"""
agent.py — OpenAI Chat Agent for Process Improvement Consulting
Uses openai SDK (v1.x) with GPT-4o-mini, history management, and retry logic.
"""

import os
import re
import json
import time
import random
import logging
from datetime import datetime, timezone
from typing import Optional

from openai import OpenAI, RateLimitError, APIStatusError, APIConnectionError
from dotenv import load_dotenv

from prompts.system_prompt import SYSTEM_PROMPT

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_CHAT_MODEL = "gpt-4o-mini"
MAX_RETRIES        = 4
BASE_DELAY         = 5.0   # seconds
MAX_DELAY          = 60.0  # seconds cap


def _build_client() -> OpenAI:
    key = os.getenv("OPENAI_API_KEY", "")
    if not key or key.startswith("sk-..."):
        raise ValueError(
            "OPENAI_API_KEY is not set. "
            "Copy .env.example → .env and add your key from "
            "https://platform.openai.com/api-keys"
        )
    return OpenAI(api_key=key)


# ---------------------------------------------------------------------------
# Agent Session
# ---------------------------------------------------------------------------

class AgentSession:
    """
    One chat session per browser conversation.
    Maintains full history as plain dicts for the OpenAI messages format.
    """

    def __init__(self, session_id: str):
        self.session_id  = session_id
        self.client      = _build_client()
        self.model       = os.getenv("CHAT_MODEL", DEFAULT_CHAT_MODEL)
        # History: list of {"role": "user"|"assistant", "content": str}
        self.history: list[dict] = []
        self.reports_this_session: list[dict] = []
        self.created_at  = datetime.now(timezone.utc).isoformat()
        logger.info("Session [%s] created — model: %s", session_id, self.model)

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def send_message(self, user_text: str) -> dict:
        """
        Send user text → OpenAI chat → return structured response.
        Returns: { "text": str, "report": dict|None, "has_report": bool }
        """
        self.history.append({"role": "user", "content": user_text})

        raw = self._chat_with_retry()

        if raw is None:
            self.history.pop()   # remove failed user msg
            return {
                "text": (
                    "⚠️ The AI service is temporarily unavailable. "
                    "Please wait a moment and try again."
                ),
                "report": None,
                "has_report": False,
            }

        self.history.append({"role": "assistant", "content": raw})

        report, clean = self._extract_report(raw)
        if report:
            self.reports_this_session.append(report)

        return {"text": clean.strip(), "report": report, "has_report": report is not None}

    def get_history(self) -> list[dict]:
        return list(self.history)

    # ------------------------------------------------------------------
    # Internal: chat with retry
    # ------------------------------------------------------------------

    def _chat_with_retry(self) -> Optional[str]:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + self.history
        delay    = BASE_DELAY

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=3000,
                    top_p=0.9,
                )
                return resp.choices[0].message.content

            except RateLimitError as e:
                if attempt < MAX_RETRIES:
                    wait = min(delay + random.uniform(0, 2), MAX_DELAY)
                    logger.warning("Rate limit (attempt %d/%d) — retry in %.1fs", attempt, MAX_RETRIES, wait)
                    time.sleep(wait)
                    delay = min(delay * 2, MAX_DELAY)
                else:
                    logger.error("Rate limit exhausted: %s", e)
                    return None

            except (APIStatusError, APIConnectionError) as e:
                logger.error("OpenAI API error (attempt %d): %s", attempt, e)
                if attempt < MAX_RETRIES:
                    time.sleep(BASE_DELAY)
                else:
                    return None

            except Exception as e:
                logger.exception("Unexpected error (attempt %d): %s", attempt, e)
                return None

        return None

    # ------------------------------------------------------------------
    # Report extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_report(text: str) -> tuple[Optional[dict], str]:
        """Pull <REPORT_JSON>…</REPORT_JSON> (or raw JSON blocks) from the AI reply."""

        # ── 1. Preferred: tagged block ────────────────────────────────────────
        match = re.search(r"<REPORT_JSON>(.*?)</REPORT_JSON>", text, re.DOTALL)

        # ── 2. Fallback: ```json ... ``` fenced block ─────────────────────────
        if not match:
            match = re.search(r"```(?:json)?\s*([\s\S]*?report_type[\s\S]*?)```", text, re.DOTALL)

        # ── 3. Fallback: bare { ... } object containing "report_type" ─────────
        if not match:
            match = re.search(r"(\{[^{}]*\"report_type\"[^{}]*(?:\{[^{}]*\}[^{}]*)*\})", text, re.DOTALL)

        if not match:
            return None, text

        json_str   = match.group(1).strip()
        clean_text = text[: match.start()].rstrip() + "\n" + text[match.end() :].lstrip()

        try:
            report = json.loads(json_str)
        except json.JSONDecodeError:
            # Try to strip any surrounding prose and re-parse
            inner = re.search(r"\{[\s\S]+\}", json_str)
            if inner:
                try:
                    report = json.loads(inner.group(0))
                except json.JSONDecodeError:
                    logger.warning("Could not parse embedded JSON report")
                    return None, text
            else:
                logger.warning("Could not parse embedded JSON report")
                return None, text

        if not report.get("timestamp"):
            report["timestamp"] = datetime.now(timezone.utc).isoformat()

        rid = report.get("report_id", "")
        if not rid or any(x in rid for x in ["XXX", "NNN", "[", "]"]):
            n        = _next_id()
            date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
            report["report_id"] = f"RPT-{date_str}-{n:03d}"

        # Enforce anonymity — growth_wellbeing and openline are always anonymous;
        # work reports honour is_anonymous flag set by the AI.
        rtype = report.get("report_type", "work")
        if rtype in ("growth_wellbeing", "openline"):
            report["is_anonymous"]   = True
            report["candidate_name"] = ""
        elif report.get("is_anonymous"):
            report["candidate_name"] = ""

        return report, clean_text


# ---------------------------------------------------------------------------
# Shared OpenAI client for STT / TTS (used by main.py)
# ---------------------------------------------------------------------------

_shared_client: Optional[OpenAI] = None

def get_openai_client() -> OpenAI:
    """Return a singleton OpenAI client for use in main.py (STT / TTS)."""
    global _shared_client
    if _shared_client is None:
        _shared_client = _build_client()
    return _shared_client


# ---------------------------------------------------------------------------
# Report counter
# ---------------------------------------------------------------------------

COUNTER_FILE = os.path.join(os.path.dirname(__file__), "data", "report_counter.txt")


def _next_id() -> int:
    os.makedirs(os.path.dirname(COUNTER_FILE), exist_ok=True)
    try:
        with open(COUNTER_FILE) as f:
            n = int(f.read().strip()) + 1
    except (FileNotFoundError, ValueError):
        n = 1
    with open(COUNTER_FILE, "w") as f:
        f.write(str(n))
    return n
