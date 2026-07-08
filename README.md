# Process Improvement Agent — Yolex Labs

> **AI-powered workplace diagnostic agent.** Finds where work breaks down before you build anything to fix it.

A full-stack web platform where managers assign structured sessions to employees. An AI agent conducts a natural conversation, classifies what it hears into one of three categories (Work · Growth & Wellbeing · Open Line), and produces a detailed structured report. Google OAuth handles authentication; Google Calendar gets an automatic event when a session is assigned.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Quick Start](#quick-start)
7. [Google Cloud Setup (Required)](#google-cloud-setup)
8. [Environment Variables](#environment-variables)
9. [How It Works](#how-it-works)
10. [Report Types](#report-types)
11. [User Roles](#user-roles)
12. [API Reference](#api-reference)
13. [Pre-assignment Flow](#pre-assignment-flow)
14. [Anonymity System](#anonymity-system)
15. [Deployment](#deployment)
16. [FAQ / Troubleshooting](#faq--troubleshooting)

---

## Features

| Feature | Description |
|---|---|
| Landing page | Public marketing page with Google sign-in button |
| Google OAuth | One-click sign-in for employees; no password management |
| Google Calendar sync | Automatic calendar event when a session is assigned |
| AI diagnostic agent | Natural, conversational session powered by GPT-4o |
| Voice input + TTS | Speak your answers; hear the agent's questions read aloud |
| Manager dashboard | Reports, assignments, members, and analytics in one place |
| Employee dashboard | Personal view of upcoming and completed sessions |
| Pre-assignment | Assign a session to an email before the employee signs up |
| Anonymity control | Employee chooses at end of session whether to be named |
| Three report types | Work - Growth & Wellbeing - Open Line |
| Interactive visualizer | Live process flowchart (tldraw) during the session |

---

## Architecture

```
Browser
  landing.html (Public)
  dashboard.html (Employee)
  index.html (Manager/Interview)
        |
        | HTTP / REST
        v
FastAPI (main.py)
  /api/auth/google/login     -> Google OAuth redirect
  /api/auth/google/callback  -> token exchange + user upsert
  /api/chat                  -> GPT-4o conversation
  /api/assignments           -> CRUD + Calendar push
  /api/employee/dashboard    -> employee session data
  /api/reports               -> report storage / retrieval
  /api/manager/stats         -> dashboard analytics
        |
   _____|_____________________
  |                           |
MongoDB (Motor async)     External APIs
  users                     Google OAuth 2.0
  reports                   Google Calendar API
  assignments               OpenAI (GPT-4o, Whisper, TTS)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 - FastAPI - Uvicorn |
| Database | MongoDB (local or Atlas) - Motor (async driver) |
| AI | OpenAI GPT-4o (chat) - Whisper (speech-to-text) - TTS |
| Auth | JWT (HS256) - Google OAuth 2.0 |
| Calendar | Google Calendar REST API v3 |
| Frontend | Vanilla HTML/CSS/JS (no framework) - tldraw (visualizer) |
| HTTP client | httpx (async, for Google API calls) |

---

## Project Structure

```
Problem Tracking Agent/
|
+-- main.py              # FastAPI app -- all routes
+-- agent.py             # GPT-4o session logic
+-- auth.py              # JWT + Google OAuth helpers
+-- database.py          # MongoDB connection (Motor)
+-- requirements.txt
+-- .env                 # NOT committed (secrets)
+-- .env.example         # committed template (no real secrets)
+-- .gitignore
|
+-- prompts/
|   +-- system_prompt.py # AI persona, report schemas, anonymity rules
|
+-- static/
    +-- landing.html     # Public landing page  ->  GET /
    +-- landing.css
    +-- index.html       # Login + Manager + Interview  ->  GET /app
    +-- style.css
    +-- app.js
    +-- dashboard.html   # Employee personal dashboard  ->  GET /dashboard
    +-- dashboard.css
    +-- dashboard.js
```

---

## Prerequisites

- **Python 3.11+**
- **MongoDB** -- local (`mongod`) or free cloud tier at mongodb.com/atlas
- **OpenAI API key** -- platform.openai.com
- **Google Cloud project** -- see Google Cloud Setup below

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/process-improvement-agent.git
cd "process-improvement-agent"

python -m venv venv

# Windows:
venv\Scripts\activate

# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Configure environment

```bash
# Windows:
copy .env.example .env

# macOS/Linux:
cp .env.example .env
```

Edit `.env` and fill in all values (see Environment Variables section below).

### 3. Start MongoDB

```bash
# If running locally:
mongod --dbpath ./data/db
```

Or use MongoDB Atlas and set `MONGODB_URI` in `.env`.

### 4. Run the server

```bash
python main.py
```

The terminal will print:

```
Process Improvement Agent  v5.0 -- Google OAuth Edition
http://localhost:8000          Landing page
http://localhost:8000/app      Manager / Interview portal
http://localhost:8000/dashboard  Employee dashboard
Default admin: admin@yolexlabs.com / Admin@1234
```

---

## Google Cloud Setup

This is required for Google login and Google Calendar sync. Without it, only the email + password admin login works.

### Step-by-step

**Step 1** -- Go to console.cloud.google.com -> New Project -> give it a name (e.g. "Process Agent").

**Step 2** -- In the left menu -> APIs & Services -> Library:
- Enable **Google Calendar API**
- Enable **People API** (for profile photos)

**Step 3** -- In APIs & Services -> Credentials -> Create Credentials -> OAuth 2.0 Client IDs:
- Application type: **Web application**
- Name: anything (e.g. "Process Agent Local")
- Authorised redirect URIs -- add exactly:
  ```
  http://localhost:8000/api/auth/google/callback
  ```
- Click Create -> copy the **Client ID** and **Client Secret**

**Step 4** -- In APIs & Services -> OAuth consent screen:
- User type: External
- Fill in App name, support email
- Scopes: add `email`, `profile`, `openid`, `https://www.googleapis.com/auth/calendar.events`
- Test users: add your own Google email while in testing mode

**Step 5** -- Paste the credentials into `.env`:

```
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
```

For production, change `GOOGLE_REDIRECT_URI` to your real domain and add it as another Authorised redirect URI in the Google Console.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
STT_MODEL=whisper-1
TTS_MODEL=tts-1
TTS_VOICE=nova

# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=process_improvement_agent

# Auth -- change JWT_SECRET to a long random string in production
JWT_SECRET=change-me-to-something-long-and-random

# Default admin account (created on first run if no users exist)
DEFAULT_MANAGER_EMAIL=admin@yolexlabs.com
DEFAULT_MANAGER_PASSWORD=Admin@1234

# Google OAuth + Calendar
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
```

---

## How It Works

### Employee flow

1. Employee visits `http://localhost:8000` -- sees the landing page
2. Clicks "Continue with Google" -- redirected to Google consent screen
3. Authorises the app -- redirected to `/dashboard`
4. Dashboard loads: shows upcoming + completed sessions
   - If manager pre-assigned a session to their email: Calendar event already created
5. Clicks "Start Session" -- goes to `/app` (consent -> interview)
6. Completes the conversation -- AI asks about anonymity preference
7. Structured JSON report saved to MongoDB
8. Dashboard: session moved to "Completed"

### Manager flow

1. Go to `http://localhost:8000/app` -- log in with admin email + password
2. Assignments tab -> enter employee email + due date
   - Assignment saved immediately
   - If employee already has Google account: Calendar event pushed instantly
   - If employee hasn't signed up yet: saved as pending pre-assignment
3. Reports tab -- see all structured reports from all sessions
   - Filter by type (Work / Growth & Wellbeing / Open Line)
   - Expand rows to see full report detail
4. Members tab -- add/remove/promote members manually if needed

---

## Report Types

The agent automatically classifies the conversation into one of three types:

### Work
Attributed reports about operational friction.

Fields: `process_name`, `process_stage`, `problem_description`, `root_cause`, `frequency`, `severity`, `priority`, `time_drain_hours_per_week`, `biggest_friction_point`, `automation_opportunity`, `quick_wins`, `team_impact`, `workarounds_in_use`, `business_impact_summary`, `suggested_solution`, `expected_impact`

Default: **attributed** (employee name included unless they choose anonymous).

### Growth & Wellbeing
Sensitive personal signals.

Fields: `upskilling_areas`, `career_concern`, `burnout_signals`, `work_life_balance_note`, `overall_wellbeing_note`

**Always forced anonymous** -- name is never stored regardless of employee preference.

### Open Line
Anything the employee wants to raise to leadership.

Fields: `escalation_topic`, `escalation_detail`, `suggested_action`, `urgency`

**Always forced anonymous** -- name is never stored.

---

## User Roles

| Role | Login method | What they can do |
|---|---|---|
| Manager | Email + password | Full dashboard, create assignments, view all reports, manage members |
| Candidate / Employee | Google OAuth (preferred) | Personal dashboard, start sessions, submit reports |

Managers can promote a candidate to manager role at any time from the Members tab.

---

## API Reference

### Auth

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/auth/google/login | Redirect to Google OAuth |
| GET | /api/auth/google/callback | OAuth callback -- issues JWT |
| POST | /api/auth/login | Email + password login |
| POST | /api/auth/register | Create first manager (when no managers exist) |
| GET | /api/auth/me | Get current user from JWT |

### Sessions & Chat

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/session/new | Start a new AI session |
| POST | /api/chat | Send a message, get AI response |
| POST | /api/transcribe | Upload audio -> text (Whisper) |
| POST | /api/speak | Text -> speech (TTS) |

### Reports

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/reports/save | Save structured report (enforces due date) |
| GET | /api/reports | List all reports (manager) |
| GET | /api/reports/{id} | Get single report |
| DELETE | /api/reports/{id} | Delete report (manager) |

### Assignments

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/assignments | List all assignments |
| GET | /api/assignments/mine | Employee's own assignments |
| POST | /api/assignments | Create assignment (by email, manager only) |
| PATCH | /api/assignments/{id} | Update status |
| PATCH | /api/assignments/{id}/due-date | Extend deadline (manager) |
| DELETE | /api/assignments/{id} | Delete assignment (manager) |

### Employee Dashboard

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/employee/dashboard | Upcoming + completed sessions + profile |

### Members

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/users | List all users (manager) |
| POST | /api/users | Create user manually (manager) |
| PATCH | /api/users/{id} | Toggle active/role (manager) |
| DELETE | /api/users/{id} | Delete user (manager) |

---

## Pre-assignment Flow

The system supports assigning sessions to employees before they create an account:

```
Manager -> Assignments tab -> enters "bob@company.com" + due date
                           -> Saved to MongoDB:
                              { candidate_email: "bob@company.com",
                                candidate_id: null,
                                status: "pending" }
                           -> No calendar event yet (Bob has no Google token)

Bob -> visits landing page -> "Continue with Google"
     -> Google callback: email = "bob@company.com"
     -> New user created in MongoDB
     -> Query: find assignments where
          candidate_email = "bob@company.com" AND candidate_id = null
     -> Found! Update: candidate_id = Bob's new ID
     -> Push Google Calendar event for each matched assignment
     -> Bob sees his session in the dashboard immediately
```

---

## Anonymity System

The agent always asks at the end of every conversation:

> "Before I finalise your report -- would you prefer I leave your name off it?"

### Rules

| Report type | Default | Employee can choose |
|---|---|---|
| Work | Named | Yes -- can request anonymous |
| Growth & Wellbeing | Always anonymous | No choice |
| Open Line | Always anonymous | No choice |

### Two-layer enforcement

1. **AI layer** -- system prompt instructs the agent to set `is_anonymous: true` if the employee requests it
2. **Frontend layer** -- `app.js` strips `candidate_name` before sending to the API if `is_anonymous` is true
3. **Backend layer** -- `agent.py` forces `is_anonymous = true` for `growth_wellbeing` and `openline` types

---

## Deployment

### Environment checklist before going live

- Change `JWT_SECRET` to a long random string:
  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```
- Change `DEFAULT_MANAGER_PASSWORD` to something secure
- Update `GOOGLE_REDIRECT_URI` to your production domain
- Add the production redirect URI in Google Console
- Use MongoDB Atlas instead of local MongoDB
- Serve behind nginx with HTTPS

### Run with gunicorn (production)

```bash
pip install gunicorn
gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## FAQ / Troubleshooting

**Q: Google login gives "redirect_uri_mismatch"**
Make sure the URI in Google Console exactly matches `GOOGLE_REDIRECT_URI` in your `.env`, including `http://` vs `https://` and trailing slashes.

**Q: Calendar event not being created**
The employee must have completed Google OAuth. If the assignment was created before they logged in, the event is pushed at their first Google login. Check server logs for `Calendar event created:`.

**Q: "Token invalid or expired" after Google login**
The JWT expires after 48 hours. Just sign in with Google again.

**Q: MongoDB connection error on startup**
Make sure `mongod` is running before starting the Python server. For Atlas, check that your IP is whitelisted in Atlas Network Access.

**Q: How do I change the AI's behaviour?**
Edit `prompts/system_prompt.py`. The entire persona, conversation style, report schemas, and anonymity wording live there.

**Q: How do I add a new manager?**
Log in as the current manager -> Members tab -> Add Member -> set Role to Manager.

---

(c) 2026 Yolex Labs. All rights reserved.
