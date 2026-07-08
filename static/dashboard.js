/* dashboard.js — Employee personal dashboard */
'use strict';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const API = async (path, method = 'GET', body = null) => {
  const token = getToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || `HTTP ${r.status}`);
  }
  return r.json();
};

function getToken() {
  // 1. Check URL param first (just returned from Google OAuth)
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem('db_token', urlToken);
    // Clean URL without reload
    window.history.replaceState({}, document.title, '/dashboard');
    return urlToken;
  }
  return localStorage.getItem('db_token');
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Render session card
// ---------------------------------------------------------------------------

function renderSessionCard(a, idx) {
  const isCompleted = a.status === 'completed';
  const isOverdue   = !isCompleted && a.is_expired;
  const isActive    = !isCompleted && !isOverdue;

  const iconType = isCompleted ? 'completed' : isOverdue ? 'overdue' : 'pending';
  const statusLabel = isCompleted ? 'Completed' : isOverdue ? 'Overdue' : (a.status === 'in_progress' ? 'In Progress' : 'Pending');
  const statusClass = isCompleted ? 'completed' : isOverdue ? 'overdue' : (a.status === 'in_progress' ? 'in_progress' : 'pending');

  const iconSvg = isCompleted
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
    : isOverdue
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

  const calBadge = a.calendar_event_id
    ? `<div class="btn-cal-badge cal-synced">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        Calendar synced
       </div>`
    : `<div class="btn-cal-badge cal-unsynced">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        No calendar event
       </div>`;

  let actionBtn = '';
  if (!isCompleted) {
    if (isOverdue) {
      actionBtn = `<button class="btn-start-session expired" disabled>
        ⏰ Deadline passed — contact your manager
      </button>`;
    } else {
      actionBtn = `<a href="/app?token=${getToken()}" class="btn-start-session">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>
        </svg>
        Start Session
      </a>`;
    }
  }

  const notesHtml = a.notes
    ? `<div class="session-notes">💬 ${esc(a.notes)}</div>`
    : '';

  const completedDate = isCompleted && a.report_id
    ? `<div class="session-date">Completed · Report #${esc(a.report_id)}</div>`
    : `<div class="session-date">Due: ${fmtDate(a.due_date)}</div>`;

  return `
    <div class="session-card" style="animation-delay:${idx * 0.08}s">
      <div class="session-card-top">
        <div class="session-icon ${iconType}">${iconSvg}</div>
        <div class="session-meta">
          <div class="session-title-row">
            <div class="session-title">Process Improvement Session</div>
            <span class="status-badge ${statusClass}">${statusLabel}</span>
          </div>
          ${completedDate}
          ${a.created_by ? `<div class="session-date" style="font-size:11px;margin-top:2px">Assigned by: ${esc(a.created_by)}</div>` : ''}
        </div>
      </div>
      ${notesHtml}
      <div class="session-actions">
        ${actionBtn}
        ${calBadge}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Empty state helpers
// ---------------------------------------------------------------------------

function emptyCard(msg) {
  return `<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-3);background:var(--bg-card);border:1px dashed var(--border);border-radius:12px;">${msg}</div>`;
}

// ---------------------------------------------------------------------------
// Main init
// ---------------------------------------------------------------------------

async function init() {
  const token = getToken();
  if (!token) {
    window.location.href = '/';
    return;
  }

  try {
    const data = await API('/api/employee/dashboard');
    renderDashboard(data);
  } catch (e) {
    if (e.message && (e.message.includes('401') || e.message.includes('Authentication'))) {
      localStorage.removeItem('db_token');
      window.location.href = '/';
      return;
    }
    toast('Could not load dashboard: ' + e.message, 'error');
  }

  // Hide loading overlay
  document.getElementById('loading-overlay').style.display = 'none';
}

function renderDashboard(data) {
  const { profile, upcoming, completed } = data;
  const name     = profile?.name || 'there';
  const picture  = profile?.picture || '';
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // User info
  document.getElementById('db-user-name').textContent = name;
  document.getElementById('db-avatar-fb').textContent = initials;
  document.getElementById('db-avatar-fb').style.display = 'flex';

  const avatarEl = document.getElementById('db-avatar');
  if (picture) {
    avatarEl.src = picture;
    avatarEl.style.display = 'block';
    document.getElementById('db-avatar-fb').style.display = 'none';
  }

  // Greeting
  const greetTitle = document.getElementById('db-greeting-title');
  greetTitle.textContent = `${greeting()}, ${name.split(' ')[0]} 👋`;

  // Stats
  const overdue = upcoming.filter(a => a.is_expired).length;
  document.getElementById('stat-upcoming').textContent  = upcoming.length;
  document.getElementById('stat-completed').textContent = completed.length;
  document.getElementById('stat-overdue').textContent   = overdue;

  const totalSessions = upcoming.length + completed.length;
  if (totalSessions === 0) {
    document.getElementById('db-main').style.display   = 'none';
    document.getElementById('db-empty').style.display  = 'flex';
    document.getElementById('loading-overlay').style.display = 'none';
    return;
  }

  // Render upcoming
  const upcomingList = document.getElementById('upcoming-list');
  if (upcoming.length > 0) {
    upcomingList.innerHTML = upcoming.map((a, i) => renderSessionCard(a, i)).join('');
  } else {
    upcomingList.innerHTML = emptyCard('🎉 No pending sessions — you\'re all caught up!');
  }

  // Render completed
  const completedList = document.getElementById('completed-list');
  if (completed.length > 0) {
    completedList.innerHTML = completed.map((a, i) => renderSessionCard(a, i)).join('');
  } else {
    completedList.innerHTML = emptyCard('No completed sessions yet.');
  }

  document.getElementById('db-main').style.display  = 'block';
  document.getElementById('loading-overlay').style.display = 'none';
}

function signOut() {
  localStorage.removeItem('db_token');
  window.location.href = '/';
}

// Kick off
document.addEventListener('DOMContentLoaded', init);
