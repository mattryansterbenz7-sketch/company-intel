const QUEUE_STAGE = 'needs_review';
const DISMISS_STAGE = 'rejected';
const DISMISS_TAG = "Didn't apply";
const SCORE_THRESHOLDS = { green: 7, amber: 4 };

let allCompanies = [];
let allKnownTags = [];
let activeType = 'all';
let activeRatings = new Set(); // empty = any
let activeStatus = 'all';
let activeTag = null;
let activeActionFilter = 'all'; // 'all' | 'my_court' | 'their_court'
let viewMode = localStorage.getItem('ci_viewMode') || 'kanban';

const DEFAULT_OPPORTUNITY_STAGES = [
  { key: 'needs_review',    label: "Coop's AI Scoring Queue",           color: '#64748b' },
  { key: 'want_to_apply',   label: 'I Want to Apply',           color: '#22d3ee' },
  { key: 'applied',         label: 'Applied',                   color: '#60a5fa' },
  { key: 'intro_requested', label: 'Intro Requested',           color: '#a78bfa' },
  { key: 'conversations',   label: 'Conversations in Progress', color: '#fb923c' },
  { key: 'offer_stage',     label: 'Offer Stage',               color: '#a3e635' },
  { key: 'accepted',        label: 'Accepted',                  color: '#4ade80' },
  { key: 'rejected',        label: "Rejected / DQ'd",           color: '#f87171' },
];
const DEFAULT_COMPANY_STAGES = [
  { key: 'co_watchlist',   label: 'Watch List',      color: '#64748b' },
  { key: 'co_researching', label: 'Researching',     color: '#22d3ee' },
  { key: 'co_networking',  label: 'Networking',      color: '#a78bfa' },
  { key: 'co_interested',  label: 'Strong Interest', color: '#fb923c' },
  { key: 'co_applied',     label: 'Applied There',   color: '#60a5fa' },
  { key: 'co_archived',    label: 'Archived',        color: '#374151' },
];
let customOpportunityStages = [...DEFAULT_OPPORTUNITY_STAGES];
let customCompanyStages = [...DEFAULT_COMPANY_STAGES];
let activePipeline = localStorage.getItem('ci_activePipeline') || 'opportunity'; // 'all' | 'opportunity' | 'company'
let stageCelebrations = {}; // { [stageKey]: { confetti, sound } } — loaded from storage
const DEFAULT_ACTION_STATUSES = [
  { key: 'my_court', label: '🏀 My Court', color: '#FF7A59' },
  { key: 'their_court', label: '⏳ Their Court', color: '#0ea5e9' },
  { key: 'scheduled', label: '📅 Scheduled', color: '#a78bfa' },
];

function detectScheduledStatus(entry) {
  const events = entry.cachedCalendarEvents || [];
  const now = new Date();
  return events.some(e => new Date(e.start) > now);
}
let customActionStatuses = null; // loaded from storage, falls back to DEFAULT
let _userWorkArrangement = []; // loaded from chrome.storage.sync prefs
const _collapsedCols = new Set(JSON.parse(sessionStorage.getItem('ci_collapsed_cols') || '[]'));
let activityPeriod = localStorage.getItem('ci_activityPeriod') || 'weekly';
let activityCustomRange = JSON.parse(localStorage.getItem('ci_activityCustomRange') || 'null'); // {start:'YYYY-MM-DD', end:'YYYY-MM-DD'} or null
let activityGoals = {
  daily:   { saved: 3,  applied: 1,  intro: 1,  interviewed: 1 },
  weekly:  { saved: 15, applied: 5,  intro: 3,  interviewed: 2 },
  monthly: { saved: 60, applied: 20, intro: 12, interviewed: 8 }
};

const DEFAULT_STAT_CARDS = [
  { key: 'saved',       label: 'Opportunities Saved',        stages: ['*'],               color: '#0ea5e9', mode: 'activity' },
  { key: 'applied',     label: 'Applications',              stages: ['applied'],         color: '#FF7A59', mode: 'activity' },
  { key: 'intro',       label: 'Reached Out / Intro Asked', stages: ['intro_requested'], color: '#a78bfa', mode: 'activity' },
  { key: 'interviewed', label: 'New Conversations Started', stages: ['conversations'],   color: '#fb923c', mode: 'activity' },
];
let statCardConfigs = DEFAULT_STAT_CARDS.map(c => ({ ...c }));

function parseLocalDate(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00').getTime();
  const ms = new Date(s).getTime();
  return isNaN(ms) ? 0 : ms;
}

function truncLabel(str, max = 40) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function computeLastActivity(entry) {
  const candidates = [];

  // A. Emails
  const BULK_RE = /noreply|no-reply|notifications?@|mailer-daemon|newsletter|digest@|linkedin\.com|updates?@|marketing@/i;
  const parseSender = (fromStr) => {
    if (!fromStr) return '';
    const before = fromStr.includes('<') ? fromStr.split('<')[0].trim() : fromStr.trim();
    const first = before.split(/\s+/)[0];
    return (first && !first.includes('@') && first.length > 1) ? first : '';
  };
  (entry.cachedEmails || []).forEach(thread => {
    // Skip bulk/notification senders
    const fromRaw = thread.from || (thread.messages?.[0]?.from) || '';
    if (BULK_RE.test(fromRaw)) return;

    let ts = 0, senderName = '';
    if (thread.messages && thread.messages.length) {
      const lastMsg = thread.messages[thread.messages.length - 1];
      ts = new Date(lastMsg.date).getTime();
      senderName = parseSender(lastMsg.from);
      if (!senderName && thread.from) senderName = parseSender(thread.from);
      if (!senderName && thread.messages[0]?.from) senderName = parseSender(thread.messages[0].from);
    }
    if (!senderName && thread.from) senderName = parseSender(thread.from);
    if (!ts || isNaN(ts)) ts = thread.date ? new Date(thread.date).getTime() : 0;
    if (!ts || isNaN(ts)) ts = thread.internalDate ? parseInt(thread.internalDate) : 0;
    if (!ts || isNaN(ts)) return;
    const label = senderName
      ? truncLabel('Email from ' + senderName)
      : truncLabel('Email: ' + (thread.subject || 'No subject'));
    candidates.push({ timestamp: ts, label, type: 'email' });
  });

  // B. Meetings (Granola)
  (entry.cachedMeetings || []).forEach(m => {
    let ts = m.createdAt ? parseLocalDate(m.createdAt) : 0;
    if (!ts) ts = parseLocalDate(m.date);
    if (!ts) return;
    candidates.push({ timestamp: ts, label: truncLabel('Call: ' + (m.title || 'Meeting')), type: 'meeting' });
  });

  // C. Calendar events (past only)
  const now = Date.now();
  (entry.cachedCalendarEvents || []).forEach(evt => {
    const ts = new Date(evt.start).getTime();
    if (!ts || isNaN(ts) || ts > now) return;
    candidates.push({ timestamp: ts, label: truncLabel('Meeting: ' + (evt.summary || evt.title || 'Event')), type: 'calendar' });
  });

  // D. Activity log
  (entry.activityLog || []).forEach(log => {
    const ts = parseLocalDate(log.date);
    if (!ts) return;
    const typeLabels = {
      linkedin_dm: 'LinkedIn DM',
      phone_call: 'Phone call',
      coffee_chat: 'Coffee chat',
      text: 'Text',
      referral: 'Referral',
      applied: 'Applied',
      other: ''
    };
    const prefix = typeLabels[log.type] || '';
    const label = log.type === 'applied' ? 'Applied'
      : prefix ? truncLabel(prefix + ': ' + (log.note || ''))
      : truncLabel(log.note || 'Activity');
    candidates.push({ timestamp: ts, label, type: 'activity_log' });
  });

  // E. Applied date (editable field — NOT stageTimestamps)
  if (entry.appliedDate && entry.appliedDate > 0) {
    candidates.push({ timestamp: entry.appliedDate, label: 'Applied', type: 'applied' });
  }

  if (!candidates.length) return { timestamp: 0, label: null };
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return candidates[0];
}

function getUpcomingCalendarEvent(entry) {
  const events = entry.cachedCalendarEvents || [];
  const now = Date.now();
  const twoWeeks = now + 14 * 24 * 60 * 60 * 1000;
  const future = events
    .filter(e => { const t = new Date(e.start).getTime(); return t > now && t <= twoWeeks; })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return future.length ? future[0] : null;
}

function isSemanticallySimlar(a, b) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const wa = norm(a), wb = norm(b);
  if (!wa.length || !wb.length) return false;
  const shared = wa.filter(w => wb.includes(w)).length;
  if (shared >= 2) return true;
  const names = s => (s.match(/\b[A-Z][a-z]{2,}/g) || []).map(n => n.toLowerCase());
  const namesA = names(a), namesB = names(b);
  return namesA.some(n => namesB.includes(n));
}

function autoPopulateNextStep(entry) {
  const upcoming = getUpcomingCalendarEvent(entry);
  if (!upcoming) return null;
  const eventTitle = (upcoming.summary || upcoming.title || '').trim();
  if (!eventTitle) return null;
  const eventDate = new Date(upcoming.start).toISOString().split('T')[0];
  const currentStep = (entry.nextStep || '').trim();
  const currentDate = entry.nextStepDate || '';
  if (currentDate === eventDate && currentStep) return null;
  if (!currentStep) return { nextStep: eventTitle, nextStepDate: eventDate };
  if (isSemanticallySimlar(currentStep, eventTitle)) return { nextStep: eventTitle, nextStepDate: eventDate };
  return { nextStep: eventTitle + ' → ' + currentStep, nextStepDate: eventDate };
}

// Helper: record timestamp when entry first reaches a stage
function stageEnterTimestamp(entry, stageKey) {
  const ts = { ...(entry.stageTimestamps || {}) };
  if (!ts[stageKey]) ts[stageKey] = Date.now();
  return { stageTimestamps: ts };
}

// Auto-set "Action On" based on stage — my court for early stages, their court after applying
function defaultActionStatus(stageKey) {
  if (/needs_review|want_to_apply|interested/i.test(stageKey)) return 'my_court';
  if (/applied|intro_requested|conversations|offer|accepted/i.test(stageKey)) return 'their_court';
  return null; // don't change for stages we don't recognize
}

function currentStages() {
  return activePipeline === 'company' ? customCompanyStages : customOpportunityStages;
}
function stageMap() { return Object.fromEntries(currentStages().map(s => [s.key, s.label])); }
function stageColor(key) {
  const all = [...customOpportunityStages, ...customCompanyStages];
  return (all.find(s => s.key === key) || currentStages()[0]).color;
}
function stageStyle(key) {
  const c = stageColor(key);
  const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  return { border: c, color: c, bg: `rgba(${r},${g},${b},0.1)` };
}
function updateStageDynamicCSS() {
  let el = document.getElementById('dynamic-stage-css');
  if (!el) { el = document.createElement('style'); el.id = 'dynamic-stage-css'; document.head.appendChild(el); }
  const defaultKeys = new Set([...DEFAULT_OPPORTUNITY_STAGES, ...DEFAULT_COMPANY_STAGES].map(s => s.key));
  const allCustom = [...customOpportunityStages, ...customCompanyStages].filter(s => !defaultKeys.has(s.key));
  el.textContent = allCustom.map(s => {
    const r = parseInt(s.color.slice(1,3),16), g = parseInt(s.color.slice(3,5),16), b = parseInt(s.color.slice(5,7),16);
    return `.status-select[data-status="${s.key}"] { background-color: rgba(${r},${g},${b},0.12); border: 1.5px solid ${s.color}; color: ${s.color}; }`;
  }).join('\n');
}

function boldKeyPhrase(text) {
  const splitRe = /\s+(matches|signals|aligns|mirrors|fits|exceeds|suggests|indicates|required|doesn't|limits|conflicts|may feel|verify|confirm|typical)\b/i;
  const m = text.match(splitRe);
  if (m) { const idx = text.indexOf(m[0]); return `<strong>${text.slice(0, idx)}</strong>${text.slice(idx)}`; }
  const dashSplit = text.match(/^(.+?)\s*[;—–]\s*(.+)$/);
  if (dashSplit) return `<strong>${dashSplit[1]}</strong> — ${dashSplit[2]}`;
  return text;
}

function escHtmlGlobal(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// Column view modes (compact vs standard) stored in localStorage
const _colViewModes = JSON.parse(localStorage.getItem('ci_colViewModes') || '{}');
function getColViewMode(stageKey) {
  if (_colViewModes[stageKey]) return _colViewModes[stageKey];
  return stageKey === QUEUE_STAGE ? 'compact' : 'standard';
}
function setColViewMode(stageKey, mode) {
  _colViewModes[stageKey] = mode;
  localStorage.setItem('ci_colViewModes', JSON.stringify(_colViewModes));
}

function renderCompactCard(c) {
  const score = c.jobMatch?.score ?? c.quickFitScore ?? null;
  const isScoring = c._queuedForScoring && score === null;

  const tier = score != null ? (score >= SCORE_THRESHOLDS.green ? 'green' : score >= SCORE_THRESHOLDS.amber ? 'amber' : 'red') : '';
  const stateClass = isScoring ? ' scoring' : '';

  // Hard DQ — only show if score is genuinely low (3 or below) to avoid false positives
  const hardDQ = c.jobMatch?.hardDQ || c.hardDQ;
  const compactDQHtml = hardDQ?.flagged && score != null && score <= 3 ? '<div class="compact-dq">\u{1F6AB} Hard DQ</div>' : '';

  // Score display
  let scoreHtml;
  if (score != null) {
    scoreHtml = `<span class="compact-score-num ${tier}">${score}</span><span class="compact-score-den">/10</span>${compactDQHtml}`;
  } else if (isScoring) {
    scoreHtml = '<span class="compact-spinner"></span>';
  } else {
    scoreHtml = '<span class="compact-queue-dot"></span>';
  }

  // Helper: strip job title prefix from any text field
  function stripTitleEcho(text) {
    if (!text || !c.jobTitle) return text;
    const tl = c.jobTitle.toLowerCase().trim();
    const xl = text.toLowerCase().trim();
    // Exact or prefix match
    if (xl.startsWith(tl)) {
      text = text.slice(c.jobTitle.length).replace(/^[\s:—–\-,.;with]+/i, '').trim();
    }
    // If remaining text is empty or essentially the same as the title, kill it
    if (text) {
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm(text) === norm(c.jobTitle) || norm(c.jobTitle).includes(norm(text)) && text.length < c.jobTitle.length + 10) text = '';
    }
    return text;
  }

  // Meta line: salary + arrangement
  let salary = c.baseSalaryRange || c.oteTotalComp || c.jobMatch?.salary?.base || c.jobSnapshot?.salary || '';
  salary = stripTitleEcho(salary);
  // If salary still looks like a title (no $ or digits in first 20 chars), extract just the money part
  if (salary && !/[\$\d]/.test(salary.slice(0, 20))) {
    const moneyMatch = salary.match(/\$[\d,]+[KkMm]?(?:\s*[-–]\s*\$[\d,]+[KkMm]?)?/);
    salary = moneyMatch ? moneyMatch[0] : '';
  }
  const arr = c.jobSnapshot?.workArrangement || c.jobMatch?.workArrangement || '';
  const meta = [salary, arr].filter(Boolean).join(' \u00b7 ');

  // Action buttons — ONLY in the scoring queue (initial stage)
  const currentStage = c.jobStage || 'needs_review';
  const inQueue = currentStage === QUEUE_STAGE;
  const showActions = inQueue && score != null;
  const actionsHtml = showActions ? `
    <div class="compact-actions">
      <button class="compact-apply-btn" data-id="${c.id}">Interested</button>
      <button class="compact-dismiss-btn" data-id="${c.id}">Dismiss</button>
    </div>` : '';

  // Favicon
  const favDomain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const favHtml = favDomain
    ? `<img class="compact-favicon" src="https://www.google.com/s2/favicons?domain=${favDomain}&sz=32" alt="" onerror="this.style.display='none'">`
    : '';

  // Tags
  const tagsHtml = (c.tags || []).length
    ? `<div class="compact-tags">${(c.tags || []).map(t => {
        const cl = tagColor(t);
        return `<span class="compact-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}">${escHtmlGlobal(t)}</span>`;
      }).join('')}</div>`
    : '';

  return `
    <div class="compact-card score-${tier}${stateClass}" data-id="${c.id}" draggable="true">
      <div class="compact-card-score">${scoreHtml}</div>
      <div class="compact-card-body">
        <div class="compact-company-row">${favHtml}<span class="compact-company">${escHtmlGlobal(c.company)}${c.dataConflict ? ' <span title="Intel may be inaccurate" style="color:#d97706">\u26a0</span>' : ''}</span></div>
        ${c.jobUrl ? `<a class="compact-title" href="${escHtmlGlobal(c.jobUrl)}" target="_blank" title="Open job posting">${escHtmlGlobal(c.jobTitle || '')}</a>` : `<div class="compact-title">${escHtmlGlobal(c.jobTitle || '')}</div>`}
        ${(() => {
          // Filter meta: remove job title echo from salary/arrangement line
          if (meta && c.jobTitle && meta.toLowerCase().startsWith(c.jobTitle.toLowerCase())) return '';
          return meta ? `<div class="compact-meta">${escHtmlGlobal(meta)}</div>` : '';
        })()}
        ${(c.jobMatch?.verdict || c.quickFitReason) && score != null ? (() => {
          let reason = c.jobMatch?.verdict || c.quickFitReason;
          if (c.jobTitle) {
            reason = stripTitleEcho(reason);
            // Also strip if the remaining text still closely matches the title
            if (reason) {
              const sim = reason.toLowerCase().replace(/[^a-z0-9]/g, '');
              const titleSim = c.jobTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (sim === titleSim || titleSim.startsWith(sim) || sim.startsWith(titleSim)) reason = '';
            }
            if (reason && reason.length < 10 && !/[a-z]{3,}/i.test(reason)) reason = '';
          }
          return reason ? `<div class="compact-meta" style="font-style:italic">${escHtmlGlobal(reason)}</div>` : '';
        })() : ''}
        ${isScoring ? '<div class="compact-meta">Scoring...</div>' : ''}
        ${inQueue ? (() => {
          const quickTake = c.jobMatch?.quickTake || c.quickTake || [];
          return quickTake.length ? `<div class="quick-take">${quickTake.slice(0, 2).map(qt =>
            `<div class="qt-bullet qt-${qt.type}">${qt.type === 'green' ? '\u{1F7E2}' : '\u{1F534}'} ${escHtmlGlobal(qt.text)}</div>`
          ).join('')}</div>` : '';
        })() : ''}
        ${tagsHtml}
        ${actionsHtml}
      </div>
    </div>`;
}

// ── Score Preview Modal ──────────────────────────────────────────────────────

function openScoreModal(entry) {
  const overlay = document.getElementById('score-modal-overlay');
  const content = document.getElementById('score-modal-content');
  if (!overlay || !content) return;

  const score = entry.jobMatch?.score ?? entry.quickFitScore ?? null;
  const tier = score != null ? (score >= SCORE_THRESHOLDS.green ? 'green' : score >= SCORE_THRESHOLDS.amber ? 'amber' : 'red') : '';
  const jm = entry.jobMatch || {};

  // Salary
  const salary = entry.baseSalaryRange || entry.oteTotalComp || jm.salary?.base || entry.jobSnapshot?.salary || '';
  const arrangement = entry.jobSnapshot?.workArrangement || jm.workArrangement || '';
  const meta = [salary, arrangement].filter(Boolean).join(' \u00b7 ');

  // Hard DQ — only show if score is genuinely low (3 or below) to avoid false positives
  const hardDQ = jm.hardDQ || entry.hardDQ;
  const dqHtml = hardDQ?.flagged && score != null && score <= 3
    ? `<div class="score-modal-dq">\u{1F6AB} Hard Disqualifier${hardDQ.reasons?.length ? ': ' + hardDQ.reasons.join('; ') : ''}</div>`
    : '';

  // Flags — side by side with gradient colors. Normalize legacy strings
  const _normFlag = f => typeof f === 'string' ? { text: f, source: null, evidence: null } : { text: f?.text || '', source: f?.source || null, evidence: f?.evidence || null };
  const _flagSrcLabel = s => ({ job_posting: 'From job posting', company_data: 'From company research', preferences: 'From your preferences', candidate_profile: 'From your profile', dealbreaker_keyword: 'From your dealbreaker keywords' }[s] || (s ? `Source: ${s}` : 'No source linked'));
  const _flagSrcIcon = s => ({ job_posting: '📄', company_data: '🏢', preferences: '⚙', candidate_profile: '👤', dealbreaker_keyword: '⛔' }[s] || 'ⓘ');
  const _flagTip = f => (_flagSrcLabel(f.source) + (f.evidence ? ` — "${f.evidence}"` : ' — no evidence quoted')).replace(/"/g, '&quot;');
  const strongFits = (jm.strongFits || []).map(_normFlag).filter(f => f.text);
  const redFlags = (jm.redFlags || jm.watchOuts || []).map(_normFlag).filter(f => f.text);
  const greenShades = ['#15803d','#16a34a','#22c55e','#4ade80','#86efac','#bbf7d0'];
  const redShades = ['#991b1b','#dc2626','#ef4444','#f87171','#fca5a5','#fecaca'];
  const dismissedFlags = jm.dismissedFlags || [];
  const greenCol = strongFits.length ? `<div class="score-modal-flag-col green">
    <div class="score-modal-flag-heading green">Green Flags</div>
    ${strongFits.map((f, i) => {
      const isDismissed = dismissedFlags.includes(f.text);
      const dimOpacity = isDismissed ? 'opacity:0.35;' : '';
      const strikeStyle = isDismissed ? ' style="text-decoration:line-through"' : '';
      const tip = _flagTip(f);
      return `<div class="score-modal-flag" style="${dimOpacity}"><span class="score-modal-flag-icon" style="color:${greenShades[Math.min(i, greenShades.length - 1)]}">&#x2714;</span><span${strikeStyle}>${escHtmlGlobal(f.text)}</span><span title="${tip}" style="opacity:0.55;font-size:10px;margin-left:4px;cursor:help;">${_flagSrcIcon(f.source)}</span><button class="flag-dismiss-btn" data-flag="${escHtmlGlobal(f.text)}" data-entry-id="${entry.id}" data-flag-type="green" title="${isDismissed ? 'Restore flag' : 'Dismiss — this is wrong'}" style="background:none;border:none;color:#c4c0bc;cursor:pointer;font-size:13px;padding:0 2px;margin-left:4px;flex-shrink:0;">${isDismissed ? '↩' : '×'}</button></div>`;
    }).join('')}
  </div>` : '';
  const redCol = redFlags.length ? `<div class="score-modal-flag-col red">
    <div class="score-modal-flag-heading red">Red Flags</div>
    ${redFlags.map((f, i) => {
      const isDismissed = dismissedFlags.includes(f.text);
      const dimOpacity = isDismissed ? 'opacity:0.35;' : '';
      const strikeStyle = isDismissed ? ' style="text-decoration:line-through"' : '';
      const tip = _flagTip(f);
      return `<div class="score-modal-flag" style="${dimOpacity}" data-flag-text="${escHtmlGlobal(f.text)}"><span class="score-modal-flag-icon" style="color:${redShades[Math.min(i, redShades.length - 1)]}">&#x25CF;</span><span${strikeStyle}>${escHtmlGlobal(f.text)}</span><span title="${tip}" style="opacity:0.55;font-size:10px;margin-left:4px;cursor:help;">${_flagSrcIcon(f.source)}</span><button class="flag-dismiss-btn" data-flag="${escHtmlGlobal(f.text)}" data-entry-id="${entry.id}" data-flag-type="red" title="${isDismissed ? 'Restore flag' : 'Dismiss — this is wrong'}" style="background:none;border:none;color:#c4c0bc;cursor:pointer;font-size:13px;padding:0 2px;margin-left:4px;flex-shrink:0;">${isDismissed ? '↩' : '×'}</button></div>`;
    }).join('')}
  </div>` : '';
  const flagsHtml = (greenCol || redCol) ? `${greenCol}${redCol}` : '';

  // Tags
  const tagsHtml = (entry.tags || []).map(t => {
    const cl = tagColor(t);
    return `<span class="score-modal-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}">${escHtmlGlobal(t)}</span>`;
  }).join('');

  // Favicon
  const favDomain = entry.companyWebsite ? entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const favHtml = favDomain ? `<img src="https://www.google.com/s2/favicons?domain=${favDomain}&sz=32" style="width:20px;height:20px;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : '';

  // Job summary + role brief
  const summary = jm.jobSummary || jm.roleBrief?.roleSummary || jm.verdict || '';
  const rb = jm.roleBrief || {};

  content.innerHTML = `
    <div class="score-modal-header">
      <div class="score-modal-score ${tier}">
        <div class="score-modal-score-num" style="color:${tier === 'green' ? '#0F6E56' : tier === 'amber' ? '#854F0B' : '#A32D2D'}">${score}</div>
        <div class="score-modal-score-den">/10</div>
      </div>
      <div>
        <a class="score-modal-company" href="${chrome.runtime.getURL('company.html')}?id=${entry.id}" target="_blank" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit">${favHtml} ${escHtmlGlobal(entry.company)}</a>
        <div class="score-modal-title">${entry.jobUrl ? `<a href="${escHtmlGlobal(entry.jobUrl)}" target="_blank">${escHtmlGlobal(entry.jobTitle || '')}</a>` : escHtmlGlobal(entry.jobTitle || '')}</div>
        ${meta ? `<div class="score-modal-meta">${escHtmlGlobal(meta)}</div>` : ''}
        ${jm.lastUpdatedAt ? `<div style="font-size:10px;color:#9CA0A6;margin-top:4px;">Scored ${(() => {
          const mins = Math.floor((Date.now() - jm.lastUpdatedAt) / 60000);
          if (mins < 1) return 'just now';
          if (mins < 60) return mins + 'm ago';
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm ago';
          const days = Math.floor(hrs / 24);
          if (days === 1) return 'yesterday';
          if (days < 7) return days + 'd ago';
          return new Date(jm.lastUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        })()}${jm.lastUpdatedBy ? ' · ' + jm.lastUpdatedBy.replace(/_/g, ' ') : ''}</div>` : ''}
      </div>
    </div>
    ${(() => {
      const linkStyle = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;text-decoration:none;padding:3px 10px;border-radius:14px;transition:all 0.12s;';
      const links = [];
      if (entry.companyWebsite) {
        const domain = entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        links.push(`<a href="${escHtmlGlobal(entry.companyWebsite)}" target="_blank" style="${linkStyle}color:#516f90;background:rgba(81,111,144,0.08);border:1px solid rgba(81,111,144,0.15);">↗ ${escHtmlGlobal(domain)}</a>`);
      }
      if (entry.companyLinkedin) links.push(`<a href="${escHtmlGlobal(entry.companyLinkedin)}" target="_blank" style="${linkStyle}color:#0a66c2;background:rgba(10,102,194,0.06);border:1px solid rgba(10,102,194,0.15);">in LinkedIn</a>`);
      const reviews = entry.reviews || entry.intelligence?.reviews || [];
      if (reviews.length) {
        const glassdoor = reviews.find(r => /glassdoor/i.test(r.source || r.url || ''));
        if (glassdoor?.url) links.push(`<a href="${escHtmlGlobal(glassdoor.url)}" target="_blank" style="${linkStyle}color:#0caa41;background:rgba(12,170,65,0.06);border:1px solid rgba(12,170,65,0.15);">★ Glassdoor</a>`);
        reviews.filter(r => r.url && !/glassdoor/i.test(r.source || r.url || '')).slice(0, 2).forEach(r => {
          const name = (r.source || 'Review').replace(/https?:\/\/(www\.)?/, '').split('/')[0];
          links.push(`<a href="${escHtmlGlobal(r.url)}" target="_blank" style="${linkStyle}color:#6B6560;background:rgba(107,101,96,0.06);border:1px solid rgba(107,101,96,0.12);">★ ${escHtmlGlobal(name)}</a>`);
        });
      }
      const industry = entry.industry || entry.intelligence?.industry || '';
      const eli5 = entry.intelligence?.eli5 || entry.intelligence?.whatItDoes || '';
      const hasContext = links.length || industry || eli5;
      if (!hasContext) return '';
      return `<div style="padding:0 20px 8px;border-bottom:1px solid #f0eeeb;margin-bottom:4px;">
        ${links.length ? `<div style="display:flex;gap:12px;align-items:center;margin-bottom:${industry || eli5 ? '6' : '0'}px;">${links.join('')}</div>` : ''}
        ${industry ? `<div style="font-size:11px;font-weight:600;color:#A09A94;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">${escHtmlGlobal(industry)}</div>` : ''}
        ${eli5 ? `<div style="font-size:12px;color:#6B6560;line-height:1.5;">${escHtmlGlobal(eli5)}</div>` : ''}
      </div>`;
    })()}
    <div class="score-modal-body">
      ${(() => {
        // Pipeline context — only when entry is in the active pipeline (past triage)
        const stage = entry.jobStage || 'needs_review';
        const triageStages = ['needs_review', 'want_to_apply'];
        if (triageStages.includes(stage)) return '';
        const nextStep = entry.nextStep || '';
        const nextDate = entry.nextStepDate || '';
        const notes    = entry.notes || '';
        const act      = (typeof computeLastActivity === 'function') ? computeLastActivity(entry) : null;
        const actStr   = act?.label ? `${new Date(act.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric'})} · ${act.label}` : '';
        const fmtDate  = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : '';
        if (!nextStep && !nextDate && !notes && !actStr) return '';
        const stageDef = customOpportunityStages.find(s => s.key === stage);
        const stageColorVal = stageDef?.color || '#FF7A59';
        const stageLabel = stageDef?.label || stage;
        const row = (label, value, valueColor) => value ? `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;font-size:12px;">
            <span style="color:#A09A94;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;font-size:10px;min-width:88px;padding-top:2px;flex-shrink:0;">${label}</span>
            <span style="color:${valueColor || '#33475b'};line-height:1.5;flex:1;word-wrap:break-word;">${value}</span>
          </div>` : '';
        return `<div style="margin-bottom:14px;padding:12px 14px;background:#fafaf8;border:1px solid #ECE7E1;border-radius:10px;border-left:3px solid ${stageColorVal};">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${stageColorVal};"></span>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${stageColorVal};">${escHtmlGlobal(stageLabel)}</span>
          </div>
          ${row('Next step', nextStep ? escHtmlGlobal(nextStep) : '')}
          ${row('Step date', fmtDate(nextDate))}
          ${row('Last activity', actStr ? escHtmlGlobal(actStr) : '')}
          ${row('Notes', notes ? escHtmlGlobal(notes).replace(/\n/g, '<br>') : '', '#6B6560')}
        </div>`;
      })()}
      ${dqHtml}
      ${summary ? `<div class="score-modal-verdict">${escHtmlGlobal(summary)}</div>` : ''}
      ${flagsHtml ? `<div class="score-modal-flags">${flagsHtml}</div>` : ''}
      ${rb.whyInteresting ? `<div style="font-size:13px;color:#33475b;line-height:1.55;margin-bottom:10px;"><strong style="color:#1D9E75;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Why interesting</strong><br>${escHtmlGlobal(rb.whyInteresting)}</div>` : ''}
      ${rb.concerns ? `<div style="font-size:13px;color:#33475b;line-height:1.55;margin-bottom:10px;"><strong style="color:#854F0B;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Open questions</strong><br>${escHtmlGlobal(rb.concerns)}</div>` : ''}
      ${rb.qualificationMatch ? `<div style="font-size:13px;color:#33475b;line-height:1.55;margin-bottom:10px;"><strong style="color:#516f90;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Qualification match ${rb.qualificationScore ? `(${rb.qualificationScore}/10)` : ''}</strong><br>${escHtmlGlobal(rb.qualificationMatch)}</div>` : ''}
      ${rb.compSummary ? `<div style="font-size:12px;color:#516f90;margin-bottom:10px;">Comp: ${escHtmlGlobal(rb.compSummary)}</div>` : ''}
      ${tagsHtml ? `<div class="score-modal-tags">${tagsHtml}</div>` : ''}
      <div style="display:flex;gap:8px;">
        <a class="score-modal-details-btn" href="${chrome.runtime.getURL('company.html')}?id=${entry.id}" target="_blank" style="flex:1">See full breakdown</a>
        ${entry.jobUrl ? `<a class="score-modal-posting-btn" href="${escHtmlGlobal(entry.jobUrl)}" target="_blank" style="flex:1">View posting</a>` : ''}
      </div>
      <button class="score-modal-rescore" id="score-modal-rescore-btn">Re-score with latest criteria</button>
      ${entry.jobMatchScoredAt ? `<div style="text-align:center;font-size:11px;color:#A09A94;margin-top:4px;">Scored ${new Date(entry.jobMatchScoredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>` : ''}
    </div>
    <div class="score-modal-actions">
      <button class="score-modal-dismiss" id="score-modal-dismiss-btn">Pass</button>
      <button class="score-modal-apply" id="score-modal-apply-btn"${(entry.jobStage || 'needs_review') === 'want_to_apply' ? ' style="background:#1D9E75"' : ''}>${(entry.jobStage || 'needs_review') === 'want_to_apply' ? 'I Applied' : 'Interested'}</button>
    </div>
  `;

  overlay.classList.add('open');

  // Action handlers
  document.getElementById('score-modal-apply-btn').addEventListener('click', () => {
    overlay.classList.remove('open');
    // Trigger the same logic as the compact card Apply button
    const btn = document.querySelector(`.compact-apply-btn[data-id="${entry.id}"]`);
    if (btn) btn.click();
  });
  document.getElementById('score-modal-dismiss-btn').addEventListener('click', () => {
    overlay.classList.remove('open');
    const btn = document.querySelector(`.compact-dismiss-btn[data-id="${entry.id}"]`);
    if (btn) btn.click();
  });

  // Flag dismiss buttons — with optional reason
  document.querySelectorAll('.flag-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const flagText = btn.dataset.flag;
      const entryId = btn.dataset.entryId;
      const flagType = btn.dataset.flagType || 'red'; // 'red' or 'green'
      if (!flagText || !entryId) return;

      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const companies = savedCompanies || [];
        const idx = companies.findIndex(c => c.id === entryId);
        if (idx === -1) return;
        const jm = companies[idx].jobMatch || {};
        const dismissed = jm.dismissedFlags || [];
        const dismissedWithReasons = jm.dismissedFlagsWithReasons || [];
        const alreadyDismissed = dismissed.includes(flagText);

        if (alreadyDismissed) {
          // Restore — simple toggle back
          jm.dismissedFlags = dismissed.filter(f => f !== flagText);
          jm.dismissedFlagsWithReasons = dismissedWithReasons.filter(f => f.flag !== flagText);
          companies[idx].jobMatch = jm;
          chrome.storage.local.set({ savedCompanies: companies }, () => {
            const flagEl = btn.closest('.score-modal-flag');
            if (flagEl) {
              flagEl.style.opacity = '';
              const textSpan = flagEl.querySelector('span:nth-child(2)');
              if (textSpan) textSpan.style.textDecoration = '';
            }
            btn.textContent = '×'; btn.title = 'Dismiss — this is wrong';
            // Remove reason input if present
            const reasonRow = flagEl?.querySelector('.flag-reason-row');
            if (reasonRow) reasonRow.remove();
            const memEntry = allCompanies.find(c => c.id === entryId);
            if (memEntry?.jobMatch) {
              memEntry.jobMatch.dismissedFlags = jm.dismissedFlags;
              memEntry.jobMatch.dismissedFlagsWithReasons = jm.dismissedFlagsWithReasons;
            }
          });
        } else {
          // Dismiss — show reason input
          const flagEl = btn.closest('.score-modal-flag');
          if (flagEl) {
            flagEl.style.opacity = '0.35';
            // Apply strikethrough only to the text span, not the whole flag (so reason input isn't struck)
            const textSpan = flagEl.querySelector('span:nth-child(2)');
            if (textSpan) textSpan.style.textDecoration = 'line-through';
            btn.textContent = '↩'; btn.title = 'Restore flag';
            // Add reason input row if not already present
            if (!flagEl.querySelector('.flag-reason-row')) {
              const row = document.createElement('div');
              row.className = 'flag-reason-row';
              row.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px;opacity:1;text-decoration:none;padding:10px 12px;background:#fff;border:1px solid #E0DDD8;border-radius:8px;';
              row.innerHTML = `<div style="font-size:11px;font-weight:600;color:#6B6F76;">Tell Coop why this is wrong — he'll learn from it</div>
                <textarea class="flag-reason-input" placeholder="e.g., This role is actually remote. Comp is disclosed in the posting." style="width:100%;font-size:12px;padding:8px 10px;border:1px solid #E0DDD8;border-radius:6px;font-family:inherit;background:#FAF9F8;color:#1A1A1A;outline:none;resize:vertical;min-height:50px;line-height:1.5;"></textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                  <button class="flag-reason-skip" style="font-size:11px;padding:5px 12px;border:1px solid #E0DDD8;border-radius:6px;background:#fff;color:#6B6F76;cursor:pointer;font-family:inherit;font-weight:600;">Skip</button>
                  <button class="flag-reason-save" style="font-size:11px;padding:5px 14px;border:none;border-radius:6px;background:#FC636B;color:#fff;cursor:pointer;font-family:inherit;font-weight:600;">Save Feedback</button>
                </div>`;
              flagEl.appendChild(row);
              const textarea = row.querySelector('.flag-reason-input');
              textarea.focus();
              // Save on click or Enter
              const saveFn = () => {
                const reason = textarea.value.trim();
                jm.dismissedFlags = [...dismissed, flagText];
                jm.dismissedFlagsWithReasons = [...dismissedWithReasons, { flag: flagText, reason: reason || null, type: flagType, date: new Date().toISOString().slice(0, 10) }];
                companies[idx].jobMatch = jm;
                chrome.storage.local.set({ savedCompanies: companies });
                const memEntry = allCompanies.find(c => c.id === entryId);
                if (memEntry?.jobMatch) {
                  memEntry.jobMatch.dismissedFlags = jm.dismissedFlags;
                  memEntry.jobMatch.dismissedFlagsWithReasons = jm.dismissedFlagsWithReasons;
                }
                // Save reason as a Coop learned insight for future scoring
                if (reason) {
                  chrome.storage.local.get(['storyTime'], d => {
                    const st = d.storyTime || {};
                    st.learnedInsights = st.learnedInsights || [];
                    st.learnedInsights.push({
                      source: companies[idx].company || 'scoring-feedback',
                      date: new Date().toISOString().slice(0, 10),
                      insight: `Dismissed ${flagType} flag "${flagText}" — reason: ${reason}`,
                      category: 'scoring_feedback',
                      priority: 'high',
                    });
                    st.learnedInsights = st.learnedInsights.slice(-100);
                    chrome.storage.local.set({ storyTime: st });
                  });
                }
                row.innerHTML = `<span style="font-size:11px;color:#8B8680;">✓ ${reason ? 'Feedback saved — Coop will remember this' : 'Dismissed'}</span>`;
                setTimeout(() => row.remove(), 2000);
              };
              row.querySelector('.flag-reason-save').addEventListener('click', saveFn);
              row.querySelector('.flag-reason-skip')?.addEventListener('click', () => { saveFn(); });
              textarea.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveFn(); } });
            }
          }
        }
      });
    });
  });

  // Re-score button
  document.getElementById('score-modal-rescore-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('score-modal-rescore-btn');
    // Re-read entry from allCompanies in case it was updated
    const freshEntry = allCompanies.find(c => c.id === entry.id) || entry;

    if (!freshEntry.jobDescription) {
      if (freshEntry.jobUrl) {
        btn.textContent = 'Opening posting to grab description...';
        btn.style.color = '#A09A94';
        btn.disabled = true;
        // Open the posting so the content script captures the job description
        window.open(freshEntry.jobUrl, '_blank');
        // Poll for the job description to appear in storage (content script will save it)
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          chrome.storage.local.get(['savedCompanies'], data => {
            const updated = (data.savedCompanies || []).find(c => c.id === freshEntry.id);
            if (updated?.jobDescription) {
              clearInterval(poll);
              // Update in-memory data
              const idx = allCompanies.findIndex(c => c.id === freshEntry.id);
              if (idx !== -1) allCompanies[idx] = updated;
              btn.textContent = 'Re-score with latest criteria';
              btn.style.color = '';
              btn.disabled = false;
              // Auto-trigger re-score
              btn.click();
            } else if (attempts > 20) {
              clearInterval(poll);
              btn.textContent = 'Visit the posting, then try again';
              btn.style.color = '#A09A94';
              btn.disabled = false;
              setTimeout(() => { btn.textContent = 'Re-score with latest criteria'; btn.style.color = ''; }, 4000);
            }
          });
        }, 2000);
      } else {
        btn.textContent = 'No job posting URL — can\'t re-score';
        btn.style.color = '#A09A94';
        setTimeout(() => { btn.textContent = 'Re-score with latest criteria'; btn.style.color = ''; }, 3000);
      }
      return;
    }

    btn.textContent = 'Re-scoring...';
    btn.disabled = true;
    console.log('[Scorecard] Re-scoring', freshEntry.company, freshEntry.jobTitle);

    chrome.storage.sync.get(['prefs'], ({ prefs }) => {
      if (!prefs || (!prefs.jobMatchEnabled && !prefs.roles && !prefs.workArrangement?.length)) {
        btn.textContent = 'Set up job preferences in Career OS first';
        btn.style.color = '#A09A94';
        btn.disabled = false;
        return;
      }
      chrome.storage.local.get(['storyTime', 'profileStory', 'profileExperience', 'profileSkills', 'profileRoleICP', 'profileCompanyICP', 'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags'], (localData) => {
        const roleICP = localData.profileRoleICP || {};
        const companyICP = localData.profileCompanyICP || {};
        const attractedTo = localData.profileAttractedTo || [];
        const dealbreakers = localData.profileDealbreakers || [];
        let candidateProfile = '';
        const _aj = v => Array.isArray(v) ? v.join(', ') : (v || '');
        if (roleICP.text || _aj(roleICP.targetFunction)) candidateProfile += `\nRole ICP: ${roleICP.text || ''} ${[_aj(roleICP.targetFunction), roleICP.seniority, roleICP.scope, roleICP.sellingMotion].filter(Boolean).join(' | ')}`;
        if (companyICP.text || _aj(companyICP.stage)) candidateProfile += `\nCompany ICP: ${companyICP.text || ''} ${[_aj(companyICP.stage), _aj(companyICP.sizeRange), _aj(companyICP.industryPreferences)].filter(Boolean).join(' | ')}`;
        if (attractedTo.length) candidateProfile += `\nGreen flags: ${attractedTo.map(e => e.text).join('; ')}`;
        if (dealbreakers.length) candidateProfile += `\nRed flags/dealbreakers: ${dealbreakers.map(e => `${e.text} (${e.severity})`).join('; ')}`;
        if (localData.profileSkillTags?.length) candidateProfile += `\nSkill tags: ${localData.profileSkillTags.join(', ')}`;
        const richContext = {
          intelligence: freshEntry.intelligence?.eli5 || freshEntry.oneLiner || null,
          reviews: freshEntry.reviews || [],
          notes: freshEntry.notes || null,
          knownComp: freshEntry.baseSalaryRange || freshEntry.oteTotalComp ? `Known comp: ${freshEntry.baseSalaryRange ? 'Base ' + freshEntry.baseSalaryRange : ''} ${freshEntry.oteTotalComp ? 'OTE ' + freshEntry.oteTotalComp : ''}`.trim() : null,
          candidateProfile,
        };
        chrome.runtime.sendMessage(
          { type: 'ANALYZE_JOB', company: freshEntry.company, jobTitle: freshEntry.jobTitle, jobDescription: freshEntry.jobDescription, prefs, richContext },
          result => {
            void chrome.runtime.lastError;
            console.log('[Scorecard] Re-score result:', result);
            if (result?.jobMatch) {
              const idx = allCompanies.findIndex(x => x.id === freshEntry.id);
              if (idx !== -1) {
                allCompanies[idx].jobMatch = result.jobMatch;
                allCompanies[idx].jobMatchScoredAt = Date.now();
                if (result.jobSnapshot) allCompanies[idx].jobSnapshot = result.jobSnapshot;
                chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
                  render();
                  overlay.classList.remove('open');
                  setTimeout(() => openScoreModal(allCompanies[idx]), 150);
                });
              }
            } else {
              console.warn('[Scorecard] Re-score failed:', result);
              btn.textContent = 'Re-score failed — check console';
              btn.disabled = false;
            }
          }
        );
      });
    });
  });

  // ── Swipe gesture ──
  initSwipeGesture(entry);
}

function initSwipeGesture(entry) {
  const overlay = document.getElementById('score-modal-overlay');
  const modal = document.getElementById('score-modal');
  const passLabel = document.getElementById('swipe-pass');
  const applyLabel = document.getElementById('swipe-apply');
  if (!modal) return;
  // Set swipe label based on current stage
  const curStage = entry.jobStage || 'needs_review';
  if (applyLabel) applyLabel.textContent = curStage === 'want_to_apply' ? 'I APPLIED' : 'INTERESTED';

  const THRESHOLD = 120; // px to trigger action
  let startX = 0, currentX = 0, dragging = false;

  function onStart(x) {
    dragging = true;
    startX = x;
    currentX = 0;
    modal.classList.add('swiping');
    modal.classList.remove('snapping');
  }

  function onMove(x) {
    if (!dragging) return;
    currentX = x - startX;
    const rotation = currentX * 0.04; // subtle tilt
    const clampedRotation = Math.max(-8, Math.min(8, rotation));
    modal.style.transform = `translateX(${currentX}px) rotate(${clampedRotation}deg)`;

    // Show indicators based on direction
    const progress = Math.min(Math.abs(currentX) / THRESHOLD, 1);
    if (currentX < -30) {
      passLabel.style.opacity = progress;
      applyLabel.style.opacity = 0;
    } else if (currentX > 30) {
      applyLabel.style.opacity = progress;
      passLabel.style.opacity = 0;
    } else {
      passLabel.style.opacity = 0;
      applyLabel.style.opacity = 0;
    }
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    modal.classList.remove('swiping');

    if (currentX < -THRESHOLD) {
      // Swipe left → Pass
      modal.classList.add('snapping');
      modal.style.transform = 'translateX(-150%) rotate(-15deg)';
      modal.style.opacity = '0';
      setTimeout(() => {
        resetModal();
        overlay.classList.remove('open');
        const btn = document.querySelector(`.compact-dismiss-btn[data-id="${entry.id}"]`);
        if (btn) btn.click();
      }, 300);
    } else if (currentX > THRESHOLD) {
      // Swipe right → Apply
      modal.classList.add('snapping');
      modal.style.transform = 'translateX(150%) rotate(15deg)';
      modal.style.opacity = '0';
      setTimeout(() => {
        resetModal();
        overlay.classList.remove('open');
        const btn = document.querySelector(`.compact-apply-btn[data-id="${entry.id}"]`);
        if (btn) btn.click();
      }, 300);
    } else {
      // Snap back
      modal.classList.add('snapping');
      modal.style.transform = '';
      passLabel.style.opacity = 0;
      applyLabel.style.opacity = 0;
    }
  }

  function resetModal() {
    modal.classList.remove('snapping', 'swiping');
    modal.style.transform = '';
    modal.style.opacity = '';
    passLabel.style.opacity = 0;
    applyLabel.style.opacity = 0;
  }

  // Mouse events
  modal.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, a, input')) return;
    e.preventDefault();
    onStart(e.clientX);
  });
  document.addEventListener('mousemove', (e) => { if (dragging) { e.preventDefault(); onMove(e.clientX); } });
  document.addEventListener('mouseup', () => onEnd());

  // Touch events
  modal.addEventListener('touchstart', (e) => {
    if (e.target.closest('button, a, input')) return;
    onStart(e.touches[0].clientX);
  }, { passive: true });
  modal.addEventListener('touchmove', (e) => { if (dragging) onMove(e.touches[0].clientX); }, { passive: true });
  modal.addEventListener('touchend', () => onEnd());

  // Reset on open
  resetModal();
}

// Close modal handlers
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('score-modal-overlay');
  if (!overlay) return;
  document.getElementById('score-modal-close')?.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('open'); });
});

function scoreToVerdict(score) {
  if (score >= 8) return { label: 'Strong Match', cls: 'high' };
  if (score >= 6) return { label: 'Good Match', cls: 'mid' };
  if (score >= 4) return { label: 'Mixed Signals', cls: 'mixed' };
  return { label: 'Likely Not a Fit', cls: 'low' };
}

// Excitement Score modifier: user's gut feeling adjusts the AI score slightly
function applyExcitementModifier(baseScore, rating) {
  if (!baseScore || !rating || rating === 3) return { final: baseScore, mod: 0 };
  const mod = { 1: -1, 2: -0.5, 4: 0.5, 5: 1 }[rating] || 0;
  const final = Math.max(1, Math.min(10, Math.round((baseScore + mod) * 10) / 10));
  return { final, mod };
}

// Tag color palette
const TAG_PALETTE = [
  { border: '#6366f1', color: '#4338ca', bg: 'rgba(99,102,241,0.15)' },   // Indigo
  { border: '#10b981', color: '#047857', bg: 'rgba(16,185,129,0.15)' },   // Emerald
  { border: '#f97316', color: '#c2410c', bg: 'rgba(249,115,22,0.15)' },   // Orange
  { border: '#ec4899', color: '#be185d', bg: 'rgba(236,72,153,0.15)' },   // Pink
  { border: '#0ea5e9', color: '#0369a1', bg: 'rgba(14,165,233,0.15)' },   // Sky
  { border: '#a855f7', color: '#7e22ce', bg: 'rgba(168,85,247,0.15)' },   // Purple
  { border: '#22c55e', color: '#15803d', bg: 'rgba(34,197,94,0.15)' },    // Green
  { border: '#eab308', color: '#a16207', bg: 'rgba(234,179,8,0.15)' },    // Yellow
  { border: '#ef4444', color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },    // Red
  { border: '#14b8a6', color: '#0f766e', bg: 'rgba(20,184,166,0.15)' },   // Teal
];
let customTagColors = {}; // { tagName: paletteIndex }

const SEMANTIC_TAG_COLORS = {
  'application rejected': 8, 'rejected': 8, "didn't apply": 8,
  'job posted': 2, 'linkedin easy apply': 4,
  'vc-backed': 1, 'bootstrapped': 6, 'founding team': 5,
  'co-founding interest': 5, 'intro request': 0, 'intro requested': 0,
  'referral': 9, 'referral agreement': 9, 'recruiter': 3,
  '***action required***': 8,
};

function tagColorIndex(tag) {
  const semantic = SEMANTIC_TAG_COLORS[tag.toLowerCase()];
  if (semantic !== undefined) return semantic;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  return Math.abs(hash) % TAG_PALETTE.length;
}
function tagColor(tag) {
  const idx = (customTagColors[tag] !== undefined) ? customTagColors[tag] : tagColorIndex(tag);
  return TAG_PALETTE[idx % TAG_PALETTE.length];
}
function saveTagColor(tag, idx) {
  customTagColors[tag] = idx;
  chrome.storage.local.set({ tagColors: customTagColors }, () => { updateTagsToolbar(); render(); });
}
function saveStageColor(stageKey, colorHex) {
  let stage = customOpportunityStages.find(s => s.key === stageKey);
  if (stage) {
    stage.color = colorHex;
    chrome.storage.local.set({ opportunityStages: customOpportunityStages }, () => {
      updateStageDynamicCSS(); updateStatusToolbar(); render();
    });
    return;
  }
  stage = customCompanyStages.find(s => s.key === stageKey);
  if (stage) {
    stage.color = colorHex;
    chrome.storage.local.set({ companyStages: customCompanyStages }, () => {
      updateStageDynamicCSS(); updateStatusToolbar(); render();
    });
  }
}

// ── Inline color picker popover ──────────────────────────────────────────────
function showColorPicker(anchorEl, palette, currentIdx, onSelect) {
  const popover = document.getElementById('color-picker-popover');
  popover.innerHTML = palette.map((c, i) =>
    `<button class="cp-swatch${i === currentIdx ? ' active' : ''}" data-i="${i}" style="background:${c}"></button>`
  ).join('');
  popover.querySelectorAll('.cp-swatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(parseInt(btn.dataset.i));
      popover.style.display = 'none';
    });
  });
  popover.style.display = 'flex';
  // Position below anchor, adjusted to stay in viewport
  requestAnimationFrame(() => {
    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + 6, left = rect.left;
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
    popover.style.top = Math.max(8, top) + 'px';
    popover.style.left = Math.max(8, left) + 'px';
  });
}
document.addEventListener('click', () => {
  const p = document.getElementById('color-picker-popover');
  if (p) p.style.display = 'none';
});

function load() {
  // Load user prefs for work arrangement mismatch detection
  chrome.storage.sync.get(['prefs'], ({ prefs }) => {
    _userWorkArrangement = (prefs?.workArrangement) || [];
  });
  chrome.storage.local.get(['savedCompanies', 'allTags', 'opportunityStages', 'companyStages', 'customStages', 'tagColors', 'activityGoals', 'stageCelebrations', 'statCardConfigs', 'actionStatuses'], (data) => {
    const { savedCompanies, allTags } = data;
    // Migration: old customStages → opportunityStages
    const storedOpp = data.opportunityStages || data.customStages;
    if (storedOpp && storedOpp.length > 0) {
      // Migration: rename old "Needs Review" / "Saved — Needs Review" → "Coop's AI Scoring Queue"
      const first = storedOpp[0];
      if (first && first.key === 'needs_review' && /needs.review/i.test(first.label)) {
        first.label = "Coop\u2019s AI Scoring Queue";
        chrome.storage.local.set({ opportunityStages: storedOpp });
      }
      customOpportunityStages = storedOpp;
    }
    if (data.companyStages && data.companyStages.length > 0) customCompanyStages = data.companyStages;
    if (data.tagColors) customTagColors = data.tagColors;
    if (data.activityGoals) {
      activityGoals.daily     = { ...activityGoals.daily,     ...(data.activityGoals.daily     || {}) };
      activityGoals.weekly    = { ...activityGoals.weekly,    ...(data.activityGoals.weekly    || {}) };
      activityGoals.monthly   = { ...activityGoals.monthly,   ...(data.activityGoals.monthly   || {}) };
    }
    if (data.stageCelebrations) stageCelebrations = data.stageCelebrations;
    if (data.actionStatuses) customActionStatuses = data.actionStatuses;
    if (data.statCardConfigs?.length) statCardConfigs = data.statCardConfigs;
    updateStageDynamicCSS();
    allCompanies = (savedCompanies || []).sort((a, b) => b.savedAt - a.savedAt);

    // Migrate old per-field timestamps → generic stageTimestamps map
    let needsBackfill = false;
    allCompanies = allCompanies.map(c => {
      if (!c.isOpportunity) return c;
      const stage = c.jobStage || '';
      let st = c.stageTimestamps ? { ...c.stageTimestamps } : {};
      let migrated = false;
      // Migrate old fields
      if (c.appliedAt && !st['applied'])        { st['applied'] = c.appliedAt; migrated = true; }
      if (c.introAt && !st['intro_requested'])   { st['intro_requested'] = c.introAt; migrated = true; }
      if (c.interviewedAt && !st['conversations']) { st['conversations'] = c.interviewedAt; migrated = true; }
      // Backfill: if entry is at a stage but has no timestamp for it, stamp it
      if (stage && !st[stage]) { st[stage] = c.savedAt || Date.now(); migrated = true; }
      if (migrated) {
        needsBackfill = true;
        const { appliedAt, introAt, interviewedAt, ...rest } = c;
        return { ...rest, stageTimestamps: st };
      }
      return c;
    });
    if (needsBackfill) chrome.storage.local.set({ savedCompanies: allCompanies });

    // One-time cleanup: remove non-human and non-domain contacts from knownContacts
    if (!localStorage.getItem('ci_contactCleanupDone')) {
      const NON_HUMAN_RE = /^(noreply|no-reply|no\.reply|donotreply|alerts?|notifications?|newsletter|marketing|updates?|digest|mailer|support|info|hello|team|news|feedback|billing|admin|postmaster|webmaster|contact|sales|help|service|system|bot|automated|unsubscribe)$/i;
      const NON_HUMAN_PART_RE = /noreply|no-reply|donotreply|notification|newsletter|mailer-daemon|bounce/i;
      let cleaned = false;
      allCompanies = allCompanies.map(c => {
        if (!c.knownContacts?.length) return c;
        const domain = (c.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
        const baseDomain = domain ? domain.split('.')[0] : '';
        const filtered = c.knownContacts.filter(k => {
          const emailDomain = (k.email?.split('@')[1] || '').toLowerCase();
          const local = (k.email?.split('@')[0] || '').toLowerCase();
          // Must match company domain
          if (domain && emailDomain !== domain && (!baseDomain || emailDomain.split('.')[0] !== baseDomain)) return false;
          // Must not be a non-human address
          if (NON_HUMAN_RE.test(local) || NON_HUMAN_PART_RE.test(local)) return false;
          return true;
        });
        if (filtered.length !== c.knownContacts.length) { cleaned = true; return { ...c, knownContacts: filtered }; }
        return c;
      });
      if (cleaned) chrome.storage.local.set({ savedCompanies: allCompanies });
      localStorage.setItem('ci_contactCleanupDone', '1');
    }

    allKnownTags = allTags || [];
    // Sync any tags from saved entries that aren't in allTags yet
    const tagsFromEntries = [...new Set(allCompanies.flatMap(c => c.tags || []))];
    const merged = [...new Set([...allKnownTags, ...tagsFromEntries])];
    if (merged.length !== allKnownTags.length) {
      allKnownTags = merged;
      chrome.storage.local.set({ allTags: allKnownTags });
    }
    updatePipelineUI();
    updateStatusToolbar();
    updateTagsToolbar();
    render();
    renderActivitySection();
    updateInboxBadge();

    // Non-blocking: auto-backfill firmographic fields for entries with missing data.
    // Dedupe per session — without this, any entry whose missing fields can't be filled
    // by regex will keep re-triggering syncEntryFields → storage write → load() → infinite loop.
    if (typeof window._syncFieldsAttempted === 'undefined') window._syncFieldsAttempted = new Set();
    const isMissingField = v => !v || /^\s*(not specified|unknown|n\/a|none|—|–|-)\s*$/i.test(String(v));
    const needsSync = allCompanies.filter(c =>
      c.isOpportunity
      && (isMissingField(c.employees) || isMissingField(c.funding))
      && !window._syncFieldsAttempted.has(c.id)
    );
    if (needsSync.length) {
      needsSync.forEach(entry => {
        window._syncFieldsAttempted.add(entry.id);
        chrome.runtime.sendMessage({ type: 'SYNC_ENTRY_FIELDS', entryId: entry.id || entry.company });
      });
    }
  });
}

function updateTagsToolbar() {
  const toolbar = document.getElementById('tags-toolbar');
  const allTagsInUse = [...new Set(allCompanies.flatMap(c => c.tags || []))].sort();
  if (allTagsInUse.length === 0) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = 'flex';
  toolbar.style.alignItems = 'center';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.gap = '6px';

  toolbar.innerHTML = '';

  // Label
  const label = document.createElement('span');
  label.className = 'filter-label';
  label.textContent = 'Tags:';
  toolbar.appendChild(label);

  // Dropdown trigger
  const dropBtn = document.createElement('button');
  dropBtn.style.cssText = 'font-size:12px;font-weight:600;color:#516f90;background:#fff;border:1px solid #dfe3eb;border-radius:6px;padding:5px 12px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px;';
  dropBtn.innerHTML = `Filter tags <span style="font-size:9px;color:#99acc2">▾</span>`;
  dropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.getElementById('tag-filter-dropdown');
    if (existing) { existing.remove(); return; }

    const rect = dropBtn.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.id = 'tag-filter-dropdown';
    dd.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;min-width:220px;max-height:320px;overflow-y:auto;background:#fff;border:1px solid #dfe3eb;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.12);z-index:10001;padding:8px 0;font-family:inherit;`;

    // "All" option
    const allOpt = document.createElement('div');
    allOpt.style.cssText = `display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:600;color:${activeTag === null ? '#FF7A59' : '#2d3e50'};transition:background 0.1s;`;
    allOpt.textContent = '✓ Show all (clear filter)';
    allOpt.addEventListener('mouseenter', () => { allOpt.style.background = '#f5f3f0'; });
    allOpt.addEventListener('mouseleave', () => { allOpt.style.background = ''; });
    allOpt.addEventListener('click', () => { activeTag = null; dd.remove(); updateTagsToolbar(); render(); });
    dd.appendChild(allOpt);

    // Divider
    const hr = document.createElement('div');
    hr.style.cssText = 'height:1px;background:#eaf0f6;margin:4px 0;';
    dd.appendChild(hr);

    allTagsInUse.forEach(tag => {
      const c = tagColor(tag);
      const opt = document.createElement('div');
      opt.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 14px;cursor:pointer;transition:background 0.1s;${activeTag === tag ? 'background:rgba(255,122,89,0.06);' : ''}`;

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const dot = document.createElement('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${c.border};flex-shrink:0;`;
      const name = document.createElement('span');
      name.style.cssText = `font-size:12px;font-weight:${activeTag === tag ? '700' : '500'};color:${activeTag === tag ? '#FF7A59' : '#2d3e50'};`;
      name.textContent = tag;
      left.appendChild(dot);
      left.appendChild(name);

      const count = document.createElement('span');
      count.style.cssText = 'font-size:11px;color:#7c98b6;';
      count.textContent = allCompanies.filter(co => (co.tags || []).includes(tag)).length;

      opt.appendChild(left);
      opt.appendChild(count);
      opt.addEventListener('mouseenter', () => { opt.style.background = '#f5f3f0'; });
      opt.addEventListener('mouseleave', () => { opt.style.background = activeTag === tag ? 'rgba(255,122,89,0.06)' : ''; });
      opt.addEventListener('click', () => {
        activeTag = activeTag === tag ? null : tag;
        dd.remove();
        updateTagsToolbar();
        render();
      });
      dd.appendChild(opt);
    });

    document.body.appendChild(dd);
    const closeDd = (ev) => { if (!dd.contains(ev.target) && ev.target !== dropBtn) { dd.remove(); document.removeEventListener('click', closeDd); } };
    setTimeout(() => document.addEventListener('click', closeDd), 0);
  });
  toolbar.appendChild(dropBtn);

  // Show active tag as a pill (if one is selected)
  if (activeTag !== null) {
    const c = tagColor(activeTag);
    const pill = document.createElement('span');
    pill.style.cssText = `display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:16px;border:1px solid ${c.border};color:${c.color};background:${c.bg};cursor:pointer;`;

    const dot = document.createElement('span');
    dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${c.border};flex-shrink:0;`;
    pill.appendChild(dot);

    const txt = document.createElement('span');
    txt.textContent = activeTag;
    pill.appendChild(txt);

    const x = document.createElement('span');
    x.textContent = '✕';
    x.style.cssText = 'font-size:10px;opacity:0.7;margin-left:2px;';
    pill.appendChild(x);

    pill.addEventListener('click', () => { activeTag = null; updateTagsToolbar(); render(); });
    toolbar.appendChild(pill);
  }
}

function updateStatusToolbar() {
  const toolbar = document.getElementById('status-toolbar');
  if (activePipeline === 'all') { toolbar.style.display = 'none'; return; }
  const statuses = stageMap();

  const currentStatus = activeStatus;
  toolbar.innerHTML = '<span class="filter-label">Status:</span>';

  const allBtn = document.createElement('button');
  allBtn.className = 'status-filter-btn' + (currentStatus === 'all' ? ' active' : '');
  allBtn.dataset.status = 'all';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => { activeStatus = 'all'; updateStatusToolbar(); render(); });
  toolbar.appendChild(allBtn);

  Object.entries(statuses).forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.className = 'status-filter-btn' + (currentStatus === val ? ' active' : '');
    btn.dataset.status = val;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';

    const dot = document.createElement('span');
    dot.className = 'stage-swatch-dot';
    dot.style.background = stageColor(val);
    dot.title = 'Change stage color';
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const currColor = stageColor(val);
      const currIdx = STAGE_COLOR_PALETTE.indexOf(currColor);
      showColorPicker(dot, STAGE_COLOR_PALETTE, currIdx === -1 ? 0 : currIdx, (idx) => saveStageColor(val, STAGE_COLOR_PALETTE[idx]));
    });

    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(label));
    btn.addEventListener('click', () => { activeStatus = val; updateStatusToolbar(); render(); });
    toolbar.appendChild(btn);
  });
}

function render() {
  const query = document.getElementById('search').value.toLowerCase();
  const grid = document.getElementById('grid');
  const kanbanBoard = document.getElementById('kanban-board');
  const statusToolbar = document.getElementById('status-toolbar');

  let filtered = allCompanies.filter(c => {
    const matchesSearch = !query ||
      c.company.toLowerCase().includes(query) ||
      (c.notes || '').toLowerCase().includes(query) ||
      (c.category || '').toLowerCase().includes(query) ||
      (c.jobTitle || '').toLowerCase().includes(query) ||
      (c.oneLiner || '').toLowerCase().includes(query) ||
      (c.tags || []).some(t => t.toLowerCase().includes(query));
    const matchesType = activePipeline === 'opportunity' ? !!c.isOpportunity
      : activePipeline === 'company' ? true
      : true;
    const matchesRating = activeRatings.size === 0 || activeRatings.has(c.rating || 0);
    const matchesStatus = activeStatus === 'all' || (c.status || 'needs_review') === activeStatus;
    const matchesTag = activeTag === null || (c.tags || []).includes(activeTag);
    const matchesAction = activeActionFilter === 'all' || (c.actionStatus || 'my_court') === activeActionFilter;
    return matchesSearch && matchesType && matchesRating && matchesStatus && matchesTag && matchesAction;
  });

  // Update stats
  // Company/opp counts are rendered in the pipeline overview stat cards now
  const _companyCountEl = document.getElementById('company-count');
  const _jobCountEl = document.getElementById('job-count');
  if (_companyCountEl) _companyCountEl.textContent = allCompanies.length;
  if (_jobCountEl) _jobCountEl.textContent = allCompanies.filter(c => !!c.isOpportunity).length;
  // Update queue header button count
  const queueLabel = document.getElementById('queue-header-label');
  if (queueLabel) {
    const qCount = allCompanies.filter(c => c.isOpportunity && (c.jobStage || 'needs_review') === QUEUE_STAGE).length;
    queueLabel.textContent = qCount > 0 ? `Coop's Scoring Queue (${qCount})` : `Coop's Scoring Queue`;
  }
  const applyLabel = document.getElementById('apply-header-label');
  if (applyLabel) {
    const aCount = allCompanies.filter(c => c.isOpportunity && c.jobStage === 'want_to_apply').length;
    applyLabel.textContent = aCount > 0 ? `Apply Queue (${aCount})` : `Apply Queue`;
  }

  if (viewMode === 'kanban' && activePipeline !== 'all') {
    grid.style.display = 'none';
    kanbanBoard.style.display = 'flex';
    if (statusToolbar) statusToolbar.style.display = 'none';
    renderKanban(filtered);
    return;
  }

  kanbanBoard.style.display = 'none';
  grid.style.display = '';
  if (statusToolbar) statusToolbar.style.display = '';

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><b>${allCompanies.length === 0 ? 'No saved companies yet' : 'No results'}</b>${allCompanies.length === 0 ? 'Open Coop.ai on any company page and hit Save.' : 'Try a different search or filter.'}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(c => {
    const stars = [1,2,3,4,5].map(i =>
      `<span class="star ${(c.rating||0) >= i ? 'filled' : ''}" data-id="${c.id}" data-val="${i}">★</span>`
    ).join('');

    const statBits = [
      c.employees ? `👥 ${c.employees}` : null,
      c.funding ? `💰 ${c.funding}` : null,
      c.founded ? `📅 ${c.founded}` : null
    ].filter(Boolean);

    const isJob = !!c.isOpportunity;
    const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
    const status = activePipeline === 'opportunity' ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');
    const arrClass = c.workArrangement === 'Remote' ? 'remote' : c.workArrangement === 'Hybrid' ? 'hybrid' : c.workArrangement === 'On-site' ? 'onsite' : '';
    const statusOptions = Object.entries(stageMap()).map(([val, label]) =>
      `<option value="${val}" ${status === val ? 'selected' : ''}>${label}</option>`
    ).join('');
    const faviconDomain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    const faviconHtml = faviconDomain
      ? `<img class="card-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">`
      : '';
    const statusColor = stageColor(status);
    return `
      <div class="card" id="card-${c.id}" data-id="${c.id}" data-type="company" style="border-left: 3px solid ${statusColor}; cursor:pointer">
        <div class="card-header">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
              ${faviconHtml}
              <span class="card-type ${isJob ? 'job' : 'company'}">${isJob ? 'Opportunity' : 'Company'}</span>
              <a class="card-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank">${c.company}</a>
            </div>
            ${isJob && c.jobTitle ? `<div class="card-job" style="font-size:13px;font-weight:500;margin-bottom:2px">${c.jobUrl ? `<a href="${c.jobUrl}" target="_blank" class="card-job-link">${c.jobTitle}</a>` : `<span style="color:#cbd5e1">${c.jobTitle}</span>`}</div>` : ''}
            ${isJob && (c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary || c.workArrangement) ? (() => {
              const compText = c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary;
              const compLabel = c.baseSalaryRange ? 'Base' : c.oteTotalComp ? 'OTE' : (c.jobSnapshot?.salaryType === 'ote' ? 'OTE' : 'Base');
              return `<div class="card-job-chips">
                ${compText ? `<span class="job-chip salary ${compLabel.toLowerCase()}">💰 ${compLabel}: ${compText}</span>` : ''}
                ${c.equity ? `<span class="job-chip equity">📈 ${c.equity}</span>` : ''}
                ${c.workArrangement ? `<span class="job-chip ${arrClass}">${c.workArrangement === 'Remote' ? '🌐' : c.workArrangement === 'Hybrid' ? '🏠' : '🏢'} ${c.workArrangement}${c.location ? ' · ' + c.location : ''}</span>` : ''}
              </div>`;
            })() : ''}
            ${isJob && c.jobMatch?.score ? (() => {
              const v = scoreToVerdict(c.jobMatch.score);
              return `<div class="card-job-overview">
                ${c.jobMatch.jobSummary && (!c.jobTitle || !c.jobMatch.jobSummary.toLowerCase().startsWith(c.jobTitle.toLowerCase())) ? `<div class="card-job-summary">${c.jobMatch.jobSummary}</div>` : ''}
                <div class="card-verdict-row">
                  <span class="card-verdict-badge ${v.cls}">${v.label}</span>
                  <span class="card-verdict-text">${c.jobMatch.verdict || ''}</span>
                </div>
              </div>`;
            })() : isJob && c.jobMatchScore ? `<div class="card-job-match">Role match: <b>${c.jobMatchScore}/10</b>${c.jobMatchVerdict ? ` — ${c.jobMatchVerdict}` : ''}</div>` : ''}
          </div>
          <button class="card-delete" data-id="${c.id}" title="Remove">✕</button>
        </div>
        <select class="status-select" data-id="${c.id}" data-status="${status}" data-stage-field="${stageField}">${statusOptions}</select>
        ${c.category ? `<span class="card-category">${c.category}</span>` : ''}
        ${c.oneLiner ? `<div class="card-oneliner">${c.oneLiner}</div>` : ''}
        ${statBits.length > 0 ? `<div class="card-stats">${statBits.map(s => `<span class="card-stat">${s}</span>`).join('')}</div>` : ''}
        <div class="card-tags" id="tags-${c.id}">
          ${(c.tags || []).map(tag => {
            const cl = tagColor(tag);
            return `<span class="card-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}" data-tag="${tag}" data-id="${c.id}">${tag}<span class="tag-remove" data-tag="${tag}" data-id="${c.id}">✕</span></span>`;
          }).join('')}
          <div class="tag-inline-wrap" id="tag-add-wrap-${c.id}">
            <button class="tag-add-btn" data-id="${c.id}">+ tag</button>
          </div>
        </div>
        <div class="card-stars"><span class="card-stars-label">Excitement</span>${stars}</div>
        <textarea class="card-notes" data-id="${c.id}" placeholder="Add notes...">${c.notes || ''}</textarea>
        ${(c.intelligence || c.jobMatch) ? `
        <details class="card-analysis">
          <summary>Full Analysis</summary>
          <div class="analysis-body">
            ${c.jobMatch?.strongFits?.length ? `<div><div class="analysis-section-label">Green Flags</div><ul class="analysis-bullets">${c.jobMatch.strongFits.map(f => { const t = typeof f === 'string' ? f : (f?.text || ''); const ev = typeof f === 'string' ? '' : (f?.evidence || ''); return `<li class="fit" title="${ev.replace(/"/g,'&quot;')}"><span>🟢</span><span>${boldKeyPhrase(t)}</span></li>`; }).join('')}</ul></div>` : ''}
            ${c.jobMatch?.redFlags?.length ? `<div><div class="analysis-section-label">Red Flags</div><ul class="analysis-bullets">${c.jobMatch.redFlags.map(f => { const t = typeof f === 'string' ? f : (f?.text || ''); const ev = typeof f === 'string' ? '' : (f?.evidence || ''); return `<li class="flag" title="${ev.replace(/"/g,'&quot;')}"><span>🔴</span><span>${boldKeyPhrase(t)}</span></li>`; }).join('')}</ul></div>` : ''}
            ${c.intelligence?.eli5 ? `<div><div class="analysis-section-label">Simple Explanation</div><div class="analysis-section-body">${c.intelligence.eli5}</div></div>` : ''}
            ${c.intelligence?.whosBuyingIt ? `<div><div class="analysis-section-label">Who Buys It</div><div class="analysis-section-body">${c.intelligence.whosBuyingIt}</div></div>` : ''}
            ${c.intelligence?.howItWorks ? `<div><div class="analysis-section-label">How It Works</div><div class="analysis-section-body">${c.intelligence.howItWorks}</div></div>` : ''}
            ${c.reviews?.length ? `<div><div class="analysis-section-label">Employee Reviews</div>${c.reviews.slice(0,3).map(r => `<div class="analysis-review">"${r.snippet}"<div class="analysis-review-src">${r.source || ''}</div></div>`).join('')}</div>` : ''}
          </div>
        </details>` : ''}
        <div class="card-footer">
          <span class="card-date">${new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <div class="card-links">
            ${!isJob ? `<button class="add-opp-btn" data-id="${c.id}">+ Pipeline</button>` : ''}
            ${c.jobUrl ? `<a class="card-link" href="${c.jobUrl}" target="_blank">↗ Job</a>` : c.url ? `<a class="card-link" href="${c.url}" target="_blank">↗ Page</a>` : ''}
            ${c.companyLinkedin ? `<a class="card-link card-link-li" href="${c.companyLinkedin}" target="_blank">LinkedIn</a>` : `<a class="card-link card-link-li" href="https://www.linkedin.com/company/${encodeURIComponent(c.company.toLowerCase().replace(/\s+/g, '-'))}" target="_blank">LinkedIn</a>`}
            ${c.companyWebsite ? `<a class="card-link card-link-web" href="${c.companyWebsite}" target="_blank">Website</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  // Tag remove
  grid.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      const tag = el.dataset.tag;
      const entry = allCompanies.find(c => c.id === id);
      if (!entry) return;
      updateCompany(id, { tags: (entry.tags || []).filter(t => t !== tag) });
      updateTagsToolbar();
    });
  });

  // Tag color edit (click tag text, not ✕)
  grid.querySelectorAll('.card-tag').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tag-remove')) return;
      e.stopPropagation();
      const tag = el.dataset.tag;
      const currIdx = customTagColors[tag] !== undefined ? customTagColors[tag] : tagColorIndex(tag);
      showColorPicker(el, TAG_PALETTE.map(p => p.border), currIdx, (idx) => saveTagColor(tag, idx));
    });
  });

  // Tag add button — show inline input
  grid.querySelectorAll('.tag-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const wrap = document.getElementById(`tag-add-wrap-${id}`);
      wrap.innerHTML = `<input class="tag-inline-input" id="tag-input-${id}" placeholder="tag name" autocomplete="off"><div class="tag-suggestions-inline" id="tag-sugg-${id}" style="display:none"></div>`;
      const input = document.getElementById(`tag-input-${id}`);
      const sugg = document.getElementById(`tag-sugg-${id}`);
      input.focus();

      input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        const entry = allCompanies.find(c => c.id === id);
        const existing = entry?.tags || [];
        if (!val) { sugg.style.display = 'none'; return; }
        const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !existing.includes(t));
        if (matches.length === 0) { sugg.style.display = 'none'; return; }
        sugg.innerHTML = matches.slice(0, 5).map(t => `<div class="tag-suggestion-inline" data-tag="${t}">${t}</div>`).join('');
        sugg.style.display = 'block';
        sugg.querySelectorAll('.tag-suggestion-inline').forEach(s => {
          s.addEventListener('mousedown', (e) => { e.preventDefault(); commitTag(id, s.dataset.tag); });
        });
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const val = input.value.trim(); if (val) commitTag(id, val); }
        if (e.key === 'Escape') { render(); }
      });
      input.addEventListener('blur', () => setTimeout(() => { if (document.getElementById(`tag-input-${id}`)) render(); }, 200));
    });
  });

  // Star click
  grid.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCompany(star.dataset.id, { rating: parseInt(star.dataset.val) });
    });
  });

  // Notes save on blur
  grid.querySelectorAll('.card-notes').forEach(ta => {
    ta.addEventListener('blur', () => {
      updateCompany(ta.dataset.id, { notes: ta.value });
    });
  });

  // Status change — update color immediately, then persist
  grid.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      sel.dataset.status = sel.value;
      const field = sel.dataset.stageField || 'status';
      const entry = allCompanies.find(c => c.id === sel.dataset.id);
      const now = Date.now();
      const changes = {
        [field]: sel.value,
        ...(entry ? stageEnterTimestamp(entry, sel.value) : { stageTimestamps: { [sel.value]: now } }),
        ...(entry ? backfillClearTimestamps(entry, sel.value) : {}),
      };
      const autoAction = defaultActionStatus(sel.value);
      if (autoAction) changes.actionStatus = autoAction;
      updateCompany(sel.dataset.id, changes);
    });
  });

  // Delete
  grid.querySelectorAll('.card-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Remove ${btn.dataset.id ? allCompanies.find(c=>c.id===btn.dataset.id)?.company : 'this company'}?`)) {
        deleteCompany(btn.dataset.id);
      }
    });
  });

  // Add opportunity from company card
  grid.querySelectorAll('.add-opp-btn').forEach(btn => {
    btn.addEventListener('click', () => createOpportunityFromCompany(btn.dataset.id));
  });

  // Click company card body → open full-screen company view
  grid.querySelectorAll('.card[data-type="company"]').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, textarea, input, .card-tag, .star, .card-stars, details, summary')) return;
      window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
    });
  });
}

function commitTag(id, tag) {
  const clean = tag.trim();
  if (!clean) return;
  const entry = allCompanies.find(c => c.id === id);
  if (!entry) return;
  const existing = entry.tags || [];
  if (existing.includes(clean)) { render(); return; }
  const newTags = [...existing, clean];
  // Add to global tag list if new
  if (!allKnownTags.includes(clean)) {
    allKnownTags = [...allKnownTags, clean];
    chrome.storage.local.set({ allTags: allKnownTags });
  }
  updateCompany(id, { tags: newTags });
  updateTagsToolbar();
}

// ── Confetti ──────────────────────────────────────────────────────────────────

// ── Celebration config ────────────────────────────────────────────────────────

const CONFETTI_OPTIONS = [
  { value: 'none',       label: '— None' },
  { value: 'confetti',   label: '🎊 Confetti' },
  { value: 'thumbsup',   label: '👍 Thumbs Up' },
  { value: 'money',      label: '🤑 Money' },
  { value: 'peace',      label: '✌️ Peace' },
  { value: 'stopsign',   label: '🛑 Stop Sign' },
  { value: 'fire',       label: '🔥 Fire' },
  { value: 'rocket',     label: '🚀 Rocket' },
  { value: 'star',       label: '⭐ Stars' },
  { value: 'heart',      label: '❤️ Hearts' },
  { value: 'clap',       label: '👏 Clap' },
  { value: 'trophy',     label: '🏆 Trophy' },
  { value: 'lightning',  label: '⚡ Lightning' },
  { value: 'muscle',     label: '💪 Muscle' },
  { value: 'party',      label: '🥳 Party' },
  { value: 'champagne',  label: '🍾 Champagne' },
  { value: 'crown',      label: '👑 Crown' },
  { value: 'gem',        label: '💎 Gem' },
  { value: 'skull',      label: '💀 Skull' },
  { value: 'wave',       label: '👋 Wave' },
  { value: 'eyes',       label: '👀 Eyes' },
  { value: 'hundred',    label: '💯 100' },
  { value: 'sparkles',   label: '✨ Sparkles' },
  { value: 'fireworks',  label: '🎆 Fireworks' },
  { value: 'unicorn',    label: '🦄 Unicorn' },
  { value: 'cake',       label: '🎂 Cake' },
  { value: 'medal',      label: '🥇 Gold Medal' },
  { value: 'rainbow',    label: '🌈 Rainbow' },
  { value: 'bell_emoji', label: '🛎️ Bell' },
  { value: 'cool',       label: '😎 Cool' },
];
const SOUND_OPTIONS = [
  { value: 'none',       label: '— None' },
  { value: 'pop',        label: '🎊 Pop' },
  { value: 'chaching',   label: '💰 Cha-ching' },
  { value: 'farewell',   label: '👋 Farewell Voice' },
  { value: 'levelup',    label: '🎮 Level Up' },
  { value: 'bell',       label: '🔔 Bell' },
  { value: 'whoosh',     label: '💨 Whoosh' },
  { value: 'tada',       label: '🎉 Ta-da!' },
  { value: 'drum',       label: '🥁 Drum Roll' },
  { value: 'coin',       label: '🪙 Coin Drop' },
  { value: 'airhorn',    label: '📯 Air Horn' },
  { value: 'sad',        label: '😢 Sad Trombone' },
  { value: 'fanfare',    label: '🎺 Fanfare' },
  { value: 'sparkle',    label: '✨ Sparkle Chime' },
  { value: 'applause',   label: '👏 Applause' },
  { value: 'arcade',     label: '🕹️ Arcade Win' },
  { value: 'doorbell',   label: '🛎️ Doorbell' },
  { value: 'magic',      label: '🪄 Magic Wand' },
  { value: 'heartbeat',  label: '💓 Heartbeat' },
  { value: 'zen',        label: '🧘 Zen Bowl' },
];

// Smart defaults — used when a stage has no custom config set
function getDefaultCelebration(stageKey) {
  const stages = customOpportunityStages;
  if (stageKey === 'applied')                              return { confetti: 'thumbsup', sound: 'none' };
  if (/stall/i.test(stageKey))                            return { confetti: 'stopsign', sound: 'none' };
  if (/rejected|closed.lost|dq/i.test(stageKey))         return { confetti: 'peace',    sound: 'farewell' };

  const convoIdx    = stages.findIndex(s => s.key === 'conversations');
  const offerIdx    = stages.findIndex(s => /offer/i.test(s.key));
  const rejectedIdx = stages.findIndex(s => /rejected/i.test(s.key));
  const toIdx       = stages.findIndex(s => s.key === stageKey);

  if (convoIdx < 0 || toIdx < convoIdx) return { confetti: 'none', sound: 'none' };
  if (rejectedIdx >= 0 && toIdx >= rejectedIdx) return { confetti: 'none', sound: 'none' };
  if (offerIdx >= 0 && toIdx >= offerIdx)       return { confetti: 'money',    sound: 'chaching' };
  return { confetti: 'confetti', sound: 'pop' };
}

function getConfettiConfig(newStatus) {
  const stages = customOpportunityStages;
  const cfg = stageCelebrations[newStatus] || getDefaultCelebration(newStatus);
  if (!cfg || cfg.confetti === 'none') return null;

  // Count scales with pipeline position for progressive feel
  let count = 30;
  if (cfg.confetti === 'confetti') {
    const convoIdx = stages.findIndex(s => s.key === 'conversations');
    const toIdx    = stages.findIndex(s => s.key === newStatus);
    const pos = (convoIdx >= 0 && toIdx >= 0) ? Math.max(0, toIdx - convoIdx) : 0;
    count = 80 + pos * 55;
  } else if (cfg.confetti === 'money') {
    const offerIdx = stages.findIndex(s => /offer/i.test(s.key));
    const toIdx    = stages.findIndex(s => s.key === newStatus);
    const pos = (offerIdx >= 0 && toIdx >= 0) ? Math.max(0, toIdx - offerIdx) : 0;
    count = 55 + pos * 35;
  } else if (cfg.confetti === 'thumbsup') count = 20;
  else if (cfg.confetti === 'stopsign')   count = 25;
  else if (cfg.confetti === 'peace')      count = 35;

  return { type: cfg.confetti, sound: cfg.sound || 'none', count };
}

function playSound(sound) {
  if (!sound || sound === 'none') return;
  if (sound === 'pop') playConfettiPop();
  else if (sound === 'chaching') playChaChingSound();
  else if (sound === 'farewell') playFarewellVoice();
  else if (sound === 'levelup') playLevelUp();
  else if (sound === 'bell') playBell();
  else if (sound === 'whoosh') playNoise(0.15);
  else if (sound === 'tada') playTada();
  else if (sound === 'drum') playDrumRoll();
  else if (sound === 'coin') playSynth([1200, 1600], 0.03, 0.12, 'square');
  else if (sound === 'airhorn') playSynth([400, 500, 400, 500], 0.12, 0.4);
  else if (sound === 'sad') playSynth([350, 330, 310, 200], 0.2, 0.5);
  else if (sound === 'fanfare') playFanfare();
  else if (sound === 'sparkle') playSparkleChime();
  else if (sound === 'applause') playApplause();
  else if (sound === 'arcade') playArcadeWin();
  else if (sound === 'doorbell') playDoorbell();
  else if (sound === 'magic') playMagicWand();
  else if (sound === 'heartbeat') playHeartbeat();
  else if (sound === 'zen') playZenBowl();
}

// ── Richer sound implementations ──────────────────────────────────────────────

function _ac() { return new (window.AudioContext || window.webkitAudioContext)(); }

// Triumphant ascending arpeggio with harmonic body
function playLevelUp() {
  try {
    const c = _ac(); const t = c.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => {
      const start = t + i * 0.07;
      [1, 2].forEach((mult, j) => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = j === 0 ? 'triangle' : 'sine';
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(j === 0 ? 0.18 : 0.05, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        o.connect(g); g.connect(c.destination);
        o.start(start); o.stop(start + 0.25);
      });
    });
  } catch(e) {}
}

// Warm bell with metallic harmonics + long decay
function playBell() {
  try {
    const c = _ac(); const t = c.currentTime;
    const fund = 880;
    [[1, 0.35, 1.8], [2.76, 0.18, 1.4], [5.4, 0.09, 0.9], [8.93, 0.05, 0.6]].forEach(([mult, vol, dec]) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.value = fund * mult;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dec);
    });
  } catch(e) {}
}

// Ta-da: short sting then triumphant chord
function playTada() {
  try {
    const c = _ac(); const t = c.currentTime;
    // Pickup note
    const p = c.createOscillator(); const pg = c.createGain();
    p.type = 'triangle'; p.frequency.value = 392;
    pg.gain.setValueAtTime(0.18, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    p.connect(pg); pg.connect(c.destination); p.start(t); p.stop(t + 0.12);
    // Chord hit
    [523.25, 659.25, 783.99, 1046.5].forEach(f => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.15, t + 0.13);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g); g.connect(c.destination);
      o.start(t + 0.13); o.stop(t + 0.7);
    });
  } catch(e) {}
}

// Brass fanfare — three rising hits
function playFanfare() {
  try {
    const c = _ac(); const t = c.currentTime;
    const hits = [[523.25, 0], [659.25, 0.13], [783.99, 0.26], [1046.5, 0.42]];
    hits.forEach(([f, dt]) => {
      [1, 2, 3].forEach((h, i) => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = f * h;
        g.gain.setValueAtTime(0.08 / h, t + dt);
        g.gain.exponentialRampToValueAtTime(0.001, t + dt + (dt < 0.4 ? 0.13 : 0.5));
        o.connect(g); g.connect(c.destination);
        o.start(t + dt); o.stop(t + dt + (dt < 0.4 ? 0.13 : 0.5));
      });
    });
  } catch(e) {}
}

// Cascading high-frequency sparkles
function playSparkleChime() {
  try {
    const c = _ac(); const t = c.currentTime;
    const notes = [2093, 2637, 3136, 2349, 2794, 3520];
    notes.forEach((f, i) => {
      const start = t + i * 0.05;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.1, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      o.connect(g); g.connect(c.destination);
      o.start(start); o.stop(start + 0.3);
    });
  } catch(e) {}
}

// Layered noise bursts → applause
function playApplause() {
  try {
    const c = _ac(); const len = c.sampleRate * 1.2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = i < len * 0.15 ? i / (len * 0.15) : Math.max(0, 1 - (i - len * 0.15) / (len * 0.85));
      const claps = Math.sin(i * 0.04) * 0.6 + Math.sin(i * 0.13) * 0.4;
      d[i] = (Math.random() * 2 - 1) * env * (0.5 + claps * 0.5) * 0.5;
    }
    const s = c.createBufferSource(); s.buffer = buf;
    const filt = c.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 1500;
    const g = c.createGain(); g.gain.value = 0.4;
    s.connect(filt); filt.connect(g); g.connect(c.destination); s.start();
  } catch(e) {}
}

// 8-bit arcade victory
function playArcadeWin() {
  try {
    const c = _ac(); const t = c.currentTime;
    const notes = [659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      const start = t + i * 0.08;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.1, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
      o.connect(g); g.connect(c.destination);
      o.start(start); o.stop(start + 0.1);
    });
    // Final long note
    const tEnd = t + notes.length * 0.08;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'square'; o.frequency.value = 1568;
    g.gain.setValueAtTime(0.12, tEnd);
    g.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.35);
    o.connect(g); g.connect(c.destination);
    o.start(tEnd); o.stop(tEnd + 0.35);
  } catch(e) {}
}

// Two-tone doorbell (ding-dong)
function playDoorbell() {
  try {
    const c = _ac(); const t = c.currentTime;
    [[659.25, 0], [523.25, 0.45]].forEach(([f, dt]) => {
      [1, 2.76].forEach(mult => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = 'sine'; o.frequency.value = f * mult;
        g.gain.setValueAtTime(mult === 1 ? 0.25 : 0.08, t + dt);
        g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.9);
        o.connect(g); g.connect(c.destination);
        o.start(t + dt); o.stop(t + dt + 0.9);
      });
    });
  } catch(e) {}
}

// Magical sweep
function playMagicWand() {
  try {
    const c = _ac(); const t = c.currentTime;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(2200, t + 0.4);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 0.5);
    // Sparkle tail
    [2400, 3000, 3600].forEach((f, i) => {
      const oo = c.createOscillator(); const gg = c.createGain();
      oo.type = 'sine'; oo.frequency.value = f;
      gg.gain.setValueAtTime(0.06, t + 0.4 + i * 0.04);
      gg.gain.exponentialRampToValueAtTime(0.001, t + 0.4 + i * 0.04 + 0.2);
      oo.connect(gg); gg.connect(c.destination);
      oo.start(t + 0.4 + i * 0.04); oo.stop(t + 0.4 + i * 0.04 + 0.2);
    });
  } catch(e) {}
}

// Two soft thumps
function playHeartbeat() {
  try {
    const c = _ac(); const t = c.currentTime;
    [0, 0.25].forEach(dt => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(80, t + dt);
      o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.15);
      g.gain.setValueAtTime(0.45, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.18);
      o.connect(g); g.connect(c.destination);
      o.start(t + dt); o.stop(t + dt + 0.18);
    });
  } catch(e) {}
}

// Singing bowl — long sustained shimmer
function playZenBowl() {
  try {
    const c = _ac(); const t = c.currentTime;
    const fund = 432;
    [[1, 0.3, 3.5], [2.4, 0.12, 2.5], [4.1, 0.06, 1.8]].forEach(([mult, vol, dec]) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.value = fund * mult;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dec);
    });
  } catch(e) {}
}

function playSynth(freqs, gap, dur, wave = 'sine') {
  try {
    const c = new AudioContext(); const t = c.currentTime;
    freqs.forEach((f, i) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = wave; o.connect(g); g.connect(c.destination);
      o.frequency.value = f;
      g.gain.setValueAtTime(0.2, t + i * gap);
      g.gain.exponentialRampToValueAtTime(0.01, t + i * gap + dur);
      o.start(t + i * gap); o.stop(t + i * gap + dur);
    });
  } catch(e) {}
}

function playNoise(dur) {
  try {
    const c = new AudioContext(); const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf;
    const g = c.createGain(); g.gain.value = 0.15;
    s.connect(g); g.connect(c.destination); s.start();
  } catch(e) {}
}

function playDrumRoll() {
  try {
    const c = new AudioContext(); const t = c.currentTime;
    for (let i = 0; i < 12; i++) {
      const buf = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
      const s = c.createBufferSource(); s.buffer = buf;
      const g = c.createGain(); g.gain.value = 0.08 + i * 0.015;
      s.connect(g); g.connect(c.destination); s.start(t + i * 0.06);
    }
  } catch(e) {}
}

function playConfettiPop() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Tonal pop — descending pitch sweep
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.12);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);

    // Noise burst for pop texture
    const bufSize = Math.floor(ctx.sampleRate * 0.045);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
  } catch(e) {}
}

const _farewellPhrases = ['peace', 'adios', 'see ya', 'hasta la vista'];
let _farewellIdx = Math.floor(Math.random() * _farewellPhrases.length);
function playFarewellVoice() {
  try {
    const phrase = _farewellPhrases[_farewellIdx % _farewellPhrases.length];
    _farewellIdx++;
    const utter = new SpeechSynthesisUtterance(phrase);
    utter.rate  = 0.88;
    utter.pitch = 1.1;
    utter.volume = 0.9;
    window.speechSynthesis.speak(utter);
  } catch(e) {}
}

function playChaChingSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Master compressor so everything sits together
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    // "KA" — low mechanical thunk
    const kaOsc = ctx.createOscillator();
    kaOsc.type = 'sine';
    kaOsc.frequency.setValueAtTime(200, t);
    kaOsc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const kaGain = ctx.createGain();
    kaGain.gain.setValueAtTime(0.9, t);
    kaGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    kaOsc.connect(kaGain); kaGain.connect(comp);
    kaOsc.start(t); kaOsc.stop(t + 0.12);

    // Noise punch on the "ka"
    const kaBufSize = Math.floor(ctx.sampleRate * 0.05);
    const kaBuf = ctx.createBuffer(1, kaBufSize, ctx.sampleRate);
    const kaData = kaBuf.getChannelData(0);
    for (let i = 0; i < kaBufSize; i++) kaData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / kaBufSize, 3);
    const kaNoise = ctx.createBufferSource(); kaNoise.buffer = kaBuf;
    const kaNoiseGain = ctx.createGain();
    kaNoiseGain.gain.setValueAtTime(0.5, t);
    kaNoiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    kaNoise.connect(kaNoiseGain); kaNoiseGain.connect(comp);
    kaNoise.start(t);

    // "CHING" — bright sustained bell, fundamental
    const ching = ctx.createOscillator();
    ching.type = 'sine';
    ching.frequency.setValueAtTime(2350, t + 0.07);
    const chingGain = ctx.createGain();
    chingGain.gain.setValueAtTime(0.75, t + 0.07);
    chingGain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    ching.connect(chingGain); chingGain.connect(comp);
    ching.start(t + 0.07); ching.stop(t + 1.6);

    // Harmonic overtones for metallic body
    [[3500, 0.45, 1.1], [4700, 0.25, 0.7], [6200, 0.14, 0.45]].forEach(([freq, vol, decay]) => {
      const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = freq;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(vol, t + 0.07);
      hg.gain.exponentialRampToValueAtTime(0.001, t + decay);
      h.connect(hg); hg.connect(comp);
      h.start(t + 0.07); h.stop(t + decay);
    });

    // Coin shimmer — 3 quick metallic taps after the ching
    [0.13, 0.21, 0.31].forEach((delay, i) => {
      const coin = ctx.createOscillator(); coin.type = 'sine';
      const f = 1900 - i * 120;
      coin.frequency.setValueAtTime(f, t + delay);
      coin.frequency.exponentialRampToValueAtTime(f * 0.65, t + delay + 0.07);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.3 - i * 0.07, t + delay);
      cg.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.12);
      coin.connect(cg); cg.connect(comp);
      coin.start(t + delay); coin.stop(t + delay + 0.12);
    });

  } catch(e) {}
}

const EMOJI_MAP = {
  thumbsup: '👍', money: '🤑', peace: '✌️', stopsign: '🛑', fire: '🔥', rocket: '🚀',
  star: '⭐', heart: '❤️', clap: '👏', trophy: '🏆', lightning: '⚡', muscle: '💪',
  party: '🥳', champagne: '🍾', crown: '👑', gem: '💎', skull: '💀', wave: '👋',
  eyes: '👀', hundred: '💯',
  sparkles: '✨', fireworks: '🎆', unicorn: '🦄', cake: '🎂', medal: '🥇',
  rainbow: '🌈', bell_emoji: '🛎️', cool: '😎',
};

function showCelebrationBanner(stageLabel, emoji) {
  try {
    const existing = document.getElementById('ci-celebration-banner');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'ci-celebration-banner';
    el.style.cssText = [
      'position:fixed','left:50%','top:22%','transform:translate(-50%,-12px) scale(0.9)',
      'background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%)',
      'border:1px solid #fdba74','border-radius:14px','padding:14px 22px',
      'box-shadow:0 18px 48px rgba(255,122,89,0.28),0 4px 14px rgba(0,0,0,0.08)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:16px','font-weight:700','color:#9a3412',
      'z-index:99998','pointer-events:none','opacity:0',
      'display:flex','align-items:center','gap:12px',
      'transition:opacity 260ms ease, transform 260ms cubic-bezier(.2,1.4,.4,1)',
    ].join(';');
    el.innerHTML = `<span style="font-size:26px;line-height:1;">${emoji}</span><span>Moved to <span style="color:#ff7a59;">${stageLabel}</span></span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%, 0) scale(1)';
    });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -8px) scale(0.96)';
      setTimeout(() => el.remove(), 320);
    }, 1700);
  } catch(e) {}
}

function fireConfetti(config) {
  const { type, sound, count } = config;
  const colors = ['#ff4444', '#ffbb00', '#00cc88', '#4488ff', '#cc44ff', '#ff8844', '#00ccff', '#ffcc00'];
  const isEmoji = type !== 'confetti' && type in EMOJI_MAP;
  const baseEmoji = EMOJI_MAP[type] || '🎊';

  playSound(sound);

  const particles = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;will-change:transform';

    if (isEmoji) {
      // Money: mix 🤑 with $ signs
      const isDollar = type === 'money' && Math.random() < 0.4;
      el.textContent = isDollar ? '$' : baseEmoji;
      el.style.fontSize = (isDollar ? 20 + Math.random() * 14 : 16 + Math.random() * 14) + 'px';
      el.style.lineHeight = '1';
      if (isDollar) {
        el.style.fontWeight = 'bold';
        el.style.color = Math.random() < 0.5 ? '#22c55e' : '#eab308';
      }
    } else {
      const color = colors[Math.floor(Math.random() * colors.length)];
      el.style.width        = (7 + Math.random() * 7) + 'px';
      el.style.height       = (4 + Math.random() * 4) + 'px';
      el.style.background   = color;
      el.style.borderRadius = '2px';
    }

    // Launch from random point near the bottom of the screen
    const startX = window.innerWidth  * (0.05 + Math.random() * 0.9);
    const startY = window.innerHeight * (0.85 + Math.random() * 0.15);
    // Fan upward — angle spread roughly ±55° around straight up
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.65);
    const speed = 5 + Math.random() * 6;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed; // negative = upward
    const vr = (Math.random() - 0.5) * 9;

    el.style.left = startX + 'px';
    el.style.top  = startY + 'px';
    document.body.appendChild(el);
    particles.push({ el, x: startX, y: startY, vx, vy, vr, rot: Math.random() * 360 });
  }

  const start     = performance.now();
  const fadeStart = 2400;
  const fadeEnd   = 4200;

  function animate(now) {
    const elapsed = now - start;
    let alive = 0;

    particles.forEach(p => {
      if (!p.el.parentNode) return;

      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.09;  // gentle gravity — slower arc
      p.vx *= 0.99;  // slight air resistance
      p.rot += p.vr;

      const opacity = elapsed < fadeStart
        ? 1
        : Math.max(0, 1 - (elapsed - fadeStart) / (fadeEnd - fadeStart));

      if (p.y > window.innerHeight + 80 || opacity <= 0) {
        p.el.remove();
        return;
      }

      p.el.style.left      = p.x + 'px';
      p.el.style.top       = p.y + 'px';
      p.el.style.transform = `rotate(${p.rot}deg)`;
      p.el.style.opacity   = opacity;
      alive++;
    });

    if (alive > 0) requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

// Clear stage timestamps for stages ahead of the destination when moving backwards
function backfillClearTimestamps(entry, toKey) {
  const stages = customOpportunityStages;
  const toIdx = stages.findIndex(s => s.key === toKey);
  if (toIdx < 0) return {};
  const ts = { ...(entry.stageTimestamps || {}) };
  let changed = false;
  for (const s of stages) {
    const sIdx = stages.findIndex(st => st.key === s.key);
    if (sIdx > toIdx && ts[s.key]) {
      delete ts[s.key];
      changed = true;
    }
  }
  return changed ? { stageTimestamps: ts } : {};
}

function updateCompany(id, changes) {
  allCompanies = allCompanies.map(c => c.id === id ? { ...c, ...changes } : c);
  chrome.storage.local.set({ savedCompanies: allCompanies }, () => { render(); renderActivitySection(); });
}

function deleteCompany(id) {
  allCompanies = allCompanies.filter(c => c.id !== id);
  chrome.storage.local.set({ savedCompanies: allCompanies }, render);
}

function createOpportunityFromCompany(companyId) {
  const company = allCompanies.find(c => c.id === companyId);
  if (!company) return;
  if (company.isOpportunity) {
    window.open(chrome.runtime.getURL('company.html') + '?id=' + companyId, '_blank');
    return;
  }
  updateCompany(companyId, { isOpportunity: true, jobStage: 'needs_review' });
}

// Keep saved view in sync when data changes from the sidepanel
// Debounced storage listener — without this, any background write to
// savedCompanies (scoring queue, calendar cache, email cache, Granola sync)
// triggers a full load() + render() rebuilding 116+ Kanban cards from scratch.
// Rapid-fire writes from multiple background processes could fire this 10+
// times/second, thrashing the DOM and crashing the renderer with OOM.
let _storageReloadTimer = null;
let _storageReloadHits = 0;
let _storageFirstHitAt = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.savedCompanies || changes.allTags)) {
    if (_storageReloadHits === 0) _storageFirstHitAt = Date.now();
    _storageReloadHits++;
    // Log which keys changed + a fingerprint of the new savedCompanies length
    if (changes.savedCompanies) {
      const oldLen = changes.savedCompanies.oldValue?.length || 0;
      const newLen = changes.savedCompanies.newValue?.length || 0;
      console.log(`[storage-write] savedCompanies ${oldLen}→${newLen}`);
    }
    clearTimeout(_storageReloadTimer);
    _storageReloadTimer = setTimeout(() => {
      const window = Date.now() - _storageFirstHitAt;
      console.log(`[debounce:storage] load() fired — ${_storageReloadHits} writes in ${window}ms (${(_storageReloadHits / (window / 1000)).toFixed(1)}/s)`);
      _storageReloadHits = 0;
      load();
    }, 400);
  }
});

// Real-time score updates from background.js — debounced render so a scoring
// queue processing N entries doesn't trigger N full Kanban rebuilds back-to-back.
let _scoreRenderTimer = null;
let _scoreRenderHits = 0;
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'QUICK_FIT_COMPLETE' && msg.companyId) {
    const idx = allCompanies.findIndex(c => c.id === msg.companyId);
    if (idx !== -1) {
      const updates = {};
      if (msg.score != null) updates.quickFitScore = msg.score;
      if (msg.scoredAt) updates.quickFitScoredAt = msg.scoredAt;
      if (msg.jobSnapshot) updates.jobSnapshot = msg.jobSnapshot;
      if (msg.quickTake) updates.quickTake = msg.quickTake;
      if (msg.hardDQ) updates.hardDQ = msg.hardDQ;
      allCompanies[idx] = { ...allCompanies[idx], ...updates, _queuedForScoring: false };
      _scoreRenderHits++;
      clearTimeout(_scoreRenderTimer);
      _scoreRenderTimer = setTimeout(() => {
        console.log('[debounce:score] render() fired after', _scoreRenderHits, 'coalesced QUICK_FIT_COMPLETE(s)');
        _scoreRenderHits = 0;
        render();
      }, 300);
    }
    sendResponse({ ok: true });
  }
});

// Kanban view
function renderKanban(filtered) {
  const board = document.getElementById('kanban-board');
  const stages = currentStages();
  const validKeys = new Set(stages.map(s => s.key));
  // Skip the scoring queue + apply queue columns in opportunity pipeline — they have dedicated pages
  const renderStages = (activePipeline === 'opportunity') ? stages.filter(s => s.key !== QUEUE_STAGE && s.key !== 'want_to_apply') : stages;
  board.innerHTML = renderStages.map(({ key: statusKey, label: statusLabel }) => {
    const cards = filtered.filter(c => {
      const s = (activePipeline === 'opportunity' ? c.jobStage : c.status) || stages[0].key;
      return validKeys.has(s) ? s === statusKey : statusKey === stages[0].key;
    });
    // Queue column: scored first (by quickFitScore desc), then scoring, then unscored
    if (statusKey === QUEUE_STAGE && activePipeline === 'opportunity') {
      cards.sort((a, b) => {
        const aScore = a.quickFitScore ?? a.jobMatch?.score ?? null;
        const bScore = b.quickFitScore ?? b.jobMatch?.score ?? null;
        const aScoring = a._queuedForScoring && aScore === null;
        const bScoring = b._queuedForScoring && bScore === null;
        // Scored first
        if ((aScore != null) !== (bScore != null)) return aScore != null ? -1 : 1;
        // Both scored — sort by score desc
        if (aScore != null && bScore != null) return bScore - aScore;
        // Scoring before queued
        if (aScoring !== bScoring) return aScoring ? -1 : 1;
        // Fallback: most recent first
        return (b.savedAt || 0) - (a.savedAt || 0);
      });
    } else if (activePipeline === 'opportunity') {
      // Sort: score first (highest first), then action priority, then most recent activity
      cards.sort((a, b) => {
        const sa = a.jobMatch?.score ? applyExcitementModifier(a.jobMatch.score, a.rating).final : (a.quickFitScore || -1);
        const sb = b.jobMatch?.score ? applyExcitementModifier(b.jobMatch.score, b.rating).final : (b.quickFitScore || -1);
        if (sb !== sa) return sb - sa;
        // Scheduled items surface above same-score items
        const actionPriority = { scheduled: 2, my_court: 1, their_court: 0 };
        const aP = actionPriority[a.actionStatus || 'my_court'] || 0;
        const bP = actionPriority[b.actionStatus || 'my_court'] || 0;
        if (bP !== aP) return bP - aP;
        return (computeLastActivity(b).timestamp || b.savedAt || 0) - (computeLastActivity(a).timestamp || a.savedAt || 0);
      });
    }
    const s = stageStyle(statusKey);
    const isCollapsed = _collapsedCols.has(statusKey);
    const colMode = getColViewMode(statusKey);
    const toggleIcon = colMode === 'compact' ? '☰' : '▤';
    const toggleTitle = colMode === 'compact' ? 'Switch to standard view' : 'Switch to compact view';
    const renderCard = colMode === 'compact' ? renderCompactCard : renderKanbanCard;
    return `
      <div class="kanban-col${isCollapsed ? ' collapsed' : ''}" data-col-key="${statusKey}">
        <div class="kanban-col-header" data-status="${statusKey}" style="border-top-color:${s.border};border-left-color:${s.border}">
          <div class="col-color-dot" data-col="${statusKey}" style="background:${s.border}"></div>
          <span class="kanban-col-title">${statusLabel}</span>
          <span class="kanban-col-count">${cards.length}</span>
          ${statusKey === QUEUE_STAGE && activePipeline === 'opportunity' ? `<button class="col-rescore-btn" data-col="${statusKey}" title="Re-score all entries in queue">↻ Re-score</button>` : ''}
          <button class="col-view-toggle" data-col="${statusKey}" title="${toggleTitle}">${toggleIcon}</button>
          <button class="kanban-col-collapse" data-collapse="${statusKey}" title="${isCollapsed ? 'Expand' : 'Collapse'}"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 4L6 8l4 4"/></svg></button>
        </div>
        <div class="kanban-cards" data-status="${statusKey}">
          ${cards.length ? cards.map(c => renderCard(c)).join('') : '<div class="kanban-empty">Empty</div>'}
        </div>
      </div>`;
  }).join('');

  // Swipe overlays are now injected dynamically on swipe start (in bindKanbanEvents)

  bindKanbanEvents(board);

  // Background-fetch calendar events for any card missing them.
  // Guarded by an in-memory Set so we never fire more than once per card per
  // session — without this, each successful fetch triggers a storage write →
  // re-render → re-fire for every card still in flight, creating a feedback
  // loop that spawns hundreds of concurrent tokeninfo/calendar requests and
  // crashes the saved.html renderer with OOM.
  if (typeof window._calendarFetchInFlight === 'undefined') window._calendarFetchInFlight = new Set();
  // Debounced storage flush — when many cards resolve at once, collapse N writes into 1.
  if (typeof window._calendarFlushTimer === 'undefined') window._calendarFlushTimer = null;
  if (typeof window._calendarFlushHits === 'undefined') window._calendarFlushHits = 0;
  const flushCalendarWrites = () => {
    window._calendarFlushHits++;
    clearTimeout(window._calendarFlushTimer);
    window._calendarFlushTimer = setTimeout(() => {
      console.log('[debounce:calendar] storage.set fired after', window._calendarFlushHits, 'coalesced fetch(s)');
      window._calendarFlushHits = 0;
      chrome.storage.local.set({ savedCompanies: allCompanies });
    }, 250);
  };
  filtered.forEach(c => {
    if (c.cachedCalendarEvents) return;
    if (window._calendarFetchInFlight.has(c.id)) return;
    const domain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    if (!domain) return;
    window._calendarFetchInFlight.add(c.id);
    const contactEmails = (c.knownContacts || []).flatMap(k => [k.email, ...(k.aliases || [])]);
    chrome.runtime.sendMessage(
      { type: 'CALENDAR_FETCH_EVENTS', domain, companyName: c.company || '', knownContactEmails: contactEmails },
      result => {
        void chrome.runtime.lastError;
        const events = result?.events || [];
        const idx = allCompanies.findIndex(x => x.id === c.id);
        if (idx === -1) return;
        // Always persist the fetch result (even empty) so we don't re-fetch on
        // the next render — key to breaking the feedback loop.
        allCompanies[idx] = { ...allCompanies[idx], cachedCalendarEvents: events };
        if (!events.length) {
          flushCalendarWrites();
          return;
        }
        if (detectScheduledStatus(allCompanies[idx])) {
          const current = allCompanies[idx].actionStatus || 'my_court';
          if (current === 'my_court' || current === 'their_court') {
            allCompanies[idx].actionStatus = 'scheduled';
          }
        } else if (allCompanies[idx].actionStatus === 'scheduled') {
          allCompanies[idx].actionStatus = defaultActionStatus(allCompanies[idx].jobStage || allCompanies[idx].status) || 'my_court';
        }
        // Auto-populate next step from upcoming calendar event
        const nextStepChanges = autoPopulateNextStep(allCompanies[idx]);
        if (nextStepChanges) {
          allCompanies[idx] = { ...allCompanies[idx], ...nextStepChanges };
        }
        flushCalendarWrites();
        if (nextStepChanges) render();
      }
    );
  });

}

function renderKanbanCard(c) {
  const isJob = !!c.isOpportunity;
  const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
  const currentStage = activePipeline === 'opportunity' ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');
  const arrClass = c.workArrangement === 'Remote' ? 'remote' : c.workArrangement === 'Hybrid' ? 'hybrid' : c.workArrangement === 'On-site' ? 'onsite' : '';
  const faviconDomain = c.companyWebsite?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const faviconHtml = faviconDomain ? `<img class="card-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">` : '';
  const stars = [1,2,3,4,5].map(i =>
    `<span class="star ${(c.rating||0) >= i ? 'filled' : ''}" data-id="${c.id}" data-val="${i}">★</span>`
  ).join('');
  const statusOptions = Object.entries(stageMap()).map(([val, label]) =>
    `<option value="${val}" ${currentStage === val ? 'selected' : ''}>${label}</option>`
  ).join('');

  const hasDetails = c.jobMatch?.jobSummary || c.jobMatch?.strongFits?.length || c.jobMatch?.redFlags?.length
    || c.intelligence?.eli5 || c.intelligence?.whosBuyingIt || c.reviews?.length;
  const detailsHtml = hasDetails ? `
    <details class="kanban-details">
      <summary class="kanban-details-toggle">Company Intel</summary>
      <div class="kanban-details-body">
        ${c.jobMatch?.jobSummary && (!c.jobTitle || !c.jobMatch.jobSummary.toLowerCase().startsWith(c.jobTitle.toLowerCase())) ? `<div class="kanban-detail-summary">${c.jobMatch.jobSummary}</div>` : ''}
        ${c.jobMatch?.verdict ? `<div class="kanban-detail-verdict">${c.jobMatch.verdict}</div>` : ''}
        ${c.jobMatch?.strongFits?.length ? `<details class="card-analysis"><summary>Green Flags</summary><div class="analysis-body"><ul class="analysis-bullets">${c.jobMatch.strongFits.map(f => { const t = typeof f === 'string' ? f : (f?.text || ''); const ev = typeof f === 'string' ? '' : (f?.evidence || ''); return `<li class="fit" title="${ev.replace(/"/g,'&quot;')}"><span>🟢</span><span>${boldKeyPhrase(t)}</span></li>`; }).join('')}</ul></div></details>` : ''}
        ${c.jobMatch?.redFlags?.length ? `<details class="card-analysis"><summary>Red Flags</summary><div class="analysis-body"><ul class="analysis-bullets">${c.jobMatch.redFlags.map(f => { const t = typeof f === 'string' ? f : (f?.text || ''); const ev = typeof f === 'string' ? '' : (f?.evidence || ''); return `<li class="flag" title="${ev.replace(/"/g,'&quot;')}"><span>🔴</span><span>${boldKeyPhrase(t)}</span></li>`; }).join('')}</ul></div></details>` : ''}
        ${c.intelligence?.eli5 ? `<details class="card-analysis"><summary>About the Company</summary><div class="analysis-body"><div class="analysis-section-body">${c.intelligence.eli5}</div></div></details>` : ''}
        ${c.intelligence?.whosBuyingIt ? `<details class="card-analysis"><summary>Who Buys It</summary><div class="analysis-body"><div class="analysis-section-body">${c.intelligence.whosBuyingIt}</div></div></details>` : ''}
        ${c.reviews?.length ? `<details class="card-analysis"><summary>Reviews & Signal</summary><div class="analysis-body">${c.reviews.slice(0,3).map(r => `<div class="analysis-review">"${r.snippet}"<div class="analysis-review-src">${r.source || ''}</div></div>`).join('')}</div></details>` : ''}
      </div>
    </details>` : '';

  return `
    <div class="kanban-card" draggable="true" data-id="${c.id}" data-type="company" id="kcard-${c.id}" style="border-left: 3px solid ${stageColor(currentStage)};">
      <div class="kanban-card-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            ${faviconHtml}
            <span class="card-type ${isJob ? 'job' : 'company'}">${isJob ? 'Opp' : 'Co.'}</span>
            <a class="kanban-card-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank">${c.company}${c.dataConflict ? ' <span title="Intel may be inaccurate" style="color:#d97706">\u26a0</span>' : ''}</a>
          </div>
          ${isJob && c.jobTitle ? `<div class="kanban-card-job">${c.jobUrl ? `<a href="${c.jobUrl}" target="_blank" class="card-job-link">${c.jobTitle}</a>` : c.jobTitle}</div>` : ''}
        </div>
        <button class="card-delete" data-id="${c.id}" title="Remove" style="flex-shrink:0">✕</button>
      </div>
      ${isJob && (c.jobMatch?.scoreBreakdown?.preferenceFit != null || c.jobMatch?.roleBrief?.qualificationScore != null) ? (() => {
        const icpMatch = c.jobMatch?.scoreBreakdown?.preferenceFit;
        const qualMatch = c.jobMatch?.roleBrief?.qualificationScore;
        const renderBadge = (label, score) => {
          if (score == null) return '';
          const color = score >= 7 ? '#00897b' : score >= 5 ? '#d97706' : '#e5483b';
          return `<span title="${label}" style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:${color}15;color:${color};white-space:nowrap;">${label} ${score}</span>`;
        };
        const uc = c.jobMatch?.userCorrections;
        const ucCount = uc?.pendingRescore ? Object.keys(uc.requirements || {}).length + (uc.overall ? 1 : 0) : 0;
        const ucPill = ucCount ? `<span title="You have unsaved corrections to this score" style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:#FFF1EC;color:#FF7A59;white-space:nowrap;">${ucCount} pending re-score</span>` : '';
        return `<div style="display:flex;gap:6px;padding:4px 0;margin-bottom:4px;font-size:11px;">${icpMatch != null ? renderBadge('ICP Match', icpMatch) : ''} ${qualMatch != null ? renderBadge('Qual Match', qualMatch) : ''} ${ucPill}</div>`;
      })() : ''}
      <div class="card-match-area" data-id="${c.id}">${isJob && c.jobMatch?.score ? (() => {
        const { final, mod } = applyExcitementModifier(c.jobMatch.score, c.rating);
        const v = scoreToVerdict(final);
        const scoreColor = final >= 7 ? '#00897b' : final >= 4 ? '#d97706' : '#e5483b';
        const modText = mod > 0 ? `<span class="card-score-mod up">+${mod}</span>` : mod < 0 ? `<span class="card-score-mod down">${mod}</span>` : '';
        const agoText = c.jobMatchScoredAt ? (() => {
          const d = Math.round((Date.now() - c.jobMatchScoredAt) / 86400000);
          return d === 0 ? 'today' : d === 1 ? '1d ago' : d + 'd ago';
        })() : '';
        const hardDQ = c.jobMatch?.hardDQ || c.hardDQ;
        const entryScore = c.jobMatch?.score ?? c.quickFitScore ?? null;
        const hardDQHtml = hardDQ?.flagged && entryScore != null && entryScore <= 3 ? '<span class="hard-dq-badge">\u{1F6AB} Hard DQ</span>' : '';
        return `<div class="card-score-row"><span class="card-score-num" style="color:${scoreColor}">${final}<span class="card-score-denom">/10</span></span>${modText}<span class="card-verdict-badge ${v.cls}">${v.label}</span>${hardDQHtml}${agoText ? `<span class="card-score-ago" title="Last scored">${agoText}</span>` : ''}</div>`;
      })() : (isJob && c._scoring ? '<span class="card-scoring-indicator">Scoring\u2026</span>' : isJob && c.jobDescription && !c.jobMatch ? '<button class="score-match-btn" data-id="' + c.id + '">Score match</button>' : '')}</div>
      ${isJob && (c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary || c.workArrangement) ? (() => {
        let compText = c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary || '';
        // Strip job title from comp if AI baked it in
        if (compText && c.jobTitle && compText.toLowerCase().startsWith(c.jobTitle.toLowerCase())) {
          compText = compText.slice(c.jobTitle.length).replace(/^[\s:—–\-,.;with]+/i, '').trim();
          if (!/[\$\d]/.test(compText.slice(0, 20))) {
            const m = compText.match(/\$[\d,]+[KkMm]?(?:\s*[-–]\s*\$[\d,]+[KkMm]?)?/);
            compText = m ? m[0] : '';
          }
        }
        const compLabel = c.baseSalaryRange ? 'Base' : c.oteTotalComp ? 'OTE' : (c.jobSnapshot?.salaryType === 'ote' ? 'OTE' : 'Base');
        const userWantsRemote = Array.isArray(_userWorkArrangement) && _userWorkArrangement.some(w => /remote/i.test(w));
        const jobArr = c.workArrangement || '';
        const arrMismatch = userWantsRemote && /on.?site|hybrid/i.test(jobArr);
        return `<div class="card-job-chips">
          ${compText ? `<span class="job-chip salary ${compLabel.toLowerCase()}">\u{1F4B0} ${compLabel}: ${compText}</span>` : ''}
          ${c.equity ? `<span class="job-chip equity">\u{1F4C8} ${c.equity}</span>` : ''}
          ${c.workArrangement ? `<span class="job-chip ${arrClass}${arrMismatch ? ' arr-mismatch' : ''}">${c.workArrangement === 'Remote' ? '\u{1F310}' : c.workArrangement === 'Hybrid' ? '\u{1F3E0}' : '\u{1F3E2}'} ${c.workArrangement}</span>` : ''}
        </div>`;
      })() : ''}
      ${(() => {
        const quickTake = c.jobMatch?.quickTake || c.quickTake || [];
        return quickTake.length ? `<div class="quick-take">${quickTake.slice(0, 4).map(qt =>
          `<div class="qt-bullet qt-${qt.type}">${qt.type === 'green' ? '\u{1F7E2}' : '\u{1F534}'} ${escHtmlGlobal(qt.text)}</div>`
        ).join('')}</div>` : '';
      })()}
      ${(() => {
        const reviews = c.reviews || [];
        const ratingReview = reviews.find(r => r.rating);
        return ratingReview ? (() => {
          const rating = parseFloat(ratingReview.rating);
          const warn = rating < 3.0;
          return `<span class="review-chip${warn ? ' review-warn' : ''}">${warn ? '\u26A0\uFE0F' : '\u2B50'} ${rating} ${ratingReview.source || 'Glassdoor'}</span>`;
        })() : '';
      })()}
      ${(() => {
        if (!c.oneLiner) return '';
        if (c.jobTitle) {
          const titleLower = c.jobTitle.toLowerCase().trim();
          const oneLower = c.oneLiner.toLowerCase().trim();
          // Hide if oneliner starts with or substantially contains the job title (redundant)
          if (oneLower.startsWith(titleLower) || titleLower.startsWith(oneLower.slice(0, titleLower.length))) return '';
        }
        return `<div class="kanban-card-oneliner">${c.oneLiner}</div>`;
      })()}
      <div class="card-tags" id="tags-${c.id}">
        ${(c.tags || []).map(tag => {
          const cl = tagColor(tag);
          return `<span class="card-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}" data-tag="${tag}" data-id="${c.id}">${tag}<span class="tag-remove" data-tag="${tag}" data-id="${c.id}">✕</span></span>`;
        }).join('')}
        <div class="tag-inline-wrap" id="tag-add-wrap-${c.id}">
          <button class="tag-add-btn" data-id="${c.id}">+ tag</button>
        </div>
      </div>
      <div class="kanban-next-step">
        <div class="kanban-next-step-row">
          <label class="kanban-field-label">Action On</label>
          <select class="kanban-action-status" data-id="${c.id}">
            ${(customActionStatuses || DEFAULT_ACTION_STATUSES).map(s =>
              `<option value="${s.key}" ${(c.actionStatus || 'my_court') === s.key ? 'selected' : ''} style="color:${s.color}">${s.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="kanban-next-step-row">
          <label class="kanban-field-label">Next Step</label>
          <input class="kanban-next-step-input" data-id="${c.id}" type="text" placeholder="" value="${(c.nextStep || '').replace(/"/g, '&quot;')}">
        </div>
        <div class="kanban-next-step-row">
          <label class="kanban-field-label">Next Step Date</label>
          <input class="kanban-next-step-date${c.nextStepDate ? ' has-value' : ''}" data-id="${c.id}" type="date" value="${c.nextStepDate || ''}">
        </div>
        ${(() => {
          const act = computeLastActivity(c);
          if (!act.label) return '';
          const dateStr = new Date(act.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return `<div class="kanban-next-step-row"><label class="kanban-field-label">Last Activity</label><span class="kanban-activity-value" title="${act.label} · ${dateStr}">${dateStr} · ${act.label}</span></div>`;
        })()}
      </div>
      <div class="card-stars"><span class="card-stars-label">Excitement</span>${stars}</div>
      <textarea class="card-notes" data-id="${c.id}" placeholder="Notes...">${c.notes || ''}</textarea>
      <div class="card-footer" style="margin-top:0">
        <span class="card-date">${new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <div class="card-links">
          ${!isJob ? `<button class="add-opp-btn" data-id="${c.id}">+ Pipeline</button>` : ''}
          ${c.jobUrl ? `<a class="card-link" href="${c.jobUrl}" target="_blank">↗</a>` : c.url ? `<a class="card-link" href="${c.url}" target="_blank">↗</a>` : ''}
          ${c.companyLinkedin
            ? `<a class="card-link card-link-li" href="${c.companyLinkedin}" target="_blank">LinkedIn</a>`
            : `<a class="card-link card-link-li" href="https://www.linkedin.com/company/${encodeURIComponent(c.company.toLowerCase().replace(/\s+/g, '-'))}" target="_blank">LinkedIn</a>`}
          ${c.companyWebsite ? `<a class="card-link card-link-web" href="${c.companyWebsite}" target="_blank">Website</a>` : ''}
        </div>
      </div>
      ${detailsHtml}
    </div>`;
}

function bindKanbanEvents(board) {
  // Column collapse/expand (delegated — works for dynamic state changes)
  board.addEventListener('click', e => {
    // Collapse button click
    const collapseBtn = e.target.closest('.kanban-col-collapse');
    if (collapseBtn) {
      e.stopPropagation();
      const key = collapseBtn.dataset.collapse;
      const col = collapseBtn.closest('.kanban-col');
      if (!col) return;
      col.classList.toggle('collapsed');
      if (col.classList.contains('collapsed')) _collapsedCols.add(key);
      else _collapsedCols.delete(key);
      sessionStorage.setItem('ci_collapsed_cols', JSON.stringify([..._collapsedCols]));
      return;
    }
    // Click anywhere on a collapsed column to expand
    const col = e.target.closest('.kanban-col.collapsed');
    if (col) {
      const key = col.dataset.colKey;
      col.classList.remove('collapsed');
      _collapsedCols.delete(key);
      sessionStorage.setItem('ci_collapsed_cols', JSON.stringify([..._collapsedCols]));
    }
  });

  let draggingId = null;
  let dragAllowed = false;

  board.querySelectorAll('.kanban-card').forEach(card => {
    // Track whether drag started from an interactive element
    card.addEventListener('mousedown', (e) => {
      dragAllowed = !e.target.closest('textarea, input, select, a, button, summary, details');
    });
    card.addEventListener('dragstart', (e) => {
      if (!dragAllowed) { e.preventDefault(); return; }
      draggingId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggingId = null;
      dragAllowed = false;
      board.querySelectorAll('.kanban-cards, .kanban-col-header').forEach(el => el.classList.remove('drag-over'));
    });
  });

  function handleColDrop(targetEl, e) {
    e.preventDefault();
    targetEl.classList.remove('drag-over');
    if (!draggingId) return;
    const newStatus = targetEl.dataset.status;
    const entry = allCompanies.find(c => c.id === draggingId);
    if (!entry) return;
    const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
    const curStage = activePipeline === 'opportunity' ? entry.jobStage : entry.status;
    if (curStage !== newStatus) {
      const now = Date.now();
      const changes = {
        [stageField]: newStatus,
        ...stageEnterTimestamp(entry, newStatus),
        ...backfillClearTimestamps(entry, newStatus),
      };
      const autoAction = defaultActionStatus(newStatus);
      if (autoAction) changes.actionStatus = autoAction;
      if (newStatus === 'applied' && !entry.appliedDate) changes.appliedDate = Date.now();
      updateCompany(draggingId, changes);
      if (activePipeline !== 'company') {
        const confettiConfig = getConfettiConfig(newStatus);
        if (confettiConfig) {
          fireConfetti(confettiConfig);
          const stageDef = customOpportunityStages.find(s => s.key === newStatus);
          showCelebrationBanner(stageDef?.label || newStatus, EMOJI_MAP[confettiConfig.type] || '🎊');
        }
      }
    }
  }

  // Drop onto cards area
  board.querySelectorAll('.kanban-cards').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => handleColDrop(col, e));
  });

  // Drop onto column header (always visible, even when scrolled deep)
  board.querySelectorAll('.kanban-col-header[data-status]').forEach(hdr => {
    hdr.addEventListener('dragover', (e) => {
      e.preventDefault(); hdr.classList.add('drag-over');
      // Auto-expand collapsed columns on drag hover
      const col = hdr.closest('.kanban-col');
      if (col?.classList.contains('collapsed')) {
        col.classList.remove('collapsed');
        _collapsedCols.delete(col.dataset.colKey);
        sessionStorage.setItem('ci_collapsed_cols', JSON.stringify([..._collapsedCols]));
      }
    });
    hdr.addEventListener('dragleave', () => hdr.classList.remove('drag-over'));
    hdr.addEventListener('drop', (e) => handleColDrop(hdr, e));
  });

  board.querySelectorAll('.card-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Remove ${allCompanies.find(c => c.id === btn.dataset.id)?.company || 'this entry'}?`)) {
        deleteCompany(btn.dataset.id);
      }
    });
  });

  board.querySelectorAll('.score-match-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const c = allCompanies.find(x => x.id === id);
      if (!c || !c.jobDescription) return;
      btn.disabled = true;
      btn.textContent = 'Scoring\u2026';
      chrome.storage.sync.get(['prefs'], ({ prefs }) => {
        chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
          const richContext = {
            intelligence: c.intelligence?.eli5 || c.oneLiner || null,
            reviews: c.reviews || [],
            emails: (c.cachedEmails || []).slice(0, 5).map(e => ({ date: e.date, subject: e.subject, from: e.from })),
            meetings: (c.cachedMeetings || []).slice(0, 3),
            transcript: c.cachedMeetingTranscript || null,
            notes: c.notes || null,
            knownComp: c.baseSalaryRange || c.oteTotalComp ? `Known comp: ${c.baseSalaryRange ? 'Base ' + c.baseSalaryRange : ''} ${c.oteTotalComp ? 'OTE ' + c.oteTotalComp : ''} ${c.equity ? 'Equity ' + c.equity : ''} (source: ${c.compSource || 'unknown'})`.trim() : null,
            matchFeedback: c.matchFeedback ? `User ${c.matchFeedback.type === 'up' ? 'agreed with' : 'disagreed with'} previous match assessment${c.matchFeedback.note ? ': "' + c.matchFeedback.note + '"' : ''}` : null,
          };
          chrome.runtime.sendMessage(
            { type: 'ANALYZE_JOB', company: c.company, jobTitle: c.jobTitle, jobDescription: c.jobDescription, prefs: prefs || {}, richContext },
            result => {
              void chrome.runtime.lastError;
              if (!result?.jobMatch) { btn.disabled = false; btn.textContent = 'Score match'; return; }
              const idx = allCompanies.findIndex(x => x.id === id);
              if (idx === -1) return;
              allCompanies[idx] = { ...allCompanies[idx], jobMatch: result.jobMatch, jobMatchScoredAt: Date.now() };
              if (result.jobSnapshot) {
                allCompanies[idx].jobSnapshot = result.jobSnapshot;
                const s = result.jobSnapshot;
                if (!allCompanies[idx].baseSalaryRange && (s.baseSalaryRange || (s.salaryType === 'base' && s.salary))) {
                  allCompanies[idx].baseSalaryRange = s.baseSalaryRange || s.salary;
                  allCompanies[idx].compSource = allCompanies[idx].compSource || 'Job posting';
                  allCompanies[idx].compAutoExtracted = true;
                }
                if (!allCompanies[idx].oteTotalComp && (s.oteTotalComp || (s.salaryType === 'ote' && s.salary))) {
                  allCompanies[idx].oteTotalComp = s.oteTotalComp || s.salary;
                }
                if (!allCompanies[idx].equity && s.equity) allCompanies[idx].equity = s.equity;
              }
              chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
                void chrome.runtime.lastError;
                render();
              });
            }
          );
        });
      });
    });
  });

  board.querySelectorAll('.card-notes').forEach(ta => {
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => updateCompany(ta.dataset.id, { notes: ta.value }));
  });

  board.querySelectorAll('.kanban-action-status').forEach(sel => {
    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('change', () => updateCompany(sel.dataset.id, { actionStatus: sel.value }));
  });

  board.querySelectorAll('.kanban-next-step-input').forEach(inp => {
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
    inp.addEventListener('blur', () => updateCompany(inp.dataset.id, { nextStep: inp.value }));
  });

  board.querySelectorAll('.kanban-next-step-date').forEach(inp => {
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
    inp.addEventListener('change', () => {
      inp.classList.toggle('has-value', !!inp.value);
      updateCompany(inp.dataset.id, { nextStepDate: inp.value });
    });
  });

  board.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      sel.dataset.status = sel.value;
      const field = sel.dataset.stageField || 'status';
      updateCompany(sel.dataset.id, { [field]: sel.value });
    });
  });

  board.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCompany(star.dataset.id, { rating: parseInt(star.dataset.val) });
    });
  });

  board.querySelectorAll('.add-opp-btn').forEach(btn => {
    btn.addEventListener('click', () => createOpportunityFromCompany(btn.dataset.id));
  });

  // Click card body → open full-screen view, or tinder DQ popup for Applied+ opportunities
  const firstTwoStages = new Set([QUEUE_STAGE, 'want_to_apply']);
  board.querySelectorAll('.kanban-card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, textarea, input, .card-tag, .star, .card-stars, details, summary')) return;
      const entry = allCompanies.find(c => c.id === cardEl.dataset.id);
      if (entry?.isOpportunity && !firstTwoStages.has(entry.jobStage || '')) {
        const w = 520, h = 760;
        const left = Math.round(screen.width / 2 - w / 2);
        const top = Math.round(screen.height / 2 - h / 2);
        window.open(chrome.runtime.getURL('queue.html') + `?mode=dq&id=${entry.id}`, '_blank', `width=${w},height=${h},left=${left},top=${top}`);
      } else {
        window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
      }
    });
  });

  // Re-score button for Coop's AI Scoring Queue
  board.querySelectorAll('.col-rescore-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const queueEntries = allCompanies.filter(c => {
        if (!c.isOpportunity || (c.jobStage || 'needs_review') !== QUEUE_STAGE) return false;
        return true; // re-score all entries in queue
      });
      if (!queueEntries.length) { btn.textContent = '✓ Queue empty'; setTimeout(() => btn.textContent = '↻ Re-score', 2000); return; }

      btn.disabled = true;
      let done = 0;
      const total = queueEntries.length;
      btn.textContent = `Scoring 0/${total}...`;

      // Mark all pending cards with a visual indicator
      queueEntries.forEach(entry => {
        const cardEl = document.getElementById('kcard-' + entry.id) || document.querySelector(`.compact-card[data-id="${entry.id}"]`);
        if (cardEl) cardEl.classList.add('rescore-pending');
      });

      // Process in batches of 2 with 2s delay
      for (let i = 0; i < queueEntries.length; i += 2) {
        const batch = queueEntries.slice(i, i + 2);
        // Mark current batch as actively scoring
        batch.forEach(entry => {
          const cardEl = document.getElementById('kcard-' + entry.id) || document.querySelector(`.compact-card[data-id="${entry.id}"]`);
          if (cardEl) { cardEl.classList.remove('rescore-pending'); cardEl.classList.add('rescore-active'); }
        });
        await Promise.all(batch.map(entry =>
          new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'QUICK_FIT_SCORE', entryId: entry.id }, result => {
              void chrome.runtime.lastError;
              const cardEl = document.getElementById('kcard-' + entry.id) || document.querySelector(`.compact-card[data-id="${entry.id}"]`);
              if (result && !result.error) {
                const idx = allCompanies.findIndex(c => c.id === entry.id);
                if (idx >= 0) {
                  if (result.quickFitScore != null) allCompanies[idx].quickFitScore = result.quickFitScore;
                  if (result.quickFitReason) allCompanies[idx].quickFitReason = result.quickFitReason;
                  if (result.quickTake) allCompanies[idx].quickTake = result.quickTake;
                  if (result.hardDQ) allCompanies[idx].hardDQ = result.hardDQ;
                }
                if (cardEl) { cardEl.classList.remove('rescore-active'); cardEl.classList.add('rescore-done'); }
              } else {
                if (cardEl) { cardEl.classList.remove('rescore-active'); cardEl.classList.add('rescore-failed'); }
              }
              done++;
              btn.textContent = `Scoring ${done}/${total}...`;
              resolve();
            });
          })
        ));
        if (i + 2 < queueEntries.length) await new Promise(r => setTimeout(r, 2000));
      }

      btn.disabled = false;
      btn.textContent = `✓ ${done} scored`;
      setTimeout(() => { btn.textContent = '↻ Re-score'; render(); }, 1500);
    });
  });

  // Column view toggle
  board.querySelectorAll('.col-view-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = btn.dataset.col;
      const cur = getColViewMode(col);
      setColViewMode(col, cur === 'compact' ? 'standard' : 'compact');
      render();
    });
  });

  // Color dot click → open color picker
  board.querySelectorAll('.col-color-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = dot.dataset.col;
      // Close any existing picker
      document.querySelectorAll('.col-color-picker').forEach(p => p.remove());

      const PRESET_COLORS = [
        '#64748b','#94a3b8','#374151','#1e293b',
        '#ef4444','#f87171','#dc2626','#b91c1c',
        '#f97316','#fb923c','#FF7A59','#ea580c',
        '#eab308','#facc15','#ca8a04','#a16207',
        '#22c55e','#4ade80','#16a34a','#15803d',
        '#14b8a6','#2dd4bf','#0d9488','#0f766e',
        '#06b6d4','#22d3ee','#0891b2','#0e7490',
        '#3b82f6','#60a5fa','#2563eb','#1d4ed8',
        '#8b5cf6','#a78bfa','#7c3aed','#6d28d9',
        '#ec4899','#f472b6','#db2777','#be185d',
      ];

      const currentColor = dot.style.background;
      const picker = document.createElement('div');
      picker.className = 'col-color-picker';
      picker.innerHTML = `
        <div class="color-grid">
          ${PRESET_COLORS.map(c => `<div class="color-swatch${c === currentColor ? ' selected' : ''}" style="background:${c}" data-color="${c}"></div>`).join('')}
        </div>
        <div class="color-custom-row">
          <span class="color-custom-label">Custom:</span>
          <input type="color" class="color-custom-input" value="${currentColor || '#64748b'}">
        </div>`;

      dot.closest('.kanban-col-header').appendChild(picker);

      function applyColor(newColor) {
        // Update storage
        const stageType = activePipeline === 'opportunity' ? 'opportunityStages' : 'companyStages';
        chrome.storage.local.get([stageType], data => {
          const stages = data[stageType] || [];
          const stage = stages.find(s => s.key === col);
          if (stage) {
            stage.color = newColor;
            chrome.storage.local.set({ [stageType]: stages }, () => {
              picker.remove();
              render(); // re-render the board
            });
          }
        });
      }

      picker.querySelectorAll('.color-swatch').forEach(sw => {
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          applyColor(sw.dataset.color);
        });
      });

      picker.querySelector('.color-custom-input').addEventListener('input', (e) => {
        // Live preview
        dot.style.background = e.target.value;
        dot.closest('.kanban-col-header').style.borderTopColor = e.target.value;
      });
      picker.querySelector('.color-custom-input').addEventListener('change', (e) => {
        applyColor(e.target.value);
      });

      // Close on outside click
      setTimeout(() => {
        document.addEventListener('click', function closePicker(ev) {
          if (!picker.contains(ev.target) && ev.target !== dot) {
            picker.remove();
            document.removeEventListener('click', closePicker);
          }
        });
      }, 0);
    });
  });

  // Compact card Apply button
  board.querySelectorAll('.compact-apply-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = allCompanies.find(c => c.id === id);
      if (!entry) return;
      const stages = currentStages();
      const curStage = entry.jobStage || 'needs_review';
      const curIdx = stages.findIndex(s => s.key === curStage);
      const nextStage = curIdx >= 0 && curIdx + 1 < stages.length ? stages[curIdx + 1].key : 'applied';
      const now = Date.now();
      const changes = {
        jobStage: nextStage,
        ...stageEnterTimestamp(entry, nextStage),
      };
      if (nextStage === 'applied') changes.appliedDate = now;
      const autoAction = defaultActionStatus(nextStage);
      if (autoAction) changes.actionStatus = autoAction;
      updateCompany(id, changes);
      // Trigger RESEARCH_COMPANY if no intelligence data
      if (!entry.intelligence) {
        chrome.runtime.sendMessage({ type: 'RESEARCH_COMPANY', companyId: id, company: entry.company, website: entry.companyWebsite || '' }, () => void chrome.runtime.lastError);
      }
      // Trigger ANALYZE_JOB for deep scoring
      if (entry.jobDescription) {
        chrome.storage.sync.get(['prefs'], ({ prefs }) => {
          chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
            const richContext = {
              intelligence: entry.intelligence?.eli5 || entry.oneLiner || null,
              reviews: entry.reviews || [],
              emails: (entry.cachedEmails || []).slice(0, 5).map(e => ({ date: e.date, subject: e.subject, from: e.from })),
              meetings: (entry.cachedMeetings || []).slice(0, 3),
              transcript: entry.cachedMeetingTranscript || null,
              notes: entry.notes || null,
              knownComp: entry.baseSalaryRange || entry.oteTotalComp ? `Known comp: ${entry.baseSalaryRange ? 'Base ' + entry.baseSalaryRange : ''} ${entry.oteTotalComp ? 'OTE ' + entry.oteTotalComp : ''} ${entry.equity ? 'Equity ' + entry.equity : ''} (source: ${entry.compSource || 'unknown'})`.trim() : null,
              matchFeedback: entry.matchFeedback ? `User ${entry.matchFeedback.type === 'up' ? 'agreed with' : 'disagreed with'} previous match assessment${entry.matchFeedback.note ? ': "' + entry.matchFeedback.note + '"' : ''}` : null,
            };
            chrome.runtime.sendMessage(
              { type: 'ANALYZE_JOB', company: entry.company, jobTitle: entry.jobTitle, jobDescription: entry.jobDescription, prefs: prefs || {}, richContext },
              result => {
                void chrome.runtime.lastError;
                if (!result?.jobMatch) return;
                const idx = allCompanies.findIndex(x => x.id === id);
                if (idx === -1) return;
                allCompanies[idx] = { ...allCompanies[idx], jobMatch: result.jobMatch, jobMatchScoredAt: Date.now() };
                if (result.jobSnapshot) {
                  allCompanies[idx].jobSnapshot = result.jobSnapshot;
                  const s = result.jobSnapshot;
                  if (!allCompanies[idx].baseSalaryRange && (s.baseSalaryRange || (s.salaryType === 'base' && s.salary))) {
                    allCompanies[idx].baseSalaryRange = s.baseSalaryRange || s.salary;
                    allCompanies[idx].compSource = allCompanies[idx].compSource || 'Job posting';
                    allCompanies[idx].compAutoExtracted = true;
                  }
                  if (!allCompanies[idx].oteTotalComp && (s.oteTotalComp || (s.salaryType === 'ote' && s.salary))) {
                    allCompanies[idx].oteTotalComp = s.oteTotalComp || s.salary;
                  }
                  if (!allCompanies[idx].equity && s.equity) allCompanies[idx].equity = s.equity;
                }
                chrome.storage.local.set({ savedCompanies: allCompanies }, () => { void chrome.runtime.lastError; render(); });
              }
            );
          });
        });
      }
    });
  });

  // Compact card Dismiss button
  board.querySelectorAll('.compact-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = allCompanies.find(c => c.id === id);
      if (!entry) return;
      const existingTags = entry.tags || [];
      const tags = existingTags.includes(DISMISS_TAG) ? existingTags : [...existingTags, DISMISS_TAG];
      updateCompany(id, {
        jobStage: DISMISS_STAGE,
        tags,
        ...stageEnterTimestamp(entry, DISMISS_STAGE),
      });
    });
  });

  // Compact card click — open score preview modal (queue cards) or full page (others)
  board.querySelectorAll('.compact-card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      const entry = allCompanies.find(c => c.id === cardEl.dataset.id);
      if (!entry) return;
      if (entry.jobMatch?.score != null || entry.quickFitScore != null) {
        openScoreModal(entry);
      } else {
        window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
      }
    });
  });

  // Compact card drag-and-drop
  board.querySelectorAll('.compact-card').forEach(card => {
    card.addEventListener('mousedown', (e) => {
      dragAllowed = !e.target.closest('button, a');
    });
    card.addEventListener('dragstart', (e) => {
      if (!dragAllowed) { e.preventDefault(); return; }
      draggingId = card.dataset.id;
      card.style.opacity = '0.35';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '';
      draggingId = null;
      dragAllowed = false;
      board.querySelectorAll('.kanban-cards, .kanban-col-header').forEach(el => el.classList.remove('drag-over'));
    });
  });

  // Tag remove
  board.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = allCompanies.find(c => c.id === el.dataset.id);
      if (!entry) return;
      updateCompany(el.dataset.id, { tags: (entry.tags || []).filter(t => t !== el.dataset.tag) });
      updateTagsToolbar();
    });
  });

  // Tag color edit
  board.querySelectorAll('.card-tag').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tag-remove')) return;
      e.stopPropagation();
      const tag = el.dataset.tag;
      const currIdx = customTagColors[tag] !== undefined ? customTagColors[tag] : tagColorIndex(tag);
      showColorPicker(el, TAG_PALETTE.map(p => p.border), currIdx, (idx) => saveTagColor(tag, idx));
    });
  });

  // Tag add button
  board.querySelectorAll('.tag-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const wrap = document.getElementById(`tag-add-wrap-${id}`);
      wrap.innerHTML = `<input class="tag-inline-input" id="tag-input-${id}" placeholder="tag name" autocomplete="off"><div class="tag-suggestions-inline" id="tag-sugg-${id}" style="display:none"></div>`;
      const input = document.getElementById(`tag-input-${id}`);
      const sugg = document.getElementById(`tag-sugg-${id}`);
      input.focus();
      input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        const entry = allCompanies.find(c => c.id === id);
        const existing = entry?.tags || [];
        if (!val) { sugg.style.display = 'none'; return; }
        const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !existing.includes(t));
        if (matches.length === 0) { sugg.style.display = 'none'; return; }
        sugg.innerHTML = matches.slice(0, 5).map(t => `<div class="tag-suggestion-inline" data-tag="${t}">${t}</div>`).join('');
        sugg.style.display = 'block';
        sugg.querySelectorAll('.tag-suggestion-inline').forEach(s => {
          s.addEventListener('mousedown', (e) => { e.preventDefault(); commitTag(id, s.dataset.tag); });
        });
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const val = input.value.trim(); if (val) commitTag(id, val); }
        if (e.key === 'Escape') { render(); }
      });
      input.addEventListener('blur', () => setTimeout(() => { if (document.getElementById(`tag-input-${id}`)) render(); }, 200));
    });
  });

  // Swipe-to-triage for ALL scoring queue cards
  if (activePipeline === 'opportunity') {
    const stages = currentStages();
    const queueKey = stages[0]?.key || QUEUE_STAGE;
    const interestedKey = stages[1]?.key || 'want_to_apply';
    const queueCardsContainer = board.querySelector(`.kanban-cards[data-status="${queueKey}"]`);

    if (queueCardsContainer) {
      const COMMIT_RATIO = 0.4;
      const interactiveSelector = 'textarea, input, select, a, button, summary, details, .card-tag, .star, .card-stars, .tag-remove, .tag-add-btn, .card-notes, .kanban-action-status, .kanban-next-step-input, .kanban-next-step-date, .status-select, .add-opp-btn, .card-delete, .score-match-btn, .compact-apply-btn, .compact-dismiss-btn';
      const colRect = () => queueCardsContainer.closest('.kanban-col')?.getBoundingClientRect();

      // Bind swipe to ALL cards in the queue column
      queueCardsContainer.querySelectorAll('.kanban-card, .compact-card').forEach(card => {
        let startX = 0, startY = 0, deltaX = 0, deltaY = 0, isSwiping = false, directionLocked = false;

        // Prevent native HTML5 drag on queue cards — it steals pointer events
        card.setAttribute('draggable', 'false');
        card.style.touchAction = 'pan-y'; // allow vertical scroll, block horizontal browser gestures

        card.addEventListener('pointerdown', e => {
          if (e.target.closest(interactiveSelector)) return;
          startX = e.clientX; startY = e.clientY;
          deltaX = 0; deltaY = 0; isSwiping = false; directionLocked = false;
          card.setPointerCapture(e.pointerId);
        });

        card.addEventListener('pointermove', e => {
          if (startX === 0 && startY === 0) return;
          deltaX = e.clientX - startX; deltaY = e.clientY - startY;
          if (!directionLocked && Math.abs(deltaX) < 3 && Math.abs(deltaY) < 3) return;
          if (!directionLocked) {
            directionLocked = true;
            if (Math.abs(deltaY) > Math.abs(deltaX)) { startX = 0; startY = 0; return; }
            isSwiping = true;
            card.classList.add('swiping');
            // Inject overlays if not present
            if (!card.querySelector('.swipe-overlay')) {
              card.style.position = 'relative';
              card.insertAdjacentHTML('afterbegin', `
                <div class="swipe-overlay right" style="opacity:0"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg><span class="swipe-label">Interested</span></div>
                <div class="swipe-overlay left" style="opacity:0"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg><span class="swipe-label">Pass</span></div>
              `);
            }
          }
          if (!isSwiping) return;
          e.preventDefault();
          const rotation = Math.max(-8, Math.min(8, deltaX * 0.06));
          card.style.transform = `translateX(${deltaX}px) rotate(${rotation}deg)`;
          card.style.transformOrigin = 'center bottom';
          const threshold = queueCardsContainer.offsetWidth * COMMIT_RATIO;
          const progress = Math.min(1, Math.abs(deltaX) / threshold);
          const rightOv = card.querySelector('.swipe-overlay.right');
          const leftOv = card.querySelector('.swipe-overlay.left');
          // Board parallax shift — push board right when swiping left to create exit space
          const boardEl = document.getElementById('kanban-board');
          if (boardEl) {
            if (deltaX < -10) {
              const shift = Math.min(40, Math.abs(deltaX) * 0.15);
              boardEl.style.transform = `translateX(${shift}px)`;
              boardEl.style.transition = 'transform 0.1s ease-out';
            } else {
              boardEl.style.transform = '';
            }
          }
          if (deltaX > 10) {
            if (rightOv) rightOv.style.opacity = progress * 0.85;
            if (leftOv) leftOv.style.opacity = 0;
            card.style.background = ''; card.style.borderLeftColor = ''; card.style.boxShadow = '';
          } else if (deltaX < -10) {
            if (leftOv) { leftOv.style.opacity = progress * 0.85; const icon = leftOv.querySelector('svg'); if (icon) icon.style.transform = `scale(${0.5 + progress * 0.7})`; }
            if (rightOv) rightOv.style.opacity = 0;
            // Progressive red tint, border, shadow
            const r = Math.min(0.18, progress * 0.18);
            card.style.background = `rgba(229,72,59,${r})`;
            card.style.borderLeftColor = progress > 0.3 ? `rgba(229,72,59,${0.3 + progress * 0.7})` : '';
            card.style.boxShadow = progress > 0.5 ? `0 0 ${progress * 20}px rgba(229,72,59,${progress * 0.15})` : '';
          } else {
            if (rightOv) rightOv.style.opacity = 0; if (leftOv) leftOv.style.opacity = 0;
            card.style.background = ''; card.style.borderLeftColor = ''; card.style.boxShadow = '';
          }
        });

        card.addEventListener('pointerup', () => {
          // Reset board parallax
          const boardEl = document.getElementById('kanban-board');
          if (boardEl) { boardEl.style.transition = 'transform 0.3s ease-out'; boardEl.style.transform = ''; setTimeout(() => boardEl.style.transition = '', 300); }
          if (!isSwiping) { startX = 0; startY = 0; return; }
          card.classList.remove('swiping');
          const threshold = queueCardsContainer.offsetWidth * COMMIT_RATIO;
          const entryId = card.dataset.id;

          // Check: did the card cross past the column edges?
          const cr = colRect();
          const cardCenter = card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2;
          const pastLeftEdge = cr && cardCenter < cr.left;
          const pastRightEdge = cr && cardCenter > cr.right;

          if ((Math.abs(deltaX) > threshold || pastLeftEdge || pastRightEdge) && entryId) {
            const direction = deltaX > 0 ? 1 : -1;
            if (direction < 0) {
              // Dismiss: arc down + tilt + shrink + fade
              card.classList.add('fly-out-dismiss');
              card.style.transform = `translateX(-600px) translateY(30px) rotate(-8deg) scale(0.95)`;
              card.style.opacity = '0';
            } else {
              card.classList.add('fly-out');
              card.style.transform = `translateX(600px) rotate(15deg)`;
              card.style.opacity = '0';
            }
            setTimeout(() => {
              const entry = allCompanies.find(c => c.id === entryId);
              if (!entry) return;
              const now = Date.now();
              if (direction > 0) {
                const ts = { ...(entry.stageTimestamps || {}) }; ts[interestedKey] = now;
                const changes = { jobStage: interestedKey, stageTimestamps: ts };
                const autoAction = defaultActionStatus(interestedKey);
                if (autoAction) changes.actionStatus = autoAction;
                updateCompany(entryId, changes);
              } else {
                const ts = { ...(entry.stageTimestamps || {}) }; ts[DISMISS_STAGE] = now;
                const tags = [...new Set([...(entry.tags || []), DISMISS_TAG])];
                if (!allKnownTags.includes(DISMISS_TAG)) { allKnownTags.push(DISMISS_TAG); chrome.storage.local.set({ allTags: allKnownTags }); }
                const changes = { jobStage: DISMISS_STAGE, stageTimestamps: ts, tags };
                const autoAction = defaultActionStatus(DISMISS_STAGE);
                if (autoAction) changes.actionStatus = autoAction;
                updateCompany(entryId, changes);
              }
            }, 300);
          } else {
            card.classList.add('snap-back');
            card.style.transform = '';
            card.style.background = ''; card.style.borderLeftColor = ''; card.style.boxShadow = '';
            const rightOv = card.querySelector('.swipe-overlay.right');
            const leftOv = card.querySelector('.swipe-overlay.left');
            if (rightOv) rightOv.style.opacity = 0;
            if (leftOv) leftOv.style.opacity = 0;
            setTimeout(() => card.classList.remove('snap-back'), 250);
          }
          startX = 0; startY = 0; isSwiping = false; directionLocked = false;
        });

        card.addEventListener('click', e => { if (Math.abs(deltaX) > 5) { e.stopPropagation(); e.preventDefault(); } }, true);
      });
    }
  }
}

// View toggle
function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('ci_viewMode', mode);
  document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
  const btnId = mode === 'kanban' ? 'view-kanban-btn' : mode === 'tasks' ? 'view-tasks-btn' : 'view-grid-btn';
  document.getElementById(btnId)?.classList.add('active');

  const grid = document.getElementById('grid');
  const kanban = document.getElementById('kanban-board');
  const tasks = document.getElementById('tasks-view');
  // Show/hide toolbars for CRM views vs tasks
  document.querySelectorAll('.toolbar').forEach(t => t.style.display = mode === 'tasks' ? 'none' : '');
  document.getElementById('activity-section').style.display = mode === 'tasks' ? 'none' : '';

  if (mode === 'tasks') {
    grid.style.display = 'none';
    kanban.style.display = 'none';
    tasks.style.display = '';
    renderTasksView();
  } else {
    tasks.style.display = 'none';
    render();
  }
}
document.getElementById('view-grid-btn').addEventListener('click', () => setViewMode('grid'));
document.getElementById('view-kanban-btn').addEventListener('click', () => setViewMode('kanban'));
document.getElementById('view-tasks-btn').addEventListener('click', () => setViewMode('tasks'));
document.getElementById('header-tasks-link')?.addEventListener('click', e => { e.preventDefault(); setViewMode('tasks'); });
// Restore toggle state on load
if (viewMode === 'kanban') {
  document.getElementById('view-kanban-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
} else if (viewMode === 'tasks') {
  document.getElementById('view-tasks-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
}

// ── Tasks ──────────────────────────────────────────────────────────────────

let _taskFilter = 'active'; // active | completed | all

function loadTasks(callback) {
  chrome.storage.local.get(['userTasks'], data => {
    callback(data.userTasks || []);
  });
}

function saveTasks(tasks, callback) {
  chrome.storage.local.set({ userTasks: tasks }, () => {
    void chrome.runtime.lastError;
    if (callback) callback();
  });
}

function taskDateLabel(dateStr) {
  if (!dateStr) return { text: '', cls: '' };
  const d = new Date(dateStr + 'T12:00:00');
  const now = new Date(); now.setHours(12,0,0,0);
  const diff = Math.round((d - now) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'overdue' };
  if (diff === 0) return { text: 'Today', cls: 'today' };
  if (diff === 1) return { text: 'Tomorrow', cls: 'upcoming' };
  return { text: `in ${diff}d`, cls: 'upcoming' };
}

function renderTasksView() {
  const container = document.getElementById('tasks-view');
  if (!container) return;

  loadTasks(tasks => {
    // Sort: overdue first, then by date, then by priority (high > normal > low)
    const priVal = p => p === 'high' ? 0 : p === 'normal' ? 1 : 2;
    const sorted = [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const da = a.dueDate || '9999-12-31', db = b.dueDate || '9999-12-31';
      if (da !== db) return da.localeCompare(db);
      return priVal(a.priority) - priVal(b.priority);
    });

    const filtered = _taskFilter === 'all' ? sorted
      : _taskFilter === 'completed' ? sorted.filter(t => t.completed)
      : sorted.filter(t => !t.completed);

    const activeCount = tasks.filter(t => !t.completed).length;
    const completedCount = tasks.filter(t => t.completed).length;
    const unreviewedCount = tasks.filter(t => t.source === 'email' && !t.reviewed && !t.completed).length;

    container.innerHTML = `
      <div class="tasks-header">
        <div class="tasks-title">Tasks${unreviewedCount ? ` <span style="background:#FF7A59;color:#fff;border-radius:10px;padding:2px 8px;font-size:11px;margin-left:6px;vertical-align:middle">${unreviewedCount} new</span>` : ''}</div>
        <button class="tasks-add-btn" id="task-add-btn">+ New Task</button>
      </div>
      <div id="task-form-container"></div>
      <div class="task-filters">
        <button class="task-filter-btn ${_taskFilter === 'active' ? 'active' : ''}" data-filter="active">Active (${activeCount})</button>
        <button class="task-filter-btn ${_taskFilter === 'completed' ? 'active' : ''}" data-filter="completed">Completed (${completedCount})</button>
        <button class="task-filter-btn ${_taskFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      </div>
      <div class="task-list">${filtered.map(t => {
        const dl = taskDateLabel(t.dueDate);
        const isAuto = t.source === 'email';
        const unreviewed = isAuto && !t.reviewed && !t.completed;
        return `<div class="task-item ${t.completed ? 'completed' : ''}" data-task-id="${t.id}" style="${unreviewed ? 'border-left:3px solid #FF7A59;' : ''}">
          <div class="task-check">${t.completed ? '✓' : ''}</div>
          <div class="task-content">
            <div class="task-text">${escHtml(t.text)}</div>
            <div class="task-meta">
              ${t.company ? `<span class="task-company-link" data-company="${escHtml(t.company)}">${escHtml(t.company)}</span>` : ''}
              <span class="task-priority ${t.priority || 'normal'}">${(t.priority || 'normal')}</span>
              ${isAuto ? `<span class="task-priority" style="background:#FFF1EC;color:#FF7A59">from email</span>` : ''}
              ${t.dueDate ? `<span>${t.dueDate}</span>` : ''}
              ${unreviewed ? `<a href="#" class="task-keep" style="color:#FF7A59;font-weight:600">keep</a> · <a href="#" class="task-dismiss" style="color:#7c98b6">dismiss</a>` : ''}
            </div>
            ${isAuto && t.rationale ? `<div style="font-size:11px;color:#7c98b6;font-style:italic;margin-top:2px">"${escHtml(t.rationale)}"</div>` : ''}
          </div>
          ${dl.text ? `<span class="task-date ${dl.cls}">${dl.text}</span>` : ''}
          <button class="task-delete-btn" data-task-id="${t.id}">&times;</button>
        </div>`;
      }).join('') || '<div style="text-align:center;color:#7c98b6;padding:40px;font-size:13px;">No tasks yet — click "+ New Task" to add one</div>'}</div>`;

    // Wire events
    container.querySelector('#task-add-btn')?.addEventListener('click', () => showTaskForm());
    container.querySelectorAll('.task-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => { _taskFilter = btn.dataset.filter; renderTasksView(); });
    });
    container.querySelectorAll('.task-check').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.closest('.task-item').dataset.taskId;
        loadTasks(tasks => {
          const t = tasks.find(t => t.id === id);
          if (t) { t.completed = !t.completed; saveTasks(tasks, () => renderTasksView()); }
        });
      });
    });
    container.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.taskId;
        loadTasks(tasks => {
          saveTasks(tasks.filter(t => t.id !== id), () => renderTasksView());
        });
      });
    });
    container.querySelectorAll('.task-keep').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const id = el.closest('.task-item').dataset.taskId;
        loadTasks(tasks => {
          const t = tasks.find(t => t.id === id);
          if (t) { t.reviewed = true; saveTasks(tasks, () => renderTasksView()); }
        });
      });
    });
    container.querySelectorAll('.task-dismiss').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const id = el.closest('.task-item').dataset.taskId;
        loadTasks(tasks => {
          const t = tasks.find(t => t.id === id);
          if (t) { t.reviewed = true; t.completed = true; saveTasks(tasks, () => renderTasksView()); }
        });
      });
    });
    container.querySelectorAll('.task-company-link').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.company;
        const entry = allCompanies.find(c => c.company === name);
        if (entry) window.open(`company.html?id=${entry.id}`, '_blank');
      });
    });
  });
}

function showTaskForm(editTask) {
  const fc = document.getElementById('task-form-container');
  if (!fc) return;

  // Build company options from pipeline
  const companyOpts = allCompanies
    .filter(c => c.company)
    .map(c => `<option value="${escHtml(c.company)}" ${editTask?.company === c.company ? 'selected' : ''}>${escHtml(c.company)}</option>`)
    .join('');

  fc.innerHTML = `
    <div class="task-form">
      <input type="text" class="task-form-input" id="task-input-text" placeholder="What needs to be done?" value="${escHtml(editTask?.text || '')}">
      <div class="task-form-row">
        <select class="task-form-select" id="task-input-company">
          <option value="">No company</option>
          ${companyOpts}
        </select>
        <input type="date" class="task-form-input" id="task-input-date" style="max-width:160px" value="${editTask?.dueDate || ''}">
        <div class="task-priority-group" id="task-input-priority">
          <button type="button" class="task-priority-btn ${editTask?.priority === 'low' ? 'active' : ''}" data-pri="low">Low</button>
          <button type="button" class="task-priority-btn ${(!editTask || editTask?.priority === 'normal') ? 'active' : ''}" data-pri="normal">Normal</button>
          <button type="button" class="task-priority-btn ${editTask?.priority === 'high' ? 'active' : ''}" data-pri="high">High</button>
        </div>
      </div>
      <div class="task-form-actions">
        <button class="task-form-save" id="task-save-btn">${editTask ? 'Update' : 'Add Task'}</button>
        <button class="task-form-cancel" id="task-cancel-btn">Cancel</button>
      </div>
    </div>`;

  fc.querySelector('#task-input-text')?.focus();

  // Priority button group
  fc.querySelectorAll('.task-priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fc.querySelectorAll('.task-priority-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  fc.querySelector('#task-save-btn').addEventListener('click', () => {
    const text = fc.querySelector('#task-input-text').value.trim();
    if (!text) return;
    const company = fc.querySelector('#task-input-company').value;
    const dueDate = fc.querySelector('#task-input-date').value;
    const priority = fc.querySelector('.task-priority-btn.active')?.dataset.pri || 'normal';

    loadTasks(tasks => {
      if (editTask) {
        const t = tasks.find(t => t.id === editTask.id);
        if (t) { Object.assign(t, { text, company, dueDate, priority }); }
      } else {
        tasks.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text, company: company || null, companyId: null,
          dueDate: dueDate || null, priority,
          completed: false, createdAt: Date.now()
        });
      }
      saveTasks(tasks, () => { fc.innerHTML = ''; renderTasksView(); });
    });
  });
  fc.querySelector('#task-cancel-btn').addEventListener('click', () => { fc.innerHTML = ''; });
}

// escHtml for tasks — use escHtmlGlobal if no local one in scope
if (typeof escHtml === 'undefined') { var escHtml = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Restore pipeline state on load (updatePipelineUI is defined later, call after DOM ready)
document.addEventListener('DOMContentLoaded', () => {}, { once: true });
// Pipeline UI is initialized via updatePipelineUI() called from load()

// Stage editor
const STAGE_COLOR_PALETTE = ['#64748b','#22d3ee','#60a5fa','#a78bfa','#fb923c','#a3e635','#4ade80','#f87171','#f59e0b','#e879f9','#34d399','#f472b6'];
let stageEditorOpen = false;
let stageEditorTab = 'stages'; // 'stages' | 'celebrations'
let editingStages = [];

function openStageEditor() {
  if (activePipeline === 'all') return;
  editingStages = currentStages().map(s => ({ ...s }));
  const pipelineName = activePipeline === 'company' ? 'Company Pipeline' : 'Opportunity Pipeline';
  document.getElementById('stage-editor-title').textContent = `Edit ${pipelineName} Stages`;
  document.getElementById('stage-editor-subtitle').textContent = `Rename, recolor, reorder, or add stages for the ${pipelineName}`;
  // Celebrations tab only shown for opportunity pipeline
  const tabsEl = document.getElementById('stage-editor-tabs');
  tabsEl.querySelector('[data-tab="celebrations"]').style.display = activePipeline === 'opportunity' ? '' : 'none';
  switchStageEditorTab('stages');
  document.getElementById('stage-editor-modal').style.display = 'flex';
  stageEditorOpen = true;
}
function closeStageEditor() {
  document.getElementById('stage-editor-modal').style.display = 'none';
  stageEditorOpen = false;
}
function switchStageEditorTab(tab) {
  stageEditorTab = tab;
  document.querySelectorAll('.stage-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('stage-editor-list').style.display         = tab === 'stages'       ? '' : 'none';
  document.getElementById('stage-celebrations-list').style.display   = tab === 'celebrations' ? '' : 'none';
  document.getElementById('stage-editor-add').style.display          = tab === 'stages'       ? '' : 'none';
  document.getElementById('stage-editor-save').textContent           = tab === 'stages'       ? 'Save Stages' : 'Save Celebrations';
  if (tab === 'stages')       renderStageEditor();
  if (tab === 'celebrations') renderCelebrationEditor();
}
function saveStages() {
  const saved = editingStages.filter(s => s.label.trim());
  if (activePipeline === 'company') {
    customCompanyStages = saved;
    chrome.storage.local.set({ companyStages: saved }, () => {
      updateStageDynamicCSS(); updateStatusToolbar(); render(); closeStageEditor();
    });
  } else {
    customOpportunityStages = saved;
    chrome.storage.local.set({ opportunityStages: saved }, () => {
      updateStageDynamicCSS(); updateStatusToolbar(); render(); closeStageEditor();
    });
  }
}
function saveCelebrations() {
  chrome.storage.local.set({ stageCelebrations }, closeStageEditor);
}

function renderCelebrationEditor() {
  const list = document.getElementById('stage-celebrations-list');
  const stages = customOpportunityStages;

  list.innerHTML = `
    <div style="font-size:12px;color:#7c98b6;padding:4px 4px 8px;line-height:1.5">
      Set the confetti and sound for each stage. Stages with no custom setting use smart defaults.
    </div>
    ${stages.map(s => {
      const isCustom = !!stageCelebrations[s.key];
      const cfg = stageCelebrations[s.key] || getDefaultCelebration(s.key);
      const confettiVal = cfg.confetti || 'none';
      const soundVal    = cfg.sound    || 'none';
      const confettiOpts = CONFETTI_OPTIONS.map(o =>
        `<option value="${o.value}"${confettiVal === o.value ? ' selected' : ''}>${o.label}</option>`
      ).join('');
      const soundOpts = SOUND_OPTIONS.map(o =>
        `<option value="${o.value}"${soundVal === o.value ? ' selected' : ''}>${o.label}</option>`
      ).join('');
      return `<div class="celeb-row" data-key="${s.key}">
        <span class="celeb-stage-dot" style="background:${s.color}"></span>
        <span class="celeb-stage-name">${s.label}${!isCustom ? '<span class="celeb-default-badge">default</span>' : ''}</span>
        <span class="celeb-pair">
          <select class="celeb-select" data-key="${s.key}" data-field="confetti">${confettiOpts}</select>
          <button type="button" class="celeb-preview-btn" data-preview="confetti" data-key="${s.key}" title="Preview confetti"${confettiVal === 'none' ? ' disabled' : ''}>▶</button>
        </span>
        <span class="celeb-pair">
          <select class="celeb-select" data-key="${s.key}" data-field="sound">${soundOpts}</select>
          <button type="button" class="celeb-preview-btn" data-preview="sound" data-key="${s.key}" title="Preview sound"${soundVal === 'none' ? ' disabled' : ''}>▶</button>
        </span>
      </div>`;
    }).join('')}
    <div style="padding:8px 4px 2px">
      <button id="celeb-reset-btn" style="font-size:11px;color:#b0c1d4;background:none;border:none;cursor:pointer;padding:0;font-family:inherit">↺ Reset all to defaults</button>
    </div>`;

  list.querySelectorAll('.celeb-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const key   = sel.dataset.key;
      const field = sel.dataset.field;
      if (!stageCelebrations[key]) stageCelebrations[key] = { ...getDefaultCelebration(key) };
      stageCelebrations[key][field] = sel.value;
      renderCelebrationEditor();
    });
  });

  list.querySelectorAll('.celeb-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const which = btn.dataset.preview;
      const cfg = stageCelebrations[key] || getDefaultCelebration(key);
      if (which === 'sound') {
        playSound(cfg.sound || 'none');
      } else if (which === 'confetti') {
        const type = cfg.confetti || 'none';
        if (type === 'none') return;
        // Preview the visual silently (don't double-trigger sound)
        fireConfetti({ type, sound: 'none', count: type === 'confetti' ? 80 : 25 });
      }
    });
  });

  list.querySelector('#celeb-reset-btn')?.addEventListener('click', () => {
    stageCelebrations = {};
    renderCelebrationEditor();
  });
}

function renderStageEditor() {
  const list = document.getElementById('stage-editor-list');
  list.innerHTML = editingStages.map((s, i) => `
    <div class="stage-row" data-i="${i}">
      <span class="stage-drag-handle">⠿</span>
      <button class="stage-color-swatch" data-i="${i}" style="background:${s.color};border-color:${s.color}" title="Click to change color"></button>
      <input class="stage-label-input" data-i="${i}" value="${s.label}" placeholder="Stage name">
      <div style="display:flex;gap:4px">
        <button class="stage-move-btn" data-i="${i}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="stage-move-btn" data-i="${i}" data-dir="1" title="Move down" ${i === editingStages.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <button class="stage-delete-btn" data-i="${i}" title="Delete stage">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.stage-label-input').forEach(inp => {
    inp.addEventListener('input', () => { editingStages[inp.dataset.i].label = inp.value; });
  });
  list.querySelectorAll('.stage-color-swatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.i);
      const currIdx = STAGE_COLOR_PALETTE.indexOf(editingStages[i].color);
      showColorPicker(btn, STAGE_COLOR_PALETTE, currIdx === -1 ? 0 : currIdx, (idx) => {
        editingStages[i].color = STAGE_COLOR_PALETTE[idx];
        btn.style.background = STAGE_COLOR_PALETTE[idx];
        btn.style.borderColor = STAGE_COLOR_PALETTE[idx];
      });
    });
  });
  list.querySelectorAll('.stage-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i), dir = parseInt(btn.dataset.dir);
      const j = i + dir;
      if (j < 0 || j >= editingStages.length) return;
      [editingStages[i], editingStages[j]] = [editingStages[j], editingStages[i]];
      renderStageEditor();
    });
  });
  list.querySelectorAll('.stage-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      if (editingStages.length <= 1) return;
      editingStages.splice(i, 1);
      renderStageEditor();
    });
  });
}
document.getElementById('stage-editor-add').addEventListener('click', () => {
  editingStages.push({ key: 'stage_' + Date.now(), label: 'New Stage', color: STAGE_COLOR_PALETTE[editingStages.length % STAGE_COLOR_PALETTE.length] });
  renderStageEditor();
});
document.getElementById('stage-editor-save').addEventListener('click', () => {
  if (stageEditorTab === 'celebrations') saveCelebrations();
  else saveStages();
});
document.getElementById('stage-editor-close').addEventListener('click', closeStageEditor);
document.getElementById('stage-editor-tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) switchStageEditorTab(btn.dataset.tab);
});
document.getElementById('stage-editor-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('stage-editor-modal')) closeStageEditor();
});
document.getElementById('edit-stages-btn').addEventListener('click', openStageEditor);
document.getElementById('queue-header-btn')?.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('queue.html'), '_blank');
});
document.getElementById('apply-header-btn')?.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('queue.html?mode=apply'), '_blank');
});

// Search
document.getElementById('search').addEventListener('input', render);

// Pipeline buttons
function updatePipelineUI() {
  document.getElementById('pipeline-all-btn').classList.toggle('active', activePipeline === 'all');
  document.getElementById('pipeline-opp-btn').classList.toggle('active', activePipeline === 'opportunity');
  document.getElementById('pipeline-co-btn').classList.toggle('active',  activePipeline === 'company');

  const isAll = activePipeline === 'all';

  // Kanban is only meaningful inside a specific pipeline
  const kanbanBtn = document.getElementById('view-kanban-btn');
  if (kanbanBtn) {
    kanbanBtn.disabled = isAll;
    kanbanBtn.style.opacity = isAll ? '0.3' : '1';
    kanbanBtn.title = isAll ? 'Select a pipeline to use Kanban view' : '';
  }

  // Edit Stages only applies to a specific pipeline
  const editBtn = document.getElementById('edit-stages-btn');
  if (editBtn) {
    editBtn.style.opacity = isAll ? '0.35' : '1';
    editBtn.title = isAll ? 'Select a pipeline to edit its stages' : 'Edit pipeline stages';
  }

  const header = document.getElementById('pipeline-header');
  const headerText = document.getElementById('pipeline-header-text');
  if (header && headerText) {
    if (activePipeline === 'opportunity') {
      headerText.textContent = 'Opportunity Pipeline';
      header.style.display = '';
    } else if (activePipeline === 'company') {
      headerText.textContent = 'Saved Company Pipeline';
      header.style.display = '';
    } else {
      header.style.display = 'none';
    }
  }
}

[
  ['pipeline-all-btn', 'all'],
  ['pipeline-opp-btn', 'opportunity'],
  ['pipeline-co-btn',  'company'],
].forEach(([id, pipeline]) => {
  document.getElementById(id).addEventListener('click', () => {
    activePipeline = pipeline;
    localStorage.setItem('ci_activePipeline', activePipeline);
    activeStatus = 'all';
    // Kanban doesn't apply to "All Saved" — drop back to grid
    if (pipeline === 'all' && viewMode === 'kanban') {
      viewMode = 'grid';
      localStorage.setItem('ci_viewMode', 'grid');
      document.getElementById('view-grid-btn').classList.add('active');
      document.getElementById('view-kanban-btn').classList.remove('active');
    }
    updatePipelineUI();
    updateStatusToolbar();
    render();
  });
});

// Rating dropdown
(function() {
  const dropBtn  = document.getElementById('rating-dropdown-btn');
  const dropMenu = document.getElementById('rating-dropdown-menu');
  const dropLabel = document.getElementById('rating-dropdown-label');
  const clearBtn = document.getElementById('rating-clear-btn');

  function updateRatingLabel() {
    if (activeRatings.size === 0) {
      dropLabel.textContent = 'Any Excitement';
      dropBtn.classList.remove('active');
    } else {
      const stars = ['★','★★','★★★','★★★★','★★★★★'];
      const parts = [5,4,3,2,1,0]
        .filter(v => activeRatings.has(v))
        .map(v => v === 0 ? 'Unrated' : stars[v-1]);
      dropLabel.textContent = parts.join(', ');
      dropBtn.classList.add('active');
    }
  }

  dropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropMenu.classList.toggle('open');
    dropBtn.classList.toggle('open', open);
    if (open) {
      const r = dropBtn.getBoundingClientRect();
      dropMenu.style.top  = (r.bottom + 6) + 'px';
      dropMenu.style.left = r.left + 'px';
    }
  });

  dropMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const val = parseInt(cb.value);
      if (cb.checked) activeRatings.add(val);
      else activeRatings.delete(val);
      updateRatingLabel();
      render();
    });
  });

  clearBtn.addEventListener('click', () => {
    activeRatings.clear();
    dropMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateRatingLabel();
    render();
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('rating-dropdown').contains(e.target)) {
      dropMenu.classList.remove('open');
      dropBtn.classList.remove('open');
    }
  });

});


// ── Activity & Goals ─────────────────────────────────────────────────────────

function getPeriodRange(period) {
  // Custom range overrides auto-calculation
  if (activityCustomRange) {
    const s = new Date(activityCustomRange.start + 'T00:00:00');
    const e = new Date(activityCustomRange.end   + 'T23:59:59');
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start: s.getTime(), end: e.getTime(), label: `${fmt(s)} – ${fmt(e)}`, custom: true };
  }
  const now = new Date();
  if (period === 'daily') {
    const s = new Date(now); s.setHours(0,0,0,0);
    const e = new Date(now); e.setHours(23,59,59,999);
    return { start: s.getTime(), end: e.getTime(), label: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
  }
  if (period === 'weekly') {
    const day = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day)); mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start: mon.getTime(), end: sun.getTime(), label: `${fmt(mon)} – ${fmt(sun)}` };
  }
  const s = new Date(now.getFullYear(), now.getMonth(), 1);
  const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: s.getTime(), end: e.getTime(), label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

function showMetricDrillDown(goalDef, range) {
  const overlay = document.getElementById('metric-drill-overlay');
  if (!overlay) return;

  const { start, end } = range;
  const toMs = ts => typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const inPeriod = ts => { const n = toMs(ts); return !!n && n >= start && n <= end; };
  const opps = allCompanies.filter(c => c.isOpportunity);
  const isSnapshot = goalDef.mode === 'snapshot';

  let matched;
  if (isSnapshot) {
    matched = goalDef.stages.includes('*')
      ? opps
      : opps.filter(c => goalDef.stages.includes(c.jobStage || 'needs_review'));
  } else {
    matched = goalDef.stages.includes('*')
      ? opps.filter(c => inPeriod(c.savedAt))
      : opps.filter(c => goalDef.stages.some(sk => inPeriod(c.stageTimestamps?.[sk])));
  }

  const smap = Object.fromEntries(customOpportunityStages.map(s => [s.key, { label: s.label, color: s.color }]));

  const rowsHtml = matched.length === 0
    ? '<div class="metric-drill-empty">No entries match this metric for the selected period.</div>'
    : matched.map(e => {
        const stageKey = e.jobStage || 'needs_review';
        const stage = smap[stageKey] || { label: stageKey, color: '#94a3b8' };
        const name = e.jobTitle || e.company || 'Unnamed';
        const sub = (e.jobTitle && e.company) ? e.company : '';
        const url = chrome.runtime.getURL('company.html') + '?id=' + e.id;
        return `<a class="metric-drill-row" href="${url}" target="_blank">
          <div class="metric-drill-row-main">
            <span class="metric-drill-name">${escHtmlGlobal(name)}</span>
            ${sub ? `<span class="metric-drill-sub">${escHtmlGlobal(sub)}</span>` : ''}
          </div>
          <span class="metric-drill-stage" style="background:${stage.color}1a;color:${stage.color};border-color:${stage.color}55">${stage.label}</span>
        </a>`;
      }).join('');

  overlay.querySelector('#metric-drill-title').textContent = goalDef.label;
  overlay.querySelector('#metric-drill-count').textContent = `${matched.length} ${matched.length === 1 ? 'opportunity' : 'opportunities'}`;
  overlay.querySelector('#metric-drill-list').innerHTML = rowsHtml;
  overlay.classList.add('open');

  const close = () => overlay.classList.remove('open');
  overlay.querySelector('#metric-drill-close').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
}

function goalRingSvg(current, goal, color) {
  const r = 22, cx = 27, sw = 5, circ = +(2 * Math.PI * r).toFixed(2);
  const pct = goal > 0 ? Math.min(1, current / goal) : 0;
  const offset = +(circ * (1 - pct)).toFixed(2);
  const fill = pct >= 1 ? '#4ade80' : color;
  return `<svg width="54" height="54" viewBox="0 0 54 54">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#e8eef4" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${fill}" stroke-width="${sw}"
      stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
  </svg>`;
}

function renderActivitySection() {
  const section = document.getElementById('activity-section');
  if (!section) return;

  const range = getPeriodRange(activityPeriod);
  const { start, end, label } = range;
  const periodName = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[activityPeriod];
  const goals = activityGoals[activityPeriod];
  const opps = allCompanies.filter(c => c.isOpportunity);
  const toMs = ts => typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const inPeriod = ts => { const n = toMs(ts); return !!n && n >= start && n <= end; };

  // Config-driven stat counting — supports activity mode (period-based) and snapshot mode (current state)
  const smap = Object.fromEntries(customOpportunityStages.map(s => [s.key, s.label]));
  const goalDefs = statCardConfigs.map(card => {
    let count;
    const isSnapshot = card.mode === 'snapshot';

    if (isSnapshot) {
      // Snapshot: count opps currently sitting in the selected stages
      if (card.stages.includes('*')) {
        count = opps.length;
      } else {
        count = opps.filter(c =>
          card.stages.includes(c.jobStage || 'needs_review')
        ).length;
      }
    } else {
      // Activity: count opps that entered the stages during the period
      if (card.stages.includes('*')) {
        count = opps.filter(c => inPeriod(c.savedAt)).length;
      } else {
        count = opps.filter(c =>
          card.stages.some(sk => inPeriod(c.stageTimestamps?.[sk]))
        ).length;
      }
    }

    const modeLabel = isSnapshot ? 'Currently in' : 'Entered during period';
    const stageNames = card.stages.includes('*') ? 'all stages' : card.stages.map(k => smap[k] || k).join(', ');
    const tooltip = `${modeLabel}: ${stageNames}`;
    return { ...card, count, goal: goals[card.key] || 0, tooltip };
  });

  const funnelStages = customOpportunityStages
    .filter(s => s.key !== 'rejected')
    .map(s => ({ label: s.label, color: s.color, count: opps.filter(c => (c.jobStage || 'needs_review') === s.key).length }));

  const funnelHtml = funnelStages.map((s, i) => `
    <div class="funnel-stage">
      <div class="funnel-count" style="${s.count > 0 ? `color:${s.color}` : 'color:#b0c1d4'}">${s.count || '—'}</div>
      <div class="funnel-label">${s.label}</div>
    </div>${i < funnelStages.length - 1 ? '<div class="funnel-arrow">›</div>' : ''}
  `).join('');

  const goalCardsHtml = goalDefs.map(g => {
    const showGoal = g.hasGoal !== false && g.goal > 0;
    return `
    <div class="goal-card" data-goal-key="${g.key}">
      <span class="goal-info-icon" title="${g.tooltip}${g.mode === 'snapshot' ? ' (snapshot)' : ''}">i</span>
      <div class="goal-drill-area" data-goal-key="${g.key}" title="View entries">
        ${showGoal ? `<div class="goal-ring">${goalRingSvg(g.count, g.goal, g.color)}</div>` : `<div class="goal-ring-plain" style="color:${g.color}">${g.count}</div>`}
        <div class="goal-text">
          <div class="goal-fraction">${g.count}${showGoal ? `<span class="goal-denom">/${g.goal}</span>` : ''}</div>
          <div class="goal-metric-label">${g.label}</div>
          ${showGoal ? '<div class="goal-edit-hint">edit goal</div>' : `<div class="goal-edit-hint" style="color:#94a3b8">${g.mode === 'snapshot' ? 'live count' : 'tracking'}</div>`}
        </div>
      </div>
      ${showGoal ? `<div class="goal-edit-form">
        <label class="goal-edit-label">${g.label} goal</label>
        <div style="display:flex;gap:7px;align-items:center">
          <input class="goal-edit-input" type="number" min="0" max="999" value="${g.goal}" data-goal-key="${g.key}">
          <button class="goal-save-btn-inline" data-goal-key="${g.key}">Save</button>
          <button class="goal-cancel-btn">✕</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');

  // Format dates for <input type="date"> value (YYYY-MM-DD)
  const toInputDate = ts => new Date(ts).toISOString().slice(0, 10);

  section.innerHTML = `
    <div class="activity-head">
      <div class="activity-head-left">
        <span class="activity-section-title">Pipeline Overview</span>
        <span style="font-size:12px;color:#7c98b6;margin-left:16px"><b style="color:#2d3e50">${allCompanies.length}</b> companies &nbsp; <b style="color:#2d3e50">${opps.length}</b> opportunities</span>
      </div>
      <div class="period-toggle">
        <div class="period-tabs">
          <button class="period-tab${activityPeriod==='daily'?' active':''}" data-period="daily">Daily</button>
          <button class="period-tab${activityPeriod==='weekly'?' active':''}" data-period="weekly">Weekly</button>
          <button class="period-tab${activityPeriod==='monthly'?' active':''}" data-period="monthly">Monthly</button>
        </div>
        <span class="activity-period-label" id="act-date-label" title="Click to set custom date range" style="cursor:pointer">📅 ${label}${range.custom ? '' : ' <span class="act-auto-badge">auto</span>'}</span>
        <div class="act-date-picker" id="act-date-picker" style="display:none">
          <input type="date" id="act-date-start" class="act-date-input" value="${toInputDate(start)}">
          <span style="color:#7c98b6;font-size:13px">–</span>
          <input type="date" id="act-date-end" class="act-date-input" value="${toInputDate(end)}">
          <button class="act-date-apply">Apply</button>
          ${range.custom ? `<button class="act-date-reset">Reset to auto</button>` : ''}
        </div>
      </div>
    </div>
    <div class="activity-funnel">${funnelHtml}</div>
    <div class="activity-goals-row">
      ${goalCardsHtml}
      <button class="stat-cards-edit-btn" id="stat-cards-edit-btn" title="Configure stat cards">⚙</button>
    </div>
  `;

  section.querySelectorAll('.period-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activityPeriod = btn.dataset.period;
      localStorage.setItem('ci_activityPeriod', activityPeriod);
      activityCustomRange = null;
      localStorage.removeItem('ci_activityCustomRange');
      renderActivitySection();
    });
  });

  // Date range editing
  const dateLabel = section.querySelector('#act-date-label');
  const datePicker = section.querySelector('#act-date-picker');
  if (dateLabel && datePicker) {
    dateLabel.addEventListener('click', () => {
      datePicker.style.display = datePicker.style.display === 'none' ? 'flex' : 'none';
    });
    section.querySelector('.act-date-apply')?.addEventListener('click', () => {
      const s = section.querySelector('#act-date-start').value;
      const e = section.querySelector('#act-date-end').value;
      if (!s || !e || s > e) return;
      activityCustomRange = { start: s, end: e };
      localStorage.setItem('ci_activityCustomRange', JSON.stringify(activityCustomRange));
      renderActivitySection();
    });
    section.querySelector('.act-date-reset')?.addEventListener('click', () => {
      activityCustomRange = null;
      localStorage.removeItem('ci_activityCustomRange');
      renderActivitySection();
    });
  }

  section.querySelectorAll('.goal-drill-area').forEach(drillArea => {
    drillArea.addEventListener('click', e => {
      if (e.target.closest('.goal-edit-hint')) {
        // "edit goal" hint — open edit form instead
        e.stopPropagation();
        const card = drillArea.closest('.goal-card');
        section.querySelectorAll('.goal-card').forEach(c => c.classList.remove('editing'));
        card.classList.add('editing');
        card.querySelector('.goal-edit-input')?.select();
        return;
      }
      const key = drillArea.dataset.goalKey;
      const def = goalDefs.find(g => g.key === key);
      if (def) showMetricDrillDown(def, range);
    });
  });

  section.querySelectorAll('.goal-cancel-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); renderActivitySection(); });
  });

  section.querySelectorAll('.goal-save-btn-inline').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.goalKey;
      const val = Math.max(0, parseInt(section.querySelector(`.goal-edit-input[data-goal-key="${key}"]`).value) || 0);
      activityGoals[activityPeriod][key] = val;
      chrome.storage.local.set({ activityGoals }, () => { void chrome.runtime.lastError; renderActivitySection(); });
    });
  });

  section.querySelectorAll('.goal-edit-input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') section.querySelector(`.goal-save-btn-inline[data-goal-key="${inp.dataset.goalKey}"]`)?.click();
      if (e.key === 'Escape') renderActivitySection();
    });
    inp.addEventListener('click', e => e.stopPropagation());
  });

  // Stat card editor button
  // Gear button — use delegation since direct binding sometimes misses
  section.addEventListener('click', e => {
    if (e.target.closest('#stat-cards-edit-btn')) {
      e.stopPropagation();
      openStatCardEditor();
    }
  });
}

function openStatCardEditor() {
  const overlay = document.getElementById('stat-card-editor-overlay');
  if (!overlay) return;
  const stages = customOpportunityStages;

  function renderEditor() {
    const list = overlay.querySelector('#stat-card-editor-list');
    list.innerHTML = statCardConfigs.map((card, i) => {
      const stageChecks = stages.map(s => {
        const checked = card.stages.includes(s.key) ? 'checked' : '';
        return `<label class="sc-stage-check"><input type="checkbox" data-card="${i}" data-stage="${s.key}" ${checked}> <span class="sc-stage-dot" style="background:${s.color}"></span>${s.label}</label>`;
      }).join('');
      const isSaved = card.stages.includes('*');
      const mode = card.mode || 'activity';
      return `
        <div class="sc-card-row" data-idx="${i}">
          <div class="sc-card-head">
            <span class="sc-card-swatch" style="background:${card.color}"></span>
            <input class="sc-card-label-input" type="text" value="${card.label}" data-card="${i}" placeholder="Card name">
            <button class="sc-card-delete" data-card="${i}" title="Remove card">&times;</button>
          </div>
          <div class="sc-card-mode">
            <label class="sc-mode-option"><input type="radio" name="mode-${i}" value="activity" data-card="${i}" ${mode === 'activity' ? 'checked' : ''}> Activity (entered during period)</label>
            <label class="sc-mode-option"><input type="radio" name="mode-${i}" value="snapshot" data-card="${i}" ${mode === 'snapshot' ? 'checked' : ''}> Snapshot (currently in stage)</label>
          </div>
          <div class="sc-card-goal">
            <label class="sc-goal-toggle"><input type="checkbox" data-card="${i}" data-goal-toggle="1" ${card.hasGoal !== false ? 'checked' : ''}> Set goal</label>
            ${card.hasGoal !== false ? `<input class="sc-goal-input" type="number" min="0" max="999" data-card="${i}" data-goal-val="1" value="${(activityGoals[activityPeriod] || {})[card.key] || 0}" placeholder="Goal">` : ''}
          </div>
          <div class="sc-card-stages">
            <label class="sc-stage-check"><input type="checkbox" data-card="${i}" data-stage="*" ${isSaved ? 'checked' : ''}> All saved (savedAt)</label>
            ${stageChecks}
          </div>
        </div>`;
    }).join('');
  }

  renderEditor();
  overlay.style.display = 'flex';

  // Delegate events
  const listEl = overlay.querySelector('#stat-card-editor-list');
  listEl.onclick = e => {
    const del = e.target.closest('.sc-card-delete');
    if (del) {
      const idx = parseInt(del.dataset.card);
      statCardConfigs.splice(idx, 1);
      renderEditor();
    }
  };
  listEl.onchange = e => {
    const inp = e.target;
    // Mode radio buttons
    if (inp.type === 'radio' && inp.name.startsWith('mode-')) {
      const ci = parseInt(inp.dataset.card);
      if (statCardConfigs[ci]) statCardConfigs[ci].mode = inp.value;
      return;
    }
    if (inp.type === 'checkbox') {
      const ci = parseInt(inp.dataset.card);
      // Goal toggle
      if (inp.dataset.goalToggle) {
        if (statCardConfigs[ci]) {
          statCardConfigs[ci].hasGoal = inp.checked;
          renderEditor();
        }
        return;
      }
      const sk = inp.dataset.stage;
      const card = statCardConfigs[ci];
      if (!card) return;
      if (sk === '*') {
        // Toggle "all saved" mode
        if (inp.checked) { card.stages = ['*']; }
        else { card.stages = card.stages.filter(s => s !== '*'); }
      } else {
        card.stages = card.stages.filter(s => s !== '*'); // uncheck "all saved" if picking specific
        if (inp.checked) { if (!card.stages.includes(sk)) card.stages.push(sk); }
        else { card.stages = card.stages.filter(s => s !== sk); }
      }
      renderEditor();
    }
  };
  listEl.oninput = e => {
    if (e.target.classList.contains('sc-card-label-input')) {
      const ci = parseInt(e.target.dataset.card);
      if (statCardConfigs[ci]) statCardConfigs[ci].label = e.target.value;
    }
    if (e.target.dataset.goalVal) {
      const ci = parseInt(e.target.dataset.card);
      const val = Math.max(0, parseInt(e.target.value) || 0);
      if (statCardConfigs[ci]) {
        activityGoals[activityPeriod][statCardConfigs[ci].key] = val;
      }
    }
  };

  // Add card button
  overlay.querySelector('#sc-add-card').onclick = () => {
    const key = 'custom_' + Date.now();
    statCardConfigs.push({ key, label: 'New Metric', stages: [], color: '#94a3b8', mode: 'activity' });
    // Ensure goals have an entry for this key
    for (const p of ['daily', 'weekly', 'monthly']) {
      if (!activityGoals[p][key]) activityGoals[p][key] = 0;
    }
    renderEditor();
  };

  // Reset to defaults
  overlay.querySelector('#sc-reset-defaults').onclick = () => {
    statCardConfigs = DEFAULT_STAT_CARDS.map(c => ({ ...c }));
    renderEditor();
  };

  // Save
  overlay.querySelector('#sc-save').onclick = () => {
    // Remove cards with no label
    statCardConfigs = statCardConfigs.filter(c => c.label.trim());
    chrome.storage.local.set({ statCardConfigs }, () => {
      void chrome.runtime.lastError;
      overlay.style.display = 'none';
      renderActivitySection();
    });
  };

  // Cancel
  overlay.querySelector('#sc-cancel').onclick = () => {
    // Reload from storage to discard edits
    chrome.storage.local.get(['statCardConfigs'], d => {
      statCardConfigs = d.statCardConfigs?.length ? d.statCardConfigs : DEFAULT_STAT_CARDS.map(c => ({ ...c }));
      overlay.style.display = 'none';
    });
  };

  // Close on overlay click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.querySelector('#sc-cancel').click();
  });
}

// ── Global Chat Widget ─────────────────────────────────────────────────────

(function initGlobalChat() {
  const floatEl  = document.getElementById('gc-float');
  const trigger  = document.getElementById('gc-trigger');
  const header   = document.getElementById('gc-header');
  const msgsEl   = document.getElementById('gc-messages');
  const inputEl  = document.getElementById('gc-input');
  const sendBtn  = document.getElementById('gc-send');
  const closeBtn = document.getElementById('gc-close');
  const minBtn   = document.getElementById('gc-min');
  const sizeBtn  = document.getElementById('gc-size');
  if (!floatEl || !trigger) return;

  if (typeof COOP !== 'undefined') {
    const gcSpark = document.querySelector('.gc-spark');
    const gcTitle = document.getElementById('gc-title');
    if (gcSpark) gcSpark.innerHTML = COOP.avatar(20);
    if (gcTitle) gcTitle.innerHTML = `<span style="color:#FF7A59;font-weight:800;">Coop</span>`;
  }

  let history = [];
  let isMinimized = false;

  // Model switcher — dropdown picklist, ordered by cost (cheapest first)
  const GC_ALL_MODELS = [
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', icon: '◆', provider: 'openai', cost: '$', tier: 'Fast & cheap' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', icon: '◆', provider: 'openai', cost: '$', tier: 'Fastest' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku', icon: '⚡', provider: 'anthropic', cost: '$', tier: 'Fast & cheap' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', icon: '✦', provider: 'anthropic', cost: '$$', tier: 'Balanced' },
    { id: 'gpt-4.1', label: 'GPT-4.1', icon: '◆', provider: 'openai', cost: '$$', tier: 'Balanced' },
    { id: 'gpt-5', label: 'GPT-5', icon: '◆', provider: 'openai', cost: '$$$', tier: 'Most capable' },
    { id: 'claude-opus-4-0-20250514', label: 'Claude Opus', icon: '★', provider: 'anthropic', cost: '$$$', tier: 'Most capable' },
  ];
  let gcModelIdx = 0;
  let gcAvailableModels = GC_ALL_MODELS; // filtered after key check
  const gcModelToggle = document.getElementById('gc-model-toggle');
  const gcModelLabel = document.getElementById('gc-model-label');

  // Load key status + pipeline config, set default model from Pipeline settings
  Promise.all([
    new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, s => { void chrome.runtime.lastError; r(s); })),
    new Promise(r => chrome.storage.local.get(['pipelineConfig'], d => r(d.pipelineConfig)))
  ]).then(([status, pipelineCfg]) => {
    if (status) {
      gcAvailableModels = GC_ALL_MODELS.filter(m => {
        if (m.provider === 'openai') return !!status.openai;
        if (m.provider === 'anthropic') return !!status.anthropic;
        return true;
      });
      if (!gcAvailableModels.length) gcAvailableModels = GC_ALL_MODELS;
    }
    const configModel = pipelineCfg?.aiModels?.chat;
    if (configModel) {
      const idx = gcAvailableModels.findIndex(m => m.id === configModel);
      if (idx >= 0) gcModelIdx = idx;
    }
    updateGcModelLabel();
  });

  function updateGcModelLabel() {
    const m = gcAvailableModels[gcModelIdx] || gcAvailableModels[0];
    if (gcModelLabel && m) gcModelLabel.textContent = m.icon + ' ' + m.label;
  }

  // Dropdown picklist
  if (gcModelToggle) {
    gcModelToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove existing dropdown if open
      const existing = document.getElementById('gc-model-dropdown');
      if (existing) { existing.remove(); return; }

      const rect = gcModelToggle.getBoundingClientRect();
      const dropdown = document.createElement('div');
      dropdown.id = 'gc-model-dropdown';
      dropdown.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${rect.left}px;min-width:200px;background:#1C2D3A;border:1px solid #2D3E50;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.4);z-index:10001;padding:6px 0;font-family:inherit;`;

      dropdown.innerHTML = gcAvailableModels.map((m, i) => `
        <div class="gc-model-option" data-idx="${i}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;cursor:pointer;transition:background 0.1s;${i === gcModelIdx ? 'background:rgba(255,122,89,0.15);' : ''}border-radius:0;">
          <div style="display:flex;flex-direction:column;gap:1px;">
            <span style="font-size:12px;font-weight:600;color:${i === gcModelIdx ? '#FF7A59' : '#e2e8f0'}">${m.icon} ${m.label}</span>
            <span style="font-size:10px;color:#7c98b6">${m.tier}</span>
          </div>
          <span style="font-size:10px;font-weight:700;color:${m.cost === '$' ? '#5DCAA5' : m.cost === '$$' ? '#facc15' : '#FF7A59'};letter-spacing:1px">${m.cost}</span>
        </div>
      `).join('');

      document.body.appendChild(dropdown);

      dropdown.querySelectorAll('.gc-model-option').forEach(opt => {
        opt.addEventListener('mouseenter', () => { opt.style.background = 'rgba(255,255,255,0.06)'; });
        opt.addEventListener('mouseleave', () => { opt.style.background = parseInt(opt.dataset.idx) === gcModelIdx ? 'rgba(255,122,89,0.15)' : ''; });
        opt.addEventListener('click', () => {
          gcModelIdx = parseInt(opt.dataset.idx);
          updateGcModelLabel();
          dropdown.remove();
        });
      });

      // Close on click outside
      const closeDropdown = (ev) => {
        if (!dropdown.contains(ev.target) && ev.target !== gcModelToggle) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      };
      setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    });
  }
  let sizeState = 0;
  const SIZE_ICONS = ['\u2922', '\u2921', '\u22A1'];
  const SIZE_CLASSES = ['', 'gc-maximized', 'gc-fullscreen'];

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
  }

  function renderMessages(showThinking) {
    if (history.length === 0) {
      msgsEl.innerHTML = typeof COOP !== 'undefined'
        ? `<div class="gc-empty">${COOP.emptyStateHTML('global')}</div>`
        : '<div class="gc-empty">Ask anything about your pipeline — compare opportunities, draft follow-ups, get strategic advice.</div>';
    } else {
      const thinkingHTML = showThinking
        ? (typeof COOP !== 'undefined' ? `<div class="gc-msg gc-msg-assistant">${COOP.thinkingHTML()}</div>` : '<div class="gc-msg gc-msg-assistant"><div class="gc-bubble gc-thinking"><span class="gc-thinking-dots"><span>.</span><span>.</span><span>.</span></span> Thinking</div></div>')
        : '';
      msgsEl.innerHTML = history.map(m => {
        const text = m.content;
        const bubble = m.role === 'assistant'
          ? (typeof renderMarkdown === 'function' ? renderMarkdown(text) : escHtml(text))
          : escHtml(text);
        const prefix = m.role === 'assistant' && typeof COOP !== 'undefined' ? COOP.messagePrefixHTML() : '';
        return `<div class="gc-msg gc-msg-${m.role}">${prefix}<div class="gc-bubble">${bubble}</div></div>`;
      }).join('') + thinkingHTML;
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = '';
    history.push({ role: 'user', content: text });
    renderMessages(true);
    sendBtn.disabled = true;
    sendBtn.textContent = '\u2026';

    // Build compact pipeline summary
    const pipeline = allCompanies.map(c => {
      const parts = [c.company];
      parts.push(`Stage: ${c.isOpportunity ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist')}`);
      if (c.jobTitle) parts.push(`Role: ${c.jobTitle}`);
      if (c.rating) parts.push(`Rating: ${c.rating}/5`);
      const contacts = (c.knownContacts || []).slice(0, 3).map(k => k.name).filter(Boolean);
      if (contacts.length) parts.push(`Contacts: ${contacts.join(', ')}`);
      if (c.notes) parts.push(`Notes: ${c.notes.slice(0, 80)}`);
      if (c.tags?.length) parts.push(`Tags: ${c.tags.join(', ')}`);
      return '- ' + parts.join(' | ');
    }).join('\n');

    // Detect mentioned companies for enrichment
    const lowerText = text.toLowerCase();
    const mentionedEntries = allCompanies.filter(c =>
      c.company && c.company.length > 2 && lowerText.includes(c.company.toLowerCase())
    );

    // Fetch missing emails/meetings for mentioned companies, then build enrichment
    const enrichmentParts = await Promise.all(mentionedEntries.slice(0, 3).map(async c => {
      // Fetch emails if not cached
      if (!c.cachedEmails?.length) {
        const domain = (c.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        if (domain) {
          const emailResult = await new Promise(r => chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName: c.company }, r));
          if (emailResult?.emails?.length) c.cachedEmails = emailResult.emails;
        }
      }
      // Fetch meetings if not cached
      if (!c.cachedMeetings?.length && !c.cachedMeetingTranscript) {
        const contactNames = (c.knownContacts || []).map(k => k.name).filter(Boolean);
        const granolaResult = await new Promise(r => chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: c.company, contactNames }, r));
        if (granolaResult?.meetings?.length) c.cachedMeetings = granolaResult.meetings;
        else if (granolaResult?.transcript) c.cachedMeetingTranscript = granolaResult.transcript;
      }

      const parts = [`\n=== ENRICHED CONTEXT: ${c.company} ===`];
      if (c.intelligence?.eli5) parts.push(`What they do: ${c.intelligence.eli5}`);
      if (c.intelligence?.whosBuyingIt) parts.push(`Who buys it: ${c.intelligence.whosBuyingIt}`);
      if (c.jobTitle) parts.push(`Role: ${c.jobTitle}`);
      if (c.jobMatch?.verdict) parts.push(`Match verdict: ${c.jobMatch.verdict} (${c.jobMatch.score}/10)`);
      if (c.jobMatch?.strongFits?.length) parts.push(`Strong fits: ${c.jobMatch.strongFits.map(f => typeof f === 'string' ? f : f?.text || '').join('; ')}`);
      if (c.jobMatch?.redFlags?.length) parts.push(`Red flags: ${c.jobMatch.redFlags.map(f => typeof f === 'string' ? f : f?.text || '').join('; ')}`);
      if (c.jobDescription) parts.push(`Job description:\n${c.jobDescription.slice(0, 3000)}`);
      if (c.leaders?.length) parts.push(`Leadership: ${c.leaders.map(l => `${l.name} (${l.title || ''})`).join(', ')}`);
      if (c.notes) parts.push(`Notes: ${c.notes}`);
      const contacts = (c.knownContacts || []).map(k => `${k.name}${k.email ? ' <' + k.email + '>' : ''}`);
      if (contacts.length) parts.push(`Known contacts: ${contacts.join(', ')}`);
      const emails = (c.cachedEmails || []).slice(0, 10);
      if (emails.length) {
        parts.push(`Recent emails:\n${emails.map(e => `  [${e.date || ''}] "${e.subject}" — ${e.from}${e.snippet ? '\n  ' + e.snippet.slice(0, 150) : ''}`).join('\n')}`);
      }
      const meetings = (c.cachedMeetings || []);
      if (meetings.length) {
        parts.push(`Meeting transcripts:\n${meetings.map(m => `--- ${m.title || 'Meeting'} | ${m.date || ''} ---\n${(m.transcript || '').slice(0, 3000)}`).join('\n\n')}`);
      } else if (c.cachedMeetingTranscript) {
        parts.push(`Meeting transcript:\n${c.cachedMeetingTranscript.slice(0, 4000)}`);
      }
      const manualMeetings = (c.manualMeetings || []);
      if (manualMeetings.length) {
        parts.push(`Manually logged meetings:\n${manualMeetings.map(m => `--- Meeting (manual): ${m.title || 'Untitled'} | ${m.date || ''} ---\n${(m.transcript || m.notes || '(no notes)').slice(0, 3000)}`).join('\n\n')}`);
      }
      if (c.reviews?.length) parts.push(`Reviews: ${c.reviews.slice(0, 3).map(r => `"${r.snippet}" (${r.source || ''})`).join('; ')}`);
      return parts.join('\n');
    }));
    const enrichments = enrichmentParts.join('\n');

    const apiMessages = history.map(m => ({ role: m.role, content: m.content }));

    let result;
    try {
      result = await Promise.race([
        new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'GLOBAL_CHAT_MESSAGE',
            messages: apiMessages,
            pipeline,
            enrichments,
            chatModel: gcAvailableModels[gcModelIdx].id,
          }, r => {
            if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
            else resolve(r);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000))
      ]);
    } catch (e) {
      result = { error: e.message === 'timeout' ? 'Request timed out. Try again.' : e.message };
    }

    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';

    if (result?.reply) {
      const fallbackNote = (result.model && result.model !== gcAvailableModels[gcModelIdx].id)
        ? `\n\n*— answered by ${result.model.startsWith('gpt') ? result.model : result.model.replace('claude-', '').replace(/-\d+$/, '')} (fallback)*`
        : '';
      history.push({ role: 'assistant', content: result.reply + fallbackNote });
    } else {
      history.push({ role: 'assistant', content: result?.error || 'Something went wrong. Try again.' });
    }
    renderMessages();
  }

  // Event listeners
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Quick action buttons
  document.querySelector('.gc-actions')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-gc-prompt]');
    if (btn) { inputEl.value = btn.dataset.gcPrompt; send(); return; }
    if (e.target.closest('[data-gc-action="clear"]')) {
      history = [];
      renderMessages();
    }
  });

  // Open / close / minimize / resize
  function open() {
    floatEl.classList.remove('gc-hidden', 'gc-minimized');
    trigger.style.display = 'none';
    isMinimized = false;
    setTimeout(() => inputEl.focus(), 150);
  }
  function close() {
    floatEl.classList.add('gc-hidden');
    floatEl.classList.remove('gc-minimized', 'gc-maximized', 'gc-fullscreen');
    trigger.style.display = '';
    isMinimized = false; sizeState = 0;
    sizeBtn.innerHTML = SIZE_ICONS[0];
  }
  function minimize() {
    isMinimized = !isMinimized;
    floatEl.classList.toggle('gc-minimized', isMinimized);
    minBtn.innerHTML = isMinimized ? '+' : '&minus;';
    if (isMinimized) { floatEl.classList.remove('gc-maximized', 'gc-fullscreen'); sizeState = 0; sizeBtn.innerHTML = SIZE_ICONS[0]; }
  }
  function cycleSize() {
    floatEl.classList.remove(...SIZE_CLASSES.filter(Boolean));
    sizeState = (sizeState + 1) % SIZE_CLASSES.length;
    if (SIZE_CLASSES[sizeState]) floatEl.classList.add(SIZE_CLASSES[sizeState]);
    sizeBtn.innerHTML = SIZE_ICONS[sizeState];
    if (isMinimized) { isMinimized = false; floatEl.classList.remove('gc-minimized'); minBtn.innerHTML = '&minus;'; }
  }

  trigger.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  minBtn.addEventListener('click', minimize);
  sizeBtn.addEventListener('click', cycleSize);

  // Drag to reposition
  let dragging = false, startX, startY, startRight, startBottom;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('.gc-btn')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = floatEl.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    floatEl.style.right  = Math.max(0, startRight  - (e.clientX - startX)) + 'px';
    floatEl.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });

  renderMessages();
})();

// Action On filter
document.getElementById('action-filter-btns')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-action-filter]');
  if (!btn) return;
  activeActionFilter = btn.dataset.actionFilter;
  document.querySelectorAll('#action-filter-btns .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.actionFilter === activeActionFilter));
  render();
});

load();

// ── Inbox: opens dedicated inbox page ────────────────────────────────────────

document.getElementById('inbox-link')?.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('inbox.html'), '_blank');
});

// Badge count for inbox link
function updateInboxBadge() {
  chrome.storage.local.get(['lastInboxViewedAt'], ({ lastInboxViewedAt }) => {
    const lastViewed = lastInboxViewedAt || 0;
    let unread = 0;
    (allCompanies || []).forEach(c => {
      (c.cachedEmails || []).forEach(e => {
        if (e.date && new Date(e.date).getTime() > lastViewed) unread++;
      });
    });
    const badge = document.getElementById('inbox-badge');
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  });
}
