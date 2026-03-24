// company.js — full-screen company detail view with drag-between-columns panels

let entry = null;
let allCompanies = [];
let allKnownTags = [];
let customCompanyStages = [];
let customOpportunityStages = [];
let customFieldDefs = []; // user-created fields

const DEFAULT_FIELD_DEFS = [
  { id: 'companyWebsite',  label: 'Website',   type: 'url'  },
  { id: 'companyLinkedin', label: 'LinkedIn',  type: 'url'  },
  { id: 'employees',       label: 'Employees', type: 'text' },
  { id: 'funding',         label: 'Funding',   type: 'text' },
  { id: 'founded',         label: 'Founded',   type: 'text' },
  { id: 'industry',        label: 'Industry',  type: 'text' },
];

const DEFAULT_LAYOUT = {
  left:  ['properties', 'tags'],
  main:  [], // replaced by hardcoded hub tabs
  right: ['contacts', 'leadership', 'opportunity', 'hiring'],
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
  contacts:      'Known Contacts',
  opportunity:   'Opportunity',
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
  { key: 'needs_review',    label: 'Needs Review',              color: '#64748b' },
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

  chrome.storage.local.get(['savedCompanies', 'allTags', 'companyStages', 'opportunityStages', 'customStages', 'companyFieldDefs', 'researchCache'], data => {
    allCompanies = data.savedCompanies || [];
    allKnownTags = data.allTags || [];
    customCompanyStages     = data.companyStages     || DEFAULT_COMPANY_STAGES;
    customOpportunityStages = data.opportunityStages || data.customStages || DEFAULT_OPP_STAGES;
    customFieldDefs = data.companyFieldDefs || [];

    entry = allCompanies.find(c => c.id === id);
    if (!entry) { showError('Company not found.'); return; }

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

    // Ensure all default panels are present
    const placed = new Set([...panelLayout.left, ...panelLayout.main, ...panelLayout.right]);
    const allDefaults = [...DEFAULT_LAYOUT.left, ...DEFAULT_LAYOUT.main, ...DEFAULT_LAYOUT.right];
    allDefaults.forEach(p => { if (!placed.has(p)) panelLayout.right.push(p); });

    // Load collapsed state
    try { collapsedPanels = JSON.parse(localStorage.getItem('ci_co_collapsed_' + id) || '{}'); } catch(e) {}

    document.title = `${entry.company} — CompanyIntel`;
    renderHeader();
    renderColumns();
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
  const oppStageLabel = entry.isOpportunity
    ? (customOpportunityStages.find(s => s.key === entry.jobStage)?.label || entry.jobStage || 'In Pipeline')
    : null;

  const hdr = document.getElementById('co-header');
  hdr.innerHTML = `
    <button class="hdr-back" id="hdr-back">← Back</button>
    <div class="hdr-divider"></div>
    ${favicon}
    <input class="hdr-name-input" id="hdr-name" value="${nameVal}" placeholder="Company name">
    <div class="hdr-divider"></div>
    <div class="hdr-spacer"></div>
    <select class="hdr-status" id="hdr-status" style="border-color:${statusColor};color:${statusColor}">
      ${statusOptions}
    </select>
    <div class="hdr-stars" id="hdr-stars">${stars}</div>
    ${entry.isOpportunity
      ? `<button class="hdr-opp-btn has-opp" id="hdr-view-pipeline">${oppStageLabel} →</button>`
      : `<button class="hdr-opp-btn" id="hdr-add-opp">+ Add to Pipeline</button>`}
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('preferences.html')}" target="_blank">⚙ Setup</a>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('docs.html')}" target="_blank" style="margin-left:4px">Docs</a>
  `;

  document.getElementById('hdr-back').addEventListener('click', () => window.close());

  // Editable company name
  const nameInput = document.getElementById('hdr-name');
  nameInput.addEventListener('blur', () => {
    const val = nameInput.value.trim();
    if (val && val !== entry.company) {
      saveEntry({ company: val });
      document.title = `${val} — CompanyIntel`;
    }
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

  document.getElementById('hdr-status').addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value, customCompanyStages);
    sel.style.borderColor = c; sel.style.color = c;
    saveEntry({ status: sel.value });
  });

  document.getElementById('hdr-stars').querySelectorAll('.hdr-star').forEach(btn => {
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
  if (score >= 8) return { label: 'Strong Match', cls: 'high' };
  if (score >= 6) return { label: 'Good Match',   cls: 'mid' };
  if (score >= 4) return { label: 'Mixed Signals', cls: 'mixed' };
  return              { label: 'Likely Not a Fit', cls: 'low' };
}

function buildOpportunity() {
  if (!entry.isOpportunity) {
    return `<button class="new-opp-btn" id="add-opp-btn">+ Add to Opportunity Pipeline</button>`;
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

  return `
    <div class="prop-row">
      <span class="prop-label">Stage</span>
      <div class="prop-val-wrap">
        <select class="prop-input" id="opp-stage-select">${stageOptions}</select>
      </div>
    </div>
    <div class="prop-row">
      <span class="prop-label">Role</span>
      <div class="prop-val-wrap">
        <input class="prop-input ${!title ? 'prop-empty' : ''}" id="opp-title-input" value="${title}" placeholder="Add job title…">
      </div>
    </div>
    ${jobUrlHtml}
    ${matchHtml}
    <button class="prop-add-cancel" id="remove-from-pipeline-btn" style="font-size:11px;color:#b0c1d4;margin-top:8px;padding:2px 0">Remove from pipeline</button>
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
      </div>
      <div class="hub-pane active" id="hub-intel">
        ${buildIntelTab()}
      </div>
      <div class="hub-pane" id="hub-notes">
        <textarea class="hub-notes-ta" id="hub-notes-ta" placeholder="Add notes about this company…">${entry.notes || ''}</textarea>
      </div>
      <div class="hub-pane" id="hub-emails">
        <div class="hub-pane-toolbar" id="emails-toolbar" style="display:none">
          <span class="hub-cache-age" id="emails-cache-age"></span>
          <button class="hub-refresh-btn" id="emails-refresh-btn">Refresh</button>
        </div>
        <div class="p-empty" id="act-emails-status">Loading emails…</div>
        <div id="act-emails-list"></div>
      </div>
      <div class="hub-pane" id="hub-meetings">
        <div class="hub-pane-toolbar" id="meetings-toolbar" style="display:none">
          <span class="hub-cache-age" id="meetings-cache-age"></span>
          <button class="hub-refresh-btn" id="meetings-refresh-btn">Refresh</button>
        </div>
        <div class="p-empty" id="act-meetings-status">Loading meeting notes…</div>
        <div id="act-meetings-content"></div>
      </div>
    </div>`;
  bindHubTabs();
}

function buildIntelTab() {
  const overview = buildOverview();
  const intel = buildIntel();
  const reviews = buildReviews();
  const hasIntel = !intel.includes('p-empty');
  const hasReviews = !reviews.includes('p-empty');
  return `
    <div class="hub-intel-block">${overview}</div>
    ${hasIntel  ? `<div class="hub-intel-block">${intel}</div>` : ''}
    ${hasReviews ? `<div class="hub-intel-block"><div class="hub-section-label">Employee Reviews</div>${reviews}</div>` : ''}
  `;
}

function bindHubTabs() {
  const container = document.querySelector('.hub-tabs-container');
  if (!container) return;

  let emailsLoaded = false, meetingsLoaded = false;

  container.querySelectorAll('.hub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.hub-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('hub-' + tab.dataset.tab)?.classList.add('active');

      if (tab.dataset.tab === 'emails' && !emailsLoaded) {
        emailsLoaded = true;
        loadHubEmails();
      }
      if (tab.dataset.tab === 'meetings' && !meetingsLoaded) {
        meetingsLoaded = true;
        loadHubMeetings();
      }
    });
  });

  const ta = document.getElementById('hub-notes-ta');
  if (ta) ta.addEventListener('blur', () => saveEntry({ notes: ta.value }));

  document.getElementById('emails-refresh-btn')?.addEventListener('click', () => loadHubEmails(true));
  document.getElementById('meetings-refresh-btn')?.addEventListener('click', () => loadHubMeetings(true));
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
  const toolbar   = document.getElementById('emails-toolbar');
  const cacheAgeEl = document.getElementById('emails-cache-age');
  if (!statusEl || !listEl) return;

  // Serve from cache if available and not forcing refresh
  if (!forceRefresh && entry.cachedEmails?.length) {
    renderEmailsFromData(entry.cachedEmails);
    if (toolbar) toolbar.style.display = 'flex';
    if (cacheAgeEl) cacheAgeEl.textContent = `Updated ${formatCacheAge(entry.cachedEmailsAt)}`;
    return;
  }

  statusEl.style.display = '';
  statusEl.textContent = 'Loading emails…';
  if (listEl) listEl.innerHTML = '';

  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  const knownContactEmails = (entry.knownContacts || []).map(c => c.email);
  chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName: entry.company || '', linkedinSlug, knownContactEmails }, result => {
    if (!document.getElementById('act-emails-status')) return; // pane unmounted
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Gmail in Setup to see emails.'; return; }
    if (!result?.emails?.length)           { statusEl.textContent = 'No emails found for this company.'; return; }

    const now = Date.now();
    saveEntry({ cachedEmails: result.emails, cachedEmailsAt: now });
    renderEmailsFromData(result.emails);
    if (toolbar) toolbar.style.display = 'flex';
    if (cacheAgeEl) cacheAgeEl.textContent = 'Updated just now';

    const newContacts = extractContactsFromEmails(result.emails);
    if (newContacts.length) {
      const merged = [...(entry.knownContacts || []), ...newContacts];
      saveEntry({ knownContacts: merged });
      renderPanel('contacts');
      renderPanel('leadership');
      bindPanelBodyEvents('contacts');
      bindPanelBodyEvents('leadership');
    }
  });
}

function loadHubMeetings(forceRefresh) {
  const statusEl  = document.getElementById('act-meetings-status');
  const contentEl = document.getElementById('act-meetings-content');
  const toolbar   = document.getElementById('meetings-toolbar');
  const cacheAgeEl = document.getElementById('meetings-cache-age');
  if (!statusEl || !contentEl) return;

  // Serve from cache if available and not forcing refresh
  if (!forceRefresh && entry.cachedMeetingNotes) {
    statusEl.style.display = 'none';
    contentEl.innerHTML = `<div class="meeting-note">${escapeHtml(entry.cachedMeetingNotes)}</div>`;
    if (toolbar) toolbar.style.display = 'flex';
    if (cacheAgeEl) cacheAgeEl.textContent = `Updated ${formatCacheAge(entry.cachedMeetingNotesAt)}`;
    return;
  }

  statusEl.style.display = '';
  statusEl.textContent = 'Loading meeting notes…';
  contentEl.innerHTML = '';

  chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company }, result => {
    if (!document.getElementById('act-meetings-status')) return;
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Granola in Setup to see meeting notes.'; return; }
    if (!result?.notes)                    { statusEl.textContent = 'No meeting notes found for this company.'; return; }

    saveEntry({ cachedMeetingNotes: result.notes, cachedMeetingNotesAt: Date.now() });
    statusEl.style.display = 'none';
    contentEl.innerHTML = `<div class="meeting-note">${escapeHtml(result.notes)}</div>`;
    if (toolbar) toolbar.style.display = 'flex';
    if (cacheAgeEl) cacheAgeEl.textContent = 'Updated just now';
  });
}

function buildPanelHTML(pid) {
  const title = pid === 'properties' ? '' : (PANEL_TITLES[pid] || pid);
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
    case 'chat':       return `<div data-chat-panel="${entry.id}"></div>`;
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

  return `<div class="prop-fields" id="prop-fields">${rows}</div>
    <div id="prop-add-area">
      <button class="prop-add-btn" id="prop-add-btn">+ Add field</button>
    </div>`;
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
  if (!oneLiner && !eli5 && !cat) return '<div class="p-empty">No overview available.</div>';
  return `
    ${cat ? `<span class="p-category">${cat}</span>` : ''}
    ${oneLiner ? `<div class="p-oneliner">${oneLiner}</div>` : ''}
    ${eli5 ? `<div class="p-section"><div class="p-section-label">In Plain English</div><div class="p-text">${eli5}</div></div>` : ''}
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

// Extracts contacts from company domain out of email from/to fields
function extractContactsFromEmails(emails) {
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!domain) return [];

  const existing = new Set((entry.knownContacts || []).map(c => c.email.toLowerCase()));
  const newContacts = [];

  emails.forEach(e => {
    [e.from, e.to].forEach(field => {
      if (!field) return;
      field.split(/,\s*/).forEach(addr => {
        const m = addr.match(/^(.*?)\s*<([^>]+)>$/) || [null, '', addr.trim()];
        const name = (m[1] || '').replace(/^["']+|["']+$/g, '').trim();
        const email = (m[2] || '').trim().toLowerCase();
        if (!email.includes('@')) return;
        const emailDomain = email.split('@')[1];
        if (emailDomain !== domain) return;
        if (existing.has(email)) return;
        existing.add(email);
        newContacts.push({
          name: name || email.split('@')[0],
          email,
          source: 'email',
          detectedAt: Date.now(),
        });
      });
    });
  });

  return newContacts;
}

// Fuzzy name match: both share at least first + last word
function namesMatch(a, b) {
  const words = s => s.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const wa = words(a), wb = words(b);
  return wa.length >= 2 && wb.length >= 2 &&
    wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
}

function buildLeadership() {
  const leaders = entry.leaders || [];
  if (!leaders.length) return '<div class="p-empty">No leadership data available.</div>';
  const contacts = entry.knownContacts || [];
  return leaders.map(l => {
    const initials = (l.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const matched = contacts.find(c => namesMatch(c.name, l.name || ''));
    return `
      <div class="leader-card">
        <div class="leader-avatar" id="lavatar-${entry.id}-${encodeURIComponent(l.name||'')}">
          ${initials}
        </div>
        <div style="min-width:0">
          <div class="leader-name">${l.name||''}</div>
          <div class="leader-role">${l.title||''}</div>
          ${matched ? `<div class="leader-email">${matched.email}</div>` : ''}
          <div class="leader-links">
            ${l.linkedinUrl||l.linkedin ? `<a class="leader-link li" href="${l.linkedinUrl||l.linkedin}" target="_blank">LinkedIn</a>` : ''}
            ${l.newsUrl ? `<a class="leader-link news" href="${l.newsUrl}" target="_blank">${/linkedin\.com/i.test(l.newsUrl) ? 'LinkedIn' : 'News'}</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function buildContacts() {
  const contacts = entry.knownContacts || [];
  if (!contacts.length) return `<div class="p-empty" style="font-size:12px;color:#7c98b6">No contacts detected yet. Open the Activity panel to scan emails from this company's domain.</div>`;
  return contacts.map(c => {
    const initials = c.name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
    const sourceLabel = c.source === 'email' ? '✉' : '📅';
    return `
      <div class="contact-card">
        <div class="contact-avatar">${initials}</div>
        <div style="min-width:0;overflow:hidden">
          <div class="contact-name">${c.name}</div>
          <div class="contact-email">${c.email}</div>
          <div class="contact-source">${sourceLabel} via ${c.source}</div>
        </div>
      </div>`;
  }).join('');
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
    const text = ((j.title || '') + ' ' + (j.snippet || '') + ' ' + (j.url || '')).toLowerCase();
    return text.includes(companyLower) || (domain && text.includes(domain));
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
  ['properties','stats','links','tags','overview','intel','reviews','leadership','contacts','opportunity'].forEach(pid => {
    bindPanelBodyEvents(pid);
  });
}

function bindPanelBodyEvents(pid) {
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

    const removeBtn = document.getElementById('remove-from-pipeline-btn');
    if (removeBtn) removeBtn.addEventListener('click', () => {
      if (!confirm('Remove from opportunity pipeline? The company record stays.')) return;
      saveEntry({ isOpportunity: false, jobStage: null, jobTitle: null, jobMatch: null, jobUrl: null, jobSnapshot: null });
      renderHeader();
      renderPanel('opportunity');
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

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    const existing = entry.tags || [];
    if (!val) { sugg.style.display = 'none'; return; }
    const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !existing.includes(t));
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.innerHTML = matches.slice(0,5).map(t => `<div class="tag-sugg-item" data-tag="${t}">${t}</div>`).join('');
    sugg.style.display = 'block';
    sugg.querySelectorAll('.tag-sugg-item').forEach(s => {
      s.addEventListener('mousedown', e => { e.preventDefault(); commitTag(s.dataset.tag); });
    });
  });
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

// ── Boot ───────────────────────────────────────────────────────────────────
init();
