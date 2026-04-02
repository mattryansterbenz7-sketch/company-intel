// pipeline.js — pipeline settings UI

const ENRICHMENT_META = {
  apollo: { name: 'Apollo', desc: 'Company firmographics from Apollo.io', keyField: 'apollo' },
  webResearch: { name: 'Web Research', desc: 'Search + AI extraction from web results', keyField: null },
};

const SEARCH_META = {
  serper: { name: 'Serper', desc: 'Google Search via Serper', cost: 'cheap', keyField: 'serper' },
  google_cse: { name: 'Google CSE', desc: 'Google Custom Search (free tier)', cost: 'cheap', keyField: 'google_cse' },
  openai: { name: 'OpenAI Search', desc: 'Web search via OpenAI', cost: 'expensive', keyField: 'openai' },
  claude: { name: 'Claude Search', desc: 'Web search via Anthropic', cost: 'expensive', keyField: 'anthropic' },
};

const AI_MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
];

const AI_MODEL_DEFAULTS = {
  companyIntelligence: 'claude-haiku-4-5-20251001',
  firmographicExtraction: 'claude-haiku-4-5-20251001',
  quickFitScoring: 'claude-haiku-4-5-20251001',
  nextStepExtraction: 'claude-haiku-4-5-20251001',
  chat: 'claude-sonnet-4-6',
};

const AI_MODEL_TASKS = [
  { key: 'companyIntelligence', label: 'Company Intelligence', desc: 'Research synthesis' },
  { key: 'firmographicExtraction', label: 'Firmographic Extraction', desc: 'Web data parsing' },
  { key: 'quickFitScoring', label: 'Fit Scoring', desc: 'Score, flags, and analysis (unified scorer)' },
  { key: 'nextStepExtraction', label: 'Next Step Extraction', desc: 'Action item detection' },
  { key: 'chat', label: 'Chat', desc: 'Conversational assistant' },
];

const SEARCH_COUNT_META = [
  { key: 'reviewScout', label: 'Review scout', min: 1, max: 10 },
  { key: 'reviewDrill', label: 'Review drill', min: 1, max: 5 },
  { key: 'leaders', label: 'Leaders', min: 1, max: 10 },
  { key: 'jobs', label: 'Jobs', min: 1, max: 10 },
  { key: 'product', label: 'Product', min: 1, max: 10 },
];

const PHOTO_SOURCE_META = {
  linkedin_thumbnail: { name: 'LinkedIn thumbnails', desc: 'Free — extracted from existing search results', cost: 'free' },
  serper_images: { name: 'Serper image search', desc: '1 credit per photo', cost: 'cheap' },
};

const PHOTO_SCOPE_OPTIONS = [
  { value: 'leaders_only', label: 'Leaders only' },
  { value: 'leaders_contacts', label: 'Leaders + contacts' },
  { value: 'nobody', label: 'Nobody (initials only)' },
];

const PHOTO_CACHE_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 0, label: 'Never expire' },
];

const SCOUT_CACHE_OPTIONS = [
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
];

let currentConfig = null;
let currentKeyStatus = null;

function savePipelineConfig(config) {
  currentConfig = config;
  chrome.runtime.sendMessage({ type: 'SET_PIPELINE_CONFIG', config });
}

function statusDot(providerId, keyStatus) {
  if (!keyStatus) return '';
  const meta = ENRICHMENT_META[providerId] || SEARCH_META[providerId];
  const keyField = meta?.keyField;

  // Web Research is healthy if any search + anthropic key are available
  if (providerId === 'webResearch') {
    const healthy = keyStatus.anthropic && (keyStatus.serper || keyStatus.google_cse || keyStatus.openai);
    return healthy
      ? '<span class="status-dot healthy"></span><span class="status-label">healthy</span>'
      : '<span class="status-dot nokey"></span><span class="status-label">no key</span>';
  }

  if (!keyField) return '';
  const hasKey = keyStatus[keyField];
  if (!hasKey) return '<span class="status-dot nokey"></span><span class="status-label">no key</span>';

  // Check exhaustion flags
  if (providerId === 'apollo' && keyStatus.apolloExhausted) return '<span class="status-dot exhausted"></span><span class="status-label">exhausted</span>';
  if (providerId === 'serper' && keyStatus.serperExhausted) return '<span class="status-dot exhausted"></span><span class="status-label">exhausted</span>';

  return '<span class="status-dot healthy"></span><span class="status-label">healthy</span>';
}

function renderEnrichmentOrder(config, keyStatus) {
  const items = config.enrichmentOrder || [];
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Enrichment Order</div>';
  html += '<div class="pipeline-sub-desc">Drag to reorder. Data flows top to bottom.</div>';
  html += '<div id="enrichment-list">';
  items.forEach((item, i) => {
    const meta = ENRICHMENT_META[item.id] || { name: item.id, desc: '' };
    const disabledClass = item.enabled ? '' : ' disabled';
    html += `<div class="pipeline-row${disabledClass}" draggable="true" data-enrichment-idx="${i}">
      <span class="pipeline-drag">&#9776;</span>
      <div><div class="pipeline-name">${meta.name}</div><div class="pipeline-desc">${meta.desc}</div></div>
      <div class="pipeline-status">
        ${statusDot(item.id, keyStatus)}
        <label class="pipeline-toggle">
          <input type="checkbox" data-enrichment-toggle="${i}" ${item.enabled ? 'checked' : ''}>
          <span class="pipeline-toggle-track"></span>
        </label>
      </div>
    </div>`;
    if (i < items.length - 1) html += '<div class="pipeline-cascade-arrow">&#8595;</div>';
  });
  html += '</div></div>';
  return html;
}

function renderSearchChain(config, keyStatus) {
  const items = config.searchFallbackOrder || [];
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Search Fallback Chain</div>';
  html += '<div class="pipeline-sub-desc">Tries each enabled provider in order until results are found.</div>';
  html += '<div id="search-chain-list">';
  items.forEach((item, i) => {
    const meta = SEARCH_META[item.id] || { name: item.id, desc: '', cost: 'cheap' };
    const disabledClass = item.enabled ? '' : ' disabled';
    const costClass = meta.cost === 'expensive' ? 'expensive' : 'cheap';
    const costLabel = meta.cost === 'expensive' ? '$$' : '$';
    html += `<div class="pipeline-row${disabledClass}" draggable="true" data-search-idx="${i}">
      <span class="pipeline-drag">&#9776;</span>
      <div><div class="pipeline-name">${meta.name}</div><div class="pipeline-desc">${meta.desc}</div></div>
      <div class="pipeline-status">
        ${statusDot(item.id, keyStatus)}
        <span class="pipeline-cost ${costClass}">${costLabel}</span>
        <label class="pipeline-toggle">
          <input type="checkbox" data-search-toggle="${i}" ${item.enabled ? 'checked' : ''}>
          <span class="pipeline-toggle-track"></span>
        </label>
      </div>
    </div>`;
    if (i < items.length - 1) html += '<div class="pipeline-cascade-arrow">&#8595;</div>';
  });
  html += '</div></div>';
  return html;
}

function buildModelDropdown(taskKey, models) {
  const current = models[taskKey] || AI_MODEL_DEFAULTS[taskKey] || AI_MODEL_OPTIONS[0].value;
  return AI_MODEL_OPTIONS.map(o =>
    `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`
  ).join('');
}

function renderAIModels(config) {
  const models = config.aiModels || {};
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">AI Models</div>';
  html += '<div class="pipeline-sub-desc">Choose which model handles each task.</div>';
  html += '<div class="pipeline-counts-grid">';
  AI_MODEL_TASKS.forEach(task => {
    html += `<div class="pipeline-count-row">
      <div><div class="pipeline-count-label" style="font-weight:600">${task.label}</div><div style="font-size:10px;color:#7c98b6">${task.desc}</div></div>
      <select class="pipeline-model-select" data-model-key="${task.key}">${buildModelDropdown(task.key, models)}</select>
    </div>`;
  });
  html += '</div></div>';
  return html;
}

function renderSearchCounts(config) {
  const counts = config.searchCounts || {};
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Search Result Counts</div>';
  html += '<div class="pipeline-sub-desc">Number of results per search query type.</div>';
  html += '<div class="pipeline-counts-grid">';
  SEARCH_COUNT_META.forEach(meta => {
    const val = counts[meta.key] ?? 3;
    html += `<div class="pipeline-count-row">
      <span class="pipeline-count-label">${meta.label}</span>
      <div class="pipeline-stepper">
        <button data-count-key="${meta.key}" data-count-dir="-1">-</button>
        <span id="count-val-${meta.key}">${val}</span>
        <button data-count-key="${meta.key}" data-count-dir="1">+</button>
      </div>
    </div>`;
  });
  html += '</div></div>';
  return html;
}

function renderPhotosSection(config) {
  const photos = config.photos || { sourceOrder: ['linkedin_thumbnail', 'serper_images'], maxPerCompany: 3, fetchScope: 'leaders_only', cacheTTLDays: 30 };
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">People & Photos</div>';
  html += '<div class="pipeline-sub-desc">Control how CompanyIntel fetches and displays photos for leaders and contacts.</div>';

  // Max leader photos stepper
  html += `<div class="pipeline-count-row" style="margin-bottom:10px">
    <div><div class="pipeline-count-label" style="font-weight:600">Max leader photos per company</div><div style="font-size:10px;color:#7c98b6">Photos fetched per company research. Set to 0 for initials only.</div></div>
    <div class="pipeline-stepper">
      <button data-photo-max-dir="-1">-</button>
      <span id="photo-max-val">${photos.maxPerCompany ?? 3}</span>
      <button data-photo-max-dir="1">+</button>
    </div>
  </div>`;

  // Photo source priority (drag-to-reorder)
  html += '<div style="margin-bottom:10px"><div class="pipeline-count-label" style="font-weight:600;margin-bottom:4px">Photo source priority</div>';
  html += '<div id="photo-source-list">';
  const sourceOrder = photos.sourceOrder || ['linkedin_thumbnail', 'serper_images'];
  sourceOrder.forEach((srcId, i) => {
    const meta = PHOTO_SOURCE_META[srcId] || { name: srcId, desc: '', cost: 'cheap' };
    const costClass = meta.cost === 'free' ? 'free' : 'cheap';
    const costLabel = meta.cost === 'free' ? 'free' : '$';
    html += `<div class="pipeline-row" draggable="true" data-photosrc-idx="${i}">
      <span class="pipeline-drag">&#9776;</span>
      <div><div class="pipeline-name">${meta.name}</div><div class="pipeline-desc">${meta.desc}</div></div>
      <div class="pipeline-status">
        <span class="pipeline-cost ${costClass}">${costLabel}</span>
      </div>
    </div>`;
  });
  html += '</div></div>';

  // Fetch scope radio
  html += '<div style="margin-bottom:10px"><div class="pipeline-count-label" style="font-weight:600;margin-bottom:4px">Fetch photos for</div>';
  html += '<div class="photo-scope-radios">';
  PHOTO_SCOPE_OPTIONS.forEach(opt => {
    html += `<label class="photo-scope-label">
      <input type="radio" name="photo-scope" value="${opt.value}" ${photos.fetchScope === opt.value ? 'checked' : ''}> ${opt.label}
    </label>`;
  });
  html += '</div></div>';

  // Cache duration dropdown
  html += `<div class="pipeline-count-row">
    <div><div class="pipeline-count-label" style="font-weight:600">Photo cache duration</div></div>
    <select class="pipeline-model-select" id="photo-cache-ttl">
      ${PHOTO_CACHE_OPTIONS.map(o => `<option value="${o.value}" ${(photos.cacheTTLDays ?? 30) === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
  </div>`;

  html += '</div>';
  return html;
}

function renderScoringSection(config) {
  const scoring = config.scoring || { scoutEnabled: true, scoutResultCount: 3, scoutCacheDays: 7, autoResearch: false };

  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Scoring & Research</div>';
  html += '<div class="pipeline-sub-desc">Control when research runs and what data the quick scoring model gets.</div>';

  // Auto-research toggle
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Auto-research on sidebar open</div>
      <div style="font-size:10px;color:#7c98b6">When disabled, full research only runs when you click the Research button.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="scoring-auto-research" ${scoring.autoResearch ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Scout toggle
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Company scout on quick score</div>
      <div style="font-size:10px;color:#7c98b6">Runs 1 lightweight search when scoring a job so the AI has real company context. Costs 1 Serper credit per new company, cached after first fetch.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="scoring-scout-enabled" ${scoring.scoutEnabled ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Scout result count stepper
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Scout results per search</div>
      <div style="font-size:10px;color:#7c98b6">More results = richer context for scoring, but larger prompt.</div>
    </div>
    <div class="pipeline-stepper">
      <button data-scout-count-dir="-1">-</button>
      <span id="scout-count-val">${scoring.scoutResultCount || 3}</span>
      <button data-scout-count-dir="1">+</button>
    </div>
  </div>`;

  // Scout cache duration
  html += `<div class="pipeline-count-row">
    <div><div class="pipeline-count-label" style="font-weight:600">Scout cache duration</div></div>
    <select class="pipeline-model-select" id="scout-cache-days">
      ${SCOUT_CACHE_OPTIONS.map(o => `<option value="${o.value}" ${(scoring.scoutCacheDays || 7) === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
  </div>`;

  html += '</div>';
  return html;
}

function renderPipelineOverview(config, keyStatus) {
  const models = config.aiModels || {};
  const counts = config.searchCounts || {};
  const enrichOrder = (config.enrichmentOrder || []).filter(p => p.enabled);

  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Pipeline Overview</div>';
  html += '<div class="pipeline-sub-desc">What happens with current settings.</div>';

  // Helper to make a synced model dropdown
  function overviewDropdown(taskKey) {
    return `<select class="pipeline-overview-select" data-model-key="${taskKey}">${buildModelDropdown(taskKey, models)}</select>`;
  }

  // Helper for flow pill with status dot
  function pill(label, providerId) {
    const dot = providerId && keyStatus ? statusDot(providerId, keyStatus).replace(/<span class="status-label">.*?<\/span>/, '') : '';
    return `<span class="flow-pill">${dot}${label}</span>`;
  }

  const arrow = '<span class="flow-arrow">&rarr;</span>';

  // Row 1: On research
  html += '<div class="flow-row"><span class="flow-label">On research:</span><div class="flow-chain">';
  const enrichPills = enrichOrder.map(p => pill(ENRICHMENT_META[p.id]?.name || p.id, p.id)).join(arrow);
  html += enrichPills + arrow;
  html += pill(`Scout &times;${counts.reviewScout || 3}`) + arrow;
  html += pill(`Drills 0-${counts.reviewDrill || 2}`) + arrow;
  html += pill(`Parallel &times;3`) + arrow;
  html += overviewDropdown('companyIntelligence');
  html += '</div></div>';

  // Row 2: On save (quick score)
  const scoring = config.scoring || {};
  const scoutPill = scoring.scoutEnabled !== false
    ? pill(`Scout &times;${scoring.scoutResultCount || 3}`, 'serper') + arrow
    : '';
  html += `<div class="flow-row"><span class="flow-label">On save:</span><div class="flow-chain">
    ${scoutPill}${pill('Quick score')} ${arrow} ${overviewDropdown('quickFitScoring')}
  </div></div>`;

  // Row 3: On refresh (re-runs same scorer with latest context)
  html += `<div class="flow-row"><span class="flow-label">On refresh:</span><div class="flow-chain">
    ${scoutPill}${pill('Re-score')} ${arrow} ${overviewDropdown('quickFitScoring')}
  </div></div>`;

  // Row 4: On chat
  html += `<div class="flow-row"><span class="flow-label">On chat:</span><div class="flow-chain">
    ${pill('Chat')} ${arrow} ${overviewDropdown('chat')}
  </div></div>`;

  // Cost estimate
  const searchCredits = (counts.reviewScout || 3) + (counts.leaders || 5) + (counts.jobs || 5) + (counts.product || 3) + (counts.reviewDrill || 2);
  const notes = [];
  if (keyStatus?.apolloExhausted) notes.push('Apollo exhausted — enrichment will fall through to web research');
  if (keyStatus?.serperExhausted) notes.push('Serper exhausted — search will use fallback providers');

  const scoutCredits = (scoring.scoutEnabled !== false) ? 1 : 0;
  html += `<div class="cost-estimate">
    <div class="cost-row">Est. per full research: ~${searchCredits} Serper credits + 1 Apollo credit + 2 AI calls</div>
    <div class="cost-row">Est. per job save: ${scoutCredits ? '1 Serper credit (scout, cached) + ' : ''}1 AI call (quick score)</div>
    <div class="cost-row">Est. per chat message: 1 AI call</div>
    <div class="cost-row" style="margin-top:4px;color:#0ea5e9">Full research only runs when you click the Research button${scoring.autoResearch ? ' or open the sidebar on a company page' : ''}.</div>
    ${notes.map(n => `<div class="cost-note">${n}</div>`).join('')}
  </div>`;

  html += '</div>';
  return html;
}

function setupDragReorder(containerId, arr, prefix, config) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let dragIdx = null;

  container.querySelectorAll(`[data-${prefix}-idx]`).forEach(row => {
    row.addEventListener('dragstart', e => {
      dragIdx = parseInt(row.dataset[prefix + 'Idx']);
      e.dataTransfer.effectAllowed = 'move';
      row.style.opacity = '0.5';
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      dragIdx = null;
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      const dropIdx = parseInt(row.dataset[prefix + 'Idx']);
      if (dragIdx === null || dragIdx === dropIdx) return;
      const [moved] = arr.splice(dragIdx, 1);
      arr.splice(dropIdx, 0, moved);
      savePipelineConfig(config);
      loadPipelineSettings();
    });
  });
}

async function loadPipelineSettings() {
  const config = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_PIPELINE_CONFIG' }, r));
  const keyStatus = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r));
  if (!config) return;
  currentConfig = config;
  currentKeyStatus = keyStatus;

  const body = document.getElementById('pipeline-body');
  if (!body) return;

  body.innerHTML =
    renderEnrichmentOrder(config, keyStatus) +
    renderSearchChain(config, keyStatus) +
    renderAIModels(config) +
    renderSearchCounts(config) +
    renderScoringSection(config) +
    renderPhotosSection(config) +
    renderPipelineOverview(config, keyStatus);

  // ── Toggle switches (enrichment) ──
  body.querySelectorAll('[data-enrichment-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.enrichmentToggle);
      config.enrichmentOrder[idx].enabled = input.checked;
      input.closest('.pipeline-row').classList.toggle('disabled', !input.checked);
      savePipelineConfig(config);
    });
  });

  // ── Toggle switches (search) ──
  body.querySelectorAll('[data-search-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.searchToggle);
      config.searchFallbackOrder[idx].enabled = input.checked;
      input.closest('.pipeline-row').classList.toggle('disabled', !input.checked);
      savePipelineConfig(config);
    });
  });

  // ── All model dropdowns (both AI Models section and Pipeline Overview) ──
  body.querySelectorAll('[data-model-key]').forEach(select => {
    select.addEventListener('change', () => {
      if (!config.aiModels) config.aiModels = {};
      config.aiModels[select.dataset.modelKey] = select.value;
      savePipelineConfig(config);
      // Sync all dropdowns with the same key
      body.querySelectorAll(`[data-model-key="${select.dataset.modelKey}"]`).forEach(s => {
        if (s !== select) s.value = select.value;
      });
    });
  });

  // ── Stepper buttons (search counts) ──
  body.querySelectorAll('[data-count-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.countKey;
      const dir = parseInt(btn.dataset.countDir);
      const meta = SEARCH_COUNT_META.find(m => m.key === key);
      if (!config.searchCounts) config.searchCounts = {};
      const current = config.searchCounts[key] ?? 3;
      const next = Math.max(meta.min, Math.min(meta.max, current + dir));
      config.searchCounts[key] = next;
      document.getElementById('count-val-' + key).textContent = next;
      savePipelineConfig(config);
    });
  });

  // ── Photo max stepper ──
  body.querySelectorAll('[data-photo-max-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!config.photos) config.photos = {};
      const current = config.photos.maxPerCompany ?? 3;
      const next = Math.max(0, Math.min(10, current + parseInt(btn.dataset.photoMaxDir)));
      config.photos.maxPerCompany = next;
      document.getElementById('photo-max-val').textContent = next;
      savePipelineConfig(config);
    });
  });

  // ── Photo scope radios ──
  body.querySelectorAll('input[name="photo-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!config.photos) config.photos = {};
      config.photos.fetchScope = radio.value;
      savePipelineConfig(config);
    });
  });

  // ── Photo cache TTL ──
  const cacheTTL = document.getElementById('photo-cache-ttl');
  if (cacheTTL) {
    cacheTTL.addEventListener('change', () => {
      if (!config.photos) config.photos = {};
      config.photos.cacheTTLDays = parseInt(cacheTTL.value);
      savePipelineConfig(config);
    });
  }

  // ── Scoring & Research controls ──
  const autoResearchToggle = document.getElementById('scoring-auto-research');
  if (autoResearchToggle) {
    autoResearchToggle.addEventListener('change', () => {
      if (!config.scoring) config.scoring = {};
      config.scoring.autoResearch = autoResearchToggle.checked;
      savePipelineConfig(config);
    });
  }
  const scoutToggle = document.getElementById('scoring-scout-enabled');
  if (scoutToggle) {
    scoutToggle.addEventListener('change', () => {
      if (!config.scoring) config.scoring = {};
      config.scoring.scoutEnabled = scoutToggle.checked;
      savePipelineConfig(config);
    });
  }
  body.querySelectorAll('[data-scout-count-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!config.scoring) config.scoring = {};
      const current = config.scoring.scoutResultCount || 3;
      const next = Math.max(1, Math.min(10, current + parseInt(btn.dataset.scoutCountDir)));
      config.scoring.scoutResultCount = next;
      document.getElementById('scout-count-val').textContent = next;
      savePipelineConfig(config);
    });
  });
  const scoutCacheDays = document.getElementById('scout-cache-days');
  if (scoutCacheDays) {
    scoutCacheDays.addEventListener('change', () => {
      if (!config.scoring) config.scoring = {};
      config.scoring.scoutCacheDays = parseInt(scoutCacheDays.value);
      savePipelineConfig(config);
    });
  }

  // ── Drag-to-reorder ──
  setupDragReorder('enrichment-list', config.enrichmentOrder, 'enrichment', config);
  setupDragReorder('search-chain-list', config.searchFallbackOrder, 'search', config);
  // Photo source drag-reorder
  if (config.photos?.sourceOrder) {
    setupDragReorder('photo-source-list', config.photos.sourceOrder, 'photosrc', config);
  }
}

// ── API Usage Dashboard ──────────────────────────────────────────────────────

let _usagePeriod = 'week'; // day | week | month | custom
let _usageCustomStart = null;
let _usageCustomEnd = null;

const USAGE_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', keyCheck: 'anthropic_key', type: 'ai', billing: 'https://console.anthropic.com/settings/billing' },
  { id: 'openai', name: 'OpenAI', keyCheck: 'openai_key', type: 'ai', billing: 'https://platform.openai.com/settings/organization/billing/overview' },
  { id: 'serper', name: 'Serper', keyCheck: 'serper_key', type: 'credit', billing: 'https://serper.dev/dashboard' },
  { id: 'apollo', name: 'Apollo', keyCheck: 'apollo_key', type: 'credit', billing: 'https://app.apollo.io/#/settings/credits/current' },
  { id: 'granola', name: 'Granola', keyCheck: 'granola_key', type: 'data', billing: null },
];

function getUsageDateRange() {
  const now = new Date();
  if (_usagePeriod === 'custom' && _usageCustomStart && _usageCustomEnd) {
    return { start: _usageCustomStart, end: _usageCustomEnd };
  }
  if (_usagePeriod === 'day') {
    return { start: now.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (_usagePeriod === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: s.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  // week (default)
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return { start: mon.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

function sumHistoryInRange(history, start, end) {
  return (history || []).filter(d => d.date >= start && d.date <= end).reduce((acc, d) => {
    acc.requests += d.requests || 0;
    acc.inputTokens += d.inputTokens || 0;
    acc.outputTokens += d.outputTokens || 0;
    return acc;
  }, { requests: 0, inputTokens: 0, outputTokens: 0 });
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

function renderSparkline(history, range) {
  const days = (history || []).filter(d => d.date >= range.start && d.date <= range.end);
  if (days.length < 2) return '';
  const max = Math.max(...days.map(d => d.requests), 1);
  const w = 50, h = 18;
  const points = days.map((d, i) => {
    const x = (i / Math.max(days.length - 1, 1)) * w;
    const y = h - (d.requests / max) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return `<svg class="usage-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="#7c98b6" stroke-width="1.2"/></svg>`;
}

function estimateCost(provider, sum) {
  if (provider === 'anthropic') {
    const costIn = sum.inputTokens * 0.25 / 1000000; // ~Haiku rate
    const costOut = sum.outputTokens * 1.25 / 1000000;
    const total = costIn + costOut;
    return total < 0.01 ? '<$0.01' : '$' + total.toFixed(2);
  }
  if (provider === 'openai') {
    const costIn = sum.inputTokens * 0.15 / 1000000; // ~GPT-4.1 mini rate
    const costOut = sum.outputTokens * 0.6 / 1000000;
    const total = costIn + costOut;
    return total < 0.01 ? '<$0.01' : '$' + total.toFixed(2);
  }
  if (provider === 'serper') {
    return sum.requests + ' credits';
  }
  return '';
}

function loadUsageDashboard() {
  chrome.runtime.sendMessage({ type: 'GET_API_USAGE' }, usage => {
    void chrome.runtime.lastError;
    chrome.storage.local.get(['apiCreditAllocations', 'integrations'], data => {
      const alloc = data.apiCreditAllocations || {};
      const integrations = data.integrations || {};
      renderUsageDashboard(usage || {}, alloc, integrations);
    });
  });
}

function renderUsageDashboard(usage, alloc, integrations) {
  const container = document.getElementById('usage-container');
  if (!container) return;

  const range = getUsageDateRange();
  const periodLabel = _usagePeriod === 'day' ? 'Today' : _usagePeriod === 'week' ? 'This week' : _usagePeriod === 'month' ? 'This month' : `${range.start} – ${range.end}`;

  let html = `<div class="usage-section">
    <div class="usage-header">
      <span class="usage-title">API Usage</span>
      <div class="usage-controls">
        <button class="usage-period-btn${_usagePeriod === 'day' ? ' active' : ''}" data-period="day">Day</button>
        <button class="usage-period-btn${_usagePeriod === 'week' ? ' active' : ''}" data-period="week">Week</button>
        <button class="usage-period-btn${_usagePeriod === 'month' ? ' active' : ''}" data-period="month">Month</button>
        <input type="date" class="usage-date-input" id="usage-start" value="${range.start}">
        <span style="color:#7c98b6;font-size:11px">–</span>
        <input type="date" class="usage-date-input" id="usage-end" value="${range.end}">
        <button class="usage-reset-btn" id="usage-reset-btn">Reset</button>
      </div>
    </div>
    <div class="usage-table">`;

  let totalRequests = 0, totalInputTokens = 0, totalOutputTokens = 0, totalEstCost = 0;

  for (const prov of USAGE_PROVIDERS) {
    const pd = usage[prov.id] || { totalRequests: 0, dailyHistory: [], errors: { count429: 0, count401: 0, countOther: 0 }, tokensToday: { input: 0, output: 0 } };
    const configured = !!integrations[prov.keyCheck];
    const dimmed = !configured ? ' dimmed' : '';
    const sum = sumHistoryInRange(pd.dailyHistory, range.start, range.end);
    totalRequests += sum.requests;
    totalInputTokens += sum.inputTokens;
    totalOutputTokens += sum.outputTokens;

    // Status
    let dotColor = 'gray', statusText = 'No key', statusClass = 'gray';
    if (!configured) { /* keep gray */ }
    else if (pd.errors?.count401 > 0) { dotColor = 'red'; statusText = 'Auth error'; statusClass = 'red'; }
    else if (pd.errors?.count429 > 0) { dotColor = 'yellow'; statusText = `${pd.errors.count429} retries`; statusClass = 'yellow'; }
    else if (pd.totalRequests > 0) { dotColor = 'green'; statusText = 'Healthy'; statusClass = 'green'; }
    else if (configured) { dotColor = 'green'; statusText = 'Ready'; statusClass = 'green'; }

    // Details
    let details = '';
    if (prov.type === 'ai' && configured) {
      if (sum.inputTokens || sum.outputTokens) {
        details += `${fmtTokens(sum.inputTokens)} in · ${fmtTokens(sum.outputTokens)} out`;
        const cost = estimateCost(prov.id, sum);
        if (cost) details += ` · <span class="usage-cost">~${cost}</span>`;
      }
      if (pd.lastRateLimit?.tokensRemaining != null) {
        details += `<br>Rate: ${fmtTokens(pd.lastRateLimit.tokensRemaining)}/${fmtTokens(pd.lastRateLimit.tokensLimit || 0)} tokens/min`;
      }
    } else if (prov.type === 'credit' && configured) {
      const creditAlloc = alloc[prov.id];
      if (creditAlloc > 0) {
        const pct = Math.min((pd.totalRequests || 0) / creditAlloc * 100, 100);
        const barColor = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';
        details += `<div class="usage-progress"><div class="usage-progress-bar ${barColor}" style="width:${pct}%"></div></div>`;
        details += `${pd.totalRequests || 0} / <span class="usage-alloc-link" data-provider="${prov.id}">${creditAlloc.toLocaleString()}</span> credits`;
      } else {
        details += `<span class="usage-alloc-link" data-provider="${prov.id}">Set credit limit</span>`;
      }
    } else if (prov.type === 'data' && pd.totalRequests > 0) {
      details += 'Meeting notes & transcripts';
    }
    if (!configured) details = '<span style="font-style:italic">No key configured</span>';

    const billingLink = prov.billing ? `<a href="${prov.billing}" target="_blank" class="usage-billing-link" title="View billing">↗</a>` : '';
    const sparkline = renderSparkline(pd.dailyHistory, range);

    html += `<div class="usage-row${dimmed}">
      <div class="usage-provider">${prov.name} ${billingLink}</div>
      <div class="usage-counts">
        <div class="usage-count-primary">${sum.requests} req ${sparkline}</div>
        <div class="usage-count-secondary">${(pd.totalRequests || 0).toLocaleString()} all time</div>
      </div>
      <div class="usage-status"><span class="usage-dot ${dotColor}"></span><span class="usage-status-text ${statusClass}">${statusText}</span></div>
      <div class="usage-details">${details}</div>
    </div>`;
  }

  // Totals bar
  html += `</div>
    <div class="usage-total-bar">
      <div class="usage-total-item"><span class="usage-total-label">Total requests (${periodLabel})</span><span class="usage-total-value">${totalRequests.toLocaleString()}</span></div>
      <div class="usage-total-item"><span class="usage-total-label">Tokens in</span><span class="usage-total-value">${fmtTokens(totalInputTokens)}</span></div>
      <div class="usage-total-item"><span class="usage-total-label">Tokens out</span><span class="usage-total-value">${fmtTokens(totalOutputTokens)}</span></div>
    </div>
  </div>`;

  container.innerHTML = html;

  // Period buttons
  container.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      _usagePeriod = btn.dataset.period;
      _usageCustomStart = null;
      _usageCustomEnd = null;
      loadUsageDashboard();
    });
  });

  // Date inputs
  const startInput = document.getElementById('usage-start');
  const endInput = document.getElementById('usage-end');
  if (startInput && endInput) {
    const onDateChange = () => {
      _usagePeriod = 'custom';
      _usageCustomStart = startInput.value;
      _usageCustomEnd = endInput.value;
      loadUsageDashboard();
    };
    startInput.addEventListener('change', onDateChange);
    endInput.addEventListener('change', onDateChange);
  }

  // Reset
  document.getElementById('usage-reset-btn')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_API_USAGE' }, () => loadUsageDashboard());
  });

  // Credit allocation inline edit
  container.querySelectorAll('.usage-alloc-link').forEach(link => {
    link.addEventListener('click', () => {
      const prov = link.dataset.provider;
      const current = alloc[prov] || '';
      const input = document.createElement('input');
      input.className = 'usage-alloc-input';
      input.type = 'number';
      input.min = '0';
      input.value = current;
      input.placeholder = 'e.g. 2500';
      link.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        const val = parseInt(input.value) || 0;
        alloc[prov] = val;
        chrome.runtime.sendMessage({ type: 'SET_CREDIT_ALLOCATION', provider: prov, credits: val }, () => loadUsageDashboard());
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); input.blur(); } });
    });
  });
}

// ── Boot ──
loadPipelineSettings();
loadUsageDashboard();
setInterval(loadUsageDashboard, 30000);
