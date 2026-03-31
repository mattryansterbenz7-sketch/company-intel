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
let viewMode = localStorage.getItem('ci_viewMode') || 'grid';

const DEFAULT_OPPORTUNITY_STAGES = [
  { key: 'needs_review',    label: 'AI Scoring Queue',           color: '#64748b' },
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
let activePipeline = localStorage.getItem('ci_activePipeline') || 'all'; // 'all' | 'opportunity' | 'company'
let stageCelebrations = {}; // { [stageKey]: { confetti, sound } } — loaded from storage
const DEFAULT_ACTION_STATUSES = [
  { key: 'my_court', label: '🏀 My Court', color: '#FF7A59' },
  { key: 'their_court', label: '⏳ Their Court', color: '#0ea5e9' },
];
let customActionStatuses = null; // loaded from storage, falls back to DEFAULT
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
  const score = c.quickFitScore ?? c.jobMatch?.score ?? null;
  const isScoring = c._queuedForScoring && score === null;
  const isQueued = !c._queuedForScoring && !c.quickFitScoredAt && score === null;

  const tier = score != null ? (score >= SCORE_THRESHOLDS.green ? 'green' : score >= SCORE_THRESHOLDS.amber ? 'amber' : 'red') : '';
  const stateClass = isScoring ? ' scoring' : isQueued ? ' queued' : '';

  // Score display
  let scoreHtml;
  if (score != null) {
    scoreHtml = `<span class="compact-score-num ${tier}">${score}</span><span class="compact-score-den">/10</span>`;
  } else if (isScoring) {
    scoreHtml = '<span class="compact-spinner"></span>';
  } else {
    scoreHtml = '<span class="compact-queue-dot"></span>';
  }

  // Meta line: salary + arrangement
  const salary = c.baseSalaryRange || c.oteTotalComp || c.jobMatch?.salary?.base || c.jobSnapshot?.salary || '';
  const arr = c.jobSnapshot?.workArrangement || c.jobMatch?.workArrangement || '';
  const meta = [salary, arr].filter(Boolean).join(' \u00b7 ');

  // Action buttons (only in queue stage)
  const inQueue = (c.jobStage || 'needs_review') === QUEUE_STAGE;
  const actionsHtml = inQueue && score != null ? `
    <div class="compact-actions">
      <button class="compact-apply-btn" data-id="${c.id}">Apply</button>
      <button class="compact-dismiss-btn" data-id="${c.id}">Dismiss</button>
    </div>` : '';

  return `
    <div class="compact-card score-${tier}${stateClass}" data-id="${c.id}" draggable="true">
      <div class="compact-card-score">${scoreHtml}</div>
      <div class="compact-card-body">
        <div class="compact-company">${escHtmlGlobal(c.company)}</div>
        <div class="compact-title">${escHtmlGlobal(c.jobTitle || '')}</div>
        ${meta ? `<div class="compact-meta">${escHtmlGlobal(meta)}</div>` : ''}
        ${c.quickFitReason && score != null ? `<div class="compact-meta" style="font-style:italic">${escHtmlGlobal(c.quickFitReason)}</div>` : ''}
        ${isScoring ? '<div class="compact-meta">Scoring...</div>' : ''}
        ${isQueued ? '<div class="compact-meta">In queue</div>' : ''}
        ${actionsHtml}
      </div>
    </div>`;
}

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
  { border: '#818cf8', color: '#a5b4fc', bg: 'rgba(99,102,241,0.12)' },
  { border: '#34d399', color: '#6ee7b7', bg: 'rgba(52,211,153,0.12)' },
  { border: '#fb923c', color: '#fdba74', bg: 'rgba(251,146,60,0.12)' },
  { border: '#f472b6', color: '#f9a8d4', bg: 'rgba(244,114,182,0.12)' },
  { border: '#38bdf8', color: '#7dd3fc', bg: 'rgba(56,189,248,0.12)' },
  { border: '#c084fc', color: '#d8b4fe', bg: 'rgba(192,132,252,0.12)' },
  { border: '#4ade80', color: '#86efac', bg: 'rgba(74,222,128,0.12)' },
  { border: '#f59e0b', color: '#fcd34d', bg: 'rgba(245,158,11,0.12)' },
];
let customTagColors = {}; // { tagName: paletteIndex }

function tagColorIndex(tag) {
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
  chrome.storage.local.get(['savedCompanies', 'allTags', 'opportunityStages', 'companyStages', 'customStages', 'tagColors', 'activityGoals', 'stageCelebrations', 'statCardConfigs', 'actionStatuses'], (data) => {
    const { savedCompanies, allTags } = data;
    // Migration: old customStages → opportunityStages
    const storedOpp = data.opportunityStages || data.customStages;
    if (storedOpp && storedOpp.length > 0) {
      // Migration: rename old "Needs Review" / "Saved — Needs Review" → "AI Scoring Queue"
      const first = storedOpp[0];
      if (first && first.key === 'needs_review' && /needs.review/i.test(first.label)) {
        first.label = 'AI Scoring Queue';
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
  });
}

function updateTagsToolbar() {
  const toolbar = document.getElementById('tags-toolbar');
  const allTagsInUse = [...new Set(allCompanies.flatMap(c => c.tags || []))].sort();
  if (allTagsInUse.length === 0) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = 'flex';

  toolbar.innerHTML = '<span class="filter-label">Tags:</span>';
  const allBtn = document.createElement('button');
  allBtn.className = 'tag-filter-btn' + (activeTag === null ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.style.cssText = 'border-color:#334155;color:#64748b;';
  if (activeTag === null) allBtn.style.cssText = 'border-color:#6366f1;color:#818cf8;background:rgba(99,102,241,0.12);';
  allBtn.addEventListener('click', () => { activeTag = null; updateTagsToolbar(); render(); });
  toolbar.appendChild(allBtn);

  allTagsInUse.forEach(tag => {
    const c = tagColor(tag);
    const btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (activeTag === tag ? ' active' : '');
    btn.style.cssText = `border-color:${c.border};color:${activeTag === tag ? '#fff' : c.color};background:${activeTag === tag ? c.bg : 'transparent'};display:inline-flex;align-items:center;gap:5px;`;

    const dot = document.createElement('span');
    dot.className = 'tag-swatch-dot';
    dot.style.background = c.border;
    dot.title = 'Change tag color';
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const currIdx = customTagColors[tag] !== undefined ? customTagColors[tag] : tagColorIndex(tag);
      showColorPicker(dot, TAG_PALETTE.map(p => p.border), currIdx, (idx) => saveTagColor(tag, idx));
    });

    const label = document.createElement('span');
    label.textContent = tag;
    label.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      updateTagsToolbar();
      render();
    });

    const del = document.createElement('span');
    del.textContent = '✕';
    del.title = `Remove "${tag}" from all entries`;
    del.style.cssText = 'font-size:10px;opacity:0.6;cursor:pointer;font-weight:700;';
    del.addEventListener('mouseenter', () => { del.style.opacity = '1'; del.style.color = '#e5483b'; });
    del.addEventListener('mouseleave', () => { del.style.opacity = '0.6'; del.style.color = ''; });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Remove tag "${tag}" from all entries?`)) return;
      allCompanies = allCompanies.map(c => ({ ...c, tags: (c.tags || []).filter(t => t !== tag) }));
      allKnownTags = allKnownTags.filter(t => t !== tag);
      chrome.storage.local.set({ savedCompanies: allCompanies, allTags: allKnownTags });
      if (activeTag === tag) activeTag = null;
      updateTagsToolbar();
      render();
    });

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.appendChild(del);
    toolbar.appendChild(btn);
  });
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
  document.getElementById('company-count').textContent = allCompanies.length;
  document.getElementById('job-count').textContent = allCompanies.filter(c => !!c.isOpportunity).length;

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
    grid.innerHTML = `<div class="empty-state"><b>${allCompanies.length === 0 ? 'No saved companies yet' : 'No results'}</b>${allCompanies.length === 0 ? 'Open CompanyIntel on any company page and hit Save.' : 'Try a different search or filter.'}</div>`;
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
                ${c.jobMatch.jobSummary ? `<div class="card-job-summary">${c.jobMatch.jobSummary}</div>` : ''}
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
            ${c.jobMatch?.strongFits?.length ? `<div><div class="analysis-section-label">Green Flags</div><ul class="analysis-bullets">${c.jobMatch.strongFits.map(f => `<li class="fit"><span>🟢</span><span>${boldKeyPhrase(f)}</span></li>`).join('')}</ul></div>` : ''}
            ${c.jobMatch?.redFlags?.length ? `<div><div class="analysis-section-label">Red Flags</div><ul class="analysis-bullets">${c.jobMatch.redFlags.map(f => `<li class="flag"><span>🔴</span><span>${boldKeyPhrase(f)}</span></li>`).join('')}</ul></div>` : ''}
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
        lastActivity: now,
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
  else if (sound === 'levelup') playSynth([440, 554, 659, 880], 0.08, 0.15);
  else if (sound === 'bell') playSynth([800, 1200], 0.05, 0.3, 'sine');
  else if (sound === 'whoosh') playNoise(0.15);
  else if (sound === 'tada') playSynth([523, 659, 784, 1047], 0.1, 0.2);
  else if (sound === 'drum') playDrumRoll();
  else if (sound === 'coin') playSynth([1200, 1600], 0.03, 0.12, 'square');
  else if (sound === 'airhorn') playSynth([400, 500, 400, 500], 0.12, 0.4);
  else if (sound === 'sad') playSynth([350, 330, 310, 200], 0.2, 0.5);
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
};

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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.savedCompanies || changes.allTags)) {
    load();
  }
});

// Real-time score updates from background.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'QUICK_FIT_COMPLETE' && msg.companyId) {
    const idx = allCompanies.findIndex(c => c.id === msg.companyId);
    if (idx !== -1) {
      const updates = {};
      if (msg.score != null) updates.quickFitScore = msg.score;
      if (msg.scoredAt) updates.quickFitScoredAt = msg.scoredAt;
      if (msg.jobSnapshot) updates.jobSnapshot = msg.jobSnapshot;
      allCompanies[idx] = { ...allCompanies[idx], ...updates, _queuedForScoring: false };
      // Re-render just the kanban if active, otherwise full render
      render();
    }
    sendResponse({ ok: true });
  }
});

// Kanban view
function renderKanban(filtered) {
  const board = document.getElementById('kanban-board');
  const stages = currentStages();
  const validKeys = new Set(stages.map(s => s.key));
  board.innerHTML = stages.map(({ key: statusKey, label: statusLabel }) => {
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
      // Sort: My Court first, then by job match score (highest first), then by most recent activity
      cards.sort((a, b) => {
        // My Court items float to top
        const aMyC = (a.actionStatus || 'my_court') === 'my_court' ? 1 : 0;
        const bMyC = (b.actionStatus || 'my_court') === 'my_court' ? 1 : 0;
        if (bMyC !== aMyC) return bMyC - aMyC;
        const sa = a.jobMatch?.score ? applyExcitementModifier(a.jobMatch.score, a.rating).final : -1;
        const sb = b.jobMatch?.score ? applyExcitementModifier(b.jobMatch.score, b.rating).final : -1;
        if (sb !== sa) return sb - sa;
        return (b.lastActivity || b.savedAt || 0) - (a.lastActivity || a.savedAt || 0);
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
        <div class="kanban-col-header" data-status="${statusKey}" style="border-color:${s.border};background:${s.bg};color:${s.color}">
          <span class="kanban-col-title">${statusLabel}</span>
          <span class="kanban-col-count">${cards.length}</span>
          <button class="col-view-toggle" data-col="${statusKey}" title="${toggleTitle}">${toggleIcon}</button>
          <button class="kanban-col-collapse" data-collapse="${statusKey}" title="${isCollapsed ? 'Expand' : 'Collapse'}">‹</button>
        </div>
        <div class="kanban-cards" data-status="${statusKey}" style="border-color:${s.border};background:rgba(0,0,0,0.15)">
          ${cards.length ? cards.map(c => renderCard(c)).join('') : '<div class="kanban-empty">Empty</div>'}
        </div>
      </div>`;
  }).join('');

  bindKanbanEvents(board);

  // Background-fetch calendar events for any card missing them
  filtered.forEach(c => {
    if (c.cachedCalendarEvents) return;
    const domain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    if (!domain) return;
    const contactEmails = (c.knownContacts || []).flatMap(k => [k.email, ...(k.aliases || [])]);
    chrome.runtime.sendMessage(
      { type: 'CALENDAR_FETCH_EVENTS', domain, companyName: c.company || '', knownContactEmails: contactEmails },
      result => {
        void chrome.runtime.lastError;
        const events = result?.events;
        if (!events?.length) return;
        const idx = allCompanies.findIndex(x => x.id === c.id);
        if (idx === -1) return;
        allCompanies[idx] = { ...allCompanies[idx], cachedCalendarEvents: events };
        chrome.storage.local.set({ savedCompanies: allCompanies });
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
        ${c.jobMatch?.jobSummary ? `<div class="kanban-detail-summary">${c.jobMatch.jobSummary}</div>` : ''}
        ${c.jobMatch?.verdict ? `<div class="kanban-detail-verdict">${c.jobMatch.verdict}</div>` : ''}
        ${c.jobMatch?.strongFits?.length ? `<details class="card-analysis"><summary>Green Flags</summary><div class="analysis-body"><ul class="analysis-bullets">${c.jobMatch.strongFits.map(f => `<li class="fit"><span>🟢</span><span>${boldKeyPhrase(f)}</span></li>`).join('')}</ul></div></details>` : ''}
        ${c.jobMatch?.redFlags?.length ? `<details class="card-analysis"><summary>Red Flags</summary><div class="analysis-body"><ul class="analysis-bullets">${c.jobMatch.redFlags.map(f => `<li class="flag"><span>🔴</span><span>${boldKeyPhrase(f)}</span></li>`).join('')}</ul></div></details>` : ''}
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
            <a class="kanban-card-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank">${c.company}</a>
          </div>
          ${isJob && c.jobTitle ? `<div class="kanban-card-job">${c.jobUrl ? `<a href="${c.jobUrl}" target="_blank" class="card-job-link">${c.jobTitle}</a>` : c.jobTitle}</div>` : ''}
        </div>
        <button class="card-delete" data-id="${c.id}" title="Remove" style="flex-shrink:0">✕</button>
      </div>
      <div class="card-match-area" data-id="${c.id}">${isJob && c.jobMatch?.score ? (() => {
        const { final, mod } = applyExcitementModifier(c.jobMatch.score, c.rating);
        const v = scoreToVerdict(final);
        const scoreColor = final >= 7 ? '#00897b' : final >= 4 ? '#d97706' : '#e5483b';
        const modText = mod > 0 ? `<span class="card-score-mod up">+${mod}</span>` : mod < 0 ? `<span class="card-score-mod down">${mod}</span>` : '';
        const agoText = c.jobMatchScoredAt ? (() => {
          const d = Math.round((Date.now() - c.jobMatchScoredAt) / 86400000);
          return d === 0 ? 'today' : d === 1 ? '1d ago' : d + 'd ago';
        })() : '';
        return `<div class="card-score-row"><span class="card-score-num" style="color:${scoreColor}">${final}<span class="card-score-denom">/10</span></span>${modText}<span class="card-verdict-badge ${v.cls}">${v.label}</span>${agoText ? `<span class="card-score-ago" title="Last scored">${agoText}</span>` : ''}</div>`;
      })() : (isJob && c._scoring ? '<span class="card-scoring-indicator">Scoring\u2026</span>' : isJob && c.jobDescription && !c.jobMatch ? '<button class="score-match-btn" data-id="' + c.id + '">Score match</button>' : '')}</div>
      ${isJob && (c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary || c.workArrangement) ? (() => {
        const compText = c.baseSalaryRange || c.oteTotalComp || c.jobSnapshot?.salary;
        const compLabel = c.baseSalaryRange ? 'Base' : c.oteTotalComp ? 'OTE' : (c.jobSnapshot?.salaryType === 'ote' ? 'OTE' : 'Base');
        return `<div class="card-job-chips">
          ${compText ? `<span class="job-chip salary ${compLabel.toLowerCase()}">💰 ${compLabel}: ${compText}</span>` : ''}
          ${c.equity ? `<span class="job-chip equity">📈 ${c.equity}</span>` : ''}
          ${c.workArrangement ? `<span class="job-chip ${arrClass}">${c.workArrangement === 'Remote' ? '🌐' : c.workArrangement === 'Hybrid' ? '🏠' : '🏢'} ${c.workArrangement}</span>` : ''}
        </div>`;
      })() : ''}
      ${c.oneLiner ? `<div class="kanban-card-oneliner">${c.oneLiner}</div>` : ''}
      ${(() => {
        const events = c.cachedCalendarEvents || [];
        const past = events.filter(e => new Date(e.start) <= new Date()).sort((a, b) => new Date(b.start) - new Date(a.start));
        const calTs = past.length ? new Date(past[0].start).getTime() : 0;
        const actTs = c.lastActivity || 0;
        const ts = Math.max(calTs, actTs);
        if (!ts) return '';
        const dateStr = new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `<div class="kanban-last-activity">Last activity: <span>${dateStr}</span></div>`;
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
        lastActivity: now,
        ...stageEnterTimestamp(entry, newStatus),
        ...backfillClearTimestamps(entry, newStatus),
      };
      const autoAction = defaultActionStatus(newStatus);
      if (autoAction) changes.actionStatus = autoAction;
      updateCompany(draggingId, changes);
      if (activePipeline !== 'company') {
        const confettiConfig = getConfettiConfig(newStatus);
        if (confettiConfig) fireConfetti(confettiConfig);
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
            storyTime: storyTime?.profileSummary || storyTime?.rawInput || null,
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

  // Click card body → open full-screen view
  board.querySelectorAll('.kanban-card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, textarea, input, .card-tag, .star, .card-stars, details, summary')) return;
      window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
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

  // Compact card Apply button
  board.querySelectorAll('.compact-apply-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = allCompanies.find(c => c.id === id);
      if (!entry) return;
      const stages = currentStages();
      const queueIdx = stages.findIndex(s => s.key === QUEUE_STAGE);
      const nextStage = queueIdx >= 0 && queueIdx + 1 < stages.length ? stages[queueIdx + 1].key : 'want_to_apply';
      const now = Date.now();
      const changes = {
        jobStage: nextStage,
        lastActivity: now,
        ...stageEnterTimestamp(entry, nextStage),
      };
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
              storyTime: storyTime?.profileSummary || storyTime?.rawInput || null,
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
      const now = Date.now();
      const existingTags = entry.tags || [];
      const tags = existingTags.includes(DISMISS_TAG) ? existingTags : [...existingTags, DISMISS_TAG];
      updateCompany(id, {
        jobStage: DISMISS_STAGE,
        lastActivity: now,
        tags,
        ...stageEnterTimestamp(entry, DISMISS_STAGE),
      });
    });
  });

  // Compact card click navigation (body area, not buttons)
  board.querySelectorAll('.compact-card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
    });
  });

  // Compact card drag-and-drop
  board.querySelectorAll('.compact-card').forEach(card => {
    card.addEventListener('mousedown', (e) => {
      dragAllowed = !e.target.closest('button');
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
}

// View toggle
document.getElementById('view-grid-btn').addEventListener('click', () => {
  viewMode = 'grid';
  localStorage.setItem('ci_viewMode', 'grid');
  document.getElementById('view-grid-btn').classList.add('active');
  document.getElementById('view-kanban-btn').classList.remove('active');
  render();
});
document.getElementById('view-kanban-btn').addEventListener('click', () => {
  viewMode = 'kanban';
  localStorage.setItem('ci_viewMode', 'kanban');
  document.getElementById('view-kanban-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
  render();
});
// Restore toggle state on load
if (viewMode === 'kanban') {
  document.getElementById('view-kanban-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
}
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
        <select class="celeb-select" data-key="${s.key}" data-field="confetti">${confettiOpts}</select>
        <select class="celeb-select" data-key="${s.key}" data-field="sound">${soundOpts}</select>
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
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      const curr = STAGE_COLOR_PALETTE.indexOf(editingStages[i].color);
      editingStages[i].color = STAGE_COLOR_PALETTE[(curr + 1) % STAGE_COLOR_PALETTE.length];
      renderStageEditor();
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
  const inPeriod = ts => ts && ts >= start && ts <= end;

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
      ${showGoal ? `<div class="goal-ring">${goalRingSvg(g.count, g.goal, g.color)}</div>` : `<div class="goal-ring-plain" style="color:${g.color}">${g.count}</div>`}
      <div class="goal-text">
        <div class="goal-fraction">${g.count}${showGoal ? `<span class="goal-denom">/${g.goal}</span>` : ''}</div>
        <div class="goal-metric-label">${g.label}</div>
        ${showGoal ? '<div class="goal-edit-hint">click to edit goal</div>' : `<div class="goal-edit-hint" style="color:#94a3b8">${g.mode === 'snapshot' ? 'live count' : 'tracking'}</div>`}
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

  section.querySelectorAll('.goal-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.goal-edit-form')) return;
      section.querySelectorAll('.goal-card').forEach(c => c.classList.remove('editing'));
      card.classList.add('editing');
      card.querySelector('.goal-edit-input')?.select();
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

  let history = [];
  let isMinimized = false;

  // Model switcher — default GPT-4.1 mini, click to cycle
  const GC_MODELS = [
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', icon: '◆' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku', icon: '⚡' },
    { id: 'claude-sonnet-4-5-20250514', label: 'Sonnet', icon: '✦' },
    { id: 'gpt-4.1', label: 'GPT-4.1', icon: '◆' },
  ];
  let gcModelIdx = 0;
  const gcModelToggle = document.getElementById('gc-model-toggle');
  const gcModelLabel = document.getElementById('gc-model-label');
  function updateGcModelLabel() {
    if (gcModelLabel) gcModelLabel.textContent = GC_MODELS[gcModelIdx].icon + ' ' + GC_MODELS[gcModelIdx].label;
  }
  updateGcModelLabel();
  if (gcModelToggle) {
    gcModelToggle.addEventListener('click', () => {
      gcModelIdx = (gcModelIdx + 1) % GC_MODELS.length;
      updateGcModelLabel();
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
      msgsEl.innerHTML = '<div class="gc-empty">Ask anything about your pipeline — compare opportunities, draft follow-ups, get strategic advice.</div>';
    } else {
      msgsEl.innerHTML = history.map(m => {
        const text = m.content;
        const bubble = m.role === 'assistant'
          ? (typeof renderMarkdown === 'function' ? renderMarkdown(text) : escHtml(text))
          : escHtml(text);
        return `<div class="gc-msg gc-msg-${m.role}"><div class="gc-bubble">${bubble}</div></div>`;
      }).join('') + (showThinking ? '<div class="gc-msg gc-msg-assistant"><div class="gc-bubble gc-thinking"><span class="gc-thinking-dots"><span>.</span><span>.</span><span>.</span></span> Thinking</div></div>' : '');
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
      if (c.jobMatch?.strongFits?.length) parts.push(`Strong fits: ${c.jobMatch.strongFits.join('; ')}`);
      if (c.jobMatch?.redFlags?.length) parts.push(`Red flags: ${c.jobMatch.redFlags.join('; ')}`);
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
            chatModel: GC_MODELS[gcModelIdx].id,
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
      const fallbackNote = (result.model && result.model !== GC_MODELS[gcModelIdx].id)
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
