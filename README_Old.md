# 🤖 Process Improvement Agent — Complete Beginner's Guide

> Built by Yolex Labs · Powered by Google Gemini AI · Python + FastAPI

---

## 📖 Table of Contents

1. [What Is This Project?](#1-what-is-this-project)
2. [What Problem Does It Solve?](#2-what-problem-does-it-solve)
3. [How Does It Work? (Big Picture)](#3-how-does-it-work-big-picture)
4. [Project File Structure Explained](#4-project-file-structure-explained)
5. [The Technology Stack](#5-the-technology-stack)
6. [How Each File Works](#6-how-each-file-works)
7. [The AI Agent — How It Thinks](#7-the-ai-agent--how-it-thinks)
8. [The Conversation Flow (Step by Step)](#8-the-conversation-flow-step-by-step)
9. [The Report System](#9-the-report-system)
10. [The User Interface](#10-the-user-interface)
11. [The API Endpoints](#11-the-api-endpoints)
12. [Setup & Installation Guide](#12-setup--installation-guide)
13. [How to Use the App](#13-how-to-use-the-app)
14. [Troubleshooting](#14-troubleshooting)
15. [Glossary](#15-glossary)

---

## 1. What Is This Project?

This project is an **AI-powered chat application** that acts as a professional **Organizational Process Improvement Consultant**.

Think of it like having an expert business consultant available 24/7 inside your browser. You type about a problem you're facing at work — maybe scheduling interviews takes too long, or expense reports are submitted manually — and the AI:

- 🗣️ **Listens** to what you describe
- 🔍 **Asks smart follow-up questions** to fully understand the issue
- 📊 **Analyzes** the root cause of the problem
- 💡 **Suggests improvements** based on best practices
- 📋 **Creates a formal report** with all the details in a structured format
- 💾 **Saves the report** so you can review it anytime

It is NOT just a chatbot that answers questions. It is an **intelligent interviewer** that guides you through reporting a problem in a structured way.

---

## 2. What Problem Does It Solve?

### The Real-World Problem

In most organizations:
- Employees notice process problems but don't know how to formally report them
- Managers receive vague complaints like *"the onboarding is terrible"* with no details
- There's no standard way to document: what went wrong, why it happened, who is affected, and what could fix it
- Valuable improvement ideas get lost in emails or casual conversations

### What This Agent Does

This agent **converts informal complaints and ideas into structured, actionable reports** that:
- Can be analyzed by managers and decision-makers
- Include severity, priority, and estimated business impact
- Separate facts from inferences
- Include both employee suggestions AND AI-generated recommendations

---

## 3. How Does It Work? (Big Picture)

Here is the complete journey of information through the system:

```
╔══════════════════════════════════════════════════════════════╗
║                        BROWSER                               ║
║                                                              ║
║   You type: "Our interview scheduling takes too long"        ║
║                           │                                  ║
║                    [index.html + app.js]                     ║
║                           │                                  ║
╚═══════════════════════════╪══════════════════════════════════╝
                            │  HTTP Request (your message)
                            ▼
╔══════════════════════════════════════════════════════════════╗
║                    PYTHON SERVER (main.py)                   ║
║                                                              ║
║   FastAPI receives the message                               ║
║   Looks up your chat session                                 ║
║   Calls the Agent to process it                              ║
║                           │                                  ║
╚═══════════════════════════╪══════════════════════════════════╝
                            │
                            ▼
╔══════════════════════════════════════════════════════════════╗
║                   AI AGENT (agent.py)                        ║
║                                                              ║
║   Sends your message + conversation history to Gemini AI     ║
║   Gemini reads the System Prompt (its instructions)          ║
║   Gemini decides: ask a follow-up? or generate a report?     ║
║                           │                                  ║
╚═══════════════════════════╪══════════════════════════════════╝
                            │
                            ▼
╔══════════════════════════════════════════════════════════════╗
║                  GOOGLE GEMINI AI (Cloud)                    ║
║                                                              ║
║   Reads the full conversation history                        ║
║   Applies the System Prompt rules                            ║
║   Generates an intelligent response                          ║
║                           │                                  ║
╚═══════════════════════════╪══════════════════════════════════╝
                            │  AI response comes back
                            ▼
╔══════════════════════════════════════════════════════════════╗
║                   AI AGENT (agent.py)                        ║
║                                                              ║
║   Checks: does the response contain a <REPORT_JSON> block?   ║
║   If YES → extracts and parses the JSON report               ║
║   If NO  → it's just a conversational reply                  ║
║                           │                                  ║
╚═══════════════════════════╪══════════════════════════════════╝
                            │  Response sent back to browser
                            ▼
╔══════════════════════════════════════════════════════════════╗
║                        BROWSER                               ║
║                                                              ║
║   Displays the AI's reply in the chat                        ║
║   If a report was produced:                                  ║
║     → Shows a green "Report Saved!" banner                   ║
║     → Saves the report to the server                         ║
║     → Adds it to the sidebar list                            ║
║     → You can click it to view full details                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 4. Project File Structure Explained

```
Problem Tracking Agent/
│
├── 📄 main.py                  ← The web server. Entry point of the whole app.
├── 📄 agent.py                 ← The AI brain. Manages conversations with Gemini.
├── 📄 requirements.txt         ← List of Python libraries needed to run the app.
├── 📄 start.bat                ← Windows shortcut to start the app easily.
├── 📄 .env.example             ← Template for storing your secret API key.
├── 📄 README.md                ← This file! Documentation.
│
├── 📁 prompts/
│   └── 📄 system_prompt.py    ← The AI's "job description" — all its rules and behavior.
│
├── 📁 static/
│   ├── 📄 index.html          ← The web page you see in the browser.
│   ├── 📄 style.css           ← Makes the page look beautiful (colors, layout, animations).
│   └── 📄 app.js              ← Makes the page interactive (sending messages, showing reports).
│
└── 📁 data/
    ├── 📄 reports.json        ← Database file where all saved reports are stored.
    └── 📄 report_counter.txt  ← Keeps track of report numbering (001, 002, 003…).
```

### Think of it like a restaurant:

| File | Restaurant Equivalent |
|------|----------------------|
| `main.py` | The front desk / reception — receives all requests |
| `agent.py` | The head chef — does the smart processing |
| `system_prompt.py` | The recipe book — tells the chef exactly how to cook |
| `index.html` | The dining room — what customers see |
| `style.css` | The interior design — how the dining room looks |
| `app.js` | The waiters — carry messages back and forth |
| `data/reports.json` | The order book — records everything permanently |

---

## 5. The Technology Stack

Here is every technology used and why it was chosen:

### 🐍 Python
The main programming language for the server-side code. Python is readable, widely used, and has excellent AI libraries.

### ⚡ FastAPI
A Python web framework that creates the server. It handles incoming requests from the browser and sends back responses.
- **Why FastAPI?** It's fast, modern, and automatically generates API documentation.

### 🦄 Uvicorn
The web server runner. It's what actually starts the server and listens for connections on port 8000.
- **Think of it as:** The engine that powers FastAPI.

### 🤖 Google Gemini AI (`google-generativeai`)
The AI model that powers the consultant. All the intelligent conversation, analysis, and report generation happens inside Gemini.
- **Why Gemini?** Free tier available, very capable, great at following complex instructions.

### 🌐 HTML / CSS / JavaScript
The front-end (what you see in the browser). No heavy frameworks — pure vanilla code for simplicity and speed.

### 📦 Python-dotenv
Reads your `.env` file and loads your secret API key into the program safely.

### 🗃️ JSON Files
Simple text files used to store reports. No database server needed — just files on your disk.

---

## 6. How Each File Works

### `main.py` — The Web Server

This is the **first file that runs** when you start the app. It does three things:

**1. Creates the web server:**
```python
app = FastAPI()  # Creates the server
```

**2. Defines API endpoints** (URLs the browser can call):
```
POST /api/session/new   → Creates a new chat conversation
POST /api/chat          → Sends your message, gets AI reply
POST /api/reports/save  → Saves a finished report
GET  /api/reports       → Gets list of all saved reports
DELETE /api/reports/id  → Deletes a specific report
```

**3. Serves the HTML page:**
When you open `http://localhost:8000` in your browser, `main.py` sends back `index.html`. It's like a tiny web host running on your computer.

**Session Management:**
Every time you open a new conversation, the server creates a unique ID (like `abc-123-xyz`) to track your specific chat. This is stored in memory (a Python dictionary) and links your browser to your Gemini conversation.

---

### `agent.py` — The AI Brain

This file manages the actual conversation with Google Gemini. Here's what it does:

**`AgentSession` class:**
Each conversation is stored as an `AgentSession` object. It holds:
- Your unique session ID
- The entire conversation history (so Gemini remembers what was said before)
- All reports generated in this session

**`send_message()` method:**
When you send a message:
1. It passes the message to Gemini along with all previous messages
2. Gemini generates a reply
3. The code checks if the reply contains a `<REPORT_JSON>` block
4. If yes, it extracts and parses the JSON
5. Returns everything back to `main.py`

**Report Extraction:**
The agent uses a **regular expression** (a pattern-matching tool) to find the hidden JSON block inside Gemini's response:
```
<REPORT_JSON>
{ ... JSON data ... }
</REPORT_JSON>
```
Once found, the block is removed from the visible text (so users don't see raw JSON in the chat), and the data is returned separately to be displayed beautifully.

---

### `prompts/system_prompt.py` — The AI's Instructions

This is the most important file for the AI's behavior. It is a very long set of instructions (called a **System Prompt**) that is sent to Gemini before every conversation starts.

Think of it like a detailed employee handbook. It tells Gemini:
- **Who it is:** "You are an expert Business Process Analyst and AI Interviewer"
- **What to do:** Conduct intelligent interviews, not just answer questions
- **How to behave:** Ask only relevant follow-up questions, never fabricate data
- **What to collect:** Process name, stage, problem, root cause, solution, impact, etc.
- **When to finalize:** Only after the user explicitly confirms the summary
- **How to format the report:** The exact JSON structure to use
- **Special rules:** Always label AI suggestions separately from user suggestions

This prompt is sent to Gemini with every API call, so the AI always stays "in character."

---

### `static/index.html` — The Web Page

This is the single HTML file that makes up the entire user interface. It contains:

- **The header bar** — with the app name and connection status
- **The sidebar** — shows all saved reports
- **The chat area** — where messages appear
- **The welcome screen** — shown to new users with example prompts
- **The input box** — where you type your messages
- **The report detail tab** — shows a full formatted view of any report

It loads two important libraries:
- `style.css` — for the visual design
- `app.js` — for the interactive behavior
- `marked.js` (from CDN) — to render **markdown** formatting in AI responses (like **bold**, bullet points, headers)

---

### `static/style.css` — The Visual Design

This file controls everything you see: colors, fonts, layout, animations. Key design decisions:

**Color Palette:**
- Deep navy background (`#0a0c14`) — easy on the eyes
- Violet accent (`#6d56f3`) — primary brand color
- Cyan highlight (`#22d3ee`) — for IDs and special text
- Green for success, amber for warnings, rose for errors

**Effects:**
- **Glassmorphism** — cards have a frosted glass appearance using `backdrop-filter: blur()`
- **Smooth animations** — messages slide in gently using CSS `@keyframes`
- **Typing indicator** — three bouncing dots appear while AI is thinking
- **Hover effects** — buttons and cards subtly react when you hover over them

**Layout:**
- Uses CSS Grid for the overall page structure (header + sidebar + main area)
- Uses Flexbox for component-level layouts (messages, input area, buttons)

---

### `static/app.js` — The Interactive Logic

This JavaScript file is the "glue" between the UI and the server. It does everything that happens when you interact with the page.

**Key functions:**

| Function | What It Does |
|----------|-------------|
| `init()` | Runs when page loads — creates a session, loads saved reports |
| `startNewSession()` | Calls `/api/session/new`, resets the chat area |
| `sendMessage(text)` | Sends your message to `/api/chat`, shows reply |
| `appendMessage(role, text)` | Adds a message bubble to the chat UI |
| `showTypingIndicator()` | Shows the bouncing dots while AI thinks |
| `autoSaveReport(report)` | Saves a new report to `/api/reports/save` |
| `loadSavedReports()` | Fetches all reports from `/api/reports` |
| `renderSidebarReports()` | Builds the sidebar list from saved reports |
| `viewReport(id)` | Displays a specific report in the Report View tab |
| `renderReportDetail(r)` | Builds the full HTML view of one report |
| `switchTab(tab)` | Switches between Chat and Report View tabs |
| `showToast(message)` | Shows a popup notification in the corner |

**The `api()` helper function:**
All communication with the Python server goes through this one function:
```javascript
async function api(path, method, body) {
    const res = await fetch(path, { method, body: JSON.stringify(body) });
    return res.json();
}
```
This uses the browser's built-in `fetch` API to make HTTP requests.

---

### `data/reports.json` — The Report Database

This is a simple text file that stores all your reports. It starts as an empty list `[]` and grows as reports are added:

```json
[
  {
    "report_id": "RPT-20260622-001",
    "process_name": "Recruitment",
    "severity": "High",
    ...
  },
  {
    "report_id": "RPT-20260622-002",
    "process_name": "Payroll",
    ...
  }
]
```

Every time:
- A report is **saved** → it's added to this array
- A report is **deleted** → it's removed from this array
- Reports are **listed** → this file is read and returned

The file is read and written directly by `main.py` using Python's built-in file operations.

---

## 7. The AI Agent — How It Thinks

### The System Prompt Strategy

Gemini is given a detailed set of rules (the system prompt) before any conversation begins. This transforms Gemini from a general-purpose AI into a specialized business consultant.

The key instructions include:

```
1. You are an expert Business Process Analyst.
2. Your job is to INTERVIEW users, not just answer questions.
3. Collect 10 specific pieces of information.
4. Ask only 1-2 follow-up questions at a time.
5. Never fabricate missing information — ask instead.
6. Always confirm the summary before creating a report.
7. Output the final report inside <REPORT_JSON> tags.
```

### Adaptive Conversation Logic

The AI adapts based on what you provide:

```
User gives vague info ("our process is bad")
   └─→ AI asks targeted follow-up questions

User gives detailed info
   └─→ AI extracts data, asks only for missing fields

User mentions multiple problems
   └─→ AI handles them as separate reports

User confirms summary
   └─→ AI generates the <REPORT_JSON> block
```

### Memory (Conversation History)

Every message you send and every reply the AI gives is stored in the `AgentSession` object and sent back to Gemini with each new message. This is why the AI "remembers" what you said earlier — it literally re-reads the entire conversation every time.

This is called a **stateful conversation** and is fundamental to how chat-based AI works.

### Priority Calculation Logic

The AI calculates priority using this internal logic:

```
CRITICAL → Severity is Critical
           OR (High frequency + High severity + many stakeholders affected)

HIGH     → High severity
           OR (Medium frequency + High business impact)

MEDIUM   → Medium severity with moderate frequency

LOW      → Low severity OR rare/one-time occurrence
```

---

## 8. The Conversation Flow (Step by Step)

Here is a complete example of a conversation from start to finish:

---

### Step 1: You Open the App

The browser loads `index.html`. JavaScript runs `init()`:
- Calls `/api/session/new` → gets back a session ID like `"abc-123-xyz"`
- Calls `/api/reports` → loads any previously saved reports into the sidebar
- Shows the welcome screen with example prompts

---

### Step 2: You Describe a Problem

You type: *"Our recruiters spend hours manually emailing candidates to schedule interviews."*

`app.js` calls `sendMessage()`:
- Adds your message to the chat as a blue bubble
- Shows the typing indicator (bouncing dots)
- Calls `POST /api/chat` with your message and session ID

---

### Step 3: Server Processes Your Message

`main.py` receives the request:
- Looks up your session by ID
- Calls `session.send_message("Our recruiters spend…")`

`agent.py` calls Gemini:
- Sends: System Prompt + your message
- Gemini has no previous history yet, so it decides to gather more information

---

### Step 4: AI Responds with Follow-up Questions

Gemini replies:
> *"That sounds like a significant time drain for your recruitment team. A couple of quick questions — at which stage does this occur (for example, after technical rounds or after HR screening)? And roughly how many interviews does your team schedule per week?"*

`agent.py` checks: No `<REPORT_JSON>` found → it's just a conversational reply.

The response is sent back to `app.js`, which displays it as an AI message bubble.

---

### Step 5: You Answer the Questions

You type: *"It happens after candidates pass the technical round. We schedule around 30 interviews a week. We use Gmail, no special tool."*

The same process repeats. Gemini now has more information.

---

### Step 6: AI Asks for Root Cause and Solution

Gemini might ask:
> *"Thanks — that's very helpful. Do you have a sense of why there's no scheduling tool in place yet? And do you have any ideas for how this could be improved?"*

---

### Step 7: You Provide More Details

You reply: *"It was just never prioritized. I think we should use something like Calendly or integrate with Google Calendar."*

---

### Step 8: AI Presents the Summary

Gemini now has enough information. It presents a readable summary:

> **📋 Report Summary**
>
> - **Process:** Recruitment
> - **Stage:** Interview Scheduling (Post-Technical Round)
> - **Problem:** Recruiters manually send scheduling emails, consuming 4–6 hours/week for 30 interviews
> - **Root Cause (you stated):** No scheduling tool was ever implemented
> - **Root Cause (AI inferred):** Absence of ATS-calendar integration and lack of self-service booking
> - **Your suggestion:** Use Calendly or Google Calendar integration
> - **My recommendation:** Integrate ATS with a self-service scheduling portal (Calendly/Chili Piper) with automated confirmation and reminder emails; eliminates all manual steps
> - **Impact:** ~5 hours/week saved, same-day scheduling vs. 3–5 days, improved candidate experience
> - **Stakeholders:** Recruiters, Candidates, Hiring Managers
> - **Frequency:** Every hire (daily)
> - **Severity:** High
> - **Priority:** High — daily occurrence affecting every hire and candidate experience
>
> *Does this accurately capture the issue, or would you like to make any changes before I finalize the report?*

---

### Step 9: You Confirm

You type: *"Yes, that looks correct."*

---

### Step 10: AI Generates the Report

Gemini generates a response containing:

```
[Closing message to you]

<REPORT_JSON>
{
  "report_id": "RPT-20260622-001",
  "timestamp": "2026-06-22T15:30:00Z",
  "process_name": "Recruitment",
  "process_stage": "Interview Scheduling",
  "problem_description": "Recruiters manually email candidates...",
  ...
}
</REPORT_JSON>
```

---

### Step 11: Report is Extracted and Saved

`agent.py` detects the `<REPORT_JSON>` block:
- Parses the JSON
- Assigns a report ID if needed
- Returns it to `main.py`, which returns it to `app.js`

`app.js` receives the response:
- Displays the closing message in the chat
- Shows a green "✅ Report finalized" banner
- Automatically calls `POST /api/reports/save`
- The report appears in the left sidebar
- A badge appears on the "Report View" tab

---

### Step 12: You View the Report

You click the report in the sidebar or click "View Report →":
- Switches to the **Report View** tab
- Shows all report fields in a formatted, beautiful layout
- Includes a confidence bar, stakeholder chips, and collapsible JSON viewer

---

## 9. The Report System

### Report ID Format

Every report gets a unique ID:
```
RPT-YYYYMMDD-NNN
     │         │
     │         └─ Sequential number (001, 002, 003…)
     └─ Date (e.g. 20260622 = June 22, 2026)

Example: RPT-20260622-001
```

The counter is stored in `data/report_counter.txt` and increments with each new report.

### The 12 Report Fields

| Field | Example | What It Means |
|-------|---------|---------------|
| `report_id` | `RPT-20260622-001` | Unique identifier |
| `timestamp` | `2026-06-22T15:30:00Z` | When report was created (UTC) |
| `process_name` | `Recruitment` | Which business process |
| `process_stage` | `Interview Scheduling` | Which step within the process |
| `problem_description` | `"Recruiters manually email..."` | Exactly what goes wrong |
| `root_cause.user_provided` | `"No tool available"` | What the user said causes it |
| `root_cause.ai_inferred` | `"Lack of ATS integration"` | What the AI thinks causes it |
| `suggested_solution.user` | `"Use Calendly"` | The user's own idea |
| `suggested_solution.ai` | `"Integrate self-service portal"` | The AI's recommendation |
| `expected_impact` | `"5 hours/week saved"` | What improves if fixed |
| `affected_stakeholders` | `["Recruiters", "Candidates"]` | Who is impacted |
| `frequency` | `"Daily"` | How often the problem occurs |
| `severity` | `"High"` | How bad the problem is |
| `priority` | `"High"` | How urgently it should be fixed |
| `confidence` | `0.92` | AI's confidence in the data (0–1) |
| `needs_follow_up` | `false` | Does the report need more info? |

### Confidence Score

The AI rates its own confidence from 0.0 to 1.0:
- `0.9–1.0` → All fields collected, clear information, no ambiguity
- `0.7–0.9` → Most fields collected, minor gaps filled by inference
- `0.5–0.7` → Several fields are AI-inferred, more info would help
- `< 0.5` → Significant gaps; `needs_follow_up` will be `true`

---

## 10. The User Interface

### Layout Overview

```
┌─────────────────────────────────────────────────────────────┐
│  🤖 Process Improvement Agent         ● Connected           │  ← Header
├────────────────┬────────────────────────────────────────────┤
│ 📋 Reports (3) │  💬 Chat  │  📄 Report View                │  ← Tabs
│                ├────────────────────────────────────────────┤
│ RPT-001        │                                            │
│ Recruitment    │     [Welcome screen or chat messages]      │  ← Main area
│ High           │                                            │
│────────────────│                                            │
│ RPT-002        │                                            │
│ Payroll        ├────────────────────────────────────────────┤
│ Medium         │  [ Type your message here... ]     [Send]  │  ← Input
└────────────────┴────────────────────────────────────────────┘
```

### The Sidebar (Left Panel)

- Shows all saved reports as cards
- Each card shows: Report ID, Process Name, Problem snippet, Priority badge, Date
- Click any card → opens it in the Report View tab
- Hover → shows a 🗑 delete button
- **"✦ New Conversation"** button → starts fresh without losing saved reports

### The Chat View (Center/Right — Default)

- **Welcome screen**: Shown to new users with 6 example prompts you can click
- **Message bubbles**: Blue (you) on right, dark card (AI) on left
- **Typing indicator**: Three bouncing dots while AI processes
- **Report banner**: Green banner appears when a report is finalized
- **Markdown rendering**: AI responses support **bold**, *italic*, bullet lists, headers

### The Report View Tab

When you click a report card or the "View Report →" button:
- Switches to the Report View tab
- Shows all fields in organized sections:
  - Problem Description (full width)
  - Root Cause vs. Suggested Solution (side by side)
  - Expected Impact (full width)
  - Stakeholders (shown as colored chips)
  - Frequency
  - Confidence (visual bar from 0% to 100%)
  - Needs Follow-up (green ✓ or amber ⚠)
  - Collapsible JSON viewer with Copy button

---

## 11. The API Endpoints

An **API endpoint** is a URL that the browser calls to get data or perform an action. Here's every endpoint this app uses:

### `POST /api/session/new`
**Purpose:** Start a new conversation

**Request:** Nothing (no body needed)

**Response:**
```json
{ "session_id": "abc-123-xyz-456" }
```

**When called:** Every time you click "New Conversation" or open the app

---

### `POST /api/chat`
**Purpose:** Send a message and get the AI's reply

**Request body:**
```json
{
  "session_id": "abc-123-xyz-456",
  "message": "Our interview scheduling takes too long"
}
```

**Response:**
```json
{
  "text": "I understand. Which stage does this happen at?",
  "report": null,
  "has_report": false
}
```
If a report was generated, `report` contains the full JSON object and `has_report` is `true`.

---

### `GET /api/reports`
**Purpose:** Get all saved reports

**Response:** An array of all report objects, newest first

---

### `GET /api/reports/{id}`
**Purpose:** Get one specific report

**Example:** `/api/reports/RPT-20260622-001`

**Response:** The single report object

---

### `POST /api/reports/save`
**Purpose:** Save a new report to disk

**Request body:**
```json
{ "report": { "report_id": "RPT-...", ... } }
```

**Response:**
```json
{ "saved": true, "report_id": "RPT-20260622-001" }
```

---

### `DELETE /api/reports/{id}`
**Purpose:** Delete a report permanently

**Response:**
```json
{ "deleted": true, "report_id": "RPT-20260622-001" }
```

---

### `GET /api/health`
**Purpose:** Check if the server is running

**Response:**
```json
{ "status": "ok", "timestamp": "2026-06-22T15:00:00Z" }
```

---

### `GET /docs`
**Purpose:** Interactive API documentation (auto-generated by FastAPI)

Open `http://localhost:8000/docs` to see every endpoint with the ability to test them directly in the browser.

---

## 12. Setup & Installation Guide

### Prerequisites

Before you start, you need:
1. **Python 3.11 or newer** — [Download here](https://www.python.org/downloads/)
2. **A Google Gemini API key** — Free at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
3. **An internet connection** — the AI model runs in Google's cloud

### Check if Python is installed

Open PowerShell (press `Win + R`, type `powershell`, press Enter) and run:
```powershell
python --version
```
You should see something like `Python 3.11.9`. If you get an error, install Python first.

---

### Step 1: Navigate to the Project Folder

```powershell
cd "C:\Drive D\Yolex Labs\Problem Tracking Agent"
```

### Step 2: Create the `.env` File

The `.env` file holds your secret API key. It's intentionally not included in the project (so you don't accidentally share your key).

```powershell
copy .env.example .env
```

Now open the `.env` file in Notepad and replace `your_gemini_api_key_here` with your real key:
```
GEMINI_API_KEY=AIzaSyABC123...your_real_key_here
```

### Step 3: Install Python Libraries

```powershell
pip install -r requirements.txt
```

This installs FastAPI, the Gemini SDK, Uvicorn, and all other required packages. It may take 1–3 minutes on the first run.

### Step 4: Start the Server

**Option A — Double-click:**
Double-click `start.bat` in the project folder.

**Option B — PowerShell:**
```powershell
python main.py
```

You should see:
```
============================================================
  🤖  Process Improvement Agent
  🌐  http://localhost:8000
  📄  API docs: http://localhost:8000/docs
============================================================
```

### Step 5: Open the App

Open your web browser (Chrome, Firefox, Edge) and go to:
```
http://localhost:8000
```

The app will load and greet you!

### Step 6: Stop the Server

Go back to the PowerShell window and press `Ctrl + C`.

---

## 13. How to Use the App

### Starting a Conversation

1. The welcome screen shows 6 example prompts. Click one to pre-fill the input, or type your own.
2. Describe any process problem you've experienced at work. Be as vague or detailed as you like.
3. The AI will ask follow-up questions if it needs more information.

### Tips for Better Results

- **Be specific:** Instead of "our process is bad," say "our expense report approval takes 2 weeks"
- **Answer the AI's questions:** The more context you give, the better the report
- **Confirm before finalizing:** When the AI shows a summary, review it carefully before saying yes
- **Start new conversations for different problems:** Use the "✦ New Conversation" button

### Viewing Reports

- All saved reports appear in the **left sidebar**
- Click any report card to view it in the **Report View tab**
- Use the **Copy JSON** button to copy the raw data for use in other systems
- Use the 🗑 button on a card to delete a report permanently

### Resetting All Reports

To clear all saved reports:
1. Stop the server
2. Open `data/reports.json` in Notepad
3. Replace the contents with just: `[]`
4. Save and restart the server

---

## 14. Troubleshooting

### ❌ "GEMINI_API_KEY is not set"

**Cause:** The `.env` file is missing or the key is wrong.

**Fix:**
1. Make sure `data\.env` exists (not `.env.example`)
2. Open `.env` and check the key starts with `AIza...`
3. Make sure there are no spaces around the `=` sign: `GEMINI_API_KEY=AIza...`

---

### ❌ "ModuleNotFoundError: No module named 'fastapi'"

**Cause:** Python libraries weren't installed.

**Fix:** Run this in the project folder:
```powershell
pip install -r requirements.txt
```

---

### ❌ Page shows "Frontend not found"

**Cause:** The `static/` folder or `index.html` is missing.

**Fix:** Make sure these files exist:
- `static/index.html`
- `static/style.css`
- `static/app.js`

---

### ❌ "Port 8000 is already in use"

**Cause:** Another program is using port 8000.

**Fix:** Change the port in `main.py`:
```python
uvicorn.run("main:app", host="0.0.0.0", port=8001)  # Changed to 8001
```
Then open `http://localhost:8001`.

---

### ❌ AI gives very short or unhelpful responses

**Cause:** API quota may be exceeded, or the key is invalid.

**Fix:**
1. Go to [https://aistudio.google.com](https://aistudio.google.com)
2. Check your API key is active
3. Check if you've hit the free tier limit (reset daily)

---

### ❌ Report doesn't appear in sidebar after conversation

**Cause:** The AI may not have generated the final JSON (user confirmation step may have been skipped).

**Fix:** When the AI presents a summary, explicitly confirm with phrases like:
- *"Yes, that's correct"*
- *"Looks good, finalize it"*
- *"That's accurate, go ahead"*

---

## 15. Glossary

| Term | Plain English Definition |
|------|-------------------------|
| **API** | A way for programs to talk to each other over the internet |
| **Endpoint** | A specific URL that does a specific action (e.g., `/api/chat`) |
| **FastAPI** | A Python tool for building web servers and APIs |
| **Gemini** | Google's AI model (like ChatGPT, but made by Google) |
| **Session** | A single conversation identified by a unique ID |
| **System Prompt** | Hidden instructions sent to the AI before every conversation |
| **JSON** | A text format for storing structured data (like a form in text form) |
| **Markdown** | A simple way to format text using symbols (e.g., `**bold**`, `# Header`) |
| **Port** | A numbered "door" on your computer that programs listen on (we use 8000) |
| **localhost** | Your own computer (same as `127.0.0.1`) |
| **Frontend** | What you see in the browser (HTML, CSS, JavaScript) |
| **Backend** | The server-side code that processes data (Python, FastAPI) |
| **Glassmorphism** | A design style that looks like frosted glass |
| **REST API** | A standard way to build web APIs using HTTP methods (GET, POST, DELETE) |
| **Environment Variable** | A secret value stored outside the code (like your API key in `.env`) |
| **Uvicorn** | The program that runs the FastAPI server |
| **Root Cause** | The underlying reason why a problem exists |
| **Stakeholder** | Anyone who is affected by the problem |
| **Severity** | How bad a problem is (Critical / High / Medium / Low) |
| **Priority** | How urgently a problem should be fixed |
| **Confidence Score** | The AI's self-rated certainty about the data it extracted (0.0 to 1.0) |

---

## 📞 Support

If you encounter issues not covered in this README:

1. Check the **server terminal** for error messages (the PowerShell window where you ran `python main.py`)
2. Open `http://localhost:8000/docs` to test individual API endpoints
3. Check `data/reports.json` to see if reports are being saved correctly

---

*Process Improvement Agent v1.0 — Yolex Labs*
*Built with Python 3.11 + FastAPI + Google Gemini 2.0 Flash*
