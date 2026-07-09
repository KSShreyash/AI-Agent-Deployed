"""
main.py — Process Improvement Agent v5
FastAPI · MongoDB · JWT Auth · Google OAuth · Google Calendar
Chat · STT · TTS · Reports · Assignments · Members
"""

import io
import json
import os
import uuid
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from bson import ObjectId
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database as db
import auth
from agent import AgentSession, get_openai_client

# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR   = BASE_DIR / "data"

# Legacy JSON files (for one-time migration only)
REPORTS_FILE = DATA_DIR / "reports.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _doc(d: dict) -> dict:
    """Convert a MongoDB document to a JSON-serialisable dict."""
    if d is None:
        return None
    d = dict(d)
    if "_id" in d:
        d["id"] = str(d.pop("_id"))
    for k, v in list(d.items()):
        if isinstance(v, ObjectId):
            d[k] = str(v)
    return d


def _load_json_file(path: Path) -> list:
    try:
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            return []
        return json.loads(text)
    except Exception as e:
        logger.warning("Could not load %s: %s", path, e)
        return []


# ---------------------------------------------------------------------------
# Google Calendar helper
# ---------------------------------------------------------------------------

async def _push_calendar_event(
    access_token: str,
    refresh_token: str,
    user_id: str,
    assignment: dict,
) -> Optional[str]:
    """
    Create a Google Calendar event for the assignment session date + time.
    Returns the Calendar event ID, or None on failure.
    Updates the user's access token in DB if refreshed.
    """
    due_date     = assignment.get("due_date", "")
    session_time = assignment.get("session_time", "10:00") or "10:00"
    if not due_date or not access_token:
        return None

    # Build start/end datetimes from date + time slot
    try:
        h, m   = [int(x) for x in session_time.split(":")]
        end_h  = h + 1 if h < 23 else 23
        end_m  = m
        start_dt = f"{due_date}T{h:02d}:{m:02d}:00"
        end_dt   = f"{due_date}T{end_h:02d}:{end_m:02d}:00"
    except Exception:
        start_dt = f"{due_date}T10:00:00"
        end_dt   = f"{due_date}T11:00:00"

    event_body = {
        "summary": "Process Improvement Session — Yolex Labs",
        "description": (
            f"You have been assigned a process improvement session.\n\n"
            f"Session scheduled: {due_date} at {session_time}\n\n"
            + (f"Notes from your manager: {assignment['notes']}" if assignment.get("notes") else "")
        ),
        "start": {
            "dateTime": start_dt,
            "timeZone": "Asia/Kolkata",
        },
        "end": {
            "dateTime": end_dt,
            "timeZone": "Asia/Kolkata",
        },
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "email",  "minutes": 1440},   # 24 h
                {"method": "popup",  "minutes": 60},
            ],
        },
    }

    cal_url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

    async def _try_create(token: str) -> Optional[dict]:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                cal_url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=event_body,
            )
            if r.status_code == 200 or r.status_code == 201:
                return r.json()
            if r.status_code == 401:
                return None   # signal: need refresh
            logger.warning("Calendar API error %s: %s", r.status_code, r.text[:300])
            return False      # other error

    result = await _try_create(access_token)

    # Token expired — try refresh
    if result is None and refresh_token:
        new_tokens = await auth.refresh_google_token(refresh_token)
        if new_tokens and new_tokens.get("access_token"):
            new_at = new_tokens["access_token"]
            # Persist new access token
            try:
                database = db.get_db()
                await database.users.update_one(
                    {"_id": ObjectId(user_id)},
                    {"$set": {"google_access_token": new_at}},
                )
            except Exception:
                pass
            result = await _try_create(new_at)

    if result and isinstance(result, dict):
        event_id = result.get("id")
        logger.info("Calendar event created: %s", event_id)
        return event_id

    return None


# ---------------------------------------------------------------------------
# Pre-assignment matching
# ---------------------------------------------------------------------------

async def _match_pending_assignments(database, email: str, user_id: str, access_token: str):
    """
    When a new user logs in via Google, find any assignments that were
    pre-created for their email (candidate_id is null) and link them.
    Also push Calendar events for each matched assignment.
    """
    pending = await database.assignments.find(
        {"candidate_email": email, "candidate_id": None}
    ).to_list(50)

    for a in pending:
        await database.assignments.update_one(
            {"_id": a["_id"]},
            {"$set": {"candidate_id": user_id}},
        )
        # Try to push Calendar event
        user_doc = await database.users.find_one({"_id": ObjectId(user_id)})
        if user_doc:
            rt = user_doc.get("google_refresh_token", "")
            ev_id = await _push_calendar_event(access_token, rt, user_id, a)
            if ev_id:
                await database.assignments.update_one(
                    {"_id": a["_id"]},
                    {"$set": {"calendar_event_id": ev_id}},
                )
        logger.info("Matched pre-assignment %s → user %s", str(a["_id"]), user_id)


# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------

async def _ensure_indexes():
    database = db.get_db()
    await database.users.create_index("email", unique=True)
    await database.reports.create_index("report_id", unique=True, sparse=True)
    await database.assignments.create_index("candidate_email")   # for pre-assignment lookup
    logger.info("MongoDB indexes ensured")


async def _migrate_json():
    """One-time migration from JSON files → MongoDB (safe, idempotent)."""
    database = db.get_db()
    if REPORTS_FILE.exists():
        for r in _load_json_file(REPORTS_FILE):
            try:
                rid = r.get("report_id")
                if rid:
                    await database.reports.update_one(
                        {"report_id": rid}, {"$setOnInsert": r}, upsert=True
                    )
            except Exception:
                pass
    logger.info("JSON → MongoDB migration complete")


async def _seed_default_manager():
    """Create a default manager account if no users exist."""
    database = db.get_db()
    count = await database.users.count_documents({})
    if count == 0:
        default_email    = os.getenv("DEFAULT_MANAGER_EMAIL", "admin@yolexlabs.com")
        default_password = os.getenv("DEFAULT_MANAGER_PASSWORD", "Admin@1234")
        await database.users.insert_one({
            "name":          "Admin",
            "email":         default_email,
            "password_hash": auth.hash_password(default_password),
            "role":          "manager",
            "department":    "Administration",
            "job_role":      "System Administrator",
            "is_active":     True,
            "auth_provider": "local",
            "created_at":    datetime.now(timezone.utc).isoformat(),
            "created_by":    "system",
        })
        logger.info("Default manager created: %s / %s", default_email, default_password)


@asynccontextmanager
async def lifespan(application: FastAPI):
    try:
        await db.connect()
        await _ensure_indexes()
        await _migrate_json()
        await _seed_default_manager()
    except Exception as e:
        logger.error("Startup error: %s", e)
        raise
    yield
    await db.disconnect()


# ---------------------------------------------------------------------------
app = FastAPI(title="Process Improvement Agent API", version="5.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

sessions: dict[str, AgentSession] = {}

def _get_session(sid: str) -> AgentSession:
    if sid not in sessions:
        sessions[sid] = AgentSession(sid)
    return sessions[sid]


# ---------------------------------------------------------------------------
# ── GOOGLE OAUTH ─────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.get("/api/auth/google/login")
async def google_login(state: str = ""):
    """Redirect the browser to Google's OAuth consent page."""
    try:
        url = auth.build_google_oauth_url(state=state)
    except ValueError as e:
        raise HTTPException(500, str(e))
    return RedirectResponse(url)


@app.get("/api/auth/google/callback")
async def google_callback(code: str = Query(...), state: str = ""):
    """
    Google redirects here after consent.
    Exchange code → tokens → upsert user → match pre-assignments → issue JWT.
    """
    # 1. Exchange code for tokens
    try:
        tokens = await auth.exchange_google_code(code)
    except Exception as e:
        logger.error("Google token exchange failed: %s", e)
        raise HTTPException(400, "Google authentication failed — please try again.")

    access_token  = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")

    # 2. Fetch Google profile
    try:
        userinfo = await auth.get_google_userinfo(access_token)
    except Exception as e:
        logger.error("Google userinfo fetch failed: %s", e)
        raise HTTPException(400, "Could not retrieve your Google profile.")

    email     = userinfo.get("email", "").lower().strip()
    name      = userinfo.get("name", "")
    google_id = userinfo.get("id") or userinfo.get("sub", "")
    picture   = userinfo.get("picture", "")

    if not email:
        raise HTTPException(400, "Google account has no email address.")

    database = db.get_db()

    # 3. Upsert user in MongoDB
    existing = await database.users.find_one({"email": email})
    if existing:
        update_fields = {
            "google_id":            google_id,
            "google_access_token":  access_token,
            "picture":              picture,
            "auth_provider":        "google",
        }
        if refresh_token:   # only overwrite if Google returned a new one
            update_fields["google_refresh_token"] = refresh_token
        await database.users.update_one(
            {"_id": existing["_id"]},
            {"$set": update_fields},
        )
        user_id = str(existing["_id"])
        role    = existing.get("role", "candidate")
        name    = existing.get("name") or name
        rt      = refresh_token or existing.get("google_refresh_token", "")
    else:
        # New user — created as candidate; manager can promote later
        doc = {
            "name":                 name,
            "email":                email,
            "google_id":            google_id,
            "google_access_token":  access_token,
            "google_refresh_token": refresh_token,
            "picture":              picture,
            "role":                 "candidate",
            "department":           "",
            "job_role":             "",
            "is_active":            True,
            "auth_provider":        "google",
            "created_at":           datetime.now(timezone.utc).isoformat(),
            "created_by":           "google_oauth",
        }
        result  = await database.users.insert_one(doc)
        user_id = str(result.inserted_id)
        role    = "candidate"
        rt      = refresh_token

    # 4. Match any pending pre-assignments for this email
    await _match_pending_assignments(database, email, user_id, access_token)

    # 5. Issue our own JWT
    jwt_token = auth.create_token({
        "sub":     user_id,
        "email":   email,
        "name":    name,
        "role":    role,
        "dept":    "",
        "picture": picture,
    })

    # 6. Redirect to appropriate page
    if role == "manager":
        return RedirectResponse(f"/app?token={jwt_token}")
    else:
        return RedirectResponse(f"/dashboard?token={jwt_token}")


# ---------------------------------------------------------------------------
# ── AUTH (email + password) ───────────────────────────────────────────────────
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "manager"
    department: str = ""
    job_role: str = ""

class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "candidate"
    department: str = ""
    job_role: str = ""

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    database = db.get_db()
    user = await database.users.find_one({"email": req.email.lower().strip()})
    if not user or not auth.verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(403, "Account is deactivated — contact your manager")

    token = auth.create_token({
        "sub":     str(user["_id"]),
        "email":   user["email"],
        "name":    user["name"],
        "role":    user["role"],
        "dept":    user.get("department", ""),
        "picture": user.get("picture", ""),
    })
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user": {
            "id":         str(user["_id"]),
            "name":       user["name"],
            "email":      user["email"],
            "role":       user["role"],
            "department": user.get("department", ""),
            "job_role":   user.get("job_role", ""),
            "picture":    user.get("picture", ""),
        },
    }


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    """Self-registration — only when no managers exist."""
    database = db.get_db()
    if await database.users.count_documents({"role": "manager"}) > 0:
        raise HTTPException(403, "Registration is closed. Contact your administrator.")

    email = req.email.lower().strip()
    if await database.users.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists")

    doc = {
        "name":          req.name,
        "email":         email,
        "password_hash": auth.hash_password(req.password),
        "role":          "manager",
        "department":    req.department,
        "job_role":      req.job_role,
        "is_active":     True,
        "auth_provider": "local",
        "created_at":    datetime.now(timezone.utc).isoformat(),
        "created_by":    "self",
    }
    result = await database.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _doc(doc)


@app.get("/api/auth/me")
async def me(user: dict = Depends(auth.get_current_user)):
    return user


@app.put("/api/auth/change-password")
async def change_password(req: ChangePasswordRequest, user: dict = Depends(auth.get_current_user)):
    database = db.get_db()
    doc = await database.users.find_one({"_id": ObjectId(user["sub"])})
    if not doc or not auth.verify_password(req.old_password, doc.get("password_hash", "")):
        raise HTTPException(400, "Current password is incorrect")
    await database.users.update_one(
        {"_id": ObjectId(user["sub"])},
        {"$set": {"password_hash": auth.hash_password(req.new_password)}},
    )
    return {"changed": True}


# ---------------------------------------------------------------------------
# ── MEMBERS (Manager only) ───────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.get("/api/users")
async def list_users(_: dict = Depends(auth.require_manager)):
    database = db.get_db()
    users = await database.users.find({}, {"password_hash": 0, "google_access_token": 0, "google_refresh_token": 0}).to_list(500)
    return [_doc(u) for u in users]


@app.post("/api/users")
async def create_user(req: CreateUserRequest, manager: dict = Depends(auth.require_manager)):
    database = db.get_db()
    email = req.email.lower().strip()
    if await database.users.find_one({"email": email}):
        raise HTTPException(409, f"An account with email '{email}' already exists")

    doc = {
        "name":          req.name,
        "email":         email,
        "password_hash": auth.hash_password(req.password),
        "role":          req.role if req.role in ("manager", "candidate") else "candidate",
        "department":    req.department,
        "job_role":      req.job_role,
        "is_active":     True,
        "auth_provider": "local",
        "created_at":    datetime.now(timezone.utc).isoformat(),
        "created_by":    manager.get("email", "unknown"),
    }
    result = await database.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    resp = _doc(doc)
    resp.pop("password_hash", None)
    return resp


@app.patch("/api/users/{user_id}")
async def toggle_user(user_id: str, body: dict, _: dict = Depends(auth.require_manager)):
    database = db.get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(400, "Invalid user ID")
    update = {}
    if "is_active" in body:
        update["is_active"] = bool(body["is_active"])
    if "role" in body and body["role"] in ("manager", "candidate"):
        update["role"] = body["role"]
    if not update:
        raise HTTPException(400, "Nothing to update")
    result = await database.users.update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"updated": True}


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: str, current: dict = Depends(auth.require_manager)):
    if user_id == current.get("sub"):
        raise HTTPException(400, "You cannot delete your own account")
    database = db.get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(400, "Invalid user ID")
    result = await database.users.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(404, "User not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# ── SESSION ──────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.post("/api/session/new")
async def new_session(_: dict = Depends(auth.get_current_user)):
    sid = str(uuid.uuid4())
    _get_session(sid)
    return {"session_id": sid}


# ---------------------------------------------------------------------------
# ── CHAT ─────────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    session_id: str
    message: str
    candidate_name: Optional[str] = None


@app.post("/api/chat")
async def chat(req: ChatRequest, _: dict = Depends(auth.get_current_user)):
    if not req.message.strip():
        raise HTTPException(400, "Message cannot be empty")
    return _get_session(req.session_id).send_message(req.message)


# ---------------------------------------------------------------------------
# ── VOICE ────────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

class SpeakRequest(BaseModel):
    text: str
    voice: str = "nova"


@app.post("/api/transcribe")
async def transcribe_audio(audio: UploadFile = File(...), _: dict = Depends(auth.get_current_user)):
    try:
        content  = await audio.read()
        filename = audio.filename or "recording.webm"
        mime     = audio.content_type or "audio/webm"
        buf      = io.BytesIO(content); buf.name = filename
        client   = get_openai_client()
        result   = client.audio.transcriptions.create(
            model=os.getenv("STT_MODEL", "whisper-1"),
            file=(filename, buf, mime),
            response_format="text",
        )
        text = result if isinstance(result, str) else result.text
        return {"text": text.strip()}
    except Exception as e:
        logger.exception("Transcription error")
        raise HTTPException(500, f"Transcription failed: {e}")


@app.post("/api/speak")
async def speak_text(req: SpeakRequest, _: dict = Depends(auth.get_current_user)):
    text = req.text.strip()[:1000]
    if not text:
        raise HTTPException(400, "Text is empty")
    try:
        client = get_openai_client()
        resp   = client.audio.speech.create(
            model=os.getenv("TTS_MODEL", "tts-1"),
            voice=os.getenv("TTS_VOICE", req.voice),
            input=text,
            response_format="mp3",
        )
        audio = resp.content
        return Response(content=audio, media_type="audio/mpeg",
                        headers={"Content-Length": str(len(audio)), "Cache-Control": "no-store"})
    except Exception as e:
        logger.exception("TTS error")
        raise HTTPException(500, f"Speech synthesis failed: {e}")


# ---------------------------------------------------------------------------
# ── REPORTS ──────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

class SaveReportRequest(BaseModel):
    report: dict


@app.post("/api/reports/save")
async def save_report(req: SaveReportRequest, user: dict = Depends(auth.get_current_user)):
    report = req.report
    if not report.get("timestamp"):
        report["timestamp"] = datetime.now(timezone.utc).isoformat()
    report.setdefault("submitted_by", user.get("email", "unknown"))
    report.setdefault("candidate_name", user.get("name", ""))

    database = db.get_db()

    # Due-date enforcement
    user_id = user.get("sub", "")
    if user_id:
        assignment = await database.assignments.find_one(
            {"candidate_id": user_id, "status": {"$in": ["pending", "in_progress"]}},
            sort=[("created_at", -1)],
        )
        if assignment:
            due_raw = assignment.get("due_date", "")
            if due_raw:
                try:
                    from datetime import date as _date
                    due   = _date.fromisoformat(due_raw[:10])
                    today = datetime.now(timezone.utc).date()
                    if today > due:
                        raise HTTPException(
                            403,
                            f"Your session deadline passed on {due.strftime('%d %b %Y')}. "
                            "Please ask your manager to extend your assignment due date.",
                        )
                except HTTPException:
                    raise
                except Exception:
                    pass

    rid = report.get("report_id")
    if rid:
        existing = await database.reports.find_one({"report_id": rid})
        if existing:
            return {"saved": False, "reason": "duplicate", "report_id": rid}
    result = await database.reports.insert_one(report)

    # ── Mark the matching assignment as completed ─────────────────────────────
    # Motor's update_one does NOT support sort — find the target first, then update by _id.
    user_email = user.get("email", "").lower().strip()
    sub        = user.get("sub", "")
    assign_filter = {
        "status": {"$in": ["pending", "in_progress"]},
        "$or": [
            {"candidate_id":    sub},
            {"candidate_email": user_email},
        ],
    }
    target_assign = await database.assignments.find_one(
        assign_filter,
        sort=[("created_at", -1)],
    )
    if target_assign:
        await database.assignments.update_one(
            {"_id": target_assign["_id"]},
            {"$set": {
                "status":       "completed",
                "report_id":    rid,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
    # ─────────────────────────────────────────────────────────────────────────


    return {"saved": True, "report_id": rid, "mongo_id": str(result.inserted_id)}


@app.get("/api/reports")
async def list_reports(_: dict = Depends(auth.get_current_user)):
    database = db.get_db()
    docs = await database.reports.find({}).sort("timestamp", -1).to_list(500)
    return [_doc(r) for r in docs]


@app.get("/api/reports/{report_id}")
async def get_report(report_id: str, _: dict = Depends(auth.get_current_user)):
    database = db.get_db()
    doc = await database.reports.find_one({"report_id": report_id})
    if not doc:
        raise HTTPException(404, f"Report {report_id} not found")
    return _doc(doc)


@app.delete("/api/reports/{report_id}")
async def delete_report(report_id: str, _: dict = Depends(auth.require_manager)):
    database = db.get_db()
    result = await database.reports.delete_one({"report_id": report_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Report not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# ── ASSIGNMENTS ──────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

class AssignmentCreate(BaseModel):
    candidate_email: str          # required — used for pre-assignment matching
    candidate_name:  str = ""     # optional hint if user doesn't exist yet
    due_date:        str          # required
    session_time:    str = "10:00" # HH:MM time slot for the calendar event
    notes:           str = ""


class AssignmentUpdate(BaseModel):
    status:    str
    report_id: Optional[str] = None


class ExtendDueDateRequest(BaseModel):
    due_date: str


@app.get("/api/assignments")
async def list_assignments(_: dict = Depends(auth.get_current_user)):
    database = db.get_db()
    docs = await database.assignments.find({}).sort("created_at", -1).to_list(500)
    return [_doc(a) for a in docs]


@app.get("/api/assignments/mine")
async def my_assignments(user: dict = Depends(auth.get_current_user)):
    """Candidate: get all their assignments (active + completed), annotated with is_expired."""
    database  = db.get_db()
    docs = await database.assignments.find(
        {"candidate_id": user["sub"]}
    ).sort("created_at", -1).to_list(50)
    today = datetime.now(timezone.utc).date()
    result = []
    for d in docs:
        a = _doc(d)
        due_raw = a.get("due_date", "")
        try:
            from datetime import date as _date
            a["is_expired"] = bool(due_raw) and today > _date.fromisoformat(due_raw[:10])
        except Exception:
            a["is_expired"] = False
        result.append(a)
    return result


@app.post("/api/assignments")
async def create_assignment(
    req: AssignmentCreate,
    manager: dict = Depends(auth.require_manager),
):
    if not req.due_date:
        raise HTTPException(400, "Due date is required")
    if not req.candidate_email:
        raise HTTPException(400, "Candidate email is required")

    database = db.get_db()
    email = req.candidate_email.lower().strip()

    # Look up existing user by email
    user_doc       = await database.users.find_one({"email": email})
    candidate_id   = str(user_doc["_id"]) if user_doc else None
    candidate_name = (user_doc.get("name") if user_doc else None) or req.candidate_name or email

    doc = {
        "short_id":        str(uuid.uuid4())[:8],
        "candidate_id":    candidate_id,            # None if user not yet registered
        "candidate_email": email,                   # always stored for matching
        "candidate_name":  candidate_name,
        "notes":           req.notes,
        "due_date":        req.due_date,
        "session_time":    req.session_time or "10:00",
        "status":          "pending",
        "report_id":       None,
        "calendar_event_id": None,
        "created_at":      datetime.now(timezone.utc).isoformat(),
        "created_by":      manager.get("email", "unknown"),
    }
    result = await database.assignments.insert_one(doc)
    doc["_id"] = result.inserted_id
    saved = _doc(doc)

    # Push Calendar event if user already has a Google token
    if user_doc and user_doc.get("google_access_token"):
        ev_id = await _push_calendar_event(
            user_doc["google_access_token"],
            user_doc.get("google_refresh_token", ""),
            candidate_id,
            doc,
        )
        if ev_id:
            await database.assignments.update_one(
                {"_id": result.inserted_id},
                {"$set": {"calendar_event_id": ev_id}},
            )
            saved["calendar_event_id"] = ev_id

    return saved


@app.patch("/api/assignments/{assign_id}/due-date")
async def extend_due_date(assign_id: str, req: ExtendDueDateRequest, _: dict = Depends(auth.require_manager)):
    """Manager extends the due date. Also updates Calendar event if possible."""
    if not req.due_date:
        raise HTTPException(400, "due_date is required")
    database = db.get_db()
    try:
        oid = ObjectId(assign_id)
    except Exception:
        raise HTTPException(400, "Invalid assignment ID")
    result = await database.assignments.update_one(
        {"_id": oid},
        {"$set": {"due_date": req.due_date}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Assignment not found")
    return {"updated": True, "due_date": req.due_date}


@app.patch("/api/assignments/{assign_id}")
async def update_assignment(assign_id: str, req: AssignmentUpdate, _: dict = Depends(auth.get_current_user)):
    database = db.get_db()
    update: dict = {"status": req.status}
    if req.report_id:
        update["report_id"] = req.report_id
    try:
        oid = ObjectId(assign_id)
    except Exception:
        raise HTTPException(400, "Invalid assignment ID")
    result = await database.assignments.update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Assignment not found")
    return {"updated": True}


@app.delete("/api/assignments/{assign_id}")
async def delete_assignment(assign_id: str, _: dict = Depends(auth.require_manager)):
    database = db.get_db()
    try:
        oid = ObjectId(assign_id)
    except Exception:
        raise HTTPException(400, "Invalid assignment ID")
    result = await database.assignments.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(404, "Assignment not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# ── EMPLOYEE DASHBOARD ────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.get("/api/employee/dashboard")
async def employee_dashboard(user: dict = Depends(auth.get_current_user)):
    """Return structured dashboard data for the logged-in employee."""
    database   = db.get_db()
    user_id    = user.get("sub", "")
    user_email = user.get("email", "").lower().strip()

    # Query by BOTH candidate_id AND candidate_email so pre-assigned
    # (before the employee signed up) assignments are always found.
    query = {
        "$or": [
            {"candidate_id":    user_id},
            {"candidate_email": user_email},
        ]
    }
    all_assigns = await database.assignments.find(
        query
    ).sort("created_at", -1).to_list(100)

    today   = datetime.now(timezone.utc).date()
    upcoming, completed = [], []

    for d in all_assigns:
        a = _doc(d)
        due_raw = a.get("due_date", "")
        try:
            from datetime import date as _date
            a["is_expired"] = bool(due_raw) and today > _date.fromisoformat(due_raw[:10])
        except Exception:
            a["is_expired"] = False
        if a.get("status") == "completed":
            completed.append(a)
        else:
            upcoming.append(a)

    # Fetch user profile for avatar/name
    try:
        user_doc = await database.users.find_one(
            {"_id": ObjectId(user_id)},
            {"password_hash": 0, "google_access_token": 0, "google_refresh_token": 0},
        )
    except Exception:
        user_doc = None
    profile = _doc(user_doc) if user_doc else {}

    return {
        "profile":   profile,
        "upcoming":  upcoming,
        "completed": completed,
    }


# ---------------------------------------------------------------------------
# ── MANAGER STATS ────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.get("/api/manager/stats")
async def manager_stats(_: dict = Depends(auth.require_manager)):
    try:
        database  = db.get_db()
        reports   = await database.reports.find({}).to_list(5000)
        users     = await database.users.find({}).to_list(5000)
        assigns   = await database.assignments.find({}).to_list(5000)

        candidates = [u for u in users if u.get("role") == "candidate"]

        severity_count = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for r in reports:
            s = (r.get("severity") or "low").lower().strip()
            severity_count[s] = severity_count.get(s, 0) + 1

        assign_status = {"pending": 0, "in_progress": 0, "completed": 0}
        for a in assigns:
            s = (a.get("status") or "pending").lower().strip()
            assign_status[s] = assign_status.get(s, 0) + 1

        recent        = sorted(reports, key=lambda r: r.get("timestamp", ""), reverse=True)[:5]
        total_assigns = len(assigns) or 1

        return {
            "total_reports":      len(reports),
            "total_candidates":   len(candidates),
            "total_assignments":  len(assigns),
            "total_users":        len(users),
            "critical_issues":    severity_count.get("critical", 0) + severity_count.get("high", 0),
            "severity_breakdown": severity_count,
            "assignment_status":  assign_status,
            "completion_rate":    round(assign_status["completed"] / total_assigns * 100, 1),
            "recent_reports":     [_doc(r) for r in recent],
        }
    except Exception as exc:
        logger.exception("Stats error: %s", exc)
        raise HTTPException(500, f"Stats failed: {exc}")


# ---------------------------------------------------------------------------
# ── HEALTH ───────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# ── STATIC + SPA ─────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_landing():
    """Public landing page."""
    lp = STATIC_DIR / "landing.html"
    if lp.exists():
        return HTMLResponse(content=lp.read_text(encoding="utf-8"))
    # Fallback to app if landing page not built yet
    idx = STATIC_DIR / "index.html"
    if idx.exists():
        return HTMLResponse(content=idx.read_text(encoding="utf-8"))
    raise HTTPException(404, "Frontend not found")


@app.get("/app", response_class=HTMLResponse)
async def serve_app():
    """Main interview + manager app (login-gated)."""
    idx = STATIC_DIR / "index.html"
    if idx.exists():
        return HTMLResponse(content=idx.read_text(encoding="utf-8"))
    raise HTTPException(404, "Frontend not found")


@app.get("/dashboard", response_class=HTMLResponse)
async def serve_dashboard():
    """Employee personal dashboard."""
    db_html = STATIC_DIR / "dashboard.html"
    if db_html.exists():
        return HTMLResponse(content=db_html.read_text(encoding="utf-8"))
    raise HTTPException(404, "Dashboard not found")


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not found")
    idx = STATIC_DIR / "index.html"
    if idx.exists():
        return HTMLResponse(content=idx.read_text(encoding="utf-8"))
    raise HTTPException(404, "Frontend not found")


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    import uvicorn
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("\n" + "=" * 66)
    print("  Process Improvement Agent  v5.0 — Google OAuth Edition")
    print("  http://localhost:8000          Landing page")
    print("  http://localhost:8000/app      Manager / Interview portal")
    print("  http://localhost:8000/dashboard  Employee dashboard")
    print("  Default admin: admin@yolexlabs.com / Admin@1234")
    print("=" * 66 + "\n")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
