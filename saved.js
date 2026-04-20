// escapeHtml — provided by ui-utils.js

const QUEUE_STAGE = 'needs_review';
// DISMISS_STAGE: fallback constant; prefer getDismissStageKey(stages) from ui-utils.js
// so custom pipelines with a renamed closed_lost stage still work.
const DISMISS_STAGE = 'rejected';
const DISMISS_TAG = "Didn't apply";
const SCORE_THRESHOLDS = { green: 7, amber: 5 };

// Chrome extensions don't support window.confirm() — it silently fails inside
// extension pages, meaning anything gated behind confirm() never fires. This
// helper uses the native <dialog> element to render a non-blocking modal with
// the same ergonomic shape: `if (await ciConfirm('Delete X?')) { ... }`.
function ciConfirm(message, { confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ci-confirm-dialog';
    dlg.style.cssText = 'border:1px solid var(--ci-border-default,#dfe3eb);border-radius:10px;padding:0;max-width:360px;background:var(--ci-bg-surface,#fff);color:var(--ci-text-primary,#1c2b3a);font:14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.15);';
    const btnDanger = 'background:#dc2626;color:#fff;border:none;';
    const btnPrimary = 'background:#2563eb;color:#fff;border:none;';
    dlg.innerHTML = `
      <div style="padding:18px 20px 4px 20px;font-weight:600;">${String(message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>
      <div style="padding:12px 20px 18px 20px;text-align:right;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" data-action="cancel" style="padding:7px 14px;border-radius:6px;border:1px solid var(--ci-border-default,#dfe3eb);background:transparent;color:inherit;cursor:pointer;font-size:13px;">${cancelLabel}</button>
        <button type="button" data-action="confirm" style="padding:7px 14px;border-radius:6px;${danger ? btnDanger : btnPrimary};cursor:pointer;font-size:13px;font-weight:600;">${confirmLabel}</button>
      </div>`;
    document.body.appendChild(dlg);
    const cleanup = (result) => { try { dlg.close(); } catch(_){} dlg.remove(); resolve(result); };
    dlg.querySelector('[data-action=confirm]').addEventListener('click', () => cleanup(true));
    dlg.querySelector('[data-action=cancel]').addEventListener('click', () => cleanup(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cleanup(false); }); // ESC
    try { dlg.showModal(); } catch(_) { dlg.setAttribute('open', ''); }
    dlg.querySelector('[data-action=confirm]').focus();
  });
}

let allCompanies = [];
let allKnownTags = [];
let activeType = 'all';
let activeRatings = new Set(); // empty = any
let activeStatus = 'all';
let activeTag = null;
let activeActionFilter = 'all'; // 'all' | 'my_court' | 'their_court'
let viewMode = localStorage.getItem('ci_viewMode') || 'kanban';
let boardSearch = localStorage.getItem('ci_boardSearch') || '';
let activeFilter = localStorage.getItem('ci_boardFilter') || 'all';
let tblSortCol = 'savedAt';
let tblSortDir = 'desc'; // 'asc' | 'desc'
let tblFilters = {}; // { [colKey]: string[] } — included values; empty = no filter

// ── Table view column registry ──────────────────────────────────────────────
const TABLE_COLUMNS = [
  {
    key: 'company', label: 'Company', defaultOn: true, locked: true, sortable: true, defaultSortDir: 'asc',
    sortVal: c => (c.company || '').toLowerCase(),
    renderCell: c => {
      const isJob = !!c.isOpportunity;
      const fav = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
      const favHtml = fav ? `<img class="tbl-favicon" src="https://www.google.com/s2/favicons?domain=${fav}&sz=64" alt="" data-img-fallback="hide">` : '';
      return `<div class="tbl-company">${favHtml}<div><a class="tbl-name" href="${chrome.runtime.getURL('company.html')}?id=${c.id}">${escapeHtml(c.company)}</a><div style="margin-top:1px;"><span class="tbl-type-badge ${isJob ? 'opp' : 'co'}">${isJob ? 'Opp' : 'Co'}</span></div></div></div>`;
    }
  },
  {
    key: 'jobTitle', label: 'Role', defaultOn: true, sortable: true, defaultSortDir: 'asc',
    sortVal: c => (c.jobTitle || '').toLowerCase(),
    renderCell: c => c.isOpportunity && c.jobTitle
      ? (c.jobUrl ? `<a class="tbl-job-link" href="${safeUrl(c.jobUrl)}" target="_blank">${escapeHtml(c.jobTitle)}</a>` : `<span style="font-size:12px;color:var(--ci-text-secondary)">${escapeHtml(c.jobTitle)}</span>`)
      : '<span class="tbl-muted">—</span>'
  },
  {
    key: 'stage', label: 'Stage', defaultOn: true, sortable: true, filterable: true, defaultSortDir: 'asc',
    sortVal: c => c.isOpportunity ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist'),
    filterVal: c => { const key = c.isOpportunity ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist'); const all = [...customOpportunityStages, ...customCompanyStages]; return all.find(s => s.key === key)?.label || key; },
    renderCell: c => {
      const isJob = !!c.isOpportunity;
      const stageField = isJob ? 'jobStage' : 'status';
      const status = isJob ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');
      const statusColor = stageColor(status);
      const opts = Object.entries(stageMap()).map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('');
      return `<div class="tbl-stage"><span class="tbl-stage-dot" style="background:${statusColor}"></span><select class="status-select" data-id="${c.id}" data-status="${status}" data-stage-field="${stageField}" style="border:none;background:none;font-size:12px;font-weight:500;color:var(--ci-text-primary);cursor:pointer;padding:0;font-family:inherit;max-width:160px;">${opts}</select></div>`;
    }
  },
  {
    key: 'score', label: 'Fit', defaultOn: true, sortable: true, filterable: true, defaultSortDir: 'desc',
    sortVal: c => c.jobMatch?.score || c.jobMatchScore || 0,
    filterVal: c => { const s = c.jobMatch?.score || c.jobMatchScore; if (!s) return 'Unscored'; if (s >= 9) return '9-10 · Strong'; if (s >= 7) return '7-8 · Good'; if (s >= 5) return '5-6 · Mixed'; return '1-4 · Poor'; },
    filterOrder: ['9-10 · Strong', '7-8 · Good', '5-6 · Mixed', '1-4 · Poor', 'Unscored'],
    renderCell: c => {
      if (!c.isOpportunity) return '<span class="tbl-muted">—</span>';
      const score = c.jobMatch?.score || c.jobMatchScore;
      if (!score) return '<span class="tbl-muted">—</span>';
      const v = scoreToVerdict(score);
      return `<span class="tbl-score ${v.cls}">${Number(score).toFixed(1)}/10</span>`;
    }
  },
  {
    key: 'rating', label: 'Rating', defaultOn: true, sortable: true, filterable: true, defaultSortDir: 'desc',
    sortVal: c => c.rating || 0,
    filterVal: c => c.rating ? `${c.rating} ★` : 'Not rated',
    renderCell: c => `<div class="tbl-stars">${[1,2,3,4,5].map(i => `<span class="tbl-star ${(c.rating||0) >= i ? 'filled' : ''}" data-id="${c.id}" data-val="${i}">★</span>`).join('')}</div>`
  },
  {
    key: 'actionStatus', label: 'Action On', defaultOn: true, sortable: true, filterable: true, defaultSortDir: 'asc',
    sortVal: c => c.actionStatus || '',
    filterVal: c => c.actionStatus === 'my_court' ? 'My Court' : c.actionStatus === 'their_court' ? 'Their Court' : c.actionStatus === 'scheduled' ? 'Scheduled' : 'None',
    renderCell: c => c.actionStatus === 'their_court' ? `<span class="tbl-action their-court">Their Court</span>` : c.actionStatus === 'my_court' ? `<span class="tbl-action my-court">My Court</span>` : c.actionStatus === 'scheduled' ? `<span class="tbl-action scheduled">Scheduled</span>` : '<span class="tbl-muted">—</span>'
  },
  {
    key: 'employees', label: 'Employees', defaultOn: true, sortable: true, defaultSortDir: 'desc',
    sortVal: c => parseInt((c.employees || '0').replace(/\D.*/, '')) || 0,
    renderCell: c => `<span class="tbl-muted">${c.employees || '—'}</span>`
  },
  {
    key: 'savedAt', label: 'Saved', defaultOn: true, sortable: true, defaultSortDir: 'desc',
    sortVal: c => c.savedAt || 0,
    renderCell: c => `<span class="tbl-muted">${c.savedAt ? new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</span>`
  },
  {
    key: 'industry', label: 'Industry', defaultOn: false, sortable: true, filterable: true, defaultSortDir: 'asc',
    sortVal: c => (c.industry || c.intelligence?.industry || '').toLowerCase(),
    filterVal: c => c.industry || c.intelligence?.industry || 'Unknown',
    renderCell: c => { const v = c.industry || c.intelligence?.industry || ''; return v ? `<span class="tbl-muted">${escapeHtml(v)}</span>` : '<span class="tbl-muted">—</span>'; }
  },
  {
    key: 'funding', label: 'Funding', defaultOn: false, sortable: false,
    sortVal: c => c.funding || '',
    renderCell: c => c.funding ? `<span class="tbl-muted">${escapeHtml(c.funding)}</span>` : '<span class="tbl-muted">—</span>'
  },
  {
    key: 'workArrangement', label: 'Arrangement', defaultOn: false, sortable: true, filterable: true, defaultSortDir: 'asc',
    sortVal: c => (c.workArrangement || c.jobSnapshot?.workArrangement || '').toLowerCase(),
    filterVal: c => c.workArrangement || c.jobSnapshot?.workArrangement || 'Unknown',
    renderCell: c => { const v = c.workArrangement || c.jobSnapshot?.workArrangement || ''; return v ? `<span class="tbl-muted">${escapeHtml(v)}</span>` : '<span class="tbl-muted">—</span>'; }
  },
  {
    key: 'location', label: 'Location', defaultOn: false, sortable: true, defaultSortDir: 'asc',
    sortVal: c => (c.location || '').toLowerCase(),
    renderCell: c => c.location ? `<span class="tbl-muted">${escapeHtml(c.location)}</span>` : '<span class="tbl-muted">—</span>'
  },
  {
    key: 'salary', label: 'Comp', defaultOn: false, sortable: false,
    sortVal: c => c.baseSalaryRange || c.oteTotalComp || '',
    renderCell: c => { const v = c.baseSalaryRange || c.oteTotalComp || ''; return v ? `<span class="tbl-muted" style="font-size:11px;">${escapeHtml(v)}</span>` : '<span class="tbl-muted">—</span>'; }
  },
  {
    key: 'nextStep', label: 'Next Step', defaultOn: false, sortable: true, defaultSortDir: 'asc',
    sortVal: c => c.nextStepDate || '',
    renderCell: c => {
      if (!c.nextStepDate && !c.nextStep) return '<span class="tbl-muted">—</span>';
      const dateStr = c.nextStepDate ? new Date(c.nextStepDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const isPast = c.nextStepDate && new Date(c.nextStepDate) < new Date();
      return `<div style="font-size:11px;">${dateStr ? `<div style="font-weight:600;color:${isPast ? 'var(--ci-accent-red)' : 'var(--ci-text-primary)'}">${escapeHtml(dateStr)}</div>` : ''}${c.nextStep ? `<div class="tbl-muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.nextStep)}">${escapeHtml(c.nextStep)}</div>` : ''}</div>`;
    }
  },
  {
    key: 'appliedAt', label: 'Applied', defaultOn: false, sortable: true, defaultSortDir: 'desc',
    sortVal: c => c.stageTimestamps?.applied || 0,
    renderCell: c => { const ts = c.stageTimestamps?.applied; return ts ? `<span class="tbl-muted">${new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>` : '<span class="tbl-muted">—</span>'; }
  },
  {
    key: 'lastActivity', label: 'Last Activity', defaultOn: false, sortable: true, defaultSortDir: 'desc',
    sortVal: c => computeLastActivity(c).timestamp || 0,
    renderCell: c => { const act = computeLastActivity(c); return act.timestamp ? `<span class="tbl-muted">${new Date(act.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>` : '<span class="tbl-muted">—</span>'; }
  },
  {
    key: 'tags', label: 'Tags', defaultOn: false, sortable: false, filterable: true,
    sortVal: c => (c.tags || []).join(','),
    filterVal: c => c.tags || [], // returns array for multi-value matching
    renderCell: c => { const tags = c.tags || []; if (!tags.length) return '<span class="tbl-muted">—</span>'; return tags.slice(0, 3).map(t => { const cl = tagColor(t); return `<span style="font-size:10px;padding:1px 5px;border-radius:3px;border:1px solid ${cl.border};color:${cl.color};background:${cl.bg}">${escapeHtml(t)}</span>`; }).join(' ') + (tags.length > 3 ? `<span class="tbl-muted"> +${tags.length - 3}</span>` : ''); }
  },
];

function getActiveCols() {
  try { const s = JSON.parse(localStorage.getItem('ci_tblCols') || 'null'); if (Array.isArray(s) && s.length) return s; } catch(e) {}
  return TABLE_COLUMNS.filter(c => c.defaultOn).map(c => c.key);
}
function setActiveCols(keys) { localStorage.setItem('ci_tblCols', JSON.stringify(keys)); }

const DEFAULT_OPPORTUNITY_STAGES = [
  { key: 'needs_review',    label: "Coop's AI Scoring Queue",  color: '#64748b', stageType: 'queue',       emptyHint: 'New opportunities land here for scoring.' },
  { key: 'want_to_apply',   label: 'I Want to Apply',          color: '#22d3ee', stageType: 'queue',       emptyHint: 'Roles you\'ve flagged to apply to.' },
  { key: 'applied',         label: 'Applied',                  color: '#60a5fa', stageType: 'outreach',    emptyHint: 'Applications you\'ve submitted.' },
  { key: 'intro_requested', label: 'Intro Requested',          color: '#a78bfa', stageType: 'outreach',    emptyHint: 'Waiting on warm intros to land.' },
  { key: 'conversations',   label: 'Conversations in Progress',color: '#fb923c', stageType: 'active',      emptyHint: 'Active discussions and interview loops.' },
  { key: 'offer_stage',     label: 'Offer Stage',              color: '#a3e635', stageType: 'active',      emptyHint: 'Offers in hand or being negotiated.' },
  { key: 'accepted',        label: 'Accepted',                 color: '#4ade80', stageType: 'active',      emptyHint: 'Offers you\'ve signed.' },
  { key: 'rejected',        label: "Rejected / DQ'd",          color: '#f87171', stageType: 'closed_lost', emptyHint: 'Roles that didn\'t move forward.' },
];
const DEFAULT_COMPANY_STAGES = [
  { key: 'co_watchlist',   label: 'Watch List',      color: '#64748b', stageType: 'queue',   emptyHint: 'Companies you\'re tracking.' },
  { key: 'co_researching', label: 'Researching',     color: '#22d3ee', stageType: 'active',  emptyHint: 'Actively exploring.' },
  { key: 'co_networking',  label: 'Networking',      color: '#a78bfa', stageType: 'active',  emptyHint: 'Building connections here.' },
  { key: 'co_interested',  label: 'Strong Interest', color: '#fb923c', stageType: 'active',  emptyHint: 'Companies you\'re excited about.' },
  { key: 'co_applied',     label: 'Applied There',   color: '#60a5fa', stageType: 'outreach', emptyHint: 'Companies where you\'ve submitted an application.' },
  { key: 'co_archived',    label: 'Archived',        color: '#374151', stageType: 'paused',  emptyHint: 'Companies set aside for now.' },
];
let customOpportunityStages = [...DEFAULT_OPPORTUNITY_STAGES];
let customCompanyStages = [...DEFAULT_COMPANY_STAGES];
let activePipeline = localStorage.getItem('ci_activePipeline') || 'opportunity'; // 'all' | 'opportunity' | 'company'
let stageCelebrations = {}; // { [stageKey]: { confetti, sound } } — loaded from storage
const DEFAULT_ACTION_STATUSES = [
  { key: 'my_court', label: '🏀 My Court', color: '#ef4444' },
  { key: 'their_court', label: '⏳ Their Court', color: '#eab308' },
  { key: 'scheduled', label: '📅 Scheduled', color: '#3b82f6' },
];

function detectScheduledStatus(entry) {
  const events = entry.cachedCalendarEvents || [];
  const now = new Date();
  return events.some(e => new Date(e.start) > now);
}
let customActionStatuses = null; // loaded from storage, falls back to DEFAULT
let _userWorkArrangement = []; // loaded from chrome.storage.sync prefs
let _stalenessThresholdDays = 7; // loaded from chrome.storage.sync prefs.stalenessThresholdDays
const _collapsedCols = new Set(JSON.parse(sessionStorage.getItem('ci_collapsed_cols') || '[]'));
// Tracks which outreach-type quiet columns the user has manually expanded this session.
const _expandedQuietCols = new Set();
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

// parseLocalDate, truncLabel — provided by ui-utils.js

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
// defaultActionStatus, autoNextStepForStage, applyAutoStage — provided by ui-utils.js

function currentStages() {
  return activePipeline === 'company' ? customCompanyStages : customOpportunityStages;
}
function stageMap() { return Object.fromEntries(currentStages().map(s => [s.key, s.label])); }
// stageColor: returns the type-driven dot color (from design-tokens.css) for a given stage key.
// Delegates to stageTypeVisual() from ui-utils.js — no per-file copy of the lookup table.
function stageColor(key) {
  const all = [...customOpportunityStages, ...customCompanyStages];
  const stageObj = all.find(s => s.key === key) || currentStages()[0];
  if (stageObj && stageObj.stageType && typeof stageTypeVisual === 'function') {
    return stageTypeVisual(stageObj.stageType).dotColor;
  }
  return stageObj?.color || '#64748b';
}
function stageStyle(key) {
  const c = stageColor(key);
  if (c && c.startsWith('#') && c.length >= 7) {
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return { border: c, color: c, bg: `rgba(${r},${g},${b},0.1)` };
  }
  // Token reference (var(--ci-stage-*)) — resolve to actual hex via getComputedStyle
  // so we can build the same rgba(...,0.1) tinted bg used everywhere stageStyle renders.
  if (c && c.startsWith('var(') && typeof getComputedStyle === 'function') {
    const m = c.match(/var\((--[a-zA-Z0-9-]+)\)/);
    if (m) {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
      if (resolved.startsWith('#') && resolved.length >= 7) {
        const r = parseInt(resolved.slice(1,3),16), g = parseInt(resolved.slice(3,5),16), b = parseInt(resolved.slice(5,7),16);
        return { border: c, color: c, bg: `rgba(${r},${g},${b},0.1)` };
      }
    }
  }
  return { border: c, color: c, bg: 'transparent' };
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

// boldKeyPhrase, escHtml — provided by ui-utils.js

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
  const score = c.jobMatch?.score ?? c.fitScore ?? null;
  const isScoring = c._queuedForScoring && score === null;

  const tier = score != null ? (score >= SCORE_THRESHOLDS.green ? 'green' : score >= SCORE_THRESHOLDS.amber ? 'amber' : 'red') : '';
  const stateClass = isScoring ? ' scoring' : '';

  // Hard DQ — only show if score is genuinely low (3 or below) to avoid false positives
  const hardDQ = c.jobMatch?.hardDQ || c.hardDQ;
  const compactDQHtml = hardDQ?.flagged && score != null && score <= 3 ? '<div class="compact-dq">\u{1F6AB} Hard DQ</div>' : '';

  // Score display
  let scoreHtml;
  if (score != null) {
    scoreHtml = `<span class="compact-score-num ${tier}" title="Coop's Score">${typeof score === 'number' ? score.toFixed(1) : score}</span><span class="compact-score-den">/10</span>${compactDQHtml}`;
  } else if (isScoring) {
    scoreHtml = '<svg class="compact-spinner" width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;"><circle cx="50" cy="50" r="50" fill="#3B5068"/><ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="41.5" cy="44.2" r="2.5" fill="#5B8C3E"/><ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="59.5" cy="44.2" r="2.5" fill="#5B8C3E"/></svg>';
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
    ? `<img class="compact-favicon" src="https://www.google.com/s2/favicons?domain=${favDomain}&sz=32" alt="" data-img-fallback="hide">`
    : '';

  // Tags
  const tagsHtml = `<div class="compact-tags">${(c.tags || []).map(t => {
      const cl = tagColor(t);
      return `<span class="compact-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}">${escHtml(t)}<button class="tag-remove" data-id="${c.id}" data-tag="${escHtml(t)}" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.5;font-size:10px;padding:0 0 0 3px;line-height:1;">&times;</button></span>`;
    }).join('')}<button class="compact-add-tag-btn" data-id="${c.id}" title="Add tag" style="font-size:10px;color:var(--ci-text-tertiary);background:none;border:1px dashed var(--ci-border-default);border-radius:3px;padding:1px 6px;cursor:pointer;line-height:1.4;">+</button></div>`;

  const { actionClass: compactActionClass, isStale, isOverdue } = computeCardIndicators(c);
  const compactIndicators = (isStale || isOverdue) ? `<div class="kanban-card-indicators" style="margin-top:4px;">${isOverdue ? `<span class="kanban-overdue-badge">&#9888; Overdue</span>` : ''}${isStale ? `<span class="kanban-stale-badge">&#x231B; Stale</span>` : ''}</div>` : '';

  return `
    <div class="compact-card score-${tier}${stateClass}${compactActionClass ? ' ' + compactActionClass : ''}" data-id="${c.id}" draggable="true">
      <div class="compact-card-score">${scoreHtml}</div>
      <div class="compact-card-body">
        <div class="compact-company-row">${favHtml}<span class="compact-company">${escHtml(c.company)}${c.dataConflict ? ' <span title="Intel may be inaccurate" style="color:#d97706">\u26a0</span>' : ''}</span></div>
        ${compactIndicators}
        ${c.jobUrl ? `<a class="compact-title" href="${safeUrl(c.jobUrl)}" target="_blank" title="Open job posting">${escHtml(c.jobTitle || '')}</a>` : `<div class="compact-title">${escHtml(c.jobTitle || '')}</div>`}
        ${(() => {
          // Filter meta: remove job title echo from salary/arrangement line
          if (meta && c.jobTitle && meta.toLowerCase().startsWith(c.jobTitle.toLowerCase())) return '';
          return meta ? `<div class="compact-meta">${escHtml(meta)}</div>` : '';
        })()}
        ${(c.jobMatch?.verdict || c.fitReason) && score != null ? (() => {
          let reason = c.jobMatch?.verdict || c.fitReason;
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
          return reason ? `<div class="compact-meta" style="font-style:italic">${escHtml(reason)}</div>` : '';
        })() : ''}
        ${isScoring ? '<div class="compact-meta">Scoring...</div>' : ''}
        ${inQueue ? (() => {
          const keySignals = c.jobMatch?.keySignals || c.keySignals || [];
          return keySignals.length ? `<div class="quick-take">${keySignals.slice(0, 2).map(qt =>
            `<div class="qt-bullet qt-${qt.type}">${qt.type === 'green' ? '\u{1F7E2}' : '\u{1F534}'} ${escHtml(qt.text)}</div>`
          ).join('')}</div>` : '';
        })() : ''}
        ${tagsHtml}
        ${actionsHtml}
      </div>
    </div>`;
}

// ── Score Preview Modal ──────────────────────────────────────────────────────

const SMT_PRIORITY_COLORS = {
  high: { bg: '#FEE2E2', color: '#991B1B' },
  normal: { bg: '#FEF3C7', color: '#92400E' },
  low: { bg: '#DBEAFE', color: '#1D4ED8' }
};

function smtDateLabel(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00'); d.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: 'var(--ci-accent-red)' };
  if (diff === 0) return { text: 'Today', color: 'var(--ci-accent-amber)' };
  if (diff === 1) return { text: 'Tomorrow', color: 'var(--ci-text-secondary)' };
  return { text: `in ${diff}d`, color: 'var(--ci-text-tertiary)' };
}

function renderModalTasks(entry, tasks) {
  const companyTasks = tasks.filter(t => t.company === entry.company || t.companyId === entry.id);
  const active = companyTasks.filter(t => !t.completed);
  const completed = companyTasks.filter(t => t.completed);
  const hasAny = companyTasks.length > 0;

  const itemHtml = (t) => {
    const pc = SMT_PRIORITY_COLORS[t.priority] || SMT_PRIORITY_COLORS.normal;
    const dl = smtDateLabel(t.dueDate);
    return `<div class="smt-item ${t.completed ? 'smt-done' : ''}" data-task-id="${t.id}">
      <div class="smt-check ${t.completed ? 'checked' : ''}">${t.completed ? '✓' : ''}</div>
      <div style="flex:1;min-width:0;">
        <div class="smt-text">${escHtml(t.text)}</div>
        <div style="display:flex;gap:5px;margin-top:3px;align-items:center;">
          <span class="smt-priority" style="background:${pc.bg};color:${pc.color}">${t.priority || 'normal'}</span>
          ${dl ? `<span class="smt-date" style="color:${dl.color}">${dl.text}</span>` : ''}
        </div>
      </div>
      <button class="smt-del" title="Delete task">&times;</button>
    </div>`;
  };

  return `<div class="smt-section" id="smt-section">
    <div class="smt-header" id="smt-toggle">
      <span class="smt-chevron ${hasAny ? 'open' : ''}" id="smt-chevron">&#x25B6;</span>
      Tasks ${active.length ? `<span class="smt-count">${active.length}</span>` : ''}
    </div>
    <div class="smt-body" id="smt-body" style="${hasAny ? '' : 'display:none'}">
      ${active.map(itemHtml).join('')}
      ${completed.length ? `<div style="font-size:10px;color:var(--ci-text-tertiary);margin-top:4px;cursor:pointer;" id="smt-show-done">+ ${completed.length} completed</div><div id="smt-done-list" style="display:none">${completed.map(itemHtml).join('')}</div>` : ''}
      <div class="smt-add">
        <input type="text" id="smt-input" placeholder="Add a task...">
        <select id="smt-priority">
          <option value="high">High</option>
          <option value="normal" selected>Normal</option>
          <option value="low">Low</option>
        </select>
        <input type="date" id="smt-date">
        <button class="smt-add-btn" id="smt-save">Add</button>
      </div>
    </div>
  </div>`;
}

let _smtUndoTimer = null;

function showSmtUndoBanner(entry, deletedTask, remainingTasks) {
  const section = document.getElementById('smt-section');
  if (!section) return;
  const existing = section.querySelector('.task-undo-banner');
  if (existing) existing.remove();
  if (_smtUndoTimer) { clearTimeout(_smtUndoTimer); _smtUndoTimer = null; }

  const banner = document.createElement('div');
  banner.className = 'task-undo-banner smt-undo';
  banner.innerHTML = `<span>Task deleted</span><button class="task-undo-btn">Undo</button>`;
  section.appendChild(banner);

  requestAnimationFrame(() => banner.classList.add('visible'));

  banner.querySelector('.task-undo-btn').addEventListener('click', () => {
    if (_smtUndoTimer) { clearTimeout(_smtUndoTimer); _smtUndoTimer = null; }
    banner.remove();
    chrome.storage.local.get(['userTasks'], d => {
      const tasks = d.userTasks || [];
      if (!tasks.find(x => x.id === deletedTask.id)) tasks.push(deletedTask);
      chrome.storage.local.set({ userTasks: tasks }, () => {
        const sec = document.getElementById('smt-section');
        if (sec) { sec.outerHTML = renderModalTasks(entry, tasks); attachModalTaskHandlers(entry); }
      });
    });
  });

  _smtUndoTimer = setTimeout(() => {
    banner.classList.remove('visible');
    setTimeout(() => banner.remove(), 200);
    _smtUndoTimer = null;
  }, 5000);
}

function attachModalTaskHandlers(entry) {
  // Toggle expand/collapse
  document.getElementById('smt-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('smt-body');
    const chev = document.getElementById('smt-chevron');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.classList.toggle('open', !open);
  });

  // Show completed tasks
  document.getElementById('smt-show-done')?.addEventListener('click', () => {
    const list = document.getElementById('smt-done-list');
    const toggle = document.getElementById('smt-show-done');
    if (list) { list.style.display = list.style.display === 'none' ? '' : 'none'; }
    if (toggle && list) { toggle.textContent = list.style.display === 'none' ? toggle.textContent : '– hide completed'; }
  });

  // Add task
  const saveTask = () => {
    const input = document.getElementById('smt-input');
    const text = input?.value.trim();
    if (!text) return;
    const priority = document.getElementById('smt-priority')?.value || 'normal';
    const dueDate = document.getElementById('smt-date')?.value || null;
    chrome.storage.local.get(['userTasks'], d => {
      const tasks = d.userTasks || [];
      tasks.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        text, company: entry.company, companyId: entry.id,
        dueDate, priority, completed: false, createdAt: Date.now()
      });
      chrome.storage.local.set({ userTasks: tasks }, () => {
        const section = document.getElementById('smt-section');
        if (section) {
          section.outerHTML = renderModalTasks(entry, tasks);
          attachModalTaskHandlers(entry);
        }
      });
    });
  };
  document.getElementById('smt-save')?.addEventListener('click', saveTask);
  document.getElementById('smt-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
  });

  // Toggle complete / Delete — delegate from section
  document.getElementById('smt-section')?.addEventListener('click', e => {
    const check = e.target.closest('.smt-check');
    const del = e.target.closest('.smt-del');
    if (!check && !del) return;
    const item = e.target.closest('.smt-item');
    const taskId = item?.dataset.taskId;
    if (!taskId) return;

    chrome.storage.local.get(['userTasks'], d => {
      let tasks = d.userTasks || [];
      if (check) {
        const task = tasks.find(t => t.id === taskId);
        if (task) task.completed = !task.completed;
        chrome.storage.local.set({ userTasks: tasks }, () => {
          const section = document.getElementById('smt-section');
          if (section) { section.outerHTML = renderModalTasks(entry, tasks); attachModalTaskHandlers(entry); }
        });
      } else if (del) {
        const deletedTask = tasks.find(t => t.id === taskId);
        if (!deletedTask) return;
        const remaining = tasks.filter(t => t.id !== taskId);
        chrome.storage.local.set({ userTasks: remaining }, () => {
          const section = document.getElementById('smt-section');
          if (section) { section.outerHTML = renderModalTasks(entry, remaining); attachModalTaskHandlers(entry); }
          showSmtUndoBanner(entry, deletedTask, remaining);
        });
      }
    });
  });
}

function openScoreModal(entry) {
  const overlay = document.getElementById('score-modal-overlay');
  const content = document.getElementById('score-modal-content');
  if (!overlay || !content) return;

  const score = entry.jobMatch?.score ?? entry.fitScore ?? null;
  const tier = score != null ? (score >= SCORE_THRESHOLDS.green ? 'green' : score >= SCORE_THRESHOLDS.amber ? 'amber' : 'red') : '';
  const jm = entry.jobMatch || {};

  // Salary
  const salary = entry.baseSalaryRange || entry.oteTotalComp || jm.salary?.base || entry.jobSnapshot?.salary || '';
  const arrangement = entry.jobSnapshot?.workArrangement || jm.workArrangement || '';
  const meta = [salary, arrangement].filter(Boolean).join(' \u00b7 ');

  // Hard DQ — only show if score is genuinely low (3 or below) to avoid false positives
  const hardDQ = jm.hardDQ || entry.hardDQ;
  const dqHtml = hardDQ?.flagged && score != null && score <= 3
    ? `<div class="score-modal-dq"><span class="score-modal-dq-label">Hard disqualifier</span>${hardDQ.reasons?.length ? `<span class="score-modal-dq-body">${escHtml(hardDQ.reasons.join('; '))}</span>` : ''}</div>`
    : '';

  // Flags — semantic single-shade, typographic hierarchy (no rainbow gradient, no emoji source icons)
  const _normFlag = f => typeof f === 'string' ? { text: f, source: null, evidence: null } : { text: f?.text || '', source: f?.source || null, evidence: f?.evidence || null };
  const _flagSrcLabel = s => ({ job_posting: 'From job posting', company_data: 'From company research', preferences: 'From your preferences', candidate_profile: 'From your profile', dealbreaker_keyword: 'From your dealbreaker keywords' }[s] || (s ? `Source: ${s}` : 'No source linked'));
  const _flagTip = f => (_flagSrcLabel(f.source) + (f.evidence ? ` — "${f.evidence}"` : ' — no evidence quoted')).replace(/"/g, '&quot;');
  const strongFits = (jm.strongFits || []).map(_normFlag).filter(f => f.text);
  const redFlags = (jm.redFlags || jm.watchOuts || []).map(_normFlag).filter(f => f.text);
  const dismissedFlags = jm.dismissedFlags || [];
  const _renderFlag = (f, kind) => {
    const isDismissed = dismissedFlags.includes(f.text);
    const tip = _flagTip(f);
    return `<div class="score-modal-flag${isDismissed ? ' is-dismissed' : ''}"${kind === 'red' ? ` data-flag-text="${escHtml(f.text)}"` : ''}>
      <span class="score-modal-flag-bullet ${kind}">${kind === 'green' ? '&#x2714;' : '&#x2013;'}</span>
      <span class="score-modal-flag-text">${escHtml(f.text)}</span>
      <span class="score-modal-flag-info" title="${tip}">i</span>
      <button class="flag-dismiss-btn" data-flag="${escHtml(f.text)}" data-entry-id="${entry.id}" data-flag-type="${kind}" title="${isDismissed ? 'Restore flag' : 'Dismiss — this is wrong'}">${isDismissed ? '\u21A9' : '\u00D7'}</button>
    </div>`;
  };
  const greenCol = strongFits.length ? `<div class="score-modal-flag-col">
    <div class="score-modal-flag-heading green">Green flags</div>
    ${strongFits.map(f => _renderFlag(f, 'green')).join('')}
  </div>` : '';
  const redCol = redFlags.length ? `<div class="score-modal-flag-col">
    <div class="score-modal-flag-heading red">Red flags</div>
    ${redFlags.map(f => _renderFlag(f, 'red')).join('')}
  </div>` : '';
  const flagsHtml = (greenCol || redCol) ? `${greenCol}${redCol}` : '';

  // Tags (with remove × and + Tag button)
  const tagsHtml = (entry.tags || []).map(t => {
    const cl = tagColor(t);
    return `<span class="score-modal-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}">${escHtml(t)}<button class="modal-tag-remove" data-id="${entry.id}" data-tag="${escHtml(t)}" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.5;font-size:10px;padding:0 0 0 4px;line-height:1;">&times;</button></span>`;
  }).join('') + `<button class="modal-add-tag-btn" data-id="${entry.id}" style="font-size:11px;color:var(--ci-text-tertiary);background:none;border:1px dashed var(--ci-border-default);border-radius:12px;padding:2px 10px;cursor:pointer;line-height:1.4;white-space:nowrap;">+ Tag</button>`;

  // Favicon
  const favDomain = entry.companyWebsite ? entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const favHtml = favDomain ? `<img src="https://www.google.com/s2/favicons?domain=${favDomain}&sz=32" style="width:20px;height:20px;border-radius:4px;flex-shrink:0" data-img-fallback="hide">` : '';

  // Job summary + role brief
  const summary = jm.jobSummary || jm.roleBrief?.roleSummary || jm.verdict || '';
  const rb = jm.roleBrief || {};

  const verdict = (typeof score === 'number' && typeof scoreToVerdict === 'function') ? scoreToVerdict(score) : null;
  const scoredAgo = jm.lastUpdatedAt ? (() => {
    const mins = Math.floor((Date.now() - jm.lastUpdatedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm ago';
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return new Date(jm.lastUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })() : '';

  content.innerHTML = `
    <div class="score-modal-header">
      <div class="score-modal-score-wrap">
        <div class="score-modal-score-line">
          <span class="score-modal-score-num ${tier}">${typeof score === 'number' ? score.toFixed(1) : (score ?? '—')}</span><span class="score-modal-score-den">/10</span>
        </div>
        ${verdict ? `<div class="score-modal-score-label ${tier}">${verdict.label}</div>` : ''}
      </div>
      <div class="score-modal-identity">
        <a class="score-modal-company" href="${chrome.runtime.getURL('company.html')}?id=${entry.id}">${favHtml}<span>${escHtml(entry.company)}</span></a>
        <div class="score-modal-title">${entry.jobUrl ? `<a href="${safeUrl(entry.jobUrl)}" target="_blank">${escHtml(entry.jobTitle || '')}</a>` : escHtml(entry.jobTitle || '')}</div>
        ${meta ? `<div class="score-modal-meta">${escHtml(meta)}</div>` : ''}
        ${scoredAgo ? `<div class="score-modal-scored">Scored ${scoredAgo}${jm.lastUpdatedBy ? ' · ' + jm.lastUpdatedBy.replace(/_/g, ' ') : ''}</div>` : ''}
      </div>
    </div>
    <div class="score-modal-tags">${tagsHtml}</div>
    ${(() => {
      const links = [];
      if (entry.companyWebsite) {
        const domain = entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        links.push(`<a class="score-modal-link" href="${safeUrl(entry.companyWebsite)}" target="_blank">${escHtml(domain)}</a>`);
      }
      if (entry.companyLinkedin) links.push(`<a class="score-modal-link" href="${safeUrl(entry.companyLinkedin)}" target="_blank">LinkedIn</a>`);
      const reviews = entry.reviews || entry.intelligence?.reviews || [];
      if (reviews.length) {
        const glassdoor = reviews.find(r => /glassdoor/i.test(r.source || r.url || ''));
        if (glassdoor?.url) links.push(`<a class="score-modal-link" href="${safeUrl(glassdoor.url)}" target="_blank">Glassdoor</a>`);
        reviews.filter(r => r.url && !/glassdoor/i.test(r.source || r.url || '')).slice(0, 2).forEach(r => {
          const name = (r.source || 'Review').replace(/https?:\/\/(www\.)?/, '').split('/')[0];
          links.push(`<a class="score-modal-link" href="${safeUrl(r.url)}" target="_blank">${escHtml(name)}</a>`);
        });
      }
      const industry = entry.industry || entry.intelligence?.industry || '';
      const eli5 = entry.intelligence?.eli5 || entry.intelligence?.whatItDoes || '';
      const hasContext = links.length || industry || eli5;
      if (!hasContext) return '';
      return `<div class="score-modal-context">
        ${links.length ? `<div class="score-modal-links">${links.join('')}</div>` : ''}
        ${industry ? `<div class="score-modal-industry">${escHtml(industry)}</div>` : ''}
        ${eli5 ? `<div class="score-modal-eli5">${escHtml(eli5)}</div>` : ''}
      </div>`;
    })()}
    <div id="smt-placeholder"></div>
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
        const stageColorVal = stageDef?.color || 'var(--ci-accent-primary)';
        const stageLabel = stageDef?.label || stage;
        const row = (label, value) => value ? `<div class="score-modal-pipe-row"><span class="score-modal-pipe-k">${label}</span><span class="score-modal-pipe-v">${value}</span></div>` : '';
        return `<div class="score-modal-pipe">
          <div class="score-modal-pipe-stage" style="color:${stageColorVal}">${escHtml(stageLabel)}</div>
          ${row('Next step', nextStep ? escHtml(nextStep) : '')}
          ${row('Step date', fmtDate(nextDate))}
          ${row('Last activity', actStr ? escHtml(actStr) : '')}
          ${row('Notes', notes ? escHtml(notes).replace(/\n/g, '<br>') : '')}
        </div>`;
      })()}
      ${dqHtml}
      ${summary ? `<div class="score-modal-section"><div class="score-modal-section-label">Summary</div><div class="score-modal-section-body">${escHtml(summary)}</div></div>` : ''}
      ${flagsHtml ? `<div class="score-modal-flags">${flagsHtml}</div>` : ''}
      ${rb.whyInteresting ? `<div class="score-modal-section"><div class="score-modal-section-label">Why interesting</div><div class="score-modal-section-body">${escHtml(rb.whyInteresting)}</div></div>` : ''}
      ${rb.concerns ? `<div class="score-modal-section"><div class="score-modal-section-label">Open questions</div><div class="score-modal-section-body">${escHtml(rb.concerns)}</div></div>` : ''}
      ${rb.qualificationMatch ? `<div class="score-modal-section"><div class="score-modal-section-label">Qualification match${rb.qualificationScore ? ` <span class="score-modal-section-qual">${rb.qualificationScore}/10</span>` : ''}</div><div class="score-modal-section-body">${escHtml(rb.qualificationMatch)}</div></div>` : ''}
      ${rb.compSummary ? `<div class="score-modal-section"><div class="score-modal-section-label">Comp</div><div class="score-modal-section-body">${escHtml(rb.compSummary)}</div></div>` : ''}
      <div class="score-modal-quick-actions">
        <a class="score-modal-details-btn" href="${chrome.runtime.getURL('company.html')}?id=${entry.id}">See full breakdown</a>
        ${entry.jobUrl ? `<a class="score-modal-posting-btn" href="${safeUrl(entry.jobUrl)}" target="_blank">View posting</a>` : ''}
      </div>
      <button class="score-modal-rescore" id="score-modal-rescore-btn">Re-score with latest criteria</button>
    </div>
    <div class="score-modal-actions">
      <button class="score-modal-dismiss" id="score-modal-dismiss-btn">${(() => { const s = customOpportunityStages.find(s => s.stageType === 'closed_lost') || customOpportunityStages.find(s => s.key === DISMISS_STAGE); return s ? s.label : 'Pass'; })()}</button>
      <button class="score-modal-apply" id="score-modal-apply-btn">${(() => { const curS = entry.jobStage || 'needs_review'; const stages = customOpportunityStages; const idx = stages.findIndex(s => s.key === curS); const next = idx >= 0 && idx + 1 < stages.length ? stages[idx + 1] : null; return next ? next.label : 'Advance'; })()}</button>
    </div>
  `;

  overlay.classList.add('open');

  // Load and render tasks asynchronously
  chrome.storage.local.get(['userTasks'], d => {
    const placeholder = document.getElementById('smt-placeholder');
    if (!placeholder) return;
    placeholder.outerHTML = renderModalTasks(entry, d.userTasks || []);
    attachModalTaskHandlers(entry);
  });

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
            if (flagEl) flagEl.classList.remove('is-dismissed');
            btn.textContent = '\u00D7'; btn.title = 'Dismiss — this is wrong';
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
            flagEl.classList.add('is-dismissed');
            btn.textContent = '\u21A9'; btn.title = 'Restore flag';
            // Add reason input row if not already present
            if (!flagEl.querySelector('.flag-reason-row')) {
              const row = document.createElement('div');
              row.className = 'flag-reason-row';
              row.innerHTML = `<div class="flag-reason-prompt">Tell Coop why this is wrong — he'll learn from it</div>
                <textarea class="flag-reason-input" placeholder="e.g., This role is actually remote. Comp is disclosed in the posting."></textarea>
                <div class="flag-reason-actions">
                  <button class="flag-reason-skip">Skip</button>
                  <button class="flag-reason-save">Save feedback</button>
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
                // Save reason to coopMemory for future scoring
                if (reason) {
                  chrome.storage.local.get(['coopMemory'], d => {
                    const mem = d.coopMemory && Array.isArray(d.coopMemory.entries) ? d.coopMemory : { entries: [] };
                    const now = new Date().toISOString();
                    mem.entries.push({
                      id: 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                      type: 'feedback',
                      name: `scoring_feedback: ${flagText.slice(0, 50)}`,
                      description: `Dismissed ${flagType} flag for ${companies[idx].company || 'unknown'}`,
                      body: `Dismissed ${flagType} flag "${flagText}" — reason: ${reason}`,
                      createdAt: now,
                      updatedAt: now,
                      source: companies[idx].company || 'scoring-feedback',
                    });
                    if (mem.entries.length > 200) mem.entries = mem.entries.slice(-200);
                    mem.updatedAt = now;
                    chrome.storage.local.set({ coopMemory: mem });
                  });
                }
                row.innerHTML = `<span class="flag-reason-ack">${reason ? 'Feedback saved — Coop will remember this' : 'Dismissed'}</span>`;
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

    chrome.runtime.sendMessage(
      { type: 'SCORE_OPPORTUNITY', entryId: freshEntry.id },
      result => {
        void chrome.runtime.lastError;
        console.log('[Scorecard] Re-score result:', result);
        if (result?.fitScore != null) {
          // scoreOpportunity persists + broadcasts — reload from storage for fresh state
          chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
            allCompanies = savedCompanies || allCompanies;
            render();
            overlay.classList.remove('open');
            const updated = allCompanies.find(x => x.id === freshEntry.id);
            if (updated) setTimeout(() => openScoreModal(updated), 150);
          });
        } else {
          console.warn('[Scorecard] Re-score failed:', result);
          btn.textContent = 'Re-score failed — check console';
          btn.disabled = false;
        }
      }
    );
  });

  // ── Modal tag remove ──
  content.querySelectorAll('.modal-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ent = allCompanies.find(c => c.id === btn.dataset.id);
      if (!ent) return;
      updateCompany(btn.dataset.id, { tags: (ent.tags || []).filter(t => t !== btn.dataset.tag) });
      const updated = allCompanies.find(c => c.id === btn.dataset.id);
      if (updated) openScoreModal(updated);
    });
  });

  // ── Modal tag add ──
  content.querySelector('.modal-add-tag-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    const tagsRow = btn.closest('.score-modal-tags');
    if (!tagsRow || tagsRow.querySelector('.modal-tag-input')) return;
    btn.style.display = 'none';
    const wrap = document.createElement('span');
    wrap.style.cssText = 'position:relative;display:inline-block;';
    wrap.innerHTML = `<input class="modal-tag-input" style="font-size:11px;width:100px;padding:3px 8px;border:1px solid var(--ci-accent-primary);border-radius:12px;outline:none;background:var(--ci-bg-raised);color:var(--ci-text-primary);" placeholder="tag name" autocomplete="off"><div class="modal-tag-sugg" style="display:none;position:absolute;top:100%;left:0;z-index:60;background:var(--ci-bg-raised);border:1px solid var(--ci-border-default);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1);min-width:120px;max-height:140px;overflow-y:auto;margin-top:4px;"></div>`;
    tagsRow.insertBefore(wrap, btn);
    const input = wrap.querySelector('input');
    const sugg = wrap.querySelector('.modal-tag-sugg');
    input.focus();
    input.addEventListener('input', () => {
      const val = input.value.trim().toLowerCase();
      const ent = allCompanies.find(c => c.id === id);
      const existing = ent?.tags || [];
      if (!val) { sugg.style.display = 'none'; return; }
      const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !existing.includes(t));
      if (!matches.length) { sugg.style.display = 'none'; return; }
      sugg.innerHTML = matches.slice(0, 5).map(t => `<div style="padding:5px 10px;cursor:pointer;font-size:12px;" data-tag="${escHtml(t)}">${escHtml(t)}</div>`).join('');
      sugg.style.display = 'block';
      sugg.querySelectorAll('[data-tag]').forEach(s => {
        s.addEventListener('mousedown', ev => { ev.preventDefault(); addModalTag(id, s.dataset.tag); });
        s.addEventListener('mouseenter', () => { s.style.background = 'var(--ci-bg-inset)'; });
        s.addEventListener('mouseleave', () => { s.style.background = ''; });
      });
    });
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); const val = input.value.trim(); if (val) addModalTag(id, val); }
      if (ev.key === 'Escape') { const updated = allCompanies.find(c => c.id === id); if (updated) openScoreModal(updated); }
    });
    input.addEventListener('blur', () => setTimeout(() => {
      const updated = allCompanies.find(c => c.id === id);
      if (updated && tagsRow.querySelector('.modal-tag-input')) openScoreModal(updated);
    }, 200));

    function addModalTag(entId, tag) {
      commitTag(entId, tag);
      setTimeout(() => {
        const updated = allCompanies.find(c => c.id === entId);
        if (updated) openScoreModal(updated);
      }, 100);
    }
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
  // Set swipe labels based on current stage → next stage / rejected
  const curStage = entry.jobStage || 'needs_review';
  const stages = customOpportunityStages;
  const curIdx = stages.findIndex(s => s.key === curStage);
  const nextStage = curIdx >= 0 && curIdx + 1 < stages.length ? stages[curIdx + 1] : null;
  const rejectedStage = stages.find(s => s.stageType === 'closed_lost') || stages.find(s => s.key === DISMISS_STAGE);
  if (applyLabel) applyLabel.textContent = nextStage ? nextStage.label : 'Advance';
  if (passLabel) passLabel.textContent = rejectedStage ? rejectedStage.label : 'Pass';

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
      // Swipe left → Reject/DQ
      modal.classList.add('snapping');
      modal.style.transform = 'translateX(-150%) rotate(-15deg)';
      modal.style.opacity = '0';
      setTimeout(() => {
        resetModal();
        overlay.classList.remove('open');
        // Try existing button first (queue stages); otherwise apply directly
        const btn = document.querySelector(`.compact-dismiss-btn[data-id="${entry.id}"]`);
        if (btn) {
          btn.click();
        } else {
          const existingTags = entry.tags || [];
          const tags = existingTags.includes(DISMISS_TAG) ? existingTags : [...existingTags, DISMISS_TAG];
          const dismissKey = (typeof getDismissStageKey === 'function') ? getDismissStageKey(customOpportunityStages) : DISMISS_STAGE;
          const changes = { jobStage: dismissKey, tags, ...stageEnterTimestamp(entry, dismissKey) };
          applyAutoStage(entry, dismissKey, changes);
          updateCompany(entry.id, changes);
        }
      }, 300);
    } else if (currentX > THRESHOLD) {
      // Swipe right → Advance to next stage
      modal.classList.add('snapping');
      modal.style.transform = 'translateX(150%) rotate(15deg)';
      modal.style.opacity = '0';
      setTimeout(() => {
        resetModal();
        overlay.classList.remove('open');
        // Try existing button first (queue stages); otherwise apply directly
        const btn = document.querySelector(`.compact-apply-btn[data-id="${entry.id}"]`);
        if (btn) {
          btn.click();
        } else {
          const stageList = customOpportunityStages;
          const curIdx2 = stageList.findIndex(s => s.key === curStage);
          const nextStageKey = curIdx2 >= 0 && curIdx2 + 1 < stageList.length ? stageList[curIdx2 + 1].key : null;
          if (nextStageKey) {
            const changes = { jobStage: nextStageKey, ...stageEnterTimestamp(entry, nextStageKey) };
            applyAutoStage(entry, nextStageKey, changes);
            updateCompany(entry.id, changes);
          }
        }
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
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const strategy = img.dataset.imgFallback;
  if (strategy === 'hide') img.style.display = 'none';
}, true);

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('score-modal-overlay');
  if (!overlay) return;
  document.getElementById('score-modal-close')?.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      overlay.classList.remove('open');
      closeQueueOverlay();
    }
  });
});

// ── Queue / card overlay (iframe over blurred pipeline) ──────────────────────

function openQueueOverlay(path) {
  const wrap = document.getElementById('queue-overlay');
  const iframe = document.getElementById('queue-overlay-iframe');
  if (!wrap || !iframe) return;
  iframe.src = chrome.runtime.getURL(path);
  wrap.classList.add('open');
}

function closeQueueOverlay() {
  const wrap = document.getElementById('queue-overlay');
  const iframe = document.getElementById('queue-overlay-iframe');
  if (!wrap || !wrap.classList.contains('open')) return;
  wrap.classList.remove('open');
  // Blank the iframe src so it stops running
  setTimeout(() => { if (iframe) iframe.src = ''; }, 300);
  render(); // refresh pipeline state
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('queue-overlay-backdrop')?.addEventListener('click', closeQueueOverlay);

  // Flanking nav arrow buttons — send postMessage into the iframe
  const _qPrev = document.getElementById('queue-overlay-prev');
  const _qNext = document.getElementById('queue-overlay-next');
  const _qIframe = () => document.getElementById('queue-overlay-iframe');
  _qPrev?.addEventListener('click', () => _qIframe()?.contentWindow?.postMessage({ type: 'COOP_QUEUE_PREV' }, '*'));
  _qNext?.addEventListener('click', () => _qIframe()?.contentWindow?.postMessage({ type: 'COOP_QUEUE_NEXT' }, '*'));

  // Arrow keys navigate when overlay is open
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('queue-overlay')?.classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); _qIframe()?.contentWindow?.postMessage({ type: 'COOP_QUEUE_PREV' }, '*'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); _qIframe()?.contentWindow?.postMessage({ type: 'COOP_QUEUE_NEXT' }, '*'); }
  });

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'COOP_QUEUE_CLOSE') closeQueueOverlay();
    if (e.data?.type === 'COOP_NAVIGATE') {
      if (e.data.url) window.location.href = e.data.url;
    }
    // iframe tells us nav arrow enabled state after each card render
    if (e.data?.type === 'COOP_QUEUE_NAV_STATE') {
      if (_qPrev) _qPrev.disabled = !e.data.canPrev;
      if (_qNext) _qNext.disabled = !e.data.canNext;
      // Only show arrows when queue has more than 1 entry
      if (e.data.count !== undefined) {
        const show = e.data.count > 1;
        if (_qPrev) _qPrev.style.visibility = show ? '' : 'hidden';
        if (_qNext) _qNext.style.visibility = show ? '' : 'hidden';
      }
    }
  });
});

// scoreToVerdict, applyExcitementModifier, TAG_PALETTE, tagColorIndex, tagColor — provided by ui-utils.js

let customTagColors = {}; // { tagName: paletteIndex }
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
  // Load user prefs for work arrangement mismatch detection + staleness threshold
  chrome.storage.sync.get(['prefs'], ({ prefs }) => {
    _userWorkArrangement = (prefs?.workArrangement) || [];
    if (prefs?.stalenessThresholdDays != null) _stalenessThresholdDays = parseInt(prefs.stalenessThresholdDays) || 7;
  });
  chrome.storage.local.get(['savedCompanies', 'allTags', 'opportunityStages', 'companyStages', 'customStages', 'tagColors', 'activityGoals', 'stageCelebrations', 'statCardConfigs', 'actionStatuses', '_migratedStageTypes'], (data) => {
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
      // Pin rejected to last — it's always the terminal column regardless of stored order
      const rejIdx = storedOpp.findIndex(s => s.key === DISMISS_STAGE);
      if (rejIdx !== -1 && rejIdx !== storedOpp.length - 1) {
        const [rej] = storedOpp.splice(rejIdx, 1);
        storedOpp.push(rej);
      }
      customOpportunityStages = storedOpp;
    }
    if (data.companyStages && data.companyStages.length > 0) customCompanyStages = data.companyStages;

    // ── stageType migration (one-time, idempotent) ───────────────────────────
    // Backfills stageType on any stage entry that is missing it.
    // Never overwrites an existing user-set stageType.
    // Guard flag _migratedStageTypes prevents re-running after the first pass.
    if (!data._migratedStageTypes) {
      const OPP_TYPE_MAP = {
        needs_review: 'queue', want_to_apply: 'queue',
        applied: 'outreach', intro_requested: 'outreach',
        conversations: 'active', offer_stage: 'active', accepted: 'active',
        rejected: 'closed_lost',
      };
      const CO_TYPE_MAP = {
        co_watchlist: 'queue',
        co_researching: 'active', co_networking: 'active', co_interested: 'active',
        co_applied: 'outreach',
        co_archived: 'paused',
      };
      let stagesDirty = false;
      customOpportunityStages.forEach(s => {
        if (!s.stageType) {
          s.stageType = OPP_TYPE_MAP[s.key] || 'active';
          stagesDirty = true;
        }
      });
      customCompanyStages.forEach(s => {
        if (!s.stageType) {
          s.stageType = CO_TYPE_MAP[s.key] || 'active';
          stagesDirty = true;
        }
      });
      if (stagesDirty) {
        chrome.storage.local.set({
          opportunityStages: customOpportunityStages,
          companyStages: customCompanyStages,
        });
      }
      chrome.storage.local.set({ _migratedStageTypes: true });
    }

    // ── Closed Lost guard ─────────────────────────────────────────────────────
    // If opportunityStages has no closed_lost-typed stage (e.g. direct storage
    // tamper or pre-migration data), append the default rejected entry.
    const hasClosedLost = customOpportunityStages.some(s => s.stageType === 'closed_lost');
    if (!hasClosedLost) {
      customOpportunityStages.push({ key: 'rejected', label: "Rejected / DQ'd", color: '#f87171', stageType: 'closed_lost' });
      chrome.storage.local.set({ opportunityStages: customOpportunityStages });
    }

    // ── Ensure closed_lost-typed stage is always last in opportunityStages ───
    const clIdx = customOpportunityStages.findIndex(s => s.stageType === 'closed_lost');
    if (clIdx !== -1 && clIdx !== customOpportunityStages.length - 1) {
      const [clStage] = customOpportunityStages.splice(clIdx, 1);
      customOpportunityStages.push(clStage);
    }

    if (data.tagColors) customTagColors = data.tagColors;
    if (data.activityGoals) {
      activityGoals.daily     = { ...activityGoals.daily,     ...(data.activityGoals.daily     || {}) };
      activityGoals.weekly    = { ...activityGoals.weekly,    ...(data.activityGoals.weekly    || {}) };
      activityGoals.monthly   = { ...activityGoals.monthly,   ...(data.activityGoals.monthly   || {}) };
    }
    if (data.stageCelebrations) stageCelebrations = data.stageCelebrations;
    if (data.actionStatuses) customActionStatuses = data.actionStatuses;
    // ── Goals seed migration (v6 dashboard) ─────────────────────────────────
    // Seeds default stat cards if absent, using _migratedGoalsSeed as a guard.
    // Check storage value (data.statCardConfigs), NOT the in-memory variable which
    // is pre-seeded with DEFAULT_STAT_CARDS and would always appear non-empty.
    if (data.statCardConfigs?.length) {
      statCardConfigs = data.statCardConfigs;
    } else {
      // Storage is empty/missing — seed v6 defaults synchronously so the
      // first render (below) sees them immediately without a second repaint.
      chrome.storage.local.get(['_migratedGoalsSeed'], ({ _migratedGoalsSeed }) => {
        if (_migratedGoalsSeed) return; // guard: only seed once
        const DEFAULT_OPP_STAGES = customOpportunityStages || [];
        const appliedKey   = (DEFAULT_OPP_STAGES.find(s => s.stageType === 'outreach' && /applied/i.test(s.key)) || DEFAULT_OPP_STAGES.find(s => /applied/i.test(s.key)))?.key || 'applied';
        const outreachKeys = DEFAULT_OPP_STAGES.filter(s => s.stageType === 'outreach').map(s => s.key);
        const convoKeys    = DEFAULT_OPP_STAGES.filter(s => s.stageType === 'active').map(s => s.key);
        const seeded = [
          { key: 'saves',         label: 'Opportunities saved',   stages: ['*'],         mode: 'activity', hasGoal: true, color: '#4573D2' },
          { key: 'applications',  label: 'Applications sent',     stages: appliedKey ? [appliedKey] : ['applied'], mode: 'activity', hasGoal: true, color: '#FC636B' },
          { key: 'outreach',      label: 'Outreach attempts',     stages: outreachKeys.length ? outreachKeys : ['applied','intro_requested'], mode: 'activity', hasGoal: true, color: '#F5A623' },
          { key: 'convos',        label: 'Conversations started', stages: convoKeys.length ? convoKeys : ['conversations'], mode: 'activity', hasGoal: true, color: '#7C6EF0' },
        ];
        // Assign in-memory first so next renderActivitySection() call sees them
        statCardConfigs = seeded;
        // Persist to storage and set migration guard
        chrome.storage.local.set({ statCardConfigs: seeded, _migratedGoalsSeed: true }, () => {
          // Re-render activity section so goal cards appear without requiring a reload
          renderActivitySection();
        });
      });
    }

    updateStageDynamicCSS();
    allCompanies = (savedCompanies || []).sort((a, b) => b.savedAt - a.savedAt);

    // Backfill: if entry is at a stage but has no stageTimestamp for it, stamp it
    let needsBackfill = false;
    allCompanies = allCompanies.map(c => {
      if (!c.isOpportunity) return c;
      const stage = c.jobStage || '';
      if (stage && (!c.stageTimestamps || !c.stageTimestamps[stage])) {
        needsBackfill = true;
        return { ...c, stageTimestamps: { ...c.stageTimestamps, [stage]: c.savedAt || Date.now() } };
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
  toolbar.style.display = '';

  const menu = document.getElementById('status-dd-menu');
  const btn = document.getElementById('status-dd-btn');
  const labelEl = document.getElementById('status-dd-label');
  const dotEl = document.getElementById('status-dd-dot');
  if (!menu || !btn) return;

  const statuses = stageMap();
  const options = [{ val: 'all', label: 'All', color: null }]
    .concat(Object.entries(statuses).map(([val, label]) => ({ val, label, color: stageColor(val) })));

  menu.innerHTML = options.map(opt => {
    const dot = opt.color
      ? `<span class="status-opt-dot" style="background:${opt.color}"></span>`
      : '<span class="status-opt-dot" style="background:transparent;border:1px dashed var(--ci-border-default)"></span>';
    return `<div class="action-dd-opt status-dd-opt${opt.val === activeStatus ? ' active' : ''}" data-status="${opt.val}">${dot}<span>${escHtml(opt.label)}</span></div>`;
  }).join('');

  const current = options.find(o => o.val === activeStatus) || options[0];
  labelEl.textContent = current.label;
  if (current.color) {
    dotEl.style.display = 'inline-block';
    dotEl.style.background = current.color;
  } else {
    dotEl.style.display = 'none';
  }
  btn.classList.toggle('filtered', activeStatus !== 'all');

  menu.querySelectorAll('.action-dd-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      activeStatus = opt.dataset.status;
      updateStatusToolbar();
      menu.classList.remove('open');
      btn.classList.remove('open');
      render();
    });
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
    const _tbRowShow = document.getElementById('kanban-toolbar-row');
    if (_tbRowShow) _tbRowShow.style.display = '';
    if (statusToolbar) statusToolbar.style.display = 'none';
    // Apply board toolbar quick-filter chip
    if (activeFilter === 'my_court') {
      filtered = filtered.filter(c => c.actionStatus === 'my_court');
    } else if (activeFilter === 'overdue') {
      const todayTs = new Date().setHours(0, 0, 0, 0);
      filtered = filtered.filter(c => c.nextStepDate && new Date(c.nextStepDate).setHours(0, 0, 0, 0) < todayTs);
    } else if (activeFilter === 'qualified') {
      // Qualified = score >= 7.5 (matches the green tier in the score color spectrum memory)
      filtered = filtered.filter(c => {
        const score = c.jobMatch?.score || c.fitScore || 0;
        return score >= 7.5;
      });
    } else if (activeFilter === 'starred') {
      filtered = filtered.filter(c => (c.rating || 0) >= 4);
    }
    renderKanban(filtered);
    return;
  }

  kanbanBoard.style.display = 'none';
  // Hide toolbar row when switching away from kanban
  const _tbRow = document.getElementById('kanban-toolbar-row');
  if (_tbRow) _tbRow.style.display = 'none';
  grid.style.display = '';
  if (statusToolbar) statusToolbar.style.display = '';

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><b>${allCompanies.length === 0 ? 'No saved companies yet' : 'No results'}</b>${allCompanies.length === 0 ? 'Open Coop.ai on any company page and hit Save.' : 'Try a different search or filter.'}</div>`;
    return;
  }

  // Apply column filters (Table view only)
  Object.entries(tblFilters).forEach(([colKey, vals]) => {
    if (!vals?.length) return;
    const colDef = TABLE_COLUMNS.find(c => c.key === colKey);
    if (!colDef?.filterVal) return;
    const valSet = new Set(vals);
    filtered = filtered.filter(c => {
      const fv = colDef.filterVal(c);
      if (Array.isArray(fv)) return fv.some(v => valSet.has(v));
      return valSet.has(fv);
    });
  });

  // Sort using the column registry's sortVal function
  const sortColDef = TABLE_COLUMNS.find(c => c.key === tblSortCol);
  if (sortColDef?.sortable !== false) {
    filtered.sort((a, b) => {
      const av = sortColDef ? sortColDef.sortVal(a) : 0;
      const bv = sortColDef ? sortColDef.sortVal(b) : 0;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return tblSortDir === 'asc' ? cmp : -cmp;
    });
  }

  const activeCols = getActiveCols();
  const cols = TABLE_COLUMNS.filter(c => activeCols.includes(c.key));

  const thHtml = cols.map(col => {
    const isSortActive = tblSortCol === col.key;
    const hasFilter = (tblFilters[col.key] || []).length > 0;
    const sortCls = !col.sortable && !col.filterable ? 'no-sort' : isSortActive ? (tblSortDir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    const filterCls = hasFilter ? ' col-filtered' : '';
    const filterDot = hasFilter ? `<span class="th-filter-dot"></span>` : '';
    const filterIcon = col.filterable && !isSortActive ? `<span class="th-filter-icon">▾</span>` : '';
    return `<th class="${sortCls}${filterCls}" data-col="${col.key}">${col.label}${filterDot}${filterIcon}</th>`;
  }).join('') + `<th class="no-sort" style="width:32px;"></th>`;

  const rowsHtml = filtered.map(c => {
    const status = c.isOpportunity ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');
    const statusColor = stageColor(status);
    const cells = cols.map(col => `<td>${col.renderCell(c)}</td>`).join('');
    return `<tr data-id="${c.id}" style="border-left:3px solid ${statusColor};">${cells}<td><button class="tbl-delete" data-id="${c.id}" title="Remove">✕</button></td></tr>`;
  }).join('');

  grid.innerHTML = `<div class="tbl-wrap" style="position:relative;"><table class="tbl">
    <thead><tr>${thHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;

  // Sort / filter on header click
  grid.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = th.dataset.col;
      const colDef = TABLE_COLUMNS.find(c => c.key === col);
      if (colDef?.filterable) {
        openColFilterPicker(th, col, colDef);
      } else if (col && colDef?.sortable !== false) {
        if (tblSortCol === col) {
          tblSortDir = tblSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          tblSortCol = col;
          tblSortDir = colDef?.defaultSortDir || 'asc';
        }
        render();
      }
    });
  });

  // Columns picker — bound once on load, not here

  // Star click
  grid.querySelectorAll('.tbl-star').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCompany(star.dataset.id, { rating: parseInt(star.dataset.val) });
    });
  });

  // Stage select change
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
      applyAutoStage(entry, sel.value, changes);
      updateCompany(sel.dataset.id, changes);
    });
  });

  // Delete
  grid.querySelectorAll('.tbl-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = allCompanies.find(c => c.id === btn.dataset.id)?.company || 'this entry';
      if (await ciConfirm(`Remove ${name}?`, { confirmLabel: 'Remove' })) {
        deleteCompany(btn.dataset.id);
      }
    });
  });

  // Row click → open company page
  grid.querySelectorAll('tbody tr').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, input')) return;
      coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + row.dataset.id);
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
    coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + companyId);
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
// ── Cost pill (header — single consolidated cost display) ─────────────────
function updateCostPill() {
  chrome.storage.local.get('apiUsage', d => {
    const usage = d.apiUsage || {};
    const pill = document.getElementById('cost-pill');
    if (!pill) return;

    const costToday = usage.costToday || 0;
    const fmtCost = c => c < 0.01 ? '$' + c.toFixed(4) : '$' + c.toFixed(2);
    const costClass = costToday >= 1 ? 'cost-high' : costToday >= 0.25 ? 'cost-mid' : 'cost-low';

    // 7-day sparkline
    const today = new Date();
    const dayKeys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const dailyCosts = {};
    dayKeys.forEach(k => { dailyCosts[k] = 0; });
    ['anthropic', 'openai'].forEach(p => {
      (usage[p]?.dailyHistory || []).forEach(entry => {
        const dk = (entry.date || '').slice(0, 10);
        if (dailyCosts.hasOwnProperty(dk)) dailyCosts[dk] += entry.estimatedCost || 0;
      });
    });
    const todayKey = dayKeys[dayKeys.length - 1];
    if (costToday > 0) dailyCosts[todayKey] = costToday;
    const costValues = dayKeys.map(k => dailyCosts[k]);
    const maxCost = Math.max(...costValues, 0.01);

    const sparkBars = dayKeys.map((k, i) => {
      const pct = Math.max((costValues[i] / maxCost) * 100, 7);
      const dayLabel = new Date(k + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return `<div class="cost-spark-bar${i === dayKeys.length - 1 ? ' today' : ''}" style="height:${pct}%" title="${dayLabel}: ${fmtCost(costValues[i])}"></div>`;
    }).join('');

    pill.innerHTML = `<span class="cost-pill-inner"><span class="cost-sparkline">${sparkBars}</span> <span class="cost-pill-amt ${costClass}">${fmtCost(costToday)}</span></span>`;
  });
}
updateCostPill();

// Cost breakdown modal
document.getElementById('cost-pill')?.addEventListener('click', () => {
  chrome.storage.local.get('apiUsage', d => {
    const usage = d.apiUsage || {};
    const todayStr = new Date().toISOString().slice(0, 10);
    const log = (usage.callLog || []).filter(c => c.ts && new Date(c.ts).toISOString().slice(0, 10) === todayStr);
    const totalCost = usage.costToday || 0;
    const providers = ['anthropic', 'openai', 'apollo', 'serper', 'granola'];
    const providerNames = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (GPT)', apollo: 'Apollo', serper: 'Serper', granola: 'Granola' };
    const providerColors = { anthropic: '#D97706', openai: '#10A37F', apollo: '#6366F1', serper: '#3B82F6', granola: '#8B5CF6' };
    const fmtCost = c => c < 0.01 ? '$' + c.toFixed(4) : '$' + c.toFixed(2);
    const fmtTok = t => t > 999 ? (t / 1000).toFixed(1) + 'k' : String(t);

    // Aggregate by provider — prefer pd.costToday (accurate) over callLog sum
    const costByProv = {};
    providers.forEach(p => { const pd = usage[p]; if (pd?.costToday) costByProv[p] = pd.costToday; });
    // Fallback: sum from callLog for providers without pd.costToday (historical entries)
    log.forEach(c => { if (!costByProv[c.provider]) costByProv[c.provider] = 0; if (!usage[c.provider]?.costToday) costByProv[c.provider] += (c.cost || 0); });

    let provRows = '';
    providers.forEach(p => {
      const pd = usage[p];
      if (!pd || !pd.requestsToday) return;
      const cost = costByProv[p] || 0;
      const pct = totalCost > 0 ? Math.round(cost / totalCost * 100) : 0;
      provRows += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--ci-border-subtle);">
        <span style="width:8px;height:8px;border-radius:50%;background:${providerColors[p]};flex-shrink:0"></span>
        <span style="flex:1;font-size:12px;font-weight:600">${providerNames[p]}</span>
        <span style="font-size:11px;color:var(--ci-text-tertiary)">${pd.requestsToday} calls</span>
        ${pd.tokensToday?.input ? `<span style="font-size:10px;color:var(--ci-text-tertiary);font-family:var(--ci-font-mono)">${fmtTok(pd.tokensToday.input)} in / ${fmtTok(pd.tokensToday.output)} out</span>` : ''}
        <span style="font-size:12px;font-weight:700;min-width:50px;text-align:right">${fmtCost(cost)}</span>
        ${pct > 0 ? `<span style="font-size:9px;color:var(--ci-text-tertiary);width:28px;text-align:right">${pct}%</span>` : '<span style="width:28px"></span>'}
      </div>`;
    });

    // Aggregate by model
    const byModel = {};
    log.forEach(c => {
      const m = c.model || c.provider;
      if (!byModel[m]) byModel[m] = { calls: 0, input: 0, output: 0, cost: 0 };
      byModel[m].calls++;
      byModel[m].input += c.input || 0;
      byModel[m].output += c.output || 0;
      byModel[m].cost += c.cost || 0;
    });
    let modelRows = '';
    Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).forEach(([model, m]) => {
      const short = model.replace(/^claude-/, '').replace(/^gpt-/, '');
      modelRows += `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
        <span style="flex:1;font-size:11px;font-family:var(--ci-font-mono)">${short}</span>
        <span style="font-size:10px;color:var(--ci-text-tertiary)">${m.calls}x</span>
        <span style="font-size:10px;color:var(--ci-text-tertiary);font-family:var(--ci-font-mono)">${fmtTok(m.input)} / ${fmtTok(m.output)}</span>
        <span style="font-size:11px;font-weight:700;min-width:50px;text-align:right">${fmtCost(m.cost)}</span>
      </div>`;
    });

    // Recent calls (last 20)
    const opLabels = { chat: 'Chat', scoring: 'Score', research: 'Research', insight: 'Insight', profile: 'Profile', rewrite: 'Rewrite', extract: 'Extract', quick_lookup: 'Lookup' };
    let recentRows = '';
    log.slice(-20).reverse().forEach(c => {
      const short = (c.model || '').replace(/^claude-/, '').replace(/^gpt-/, '');
      const ago = Math.round((Date.now() - c.ts) / 60000);
      const agoStr = ago < 1 ? 'now' : ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`;
      const opLabel = opLabels[c.op] || c.op || '';
      recentRows += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:10px;color:var(--ci-text-secondary);">
        <span style="width:24px;color:var(--ci-text-tertiary);text-align:right;flex-shrink:0">${agoStr}</span>
        ${opLabel ? `<span style="font-size:9px;font-weight:600;color:var(--ci-text-tertiary);background:var(--ci-bg-inset);border-radius:3px;padding:1px 4px;flex-shrink:0">${opLabel}</span>` : ''}
        <span style="flex:1;font-family:var(--ci-font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${short}</span>
        <span style="color:var(--ci-text-tertiary)">${c.input || c.output ? fmtTok(c.input) + '/' + fmtTok(c.output) : '—'}</span>
        <span style="font-weight:600;min-width:40px;text-align:right">${c.cost > 0 ? fmtCost(c.cost) : '—'}</span>
      </div>`;
    });

    // Remove if already open
    const existing = document.getElementById('cost-modal-overlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'cost-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `<div style="background:var(--ci-bg-raised);border:1px solid var(--ci-border-default);border-radius:14px;box-shadow:var(--ci-shadow-lg);width:480px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;animation:thinkFadeIn 0.2s ease;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--ci-border-subtle);display:flex;align-items:center;gap:12px;">
        <span style="font-size:15px;font-weight:700;flex:1">API Costs — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span style="font-size:18px;font-weight:800;color:var(--ci-accent-primary)">${fmtCost(totalCost)}</span>
        <button id="cost-modal-close" style="background:none;border:none;font-size:20px;color:var(--ci-text-tertiary);cursor:pointer;padding:0 4px;line-height:1">&times;</button>
      </div>
      <div style="overflow-y:auto;padding:12px 20px;">
        <div style="margin-bottom:16px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--ci-text-tertiary);margin-bottom:6px">By Provider</div>
          ${provRows || '<div style="font-size:12px;color:var(--ci-text-tertiary);padding:8px 0">No API calls today</div>'}
        </div>
        ${modelRows ? `<div style="margin-bottom:16px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--ci-text-tertiary);margin-bottom:6px">By Model</div>${modelRows}</div>` : ''}
        ${recentRows ? `<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--ci-text-tertiary);margin-bottom:6px">Recent Calls</div>${recentRows}</div>` : ''}
      </div>
      <div style="padding:10px 20px;border-top:1px solid var(--ci-border-subtle);font-size:10px;color:var(--ci-text-tertiary);text-align:center;display:flex;align-items:center;justify-content:space-between">
        <span>${log.length} API calls today &middot; Resets at midnight</span>
        <a href="coop-settings.html" style="color:var(--ci-accent-primary);font-weight:600;text-decoration:none;font-size:11px">Full Report &rarr;</a>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('cost-modal-close')?.addEventListener('click', () => overlay.remove());
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiUsage) { updateCostPill(); }
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
  if (msg.type === 'SCORE_COMPLETE' && msg.companyId) {
    const idx = allCompanies.findIndex(c => c.id === msg.companyId);
    if (idx !== -1) {
      const updates = {};
      if (msg.score != null) updates.fitScore = msg.score;
      if (msg.scoredAt) updates.scoredAt = msg.scoredAt;
      if (msg.jobSnapshot) updates.jobSnapshot = msg.jobSnapshot;
      if (msg.keySignals) updates.keySignals = msg.keySignals;
      if (msg.hardDQ) updates.hardDQ = msg.hardDQ;
      allCompanies[idx] = { ...allCompanies[idx], ...updates, _queuedForScoring: false };
      _scoreRenderHits++;
      clearTimeout(_scoreRenderTimer);
      _scoreRenderTimer = setTimeout(() => {
        console.log('[debounce:score] render() fired after', _scoreRenderHits, 'coalesced SCORE_COMPLETE(s)');
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

  // ── Board toolbar ─────────────────────────────────────────────────────────
  // Compute chip counts from allCompanies (filtered to current pipeline type)
  const pipelineItems = allCompanies.filter(c =>
    activePipeline === 'opportunity' ? !!c.isOpportunity : !c.isOpportunity
  );
  const today = new Date().setHours(0,0,0,0);
  const chipCounts = {
    all:      pipelineItems.length,
    my_court: pipelineItems.filter(c => c.actionStatus === 'my_court').length,
    overdue:  pipelineItems.filter(c => c.nextStepDate && new Date(c.nextStepDate).setHours(0,0,0,0) < today).length,
  };

  const toolbarHtml = `<div class="board-toolbar">
    <div class="tb-search">
      <span class="tb-search-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l3 3"/></svg></span>
      <input class="tb-search-input" id="board-search" placeholder="Search companies, roles, tags\u2026" value="${escapeHtml(boardSearch || '')}">
    </div>
    <div class="tb-divider"></div>
    <div class="tb-group">
      <button class="tb-chip${activeFilter === 'all' ? ' active' : ''}" data-filter="all">All <span class="tb-chip-count">${chipCounts.all}</span></button>
      <button class="tb-chip${activeFilter === 'my_court' ? ' active' : ''}" data-filter="my_court">My court <span class="tb-chip-count">${chipCounts.my_court}</span></button>
      <button class="tb-chip${activeFilter === 'overdue' ? ' active' : ''}" data-filter="overdue">Overdue <span class="tb-chip-count">${chipCounts.overdue}</span></button>
      <button class="tb-chip${activeFilter === 'qualified' ? ' active' : ''}" data-filter="qualified">Qualified</button>
      <button class="tb-chip${activeFilter === 'starred' ? ' active' : ''}" data-filter="starred">Starred</button>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-view-toggle">
      <button class="tb-view-btn${viewMode === 'kanban' ? ' active' : ''}" data-view="kanban"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="4" height="14" rx="1"/><rect x="6" y="1" width="4" height="14" rx="1"/><rect x="11" y="1" width="4" height="14" rx="1"/></svg> Kanban</button>
      <button class="tb-view-btn${viewMode !== 'kanban' ? ' active' : ''}" data-view="grid"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> Table</button>
    </div>
    <button class="tb-icon-btn" data-coming-soon="group" title="Group by"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M4 8h8M6 12h4"/></svg></button>
    <button class="tb-icon-btn" data-coming-soon="sort" title="Sort"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5l5-3 5 3M7 2v12M4 10l3 3 3-3"/></svg></button>
    <button class="tb-icon-btn" data-coming-soon="more" title="More"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg></button>
  </div>`;

  // Skip the scoring queue + apply queue columns in opportunity pipeline — they have dedicated pages
  // Always render closed_lost stage last regardless of storage order
  const stagesForRender = [...stages].sort((a, b) => {
    const aTerminal = stageTypeVisual(a.stageType).isTerminal ? 1 : 0;
    const bTerminal = stageTypeVisual(b.stageType).isTerminal ? 1 : 0;
    return aTerminal - bTerminal;
  });

  const renderStages = (activePipeline === 'opportunity') ? stagesForRender.filter(s => s.key !== QUEUE_STAGE && s.key !== 'want_to_apply') : stagesForRender;
  const columnsHtml = renderStages.map((stageObj) => {
    const statusKey = stageObj.key;
    const statusLabel = stageObj.label;
    const cards = filtered.filter(c => {
      const s = (activePipeline === 'opportunity' ? c.jobStage : c.status) || stages[0].key;
      return validKeys.has(s) ? s === statusKey : statusKey === stages[0].key;
    });
    // Queue column: scored first (by fitScore desc), then scoring, then unscored
    if (statusKey === QUEUE_STAGE && activePipeline === 'opportunity') {
      cards.sort((a, b) => {
        const aScore = a.fitScore ?? a.jobMatch?.score ?? null;
        const bScore = b.fitScore ?? b.jobMatch?.score ?? null;
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
        const sa = a.jobMatch?.score ? applyExcitementModifier(a.jobMatch.score, a.rating).final : (a.fitScore || -1);
        const sb = b.jobMatch?.score ? applyExcitementModifier(b.jobMatch.score, b.rating).final : (b.fitScore || -1);
        if (sb !== sa) return sb - sa;
        // Scheduled items surface above same-score items
        const actionPriority = { scheduled: 2, my_court: 1, their_court: 0 };
        const aP = actionPriority[a.actionStatus || 'my_court'] || 0;
        const bP = actionPriority[b.actionStatus || 'my_court'] || 0;
        if (bP !== aP) return bP - aP;
        return (computeLastActivity(b).timestamp || b.savedAt || 0) - (computeLastActivity(a).timestamp || a.savedAt || 0);
      });
    }

    // Stage type visual — drives dot color and quiet-column logic
    const typeVisual = stageTypeVisual(stageObj.stageType);
    const dotColor = typeVisual.dotColor;

    const isCollapsed = _collapsedCols.has(statusKey);
    const colMode = getColViewMode(statusKey);
    const toggleIcon = colMode === 'compact' ? '☰' : '▤';
    const toggleTitle = colMode === 'compact' ? 'Switch to standard view' : 'Switch to compact view';
    const renderCard = colMode === 'compact' ? renderCompactCard : renderKanbanCard;

    // Applied quiet-column: outreach-type columns with >10 entries collapse by default.
    // User can expand per-session. State tracked in _expandedQuietCols (session-only).
    const QUIET_THRESHOLD = 10;
    const isQuietCandidate = typeVisual.isQuietColumn && cards.length > QUIET_THRESHOLD;
    const isExpanded = _expandedQuietCols.has(statusKey);
    const showQuietMode = isQuietCandidate && !isExpanded;

    const emptyBlock = `<div class="col-empty">
          <div class="col-empty-title">Nothing here yet.</div>
          <div class="col-empty-hint">${escapeHtml(stageObj.emptyHint || 'Drop a card when something lands in this stage.')}</div>
        </div>`;

    return `
      <div class="kanban-col${isCollapsed ? ' collapsed' : ''}${showQuietMode ? ' quiet-col' : ''}" data-col-key="${statusKey}">
        <div class="kanban-col-header board-col-header" data-status="${statusKey}" style="border-top-color:${dotColor};border-left-color:${dotColor}">
          <div class="board-col-dot col-color-dot" data-col="${statusKey}" style="--stage-color:${dotColor};background:${dotColor}"></div>
          <span class="kanban-col-title">${escapeHtml(statusLabel)}</span>
          <span class="kanban-col-count">${cards.length}</span>
          ${statusKey === QUEUE_STAGE && activePipeline === 'opportunity' ? `<button class="col-rescore-btn" data-col="${statusKey}" title="Re-score all entries in queue">↻ Re-score</button>` : ''}
          ${showQuietMode ? `<button class="col-quiet-expand" data-col="${statusKey}" title="Show all ${cards.length} entries in this column">Expand</button>` : ''}
          ${!showQuietMode ? `<button class="col-view-toggle" data-col="${statusKey}" title="${toggleTitle}">${toggleIcon}</button>` : ''}
          <div class="board-col-actions">
            <button class="col-act kanban-col-collapse" data-collapse="${statusKey}" title="${isCollapsed ? 'Expand' : 'Collapse'}">⟨</button>
            <button class="col-act col-act-menu" data-menu="${statusKey}" title="More">⋯</button>
          </div>
        </div>
        <div class="kanban-cards" data-status="${statusKey}">
          ${showQuietMode
            ? `<div class="kanban-quiet-info">
                 <span style="font-size:13px;color:var(--ci-text-secondary)">${cards.length} entries — high volume</span>
                 <button class="col-quiet-expand-inline" data-col="${statusKey}" style="margin-top:8px;padding:6px 14px;font-size:12px;font-weight:600;background:transparent;border:1px solid var(--ci-border-default);border-radius:var(--ci-radius-sm);cursor:pointer;color:var(--ci-text-secondary);font-family:inherit;">Show all ${cards.length}</button>
               </div>`
            : (cards.length ? cards.map(c => renderCard(c)).join('') : emptyBlock)}
          <button class="board-col-add" data-stage="${statusKey}">
            <span class="board-col-add-circle">+</span>Add card
          </button>
        </div>
      </div>`;
  }).join('');

  // Add-stage ghost column
  const addStageHtml = `<button class="board-add-stage" id="board-add-stage">
    <span class="board-add-stage-circle">+</span>
    <span class="board-add-stage-label">Add stage</span>
  </button>`;

  // Toolbar goes in a sibling div above the board (not inside the flex-row board container)
  let toolbarEl = document.getElementById('kanban-toolbar-row');
  if (!toolbarEl) {
    toolbarEl = document.createElement('div');
    toolbarEl.id = 'kanban-toolbar-row';
    board.parentNode.insertBefore(toolbarEl, board);
  }
  toolbarEl.innerHTML = toolbarHtml;
  board.innerHTML = columnsHtml + addStageHtml;

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

// Returns { actionClass, isStale, isOverdue } for visual tagging on cards
function computeCardIndicators(c) {
  const actionStatus = c.actionStatus || 'my_court';
  const actionClass = actionStatus === 'my_court' ? 'action-my-court'
    : actionStatus === 'their_court' ? 'action-their-court'
    : actionStatus === 'scheduled' ? 'action-scheduled' : '';

  // Staleness: compare last activity timestamp to threshold
  let isStale = false;
  if (_stalenessThresholdDays > 0 && c.isOpportunity) {
    const act = computeLastActivity(c);
    const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
    const currentStage = c[stageField] || '';
    const stageTs = c.stageTimestamps?.[currentStage] || c.savedAt || 0;
    const lastTs = Math.max(act.timestamp || 0, stageTs);
    const ageMs = Date.now() - lastTs;
    const ageDays = ageMs / 86400000;
    // Skip terminal/waiting stages: rejected, dismissed, offer
    const skipStages = new Set(['rejected', 'dismissed', 'offer', 'hired', 'co_watchlist', 'needs_review']);
    if (!skipStages.has(currentStage) && lastTs > 0 && ageDays > _stalenessThresholdDays) {
      isStale = true;
    }
  }

  // Overdue: nextStepDate is in the past
  let isOverdue = false;
  if (c.nextStepDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(c.nextStepDate + 'T00:00:00');
    if (due < today) isOverdue = true;
  }

  return { actionClass, isStale, isOverdue };
}

function renderKanbanCard(c) {
  const isJob = !!c.isOpportunity;
  const currentStage = activePipeline === 'opportunity' ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');

  // Favicon
  const faviconDomain = c.companyWebsite?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const faviconHtml = faviconDomain
    ? `<img class="kc-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" data-img-fallback="hide">`
    : '<span class="kc-favicon kc-favicon-placeholder"></span>';

  // Indicator state + day counts
  const { isStale, isOverdue } = computeCardIndicators(c);
  let overdueDays = 0, staleDays = 0;
  if (isOverdue && c.nextStepDate) {
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(c.nextStepDate + 'T00:00:00');
    overdueDays = Math.max(1, Math.round((today - due) / 86400000));
  }
  if (isStale) {
    const act = computeLastActivity(c);
    const stageTs = c.stageTimestamps?.[currentStage] || c.savedAt || 0;
    const lastTs = Math.max(act.timestamp || 0, stageTs);
    if (lastTs > 0) staleDays = Math.round((Date.now() - lastTs) / 86400000);
  }

  // Score (spectrum by score value)
  let scoreHtml = '';
  if (isJob && c.jobMatch?.score) {
    const { final, mod } = applyExcitementModifier(c.jobMatch.score, c.rating);
    const tier = final >= 7.5 ? 's-green' : final >= 6.0 ? 's-amber' : final >= 4.5 ? 's-orange' : 's-red';
    const modHtml = mod > 0 ? `<span class="kc-score-mod up">+${mod}</span>` : mod < 0 ? `<span class="kc-score-mod down">${mod}</span>` : '';
    const agoText = c.jobMatchScoredAt ? (() => {
      const d = Math.round((Date.now() - c.jobMatchScoredAt) / 86400000);
      return d === 0 ? 'today' : d === 1 ? '1d ago' : d + 'd ago';
    })() : '';
    scoreHtml = `<div class="kc-score ${tier}" title="Coop's score${agoText ? ' · last scored ' + agoText : ''}">${final}<span class="kc-score-d">/10</span>${modHtml}</div>`;
  } else if (isJob && c._scoring) {
    scoreHtml = '<div class="kc-scoring">Scoring\u2026</div>';
  } else if (isJob && c.jobDescription && !c.jobMatch) {
    scoreHtml = `<button class="kc-score-btn score-match-btn" data-id="${c.id}">Score match</button>`;
  }

  // Job title (hyperlinked to jobUrl when present)
  const jobTitleHtml = isJob && c.jobTitle
    ? (c.jobUrl
      ? `<a class="kc-job card-job-link" href="${safeUrl(c.jobUrl)}" target="_blank">${escapeHtml(c.jobTitle)}</a>`
      : `<span class="kc-job">${escapeHtml(c.jobTitle)}</span>`)
    : '';

  // External links
  const extLinksHtml = (c.companyLinkedin || c.companyWebsite)
    ? `<div class="kc-ext-links">${c.companyLinkedin ? `<a class="card-link card-link-li" href="${safeUrl(c.companyLinkedin)}" target="_blank">LinkedIn</a>` : ''}${c.companyWebsite ? `<a class="card-link card-link-web" href="${safeUrl(c.companyWebsite)}" target="_blank">Website</a>` : ''}</div>`
    : '';

  // Indicator pills (overdue/stale only — no Hard DQ)
  const indicatorPills = [];
  if (isOverdue) indicatorPills.push(`<span class="kc-pill bad">Overdue ${overdueDays}d</span>`);
  if (isStale && staleDays > 0) indicatorPills.push(`<span class="kc-pill">Stale ${staleDays}d</span>`);
  const indicatorsHtml = indicatorPills.length ? `<div class="kc-indicators">${indicatorPills.join('')}</div>` : '';

  // Meta row: comp · arrangement · review · stars
  const metaParts = [];
  if (isJob) {
    let compText = c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary || '';
    if (compText && c.jobTitle && compText.toLowerCase().startsWith(c.jobTitle.toLowerCase())) {
      compText = compText.slice(c.jobTitle.length).replace(/^[\s:—–\-,.;with]+/i, '').trim();
      if (!/[\$\d]/.test(compText.slice(0, 20))) {
        const m = compText.match(/\$[\d,]+[KkMm]?(?:\s*[-–]\s*\$[\d,]+[KkMm]?)?/);
        compText = m ? m[0] : '';
      }
    }
    const isOte = c.oteTotalComp || c.jobSnapshot?.salaryType === 'ote';
    if (compText) metaParts.push(`<span>${escapeHtml(compText)}${isOte ? ' OTE' : ''}</span>`);

    if (c.workArrangement) {
      const userWantsRemote = Array.isArray(_userWorkArrangement) && _userWorkArrangement.some(w => /remote/i.test(w));
      const arrMismatch = userWantsRemote && /on.?site|hybrid/i.test(c.workArrangement);
      metaParts.push(`<span${arrMismatch ? ' class="kc-mismatch"' : ''}>${escapeHtml(c.workArrangement)}</span>`);
    }
  }

  const ratingReview = (c.reviews || []).find(r => r.rating);
  if (ratingReview) {
    const rating = parseFloat(ratingReview.rating);
    const warnCls = rating < 3.0 ? ' kc-warn' : '';
    const src = ratingReview.source || 'Glassdoor';
    const txt = `${rating} ${escapeHtml(src)}`;
    metaParts.push(ratingReview.url
      ? `<a class="kc-review${warnCls}" href="${safeUrl(ratingReview.url)}" target="_blank" rel="noopener">${txt}</a>`
      : `<span class="${warnCls.trim()}">${txt}</span>`);
  }

  // Stars — SVG, always shown, interactive
  const starsHtml = `<span class="card-stars kc-stars">${[1,2,3,4,5].map(i =>
    `<svg class="star ${(c.rating||0) >= i ? 'filled' : ''}" data-id="${c.id}" data-val="${i}" viewBox="0 0 10 10" aria-label="Rate ${i}"><polygon points="5,1 6.2,3.8 9,4 7,6 7.6,9 5,7.5 2.4,9 3,6 1,4 3.8,3.8"/></svg>`
  ).join('')}</span>`;
  metaParts.push(starsHtml);

  const metaHtml = metaParts.length
    ? `<div class="kc-meta">${metaParts.map((p, i) => i > 0 ? '<span class="kc-sep"></span>' + p : p).join('')}</div>`
    : '';

  // Flags (green/red dot-led lines from keySignals)
  const keySignals = c.jobMatch?.keySignals || c.keySignals || [];
  const flagsHtml = keySignals.length
    ? `<div class="kc-flags">${keySignals.slice(0, 4).map(qt =>
        `<div class="kc-flag ${qt.type === 'green' ? 'pos' : 'neg'}"><span class="kc-flag-dot"></span><span>${escHtml(qt.text)}</span></div>`
      ).join('')}</div>`
    : '';

  // One-liner (suppress if duplicates job title)
  let oneLinerHtml = '';
  if (c.oneLiner) {
    let show = true;
    if (c.jobTitle) {
      const titleLower = c.jobTitle.toLowerCase().trim();
      const oneLower = c.oneLiner.toLowerCase().trim();
      if (oneLower.startsWith(titleLower) || titleLower.startsWith(oneLower.slice(0, titleLower.length))) show = false;
    }
    if (show) oneLinerHtml = `<div class="kc-oneliner">${escapeHtml(c.oneLiner)}</div>`;
  }

  // Next-step grid (inline-editable Action / Next Step / Next Step Date, static Last Activity)
  const actionStatuses = customActionStatuses || DEFAULT_ACTION_STATUSES;
  const actionSelectOptions = actionStatuses.map(s =>
    `<option value="${s.key}" ${(c.actionStatus || 'my_court') === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');
  const actionValueClass = (c.actionStatus || 'my_court').replace(/_/g, '-');

  const act = computeLastActivity(c);
  const lastActivityHtml = act.label && act.timestamp
    ? (() => {
        const dateStr = new Date(act.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<span class="kc-k">Last Activity</span><span class="kc-v kc-muted" title="${escapeHtml(act.label)} · ${dateStr}">${dateStr} — ${escapeHtml(act.label)}</span>`;
      })()
    : '';

  const nextHtml = `
      <div class="kc-next">
        <span class="kc-k">Action</span>
        <span class="kc-v"><span class="kc-select-wrap"><select class="kanban-action-status kc-select ${actionValueClass}" data-id="${c.id}">${actionSelectOptions}</select></span></span>
        <span class="kc-k">Next Step</span>
        <span class="kc-v"><input class="kanban-next-step-input kc-input" data-id="${c.id}" type="text" placeholder="Add next step\u2026" value="${(c.nextStep || '').replace(/"/g, '&quot;')}"></span>
        <span class="kc-k">Next Step Date</span>
        <span class="kc-v"><input class="kanban-next-step-date kc-input${c.nextStepDate ? ' has-value' : ''}" data-id="${c.id}" type="date" value="${c.nextStepDate || ''}"></span>
        ${lastActivityHtml}
      </div>`;

  // Tags — existing user tags + subtle + button always visible
  const tagsHtml = `
      <div class="kc-tags card-tags" id="tags-${c.id}">
        ${(c.tags || []).map(tag => {
          const cl = tagColor(tag);
          return `<span class="kc-tag card-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}" data-tag="${tag}" data-id="${c.id}">${escapeHtml(tag)}<span class="tag-remove" data-tag="${tag}" data-id="${c.id}">\u2715</span></span>`;
        }).join('')}
        <div class="tag-inline-wrap" id="tag-add-wrap-${c.id}">
          <button class="kc-tag-add tag-add-btn" data-id="${c.id}" title="Add tag">+</button>
        </div>
      </div>`;

  const dataConflictHtml = c.dataConflict
    ? ` <span class="kc-conflict" title="Intel may be inaccurate">!</span>`
    : '';

  return `
    <div class="kanban-card" draggable="true" data-id="${c.id}" data-type="company" id="kcard-${c.id}">
      <div class="kanban-card-header kc-header">
        <div class="kc-ident">
          <div class="kc-title-row">
            ${faviconHtml}
            <a class="kc-company kanban-card-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}">${escapeHtml(c.company)}</a>${dataConflictHtml}
          </div>
          ${jobTitleHtml}
          ${extLinksHtml}
        </div>
        ${scoreHtml}
        <button class="kc-del card-delete" data-id="${c.id}" title="Remove">\u2715</button>
      </div>
      ${indicatorsHtml}
      ${metaHtml}
      ${flagsHtml}
      ${oneLinerHtml}
      ${nextHtml}
      ${tagsHtml}
    </div>`;
}

function bindKanbanEvents(board) {
  // Column collapse/expand (delegated — works for dynamic state changes)
  board.addEventListener('click', e => {
    // Quiet-column expand button (in header or inline in cards area)
    const quietExpandBtn = e.target.closest('.col-quiet-expand, .col-quiet-expand-inline');
    if (quietExpandBtn) {
      e.stopPropagation();
      const key = quietExpandBtn.dataset.col;
      _expandedQuietCols.add(key);
      render(); // re-render with this column now expanded
      return;
    }

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
      applyAutoStage(entry, newStatus, changes);
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
    btn.addEventListener('click', async () => {
      const name = allCompanies.find(c => c.id === btn.dataset.id)?.company || 'this entry';
      if (await ciConfirm(`Remove ${name}?`, { confirmLabel: 'Remove' })) {
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
      chrome.runtime.sendMessage(
        { type: 'SCORE_OPPORTUNITY', entryId: id },
        result => {
          void chrome.runtime.lastError;
          if (result?.error) { btn.disabled = false; btn.textContent = 'Score match'; return; }
          // scoreOpportunity persists + broadcasts SCORE_COMPLETE → listener handles render
        }
      );
    });
  });

  board.querySelectorAll('.card-notes').forEach(ta => {
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => updateCompany(ta.dataset.id, { notes: ta.value }));
  });

  board.querySelectorAll('.kanban-action-status').forEach(sel => {
    sel.addEventListener('mousedown', e => e.stopPropagation());
    // Color the select to match the selected action status
    const colorActionSelect = (s) => {
      const statuses = customActionStatuses || DEFAULT_ACTION_STATUSES;
      const match = statuses.find(st => st.key === s.value);
      if (match) s.style.color = match.color;
    };
    colorActionSelect(sel);
    sel.addEventListener('change', () => {
      colorActionSelect(sel);
      updateCompany(sel.dataset.id, { actionStatus: sel.value });
    });
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
        openQueueOverlay(`queue.html?mode=dq&id=${entry.id}`);
      } else {
        coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id);
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
            chrome.runtime.sendMessage({ type: 'SCORE_OPPORTUNITY', entryId: entry.id }, result => {
              void chrome.runtime.lastError;
              const cardEl = document.getElementById('kcard-' + entry.id) || document.querySelector(`.compact-card[data-id="${entry.id}"]`);
              if (result && !result.error) {
                const idx = allCompanies.findIndex(c => c.id === entry.id);
                if (idx >= 0) {
                  if (result.fitScore != null) allCompanies[idx].fitScore = result.fitScore;
                  if (result.fitReason) allCompanies[idx].fitReason = result.fitReason;
                  if (result.keySignals) allCompanies[idx].keySignals = result.keySignals;
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
      applyAutoStage(entry, nextStage, changes);
      updateCompany(id, changes);
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
      const dismissKey = (typeof getDismissStageKey === 'function') ? getDismissStageKey(customOpportunityStages) : DISMISS_STAGE;
      updateCompany(id, {
        jobStage: dismissKey,
        tags,
        ...stageEnterTimestamp(entry, dismissKey),
      });
    });
  });

  // Compact card click — open score preview modal (queue cards) or full page (others)
  board.querySelectorAll('.compact-card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      const entry = allCompanies.find(c => c.id === cardEl.dataset.id);
      if (!entry) return;
      if (entry.jobMatch?.score != null || entry.fitScore != null) {
        openQueueOverlay(`queue.html?mode=dq&id=${entry.id}`);
      } else {
        coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id);
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

  // Compact card inline tag add
  board.querySelectorAll('.compact-add-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      // Replace the + button with an inline input
      const tagsDiv = btn.closest('.compact-tags');
      if (!tagsDiv || tagsDiv.querySelector('.tag-inline-input')) return;
      btn.style.display = 'none';
      const wrap = document.createElement('span');
      wrap.style.cssText = 'position:relative;display:inline-block;';
      wrap.innerHTML = `<input class="tag-inline-input" style="font-size:10px;width:80px;padding:1px 5px;border:1px solid var(--ci-accent-primary);border-radius:3px;outline:none;background:var(--ci-bg-raised);color:var(--ci-text-primary);" placeholder="tag name" autocomplete="off"><div class="compact-tag-sugg" style="display:none;position:absolute;top:100%;left:0;z-index:50;background:var(--ci-bg-raised);border:1px solid var(--ci-border-default);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.1);min-width:100px;max-height:120px;overflow-y:auto;"></div>`;
      tagsDiv.insertBefore(wrap, btn);
      const input = wrap.querySelector('input');
      const sugg = wrap.querySelector('.compact-tag-sugg');
      input.focus();
      input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        const entry = allCompanies.find(c => c.id === id);
        const existing = entry?.tags || [];
        if (!val) { sugg.style.display = 'none'; return; }
        const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !existing.includes(t));
        if (!matches.length) { sugg.style.display = 'none'; return; }
        sugg.innerHTML = matches.slice(0, 5).map(t => `<div style="padding:4px 8px;cursor:pointer;font-size:11px;" data-tag="${escHtml(t)}">${escHtml(t)}</div>`).join('');
        sugg.style.display = 'block';
        sugg.querySelectorAll('[data-tag]').forEach(s => {
          s.addEventListener('mousedown', ev => { ev.preventDefault(); commitTag(id, s.dataset.tag); });
          s.addEventListener('mouseenter', () => { s.style.background = 'var(--ci-bg-inset)'; });
          s.addEventListener('mouseleave', () => { s.style.background = ''; });
        });
      });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); const val = input.value.trim(); if (val) commitTag(id, val); }
        if (ev.key === 'Escape') render();
      });
      input.addEventListener('blur', () => setTimeout(() => render(), 200));
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
                applyAutoStage(entry, interestedKey, changes);
                updateCompany(entryId, changes);
              } else {
                const dismissKey = (typeof getDismissStageKey === 'function') ? getDismissStageKey(customOpportunityStages) : DISMISS_STAGE;
                const ts = { ...(entry.stageTimestamps || {}) }; ts[dismissKey] = now;
                const tags = [...new Set([...(entry.tags || []), DISMISS_TAG])];
                if (!allKnownTags.includes(DISMISS_TAG)) { allKnownTags.push(DISMISS_TAG); chrome.storage.local.set({ allTags: allKnownTags }); }
                const changes = { jobStage: dismissKey, stageTimestamps: ts, tags };
                applyAutoStage(entry, dismissKey, changes);
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

  // ── Board toolbar event wiring ────────────────────────────────────────────

  // Search
  const boardSearchInput = document.getElementById('board-search');
  if (boardSearchInput) {
    boardSearchInput.addEventListener('input', () => {
      boardSearch = boardSearchInput.value;
      localStorage.setItem('ci_boardSearch', boardSearch);
      applyBoardSearchFilter();
    });
    // Prevent search keystrokes from bubbling to page-level shortcut handlers
    boardSearchInput.addEventListener('keydown', e => e.stopPropagation());
  }

  // Filter chips (toolbar is a sibling of board — use document scope)
  const _toolbarEl = document.getElementById('kanban-toolbar-row');
  if (_toolbarEl) {
    _toolbarEl.querySelectorAll('.tb-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        localStorage.setItem('ci_boardFilter', activeFilter);
        render();
      });
    });

    // View switcher (tb-view-btn) — route through setViewMode so existing
    // legacy view-toggle button states + column-picker visibility update too.
    _toolbarEl.querySelectorAll('.tb-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === viewMode) return;
        if (typeof setViewMode === 'function') setViewMode(view);
        else { viewMode = view; localStorage.setItem('ci_viewMode', view); render(); }
      });
    });

    // Coming-soon icon buttons
    _toolbarEl.querySelectorAll('.tb-icon-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showComingSoonPopover(btn, btn.dataset.comingSoon);
      });
    });
  }

  // Add card button
  board.querySelectorAll('.board-col-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showInlineCardComposer(btn, btn.dataset.stage);
    });
  });

  // Column action menu (⋯) — opens stage editor
  board.querySelectorAll('.col-act-menu').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openStageEditor();
    });
  });

  // Add stage ghost column
  document.getElementById('board-add-stage')?.addEventListener('click', () => {
    openStageEditor();
  });

  // Apply boardSearch filter immediately after render (restore persisted search state)
  if (boardSearch) applyBoardSearchFilter();
}

// ── Board toolbar helpers ────────────────────────────────────────────────────

function applyBoardSearchFilter() {
  const q = (boardSearch || '').toLowerCase().trim();
  const cards = document.querySelectorAll('.kanban-card, .compact-card');
  if (!q) {
    cards.forEach(c => { c.style.opacity = ''; c.style.boxShadow = ''; });
    return;
  }
  cards.forEach(c => {
    const text = c.textContent.toLowerCase();
    const matches = text.includes(q);
    c.style.opacity = matches ? '1' : '0.2';
    c.style.boxShadow = matches ? '0 0 0 1px var(--ci-accent-amber)' : '';
    c.style.transition = 'opacity var(--motion-xs) var(--ease-out), box-shadow var(--motion-xs) var(--ease-out)';
  });
}

function showInlineCardComposer(anchor, stageKey) {
  // Remove any existing composer first
  document.querySelectorAll('.board-add-card-composer').forEach(el => el.remove());
  const composer = document.createElement('div');
  composer.className = 'board-add-card-composer';
  composer.style.cssText = 'padding:8px;background:var(--ci-bg-raised);border:1px solid var(--ci-accent-primary);border-radius:6px;margin-top:6px;';
  composer.innerHTML = `<input class="board-add-card-input" placeholder="Company name" style="width:100%;padding:6px;border:none;background:transparent;font-size:13px;font-family:inherit;outline:none;color:var(--ci-text-primary);">`;
  anchor.parentNode.insertBefore(composer, anchor.nextSibling);
  const input = composer.querySelector('input');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      const name = input.value.trim();
      const isOpp = activePipeline === 'opportunity';
      const newEntry = {
        id: 'ci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        company: name,
        savedAt: Date.now(),
        isOpportunity: isOpp,
        ...(isOpp ? { jobStage: stageKey } : { status: stageKey })
      };
      allCompanies.unshift(newEntry);
      chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
        composer.remove();
        render();
      });
    } else if (e.key === 'Escape') {
      composer.remove();
    }
  });
  input.addEventListener('blur', () => { setTimeout(() => { composer.remove(); }, 200); });
}

function showComingSoonPopover(anchor, kind) {
  document.querySelectorAll('.tb-coming-soon-popover').forEach(el => el.remove());
  const pop = document.createElement('div');
  pop.className = 'tb-coming-soon-popover';
  pop.style.cssText = 'position:fixed;background:var(--ci-bg-raised);border:1px solid var(--ci-border-default);border-radius:8px;padding:10px 14px;box-shadow:var(--ci-shadow-md);z-index:1000;font-size:12px;color:var(--ci-text-primary);max-width:240px;';
  const label = kind === 'group'
    ? 'Group cards by stage, action, or rating.'
    : kind === 'sort'
    ? 'Sort by score, last activity, or saved date.'
    : 'More board options on the way.';
  pop.innerHTML = `<strong>Coming soon.</strong><br><span style="color:var(--ci-text-secondary);">${label}</span>`;
  const rect = anchor.getBoundingClientRect();
  pop.style.left = rect.left + 'px';
  pop.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(pop);
  setTimeout(() => {
    document.addEventListener('click', () => pop.remove(), { once: true });
  }, 50);
}

// View toggle
function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('ci_viewMode', mode);
  document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
  const btnId = mode === 'kanban' ? 'view-kanban-btn' : 'view-grid-btn';
  document.getElementById(btnId)?.classList.add('active');

  // Highlight the header Tasks button when in tasks mode
  const headerTasksBtn = document.getElementById('header-tasks-link');
  if (headerTasksBtn) {
    if (mode === 'tasks') {
      headerTasksBtn.style.color = 'var(--ci-text-on-dark)';
      headerTasksBtn.style.background = 'rgba(255,255,255,0.18)';
      headerTasksBtn.style.borderColor = 'rgba(255,255,255,0.3)';
    } else {
      headerTasksBtn.style.color = '';
      headerTasksBtn.style.background = '';
      headerTasksBtn.style.borderColor = '';
    }
  }

  const colsBtn = document.getElementById('tbl-cols-btn');
  if (colsBtn) colsBtn.style.display = mode === 'grid' ? '' : 'none';

  const grid = document.getElementById('grid');
  const kanban = document.getElementById('kanban-board');
  const tasks = document.getElementById('tasks-view');
  // Show/hide toolbars for CRM views vs tasks
  document.querySelectorAll('.toolbar').forEach(t => t.style.display = mode === 'tasks' ? 'none' : '');
  document.getElementById('activity-section').style.display = mode === 'tasks' ? 'none' : '';
  const ph = document.getElementById('pipeline-header');
  if (ph) ph.style.display = mode === 'tasks' ? 'none' : '';

  if (mode === 'tasks') {
    grid.style.display = 'none';
    kanban.style.display = 'none';
    const _tbRowTasks = document.getElementById('kanban-toolbar-row');
    if (_tbRowTasks) _tbRowTasks.style.display = 'none';
    tasks.style.display = '';
    renderTasksView();
  } else {
    tasks.style.display = 'none';
    render();
  }
}
document.getElementById('view-grid-btn').addEventListener('click', () => setViewMode('grid'));
document.getElementById('view-kanban-btn').addEventListener('click', () => setViewMode('kanban'));
document.getElementById('header-tasks-link')?.addEventListener('click', e => { e.preventDefault(); setViewMode(viewMode === 'tasks' ? 'grid' : 'tasks'); });

// Column picker — permanent handler on the toolbar button
document.getElementById('tbl-cols-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const existing = document.getElementById('tbl-cols-picker');
  if (existing) { existing.remove(); render(); return; }
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.id = 'tbl-cols-picker';
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 316) + 'px';
  const active = getActiveCols();
  const defaults = TABLE_COLUMNS.filter(c => c.defaultOn).map(c => c.key);
  picker.innerHTML = `
    <div class="tcp-header">
      <span class="tcp-title">Columns</span>
      <button class="tcp-reset" id="tcp-reset-btn">Reset to defaults</button>
    </div>
    <div class="tcp-grid">
      ${TABLE_COLUMNS.map(col => `
        <label class="tcp-item${col.locked ? ' tcp-locked' : ''}">
          <input type="checkbox" data-col-key="${col.key}" ${active.includes(col.key) ? 'checked' : ''} ${col.locked ? 'disabled' : ''}>
          <span class="tcp-item-label">${col.label}</span>
        </label>
      `).join('')}
    </div>`;
  document.body.appendChild(picker);
  let dirty = false;
  picker.querySelector('#tcp-reset-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setActiveCols(defaults);
    picker.remove();
    document.removeEventListener('click', closeHandler);
    render();
  });
  picker.querySelectorAll('input[data-col-key]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...picker.querySelectorAll('input[data-col-key]:checked')].map(el => el.dataset.colKey);
      setActiveCols(TABLE_COLUMNS.filter(c => checked.includes(c.key)).map(c => c.key));
      dirty = true;
    });
  });
  const closeHandler = (ev) => {
    if (!picker.contains(ev.target) && ev.target !== btn) {
      picker.remove();
      document.removeEventListener('click', closeHandler);
      if (dirty) render();
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
});

// ── Column filter picker ────────────────────────────────────────────────────
function openColFilterPicker(th, colKey, colDef) {
  const existingId = 'tcf-picker';
  const existing = document.getElementById(existingId);
  // If same column picker is already open, close it
  if (existing) { existing.remove(); document.removeEventListener('click', existing._closeHandler); return; }

  const rect = th.getBoundingClientRect();
  const picker = document.createElement('div');
  picker.id = existingId;

  // Collect unique values with counts from allCompanies
  const valueCounts = new Map();
  allCompanies.forEach(c => {
    const fv = colDef.filterVal(c);
    if (Array.isArray(fv)) {
      fv.forEach(v => { if (v) valueCounts.set(v, (valueCounts.get(v) || 0) + 1); });
    } else if (fv) {
      valueCounts.set(fv, (valueCounts.get(fv) || 0) + 1);
    }
  });

  const activeFilters = new Set(tblFilters[colKey] || []);
  // Sort: active filters first, then by count desc
  const sortedVals = [...valueCounts.entries()].sort((a, b) => {
    const aActive = activeFilters.has(a[0]) ? 1 : 0;
    const bActive = activeFilters.has(b[0]) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (colDef.filterOrder) {
      const ai = colDef.filterOrder.indexOf(a[0]);
      const bi = colDef.filterOrder.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    return b[1] - a[1];
  });

  const isSortAsc = tblSortCol === colKey && tblSortDir === 'asc';
  const isSortDesc = tblSortCol === colKey && tblSortDir === 'desc';

  picker.innerHTML = `
    <div class="tcf-header">
      <span class="tcf-title">${colDef.label}</span>
      <button class="tcf-close-btn">✕</button>
    </div>
    <div class="tcf-sort-row">
      <button class="tcf-sort-btn${isSortAsc ? ' active' : ''}" data-dir="asc">↑ A → Z</button>
      <button class="tcf-sort-btn${isSortDesc ? ' active' : ''}" data-dir="desc">↓ Z → A</button>
    </div>
    <div class="tcf-divider"></div>
    <div class="tcf-filter-head">
      <span class="tcf-filter-label">Filter</span>
      ${activeFilters.size ? `<button class="tcf-clear-btn">Clear filter</button>` : ''}
    </div>
    <div class="tcf-options">
      ${sortedVals.map(([val, count]) => `
        <label class="tcf-option">
          <input type="checkbox" data-fval="${escapeHtml(val)}" ${activeFilters.has(val) ? 'checked' : ''}>
          <span class="tcf-option-label">${escapeHtml(val)}</span>
          <span class="tcf-option-count">${count}</span>
        </label>`).join('')}
      ${sortedVals.length === 0 ? '<div style="padding:10px 14px;font-size:12px;color:var(--ci-text-tertiary)">No data</div>' : ''}
    </div>`;

  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 236) + 'px';
  document.body.appendChild(picker);

  picker.querySelector('.tcf-close-btn')?.addEventListener('click', () => {
    picker.remove();
    document.removeEventListener('click', closeHandler);
  });

  picker.querySelectorAll('.tcf-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      tblSortCol = colKey;
      tblSortDir = btn.dataset.dir;
      picker.remove();
      document.removeEventListener('click', closeHandler);
      render();
    });
  });

  picker.querySelector('.tcf-clear-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    delete tblFilters[colKey];
    picker.remove();
    document.removeEventListener('click', closeHandler);
    render();
  });

  picker.querySelectorAll('input[data-fval]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...picker.querySelectorAll('input[data-fval]:checked')].map(el => el.dataset.fval);
      if (checked.length) tblFilters[colKey] = checked;
      else delete tblFilters[colKey];
      render();
      // Re-anchor picker after render() replaces the th element
      const newTh = document.querySelector(`th[data-col="${colKey}"]`);
      if (newTh) {
        const r = newTh.getBoundingClientRect();
        picker.style.top = (r.bottom + 4) + 'px';
        picker.style.left = Math.min(r.left, window.innerWidth - 236) + 'px';
      }
    });
  });

  const closeHandler = (ev) => {
    if (!picker.contains(ev.target) && !th.contains(ev.target)) {
      picker.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  picker._closeHandler = closeHandler;
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}
// Restore toggle state on load
if (viewMode === 'kanban') {
  document.getElementById('view-kanban-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
  const cb = document.getElementById('tbl-cols-btn'); if (cb) cb.style.display = 'none';
} else if (viewMode === 'tasks') {
  document.getElementById('view-grid-btn').classList.remove('active');
  const htl = document.getElementById('header-tasks-link');
  if (htl) { htl.style.color = 'var(--ci-text-on-dark)'; htl.style.background = 'rgba(255,255,255,0.18)'; htl.style.borderColor = 'rgba(255,255,255,0.3)'; }
  const cb = document.getElementById('tbl-cols-btn'); if (cb) cb.style.display = 'none';
} else {
  // grid (default) — show columns button
  const cb = document.getElementById('tbl-cols-btn'); if (cb) cb.style.display = '';
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

let _tasksViewUndoTimer = null;

function showTasksViewUndoBanner(container, deletedTask) {
  const existing = container.querySelector('.task-undo-banner');
  if (existing) existing.remove();
  if (_tasksViewUndoTimer) { clearTimeout(_tasksViewUndoTimer); _tasksViewUndoTimer = null; }

  const banner = document.createElement('div');
  banner.className = 'task-undo-banner';
  banner.innerHTML = `<span>Task deleted</span><button class="task-undo-btn">Undo</button>`;
  container.appendChild(banner);

  requestAnimationFrame(() => banner.classList.add('visible'));

  banner.querySelector('.task-undo-btn').addEventListener('click', () => {
    if (_tasksViewUndoTimer) { clearTimeout(_tasksViewUndoTimer); _tasksViewUndoTimer = null; }
    banner.remove();
    loadTasks(all => {
      if (!all.find(x => x.id === deletedTask.id)) all.push(deletedTask);
      saveTasks(all, () => renderTasksView());
    });
  });

  _tasksViewUndoTimer = setTimeout(() => {
    banner.classList.remove('visible');
    setTimeout(() => banner.remove(), 200);
    _tasksViewUndoTimer = null;
  }, 5000);
}

function renderTasksView(onRendered) {
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
            <div class="task-text" data-field="text">${escHtml(t.text)}</div>
            <div class="task-meta">
              ${t.company ? `<span class="task-company-link" data-company="${escHtml(t.company)}" data-field="company">${escHtml(t.company)}</span>` : `<span class="task-no-company" data-field="company">No company</span>`}
              <span class="task-priority ${t.priority || 'normal'}" data-field="priority">${(t.priority || 'normal')}</span>
              ${isAuto ? `<span class="task-priority" style="background:#FFF1EC;color:#FF7A59">from email</span>` : ''}
              ${t.dueDate ? `<span class="task-date-value" data-field="dueDate">${t.dueDate}</span>` : `<span class="task-no-date" data-field="dueDate">No date</span>`}
              ${unreviewed ? `<a href="#" class="task-keep" style="color:#FF7A59;font-weight:600">keep</a> · <a href="#" class="task-dismiss" style="color:#7c98b6">dismiss</a>` : ''}
            </div>
            ${isAuto && t.rationale ? `<div style="font-size:11px;color:#7c98b6;font-style:italic;margin-top:2px">"${escHtml(t.rationale)}"</div>` : ''}
          </div>
          ${dl.text ? `<span class="task-date ${dl.cls}">${dl.text}</span>` : ''}
          <button class="task-delete-btn" data-task-id="${t.id}">&times;</button>
        </div>`;
      }).join('') || '<div style="text-align:center;color:#7c98b6;padding:40px;font-size:13px;">No tasks yet — click "+ New Task" to add one</div>'}</div>`;

    if (typeof onRendered === 'function') onRendered();

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
          const deletedTask = tasks.find(t => t.id === id);
          if (!deletedTask) return;
          saveTasks(tasks.filter(t => t.id !== id), () => {
            renderTasksView(() => showTasksViewUndoBanner(container, deletedTask));
          });
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
    // Inline edit handlers
    container.querySelectorAll('[data-field]').forEach(el => {
      const field = el.dataset.field;
      el.style.cursor = 'pointer';

      // For company, allow navigation on double-click, edit on single-click
      if (field === 'company' && el.classList.contains('task-company-link')) {
        let lastClickTime = 0;
        el.addEventListener('click', e => {
          e.stopPropagation();
          const now = Date.now();
          if (now - lastClickTime < 300) {
            // Double-click: navigate
            const name = el.dataset.company;
            const entry = allCompanies.find(c => c.company === name);
            if (entry) coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + entry.id);
          } else {
            // Single-click: edit
            const taskItem = el.closest('.task-item');
            const taskId = taskItem.dataset.taskId;
            if (taskItem.querySelector('[data-task-edit]')) return; // Already editing

            loadTasks(tasks => {
              const t = tasks.find(t => t.id === taskId);
              if (t) editTaskField(taskId, t, 'company', el, tasks);
            });
          }
          lastClickTime = now;
        });
      } else {
        el.addEventListener('click', e => {
          e.stopPropagation();
          const taskItem = el.closest('.task-item');
          const taskId = taskItem.dataset.taskId;

          loadTasks(tasks => {
            const t = tasks.find(t => t.id === taskId);
            if (!t) return;

            // Prevent multiple edit widgets on same task
            if (taskItem.querySelector('[data-task-edit]')) return;

            editTaskField(taskId, t, field, el, tasks);
          });
        });
      }
    });
  });
}

function editTaskField(taskId, task, field, element, allTasks) {
  const taskItem = element.closest('.task-item');
  const originalValue = task[field];

  // Create appropriate edit widget based on field type
  let editWidget;

  if (field === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = originalValue;
    input.setAttribute('data-task-edit', '');
    editWidget = input;

    const saveEdit = () => {
      const newVal = input.value.trim();
      if (newVal && newVal !== originalValue) {
        task.text = newVal;
        saveTasks(allTasks, () => renderTasksView());
      } else {
        renderTasksView();
      }
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { saveEdit(); e.preventDefault(); }
      else if (e.key === 'Escape') { renderTasksView(); e.preventDefault(); }
    });

    element.replaceWith(input);
    input.focus();
    input.select();
  }
  else if (field === 'priority') {
    // Cycle: low → normal → high → low
    const cycles = ['low', 'normal', 'high'];
    const idx = cycles.indexOf(originalValue || 'normal');
    const nextIdx = (idx + 1) % cycles.length;
    task.priority = cycles[nextIdx];
    saveTasks(allTasks, () => renderTasksView());
  }
  else if (field === 'dueDate') {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'task-edit-date';
    input.value = originalValue || '';
    input.setAttribute('data-task-edit', '');
    editWidget = input;

    let saved = false;
    const saveEdit = () => {
      if (saved) return;
      saved = true;
      const newVal = input.value || null;
      const origVal = originalValue || null;
      if (newVal !== origVal) {
        task.dueDate = newVal;
        saveTasks(allTasks, () => renderTasksView());
      } else {
        renderTasksView();
      }
    };

    // Use change as primary save trigger; delay blur to avoid premature close
    // when the native date picker opens (steals focus → fires blur immediately)
    input.addEventListener('change', saveEdit);
    input.addEventListener('blur', () => setTimeout(() => { if (!saved) saveEdit(); }, 200));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { saved = true; renderTasksView(); e.preventDefault(); }
    });

    element.replaceWith(input);
    input.focus();
  }
  else if (field === 'company') {
    const container = document.createElement('div');
    container.className = 'task-edit-company';
    container.setAttribute('data-task-edit', '');

    const select = document.createElement('select');
    select.className = 'task-edit-company-select';

    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = 'No company';
    select.appendChild(optNone);

    allCompanies.filter(c => c.company).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.company;
      opt.textContent = c.company;
      opt.selected = (task.company === c.company);
      select.appendChild(opt);
    });

    const saveEdit = () => {
      const newVal = select.value || null;
      const origVal = originalValue || null;
      if (newVal !== origVal) {
        task.company = newVal;
        saveTasks(allTasks, () => renderTasksView());
      } else {
        renderTasksView();
      }
    };

    select.addEventListener('blur', saveEdit);
    select.addEventListener('change', saveEdit);
    select.addEventListener('keydown', e => {
      if (e.key === 'Escape') { renderTasksView(); e.preventDefault(); }
    });

    container.appendChild(select);
    element.replaceWith(container);
    select.focus();
  }
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
          <button type="button" class="task-priority-btn ${editTask?.priority === 'high' ? 'active' : ''}" data-pri="high">High</button>
          <button type="button" class="task-priority-btn ${(!editTask || editTask?.priority === 'normal') ? 'active' : ''}" data-pri="normal">Normal</button>
          <button type="button" class="task-priority-btn ${editTask?.priority === 'low' ? 'active' : ''}" data-pri="low">Low</button>
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

// escHtml — provided by ui-utils.js
// Restore pipeline state on load (updatePipelineUI is defined later, call after DOM ready)
document.addEventListener('DOMContentLoaded', () => {}, { once: true });
// Pipeline UI is initialized via updatePipelineUI() called from load()

// Stage editor
const STAGE_COLOR_PALETTE = [
  // Grays
  '#64748b', '#475569', '#1e293b',
  // Reds & Pinks
  '#dc2626', '#f87171', '#f472b6', '#ec4899',
  // Oranges & Ambers
  '#fb923c', '#f97316', '#f59e0b', '#d97706',
  // Yellows & Limes
  '#a3e635', '#84cc16', '#facc15', '#eab308',
  // Greens
  '#4ade80', '#22c55e', '#16a34a', '#34d399',
  // Teals & Cyans
  '#22d3ee', '#06b6d4', '#0891b2', '#14b8a6',
  // Blues
  '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8',
  // Purples & Violets
  '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#c084fc',
  // Indigos
  '#6366f1', '#4f46e5'
];
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
    // Closed Lost guard — opportunity pipeline must always retain a closed_lost-typed
    // terminal stage. If the user emptied its label or removed the stageType field,
    // re-append the default rather than letting the system lose its terminal-negative.
    if (!saved.some(s => s.stageType === 'closed_lost')) {
      saved.push({ key: 'rejected', label: "Rejected / DQ'd", color: '#f87171', stageType: 'closed_lost' });
    }
    // Always sort closed_lost-typed stage to the end, matching boot-time enforcement.
    const clIdx = saved.findIndex(s => s.stageType === 'closed_lost');
    if (clIdx !== -1 && clIdx !== saved.length - 1) {
      const [cl] = saved.splice(clIdx, 1);
      saved.push(cl);
    }
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
  list.innerHTML = editingStages.map((s, i) => {
    // closed_lost-typed stage: cannot be deleted or moved out of last position
    const isTerminal = s.stageType === 'closed_lost';
    const isLast = i === editingStages.length - 1;
    const canMoveDown = !isLast && !isTerminal;
    // Can't move up into a position that would put a closed_lost stage before the last slot
    const targetAbove = i - 1;
    const canMoveUp = i > 0 && !isTerminal && editingStages[targetAbove]?.stageType !== 'closed_lost';
    return `
    <div class="stage-row" data-i="${i}">
      <span class="stage-drag-handle" ${isTerminal ? 'style="opacity:0.3;cursor:default;"' : ''}>⠿</span>
      <button class="stage-color-swatch" data-i="${i}" style="background:${s.color};border-color:${s.color}" title="Click to change color"></button>
      <input class="stage-label-input" data-i="${i}" value="${escapeHtml(s.label)}" placeholder="Stage name"${isTerminal ? ' data-terminal="1" title="Terminal stage label cannot be blank"' : ''}>
      ${isTerminal ? '<span style="font-size:11px;color:var(--ci-stage-lost);font-weight:600;white-space:nowrap;padding:0 2px;">Terminal</span>' : ''}
      <div style="display:flex;gap:4px">
        <button class="stage-move-btn" data-i="${i}" data-dir="-1" title="Move up" ${!canMoveUp ? 'disabled' : ''}>↑</button>
        <button class="stage-move-btn" data-i="${i}" data-dir="1" title="Move down" ${!canMoveDown ? 'disabled' : ''}>↓</button>
      </div>
      <button class="stage-delete-btn" data-i="${i}" title="${isTerminal ? 'Terminal stage cannot be deleted' : 'Delete stage'}" ${isTerminal ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>✕</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.stage-label-input').forEach(inp => {
    inp.addEventListener('input', () => { editingStages[inp.dataset.i].label = inp.value; });
    // Terminal stage: prevent blank label on blur (snap back to default if cleared).
    if (inp.dataset.terminal === '1') {
      inp.addEventListener('blur', () => {
        if (!inp.value.trim()) {
          inp.value = "Rejected / DQ'd";
          editingStages[inp.dataset.i].label = inp.value;
        }
      });
    }
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
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i), dir = parseInt(btn.dataset.dir);
      const j = i + dir;
      if (j < 0 || j >= editingStages.length) return;
      // Never allow a move that would displace a closed_lost stage from last position
      if (editingStages[j]?.stageType === 'closed_lost') return;
      [editingStages[i], editingStages[j]] = [editingStages[j], editingStages[i]];
      renderStageEditor();
    });
  });
  list.querySelectorAll('.stage-delete-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      if (editingStages.length <= 1) return;
      if (editingStages[i]?.stageType === 'closed_lost') return; // extra guard
      editingStages.splice(i, 1);
      renderStageEditor();
    });
  });
}
document.getElementById('stage-editor-add').addEventListener('click', () => {
  // Always insert new stages before the terminal (closed_lost) stage if one exists
  const terminalIdx = editingStages.findIndex(s => s.stageType === 'closed_lost');
  const insertIdx = terminalIdx === -1 ? editingStages.length : terminalIdx;
  const newStage = { key: 'stage_' + Date.now(), label: 'New Stage', color: STAGE_COLOR_PALETTE[editingStages.length % STAGE_COLOR_PALETTE.length], stageType: 'active' };
  editingStages.splice(insertIdx, 0, newStage);
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
  openQueueOverlay('queue.html');
});
document.getElementById('apply-header-btn')?.addEventListener('click', () => {
  openQueueOverlay('queue.html?mode=apply');
});

// Search with autocomplete dropdown
(function initSearchAutocomplete() {
  const searchInput = document.getElementById('search');
  const dropdown = document.getElementById('search-dropdown');
  let activeIndex = -1;

  function getMatches(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return allCompanies
      .filter(c =>
        c.company.toLowerCase().includes(q) ||
        (c.jobTitle || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q) ||
        (c.oneLiner || '').toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }

  function renderDropdown(matches) {
    if (!matches.length) {
      dropdown.classList.remove('visible');
      dropdown.innerHTML = '';
      return;
    }
    dropdown.innerHTML = matches.map((c, i) => {
      const detail = c.isOpportunity && c.jobTitle ? escHtml(c.jobTitle) : (c.oneLiner ? escHtml(c.oneLiner) : '');
      return `<div class="search-dropdown-item${i === activeIndex ? ' active' : ''}" data-id="${c.id}">
        <span class="search-dropdown-company">${escHtml(c.company)}</span>
        ${detail ? `<span class="search-dropdown-detail">${detail}</span>` : ''}
      </div>`;
    }).join('');
    dropdown.classList.add('visible');
  }

  searchInput.addEventListener('input', () => {
    activeIndex = -1;
    const q = searchInput.value.trim();
    renderDropdown(getMatches(q));
    render();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('visible');
      activeIndex = -1;
      return;
    }
    const matches = getMatches(searchInput.value.trim());
    if (!matches.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, matches.length - 1);
      renderDropdown(matches);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      renderDropdown(matches);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const match = matches[activeIndex];
      if (match) {
        coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + match.id);
        dropdown.classList.remove('visible');
        activeIndex = -1;
      }
    }
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-dropdown-item');
    if (item) {
      const id = item.dataset.id;
      coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + id);
      dropdown.classList.remove('visible');
      activeIndex = -1;
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      dropdown.classList.remove('visible');
      activeIndex = -1;
    }
  });

  // Re-show dropdown on focus if there's a query
  searchInput.addEventListener('focus', () => {
    const q = searchInput.value.trim();
    if (q) renderDropdown(getMatches(q));
  });
})();

// Pipeline dropdown
function updatePipelineUI() {
  const ddBtn = document.getElementById('pipeline-dd-btn');
  const ddMenu = document.getElementById('pipeline-dd-menu');
  const labelEl = document.getElementById('pipeline-dd-label');
  const labels = { all: 'All Saved', opportunity: 'Opportunity Pipeline', company: 'Company Pipeline' };

  if (labelEl) labelEl.textContent = labels[activePipeline] || 'All Saved';
  if (ddBtn) ddBtn.dataset.active = activePipeline;
  if (ddMenu) {
    ddMenu.querySelectorAll('.pipeline-dd-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.pipeline === activePipeline);
    });
  }

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

(function() {
  const ddBtn = document.getElementById('pipeline-dd-btn');
  const ddMenu = document.getElementById('pipeline-dd-menu');

  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = ddMenu.classList.toggle('open');
    ddBtn.classList.toggle('open', open);
    if (open) {
      const r = ddBtn.getBoundingClientRect();
      ddMenu.style.top  = (r.bottom + 6) + 'px';
      ddMenu.style.left = r.left + 'px';
    }
  });

  ddMenu.querySelectorAll('.pipeline-dd-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const pipeline = opt.dataset.pipeline;
      activePipeline = pipeline;
      localStorage.setItem('ci_activePipeline', activePipeline);
      activeStatus = 'all';
      if (pipeline === 'all' && viewMode === 'kanban') {
        viewMode = 'grid';
        localStorage.setItem('ci_viewMode', 'grid');
        document.getElementById('view-grid-btn').classList.add('active');
        document.getElementById('view-kanban-btn').classList.remove('active');
      }
      ddMenu.classList.remove('open');
      ddBtn.classList.remove('open');
      updatePipelineUI();
      updateStatusToolbar();
      render();
    });
  });

  document.addEventListener('click', (e) => {
    if (!ddBtn.contains(e.target)) {
      ddMenu.classList.remove('open');
      ddBtn.classList.remove('open');
    }
  });
})();

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
        return `<a class="metric-drill-row" href="${url}">
          <div class="metric-drill-row-main">
            <span class="metric-drill-name">${escHtml(name)}</span>
            ${sub ? `<span class="metric-drill-sub">${escHtml(sub)}</span>` : ''}
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

  // ── v6 goal cards (bar + left-border style) ──
  // Map statCardConfig key → goal type class for color accents.
  // Type classes: type-saves, type-applications, type-outreach, type-convos, type-interviews
  // Falls back to no type class (neutral) for unknown keys.
  const _keyToType = key => {
    if (/save|saved/i.test(key)) return 'type-saves';
    if (/appl/i.test(key)) return 'type-applications';
    if (/outreach|reach|intro/i.test(key)) return 'type-outreach';
    if (/conv|interview|interview/i.test(key)) return 'type-convos';
    if (/offer|accept/i.test(key)) return 'type-interviews';
    return '';
  };

  const v6GoalCardsHtml = goalDefs.map(g => {
    const showGoal = g.hasGoal !== false && g.goal > 0;
    const pct = showGoal && g.goal > 0 ? Math.min(1, g.count / g.goal) : 0;
    const pctLabel = showGoal ? (pct >= 1 ? 'Met ✓' : `${Math.round(pct * 100)}%`) : '';
    const typeClass = _keyToType(g.key);
    const met = showGoal && g.count >= g.goal;
    const periodLabel2 = { daily: 'Today', weekly: 'This week', monthly: 'This month' }[activityPeriod] || activityPeriod;
    return `<div class="goal-card-v6 ${typeClass}${met ? ' gc-met' : ''}" data-goal-key="${escHtml(g.key)}" title="${escHtml(g.tooltip)}">
      <div class="gc-name">${escHtml(g.label)}</div>
      <div class="gc-values">
        <span class="gc-current">${g.count}</span>
        ${showGoal ? `<span class="gc-target">/ ${g.goal}</span>` : ''}
      </div>
      ${showGoal ? `<div class="gc-bar"><div class="gc-bar-fill" style="width:${Math.round(pct * 100)}%;"></div></div>` : ''}
      <div class="gc-footer">
        <span>${escHtml(periodLabel2)}</span>
        ${pctLabel ? `<span class="gc-pct">${escHtml(pctLabel)}</span>` : ''}
      </div>
    </div>`;
  }).join('') + `<div class="goal-card-v6-add" id="goal-card-add-btn">+ Add goal</div>`;

  // Format dates for <input type="date"> value (YYYY-MM-DD)
  const toInputDate = ts => new Date(ts).toISOString().slice(0, 10);

  const autoBadge = range.custom ? '' : ' <span class="act-auto-badge">auto</span>';

  // ── v6 30/70 top-strip layout ──
  section.innerHTML = `
    <div class="top-strip-grid">

      <!-- Tasks panel (left 30%) -->
      <div class="tasks-panel-strip">
        <div class="tasks-panel-head">
          <span class="tp-title">Tasks</span>
          <span class="tp-count tp-zero" id="tp-count-badge"><span class="tp-dot"></span><span id="tp-count-num">0</span></span>
          <span class="tp-spacer"></span>
          <div class="tp-toggle" id="tp-toggle">
            <span class="active" data-tp-view="focused">Today + Overdue</span>
            <span data-tp-view="all">All</span>
          </div>
        </div>
        <div class="tasks-panel-body" id="tp-tasks-body">Loading…</div>
        <button class="tasks-panel-add" id="tp-add-btn">
          <span>+ Add task</span>
          <span class="tp-kbd">N</span>
        </button>
      </div>

      <!-- Pipeline Overview (right 70%) -->
      <div class="pipeline-overview-panel">
        <div class="overview-head">
          <span class="overview-title">Pipeline Overview</span>
          <div class="period-tabs">
            <button class="period-tab${activityPeriod==='daily'?' active':''}" data-period="daily">Daily</button>
            <button class="period-tab${activityPeriod==='weekly'?' active':''}" data-period="weekly">Weekly</button>
            <button class="period-tab${activityPeriod==='monthly'?' active':''}" data-period="monthly">Monthly</button>
          </div>
          <span class="activity-period-label" id="act-date-label" title="Click to set custom date range">&#128197; ${label}${autoBadge}</span>
          <div class="act-date-picker" id="act-date-picker" style="display:none">
            <input type="date" id="act-date-start" class="act-date-input" value="${toInputDate(start)}">
            <span style="color:var(--ci-text-tertiary);font-size:13px">–</span>
            <input type="date" id="act-date-end" class="act-date-input" value="${toInputDate(end)}">
            <button class="act-date-apply">Apply</button>
            ${range.custom ? `<button class="act-date-reset">Reset to auto</button>` : ''}
          </div>
          <span class="overview-spacer"></span>
          <button class="edit-goals-btn" id="stat-cards-edit-btn" title="Configure goals">Edit goals</button>
        </div>
        <div class="goal-grid-v6">
          ${v6GoalCardsHtml}
        </div>
      </div>

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
  const actDateLabel = section.querySelector('#act-date-label');
  const datePicker = section.querySelector('#act-date-picker');
  if (actDateLabel && datePicker) {
    actDateLabel.addEventListener('click', () => {
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

  // v6 goal cards — click to drill down (goal-card-v6 is the whole clickable card)
  section.querySelectorAll('.goal-card-v6[data-goal-key]').forEach(card => {
    card.addEventListener('click', e => {
      const key = card.dataset.goalKey;
      const def = goalDefs.find(g => g.key === key);
      if (def) showMetricDrillDown(def, range);
    });
  });

  // "Add goal" button → opens stat card editor
  section.querySelector('#goal-card-add-btn')?.addEventListener('click', () => openStatCardEditor());

  // "Edit goals" button (stat card editor) — use delegation for robustness
  section.addEventListener('click', e => {
    if (e.target.closest('#stat-cards-edit-btn')) {
      e.stopPropagation();
      openStatCardEditor();
    }
  });

  // Tasks panel — view toggle (Today + Overdue / All)
  section.querySelectorAll('#tp-toggle span').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.tpView;
      localStorage.setItem('ci_tpView', view);
      section.querySelectorAll('#tp-toggle span').forEach(s => s.classList.toggle('active', s === btn));
      populateActivityTasksPanel(section, start, end);
    });
  });

  // "+ Add task" button — open the inline task composer in the tasks panel
  section.querySelector('#tp-add-btn')?.addEventListener('click', () => {
    const list = section.querySelector('#tp-tasks-body') || section.querySelector('#activity-tasks-list');
    if (list) {
      showOverviewTaskComposer(section, start, end, list);
    }
  });

  // Tasks panel — load async after the rest of the section is already rendered
  populateActivityTasksPanel(section, start, end);

  // Event delegation for task check toggle — guard against re-attachment on re-render
  if (!section.dataset.checkWired) {
    section.dataset.checkWired = '1';
    section.addEventListener('click', e => {
      const checkBtn = e.target.closest('[data-check]');
      if (checkBtn) {
        e.stopPropagation();
        const id = checkBtn.dataset.check;
        loadTasks(all => {
          const idx = all.findIndex(t => t.id === id);
          if (idx === -1) return;
          all[idx].completed = !all[idx].completed;
          if (all[idx].completed) all[idx].completedAt = new Date().toISOString();
          saveTasks(all, () => populateActivityTasksPanel(section, start, end));
        });
      }
    });
  }
}

function populateActivityTasksPanel(section, start, end) {
  // v6: target the new tasks-panel-body container; fall back to legacy id for safety
  const list = section.querySelector('#tp-tasks-body') || section.querySelector('#activity-tasks-list');
  if (!list) return;

  // v6 view toggle: 'focused' = today + overdue (default), 'all' = everything
  const tpView = localStorage.getItem('ci_tpView') || 'focused';
  const showDone = localStorage.getItem('ci_tasksShowDone') === 'true';
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const priVal = p => (p === 'high' || p === 'p1') ? 0 : (p === 'normal' || p === 'p2' || p === 'medium') ? 1 : 2;

  // Helpers
  const formatShort = dateStr => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const daysAgo = dateStr => {
    const ms = new Date(todayStr + 'T12:00:00') - new Date(dateStr + 'T12:00:00');
    return Math.round(ms / 86400000);
  };


  loadTasks(tasks => {
    const activeTasks = tasks.filter(t => !t.completed && t.dueDate);
    const overdueTasks = activeTasks.filter(t => t.dueDate < todayStr);
    const todayTasks   = activeTasks.filter(t => t.dueDate === todayStr);
    const futureTasks  = activeTasks.filter(t => t.dueDate > todayStr);

    const sortByPriThenDate = arr => [...arr].sort((a, b) => {
      const pd = priVal(a.priority) - priVal(b.priority);
      if (pd !== 0) return pd;
      return a.dueDate.localeCompare(b.dueDate);
    });

    // Focused view = today + overdue. All view = everything active + optionally done.
    const focused = tpView !== 'all';

    // Count badge: overdue+today regardless of toggle
    const totalBadge = overdueTasks.length + todayTasks.length;
    const countBadge = section.querySelector('#tp-count-badge');
    const countNum   = section.querySelector('#tp-count-num');
    if (countBadge && countNum) {
      countNum.textContent = totalBadge;
      countBadge.className = 'tp-count' +
        (overdueTasks.length > 0 ? '' : todayTasks.length > 0 ? ' tp-clean' : ' tp-zero');
      countBadge.style.display = totalBadge === 0 ? 'none' : '';
    }

    // Build HTML using renderTaskRow from ui-utils.js
    let html = '';

    if (focused) {
      // Grouped: Overdue, then Today
      if (overdueTasks.length === 0 && todayTasks.length === 0) {
        html += `<div class="tasks-panel-empty">Clear slate — nothing due today.</div>`;
      } else {
        if (overdueTasks.length > 0) {
          html += `<div class="tasks-panel-group">
            <div class="tasks-panel-group-hd overdue">Overdue <span class="tasks-panel-group-count">${overdueTasks.length}</span></div>
            ${sortByPriThenDate(overdueTasks).map(t => renderTaskRow(t)).join('')}
          </div>`;
        }
        if (todayTasks.length > 0) {
          html += `<div class="tasks-panel-group">
            <div class="tasks-panel-group-hd">Today <span class="tasks-panel-group-count">${todayTasks.length}</span></div>
            ${sortByPriThenDate(todayTasks).map(t => renderTaskRow(t)).join('')}
          </div>`;
        }
      }
    } else {
      // All view: overdue + today + future, ungrouped
      const allActive = [...sortByPriThenDate(overdueTasks), ...sortByPriThenDate(todayTasks), ...sortByPriThenDate(futureTasks)];
      if (allActive.length === 0) {
        html += `<div class="tasks-panel-empty">No tasks yet.</div>`;
      } else {
        html += allActive.map(t => renderTaskRow(t)).join('');
      }
      // Done items
      const doneToday = tasks.filter(t => {
        if (!t.completed) return false;
        if (t.completedAt) return t.completedAt.startsWith(todayStr);
        return t.dueDate === todayStr;
      });
      if (doneToday.length > 0) {
        html += `<div class="done-collapse">${doneToday.length} completed today · <span class="show-link" id="toggle-done">${showDone ? 'hide' : 'show'}</span></div>`;
        if (showDone) {
          html += doneToday.map(t => renderTaskRow(t)).join('');
        }
      }
    }

    list.innerHTML = html;

    // Wire task-specific events (delegation on list) — guard against re-attachment
    // on every re-render. populateActivityTasksPanel is called on every action.
    if (list.dataset.wired) return;
    list.dataset.wired = '1';
    list.addEventListener('click', e => {
      // Skip clicks that land on an active inline edit widget
      if (e.target.closest('[data-task-edit]')) return;

      // task-keep
      const keepBtn = e.target.closest('.task-keep');
      if (keepBtn) {
        e.preventDefault();
        const id = keepBtn.dataset.taskId;
        loadTasks(all => {
          const t = all.find(x => x.id === id);
          if (t) { t.reviewed = true; saveTasks(all, () => populateActivityTasksPanel(section, start, end)); }
        });
        return;
      }
      // task-dismiss
      const dismissBtn = e.target.closest('.task-dismiss');
      if (dismissBtn) {
        e.preventDefault();
        const id = dismissBtn.dataset.taskId;
        loadTasks(all => {
          const t = all.find(x => x.id === id);
          if (t) { t.reviewed = true; t.completed = true; t.completedAt = new Date().toISOString(); saveTasks(all, () => populateActivityTasksPanel(section, start, end)); }
        });
        return;
      }
      // task-snooze
      const snoozeBtn = e.target.closest('.task-snooze');
      if (snoozeBtn) {
        const id = snoozeBtn.dataset.taskId;
        loadTasks(all => {
          const t = all.find(x => x.id === id);
          if (t) {
            const d = new Date((t.dueDate || todayStr) + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            t.dueDate = d.toISOString().slice(0, 10);
            saveTasks(all, () => populateActivityTasksPanel(section, start, end));
          }
        });
        return;
      }
      // task-open (navigate to company)
      const openBtn = e.target.closest('.task-open');
      if (openBtn) {
        const id = openBtn.dataset.taskId;
        loadTasks(all => {
          const t = all.find(x => x.id === id);
          if (t && t.company) {
            const entry = allCompanies.find(c => c.company === t.company);
            if (entry) coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + entry.id);
          }
        });
        return;
      }
      // task-trash — delete with undo banner
      const trashBtn = e.target.closest('.task-trash');
      if (trashBtn) {
        e.stopPropagation();
        const id = trashBtn.dataset.taskId;
        loadTasks(all => {
          const idx = all.findIndex(x => x.id === id);
          if (idx === -1) return;
          const deletedTask = all[idx];
          const remaining = all.filter(x => x.id !== id);
          saveTasks(remaining, () => {
            populateActivityTasksPanel(section, start, end);
            showTaskUndoBanner(section, start, end, deletedTask, remaining);
          });
        });
        return;
      }
      // task-text inline edit (click on title)
      const textEl = e.target.closest('.task-text-editable');
      if (textEl) {
        const id = textEl.dataset.taskId;
        if (id && !textEl.querySelector('input')) {
          loadTasks(all => {
            const t = all.find(x => x.id === id);
            if (!t) return;
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'task-edit-input';
            inp.value = t.text;
            inp.setAttribute('data-task-edit', '');
            let done = false;
            const save = () => {
              if (done) return; done = true;
              inp.removeEventListener('blur', save);
              const v = inp.value.trim();
              if (v && v !== t.text) { t.text = v; saveTasks(all, () => populateActivityTasksPanel(section, start, end)); }
              else populateActivityTasksPanel(section, start, end);
            };
            inp.addEventListener('blur', save);
            inp.addEventListener('keydown', ev => {
              if (ev.key === 'Enter') { save(); ev.preventDefault(); }
              else if (ev.key === 'Escape') { done = true; inp.removeEventListener('blur', save); populateActivityTasksPanel(section, start, end); ev.preventDefault(); }
            });
            textEl.replaceWith(inp);
            inp.focus(); inp.select();
          });
        }
        return;
      }
      // task-company-editable — inline company picker
      const companyEl = e.target.closest('.task-company-editable');
      if (companyEl) {
        const id = companyEl.dataset.taskId;
        if (id && !companyEl.querySelector('select')) {
          loadTasks(all => {
            const t = all.find(x => x.id === id);
            if (!t) return;
            const select = document.createElement('select');
            select.className = 'task-edit-company-select';
            select.setAttribute('data-task-edit', '');
            const optNone = document.createElement('option');
            optNone.value = '';
            optNone.textContent = 'No company';
            select.appendChild(optNone);
            // Preserve current value even if not in allCompanies
            if (t.company && !allCompanies.some(c => c.company === t.company)) {
              const opt = document.createElement('option');
              opt.value = t.company;
              opt.textContent = t.company + ' (not in pipeline)';
              opt.selected = true;
              select.appendChild(opt);
            }
            const seen = new Set();
            allCompanies.filter(c => c.company).forEach(c => {
              if (seen.has(c.company)) return;
              seen.add(c.company);
              const opt = document.createElement('option');
              opt.value = c.company;
              opt.textContent = c.company;
              opt.selected = (t.company === c.company);
              select.appendChild(opt);
            });
            let done = false;
            const save = () => {
              if (done) return; done = true;
              select.removeEventListener('blur', save);
              const newVal = select.value || null;
              const origVal = t.company || null;
              if (newVal !== origVal) { t.company = newVal; saveTasks(all, () => populateActivityTasksPanel(section, start, end)); }
              else populateActivityTasksPanel(section, start, end);
            };
            select.addEventListener('blur', save);
            select.addEventListener('change', save);
            select.addEventListener('keydown', ev => {
              if (ev.key === 'Escape') { done = true; select.removeEventListener('blur', save); populateActivityTasksPanel(section, start, end); ev.preventDefault(); }
            });
            companyEl.replaceWith(select);
            select.focus();
          });
        }
        return;
      }
      // task-due-editable — inline date picker
      const dueEl = e.target.closest('.task-due-editable');
      if (dueEl) {
        const id = dueEl.dataset.taskId;
        if (id && !dueEl.querySelector('input')) {
          loadTasks(all => {
            const t = all.find(x => x.id === id);
            if (!t) return;
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.className = 'task-edit-date';
            dateInput.value = t.dueDate || '';
            dateInput.setAttribute('data-task-edit', '');
            let saved = false;
            const save = () => {
              if (saved) return; saved = true;
              t.dueDate = dateInput.value || null;
              saveTasks(all, () => populateActivityTasksPanel(section, start, end));
            };
            dateInput.addEventListener('change', save);
            dateInput.addEventListener('blur', () => setTimeout(() => { if (!saved) save(); }, 200));
            dateInput.addEventListener('keydown', ev => {
              if (ev.key === 'Escape') { saved = true; populateActivityTasksPanel(section, start, end); ev.preventDefault(); }
            });
            dueEl.replaceWith(dateInput);
            dateInput.focus();
          });
        }
        return;
      }
      // toggle-done
      if (e.target.id === 'toggle-done') {
        const cur = localStorage.getItem('ci_tasksShowDone') === 'true';
        localStorage.setItem('ci_tasksShowDone', (!cur).toString());
        populateActivityTasksPanel(section, start, end);
        return;
      }
      // add task buttons
      if (e.target.id === 'overview-task-add' || e.target.id === 'empty-add-task' || e.target.closest('#overview-task-add')) {
        showOverviewTaskComposer(section, start, end, list);
        return;
      }
    });
  });
}

let _taskUndoTimer = null;

function showTaskUndoBanner(section, start, end, deletedTask, remainingTasks) {
  // Clear any existing undo banner
  const existing = section.querySelector('.task-undo-banner');
  if (existing) existing.remove();
  if (_taskUndoTimer) { clearTimeout(_taskUndoTimer); _taskUndoTimer = null; }

  // v6: target the tasks panel strip; fall back to legacy column selector
  const tasksCol = section.querySelector('.tasks-panel-strip') || section.querySelector('.activity-tasks-col');
  if (!tasksCol) return;

  const banner = document.createElement('div');
  banner.className = 'task-undo-banner';
  banner.innerHTML = `<span>Task deleted</span><button class="task-undo-btn">Undo</button>`;
  tasksCol.appendChild(banner);

  // Fade in
  requestAnimationFrame(() => banner.classList.add('visible'));

  banner.querySelector('.task-undo-btn').addEventListener('click', () => {
    if (_taskUndoTimer) { clearTimeout(_taskUndoTimer); _taskUndoTimer = null; }
    banner.remove();
    // Restore: re-add the deleted task to storage
    loadTasks(all => {
      // Only restore if not already present (guard against double-click)
      if (!all.find(x => x.id === deletedTask.id)) {
        all.push(deletedTask);
      }
      saveTasks(all, () => populateActivityTasksPanel(section, start, end));
    });
  });

  _taskUndoTimer = setTimeout(() => {
    banner.classList.remove('visible');
    setTimeout(() => banner.remove(), 200);
    _taskUndoTimer = null;
  }, 5000);
}

function showOverviewTaskComposer(section, start, end, list) {
  // Remove existing composer if any
  list.querySelector('.task-composer')?.remove();
  list.querySelector('#overview-task-add')?.remove();

  const companyOpts = allCompanies
    .filter(c => c.company)
    .map(c => `<option value="${escHtml(c.company)}">${escHtml(c.company)}</option>`)
    .join('');

  const composer = document.createElement('div');
  composer.className = 'task-composer';
  composer.innerHTML = `
    <input type="text" class="task-composer-input" id="composer-text" placeholder="Task title…" autocomplete="off">
    <div class="task-composer-row">
      <select class="task-composer-select" id="composer-company">
        <option value="">No company</option>
        ${companyOpts}
      </select>
      <input type="date" class="task-composer-date" id="composer-date">
    </div>
    <div class="task-composer-actions">
      <button class="task-composer-save" id="composer-save">Save</button>
      <button class="task-composer-cancel" id="composer-cancel">Cancel</button>
    </div>`;
  list.appendChild(composer);

  const textInput = composer.querySelector('#composer-text');
  textInput.focus();

  const save = () => {
    const text = textInput.value.trim();
    if (!text) { textInput.focus(); return; }
    const company = composer.querySelector('#composer-company').value || null;
    const dueDate = composer.querySelector('#composer-date').value || null;
    const newTask = {
      id: crypto.randomUUID(),
      text,
      company,
      dueDate,
      priority: 'normal',
      completed: false,
      createdAt: new Date().toISOString()
    };
    loadTasks(all => {
      all.push(newTask);
      saveTasks(all, () => populateActivityTasksPanel(section, start, end));
    });
  };

  const cancel = () => populateActivityTasksPanel(section, start, end);

  composer.querySelector('#composer-save').addEventListener('click', save);
  composer.querySelector('#composer-cancel').addEventListener('click', cancel);
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { save(); e.preventDefault(); }
    else if (e.key === 'Escape') { cancel(); e.preventDefault(); }
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
    { id: 'gpt-4.1-nano',              label: 'GPT-4.1 Nano',       icon: '◆', provider: 'openai',    cost: '$',   tier: 'Fastest' },
    { id: 'gemini-2.0-flash-lite',     label: 'Gemini Flash-Lite',  icon: '✦', provider: 'gemini',    cost: '$',   tier: 'Cheapest' },
    { id: 'gpt-4.1-mini',              label: 'GPT-4.1 Mini',       icon: '◆', provider: 'openai',    cost: '$',   tier: 'Fast & cheap' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku',       icon: '⚡', provider: 'anthropic', cost: '$',   tier: 'Fast & cheap' },
    { id: 'gemini-2.0-flash',          label: 'Gemini Flash',       icon: '✦', provider: 'gemini',    cost: '$',   tier: 'Fast & cheap' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',  icon: '✦', provider: 'anthropic', cost: '$$',  tier: 'Balanced' },
    { id: 'gpt-4.1',                   label: 'GPT-4.1',            icon: '◆', provider: 'openai',    cost: '$$',  tier: 'Balanced' },
    { id: 'gpt-5',                     label: 'GPT-5',              icon: '◆', provider: 'openai',    cost: '$$$', tier: 'Most capable' },
    { id: 'claude-opus-4-0-20250514',  label: 'Claude Opus',        icon: '★', provider: 'anthropic', cost: '$$$', tier: 'Most capable' },
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
        if (m.provider === 'gemini') return !!status.gemini;
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

  // escHtml — provided by ui-utils.js

  function renderMessages(showThinking) {
    if (typeof injectContextManifestStyles === 'function') injectContextManifestStyles('gc');
    if (history.length === 0) {
      msgsEl.innerHTML = typeof COOP !== 'undefined'
        ? `<div class="gc-empty">${COOP.emptyStateHTML('global')}</div>`
        : '<div class="gc-empty">Ask anything about your pipeline — compare opportunities, draft follow-ups, get strategic advice.</div>';
    } else {
      // Thinking state: same streaming-caret pattern as company/opportunity chat (DESIGN.md)
      const thinkingHTML = showThinking
        ? `<div class="chat-turn chat-turn-coop"><div class="sender-cap"><span class="sender-cap-dot"></span><span>Coop</span></div><div class="msg-coop-body">${typeof COOP !== 'undefined' ? COOP.thinkingHTML() : '<span class="streaming-caret"></span>'}</div></div>`
        : '';
      msgsEl.innerHTML = history.map(m => {
        const text = m.content;
        if (m.role !== 'assistant') {
          // User turn — same sender-cap / msg-user-body shape as company/opportunity chat
          return `<div class="chat-turn chat-turn-user">
            <div class="sender-cap sender-cap-user"><span class="sender-cap-dot sender-cap-dot-user"></span><span>You</span></div>
            <div class="msg-user-body">${escHtml(text)}</div>
          </div>`;
        }
        // Assistant (Coop) turn
        const rendered = typeof renderMarkdown === 'function' ? renderMarkdown(text) : `<p>${escHtml(text)}</p>`;
        const toolBadge = (m._toolCalls?.length && typeof renderContextManifest === 'function')
          ? renderContextManifest(m._contextManifest, m._toolCalls, 'gc')
          : '';
        return `<div class="chat-turn chat-turn-coop">
          <div class="sender-cap"><span class="sender-cap-dot"></span><span>Coop</span></div>
          <div class="msg-coop-body">${rendered}</div>
          ${toolBadge}
        </div>`;
      }).join('') + thinkingHTML;
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
    // Bind context manifest expand/collapse
    if (typeof bindContextManifestEvents === 'function') bindContextManifestEvents(msgsEl);
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
      const msgEntry = { role: 'assistant', content: result.reply + fallbackNote };
      if (result.toolCalls) msgEntry._toolCalls = result.toolCalls;
      if (result.contextManifest) msgEntry._contextManifest = result.contextManifest;
      if (result.usage) msgEntry._usage = result.usage;
      if (result.model) msgEntry._model = result.model;
      history.push(msgEntry);
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

// Action On dropdown
(function() {
  const ddBtn = document.getElementById('action-dd-btn');
  const ddMenu = document.getElementById('action-dd-menu');
  const labelEl = document.getElementById('action-dd-label');
  const labels = { all: 'All', my_court: 'My Court', their_court: 'Their Court', scheduled: 'Scheduled' };
  if (!ddBtn) return;

  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = ddMenu.classList.toggle('open');
    ddBtn.classList.toggle('open', open);
    if (open) {
      const r = ddBtn.getBoundingClientRect();
      ddMenu.style.top = (r.bottom + 6) + 'px';
      ddMenu.style.left = r.left + 'px';
    }
  });

  ddMenu.querySelectorAll('.action-dd-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      activeActionFilter = opt.dataset.actionFilter;
      labelEl.textContent = labels[activeActionFilter] || 'All';
      ddBtn.classList.toggle('filtered', activeActionFilter !== 'all');
      ddMenu.querySelectorAll('.action-dd-opt').forEach(o => o.classList.toggle('active', o.dataset.actionFilter === activeActionFilter));
      ddMenu.classList.remove('open');
      ddBtn.classList.remove('open');
      render();
    });
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('action-dd')?.contains(e.target)) {
      ddMenu.classList.remove('open');
      ddBtn.classList.remove('open');
    }
  });
})();

// Status dropdown (mirrors Action On pattern)
(function() {
  const ddBtn = document.getElementById('status-dd-btn');
  const ddMenu = document.getElementById('status-dd-menu');
  if (!ddBtn) return;

  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = ddMenu.classList.toggle('open');
    ddBtn.classList.toggle('open', open);
    if (open) {
      const r = ddBtn.getBoundingClientRect();
      ddMenu.style.top = (r.bottom + 6) + 'px';
      ddMenu.style.left = r.left + 'px';
    }
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('status-dd')?.contains(e.target)) {
      ddMenu.classList.remove('open');
      ddBtn.classList.remove('open');
    }
  });
})();

load();

// ── Inbox: opens dedicated inbox page ────────────────────────────────────────

document.getElementById('inbox-link')?.addEventListener('click', () => {
  coopNavigate(chrome.runtime.getURL('inbox.html'));
});

// Badge count for inbox link
function updateInboxBadge() {
  chrome.storage.local.get(['lastInboxViewedAt', 'readEmailKeys'], ({ lastInboxViewedAt, readEmailKeys: rk }) => {
    const lastViewed = lastInboxViewedAt || 0;
    const readSet = new Set(Array.isArray(rk) ? rk : []);
    let unread = 0;
    (allCompanies || []).forEach(c => {
      (c.cachedEmails || []).forEach(e => {
        const ts = e.date ? new Date(e.date).getTime() : 0;
        if (ts <= lastViewed) return; // not genuinely new since last inbox open
        const key = e.id || e.messageId || e.threadId || `${e.subject||''}|${e.date||''}|${e.from||''}`;
        if (!readSet.has(key)) unread++;
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
