// company.js — full-screen company detail view with drag-between-columns panels

let entry = null;
let allCompanies = [];
let allKnownTags = [];
let customCompanyStages = [];
let customOpportunityStages = [];
let customFieldDefs = []; // user-created fields
let gmailUserEmail = ''; // user's own Gmail address, used to exclude self from Known Contacts
let _stageCelebrations = {}; // loaded from storage for confetti/sound on stage changes
let _researchAttempted = false; // guards against repeated RESEARCH_COMPANY calls per page session

// Auto-set "Action On" based on stage
function defaultActionStatus(stageKey) {
  if (/needs_review|want_to_apply|interested/i.test(stageKey)) return 'my_court';
  if (/applied|intro_requested|conversations|offer|accepted/i.test(stageKey)) return 'their_court';
  return null;
}

function detectScheduledStatus(entry) {
  const events = entry.cachedCalendarEvents || [];
  const now = new Date();
  return events.some(e => new Date(e.start) > now);
}

const DEFAULT_FIELD_DEFS = [
  { id: 'companyWebsite',  label: 'Website',   type: 'url'  },
  { id: 'companyLinkedin', label: 'LinkedIn',  type: 'url'  },
  { id: 'employees',       label: 'Employees', type: 'text' },
  { id: 'funding',         label: 'Funding',   type: 'text' },
  { id: 'founded',         label: 'Founded',   type: 'text' },
  { id: 'industry',        label: 'Industry',  type: 'text' },
];

const DEFAULT_LAYOUT = {
  left:  ['opportunity', 'tags'],
  main:  [], // replaced by hardcoded hub tabs
  right: ['contacts', 'leadership', 'hiring'],
};

const PANEL_TITLES = {
  properties:    'Properties',
  stats:         'Company Stats',
  links:         'Links',
  tags:          'Tags',
  notes:         'Notes',
  overview:      'Overview',
  intel:         'Company Intel',
  reviews:       'Employee Reviews',
  leadership:    'Leadership',
  contacts:      'Contacts',
  opportunity:   'Overview',
  hiring:        'Hiring Signals',
  activity:      'Activity',
  chat:          'Ask AI',
};

const DEFAULT_COMPANY_STAGES = [
  { key: 'co_watchlist',  label: 'Watch List',     color: '#64748b' },
  { key: 'co_researching',label: 'Researching',    color: '#22d3ee' },
  { key: 'co_networking', label: 'Networking',     color: '#a78bfa' },
  { key: 'co_interested', label: 'Strong Interest',color: '#fb923c' },
  { key: 'co_applied',    label: 'Applied There',  color: '#60a5fa' },
  { key: 'co_archived',   label: 'Archived',       color: '#374151' },
];
const DEFAULT_OPP_STAGES = [
  { key: 'needs_review',    label: 'AI Scoring Queue',           color: '#64748b' },
  { key: 'want_to_apply',   label: 'Want to Apply',             color: '#22d3ee' },
  { key: 'applied',         label: 'Applied',                   color: '#60a5fa' },
  { key: 'intro_requested', label: 'Intro Requested',           color: '#a78bfa' },
  { key: 'conversations',   label: 'Conversations in Progress', color: '#fb923c' },
  { key: 'offer_stage',     label: 'Offer Stage',               color: '#a3e635' },
  { key: 'accepted',        label: 'Accepted',                  color: '#4ade80' },
  { key: 'rejected',        label: "Rejected / DQ'd",           color: '#f87171' },
];

let panelLayout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
let collapsedPanels = {};

// ── Bootstrap ──────────────────────────────────────────────────────────────

function init() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { showError('No company ID specified.'); return; }

  chrome.storage.local.get(['savedCompanies', 'allTags', 'companyStages', 'opportunityStages', 'customStages', 'companyFieldDefs', 'researchCache', 'gmailUserEmail', 'stageCelebrations'], data => {
    if (data.stageCelebrations) _stageCelebrations = data.stageCelebrations;
    allCompanies = data.savedCompanies || [];
    // Derive tags from actual entries — allTags can get stale if tags are removed from entries
    allKnownTags = [...new Set(allCompanies.flatMap(c => c.tags || []))].sort();
    customCompanyStages     = data.companyStages     || DEFAULT_COMPANY_STAGES;
    customOpportunityStages = data.opportunityStages || data.customStages || DEFAULT_OPP_STAGES;
    // Migration: rename old "Needs Review" labels → "AI Scoring Queue"
    if (customOpportunityStages[0]?.key === 'needs_review' && /needs.review/i.test(customOpportunityStages[0].label)) {
      customOpportunityStages[0].label = 'AI Scoring Queue';
      chrome.storage.local.set({ opportunityStages: customOpportunityStages });
    }
    customFieldDefs = data.companyFieldDefs || [];
    entry = allCompanies.find(c => c.id === id);
    if (!entry) { showError('Company not found.'); return; }

    gmailUserEmail = (data.gmailUserEmail || entry.gmailUserEmail || '').toLowerCase();

    // Deduplicate existing contacts by name (merges split records like two Noah Maffitts)
    if (entry.knownContacts?.length) {
      const deduped = deduplicateContacts(entry.knownContacts);
      if (deduped.length !== entry.knownContacts.length) {
        entry = { ...entry, knownContacts: deduped };
        saveEntry({ knownContacts: deduped });
      }
    }

    // Extract contacts from cached emails immediately (purges self, finds any missed contacts)
    if (entry.cachedEmails?.length) applyContactsFromEmails(entry.cachedEmails);

    // Backfill from LinkedIn firmographics (persisted)
    backfillFromLinkedinFirmo();

    // Backfill from research cache (persisted)
    backfillFromResearchCache();

    // Fill missing firmographic fields from research cache (display-only, not persisted)
    const cached = (data.researchCache || {})[entry.company?.toLowerCase()]?.data;
    if (cached) {
      if (!entry.funding  && cached.funding)  entry = { ...entry, funding:  cached.funding  };
      if (!entry.founded  && cached.founded)  entry = { ...entry, founded:  cached.founded  };
      if (!entry.industry && cached.industry) entry = { ...entry, industry: cached.industry };
      if (!entry.employees && cached.employees) entry = { ...entry, employees: cached.employees };
      if (!entry.jobListings?.length && cached.jobListings?.length) entry = { ...entry, jobListings: cached.jobListings };
    }

    // Pull website/LinkedIn from linked opportunity if missing on company entry
    const linkedOppForSync = allCompanies.find(o =>
      o.type === 'job' && (o.linkedCompanyId === id || o.company === entry.company)
    );
    if (linkedOppForSync) {
      const updates = {};
      if (!entry.companyWebsite  && linkedOppForSync.companyWebsite)  updates.companyWebsite  = linkedOppForSync.companyWebsite;
      if (!entry.companyLinkedin && linkedOppForSync.companyLinkedin) updates.companyLinkedin = linkedOppForSync.companyLinkedin;
      if (Object.keys(updates).length) saveEntry(updates);
    }

    // Load persisted layout
    try {
      const saved = localStorage.getItem('ci_co_layout_' + id);
      if (saved) panelLayout = JSON.parse(saved);
    } catch(e) {}

    // Migrate old panel names
    ['left','main','right'].forEach(col => {
      panelLayout[col] = panelLayout[col].map(p =>
        (p === 'stats' || p === 'links') ? 'properties' :
        p === 'opportunities' ? 'opportunity' : p
      );
      // Deduplicate
      panelLayout[col] = [...new Set(panelLayout[col])];
    });
    // Main column is now hardcoded hub tabs — clear any saved panels there
    panelLayout.main = [];
    // Notes moved to hub Notes tab — remove from left column
    panelLayout.left = panelLayout.left.filter(p => p !== 'notes');
    // Chat replaced by floating chat — remove from all columns
    ['left','main','right'].forEach(col => { panelLayout[col] = panelLayout[col].filter(p => p !== 'chat'); });
    // Opportunity moved to top-left — remove from right, ensure it's first in left
    panelLayout.right = panelLayout.right.filter(p => p !== 'opportunity');
    if (!panelLayout.left.includes('opportunity')) panelLayout.left.unshift('opportunity');
    else if (panelLayout.left[0] !== 'opportunity') {
      panelLayout.left = ['opportunity', ...panelLayout.left.filter(p => p !== 'opportunity')];
    }

    // Ensure all default panels are present
    const placed = new Set([...panelLayout.left, ...panelLayout.main, ...panelLayout.right]);
    const allDefaults = [...DEFAULT_LAYOUT.left, ...DEFAULT_LAYOUT.main, ...DEFAULT_LAYOUT.right];
    allDefaults.forEach(p => { if (!placed.has(p)) panelLayout.right.push(p); });

    // Load collapsed state
    try { collapsedPanels = JSON.parse(localStorage.getItem('ci_co_collapsed_' + id) || '{}'); } catch(e) {}

    document.title = `${entry.company} — CompanyIntel`;
    renderHeader();
    renderColumns();
    if (typeof initChatPanels === 'function') initChatPanels(entry);
    initFloatingChat();

    // Auto-refresh on open — show cache immediately, fetch fresh in background
    loadHubEmails(true);
    loadHubMeetings(false);
    maybeRefreshDeepFitAnalysis();

    const focus = new URLSearchParams(location.search).get('focus');
    if (focus === 'opportunity') {
      setTimeout(() => {
        const panel = document.getElementById('panel-opportunity');
        if (panel) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          panel.classList.add('panel-focus-highlight');
          setTimeout(() => panel.classList.remove('panel-focus-highlight'), 2000);
        }
      }, 150);
    }
  });
}

function showError(msg) {
  document.getElementById('co-header').innerHTML = `<span style="color:#e5483b">${msg}</span>`;
}

function saveEntry(changes) {
  Object.assign(entry, changes);
  const idx = allCompanies.findIndex(c => c.id === entry.id);
  if (idx !== -1) allCompanies[idx] = entry;
  chrome.storage.local.set({ savedCompanies: allCompanies });
}

function backfillFromResearchCache() {
  return new Promise(resolve => {
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const key = entry.company?.toLowerCase();
      const cached = researchCache?.[key]?.data;
      if (!cached) { resolve(false); return; }
      const updates = {};
      if (!entry.companyWebsite && cached.companyWebsite) updates.companyWebsite = cached.companyWebsite;
      if (!entry.companyLinkedin && cached.companyLinkedin) updates.companyLinkedin = cached.companyLinkedin;
      if (!entry.employees && cached.employees) updates.employees = cached.employees;
      if (!entry.industry && cached.industry) updates.industry = cached.industry;
      if (!entry.funding && cached.funding) updates.funding = cached.funding;
      if (Object.keys(updates).length === 0) { resolve(false); return; }
      saveEntry(updates);
      resolve(true);
    });
  });
}

function backfillFromLinkedinFirmo() {
  const f = entry.linkedinFirmo;
  if (!f) return false;
  const updates = {};
  if (!entry.employees && f.employees) updates.employees = f.employees;
  if (!entry.industry && f.industry) updates.industry = f.industry;
  if (!entry.location && f.location) updates.location = f.location;
  if (Object.keys(updates).length === 0) return false;
  saveEntry(updates);
  return true;
}

// Event-driven re-scoring: triggers when new context arrives (meetings, emails, notes)
function maybeRescore(reason) {
  if (!entry.isOpportunity || !entry.jobDescription) return;
  chrome.storage.sync.get(['prefs'], ({ prefs }) => {
    if (!prefs) return;
    chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
      console.log('[Rescore] Triggering re-score for', entry.company, '— reason:', reason);
      const richContext = {
        intelligence: entry.intelligence?.eli5 || entry.oneLiner || null,
        reviews: entry.reviews || [],
        emails: (entry.cachedEmails || []).slice(0, 5).map(e => ({ date: e.date, subject: e.subject, from: e.from })),
        meetings: (entry.cachedMeetings || []).slice(0, 3),
        transcript: entry.cachedMeetingTranscript || null,
        storyTime: storyTime?.profileSummary || storyTime?.rawInput || null,
        notes: entry.notes || null,
        contextDocuments: entry.contextDocuments || [],
      };
      chrome.runtime.sendMessage(
        { type: 'ANALYZE_JOB', company: entry.company, jobTitle: entry.jobTitle, jobDescription: entry.jobDescription, prefs, richContext },
        result => {
          void chrome.runtime.lastError;
          if (!result?.jobMatch) return;
          saveEntry({ jobMatch: result.jobMatch, jobMatchScoredAt: Date.now() });
          if (result.jobSnapshot) saveEntry({ jobSnapshot: result.jobSnapshot });
          renderPanel('opportunity');
        }
      );
    });
  });
}

function saveLayout() {
  localStorage.setItem('ci_co_layout_' + entry.id, JSON.stringify(panelLayout));
}

function saveCollapsed() {
  localStorage.setItem('ci_co_collapsed_' + entry.id, JSON.stringify(collapsedPanels));
}

function stageColor(key, stages) {
  const s = stages.find(s => s.key === key);
  return s ? s.color : '#64748b';
}

// ── Header ─────────────────────────────────────────────────────────────────

function renderHeader() {
  const faviconDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const favicon = faviconDomain
    ? `<img class="hdr-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">`
    : '';

  const statusColor = stageColor(entry.status || 'co_watchlist', customCompanyStages);
  const statusOptions = customCompanyStages.map(s =>
    `<option value="${s.key}" ${(entry.status || 'co_watchlist') === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const stars = [1,2,3,4,5].map(i =>
    `<button class="hdr-star ${(entry.rating||0) >= i ? 'filled' : ''}" data-val="${i}">★</button>`
  ).join('');

  const nameVal = (entry.company || '').replace(/"/g, '&quot;');
  const oppStageColor = entry.isOpportunity
    ? stageColor(entry.jobStage || 'needs_review', customOpportunityStages)
    : null;
  const oppStageOptions = customOpportunityStages.map(s =>
    `<option value="${s.key}" ${(entry.jobStage || 'needs_review') === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const hdr = document.getElementById('co-header');
  hdr.innerHTML = `
    <a href="saved.html" style="text-decoration:none;font-size:14px;font-weight:700;color:#f1f5f9;letter-spacing:-0.01em;margin-right:4px">Company<span style="color:#FF7A59">Intel</span></a>
    <div class="hdr-divider"></div>
    ${favicon}
    <input class="hdr-name-input" id="hdr-name" value="${nameVal}" placeholder="Company name">
    ${entry.isOpportunity
      ? `<div class="hdr-stage-group" style="margin-left:8px"><span class="hdr-stage-label">Opportunity</span><select class="hdr-status" id="hdr-opp-stage" style="border-color:${oppStageColor};color:${oppStageColor}">${oppStageOptions}</select></div>`
      : `<button class="hdr-opp-btn" id="hdr-add-opp" style="margin-left:8px">+ Add to Pipeline</button>`}
    <div class="hdr-spacer"></div>
    <div class="hdr-stage-group">
      <span class="hdr-stage-label">Company</span>
      <select class="hdr-status" id="hdr-status" style="border-color:${statusColor};color:${statusColor}">
        ${statusOptions}
      </select>
    </div>
    <div class="hdr-stars" id="hdr-stars"><span class="hdr-stars-label">Excitement</span>${stars}</div>
    <button class="hdr-refresh-btn" id="hdr-refresh-btn" title="Refresh emails &amp; meetings"><span class="hdr-refresh-icon">↻</span></button>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('preferences.html')}" target="_blank">⚙ Setup</a>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('integrations.html')}" target="_blank" style="margin-left:4px">🔗</a>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('docs.html')}" target="_blank" style="margin-left:4px">Docs</a>
  `;

  document.getElementById('hdr-back')?.addEventListener('click', () => window.close());

  // Editable company name
  const nameInput = document.getElementById('hdr-name');
  nameInput?.addEventListener('blur', () => {
    const val = nameInput.value.trim();
    if (val && val !== entry.company) {
      saveEntry({ company: val });
      document.title = `${val} — CompanyIntel`;
    }
  });
  nameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

  document.getElementById('hdr-status')?.addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value, customCompanyStages);
    sel.style.borderColor = c; sel.style.color = c;
    saveEntry({ status: sel.value });
  });

  document.getElementById('hdr-opp-stage')?.addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value, customOpportunityStages);
    sel.style.borderColor = c; sel.style.color = c;
    // Record stage entry timestamp + clear timestamps for stages ahead when moving backward
    const toIdx = customOpportunityStages.findIndex(s => s.key === sel.value);
    const ts = { ...(entry.stageTimestamps || {}) };
    if (!ts[sel.value]) ts[sel.value] = Date.now();
    for (const s of customOpportunityStages) {
      const sIdx = customOpportunityStages.findIndex(st => st.key === s.key);
      if (sIdx > toIdx && ts[s.key]) delete ts[s.key];
    }
    const stageChanges = { jobStage: sel.value, stageTimestamps: ts };
    // Auto-set Action On based on stage
    const autoAction = defaultActionStatus(sel.value);
    if (autoAction) stageChanges.actionStatus = autoAction;
    saveEntry(stageChanges);
    // Update Action On dropdown if visible
    const actionSel = document.getElementById('opp-action-status');
    if (actionSel && autoAction) actionSel.value = autoAction;
    // Fire celebration if configured
    const celebCfg = _getCelebrationConfig(sel.value);
    if (celebCfg) _fireCelebration(celebCfg);
  });

  document.getElementById('hdr-stars')?.querySelectorAll('.hdr-star').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val);
      saveEntry({ rating: val });
      document.querySelectorAll('.hdr-star').forEach((s, i) => s.classList.toggle('filled', i < val));
    });
  });

  const addOppBtn = document.getElementById('hdr-add-opp');
  if (addOppBtn) addOppBtn.addEventListener('click', addToOpportunityPipeline);

  const viewPipelineBtn = document.getElementById('hdr-view-pipeline');
  if (viewPipelineBtn) viewPipelineBtn.addEventListener('click', () => renderPanel('opportunity'));

  const refreshBtn = document.getElementById('hdr-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
    loadHubEmails(true);
    loadHubMeetings(true);
    setTimeout(() => {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }, 2000);
  });
}

function commitUrl(field, val) {
  const key = field === 'website' ? 'companyWebsite' : 'companyLinkedin';
  saveEntry({ [key]: val });
  renderHeader(); // re-render to show updated link/input state
  renderPanel('properties'); // keep properties panel in sync
}

function addToOpportunityPipeline() {
  saveEntry({ isOpportunity: true, jobStage: 'needs_review' });
  renderHeader();
  renderPanel('opportunity');
}

function createOpportunity() { addToOpportunityPipeline(); } // backward compat

function scoreToVerdict(score) {
  if (score >= 8) return { label: 'Strong Match',     cls: 'high',  color: '#059669' };
  if (score >= 6) return { label: 'Good Match',       cls: 'mid',   color: '#2563eb' };
  if (score >= 4) return { label: 'Mixed Signals',    cls: 'mixed', color: '#d97706' };
  return                 { label: 'Likely Not a Fit', cls: 'low',   color: '#dc2626' };
}

function buildOpportunity() {
  const propsHtml = buildProperties();

  if (!entry.isOpportunity) {
    return `${propsHtml}
    <div id="prop-add-area">
      <button class="prop-add-btn" id="prop-add-btn">+ Add field</button>
    </div>
    <div class="opp-divider"></div>
    <button class="new-opp-btn" id="add-opp-btn">+ Add to Opportunity Pipeline</button>`;
  }

  const stageOptions = customOpportunityStages.map(s =>
    `<option value="${s.key}" ${entry.jobStage === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');
  const title = (entry.jobTitle && entry.jobTitle !== 'New Opportunity') ? entry.jobTitle : '';

  const matchHtml = entry.jobMatch?.score ? (() => {
    const v = scoreToVerdict(entry.jobMatch.score);
    const sc = stageColor(entry.jobStage, customOpportunityStages);
    return `<div class="prop-row">
      <span class="prop-label">Match</span>
      <div class="prop-val-wrap" style="gap:6px">
        <span style="font-size:13px;font-weight:700;color:#33475b">${entry.jobMatch.score}/10</span>
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(45,62,80,0.07);color:#516f90">${v.label}</span>
      </div>
    </div>`;
  })() : '';

  const jobUrlHtml = entry.jobUrl
    ? `<div class="prop-row"><span class="prop-label">Posting</span><div class="prop-val-wrap"><a class="prop-open-link" href="${entry.jobUrl}" target="_blank">View Job ↗</a></div></div>`
    : '';

  return `${propsHtml}
    <div class="opp-divider"></div>
    <div class="prop-row">
      <span class="prop-label">Stage</span>
      <div class="prop-val-wrap">
        <select class="prop-input" id="opp-stage-select">${stageOptions}</select>
      </div>
    </div>
    <div class="prop-row">
      <span class="prop-label">Role</span>
      <div class="prop-val-wrap">
        ${title && entry.jobUrl
          ? `<a href="${entry.jobUrl}" target="_blank" class="prop-link-display" id="opp-title-link" style="font-weight:600;font-size:13px">${title}</a><button class="prop-link-edit" id="opp-title-edit-btn" title="Edit">✎</button>`
          : `<input class="prop-input ${!title ? 'prop-empty' : ''}" id="opp-title-input" value="${title}" placeholder="Add job title…">`}
      </div>
    </div>
    ${jobUrlHtml}
    ${matchHtml}
    ${entry.baseSalaryRange || entry.oteTotalComp || entry.equity ? `
    <div class="prop-row">
      <span class="prop-label">Base Salary</span>
      <div class="prop-val-wrap"><input class="prop-input${entry.baseSalaryRange ? '' : ' prop-empty'}" id="opp-base-salary" value="${(entry.baseSalaryRange || '').replace(/"/g,'&quot;')}" placeholder="e.g. $150K - $180K"></div>
    </div>
    <div class="prop-row">
      <span class="prop-label">OTE / Total</span>
      <div class="prop-val-wrap"><input class="prop-input${entry.oteTotalComp ? '' : ' prop-empty'}" id="opp-ote" value="${(entry.oteTotalComp || '').replace(/"/g,'&quot;')}" placeholder="e.g. $250K OTE"></div>
    </div>
    <div class="prop-row">
      <span class="prop-label">Equity</span>
      <div class="prop-val-wrap"><input class="prop-input${entry.equity ? '' : ' prop-empty'}" id="opp-equity" value="${(entry.equity || '').replace(/"/g,'&quot;')}" placeholder="e.g. 0.1% - 0.2%"></div>
    </div>
    ${entry.compSource ? `<div class="prop-row"><span class="prop-label" style="font-size:10px;color:#94a3b8">Comp Source</span><div class="prop-val-wrap"><span style="font-size:11px;color:#94a3b8">${entry.compAutoExtracted ? '✨ ' : ''}${entry.compSource}</span></div></div>` : ''}
    ` : `
    <div class="prop-row">
      <span class="prop-label">Base Salary</span>
      <div class="prop-val-wrap"><input class="prop-input prop-empty" id="opp-base-salary" value="" placeholder="e.g. $150K - $180K"></div>
    </div>
    `}
    <div class="prop-row">
      <span class="prop-label">Action On</span>
      <div class="prop-val-wrap">
        <select class="prop-input" id="opp-action-status" style="min-height:auto;padding:6px 8px">
          <option value="my_court" ${(entry.actionStatus || 'my_court') === 'my_court' ? 'selected' : ''}>🏀 My Court</option>
          <option value="their_court" ${entry.actionStatus === 'their_court' ? 'selected' : ''}>⏳ Their Court</option>
          <option value="scheduled" ${entry.actionStatus === 'scheduled' ? 'selected' : ''}>📅 Scheduled</option>
        </select>
      </div>
    </div>
    <div class="prop-row">
      <span class="prop-label">Next Step</span>
      <div class="prop-val-wrap">
        <input class="prop-input ${!entry.nextStep ? 'prop-empty' : ''}" id="opp-next-step-input" value="${(entry.nextStep || '').replace(/"/g,'&quot;')}" placeholder="e.g. Send proposal…">
      </div>
    </div>
    <div class="prop-row">
      <span class="prop-label">Next Step Date</span>
      <div class="prop-val-wrap">
        <input class="prop-input${entry.nextStepDate ? ' has-value' : ''}" id="opp-next-step-date" type="date" value="${entry.nextStepDate || ''}">
      </div>
    </div>
    ${(() => {
      const ts = Math.max(entry.cachedEmailsAt || 0, entry.cachedMeetingNotesAt || 0, entry.cachedGranolaAt || 0, entry.savedAt || 0);
      if (!ts) return '';
      const d = new Date(ts);
      return `<div class="prop-row">
        <span class="prop-label">Last Activity</span>
        <div class="prop-val-wrap"><span>${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
      </div>`;
    })()}
    <div id="prop-add-area">
      <button class="prop-add-btn" id="prop-add-btn">+ Add field</button>
    </div>
  `;
}

// Legacy stub (kept only while old type:'job' data exists — migration handles cleanup)
function _legacyCreateJobRecord() {
  const newEntry = {
    id: Date.now().toString(), type: 'job',
    company: entry.company,
    companyWebsite: entry.companyWebsite || '',
    companyLinkedin: entry.companyLinkedin || '',
    intelligence: entry.intelligence || null,
    reviews: entry.reviews || [],
    leaders: entry.leaders || [],
    oneLiner: entry.oneLiner || '',
    category: entry.category || '',
    employees: entry.employees || '',
    funding: entry.funding || '',
    founded: entry.founded || '',
    industry: entry.industry || '',
    linkedCompanyId: entry.id,
    status: 'needs_review',
    savedAt: Date.now(),
    jobTitle: 'New Opportunity',
  };
  allCompanies = [newEntry, ...allCompanies];
  chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
    window.open(chrome.runtime.getURL('opportunity.html') + '?id=' + newEntry.id, '_blank');
    renderHeader(); // refresh button to "View Opportunity"
    renderPanel('opportunities'); // refresh opportunities panel if visible
  });
}

// ── Columns & Panels ───────────────────────────────────────────────────────

function renderColumns() {
  ['left', 'right'].forEach(col => {
    const colEl = document.getElementById('col-' + col);
    colEl.innerHTML = panelLayout[col].map(pid => buildPanelHTML(pid)).join('');
  });
  renderMainTabs();
  bindPanelEvents();
  bindDragDrop();
}

function renderMainTabs() {
  const colEl = document.getElementById('col-main');
  colEl.innerHTML = `
    <div class="hub-tabs-container">
      <div class="hub-tab-bar">
        <button class="hub-tab active" data-tab="intel">Intel</button>
        <button class="hub-tab" data-tab="notes">Notes</button>
        <button class="hub-tab" data-tab="emails">Emails</button>
        <button class="hub-tab" data-tab="meetings">Meetings</button>
        <button class="hub-tab" data-tab="docs">Docs</button>
      </div>
      <div class="hub-pane active" id="hub-intel">
        ${buildIntelTab()}
      </div>
      <div class="hub-pane" id="hub-notes">
        <div id="hub-notes-container" data-editing="0"></div>
      </div>
      <div class="hub-pane" id="hub-emails">
        <div class="p-empty" id="act-emails-status">Loading emails…</div>
        <div id="act-emails-list"></div>
      </div>
      <div class="hub-pane" id="hub-meetings">
        <div class="p-empty" id="act-meetings-status">Loading meetings…</div>
        <div id="act-meetings-content"></div>
      </div>
      <div class="hub-pane" id="hub-docs">
        <div class="docs-section">
          <div class="docs-upload-zone" id="docs-drop-zone">
            <div class="docs-upload-text">Drop files here or click to upload</div>
            <div class="docs-upload-sub">PDF, images (.png, .jpg), or paste text</div>
            <input type="file" id="docs-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple style="display:none">
            <button class="docs-upload-btn" id="docs-upload-btn">Choose files</button>
          </div>
          <div class="docs-paste-zone">
            <textarea class="docs-paste-input" id="docs-paste-input" placeholder="Or paste a job description, offer details, or any text here..." rows="3"></textarea>
            <button class="docs-paste-btn" id="docs-paste-save">Save text</button>
          </div>
          <div class="docs-list" id="docs-list"></div>
        </div>
      </div>
    </div>`;
  bindHubTabs();
}

function buildIntelTab() {
  const overview = buildOverview();
  const intel    = buildIntel();
  const hasIntel = !intel.includes('p-empty');

  // Fit section — always shown for opportunities; prompt to add if not
  const fitHtml = (entry.isOpportunity || entry.jobMatch)
    ? buildFitSection()
    : `<div class="hub-section-label">Job Fit Analysis</div>
       <div class="p-empty" style="text-align:left">Add this company to the Opportunity Pipeline to enable fit analysis against your preferences, meetings, and emails.</div>`;

  return `
    <div class="hub-intel-block">${overview}</div>
    ${hasIntel ? `<div class="hub-intel-block">${intel}</div>` : ''}
    <div class="hub-intel-block" id="hub-fit-block">${fitHtml}</div>
    <div class="hub-intel-block" id="hub-reviews-block">
      <div class="hub-section-label">Employee Reviews</div>
      ${buildReviews()}
    </div>
    <div class="hub-intel-block" id="hub-hiring-block">
      <div class="hub-section-label">Hiring Signals</div>
      ${buildHiring()}
    </div>
  `.trim();
}

// Called when the Intel tab is first opened — fetches missing research data and triggers fit analysis
function initIntelTab() {
  // Trigger fresh research if reviews or hiring signals are missing
  const needsResearch = !entry.reviews?.length || !entry.jobListings?.length;
  if (needsResearch && !_researchAttempted) {
    _researchAttempted = true;
    const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    chrome.runtime.sendMessage({ type: 'RESEARCH_COMPANY', company: entry.company, domain }, data => {
      void chrome.runtime.lastError;
      if (!data || data.error) return;
      const updates = {};
      if (data.reviews?.length && !entry.reviews?.length)     updates.reviews     = data.reviews;
      if (data.jobListings?.length)                           updates.jobListings  = data.jobListings;
      if (data.leaders?.length   && !entry.leaders?.length)   updates.leaders     = data.leaders;
      if (data.intelligence      && !entry.intelligence)      updates.intelligence = data.intelligence;
      if (!Object.keys(updates).length) return;
      saveEntry(updates);
      // Re-render only the sections that changed
      const reviewsEl = document.getElementById('hub-reviews-block');
      if (reviewsEl && updates.reviews) reviewsEl.innerHTML = `<div class="hub-section-label">Employee Reviews</div>${buildReviews()}`;
      const hiringEl  = document.getElementById('hub-hiring-block');
      if (hiringEl  && updates.jobListings) hiringEl.innerHTML  = `<div class="hub-section-label">Hiring Signals</div>${buildHiring()}`;
    });
  }

  // Trigger / refresh deep fit analysis
  maybeRefreshDeepFitAnalysis();
}

function maybeRefreshDeepFitAnalysis() {
  if (!entry.isOpportunity && !entry.jobMatch) return;

  // Determine if we have richer context than just the job posting
  const hasContext = !!(entry.cachedMeetingTranscript || entry.cachedMeetingNotes ||
    entry.cachedEmails?.length || entry.notes);

  // Don't re-generate if analysis is fresh (< 60 min) AND context hasn't changed
  const age = entry.deepFitAnalysisAt
    ? (Date.now() - entry.deepFitAnalysisAt) / 60000
    : Infinity;
  if (entry.deepFitAnalysis && age < 60) return;

  // No context beyond posting and no existing analysis — skip (not enough to say anything new)
  if (!hasContext && entry.deepFitAnalysis) return;

  chrome.storage.sync.get(['prefs'], ({ prefs = {} }) => {
    chrome.runtime.sendMessage({
      type: 'DEEP_FIT_ANALYSIS',
      company:     entry.company,
      jobTitle:    entry.jobTitle || '',
      jobSummary:      entry.jobMatch?.jobSummary || entry.jobSummary || '',
      jobSnapshot:     entry.jobSnapshot || '',
      jobDescription:  entry.jobDescription || '',
      jobMatch:        entry.jobMatch || {},
      notes:           entry.notes || '',
      transcripts:     entry.cachedMeetingTranscript || entry.cachedMeetingNotes || '',
      emails:          (entry.cachedEmails || []).slice(0, 8).map(e => ({ subject: e.subject, from: e.from, snippet: e.snippet })),
      prefs
    }, result => {
      void chrome.runtime.lastError;
      if (result?.analysis) {
        saveEntry({ deepFitAnalysis: result.analysis, deepFitAnalysisAt: Date.now() });
        // Update only the fit block so other sections aren't disrupted
        const fitBlock = document.getElementById('hub-fit-block');
        if (fitBlock) fitBlock.innerHTML = buildFitSection();
      }
    });
  });
}

function buildFitSection() {
  const jm         = entry.jobMatch || {};
  const score      = jm.score;
  const strongFits = jm.strongFits || [];
  const redFlags   = jm.redFlags   || jm.watchOuts || [];
  const jobSummary = jm.jobSummary  || entry.jobSummary || '';
  const deep       = entry.deepFitAnalysis || '';
  const v          = score ? scoreToVerdict(score) : null;

  // Quick fit score (from AI scoring queue) — shown when no deep analysis exists
  const qfs = entry.quickFitScore;
  const qfr = entry.quickFitReason;
  const hasQuickFit = qfs != null && !score;

  let html = `<div class="hub-section-label">Job Fit Analysis</div>`;

  // Full deep score + verdict row
  if (score) {
    const fb = entry.matchFeedback;
    const upA = fb?.type === 'up' ? ' active up' : '';
    const noteA = fb?.type === 'note' ? ' active note' : '';
    const downA = fb?.type === 'down' ? ' active down' : '';
    html += `<div class="fit-score-row">
      <span class="fit-score">${score}<span class="fit-score-denom">/10</span></span>
      <span class="fit-verdict" style="color:${v.color}">${v.label}</span>
      <span class="verdict-thumbs">
        <button class="thumb-btn${upA}" data-dir="up" title="Agree">👍</button>
        <button class="thumb-btn${noteA}" data-dir="note" title="Note on wording/format">💬</button>
        <button class="thumb-btn${downA}" data-dir="down" title="Disagree">👎</button>
      </span>
    </div>
    <div id="co-thumb-form" style="display:none"></div>`;
    // Show quick screen as secondary reference if it also exists
    if (qfs != null) {
      html += `<div style="font-size:11px;color:#A09A94;margin-top:4px">Quick screen: ${qfs}/10${qfr ? ' — ' + escapeHtml(qfr) : ''}</div>`;
    }
  } else if (hasQuickFit) {
    // Quick fit only — no deep analysis yet
    const qfColor = qfs >= 7 ? '#0F6E56' : qfs >= 4 ? '#854F0B' : '#A32D2D';
    html += `<div class="fit-score-row">
      <span class="fit-score" style="color:${qfColor}">${qfs}<span class="fit-score-denom">/10</span></span>
      <span class="fit-verdict" style="color:${qfColor}">Quick Fit Screen</span>
    </div>`;
    if (qfr) {
      html += `<div style="font-size:13px;color:#516f90;margin:8px 0;line-height:1.5">${escapeHtml(qfr)}</div>`;
    }
    html += `<div style="font-size:12px;color:#A09A94;margin:6px 0;line-height:1.5">Quick screening — move to a later stage or click "Run fit analysis" for the full deep analysis with green flags, red flags, and detailed breakdown.</div>`;
  }

  // Refresh button — always available for opportunities
  html += `<button class="fit-refresh-btn" id="fit-refresh-btn" title="Re-analyze using job posting, meetings, emails &amp; notes">
    ↻ ${score ? 'Refresh analysis' : 'Run fit analysis'}
  </button>`;

  // Job summary (from posting)
  if (jobSummary) {
    html += `<div class="fit-job-summary">${escapeHtml(jobSummary)}</div>`;
  }

  // Deep analysis narrative (generated from full context)
  if (deep) {
    html += `<div class="fit-deep-analysis">${renderMarkdown(deep)}</div>`;
  } else if (!score && !hasQuickFit) {
    html += `<div class="p-empty" style="text-align:left;margin:8px 0">No fit analysis yet. Click "Run fit analysis" above — or save a job posting to automatically generate one.</div>`;
  }

  // Green flags / Red flags — always shown as side-by-side grid
  const greenLabel = hasQuickFit && !strongFits.length ? 'Run full analysis to generate' : 'None identified yet';
  const redLabel = hasQuickFit && !redFlags.length ? 'Run full analysis to generate' : 'None identified yet';
  html += `<div class="fit-flags-grid">
    <div class="fit-flags-col fit-flags-green">
      <div class="fit-flags-header">✓ Green Flags</div>
      ${strongFits.length
        ? strongFits.map(f => `<div class="fit-flag">${escapeHtml(f)}</div>`).join('')
        : `<div class="fit-flag-none">${greenLabel}</div>`}
    </div>
    <div class="fit-flags-col fit-flags-red">
      <div class="fit-flags-header">⚠ Red Flags</div>
      ${redFlags.length
        ? redFlags.map(f => `<div class="fit-flag">${escapeHtml(f)}</div>`).join('')
        : `<div class="fit-flag-none">${redLabel}</div>`}
    </div>
  </div>`;

  return html;
}

function bindHubTabs() {
  const container = document.querySelector('.hub-tabs-container');
  if (!container) return;

  let emailsLoaded = false, meetingsLoaded = false, intelInited = false, docsInited = false;

  // Init intel immediately (starts active)
  setTimeout(() => { if (!intelInited) { intelInited = true; initIntelTab(); } }, 0);

  container.querySelectorAll('.hub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.hub-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('hub-' + tab.dataset.tab)?.classList.add('active');

      if (tab.dataset.tab === 'intel' && !intelInited) {
        intelInited = true;
        initIntelTab();
      }
      if (tab.dataset.tab === 'emails' && !emailsLoaded) {
        emailsLoaded = true;
        loadHubEmails();
      }
      if (tab.dataset.tab === 'meetings' && !meetingsLoaded) {
        meetingsLoaded = true;
        loadHubMeetings();
      }
      if (tab.dataset.tab === 'docs' && !docsInited) {
        docsInited = true;
        initDocsTab();
      }
    });
  });

  renderNotesEditor();

  // Thumbs feedback on match verdict
  document.addEventListener('click', e => {
    const thumbBtn = e.target.closest('.thumb-btn');
    if (!thumbBtn || !thumbBtn.closest('.fit-score-row, .verdict-row')) return;
    const dir = thumbBtn.dataset.dir;
    const formEl = document.getElementById('co-thumb-form');
    if (!formEl) return;
    document.querySelectorAll('.fit-score-row .thumb-btn, .verdict-row .thumb-btn').forEach(b => b.classList.remove('active', 'up', 'down'));
    thumbBtn.classList.add('active', dir);
    const placeholder = dir === 'up' ? 'What resonated?' : dir === 'note' ? 'Feedback on wording, length, format...' : 'What felt off?';
    formEl.style.display = 'block';
    formEl.innerHTML = `<div class="thumb-feedback-form"><input class="thumb-feedback-input" id="co-thumb-note" type="text" placeholder="${placeholder}"><button class="thumb-feedback-submit" id="co-thumb-submit">Submit</button></div>`;
    formEl.querySelector('#co-thumb-note')?.focus();
    const submit = () => {
      const note = document.getElementById('co-thumb-note')?.value?.trim() || '';
      saveEntry({ matchFeedback: { type: dir, note, date: Date.now() } });
      formEl.innerHTML = `<div style="font-size:11px;color:#7da8c4;padding:4px 0">Thanks for the feedback</div>`;
      setTimeout(() => { formEl.style.display = 'none'; }, 2000);
    };
    document.getElementById('co-thumb-submit')?.addEventListener('click', submit);
    document.getElementById('co-thumb-note')?.addEventListener('keydown', e2 => { if (e2.key === 'Enter') submit(); });
  });

  // Fit analysis refresh button (may be rendered later if intel tab is active)
  document.addEventListener('click', e => {
    if (e.target.id !== 'fit-refresh-btn') return;
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = '↻ Analyzing…';
    const prefs = {};
    chrome.storage.sync.get(['prefs'], d => {
      Object.assign(prefs, d.prefs || {});
      chrome.runtime.sendMessage({
        type: 'DEEP_FIT_ANALYSIS',
        company:    entry.company,
        jobTitle:   entry.jobTitle || '',
        jobSummary:     entry.jobMatch?.jobSummary || entry.jobSummary || '',
        jobSnapshot:    entry.jobSnapshot || '',
        jobDescription: entry.jobDescription || '',
        jobMatch:       entry.jobMatch || {},
        notes:          entry.notes || '',
        transcripts:    entry.cachedMeetingTranscript || entry.cachedMeetingNotes || '',
        emails:         (entry.cachedEmails || []).slice(0, 8).map(e => ({ subject: e.subject, from: e.from, snippet: e.snippet })),
        prefs
      }, result => {
        void chrome.runtime.lastError;
        btn.disabled = false;
        btn.textContent = '↻ Refresh analysis';
        if (result?.analysis) {
          saveEntry({ deepFitAnalysis: result.analysis, deepFitAnalysisAt: Date.now() });
          // Re-render only the fit block so we don't disrupt other sections
          const fitBlock = document.getElementById('hub-fit-block');
          if (fitBlock) fitBlock.innerHTML = buildFitSection();
        }
      });
    });
  }, { capture: true });

}

// ── Documents tab ────────────────────────────────────────────────────────────

function initDocsTab() {
  const dropZone = document.getElementById('docs-drop-zone');
  const fileInput = document.getElementById('docs-file-input');
  const uploadBtn = document.getElementById('docs-upload-btn');
  const pasteInput = document.getElementById('docs-paste-input');
  const pasteSaveBtn = document.getElementById('docs-paste-save');
  if (!dropZone) return;

  // Render existing docs
  renderDocsList();

  // Click to upload
  uploadBtn.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', e => {
    if (e.target === uploadBtn || e.target === fileInput) return;
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // Drag and drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
  });

  // Paste text save
  pasteSaveBtn.addEventListener('click', () => {
    const text = pasteInput.value.trim();
    if (!text) return;
    const filename = 'Pasted text — ' + text.slice(0, 30).replace(/\n/g, ' ');
    const doc = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      filename,
      type: 'text',
      extractedText: text,
      addedAt: new Date().toISOString(),
      tokenEstimate: Math.ceil(text.length / 4)
    };
    const docs = entry.contextDocuments || [];
    docs.push(doc);
    saveEntry({ contextDocuments: docs });
    pasteInput.value = '';
    renderDocsList();
  });

  // Delete handler (delegated)
  document.getElementById('docs-list')?.addEventListener('click', e => {
    const delBtn = e.target.closest('.doc-delete');
    if (!delBtn) return;
    const docId = delBtn.dataset.docId;
    const docs = (entry.contextDocuments || []).filter(d => d.id !== docId);
    saveEntry({ contextDocuments: docs });
    renderDocsList();
  });
}

async function handleFiles(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      await handlePdfFile(file);
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      await handleImageFile(file);
    }
  }
}

async function handlePdfFile(file) {
  // Add placeholder card
  const placeholderId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const docs = entry.contextDocuments || [];
  const placeholder = { id: placeholderId, filename: file.name, type: 'pdf', extractedText: '', addedAt: new Date().toISOString(), tokenEstimate: 0, _extracting: true };
  docs.push(placeholder);
  saveEntry({ contextDocuments: docs });
  renderDocsList();

  try {
    const pdfjsLib = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    const text = pages.join('\n\n');
    // Update placeholder with extracted text
    const currentDocs = entry.contextDocuments || [];
    const idx = currentDocs.findIndex(d => d.id === placeholderId);
    if (idx !== -1) {
      currentDocs[idx].extractedText = text;
      currentDocs[idx].tokenEstimate = Math.ceil(text.length / 4);
      delete currentDocs[idx]._extracting;
      saveEntry({ contextDocuments: currentDocs });
    }
    renderDocsList();
  } catch (e) {
    console.error('[Docs] PDF extraction failed:', e);
    // Remove failed placeholder
    const currentDocs = (entry.contextDocuments || []).filter(d => d.id !== placeholderId);
    saveEntry({ contextDocuments: currentDocs });
    renderDocsList();
  }
}

async function handleImageFile(file) {
  const placeholderId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const docs = entry.contextDocuments || [];
  const placeholder = { id: placeholderId, filename: file.name, type: 'image', extractedText: '', addedAt: new Date().toISOString(), tokenEstimate: 0, _extracting: true };
  docs.push(placeholder);
  saveEntry({ contextDocuments: docs });
  renderDocsList();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
    const extToMime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    const ext = file.name.split('.').pop().toLowerCase();
    const mediaType = extToMime[ext] || 'image/png';

    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'EXTRACT_IMAGE_TEXT', imageBase64: base64, mediaType, filename: file.name }, resolve);
    });

    const text = result?.text || '';
    const currentDocs = entry.contextDocuments || [];
    const idx = currentDocs.findIndex(d => d.id === placeholderId);
    if (idx !== -1) {
      currentDocs[idx].extractedText = text;
      currentDocs[idx].tokenEstimate = Math.ceil(text.length / 4);
      delete currentDocs[idx]._extracting;
      saveEntry({ contextDocuments: currentDocs });
    }
    renderDocsList();
  } catch (e) {
    console.error('[Docs] Image extraction failed:', e);
    const currentDocs = (entry.contextDocuments || []).filter(d => d.id !== placeholderId);
    saveEntry({ contextDocuments: currentDocs });
    renderDocsList();
  }
}

function renderDocsList() {
  const listEl = document.getElementById('docs-list');
  if (!listEl) return;
  const docs = entry.contextDocuments || [];
  if (!docs.length) {
    listEl.innerHTML = '';
    return;
  }

  const typeIcons = { pdf: '\ud83d\udcc4', image: '\ud83d\uddbc\ufe0f', text: '\ud83d\udcdd' };
  let totalTokens = 0;

  listEl.innerHTML = docs.map(d => {
    totalTokens += d.tokenEstimate || 0;
    const icon = typeIcons[d.type] || '\ud83d\udcc4';
    const date = d.addedAt ? new Date(d.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const preview = d._extracting
      ? '<div class="doc-extracting-text">Extracting text…</div>'
      : `<div class="doc-preview">${escapeHtml((d.extractedText || '').slice(0, 150))}${d.extractedText?.length > 150 ? '...' : ''}</div>`;
    return `<div class="doc-card${d._extracting ? ' extracting' : ''}" data-doc-id="${d.id}">
      <div class="doc-icon">${icon}</div>
      <div class="doc-info">
        <div class="doc-filename">${escapeHtml(d.filename)}</div>
        <div class="doc-meta">${date} · ~${d.tokenEstimate} tokens</div>
        ${preview}
      </div>
      <button class="doc-delete" data-doc-id="${d.id}" title="Remove">\u2715</button>
    </div>`;
  }).join('');

  // Token budget warning
  if (totalTokens > 4000) {
    listEl.insertAdjacentHTML('beforeend', `<div class="docs-budget-warn">Context budget exceeded (${totalTokens} tokens). Oldest documents may be truncated in AI conversations.</div>`);
  }
}

function formatCacheAge(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

function renderEmailsFromData(emails) {
  const statusEl = document.getElementById('act-emails-status');
  const listEl   = document.getElementById('act-emails-list');
  if (!statusEl || !listEl) return;
  statusEl.style.display = 'none';
  listEl.innerHTML = renderEmailThreads(emails);
  bindThreadToggles(listEl);
}

function loadHubEmails(forceRefresh) {
  const statusEl  = document.getElementById('act-emails-status');
  const listEl    = document.getElementById('act-emails-list');
  if (!statusEl || !listEl) return;

  // Serve from cache if available and not forcing refresh
  if (!forceRefresh && entry.cachedEmails?.length) {
    renderEmailsFromData(entry.cachedEmails);
    // Still extract any contacts we may have missed from cached emails
    applyContactsFromEmails(entry.cachedEmails);
    return;
  }

  statusEl.style.display = '';
  statusEl.textContent = 'Loading emails…';
  if (listEl) listEl.innerHTML = '';

  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  const knownContactEmails = (entry.knownContacts || []).map(c => c.email);
  chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName: entry.company || '', linkedinSlug, knownContactEmails }, result => {
    void chrome.runtime.lastError;
    if (!document.getElementById('act-emails-status')) return; // pane unmounted
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Gmail in Setup to see emails.'; return; }
    if (!result?.emails?.length)           { statusEl.textContent = 'No emails found for this company.'; return; }

    const now = Date.now();
    const emailUpdates = { cachedEmails: result.emails, cachedEmailsAt: now };
    if (result.userEmail) {
      emailUpdates.gmailUserEmail = result.userEmail;
      gmailUserEmail = result.userEmail.toLowerCase(); // update module-level variable immediately
    }
    saveEntry(emailUpdates);
    renderEmailsFromData(result.emails);
    applyContactsFromEmails(result.emails);
    maybeRescore('new_emails');
  });
}

function loadHubMeetings(forceRefresh) {
  const statusEl  = document.getElementById('act-meetings-status');
  const contentEl = document.getElementById('act-meetings-content');
  if (!statusEl || !contentEl) return;

  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const knownContactEmails = (entry.knownContacts || []).flatMap(c => [c.email, ...(c.aliases || [])]);
  const contactNames = (entry.knownContacts || []).map(c => c.name).filter(Boolean);

  // Show cached calendar events immediately — never block UI on fetches
  if (entry.cachedCalendarEvents?.length) {
    statusEl.style.display = 'none';
    renderMeetingsTimeline(entry.cachedCalendarEvents, entry.cachedMeetingNotes);
  } else if (entry.manualMeetings?.length) {
    // Show manual meetings immediately while calendar loads
    statusEl.style.display = 'none';
    renderMeetingsTimeline([], null);
  } else {
    statusEl.textContent = 'Loading meetings…';
  }

  // Always refresh calendar (fast)
  chrome.runtime.sendMessage({ type: 'CALENDAR_FETCH_EVENTS', domain, companyName: entry.company, knownContactEmails }, calResult => {
    void chrome.runtime.lastError;
    if (!document.getElementById('act-meetings-status')) return;
    const calEvents = calResult?.events || [];
    const calError = calResult?.error;

    if (calError === 'needs_reauth') {
      statusEl.textContent = `Calendar access error. Disconnect and reconnect Gmail in Setup.`;
      statusEl.style.display = '';
      return;
    }

    if (calEvents.length) {
      saveEntry({ cachedCalendarEvents: calEvents });
      if (detectScheduledStatus(entry)) {
        const current = entry.actionStatus || 'my_court';
        if (current === 'my_court' || current === 'their_court') {
          saveEntry({ actionStatus: 'scheduled' });
        }
      } else if (entry.actionStatus === 'scheduled') {
        saveEntry({ actionStatus: defaultActionStatus(entry.jobStage || entry.status) || 'my_court' });
      }
      statusEl.style.display = 'none';
      renderMeetingsTimeline(calEvents, entry.cachedMeetingNotes);
      // Auto-populate next step date from nearest future calendar event
      if (!entry.nextStepDate && calEvents.length) {
        const now = new Date();
        const futureEvents = calEvents
          .filter(e => new Date(e.start) > now)
          .sort((a, b) => new Date(a.start) - new Date(b.start));
        if (futureEvents.length) {
          const nextDate = new Date(futureEvents[0].start).toISOString().slice(0, 10);
          const updates = { nextStepDate: nextDate };
          // Also auto-set next step text from calendar event title if not set
          if (!entry.nextStep) {
            updates.nextStep = futureEvents[0].summary || futureEvents[0].title || 'Upcoming meeting';
          }
          saveEntry(updates);
          renderPanel('opportunity');
        }
      }
      // If no date found and no next step at all, try AI extraction
      if (!entry.nextStep && !entry.nextStepDate) {
        chrome.runtime.sendMessage({
          type: 'EXTRACT_NEXT_STEPS',
          notes: entry.cachedMeetingNotes || null,
          transcripts: entry.cachedMeetingTranscript || null,
          calendarEvents: calEvents
        }, result => {
          void chrome.runtime.lastError;
          if (result?.nextStep || result?.nextStepDate) {
            saveEntry({ nextStep: result.nextStep || null, nextStepDate: result.nextStepDate || null });
            renderPanel('opportunity');
          }
        });
      }
    } else if (!entry.cachedCalendarEvents?.length) {
      // Still render the meetings timeline so the "+ Add meeting" button is available
      statusEl.style.display = 'none';
      renderMeetingsTimeline([], null);
    }
  });

  // Set context overrides from cache so embedded chat panels have context immediately
  function applyGranolaContextOverrides() {
    if (typeof setChatContext !== 'function') return;
    const allCtx = entry.cachedMeetingTranscript || entry.cachedMeetingNotes || '';
    if (allCtx) {
      setChatContext(`${entry.id}-meetings`, allCtx); // meetings-tab chat
      setChatContext(entry.id, allCtx);               // floating chat (uses base entry.id as key)
    }
    (entry.cachedMeetings || []).forEach(m => {
      if (m.transcript) setChatContext(`${entry.id}-meeting-${m.id}`, m.transcript);
    });
    // Manual meetings context
    (entry.manualMeetings || []).forEach(m => {
      const ctx = m.transcript || m.notes || '';
      if (ctx) setChatContext(`${entry.id}-meeting-${m.id}`, ctx);
    });
  }
  applyGranolaContextOverrides();

  // Refresh Granola only if forced or we have no notes or cache is older than 30 minutes
  const granolaAge = (entry.cachedMeetingNotes && entry.cachedMeetingNotesAt)
    ? (Date.now() - entry.cachedMeetingNotesAt) / 60000
    : Infinity;
  const missingStructuredMeetings = !entry.cachedMeetings?.length;
  if (!forceRefresh && granolaAge < 30 && !missingStructuredMeetings) return;

  Promise.race([
    new Promise(r => {
      const companyDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
      chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company, companyDomain, contactNames }, result => {
        void chrome.runtime.lastError;
        r(result || { notes: null });
      });
    }),
    new Promise(r => setTimeout(() => r({ notes: null, error: 'timeout' }), 20000))
  ]).then(granolaResult => {
    if (!document.getElementById('act-meetings-content')) return;
    const granolaNotes = granolaResult?.notes || null;
    const granolaTranscript = granolaResult?.transcript || null;
    const granolaMeetings = granolaResult?.meetings || null;
    if (granolaNotes || granolaTranscript || granolaMeetings?.length) {
      saveEntry({
        cachedMeetingNotes: granolaNotes,
        cachedMeetingTranscript: granolaTranscript,
        cachedMeetings: granolaMeetings,
        cachedMeetingNotesAt: Date.now(),
      });
      applyGranolaContextOverrides();
      const calEvents = entry.cachedCalendarEvents || [];
      renderMeetingsTimeline(calEvents, granolaNotes);

      // New context arrived — refresh fit analysis and job match score
      maybeRefreshDeepFitAnalysis();
      maybeRescore('new_meetings');

      // Auto-populate next step + date if not already set
      if (!entry.nextStep && !entry.nextStepDate) {
        chrome.runtime.sendMessage({
          type: 'EXTRACT_NEXT_STEPS',
          notes: granolaNotes,
          transcripts: granolaTranscript,
          calendarEvents: calEvents
        }, result => {
          void chrome.runtime.lastError;
          if (result?.nextStep || result?.nextStepDate) {
            saveEntry({
              nextStep: result.nextStep || null,
              nextStepDate: result.nextStepDate || null
            });
            renderPanel('opportunity');
          }
        });
      }
    }
  });
}

function renderMeetingsTimeline(events, granolaNotes, granolaError) {
  const contentEl = document.getElementById('act-meetings-content');
  if (!contentEl) return;

  const granolaM = (entry.cachedMeetings || []).map(m => ({ ...m, _isManual: false }));
  const manualM = (entry.manualMeetings || []).map(m => ({ ...m, _isManual: true }));
  const meetings = [...granolaM, ...manualM].sort((a, b) => {
    const da = a.date || ''; const db = b.date || '';
    return da < db ? 1 : da > db ? -1 : 0;
  });
  const allCtx = entry.cachedMeetingTranscript || entry.cachedMeetingNotes || '';
  let html = '';

  // ── "+ Add meeting" button and form ────────────────────────────────────────
  html += `<button class="mtg-add-btn" id="mtg-add-btn">+ Add meeting</button>`;
  html += `
    <div class="mtg-add-form" id="mtg-add-form" style="display:none">
      <div class="mtg-add-title">Log a meeting</div>
      <div class="mtg-add-fields">
        <input type="text" class="mtg-add-input" id="mm-title" placeholder="Meeting title…">
        <div style="display:flex;gap:8px">
          <input type="date" class="mtg-add-input" id="mm-date" style="flex:1">
          <input type="text" class="mtg-add-input" id="mm-time" placeholder="e.g. 2:00 PM" style="flex:1">
        </div>
        <input type="text" class="mtg-add-input" id="mm-attendees" placeholder="e.g. Sarah Chen, VP Sales">
        <textarea class="mtg-add-input" id="mm-notes" rows="4" placeholder="Key takeaways, decisions, action items…"></textarea>
        <div class="mtg-transcript-toggle" id="mm-transcript-toggle">+ Add full transcript</div>
        <textarea class="mtg-add-input" id="mm-transcript" rows="8" placeholder="Paste full meeting transcript…" style="display:none"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="mtg-add-save" id="mm-save">Save meeting</button>
          <button class="mtg-add-cancel" id="mm-cancel">Cancel</button>
        </div>
      </div>
    </div>`;

  // ── "+ Log activity" button and form ────────────────────────────────────────
  html += `<button class="mtg-add-btn" id="activity-log-btn" style="margin-left:8px">+ Log activity</button>`;
  html += `
    <div id="activity-log-form" style="display:none" class="mtg-add-form">
      <div class="mtg-add-title">Log an activity</div>
      <div class="mtg-add-fields">
        <select class="mtg-add-input" id="al-type">
          <option value="linkedin_dm">LinkedIn DM</option>
          <option value="phone_call">Phone Call</option>
          <option value="coffee_chat">Coffee Chat</option>
          <option value="text">Text Message</option>
          <option value="referral">Referral / Intro</option>
          <option value="email_sent">Email Sent</option>
          <option value="other">Other</option>
        </select>
        <input type="text" class="mtg-add-input" id="al-note" placeholder="What happened?">
        <input type="date" class="mtg-add-input" id="al-date" style="width:auto">
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="mtg-add-save" id="al-save">Save</button>
          <button class="mtg-add-cancel" id="al-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
  html += `<div id="activity-log-list"></div>`;

  // ── "Ask about all meetings" chat (shown if we have any data) ──────────────
  if (meetings.length || allCtx) {
    html += `
      <div class="mtg-ask-all">
        <div class="mtg-ask-all-header">
          <span class="mtg-folder-icon">▤</span>
          <div>
            <div class="mtg-ask-all-title">${escapeHtml(entry.company)}</div>
            <div class="mtg-ask-all-sub">${meetings.length ? meetings.length + ' meeting' + (meetings.length === 1 ? '' : 's') : 'All meetings'}</div>
          </div>
        </div>
        <div data-chat-panel="${entry.id}"
             data-chat-key="${entry.id}-meetings"
             data-chat-placeholder="Ask about all meetings…"
             data-chat-minimal="1"></div>
        <div class="mtg-quick-actions">
          <button class="mtg-quick-btn" data-prompt="Summarize all my meetings with this company">Summarize all</button>
          <button class="mtg-quick-btn" data-prompt="What were the key decisions from my meetings with this company?">Key decisions</button>
          <button class="mtg-quick-btn" data-prompt="List all action items from my meetings with this company">Action items</button>
          <button class="mtg-refresh-btn" id="mtg-refresh-btn" title="Clear cached meetings and re-fetch from Granola">↻ Refresh meetings</button>
        </div>
      </div>`;
  }

  // ── Combined meeting list (Granola + Manual, sorted by date desc) ──────────
  if (meetings.length) {
    const byDate = {};
    meetings.forEach(m => {
      const key = m.date || '';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(m);
    });

    html += '<div class="mtg-list">';
    for (const [dateKey, dayMeetings] of Object.entries(byDate)) {
      const d = dateKey ? new Date(dateKey + 'T12:00:00') : null;
      const dateLabel = (d && !isNaN(d))
        ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : 'Unknown date';
      html += `<div class="mtg-date-group">${escapeHtml(dateLabel)}</div>`;
      for (const m of dayMeetings) {
        const manualBadge = m._isManual ? `<span class="mtg-manual-badge">Manual</span>` : '';
        const manualActions = m._isManual ? `<button class="mtg-card-edit" data-mm-edit="${escapeHtml(m.id)}" title="Edit">✎</button><button class="mtg-card-del" data-mm-del="${escapeHtml(m.id)}" title="Delete">✕</button>` : '';
        html += `
          <div class="mtg-card" data-meeting-id="${escapeHtml(m.id)}" data-is-manual="${m._isManual ? '1' : '0'}">
            <span class="mtg-card-icon">${m._isManual ? '✏️' : '▤'}</span>
            <div class="mtg-card-body">
              <div class="mtg-card-title">${escapeHtml(m.title || 'Untitled')}${manualBadge}</div>
              ${m.attendees ? `<div class="mtg-card-meta">${escapeHtml(m.attendees)}</div>` : ''}
            </div>
            ${m.time ? `<span class="mtg-card-time">${escapeHtml(m.time)}</span>` : ''}
            ${manualActions}
            <span class="mtg-card-arrow">›</span>
          </div>`;
      }
    }
    html += '</div>';

  } else if (events.length) {
    // Fallback: calendar-only view
    const byDate = {};
    [...events].reverse().forEach(ev => {
      const d = new Date(ev.start);
      const key = isNaN(d) ? ev.start : d.toISOString().slice(0, 10);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(ev);
    });

    html += '<div class="mtg-list">';
    for (const [dateKey, dayEvs] of Object.entries(byDate)) {
      const d = new Date(dateKey + 'T12:00:00');
      const dateLabel = isNaN(d) ? dateKey : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      html += `<div class="mtg-date-group">${escapeHtml(dateLabel)}</div>`;
      for (const ev of dayEvs) {
        const evD = new Date(ev.start);
        const timeStr = (ev.start.includes('T') && !isNaN(evD))
          ? evD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : '';
        const attendees = (ev.attendees || []).filter(a => !a.self).map(a => a.name || a.email).join(', ');
        html += `
          <div class="mtg-card mtg-card-cal">
            <span class="mtg-card-icon mtg-card-icon-cal">◷</span>
            <div class="mtg-card-body">
              <div class="mtg-card-title">${escapeHtml(ev.title)}</div>
              ${attendees ? `<div class="mtg-card-meta">${escapeHtml(attendees)}</div>` : ''}
            </div>
            ${timeStr ? `<span class="mtg-card-time">${timeStr}</span>` : ''}
          </div>`;
      }
    }
    html += '</div>';
  }

  if (!html) html = '<div class="p-empty">No meetings found.</div>';

  contentEl.innerHTML = html;

  // Init "ask all meetings" chat panel
  if (typeof initChatPanels === 'function') initChatPanels(entry);

  // ── Manual meeting form wiring ─────────────────────────────────────────────
  let _mmEditId = null; // tracks which manual meeting is being edited
  const addBtn = contentEl.querySelector('#mtg-add-btn');
  const addForm = contentEl.querySelector('#mtg-add-form');
  const mmTitle = contentEl.querySelector('#mm-title');
  const mmDate = contentEl.querySelector('#mm-date');
  const mmTime = contentEl.querySelector('#mm-time');
  const mmAttendees = contentEl.querySelector('#mm-attendees');
  const mmNotes = contentEl.querySelector('#mm-notes');
  const mmTranscript = contentEl.querySelector('#mm-transcript');
  const mmTranscriptToggle = contentEl.querySelector('#mm-transcript-toggle');
  const mmSave = contentEl.querySelector('#mm-save');
  const mmCancel = contentEl.querySelector('#mm-cancel');

  if (addBtn && addForm) {
    // Default date to today
    mmDate.value = new Date().toISOString().slice(0, 10);

    addBtn.addEventListener('click', () => {
      _mmEditId = null;
      mmTitle.value = ''; mmTime.value = ''; mmAttendees.value = '';
      mmNotes.value = ''; mmTranscript.value = '';
      mmDate.value = new Date().toISOString().slice(0, 10);
      mmTranscript.style.display = 'none';
      mmTranscriptToggle.textContent = '+ Add full transcript';
      mmSave.textContent = 'Save meeting';
      addForm.style.display = '';
      addBtn.style.display = 'none';
      mmTitle.focus();
    });

    mmTranscriptToggle.addEventListener('click', () => {
      const showing = mmTranscript.style.display !== 'none';
      mmTranscript.style.display = showing ? 'none' : '';
      mmTranscriptToggle.textContent = showing ? '+ Add full transcript' : '− Hide transcript';
    });

    mmCancel.addEventListener('click', () => {
      addForm.style.display = 'none';
      addBtn.style.display = '';
      _mmEditId = null;
    });

    mmSave.addEventListener('click', () => {
      const title = mmTitle.value.trim();
      const date = mmDate.value || new Date().toISOString().slice(0, 10);
      const time = mmTime.value.trim();
      const attendees = mmAttendees.value.trim();
      const notes = mmNotes.value.trim();
      const transcript = mmTranscript.value.trim();

      if (!title && !notes && !transcript) return; // require at least something

      const current = entry.manualMeetings || [];

      if (_mmEditId) {
        // Update existing
        const idx = current.findIndex(m => m.id === _mmEditId);
        if (idx !== -1) {
          current[idx] = { ...current[idx], title, date, time, attendees, notes, transcript, updatedAt: Date.now() };
        }
      } else {
        // Create new
        current.unshift({
          id: 'mm_' + Date.now(),
          title, date, time, attendees, notes, transcript,
          createdAt: Date.now(),
        });
      }

      saveEntry({ manualMeetings: current });

      // Set chat context for this manual meeting
      if (typeof setChatContext === 'function') {
        const m = _mmEditId ? current.find(x => x.id === _mmEditId) : current[0];
        if (m) setChatContext(`${entry.id}-meeting-${m.id}`, m.transcript || m.notes || '');
      }

      _mmEditId = null;
      renderMeetingsTimeline(events, granolaNotes);
    });
  }

  // ── Edit / Delete handlers for manual meetings ─────────────────────────────
  contentEl.querySelectorAll('[data-mm-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mid = btn.dataset.mmEdit;
      const m = (entry.manualMeetings || []).find(x => x.id === mid);
      if (!m || !addForm) return;
      _mmEditId = mid;
      mmTitle.value = m.title || '';
      mmDate.value = m.date || '';
      mmTime.value = m.time || '';
      mmAttendees.value = m.attendees || '';
      mmNotes.value = m.notes || '';
      mmTranscript.value = m.transcript || '';
      mmTranscript.style.display = m.transcript ? '' : 'none';
      mmTranscriptToggle.textContent = m.transcript ? '− Hide transcript' : '+ Add full transcript';
      mmSave.textContent = 'Update meeting';
      addForm.style.display = '';
      addBtn.style.display = 'none';
      mmTitle.focus();
    });
  });

  contentEl.querySelectorAll('[data-mm-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mid = btn.dataset.mmDel;
      const current = (entry.manualMeetings || []).filter(x => x.id !== mid);
      saveEntry({ manualMeetings: current });
      renderMeetingsTimeline(events, granolaNotes);
    });
  });

  // Quick-action chips → fill input and send
  contentEl.querySelectorAll('.mtg-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = contentEl.querySelector('.chat-input');
      if (input) {
        input.value = btn.dataset.prompt;
        input.focus();
        input.dispatchEvent(new Event('input'));
        // Trigger send by clicking the send button
        const sendBtn = contentEl.querySelector('.chat-send-btn');
        if (sendBtn) sendBtn.click();
      }
    });
  });

  // Refresh meetings — clear cache and re-fetch from Granola
  const refreshBtn = contentEl.querySelector('#mtg-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '↻ Refreshing…';
      // Clear cached meetings from saved entry
      entry.cachedMeetings = [];
      entry.cachedMeetingNotes = null;
      entry.cachedMeetingNotesAt = null;
      entry.cachedMeetingTranscript = null;
      // Persist the cleared cache
      saveEntry({
        cachedMeetings: [],
        cachedMeetingNotes: null,
        cachedMeetingNotesAt: null,
        cachedMeetingTranscript: null,
      });
      // Re-fetch by re-running loadHubMeetings with forceRefresh
      loadHubMeetings(true);
    });
  }

  // Meeting card click → detail view (for both Granola and manual meetings)
  contentEl.querySelectorAll('.mtg-card[data-meeting-id]').forEach(card => {
    card.addEventListener('click', () => {
      const mid = card.dataset.meetingId;
      const isManual = card.dataset.isManual === '1';
      let meeting;
      if (isManual) {
        meeting = (entry.manualMeetings || []).find(m => m.id === mid);
        if (meeting) {
          // Manual meetings render detail with notes as body
          renderManualMeetingDetail(contentEl, meeting, events, granolaNotes);
        }
      } else {
        meeting = (entry.cachedMeetings || []).find(m => m.id === mid);
        if (meeting) renderMeetingDetail(contentEl, meeting, events, granolaNotes);
      }
    });
  });

  // ── Activity Log wiring ───────────────────────────────────────────────────
  const alBtn = contentEl.querySelector('#activity-log-btn');
  const alForm = contentEl.querySelector('#activity-log-form');
  const alType = contentEl.querySelector('#al-type');
  const alNote = contentEl.querySelector('#al-note');
  const alDate = contentEl.querySelector('#al-date');
  const alSave = contentEl.querySelector('#al-save');
  const alCancel = contentEl.querySelector('#al-cancel');

  function renderActivityLog() {
    const listEl = contentEl.querySelector('#activity-log-list');
    if (!listEl) return;
    const log = (entry.activityLog || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!log.length) { listEl.innerHTML = ''; return; }

    const typeLabels = {
      linkedin_dm: '\u{1F4AC} LinkedIn DM',
      phone_call: '\u{1F4DE} Phone Call',
      coffee_chat: '\u2615 Coffee Chat',
      text: '\u{1F4F1} Text Message',
      referral: '\u{1F91D} Referral / Intro',
      email_sent: '\u{1F4E7} Email Sent',
      other: '\u{1F4CC} Other'
    };

    listEl.innerHTML = '<div style="font-size:11px;font-weight:700;color:#516f90;text-transform:uppercase;letter-spacing:0.05em;margin:16px 0 8px">Activity Log</div>' +
      log.map(a => {
        const d = new Date(a.date + 'T12:00:00');
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="activity-log-entry" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f3f8;font-size:12px">
          <span style="color:#7c98b6;white-space:nowrap">${dateStr}</span>
          <span style="color:#516f90;font-weight:600;white-space:nowrap">${typeLabels[a.type] || a.type}</span>
          <span style="color:#33475b;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.note || '')}</span>
          <button class="mtg-card-del" data-al-id="${a.id}" title="Delete" style="flex-shrink:0">\u2715</button>
        </div>`;
      }).join('');

    // Delete handlers
    listEl.querySelectorAll('[data-al-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const aid = btn.dataset.alId;
        const current = (entry.activityLog || []).filter(x => x.id !== aid);
        entry.activityLog = current;
        saveEntry({ activityLog: current });
        renderActivityLog();
      });
    });
  }

  if (alBtn && alForm) {
    // Default date to today
    alDate.value = new Date().toISOString().slice(0, 10);

    alBtn.addEventListener('click', () => {
      alNote.value = '';
      alDate.value = new Date().toISOString().slice(0, 10);
      alType.value = 'linkedin_dm';
      alForm.style.display = '';
      alBtn.style.display = 'none';
      alNote.focus();
    });

    alCancel.addEventListener('click', () => {
      alForm.style.display = 'none';
      alBtn.style.display = '';
    });

    alSave.addEventListener('click', () => {
      const type = alType.value;
      const note = alNote.value.trim();
      const date = alDate.value || new Date().toISOString().slice(0, 10);

      const current = entry.activityLog || [];
      current.unshift({
        id: 'act_' + Date.now(),
        type,
        note,
        date,
        createdAt: Date.now(),
      });
      entry.activityLog = current;
      saveEntry({ activityLog: current });

      alForm.style.display = 'none';
      alBtn.style.display = '';
      renderActivityLog();
    });
  }

  renderActivityLog();
}

function renderManualMeetingDetail(contentEl, meeting, events, granolaNotes) {
  const d = meeting.date ? new Date(meeting.date + 'T12:00:00') : null;
  const dateLabel = (d && !isNaN(d))
    ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : (meeting.date || '');

  // Set context for this meeting's chat before rendering
  if (typeof setChatContext === 'function') {
    setChatContext(`${entry.id}-meeting-${meeting.id}`, meeting.transcript || meeting.notes || '');
  }

  const bodyText = meeting.notes || '';
  contentEl.innerHTML = `
    <button class="mtg-detail-back" id="mtg-back">← All meetings</button>
    <div class="mtg-detail-header">
      ${dateLabel ? `<div class="mtg-detail-date">${escapeHtml(dateLabel)}${meeting.time ? ' · ' + meeting.time : ''}</div>` : ''}
      <div class="mtg-detail-title">${escapeHtml(meeting.title || 'Untitled')}<span class="mtg-manual-badge">Manual</span></div>
      ${meeting.attendees ? `<div class="mtg-card-meta" style="margin-top:4px">${escapeHtml(meeting.attendees)}</div>` : ''}
    </div>
    ${bodyText ? `<div style="font-size:13px;color:#33475b;line-height:1.7;margin:12px 0;white-space:pre-wrap">${escapeHtml(bodyText)}</div>` : ''}
    <div class="mtg-detail-chat">
      <div data-chat-panel="${entry.id}"
           data-chat-key="${entry.id}-meeting-${meeting.id}"
           data-chat-placeholder="Ask about this meeting…"
           data-chat-minimal="1"></div>
    </div>
    ${meeting.transcript ? `
      <details class="mtg-transcript-wrap">
        <summary class="mtg-transcript-label">Full transcript</summary>
        <div class="mtg-transcript">${typeof renderMarkdown === 'function' ? renderMarkdown(meeting.transcript) : escapeHtml(meeting.transcript)}</div>
      </details>` : ''}
  `;

  if (typeof initChatPanels === 'function') initChatPanels(entry);

  document.getElementById('mtg-back').addEventListener('click', () => {
    renderMeetingsTimeline(events, granolaNotes);
  });
}

function renderMeetingDetail(contentEl, meeting, events, granolaNotes) {
  const d = meeting.date ? new Date(meeting.date + 'T12:00:00') : null;
  const dateLabel = (d && !isNaN(d))
    ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : (meeting.date || '');

  // Set context for this meeting's chat before rendering
  if (typeof setChatContext === 'function' && meeting.transcript) {
    setChatContext(`${entry.id}-meeting-${meeting.id}`, meeting.transcript);
  }

  contentEl.innerHTML = `
    <button class="mtg-detail-back" id="mtg-back">← All meetings</button>
    <div class="mtg-detail-header">
      ${dateLabel ? `<div class="mtg-detail-date">${escapeHtml(dateLabel)}${meeting.time ? ' · ' + meeting.time : ''}</div>` : ''}
      <div class="mtg-detail-title">${escapeHtml(meeting.title)}</div>
    </div>
    <div class="mtg-detail-chat">
      <div data-chat-panel="${entry.id}"
           data-chat-key="${entry.id}-meeting-${meeting.id}"
           data-chat-placeholder="Ask about this meeting…"
           data-chat-minimal="1"></div>
    </div>
    ${meeting.transcript ? `
      <details class="mtg-transcript-wrap">
        <summary class="mtg-transcript-label">Full transcript</summary>
        <div class="mtg-transcript">${renderMarkdown(meeting.transcript)}</div>
      </details>` : ''}
  `;

  if (typeof initChatPanels === 'function') initChatPanels(entry);

  document.getElementById('mtg-back').addEventListener('click', () => {
    renderMeetingsTimeline(events, granolaNotes);
  });
}

function buildPanelHTML(pid) {
  if (pid === 'properties') return ''; // merged into opportunity panel
  const title = PANEL_TITLES[pid] || pid;
  const collapsed = !!collapsedPanels[pid];
  const body = buildPanelBody(pid);
  return `
    <div class="panel" id="panel-${pid}" data-panel="${pid}" draggable="true">
      <div class="panel-header">
        <span class="panel-drag-hint">⠿</span>
        <span class="panel-title">${title}</span>
        <button class="panel-collapse-btn" data-panel="${pid}">${collapsed ? '▼' : '▲'}</button>
      </div>
      <div class="panel-body${collapsed ? ' collapsed' : ''}" id="pbody-${pid}">
        ${body}
      </div>
    </div>`;
}

function renderPanel(pid) {
  const el = document.getElementById('panel-' + pid);
  if (!el) return;
  const body = document.getElementById('pbody-' + pid);
  if (body) body.innerHTML = buildPanelBody(pid);
  bindPanelBodyEvents(pid);
}

function buildPanelBody(pid) {
  switch (pid) {
    case 'properties': return buildProperties();
    case 'stats':      return buildStats();    // legacy fallback
    case 'links':      return buildLinks();    // legacy fallback
    case 'tags':       return buildTags();
    case 'notes':      return buildNotes();
    case 'overview':   return buildOverview();
    case 'intel':      return buildIntel();
    case 'reviews':    return buildReviews();
    case 'leadership': return buildLeadership();
    case 'contacts':   return buildContacts();
    case 'opportunity':    return buildOpportunity();
    case 'opportunities':  return buildOpportunity(); // legacy alias
    case 'hiring':     return buildHiring();
    case 'activity':   return buildActivity();
    case 'chat':       return `<button class="open-float-chat-btn" data-action="open-float-chat">✦ Open AI Chat</button>`;
    default: return '<div class="p-empty">No content.</div>';
  }
}

function buildProperties() {
  const allFields = [...DEFAULT_FIELD_DEFS, ...customFieldDefs];
  const rows = allFields.map(f => {
    const isCustom = !DEFAULT_FIELD_DEFS.find(d => d.id === f.id);

    // Website and LinkedIn render as clean hyperlinks
    if (f.id === 'companyWebsite' || f.id === 'companyLinkedin') {
      const icon = f.id === 'companyWebsite' ? '🌐' : '🔗';
      const displayText = f.id === 'companyWebsite'
        ? (entry[f.id] ? entry[f.id].replace(/^https?:\/\//, '').replace(/\/$/, '') : null)
        : (entry[f.id] ? 'LinkedIn' : null);
      const placeholder = f.id === 'companyWebsite' ? 'Add website URL…' : 'Add LinkedIn URL…';
      return `<div class="prop-row prop-link-row" data-field="${f.id}">
        ${entry[f.id]
          ? `<a class="prop-link-display" href="${entry[f.id]}" target="_blank">${icon} ${displayText}</a>
             <button class="prop-link-edit" data-field="${f.id}" title="Edit">✎</button>`
          : `<span class="prop-link-icon">${icon}</span>
             <input class="prop-input prop-empty prop-link-input" data-field="${f.id}" value="" placeholder="${placeholder}" type="url">`}
      </div>`;
    }

    const val = (entry[f.id] || '').replace(/"/g, '&quot;');
    // Always show employees and industry; hide other empty metadata fields
    const alwaysShow = ['employees', 'industry'].includes(f.id);
    const isMetadataField = ['employees', 'funding', 'founded', 'industry'].includes(f.id);
    if (isMetadataField && !val && !alwaysShow) return '';
    const isUrl = f.type === 'url';
    const openLink = isUrl && entry[f.id]
      ? `<a class="prop-open-link" href="${entry[f.id]}" target="_blank">↗</a>` : '';
    return `<div class="prop-row" data-field="${f.id}">
      <span class="prop-label">${f.label}</span>
      <div class="prop-val-wrap">
        <input class="prop-input${!val ? ' prop-empty' : ''}" data-field="${f.id}" value="${val}" placeholder="—" ${isUrl ? 'type="url"' : ''}>
        ${openLink}
      </div>
      ${isCustom ? `<button class="prop-delete-btn" data-field="${f.id}" title="Remove field">✕</button>` : ''}
    </div>`;
  }).join('');

  // Job posting link — shown only for saved opportunities that have a job URL
  const jobLinkRow = (entry.isOpportunity && entry.jobUrl)
    ? `<div class="prop-row prop-link-row">
        <a class="prop-link-display" href="${entry.jobUrl}" target="_blank">📄 View Job Posting ↗</a>
      </div>`
    : '';

  return `<div class="prop-fields" id="prop-fields">${rows}${jobLinkRow}</div>`;
}

function buildStats() {
  const rows = [
    ['Employees', entry.employees],
    ['Funding',   entry.funding],
    ['Founded',   entry.founded],
    ['Industry',  entry.industry || entry.intelligence?.category || entry.category],
  ].filter(([, v]) => v);
  if (!rows.length) return '<div class="p-empty">No stats available.</div>';
  return rows.map(([label, val]) => `
    <div class="p-stat">
      <span class="p-stat-label">${label}</span>
      <span class="p-stat-value">${val}</span>
    </div>`).join('');
}

function buildLinks() {
  const li = entry.companyLinkedin || `https://www.linkedin.com/company/${encodeURIComponent((entry.company||'').toLowerCase().replace(/\s+/g,'-'))}`;
  return `
    ${entry.companyWebsite ? `<a class="p-link web" href="${entry.companyWebsite}" target="_blank">🌐 ${entry.companyWebsite.replace(/^https?:\/\//,'')}</a>` : ''}
    <a class="p-link li" href="${li}" target="_blank">in LinkedIn</a>
    ${entry.url ? `<a class="p-link" style="color:#FF7A59" href="${entry.url}" target="_blank">↗ Source Page</a>` : ''}
  `.trim() || '<div class="p-empty">No links saved.</div>';
}

function buildTags() {
  const tags = entry.tags || [];
  const tagHTML = tags.map(t => {
    const c = tagColor(t);
    return `<span class="p-tag" style="border-color:${c.border};color:${c.color};background:${c.bg}">${t}<span class="tag-rm" data-tag="${t}">✕</span></span>`;
  }).join('');
  return `<div class="p-tags" id="co-tags">
    ${tagHTML}
    <div class="tag-wrap" id="tag-add-wrap">
      <button class="tag-add-btn" id="tag-add-btn">+ tag</button>
    </div>
  </div>`;
}

function buildNotes() {
  return `<textarea class="p-notes" id="co-notes" placeholder="Add notes about this company…">${entry.notes || ''}</textarea>`;
}

function buildOverview() {
  const intel = entry.intelligence || {};
  const oneLiner = entry.oneLiner || intel.oneLiner || '';
  const eli5 = intel.eli5 || '';
  const cat = entry.category || intel.category || '';
  // Use oneLiner if available; fall back to eli5 if not — never show both
  const description = oneLiner || eli5;
  if (!description && !cat) return '<div class="p-empty">No overview available.</div>';
  return `
    ${cat ? `<span class="p-category">${cat}</span>` : ''}
    ${description ? `<div class="p-oneliner">${description}</div>` : ''}
  `.trim();
}

function buildIntel() {
  const intel = entry.intelligence || {};
  const parts = [
    intel.whosBuyingIt  ? ['Who Buys It',  intel.whosBuyingIt]  : null,
    intel.howItWorks    ? ['How It Works', intel.howItWorks]    : null,
  ].filter(Boolean);
  if (!parts.length) return '<div class="p-empty">No intel available.</div>';
  return parts.map(([label, text]) => `
    <div class="p-section">
      <div class="p-section-label">${label}</div>
      <div class="p-text">${text}</div>
    </div>`).join('');
}

function buildReviews() {
  const reviews = entry.reviews || [];
  if (!reviews.length) return '<div class="p-empty">No reviews saved.</div>';
  return reviews.slice(0, 5).map(r => `
    <div class="p-review">
      "${r.snippet}"
      <div class="p-review-src">${r.source ? `<a href="${r.url||'#'}" target="_blank">${r.source}</a>` : ''}</div>
    </div>`).join('');
}

// Extract contacts from emails and apply to entry, purging self
function applyContactsFromEmails(emails) {
  const { newContacts, detectedUserEmail } = extractContactsFromEmails(emails);
  const blocked = new Set((entry.removedContacts || []).map(e => e.toLowerCase()));
  let current = (entry.knownContacts || []).map(c => ({ ...c, aliases: c.aliases ? [...c.aliases] : [] }));

  // Purge user's own email
  const selfEmail = detectedUserEmail || gmailUserEmail;
  if (selfEmail) {
    current = current.filter(c =>
      c.email.toLowerCase() !== selfEmail &&
      !c.aliases.some(a => a.toLowerCase() === selfEmail)
    );
  }

  let changed = selfEmail && (entry.knownContacts || []).some(c =>
    c.email.toLowerCase() === selfEmail || (c.aliases || []).some(a => a.toLowerCase() === selfEmail)
  );

  newContacts.forEach(nc => {
    // Skip contacts the user has explicitly removed
    if (blocked.has(nc.email.toLowerCase())) return;
    // Same name → merge as alias instead of new card
    const match = current.find(c => namesMatch(c.name, nc.name));
    if (match) {
      const emailLower = nc.email.toLowerCase();
      if (!match.aliases) match.aliases = [];
      if (match.email !== emailLower && !match.aliases.includes(emailLower)) {
        match.aliases.push(emailLower);
        changed = true;
      }
    } else {
      current.push(nc);
      changed = true;
    }
  });

  if (!changed) return;
  saveEntry({ knownContacts: current });
  renderPanel('contacts');
  renderPanel('leadership');
  bindPanelBodyEvents('contacts');
  bindPanelBodyEvents('leadership');
}

// Filter out non-human / mass email addresses
function isNonHumanEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  return /^(noreply|no-reply|no\.reply|donotreply|alerts?|notifications?|newsletter|marketing|updates?|digest|mailer|support|info|hello|team|news|feedback|billing|admin|postmaster|webmaster|contact|sales|help|service|system|bot|automated|unsubscribe)$/.test(local)
    || /noreply|no-reply|donotreply|notification|newsletter|mailer-daemon|bounce/i.test(local);
}

// Extracts contacts from all participants in company-related emails
function extractContactsFromEmails(emails) {
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';
  const isCompanyEmail = email => {
    const d = (email.split('@')[1] || '').toLowerCase();
    return d === domain || (baseDomain && d.split('.')[0] === baseDomain);
  };

  const parseAddrs = field => {
    if (!field) return [];
    return field.split(/,\s*/).map(addr => {
      const m = addr.match(/^(.*?)\s*<([^>]+)>$/) || [null, '', addr.trim()];
      const name = (m[1] || '').replace(/^["']+|["']+$/g, '').trim();
      const email = (m[2] || '').trim().toLowerCase();
      return { name, email };
    }).filter(a => a.email.includes('@'));
  };

  // Detect the user's own email: the most frequent non-domain from: address is almost certainly the user
  const fromFreq = {};
  emails.forEach(e => {
    parseAddrs(e.from).forEach(({ email }) => {
      if (domain && isCompanyEmail(email)) return;
      fromFreq[email] = (fromFreq[email] || 0) + 1;
    });
  });
  const detectedUserEmail = gmailUserEmail ||
    (entry.gmailUserEmail || '').toLowerCase() ||
    Object.entries(fromFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const existing = new Set((entry.knownContacts || []).map(c => c.email.toLowerCase()));
  const newContacts = [];

  emails.forEach(e => {
    const allAddrs = [...parseAddrs(e.from), ...parseAddrs(e.to), ...parseAddrs(e.cc)];
    // Only process emails that involve someone from the company domain
    const hasCompanyParticipant = domain && allAddrs.some(a => isCompanyEmail(a.email));
    if (!hasCompanyParticipant && domain) return;

    allAddrs.forEach(({ name, email }) => {
      if (!email) return;
      if (detectedUserEmail && email === detectedUserEmail) return;
      if (existing.has(email)) return;
      // Only add contacts from the company's domain
      if (domain && !isCompanyEmail(email)) return;
      // Filter out non-human / mass email senders
      if (isNonHumanEmail(email)) return;
      existing.add(email);
      newContacts.push({ name: name || email.split('@')[0], email, source: 'email', detectedAt: Date.now() });
    });
  });

  return { newContacts, detectedUserEmail };
}

// Fuzzy name match: both share at least first + last word
function namesMatch(a, b) {
  const words = s => s.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const wa = words(a), wb = words(b);
  return wa.length >= 2 && wb.length >= 2 &&
    wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
}

// Merge contacts with the same name into one record with aliases
function deduplicateContacts(contacts) {
  const merged = [];
  contacts.forEach(c => {
    const existing = merged.find(m => namesMatch(m.name, c.name));
    if (existing) {
      const newEmails = [c.email, ...(c.aliases || [])].filter(
        e => e !== existing.email && !(existing.aliases || []).includes(e)
      );
      if (newEmails.length) existing.aliases = [...(existing.aliases || []), ...newEmails];
    } else {
      merged.push({ ...c, aliases: c.aliases ? [...c.aliases] : [] });
    }
  });
  return merged;
}

function buildLeadership() {
  const leaders = entry.leaders || [];
  if (!leaders.length) return '<div class="p-empty">No leadership data available.</div>';
  const contacts = entry.knownContacts || [];
  return leaders.map(l => {
    const initials = (l.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const matched = contacts.find(c => namesMatch(c.name, l.name || ''));
    const safeName = (l.name||'').replace(/"/g,'&quot;');
    const contactAction = matched
      ? `<span class="leader-is-contact">✓ Contact</span>`
      : `<button class="leader-add-contact-btn" data-name="${safeName}">+ Add as Contact</button>`;
    return `
      <div class="leader-card">
        <div class="leader-avatar" id="lavatar-${entry.id}-${encodeURIComponent(l.name||'')}">
          ${initials}
        </div>
        <div style="min-width:0;flex:1">
          <div class="leader-name">${l.name||''}</div>
          <div class="leader-role">${l.title||''}</div>
          ${matched ? `<div class="leader-email">${matched.email}</div>` : ''}
          <div class="leader-links">
            ${l.linkedinUrl||l.linkedin ? `<a class="leader-link li" href="${l.linkedinUrl||l.linkedin}" target="_blank">LinkedIn</a>` : ''}
            ${l.newsUrl ? `<a class="leader-link news" href="${l.newsUrl}" target="_blank">${/linkedin\.com/i.test(l.newsUrl) ? 'LinkedIn' : 'News'}</a>` : ''}
            ${contactAction}
          </div>
          <div class="leader-email-form" style="display:none">
            <input class="leader-email-input" type="email" placeholder="Email address…">
            <div class="leader-email-form-actions">
              <button class="leader-email-save-btn">Save</button>
              <button class="leader-email-cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function buildContacts() {
  const contacts = entry.knownContacts || [];
  const leaders = entry.leaders || [];
  const cardsHtml = contacts.length === 0
    ? `<div class="p-empty" style="font-size:12px;color:#7c98b6">No contacts yet. Add one below or scan emails.</div>`
    : contacts.map(c => {
        const initials = c.name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
        const sourceLabel = c.source === 'manual' ? '✎ manual' : c.source === 'email' ? '✉ email' : '📅 calendar';
        const safeEmail = c.email.replace(/"/g, '&quot;');
        const allEmails = [c.email, ...(c.aliases || [])];
        const emailsHtml = allEmails.map(em => {
          const se = em.replace(/"/g, '&quot;');
          return `<div class="contact-email-row">
            <span class="contact-email">${em}</span>
            <button class="contact-copy-btn" data-email="${se}" title="Copy email">⎘</button>
          </div>`;
        }).join('');
        const leader = leaders.find(l => namesMatch(l.name || '', c.name));
        const liUrl = leader?.linkedinUrl || leader?.linkedin || (leader?.newsUrl && /linkedin\.com/i.test(leader.newsUrl) ? leader.newsUrl : null);
        const liHtml = liUrl ? `<a class="contact-li-link" href="${liUrl}" target="_blank">LinkedIn</a>` : '';
        return `
          <div class="contact-card" data-email="${safeEmail}">
            <div class="contact-avatar" id="cavatar-${encodeURIComponent(c.email)}">${initials}</div>
            <div style="min-width:0;overflow:hidden;flex:1">
              <div class="contact-name">${c.name}</div>
              ${emailsHtml}
              ${liHtml}
              <div class="contact-source">${sourceLabel}</div>
            </div>
            <div class="contact-card-actions">
              <button class="contact-edit-btn" data-email="${safeEmail}" title="Edit">✎</button>
              <button class="contact-remove-btn" data-email="${safeEmail}" title="Remove">×</button>
            </div>
          </div>`;
      }).join('');
  return `
    ${cardsHtml}
    <div class="contact-add-row">
      <button class="contact-add-btn" id="contact-add-btn">+ Add contact</button>
    </div>
    <div class="contact-add-form" id="contact-add-form" style="display:none">
      <input class="contact-add-input" id="contact-add-name" placeholder="Name">
      <input class="contact-add-input" id="contact-add-email" placeholder="Email">
      <div class="contact-add-actions">
        <button class="contact-confirm-btn" id="contact-add-save">Add</button>
        <button class="contact-cancel-btn" id="contact-add-cancel">Cancel</button>
      </div>
    </div>`;
}

function buildOpportunities() {
  const opps = allCompanies.filter(o => o.type === 'job' && o.linkedCompanyId === entry.id);
  const oppCards = opps.map(o => {
    const sc = stageColor(o.status || 'needs_review', customOpportunityStages);
    const stage = customOpportunityStages.find(s => s.key === (o.status||'needs_review'));
    return `<a class="opp-card" href="${chrome.runtime.getURL('opportunity.html')}?id=${o.id}" target="_blank">
      <div class="opp-card-title">${(o.jobTitle && o.jobTitle !== 'New Opportunity') ? o.jobTitle : `Custom Role @ ${o.company || entry.company}`}</div>
      <div class="opp-card-meta">Saved ${new Date(o.savedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
      <span class="opp-card-status" style="border-color:${sc};color:${sc};background:${hexToRgba(sc,0.08)}">${stage?.label||o.status||''}</span>
    </a>`;
  }).join('');
  const actionBtn = opps.length > 0
    ? `<a class="new-opp-btn view-opp-btn" href="${chrome.runtime.getURL('opportunity.html')}?id=${opps[0].id}" target="_blank">View Opportunity →</a>`
    : `<button class="new-opp-btn" id="new-opp-btn">+ Add as Opportunity</button>`;
  return `
    ${oppCards}
    ${actionBtn}
  `;
}

function buildHiring() {
  // Pull job listings from the entry itself or from any linked opportunity
  const allListings = entry.jobListings || (() => {
    const linked = allCompanies.find(o => o.type === 'job' && o.linkedCompanyId === entry.id);
    return linked?.jobListings || [];
  })();
  // Filter to listings that mention the company name to avoid false positives from keyword overlap
  const companyLower = (entry.company || '').toLowerCase();
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const listings = allListings.filter(j => {
    const title = (j.title || '').toLowerCase();
    const url = (j.url || '').toLowerCase();
    const inTitle = title.includes(companyLower) || (domain && title.includes(domain));
    const inUrl = domain && url.includes(domain);
    if (!inTitle && !inUrl) return false;
    // Skip results where the title is basically just the company name with no job context
    const stripped = title.replace(companyLower, '').replace(domain || '', '').replace(/[^a-z0-9]/g, '');
    if (stripped.length < 5) return false;
    return true;
  });
  if (!listings.length) return `<div class="p-empty" style="font-size:13px;color:#7c98b6;padding:10px 0">No additional open roles found.</div>`;
  return listings.map(j => `
    <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f0f3f8">
      <span style="color:#3d5468;font-size:14px;flex-shrink:0">•</span>
      <span style="font-size:13px;color:#33475b">
        ${j.title || 'Open Role'}
        ${j.url ? `<a href="${j.url}" target="_blank" style="color:#0077b5;text-decoration:none;margin-left:4px">↗</a>` : ''}
        ${j.location ? `<span style="color:#64748b;font-size:12px"> · ${j.location}</span>` : ''}
      </span>
    </div>`).join('');
}

function buildActivity() {
  return `
    <div class="activity-tabs">
      <button class="activity-tab active" data-tab="emails">Emails</button>
      <button class="activity-tab" data-tab="meetings">Meetings</button>
    </div>
    <div class="activity-pane active" id="act-emails-pane">
      <div class="p-empty" id="act-emails-status">Loading emails…</div>
      <div id="act-emails-list"></div>
    </div>
    <div class="activity-pane" id="act-meetings-pane">
      <div class="p-empty" id="act-meetings-status">Loading meeting notes…</div>
      <div id="act-meetings-content"></div>
    </div>`;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  const palette = [
    { border: '#818cf8', color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
    { border: '#34d399', color: '#059669', bg: 'rgba(5,150,105,0.08)'  },
    { border: '#fbbf24', color: '#d97706', bg: 'rgba(217,119,6,0.08)'  },
    { border: '#f472b6', color: '#db2777', bg: 'rgba(219,39,119,0.08)' },
    { border: '#60a5fa', color: '#2563eb', bg: 'rgba(37,99,235,0.08)'  },
    { border: '#a78bfa', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    { border: '#fb923c', color: '#ea6d0d', bg: 'rgba(234,109,13,0.08)' },
    { border: '#2dd4bf', color: '#0d9488', bg: 'rgba(13,148,136,0.08)' },
  ];
  return palette[Math.abs(hash) % palette.length];
}

// ── Panel event binding ─────────────────────────────────────────────────────

function bindPanelEvents() {
  // Collapse toggles
  document.querySelectorAll('.panel-collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.panel;
      collapsedPanels[pid] = !collapsedPanels[pid];
      saveCollapsed();
      const body = document.getElementById('pbody-' + pid);
      body.classList.toggle('collapsed', !!collapsedPanels[pid]);
      btn.textContent = collapsedPanels[pid] ? '▼' : '▲';
    });
  });

  // Bind interactive content for each panel
  ['properties','stats','links','tags','overview','intel','reviews','leadership','contacts','opportunity','chat'].forEach(pid => {
    bindPanelBodyEvents(pid);
  });
}

function loadPhotosForPanel(pid) {
  if (pid === 'leadership') {
    const leaders = (entry.leaders || []).filter(l => l.name);
    if (!leaders.length) return;
    chrome.runtime.sendMessage({ type: 'GET_LEADER_PHOTOS', leaders, company: entry.company || '' }, photos => {
      void chrome.runtime.lastError;
      if (!photos) return;
      leaders.forEach((l, i) => {
        const photoUrl = photos[i];
        if (!photoUrl) return;
        const el = document.getElementById(`lavatar-${entry.id}-${encodeURIComponent(l.name||'')}`);
        if (!el) return;
        const initials = (l.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        el.innerHTML = `<img src="${photoUrl}" alt="${initials}" onerror="this.parentElement.textContent='${initials}'">`;
      });
    });
  }

  if (pid === 'contacts') {
    const contacts = (entry.knownContacts || []).filter(c => c.name);
    if (!contacts.length) return;
    chrome.runtime.sendMessage(
      { type: 'GET_LEADER_PHOTOS', leaders: contacts.map(c => ({ name: c.name })), company: entry.company || '' },
      photos => {
        void chrome.runtime.lastError;
        if (!photos) return;
        contacts.forEach((c, i) => {
          const photoUrl = photos[i];
          if (!photoUrl) return;
          const el = document.getElementById(`cavatar-${encodeURIComponent(c.email)}`);
          if (!el) return;
          const initials = c.name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
          el.innerHTML = `<img src="${photoUrl}" alt="${initials}" onerror="this.parentElement.textContent='${initials}'">`;
        });
      }
    );
  }
}

function bindPanelBodyEvents(pid) {
  if (pid === 'contacts') {
    const body = document.getElementById('pbody-contacts');
    if (!body) return;

    // Remove contact
    body.querySelectorAll('.contact-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.dataset.email;
        const contact = (entry.knownContacts || []).find(c => c.email === email);
        const allEmails = contact ? [contact.email, ...(contact.aliases || [])] : [email];
        const blocked = [...new Set([...(entry.removedContacts || []), ...allEmails])];
        saveEntry({
          knownContacts: (entry.knownContacts || []).filter(c => c.email !== email),
          removedContacts: blocked
        });
        renderPanel('contacts'); bindPanelBodyEvents('contacts');
      });
    });

    // Copy email
    body.querySelectorAll('.contact-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.email).catch(() => {});
        const orig = btn.textContent; btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });

    // Edit button → expand inline edit form
    body.querySelectorAll('.contact-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.dataset.email;
        const contact = (entry.knownContacts || []).find(c => c.email === email);
        if (!contact) return;
        const card = btn.closest('.contact-card');
        if (!card) return;
        const initials = contact.name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
        const allEmails = [contact.email, ...(contact.aliases || [])];

        const emailRowsHtml = allEmails.map((em, i) => `
          <div class="contact-edit-email-row">
            <input class="contact-edit-input email-val" value="${em.replace(/"/g,'&quot;')}" placeholder="Email">
            ${allEmails.length > 1 ? `<button class="contact-email-del-btn" data-idx="${i}" title="Remove this email">×</button>` : ''}
          </div>`).join('');

        card.innerHTML = `
          <div class="contact-avatar">${initials}</div>
          <div class="contact-edit-form">
            <input class="contact-edit-input" id="ced-name" value="${contact.name.replace(/"/g,'&quot;')}" placeholder="Name">
            <div class="contact-edit-emails">${emailRowsHtml}</div>
            <button class="contact-add-email-btn">+ Add email</button>
            <div class="contact-add-actions" style="margin-top:6px">
              <button class="contact-confirm-btn contact-save-edit">Save</button>
              <button class="contact-cancel-btn contact-cancel-edit">Cancel</button>
            </div>
          </div>`;

        card.querySelector('#ced-name').focus();

        // Remove individual email row
        card.querySelectorAll('.contact-email-del-btn').forEach(d => {
          d.addEventListener('click', () => d.closest('.contact-edit-email-row').remove());
        });

        // Add new email row
        card.querySelector('.contact-add-email-btn').addEventListener('click', () => {
          const row = document.createElement('div');
          row.className = 'contact-edit-email-row';
          row.innerHTML = `<input class="contact-edit-input email-val" placeholder="Email">
            <button class="contact-email-del-btn" title="Remove">×</button>`;
          row.querySelector('.contact-email-del-btn').addEventListener('click', () => row.remove());
          card.querySelector('.contact-edit-emails').appendChild(row);
          row.querySelector('input').focus();
        });

        const save = () => {
          const newName = card.querySelector('#ced-name').value.trim();
          const emails = [...card.querySelectorAll('.email-val')]
            .map(i => i.value.trim().toLowerCase()).filter(e => e.includes('@'));
          if (!emails.length) return;
          saveEntry({ knownContacts: (entry.knownContacts || []).map(c =>
            c.email === email ? { ...c, name: newName || c.name, email: emails[0], aliases: emails.slice(1) } : c
          )});
          renderPanel('contacts'); bindPanelBodyEvents('contacts');
        };
        card.querySelector('.contact-save-edit').addEventListener('click', save);
        card.querySelector('.contact-cancel-edit').addEventListener('click', () => {
          renderPanel('contacts'); bindPanelBodyEvents('contacts');
        });
      });
    });

    // Add contact form
    const addBtn = document.getElementById('contact-add-btn');
    const addForm = document.getElementById('contact-add-form');
    if (addBtn) addBtn.addEventListener('click', () => {
      addBtn.style.display = 'none';
      addForm.style.display = '';
      document.getElementById('contact-add-name').focus();
    });
    const doAdd = () => {
      const name = document.getElementById('contact-add-name')?.value.trim();
      const email = document.getElementById('contact-add-email')?.value.trim().toLowerCase();
      if (!email || !email.includes('@')) return;
      const existing = entry.knownContacts || [];
      if (existing.some(c => c.email === email)) return;
      saveEntry({ knownContacts: [...existing, { name: name || email.split('@')[0], email, source: 'manual', detectedAt: Date.now() }] });
      renderPanel('contacts'); bindPanelBodyEvents('contacts');
    };
    document.getElementById('contact-add-save')?.addEventListener('click', doAdd);
    document.getElementById('contact-add-cancel')?.addEventListener('click', () => {
      renderPanel('contacts'); bindPanelBodyEvents('contacts');
    });
    document.getElementById('contact-add-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    loadPhotosForPanel('contacts');
  }

  if (pid === 'leadership') {
    const body = document.getElementById('pbody-leadership');
    if (!body) return;

    body.querySelectorAll('.leader-add-contact-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.leader-card');
        btn.style.display = 'none';
        const form = card.querySelector('.leader-email-form');
        form.style.display = '';
        form.querySelector('.leader-email-input').focus();
      });
    });

    body.querySelectorAll('.leader-email-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.leader-card');
        card.querySelector('.leader-email-form').style.display = 'none';
        card.querySelector('.leader-add-contact-btn').style.display = '';
      });
    });

    body.querySelectorAll('.leader-email-save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.leader-card');
        const name = card.querySelector('.leader-name')?.textContent?.trim() || '';
        const email = card.querySelector('.leader-email-input')?.value?.trim().toLowerCase() || '';
        if (!email || !email.includes('@')) {
          card.querySelector('.leader-email-input')?.focus();
          return;
        }
        const existing = entry.knownContacts || [];
        if (!existing.some(c => c.email === email)) {
          saveEntry({ knownContacts: [...existing, { name, email, source: 'manual', detectedAt: Date.now() }] });
        }
        renderPanel('leadership'); bindPanelBodyEvents('leadership');
        renderPanel('contacts'); bindPanelBodyEvents('contacts');
      });
    });

    // Allow Enter key in email input to save
    body.querySelectorAll('.leader-email-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.closest('.leader-card').querySelector('.leader-email-save-btn').click();
        if (e.key === 'Escape') input.closest('.leader-card').querySelector('.leader-email-cancel-btn').click();
      });
    });

    loadPhotosForPanel('leadership');
  }

  if (pid === 'notes') {
    const ta = document.getElementById('co-notes');
    if (ta) ta.addEventListener('blur', () => saveEntry({ notes: ta.value }));
  }

  if (pid === 'properties') {
    // Edit button for website/linkedin link rows
    document.querySelectorAll('.prop-link-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        const row = btn.closest('.prop-link-row');
        const currentVal = entry[field] || '';
        row.innerHTML = `<span class="prop-link-icon">${field === 'companyWebsite' ? '🌐' : '🔗'}</span>
          <input class="prop-input prop-link-input" data-field="${field}" value="${currentVal}" type="url" style="flex:1">`;
        const input = row.querySelector('input');
        input.focus();
        const commit = () => { saveEntry({ [field]: input.value.trim() }); renderPanel('properties'); bindPanelBodyEvents('properties'); };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { renderPanel('properties'); bindPanelBodyEvents('properties'); } });
      });
    });

    document.querySelectorAll('.prop-input').forEach(input => {
      input.addEventListener('blur', () => {
        const field = input.dataset.field;
        const val = input.value.trim();
        const isDefault = !!DEFAULT_FIELD_DEFS.find(d => d.id === field);
        if (isDefault) {
          saveEntry({ [field]: val });
          if (field === 'companyWebsite' || field === 'companyLinkedin') renderPanel('properties');
        } else {
          saveEntry({ customFields: { ...(entry.customFields||{}), [field]: val } });
        }
        const row = input.closest('.prop-row');
        const openLink = row?.querySelector('.prop-open-link');
        if (openLink) { openLink.href = val; openLink.style.display = val ? '' : 'none'; }
        input.classList.toggle('prop-empty', !val);
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    document.querySelectorAll('.prop-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        customFieldDefs = customFieldDefs.filter(f => f.id !== field);
        chrome.storage.local.set({ companyFieldDefs: customFieldDefs }, () => {
          renderPanel('properties');
          bindPanelBodyEvents('properties');
        });
      });
    });

    const addBtn = document.getElementById('prop-add-btn');
    if (addBtn) addBtn.addEventListener('click', openAddFieldForm);
  }

  if (pid === 'tags') {
    document.querySelectorAll('.tag-rm').forEach(el => {
      el.addEventListener('click', () => {
        saveEntry({ tags: (entry.tags||[]).filter(t => t !== el.dataset.tag) });
        renderPanel('tags');
        bindPanelBodyEvents('tags');
      });
    });
    const addBtn = document.getElementById('tag-add-btn');
    if (addBtn) addBtn.addEventListener('click', openTagInput);
  }

  if (pid === 'opportunity' || pid === 'opportunities') {
    const addBtn = document.getElementById('add-opp-btn');
    if (addBtn) addBtn.addEventListener('click', addToOpportunityPipeline);

    const stageSelect = document.getElementById('opp-stage-select');
    if (stageSelect) stageSelect.addEventListener('change', () => {
      const c = stageColor(stageSelect.value, customOpportunityStages);
      saveEntry({ jobStage: stageSelect.value });
      renderHeader();
    });

    const titleInput = document.getElementById('opp-title-input');
    if (titleInput) {
      titleInput.addEventListener('blur', () => saveEntry({ jobTitle: titleInput.value.trim() || null }));
      titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); });
    }
    // Edit button for linked role title — swaps link for input
    const titleEditBtn = document.getElementById('opp-title-edit-btn');
    if (titleEditBtn) {
      titleEditBtn.addEventListener('click', () => {
        const wrap = titleEditBtn.parentElement;
        const val = entry.jobTitle || '';
        wrap.innerHTML = `<input class="prop-input" id="opp-title-input" value="${val.replace(/"/g, '&quot;')}">`;
        const inp = document.getElementById('opp-title-input');
        inp.focus();
        inp.addEventListener('blur', () => { saveEntry({ jobTitle: inp.value.trim() || null }); renderPanel('opportunity'); bindPanelBodyEvents('opportunity'); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      });
    }

    // Comp field bindings
    const baseSalaryInput = document.getElementById('opp-base-salary');
    if (baseSalaryInput) {
      baseSalaryInput.addEventListener('blur', () => saveEntry({ baseSalaryRange: baseSalaryInput.value.trim() || null, compSource: 'Manual', compAutoExtracted: false }));
      baseSalaryInput.addEventListener('keydown', e => { if (e.key === 'Enter') baseSalaryInput.blur(); });
    }
    const oteInput = document.getElementById('opp-ote');
    if (oteInput) {
      oteInput.addEventListener('blur', () => saveEntry({ oteTotalComp: oteInput.value.trim() || null, compSource: 'Manual', compAutoExtracted: false }));
      oteInput.addEventListener('keydown', e => { if (e.key === 'Enter') oteInput.blur(); });
    }
    const equityInput = document.getElementById('opp-equity');
    if (equityInput) {
      equityInput.addEventListener('blur', () => saveEntry({ equity: equityInput.value.trim() || null }));
      equityInput.addEventListener('keydown', e => { if (e.key === 'Enter') equityInput.blur(); });
    }

    const actionSelect = document.getElementById('opp-action-status');
    if (actionSelect) {
      actionSelect.addEventListener('change', () => saveEntry({ actionStatus: actionSelect.value }));
    }

    const nextStepInput = document.getElementById('opp-next-step-input');
    if (nextStepInput) {
      nextStepInput.addEventListener('blur', () => saveEntry({ nextStep: nextStepInput.value.trim() || null }));
      nextStepInput.addEventListener('keydown', e => { if (e.key === 'Enter') nextStepInput.blur(); });
    }

    const nextStepDate = document.getElementById('opp-next-step-date');
    if (nextStepDate) {
      nextStepDate.addEventListener('change', () => {
        nextStepDate.classList.toggle('has-value', !!nextStepDate.value);
        saveEntry({ nextStepDate: nextStepDate.value || null });
      });
    }

  }

  if (pid === 'chat') {
    const body = document.getElementById('pbody-chat');
    body?.querySelector('[data-action="open-float-chat"]')?.addEventListener('click', () => {
      document.getElementById('fch-trigger')?.click();
    });
  }

}

function openAddFieldForm() {
  const area = document.getElementById('prop-add-area');
  area.innerHTML = `
    <div class="prop-add-form">
      <input class="prop-add-input" id="prop-new-label" placeholder="Field name (e.g. HQ City)" autocomplete="off">
      <select class="prop-add-type" id="prop-new-type">
        <option value="text">Text</option>
        <option value="url">URL</option>
        <option value="number">Number</option>
      </select>
      <button class="prop-add-confirm" id="prop-add-confirm">Add</button>
      <button class="prop-add-cancel" id="prop-add-cancel">✕</button>
    </div>`;
  document.getElementById('prop-new-label').focus();
  document.getElementById('prop-add-confirm').addEventListener('click', confirmAddField);
  document.getElementById('prop-add-cancel').addEventListener('click', () => {
    renderPanel('properties'); bindPanelBodyEvents('properties');
  });
  document.getElementById('prop-new-label').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAddField();
    if (e.key === 'Escape') { renderPanel('properties'); bindPanelBodyEvents('properties'); }
  });
}

function confirmAddField() {
  const label = document.getElementById('prop-new-label')?.value.trim();
  const type  = document.getElementById('prop-new-type')?.value || 'text';
  if (!label) return;
  const id = 'cf_' + label.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') + '_' + Date.now();
  customFieldDefs = [...customFieldDefs, { id, label, type }];
  chrome.storage.local.set({ companyFieldDefs: customFieldDefs }, () => {
    renderPanel('properties');
    bindPanelBodyEvents('properties');
  });
}

function openTagInput() {
  const wrap = document.getElementById('tag-add-wrap');
  wrap.innerHTML = `<input class="tag-input" id="tag-input" placeholder="tag name" autocomplete="off">
    <div class="tag-sugg" id="tag-sugg" style="display:none"></div>`;
  const input = document.getElementById('tag-input');
  const sugg  = document.getElementById('tag-sugg');
  input.focus();

  function updateSugg() {
    const val = input.value.trim().toLowerCase();
    const existing = entry.tags || [];
    const matches = allKnownTags.filter(t => !existing.includes(t) && (!val || t.toLowerCase().includes(val)));
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.innerHTML = matches.slice(0, 8).map(t => `<div class="tag-sugg-item" data-tag="${t}">${t}</div>`).join('');
    sugg.style.display = 'block';
    sugg.querySelectorAll('.tag-sugg-item').forEach(s => {
      s.addEventListener('mousedown', e => { e.preventDefault(); commitTag(s.dataset.tag); });
    });
  }

  updateSugg();
  input.addEventListener('focus', updateSugg);
  input.addEventListener('input', updateSugg);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTag(input.value.trim()); }
    if (e.key === 'Escape') { renderPanel('tags'); bindPanelBodyEvents('tags'); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.getElementById('tag-input')) { renderPanel('tags'); bindPanelBodyEvents('tags'); }
    }, 200);
  });
}

function commitTag(tag) {
  const clean = tag.trim();
  if (!clean) return;
  const existing = entry.tags || [];
  if (existing.includes(clean)) { renderPanel('tags'); bindPanelBodyEvents('tags'); return; }
  if (!allKnownTags.includes(clean)) {
    allKnownTags = [...allKnownTags, clean];
    chrome.storage.local.set({ allTags: allKnownTags });
  }
  saveEntry({ tags: [...existing, clean] });
  renderPanel('tags');
  bindPanelBodyEvents('tags');
}

// ── Drag & Drop between columns ────────────────────────────────────────────

function bindDragDrop() {
  let draggingPanel = null;
  let draggingCol   = null;
  let dragAllowed   = false;

  const INTERACTIVE = 'textarea, input, select, a, button, details, summary, .tag-rm, .tag-add-btn, .panel-collapse-btn';

  document.querySelectorAll('.panel').forEach(panelEl => {
    panelEl.addEventListener('mousedown', e => {
      // Allow drag unless mousedown was on an interactive element
      dragAllowed = !e.target.closest(INTERACTIVE);
    });

    panelEl.addEventListener('dragstart', e => {
      if (!dragAllowed) { e.preventDefault(); return; }
      draggingPanel = panelEl.dataset.panel;
      draggingCol   = panelEl.closest('.co-col').dataset.col;
      panelEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingPanel);
      dragAllowed = false;
    });

    panelEl.addEventListener('dragend', () => {
      document.querySelectorAll('.panel.dragging').forEach(p => p.classList.remove('dragging'));
      document.querySelectorAll('.drop-line').forEach(l => l.remove());
      document.querySelectorAll('.co-col').forEach(c => c.classList.remove('drag-over'));
      draggingPanel = null;
      draggingCol   = null;
    });
  });

  document.querySelectorAll('.co-col').forEach(colEl => {
    colEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggingPanel) return;
      colEl.classList.add('drag-over');

      // Move drop-line to show insertion point
      document.querySelectorAll('.drop-line').forEach(l => l.remove());
      const panels = [...colEl.querySelectorAll('.panel:not(.dragging)')];
      const line = document.createElement('div');
      line.className = 'drop-line';
      let insertBefore = null;
      for (const p of panels) {
        const rect = p.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { insertBefore = p; break; }
      }
      if (insertBefore) colEl.insertBefore(line, insertBefore);
      else colEl.appendChild(line);
    });

    colEl.addEventListener('dragleave', e => {
      if (!colEl.contains(e.relatedTarget)) {
        colEl.classList.remove('drag-over');
        document.querySelectorAll('.drop-line').forEach(l => l.remove());
      }
    });

    colEl.addEventListener('drop', e => {
      e.preventDefault();
      if (!draggingPanel) return;
      const targetCol = colEl.dataset.col;

      document.querySelectorAll('.drop-line').forEach(l => l.remove());
      colEl.classList.remove('drag-over');

      // Determine insertion point from mouse Y vs panel midpoints
      const panels = [...colEl.querySelectorAll('.panel:not(.dragging)')];
      let insertBeforePanelId = null;
      for (const p of panels) {
        const rect = p.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { insertBeforePanelId = p.dataset.panel; break; }
      }

      // Update layout arrays
      panelLayout[draggingCol] = panelLayout[draggingCol].filter(p => p !== draggingPanel);
      const newCol = panelLayout[targetCol].filter(p => p !== draggingPanel);
      if (insertBeforePanelId) {
        const idx = newCol.indexOf(insertBeforePanelId);
        newCol.splice(idx === -1 ? newCol.length : idx, 0, draggingPanel);
      } else {
        newCol.push(draggingPanel);
      }
      panelLayout[targetCol] = newCol;

      saveLayout();
      renderColumns();
    });
  });
}

function initFloatingChat() {
  const floatEl   = document.getElementById('ci-float-chat');
  const trigger   = document.getElementById('fch-trigger');
  const header    = document.getElementById('fch-header');
  const body      = document.getElementById('fch-body');
  const closeBtn  = document.getElementById('fch-close');
  const minBtn    = document.getElementById('fch-minimize');
  const sizeBtn   = document.getElementById('fch-size-toggle');
  const nameEl    = document.getElementById('fch-company-name');
  if (!floatEl || !trigger) return;

  if (nameEl && entry.company) nameEl.textContent = `— ${entry.company}`;

  // Build the chat panel once
  const chatContainer = document.createElement('div');
  chatContainer.setAttribute('data-chat-panel', entry.id);
  body.appendChild(chatContainer);
  buildChatPanel(chatContainer, entry);

  let isMinimized = false;
  // sizeState: 0=normal, 1=large, 2=fullscreen
  let sizeState = 0;
  const SIZE_ICONS = ['⤢', '⤡', '⊡'];
  const SIZE_CLASSES = ['', 'fch-maximized', 'fch-fullscreen'];

  function open() {
    floatEl.classList.remove('fch-hidden', 'fch-minimized');
    trigger.style.display = 'none';
    isMinimized = false;
    setTimeout(() => chatContainer.querySelector('.chat-input')?.focus(), 150);
  }

  function close() {
    floatEl.classList.add('fch-hidden');
    floatEl.classList.remove('fch-minimized', 'fch-maximized', 'fch-fullscreen');
    trigger.style.display = '';
    isMinimized = false; sizeState = 0;
    sizeBtn.textContent = SIZE_ICONS[0];
  }

  function minimize() {
    isMinimized = !isMinimized;
    floatEl.classList.toggle('fch-minimized', isMinimized);
    minBtn.textContent = isMinimized ? '+' : '−';
    if (isMinimized) {
      floatEl.classList.remove('fch-maximized', 'fch-fullscreen');
      sizeState = 0; sizeBtn.textContent = SIZE_ICONS[0];
    }
  }

  function cycleSize() {
    floatEl.classList.remove(...SIZE_CLASSES.filter(Boolean));
    sizeState = (sizeState + 1) % SIZE_CLASSES.length;
    if (SIZE_CLASSES[sizeState]) floatEl.classList.add(SIZE_CLASSES[sizeState]);
    sizeBtn.textContent = SIZE_ICONS[sizeState];
    if (isMinimized) { isMinimized = false; floatEl.classList.remove('fch-minimized'); minBtn.textContent = '−'; }
  }

  trigger.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  minBtn.addEventListener('click', minimize);
  sizeBtn.addEventListener('click', cycleSize);

  // Drag to reposition
  let dragging = false, startX, startY, startRight, startBottom;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('.fch-btn')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = floatEl.getBoundingClientRect();
    startRight  = window.innerWidth  - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newRight  = Math.max(0, Math.min(window.innerWidth  - 60, startRight  - dx));
    const newBottom = Math.max(0, Math.min(window.innerHeight - 52, startBottom - dy));
    floatEl.style.right  = newRight  + 'px';
    floatEl.style.bottom = newBottom + 'px';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });

  // Open automatically if URL has ?chat=1
  if (new URLSearchParams(location.search).get('chat') === '1') open();
}

function openChatPanel() {
  const panel = document.getElementById('panel-chat');
  if (!panel) return;
  // Expand if collapsed
  const body = document.getElementById('pbody-chat');
  if (body && body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    const btn = panel.querySelector('.panel-collapse-btn');
    if (btn) btn.textContent = '▲';
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => {
    const input = panel.querySelector('.chat-input');
    if (input) input.focus();
  }, 300);
}

function sanitizeNotesHtml(html) {
  const allowed = ['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'del', 'div', 'span'];
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  div.querySelectorAll('*').forEach(el => {
    if (!allowed.includes(el.tagName.toLowerCase())) {
      el.replaceWith(...el.childNodes);
    }
    // Strip style/class attributes except on allowed elements
    el.removeAttribute('class');
    el.removeAttribute('style');
  });
  return div.innerHTML;
}

// Convert old plain text / markdown notes to simple HTML for the WYSIWYG editor
function notesToHtml(raw) {
  if (!raw) return '';
  // If it already looks like HTML, return sanitized
  if (/<[a-z][\s>]/i.test(raw)) return sanitizeNotesHtml(raw);
  // Convert markdown-ish patterns to HTML
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    return sanitizeNotesHtml(marked.parse(raw));
  }
  // Plain text fallback
  return raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function migrateNotesFeed() {
  // Migrate old single entry.notes string to notesFeed[] array
  if (!entry.notesFeed && entry.notes) {
    entry.notesFeed = [{
      id: 'note_migrated',
      content: notesToHtml(entry.notes),
      createdAt: entry.savedAt || Date.now(),
      updatedAt: entry.savedAt || Date.now(),
    }];
    saveEntry({ notesFeed: entry.notesFeed });
  }
  if (!entry.notesFeed) entry.notesFeed = [];
}

function renderNotesEditor() {
  const container = document.getElementById('hub-notes-container');
  if (!container) return;
  migrateNotesFeed();

  const feed = entry.notesFeed || [];

  // Compose area at top + feed below
  container.innerHTML = `
    <div class="notes-compose">
      <div class="notes-toolbar">
        <button class="notes-tb-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="notes-tb-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="notes-tb-btn" data-cmd="formatBlock:H2" title="Heading">H</button>
        <span class="notes-tb-sep"></span>
        <button class="notes-tb-btn" data-cmd="insertUnorderedList" title="Bullet list">•</button>
        <button class="notes-tb-btn" data-cmd="insertOrderedList" title="Numbered list">1.</button>
        <button class="notes-tb-btn" data-cmd="createLink" title="Link">🔗</button>
        <div style="margin-left:auto">
          <button class="notes-save-btn" id="notes-save-btn">+ Add note</button>
        </div>
      </div>
      <div class="notes-editable notes-compose-area" id="hub-notes-editable" contenteditable="true"><p><br></p></div>
    </div>
    <div class="notes-feed" id="notes-feed">
      ${feed.length ? feed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => renderNoteCard(n)).join('') : '<div class="notes-feed-empty">No notes yet — add one above</div>'}
    </div>`;

  const editable = container.querySelector('#hub-notes-editable');
  const saveBtn = container.querySelector('#notes-save-btn');

  // Placeholder
  function updatePlaceholder() {
    editable.classList.toggle('notes-empty-edit', !editable.textContent.trim());
  }
  updatePlaceholder();
  editable.addEventListener('input', updatePlaceholder);

  // Toolbar
  container.querySelectorAll('.notes-tb-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd.startsWith('formatBlock:')) {
        const tag = cmd.split(':')[1];
        const current = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, current.toLowerCase() === tag.toLowerCase() ? 'P' : tag);
      } else if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      editable.focus();
    });
  });

  // Save button — add new note
  saveBtn.addEventListener('mousedown', e => e.preventDefault());
  saveBtn.addEventListener('click', () => {
    const html = sanitizeNotesHtml(editable.innerHTML);
    if (!editable.textContent.trim()) return;
    const note = {
      id: 'note_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
      content: html,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!entry.notesFeed) entry.notesFeed = [];
    entry.notesFeed.push(note);
    // Also update legacy notes field with latest for backward compat (chat context, etc.)
    saveEntry({ notesFeed: entry.notesFeed, notes: html });
    editable.innerHTML = '<p><br></p>';
    updatePlaceholder();
    renderNotesFeed();
  });

  // Keyboard shortcuts
  editable.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); }
    // Ctrl+Enter to save
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  // Paste handler
  editable.addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) {
      document.execCommand('insertHTML', false, sanitizeNotesHtml(html));
    } else {
      document.execCommand('insertText', false, text);
    }
  });

  // Bind edit/delete on existing note cards
  bindNoteCardEvents();
}

function renderNoteCard(n) {
  const d = new Date(n.createdAt);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="note-card" data-note-id="${n.id}">
      <div class="note-card-header">
        <span class="note-card-date">${dateStr} · ${timeStr}</span>
        <span class="note-card-actions">
          <button class="note-edit-btn" data-note-id="${n.id}" title="Edit">✏️</button>
          <button class="note-del-btn" data-note-id="${n.id}" title="Delete">✕</button>
        </span>
      </div>
      <div class="note-card-body" data-note-id="${n.id}">${n.content}</div>
    </div>`;
}

function renderNotesFeed() {
  const feedEl = document.getElementById('notes-feed');
  if (!feedEl) return;
  const feed = (entry.notesFeed || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  feedEl.innerHTML = feed.length
    ? feed.map(n => renderNoteCard(n)).join('')
    : '<div class="notes-feed-empty">No notes yet — add one above</div>';
  bindNoteCardEvents();
}

function bindNoteCardEvents() {
  const container = document.getElementById('hub-notes-container');
  if (!container) return;

  // Delete
  container.querySelectorAll('.note-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.noteId;
      entry.notesFeed = (entry.notesFeed || []).filter(n => n.id !== id);
      // Update legacy notes to most recent
      const latest = entry.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      saveEntry({ notesFeed: entry.notesFeed, notes: latest?.content || '' });
      renderNotesFeed();
    });
  });

  // Edit — make card body contenteditable inline
  container.querySelectorAll('.note-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.noteId;
      const bodyEl = container.querySelector(`.note-card-body[data-note-id="${id}"]`);
      if (!bodyEl || bodyEl.contentEditable === 'true') return;
      bodyEl.contentEditable = 'true';
      bodyEl.classList.add('note-card-editing');
      bodyEl.focus();
      btn.textContent = '✓';
      btn.title = 'Save';

      const finishEdit = () => {
        bodyEl.contentEditable = 'false';
        bodyEl.classList.remove('note-card-editing');
        btn.textContent = '✏️';
        btn.title = 'Edit';
        const note = (entry.notesFeed || []).find(n => n.id === id);
        if (note) {
          note.content = sanitizeNotesHtml(bodyEl.innerHTML);
          note.updatedAt = Date.now();
          saveEntry({ notesFeed: entry.notesFeed, notes: note.content });
        }
      };

      bodyEl.addEventListener('blur', (e) => {
        if (e.relatedTarget === btn) return;
        finishEdit();
      }, { once: true });

      // Click the same button again to save
      btn.addEventListener('click', finishEdit, { once: true });
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(text) {
  // Escape HTML first, then apply markdown patterns
  let s = escapeHtml(text);
  // Headers: ## Heading
  s = s.replace(/^### (.+)$/gm, '<strong style="font-size:12px;color:#7c98b6;text-transform:uppercase;letter-spacing:.04em">$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:14px;color:#2d3e50;margin:10px 0 4px">$1</div>');
  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Citation links: [[N]](url) — render as clickable superscript
  s = s.replace(/\[\[(\d+)\]\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" style="font-size:10px;color:#0077b5;vertical-align:super;text-decoration:none">[$1]</a>');
  // Plain markdown links: [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" style="color:#0077b5">$1</a>');
  // Bullet lines: "- item"
  s = s.replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>');
  // Line breaks
  s = s.replace(/\n/g, '<br>');
  return s;
}

function initColumnResize() {
  const colLeft  = document.getElementById('col-left');
  const colRight = document.getElementById('col-right');

  const savedLeft  = localStorage.getItem('ci_col_left_w');
  const savedRight = localStorage.getItem('ci_col_right_w');
  if (savedLeft)  colLeft.style.width  = savedLeft;
  if (savedRight) colRight.style.width = savedRight;

  function bindHandle(handleId, col, storageKey, direction) {
    const handle = document.getElementById(handleId);
    if (!handle) return;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('resizing');
      const startX = e.clientX;
      const startW = col.getBoundingClientRect().width;
      const onMove = e => {
        const delta = direction === 'right' ? e.clientX - startX : startX - e.clientX;
        col.style.width = Math.max(200, Math.min(560, startW + delta)) + 'px';
      };
      const onUp = () => {
        handle.classList.remove('resizing');
        localStorage.setItem(storageKey, col.style.width);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  bindHandle('resize-left',  colLeft,  'ci_col_left_w',  'right');
  bindHandle('resize-right', colRight, 'ci_col_right_w', 'left');
}

// ── Celebrations (mirrors saved.js logic) ──────────────────────────────────

function _getDefaultCelebration(key) {
  if (/applied/i.test(key)) return { type: 'thumbsup', sound: 'pop', count: 15 };
  if (/conversations?|mutual/i.test(key)) return { type: 'confetti', sound: 'pop', count: 30 };
  if (/offer|accepted|referral/i.test(key)) return { type: 'money', sound: 'chaching', count: 40 };
  if (/stalled/i.test(key)) return { type: 'stopsign', sound: 'none', count: 20 };
  if (/rejected|closed|dq/i.test(key)) return { type: 'peace', sound: 'farewell', count: 25 };
  return null;
}

function _getCelebrationConfig(newStatus) {
  const cfg = _stageCelebrations[newStatus] || _getDefaultCelebration(newStatus);
  if (!cfg || cfg.type === 'none') return null;
  return cfg;
}

function _fireCelebration(config) {
  const { type, sound, count } = config;
  if (sound === 'chaching') _playChaChingSound();
  else if (sound === 'pop') _playConfettiPop();
  else if (sound === 'farewell') _playFarewellVoice();

  const colors = ['#ff4444', '#ffbb00', '#00cc88', '#4488ff', '#cc44ff', '#ff8844', '#00ccff', '#ffcc00'];
  const isEmoji = type === 'thumbsup' || type === 'money' || type === 'stopsign' || type === 'peace';
  const baseEmoji = type === 'thumbsup' ? '👍' : type === 'stopsign' ? '🛑' : type === 'peace' ? '✌️' : '🤑';
  const n = count || 30;
  const particles = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font-size:' + (isEmoji ? '22px' : '10px') + ';';
    if (isEmoji) { el.textContent = type === 'money' && Math.random() > 0.5 ? '💵' : baseEmoji; }
    else { el.style.width = '8px'; el.style.height = '8px'; el.style.borderRadius = '2px'; el.style.background = colors[i % colors.length]; }
    document.body.appendChild(el);
    particles.push({ el, x: window.innerWidth / 2 + (Math.random() - 0.5) * 200, y: window.innerHeight, vx: (Math.random() - 0.5) * 12, vy: -(Math.random() * 14 + 8), life: 1 });
  }
  function animate() {
    let alive = 0;
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= 0.008;
      p.el.style.left = p.x + 'px'; p.el.style.top = p.y + 'px'; p.el.style.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.el.remove(); else alive++;
    }
    if (alive > 0) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function _playConfettiPop() {
  try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.setValueAtTime(600, c.currentTime); o.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.1); g.gain.setValueAtTime(0.3, c.currentTime); g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.15); o.start(); o.stop(c.currentTime + 0.15); } catch(e) {}
}

function _playChaChingSound() {
  try { const c = new AudioContext(); const t = c.currentTime; [800, 1200, 1600].forEach((f, i) => { const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = f; g.gain.setValueAtTime(0.2, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.01, t + i * 0.12 + 0.2); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.2); }); } catch(e) {}
}

function _playFarewellVoice() {
  try { const u = new SpeechSynthesisUtterance(['peace', 'adios', 'see ya', 'bye'][Math.floor(Math.random() * 4)]); u.rate = 1.1; u.pitch = 1.0; u.volume = 0.6; speechSynthesis.speak(u); } catch(e) {}
}

// ── Boot ───────────────────────────────────────────────────────────────────
init();
initColumnResize();
