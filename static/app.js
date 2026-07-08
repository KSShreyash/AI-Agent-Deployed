/* ============================================================
   app.js — Process Improvement Agent v4
   Auth · Login · Consent · Interview (voice+chat) · Manager
   ============================================================ */

/* ── marked ─────────────────────────────────────────────────── */
if (typeof marked !== 'undefined') marked.setOptions({ breaks: true, gfm: true });

/* ── Auth module ─────────────────────────────────────────────── */
const AUTH = {
  token: localStorage.getItem('pa_token'),
  user:  null,

  setToken(token) {
    this.token = token;
    localStorage.setItem('pa_token', token);
  },

  clear() {
    this.token = null;
    this.user  = null;
    localStorage.removeItem('pa_token');
  },
};

/* ── App state ───────────────────────────────────────────────── */
const app = {
  sessionId:     null,
  loading:       false,
  speakerMuted:  false,
  timerInterval: null,
  timerSecs:     0,
};

/* ── Visualizer state ────────────────────────────────────────── */
const viz = {
  open:     false,
  step:     0,         // 0-6
  data:     {},        // accumulated report data
  ready:    false,     // iframe has signalled VIZ_READY
  turnCount: 0,        // conversation turns since session start
};

/* Mapping of turnCount to step (rough heuristic for 5-part interview) */
function turnToStep(t) {
  if (t <= 0) return 0;
  if (t === 1) return 1;
  if (t <= 3) return 2;
  if (t <= 5) return 3;
  if (t <= 7) return 4;
  return 5;
}

/* ── Voice state ─────────────────────────────────────────────── */
const voice = {
  recording: false, mediaRecorder: null, audioChunks: [],
  stream: null, recognition: null, finalTranscript: '', interimTranscript: '',
  audioCtx: null, analyser: null, animFrame: null, currentAudio: null, countdownTimer: null,
};

/* ── DOM helpers ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = {
  loading:         $('loading'),
  ivMessages:      $('iv-messages'),
  ivChatInput:     $('iv-chat-input'),
  ivBtnSend:       $('iv-btn-send'),
  ivBtnMic:        $('iv-btn-mic'),
  ivCountdown:     $('iv-countdown'),
  ivVoiceBar:      $('iv-voice-bar'),
  ivVoiceTxt:      $('iv-voice-txt'),
  ivLiveT:         $('iv-live-transcript'),
  ivLtLabel:       $('iv-lt-label'),
  ivLtText:        $('iv-lt-text'),
  ivWaveWrap:      $('iv-waveform-wrap'),
  ivWaveCanvas:    $('iv-waveform'),
  aiOrb:           $('ai-orb'),
  agentStatusTxt:  $('iv-agent-status-text'),
  ivTimer:         $('iv-timer'),
  ivTopicText:     $('iv-topic-text'),
  ivCandLabel:     $('iv-candidate-label'),
  toasts:          $('toasts'),
};

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


/* ============================================================
   VIEW NAVIGATION
   ============================================================ */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(`view-${name}`);
  if (v) v.classList.add('active');
}


/* ============================================================
   AUTH FLOW
   ============================================================ */
async function init() {
  setTimeout(initParticles, 400);
  setTimeout(() => el.loading?.classList.add('hidden'), 600);

  if (AUTH.token) {
    try {
      const me = await api('/api/auth/me');
      AUTH.user = me;
      routeByRole(me.role);
      return;
    } catch {
      AUTH.clear();
    }
  }
  showView('login');
  setTimeout(() => $('login-email')?.focus(), 200);
}

function routeByRole(role) {
  if (role === 'manager') {
    showView('manager');
    const pill = $('mgr-user-pill');
    if (pill) pill.textContent = `${AUTH.user?.name || 'Manager'}  ·  Manager`;
    loadManagerDashboard();
  } else {
    // candidate → consent
    showView('consent');
    setTimeout(() => $('consent-input')?.focus(), 150);
  }
}


/* ── Login ── */
async function doLogin() {
  const email    = $('login-email')?.value.trim();
  const password = $('login-password')?.value;
  const errEl    = $('login-error');
  if (!email || !password) { showLoginErr('Please enter your email and password.'); return; }

  const btn = $('btn-login');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  try {
    const res = await api('/api/auth/login', 'POST', { email, password }, true /* noAuth */);
    AUTH.setToken(res.access_token);
    AUTH.user = res.user;
    if (errEl) errEl.style.display = 'none';
    routeByRole(res.user.role);
  } catch (e) {
    showLoginErr(e.message || 'Invalid email or password.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}

function showLoginErr(msg) {
  const errEl = $('login-error');
  if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
}

/* ── Register ── */
async function doRegister() {
  const name     = $('reg-name')?.value.trim();
  const email    = $('reg-email')?.value.trim();
  const password = $('reg-password')?.value;
  const dept     = $('reg-dept')?.value.trim();
  const jobrole  = $('reg-jobrole')?.value.trim();
  const errEl    = $('reg-error');

  if (!name || !email || !password) { showRegErr('Name, email and password are required.'); return; }
  if (password.length < 8)          { showRegErr('Password must be at least 8 characters.'); return; }

  try {
    const res = await api('/api/auth/register', 'POST',
      { name, email, password, department: dept, job_role: jobrole }, true);
    // Auto-login
    const login = await api('/api/auth/login', 'POST', { email, password }, true);
    AUTH.setToken(login.access_token);
    AUTH.user = login.user;
    showView('manager');
    const pill = $('mgr-user-pill');
    if (pill) pill.textContent = `${login.user.name}  ·  Manager`;
    loadManagerDashboard();
    toast('Manager account created — welcome!', 'success');
  } catch (e) {
    showRegErr(e.message || 'Registration failed.');
  }
}

function showRegErr(msg) {
  const e = $('reg-error');
  if (e) { e.textContent = msg; e.style.display = 'block'; }
}

/* ── Logout ── */
function authLogout() {
  AUTH.clear();
  app.sessionId = null;
  stopTimer();
  if (voice.recording) stopRecording();
  voice.currentAudio?.pause(); voice.currentAudio = null;
  if (el.ivMessages) el.ivMessages.innerHTML = '';
  const ci = $('consent-input'); if (ci) { ci.value = ''; }
  const cb = $('consent-btn');   if (cb) cb.disabled = true;
  showView('login');
  setTimeout(() => $('login-email')?.focus(), 200);
}

/* ── Utilities ── */
function togglePwVisibility(inputId, btn) {
  const inp = $(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

/* Handle Enter key on login form */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('view-login')?.classList.contains('active')) {
    doLogin();
  }
});


/* ============================================================
   CONSENT
   ============================================================ */
function checkConsent(input) {
  const ok = input.value.trim().toLowerCase() === 'i consent';
  input.classList.toggle('valid', ok);
  $('consent-btn').disabled = !ok;
}

/* ============================================================
   VISUALIZER
   ============================================================ */

function toggleVisualizer() {
  viz.open = !viz.open;
  const overlay = document.getElementById('viz-overlay');
  if (overlay) overlay.classList.toggle('open', viz.open);
  const btn = document.getElementById('iv-viz-btn');
  if (btn) btn.classList.toggle('active', viz.open);

  if (viz.open) {
    const frame = document.getElementById('viz-frame');
    if (frame && !frame.src) {
      // Lazy-load tldraw on first open
      frame.src = '/static/visualize.html';
    } else if (viz.ready) {
      // Already loaded — push current state
      sendVizUpdate();
    }
  }
}

function sendVizUpdate() {
  const frame = document.getElementById('viz-frame');
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({
    type: 'UPDATE_VIZ',
    step: viz.step,
    data: viz.data,
  }, '*');
}

function vizFitView() {
  // Tell the tldraw page to zoom-to-fit
  const frame = document.getElementById('viz-frame');
  if (frame?.contentWindow) {
    frame.contentWindow.postMessage({ type: 'VIZ_FIT' }, '*');
  }
}

// Listen for VIZ_READY from the iframe (tldraw mounted)
window.addEventListener('message', (evt) => {
  if (evt.data?.type === 'VIZ_READY') {
    viz.ready = true;
    sendVizUpdate();
  }
});

async function beginSession() {
  // Reset visualizer for new session
  viz.step      = 0;
  viz.data      = {};
  viz.turnCount = 0;
  sendVizUpdate();

  await startSession();
  showView('interview');

  const name = AUTH.user?.name || 'Candidate';
  if (el.ivCandLabel) el.ivCandLabel.textContent = `· ${name}`;


  startTimer();
  setupIvInput();

  // Check for assigned topic
  let topicHint = '';
  try {
    const mine = await api('/api/assignments/mine');
    if (mine.length > 0) {
      topicHint = mine[0].process_area;
      if (el.ivTopicText) el.ivTopicText.textContent = topicHint;
    }
  } catch { /* no assignment, that's fine */ }

  await sendMessage(
    `Hello ${name}! I'm your Process Improvement Consultant. ` +
    (topicHint
      ? `Today we'll be discussing: "${topicHint}". Please describe what you've observed about this process.`
      : `Please describe any workflow issue or operational problem you've encountered recently. I'll guide you through a structured assessment.`),
    false, true
  );
}


/* ============================================================
   SESSION
   ============================================================ */
async function startSession() {
  try {
    const res = await api('/api/session/new', 'POST');
    app.sessionId = res.session_id;
  } catch { toast('Cannot start session', 'error'); }
}

function endSession() {
  if (!confirm('End this session?')) return;
  stopTimer();
  voice.currentAudio?.pause(); voice.currentAudio = null;
  if (voice.recording) stopRecording();
  if (el.ivMessages) el.ivMessages.innerHTML = '';
  const ci = $('consent-input'); if (ci) ci.value = '';
  const cb = $('consent-btn');   if (cb) cb.disabled = true;

  // Employees (candidates) always go back to their dashboard
  if (AUTH.user?.role === 'candidate' || AUTH.user?.role !== 'manager') {
    window.location.href = '/dashboard';
  } else {
    routeByRole(AUTH.user?.role || 'candidate');
  }
}

function startTimer() {
  app.timerSecs = 0;
  app.timerInterval = setInterval(() => {
    app.timerSecs++;
    const m = String(Math.floor(app.timerSecs / 60)).padStart(2,'0');
    const s = String(app.timerSecs % 60).padStart(2,'0');
    if (el.ivTimer) el.ivTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() { clearInterval(app.timerInterval); app.timerInterval = null; }

/* Show "Return to Dashboard" after session completion (employees only) */
function _showReturnToDashboard() {
  // Inject a return banner at the bottom of the chat
  const wrap = document.createElement('div');
  wrap.id = 'return-dashboard-banner';
  wrap.style.cssText = `
    display:flex; flex-direction:column; align-items:center; gap:12px;
    padding:24px 16px; margin-top:12px;
    background:rgba(118,185,0,.07); border:1px solid rgba(118,185,0,.25);
    border-radius:14px; text-align:center;
  `;
  let secs = 8;
  wrap.innerHTML = `
    <div style="font-size:13px;color:var(--text-muted);">
      Your session is complete. You will be returned to your dashboard in
      <strong id="return-countdown" style="color:var(--green)">${secs}s</strong>.
    </div>
    <button onclick="window.location.href='/dashboard'"
      style="padding:10px 28px;background:var(--green);color:#000;font-weight:700;
             font-size:13px;border:none;border-radius:8px;cursor:pointer;letter-spacing:.3px;">
      Return to Dashboard
    </button>
  `;
  el.ivMessages?.appendChild(wrap);
  el.ivMessages?.scrollTo({ top: el.ivMessages.scrollHeight, behavior: 'smooth' });

  const ticker = setInterval(() => {
    secs--;
    const cd = document.getElementById('return-countdown');
    if (cd) cd.textContent = `${secs}s`;
    if (secs <= 0) {
      clearInterval(ticker);
      window.location.href = '/dashboard';
    }
  }, 1000);
}




/* ============================================================
   INTERVIEW CHAT
   ============================================================ */
async function sendMessage(text, isVoice = false, isAgentInitiated = false) {
  if (isAgentInitiated) {
    addIvMessage('assistant', text);
    if (!app.speakerMuted) speakText(text);
    return;
  }
  if (!text.trim() || app.loading) return;
  if (!app.sessionId) await startSession();

  addIvMessage('user', text, isVoice);
  setLoading(true);
  const typEl = addIvTyping();

  try {
    const res = await api('/api/chat', 'POST', {
      session_id: app.sessionId, message: text,
      candidate_name: AUTH.user?.name || '',
    });
    typEl.remove(); setLoading(false);
    const msgEl = addIvMessage('assistant', res.text);
    if (res.has_report && res.report) {
      const report = res.report;
      // Enforce client-side anonymity for work reports:
      // growth_wellbeing and openline are always anonymous (enforced server-side too)
      if (report.is_anonymous || report.report_type === 'growth_wellbeing' || report.report_type === 'openline') {
        report.candidate_name = '';
        report.is_anonymous   = true;
      }
      saveReport(report);
      appendReportBanner(msgEl, report);
      // ── Visualizer: complete ──────────────────────────────────
      viz.step = 6;
      viz.data = report;
      sendVizUpdate();

      // ── For employees: show return button + auto-redirect ─────
      if (AUTH.user?.role !== 'manager') {
        stopTimer();
        _showReturnToDashboard();
      }
    } else {
      // ── Visualizer: incremental step ─────────────────────────
      viz.turnCount++;
      viz.step = turnToStep(viz.turnCount);
      sendVizUpdate();
    }
    if (!app.speakerMuted) speakText(res.text, msgEl);
  } catch {
    typEl.remove(); setLoading(false);
    addIvMessage('assistant', 'Connection error. Please check the server is running.');
  }
}

function addIvMessage(role, text, isVoice = false) {
  const wrap = document.createElement('div');
  wrap.className = `iv-msg ${role}`;
  if (role === 'user') {
    const v = isVoice ? `<span style="font-size:9px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.4px;margin-right:6px">VOICE</span>` : '';
    wrap.innerHTML = `<div class="iv-msg-avatar user-av">U</div><div class="iv-msg-bubble">${v}${esc(text).replace(/\n/g,'<br>')}</div>`;
  } else {
    const html = typeof marked !== 'undefined' ? marked.parse(text) : esc(text);
    wrap.innerHTML = `<div class="iv-msg-avatar">AI</div><div class="iv-msg-content"><div class="iv-msg-sender">Process Agent</div><div class="iv-msg-bubble">${html}</div></div>`;
  }
  el.ivMessages?.appendChild(wrap);
  el.ivMessages?.scrollTo({ top: el.ivMessages.scrollHeight, behavior: 'smooth' });
  return wrap;
}

function appendReportBanner(msgEl, r) {
  const typeLabels = {
    work:              'Work',
    growth_wellbeing:  'Growth & Wellbeing',
    openline:          'Open Line',
  };
  const typeLabel = typeLabels[r.report_type] || 'Report';
  const typeColor = r.report_type === 'work' ? 'var(--green)'
                  : r.report_type === 'openline' ? 'var(--blue)'
                  : '#a78bfa';
  const anonTag  = (r.is_anonymous || !r.candidate_name)
    ? `<span style="font-size:9px;font-weight:700;background:rgba(167,139,250,.15);color:#a78bfa;border-radius:4px;padding:1px 6px;margin-left:6px;">ANONYMOUS</span>`
    : '';
  const detail = r.report_type === 'work'
    ? `${esc(r.process_name || '')}${r.severity ? ' · ' + esc(r.severity) + ' severity' : ''}`
    : r.report_type === 'openline'
    ? esc(r.escalation_topic || 'Escalation raised')
    : (r.upskilling_areas?.length ? esc(r.upskilling_areas.join(', ')) : 'Wellbeing note recorded');
  const b = document.createElement('div');
  b.className = 'iv-report-banner';
  b.innerHTML = `<span style="color:${typeColor}">&#10003;</span><div>
    <strong style="color:${typeColor}">${typeLabel}</strong>${anonTag} &nbsp;<span style="color:var(--text-muted);font-size:10px;font-weight:500">${esc(r.report_id||'N/A')}</span><br>
    <small style="color:var(--text-muted)">${detail}</small>
  </div>`;
  msgEl.querySelector('.iv-msg-content')?.appendChild(b);
}

function addIvTyping() {
  const wrap = document.createElement('div'); wrap.className = 'iv-typing';
  wrap.innerHTML = `<div class="iv-msg-avatar">AI</div><div class="iv-typing-bubble"><div class="iv-typing-dot"></div><div class="iv-typing-dot"></div><div class="iv-typing-dot"></div></div>`;
  el.ivMessages?.appendChild(wrap);
  el.ivMessages?.scrollTo({ top: el.ivMessages.scrollHeight, behavior: 'smooth' });
  return wrap;
}

function setLoading(v) {
  app.loading = v;
  if (el.ivBtnSend)   el.ivBtnSend.disabled   = v;
  if (el.ivChatInput) el.ivChatInput.disabled  = v;
}

function setupIvInput() {
  const ta = el.ivChatInput;
  if (!ta) return;
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitIvText(); }
  });
  ta.addEventListener('input', () => autoResize(ta));
}

function submitIvText() {
  const text = el.ivChatInput?.value.trim();
  if (!text) return;
  el.ivChatInput.value = '';
  autoResize(el.ivChatInput);
  sendMessage(text);
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}


/* ============================================================
   VOICE ENGINE
   ============================================================ */
const hasSR  = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

async function toggleVoice() {
  if (voice.currentAudio) { stopSpeaking(); return; }
  voice.recording ? await stopRecording() : await startRecording();
}

function toggleSpeaker() {
  app.speakerMuted = !app.speakerMuted;
  const btn = $('ctrl-speaker'); const lbl = $('ctrl-speaker-label');
  if (btn) btn.classList.toggle('muted', app.speakerMuted);
  if (lbl) lbl.textContent = app.speakerMuted ? 'Muted' : 'Speaker';
  if (app.speakerMuted && voice.currentAudio) stopSpeaking();
}

async function startRecording() {
  try { voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast('Microphone access denied', 'error'); return; }
  voice.audioChunks = []; voice.finalTranscript = ''; voice.interimTranscript = '';
  voice.recording = true;
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  voice.mediaRecorder = new MediaRecorder(voice.stream, { mimeType: mime });
  voice.mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) voice.audioChunks.push(e.data); };
  voice.mediaRecorder.onstop = handleRecordingStop;
  voice.mediaRecorder.start(100);
  if (hasSR) startSpeechRecognition();
  startWaveform();
  setVoiceUI('recording');
  showLiveT('', true);
}

async function stopRecording() {
  if (!voice.recording) return;
  voice.recording = false; clearCountdown(); voice.recognition?.stop(); voice.recognition = null;
  stopWaveform();
  if (voice.mediaRecorder?.state !== 'inactive') voice.mediaRecorder.stop();
  voice.stream?.getTracks().forEach(t => t.stop());
  setVoiceUI('processing');
}

async function handleRecordingStop() {
  const mime = voice.mediaRecorder?.mimeType || 'audio/webm';
  const blob = new Blob(voice.audioChunks, { type: mime });
  let text   = voice.finalTranscript.trim();
  if (!text && blob.size > 1000) {
    text = await whisperTranscribe(blob, mime);
  }
  if (!text) { toast('Could not understand audio', 'error'); resetVoiceUI(); return; }
  showLiveT(text, false);
  startCountdown(text, 2);
}

async function whisperTranscribe(blob, mime) {
  try {
    const ext = mime.includes('webm') ? 'webm' : 'wav';
    const fd  = new FormData(); fd.append('audio', blob, `rec.${ext}`);
    const res = await fetch('/api/transcribe', {
      method:'POST', body: fd,
      headers: AUTH.token ? { Authorization: `Bearer ${AUTH.token}` } : {},
    });
    if (!res.ok) throw new Error(res.status);
    return (await res.json()).text || '';
  } catch { return ''; }
}

function startSpeechRecognition() {
  const rec = new SpeechAPI(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
  voice.recognition = rec;
  rec.onresult = e => {
    voice.finalTranscript = ''; voice.interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      e.results[i].isFinal ? (voice.finalTranscript += t + ' ') : (voice.interimTranscript += t);
    }
    if (el.ivLtText) el.ivLtText.innerHTML =
      (voice.finalTranscript   ? `<span>${esc(voice.finalTranscript)}</span>` : '') +
      (voice.interimTranscript ? `<span class="lt-interim">${esc(voice.interimTranscript)}</span>` : '');
  };
  rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') console.warn('SR:', e.error); };
  rec.start();
}

function startCountdown(text, secs) {
  let rem = secs;
  if (el.ivCountdown) el.ivCountdown.textContent = rem;
  el.ivBtnMic?.classList.add('counting');
  voice.countdownTimer = setInterval(() => {
    rem--;
    if (el.ivCountdown) el.ivCountdown.textContent = rem;
    if (rem <= 0) { clearCountdown(); resetVoiceUI(); hideLiveT(); sendMessage(text, true); }
  }, 1000);
}

function clearCountdown() {
  clearInterval(voice.countdownTimer); voice.countdownTimer = null;
  el.ivBtnMic?.classList.remove('counting');
  if (el.ivCountdown) el.ivCountdown.textContent = '3';
}

function voiceStop() {
  if (voice.recording) stopRecording();
  else if (voice.currentAudio) stopSpeaking();
  else { clearCountdown(); resetVoiceUI(); }
}

function startWaveform() {
  voice.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = voice.audioCtx.createMediaStreamSource(voice.stream);
  voice.analyser = voice.audioCtx.createAnalyser(); voice.analyser.fftSize = 64;
  src.connect(voice.analyser);
  const canvas = el.ivWaveCanvas; el.ivWaveWrap?.classList.add('visible');
  canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
  canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
  const ctx2 = canvas.getContext('2d'); const data = new Uint8Array(voice.analyser.frequencyBinCount);
  const draw = () => {
    if (!voice.recording) return; voice.animFrame = requestAnimationFrame(draw);
    voice.analyser.getByteFrequencyData(data);
    const W = canvas.width, H = canvas.height; ctx2.clearRect(0,0,W,H);
    const bars = 22, step = Math.floor(data.length / bars), bw = W/bars - 2;
    for (let i = 0; i < bars; i++) {
      const v = data[i*step]/255;
      ctx2.fillStyle = `rgba(118,185,0,${0.3+v*0.7})`;
      ctx2.fillRect(i*(bw+2),(H-Math.max(2,v*H*0.9))/2,bw,Math.max(2,v*H*0.9));
    }
  }; draw();
}

function stopWaveform() {
  if (voice.animFrame) cancelAnimationFrame(voice.animFrame); voice.animFrame = null;
  el.ivWaveWrap?.classList.remove('visible');
  voice.audioCtx?.close(); voice.audioCtx = null;
}

function setVoiceUI(state) {
  const mic = el.ivBtnMic; if (!mic) return;
  mic.classList.remove('recording','speaking');
  switch(state) {
    case 'idle':
      mic.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg><span class="iv-countdown" id="iv-countdown">3</span>`;
      el.ivVoiceBar?.classList.remove('visible');
      if ($('ctrl-mic')) { $('ctrl-mic').classList.remove('recording'); $('ctrl-mic-label').textContent='Mic'; }
      el.aiOrb?.classList.remove('speaking'); setAgentStatus('Listening for your response…'); break;
    case 'recording':
      mic.classList.add('recording');
      mic.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="1"/></svg><span class="iv-countdown" id="iv-countdown">3</span>`;
      updateVoiceBar('listen','<strong>Listening</strong> — click to stop');
      if ($('ctrl-mic')) { $('ctrl-mic').classList.add('recording'); $('ctrl-mic-label').textContent='Stop'; }
      el.aiOrb?.classList.remove('speaking'); setAgentStatus('Listening…'); break;
    case 'processing':
      mic.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity=".2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg><span class="iv-countdown" id="iv-countdown">3</span>`;
      updateVoiceBar('proc','Processing voice…'); setAgentStatus('Processing your voice…'); break;
    case 'speaking':
      mic.classList.add('speaking');
      mic.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="1"/></svg><span class="iv-countdown" id="iv-countdown">3</span>`;
      updateVoiceBar('speak','<strong>Agent speaking</strong> — click to stop');
      if ($('ctrl-mic-label')) $('ctrl-mic-label').textContent='Stop AI';
      el.aiOrb?.classList.add('speaking'); setAgentStatus('AI is speaking…'); break;
  }
}

function updateVoiceBar(type, html) {
  el.ivVoiceBar?.classList.add('visible','iv-vb-'+type);
  if (el.ivVoiceTxt) el.ivVoiceTxt.innerHTML = html;
}

function resetVoiceUI() {
  setVoiceUI('idle'); hideLiveT();
  el.ivVoiceBar?.classList.remove('visible','iv-vb-listen','iv-vb-proc','iv-vb-speak');
  clearCountdown();
}

function showLiveT(text, isRecording) {
  el.ivLiveT?.classList.add('visible');
  if (isRecording) {
    el.ivLiveT?.classList.remove('done');
    if (el.ivLtLabel) { el.ivLtLabel.className='lt-lbl rec'; el.ivLtLabel.textContent='LISTENING'; }
    if (el.ivLtText)  el.ivLtText.innerHTML='<span class="lt-interim">Start speaking…</span>';
  } else {
    el.ivLiveT?.classList.add('done');
    if (el.ivLtLabel) { el.ivLtLabel.className='lt-lbl done'; el.ivLtLabel.textContent='TRANSCRIPT'; }
    if (el.ivLtText)  el.ivLtText.textContent = text;
  }
}
function hideLiveT() { el.ivLiveT?.classList.remove('visible','done'); }
function setAgentStatus(txt) { if (el.agentStatusTxt) el.agentStatusTxt.textContent = txt; }


/* ============================================================
   TTS
   ============================================================ */
async function speakText(text) {
  if (app.speakerMuted || !text || text.length < 3) return;
  const clean = text.replace(/#{1,6}\s/g,'').replace(/\*\*/g,'').replace(/\*/g,'').replace(/`/g,'')
    .replace(/\n{2,}/g,'. ').replace(/\n/g,' ').slice(0,900);
  setVoiceUI('speaking');
  try {
    const res = await fetch('/api/speak', {
      method:'POST', headers:{ 'Content-Type':'application/json', ...(AUTH.token ? { Authorization:`Bearer ${AUTH.token}` } : {}) },
      body: JSON.stringify({ text: clean, voice:'nova' }),
    });
    if (!res.ok) throw new Error(res.status);
    const blob  = await res.blob(); const url = URL.createObjectURL(blob);
    const audio = new Audio(url); voice.currentAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(url); stopSpeaking(); };
    audio.onerror = () => stopSpeaking();
    await audio.play();
  } catch { stopSpeaking(); }
}

function stopSpeaking() { voice.currentAudio?.pause(); voice.currentAudio = null; resetVoiceUI(); }


/* ============================================================
   REPORTS
   ============================================================ */
async function saveReport(report) {
  try {
    const res = await api('/api/reports/save', 'POST', { report });
    if (res.saved) toast(`Report ${report.report_id || ''} saved`, 'success');
  } catch (e) {
    // 403 means the due date has passed
    if (e.message && e.message.includes('deadline')) {
      // Show a persistent error in the chat
      addIvMessage('assistant',
        `**Session Deadline Reached**\n\n${e.message}\n\n` +
        `Please contact your manager to extend your assignment deadline before continuing.`);
    } else {
      toast('Could not save report: ' + (e.message || ''), 'error');
    }
  }
}


/* ============================================================
   MANAGER DASHBOARD
   ============================================================ */
async function loadManagerDashboard() {
  let stats = null, assigns = [];
  try { stats   = await api('/api/manager/stats'); }
  catch (e) { console.error('Stats error:', e); toast('Stats: ' + e.message, 'error'); }
  try { assigns = await api('/api/assignments'); }
  catch (e) { console.error('Assignments error:', e); assigns = []; }

  if (stats) renderDashboard(stats);
  renderAssignmentTable(assigns);
  populateCandidateSelect();
  updateNavBadges(stats, assigns);

  // Load users for assignment dropdown
  try {
    const users = await api('/api/users');
    populateCandidateSelect(users.filter(u => u.role === 'candidate'));
  } catch { /* non-critical */ }
}

function mgrNav(page, navEl) {
  document.querySelectorAll('.mgr-nav-item').forEach(n => n.classList.remove('active'));
  if (navEl) navEl.classList.add('active');
  else document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.mgr-page').forEach(p => p.classList.remove('active'));
  $(`mgr-page-${page}`)?.classList.add('active');

  if (['dashboard','assignments'].includes(page)) loadManagerDashboard();
  if (page === 'reports')  loadAllReports();
  if (page === 'members')  loadMembers();
}

function updateNavBadges(stats, assigns) {
  if ($('nav-reports-badge')) $('nav-reports-badge').textContent = stats ? String(stats.total_reports ?? 0) : '?';
  if ($('nav-assign-badge'))  $('nav-assign-badge').textContent  = Array.isArray(assigns) ? assigns.length : 0;
}

function renderDashboard(stats) {
  if (!stats) return;
  if ($('stat-total'))    $('stat-total').textContent    = String(stats.total_reports   ?? 0);
  if ($('stat-critical')) $('stat-critical').textContent = String(stats.critical_issues ?? 0);
  if ($('stat-cands'))    $('stat-cands').textContent    = String(stats.total_users     ?? 0);
  if ($('stat-complete')) $('stat-complete').textContent = (stats.completion_rate ?? 0) + '%';
  if ($('nav-members-badge')) $('nav-members-badge').textContent = String(stats.total_users ?? 0);

  // Severity bars
  const sevEl = $('sev-bars');
  if (sevEl && stats.severity_breakdown) {
    const total  = stats.total_reports || 1;
    const colors = { critical:'#ff7070', high:'#ffc040', medium:'#a78bfa', low:'#a8e045' };
    sevEl.innerHTML = Object.entries(stats.severity_breakdown).map(([k,v]) => `
      <div class="sev-bar-wrap">
        <span class="sev-bar-label">${cap(k)}</span>
        <div class="sev-bar-track"><div class="sev-bar-fill" style="width:${Math.round(v/total*100)}%;background:${colors[k]||'#aaa'}"></div></div>
        <span class="sev-bar-count">${v}</span>
      </div>`).join('');
  }

  // Pipeline
  const pipeEl = $('pipeline-bars');
  if (pipeEl && stats.assignment_status) {
    const total = stats.total_assignments || 1;
    const st    = stats.assignment_status;
    const items = [
      { label:'Pending',     key:'pending',    color:'#ffc040' },
      { label:'In Progress', key:'in_progress',color:'#60a5fa' },
      { label:'Completed',   key:'completed',  color:'#a8e045' },
    ];
    pipeEl.innerHTML = items.map(p => `
      <div class="pipeline-row">
        <span class="pipeline-label">${p.label}</span>
        <div class="pipeline-bar"><div class="pipeline-fill" style="width:${Math.round((st[p.key]||0)/total*100)}%;background:${p.color}"></div></div>
        <span class="pipeline-count">${st[p.key]||0}</span>
      </div>`).join('');
  }

  // Recent reports
  const recentEl = $('recent-reports-table');
  if (recentEl) {
    const rr = stats.recent_reports || [];
    recentEl.innerHTML = rr.length ? rr.map(r => `
      <tr>
        <td class="td-name">${r.process_name||'Unknown'}</td>
        <td>${r.process_stage||'—'}</td>
        <td>${severityBadge(r.severity)}</td>
        <td>${priorityBadge(r.priority)}</td>
        <td>${r.candidate_name||r.submitted_by||'—'}</td>
        <td class="td-mono">${fmtDate(r.timestamp)}</td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="empty-state">No reports yet</td></tr>`;
  }
}

/* All reports */
async function loadAllReports() {
  try {
    const reports = await api('/api/reports');
    const tbl = $('all-reports-table'); if (!tbl) return;
    if (!reports.length) { tbl.innerHTML = `<tr><td colspan="8"><div class="empty-state">No reports submitted yet.</div></td></tr>`; return; }

    // Type labels and colours
    const typeLabel = { work: 'Work', growth_wellbeing: 'Growth & Wellbeing', openline: 'Open Line' };
    const typeColor = { work: 'var(--green)', growth_wellbeing: '#a78bfa', openline: 'var(--blue)' };

    tbl.innerHTML = reports.map(r => {
      const rtype  = r.report_type || 'work';
      const tlabel = typeLabel[rtype] || rtype;
      const tcolor = typeColor[rtype] || 'var(--green)';
      const displayName = r.is_anonymous || !r.candidate_name
        ? '<span style="color:#a78bfa;font-size:10px;font-weight:700">Anonymous</span>'
        : esc(r.candidate_name || r.submitted_by || '—');
      const typeBadge = `<span style="font-size:9px;font-weight:700;color:${tcolor};border:1px solid;border-color:${tcolor};border-radius:4px;padding:1px 5px;white-space:nowrap">${tlabel}</span>`;
      const detailHtml = rtype === 'work'
        ? `<strong>Problem:</strong> ${esc(r.problem_description||'N/A')}<br>
           <strong>Root Cause:</strong> ${esc(typeof r.root_cause==='object'?(r.root_cause?.ai_inferred||r.root_cause?.user_provided||'N/A'):(r.root_cause||'N/A'))}<br>
           <strong>Solution (Employee):</strong> ${esc(typeof r.suggested_solution==='object'?(r.suggested_solution?.user||'—'):(r.suggested_solution||'N/A'))}<br>
           <strong>AI Recommendation:</strong> ${esc(typeof r.suggested_solution==='object'?(r.suggested_solution?.ai||'—'):'N/A')}<br>
           <strong>Expected Impact:</strong> ${esc(r.expected_impact||'N/A')}&nbsp;·&nbsp;
           <strong>Frequency:</strong> ${esc(r.frequency||'N/A')}<br>
           ${r.time_drain_hours_per_week ? `<strong>Est. Time Drain:</strong> ${esc(r.time_drain_hours_per_week)} hrs/week<br>` : ''}
           ${r.biggest_friction_point ? `<strong>Biggest Friction:</strong> ${esc(r.biggest_friction_point)}<br>` : ''}
           ${r.automation_opportunity ? `<strong>Automation Opp:</strong> ${esc(r.automation_opportunity)}<br>` : ''}
           ${r.team_impact ? `<strong>Team Impact:</strong> ${esc(r.team_impact)}<br>` : ''}
           ${r.workarounds_in_use ? `<strong>Workarounds:</strong> ${esc(r.workarounds_in_use)}<br>` : ''}
           ${r.business_impact_summary ? `<strong>Business Impact:</strong> ${esc(r.business_impact_summary)}<br>` : ''}
           ${r.quick_wins?.length ? `<strong>Quick Wins:</strong> ${r.quick_wins.map(esc).join(', ')}<br>` : ''}`
        : rtype === 'growth_wellbeing'
        ? `${r.upskilling_areas?.length ? `<strong>Upskilling:</strong> ${r.upskilling_areas.map(esc).join(', ')}<br>` : ''}
           ${r.burnout_signals?.length ? `<strong>Burnout Signals:</strong> ${r.burnout_signals.map(esc).join(', ')}<br>` : ''}
           ${r.career_concern ? `<strong>Career Concern:</strong> ${esc(r.career_concern)}<br>` : ''}
           ${r.overall_wellbeing_note ? `<strong>Note:</strong> ${esc(r.overall_wellbeing_note)}` : ''}`
        : `<strong>Topic:</strong> ${esc(r.escalation_topic||'N/A')}<br>
           <strong>Detail:</strong> ${esc(r.escalation_detail||'N/A')}`;
      return `
      <tr onclick="toggleReportRow('${r.report_id||r.id}')" style="cursor:pointer;">
        <td class="td-mono" style="font-size:10px">${esc(r.report_id||'—')}</td>
        <td>${typeBadge}</td>
        <td class="td-name">${rtype==='work' ? esc(r.process_name||'Unknown') : '—'}</td>
        <td>${rtype==='work' ? esc(r.process_stage||'—') : '—'}</td>
        <td>${rtype==='work' ? severityBadge(r.severity) : '—'}</td>
        <td>${rtype==='work' ? priorityBadge(r.priority) : '—'}</td>
        <td>${displayName}</td>
        <td class="td-mono">${fmtDate(r.timestamp)}</td>
        <td><button class="tbl-action del" onclick="event.stopPropagation();deleteReport('${r.report_id}')">Delete</button></td>
      <tr id="expand-${r.report_id||r.id}"><td colspan="9" style="padding:0">
        <div class="report-expand" id="expand-body-${r.report_id||r.id}">${detailHtml}</div>
      </td></tr>`;
    }).join('');
  } catch { toast('Could not load reports', 'error'); }
}

function toggleReportRow(id) { $(`expand-body-${id}`)?.classList.toggle('open'); }

async function deleteReport(id) {
  if (!id || !confirm(`Delete report ${id}?`)) return;
  try { await api(`/api/reports/${id}`, 'DELETE'); toast('Report deleted', 'info'); loadAllReports(); loadManagerDashboard(); }
  catch (e) { toast('Could not delete: ' + e.message, 'error'); }
}

/* Assignments */
function renderAssignmentTable(assigns) {
  const tbl = $('assignments-table'); if (!tbl) return;
  if (!assigns.length) { tbl.innerHTML=`<tr><td colspan="5"><div class="empty-state">No assignments yet.</div></td></tr>`; return; }
  const today = new Date(); today.setHours(0,0,0,0);
  tbl.innerHTML = assigns.map(a => {
    const due      = a.due_date ? new Date(a.due_date + 'T00:00:00') : null;
    const expired  = due && due < today && a.status !== 'completed';
    const dueStr   = due ? due.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const dueBadge = expired
      ? `<span style="color:var(--red);font-size:10px;font-weight:700;">EXPIRED</span> ${dueStr}`
      : dueStr;
    return `<tr ${expired ? 'style="opacity:0.75"' : ''}>
      <td class="td-name">${a.candidate_name}</td>
      <td>${assignStatusBadge(a.status)}</td>
      <td class="td-mono" style="font-size:11px">${dueBadge}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
        ${a.status!=='completed' ? `<button class="tbl-action complete" onclick="updateAssign('${a.id}','completed')">Done</button>` : ''}
        ${a.status==='pending'   ? `<button class="tbl-action" onclick="updateAssign('${a.id}','in_progress')">Start</button>` : ''}
        <button class="tbl-action" style="border-color:rgba(59,130,246,0.3);color:var(--blue)" onclick="showExtendDueDate('${a.id}','${a.due_date||''}')" title="Update due date">Extend</button>
        <button class="tbl-action del" onclick="deleteAssign('${a.id}')">Delete</button>
      </td>
    </tr>
    <tr id="extend-row-${a.id}" style="display:none">
      <td colspan="4" style="padding:0">
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface-2);border:1px solid var(--border);">
          <label style="font-size:11px;color:var(--text-muted);white-space:nowrap;">New due date:</label>
          <input class="form-input" type="date" id="extend-date-${a.id}" value="${a.due_date||''}" style="max-width:160px;padding:6px 10px;"/>
          <button class="tbl-action complete" onclick="submitExtend('${a.id}')">Save</button>
          <button class="tbl-action" onclick="hideExtendRow('${a.id}')">Cancel</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function populateCandidateSelect() {
  // Dropdown replaced by email field — kept as no-op to avoid reference errors
}

async function createAssignment() {
  const email = ($('assign-email')?.value || '').toLowerCase().trim();
  const name  = ($('assign-name')?.value || '').trim();
  const due   = $('assign-due')?.value || '';
  const time  = $('assign-time')?.value || '10:00';
  const notes = $('assign-notes')?.value.trim() || '';
  if (!email) { toast('Employee email is required', 'error'); $('assign-email')?.focus(); return; }
  if (!due)   { toast('Date is required', 'error'); $('assign-due')?.focus(); return; }
  if (!time)  { toast('Time slot is required', 'error'); $('assign-time')?.focus(); return; }
  try {
    const res = await api('/api/assignments','POST',{ candidate_email:email, candidate_name:name, due_date:due, session_time:time, notes });
    const calMsg = res.calendar_event_id ? ' · Calendar event created' : '';
    toast(`Session assigned to ${email}${calMsg}`, 'success');
    ['assign-email','assign-name','assign-due','assign-notes'].forEach(id => { const e=$(id); if(e) e.value=''; });
    const timeEl = $('assign-time'); if (timeEl) timeEl.value = '10:00';
    loadManagerDashboard();
  } catch (e) { toast('Could not create: ' + e.message, 'error'); }
}

/* Extend due date inline row */
function showExtendDueDate(id, currentDate) {
  hideAllExtendRows();
  const row = $(`extend-row-${id}`);
  if (row) row.style.display = '';
}

function hideExtendRow(id) {
  const row = $(`extend-row-${id}`);
  if (row) row.style.display = 'none';
}

function hideAllExtendRows() {
  document.querySelectorAll('[id^="extend-row-"]').forEach(r => r.style.display = 'none');
}

async function submitExtend(id) {
  const inp = $(`extend-date-${id}`);
  const newDate = inp?.value;
  if (!newDate) { toast('Please pick a date', 'error'); return; }
  try {
    await api(`/api/assignments/${id}/due-date`, 'PATCH', { due_date: newDate });
    toast(`Due date updated to ${fmtDate(newDate)}`, 'success');
    hideExtendRow(id);
    loadManagerDashboard();
  } catch (e) { toast('Could not update: ' + e.message, 'error'); }
}

async function updateAssign(id, status) {
  try { await api(`/api/assignments/${id}`,'PATCH',{status}); toast('Assignment updated','success'); loadManagerDashboard(); }
  catch (e) { toast('Error: '+e.message,'error'); }
}

async function deleteAssign(id) {
  if (!confirm('Delete this assignment?')) return;
  try { await api(`/api/assignments/${id}`,'DELETE'); toast('Deleted','info'); loadManagerDashboard(); }
  catch (e) { toast('Error: '+e.message,'error'); }
}

/* Members */
async function loadMembers() {
  try {
    const users = await api('/api/users');
    const active   = users.filter(u => u.is_active !== false);
    const inactive = users.filter(u => u.is_active === false);

    const tbody    = $('members-tbody');
    const itbody   = $('inactive-tbody');
    const badge    = $('members-count-badge');
    const detail   = $('detail-members');

    if (badge)  badge.textContent  = users.length;
    if (detail) detail.textContent = `${users.length} member${users.length !== 1 ? 's' : ''}`;
    if ($('nav-members-badge')) $('nav-members-badge').textContent = users.length;

    if (tbody) {
      tbody.innerHTML = active.length ? active.map(u => `
        <tr>
          <td>
            <div style="font-weight:600;font-size:13px">${esc(u.name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${u.job_role||''}</div>
          </td>
          <td style="font-size:12px;color:var(--text-2)">${esc(u.email)}</td>
          <td>${roleBadge(u.role)}</td>
          <td style="font-size:12px">${esc(u.department||'—')}</td>
          <td>
            <button class="tbl-action deact" onclick="toggleMember('${u.id}',false)">Deactivate</button>
            ${u.id !== AUTH.user?.sub ? `<button class="tbl-action del" onclick="deleteMember('${u.id}','${esc(u.name)}')">Remove</button>` : ''}
          </td>
        </tr>`).join('')
        : `<tr><td colspan="5"><div class="empty-state">No active members</div></td></tr>`;
    }

    if (itbody) {
      itbody.innerHTML = inactive.length ? inactive.map(u => `
        <tr>
          <td><div style="font-weight:600;font-size:13px;color:var(--text-muted)">${esc(u.name)}</div></td>
          <td style="font-size:12px;color:var(--text-muted)">${esc(u.email)}</td>
          <td>${roleBadge(u.role)}</td>
          <td>
            <button class="tbl-action react" onclick="toggleMember('${u.id}',true)">Activate</button>
            <button class="tbl-action del" onclick="deleteMember('${u.id}','${esc(u.name)}')">Remove</button>
          </td>
        </tr>`).join('')
        : `<tr><td colspan="4"><div class="empty-state" style="padding:16px">No inactive members</div></td></tr>`;
    }
  } catch (e) { toast('Could not load members: '+e.message,'error'); }
}

async function addMember() {
  const name  = $('mem-name')?.value.trim();
  const email = $('mem-email')?.value.trim();
  const role  = $('mem-role')?.value || 'candidate';
  const pw    = $('mem-password')?.value;
  const dept  = $('mem-dept')?.value.trim() || '';
  const jr    = $('mem-jobrole')?.value.trim() || '';
  if (!name)  { toast('Name is required','error'); return; }
  if (!email) { toast('Email is required','error'); return; }
  if (!pw)    { toast('Password is required','error'); return; }
  try {
    await api('/api/users','POST',{ name, email, password:pw, role, department:dept, job_role:jr });
    toast(`${role === 'manager' ? 'Manager' : 'Candidate'} "${name}" added`,'success');
    ['mem-name','mem-email','mem-password','mem-dept','mem-jobrole'].forEach(id => { const e=$(id); if(e) e.value=''; });
    loadMembers();
  } catch (e) { toast('Could not add: '+e.message,'error'); }
}

async function toggleMember(id, active) {
  try {
    await api(`/api/users/${id}`,'PATCH',{ is_active: active });
    toast(`Member ${active ? 'activated' : 'deactivated'}`,'info');
    loadMembers();
  } catch (e) { toast('Error: '+e.message,'error'); }
}

async function deleteMember(id, name) {
  if (!confirm(`Remove "${name}" from the platform? This cannot be undone.`)) return;
  try { await api(`/api/users/${id}`,'DELETE'); toast(`${name} removed`,'info'); loadMembers(); }
  catch (e) { toast('Error: '+e.message,'error'); }
}


/* ============================================================
   PARTICLES
   ============================================================ */
function initParticles() {
  if (typeof particlesJS === 'undefined') return;
  particlesJS('particles-js', {
    particles: {
      number:   { value: 55, density: { enable: true, value_area: 900 } },
      color:    { value: '#76b900' },
      shape:    { type: 'circle' },
      opacity:  { value: 0.25, random: true, anim: { enable: true, speed: 0.3, opacity_min: 0.05, sync: false } },
      size:     { value: 2, random: true },
      line_linked: { enable: false },
      move: { enable: true, speed: 0.4, random: true, out_mode: 'out' },
    },
    interactivity: { events: { onhover: { enable: false }, onclick: { enable: false } } },
    retina_detect: true,
  });
}


/* ============================================================
   HELPERS
   ============================================================ */
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function fmtDate(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('en-GB',{ day:'numeric',month:'short',year:'numeric' }); } catch { return iso.slice(0,10); } }

function severityBadge(s) {
  const m = { critical:'red', high:'amber', medium:'purple', low:'green' };
  return `<span class="badge badge-${m[(s||'low').toLowerCase()]||'gray'}">${cap(s||'low')}</span>`;
}
function priorityBadge(p) {
  const m = { critical:'red', high:'amber', medium:'blue', low:'green' };
  return `<span class="badge badge-${m[(p||'low').toLowerCase()]||'gray'}">${cap(p||'low')}</span>`;
}
function assignStatusBadge(s) {
  const m = { pending:'amber', in_progress:'blue', completed:'green' };
  return `<span class="badge badge-${m[s]||'gray'}">${(s||'pending').replace('_',' ').toUpperCase()}</span>`;
}
function roleBadge(r) {
  return r === 'manager'
    ? `<span class="badge badge-blue">MANAGER</span>`
    : `<span class="badge badge-green">CANDIDATE</span>`;
}

function toast(msg, type = 'info') {
  const t = document.createElement('div'); t.className = `toast ${type}`;
  t.innerHTML = `<span>${type==='success'?'✓':type==='error'?'✕':'·'}</span>${esc(msg)}`;
  el.toasts?.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(10px)'; setTimeout(()=>t.remove(),220); }, 3000);
}

async function api(path, method = 'GET', body = null, noAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (!noAuth && AUTH.token) headers['Authorization'] = `Bearer ${AUTH.token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { AUTH.clear(); showView('login'); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) { const e = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(e.detail || res.statusText); }
  return res.json();
}


/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);
