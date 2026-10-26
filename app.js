/* ==========================================
   WorkDay Tracker — App Logic v2
   Persistent storage (survives browser close),
   past history across all days,
   break edit / delete support
   ========================================== */
'use strict';

// =============================================
// STORAGE KEYS — all data lives in localStorage
// which persists across browser restarts
// =============================================
const STATE_KEY    = 'wdt_state';      // today's live session
const HISTORY_KEY  = 'wdt_history';   // array of completed days
const SETTINGS_KEY = 'wdt_settings';  // user preferences

// =============================================
// DEFAULT STATE & SETTINGS
// =============================================
function defaultState() {
  return {
    phase: 'idle',          // 'idle' | 'working' | 'on_break' | 'ended'
    arrivedAt: null,        // ms timestamp
    endedAt: null,          // ms timestamp
    currentBreakStart: null,
    currentBreakType: null, // 'lunch' | 'break'
    currentBreakReason: '',
    events: [],             // [{ id, type, time, label, detail }]
    breaks: [],             // [{ id, type, start, end, reason, duration }]
    totalBreakMs: 0,
    notifSent: { halfway: false, almostDone: false, goal: false },
  };
}

let state    = defaultState();
let history  = [];   // array of completed day objects (same shape as state)
let settings = { targetHours: 8, yourName: '', notificationsEnabled: false, soundEnabled: true };

let tickInterval     = null;
let activeHistoryDay = null;   // day object currently shown in detail modal
let _eid             = 0;      // simple incrementing id for events/breaks
const uid = () => `e${++_eid}_${Date.now()}`;

// =============================================
// DOM SHORTCUTS
// =============================================
const $ = (id) => document.getElementById(id);

// =============================================
// UTILITIES
// =============================================
const pad = (n) => String(n).padStart(2, '0');

function formatTime(ts) {
  const d = new Date(ts);
  let h = d.getHours(), m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ap}`;
}

function fmtDuration(ms, showSec = false) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const sec = s % 60, min = Math.floor(s / 60) % 60, hrs = Math.floor(s / 3600);
  if (showSec) return `${hrs > 0 ? hrs + 'h ' : ''}${pad(min)}m ${pad(sec)}s`;
  if (hrs > 0) return `${hrs}h ${pad(min)}m`;
  return `${min}m`;
}

function fmtTs(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDateFull(ts) {
  const d = new Date(ts);
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

function formatDateShort(ts) {
  const d = new Date(ts);
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function targetMs() { return settings.targetHours * 3600000; }

function workedMs(s = state) {
  if (!s.arrivedAt) return 0;
  const end = s.endedAt || Date.now();
  const raw = end - s.arrivedAt;
  let ongoing = 0;
  if (s.currentBreakStart && s.phase === 'on_break') {
    ongoing = Date.now() - s.currentBreakStart;
  }
  return Math.max(0, raw - s.totalBreakMs - ongoing);
}

function currentBreakMs() {
  if (!state.currentBreakStart) return 0;
  return Date.now() - state.currentBreakStart;
}

function isToday(ts) {
  return ts && new Date(ts).toDateString() === new Date().toDateString();
}

// Recompute totalBreakMs from breaks array (used after editing)
function recomputeTotalBreak(s = state) {
  s.totalBreakMs = s.breaks.reduce((acc, b) => acc + (b.duration || 0), 0);
}

// Rebuild events array from breaks (used after editing/deleting a break)
function rebuildEvents(s = state) {
  // Keep non-break/resume events, then re-insert breaks in chronological order
  const coreEvents = s.events.filter(e => e.type !== 'lunch' && e.type !== 'break' && e.type !== 'resume');
  const breakEvents = [];
  s.breaks.forEach(b => {
    breakEvents.push({
      id: uid(), type: b.type, time: b.start,
      label: b.type === 'lunch' ? '🍽️ Lunch Break' : `☕ Break${b.reason ? ': ' + b.reason : ''}`,
      detail: b.reason || ''
    });
    breakEvents.push({
      id: uid(), type: 'resume', time: b.end,
      label: '▶️ Resumed Work',
      detail: `Back from ${b.type === 'lunch' ? 'lunch' : (b.reason || 'break')} (${fmtDuration(b.duration)})`
    });
  });
  s.events = [...coreEvents, ...breakEvents].sort((a, b) => a.time - b.time);
}

// =============================================
// STORAGE — PERSIST & RESTORE
// =============================================
function saveState()    { localStorage.setItem(STATE_KEY,    JSON.stringify(state));    }
function saveHistory()  { localStorage.setItem(HISTORY_KEY,  JSON.stringify(history));  }
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

function loadAll() {
  // --- settings ---
  try { const r = localStorage.getItem(SETTINGS_KEY); if (r) settings = { ...settings, ...JSON.parse(r) }; } catch(e) {}

  // --- history (all past completed days) ---
  try { const r = localStorage.getItem(HISTORY_KEY); if (r) history = JSON.parse(r) || []; } catch(e) {}

  // --- today's session ---
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Restore if it's today OR if it's still an ongoing (working/on_break) session from any day
      // (edge: user left session open overnight — we still restore so they can end it)
      if (saved && (saved.phase === 'working' || saved.phase === 'on_break' || isToday(saved.arrivedAt))) {
        state = { ...defaultState(), ...saved };
        // Ensure notifSent exists
        if (!state.notifSent) state.notifSent = { halfway: false, almostDone: false, goal: false };
      }
    }
  } catch(e) {}
}

// Archive today's finished session into history
function archiveToHistory(s) {
  const dayData = JSON.parse(JSON.stringify(s)); // deep copy
  // Check if this day already exists in history (by arrivedAt date string)
  const idx = history.findIndex(h =>
    new Date(h.arrivedAt).toDateString() === new Date(dayData.arrivedAt).toDateString()
  );
  if (idx >= 0) {
    history[idx] = dayData; // update existing
  } else {
    history.unshift(dayData); // newest first
  }
  // Keep max 90 days
  if (history.length > 90) history = history.slice(0, 90);
  saveHistory();
}

// =============================================
// SCREEN MANAGEMENT
// =============================================
function showScreen(name) {
  $('notStartedScreen').classList.add('hidden');
  $('trackingScreen').classList.add('hidden');
  $('endedScreen').classList.add('hidden');
  if (name === 'notStarted') $('notStartedScreen').classList.remove('hidden');
  else if (name === 'tracking') $('trackingScreen').classList.remove('hidden');
  else if (name === 'ended')    $('endedScreen').classList.remove('hidden');
}

function switchTab(tab) {
  $('todayTab').classList.toggle('active', tab === 'today');
  $('historyTab').classList.toggle('active', tab === 'history');
  $('todayView').classList.toggle('hidden', tab !== 'today');
  $('historyView').classList.toggle('hidden', tab !== 'history');
  if (tab === 'history') renderHistory();
}

// =============================================
// CLOCK IN
// =============================================
function clockIn(customTime = null) {
  const now = customTime || Date.now();
  state = defaultState();
  state.phase     = 'working';
  state.arrivedAt = now;
  addEvent('arrival', now, '🏁 Clocked In', '');
  saveState();
  startTick();
  showScreen('tracking');
  renderTimeline();
  updateActionButtons();
  toast('🏁 Workday started! Have a great day!', 'success');
  if (settings.notificationsEnabled) requestNotifPermission();
}

// =============================================
// END DAY
// =============================================
function endDay() {
  if (state.phase === 'on_break') endBreak(false);
  state.phase   = 'ended';
  state.endedAt = Date.now();
  addEvent('end', state.endedAt, '🏠 Clocked Out', '');
  saveState();
  archiveToHistory(state);
  stopTick();
  showSummary();
  showScreen('ended');
  updateHistoryCount();
}

// =============================================
// BREAKS
// =============================================
function startBreak(type, reason) {
  if (state.phase !== 'working') return;
  state.phase             = 'on_break';
  state.currentBreakStart = Date.now();
  state.currentBreakType  = type;
  state.currentBreakReason = reason;
  addEvent(type, Date.now(),
    type === 'lunch' ? '🍽️ Lunch Break' : `☕ Break${reason ? ': ' + reason : ''}`,
    reason
  );
  saveState();
  updateStatusBanner();
  updateActionButtons();
  renderTimeline();
}

function endBreak(showToastMsg = true) {
  if (state.phase !== 'on_break') return;
  const dur    = Date.now() - state.currentBreakStart;
  const bType  = state.currentBreakType;
  const bReason = state.currentBreakReason;
  const breakObj = {
    id: uid(),
    type: bType,
    start: state.currentBreakStart,
    end: Date.now(),
    reason: bReason,
    duration: dur
  };
  state.breaks.push(breakObj);
  state.totalBreakMs += dur;
  addEvent('resume', Date.now(), '▶️ Resumed Work',
    `Back from ${bType === 'lunch' ? 'lunch' : (bReason || 'break')} (${fmtDuration(dur)})`
  );
  state.currentBreakStart  = null;
  state.currentBreakType   = null;
  state.currentBreakReason = '';
  state.phase = 'working';
  saveState();
  updateStatusBanner();
  updateActionButtons();
  renderTimeline();
  if (showToastMsg) toast('▶️ Welcome back! Keep going!', 'success');
}

// =============================================
// EDIT / DELETE A PAST BREAK
// =============================================
let editingBreakId = null;

function openEditBreak(breakId) {
  const brk = state.breaks.find(b => b.id === breakId);
  if (!brk) return;
  editingBreakId = breakId;

  $('editBreakInfo').textContent =
    `Original: ${formatTime(brk.start)} → ${formatTime(brk.end)} (${fmtDuration(brk.duration)})`;
  $('editBreakReason').value = brk.reason || '';

  const sDate = new Date(brk.start);
  const eDate = new Date(brk.end);
  $('editBreakStart').value = `${pad(sDate.getHours())}:${pad(sDate.getMinutes())}`;
  $('editBreakEnd').value   = `${pad(eDate.getHours())}:${pad(eDate.getMinutes())}`;
  showModal('editBreakModal');
}

function saveEditBreak() {
  const brk = state.breaks.find(b => b.id === editingBreakId);
  if (!brk) return;

  const reason   = $('editBreakReason').value.trim();
  const startVal = $('editBreakStart').value;
  const endVal   = $('editBreakEnd').value;

  if (!startVal || !endVal) { toast('⚠️ Please set both start and end times.', 'warning'); return; }

  const refDate = new Date(brk.start);
  const [sh, sm] = startVal.split(':').map(Number);
  const [eh, em] = endVal.split(':').map(Number);

  const newStart = new Date(refDate); newStart.setHours(sh, sm, 0, 0);
  const newEnd   = new Date(refDate); newEnd.setHours(eh, em, 0, 0);

  if (newEnd <= newStart) { toast('⚠️ End time must be after start time.', 'warning'); return; }
  if (newStart < state.arrivedAt) { toast('⚠️ Break cannot start before arrival time.', 'warning'); return; }

  // Validate: break must end before another break starts (basic check)
  const dur = newEnd.getTime() - newStart.getTime();

  brk.reason   = reason;
  brk.start    = newStart.getTime();
  brk.end      = newEnd.getTime();
  brk.duration = dur;

  recomputeTotalBreak();
  rebuildEvents();
  saveState();
  hideModal('editBreakModal');
  renderTimeline();
  updateStatCards();
  updateRing();
  toast('✏️ Break updated!', 'success');
}

function deleteBreak() {
  state.breaks = state.breaks.filter(b => b.id !== editingBreakId);
  recomputeTotalBreak();
  rebuildEvents();
  saveState();
  hideModal('editBreakModal');
  renderTimeline();
  updateStatCards();
  updateRing();
  toast('🗑️ Break entry removed.', 'info');
}

// =============================================
// EVENTS
// =============================================
function addEvent(type, time, label, detail) {
  state.events.push({ id: uid(), type, time, label, detail });
  saveState();
}

// =============================================
// TICK
// =============================================
function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 1000);
  tick();
}
function stopTick() { clearInterval(tickInterval); tickInterval = null; }

function tick() {
  updateLiveClock();
  if (state.phase === 'working' || state.phase === 'on_break') {
    updateRing();
    updateStatCards();
    updateStatusBanner();
    checkMilestones();
  }
}

// =============================================
// UI UPDATERS
// =============================================
function updateLiveClock() {
  const now = new Date();
  $('liveClock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  $('dateBadge').textContent = formatDateFull(Date.now());
}

function updateWelcomeGreeting() {
  const h = new Date().getHours();
  const name = settings.yourName ? `, ${settings.yourName}` : '';
  let greeting = h < 12 ? '☀️ Good Morning' : h < 17 ? '🌤️ Good Afternoon' : '🌙 Good Evening';
  $('welcomeTitle').textContent = `${greeting}${name}! 👋`;
  const finishTime = new Date(Date.now() + targetMs());
  $('finishByEstimate').textContent = formatTime(finishTime.getTime());
  $('targetDisplay').textContent = `${settings.targetHours}h`;
}

function updateRing() {
  const worked = workedMs();
  const target = targetMs();
  const C = 2 * Math.PI * 118; // 741.42

  const pr = $('progressRing');
  const or = $('overtimeRing');
  const wd = $('workedDisplay');
  const rp = $('ringPercent');

  if (worked <= target) {
    const pct    = worked / target;
    const offset = C * (1 - pct);
    pr.style.display = '';
    or.style.display = 'none';
    pr.setAttribute('stroke-dashoffset', offset.toFixed(2));
    pr.setAttribute('stroke-dasharray', `${C}`);
    rp.textContent = `${Math.floor(pct * 100)}%`;
    rp.classList.remove('overtime-badge');
    wd.classList.remove('overtime-text');
  } else {
    pr.setAttribute('stroke-dashoffset', '0');
    pr.setAttribute('stroke-dasharray', `${C}`);
    or.style.display = '';
    const extraPct = Math.min((worked - target) / target, 1);
    or.setAttribute('stroke-dasharray', `${C * extraPct} ${C}`);
    rp.textContent = `+${fmtDuration(worked - target)} OT`;
    rp.classList.add('overtime-badge');
    wd.classList.add('overtime-text');
  }

  wd.textContent = fmtDuration(worked);
  $('ringSubText').textContent = `of ${fmtDuration(target)}`;
}

function updateStatCards() {
  const worked    = workedMs();
  const target    = targetMs();
  const remaining = Math.max(0, target - worked);
  const breakTotal = state.totalBreakMs + (state.phase === 'on_break' ? currentBreakMs() : 0);

  $('arrivedTime').textContent   = state.arrivedAt ? formatTime(state.arrivedAt) : '—';
  $('totalBreakTime').textContent = fmtDuration(breakTotal);
  $('remainingTime').textContent  = worked >= target ? 'Done! 🎉' : fmtDuration(remaining);

  if (worked < target && state.phase === 'working') {
    $('estFinish').textContent = formatTime(Date.now() + remaining);
  } else if (worked >= target) {
    $('estFinish').textContent = state.endedAt ? formatTime(state.endedAt) : 'Now! 🎉';
  } else {
    // on break — extend estimate by current break time
    $('estFinish').textContent = formatTime(Date.now() + remaining + currentBreakMs());
  }
}

function updateStatusBanner() {
  const dot  = $('statusDot');
  const txt  = $('statusText');
  const elps = $('statusElapsed');
  if (state.phase === 'working') {
    dot.className = 'status-dot';
    txt.textContent = 'Working';
    elps.textContent = `· ${fmtDuration(workedMs())}`;
  } else if (state.phase === 'on_break') {
    dot.className = 'status-dot on-break';
    txt.textContent = state.currentBreakType === 'lunch' ? '🍽️ Lunch Break' : '☕ On Break';
    elps.textContent = `· ${fmtDuration(currentBreakMs())}`;
  }
}

function updateActionButtons() {
  const lb = $('lunchBtn');
  const bb = $('breakBtn');
  if (state.phase === 'on_break') {
    if (state.currentBreakType === 'lunch') {
      lb.innerHTML = `<span class="btn-icon">🍽️</span><span class="btn-text">End Lunch</span>`;
      lb.classList.add('active');
      bb.disabled = true; bb.style.opacity = '0.4';
    } else {
      bb.innerHTML = `<span class="btn-icon">☕</span><span class="btn-text">End Break</span>`;
      bb.classList.add('active');
      lb.disabled = true; lb.style.opacity = '0.4';
    }
  } else {
    lb.innerHTML = `<span class="btn-icon">🍽️</span><span class="btn-text">Lunch Break</span>`;
    lb.classList.remove('active'); lb.disabled = false; lb.style.opacity = '';
    bb.innerHTML = `<span class="btn-icon">☕</span><span class="btn-text">Take Break</span>`;
    bb.classList.remove('active'); bb.disabled = false; bb.style.opacity = '';
  }
}

function updateHistoryCount() {
  const cnt = $('historyCount');
  if (history.length > 0) {
    cnt.textContent = history.length;
    cnt.style.display = '';
  } else {
    cnt.style.display = 'none';
  }
}

// =============================================
// TIMELINE RENDERING
// =============================================
function renderTimeline(container = $('timeline'), sourceState = state, allowEdit = true) {
  container.innerHTML = '';
  if (!sourceState.events.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px 0;">No events yet.</p>';
    return;
  }

  // Tracking screen: newest first. Summary/history: oldest first.
  const reversed = container.id === 'timeline';
  const events = reversed ? [...sourceState.events].reverse() : [...sourceState.events];

  events.forEach((ev, i) => {
    const item = document.createElement('div');
    item.className = 'timeline-item';

    const dotClass = { arrival:'arrival', lunch:'lunch', break:'break', end:'end', resume:'resume' }[ev.type] || 'arrival';
    const isOngoing = reversed && i === 0 && sourceState.phase !== 'ended';

    const badgeMap = {
      arrival: `working ${isOngoing ? 'ongoing' : ''}`,
      lunch:   `lunch   ${isOngoing ? 'ongoing' : ''}`,
      break:   `break   ${isOngoing ? 'ongoing' : ''}`,
      end:     'ended',
      resume:  `working ${isOngoing ? 'ongoing' : ''}`,
    };
    const badge = `<span class="tl-badge ${(badgeMap[ev.type] || '').trim()}">${
      { arrival:'Working', lunch:'Lunch', break:'Break', end:'Ended', resume:'Working' }[ev.type] || ''
    }</span>`;

    // Edit button for completed breaks (has a matching break in state.breaks)
    let editBtn = '';
    if (allowEdit && sourceState === state && sourceState.phase !== 'ended') {
      if (ev.type === 'lunch' || ev.type === 'break') {
        // Find the matching completed break by start time
        const brk = sourceState.breaks.find(b => Math.abs(b.start - ev.time) < 2000);
        if (brk) {
          item.classList.add('editable');
          editBtn = `<button class="tl-edit-btn" data-break-id="${brk.id}">✏️ Edit</button>`;
        }
      }
    }

    const detail = ev.detail ? `<div class="tl-duration">${ev.detail}</div>` : '';

    item.innerHTML = `
      <div class="tl-dot ${dotClass}"></div>
      <div class="tl-content">
        <div class="tl-event">${ev.label}</div>
        <div class="tl-time">${formatTime(ev.time)} · ${fmtTs(ev.time)}</div>
        ${detail}
      </div>
      ${badge}
      ${editBtn}
    `;
    container.appendChild(item);
  });

  // Attach edit button listeners
  if (allowEdit) {
    container.querySelectorAll('.tl-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditBreak(btn.dataset.breakId);
      });
    });
  }
}

// =============================================
// MILESTONES
// =============================================
function checkMilestones() {
  const worked = workedMs();
  const target = targetMs();
  const ns     = state.notifSent;

  if (!ns.halfway && worked >= target * 0.5) {
    ns.halfway = true;
    toast('🎯 Halfway there! Keep it up!', 'info');
    sendNotif('Halfway there! 🎯', `You've worked ${fmtDuration(worked)} so far.`);
    playSound(440, 0.2);
    saveState();
  }
  if (!ns.almostDone && worked >= target * 0.875) {
    ns.almostDone = true;
    toast('⚡ Almost done! Just 1 hour left!', 'info');
    sendNotif('Almost done! ⚡', 'Less than 1 hour remaining.');
    playSound(523, 0.2);
    saveState();
  }
  if (!ns.goal && worked >= target) {
    ns.goal = true;
    toast(`🎉 Goal reached! ${settings.targetHours}h complete!`, 'success');
    sendNotif('Goal Reached! 🎉', `You've completed your ${settings.targetHours}-hour workday!`);
    playSound(659, 0.3); setTimeout(() => playSound(784, 0.3), 200);
    saveState();
  }
}

// =============================================
// SUMMARY (today's ended screen)
// =============================================
function showSummary(s = state) {
  const worked = workedMs(s);
  const target = targetMs();
  const diff   = worked - target;
  const span   = (s.endedAt || Date.now()) - s.arrivedAt;

  $('sumArrived').textContent = formatTime(s.arrivedAt);
  $('sumLeft').textContent    = s.endedAt ? formatTime(s.endedAt) : '—';
  $('sumTotal').textContent   = fmtDuration(span);
  $('sumBreaks').textContent  = fmtDuration(s.totalBreakMs);
  $('sumWorked').textContent  = fmtDuration(worked);

  if (diff >= 0) {
    $('sumVsGoal').textContent  = `+${fmtDuration(diff)} extra`;
    $('summaryTitle').textContent = diff > 3600000 ? 'Amazing Work! 🚀' : 'Great Job! 🎉';
    $('summaryEmoji').textContent = diff > 3600000 ? '🏆' : '🎉';
    $('summarySub').textContent   = `You crushed your ${settings.targetHours}-hour goal!`;
  } else {
    $('sumVsGoal').textContent  = `-${fmtDuration(Math.abs(diff))} short`;
    $('summaryTitle').textContent = 'Day Complete 🌅';
    $('summaryEmoji').textContent = '🌙';
    $('summarySub').textContent   = `You worked ${fmtDuration(worked)} today.`;
  }
  if (settings.yourName) {
    $('summaryTitle').textContent = diff >= 0
      ? `Great work, ${settings.yourName}! 🎉`
      : `Day done, ${settings.yourName}! 🌅`;
  }
  renderTimeline($('summaryTimeline'), s, false);
}

// =============================================
// REPORT TEXT
// =============================================
function generateReport(s = state) {
  const worked = workedMs(s);
  const target = targetMs();
  const diff   = worked - target;
  return [
    `📋 WorkDay Report — ${formatDateFull(s.arrivedAt)}`,
    `─────────────────────────────────`,
    `🏁 Arrived:    ${formatTime(s.arrivedAt)}`,
    `🏠 Left:       ${s.endedAt ? formatTime(s.endedAt) : 'Ongoing'}`,
    `☕ Breaks:     ${fmtDuration(s.totalBreakMs)}`,
    `⏱️  Net worked: ${fmtDuration(worked)}`,
    `🎯 Goal:       ${fmtDuration(target)}`,
    `📊 vs Goal:    ${diff >= 0 ? '+' : ''}${fmtDuration(Math.abs(diff))} ${diff >= 0 ? '(extra)' : '(short)'}`,
    ``,
    `📅 Timeline:`,
    ...s.events.map(ev => `  • ${formatTime(ev.time)} — ${ev.label}${ev.detail ? ` (${ev.detail})` : ''}`),
  ].join('\n');
}

function copyReport(s = state) {
  const txt = generateReport(s);
  navigator.clipboard.writeText(txt).then(() => {
    toast('📋 Report copied to clipboard!', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('📋 Report copied!', 'success');
  });
}

// =============================================
// HISTORY RENDERING
// =============================================
function renderHistory() {
  const list  = $('historyList');
  const empty = $('historyEmpty');
  const bar   = $('historySummaryBar');
  list.innerHTML = '';

  if (!history.length) {
    empty.style.display = '';
    bar.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  // Summary bar stats
  const totalDays   = history.length;
  const totalWorked = history.reduce((a, d) => a + workedMs(d), 0);
  const avgWorked   = totalWorked / totalDays;
  const goalDays    = history.filter(d => workedMs(d) >= targetMs()).length;
  const totalBreaks = history.reduce((a, d) => a + d.totalBreakMs, 0);

  bar.innerHTML = `
    <div class="hsb-card"><div class="hsb-label">Total Days</div><div class="hsb-value">${totalDays}</div></div>
    <div class="hsb-card"><div class="hsb-label">Total Worked</div><div class="hsb-value">${fmtDuration(totalWorked)}</div></div>
    <div class="hsb-card"><div class="hsb-label">Avg / Day</div><div class="hsb-value">${fmtDuration(avgWorked)}</div></div>
    <div class="hsb-card"><div class="hsb-label">Goal Achieved</div><div class="hsb-value">${goalDays}/${totalDays}</div></div>
  `;

  history.forEach((day, idx) => {
    const worked  = workedMs(day);
    const target  = targetMs();
    const diff    = worked - target;
    const isComplete = worked >= target;
    const isOver     = diff > 0;

    const card = document.createElement('div');
    card.className = 'history-day-card';
    const badgeTxt   = isOver ? `+${fmtDuration(diff)} OT` : isComplete ? 'Complete' : `-${fmtDuration(Math.abs(diff))} short`;
    const badgeCls   = isOver ? 'over' : isComplete ? 'complete' : 'short';
    const barCls     = isComplete ? 'complete' : 'short';

    card.innerHTML = `
      <div class="hdc-bar ${barCls}"></div>
      <div class="hdc-date">
        <div class="hdc-day">${formatDateShort(day.arrivedAt)}</div>
        <div class="hdc-sub">${formatTime(day.arrivedAt)} → ${day.endedAt ? formatTime(day.endedAt) : 'Ongoing'}</div>
      </div>
      <div class="hdc-stats">
        <div class="hdc-stat">
          <div class="hdc-stat-label">Worked</div>
          <div class="hdc-stat-val">${fmtDuration(worked)}</div>
        </div>
        <div class="hdc-stat">
          <div class="hdc-stat-label">Breaks</div>
          <div class="hdc-stat-val">${fmtDuration(day.totalBreakMs)}</div>
        </div>
      </div>
      <span class="hdc-badge ${badgeCls}">${badgeTxt}</span>
    `;

    card.addEventListener('click', () => openHistoryDetail(day, idx));
    list.appendChild(card);
  });
}

function openHistoryDetail(day, idx) {
  activeHistoryDay = { day, idx };
  $('historyDetailTitle').textContent = formatDateFull(day.arrivedAt);

  const worked = workedMs(day);
  const diff   = worked - targetMs();
  $('historyDetailStats').innerHTML = `
    <div class="hds-card"><div class="hds-label">Arrived</div><div class="hds-value">${formatTime(day.arrivedAt)}</div></div>
    <div class="hds-card"><div class="hds-label">Left</div><div class="hds-value">${day.endedAt ? formatTime(day.endedAt) : '—'}</div></div>
    <div class="hds-card"><div class="hds-label">Net Worked</div><div class="hds-value">${fmtDuration(worked)}</div></div>
    <div class="hds-card"><div class="hds-label">Break Time</div><div class="hds-value">${fmtDuration(day.totalBreakMs)}</div></div>
    <div class="hds-card"><div class="hds-label">vs ${settings.targetHours}h Goal</div><div class="hds-value">${diff >= 0 ? '+' : ''}${fmtDuration(Math.abs(diff))}</div></div>
    <div class="hds-card"><div class="hds-label">Breaks Count</div><div class="hds-value">${day.breaks.length}</div></div>
  `;
  renderTimeline($('historyDetailTimeline'), day, false);
  showModal('historyDetailModal');
}

function deleteHistoryDay() {
  if (!activeHistoryDay) return;
  if (!confirm(`Delete the record for ${formatDateFull(activeHistoryDay.day.arrivedAt)}? This cannot be undone.`)) return;
  history.splice(activeHistoryDay.idx, 1);
  saveHistory();
  hideModal('historyDetailModal');
  renderHistory();
  updateHistoryCount();
  toast('🗑️ Day record deleted.', 'info');
}

// =============================================
// NOTIFICATIONS & SOUND
// =============================================
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
function sendNotif(title, body) {
  if (!settings.notificationsEnabled) return;
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
}
function playSound(freq, vol = 0.2) {
  if (!settings.soundEnabled) return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq; osc.type = 'sine';
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

// =============================================
// TOAST
// =============================================
function toast(msg, type = 'info') {
  const icons = { success:'✅', info:'ℹ️', warning:'⚠️', error:'❌' };
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${msg}</span>`;
  $('toastContainer').appendChild(el);
  setTimeout(() => { el.classList.add('hiding'); setTimeout(() => el.remove(), 350); }, 3500);
}

// =============================================
// MODAL HELPERS
// =============================================
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden');    }

// =============================================
// EVENT LISTENERS
// =============================================
function initListeners() {

  // ---- Tabs ----
  $('todayTab').addEventListener('click',   () => switchTab('today'));
  $('historyTab').addEventListener('click', () => switchTab('history'));

  // ---- Clock In ----
  $('clockInBtn').addEventListener('click', () => clockIn());

  // ---- Manual arrival time ----
  $('manualTimeBtn').addEventListener('click', () => {
    const now = new Date();
    $('manualTimeInput').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    showModal('manualTimeModal');
  });
  $('closeManualModal').addEventListener('click', ()  => hideModal('manualTimeModal'));
  $('cancelManualModal').addEventListener('click', ()  => hideModal('manualTimeModal'));
  $('confirmManualTime').addEventListener('click', () => {
    const val = $('manualTimeInput').value;
    if (!val) return;
    const [h, m] = val.split(':').map(Number);
    const t = new Date(); t.setHours(h, m, 0, 0);
    if (t > new Date()) { toast('⚠️ Arrival time cannot be in the future!', 'warning'); return; }
    hideModal('manualTimeModal');
    clockIn(t.getTime());
  });

  // ---- Lunch ----
  $('lunchBtn').addEventListener('click', () => {
    if (state.phase === 'on_break' && state.currentBreakType === 'lunch') {
      endBreak();
    } else {
      startBreak('lunch', 'Lunch');
      toast('🍽️ Lunch break started! Enjoy your meal!', 'info');
    }
  });

  // ---- Custom Break ----
  $('breakBtn').addEventListener('click', () => {
    if (state.phase === 'on_break' && state.currentBreakType === 'break') {
      endBreak();
    } else {
      $('breakReasonInput').value = '';
      showModal('breakModal');
    }
  });
  $('closeBreakModal').addEventListener('click',  () => hideModal('breakModal'));
  $('cancelBreakModal').addEventListener('click', () => hideModal('breakModal'));
  $('confirmBreak').addEventListener('click', () => {
    const reason = $('breakReasonInput').value.trim();
    hideModal('breakModal');
    startBreak('break', reason);
    toast(`☕ Break started${reason ? ': ' + reason : ''}!`, 'info');
  });
  $('breakReasonInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('confirmBreak').click(); });

  // ---- Edit Break ----
  $('closeEditBreakModal').addEventListener('click', () => hideModal('editBreakModal'));
  $('cancelEditBreak').addEventListener('click',     () => hideModal('editBreakModal'));
  $('confirmEditBreak').addEventListener('click', saveEditBreak);
  $('deleteBreakBtn').addEventListener('click', () => {
    if (confirm('Remove this break entry? The time will be added back to your work time.')) deleteBreak();
  });

  // ---- End Day ----
  $('endDayBtn').addEventListener('click', () => {
    const worked = workedMs();
    const diff   = targetMs() - worked;
    $('endDayMessage').innerHTML = diff > 0
      ? `You still have <strong>${fmtDuration(diff)}</strong> remaining to reach your ${settings.targetHours}h goal. Are you sure?`
      : `You've worked <strong>${fmtDuration(worked)}</strong> today. Ready to clock out?`;
    showModal('endDayModal');
  });
  $('closeEndModal').addEventListener('click',  () => hideModal('endDayModal'));
  $('cancelEndModal').addEventListener('click', () => hideModal('endDayModal'));
  $('confirmEndDay').addEventListener('click', () => { hideModal('endDayModal'); endDay(); });

  // ---- New Day (from ended screen) ----
  $('newDayBtn').addEventListener('click', () => {
    if (confirm('Start a fresh day?')) {
      state = defaultState();
      saveState();
      showScreen('notStarted');
      updateWelcomeGreeting();
    }
  });

  // ---- Copy Report ----
  $('copyReportBtn').addEventListener('click', () => copyReport(state));

  // ---- History actions ----
  $('clearHistoryBtn').addEventListener('click', () => {
    if (!history.length) { toast('📭 History is already empty.', 'info'); return; }
    if (confirm(`Delete all ${history.length} day records? This cannot be undone.`)) {
      history = []; saveHistory();
      renderHistory(); updateHistoryCount();
      toast('🗑️ History cleared.', 'info');
    }
  });
  $('closeHistoryDetail').addEventListener('click',    () => hideModal('historyDetailModal'));
  $('deleteHistoryDayBtn').addEventListener('click',   deleteHistoryDay);
  $('copyHistoryReportBtn').addEventListener('click',  () => {
    if (activeHistoryDay) copyReport(activeHistoryDay.day);
  });

  // ---- Settings ----
  $('settingsBtn').addEventListener('click', () => {
    $('targetHours').value        = settings.targetHours;
    $('yourName').value           = settings.yourName || '';
    $('notifToggle').checked      = settings.notificationsEnabled;
    $('soundToggle').checked      = settings.soundEnabled;
    showModal('settingsModal');
  });
  $('closeSettingsModal').addEventListener('click', () => hideModal('settingsModal'));
  $('saveSettings').addEventListener('click', () => {
    settings.targetHours           = parseFloat($('targetHours').value) || 8;
    settings.yourName              = $('yourName').value.trim();
    settings.notificationsEnabled  = $('notifToggle').checked;
    settings.soundEnabled          = $('soundToggle').checked;
    if (settings.notificationsEnabled) requestNotifPermission();
    saveSettings();
    hideModal('settingsModal');
    updateWelcomeGreeting();
    if (state.phase === 'working' || state.phase === 'on_break') updateRing();
    toast('⚙️ Settings saved!', 'success');
  });

  // ---- Theme toggle ----
  $('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const light = document.body.classList.contains('light-mode');
    localStorage.setItem('wdt_theme', light ? 'light' : 'dark');
    $('themeIcon').innerHTML = light
      ? `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/>`
      : `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
         <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
         <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
         <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  });

  // ---- Close modals on backdrop click ----
  document.querySelectorAll('.modal-backdrop').forEach(b =>
    b.addEventListener('click', e => { if (e.target === b) b.classList.add('hidden'); })
  );

  // ---- Escape key ----
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape')
      document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => m.classList.add('hidden'));
  });

  // ---- Page visibility: refresh UI when tab gains focus ----
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (state.phase === 'working' || state.phase === 'on_break')) {
      tick(); renderTimeline();
    }
  });
}

// =============================================
// INIT
// =============================================
function init() {
  loadAll();

  // Restore theme
  if (localStorage.getItem('wdt_theme') === 'light') document.body.classList.add('light-mode');

  updateLiveClock();
  updateWelcomeGreeting();
  updateHistoryCount();
  initListeners();

  if (state.phase === 'working' || state.phase === 'on_break') {
    showScreen('tracking');
    updateActionButtons();
    updateStatusBanner();
    renderTimeline();
    startTick();
    toast('👋 Welcome back! Your session has been restored.', 'info');
  } else if (state.phase === 'ended' && isToday(state.arrivedAt)) {
    showSummary();
    showScreen('ended');
  } else {
    // Stale ended day from a previous day — archive it if not already, then show fresh start
    if (state.phase === 'ended' && state.arrivedAt && !isToday(state.arrivedAt)) {
      archiveToHistory(state);
      state = defaultState();
      saveState();
      updateHistoryCount();
    }
    showScreen('notStarted');
  }

  // Always-running clock
  setInterval(updateLiveClock, 1000);
}

document.addEventListener('DOMContentLoaded', init);
