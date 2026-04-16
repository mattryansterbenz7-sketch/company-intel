// ── Coop config (loaded for automation guards) ─────────────────────────────
let _coopConfig = {};
chrome.storage.local.get(['coopConfig'], d => { _coopConfig = d.coopConfig || {}; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.coopConfig) _coopConfig = changes.coopConfig.newValue || {};
});

// ── User name cache ─────────────────────────────────────────────────────────
let _cachedUserName = '';
chrome.storage.sync.get(['prefs'], d => { _cachedUserName = (d.prefs && (d.prefs.name || d.prefs.fullName)) || ''; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.prefs) {
    const p = changes.prefs.newValue || {};
    _cachedUserName = p.name || p.fullName || '';
  }
});

// ── Task filter state ───────────────────────────────────────────────────────
let _taskPriFilter = 'all';
let _taskDateFilter = 'all';

// ── Coop quick prompts ──────────────────────────────────────────────────────
const DEFAULT_QUICK_PROMPTS_SP = [
  { id: 'cover-letter', label: 'Cover letter', prompt: 'Help me write a custom cover letter for this role. Use what you know about me and the company to make it specific and compelling.' },
  { id: 'interview-prep', label: 'Interview prep', prompt: 'Prep me for an interview here — what should I know about the company, what questions will they likely ask, and how should I position myself?' },
  { id: 'why-this-role', label: 'Why this role', prompt: 'Help me articulate why I\'m genuinely interested in this role in a way that\'s specific and authentic, not generic.' },
  { id: 'draft-followup', label: 'Draft follow-up', prompt: 'Draft a follow-up message I can send after my last touch with this company. Make it brief and natural.' },
];
let _quickPrompts = DEFAULT_QUICK_PROMPTS_SP;
chrome.storage.local.get(['coopQuickPrompts'], d => {
  if (Array.isArray(d.coopQuickPrompts)) _quickPrompts = d.coopQuickPrompts;
});
let _onQuickPromptsChanged = null; // set by chat init to re-render empty state
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.coopQuickPrompts) {
    _quickPrompts = Array.isArray(changes.coopQuickPrompts.newValue) ? changes.coopQuickPrompts.newValue : DEFAULT_QUICK_PROMPTS_SP;
    _onQuickPromptsChanged?.();
  }
});

// ── Notify content script that side panel is open/closed ────────────────────
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: '_SIDEPANEL_OPENED' }).catch(() => {});
  } catch {}
})();
window.addEventListener('beforeunload', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: '_SIDEPANEL_CLOSED' }).catch(() => {});
  } catch {}
});

// ── API Health Dot ──────────────────────────────────────────────────────────

function updateHealthDot() {
  chrome.runtime.sendMessage({ type: 'GET_API_USAGE' }, usage => {
    void chrome.runtime.lastError;
    const dot = document.getElementById('sp-health-dot');
    if (!dot || !usage) { if (dot) dot.className = 'sp-health-dot gray'; return; }

    // Check for recent issues
    let status = 'green';
    for (const key of ['anthropic', 'openai', 'serper', 'apollo']) {
      const p = usage[key];
      if (!p) continue;
      if (p.errors?.count401 > 0) { status = 'red'; break; }
      if (p.errors?.count429 > 0 && p.lastRequestAt > Date.now() - 600000) { status = 'yellow'; }
    }

    dot.className = `sp-health-dot ${status}`;
  });
}
updateHealthDot();
// Health dot refresh every 60s — only when side panel is visible
setInterval(() => { if (!document.hidden) updateHealthDot(); }, 60000);

document.getElementById('sp-health-dot')?.addEventListener('click', () => {
  coopNavigate(chrome.runtime.getURL('integrations.html'), true);
});

// ── Cost Badge ─────────────────────────────────────────────────────────────

const _costOpLabels = {
  chat: 'Coop Chat', insight: 'Memory Extraction', scoring: 'Job Scoring',
  research: 'Company Research', search: 'Web Search', enrich: 'Data Enrichment',
  profile: 'Profile Processing', extract: 'Task Extraction', rewrite: 'Writing Assistant',
  scout: 'Scout'
};

function updateCostBadge() {
  chrome.storage.local.get(['apiUsage'], d => {
    const badge = document.getElementById('sp-cost-badge');
    if (!badge) return;
    const usage = d.apiUsage || {};
    const cost = typeof usage.costToday === 'number' ? usage.costToday : 0;

    badge.textContent = cost < 0.01 ? `~$${cost.toFixed(4)}` : `~$${cost.toFixed(2)}`;

    // Color code
    badge.classList.remove('cost-green', 'cost-orange', 'cost-red');
    if (cost > 1.00) badge.classList.add('cost-red');
    else if (cost >= 0.25) badge.classList.add('cost-orange');
    else badge.classList.add('cost-green');

    // Build tooltip with per-op breakdown
    const log = Array.isArray(usage.callLog) ? usage.callLog : [];
    const today = new Date().toDateString();
    const opTotals = {};
    for (const entry of log) {
      if (!entry.ts || new Date(entry.ts).toDateString() !== today) continue;
      const label = _costOpLabels[entry.op] || entry.op || 'Other';
      opTotals[label] = (opTotals[label] || 0) + (entry.cost || 0);
    }
    const lines = Object.entries(opTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([op, c]) => `${op}: $${c.toFixed(3)}`);
    badge.title = lines.length
      ? `API spend today: ~$${cost.toFixed(2)}\n${lines.join('\n')}`
      : `API spend today: ~$${cost.toFixed(2)}`;
  });
}

updateCostBadge();
setInterval(() => { if (!document.hidden) updateCostBadge(); }, 30000);

// Update after storage changes (catches post-chat, post-scoring, etc.)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiUsage) updateCostBadge();
});

document.getElementById('sp-cost-badge')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('coop-settings.html') });
});

// ── Main ────────────────────────────────────────────────────────────────────

const searchBtn = document.getElementById('search-btn');
const settingsBtn = document.getElementById('settings-btn');

// Debug log: copy background.js logs to clipboard for bug reporting
document.getElementById('sp-debug-btn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_DEBUG_LOG' }, (res) => {
    const log = res?.log || '(no logs)';
    navigator.clipboard.writeText(log).then(() => {
      const btn = document.getElementById('sp-debug-btn');
      if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '🐛'; }, 1500); }
    });
  });
});

// ── Chat/Intel Mode Toggle ──────────────────────────────────────────────────
const coopToggleBtn = document.getElementById('coop-toggle-btn');
const chatBackBtn = document.getElementById('sp-chat-back');

// Set Coop avatar on the toggle button
if (coopToggleBtn && typeof COOP !== 'undefined') {
  coopToggleBtn.innerHTML = COOP.avatar(24);
}

// SIZE_ORDER: minimized → half → full
const CHAT_SIZES = ['minimized', 'half', 'full'];

function _applyTopLevelChatSize(size) {
  document.body.classList.remove('chat-mode', 'chat-half', 'chat-minimized');
  const chatEl = document.getElementById('sp-chat');
  const msgs = document.getElementById('sp-chat-messages');
  const inputRow = chatEl?.querySelector('.sp-chat-input-row');
  if (size === 'full') {
    document.body.classList.add('chat-mode');
    if (chatEl) chatEl.style.display = 'flex';
    if (msgs) { msgs.style.display = ''; msgs.style.maxHeight = ''; msgs.style.minHeight = ''; msgs.style.height = ''; }
    if (inputRow) inputRow.style.display = '';
    localStorage.setItem('ci_sp_chat_size', 'full');
  } else if (size === 'half') {
    document.body.classList.add('chat-half');
    if (chatEl) chatEl.style.display = 'flex';
    if (msgs) { msgs.style.display = ''; msgs.style.maxHeight = ''; msgs.style.minHeight = ''; msgs.style.height = ''; }
    if (inputRow) inputRow.style.display = '';
    localStorage.setItem('ci_sp_chat_size', 'half');
  } else if (size === 'minimized') {
    document.body.classList.add('chat-minimized');
    if (chatEl) chatEl.style.display = 'flex';
    if (msgs) msgs.style.display = 'none';
    if (inputRow) inputRow.style.display = '';
    localStorage.setItem('ci_sp_chat_size', 'minimized');
  } else {
    // null — hide chat entirely
    if (chatEl) chatEl.style.display = '';
    localStorage.removeItem('ci_sp_chat_size');
  }
}

function enterChatMode() {
  const saved = localStorage.getItem('ci_sp_chat_size');
  const size = CHAT_SIZES.includes(saved) ? saved : 'half';
  _applyTopLevelChatSize(size);
}

function exitChatMode() {
  document.body.classList.remove('chat-mode', 'chat-half', 'chat-minimized');
  const chatEl = document.getElementById('sp-chat');
  if (chatEl) chatEl.style.display = '';
  localStorage.removeItem('ci_sp_chat_size');
}

if (coopToggleBtn) {
  coopToggleBtn.addEventListener('click', enterChatMode);
}
if (chatBackBtn) {
  // Back button (visible in full mode) — shrink to half
  chatBackBtn.addEventListener('click', () => _applyTopLevelChatSize('half'));
}

// Restore last size (also accept legacy 'chat' value)
const _savedSize = localStorage.getItem('ci_sp_chat_size');
const _legacyChat = localStorage.getItem('ci_sp_mode') === 'chat';
if (CHAT_SIZES.includes(_savedSize) || _legacyChat) {
  _applyTopLevelChatSize(CHAT_SIZES.includes(_savedSize) ? _savedSize : 'half');
}
const savedBtn = document.getElementById('saved-btn'); // may be null if removed
const companyNameEl = document.getElementById('company-name');
const companyLinksEl = document.getElementById('company-links');
const contentEl = document.getElementById('content');
const settingsPanel = document.getElementById('settings-panel');
const savePrefsBtn = document.getElementById('save-prefs-btn');
const saveConfirm = document.getElementById('save-confirm');
const saveBtn = document.getElementById('save-btn');
const saveJobBtn = document.getElementById('save-job-btn');
const savePanel = document.getElementById('save-panel');
const saveNotes = document.getElementById('save-notes');
const saveConfirmBtn = document.getElementById('save-confirm-btn');
let saveMode = 'company'; // 'company' or 'job'
let currentSaveTags = [];
let allKnownTags = [];
let detectedDomain = null;
let detectedCompanyLinkedin = null;
let detectedLinkedinFirmo = null;
let settingsOpen = false;
let currentResearch = null;
let currentSavedEntry = null; // saved entry for the current company (for knownContacts etc.)
let currentUrl = null;
let detectedJobUrl = null; // canonical job URL from content script (preferred over currentUrl for jobUrl)
let currentJobTitle = null;
let currentJobDescription = null;
let currentJobMeta = null;
let currentPrefs = null;
let saveRating = 0;
let _sessionSaves = [];
let _queueStageKey = 'needs_review'; // dynamically resolved on load
let _manualLinkId = null; // persisted manual association (survives page navigation)

// Resolve the queue stage key from pipeline config or first stage
function resolveQueueStage() {
  chrome.storage.local.get(['pipelineConfig', 'opportunityStages', 'customStages'], data => {
    const stages = data.opportunityStages || data.customStages || [];
    _queueStageKey = data.pipelineConfig?.scoring?.queueStage || (stages.length > 0 ? stages[0].key : 'needs_review');
  });
}
resolveQueueStage();

// Auto-set "Action On" based on stage
// defaultActionStatus, autoNextStepForStage, applyAutoStage — provided by ui-utils.js

let currentTabId = null;

// Load prefs from sync, falling back to local (migration path for pre-sync installs).
// If found only in local, copies to sync so future reads succeed.
function normalizeCompanyName(name) {
  return (name || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function companiesMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (na === nb) return true;
  // One contains the other (handles "Product Genius" vs "Product Genius AI")
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function getDomainFromUrl(url) {
  return (url || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').toLowerCase();
}

// Fallback: if content script detection fails, match the tab URL against saved companies by domain.
// Calls onMatch(savedEntry) if found, onFail() otherwise.
function tryShowCompanyFromUrl(tabUrl, onFail) {
  if (!tabUrl || /^chrome|^about|^moz-extension/.test(tabUrl)) { onFail(); return; }
  const tabDomain = getDomainFromUrl(tabUrl);
  if (!tabDomain) { onFail(); return; }
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const match = (savedCompanies || []).find(c => {
      const savedDomain = getDomainFromUrl(c.companyWebsite || '');
      return savedDomain && savedDomain.length > 3 && tabDomain === savedDomain;
    });
    if (match) {
      const homeEl = document.getElementById('sp-home');
      if (homeEl) homeEl.style.display = 'none';
      const companyContent = document.getElementById('company-content');
      if (companyContent) companyContent.style.display = '';
      if (searchBtn) searchBtn.style.display = '';
      companyNameEl.textContent = match.company;
      detectedDomain = getDomainFromUrl(match.companyWebsite || '') || null;
      detectedCompanyLinkedin = match.companyLinkedin || null;
      triggerResearch(match.company);
    } else {
      onFail();
    }
  });
}

function loadPrefsWithMigration(callback) {
  chrome.storage.sync.get(['prefs'], (syncResult) => {
    void chrome.runtime.lastError;
    if (syncResult.prefs && Object.keys(syncResult.prefs).length > 0) {
      callback(syncResult.prefs);
      return;
    }
    chrome.storage.local.get(['prefs'], (localResult) => {
      void chrome.runtime.lastError;
      if (localResult.prefs && Object.keys(localResult.prefs).length > 0) {
        chrome.storage.sync.set({ prefs: localResult.prefs }, () => void chrome.runtime.lastError);
      }
      callback(localResult.prefs || null);
    });
  });
}

function applyPrefsToForm(prefs) {
  if (!prefs) return;
  // Helper: set value only if element exists (some fields moved to Career OS page)
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('pref-roles', prefs.roles);
  setVal('pref-avoid', prefs.avoid);
  setVal('pref-interests', prefs.interests);
  setVal('pref-linkedin-url', prefs.linkedinUrl);
  setVal('pref-resume-text', prefs.resumeText);
  setVal('pref-job-match-bg', prefs.jobMatchBackground);
  setVal('pref-role-loved', prefs.roleLoved);
  setVal('pref-role-hated', prefs.roleHated);
  const toggle = document.getElementById('pref-job-match-toggle');
  if (toggle) toggle.checked = !!prefs.jobMatchEnabled;
  const matchFields = document.getElementById('job-match-fields');
  if (matchFields) matchFields.style.display = prefs.jobMatchEnabled ? 'block' : 'none';
  (prefs.workArrangement || []).forEach(val => {
    const cb = document.querySelector(`input[name="work-arr"][value="${val}"]`);
    if (cb) cb.checked = true;
  });
  setVal('pref-location-city', prefs.locationCity);
  setVal('pref-location-state', prefs.locationState);
  setVal('pref-max-travel', prefs.maxTravel);
  setVal('pref-salary-floor', prefs.salaryFloor || prefs.minSalary);
  setVal('pref-salary-strong', prefs.salaryStrong);
}

// Load preferences into settings fields (with local→sync migration)
loadPrefsWithMigration((prefs) => {
  currentPrefs = prefs;
  applyPrefsToForm(prefs);
});

// Open full saved view
function openDashboard() {
  coopNavigate(chrome.runtime.getURL('saved.html'), true);
}
savedBtn?.addEventListener('click', openDashboard);
document.getElementById('sp-logo')?.addEventListener('click', openDashboard);
document.getElementById('sp-dashboard-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  openDashboard();
});

// Close sidepanel
document.getElementById('sp-close-btn')?.addEventListener('click', () => {
  // Try Chrome sidePanel API first, fall back to window.close
  if (chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'CLOSE_SIDEPANEL' }, () => {
      void chrome.runtime.lastError;
      window.close();
    });
  } else {
    window.close();
  }
});

// Re-render tasks/stats when storage changes from another page (e.g. saved.html)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.userTasks) {
    const homeEl = document.getElementById('sp-home');
    if (homeEl && homeEl.style.display !== 'none') renderHomeState();
    else showPipelineStats();
  }
});

function openSavePanel(mode) {
  saveMode = mode;
  const isJob = mode === 'job';
  const modeLabel = document.getElementById('save-mode-label');
  if (modeLabel) modeLabel.textContent = isJob ? 'Saving Job Posting' : 'Saving Company';
  saveConfirmBtn.textContent = isJob ? 'Save Job Posting' : 'Save Company';

  const statusRow = document.getElementById('save-status-row');
  const statusSelect = document.getElementById('save-status-select');
  if (statusRow && statusSelect) {
    statusSelect.innerHTML = Object.entries(JOB_STATUSES)
      .map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
    statusRow.style.display = 'block';
  }

  savePanel.classList.add('visible');
  saveNotes.value = '';
  saveRating = 0;
  currentSaveTags = isJob ? ['Job Posted'] : [];
  document.querySelectorAll('.save-star').forEach(s => s.classList.remove('filled'));
  renderSaveTagChips();

  // Derive tags from actual entries so stale/removed tags never appear
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    allKnownTags = [...new Set((savedCompanies || []).flatMap(c => c.tags || []))].sort();
  });
}

function renderSaveTagChips() {
  const chipsEl = document.getElementById('save-tags-chips');
  if (!chipsEl) return;
  chipsEl.innerHTML = currentSaveTags.map(tag =>
    `<span class="save-tag-chip">${tag}<span class="remove-tag" data-tag="${tag}">✕</span></span>`
  ).join('');
  chipsEl.querySelectorAll('.remove-tag').forEach(el => {
    el.addEventListener('click', () => {
      currentSaveTags = currentSaveTags.filter(t => t !== el.dataset.tag);
      renderSaveTagChips();
    });
  });
}

// Tag input logic
const saveTagInput = document.getElementById('save-tag-input');
const saveTagSuggestions = document.getElementById('save-tag-suggestions');

function showSaveTagSuggestions() {
  const val = saveTagInput.value.trim().toLowerCase();
  const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !currentSaveTags.includes(t));
  if (matches.length === 0) { saveTagSuggestions.style.display = 'none'; return; }
  saveTagSuggestions.innerHTML = matches.slice(0, 8).map(t =>
    `<div class="save-tag-suggestion" data-tag="${t}">${t}</div>`
  ).join('');
  saveTagSuggestions.style.display = 'block';
  saveTagSuggestions.querySelectorAll('.save-tag-suggestion').forEach(el => {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); addSaveTag(el.dataset.tag); });
  });
}

if (saveTagInput) {
  saveTagInput.addEventListener('focus', showSaveTagSuggestions);
  saveTagInput.addEventListener('input', showSaveTagSuggestions);
  saveTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const val = saveTagInput.value.trim(); if (val) addSaveTag(val); }
    if (e.key === 'Escape') saveTagSuggestions.style.display = 'none';
  });
  saveTagInput.addEventListener('blur', () => { setTimeout(() => { if (saveTagSuggestions) saveTagSuggestions.style.display = 'none'; }, 150); });
}

function addSaveTag(tag) {
  const clean = tag.trim();
  if (!clean || currentSaveTags.includes(clean)) { saveTagInput.value = ''; return; }
  currentSaveTags.push(clean);
  saveTagInput.value = '';
  saveTagSuggestions.style.display = 'none';
  renderSaveTagChips();
}

// Save Company button
saveBtn.addEventListener('click', () => {
  if (saveBtn.classList.contains('saved')) return;
  if (savePanel.classList.contains('visible') && saveMode === 'company') {
    savePanel.classList.remove('visible');
    return;
  }
  openSavePanel('company');
});

// Save Job button
saveJobBtn.addEventListener('click', () => {
  if (saveJobBtn.classList.contains('saved')) return;
  if (savePanel.classList.contains('visible') && saveMode === 'job') {
    savePanel.classList.remove('visible');
    return;
  }
  openSavePanel('job');
});

// Save stars
const allStars = [...document.querySelectorAll('.save-star')];
allStars.forEach(star => {
  star.addEventListener('mouseenter', () => {
    const hoverVal = parseInt(star.dataset.val);
    allStars.forEach((s, i) => s.classList.toggle('hovered', i < hoverVal));
  });
  star.addEventListener('click', () => {
    saveRating = parseInt(star.dataset.val);
    allStars.forEach((s, i) => s.classList.toggle('filled', i < saveRating));
  });
});
document.getElementById('save-stars').addEventListener('mouseleave', () => {
  allStars.forEach(s => s.classList.remove('hovered'));
});

// Save confirm
// Title similarity: strip seniority prefixes and compare core role words
function titlesAreSimilar(a, b) {
  if (!a || !b) return true; // if either is missing, treat as same
  const strip = t => t.toLowerCase()
    .replace(/^(senior|sr\.?|staff|principal|lead|head of|vp of?|director of?|chief|junior|jr\.?|associate|founding)\s+/i, '')
    .replace(/[,\-–—|·•].*$/, '') // strip suffixes like ", B2B SAAS"
    .trim();
  const ca = strip(a), cb = strip(b);
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  // Check word overlap — if >50% of words match
  const wa = ca.split(/\s+/), wb = cb.split(/\s+/);
  const shared = wa.filter(w => wb.includes(w)).length;
  return shared >= Math.min(wa.length, wb.length) * 0.5;
}

function showToast(msg) {
  const el = document.getElementById('sp-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

saveConfirmBtn.addEventListener('click', () => {
  if (saveConfirmBtn.classList.contains('saved')) return;
  const company = companyNameEl.textContent;
  const isJobSave = saveMode === 'job';

  chrome.runtime.sendMessage({
    type: 'SAVE_OPPORTUNITY',
    company,
    jobTitle: isJobSave ? (currentJobTitle || null) : null,
    jobUrl: isJobSave ? (detectedJobUrl || currentUrl || null) : null,
    jobDescription: isJobSave ? (currentJobDescription || null) : null,
    jobMeta: isJobSave ? (currentJobMeta || currentResearch?.jobSnapshot || null) : null,
    linkedinFirmo: detectedLinkedinFirmo || null,
    source: 'sidepanel',
  }, (resp) => {
    void chrome.runtime.lastError;
    if (!resp || resp.error) {
      console.error('[SP] Save error:', resp?.error);
      return;
    }

    const entry = resp.entry;
    saveConfirmBtn.textContent = '✓ Saved'; saveConfirmBtn.classList.add('saved');
    if (isJobSave) { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
    else           { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
    showCrmLink(entry);

    if (resp.isDuplicate) {
      showToast(`Updated existing opportunity at ${entry.company}`);
    }
  });
});

function mergeAndSave(prev, existing, dupIdx) {
  const isJobSave = saveMode === 'job';
  const jobStageValue = isJobSave ? (document.getElementById('save-status-select')?.value || 'needs_review') : null;
  const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
  const companyLinkedin = currentResearch?.companyLinkedin || detectedCompanyLinkedin || (/linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null);

  // Auto-tag Easy Apply jobs
  if (isJobSave && currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
    currentSaveTags.push('linkedin easy apply');
  }

  const merged = {
    ...prev,
    notes:          saveNotes.value.trim() || prev.notes,
    rating:         saveRating || prev.rating,
    tags:           [...new Set([...(prev.tags || []), ...currentSaveTags])],
    companyWebsite: prev.companyWebsite  || companyWebsite  || null,
    companyLinkedin:prev.companyLinkedin || companyLinkedin || null,
    intelligence:   prev.intelligence   || currentResearch?.intelligence || null,
    reviews:        prev.reviews?.length ? prev.reviews : (currentResearch?.reviews || null),
    leaders:        prev.leaders?.length ? prev.leaders : (currentResearch?.leaders || null),
    employees:      prev.employees || currentResearch?.employees || null,
    funding:        prev.funding   || currentResearch?.funding   || null,
    founded:        prev.founded   || currentResearch?.founded   || null,
    ...(isJobSave ? {
      isOpportunity:  true,
      jobStage:       jobStageValue, // Always reset to scoring queue on new save
      jobTitle:       currentJobTitle || prev.jobTitle || null,
      jobUrl:         detectedJobUrl || currentUrl || prev.jobUrl || null,
      jobMatch:       currentResearch?.jobMatch || null, // Clear old score for re-evaluation
      jobSnapshot:    currentResearch?.jobSnapshot || prev.jobSnapshot || null,
      jobDescription: currentJobDescription || prev.jobDescription || null,
    } : {
      status: prev.status || 'co_watchlist',
    }),
  };
  // Backfill from LinkedIn firmographics (free DOM scraping — never overwrites)
  if (detectedLinkedinFirmo) {
    if (!merged.linkedinFirmo) merged.linkedinFirmo = detectedLinkedinFirmo;
    if (!merged.employees && detectedLinkedinFirmo.employees) merged.employees = detectedLinkedinFirmo.employees;
    if (!merged.industry && detectedLinkedinFirmo.industry) merged.industry = detectedLinkedinFirmo.industry;
  }
  const updated = [merged, ...existing.filter((_, i) => i !== dupIdx)];
  chrome.storage.local.set({ savedCompanies: updated }, () => {
    void chrome.runtime.lastError;
    markAsSaved();
    showCrmLink(merged);
    // Auto-queue scoring for job saves
    if (merged.isOpportunity) {
      chrome.runtime.sendMessage({ type: 'QUEUE_SCORE', entryId: merged.id });
    }
  });
}

function enrichExistingOpportunity(prev, existing, dupIdx) {
  // Auto-tag Easy Apply jobs
  if (currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
    currentSaveTags.push('linkedin easy apply');
  }
  // Enrich and reset to scoring queue for re-evaluation
  const enriched = { ...prev };
  enriched.jobStage = _queueStageKey;
  enriched.jobMatch = null; // clear old score for fresh evaluation
  // Use longer/more detailed job description
  if (currentJobDescription && (!prev.jobDescription || currentJobDescription.length > prev.jobDescription.length)) {
    enriched.jobDescription = currentJobDescription;
  }
  // Backfill missing snapshot data
  if (currentResearch?.jobSnapshot) {
    enriched.jobSnapshot = { ...(prev.jobSnapshot || {}), ...currentResearch.jobSnapshot };
    // Only overwrite salary if it was missing
    if (prev.jobSnapshot?.salary) enriched.jobSnapshot.salary = prev.jobSnapshot.salary;
  }
  // Add new URL if different
  const resolvedJobUrl = detectedJobUrl || currentUrl;
  if (resolvedJobUrl && resolvedJobUrl !== prev.jobUrl) enriched.jobUrl = resolvedJobUrl;
  // Backfill company data
  enriched.intelligence = prev.intelligence || currentResearch?.intelligence || null;
  enriched.reviews = prev.reviews?.length ? prev.reviews : (currentResearch?.reviews || null);
  enriched.leaders = prev.leaders?.length ? prev.leaders : (currentResearch?.leaders || null);
  enriched.tags = [...new Set([...(prev.tags || []), ...currentSaveTags])];
  // Backfill comp fields (don't overwrite existing)
  const snap = currentResearch?.jobSnapshot;
  if (!enriched.baseSalaryRange && (snap?.baseSalaryRange || (snap?.salaryType === 'base' && snap?.salary))) {
    enriched.baseSalaryRange = snap.baseSalaryRange || snap.salary;
    enriched.compSource = enriched.compSource || 'Job posting';
    enriched.compAutoExtracted = true;
  }
  if (!enriched.oteTotalComp && (snap?.oteTotalComp || (snap?.salaryType === 'ote' && snap?.salary))) {
    enriched.oteTotalComp = snap.oteTotalComp || snap.salary;
    enriched.compSource = enriched.compSource || 'Job posting';
    enriched.compAutoExtracted = true;
  }
  if (!enriched.equity && snap?.equity) enriched.equity = snap.equity;
  // Backfill from LinkedIn firmographics (free DOM scraping — never overwrites)
  if (detectedLinkedinFirmo) {
    if (!enriched.linkedinFirmo) enriched.linkedinFirmo = detectedLinkedinFirmo;
    if (!enriched.employees && detectedLinkedinFirmo.employees) enriched.employees = detectedLinkedinFirmo.employees;
    if (!enriched.industry && detectedLinkedinFirmo.industry) enriched.industry = detectedLinkedinFirmo.industry;
  }

  const updated = [enriched, ...existing.filter((_, i) => i !== dupIdx)];
  chrome.storage.local.set({ savedCompanies: updated }, () => {
    void chrome.runtime.lastError;
    markAsSaved();
    showToast(`Updated existing opportunity at ${prev.company} with new details.`);
    showCrmLink(enriched);
    // Auto-queue scoring
    chrome.runtime.sendMessage({ type: 'QUEUE_SCORE', entryId: enriched.id });
  });
}

function backfillEntryFromResearch(savedEntry, research) {
  if (!savedEntry || !research) return;
  const updates = {};
  if (!savedEntry.companyWebsite && research.companyWebsite) updates.companyWebsite = research.companyWebsite;
  if (!savedEntry.companyLinkedin && research.companyLinkedin) updates.companyLinkedin = research.companyLinkedin;
  if (!savedEntry.employees && research.employees) updates.employees = research.employees;
  if (!savedEntry.industry && research.industry) updates.industry = research.industry;
  if (!savedEntry.funding && research.funding) updates.funding = research.funding;
  if (!savedEntry.revenue && research.revenue) updates.revenue = research.revenue;
  if (!savedEntry.companyType && research.companyType) updates.companyType = research.companyType;
  if (!savedEntry.techStack?.length && research.techStack?.length) updates.techStack = research.techStack;
  if (!savedEntry.recentNews?.length && research.recentNews?.length) updates.recentNews = research.recentNews;
  // Backfill intelligence + reviews — used by scorer for culture/company fit
  if (!savedEntry.intelligence && research.intelligence) updates.intelligence = research.intelligence;
  if ((!savedEntry.reviews || !savedEntry.reviews.length) && research.reviews?.length) updates.reviews = research.reviews;
  if (!savedEntry.leaders?.length && research.leaders?.length) updates.leaders = research.leaders;
  if (Object.keys(updates).length === 0) return;
  // Update in storage
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const entries = savedCompanies || [];
    const idx = entries.findIndex(c => c.id === savedEntry.id);
    if (idx === -1) return;
    Object.assign(entries[idx], updates);
    Object.assign(savedEntry, updates);
    chrome.storage.local.set({ savedCompanies: entries });
  });
}

function showDuplicateDialog(prev, existing, dupIdx) {
  const dialog = document.getElementById('dup-dialog');
  const titleEl = document.getElementById('dup-dialog-title');
  const bodyEl = document.getElementById('dup-dialog-body');
  titleEl.textContent = `Existing opportunity at ${prev.company}`;
  bodyEl.innerHTML = `You're already tracking <strong>${prev.jobTitle}</strong> at ${prev.company}. This posting is for <strong>${currentJobTitle}</strong>. Is this a different role?`;
  dialog.classList.add('visible');

  const updateBtn = document.getElementById('dup-btn-update');
  const newBtn = document.getElementById('dup-btn-new');

  // Clean up old listeners
  const newUpdateBtn = updateBtn.cloneNode(true);
  const newNewBtn = newBtn.cloneNode(true);
  updateBtn.replaceWith(newUpdateBtn);
  newBtn.replaceWith(newNewBtn);

  newUpdateBtn.addEventListener('click', () => {
    dialog.classList.remove('visible');
    enrichExistingOpportunity(prev, existing, dupIdx);
  });
  newNewBtn.addEventListener('click', () => {
    dialog.classList.remove('visible');
    // Auto-tag Easy Apply jobs
    if (currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
      currentSaveTags.push('linkedin easy apply');
    }
    // Create brand new opportunity entry for the different role
    const company = companyNameEl.textContent;
    const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
    const companyLinkedin = currentResearch?.companyLinkedin || detectedCompanyLinkedin || null;
    const entry = {
      id:             Date.now().toString(36) + Math.random().toString(36).substr(2),
      type:           'company',
      company,
      savedAt:        Date.now(),
      notes:          saveNotes.value.trim(),
      rating:         saveRating || null,
      tags:           [...currentSaveTags],
      companyWebsite: companyWebsite || prev.companyWebsite || null,
      companyLinkedin: companyLinkedin || prev.companyLinkedin || null,
      intelligence:   prev.intelligence || currentResearch?.intelligence || null,
      reviews:        prev.reviews || currentResearch?.reviews || null,
      leaders:        prev.leaders || currentResearch?.leaders || null,
      employees:      prev.employees || currentResearch?.employees || null,
      funding:        prev.funding || currentResearch?.funding || null,
      founded:        prev.founded || currentResearch?.founded || null,
      status:         'co_watchlist',
      isOpportunity:  true,
      jobStage:       document.getElementById('save-status-select')?.value || 'needs_review',
      jobTitle:       currentJobTitle || null,
      jobUrl:         detectedJobUrl || currentUrl || null,
      jobMatch:       currentResearch?.jobMatch || null,
      jobSnapshot:    currentResearch?.jobSnapshot || null,
      jobDescription: currentJobDescription || null,
    };
    chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, () => {
      void chrome.runtime.lastError;
      markAsSaved();
      showCrmLink(entry);
    });
  });
}

function showPipelineStats() {
  const el = document.getElementById('sp-pipeline-stats');
  if (!el) return;
  chrome.storage.local.get(['savedCompanies', 'activityGoals', 'statCardConfigs'], data => {
    const companies = data.savedCompanies || [];
    const opps = companies.filter(c => c.isOpportunity);
    // Mirror the dashboard's selected period — same logic as saved.js getPeriodRange
    const period = localStorage.getItem('ci_activityPeriod') || 'daily';
    const goals = (data.activityGoals || {})[period] || {};
    const cards = data.statCardConfigs || [
      { key: 'saved', label: 'Opportunities Saved', stages: ['*'], color: '#0ea5e9', mode: 'snapshot' },
      { key: 'applied', label: 'Applications', stages: ['applied'], color: '#FF7A59' },
      { key: 'interviewed', label: 'New Conversations Started', stages: ['conversations'], color: '#fb923c' },
    ];

    // Replicate the exact same period range calculation as the dashboard
    const now = new Date();
    let start, end;
    const customRange = localStorage.getItem('ci_activityCustomRange');
    if (customRange) {
      try {
        const cr = JSON.parse(customRange);
        start = new Date(cr.start + 'T00:00:00').getTime();
        end = new Date(cr.end + 'T23:59:59').getTime();
      } catch(e) {}
    }
    if (!start) {
      if (period === 'daily') {
        const s = new Date(now); s.setHours(0,0,0,0);
        const e = new Date(now); e.setHours(23,59,59,999);
        start = s.getTime(); end = e.getTime();
      } else if (period === 'weekly') {
        const day = now.getDay();
        const mon = new Date(now); mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day)); mon.setHours(0,0,0,0);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
        start = mon.getTime(); end = sun.getTime();
      } else {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        start = s.getTime(); end = e.getTime();
      }
    }
    const inPeriod = ts => ts && ts >= start && ts <= end;

    // Same counting logic as dashboard — supports activity + snapshot modes
    const counts = cards.slice(0, 3).map(card => {
      let count;
      if (card.mode === 'snapshot') {
        count = card.stages.includes('*') ? opps.length : opps.filter(c => card.stages.includes(c.jobStage || 'needs_review')).length;
      } else {
        if (card.stages.includes('*')) {
          count = opps.filter(c => inPeriod(c.savedAt)).length;
        } else {
          count = opps.filter(c => card.stages.some(sk => inPeriod(c.stageTimestamps?.[sk]))).length;
        }
      }
      const goal = goals[card.key] || 0;
      return { ...card, count, goal };
    });

    // Mini ring SVG (16x16)
    function miniRing(count, goal, color) {
      if (!goal) return '';
      const pct = Math.min(1, count / goal);
      const r = 6, cx = 8, cy = 8, c = 2 * Math.PI * r;
      return `<svg class="sp-stat-ring" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2D3E50" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2"
          stroke-dasharray="${pct * c} ${c}" stroke-linecap="round"
          transform="rotate(-90 ${cx} ${cy})"/>
      </svg>`;
    }

    // Format date range label
    const fmtDate = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const periodLabel = period === 'daily' ? 'Today' : `${fmtDate(start)} – ${fmtDate(end)}`;

    el.innerHTML = `<span style="font-size:10px;font-weight:600;color:#7c98b6;text-transform:uppercase;letter-spacing:0.04em;margin-right:4px;">${periodLabel}</span>` +
    counts.map(c =>
      `<div class="sp-stat-chip">
        ${miniRing(c.count, c.goal, c.color)}
        <span class="sp-stat-num">${c.count}${c.goal ? `<span class="sp-stat-denom">/${c.goal}</span>` : ''}</span>
        <span class="sp-stat-label">${c.label}</span>
      </div>`
    ).join('<span style="color:#2D3E50">·</span>');
    el.style.display = 'flex';

    // Click to open dashboard
    el.onclick = () => {
      coopNavigate(chrome.runtime.getURL('saved.html'), true);
    };
  });
}

function markAsSaved() {
  saveConfirmBtn.textContent = '✓ Saved'; saveConfirmBtn.classList.add('saved');
  if (saveMode === 'job') { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
  else                    { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
}

// Show pipeline stats immediately on load
showPipelineStats();

// Detect company on load and auto-research
chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  currentUrl = tabs[0]?.url || null;
  currentTabId = tabs[0]?.id || null;
  const tabId = tabs[0]?.id;

  function handleInitialDetection(response) {
    // If a queue Open-Application handoff already bound the panel, preserve it.
    // The pending-bind IIFE (see __coopBind block) runs in parallel with this
    // detection and may set _manualLinkId + currentSavedEntry before we get here.
    // Without this guard we'd unconditionally overwrite the bound UI with
    // whatever content.js detected on the new tab (often nothing, on a LinkedIn
    // search URL), dropping the user to home state.
    if (_manualLinkId && currentSavedEntry) {
      currentUrl = tabs[0]?.url || currentUrl;
      if (response && response.domain) detectedDomain = response.domain;
      if (response && response.canonicalJobUrl) detectedJobUrl = response.canonicalJobUrl;
      if (response && response.jobTitle && !currentJobTitle) currentJobTitle = response.jobTitle;
      updateJobTitleBar();
      return;
    }
    if (chrome.runtime.lastError || !response || !response.company) {
      // Content script didn't respond — try URL-based match against saved companies
      tryShowCompanyFromUrl(currentUrl, renderHomeState);
      return;
    }
    // Company detected — hide home state, show company UI
    const homeEl = document.getElementById('sp-home');
    if (homeEl) homeEl.style.display = 'none';
    const companyContent = document.getElementById('company-content');
    if (companyContent) companyContent.style.display = '';
    if (searchBtn) searchBtn.style.display = '';
    companyNameEl.textContent = response.company;
    currentJobTitle = response.jobTitle || null;
    currentJobMeta = response.jobMeta || null;
    if (response.easyApply != null) {
      if (!currentJobMeta) currentJobMeta = {};
      currentJobMeta.easyApply = response.easyApply;
    }
    detectedDomain = response.domain || null;
    detectedCompanyLinkedin = response.companyLinkedinUrl || null;
    detectedLinkedinFirmo = response.linkedinFirmo || null;
    detectedJobUrl = response.canonicalJobUrl || null;
    updateJobTitleBar();
    triggerResearch(response.company);

    // Concurrently extract description — fires in parallel with research
    if (currentJobTitle) {
      startJobDescriptionFlow(tabId);
    }
  }

  if (!tabId) {
    tryShowCompanyFromUrl(currentUrl, renderHomeState);
    return;
  }

  // Only inject content script on real web pages — skip chrome://, extension pages, etc.
  const isWebPage = currentUrl && /^https?:\/\//i.test(currentUrl);
  if (isWebPage) {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
  }
  // Wait for the pending-bind handoff to settle before running detection.
  // If the Apply-Queue handoff bound an entry, we skip detection entirely so
  // it can't overwrite the bound UI.
  Promise.resolve(window.__coopBindReady).then(() => {
    if (_manualLinkId && currentSavedEntry) {
      console.log('[SP] Initial detection skipped — queue handoff already bound:', currentSavedEntry.company);
      return;
    }
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_COMPANY' }, handleInitialDetection);
    }, 300);
  });
});

function startJobDescriptionFlow(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'GET_JOB_DESCRIPTION' }, (descResponse) => {
    void chrome.runtime.lastError;
    if (!descResponse) return;

    // Update meta with more accurate post-panel data
    if (descResponse.jobMeta?.workArrangement || descResponse.jobMeta?.salary || descResponse.jobMeta?.perks?.length) {
      currentJobMeta = descResponse.jobMeta;
      renderJobSnapshot(descResponse.jobMeta);
    }

    // Render saved match if available, otherwise show location/meta only (no loading spinner)
    if (currentSavedEntry?.jobMatch) {
      renderJobOpportunity(currentSavedEntry.jobMatch, currentSavedEntry.jobSnapshot || descResponse.jobMeta || currentJobMeta || null);
    } else if (descResponse.jobMeta || currentJobMeta) {
      // Show job meta (location, salary) without the analysis spinner
      renderJobOpportunity('pending', descResponse.jobMeta || currentJobMeta || null);
    }

    // Store description for use in save + chat context
    if (descResponse.jobDescription) {
      currentJobDescription = descResponse.jobDescription;

      // Backfill: if entry was already saved without JD, patch storage
      if (currentSavedEntry && !currentSavedEntry.jobDescription) {
        currentSavedEntry.jobDescription = descResponse.jobDescription;
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          void chrome.runtime.lastError;
          const es = savedCompanies || [];
          const idx = es.findIndex(e => e.id === currentSavedEntry.id);
          if (idx !== -1 && !es[idx].jobDescription) {
            es[idx].jobDescription = descResponse.jobDescription;
            chrome.storage.local.set({ savedCompanies: es });
            console.log('[SP] Late-backfilled JD on', currentSavedEntry.company);
          }
        });
      }

      // If already saved with a job match score, use it — don't re-score
      if (currentSavedEntry?.jobMatch) {
        console.log('[SP] Using saved job match — skipping re-score');
        renderJobOpportunity(currentSavedEntry.jobMatch, currentSavedEntry.jobSnapshot || descResponse.jobMeta || currentJobMeta || null);
        return;
      }
      // Never auto-trigger job analysis — only runs via explicit research or save+research
      console.log('[SP] Skipping auto scoring — user must click Research');
      return;
    }
  });
}

// Open Setup page in a new tab
settingsBtn.addEventListener('click', () => {
  coopNavigate(chrome.runtime.getURL('preferences.html'), true);
});

// Job match toggle
document.getElementById('pref-job-match-toggle').addEventListener('change', (e) => {
  document.getElementById('job-match-fields').style.display = e.target.checked ? 'block' : 'none';
});

// Import LinkedIn profile
document.getElementById('import-linkedin-btn').addEventListener('click', () => {
  const btn = document.getElementById('import-linkedin-btn');
  const status = document.getElementById('import-profile-status');
  btn.disabled = true;
  status.textContent = 'Importing…';
  status.className = 'import-profile-status';

  const linkedinUrl = document.getElementById('pref-linkedin-url').value.trim();
  if (!linkedinUrl) {
    status.textContent = 'Enter your LinkedIn profile URL above first.';
    status.className = 'import-profile-status err';
    btn.disabled = false;
    return;
  }

  const slugMatch = linkedinUrl.match(/\/in\/([^/?#]+)/);
  if (!slugMatch) {
    status.textContent = 'Invalid LinkedIn URL — should be linkedin.com/in/yourname';
    status.className = 'import-profile-status err';
    btn.disabled = false;
    return;
  }
  const profileSlug = slugMatch[1].toLowerCase();

  chrome.tabs.query({}, (tabs) => {
    const profileTab = tabs.find(t => {
      if (!t.url) return false;
      const m = t.url.match(/\/in\/([^/?#]+)/);
      return m && m[1].toLowerCase() === profileSlug;
    });

    if (!profileTab) {
      status.textContent = 'Open your LinkedIn profile in a tab first, then click Import.';
      status.className = 'import-profile-status err';
      btn.disabled = false;
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: profileTab.id },
      func: () => {
        const parts = [];
        const name = document.querySelector('h1')?.textContent?.trim();
        const headline = document.querySelector('.text-body-medium.break-words')?.textContent?.trim();
        if (name) parts.push('Name: ' + name);
        if (headline) parts.push('Headline: ' + headline + '\n');

        function sectionText(id) {
          const anchor = document.getElementById(id);
          if (!anchor) return null;
          let el = anchor;
          for (let i = 0; i < 6; i++) {
            el = el.parentElement;
            if (!el) break;
            const t = el.innerText && el.innerText.trim();
            if (t && t.length > 80) return t;
          }
          return null;
        }

        const about = sectionText('about');
        if (about) parts.push('About:\n' + about.replace(/^About\s*\n/, '') + '\n');
        const exp = sectionText('experience');
        if (exp) parts.push('Experience:\n' + exp.replace(/^Experience\s*\n/, '') + '\n');
        const edu = sectionText('education');
        if (edu) parts.push('Education:\n' + edu.replace(/^Education\s*\n/, '') + '\n');
        const skills = sectionText('skills');
        if (skills) parts.push('Skills:\n' + skills.replace(/^Skills\s*\n/, ''));

        if (parts.length <= 2) {
          const main = document.querySelector('main') || document.querySelector('.scaffold-layout__main');
          const t = main && main.innerText && main.innerText.trim();
          if (t && t.length > 100) parts.push(t);
        }

        const result = parts.join('\n').trim();
        return result.length > 0 ? result.slice(0, 4000) : null;
      }
    }, (results) => {
      void chrome.runtime.lastError;
      btn.disabled = false;
      const profileText = results && results[0] && results[0].result;
      if (profileText) {
        document.getElementById('pref-resume-text').value = profileText;
        status.textContent = 'Imported!';
        status.className = 'import-profile-status ok';
        setTimeout(() => { status.textContent = ''; }, 3000);
      } else {
        status.textContent = 'Could not read profile — make sure the page has fully loaded.';
        status.className = 'import-profile-status err';
      }
    });
  });
});

// Upload resume file (.txt / .md)
document.getElementById('upload-resume-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const status = document.getElementById('import-profile-status');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result?.trim();
    if (text) {
      document.getElementById('pref-resume-text').value = text;
      status.textContent = `Loaded: ${file.name}`;
      status.className = 'import-profile-status ok';
      setTimeout(() => { status.textContent = ''; }, 3000);
    } else {
      status.textContent = 'File appears empty.';
      status.className = 'import-profile-status err';
    }
  };
  reader.onerror = () => {
    status.textContent = 'Could not read file.';
    status.className = 'import-profile-status err';
  };
  reader.readAsText(file);
  e.target.value = ''; // allow re-uploading same file
});

// Save preferences
savePrefsBtn.addEventListener('click', () => {
  const cityVal = document.getElementById('pref-location-city').value.trim();
  const stateVal = document.getElementById('pref-location-state').value.trim();

  // Require both fields together, and city must look like a real place name (letters/spaces/hyphens only)
  if (cityVal && !stateVal) {
    document.getElementById('pref-location-state').style.borderColor = '#f87171';
    setTimeout(() => document.getElementById('pref-location-state').style.borderColor = '', 2000);
    return;
  }
  if (stateVal && !cityVal) {
    document.getElementById('pref-location-city').style.borderColor = '#f87171';
    setTimeout(() => document.getElementById('pref-location-city').style.borderColor = '', 2000);
    return;
  }
  if (cityVal && !/^[A-Za-z\s\-'.]+$/.test(cityVal)) {
    document.getElementById('pref-location-city').style.borderColor = '#f87171';
    setTimeout(() => document.getElementById('pref-location-city').style.borderColor = '', 2000);
    return;
  }

  const prefs = {
    roles: document.getElementById('pref-roles').value.trim(),
    avoid: document.getElementById('pref-avoid').value.trim(),
    interests: document.getElementById('pref-interests').value.trim(),
    jobMatchEnabled: document.getElementById('pref-job-match-toggle').checked,
    linkedinUrl: document.getElementById('pref-linkedin-url').value.trim(),
    resumeText: document.getElementById('pref-resume-text').value.trim(),
    jobMatchBackground: document.getElementById('pref-job-match-bg').value.trim(),
    roleLoved: document.getElementById('pref-role-loved').value.trim(),
    roleHated: document.getElementById('pref-role-hated').value.trim(),
    workArrangement: [...document.querySelectorAll('input[name="work-arr"]:checked')].map(el => el.value),
    locationCity: document.getElementById('pref-location-city').value.trim(),
    locationState: document.getElementById('pref-location-state').value.trim(),
    userLocation: [document.getElementById('pref-location-city').value.trim(), document.getElementById('pref-location-state').value.trim()].filter(Boolean).join(', '),
    maxTravel: document.getElementById('pref-max-travel').value.trim(),
    salaryFloor: document.getElementById('pref-salary-floor').value.trim(),
    salaryStrong: document.getElementById('pref-salary-strong').value.trim()
  };
  chrome.storage.sync.set({ prefs }, () => {
    saveConfirm.classList.add('show');
    setTimeout(() => saveConfirm.classList.remove('show'), 2500);
  });
});

// Company bar toggle
document.getElementById('company-bar-toggle').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  const content = document.getElementById('company-content');
  const chevron = document.getElementById('company-chevron');
  const isOpen = chevron.classList.contains('open');
  chevron.classList.toggle('open', !isOpen);
  content.style.display = isOpen ? 'none' : 'block';
});

// Job bar toggle
document.getElementById('job-bar').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  const content = document.getElementById('job-content');
  const chevron = document.getElementById('job-chevron');
  const isOpen = chevron.classList.contains('open');
  chevron.classList.toggle('open', !isOpen);
  content.style.display = isOpen ? 'none' : 'block';
});

// Refresh button — re-detect company then research
searchBtn.addEventListener('click', () => {
  // Always re-query the CURRENT active tab — don't use stale currentTabId
  searchBtn.classList.add('refreshing');
  searchBtn.disabled = true;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab?.id) {
      contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
      searchBtn.classList.remove('refreshing');
      searchBtn.disabled = false;
      return;
    }
    currentTabId = tab.id;
    currentUrl = tab.url || null;
    const prevCompany = companyNameEl.textContent;

    // Try to inject content script first in case it wasn't loaded
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});

    // Give content script a moment to initialize, then query
    setTimeout(() => {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_COMPANY' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.company) {
        // Try extracting company from tab title as fallback
        const titleCompany = tab.title?.split(/\s*[|·—–]\s*/)?.[0]?.trim();
        if (titleCompany && titleCompany.length > 1 && titleCompany.length < 50) {
          companyNameEl.textContent = titleCompany;
          triggerResearch(titleCompany, true);
          setTimeout(() => { searchBtn.classList.remove('refreshing'); searchBtn.disabled = false; }, 1000);
          return;
        }
        // Try URL-based match against saved companies before showing home state
        searchBtn.classList.remove('refreshing');
        searchBtn.disabled = false;
        tryShowCompanyFromUrl(currentUrl, renderHomeState);
        return;
      }
      // Company detected — hide home state, show company UI
      const homeEl = document.getElementById('sp-home');
      if (homeEl) homeEl.style.display = 'none';
      const companyContentEl = document.getElementById('company-content');
      if (companyContentEl) companyContentEl.style.display = '';
      const companyBarEl = document.getElementById('company-bar-toggle');
      if (companyBarEl) companyBarEl.style.display = '';
      if (searchBtn) searchBtn.style.display = '';
      // Flash if company changed
      if (prevCompany && prevCompany !== '—' && prevCompany !== response.company) {
        companyNameEl.style.animation = 'sp-company-flash 0.5s ease';
        setTimeout(() => companyNameEl.style.animation = '', 500);
      }
      // If user manually linked a company, preserve that association
      // unless we're on a completely different site
      if (_manualLinkId) {
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          const linked = (savedCompanies || []).find(c => c.id === _manualLinkId);
          if (linked) {
            // Manual binds are sticky — they persist across tab/page changes until the user
            // explicitly unbinds or rebinds. Aggregator surfaces (Gmail, Calendar, LinkedIn
            // inbox) detect unrelated "companies" that would otherwise blow away the bind.
            currentSavedEntry = linked;
            currentUrl = tab.url || null;
            detectedDomain = response.domain || detectedDomain;
            if (response.jobTitle) currentJobTitle = response.jobTitle;
            if (response.linkedinFirmo) detectedLinkedinFirmo = response.linkedinFirmo;
            companyNameEl.textContent = linked.company;
            updateJobTitleBar();
            triggerResearch(linked.company, false);
            setTimeout(() => { searchBtn.classList.remove('refreshing'); searchBtn.disabled = false; }, 500);
          }
        });
        return; // async — will handle inside callback
      }

      // Reset state for fresh research
      companyNameEl.textContent = response.company;
      currentJobTitle = response.jobTitle || null;
      currentJobMeta = response.jobMeta || null;
      detectedDomain = response.domain || null;
      detectedCompanyLinkedin = response.companyLinkedinUrl || null;
      detectedLinkedinFirmo = response.linkedinFirmo || null;
      detectedJobUrl = response.canonicalJobUrl || null;
      currentResearch = null;
      currentSavedEntry = null;
      const jobOpp = document.getElementById('job-opportunity');
      if (jobOpp) jobOpp.innerHTML = '';
      updateJobTitleBar();
      triggerResearch(response.company, true);
      if (currentJobTitle) startJobDescriptionFlow(tab.id);

      // Stop spinning after research starts (content loading handles the rest)
      setTimeout(() => {
        searchBtn.classList.remove('refreshing');
        searchBtn.disabled = false;
      }, 1000);
    });
    }, 300); // small delay for content script injection
  });
});

// ── Home State ─────────────────────────────────────────────────────────────
function renderHomeState() {
  const homeEl = document.getElementById('sp-home');
  if (!homeEl) return;

  // Hide company content, show home
  const companyContent = document.getElementById('company-content');
  if (companyContent) companyContent.style.display = 'none';
  const companyBar = document.getElementById('company-bar-toggle');
  if (companyBar) companyBar.style.display = 'none';
  const jobBar = document.getElementById('job-bar');
  if (jobBar) jobBar.style.display = 'none';
  const oppFields = document.getElementById('sp-opp-fields');
  if (oppFields) oppFields.style.display = 'none';
  if (searchBtn) searchBtn.style.display = 'none';
  homeEl.style.display = '';

  // Greeting
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  chrome.storage.local.get(['savedCompanies', 'profileLinks', 'storyTime', 'gmailUserEmail'], data => {
    const companies = data.savedCompanies || [];

    // Try to get first name from profile data
    let firstName = '';
    // Common words that look like names but aren't
    const notNames = /^(one|the|this|that|who|what|how|not|all|any|can|will|been|just|have|with|from|into|also|over|only|some|more|very|each|both|most|than|then|when|here|your|such)$/i;
    if (data.storyTime?.rawInput) {
      const m = data.storyTime.rawInput.match(/(?:my name is|I'm|I am)\s+([A-Z][a-z]{2,})/);
      if (m && !notNames.test(m[1])) firstName = m[1];
    }
    if (!firstName && data.storyTime?.profileSummary) {
      const m = data.storyTime.profileSummary.match(/(?:Name|name):\s*([A-Z][a-z]{2,})/);
      if (m && !notNames.test(m[1])) firstName = m[1];
    }
    // Check gmail user email (stored separately by email fetch)
    if (!firstName && data.gmailUserEmail) {
      const local = data.gmailUserEmail.split('@')[0].split('.')[0];
      if (local && local.length > 2 && !/\d/.test(local) && !notNames.test(local)) firstName = local;
    }
    if (!firstName && data.profileLinks?.email) {
      const local = data.profileLinks.email.split('@')[0].split('.')[0];
      if (local && local.length > 2 && !/\d/.test(local) && !notNames.test(local)) firstName = local;
    }
    firstName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : '';

    document.getElementById('sp-home-greeting').innerHTML = `
      <div class="sp-home-greeting">Good ${timeOfDay}${firstName ? ', ' + firstName : ''}</div>
      <div class="sp-home-greeting-sub">Navigate to any company page to start research</div>
      <button class="sp-open-pipeline-btn" id="sp-open-pipeline" title="Open full pipeline dashboard">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="1" width="14" height="14" rx="2"/><path d="M1 6h14M6 6v9"/></svg>
        Open Pipeline
      </button>
    `;
    document.getElementById('sp-open-pipeline')?.addEventListener('click', openDashboard);

    // Scoring queue count
    const queueCount = companies.filter(c => c.isOpportunity && (c.jobStage || _queueStageKey) === _queueStageKey).length;
    document.getElementById('sp-home-queue').innerHTML = queueCount > 0 ? `
      <div class="sp-home-card sp-home-queue-card" id="sp-home-queue-link">
        <span class="sp-home-queue-count">${queueCount}</span>
        <div>
          <div class="sp-home-queue-text">in Coop's AI Scoring Queue</div>
          <div class="sp-home-queue-sub">Tap to review</div>
        </div>
      </div>
    ` : '';

    document.getElementById('sp-home-queue-link')?.addEventListener('click', () => {
      coopNavigate(chrome.runtime.getURL('queue.html'), true);
    });

    // Next Steps — company-specific next steps with dates (not completable)
    const sourceLabel = (s) => {
      if (!s) return 'Manually set';
      if (s === 'calendar') return 'From calendar event';
      if (s === 'transcript') return 'From meeting transcript';
      if (s === 'notes') return 'From meeting notes';
      if (s === 'email') return 'From recent email';
      return `Source: ${s}`;
    };
    const sourceIcon = (s) => {
      if (!s) return '✎';
      if (s === 'calendar') return '📅';
      if (s === 'transcript') return '🎙';
      if (s === 'notes') return '📝';
      if (s === 'email') return '✉';
      return '·';
    };
    const nextSteps = companies
      .filter(c => c.isOpportunity && c.nextStepDate)
      .map(c => {
        const daysUntil = Math.round((new Date(c.nextStepDate + 'T12:00:00') - new Date()) / 86400000);
        return { id: c.id, company: c.company, text: (c.nextStep || '').slice(0, 50), daysUntil, source: c.nextStepSource || null, evidence: c.nextStepEvidence || null };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 5);

    if (nextSteps.length) {
      document.getElementById('sp-home-actions').innerHTML = `
        <div class="sp-home-section">
          <div class="sp-home-section-title">Next Steps</div>
          <div class="sp-home-card">
            ${nextSteps.map(c => {
              const dateClass = c.daysUntil < 0 ? 'overdue' : c.daysUntil === 0 ? 'today' : 'upcoming';
              const dateLabel = c.daysUntil < 0 ? `${Math.abs(c.daysUntil)}d overdue` : c.daysUntil === 0 ? 'Today' : c.daysUntil === 1 ? 'Tomorrow' : `in ${c.daysUntil}d`;
              const tip = sourceLabel(c.source) + (c.evidence ? ` — "${c.evidence.replace(/"/g, '\\"')}"` : '');
              return `<div class="sp-home-action-item" data-id="${c.id}" data-type="company">
                <div>
                  <div class="sp-home-action-company">${c.company}</div>
                  <div class="sp-home-action-step">${c.text} <span class="sp-home-action-source" title="${tip.replace(/"/g, '&quot;')}" style="opacity:0.55;font-size:10px;margin-left:4px;cursor:help;">${sourceIcon(c.source)}</span></div>
                </div>
                <span class="sp-home-action-date ${dateClass}">${dateLabel}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
      document.querySelectorAll('#sp-home-actions .sp-home-action-item').forEach(el => {
        el.addEventListener('click', () => { coopNavigate(chrome.runtime.getURL('company.html?id=' + el.dataset.id), true); });
      });
    } else {
      document.getElementById('sp-home-actions').innerHTML = '';
    }

    // Tasks — user-created tasks with due dates, completable with checkbox
    chrome.storage.local.get(['userTasks'], taskData => {
      const priVal = p => p === 'high' ? 0 : p === 'normal' ? 1 : 2;
      const tasks = (taskData.userTasks || [])
        .filter(t => !t.completed)
        .map(t => {
          const daysUntil = t.dueDate ? Math.round((new Date(t.dueDate + 'T12:00:00') - new Date()) / 86400000) : null;
          return { ...t, daysUntil };
        })
        .sort((a, b) => {
          if (a.daysUntil === null && b.daysUntil === null) return priVal(a.priority) - priVal(b.priority);
          if (a.daysUntil === null) return 1;
          if (b.daysUntil === null) return -1;
          if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
          return priVal(a.priority) - priVal(b.priority);
        })
        .slice(0, 20);

      const tasksEl = document.getElementById('sp-home-tasks');
      // Read filter state
      const taskPriFilter = _taskPriFilter;
      const taskDateFilter = _taskDateFilter;

      // Apply filters
      const filtered = tasks.filter(t => {
        if (taskPriFilter !== 'all' && (t.priority || 'normal') !== taskPriFilter) return false;
        if (taskDateFilter === 'overdue') return t.daysUntil !== null && t.daysUntil < 0;
        if (taskDateFilter === 'today') return t.daysUntil === 0;
        if (taskDateFilter === 'upcoming') return t.daysUntil !== null && t.daysUntil > 0;
        return true; // 'all' — include tasks with and without dates
      });

      const priColors = { low: { bg: '#DBEAFE', color: '#1D4ED8' }, normal: { bg: '#FEF3C7', color: '#92400E' }, high: { bg: '#FEE2E2', color: '#991B1B' } };

      const filterBtn = (label, filterKey, filterVal) => {
        const isActive = (filterKey === 'pri' ? taskPriFilter : taskDateFilter) === filterVal;
        return `<button data-filter-key="${filterKey}" data-filter-val="${filterVal}" style="font-size:10px;font-weight:600;padding:3px 10px;border-radius:12px;border:1px solid ${isActive ? '#FF7A59' : '#E8E5E0'};background:${isActive ? 'rgba(255,122,89,0.08)' : '#fff'};color:${isActive ? '#FF7A59' : '#6B6560'};cursor:pointer;font-family:inherit;transition:all 0.15s;">${label}</button>`;
      };

      {
        tasksEl.innerHTML = `
          <div class="sp-home-section">
            <div class="sp-home-section-title" style="display:flex;align-items:center;justify-content:space-between;">
              Tasks
              <button id="sp-task-new-btn" style="font-size:10px;font-weight:700;color:#FF7A59;background:none;border:1px solid #FF7A59;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;">+ New</button>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
              ${filterBtn('All', 'pri', 'all')}${filterBtn('High', 'pri', 'high')}${filterBtn('Normal', 'pri', 'normal')}${filterBtn('Low', 'pri', 'low')}
              <span style="width:1px;background:#E8E5E0;margin:0 2px;"></span>
              ${filterBtn('All dates', 'date', 'all')}${filterBtn('Overdue', 'date', 'overdue')}${filterBtn('Today', 'date', 'today')}${filterBtn('Upcoming', 'date', 'upcoming')}
            </div>
            <div class="sp-home-card">
              ${filtered.length ? filtered.map(t => {
                const dateClass = t.daysUntil === null ? '' : t.daysUntil < 0 ? 'overdue' : t.daysUntil === 0 ? 'today' : 'upcoming';
                const dateLabel = t.daysUntil === null ? 'No date' : t.daysUntil < 0 ? `${Math.abs(t.daysUntil)}d overdue` : t.daysUntil === 0 ? 'Today' : t.daysUntil === 1 ? 'Tomorrow' : `in ${t.daysUntil}d`;
                const pri = t.priority || 'normal';
                const pc = priColors[pri] || priColors.normal;
                return `<div class="sp-home-action-item" style="display:flex;align-items:center;gap:8px;" data-task-id="${t.id}">
                  <div class="sp-task-check" data-task-id="${t.id}" style="width:18px;height:18px;border-radius:50%;border:2px solid #dfe3eb;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" title="Complete task"></div>
                  <div style="flex:1;min-width:0;cursor:pointer;padding:2px 4px;border-radius:4px;transition:background 0.15s;" class="sp-task-click" data-task-id="${t.id}" data-task-text="${(t.text||'').replace(/"/g,'&quot;')}" data-task-company="${(t.company||'').replace(/"/g,'&quot;')}" data-task-date="${t.dueDate||''}" data-task-pri="${t.priority||'normal'}" title="Click to edit">
                    <div class="sp-home-action-company">${t.company || (t.text || '').slice(0, 50) || 'Task'}</div>
                    ${t.company ? `<div class="sp-home-action-step">${(t.text || '').slice(0, 50)}</div>` : ''}
                  </div>
                  <span class="sp-task-pri-badge" data-task-id="${t.id}" data-pri="${pri}" style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:3px 8px;border-radius:4px;background:${pc.bg};color:${pc.color};flex-shrink:0;border:1px solid ${pc.color}22;cursor:pointer;" title="Click to change priority">${pri}</span>
                  <span class="sp-task-date-edit ${dateClass}" data-task-id="${t.id}" data-date="${t.dueDate || ''}" title="Click to change date" style="cursor:pointer;flex-shrink:0;${t.daysUntil===null?'color:#A09A94;font-size:10px;':''}">${dateLabel}</span>
                </div>`;
              }).join('') : `<div style="color:#A09A94;font-size:12px;padding:8px 0;">${tasks.length ? 'No tasks match filter' : 'No tasks yet'}</div>`}
            </div>
            <div id="sp-task-add-form" style="display:none;margin-top:8px;">
              <div class="sp-home-card" style="display:flex;flex-direction:column;gap:8px;padding:12px;">
                <input type="hidden" id="sp-quick-task-edit-id">
                <input type="text" id="sp-quick-task-input" placeholder="What needs to be done?" style="font-size:13px;padding:8px 10px;border:1px solid #E8E5E0;border-radius:6px;font-family:inherit;outline:none;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:10px;font-weight:600;color:#6B6560;white-space:nowrap;">Priority:</span>
                    <div id="sp-quick-task-pri" style="display:flex;gap:0;border:1px solid #E8E5E0;border-radius:6px;overflow:hidden;">
                      <button type="button" data-pri="low" style="font-size:9px;font-weight:700;padding:5px 10px;border:none;cursor:pointer;font-family:inherit;background:#fff;color:#6B6560;">Low</button>
                      <button type="button" data-pri="normal" style="font-size:9px;font-weight:700;padding:5px 10px;border:none;border-left:1px solid #E8E5E0;border-right:1px solid #E8E5E0;cursor:pointer;font-family:inherit;background:#FEF3C7;color:#92400E;">Normal</button>
                      <button type="button" data-pri="high" style="font-size:9px;font-weight:700;padding:5px 10px;border:none;cursor:pointer;font-family:inherit;background:#fff;color:#6B6560;">High</button>
                    </div>
                  </div>
                  <input type="date" id="sp-quick-task-date" style="font-size:11px;padding:5px 8px;border:1px solid #E8E5E0;border-radius:6px;font-family:inherit;color:#6B6560;outline:none;flex:1;min-width:130px;">
                </div>
                <div style="display:flex;gap:8px;">
                  <button id="sp-quick-task-add" style="flex:1;font-size:12px;font-weight:700;color:#fff;background:#FF7A59;border:none;border-radius:6px;padding:8px;cursor:pointer;font-family:inherit;">Add Task</button>
                  <button id="sp-quick-task-cancel" style="font-size:12px;font-weight:600;color:#6B6560;background:#F0EEEB;border:none;border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        `;

        // Filter handlers
        tasksEl.querySelectorAll('[data-filter-key]').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.filterKey;
            const val = btn.dataset.filterVal;
            if (key === 'pri') _taskPriFilter = val;
            else _taskDateFilter = val;
            renderHomeState();
          });
        });

        // "+ New" button shows the add form
        tasksEl.querySelector('#sp-task-new-btn')?.addEventListener('click', () => showTaskAddForm(null));
        // Cancel hides it
        tasksEl.querySelector('#sp-quick-task-cancel')?.addEventListener('click', () => {
          const form = tasksEl.querySelector('#sp-task-add-form');
          if (form) form.style.display = 'none';
        });

        // Quick-add / quick-edit task handler
        const quickInput = tasksEl.querySelector('#sp-quick-task-input');
        const quickDate = tasksEl.querySelector('#sp-quick-task-date');
        const quickBtn = tasksEl.querySelector('#sp-quick-task-add');
        const quickPriGroup = tasksEl.querySelector('#sp-quick-task-pri');
        const quickEditId = tasksEl.querySelector('#sp-quick-task-edit-id');
        let quickPriority = 'normal';

        const setQuickPriority = (pri) => {
          quickPriority = pri;
          if (quickPriGroup) {
            quickPriGroup.querySelectorAll('button').forEach(b => {
              const isActive = b.dataset.pri === quickPriority;
              const c = priColors[b.dataset.pri];
              b.style.background = isActive ? c.bg : '#fff';
              b.style.color = isActive ? c.color : '#6B6560';
            });
          }
        };

        if (quickPriGroup) {
          quickPriGroup.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => setQuickPriority(btn.dataset.pri));
          });
        }

        const showTaskAddForm = (editData) => {
          const form = tasksEl.querySelector('#sp-task-add-form');
          if (!form) return;
          if (editData) {
            quickEditId.value = editData.id;
            quickInput.value = editData.text || '';
            quickDate.value = editData.dueDate || '';
            setQuickPriority(editData.priority || 'normal');
            quickBtn.textContent = 'Update Task';
          } else {
            quickEditId.value = '';
            quickInput.value = '';
            quickDate.value = new Date().toISOString().slice(0, 10);
            setQuickPriority('normal');
            quickBtn.textContent = 'Add Task';
          }
          form.style.display = 'block';
          form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          quickInput.focus();
        };

        const addQuickTask = () => {
          const text = quickInput?.value?.trim();
          if (!text) {
            if (quickInput) {
              quickInput.style.borderColor = '#FF7A59';
              quickInput.placeholder = 'Type a task first...';
              setTimeout(() => { quickInput.style.borderColor = ''; quickInput.placeholder = 'What needs to be done?'; }, 1500);
            }
            return;
          }
          const dueDate = quickDate?.value || null;
          const editId = quickEditId?.value;
          chrome.storage.local.get(['userTasks'], d => {
            const all = d.userTasks || [];
            if (editId) {
              const t = all.find(t => t.id === editId);
              if (t) Object.assign(t, { text, dueDate, priority: quickPriority });
            } else {
              all.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                text, dueDate, priority: quickPriority,
                completed: false, createdAt: Date.now(),
              });
            }
            chrome.storage.local.set({ userTasks: all }, () => {
              const form = tasksEl.querySelector('#sp-task-add-form');
              if (form) form.style.display = 'none';
              renderHomeState();
            });
          });
        };
        quickBtn?.addEventListener('click', addQuickTask);
        quickInput?.addEventListener('keydown', e => { if (e.key === 'Enter') addQuickTask(); });

        // Checkbox to complete
        tasksEl.querySelectorAll('.sp-task-check').forEach(el => {
          el.addEventListener('mouseenter', () => { el.style.borderColor = '#5DCAA5'; });
          el.addEventListener('mouseleave', () => { el.style.borderColor = '#dfe3eb'; });
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = el.dataset.taskId;
            chrome.storage.local.get(['userTasks'], d => {
              const allTasks = d.userTasks || [];
              const task = allTasks.find(t => t.id === id);
              if (task) {
                task.completed = true;
                chrome.storage.local.set({ userTasks: allTasks }, () => {
                  // Animate out
                  const row = el.closest('.sp-home-action-item');
                  if (row) {
                    el.style.background = '#5DCAA5';
                    el.style.borderColor = '#5DCAA5';
                    el.innerHTML = '<span style="color:#fff;font-size:10px">✓</span>';
                    row.style.opacity = '0.4';
                    row.style.textDecoration = 'line-through';
                    setTimeout(() => { row.style.display = 'none'; }, 600);
                  }
                });
              }
            });
          });
        });

        // Priority badge is display-only — edit via clicking task text to open inline form

        // Click date to edit
        tasksEl.querySelectorAll('.sp-task-date-edit').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const taskId = el.dataset.taskId;
            const currentDate = el.dataset.date || '';
            // Replace label with date input
            const input = document.createElement('input');
            input.type = 'date';
            input.value = currentDate;
            input.style.cssText = 'font-size:11px;padding:2px 4px;border:1px solid #FF7A59;border-radius:4px;font-family:inherit;outline:none;width:110px;';
            el.replaceWith(input);
            input.focus();
            const save = () => {
              const newDate = input.value;
              if (newDate && newDate !== currentDate) {
                chrome.storage.local.get(['userTasks'], d => {
                  const allTasks = d.userTasks || [];
                  const task = allTasks.find(t => t.id === taskId);
                  if (task) {
                    task.dueDate = newDate;
                    chrome.storage.local.set({ userTasks: allTasks }, () => renderHomeState());
                  }
                });
              } else {
                renderHomeState(); // re-render to restore label
              }
            };
            input.addEventListener('change', save);
            input.addEventListener('blur', save);
          });
        });

        // Click priority badge → show small inline picker (Low / Normal / High)
        const PRI_DEFS = [
          { p: 'low',    label: 'Low',    bg: '#DBEAFE', color: '#1D4ED8' },
          { p: 'normal', label: 'Normal', bg: '#FEF3C7', color: '#92400E' },
          { p: 'high',   label: 'High',   bg: '#FEE2E2', color: '#991B1B' },
        ];
        tasksEl.querySelectorAll('.sp-task-pri-badge').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close any existing picker
            tasksEl.querySelectorAll('.sp-pri-picker').forEach(p => p.remove());

            const taskId = el.dataset.taskId;
            const currentPri = el.dataset.pri || 'normal';

            const picker = document.createElement('div');
            picker.className = 'sp-pri-picker';
            picker.style.cssText = 'display:flex;gap:5px;padding:5px;background:#fff;border:1px solid #E0DDD8;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.12);position:absolute;z-index:999;margin-top:4px;';

            PRI_DEFS.forEach(({ p, label, bg, color }) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = label;
              const isActive = p === currentPri;
              btn.style.cssText = `font-size:10px;font-weight:700;padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit;border:1px solid ${isActive ? color : '#E0DDD8'};background:${isActive ? bg : '#fff'};color:${isActive ? color : '#9A9590'};`;
              btn.addEventListener('click', (e2) => {
                e2.stopPropagation();
                picker.remove();
                // Update badge in-place
                const pc = PRI_DEFS.find(d => d.p === p);
                el.dataset.pri = p;
                el.textContent = p;
                el.style.background = pc.bg;
                el.style.color = pc.color;
                el.style.borderColor = pc.color + '22';
                // Keep sp-task-click in sync
                const taskClick = el.closest('.sp-home-action-item')?.querySelector('.sp-task-click');
                if (taskClick) taskClick.dataset.taskPri = p;
                // Persist
                chrome.storage.local.get(['userTasks'], d => {
                  const allTasks = d.userTasks || [];
                  const task = allTasks.find(t => t.id === taskId);
                  if (task) { task.priority = p; chrome.storage.local.set({ userTasks: allTasks }); }
                });
              });
              picker.appendChild(btn);
            });

            // Position below the badge, anchored to viewport so it doesn't clip
            document.body.appendChild(picker);
            const rect = el.getBoundingClientRect();
            picker.style.position = 'fixed';
            // Align right edge of picker with right edge of badge, flip left if it would overflow
            const pickerW = 180;
            const left = Math.min(rect.right - pickerW, window.innerWidth - pickerW - 8);
            picker.style.left = Math.max(8, left) + 'px';
            picker.style.top = (rect.bottom + 4) + 'px';

            // Dismiss on outside click
            const dismiss = (e2) => {
              if (!picker.contains(e2.target) && e2.target !== el) {
                picker.remove();
                document.removeEventListener('click', dismiss);
              }
            };
            setTimeout(() => document.addEventListener('click', dismiss), 0);
          });
        });

        // Hover effects on task text (edit affordance)
        tasksEl.querySelectorAll('.sp-task-click').forEach(el => {
          el.addEventListener('mouseenter', () => { el.style.background = 'rgba(0,0,0,0.04)'; });
          el.addEventListener('mouseleave', () => { el.style.background = ''; });
        });

        // Hover effects on task rows
        tasksEl.querySelectorAll('.sp-home-action-item').forEach(row => {
          row.style.transition = 'background 0.15s';
          row.style.borderRadius = '6px';
          row.addEventListener('mouseenter', () => { row.style.background = '#F7F5F2'; });
          row.addEventListener('mouseleave', () => { row.style.background = row.classList.contains('sp-editing') ? '#F7F5F2' : ''; });
        });

        // Hover on date label only (it's still inline-editable)
        tasksEl.querySelectorAll('.sp-task-date-edit').forEach(el => {
          el.style.transition = 'opacity 0.15s';
          el.addEventListener('mouseenter', () => { el.style.opacity = '0.65'; });
          el.addEventListener('mouseleave', () => { el.style.opacity = ''; });
        });

        // Click task text → open inline edit form directly below the row
        tasksEl.querySelectorAll('.sp-task-click').forEach(el => {
          el.addEventListener('click', () => {
            const taskRow = el.closest('.sp-home-action-item');
            const taskId = el.dataset.taskId;

            // Close any open edit — immediately, no race
            const existing = tasksEl.querySelector('.sp-task-inline-edit');
            if (existing) {
              const wasThis = existing.dataset.forTask === taskId;
              existing.remove();
              tasksEl.querySelectorAll('.sp-home-action-item').forEach(r => r.classList.remove('sp-editing'));
              if (wasThis) return; // toggle off
            }

            taskRow.classList.add('sp-editing');
            let editPri = el.dataset.taskPri || 'normal';

            const renderPriBtns = (container, currentPri) => {
              const defs = [
                { p: 'low',    label: 'Low',    bg: '#DBEAFE', color: '#1D4ED8', border: '#93C5FD' },
                { p: 'normal', label: 'Normal', bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
                { p: 'high',   label: 'High',   bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5' },
              ];
              container.innerHTML = '';
              defs.forEach(({ p, label, bg, color, border }) => {
                const active = p === currentPri;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.pri = p;
                btn.textContent = label;
                btn.style.cssText = `flex:1;font-size:12px;font-weight:700;padding:8px 0;border-radius:7px;cursor:pointer;font-family:inherit;transition:all 0.12s;border:2px solid ${active ? border : '#E0DDD8'};background:${active ? bg : '#fff'};color:${active ? color : '#9A9590'};`;
                btn.addEventListener('click', () => {
                  editPri = p;
                  renderPriBtns(container, editPri);
                });
                container.appendChild(btn);
              });
            };

            const editDiv = document.createElement('div');
            editDiv.className = 'sp-task-inline-edit';
            editDiv.dataset.forTask = taskId;
            editDiv.style.cssText = 'padding:12px;background:#F2F0ED;border-top:1px solid #E0DDD8;border-bottom:1px solid #E0DDD8;display:flex;flex-direction:column;gap:10px;max-height:0;overflow:hidden;opacity:0;transition:max-height 0.2s ease,opacity 0.15s ease;';
            editDiv.innerHTML = `
              <input class="sp-inline-text" type="text" value="${(el.dataset.taskText||'').replace(/"/g,'&quot;')}" style="font-size:13px;padding:8px 10px;border:1px solid #E0DDD8;border-radius:6px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;background:#fff;">
              <div>
                <div style="font-size:10px;font-weight:700;color:#9A9590;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Priority</div>
                <div class="sp-inline-pri" style="display:flex;gap:6px;"></div>
              </div>
              <div>
                <div style="font-size:10px;font-weight:700;color:#9A9590;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Due date</div>
                <input class="sp-inline-date" type="date" value="${el.dataset.taskDate||''}" style="font-size:12px;padding:7px 10px;border:1px solid #E0DDD8;border-radius:6px;font-family:inherit;color:#3D3935;outline:none;width:100%;box-sizing:border-box;background:#fff;">
              </div>
              <div style="display:flex;gap:8px;">
                <button class="sp-inline-save" style="flex:1;font-size:12px;font-weight:700;color:#fff;background:#FF7A59;border:none;border-radius:7px;padding:9px;cursor:pointer;font-family:inherit;">Update</button>
                <button class="sp-inline-cancel" style="font-size:12px;font-weight:600;color:#6B6560;background:#E0DDD8;border:none;border-radius:7px;padding:9px 16px;cursor:pointer;font-family:inherit;">Cancel</button>
              </div>`;

            taskRow.insertAdjacentElement('afterend', editDiv);
            renderPriBtns(editDiv.querySelector('.sp-inline-pri'), editPri);
            requestAnimationFrame(() => { editDiv.style.maxHeight = '400px'; editDiv.style.opacity = '1'; });
            editDiv.querySelector('.sp-inline-text')?.focus();

            const closeEdit = () => {
              taskRow.classList.remove('sp-editing');
              editDiv.style.maxHeight = '0';
              editDiv.style.opacity = '0';
              setTimeout(() => editDiv.remove(), 180);
            };

            const saveEdit = () => {
              const text = editDiv.querySelector('.sp-inline-text')?.value?.trim();
              if (!text) return;
              const dueDate = editDiv.querySelector('.sp-inline-date')?.value || null;
              chrome.storage.local.get(['userTasks'], d => {
                const all = d.userTasks || [];
                const t = all.find(t => t.id === taskId);
                if (t) Object.assign(t, { text, dueDate, priority: editPri });
                chrome.storage.local.set({ userTasks: all }, () => renderHomeState());
              });
            };

            editDiv.querySelector('.sp-inline-save')?.addEventListener('click', saveEdit);
            editDiv.querySelector('.sp-inline-cancel')?.addEventListener('click', closeEdit);
            editDiv.querySelector('.sp-inline-text')?.addEventListener('keydown', e => {
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') closeEdit();
            });
          });
        });
      }
    });

    // Pipeline snapshot — removed, available in full-screen CRM view
    document.getElementById('sp-home-pipeline').innerHTML = '';

    // Search
    const searchInput = document.getElementById('sp-home-search');
    const resultsEl = document.getElementById('sp-home-results');
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      if (!q || q.length < 2) { resultsEl.style.display = 'none'; return; }
      const matches = companies.filter(c =>
        c.company?.toLowerCase().includes(q) ||
        (c.jobTitle || '').toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      ).slice(0, 8);
      if (!matches.length) { resultsEl.style.display = 'none'; return; }
      resultsEl.style.display = '';
      resultsEl.innerHTML = matches.map(c => `
        <div class="sp-home-search-result" data-id="${c.id}">
          <div class="sp-home-search-result-name">${c.company}</div>
          <div class="sp-home-search-result-role">${c.jobTitle || c.status || ''}</div>
        </div>
      `).join('');
      resultsEl.querySelectorAll('.sp-home-search-result').forEach(el => {
        el.addEventListener('click', () => { coopNavigate(chrome.runtime.getURL('company.html?id=' + el.dataset.id), true); });
      });
    });
  });
}

async function triggerResearch(company, forceRefresh = false) {
  if (!company || company === '—') {
    contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
    return;
  }

  // Show save button — mark as already saved if this company exists
  showSaveBar();
  await checkAlreadySaved(company);

  // Show job meta immediately from DOM badges (no API wait needed)
  if (currentJobMeta && currentJobTitle) {
    renderJobSnapshot(currentJobMeta);
  }

  // If saved data was already loaded by checkAlreadySaved, skip API calls
  if (currentResearch && !forceRefresh) {
    console.log('[SP] Using saved research data — skipping API calls');
    return;
  }

  // Check if auto-research is enabled in pipeline config
  const { pipelineConfig: pc } = await new Promise(r => chrome.storage.local.get(['pipelineConfig'], r));
  const autoResearch = pc?.scoring?.autoResearch || false;

  if (!forceRefresh && !autoResearch) {
    console.log('[SP] Skipping auto-research — user must click Research button');
    // Show what we have (cached data, LinkedIn firmographics, or empty state with research button)
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const cacheKey = company.toLowerCase().replace(/[,;:!?.]+$/, '').trim();
      const cached = researchCache?.[cacheKey];
      if (cached) {
        currentResearch = cached.data;
        renderResults(cached.data);
      } else if (detectedLinkedinFirmo) {
        // Show LinkedIn firmographics as a lightweight overview
        renderQuickData({
          employees: detectedLinkedinFirmo.employees,
          industry: detectedLinkedinFirmo.industry,
        });
      }
      // Always show the research button. If nothing has rendered content into
      // contentEl yet (no cached result, no saved-entry research, no
      // LinkedIn firmographics), replace the default "Navigate to..." empty
      // state with a clean placeholder so the button doesn't sit below stale
      // empty-state text. See backlog #7.
      const loader = document.getElementById('research-loader');
      if (loader) loader.remove();
      const staleEmpty = contentEl.querySelector(':scope > .empty');
      const hasRenderedContent = contentEl.querySelector('.section, .stat-grid, .one-liner');
      if (staleEmpty && !hasRenderedContent) {
        const placeholder = cached
          ? '' // cached render handles its own content
          : `<div class="empty" style="padding:24px 16px;text-align:center;color:#7c98b6;">
              <div style="font-size:13px;margin-bottom:4px;">No research yet for <strong>${company}</strong></div>
              <div style="font-size:11px;opacity:0.75;">Click below to fetch firmographics, leadership, reviews, and open roles.</div>
            </div>`;
        contentEl.innerHTML = placeholder;
      }
      const existingBtn = document.getElementById('sp-research-btn');
      if (!existingBtn) {
        const btn = document.createElement('button');
        btn.id = 'sp-research-btn';
        btn.className = 'sp-chat-launch-btn';
        btn.style.cssText = 'margin:12px 0;width:100%';
        btn.innerHTML = cached ? '↻ Refresh research' : '&#128270; Research this company';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;animation:spin 1.5s ease-in-out infinite"><circle cx="50" cy="50" r="50" fill="#3B5068"/><ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="41.5" cy="44.2" r="2.5" fill="#5B8C3E"/><ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="59.5" cy="44.2" r="2.5" fill="#5B8C3E"/></svg> Researching...</span>';
          btn.style.opacity = '0.7';
          triggerResearch(company, true);
        });
        contentEl.appendChild(btn);
      }
    });
    return;
  }

  // Phase-based loading UI — visible, informative, and slick
  renderResearchPhases(company);

  chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
    loadPrefsWithMigration((prefs) => {
    void chrome.runtime.lastError;
    currentPrefs = prefs || currentPrefs;

    // On force refresh, wipe the cache entry so background doesn't serve stale data
    if (forceRefresh && researchCache?.[company.toLowerCase()]) {
      const pruned = { ...researchCache };
      delete pruned[company.toLowerCase()];
      chrome.storage.local.set({ researchCache: pruned });
    }

    // If we have a cached result, render immediately — skip all API calls
    const cacheKey = company.toLowerCase();
    const cached = researchCache?.[cacheKey];
    if (!forceRefresh && cached) {
      currentResearch = cached.data;
      renderResults(cached.data);
      if (cached.data.leaders?.length > 0) {
        const toFetch = cached.data.leaders.slice(0, 4);
        chrome.runtime.sendMessage({ type: 'GET_LEADER_PHOTOS', leaders: toFetch, company }, (photos) => {
          void chrome.runtime.lastError;
          if (!photos) return;
          photos.forEach((url, i) => {
            if (!url) return;
            const el = document.getElementById(`leader-avatar-${i}`);
            if (!el) return;
            const img = document.createElement('img');
            img.className = 'leader-avatar';
            img.onerror = () => { img.style.display = 'none'; };
            img.src = url;
            el.replaceWith(img);
          });
        });
      }
      return;
    }

    // Derive a usable domain — LinkedIn pages have domain=null but may have a LinkedIn company URL
    const enrichDomain = (detectedDomain && !/linkedin\.com/i.test(detectedDomain)) ? detectedDomain : null;

    // Phase 1: Apollo quick lookup — renders stats while Claude runs
    chrome.runtime.sendMessage(
      { type: 'QUICK_LOOKUP', company, domain: enrichDomain, companyLinkedin: detectedCompanyLinkedin, linkedinFirmo: detectedLinkedinFirmo },
      (quick) => {
        void chrome.runtime.lastError;
        // Advance the phase loader to "Scanning leaders & reviews" regardless of
        // whether quick-lookup returned data — the firmographics phase is done.
        try { window.__researchPhases?.advance(1); } catch (_) {}
        if (quick && (quick.employees || quick.funding || quick.companyWebsite)) {
          if (quick.companyWebsite) setFavicon(quick.companyWebsite);
          renderQuickData(quick);
        }
      }
    );

    // Phase 2: Full research — fills in the rest when ready
    chrome.runtime.sendMessage(
      { type: 'RESEARCH_COMPANY', company, domain: enrichDomain, companyLinkedin: detectedCompanyLinkedin, linkedinFirmo: detectedLinkedinFirmo, prefs: prefs || null },
      (response) => {
        void chrome.runtime.lastError;
        // Close out the phase loader — research is done (success or error)
        try { window.__researchPhases?.finish(); window.__researchPhases?.stop(); } catch (_) {}
        if (!response || response.error) {
          contentEl.innerHTML = '<div class="error">' + (response?.error || 'Something went wrong') + '</div>';
          return;
        }
        currentResearch = response;
        renderResults(response);
        backfillEntryFromResearch(currentSavedEntry, response);

        // Write research data back to saved entry if missing
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          void chrome.runtime.lastError;
          const entries = savedCompanies || [];
          const idx = entries.findIndex(c => companiesMatch(c.company, company));
          if (idx !== -1) {
            let changed = false;
            const validLinkedin = url => url && !url.includes('/company/unavailable');
            const linkedinFromUrl = /linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null;
            const bestLinkedin = validLinkedin(response.companyLinkedin) ? response.companyLinkedin : (linkedinFromUrl || null);
            if (!entries[idx].companyWebsite && response.companyWebsite) { entries[idx].companyWebsite = response.companyWebsite; changed = true; }
            if ((!entries[idx].companyLinkedin || !validLinkedin(entries[idx].companyLinkedin)) && bestLinkedin) { entries[idx].companyLinkedin = bestLinkedin; changed = true; }
            if (response.jobListings?.length)  { entries[idx].jobListings  = response.jobListings;  changed = true; }
            if (response.leaders?.length)      { entries[idx].leaders      = response.leaders;      changed = true; }
            if (response.intelligence)         { entries[idx].intelligence = response.intelligence; changed = true; }
            if (!entries[idx].employees && response.employees) { entries[idx].employees = response.employees; changed = true; }
            if (!entries[idx].funding && response.funding)     { entries[idx].funding   = response.funding;   changed = true; }
            if (!entries[idx].industry && response.industry)   { entries[idx].industry  = response.industry;  changed = true; }
            if (changed) chrome.storage.local.set({ savedCompanies: entries }, () => void chrome.runtime.lastError);
          }
        });

        // Load leader photos asynchronously after render
        if (response.leaders && response.leaders.length > 0) {
          const toFetch = response.leaders.slice(0, 4);
          chrome.runtime.sendMessage(
            { type: 'GET_LEADER_PHOTOS', leaders: toFetch, company },
            (photos) => {
              void chrome.runtime.lastError;
              if (!photos) return;
              photos.forEach((url, i) => {
                if (!url) return;
                const el = document.getElementById(`leader-avatar-${i}`);
                if (!el) return;
                const img = document.createElement('img');
                img.className = 'leader-avatar';
                img.onerror = () => { img.style.display = 'none'; };
                img.src = url;
                el.replaceWith(img);
              });
            }
          );
        }
      }
    );
    }); // loadPrefsWithMigration
  }); // local.get researchCache
}

function updateJobTitleBar() {
  const jobBar = document.getElementById('job-bar');
  const titleEl = document.getElementById('job-title-bar');
  const jobContent = document.getElementById('job-content');
  const jobChevron = document.getElementById('job-chevron');
  if (!jobBar || !titleEl) return;
  if (currentJobTitle) {
    titleEl.textContent = currentJobTitle;
    jobBar.style.display = 'flex';
    if (jobContent) jobContent.style.display = 'block';
    if (jobChevron) jobChevron.classList.add('open');
    // Hide Save Job Posting button when queue buttons are visible
    const qPanel = document.getElementById('queue-save-panel');
    if (qPanel && (qPanel.style.display === 'block' || qPanel.style.display === '')) {
      saveJobBtn.style.display = 'none';
    }
    // Check if this company already has a saved opportunity (any role)
    if (currentSavedEntry?.isOpportunity) {
      saveJobBtn.textContent = '✓ Saved';
      saveJobBtn.classList.add('saved');
    } else {
      saveJobBtn.classList.remove('saved');
      saveJobBtn.textContent = '+ Save Job Posting';
      // Also check storage in case currentSavedEntry hasn't been set yet
      const company = companyNameEl?.textContent;
      if (company) {
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          const dup = (savedCompanies || []).find(
            c => c.isOpportunity && companiesMatch(c.company, company)
          );
          if (dup) { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
        });
      }
    }
  } else {
    jobBar.style.display = 'none';
    if (jobContent) jobContent.style.display = 'none';
  }
}

const JOB_STATUSES = {
  needs_review: "Coop's AI Scoring Queue",
  want_to_apply: 'I Want to Apply',
  applied: 'Applied',
  intro_requested: 'Intro Requested',
  conversations: 'Conversations in Progress',
  offer_stage: 'Offer Stage',
  accepted: 'Accepted',
  rejected: "Rejected / DQ'd"
};

const COMPANY_STATUSES = {
  co_watchlist:   'Watch List',
  co_researching: 'Researching',
  co_networking:  'Networking',
  co_interested:  'Strong Interest',
  co_applied:     'Applied There',
  co_archived:    'Archived',
};

function renderOppFields(savedEntry) {
  const el = document.getElementById('sp-opp-fields');
  if (!el) return;
  if (!savedEntry) { el.style.display = 'none'; return; }

  // Load custom stages from storage for accurate dropdowns
  chrome.storage.local.get(['opportunityStages', 'companyStages', 'customStages'], data => {
    void chrome.runtime.lastError;
    const oppStages = data.opportunityStages || data.customStages || Object.entries(JOB_STATUSES).map(([key, label]) => ({ key, label }));
    const coStages = data.companyStages || Object.entries(COMPANY_STATUSES).map(([key, label]) => ({ key, label }));

    // Only show stage dropdowns and next step — other fields are in Company Overview below
    const fields = [];

    // Opportunity stage dropdown (most important — show first)
    if (savedEntry.isOpportunity) {
      const oppOptions = oppStages.map(s =>
        `<option value="${s.key}" ${(savedEntry.jobStage || 'needs_review') === s.key ? 'selected' : ''}>${s.label}</option>`
      ).join('');
      fields.push(['Stage', `<select class="sp-stage-select sp-stage-opp" id="sp-opp-stage">${oppOptions}</select>`]);
    }

    // Company stage dropdown — only show if NOT an opportunity (opportunity stage is primary)
    if (!savedEntry.isOpportunity) {
      const coOptions = coStages.map(s =>
        `<option value="${s.key}" ${(savedEntry.status || 'co_watchlist') === s.key ? 'selected' : ''}>${s.label}</option>`
      ).join('');
      fields.push(['Company', `<select class="sp-stage-select" id="sp-co-stage">${coOptions}</select>`]);
    }

    // Action On dropdown
    const actionOpts = '<option value="my_court"' + ((savedEntry.actionStatus || 'my_court') === 'my_court' ? ' selected' : '') + '>🏀 My Court</option><option value="their_court"' + (savedEntry.actionStatus === 'their_court' ? ' selected' : '') + '>⏳ Their Court</option><option value="scheduled"' + (savedEntry.actionStatus === 'scheduled' ? ' selected' : '') + '>📅 Scheduled</option>';
    fields.push(['Action On', `<select class="sp-stage-select" id="sp-action-status">${actionOpts}</select>`]);

    if (savedEntry.nextStep) fields.push(['Next Step', savedEntry.nextStep]);

    if (!fields.length) { el.style.display = 'none'; return; }

    el.innerHTML = fields.map(([k, v]) =>
      `<div class="sp-opp-row"><span class="sp-opp-key">${k}</span><span class="sp-opp-val">${v}</span></div>`
    ).join('') + `<div class="sp-notes-row">
      <textarea class="sp-notes-input" id="sp-notes-input" placeholder="Add notes...">${savedEntry.notes || ''}</textarea>
    </div>`;
    el.style.display = 'block';

    // Bind stage change handlers
    const updateEntry = (changes) => {
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const entries = savedCompanies || [];
        const idx = entries.findIndex(c => c.id === savedEntry.id);
        if (idx === -1) return;
        Object.assign(entries[idx], changes);
        Object.assign(savedEntry, changes);
        if (currentSavedEntry?.id === savedEntry.id) Object.assign(currentSavedEntry, changes);
        chrome.storage.local.set({ savedCompanies: entries });
      });
    };

    const coSelect = el.querySelector('#sp-co-stage');
    if (coSelect) {
      coSelect.addEventListener('change', () => {
        updateEntry({ status: coSelect.value });
        coSelect.style.animation = 'sp-stage-flash 0.4s ease';
        setTimeout(() => coSelect.style.animation = '', 400);
        setTimeout(() => showPipelineStats(), 300);
      });
    }

    const oppSelect = el.querySelector('#sp-opp-stage');
    if (oppSelect) {
      oppSelect.addEventListener('change', () => {
        const ts = { ...(savedEntry.stageTimestamps || {}) };
        if (!ts[oppSelect.value]) ts[oppSelect.value] = Date.now();
        const stageChanges = { jobStage: oppSelect.value, stageTimestamps: ts };
        applyAutoStage(savedEntry, oppSelect.value, stageChanges);
        // Auto-seed applied date
        if (oppSelect.value === 'applied' && !savedEntry.appliedDate) stageChanges.appliedDate = Date.now();
        updateEntry(stageChanges);
        // Update Action On dropdown if visible
        const actionSel = el.querySelector('#sp-action-status');
        if (actionSel && stageChanges.actionStatus) actionSel.value = stageChanges.actionStatus;
        oppSelect.style.animation = 'sp-stage-flash 0.4s ease';
        setTimeout(() => oppSelect.style.animation = '', 400);
        // Update the header stage text
        const stageEl = document.getElementById('crm-stage');
        if (stageEl) {
          const label = oppStages.find(s => s.key === oppSelect.value)?.label || oppSelect.value;
          stageEl.textContent = label;
        }
        // Fire celebration
        _spFireCelebration(oppSelect.value);
        // Refresh stats
        setTimeout(() => showPipelineStats(), 300);
      });
    }

    // Notes
    const actionSelect = el.querySelector('#sp-action-status');
    if (actionSelect) {
      actionSelect.addEventListener('change', () => {
        updateEntry({ actionStatus: actionSelect.value });
      });
    }

    const notesInput = el.querySelector('#sp-notes-input');
    if (notesInput) {
      notesInput.addEventListener('blur', () => {
        updateEntry({ notes: notesInput.value.trim() || null });
      });
    }
  });
}

function showCrmLink(savedEntry) {
  const crmLink = document.getElementById('crm-link');
  if (!crmLink || !savedEntry) return;
  const focusParam = savedEntry.isOpportunity ? '&focus=opportunity' : '';
  crmLink.href = chrome.runtime.getURL(`company.html?id=${savedEntry.id}${focusParam}`);
  crmLink.style.display = 'inline';
  crmLink.onclick = () => window.close();
  // Stage is now shown as dropdown in sp-opp-fields — hide the header text
  const stageEl = document.getElementById('crm-stage');
  if (stageEl) stageEl.style.display = 'none';
  renderOppFields(savedEntry);
  showPipelineStats();
}

function showSaveBar() {
  saveBtn.textContent = '+ Save Company';
  saveBtn.classList.remove('saved');
  savePanel.classList.remove('visible');
  saveConfirmBtn.classList.remove('saved');
  const crmLink = document.getElementById('crm-link');
  if (crmLink) crmLink.style.display = 'none';
  const stageEl = document.getElementById('crm-stage');
  if (stageEl) stageEl.style.display = 'none';
  const oppFields = document.getElementById('sp-opp-fields');
  if (oppFields) oppFields.style.display = 'none';

  // Show queue buttons when job is detected, hide Save Company
  const queuePanel = document.getElementById('queue-save-panel');
  const queueConfirm = document.getElementById('queue-save-confirm');
  if (currentJobTitle) {
    saveBtn.style.display = 'none';
    saveJobBtn.style.display = 'none';
    if (queuePanel) queuePanel.style.display = 'block';
    if (queueConfirm) queueConfirm.style.display = 'none';
    // Reset queue button states
    const qBtn = document.getElementById('save-queue-btn');
    const rBtn = document.getElementById('save-research-btn');
    if (qBtn) { qBtn.disabled = false; qBtn.textContent = 'Send to Coop'; }
    if (rBtn) { rBtn.disabled = false; rBtn.textContent = 'Save + research now'; }
  } else {
    saveBtn.style.display = '';
    if (queuePanel) queuePanel.style.display = 'none';
    if (queueConfirm) queueConfirm.style.display = 'none';
  }
}

function checkAlreadySaved(company) {
  return new Promise(resolve => {
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const entries = savedCompanies || [];
    // Prefer the opportunity over the bare company entry — opportunities carry richer
    // context (jobMatch, jobDescription, stage history). Fall back to the company entry
    // if no opportunity exists for this company name.
    const allMatches = entries.filter(c => companiesMatch(c.company, company));
    const oppMatch = allMatches.find(c => c.isOpportunity);
    const match = oppMatch || allMatches[0];
    if (match) {
      currentSavedEntry = match;
      // Auto-bind Coop to this entry so chat pulls full context (meetings, emails,
      // transcripts) without requiring the user to click the 📎 Bind button. Manual
      // binds always win — if the user has explicitly bound something, leave it alone.
      try {
        const cur = window.__coopBind?.get?.() || { id: null, auto: false };
        if (!cur.id || cur.auto) {
          window.__coopBind?.set?.(match.id, { auto: true });
        }
      } catch (e) {}
      // Fix company name if detected as "Unknown Company" but saved entry has real name
      if ((!company || company === 'Unknown Company') && match.company) {
        companyNameEl.textContent = match.company;
      }
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('saved');
      // Also mark queue buttons as saved if job detected
      if (currentJobTitle && match.isOpportunity) {
        const queuePanel = document.getElementById('queue-save-panel');
        if (queuePanel) queuePanel.style.display = 'none';
        const qBtn = document.getElementById('save-queue-btn');
        const rBtn = document.getElementById('save-research-btn');
        if (qBtn) { qBtn.disabled = true; qBtn.textContent = 'Saved'; }
        if (rBtn) { rBtn.disabled = true; rBtn.textContent = 'Saved'; }
      }
      showCrmLink(match);

      // Clear stale "Navigate to..." empty state — we've found a saved entry
      const _staleEmpty = contentEl.querySelector(':scope > .empty');
      if (_staleEmpty && _staleEmpty.textContent.includes('Navigate to')) {
        _staleEmpty.remove();
      }

      // Use saved research data instead of re-fetching from API.
      // Gate is intentionally loose: any of these fields is enough to render
      // something more useful than the default "Navigate to..." empty state.
      // Previously we only rendered on intelligence/employees/industry which
      // left the empty text visible on entries saved from LinkedIn with only
      // website + leaders populated — see backlog #7.
      if (match.intelligence || match.employees || match.industry || match.companyWebsite ||
          (match.leaders && match.leaders.length) || (match.reviews && match.reviews.length) ||
          (match.jobListings && match.jobListings.length) || match.companyLinkedin) {
        const savedResearch = {
          intelligence: match.intelligence,
          employees: match.employees,
          funding: match.funding,
          founded: match.founded,
          industry: match.industry,
          companyWebsite: match.companyWebsite,
          companyLinkedin: match.companyLinkedin,
          reviews: match.reviews || [],
          leaders: match.leaders || [],
          jobListings: match.jobListings || [],
          jobMatch: match.jobMatch,
          jobSnapshot: match.jobSnapshot,
          enrichmentSource: 'Saved data',
        };
        currentResearch = savedResearch;
        if (match.companyWebsite) setFavicon(match.companyWebsite);
        renderResults(savedResearch);
        // Render existing job match in the job opportunity section
        if (match.jobMatch) {
          renderJobOpportunity(match.jobMatch, match.jobSnapshot || currentJobMeta || null);
        }
      }

      // Auto-tag with 'Job Posted' when viewing from a job page
      if (currentJobTitle && !(match.tags || []).includes('Job Posted')) {
        match.tags = [...(match.tags || []), 'Job Posted'];
        currentSavedEntry = match;
        const updated = entries.map(c => companiesMatch(c.company, match.company) ? match : c);
        chrome.storage.local.set({ savedCompanies: updated }, () => void chrome.runtime.lastError);
      }
      // Refresh contacts section if renderResults already ran
      const contactsSection = document.getElementById('sp-contacts-section');
      if (contactsSection) renderContactsSection(contactsSection, match.knownContacts || []);
      // Auto-sync contacts in background if cache is stale (>4 hours)
      const SYNC_INTERVAL = 4 * 60 * 60 * 1000;
      if (!match.cachedEmailsAt || Date.now() - match.cachedEmailsAt > SYNC_INTERVAL) {
        syncContactsForEntry(match);
      }
    }
    // Show/hide manual link panel
    const manualLinkPanel = document.getElementById('manual-link-panel');
    if (manualLinkPanel) {
      manualLinkPanel.style.display = match ? 'none' : 'block';
    }
    resolve();
  });
  });
}

// ── Manual link to saved opportunity ────────────────────────────────────────
(function initManualLink() {
  const toggle = document.getElementById('manual-link-toggle');
  const searchBox = document.getElementById('manual-link-search');
  const input = document.getElementById('manual-link-input');
  const results = document.getElementById('manual-link-results');
  if (!toggle || !searchBox || !input || !results) return;

  toggle.addEventListener('click', () => {
    const open = searchBox.style.display !== 'none';
    searchBox.style.display = open ? 'none' : 'block';
    if (!open) { input.focus(); input.value = ''; renderLinkResults(''); }
  });

  function renderLinkResults(query) {
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const entries = (savedCompanies || []).filter(c => c.company);
      const q = query.toLowerCase().trim();
      const filtered = q
        ? entries.filter(c => c.company.toLowerCase().includes(q) || (c.jobTitle || '').toLowerCase().includes(q))
        : entries.slice(0, 15);
      if (!filtered.length) {
        results.innerHTML = `<div style="font-size:12px;color:#A09A94;padding:8px 0;">No matches</div>`;
        return;
      }
      results.innerHTML = filtered.slice(0, 15).map(c => {
        const stage = (c.jobStage || 'saved').replace(/_/g, ' ');
        return `<div class="manual-link-result" data-id="${c.id}">
          <div style="flex:1;min-width:0;">
            <div class="mlr-name">${c.company}</div>
            ${c.jobTitle ? `<div class="mlr-title">${c.jobTitle}</div>` : ''}
          </div>
          <span class="mlr-stage">${stage}</span>
        </div>`;
      }).join('');
    });
  }

  input.addEventListener('input', () => renderLinkResults(input.value));

  results.addEventListener('click', (e) => {
    const row = e.target.closest('.manual-link-result');
    if (!row) return;
    const id = row.dataset.id;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const entries = savedCompanies || [];
      const match = entries.find(c => c.id === id);
      if (!match) return;
      // Persist manual association — survives page navigation
      _manualLinkId = match.id;
      // Update the detected company name to the saved entry's name
      companyNameEl.textContent = match.company;
      // Set job context from the saved entry so Coop and job opportunity section work
      if (match.jobTitle) {
        currentJobTitle = match.jobTitle;
        currentJobMeta = match.jobSnapshot || null;
      }
      // Hide the link panel and re-run the saved check
      const panel = document.getElementById('manual-link-panel');
      if (panel) panel.style.display = 'none';
      const searchPanel = document.getElementById('manual-link-search');
      if (searchPanel) searchPanel.style.display = 'none';
      // Re-trigger the full saved-entry flow
      checkAlreadySaved(match.company);
      showSaveBar(match.company, currentJobTitle);
      // Re-render chat empty state with opportunity-aware suggestions
      const chatMsgs = document.getElementById('sp-chat-messages');
      if (chatMsgs && chatMsgs.querySelector('.sp-chat-empty')) {
        // Force re-render of suggestions by dispatching a custom event
        chatMsgs.dispatchEvent(new CustomEvent('context-updated'));
      }
    });
  });
})();

// ── Rejection email detection (regex-only, zero AI cost) ─────────────────────
function detectRejectionEmail(emails, entry) {
  if (!emails?.length) return null;

  const REJECTION_PHRASES = [
    /we(?:'ve| have) decided to (?:move|go) forward with (?:other|another|different) candidate/i,
    /(?:unfortunately|regretfully),?\s*we (?:will not|won't|are unable to|cannot) (?:be )?(?:move|moving|proceed|proceeding) forward/i,
    /(?:unfortunately|regretfully),?\s*(?:we|the team|I) (?:have|has) decided (?:not )?to (?:not )?(?:move|proceed|continue)/i,
    /(?:the )?position has been filled/i,
    /after careful (?:consideration|review|deliberation).*?(?:not|won't|unable).*?(?:move|moving|proceed|offer)/i,
    /we(?:'re| are) not (?:able to )?(?:move|moving|proceed) forward with your (?:application|candidacy)/i,
    /(?:we|I) (?:regret|am sorry|are sorry) to inform you/i,
    /your (?:application|candidacy) (?:was|has been) (?:not selected|unsuccessful|rejected)/i,
    /we(?:'ve| have) (?:chosen|selected|decided on) (?:a |an )?(?:other|another|different) candidate/i,
    /(?:not|won't) be (?:extending|making) (?:you )?an offer/i,
    /decided to (?:pursue|explore) other (?:candidates|directions|options)/i,
    /will not be (?:advancing|continuing) (?:your|with your)/i,
    /your (?:profile|background|experience) (?:does not|doesn't|did not|didn't) (?:align|match|fit)/i,
    /we (?:appreciate|thank) (?:you|your).*?(?:but|however).*?(?:not|won't|unable).*?(?:forward|proceed|offer)/i,
  ];

  // Only check emails from the last 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Skip if already tagged as rejected
  if ((entry.tags || []).includes('Application Rejected')) return null;

  for (const email of emails) {
    // Parse date
    const emailDate = email.date ? new Date(email.date).getTime() : 0;
    if (emailDate && emailDate < cutoff) continue;

    // Check subject + snippet + body (first 800 chars)
    const textToCheck = [email.subject || '', email.snippet || '', (email.body || '').slice(0, 800)].join(' ');

    for (const pattern of REJECTION_PHRASES) {
      if (pattern.test(textToCheck)) {
        return {
          subject: email.subject,
          from: email.from,
          date: email.date,
          snippet: email.snippet,
          matchedPhrase: textToCheck.match(pattern)?.[0] || ''
        };
      }
    }
  }
  return null;
}

// Silently fetch emails and update knownContacts for a saved entry
function syncContactsForEntry(savedEntry) {
  const domain = (savedEntry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!domain) return;
  const linkedinSlug = (savedEntry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  const knownContactEmails = (savedEntry.knownContacts || []).map(c => c.email);
  chrome.runtime.sendMessage(
    { type: 'GMAIL_FETCH_EMAILS', domain, companyName: savedEntry.company || '', linkedinSlug, knownContactEmails },
    result => {
      void chrome.runtime.lastError;
      if (!result?.emails?.length) return;
      const userEmail = (result.userEmail || '').toLowerCase();
      if (userEmail) chrome.storage.local.set({ gmailUserEmail: userEmail });

      const parseAddrs = field => {
        if (!field) return [];
        return field.split(/,\s*/).map(addr => {
          const m = addr.match(/^(.*?)\s*<([^>]+)>$/) || [null, '', addr.trim()];
          return { name: (m[1] || '').replace(/^["']+|["']+$/g, '').trim(), email: (m[2] || '').trim().toLowerCase() };
        }).filter(a => a.email.includes('@'));
      };

      // Detect user's own email by most frequent non-domain from: address
      const fromFreq = {};
      result.emails.forEach(e => {
        parseAddrs(e.from).forEach(({ email }) => {
          if (domain && email.endsWith('@' + domain)) return;
          fromFreq[email] = (fromFreq[email] || 0) + 1;
        });
      });
      const selfEmail = userEmail ||
        Object.entries(fromFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

      let current = (savedEntry.knownContacts || []).map(c => ({ ...c, aliases: c.aliases ? [...c.aliases] : [] }));
      if (selfEmail) current = current.filter(c => c.email.toLowerCase() !== selfEmail);
      // Respect user's explicitly removed contacts
      const blocked = new Set((savedEntry.removedContacts || []).map(e => e.toLowerCase()));

      const existing = new Set(current.map(c => c.email.toLowerCase()));
      const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';
      const namesMatch = (a, b) => {
        const words = s => s.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const wa = words(a), wb = words(b);
        return wa.length >= 2 && wb.length >= 2 && wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
      };
      result.emails.forEach(e => {
        const all = [...parseAddrs(e.from), ...parseAddrs(e.to), ...parseAddrs(e.cc)];
        const hasCompany = all.some(a => {
          const d = (a.email.split('@')[1] || '').toLowerCase();
          return d === domain || (baseDomain && d.split('.')[0] === baseDomain);
        });
        if (!hasCompany) return;
        all.forEach(({ name, email }) => {
          if (!email || (selfEmail && email === selfEmail) || existing.has(email) || blocked.has(email.toLowerCase())) return;
          existing.add(email);
          // Classify why this email was matched, for traceability
          const emailDomain = (email.split('@')[1] || '').toLowerCase();
          let matchedVia;
          if (emailDomain === domain) {
            matchedVia = { type: 'email-domain', detail: `Email participant on @${domain}` };
          } else if (baseDomain && emailDomain.split('.')[0] === baseDomain) {
            matchedVia = { type: 'email-sibling-domain', detail: `Email participant on sibling domain @${emailDomain} (base name matches @${domain})` };
          } else {
            matchedVia = { type: 'email-sender', detail: `Gmail thread matched by company name "${savedEntry.company}"` };
          }
          // Merge into existing contact if same name, otherwise add new
          const match = name && name.split(/\s+/).length >= 2
            ? current.find(c => namesMatch(c.name, name)) : null;
          if (match) {
            match.aliases.push(email);
          } else {
            current.push({ name: name || email.split('@')[0], email, aliases: [], source: 'email', detectedAt: Date.now(), matchedVia });
          }
        });
      });

      const cacheUpdates = { cachedEmails: result.emails, cachedEmailsAt: Date.now() };
      if (result.userEmail) cacheUpdates.gmailUserEmail = result.userEmail;

      const origLen = (savedEntry.knownContacts || []).length;
      const contactsChanged = current.length !== origLen ||
        current.some((c, i) => (c.aliases || []).length !== ((savedEntry.knownContacts || [])[i]?.aliases || []).length);
      if (contactsChanged) cacheUpdates.knownContacts = current;

      // Persist updates to storage
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        void chrome.runtime.lastError;
        const all = savedCompanies || [];
        const idx = all.findIndex(c => c.id === savedEntry.id);
        if (idx === -1) return;
        all[idx] = { ...all[idx], ...cacheUpdates };
        currentSavedEntry = all[idx];

        // ── Rejection detection ──────────────────────────────────────────
        const activeStages = ['applied', 'co_applied', 'interviewing', 'phone_screen', 'interview', 'final_round', 'want_to_apply'];
        const entryStage = all[idx].jobStage || all[idx].status || '';
        if (activeStages.includes(entryStage)) {
          const rejection = detectRejectionEmail(result.emails, all[idx]);
          if (rejection) {
            console.log(`[Rejection] Detected for ${all[idx].company}: "${rejection.subject}" — ${rejection.matchedPhrase}`);
            all[idx].jobStage = 'rejected';
            all[idx].status = 'closed';
            const tags = all[idx].tags || [];
            if (!tags.includes('Application Rejected')) tags.push('Application Rejected');
            all[idx].tags = tags;
            all[idx].rejectedAt = Date.now();
            all[idx].rejectionEmail = { subject: rejection.subject, from: rejection.from, date: rejection.date, snippet: rejection.snippet };
            if (!all[idx].stageTimestamps) all[idx].stageTimestamps = {};
            all[idx].stageTimestamps.rejected = Date.now();
            currentSavedEntry = all[idx];
          }
        }

        chrome.storage.local.set({ savedCompanies: all }, () => {
          void chrome.runtime.lastError;
          // Re-render contacts section if visible
          if (contactsChanged) {
            const contactsSection = document.getElementById('sp-contacts-section');
            if (contactsSection) renderContactsSection(contactsSection, all[idx].knownContacts || []);
          }
        });
      });
    }
  );
}

function renderJobSnapshot(snap) {
  const inlineEl = document.getElementById('job-snapshot-inline');
  if (!inlineEl || !snap) return;
  const arrClass = snap.workArrangement === 'Remote' ? 'remote' : snap.workArrangement === 'Hybrid' ? 'hybrid' : snap.workArrangement === 'On-site' ? 'onsite' : '';
  const arrIcon = snap.workArrangement === 'Remote' ? '🌐' : snap.workArrangement === 'Hybrid' ? '🏠' : snap.workArrangement === 'On-site' ? '🏢' : '';
  const bits = [];
  if (snap.salary) bits.push(`<span class="job-snap-item salary"><span class="job-snap-icon">💰</span>${snap.salary}${snap.salaryType === 'ote' ? ' OTE' : ''}</span>`);
  if (snap.workArrangement) bits.push(`<span class="job-snap-item ${arrClass}"><span class="job-snap-icon">${arrIcon}</span>${snap.workArrangement}${snap.location ? ' · ' + snap.location : ''}</span>`);
  if (snap.employmentType) bits.push(`<span class="job-snap-item type"><span class="job-snap-icon">🕐</span>${snap.employmentType}</span>`);
  (snap.perks || []).forEach(p => bits.push(`<span class="job-snap-item perk"><span class="job-snap-icon">🎁</span>${p}</span>`));
  inlineEl.innerHTML = bits.join('');
}

// triggerJobAnalysis removed — all scoring now goes through SCORE_OPPORTUNITY (scoreOpportunity)

function renderJobOpportunity(jobMatch, jobSnapshot) {
  const jobOpportunityEl = document.getElementById('job-opportunity');
  if (!jobOpportunityEl) return;
  // Fall back to saved entry's job title if content script didn't detect one
  if (!currentJobTitle && currentSavedEntry?.jobTitle) {
    currentJobTitle = currentSavedEntry.jobTitle;
  }
  if (!currentJobTitle) return;

  // scoreToVerdict — provided by ui-utils.js

  // LinkedIn chips are authoritative for work arrangement — AI snapshot can misinterpret territory mentions as "On-site"
  const jobArr = currentJobMeta?.workArrangement || jobSnapshot?.workArrangement;
  const jobLoc = currentJobMeta?.location || jobSnapshot?.location;
  const userWants = currentPrefs?.workArrangement || [];
  let locationMatchHtml = '';
  let locationSummary = '';
  if (jobArr) {
    if (userWants.length > 0) {
      // Match if jobArr exactly matches OR if jobArr text contains any preferred arrangement
      // e.g., "Flexible (Remote and On-site)" matches a "Remote" preference
      const jobArrLower = jobArr.toLowerCase();
      const isMatch = userWants.includes(jobArr) || userWants.some(w => jobArrLower.includes(w.toLowerCase())) || /flexible|hybrid.*remote|remote.*on.?site/i.test(jobArr);
      if (isMatch) {
        let detail = jobArr;
        if (jobArr === 'Remote' && currentPrefs?.remoteGeo) detail += ` · ${currentPrefs.remoteGeo}`;
        else if (jobLoc) detail += ` · ${jobLoc}`;
        locationMatchHtml = `<div class="location-match ok"><span class="loc-icon">✓</span> ${detail} — matches your preference</div>`;
        locationSummary = `<span class="jopp-sum-loc ok">✓ ${jobArr}</span>`;
      } else {
        let jobDetail = jobArr + (jobLoc ? ` · ${jobLoc}` : '');
        locationMatchHtml = `<div class="location-match bad"><span class="loc-icon">✗</span> ${jobDetail} — you want ${userWants.join('/')}</div>`;
        locationSummary = `<span class="jopp-sum-loc bad">✗ ${jobArr}</span>`;
      }
    } else {
      locationMatchHtml = `<div class="location-match neutral"><span class="loc-icon">📍</span> ${jobArr}${jobLoc ? ' · ' + jobLoc : ''}</div>`;
      locationSummary = `<span class="jopp-sum-loc">${jobArr}</span>`;
    }
  }

  const isPending = jobMatch === 'pending';
  const hasMatch = !!(jobMatch && jobMatch !== 'pending');
  const v = hasMatch ? scoreToVerdict(jobMatch.score) : null;

  // If no data and not pending, show loading state
  if (!locationMatchHtml && !hasMatch && !isPending) {
    jobOpportunityEl.innerHTML = `
      <details class="jopp-dropdown">
        <summary class="jopp-summary">
          <span class="jopp-summary-left">Job Opportunity</span>
          <span class="jopp-summary-right"><span class="jopp-loader"><span class="jopp-loader-icon">🔍</span><span class="jopp-loader-text"></span></span></span><span class="jopp-chevron">›</span>
        </summary>
        <div class="jopp-body"><div class="jopp-loading-area"><span class="jopp-loader-icon jopp-loader-lg">🔍</span><span class="jopp-loader-text"></span></div></div>
      </details>`;
    startLoaderTextCycle(jobOpportunityEl);
    return;
  }

  const summaryBadge = v ? `<span class="verdict-badge-sm ${v.cls}">${v.label}</span>` : '';
  const easyApplyBadge = currentJobMeta?.easyApply ? '<span class="easy-apply-badge">⚡ Easy Apply</span>' : '';

  const autoOpen = hasMatch || locationMatchHtml;
  jobOpportunityEl.innerHTML = `
    <details class="jopp-dropdown"${autoOpen ? ' open' : ''}>
      <summary class="jopp-summary">
        <span class="jopp-summary-left">Job Opportunity</span>
        <span class="jopp-summary-right">${easyApplyBadge}${locationSummary}${summaryBadge}</span><span class="jopp-chevron">›</span>
      </summary>
      <div class="jopp-body">
        ${locationMatchHtml}
        ${(jobSnapshot?.salary || currentJobMeta?.salary) ? `<div class="salary-display"><span class="salary-label">${jobSnapshot?.salaryType === 'ote' ? 'OTE' : 'Base Salary'}</span><span class="salary-value">${jobSnapshot?.salary || currentJobMeta?.salary}</span></div>` : ''}
        ${(jobSnapshot?.perks?.length || currentJobMeta?.perks?.length) ? `<div class="perks-display">${(jobSnapshot?.perks || currentJobMeta?.perks || []).map(p => `<span class="perk-chip">🎁 ${p}</span>`).join('')}</div>` : ''}
        ${isPending && !hasMatch ? '<div style="font-size:11px;color:#7c98b6;margin:8px 0;line-height:1.5">Click <b>Research this company</b> below for full fit analysis with score, green flags, and red flags.</div>' : ''}
        ${hasMatch && jobMatch.jobSummary ? `<div class="job-summary">${jobMatch.jobSummary}</div>` : ''}
        ${hasMatch ? (() => {
          const fb = currentResearch?.matchFeedback;
          const upActive = fb?.type === 'up' ? ' active up' : '';
          const downActive = fb?.type === 'down' ? ' active down' : '';
          const noteActive = fb?.type === 'note' ? ' active note' : '';
          return `
          <div class="verdict-row" style="margin-top:12px">
            ${jobMatch.score ? `<span style="font-size:18px;font-weight:800;color:${jobMatch.score >= 7 ? '#00BDA5' : jobMatch.score >= 5 ? '#d97706' : '#f87171'};margin-right:4px"><span style="display:block;font-size:9px;font-weight:600;color:var(--ci-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;line-height:1;">Coop's Score</span>${jobMatch.score}<span style="font-size:12px;opacity:0.6">/10</span></span>` : ''}
            <span class="verdict-badge ${v.cls}">${v.label}</span>
            <span class="verdict-thumbs">
              <button class="thumb-btn${upActive}" data-dir="up" title="Agree with assessment">👍</button>
              <button class="thumb-btn${noteActive}" data-dir="note" title="Leave a note on the wording/format">💬</button>
              <button class="thumb-btn${downActive}" data-dir="down" title="Disagree with assessment">👎</button>
            </span>
            ${jobMatch.verdict ? `<span class="fit-verdict">${jobMatch.verdict}</span>` : ''}
          </div>
          <div id="sp-thumb-form" style="display:none"></div>
          ${jobMatch.strongFits ? `<details open class="flags-green"><summary>Green Flags</summary><div class="detail-body">${renderBullets(jobMatch.strongFits, 'fit')}</div></details>` : ''}
          ${(jobMatch.redFlags || jobMatch.watchOuts) ? `<details open class="flags-red"><summary>Red Flags</summary><div class="detail-body">${renderBullets(jobMatch.redFlags || jobMatch.watchOuts, 'flag')}</div></details>` : ''}
          ${jobMatch.qualifications?.length ? `<details class="flags-qual"><summary>${(_cachedUserName || '').split(/\s/)[0] ? (_cachedUserName.split(/\s/)[0] + "'s Qualifications") : 'Qualifications'} (${jobMatch.qualifications.filter(q => q.status === 'met' && !q.dismissed).length}/${jobMatch.qualifications.length})</summary><div class="detail-body">${renderQualifications(jobMatch.qualifications)}</div></details>` : ''}
          ${jobMatch.scoreBreakdown ? `<details class="flags-breakdown"><summary>Score Breakdown</summary><div class="detail-body">${renderScoreBreakdown(jobMatch.scoreBreakdown)}</div></details>` : ''}
        `;
        })() : ''}
      </div>
    </details>`;
}

function startResearchLoaderCycle(company) {
  const phrases = [
    `Researching ${company}...`,
    'Pulling company intel...',
    'Scanning for leadership...',
    'Checking reviews & signals...',
    'Analyzing fit...',
    'Scoring match...',
  ];
  let idx = 0;
  const el = document.getElementById('research-loader-text');
  if (!el) return;
  const update = () => { el.textContent = phrases[idx]; idx = (idx + 1) % phrases.length; };
  update();
  const interval = setInterval(() => {
    if (!el.isConnected) { clearInterval(interval); return; }
    update();
  }, 1800);
}

// Phase-based loader for forced-refresh research flow. Replaces the single-icon
// loader with a three-phase progress card (Firmographics → Leaders & reviews →
// Synthesizing), elapsed time counter, and adaptive hints at 15s/45s thresholds.
// Exposes window.__researchPhases.advance(phaseIdx) so triggerResearch callbacks
// can nudge it forward on real events (e.g., QUICK_LOOKUP returning).
function renderResearchPhases(company) {
  const safeCompany = (company || 'company').replace(/</g, '&lt;');
  const _thinkSvg = `<svg class="coop-thinking-face" width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="#3B5068"/><clipPath id="ct28"><circle cx="50" cy="50" r="48"/></clipPath><g clip-path="url(#ct28)"><ellipse cx="50" cy="100" rx="48" ry="28" fill="#435766"/><path d="M26 100L40 77L50 88L60 77L74 100" fill="#364854"/><path d="M40 77L50 94L60 77" fill="#F0EAE0"/><path d="M41 78Q44 73 50 76Q44 79 41 78Z" fill="#3D4F5F"/><path d="M59 78Q56 73 50 76Q56 79 59 78Z" fill="#3D4F5F"/><ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/><rect x="43" y="71" width="14" height="8" rx="2" fill="#E8C4A0"/><path d="M28 43Q28 27 39 21Q50 16 61 21Q72 27 72 43Q72 53 68 58L63 64L56 68L50 70L44 68L37 64Q32 58 28 53Q28 48 28 43Z" fill="#EDBB92"/><ellipse cx="29" cy="44" rx="3" ry="4.5" fill="#DFB088"/><ellipse cx="71" cy="44" rx="3" ry="4.5" fill="#DFB088"/><path d="M27 40Q27 15 50 10Q73 15 73 40L71 32Q69 16 50 13Q31 16 29 32Z" fill="#2D1F16"/><path d="M29 31Q30 13 50 10Q70 13 71 31Q69 17 50 13Q31 17 29 31Z" fill="#3D2A1E"/><path d="M33 23Q38 13 50 11Q58 11 63 15" fill="#3D2A1E" opacity="0.7"/><ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="40" cy="42.5" r="3" fill="#5B8C3E"/><circle cx="40" cy="42.5" r="2.2" fill="#4A7A30"/><circle cx="40.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/><ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="58" cy="42.5" r="3" fill="#5B8C3E"/><circle cx="58" cy="42.5" r="2.2" fill="#4A7A30"/><circle cx="58.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/><path d="M35 37Q38 35 41 35Q44 35 47 37" fill="#2D1F16" opacity="0.8"/><path d="M53 35.5Q56 33 59 33Q62 33 65 35.5" fill="#2D1F16" opacity="0.8"/><path d="M47 53Q48 55 50 55.5Q52 55 53 53" fill="none" stroke="#C8966E" stroke-width="0.7" stroke-linecap="round"/><path d="M43 60Q47 62 50 62Q53 62 57 60" fill="none" stroke="#9B7055" stroke-width="1" stroke-linecap="round"/><path d="M65 84Q72 76 69 68Q67 63 62 62" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/><path d="M65 84Q68 80 69 76" fill="none" stroke="#364854" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/><path d="M48 66Q50 62 56 61Q62 62 63 66Q62 69 58 70Q52 71 49 68Z" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/><circle cx="76" cy="28" r="6" fill="rgba(255,255,255,0.7)" stroke="#ccc" stroke-width="0.5"><animate attributeName="cy" values="28;24;28" dur="2s" repeatCount="indefinite"/></circle><circle cx="71" cy="37" r="3.5" fill="rgba(255,255,255,0.5)" stroke="#ddd" stroke-width="0.4"><animate attributeName="cy" values="37;34;37" dur="2.3s" repeatCount="indefinite"/></circle><circle cx="67" cy="42" r="2" fill="rgba(255,255,255,0.4)" stroke="#ddd" stroke-width="0.3"><animate attributeName="cy" values="42;40;42" dur="1.8s" repeatCount="indefinite"/></circle></g></svg>`;
  contentEl.innerHTML = `
    <div class="research-phases-card" id="research-phases-card">
      <div class="research-phases-header">
        ${_thinkSvg}
        <div class="research-phases-title">Researching <span class="company">${safeCompany}</span></div>
      </div>
      <div class="research-phase-list">
        <div class="research-phase active" data-phase="0">
          <span class="rp-icon"></span>
          <span class="rp-text">Fetching firmographics</span>
        </div>
        <div class="research-phase pending" data-phase="1">
          <span class="rp-icon"></span>
          <span class="rp-text">Scanning leaders & reviews</span>
        </div>
        <div class="research-phase pending" data-phase="2">
          <span class="rp-icon"></span>
          <span class="rp-text">Synthesizing company intel</span>
        </div>
      </div>
      <div class="research-elapsed">
        <span id="research-elapsed-time">0:00</span>
        <span class="rp-hint" id="research-elapsed-hint"></span>
      </div>
    </div>`;

  const startedAt = Date.now();
  let currentPhase = 0;

  const advance = (to) => {
    if (to <= currentPhase) return;
    const phaseEls = document.querySelectorAll('#research-phases-card .research-phase');
    phaseEls.forEach((el, i) => {
      el.classList.remove('active', 'pending', 'done');
      if (i < to) el.classList.add('done');
      else if (i === to) el.classList.add('active');
      else el.classList.add('pending');
    });
    currentPhase = to;
  };

  const finish = () => {
    const phaseEls = document.querySelectorAll('#research-phases-card .research-phase');
    phaseEls.forEach(el => { el.classList.remove('active', 'pending'); el.classList.add('done'); });
    currentPhase = 3;
  };

  // Elapsed time counter + adaptive hints
  const timeEl = document.getElementById('research-elapsed-time');
  const hintEl = document.getElementById('research-elapsed-hint');
  const tick = () => {
    if (!timeEl?.isConnected) { clearInterval(interval); return; }
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');
    timeEl.textContent = `${mm}:${ss}`;
    if (hintEl) {
      if (secs >= 45) hintEl.textContent = 'Taking longer than usual — large fallback chain is running';
      else if (secs >= 15) hintEl.textContent = 'Still working — large companies can take up to 30s';
      else hintEl.textContent = '';
    }
    // Time-based phase hints if real events don't advance us
    if (currentPhase === 0 && secs >= 4) advance(1);
    if (currentPhase === 1 && secs >= 12) advance(2);
  };
  tick();
  const interval = setInterval(tick, 500);

  // Expose advance/finish so triggerResearch can call them on real events
  window.__researchPhases = {
    advance,
    finish,
    stop: () => clearInterval(interval),
  };
}

function startLoaderTextCycle(container) {
  const phrases = ['Researching role...', 'Analyzing fit...', 'Scoring match...', 'Checking alignment...'];
  let idx = 0;
  const els = container.querySelectorAll('.jopp-loader-text');
  if (!els.length) return;
  const update = () => { els.forEach(el => el.textContent = phrases[idx]); idx = (idx + 1) % phrases.length; };
  update();
  const interval = setInterval(() => {
    if (!container.isConnected) { clearInterval(interval); return; }
    update();
  }, 1800);
}

// Thumbs feedback handler (delegated)
document.addEventListener('click', e => {
  const thumbBtn = e.target.closest('.thumb-btn');
  if (!thumbBtn) return;
  const dir = thumbBtn.dataset.dir;
  const formEl = document.getElementById('sp-thumb-form');
  if (!formEl) return;

  // Toggle active state
  document.querySelectorAll('.thumb-btn').forEach(b => b.classList.remove('active', 'up', 'down'));
  thumbBtn.classList.add('active', dir);

  // Show inline feedback form
  const placeholder = dir === 'up' ? 'What resonated?' : dir === 'note' ? 'Feedback on wording, length, format...' : 'What felt off?';
  formEl.style.display = 'block';
  formEl.innerHTML = `<div class="thumb-feedback-form">
    <input class="thumb-feedback-input" id="sp-thumb-note" type="text" placeholder="${placeholder}">
    <button class="thumb-feedback-submit" id="sp-thumb-submit">Submit</button>
  </div>`;
  formEl.querySelector('#sp-thumb-note')?.focus();

  const submit = () => {
    const note = document.getElementById('sp-thumb-note')?.value?.trim() || '';
    const feedback = { type: dir, note, date: Date.now() };
    // Save to current research and persist to entry
    if (currentResearch) currentResearch.matchFeedback = feedback;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const companies = savedCompanies || [];
      const company = companyNameEl.textContent;
      const idx = companies.findIndex(c => companiesMatch(c.company, company));
      if (idx !== -1) {
        companies[idx] = { ...companies[idx], matchFeedback: feedback };
        chrome.storage.local.set({ savedCompanies: companies });
      }
    });
    formEl.innerHTML = `<div style="font-size:11px;color:#7da8c4;padding:4px 0">Thanks for the feedback</div>`;
    setTimeout(() => { formEl.style.display = 'none'; }, 2000);
  };

  document.getElementById('sp-thumb-submit')?.addEventListener('click', submit);
  document.getElementById('sp-thumb-note')?.addEventListener('keydown', e2 => {
    if (e2.key === 'Enter') submit();
  });
});

// Qualification dismiss handler (delegated)
document.addEventListener('click', e => {
  const dismissBtn = e.target.closest('.qual-dismiss');
  if (!dismissBtn) return;
  const qualId = dismissBtn.dataset.qualId;
  if (!qualId) return;
  const company = companyNameEl.textContent;
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const companies = savedCompanies || [];
    const idx = companies.findIndex(c => companiesMatch(c.company, company));
    if (idx === -1 || !companies[idx].jobMatch?.qualifications) return;
    const qual = companies[idx].jobMatch.qualifications.find(q => q.id === qualId);
    if (!qual) return;
    qual.dismissed = !qual.dismissed;
    chrome.storage.local.set({ savedCompanies: companies }, () => {
      // Update the row visually
      const row = dismissBtn.closest('.qual-row');
      if (row) {
        row.classList.toggle('dismissed', qual.dismissed);
        dismissBtn.textContent = qual.dismissed ? '↩' : '×';
        dismissBtn.title = qual.dismissed ? 'Restore' : 'Dismiss';
      }
      // Update the summary in the details summary
      const qualDetails = document.querySelector('.flags-qual summary');
      if (qualDetails) {
        const allQuals = companies[idx].jobMatch.qualifications;
        const metCount = allQuals.filter(q => q.status === 'met' && !q.dismissed).length;
        const _fn = (_cachedUserName || '').split(/\s/)[0];
        qualDetails.textContent = `${_fn ? _fn + "'s Qualifications" : 'Qualifications'} (${metCount}/${allQuals.length})`;
      }
    });
  });
});

// Qualification status edit handler (click the icon to change status + give feedback)
document.addEventListener('click', e => {
  const iconBtn = e.target.closest('.qual-icon[data-qual-idx]');
  if (!iconBtn) return;
  const qualIdx = parseInt(iconBtn.dataset.qualIdx);
  const row = iconBtn.closest('.qual-row');
  if (!row || row.querySelector('.qual-status-picker')) return; // already open

  const statuses = ['met', 'partial', 'unmet'];
  const labels = { met: '✓ Met', partial: '◐ Partial', unmet: '✗ Unmet' };

  const picker = document.createElement('div');
  picker.className = 'qual-status-picker';
  picker.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;padding:8px 10px;background:var(--ci-bg-raised);border:1px solid var(--ci-border-default);border-radius:8px;';
  picker.innerHTML = `
    <div style="display:flex;gap:4px;">
      ${statuses.map(s => `<button class="qual-status-opt" data-status="${s}">${labels[s]}</button>`).join('')}
    </div>
    <textarea placeholder="Why? (e.g., I managed 70+ client logos which qualifies as enterprise relationship management)" style="width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--ci-border-default);border-radius:6px;font-family:inherit;background:var(--ci-bg-inset);color:var(--ci-text-primary);outline:none;resize:vertical;min-height:40px;line-height:1.4;"></textarea>
    <div style="display:flex;gap:6px;justify-content:flex-end;">
      <button class="qual-fb-cancel" style="font-size:11px;padding:4px 10px;border:1px solid var(--ci-border-default);border-radius:6px;background:var(--ci-bg-raised);color:var(--ci-text-tertiary);cursor:pointer;font-family:inherit;">Cancel</button>
      <button class="qual-fb-save" style="font-size:11px;padding:4px 12px;border:none;border-radius:6px;background:var(--ci-accent-primary);color:#fff;cursor:pointer;font-family:inherit;font-weight:600;">Save</button>
    </div>`;

  const textEl = row.querySelector('.qual-text');
  textEl.appendChild(picker);

  let selectedStatus = null;
  picker.querySelectorAll('.qual-status-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.qual-status-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedStatus = btn.dataset.status;
    });
  });

  picker.querySelector('.qual-fb-cancel').addEventListener('click', () => picker.remove());
  picker.querySelector('.qual-fb-save').addEventListener('click', () => {
    const feedback = picker.querySelector('textarea').value.trim();
    if (!selectedStatus && !feedback) { picker.remove(); return; }

    const company = companyNameEl.textContent;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const companies = savedCompanies || [];
      const idx = companies.findIndex(c => companiesMatch(c.company, company));
      if (idx === -1 || !companies[idx].jobMatch?.qualifications) return;
      const qual = companies[idx].jobMatch.qualifications[qualIdx];
      if (!qual) return;
      if (selectedStatus) qual.userOverrideStatus = selectedStatus;
      if (feedback) qual.userFeedback = feedback;
      chrome.storage.local.set({ savedCompanies: companies });

      // Save feedback to coopMemory for future scoring
      if (feedback) {
        chrome.storage.local.get(['coopMemory'], d => {
          const mem = d.coopMemory && Array.isArray(d.coopMemory.entries) ? d.coopMemory : { entries: [] };
          const now = new Date().toISOString();
          mem.entries.push({
            id: 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: 'feedback',
            name: `scoring_feedback: ${(qual.requirement || '').slice(0, 50)}`,
            description: `Qualification feedback for ${company}`,
            body: `Qualification "${qual.requirement}" — user says ${selectedStatus || qual.status}: ${feedback}`,
            createdAt: now,
            updatedAt: now,
            source: company,
          });
          if (mem.entries.length > 200) mem.entries = mem.entries.slice(-200);
          mem.updatedAt = now;
          chrome.storage.local.set({ coopMemory: mem });
        });
      }

      // Update icon
      const icons = { met: '✓', partial: '◐', unmet: '✗', unknown: '✗' };
      const newStatus = selectedStatus || qual.status;
      iconBtn.textContent = icons[newStatus] || '?';
      iconBtn.className = `qual-icon ${newStatus}`;

      picker.remove();
      // Show confirmation
      const note = document.createElement('div');
      note.className = 'qual-feedback-note';
      note.textContent = `💬 ${feedback || 'Status updated'}`;
      textEl.appendChild(note);
    });
  });
});

function renderQuickData(data) {
  const companySlug = companyNameEl.textContent.toLowerCase().replace(/\s+/g, '-');
  const crunchbaseUrl = `https://www.crunchbase.com/organization/${companySlug}`;

  // Company links
  const links = [];
  if (data.companyWebsite) links.push(`<a class="company-link" href="${data.companyWebsite}" target="_blank">↗ Website</a>`);
  if (data.companyLinkedin) links.push(`<a class="company-link" href="${data.companyLinkedin}" target="_blank">in LinkedIn</a>`);
  companyLinksEl.innerHTML = links.length > 0 ? `<div class="company-links">${links.join('')}</div>` : '';

  // Stats
  const statDefs = [
    { label: 'Employees', value: data.employees, url: data.companyLinkedin ? data.companyLinkedin.replace(/\/?$/, '/') + 'people/' : null },
    { label: 'Total Funding', value: data.funding, url: crunchbaseUrl },
    { label: 'Industry', value: data.industry, url: null },
    { label: 'Founded', value: data.founded, url: null }
  ].filter(s => s.value && s.value !== 'null' && !/not found|unknown|unavailable|n\/a/i.test(s.value));

  if (statDefs.length === 0) return;

  const statsHtml = statDefs.map(s => {
    const inner = `<div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div>`;
    return s.url ? `<a class="stat" href="${s.url}" target="_blank">${inner}</a>` : `<div class="stat">${inner}</div>`;
  }).join('');

  const sourceTag = data.enrichmentSource ? `<div style="font-size:10px;color:#4a6580;margin-top:6px">Source: ${data.enrichmentSource}</div>` : '';
  const overviewHtml = `
    <div class="section">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
      ${sourceTag}
    </div>`;

  // If the phase loader is active (forced refresh flow), inject the overview
  // ABOVE it rather than replacing the entire content — preserves the visible
  // progress UI while showing the freshly-arrived quick data.
  const phaseCard = document.getElementById('research-phases-card');
  if (phaseCard && window.__researchPhases) {
    // Remove any prior quick-data overview we injected, then insert fresh
    document.getElementById('sp-quick-overview')?.remove();
    const holder = document.createElement('div');
    holder.id = 'sp-quick-overview';
    holder.innerHTML = overviewHtml;
    contentEl.insertBefore(holder, phaseCard);
    return;
  }

  contentEl.innerHTML = `
    ${overviewHtml}
    <div class="research-loader" id="research-loader"><span class="research-loader-icon">🔍</span><span class="research-loader-text" id="research-loader-text"></span></div>`;
  startResearchLoaderCycle(companyNameEl.textContent);
}

function renderBullets(items, type) {
  // Handles strings (legacy) AND {text, source, evidence} objects (new)
  let bullets;
  if (Array.isArray(items)) {
    bullets = items.filter(Boolean).map(b => typeof b === 'string'
      ? { text: b, source: null, evidence: null }
      : { text: b?.text || '', source: b?.source || null, evidence: b?.evidence || null }
    ).filter(b => b.text);
  } else {
    bullets = String(items).split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 4).map(s => ({ text: s, source: null, evidence: null }));
  }
  if (bullets.length === 0) return '';
  const icon = type === 'fit' ? '✓' : '✗';
  const cls = type === 'fit' ? 'bullet-fit' : 'bullet-flag';
  const greenShades = ['#15803d','#16a34a','#22c55e','#4ade80','#86efac','#bbf7d0'];
  const redShades = ['#991b1b','#dc2626','#ef4444','#f87171','#fca5a5','#fecaca'];
  const shades = type === 'fit' ? greenShades : redShades;
  const srcLabel = s => ({ job_posting: 'From job posting', company_data: 'From company research', preferences: 'From your preferences', candidate_profile: 'From your profile', dealbreaker_keyword: 'From your dealbreaker keywords' }[s] || (s ? `Source: ${s}` : 'No source linked'));
  const srcIcon = s => ({ job_posting: '📄', company_data: '🏢', preferences: '⚙', candidate_profile: '👤', dealbreaker_keyword: '⛔' }[s] || 'ⓘ');
  return `<ul class="match-bullets">${bullets.map((b, i) => {
    const color = shades[Math.min(i, shades.length - 1)];
    const tip = (srcLabel(b.source) + (b.evidence ? ` — "${b.evidence}"` : ' — no evidence quoted')).replace(/"/g, '&quot;');
    return `<li class="${cls}"><span class="bullet-icon" style="color:${color}">${icon}</span><span>${boldKeyPhrase(b.text.trim())}</span><span title="${tip}" style="opacity:0.55;font-size:10px;margin-left:4px;cursor:help;">${srcIcon(b.source)}</span></li>`;
  }).join('')}</ul>`;
}

// Bold the key signal phrase in a flag bullet — typically the first clause
// boldKeyPhrase — provided by ui-utils.js

function renderQualifications(qualifications) {
  if (!qualifications?.length) return '';
  const metCount = qualifications.filter(q => q.status === 'met' && !q.dismissed).length;
  const reqCount = qualifications.filter(q => q.importance === 'required').length;
  const reqMetCount = qualifications.filter(q => q.importance === 'required' && q.status === 'met' && !q.dismissed).length;
  const icons = { met: '✓', partial: '◐', unmet: '✗', unknown: '✗' };
  const summary = `<div class="qual-summary">
    <span class="qual-summary-item"><strong>${metCount}</strong>/${qualifications.length} met</span>
    ${reqCount ? `<span class="qual-summary-item"><strong>${reqMetCount}</strong>/${reqCount} required</span>` : ''}
  </div>`;
  const rows = qualifications.map((q, idx) => {
    const dismissed = q.dismissed ? ' dismissed' : '';
    const feedbackNote = q.userFeedback ? `<div class="qual-feedback-note">💬 ${q.userFeedback}</div>` : '';
    const overridden = q.userOverrideStatus ? ` (you said: ${q.userOverrideStatus})` : '';
    return `<div class="qual-row${dismissed}" data-qual-id="${q.id}" data-qual-idx="${idx}">
      <button class="qual-icon ${q.userOverrideStatus || q.status}" data-qual-idx="${idx}" title="Click to change status">${icons[q.userOverrideStatus || q.status] || '?'}</button>
      <div class="qual-text">
        <div class="qual-req">${q.requirement}</div>
        ${q.evidence ? `<div class="qual-evidence">${q.evidence}${overridden}</div>` : ''}
        ${feedbackNote}
      </div>
      <div class="qual-right">
        <span class="qual-badge ${q.importance}">${(q.sources?.length ? q.sources[0] : q.importance) || q.importance}</span>
        <button class="qual-dismiss" data-qual-id="${q.id}" title="${q.dismissed ? 'Restore' : 'Dismiss'}">${q.dismissed ? '↩' : '×'}</button>
      </div>
    </div>`;
  }).join('');
  return summary + rows;
}

function renderScoreBreakdown(breakdown) {
  if (!breakdown) return '';
  const DIM_COLORS = { qualificationFit: '#378ADD', roleFit: '#3B6D11', cultureFit: '#7F77DD', companyFit: '#BA7517', compFit: '#0F6E56' };
  const components = [
    { key: 'qualificationFit', label: 'Qualification Fit', tip: "Would they hire you? Matches your experience, seniority, and skills against job requirements. Your preferences don't affect this score." },
    { key: 'roleFit', label: 'Role Fit', tip: "How well does the day-to-day work match what you're looking for? Green flags, role ICP, selling motion, autonomy, scope." },
    { key: 'cultureFit', label: 'Culture Fit', tip: "Culture markers, team dynamics, company values, work style, growth environment." },
    { key: 'companyFit', label: 'Company Fit', tip: "Company stage, size, industry, market position, and trajectory vs your ICP." },
    { key: 'compFit', label: 'Comp Fit', tip: "Comp alignment against your salary/OTE floors and strong targets. 5 = meets floor or not disclosed." }
  ];
  // Backward compat: fall back to old keys if new ones missing
  const get = (key) => {
    if (breakdown[key] !== undefined) return breakdown[key];
    if (key === 'roleFit' && breakdown.preferenceFit !== undefined) return breakdown.preferenceFit;
    if (key === 'cultureFit' && breakdown.dealbreakers !== undefined) return breakdown.dealbreakers;
    if (key === 'companyFit' && breakdown.roleFit !== undefined) return breakdown.roleFit;
    return 5;
  };
  return components.map(c => {
    const val = get(c.key);
    const pct = val * 10;
    const barColor = val >= 7 ? '#00BDA5' : val >= 5 ? '#d97706' : '#f87171';
    const dotColor = DIM_COLORS[c.key] || barColor;
    return `<div class="breakdown-row" style="position:relative;cursor:help;">
      <span class="breakdown-label"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:5px;vertical-align:middle;"></span>${c.label} <span style="opacity:0.4;font-size:10px;">ⓘ</span></span>
      <div class="breakdown-bar"><div class="breakdown-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <span class="breakdown-val" style="color:${barColor}">${Number(val).toFixed(1)}</span>
      <div class="breakdown-tooltip">${c.tip}</div>
    </div>`;
  }).join('');
}

function setFavicon(domain) {
  const favicon = document.getElementById('company-favicon');
  if (!favicon) return;
  if (!domain) { favicon.style.display = 'none'; return; }
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  favicon.src = `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=64`;
  favicon.style.display = 'block';
  favicon.onerror = () => { favicon.style.display = 'none'; };
}

function renderResults(data) {
  // Cache age indicator
  const cacheAgeEl = document.getElementById('sp-cache-age');
  if (cacheAgeEl) {
    if (data._cachedAt) {
      const days = Math.round((Date.now() - data._cachedAt) / 86400000);
      cacheAgeEl.textContent = days === 0 ? 'Researched today' : days === 1 ? 'Researched yesterday' : `Researched ${days} days ago`;
      cacheAgeEl.style.display = '';
    } else {
      cacheAgeEl.textContent = 'Just researched';
      cacheAgeEl.style.display = '';
      setTimeout(() => { if (cacheAgeEl.textContent === 'Just researched') cacheAgeEl.style.display = 'none'; }, 5000);
    }
  }

  // Job snapshot badges — use DOM meta (jobSnapshot comes via SCORE_OPPORTUNITY)
  renderJobSnapshot(currentJobMeta || null);

  // Company favicon
  setFavicon(data.companyWebsite || detectedDomain);

  // Company links bar
  const links = [];
  if (data.companyWebsite) links.push(`<a class="company-link" href="${data.companyWebsite}" target="_blank">↗ Website</a>`);
  if (data.companyLinkedin) links.push(`<a class="company-link" href="${data.companyLinkedin}" target="_blank">in LinkedIn</a>`);
  companyLinksEl.innerHTML = links.length > 0 ? `<div class="company-links">${links.join('')}</div>` : '';

  // Stats
  const companySlug = companyNameEl.textContent.toLowerCase().replace(/\s+/g, '-');
  const crunchbaseUrl = `https://www.crunchbase.com/organization/${companySlug}`;
  const ds = data.dataSources || {};
  const statDefs = [
    { label: 'Employees', value: data.employees, url: data.companyLinkedin ? data.companyLinkedin.replace(/\/?$/, '/') + 'people/' : null, src: ds.employees },
    { label: 'Total Funding', value: data.funding, url: crunchbaseUrl, src: ds.funding },
    { label: 'Industry', value: data.industry, url: null, src: ds.industry },
    { label: 'Founded', value: data.founded, url: null, src: ds.founded }
  ].filter(s => s.value && s.value !== 'null' && !/not found|unknown|unavailable|n\/a/i.test(s.value));

  const statsHtml = statDefs.length > 0
    ? statDefs.map(s => {
        const srcTag = s.src ? `<div class="stat-src">${s.src}</div>` : '';
        const inner = `<div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div>${srcTag}`;
        return s.url
          ? `<a class="stat" href="${s.url}" target="_blank">${inner}</a>`
          : `<div class="stat">${inner}</div>`;
      }).join('')
    : '<div class="stat"><div class="stat-value" style="color:#555">No firmographic data available</div></div>';

  // Intelligence / What They Do
  const intel = data.intelligence || {};
  const description = intel.oneLiner || intel.eli5 || '';
  const intelHtml = description ? `
    <div class="one-liner">${description}</div>
    ${intel.category ? `<span class="intel-category">${intel.category}</span>` : ''}
    ${intel.whosBuyingIt ? `<details><summary>Who buys it</summary><div class="detail-body">${intel.whosBuyingIt}</div></details>` : ''}
    ${intel.howItWorks ? `<details><summary>How it works</summary><div class="detail-body">${intel.howItWorks}</div></details>` : ''}
  ` : '<div style="color:#555;font-size:13px">No product data available</div>';

  // scoreToVerdict — provided by ui-utils.js

  // Company fit intentionally omitted — only job-level fit (via SCORE_OPPORTUNITY) is shown

  // Job opportunity rendered independently by triggerJobAnalysis/renderJobOpportunity

  // Reviews
  const reviewsHtml = data.reviews && data.reviews.length > 0
    ? data.reviews.map(r => {
        const inner = `${r.rating ? `<span style="color:#fbbf24;font-weight:700">${r.rating}★</span> ` : ''}${r.snippet}<div class="review-source">${r.source}</div>`;
        return r.url
          ? `<a class="review-item" href="${r.url}" target="_blank">${inner}</a>`
          : `<div class="review-item">${inner}</div>`;
      }).join('')
    : '<div class="review-item" style="color:#555">No reviews found</div>';

  // Leaders
  const leadersHtml = data.leaders && data.leaders.length > 0
    ? data.leaders.filter(l => l.name).map((l, i) => {
        const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(l.name + ' ' + companyNameEl.textContent)}`;
        const initials = l.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return `
          <div class="leader-item">
            <div class="leader-avatar-initials" id="leader-avatar-${i}">${initials}</div>
            <div class="leader-info">
              <div class="leader-name">${l.name}</div>
              <div class="leader-title">${l.title}</div>
            </div>
            <div class="leader-links">
              <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
              ${l.newsUrl ? `<a class="leader-link" href="${l.newsUrl}" target="_blank">News</a>` : ''}
            </div>
          </div>`;
      }).join('')
    : '<div style="color:#555;font-size:13px">No leadership data found</div>';

  // Hiring signals — current posting first, then other open roles
  const currentPosting = currentJobTitle && currentUrl
    ? [{ title: currentJobTitle, url: currentUrl, snippet: 'Currently viewing this posting', current: true }]
    : [];
  const otherListings = (data.jobListings || []).filter(j => j.url !== currentUrl).slice(0, 1);
  const allListings = [...currentPosting, ...otherListings];
  const jobsHtml = allListings.length > 0
    ? allListings.map(j => `
        <a class="job-item${j.current ? ' current-posting' : ''}" href="${j.url}" target="_blank">
          <div class="job-title">${j.title}${j.current ? ' <span style="font-size:10px;color:#6366f1;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Viewing</span>' : ''}</div>
          <div class="job-snippet">${j.snippet || ''}</div>
        </a>`).join('')
    : '<div style="color:#555;font-size:13px">No open roles found</div>';

  // Job opportunity is rendered separately by renderJobOpportunity() — don't touch #job-opportunity here

  // Known contacts — from saved entry (populated when Activity panel emails are scanned)
  const knownContacts = currentSavedEntry?.knownContacts || [];
  const contactsHtml = knownContacts.length > 0
    ? knownContacts.map(c => {
        const initials = c.name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
        const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + companyNameEl.textContent)}`;
        return `<div class="leader-item">
          <div class="leader-avatar-initials" style="background:linear-gradient(135deg,#0d9488,#0077b5);color:#fff">${initials}</div>
          <div class="leader-info">
            <div class="leader-name">${c.name}</div>
            <div class="leader-title" style="color:#0077b5;display:flex;align-items:center;gap:4px;">${c.email}<button class="copy-email-btn" data-copy-email="${c.email.replace(/"/g,'&quot;')}">⎘</button></div>
          </div>
          <div class="leader-links">
            <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
          </div>
        </div>`;
      }).join('')
    : null;

  const srcLabel = (s) => s ? `<span class="data-src">${s}</span>` : '';
  contentEl.innerHTML = `
    <div class="section section-overview">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
      ${intelHtml}
      ${ds.intelligence ? srcLabel(ds.intelligence) : ''}
    </div>
    <div class="section section-signals">
      <div class="section-title">Hiring Signals ${srcLabel(ds.jobListings)}</div>
      ${jobsHtml}
    </div>
    ${contactsHtml ? `<div class="section section-leadership" id="sp-contacts-section">
      <div class="section-title">Known Contacts ${srcLabel('Gmail')}</div>
      ${contactsHtml}
    </div>` : `<div id="sp-contacts-section"></div>`}
    <div class="section section-leadership">
      <div class="section-title">Leadership ${srcLabel(ds.leaders)}</div>
      ${leadersHtml}
    </div>
    <div class="section section-reviews">
      <div class="section-title">Reviews & Signal ${srcLabel(ds.reviews)}</div>
      ${reviewsHtml}
    </div>
  `;
}

// Delegated copy email handler (replaces inline onclick)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy-email]');
  if (!btn) return;
  const email = btn.dataset.copyEmail;
  navigator.clipboard.writeText(email).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
});

function renderContactsSection(el, contacts) {
  if (!contacts.length) return;
  const MATCHED_VIA_LABELS = {
    'email-domain':          '✉ email · domain match',
    'email-sibling-domain':  '✉ email · sibling domain',
    'email-sender':          '✉ email · name match',
    'granola-email-domain':  '📅 meeting · email domain',
    'granola-folder':        '📅 meeting · folder',
    'granola-attendee-name': '📅 meeting · attendee',
    'granola-title':         '📅 meeting · title',
    'granola-meeting':       '📅 meeting',
    'manual':                '✎ manual',
    'leader-promoted':       '✎ leader · promoted',
    'calendar':              '📅 calendar',
  };
  const getSourceLabel = c => {
    if (c.matchedVia?.type) return MATCHED_VIA_LABELS[c.matchedVia.type] || c.matchedVia.type;
    return c.source === 'manual' ? '✎ manual' : c.source === 'email' ? '✉ email' : '📅 calendar';
  };
  const getSourceTitle = c => {
    if (c.matchedVia?.detail) return c.matchedVia.detail;
    return 'Added before match reasoning was recorded.';
  };
  const html = contacts.map(c => {
    const initials = c.name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
    const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + companyNameEl.textContent)}`;
    const sourceLabel = getSourceLabel(c);
    const sourceTitle = getSourceTitle(c).replace(/"/g, '&quot;');
    return `<div class="leader-item">
      <div class="leader-avatar-initials" style="background:linear-gradient(135deg,#0d9488,#0077b5);color:#fff">${initials}</div>
      <div class="leader-info">
        <div class="leader-name">${c.name}</div>
        <div class="leader-title" style="color:#0077b5;display:flex;align-items:center;gap:4px;">${c.email}<button class="copy-email-btn" data-copy-email="${c.email.replace(/"/g,'&quot;')}">⎘</button></div>
        <div style="font-size:10px;color:#7c98b6;margin-top:2px" title="${sourceTitle}">${sourceLabel}</div>
      </div>
      <div class="leader-links">
        <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
      </div>
    </div>`;
  }).join('');
  el.outerHTML = `<div class="section section-leadership" id="sp-contacts-section">
    <div class="section-title">Known Contacts</div>
    ${html}
  </div>`;
}

// ── Side Panel Chat (launches floating widget on page) ──────────────────────

(function initSidePanelInlineChat() {
  const chatEl = document.getElementById('sp-chat');
  const msgsEl = document.getElementById('sp-chat-messages');
  const inputEl = document.getElementById('sp-chat-input');
  const sendBtn = document.getElementById('sp-chat-send');
  const detachBtn = document.getElementById('sp-chat-detach');
  const popoutBtn = document.getElementById('sp-chat-popout');
  const chatResize = document.getElementById('sp-chat-resize');
  const chatSpacer = document.getElementById('sp-chat-spacer');
  const tabIndicator = document.getElementById('sp-tab-indicator');
  const tabIndicatorText = document.getElementById('sp-tab-indicator-text');
  const tabDismissBtn = document.getElementById('sp-tab-dismiss');
  console.log('[SP Chat] Init:', { chatEl: !!chatEl, msgsEl: !!msgsEl, inputEl: !!inputEl, sendBtn: !!sendBtn });
  if (!chatEl || !msgsEl || !inputEl || !sendBtn) { console.warn('[SP Chat] Missing elements — aborting init'); return; }

  if (typeof COOP !== 'undefined') {
    const headerTitle = document.getElementById('sp-chat-header-title');
    if (headerTitle) headerTitle.innerHTML = COOP.headerHTML();
  }

  // ── Entry bind (attach Coop context to a saved company/opportunity) ──
  const bindBtn = document.getElementById('sp-chat-bind-btn');
  const bindPanel = document.getElementById('sp-chat-bind-panel');
  const bindInput = document.getElementById('sp-chat-bind-input');
  const bindResults = document.getElementById('sp-chat-bind-results');

  let _boundEntryId = null; // chat-session binding (separate from _manualLinkId which is for intel panel)
  let _autoBindActive = false; // tracks whether the current bind was set automatically (vs user click)
  // Expose to module scope so checkAlreadySaved (outside this IIFE) can auto-bind
  window.__coopBind = {
    set(id, { auto = false } = {}) {
      _boundEntryId = id;
      _autoBindActive = auto;
      updateBindBtnLabel();
    },
    // setFromQueue: used by the pending-bind IIFE for "Open Application" handoffs.
    // Sets _manualLinkId so the tab-change handler treats this bind as sticky and
    // doesn't blow it away when the new tab's content script fires.
    setFromQueue(id) {
      _boundEntryId = id;
      _autoBindActive = true;
      _manualLinkId = id; // sticky — survives tab load events
      updateBindBtnLabel();
    },
    get() { return { id: _boundEntryId, auto: _autoBindActive }; },
    clearForUser() { _boundEntryId = null; _autoBindActive = false; updateBindBtnLabel(); },
  };

  // ── Pending bind handoff from Apply Queue (Open Application flow) ─────────
  // queue.js writes { entryId, ts } to chrome.storage.session before opening
  // the side panel on the new job tab. Read it, load the entry, and auto-bind
  // Coop so he has full context from the first message.
  // Exposed as a promise so the initial-detection block (line ~865) can await
  // it before running, preventing a race where content.js detection overwrites
  // the bound UI.
  window.__coopBindReady = (async () => {
    try {
      // NOTE: the previous getSession() form short-circuited because
      // chrome.storage.session.get(keys, cb) returns undefined synchronously,
      // making `... || r({})` resolve the promise before the callback fired.
      const getSession = () => new Promise(r => {
        if (chrome.storage.session?.get) {
          try { chrome.storage.session.get(['pendingSidePanelBind'], r); }
          catch (_) { r({}); }
        } else {
          r({});
        }
      });
      const getLocal   = () => new Promise(r => chrome.storage.local.get(['pendingSidePanelBind'], r));
      let pending = null;
      try { pending = (await getSession())?.pendingSidePanelBind; } catch (_) {}
      if (!pending) { try { pending = (await getLocal())?.pendingSidePanelBind; } catch (_) {} }
      if (!pending || !pending.entryId) return;
      // Freshness guard: only honor handoffs from the last 2 minutes
      if (pending.ts && (Date.now() - pending.ts) > 2 * 60 * 1000) {
        try { chrome.storage.session?.remove?.(['pendingSidePanelBind']); } catch (_) {}
        try { chrome.storage.local.remove(['pendingSidePanelBind']); } catch (_) {}
        return;
      }
      // Load the entry
      const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
      const entry = (savedCompanies || []).find(e => e.id === pending.entryId);
      if (!entry) return;
      applyQueueBind(entry);
      // Clear the pending flag so a refresh doesn't re-bind
      try { chrome.storage.session?.remove?.(['pendingSidePanelBind']); } catch (_) {}
      try { chrome.storage.local.remove(['pendingSidePanelBind']); } catch (_) {}
      console.log('[SP] Auto-bound to entry from Apply Queue handoff:', entry.company);
    } catch (err) {
      console.warn('[SP] Pending-bind handoff failed:', err.message);
    }
  })();

  function updateBindBtnLabel() {
    if (!bindBtn) return;
    const viewLink = document.getElementById('sp-chat-bind-view');
    if (_boundEntryId && currentSavedEntry) {
      const name = currentSavedEntry.company || '';
      const job = currentSavedEntry.jobTitle ? ` · ${currentSavedEntry.jobTitle}` : '';
      const autoTag = _autoBindActive ? ' (auto)' : '';
      bindBtn.textContent = `📎 ${name}${autoTag} ×`;
      bindBtn.classList.add('bound');
      bindBtn.title = _autoBindActive
        ? `Auto-bound to ${name}${job} from the detected entry — click to unbind`
        : `Bound to ${name}${job} — click to unbind`;
      if (viewLink) {
        viewLink.style.display = '';
        // company.html is the canonical entry detail page — it handles both
        // companies and opportunities. (opportunity.html is a separate job-focused
        // view still reachable from company.js "View Opportunity" buttons.)
        viewLink.href = chrome.runtime.getURL(`company.html?id=${encodeURIComponent(currentSavedEntry.id)}`);
        viewLink.title = `Open ${name}${job} in full CRM`;
      }
    } else {
      bindBtn.textContent = '📎 Bind';
      bindBtn.classList.remove('bound');
      bindBtn.title = 'Bind Coop to a saved company or opportunity';
      if (viewLink) viewLink.style.display = 'none';
    }
  }

  // Open view link in a new tab (chrome-extension:// pages from sidepanel need explicit handling)
  (function initBindViewLink() {
    const viewLink = document.getElementById('sp-chat-bind-view');
    if (!viewLink) return;
    viewLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (viewLink.href && viewLink.href !== '#') {
        chrome.tabs.create({ url: viewLink.href });
      }
    });
  })();

  function renderBindResults(query) {
    if (!bindResults) return;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      void chrome.runtime.lastError;
      const entries = (savedCompanies || []).filter(c => c.company);
      const q = (query || '').toLowerCase().trim();
      const filtered = q
        ? entries.filter(c => c.company.toLowerCase().includes(q) || (c.jobTitle || '').toLowerCase().includes(q))
        : entries.slice(0, 12);
      if (!filtered.length) {
        bindResults.innerHTML = `<div style="font-size:11px;color:var(--ci-text-tertiary);padding:6px 4px">No matches</div>`;
        return;
      }
      bindResults.innerHTML = filtered.slice(0, 12).map(c => {
        const stage = (c.jobStage || c.status || 'saved').replace(/_/g, ' ');
        const job = c.jobTitle ? ` — ${c.jobTitle}` : '';
        return `<div class="sp-chat-bind-row" data-id="${c.id}">
          <span class="sp-chat-bind-name">${c.company}${job}</span>
          <span class="sp-chat-bind-stage">${stage}</span>
        </div>`;
      }).join('');
    });
  }

  if (bindBtn) {
    bindBtn.addEventListener('click', () => {
      // If already bound, clicking unbinds
      if (_boundEntryId) {
        _boundEntryId = null;
        _autoBindActive = false;
        if (bindPanel) bindPanel.classList.remove('open');
        updateBindBtnLabel();
        return;
      }
      const isOpen = bindPanel?.classList.contains('open');
      if (bindPanel) bindPanel.classList.toggle('open', !isOpen);
      if (!isOpen && bindInput) {
        bindInput.value = '';
        renderBindResults('');
        bindInput.focus();
      }
    });
  }

  if (bindInput) {
    bindInput.addEventListener('input', () => renderBindResults(bindInput.value));
  }

  if (bindResults) {
    bindResults.addEventListener('click', e => {
      const row = e.target.closest('.sp-chat-bind-row');
      if (!row) return;
      const id = row.dataset.id;
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        void chrome.runtime.lastError;
        const match = (savedCompanies || []).find(c => c.id === id);
        if (!match) return;
        // Bind the entry — updates currentSavedEntry so buildChatContext() picks it up
        _boundEntryId = id;
        _autoBindActive = false; // explicit user choice
        currentSavedEntry = match;
        _manualLinkId = id;
        if (match.company) companyNameEl.textContent = match.company;
        if (match.jobTitle) { currentJobTitle = match.jobTitle; currentJobMeta = match.jobSnapshot || null; }
        if (bindPanel) bindPanel.classList.remove('open');
        updateBindBtnLabel();
        // Flip the side panel header from "Save Company" → "View in CRM" so the
        // detected card matches the bound state. Also hydrate research/job match.
        try {
          if (typeof showCrmLink === 'function') showCrmLink(match);
          if (match.intelligence || match.employees || match.industry) {
            currentResearch = {
              intelligence: match.intelligence,
              employees: match.employees,
              funding: match.funding,
              industry: match.industry,
              companyWebsite: match.companyWebsite,
              companyLinkedin: match.companyLinkedin,
              reviews: match.reviews || [],
              leaders: match.leaders || [],
              jobListings: match.jobListings || [],
              jobMatch: match.jobMatch,
              jobSnapshot: match.jobSnapshot,
              enrichmentSource: 'Saved data',
            };
            if (typeof renderResults === 'function') renderResults(currentResearch);
            if (match.jobMatch && typeof renderJobOpportunity === 'function') {
              renderJobOpportunity(match.jobMatch, match.jobSnapshot || currentJobMeta || null);
            }
          }
        } catch (e) { console.warn('[SP Bind] hydrate failed:', e); }
        // Show a brief confirmation in chat
        const confirmMsg = document.createElement('div');
        confirmMsg.style.cssText = 'font-size:11px;color:var(--ci-text-tertiary);text-align:center;padding:4px 0;';
        confirmMsg.textContent = `📎 Coop is now using context from ${match.company}${match.jobTitle ? ' — ' + match.jobTitle : ''}`;
        msgsEl.appendChild(confirmMsg);
        msgsEl.scrollTop = msgsEl.scrollHeight;

        // Auto-fetch Granola transcripts if the entry doesn't already have transcript text cached.
        // cachedMeetings may exist with metadata-only entries (no transcript field) — still fetch.
        const hasTranscriptText = !!(match.cachedMeetingTranscript || match.cachedMeetingNotes ||
          (match.cachedMeetings || []).some(m => m && (m.transcript || m.summary)));
        if (!hasTranscriptText) {
          const contactNames = (match.knownContacts || []).map(c => c.name).filter(Boolean);
          const companyDomain = (match.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') || null;
          const fetchingMsg = document.createElement('div');
          fetchingMsg.style.cssText = 'font-size:11px;color:var(--ci-text-tertiary);text-align:center;padding:4px 0;';
          fetchingMsg.textContent = `📝 Fetching meeting notes from Granola…`;
          msgsEl.appendChild(fetchingMsg);
          msgsEl.scrollTop = msgsEl.scrollHeight;
          chrome.runtime.sendMessage(
            { type: 'GRANOLA_SEARCH', companyName: match.company, companyDomain, contactNames },
            result => {
              void chrome.runtime.lastError;
              if (!result || result.error) {
                fetchingMsg.textContent = `📝 No Granola notes found${result?.error ? ' (' + result.error + ')' : ''}`;
                return;
              }
              const transcriptText = result.transcript || result.notes;
              let loadedCount = 0;
              if (currentSavedEntry?.id === id) {
                if (transcriptText) {
                  currentSavedEntry.cachedMeetingTranscript = transcriptText;
                  loadedCount++;
                }
                if (result.meetings?.length) {
                  currentSavedEntry.cachedMeetings = result.meetings;
                  loadedCount += result.meetings.length;
                }
              }
              if (loadedCount) {
                fetchingMsg.textContent = `📝 Loaded ${result.meetings?.length || 1} meeting${(result.meetings?.length || 1) > 1 ? 's' : ''} from Granola`;
                // Persist back to storage so future binds and background context have it
                chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
                  void chrome.runtime.lastError;
                  const list = savedCompanies || [];
                  const idx = list.findIndex(c => c.id === id);
                  if (idx >= 0) {
                    if (transcriptText) list[idx].cachedMeetingTranscript = transcriptText;
                    if (result.meetings?.length) list[idx].cachedMeetings = result.meetings;
                    chrome.storage.local.set({ savedCompanies: list });
                  }
                });
              } else {
                fetchingMsg.textContent = `📝 No matching Granola notes for ${match.company}`;
              }
              msgsEl.scrollTop = msgsEl.scrollHeight;
            }
          );
        }
      });
    });
  }

  // Update bind button label whenever context changes
  document.addEventListener('context-updated', updateBindBtnLabel);

  // ── Tab/page awareness ──
  let tabContextActive = true;
  let tabContextLabel = '';

  // ── Screen share (vision) — uses getDisplayMedia for native picker ──
  let screenShareActive = false;
  let latestScreenshotDataUrl = null;
  let _displayStream = null;       // MediaStream from getDisplayMedia
  let _captureInterval = null;     // periodic frame capture
  const screenToggle = document.getElementById('sp-screenshare-toggle');
  const screenPreview = document.getElementById('sp-screen-preview');
  const screenPreviewImg = document.getElementById('sp-screen-preview-img');
  const screenFlash = document.getElementById('sp-screen-flash');

  function captureFrameFromStream() {
    if (!_displayStream || !_displayStream.active) return null;
    const video = screenToggle._video;
    if (!video || video.readyState < 2) return null; // HAVE_CURRENT_DATA
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      latestScreenshotDataUrl = dataUrl;
      if (screenPreviewImg) screenPreviewImg.src = dataUrl;
      if (screenPreview) screenPreview.classList.add('visible');
      if (screenFlash) { screenFlash.classList.remove('flash'); void screenFlash.offsetWidth; screenFlash.classList.add('flash'); }
      return dataUrl;
    } catch (e) {
      console.warn('[ScreenShare] Frame capture failed:', e.message);
      return null;
    }
  }

  async function startScreenShare() {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });
    } catch (e) {
      // User cancelled the picker OR the browser rejected the call.
      // NotAllowedError with "Permission denied by user" = user dismissal (expected, stay silent).
      // Anything else = real failure, surface it so the user knows.
      const isUserCancel = e.name === 'NotAllowedError' && /permission denied by user|canceled/i.test(e.message);
      if (!isUserCancel) {
        console.warn('[ScreenShare] getDisplayMedia failed:', e.name, e.message);
        // Flash the button red briefly so the user sees something happened
        screenToggle.style.color = '#ef4444';
        screenToggle.title = `Screen share failed: ${e.message}`;
        setTimeout(() => {
          screenToggle.style.color = '';
          screenToggle.title = 'Share your screen with Coop';
        }, 2500);
      }
      screenShareActive = false;
      screenToggle.classList.remove('active');
      return;
    }

    _displayStream = stream;
    screenShareActive = true;
    screenToggle.classList.add('active');
    screenToggle.title = 'Stop sharing screen';

    // Show preview container first so the <video> inside is laid out in the DOM
    if (screenPreview) screenPreview.classList.add('visible');

    // Pipe stream into the live preview video element and reuse it for frame capture.
    // Using the DOM-attached video (autoplay/muted/playsinline in HTML) is reliable;
    // detached <video> elements often never reach HAVE_CURRENT_DATA in Chrome.
    const previewVideo = document.getElementById('sp-screen-preview-video');
    if (previewVideo) {
      previewVideo.srcObject = _displayStream;
      previewVideo.style.display = 'block';
      if (screenPreviewImg) screenPreviewImg.style.display = 'none';
      try { await previewVideo.play(); } catch (_) { /* autoplay may already be handled */ }
      // Wait for the first frame to be decodable, with a hard timeout fallback.
      await new Promise(resolve => {
        if (previewVideo.readyState >= 2) return resolve();
        const done = () => { previewVideo.removeEventListener('loadeddata', done); resolve(); };
        previewVideo.addEventListener('loadeddata', done);
        setTimeout(done, 1500);
      });
      screenToggle._video = previewVideo;
    }

    // Auto-stop when user ends share via browser UI (e.g. "Stop sharing" bar)
    _displayStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopScreenShare();
    });

    if (typeof CISounds !== 'undefined') CISounds.shareStart();
    console.log('[ScreenShare] Started — preview video readyState:', previewVideo?.readyState);
  }

  function stopScreenShare() {
    screenShareActive = false;
    screenToggle.classList.remove('active');
    screenToggle.title = 'Share your screen with Coop';
    latestScreenshotDataUrl = null;
    if (screenPreview) screenPreview.classList.remove('visible');
    // Reset the preview/capture video (same DOM element now)
    const previewVideo = document.getElementById('sp-screen-preview-video');
    if (previewVideo) { previewVideo.srcObject = null; previewVideo.style.display = 'none'; }
    if (screenPreviewImg) { screenPreviewImg.style.display = ''; screenPreviewImg.src = ''; }
    if (_displayStream) {
      _displayStream.getTracks().forEach(t => t.stop());
      _displayStream = null;
    }
    screenToggle._video = null;
    if (typeof CISounds !== 'undefined') CISounds.shareStop();
    console.log('[ScreenShare] Stopped');
  }

  // Override captureScreenshot for the send() function to use stream frames
  async function captureScreenshot() {
    if (_displayStream?.active) return captureFrameFromStream();
    // Fallback to tab capture if no stream
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 });
      latestScreenshotDataUrl = dataUrl;
      if (screenPreviewImg) screenPreviewImg.src = dataUrl;
      if (screenPreview) screenPreview.classList.add('visible');
      if (screenFlash) { screenFlash.classList.remove('flash'); void screenFlash.offsetWidth; screenFlash.classList.add('flash'); }
      return dataUrl;
    } catch (e) {
      console.warn('[ScreenShare] Capture failed:', e.message);
      return null;
    }
  }

  if (screenToggle) {
    screenToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (screenShareActive) {
        stopScreenShare();
      } else {
        startScreenShare();
      }
    });
  }


  // ── Snip tool: select a region on the active tab to send to Coop ──
  const snipBtn = document.getElementById('sp-snip-btn');
  let _pendingSnip = null; // stores cropped base64 for next message

  if (snipBtn) {
    snipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      snipBtn.classList.add('active');
      try {
        // 1. Capture the full visible tab
        const fullDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 });
        if (!fullDataUrl) { snipBtn.classList.remove('active'); return; }

        // 2. Inject crosshair overlay on the active tab for region selection
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { snipBtn.classList.remove('active'); return; }

        const [{ result: rect }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            return new Promise(resolve => {
              const overlay = document.createElement('div');
              overlay.id = '__coop-snip-overlay';
              Object.assign(overlay.style, {
                position: 'fixed', inset: '0', zIndex: '2147483647',
                cursor: 'crosshair', background: 'rgba(0,0,0,0.15)',
              });
              const box = document.createElement('div');
              Object.assign(box.style, {
                position: 'fixed', border: '2px solid #FC636B', background: 'rgba(252,99,107,0.08)',
                borderRadius: '4px', pointerEvents: 'none', zIndex: '2147483647',
              });
              document.body.appendChild(overlay);
              document.body.appendChild(box);

              let startX, startY, selecting = false;
              overlay.addEventListener('mousedown', e => {
                startX = e.clientX; startY = e.clientY; selecting = true;
                box.style.left = startX + 'px'; box.style.top = startY + 'px';
                box.style.width = '0'; box.style.height = '0';
                box.style.display = 'block';
              });
              overlay.addEventListener('mousemove', e => {
                if (!selecting) return;
                const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
                Object.assign(box.style, { left: x+'px', top: y+'px', width: w+'px', height: h+'px' });
              });
              overlay.addEventListener('mouseup', e => {
                selecting = false;
                const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
                overlay.remove(); box.remove();
                if (w < 10 || h < 10) { resolve(null); return; } // too small, cancel
                // Account for device pixel ratio
                const dpr = window.devicePixelRatio || 1;
                resolve({ x: x * dpr, y: y * dpr, w: w * dpr, h: h * dpr });
              });
              // Escape to cancel
              const onKey = e => { if (e.key === 'Escape') { overlay.remove(); box.remove(); document.removeEventListener('keydown', onKey); resolve(null); } };
              document.addEventListener('keydown', onKey);
            });
          }
        });

        snipBtn.classList.remove('active');
        if (!rect) return; // cancelled

        // 3. Crop the full screenshot to the selected region
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = fullDataUrl; });
        const canvas = document.createElement('canvas');
        canvas.width = rect.w;
        canvas.height = rect.h;
        canvas.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const compressed = croppedDataUrl.split(',')[1];

        // 4. Store for next message + show preview
        _pendingSnip = compressed;
        latestScreenshotDataUrl = croppedDataUrl;
        if (screenPreviewImg) screenPreviewImg.src = croppedDataUrl;
        if (screenPreview) screenPreview.classList.add('visible');
        if (screenFlash) { screenFlash.classList.remove('flash'); void screenFlash.offsetWidth; screenFlash.classList.add('flash'); }

        if (typeof CISounds !== 'undefined') CISounds.snip();
        console.log(`[Snip] Captured ${rect.w}x${rect.h} region (${Math.round(compressed.length / 1024)}KB)`);
      } catch (e) {
        console.warn('[Snip] Failed:', e.message);
        snipBtn.classList.remove('active');
      }
    });
  }

  function getTabContextLabel() {
    const url = currentUrl || '';
    const company = companyNameEl?.textContent || '';
    if (!url) return '';
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      if (host.includes('linkedin.com')) {
        if (url.includes('/jobs/')) return company ? `LinkedIn Jobs — ${company}` : 'LinkedIn Jobs';
        if (url.includes('/feed')) return 'LinkedIn Feed';
        return `LinkedIn — ${u.pathname.split('/').filter(Boolean)[0] || 'page'}`;
      }
      if (url.includes('chrome-extension://')) {
        if (url.includes('saved')) return 'Coop.ai — Saved';
        return 'Coop.ai';
      }
      return company ? `${company} — ${host}` : host;
    } catch { return ''; }
  }

  function getTabFaviconHTML() {
    const url = currentUrl || '';
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (host.includes('linkedin.com')) return `<span class="sp-tab-indicator-icon-fallback" style="color:#0A66C2;">in</span>`;
      if (url.includes('chrome-extension://')) return `<span class="sp-tab-indicator-icon-fallback" style="color:#FF7A59;">&#9670;</span>`;
      return `<img class="sp-tab-indicator-icon" src="https://www.google.com/s2/favicons?domain=${host}&sz=32" onerror="this.outerHTML='<span class=sp-tab-indicator-icon-fallback>&#9679;</span>'" />`;
    } catch { return `<span class="sp-tab-indicator-icon-fallback">&#9679;</span>`; }
  }

  function updateTabIndicator() {
    if (!tabContextActive || !tabIndicator) return;
    tabContextLabel = getTabContextLabel();
    if (tabContextLabel) {
      const iconWrap = document.getElementById('sp-tab-indicator-icon-wrap');
      if (iconWrap) iconWrap.innerHTML = getTabFaviconHTML();
      tabIndicatorText.textContent = `Sharing "${tabContextLabel}"`;
      tabIndicator.style.display = '';
    } else {
      tabIndicator.style.display = 'none';
    }
  }

  if (tabDismissBtn) {
    tabDismissBtn.addEventListener('click', () => {
      tabContextActive = false;
      tabIndicator.style.display = 'none';
    });
  }

  // ── Contextual suggested questions ──
  const SUGGESTIONS_BY_CONTEXT = {
    job: [
      { label: 'Score this role for me', prompt: 'Score this role against my profile and ICP' },
      { label: 'Help me apply', prompt: 'Help me answer application questions for this role' },
      { label: 'Help me respond', prompt: 'Help me draft a response based on what you see on my screen right now' },
      { label: 'Compare to my ICP', prompt: 'Compare this role to my ideal company profile' },
    ],
    linkedin: [
      { label: 'Explore trending topics', prompt: 'What are the trending topics in my feed?' },
      { label: 'Find networking opportunities', prompt: 'Identify networking opportunities from this page' },
      { label: 'Draft a post', prompt: 'Help me draft a LinkedIn post about my job search' },
    ],
    saved: [
      { label: 'What should I prioritize?', prompt: 'What should I prioritize today from my saved opportunities?' },
      { label: 'Compare top opportunities', prompt: 'Compare my top-rated saved opportunities' },
      { label: 'Draft follow-ups', prompt: 'Draft follow-up messages for my active opportunities' },
    ],
    company: [
      { label: 'Prep me for an interview', prompt: 'What should I know before interviewing here?' },
      { label: 'Help me respond', prompt: 'Help me draft a response based on what you see on my screen right now' },
      { label: 'Draft a follow-up email', prompt: 'Draft a follow-up email for this company' },
      { label: 'What are the risks?', prompt: "What are the red flags or risks I should know about?" },
    ],
  };

  function detectSuggestionContext() {
    const url = currentUrl || '';
    if (currentJobTitle) return 'job';
    // Detect ATS application pages even without a detected job title
    if (currentSavedEntry?.isOpportunity) return 'job';
    if (/careers\.|jobs\.|apply\.|lever\.co|greenhouse\.io|ashbyhq\.com|myworkdayjobs\.com|jobvite\.com|smartrecruiters\.com|workable\.com/i.test(url)) return 'job';
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('chrome-extension://') && url.includes('saved')) return 'saved';
    return 'company';
  }

  function buildEmptyStateHTML() {
    const avatarHTML = typeof COOP !== 'undefined' ? COOP.avatar(48) : '';

    // Quick prompts row (user-configured)
    const quickPromptsHTML = _quickPrompts.length > 0
      ? _quickPrompts.map(p =>
          `<button class="sp-suggestion-btn sp-quick-prompt-btn" data-suggestion-prompt="${p.prompt.replace(/"/g, '&quot;')}">${p.label}</button>`
        ).join('')
      : '';

    // Contextual suggestions row (auto, context-aware) — only shown when no user-configured prompts exist
    let contextualHTML = '';
    if (_quickPrompts.length === 0 && _coopConfig.automations?.contextualSuggestions !== false) {
      const ctx = detectSuggestionContext();
      const suggestions = SUGGESTIONS_BY_CONTEXT[ctx] || SUGGESTIONS_BY_CONTEXT.company;
      contextualHTML = suggestions.map(s =>
        `<button class="sp-suggestion-btn" data-suggestion-prompt="${s.prompt.replace(/"/g, '&quot;')}">${s.label}</button>`
      ).join('');
    }

    return `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:32px 24px 20px;">
      <div style="margin-bottom:8px;">${avatarHTML}</div>
      <div style="font-size:22px;font-weight:700;color:#FF7A59;line-height:1.2;">Hello${_cachedUserName ? ', ' + _cachedUserName : ''}</div>
      <div style="font-size:20px;font-weight:600;color:#2D2D2D;line-height:1.3;">How can I help you today?</div>
    </div>
    ${quickPromptsHTML ? `<div class="sp-suggestions sp-quick-prompts-row">${quickPromptsHTML}</div>` : ''}
    ${contextualHTML ? `<div class="sp-suggestions">${contextualHTML}</div>` : ''}`;
  }

  // Re-render empty state when quick prompts change in settings
  _onQuickPromptsChanged = () => {
    const emptyEl = msgsEl.querySelector('.sp-chat-empty');
    if (emptyEl) emptyEl.innerHTML = buildEmptyStateHTML();
  };

  // Restore saved chat height
  const savedChatH = localStorage.getItem('ci_sp_chat_height');
  if (savedChatH) msgsEl.style.maxHeight = savedChatH + 'px';

  // Drag top edge to resize chat height
  if (chatResize) {
    chatResize.addEventListener('mousedown', e => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = msgsEl.offsetHeight;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      const onMove = ev => {
        const newH = Math.max(60, Math.min(500, startH + (startY - ev.clientY)));
        msgsEl.style.maxHeight = newH + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem('ci_sp_chat_height', parseInt(msgsEl.style.maxHeight));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  let history = [];
  let isApplicationMode = false;
  const appModeBadge = document.getElementById('sp-app-mode-badge');

  // Detect application form URLs (not just job listings — actual apply pages)
  function isApplicationFormUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const path = u.pathname.toLowerCase();
      const host = u.hostname.toLowerCase();
      // ATS application form patterns
      if (host.includes('greenhouse.io') && (path.includes('/application') || path.includes('/apply'))) return true;
      if (host.includes('lever.co') && path.includes('/apply')) return true;
      if (host.includes('myworkdayjobs.com') && (path.includes('/apply') || path.includes('/login'))) return true;
      if (host.includes('ashbyhq.com') && path.includes('/application')) return true;
      if (host.includes('jobvite.com') && path.includes('/apply')) return true;
      if (host.includes('smartrecruiters.com') && path.includes('/apply')) return true;
      if (host.includes('workable.com') && path.includes('/apply')) return true;
      // Generic patterns on any ATS-like domain
      if (/\/applications?\//i.test(path) || /\/apply\b/i.test(path)) return true;
      return false;
    } catch { return false; }
  }

  function updateAppModeBadge() {
    if (appModeBadge) appModeBadge.style.display = isApplicationMode ? '' : 'none';
  }

  function tryAutoActivateAppMode() {
    if (isApplicationMode) return; // already active
    if (_coopConfig.automations?.applicationModeDetection === false) return;
    if (isApplicationFormUrl(currentUrl)) {
      isApplicationMode = true;
      updateAppModeBadge();
      console.log('[SP] Auto-activated application mode for URL:', currentUrl);
    }
  }
  // Auto-activate on load if we're on an application form
  tryAutoActivateAppMode();

  // Model switcher — dropdown picklist, ordered by cost
  const CHAT_ALL_MODELS = [
    { id: 'gpt-4.1-nano',              label: 'GPT-4.1 Nano',        icon: '◆', provider: 'openai',  cost: '$',   tier: 'Fastest' },
    { id: 'gemini-2.0-flash-lite',     label: 'Gemini Flash-Lite',   icon: '✦', provider: 'gemini',  cost: '$',   tier: 'Cheapest' },
    { id: 'gpt-4.1-mini',              label: 'GPT-4.1 Mini',        icon: '◆', provider: 'openai',  cost: '$',   tier: 'Fast & cheap' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku',        icon: '⚡', provider: 'anthropic', cost: '$', tier: 'Fast & cheap' },
    { id: 'gemini-2.0-flash',          label: 'Gemini Flash',        icon: '✦', provider: 'gemini',  cost: '$',   tier: 'Fast & cheap' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',   icon: '✦', provider: 'anthropic', cost: '$$', tier: 'Balanced' },
    { id: 'gpt-4.1',                   label: 'GPT-4.1',             icon: '◆', provider: 'openai',  cost: '$$',  tier: 'Balanced' },
    { id: 'gpt-5',                     label: 'GPT-5',               icon: '◆', provider: 'openai',  cost: '$$$', tier: 'Most capable' },
    { id: 'claude-opus-4-0-20250514',  label: 'Claude Opus',         icon: '★', provider: 'anthropic', cost: '$$$', tier: 'Most capable' },
  ];
  let spAvailableModels = CHAT_ALL_MODELS;
  let chatModelIdx = 0;
  const modelToggle = document.getElementById('sp-model-toggle');
  const modelLabel = document.getElementById('sp-model-label');

  // Load pipeline config and key status independently, then set the default model
  Promise.all([
    new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, s => { void chrome.runtime.lastError; r(s); })),
    new Promise(r => chrome.storage.local.get(['pipelineConfig'], d => r(d.pipelineConfig)))
  ]).then(([status, pipelineCfg]) => {
    if (status) {
      spAvailableModels = CHAT_ALL_MODELS.filter(m => {
        if (m.provider === 'openai') return !!status.openai;
        if (m.provider === 'anthropic') return !!status.anthropic;
        if (m.provider === 'gemini') return !!status.gemini;
        return true;
      });
      if (!spAvailableModels.length) spAvailableModels = CHAT_ALL_MODELS;
    }
    const configModel = pipelineCfg?.aiModels?.chat;
    if (configModel) {
      const idx = spAvailableModels.findIndex(m => m.id === configModel);
      if (idx >= 0) chatModelIdx = idx;
    }
    updateModelLabel();
  });

  function updateModelLabel() {
    const m = spAvailableModels[chatModelIdx] || spAvailableModels[0];
    if (!modelLabel || !m) return;
    // Compact tier label: "Fast", "Balanced", "Pro"
    const tierMap = { 'Fast & cheap': 'Fast', 'Fastest': 'Fast', 'Balanced': 'Balanced', 'Most capable': 'Pro' };
    modelLabel.textContent = (tierMap[m.tier] || m.tier);
  }

  if (modelToggle) {
    modelToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.getElementById('sp-model-dropdown');
      if (existing) { existing.remove(); return; }

      const rect = modelToggle.getBoundingClientRect();
      const dd = document.createElement('div');
      dd.id = 'sp-model-dropdown';
      // Position above the toggle to avoid getting cut off at bottom of sidepanel
      const dropdownHeight = spAvailableModels.length * 52 + 12;
      const topPos = Math.max(8, rect.top - dropdownHeight - 4);
      dd.style.cssText = `position:fixed;top:${topPos}px;left:${Math.max(4, rect.left - 40)}px;right:8px;max-width:240px;background:#fff;border:1px solid #dfe3eb;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.15);z-index:10001;padding:6px 0;font-family:inherit;max-height:${window.innerHeight - 20}px;overflow-y:auto;`;

      dd.innerHTML = spAvailableModels.map((m, i) => `
        <div data-idx="${i}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;cursor:pointer;transition:background 0.1s;${i === chatModelIdx ? 'background:rgba(255,122,89,0.08);' : ''}">
          <div>
            <div style="font-size:12px;font-weight:600;color:${i === chatModelIdx ? '#FF7A59' : '#2d3e50'}">${m.icon} ${m.label}</div>
            <div style="font-size:10px;color:#7c98b6">${m.tier}</div>
          </div>
          <span style="font-size:10px;font-weight:700;color:${m.cost === '$' ? '#5DCAA5' : m.cost === '$$' ? '#ca8a04' : '#FF7A59'};letter-spacing:1px">${m.cost}</span>
        </div>
      `).join('');

      document.body.appendChild(dd);

      dd.querySelectorAll('[data-idx]').forEach(opt => {
        opt.addEventListener('mouseenter', () => { opt.style.background = '#f5f3f0'; });
        opt.addEventListener('mouseleave', () => { opt.style.background = parseInt(opt.dataset.idx) === chatModelIdx ? 'rgba(255,122,89,0.08)' : ''; });
        opt.addEventListener('click', () => {
          chatModelIdx = parseInt(opt.dataset.idx);
          updateModelLabel();
          dd.remove();
        });
      });

      const closeDd = (ev) => { if (!dd.contains(ev.target) && ev.target !== modelToggle) { dd.remove(); document.removeEventListener('click', closeDd); } };
      setTimeout(() => document.addEventListener('click', closeDd), 0);
    });
  }

  // escHtml — provided by ui-utils.js

  function renderMd(text) {
    let html = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (fenced)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="sp-code-block"><code>${code.trim()}</code><button class="sp-code-copy" title="Copy">📋</button></pre>`);

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="sp-inline-code">$1</code>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="sp-chat-img" src="$2" alt="$1" loading="lazy">');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="sp-chat-link">$1</a>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4 class="sp-chat-h">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="sp-chat-h">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h3 class="sp-chat-h">$1</h3>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr class="sp-chat-hr">');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul class="sp-chat-ul">${m}</ul>`);

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Line breaks (double newline = paragraph, single = br)
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, '');
    // Strip <p> wrappers around block elements — prevents double-margin from paragraph breaks around lists/headings
    html = html.replace(/<p>(<(?:ul|ol|h\d)[^>]*>)/g, '$1');
    html = html.replace(/(<\/(?:ul|ol|h\d)>)<\/p>/g, '$1');
    html = html.replace(/<p><\/p>/g, '');
    // Strip <br> tags between list items — \n between <li>s becomes <br> which adds unwanted spacing
    html = html.replace(/<\/li><br>/g, '</li>');
    html = html.replace(/<ul([^>]*)><br>/g, '<ul$1>');
    html = html.replace(/<br><\/ul>/g, '</ul>');

    // Auto-link bare URLs
    html = html.replace(/(^|[^"=])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" class="sp-chat-link">$2</a>');

    return html;
  }

  // ── Proposal parsing & application ────────────────────────────────────────
  function parseEntryProposals(content) {
    const proposals = [];
    let cleaned = content;
    const fenceRegex = /```entry-update\n([\s\S]*?)```/g;
    let match;
    while ((match = fenceRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) proposals.push(...parsed);
        else proposals.push(parsed);
      } catch {}
      cleaned = cleaned.replace(match[0], '');
    }
    // Also parse create-task fences
    const taskRegex = /```create-task\n([\s\S]*?)```/g;
    while ((match = taskRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        proposals.push({ ...parsed, _type: 'task' });
      } catch {}
      cleaned = cleaned.replace(match[0], '');
    }
    return { cleaned: cleaned.trim(), proposals };
  }

  function applyEntryProposal(proposal) {
    // Handle task creation
    if (proposal._type === 'task') {
      const newTask = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: proposal.text,
        company: proposal.company || currentSavedEntry?.company || '',
        companyId: currentSavedEntry?.id || '',
        dueDate: proposal.dueDate || new Date().toISOString().slice(0, 10),
        priority: proposal.priority || 'normal',
        completed: false,
        createdAt: Date.now(),
        source: 'coop',
      };
      chrome.storage.local.get(['userTasks'], d => {
        const all = d.userTasks || [];
        all.push(newTask);
        chrome.storage.local.set({ userTasks: all });
      });
      return;
    }
    if (!currentSavedEntry?.id) return;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const entries = savedCompanies || [];
      const idx = entries.findIndex(c => c.id === currentSavedEntry.id);
      if (idx === -1) return;
      const entry = entries[idx];
      const field = proposal.field;
      const value = proposal.value;

      if (field === 'notes') {
        // Append to notes
        const existing = entry.notes || '';
        const sep = existing ? '\n' : '';
        entry.notes = existing + sep + value;
      } else if (field === 'addTags') {
        const tags = entry.tags || [];
        (Array.isArray(value) ? value : [value]).forEach(t => { if (!tags.includes(t)) tags.push(t); });
        entry.tags = tags;
      } else if (field === 'removeTags') {
        const remove = Array.isArray(value) ? value : [value];
        entry.tags = (entry.tags || []).filter(t => !remove.includes(t));
      } else {
        entry[field] = value;
      }

      Object.assign(currentSavedEntry, entry);
      chrome.storage.local.set({ savedCompanies: entries });
    });
  }

  // ── Onboarding injection (Phase 1) ──
  // Renders the next unmet onboarding step as a DOM-only Coop message in the
  // empty state. Never enters `history` — onboarding is system-origin, not a
  // user exchange. Safe no-op if onboarding layer is absent or no step matches.
  function injectOnboardingStep() {
    if (!window.coopOnboarding || typeof window.coopOnboarding.getNextStep !== 'function') return;
    window.coopOnboarding.getNextStep().then(step => {
      if (!step) return;
      if (history.length !== 0) return; // user has already started chatting
      const host = document.createElement('div');
      host.className = 'sp-chat-msg sp-chat-msg-assistant sp-onboarding-msg';
      host.dataset.stepId = step.id;
      const prefix = typeof COOP !== 'undefined' ? COOP.messagePrefixHTML() : '';
      const promptHTML = escHtml(step.prompt || '').replace(/\n/g, '<br>');
      const actionsHTML = (step.actions || []).map((a, i) =>
        `<button class="sp-suggestion-btn sp-onboarding-btn" data-action-idx="${i}" style="margin-right:6px;margin-top:6px;">${escHtml(a.label || '')}</button>`
      ).join('');
      host.innerHTML = `${prefix}<div class="sp-chat-bubble">${promptHTML}<div class="sp-onboarding-actions" style="margin-top:8px;">${actionsHTML}</div></div>`;
      // Mount at top of empty-state container
      const emptyEl = msgsEl.querySelector('.sp-chat-empty');
      if (emptyEl) emptyEl.insertBefore(host, emptyEl.firstChild);
      else msgsEl.insertBefore(host, msgsEl.firstChild);
      host.querySelectorAll('.sp-onboarding-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.actionIdx, 10);
          const action = (step.actions || [])[idx];
          if (!action) return;
          const result = window.coopOnboarding.dispatchAction(
            action.call,
            action.args || [],
            { currentStepId: step.id }
          );
          // inline_explain: replace button row with the canned explanation
          if (action.call === 'inline_explain' && result && result.text) {
            const actionsWrap = host.querySelector('.sp-onboarding-actions');
            if (actionsWrap) {
              actionsWrap.innerHTML = `<div style="margin-top:8px;padding:10px 12px;background:rgba(255,122,89,0.08);border-left:2px solid #FF7A59;border-radius:6px;font-size:13px;line-height:1.5;color:#2D2D2D;">${escHtml(result.text)}</div>`;
            }
            window.coopOnboarding.markComplete(step.id);
            return;
          }
          // dismiss / complete / open_page: remove the onboarding block from the DOM
          if (action.call === 'dismiss_step' || action.call === 'complete_step' || action.call === 'open_page') {
            host.remove();
          }
        });
      });
    }).catch(err => console.warn('[onboarding] getNextStep failed', err));
  }

  function renderMessages(showThinking) {
    // Inject context manifest CSS once
    if (typeof injectContextManifestStyles === 'function') injectContextManifestStyles('sp-chat');
    if (history.length === 0) {
      msgsEl.innerHTML = `<div class="sp-chat-empty">${buildEmptyStateHTML()}</div>`;
      injectOnboardingStep();
      // Bind suggestion buttons
      msgsEl.querySelectorAll('.sp-suggestion-btn:not(.sp-onboarding-btn)').forEach(btn => {
        btn.addEventListener('click', () => {
          const prompt = btn.dataset.suggestionPrompt;
          if (prompt) {
            // Activate application mode when "Help me apply" is clicked
            if (prompt.toLowerCase().includes('application questions')) {
              isApplicationMode = true;
              updateAppModeBadge();
            }
            inputEl.value = prompt;
            send();
          }
        });
      });
    } else {
      const thinkingHTML = showThinking
        ? (typeof COOP !== 'undefined' ? `<div class="sp-chat-msg sp-chat-msg-assistant">${COOP.thinkingHTML()}</div>` : '<div class="sp-chat-msg sp-chat-msg-assistant"><div class="sp-chat-bubble sp-chat-thinking"><span class="sp-thinking-dots"><span class="sp-thinking-dot"></span><span class="sp-thinking-dot"></span><span class="sp-thinking-dot"></span></span></div></div>')
        : '';
      msgsEl.innerHTML = history.map((m, idx) => {
        let bubble;
        let proposalHTML = '';
        if (m.role === 'assistant') {
          const { cleaned, proposals } = parseEntryProposals(m.content);
          bubble = renderMd(cleaned);
          if (proposals.length) {
            proposalHTML = proposals.map((p, pi) => {
              const label = p._type === 'task'
                ? (p.label || `Task: ${p.text}`)
                : (p.label || `Set ${p.field} to ${typeof p.value === 'string' ? p.value : JSON.stringify(p.value)}`);
              return `<div class="sp-chat-proposal" data-msg="${idx}" data-pi="${pi}">
                <div class="sp-chat-proposal-text">${escHtml(label)}</div>
                <div class="sp-chat-proposal-actions">
                  <button class="sp-chat-proposal-accept">Accept</button>
                  <button class="sp-chat-proposal-dismiss">Dismiss</button>
                </div>
              </div>`;
            }).join('');
          }
        } else {
          bubble = escHtml(m.content);
        }
        // In application mode, only show copy on actual answers (not meta/conversational messages)
        const isAppAnswer = isApplicationMode && m.role === 'assistant' && m.content
          && !m.content.startsWith('Paste the application')
          && !m.content.startsWith('What\'s your call')
          && m.content.length > 20;
        const showCopy = m.role === 'assistant' && m.content && (!isApplicationMode || isAppAnswer);
        const copyBtn = showCopy
          ? `<button class="sp-chat-copy" data-idx="${idx}" title="Copy to clipboard">📋</button>`
          : '';
        const saveAnswerBtn = (m.role === 'assistant' && isApplicationMode && m.content && !m.content.startsWith('Paste the application'))
          ? `<button class="sp-chat-save-answer" data-idx="${idx}" title="Save as reusable answer pattern">💾 Save</button>`
          : '';
        const prefix = m.role === 'assistant' && typeof COOP !== 'undefined' ? COOP.messagePrefixHTML() : '';
        // Token usage badge for assistant messages.
        // CRITICAL: Anthropic returns input_tokens as ONLY the uncached delta
        // when prompt caching is active. Full billable input is:
        //   input + cacheCreation (billed 1.25×) + cacheRead (billed 0.10×)
        // The previous version of this badge read only `input` and under-
        // reported cost by 10-50× on Tier 3 chat calls.
        const usageBadge = (m.role === 'assistant' && m._usage) ? (() => {
          const inp     = m._usage.input || 0;
          const out     = m._usage.output || 0;
          const cacheW  = m._usage.cacheCreation || 0;
          const cacheR  = m._usage.cacheRead || 0;
          const totalIn = inp + cacheW + cacheR;
          const total   = totalIn + out;
          const modelShort = (m._model || '').replace('claude-', '').replace('-20251001', '').replace('gpt-', 'GPT-');
          // Per-1k rates (dollars). OpenAI has no cache tiers.
          // Haiku 4.5: $1/M in, $5/M out (verified against real Anthropic
          // billing on 2026-04-08 — previous $0.80/$4.00 rates under-reported
          // by 25%). Keep synced with MODEL_COST_PER_MTok in background.js.
          const isGpt   = (m._model || '').startsWith('gpt');
          const isMini  = (m._model || '').includes('mini') || (m._model || '').includes('nano');
          const isHaiku = (m._model || '').includes('haiku');
          const inRate  = isGpt ? (isMini ? 0.0004 : 0.01) : (isHaiku ? 0.001 : 0.003);
          const outRate = isGpt ? (isMini ? 0.0016 : 0.03) : (isHaiku ? 0.005 : 0.015);
          const cost =
              (inp    / 1000) * inRate
            + (cacheW / 1000) * inRate * 1.25
            + (cacheR / 1000) * inRate * 0.10
            + (out    / 1000) * outRate;
          const costStr = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`;
          const cacheHint = (cacheW || cacheR)
            ? ` &middot; <span style="color:#8a8e94;">cache +${cacheW.toLocaleString()}w/${cacheR.toLocaleString()}r</span>`
            : '';
          return `<div class="sp-chat-usage">${modelShort} &middot; ${total.toLocaleString()} tokens (${totalIn.toLocaleString()} in, ${out.toLocaleString()} out)${cacheHint} &middot; ${costStr}</div>`;
        })() : '';
        // G2 tool-use badge — collapsible context manifest (transparency "show your work" panel).
        const toolBadge = (m.role === 'assistant' && m._toolCalls && m._toolCalls.length)
          ? (typeof renderContextManifest === 'function'
            ? renderContextManifest(m._contextManifest, m._toolCalls, 'sp-chat')
            : `<div class="sp-chat-usage" style="color:#7C6EF0;">↳ Coop pulled: ${[...new Set(m._toolCalls.map(t => t.name))].join(', ')}</div>`)
          : '';
        return `<div class="sp-chat-msg sp-chat-msg-${m.role}">${prefix}<div class="sp-chat-bubble">${bubble}</div>${proposalHTML}${copyBtn}${saveAnswerBtn}${toolBadge}${usageBadge}</div>`;
      }).join('') + thinkingHTML;
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Bind context manifest expand/collapse
    if (typeof bindContextManifestEvents === 'function') bindContextManifestEvents(msgsEl);

    // Bind proposal accept/dismiss buttons
    msgsEl.querySelectorAll('.sp-chat-proposal-accept').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.sp-chat-proposal');
        const msgIdx = parseInt(card.dataset.msg);
        const pi = parseInt(card.dataset.pi);
        const { proposals } = parseEntryProposals(history[msgIdx]?.content || '');
        if (proposals[pi]) {
          applyEntryProposal(proposals[pi]);
          card.querySelector('.sp-chat-proposal-actions').innerHTML = '<span style="color:#5DCAA5;font-weight:600;font-size:12px">Applied</span>';
        }
      });
    });
    msgsEl.querySelectorAll('.sp-chat-proposal-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.sp-chat-proposal');
        card.querySelector('.sp-chat-proposal-actions').innerHTML = '<span style="color:#7c98b6;font-size:12px">Dismissed</span>';
      });
    });

    // Bind copy buttons
    msgsEl.querySelectorAll('.sp-chat-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        let text = history[idx]?.content || '';

        // Extract only the answer portion, stripping preamble and closing commentary
        // Remove common opening phrases (case-insensitive)
        text = text.replace(/^(?:here['\s]*s(?:\s+my)?|i['\s]*d\s+(?:suggest|say|emphasize|highlight|point\s+out)|i\s+think|i\s+would|the\s+answer|my\s+answer|this\s+would\s+be)[:\s]*/i, '').trim();

        // Remove common closing questions/offers (after the answer)
        text = text.replace(/\n\n(?:does\s+that|what(?:\s+do\s+)?you|feel\s+free|let\s+me|you\s+could|happy\s+to|does\s+this|would\s+that|any\s+other)[\w\s.,?;!-]*/i, '').trim();

        // Strip outer quotation marks if present
        const clean = text.replace(/^["']|["']$/g, '').trim();

        navigator.clipboard.writeText(clean).then(() => {
          btn.textContent = '✓';
          btn.style.color = '#00BDA5';
          setTimeout(() => { btn.textContent = '📋'; btn.style.color = ''; }, 1500);
        });
      });
    });

    // Code block copy buttons
    msgsEl.querySelectorAll('.sp-code-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.closest('pre')?.querySelector('code')?.textContent || '';
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1500);
        });
      });
    });

    // Save answer buttons
    msgsEl.querySelectorAll('.sp-chat-save-answer').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const answer = history[idx]?.content || '';
        let question = '';
        for (let i = idx - 1; i >= 0; i--) {
          if (history[i]?.role === 'user') { question = typeof history[i].content === 'string' ? history[i].content : history[i].content; break; }
        }
        chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
          const st = storyTime || {};
          st.answerPatterns = st.answerPatterns || [];
          if (st.answerPatterns.length >= 50) st.answerPatterns.shift();
          st.answerPatterns.push({
            question: question.slice(0, 200),
            text: answer.slice(0, 500),
            company: companyNameEl?.textContent || '',
            date: new Date().toISOString().slice(0, 10),
            source: 'manual-save'
          });
          chrome.storage.local.set({ storyTime: st }, () => {
            btn.textContent = '✓ Saved';
            btn.style.color = '#15803d';
            btn.disabled = true;
            setTimeout(() => { btn.textContent = '💾 Save'; btn.style.color = ''; btn.disabled = false; }, 2000);
          });
        });
      });
    });
  }

  function buildChatContext() {
    const company = companyNameEl?.textContent || '';
    const entry = currentSavedEntry || {};
    const research = currentResearch || {};
    const isManuallyBound = !!(_boundEntryId || _manualLinkId);
    return {
      todayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      todayTimestamp: Date.now(),
      // When the user has explicitly bound Coop to an entry, force full-context routing
      // so meetings/emails/transcripts always flow through — never stripped by tier routing.
      _manualBind: isManuallyBound,
      type: currentJobTitle ? 'job' : 'company',
      company,
      jobTitle: currentJobTitle || entry.jobTitle || null,
      status: entry.status || null,
      notes: entry.notes || null,
      tags: entry.tags || [],
      intelligence: research.intelligence || entry.intelligence || null,
      jobMatch: research.jobMatch || entry.jobMatch || null,
      matchFeedback: entry.matchFeedback || null,
      jobDescription: currentJobDescription || entry.jobDescription || null,
      roleBrief: entry.roleBrief || entry.jobMatch?.roleBrief || null,
      jobSnapshot: entry.jobSnapshot || null,
      reviews: research.reviews || entry.reviews || [],
      leaders: research.leaders || entry.leaders || [],
      employees: research.employees || entry.employees || null,
      funding: research.funding || entry.funding || null,
      knownContacts: entry.knownContacts || [],
      emails: (entry.cachedEmails || []).slice(0, 20).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet })),
      meetings: entry.cachedMeetings || [],
      granolaNote: entry.cachedMeetingTranscript || entry.cachedMeetingNotes ||
        ((entry.cachedMeetings || []).map(m => m && (m.transcript || m.summary)).filter(Boolean).join('\n\n---\n\n') || null),
      _applicationMode: isApplicationMode,
      _questionArchetype: null, // set by send() after classification
      currentTabUrl: tabContextActive ? currentUrl : null,
      tabContext: tabContextActive ? tabContextLabel : null,
    };
  }

  // ── Question Archetype Classifier (application mode) ────────────────────────
  const FACTUAL_PATTERNS = [
    { pattern: /\b(what|which)\s+(city|town|metro|location|state|area)\b|where\s+(are you|do you)\s+(based|located|live)|current\s+(city|location)/i, key: 'location' },
    { pattern: /linkedin\s*(url|profile|link|page)|your\s+linkedin/i, key: 'linkedin' },
    { pattern: /github\s*(url|profile|link|page)|your\s+github/i, key: 'github' },
    { pattern: /portfolio\s*(url|site|link|page|website)|personal\s*(site|website|page)/i, key: 'portfolio' },
    { pattern: /\b(salary|compensation|pay)\s*(expectation|requirement|range|desire)|expected\s*(salary|comp|pay|ote|base)|desired\s*(salary|comp|pay)|minimum\s*(salary|comp|base)/i, key: 'salary' },
    { pattern: /your\s*(full\s*)?name\b|first\s+name|last\s+name|legal\s+name|preferred\s+name/i, key: 'name' },
    { pattern: /email\s*(address)?$|your\s+email|contact\s+email|preferred\s+email/i, key: 'email' },
    { pattern: /phone\s*(number)?$|your\s+phone|mobile\s*(number)?|contact\s+number/i, key: 'phone' },
    { pattern: /when\s+can\s+you\s+start|start\s+date|earliest\s+(start|available)|available\s+to\s+(start|begin)|notice\s+period/i, key: 'startDate' },
    { pattern: /work\s+(authorization|auth)|authorized\s+to\s+work|visa\s+(status|sponsor|require)|citizen|do you\s+require\s+sponsor|immigration/i, key: 'workAuth' },
    { pattern: /willing\s*to\s*relocate|open\s*to\s*(relocation|relocating)|relocation/i, key: 'relocation' },
    { pattern: /years?\s+of\s+experience|how\s+(many|long)\s+(years?|have you)/i, key: 'experience' },
  ];

  const ARCHETYPE_PATTERNS = [
    { pattern: /why\s+(this|our|the)\s+(company|team|org|role|position|opportunity)|what\s+(excites|interests|attracts|draws|appeals)\s+you|why\s+are\s+you\s+interested/i, archetype: 'motivation' },
    { pattern: /tell\s+(me|us)\s+about\s+a\s+time|describe\s+a\s+(time|situation|scenario)|give\s+(me|us)\s+an?\s+example|walk\s+(me|us)\s+through/i, archetype: 'behavioral' },
    { pattern: /describe\s+your\s+(approach|process|method|experience\s+with)|how\s+would\s+you\s+(approach|handle|solve|build|design|implement)|technical\s+(approach|assessment)/i, archetype: 'technical' },
    { pattern: /why\s+(sales|this\s+career|career\s+change|are\s+you\s+leaving|did\s+you\s+leave)|what\s+motivates\s+you|tell\s+(me|us)\s+about\s+yourself/i, archetype: 'motivation' },
    { pattern: /anything\s+else|additional\s+information|is\s+there\s+anything|what\s+else\s+should\s+we\s+know/i, archetype: 'freeform' },
    { pattern: /cover\s+letter/i, archetype: 'motivation' },
  ];

  function classifyQuestion(text) {
    const trimmed = text.trim();
    // Check factual patterns first
    for (const { pattern, key } of FACTUAL_PATTERNS) {
      if (pattern.test(trimmed)) return { type: 'factual', key };
    }
    // Check narrative archetypes
    for (const { pattern, archetype } of ARCHETYPE_PATTERNS) {
      if (pattern.test(trimmed)) return { type: archetype, key: null };
    }
    return { type: 'freeform', key: null };
  }

  async function tryFactualAnswer(key) {
    const data = await new Promise(r => {
      chrome.storage.sync.get(['prefs'], sync => {
        chrome.storage.local.get(['profileLinks'], local => r({ prefs: sync.prefs || {}, links: local.profileLinks || {} }));
      });
    });
    const p = data.prefs;
    const l = data.links;
    switch (key) {
      case 'location': {
        const parts = [p.locationCity, p.locationState].filter(Boolean);
        return parts.length ? parts.join(', ') : null;
      }
      case 'linkedin': return l.linkedin || p.linkedinUrl || null;
      case 'github': return l.github || null;
      case 'portfolio': return l.portfolio || l.website || null;
      case 'salary': {
        const floor = p.salaryFloor;
        const strong = p.salaryStrong;
        if (floor && strong) return `$${floor} - $${strong}`;
        if (floor) return `$${floor}+`;
        return null;
      }
      case 'name': return p.name || p.fullName || null;
      case 'email': return l.email || null;
      case 'phone': return l.phone || null;
      case 'startDate': return null; // Not stored in prefs — let LLM handle
      case 'workAuth': return null; // Not stored — let LLM handle
      case 'relocation': return null; // Not stored — let LLM handle
      case 'experience': return null; // Needs profile context — let LLM handle
      default: return null;
    }
  }

  async function send() {
    const text = inputEl.value.trim();
    console.log('[SP Chat] Send called, text:', text?.slice(0, 50));
    if (!text) return;
    // Detect application mode from user message
    if (/help me (apply|answer|fill)|application (question|field)/i.test(text)) {
      isApplicationMode = true;
      updateAppModeBadge();
    }
    inputEl.value = '';
    inputEl.style.height = '';
    history.push({ role: 'user', content: text });
    renderMessages(true);
    sendBtn.disabled = true;
    if (typeof CISounds !== 'undefined') CISounds.send();

    // Application mode: try factual auto-answer before hitting the API
    if (isApplicationMode) {
      const classification = classifyQuestion(text);
      if (classification.type === 'factual' && classification.key) {
        const factualAnswer = await tryFactualAnswer(classification.key);
        if (factualAnswer) {
          history.push({ role: 'assistant', content: factualAnswer });
          renderMessages();
          sendBtn.disabled = false;
          if (typeof CISounds !== 'undefined') CISounds.receive();
          console.log('[SP Chat] Factual auto-answer for:', classification.key);
          return;
        }
      }
    }

    // If a manual bind is active, refresh currentSavedEntry from storage so we always
    // pull the latest cachedMeetings/cachedEmails/transcripts written by company.js
    const boundId = _boundEntryId || _manualLinkId;
    if (boundId) {
      try {
        const fresh = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
        const found = (fresh.savedCompanies || []).find(c => c.id === boundId);
        if (found) currentSavedEntry = found;
      } catch (e) {}
    }

    const context = buildChatContext();
    // Classify question archetype for application mode
    if (isApplicationMode) {
      const classification = classifyQuestion(text);
      if (classification.type !== 'factual') {
        context._questionArchetype = classification.type; // motivation, behavioral, technical, freeform
      }
    }
    console.log('[SP Chat] Context built — bound:', !!boundId, 'meetings:', context.meetings?.length, 'granolaNote:', context.granolaNote ? context.granolaNote.length + ' chars' : 'null');
    // Fetch visible page content from the active tab if tab sharing is on
    if (tabContextActive) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const [{ result: pageText }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body.innerText?.slice(0, 4000) || ''
          });
          if (pageText) context.visiblePageContent = pageText;
        }
      } catch (e) { /* content script may not have access — that's fine */ }
    }

    // Capture screenshot if screen sharing is active
    if (screenShareActive) {
      try {
        let dataUrl = null;
        // Prefer getDisplayMedia stream frame if available
        if (_displayStream?.active && screenToggle._video?.readyState >= 2) {
          const video = screenToggle._video;
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 800 / video.videoWidth);
          canvas.width = video.videoWidth * scale;
          canvas.height = video.videoHeight * scale;
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        } else {
          // Fallback to tab capture
          dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 40 });
        }
        if (dataUrl) {
          const compressed = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          // Send screenshot via port AND store on context as fallback
          try {
            const port = chrome.runtime.connect({ name: 'coop-screenshot' });
            port.postMessage({ screenshot: compressed });
            port.disconnect();
          } catch (e) { console.warn('[ScreenShare] Port send failed:', e.message); }
          if (screenPreviewImg) screenPreviewImg.src = dataUrl;
          if (screenPreview) screenPreview.classList.add('visible');
          if (screenFlash) { screenFlash.classList.remove('flash'); void screenFlash.offsetWidth; screenFlash.classList.add('flash'); }
          history[history.length - 1]._screenshot = true;
          context._hasScreenshot = true;
          context.hasScreenshot = true;
          context._screenshotData = compressed;
          await new Promise(r => setTimeout(r, 150));
          console.log(`[ScreenShare] Sent ${Math.round(compressed.length / 1024)}KB screenshot`);
        }
      } catch (e) { console.warn('[ScreenShare] Capture failed:', e.message); }
    }

    // Attach pending snip if available (one-shot — clears after use)
    if (_pendingSnip && !context._hasScreenshot) {
      try {
        const port = chrome.runtime.connect({ name: 'coop-screenshot' });
        port.postMessage({ screenshot: _pendingSnip });
        port.disconnect();
      } catch (e) { /* ignore */ }
      history[history.length - 1]._screenshot = true;
      context._hasScreenshot = true;
      context.hasScreenshot = true;
      context._screenshotData = _pendingSnip;
      await new Promise(r => setTimeout(r, 150));
      console.log(`[Snip] Attached ${Math.round(_pendingSnip.length / 1024)}KB snip to message`);
      _pendingSnip = null;
      if (screenPreview) screenPreview.classList.remove('visible');
    }

    // Text-only messages through the channel — screenshot read from memory by background.js
    const apiMessages = history.map(m => ({ role: m.role, content: m.content }));

    let result;
    try {
      result = await Promise.race([
        new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', messages: apiMessages, context, chatModel: spAvailableModels[chatModelIdx].id }, r => {
            if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
            else resolve(r);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000))
      ]);
    } catch (e) {
      result = { error: e.message === 'timeout' ? 'Request timed out.' : e.message };
    }

    sendBtn.disabled = false;
    if (typeof CISounds !== 'undefined') {
      if (result?.error) CISounds.error();
      else CISounds.receive();
    }
    // If the backend fell back to a different model, show which one was used
    const replyText = result?.reply || result?.error || 'Something went wrong.';
    const fallbackNote = (result?.model && result.model !== spAvailableModels[chatModelIdx].id)
      ? `\n\n*— answered by ${result.model.includes('gpt') ? 'GPT-4.1 mini' : result.model} (fallback)*`
      : '';
    const msgEntry = { role: 'assistant', content: replyText + fallbackNote };
    // Store usage metadata for display
    if (result?.usage) msgEntry._usage = result.usage;
    if (result?.model) msgEntry._model = result.model;
    if (result?.routed) msgEntry._routed = result.routed;
    if (result?.toolCalls) msgEntry._toolCalls = result.toolCalls;
    if (result?.contextManifest) msgEntry._contextManifest = result.contextManifest;
    history.push(msgEntry);
    renderMessages();
    generateFollowUpChips(replyText);
  }

  // ── Follow-up suggestion chips ────────────────────────────────────────────
  function generateFollowUpChips(lastReply) {
    if (_coopConfig.automations?.followUpChips === false) return;
    // Remove any existing chips
    document.getElementById('sp-followup-chips')?.remove();
    // Ask the model for 2-3 short follow-up questions based on the last reply
    const context = history.slice(-4).map(m => `${m.role}: ${(m.content || '').slice(0, 400)}`).join('\n');
    chrome.runtime.sendMessage({
      type: 'COOP_CHAT',
      messages: [{ role: 'user', content: `Based on this conversation, suggest exactly 3 very short follow-up questions the user might want to ask next. Return ONLY a JSON array of strings, no explanation. Each question max 8 words.\n\n${context}` }],
      globalChat: true,
      chatModel: 'gpt-4.1-nano',
    }, result => {
      if (!result?.reply) return;
      let chips;
      try {
        const cleaned = result.reply.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
        chips = JSON.parse(cleaned);
        if (!Array.isArray(chips)) return;
      } catch { return; }
      chips = chips.slice(0, 3).filter(c => typeof c === 'string' && c.trim());
      if (!chips.length) return;
      const container = document.createElement('div');
      container.id = 'sp-followup-chips';
      container.className = 'sp-followup-chips';
      container.innerHTML = chips.map(c =>
        `<button class="sp-followup-chip" data-prompt="${c.replace(/"/g, '&quot;')}">${c}</button>`
      ).join('');
      container.querySelectorAll('.sp-followup-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          inputEl.value = btn.dataset.prompt;
          inputEl.dispatchEvent(new Event('input'));
          container.remove();
          send();
        });
      });
      msgsEl.appendChild(container);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    });
  }

  // ── @ Mention autocomplete ──
  const mentionDropdown = document.getElementById('sp-mention-dropdown');
  let mentionActive = false;
  let mentionStartIdx = -1;
  let mentionSelectedIdx = 0;
  let mentionEntries = [];

  // ── Quick prompts button ──────────────────────────────────────────────────
  const promptsBtn = document.getElementById('sp-prompts-btn');
  if (promptsBtn) {
    promptsBtn.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('sp-prompts-dropdown')?.remove();
      if (!_quickPrompts.length) return;
      const dd = document.createElement('div');
      dd.id = 'sp-prompts-dropdown';
      dd.className = 'sp-prompts-dropdown';
      dd.innerHTML = _quickPrompts.map(p =>
        `<button class="sp-prompts-dropdown-item" data-prompt="${p.prompt.replace(/"/g, '&quot;')}">${p.label}</button>`
      ).join('');
      promptsBtn.closest('.sp-chat-input-row').appendChild(dd);
      dd.querySelectorAll('.sp-prompts-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          inputEl.value = item.dataset.prompt;
          inputEl.dispatchEvent(new Event('input'));
          dd.remove();
          inputEl.focus();
        });
      });
      document.addEventListener('click', () => dd.remove(), { once: true });
    });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !mentionActive) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
    // Toggle send button active state
    sendBtn.classList.toggle('has-text', inputEl.value.trim().length > 0);
    // @ mention detection
    handleMentionInput();
  });

  function handleMentionInput() {
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    // Find the last @ before cursor that isn't preceded by a word char
    const before = val.slice(0, cursor);
    const atMatch = before.match(/(^|[\s(])@([^\s@]*)$/);
    if (!atMatch) { closeMentionDropdown(); return; }
    mentionStartIdx = before.lastIndexOf('@');
    const query = atMatch[2].toLowerCase();
    // Load saved companies and filter
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const entries = (savedCompanies || []).filter(c => c.company);
      const filtered = query
        ? entries.filter(c => c.company.toLowerCase().includes(query) || (c.jobTitle || '').toLowerCase().includes(query))
        : entries.slice(0, 12);
      // Sort: exact prefix first, then alphabetical
      filtered.sort((a, b) => {
        const aPrefix = a.company.toLowerCase().startsWith(query) ? 0 : 1;
        const bPrefix = b.company.toLowerCase().startsWith(query) ? 0 : 1;
        return aPrefix - bPrefix || a.company.localeCompare(b.company);
      });
      mentionEntries = filtered.slice(0, 10);
      mentionSelectedIdx = 0;
      renderMentionDropdown();
    });
  }

  function renderMentionDropdown() {
    if (!mentionEntries.length) {
      mentionDropdown.innerHTML = '<div class="sp-mention-empty">No matching companies</div>';
      mentionDropdown.classList.add('visible');
      mentionActive = true;
      return;
    }
    mentionDropdown.innerHTML = mentionEntries.map((e, i) => {
      const stage = e.jobStage || e.status || '';
      const stageHTML = stage ? `<span class="sp-mention-item-stage">${stage.replace(/_/g, ' ')}</span>` : '';
      const meta = e.isOpportunity && e.jobTitle ? e.jobTitle : (e.industry || '');
      return `<div class="sp-mention-item${i === mentionSelectedIdx ? ' active' : ''}" data-idx="${i}">
        <span class="sp-mention-item-name">${escHtml(e.company)}</span>
        ${meta ? `<span class="sp-mention-item-meta">${escHtml(meta)}</span>` : ''}
        ${stageHTML}
      </div>`;
    }).join('');
    mentionDropdown.classList.add('visible');
    mentionActive = true;
    // Click handler for items
    mentionDropdown.querySelectorAll('.sp-mention-item').forEach(el => {
      el.addEventListener('mousedown', ev => {
        ev.preventDefault(); // don't blur input
        selectMention(parseInt(el.dataset.idx));
      });
    });
  }

  function selectMention(idx) {
    const entry = mentionEntries[idx];
    if (!entry) return;
    const val = inputEl.value;
    const before = val.slice(0, mentionStartIdx);
    const after = val.slice(inputEl.selectionStart);
    const insertText = `@${entry.company} `;
    inputEl.value = before + insertText + after;
    inputEl.selectionStart = inputEl.selectionEnd = before.length + insertText.length;
    closeMentionDropdown();
    inputEl.focus();
    sendBtn.classList.toggle('has-text', inputEl.value.trim().length > 0);
  }

  function closeMentionDropdown() {
    mentionDropdown.classList.remove('visible');
    mentionActive = false;
    mentionEntries = [];
  }

  // Keyboard navigation for mention dropdown
  inputEl.addEventListener('keydown', e => {
    if (!mentionActive || !mentionEntries.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionSelectedIdx = (mentionSelectedIdx + 1) % mentionEntries.length;
      renderMentionDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionSelectedIdx = (mentionSelectedIdx - 1 + mentionEntries.length) % mentionEntries.length;
      renderMentionDropdown();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectMention(mentionSelectedIdx);
    } else if (e.key === 'Escape') {
      closeMentionDropdown();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      selectMention(mentionSelectedIdx);
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.sp-mention-dropdown') && e.target !== inputEl) closeMentionDropdown();
  });

  // Quick action buttons (clear in bottom bar)
  chatEl.addEventListener('click', e => {
    if (e.target.closest('[data-action="clear"]')) {
      history = [];
      isApplicationMode = false;
      updateAppModeBadge();
      renderMessages();
    }
  });

  // ── View CRM button — navigate to full-page dashboard ──
  if (popoutBtn) {
    popoutBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent bubbling to chatHeader minimize handler
      chrome.tabs.create({ url: chrome.runtime.getURL('saved.html') });
    });
  }

  const inputRow = chatEl.querySelector('.sp-chat-input-row');
  const sizeUpBtn = document.getElementById('sp-chat-size-up');
  const sizeDownBtn = document.getElementById('sp-chat-size-down');

  function getCurrentChatSize() {
    if (document.body.classList.contains('chat-mode')) return 'full';
    if (document.body.classList.contains('chat-half')) return 'half';
    if (document.body.classList.contains('chat-minimized')) return 'minimized';
    return null;
  }

  function setChatSize(size) {
    // size: 'full' | 'half' | 'minimized' | null (close)
    _applyTopLevelChatSize(size); // sets body class + localStorage
    // Reconcile inline styles — CSS handles full/half sizing, inline handles minimized
    if (size === 'full' || size === 'half') {
      msgsEl.style.display = '';
      msgsEl.style.maxHeight = '';
      msgsEl.style.minHeight = '';
      msgsEl.style.height = '';
      if (inputRow) inputRow.style.display = '';
      setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 50);
    } else if (size === 'minimized') {
      msgsEl.style.display = 'none';
      if (inputRow) inputRow.style.display = '';
    } else {
      chatEl.style.display = '';
    }
    updateSizeBtns();
  }

  function updateSizeBtns() {
    const size = getCurrentChatSize();
    if (sizeUpBtn) sizeUpBtn.disabled = size === 'full';
    if (sizeDownBtn) sizeDownBtn.disabled = size === null;
  }

  // Initial state: if body class was set by _applyTopLevelChatSize before IIFE ran,
  // reconcile inline styles now.
  const _initSize = getCurrentChatSize();
  if (_initSize === 'full' || _initSize === 'half') {
    msgsEl.style.display = '';
    msgsEl.style.maxHeight = '';
    msgsEl.style.minHeight = '';
    msgsEl.style.height = '';
    if (inputRow) inputRow.style.display = '';
  } else if (_initSize === 'minimized') {
    msgsEl.style.display = 'none';
    if (inputRow) inputRow.style.display = '';
  }
  updateSizeBtns();

  sizeUpBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = getCurrentChatSize();
    const idx = CHAT_SIZES.indexOf(cur);
    if (idx < CHAT_SIZES.length - 1) setChatSize(CHAT_SIZES[idx + 1]);
  });

  sizeDownBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = getCurrentChatSize();
    const idx = CHAT_SIZES.indexOf(cur);
    if (idx > 0) setChatSize(CHAT_SIZES[idx - 1]);
    else setChatSize(null); // close chat from minimized
  });

  // Click header title to cycle size
  const chatHeader = chatEl.querySelector('.sp-chat-header');
  chatHeader?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.sp-model-toggle')) return;
    const cur = getCurrentChatSize();
    const idx = CHAT_SIZES.indexOf(cur);
    // cycle forward, wrap around
    setChatSize(CHAT_SIZES[(idx + 1) % CHAT_SIZES.length]);
  });

  // Show chat when company is detected. Use 'flex' for full/half modes so that
  // .sp-inline-chat remains a flex item and the messages container can scroll via flex:1.
  const showChatEl = () => {
    const size = getCurrentChatSize();
    chatEl.style.display = (size === 'full' || size === 'half') ? 'flex' : (size === 'minimized' ? 'flex' : 'block');
  };
  const observer = new MutationObserver(() => {
    if (companyNameEl.textContent && companyNameEl.textContent !== 'Detecting…') {
      showChatEl();
      updateTabIndicator();
      // Re-render empty state with fresh context-aware suggestions
      if (history.length === 0) renderMessages();
    }
  });
  observer.observe(companyNameEl, { childList: true, characterData: true, subtree: true });
  if (companyNameEl.textContent && companyNameEl.textContent !== 'Detecting…') {
    showChatEl();
    updateTabIndicator();
  }

  // Handle popout mode — if opened as ?popout=1, restore history and show full chat
  if (new URLSearchParams(window.location.search).get('popout') === '1') {
    setChatSize('full');
    chatEl.style.display = 'flex';
    // Hide back + pop-out buttons in pop-out window
    if (popoutBtn) popoutBtn.style.display = 'none';
    const backBtn = document.getElementById('sp-chat-back');
    if (backBtn) backBtn.style.display = 'none';
    // Restore history + context from storage
    chrome.storage.local.get(['_coopPopoutHistory', '_coopPopoutModel', '_coopPopoutContext'], data => {
      if (data._coopPopoutHistory) {
        try { history = JSON.parse(data._coopPopoutHistory); } catch {}
      }
      if (typeof data._coopPopoutModel === 'number') chatModelIdx = data._coopPopoutModel;
      // Restore company/opportunity context so Coop stays connected
      if (data._coopPopoutContext) {
        const ctx = data._coopPopoutContext;
        if (ctx.company) companyNameEl.textContent = ctx.company;
        if (ctx.jobTitle) currentJobTitle = ctx.jobTitle;
        if (ctx.tabUrl) currentUrl = ctx.tabUrl;
        if (ctx.entryId) {
          chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
            const entry = (savedCompanies || []).find(c => c.id === ctx.entryId);
            if (entry) {
              currentSavedEntry = entry;
              currentJobMeta = entry.jobSnapshot || null;
              if (entry.jobDescription) currentJobDescription = entry.jobDescription;
              currentResearch = {
                intelligence: entry.intelligence,
                employees: entry.employees,
                funding: entry.funding,
                industry: entry.industry,
                reviews: entry.reviews || [],
                leaders: entry.leaders || [],
                jobMatch: entry.jobMatch,
                jobSnapshot: entry.jobSnapshot,
              };
            }
          });
        }
      }
      updateModelLabel();
      renderMessages();
    });
  }

  renderMessages();

  // Re-render suggestions when context changes (e.g., manual link to saved opportunity)
  msgsEl.addEventListener('context-updated', () => {
    if (history.length === 0) renderMessages();
  });

  // Listen for INSIGHTS_CAPTURED broadcasts and annotate the last assistant message
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'INSIGHTS_CAPTURED' && msg.insights?.length) {
      const allMsgs = msgsEl.querySelectorAll('.sp-chat-msg-assistant');
      const lastMsg = allMsgs[allMsgs.length - 1];
      if (lastMsg) {
        if (lastMsg.querySelector('.insight-annotation')) return;
        const annotationHtml = `<div class="insight-annotation">
          <span class="insight-check">✓</span>
          <span class="insight-text">Learned: ${msg.insights.map(t => t.length > 60 ? t.slice(0, 57) + '...' : t).join('; ')}</span>
        </div>`;
        lastMsg.insertAdjacentHTML('beforeend', annotationHtml);
      }
    }
  });
})();

// ── Celebrations (for stage changes in sidepanel) ──────────────────────────

let _spStageCelebrations = {};
chrome.storage.local.get(['stageCelebrations'], d => { if (d.stageCelebrations) _spStageCelebrations = d.stageCelebrations; });

function _spGetDefaultCeleb(key) {
  if (/applied/i.test(key)) return { type: 'thumbsup', sound: 'pop', count: 15 };
  if (/conversations?|mutual/i.test(key)) return { type: 'confetti', sound: 'pop', count: 30 };
  if (/offer|accepted|referral/i.test(key)) return { type: 'money', sound: 'chaching', count: 40 };
  if (/stalled/i.test(key)) return { type: 'stopsign', sound: 'none', count: 20 };
  if (/rejected|closed|dq/i.test(key)) return { type: 'peace', sound: 'farewell', count: 25 };
  return null;
}

const _SP_EMOJI_MAP = {
  thumbsup:'👍', money:'🤑', peace:'✌️', stopsign:'🛑', fire:'🔥', rocket:'🚀',
  star:'⭐', heart:'❤️', clap:'👏', trophy:'🏆', lightning:'⚡', muscle:'💪',
  party:'🥳', champagne:'🍾', crown:'👑', gem:'💎', skull:'💀', wave:'👋',
  eyes:'👀', hundred:'💯', sparkles:'✨', fireworks:'🎆', unicorn:'🦄',
  cake:'🎂', medal:'🥇', rainbow:'🌈', bell_emoji:'🛎️', cool:'😎',
};

function _spShowCelebrationBanner(stageLabel, emoji) {
  try {
    const existing = document.getElementById('ci-celebration-banner');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'ci-celebration-banner';
    el.style.cssText = [
      'position:fixed','left:50%','top:18%','transform:translate(-50%,-12px) scale(0.9)',
      'background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%)',
      'border:1px solid #fdba74','border-radius:12px','padding:11px 16px',
      'box-shadow:0 14px 36px rgba(255,122,89,0.28),0 4px 14px rgba(0,0,0,0.08)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:13px','font-weight:700','color:#9a3412',
      'z-index:99998','pointer-events:none','opacity:0',
      'display:flex','align-items:center','gap:10px',
      'transition:opacity 260ms ease, transform 260ms cubic-bezier(.2,1.4,.4,1)',
    ].join(';');
    el.innerHTML = `<span style="font-size:20px;line-height:1;">${emoji}</span><span>Moved to <span style="color:#ff7a59;">${stageLabel}</span></span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%, 0) scale(1)'; });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -8px) scale(0.96)';
      setTimeout(() => el.remove(), 320);
    }, 1700);
  } catch(e) {}
}

function _spFireCelebration(stageKey) {
  const cfg = _spStageCelebrations[stageKey] || _spGetDefaultCeleb(stageKey);
  if (!cfg || cfg.type === 'none') return;
  const { type, sound, count } = cfg;
  // Banner — uses stage label from oppStages if available
  try {
    const stageLabel = (typeof oppStages !== 'undefined' && oppStages?.find?.(s => s.key === stageKey)?.label) || stageKey;
    _spShowCelebrationBanner(stageLabel, _SP_EMOJI_MAP[type] || '🎊');
  } catch(e) {}

  if (sound === 'pop') { try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.setValueAtTime(600, c.currentTime); o.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.1); g.gain.setValueAtTime(0.3, c.currentTime); g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.15); o.start(); o.stop(c.currentTime + 0.15); } catch(e) {} }
  else if (sound === 'chaching') { try { const c = new AudioContext(); const t = c.currentTime; [800,1200,1600].forEach((f,i) => { const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = f; g.gain.setValueAtTime(0.2, t+i*0.12); g.gain.exponentialRampToValueAtTime(0.01, t+i*0.12+0.2); o.start(t+i*0.12); o.stop(t+i*0.12+0.2); }); } catch(e) {} }
  else if (sound === 'farewell') { try { const u = new SpeechSynthesisUtterance(['peace','adios','see ya','bye'][Math.floor(Math.random()*4)]); u.rate=1.1; u.pitch=1; u.volume=0.6; speechSynthesis.speak(u); } catch(e) {} }

  const colors = ['#ff4444','#ffbb00','#00cc88','#4488ff','#cc44ff','#ff8844','#00ccff','#ffcc00'];
  const isEmoji = type !== 'confetti' && type in _SP_EMOJI_MAP;
  const baseEmoji = _SP_EMOJI_MAP[type] || '🎊';
  const n = count || 30;
  const particles = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font-size:' + (isEmoji ? '22px' : '10px') + ';';
    if (isEmoji) el.textContent = type === 'money' && Math.random() > 0.5 ? '💵' : baseEmoji;
    else { el.style.width = '8px'; el.style.height = '8px'; el.style.borderRadius = '2px'; el.style.background = colors[i % colors.length]; }
    document.body.appendChild(el);
    particles.push({ el, x: window.innerWidth/2 + (Math.random()-0.5)*200, y: window.innerHeight, vx: (Math.random()-0.5)*12, vy: -(Math.random()*14+8), life: 1 });
  }
  function animate() {
    let alive = 0;
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= 0.008;
      p.el.style.left = p.x+'px'; p.el.style.top = p.y+'px'; p.el.style.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.el.remove(); else alive++;
    }
    if (alive > 0) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ── Queue Save Buttons ──────────────────────────────────────────────────────

function queueSaveEntry(callback, { triggerResearch = false } = {}) {
  const company = companyNameEl.textContent;

  // Re-request JD from content script before saving (handles race where JD wasn't ready yet)
  const saveWithJD = (jd) => {
    if (jd && !currentJobDescription) currentJobDescription = jd;

    chrome.runtime.sendMessage({
      type: 'SAVE_OPPORTUNITY',
      company,
      jobTitle: currentJobTitle || null,
      jobUrl: detectedJobUrl || currentUrl || null,
      jobDescription: currentJobDescription || null,
      jobMeta: currentJobMeta || (currentResearch?.jobSnapshot ? { ...currentResearch.jobSnapshot } : null),
      linkedinFirmo: detectedLinkedinFirmo || null,
      source: 'sidepanel',
      triggerResearch,
    }, (resp) => {
      void chrome.runtime.lastError;
      if (!resp || resp.error) {
        console.error('[SP] SAVE_OPPORTUNITY error:', resp?.error);
        return;
      }

      const entry = resp.entry;

      // Mark UI as saved
      saveJobBtn.textContent = '✓ Saved';
      saveJobBtn.classList.add('saved');
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('saved');

      if (resp.isDuplicate) {
        showToast(`Updated existing opportunity at ${entry.company}`);
      }

      // Compute structural matches
      loadPrefsWithMigration((prefs) => {
        chrome.runtime.sendMessage(
          { type: 'COMPUTE_STRUCTURAL_MATCHES', entry, prefs: prefs || currentPrefs || {} },
          (matches) => {
            void chrome.runtime.lastError;
            if (matches) {
              chrome.storage.local.get(['savedCompanies'], ({ savedCompanies: latest }) => {
                const entries = latest || [];
                const idx = entries.findIndex(c => c.id === entry.id);
                if (idx !== -1) {
                  Object.assign(entries[idx], { structuralMatches: matches });
                  chrome.storage.local.set({ savedCompanies: entries });
                }
              });
            }
          }
        );
      });

      // Track in session
      _sessionSaves.push({
        id: entry.id,
        company: entry.company,
        jobTitle: entry.jobTitle,
        fitScore: null,
        fitReason: null,
      });

      showPipelineStats();
      showCrmLink(entry);
      callback(entry);
    });
  };

  // Try to get JD from content script if we don't have it yet
  if (!currentJobDescription && currentJobTitle) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) { saveWithJD(null); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_DESCRIPTION' }, (resp) => {
        void chrome.runtime.lastError;
        saveWithJD(resp?.jobDescription || null);
      });
    });
  } else {
    saveWithJD(null);
  }
}

function renderQueueConfirmation(entry) {
  const panel = document.getElementById('queue-save-confirm');
  const queuePanel = document.getElementById('queue-save-panel');
  if (!panel) return;
  if (queuePanel) queuePanel.style.display = 'none';
  savePanel.classList.remove('visible');

  // Bug 2: Hide all research content so confirmation is the only visible content
  const jobContent = document.getElementById('job-content');
  const companyContent = document.getElementById('company-content');
  const jobOpp = document.getElementById('job-opportunity');
  if (jobContent) jobContent.style.display = 'none';
  if (companyContent) companyContent.style.display = 'none';
  if (jobOpp) jobOpp.style.display = 'none';
  saveJobBtn.style.display = 'none';

  // Bug 6: Reset saveRating and clear old save-panel stars
  saveRating = 0;
  document.querySelectorAll('.save-star').forEach(s => s.classList.remove('filled'));

  let confirmRating = 0;
  let confirmTags = [...(entry.tags || [])];

  function renderTags() {
    const tagsEl = panel.querySelector('.confirm-tags');
    if (!tagsEl) return;
    tagsEl.innerHTML = confirmTags.map(t =>
      `<span class="confirm-tag">${t}<span class="remove-tag" data-tag="${t}">✕</span></span>`
    ).join('') + `<span class="confirm-add-tag" id="confirm-add-tag-btn">+ Add</span>`;
    tagsEl.querySelectorAll('.remove-tag').forEach(el => {
      el.addEventListener('click', () => {
        confirmTags = confirmTags.filter(t => t !== el.dataset.tag);
        renderTags();
        autoSaveConfirmField(entry.id, { tags: [...confirmTags] });
      });
    });
    const addBtn = tagsEl.querySelector('#confirm-add-tag-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const tag = prompt('Add tag:');
        if (tag && tag.trim() && !confirmTags.includes(tag.trim())) {
          confirmTags.push(tag.trim());
          renderTags();
          autoSaveConfirmField(entry.id, { tags: [...confirmTags] });
        }
      });
    }
  }

  function renderStars() {
    const starsEl = panel.querySelector('.confirm-stars');
    if (!starsEl) return;
    starsEl.innerHTML = [1,2,3,4,5].map(v =>
      `<span class="confirm-star${v <= confirmRating ? ' filled' : ''}" data-val="${v}">&#9733;</span>`
    ).join('');
    starsEl.querySelectorAll('.confirm-star').forEach(star => {
      star.addEventListener('mouseenter', () => {
        const hv = parseInt(star.dataset.val);
        starsEl.querySelectorAll('.confirm-star').forEach((s, i) => s.classList.toggle('hovered', i < hv));
      });
      star.addEventListener('click', () => {
        confirmRating = parseInt(star.dataset.val);
        renderStars();
        autoSaveConfirmField(entry.id, { rating: confirmRating });
      });
    });
    starsEl.addEventListener('mouseleave', () => {
      starsEl.querySelectorAll('.confirm-star').forEach(s => s.classList.remove('hovered'));
    });
  }

  function renderSessionFeed() {
    if (_sessionSaves.length === 0) return '';
    const items = _sessionSaves.slice().reverse().map(s => {
      let scoreCls = 'pending';
      let scoreText = '...';
      if (s.fitScore != null) {
        scoreText = s.fitScore + '/10';
        scoreCls = s.fitScore >= 7 ? 'high' : s.fitScore >= 4 ? 'mid' : 'low';
      }
      return `<div class="save-session-item" data-session-id="${s.id}">
        <div class="item-info">
          <div class="item-company">${s.company}</div>
          <div class="item-title">${s.jobTitle || ''}</div>
        </div>
        <span class="item-score ${scoreCls}">${scoreText}</span>
      </div>`;
    }).join('');
    return `<div class="save-session-feed" id="session-feed">
      <div class="feed-label">Saved this session</div>
      ${items}
    </div>`;
  }

  panel.innerHTML = `
    <div class="confirm-banner">Saved — AI fit scoring queued</div>
    <div class="confirm-company">${entry.company}</div>
    <div class="confirm-title">${entry.jobTitle || ''}</div>
    <div class="confirm-stars"></div>
    <textarea class="confirm-note" placeholder="Quick note... (optional)"></textarea>
    <div class="confirm-tags"></div>
    ${renderSessionFeed()}
  `;
  panel.style.display = 'block';

  renderStars();
  renderTags();

  // Auto-save note on blur
  const noteEl = panel.querySelector('.confirm-note');
  if (noteEl) {
    noteEl.addEventListener('blur', () => {
      autoSaveConfirmField(entry.id, { notes: noteEl.value.trim() });
    });
  }
}

function autoSaveConfirmField(entryId, changes) {
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const entries = savedCompanies || [];
    const idx = entries.findIndex(c => c.id === entryId);
    if (idx === -1) return;
    Object.assign(entries[idx], changes);
    chrome.storage.local.set({ savedCompanies: entries });
  });
}

function updateSessionFeedScore(entryId, score, reason) {
  const item = _sessionSaves.find(s => s.id === entryId);
  if (item) {
    item.fitScore = score;
    item.fitReason = reason;
  }
  // Re-render feed items in DOM if visible
  const feedEl = document.getElementById('session-feed');
  if (!feedEl) return;
  const itemEl = feedEl.querySelector(`[data-session-id="${entryId}"]`);
  if (!itemEl) return;
  const scoreEl = itemEl.querySelector('.item-score');
  if (scoreEl && score != null) {
    scoreEl.textContent = score + '/10';
    scoreEl.className = 'item-score ' + (score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low');
  }
}

// Listen for SCORE_COMPLETE messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SCORE_COMPLETE' && message.entryId) {
    updateSessionFeedScore(message.entryId, message.score, message.reason);
  }
});

// ── Open Application → Auto-bind (event-driven) ────────────────────────────
// The pending-bind IIFE only runs on fresh panel loads. If the panel is already
// open, queue.js sends this direct message so we can bind immediately without
// relying on storage polling.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'QUEUE_OPEN_APPLICATION' || !msg.entryId) return;
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const entry = (savedCompanies || []).find(e => e.id === msg.entryId);
    if (!entry) return;
    applyQueueBind(entry);
  });
});

function applyQueueBind(entry) {
  currentSavedEntry = entry;
  if (window.__coopBind?.setFromQueue) {
    window.__coopBind.setFromQueue(entry.id);
  }
  // Pre-populate research from saved data so triggerResearch short-circuits
  if (entry.intelligence || entry.employees || entry.industry) {
    currentResearch = {
      intelligence: entry.intelligence,
      employees: entry.employees,
      funding: entry.funding,
      founded: entry.founded,
      industry: entry.industry,
      companyWebsite: entry.companyWebsite,
      companyLinkedin: entry.companyLinkedin,
      reviews: entry.reviews || [],
      leaders: entry.leaders || [],
      jobMatch: entry.jobMatch,
      jobSnapshot: entry.jobSnapshot,
    };
  }
  // Show company UI immediately
  const homeEl = document.getElementById('sp-home');
  if (homeEl) homeEl.style.display = 'none';
  const companyContentEl = document.getElementById('company-content');
  if (companyContentEl) companyContentEl.style.display = '';
  const companyBarEl = document.getElementById('company-bar-toggle');
  if (companyBarEl) companyBarEl.style.display = '';
  if (companyNameEl) companyNameEl.textContent = entry.company;
  if (searchBtn) searchBtn.style.display = '';
  if (entry.jobTitle) { currentJobTitle = entry.jobTitle; currentJobMeta = entry.jobSnapshot || null; }
  updateJobTitleBar();
  if (currentResearch) renderResults(currentResearch);
  if (entry.jobMatch) renderJobOpportunity(entry.jobMatch, entry.jobSnapshot || null);
  showSaveBar();
  if (saveBtn) { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
  // Hide the queue save buttons — this entry is already saved
  const _qPanel = document.getElementById('queue-save-panel');
  if (_qPanel) _qPanel.style.display = 'none';
  showCrmLink(entry);
  console.log('[SP] Queue bind applied for:', entry.company);
}

// "Send to Coop" button
document.getElementById('save-queue-btn')?.addEventListener('click', function() {
  if (this.disabled) return;
  this.disabled = true;
  this.textContent = 'Sending...';
  queueSaveEntry((entry) => {
    renderQueueConfirmation(entry);
  });
});

// "Send to Coop + Research" button
document.getElementById('save-research-btn')?.addEventListener('click', function() {
  if (this.disabled) return;
  this.disabled = true;
  this.textContent = 'Saving & researching...';
  const qBtn = document.getElementById('save-queue-btn');
  if (qBtn) { qBtn.disabled = true; qBtn.textContent = 'Saved'; }

  queueSaveEntry((entry) => {
    // Hide confirmation — keep the existing research/scoring view
    const queueConfirm = document.getElementById('queue-save-confirm');
    if (queueConfirm) queueConfirm.style.display = 'none';
    const queuePanel = document.getElementById('queue-save-panel');
    if (queuePanel) queuePanel.style.display = 'none';

    // Full research triggered by SAVE_OPPORTUNITY handler (triggerResearch: true)
    // But we also need to render results when they come back, so poll for research completion
    const company = companyNameEl.textContent;
    const enrichDomain = (detectedDomain && !/linkedin\.com/i.test(detectedDomain)) ? detectedDomain : null;
    chrome.runtime.sendMessage(
      { type: 'RESEARCH_COMPANY', company, domain: enrichDomain, companyLinkedin: detectedCompanyLinkedin, linkedinFirmo: detectedLinkedinFirmo, prefs: currentPrefs || null },
      (response) => {
        void chrome.runtime.lastError;
        if (!response || response.error) return;
        currentResearch = response;
        renderResults(response);
        backfillEntryFromResearch(currentSavedEntry, response);

        // Re-score via the deterministic scorer now that research data is available
        if (entry.id) {
          chrome.runtime.sendMessage({ type: 'QUEUE_SCORE', entryId: entry.id });
        }
      }
    );
  }, { triggerResearch: false }); // research triggered explicitly above via RESEARCH_COMPANY
});
