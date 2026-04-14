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
  { key: 'coopAutofill', label: "Coop's autofills", desc: 'ICP, flags, skills, experience tagging, FAQ' },
  { key: 'coopMemorySynthesis', label: "Coop's memory synthesis", desc: 'Context Window narrative regeneration' },
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
  { value: 0, label: 'Never expire' },
];

let currentConfig = null;
let currentKeyStatus = null;

function savePipelineConfig(config) {
  currentConfig = config;
  chrome.runtime.sendMessage({ type: 'SET_PIPELINE_CONFIG', config }, (resp) => {
    void chrome.runtime.lastError;
    const toast = document.getElementById('pipeline-save-toast');
    if (toast) {
      toast.style.opacity = '1';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    }
  });
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
  html += '<div class="pipeline-sub-desc">Control how Coop.ai fetches and displays photos for leaders and contacts.</div>';

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
      ${SCOUT_CACHE_OPTIONS.map(o => `<option value="${o.value}" ${(scoring.scoutCacheDays ?? 7) === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
  </div>`;

  html += '</div>';
  return html;
}

function renderChatFallbackSection(config) {
  const fb = config.chatFallback || { enabled: true, allowExpensive: false, showIndicator: true };

  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Chat Model Fallback</div>';
  html += '<div class="pipeline-sub-desc">When the primary chat model fails (rate limit, outage), Coop can try other models. Control which models are allowed.</div>';

  // Fallback enabled toggle
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Enable fallback</div>
      <div style="font-size:10px;color:#7c98b6">If disabled, Coop will show an error instead of trying another model.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-enabled" ${fb.enabled ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Allow expensive models toggle
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Allow expensive fallback models</div>
      <div style="font-size:10px;color:#7c98b6">When OFF, fallback is limited to cheap models (Haiku, GPT-4.1 Mini). When ON, Sonnet and GPT-4.1 are also available as fallbacks — these cost 3-5x more per message.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-allow-expensive" ${fb.allowExpensive ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Show fallback indicator toggle
  html += `<div class="pipeline-count-row">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Show fallback indicator in chat</div>
      <div style="font-size:10px;color:#7c98b6">Display a notice when Coop used a different model than your selected one.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-show-indicator" ${fb.showIndicator ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Current fallback order display
  const cheapModels = ['Haiku ($1/$5 per MTok)', 'GPT-4.1 Mini ($0.40/$1.60 per MTok)'];
  const expensiveModels = ['Sonnet ($3/$15 per MTok)', 'GPT-4.1 ($2/$8 per MTok)'];
  html += `<div style="margin-top:10px;padding:10px 12px;background:var(--ci-bg-secondary, #f5f0eb);border-radius:8px;font-size:11px;color:#7c98b6">
    <div style="font-weight:600;margin-bottom:4px;color:var(--ci-text-primary, #2d2a26)">Current fallback order:</div>
    <div>Your selected model → ${cheapModels.join(' → ')}${fb.allowExpensive ? ' → ' + expensiveModels.join(' → ') : ''}</div>
    ${!fb.enabled ? '<div style="color:var(--ci-accent-red, #c44040);margin-top:4px;font-weight:600">Fallback disabled — errors will surface directly.</div>' : ''}
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
    renderChatFallbackSection(config) +
    renderPhotosSection(config) +
    renderPipelineOverview(config, keyStatus) +
    '<div id="auto-rescore-section"></div>';

  loadAutoRescoreSection();

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

  // ── Chat Fallback controls ──
  const fbEnabled = document.getElementById('fb-enabled');
  if (fbEnabled) {
    fbEnabled.addEventListener('change', () => {
      if (!config.chatFallback) config.chatFallback = {};
      config.chatFallback.enabled = fbEnabled.checked;
      savePipelineConfig(config);
    });
  }
  const fbExpensive = document.getElementById('fb-allow-expensive');
  if (fbExpensive) {
    fbExpensive.addEventListener('change', () => {
      if (!config.chatFallback) config.chatFallback = {};
      config.chatFallback.allowExpensive = fbExpensive.checked;
      savePipelineConfig(config);
    });
  }
  const fbIndicator = document.getElementById('fb-show-indicator');
  if (fbIndicator) {
    fbIndicator.addEventListener('change', () => {
      if (!config.chatFallback) config.chatFallback = {};
      config.chatFallback.showIndicator = fbIndicator.checked;
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

// ── Auto-rescore section ──
function loadAutoRescoreSection() {
  chrome.storage.local.get(['coopConfig', 'savedCompanies'], data => {
    const DEFAULT_AUTOMATIONS = {
      insightExtraction: true, autoFetchUrls: true, applicationModeDetection: true, contextualSuggestions: true,
      rescoreOnProfileChange: false, rescoreOnPrefChange: false, rescoreOnNewData: false,
    };
    const cfg = { automations: { ...DEFAULT_AUTOMATIONS, ...(data.coopConfig?.automations || {}) }, rescoreStages: data.coopConfig?.rescoreStages || [], ...data.coopConfig };

    const DEFAULT_STAGES = [
      { key: 'needs_review', label: "Coop's AI Scoring Queue" },
      { key: 'want_to_apply', label: 'I Want to Apply' },
      { key: 'applied', label: 'Applied' },
      { key: 'intro_requested', label: 'Intro Requested' },
      { key: 'conversations', label: 'Conversations in Progress' },
      { key: 'offer_stage', label: 'Offer Stage' },
      { key: 'accepted', label: 'Accepted' },
      { key: 'rejected', label: "Rejected / DQ'd" },
    ];

    chrome.storage.local.get(['opportunityStages', 'customStages'], stageData => {
      const stages = stageData.opportunityStages || stageData.customStages || DEFAULT_STAGES;
      const selected = cfg.rescoreStages?.length ? cfg.rescoreStages : [];

      const anyEnabled = cfg.automations.rescoreOnProfileChange || cfg.automations.rescoreOnPrefChange || cfg.automations.rescoreOnNewData;
      const container = document.getElementById('auto-rescore-section');
      if (!container) return;

      const triggers = [
        { key: 'rescoreOnProfileChange', label: 'Profile changes', desc: 'Re-score when you update flags, skills, resume, or ICP' },
        { key: 'rescoreOnPrefChange', label: 'Salary / work pref changes', desc: 'Re-score when salary floors or work arrangement change' },
        { key: 'rescoreOnNewData', label: 'New interaction data', desc: 'Re-score when new emails, meetings, or transcripts are added (15s debounce)' },
      ];

      container.innerHTML = `
        <div class="pipeline-subsection">
          <div class="pipeline-sub-title">Auto-rescore triggers</div>
          <div class="pipeline-sub-desc" style="margin-bottom:10px;">All off by default. Each trigger re-scores only opportunities in the selected stages below. Scoring uses ~$0.003–0.007 per entry.</div>
          ${triggers.map(t => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--ci-border-default);">
              <div>
                <div style="font-size:12px;font-weight:500;color:var(--ci-text-primary);">${t.label}</div>
                <div style="font-size:11px;color:var(--ci-text-secondary);">${t.desc}</div>
              </div>
              <label class="pipeline-toggle" style="flex-shrink:0;margin-left:16px;">
                <input type="checkbox" class="rescore-trigger-cb" data-key="${t.key}" ${cfg.automations[t.key] ? 'checked' : ''}>
                <span class="pipeline-toggle-track"></span>
              </label>
            </div>`).join('')}
          <div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:500;color:var(--ci-text-primary);margin-bottom:6px;">Stages to re-score</div>
            <div id="rescore-stage-list" style="display:flex;flex-wrap:wrap;gap:6px;${!anyEnabled ? 'opacity:0.4;pointer-events:none;' : ''}">
              ${stages.filter(s => s.key !== 'rejected').map(s => `
                <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;padding:3px 8px;border:1px solid var(--ci-border-default);border-radius:var(--ci-radius-sm);background:var(--ci-bg-raised);">
                  <input type="checkbox" class="rescore-stage-cb" value="${s.key}" ${selected.includes(s.key) ? 'checked' : ''} style="margin:0;"> ${s.label}
                </label>`).join('')}
            </div>
          </div>
        </div>`;

      const stageList = container.querySelector('#rescore-stage-list');

      function saveCoopConfig() {
        cfg.rescoreStages = [...container.querySelectorAll('.rescore-stage-cb:checked')].map(el => el.value);
        chrome.storage.local.set({ coopConfig: cfg });
        const toast = document.getElementById('pipeline-save-toast');
        if (toast) { toast.style.opacity = '1'; setTimeout(() => toast.style.opacity = '0', 1800); }
        const any = cfg.automations.rescoreOnProfileChange || cfg.automations.rescoreOnPrefChange || cfg.automations.rescoreOnNewData;
        stageList.style.opacity = any ? '1' : '0.4';
        stageList.style.pointerEvents = any ? '' : 'none';
      }

      container.querySelectorAll('.rescore-trigger-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          cfg.automations[cb.dataset.key] = cb.checked;
          saveCoopConfig();
        });
      });

      container.querySelectorAll('.rescore-stage-cb').forEach(cb => {
        cb.addEventListener('change', saveCoopConfig);
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Cost Dashboard (Usage & Costs tab)
// ═══════════════════════════════════════════════════════════════════════════

const COST_OP_LABELS = {
  chat:     'Coop Chat',
  insight:  'Memory Extraction',
  scoring:  'Job Scoring',
  research: 'Company Research',
  search:   'Web Search',
  enrich:   'Data Enrichment',
  profile:  'Profile Processing',
  extract:  'Task Extraction',
  rewrite:  'Writing Assistant',
  scout:    'Company Scout'
};

const COST_OP_COLORS = {
  chat:     '#4573D2',
  insight:  '#7C6EF0',
  scoring:  '#FC636B',
  research: '#F5A623',
  search:   '#3B82F6',
  enrich:   '#36B37E',
  profile:  '#E8384F',
  extract:  '#10B981',
  rewrite:  '#8B5CF6',
  scout:    '#D97706'
};

const COST_PROVIDER_NAMES = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
  serper:    'Serper',
  apollo:    'Apollo',
  granola:   'Granola'
};

const COST_PROVIDER_COLORS = {
  anthropic: '#D97706',
  openai:    '#10A37F',
  serper:    '#3B82F6',
  apollo:    '#6366F1',
  granola:   '#8B5CF6'
};

const COST_PROVIDERS = ['anthropic', 'openai', 'serper', 'apollo', 'granola'];

function costFmt(c) {
  if (c == null || c === 0) return '$0.00';
  return c < 0.01 ? '$' + c.toFixed(4) : '$' + c.toFixed(2);
}

function costFmtLong(c) {
  if (c == null || c === 0) return '$0.000';
  return '$' + c.toFixed(4);
}

function costFmtTokens(t) {
  if (!t) return '0';
  return t > 999 ? (t / 1000).toFixed(1) + 'k' : String(t);
}

function costColorClass(cost) {
  if (cost < 0.25) return 'cost-green';
  if (cost <= 1.00) return 'cost-yellow';
  return 'cost-red';
}

function costBarColor(cost) {
  if (cost < 0.25) return 'var(--ci-accent-teal)';
  if (cost <= 1.00) return 'var(--ci-accent-amber)';
  return 'var(--ci-accent-red)';
}

function costEscapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function costTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadAndRenderCosts() {
  chrome.storage.local.get('apiUsage', d => {
    const usage = d.apiUsage || {};
    renderCostDashboard(usage);
    const note = document.getElementById('cost-refresh-note');
    if (note) note.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
  });
}

function renderCostDashboard(usage) {
  const today = costTodayStr();
  const log = (usage.callLog || []).filter(c => {
    const d = new Date(c.ts).toISOString().slice(0, 10);
    return d === today;
  });

  // Show the date on "today" section headers so the numbers have context
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  document.querySelectorAll('.cost-section-header').forEach(el => {
    if (el.textContent.includes('Operation')) el.textContent = `Breakdown by Operation \u2014 ${todayLabel}`;
    else if (el.textContent.includes('Provider')) el.textContent = `Breakdown by Provider \u2014 ${todayLabel}`;
  });

  renderCostSummary(usage, log);
  renderCostOpBreakdown(log);
  renderCostProviders(usage, log);
  renderCostLog(usage.callLog || []);
  renderCostChart(usage);
}

function renderCostSummary(usage, todayLog) {
  const totalCost = usage.costToday || 0;
  const totalCalls = todayLog.length;

  const sumTotal = document.getElementById('cost-sum-total');
  if (sumTotal) {
    sumTotal.textContent = costFmt(totalCost);
    sumTotal.className = 'cost-summary-card-value ' + costColorClass(totalCost);
  }

  const resetDate = usage.lastDayReset || costTodayStr();
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const totalLabelEl = document.getElementById('cost-sum-total-label');
  if (totalLabelEl) totalLabelEl.textContent = `Today \u2014 ${todayLabel}`;
  const detailEl = document.getElementById('cost-sum-total-detail');
  if (detailEl) detailEl.textContent = totalCalls + ' API calls';

  const callsEl = document.getElementById('cost-sum-calls');
  if (callsEl) callsEl.textContent = totalCalls;
  const providerCounts = {};
  todayLog.forEach(c => { const p = c.provider || 'unknown'; providerCounts[p] = (providerCounts[p] || 0) + 1; });
  const topProvider = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0];
  const callsDetail = document.getElementById('cost-sum-calls-detail');
  if (callsDetail) callsDetail.textContent = topProvider ? `Most active: ${topProvider[0]} (${topProvider[1]})` : '';

  const opCosts = {};
  todayLog.forEach(c => { const op = c.op || 'unknown'; opCosts[op] = (opCosts[op] || 0) + (c.cost || 0); });
  const topOp = Object.entries(opCosts).sort((a, b) => b[1] - a[1])[0];
  const sumExpensive = document.getElementById('cost-sum-expensive');
  const sumExpensiveDetail = document.getElementById('cost-sum-expensive-detail');
  if (sumExpensive) {
    if (topOp && topOp[1] > 0) {
      sumExpensive.textContent = COST_OP_LABELS[topOp[0]] || topOp[0];
      if (sumExpensiveDetail) sumExpensiveDetail.textContent = costFmt(topOp[1]) + ' total';
    } else {
      sumExpensive.textContent = '--';
      if (sumExpensiveDetail) sumExpensiveDetail.textContent = 'No calls today';
    }
  }

  const chatEntries = todayLog.filter(c => c.op === 'chat');
  const avgChat = chatEntries.length > 0
    ? chatEntries.reduce((s, c) => s + (c.cost || 0), 0) / chatEntries.length
    : 0;
  const avgEl = document.getElementById('cost-sum-avg-chat');
  if (avgEl) avgEl.textContent = costFmtLong(avgChat);
  const avgDetail = document.getElementById('cost-sum-avg-chat-detail');
  if (avgDetail) avgDetail.textContent = chatEntries.length + ' chat calls today';
}

function renderCostOpBreakdown(todayLog) {
  const container = document.getElementById('cost-op-rows');
  if (!container) return;

  const ops = {};
  todayLog.forEach(c => { const op = c.op || 'unknown'; if (!ops[op]) ops[op] = { count: 0, cost: 0 }; ops[op].count++; ops[op].cost += (c.cost || 0); });
  const totalCost = todayLog.reduce((s, c) => s + (c.cost || 0), 0);
  const sorted = Object.entries(ops).sort((a, b) => b[1].cost - a[1].cost);

  if (sorted.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ci-text-tertiary);font-size:13px;">No API calls today</div>';
    return;
  }

  container.innerHTML = sorted.map(([op, data]) => {
    const label = COST_OP_LABELS[op] || op;
    const color = COST_OP_COLORS[op] || 'var(--ci-text-tertiary)';
    const pct = totalCost > 0 ? (data.cost / totalCost * 100) : 0;
    const avg = data.count > 0 ? data.cost / data.count : 0;
    return `<div class="cost-op-row">
      <div class="cost-op-name"><span class="cost-op-badge" style="background:${color}"></span>${costEscapeHtml(label)}</div>
      <div class="cost-op-mono">${data.count}</div>
      <div class="cost-op-mono">${costFmt(data.cost)}</div>
      <div class="cost-op-mono">${costFmtLong(avg)}</div>
      <div><div class="cost-op-bar-wrap"><div class="cost-op-bar-fill" style="width:${Math.max(pct, 1)}%;background:${color}"></div></div></div>
    </div>`;
  }).join('');
}

function renderCostProviders(usage, todayLog) {
  const container = document.getElementById('cost-provider-grid');
  if (!container) return;

  const modelsByProvider = {};
  todayLog.forEach(c => {
    const p = c.provider || 'unknown';
    const m = c.model || 'unknown';
    if (!modelsByProvider[p]) modelsByProvider[p] = {};
    if (!modelsByProvider[p][m]) modelsByProvider[p][m] = { count: 0, cost: 0 };
    modelsByProvider[p][m].count++;
    modelsByProvider[p][m].cost += (c.cost || 0);
  });

  container.innerHTML = COST_PROVIDERS.map(key => {
    const pd = usage[key] || {};
    const name = COST_PROVIDER_NAMES[key] || key;
    const color = COST_PROVIDER_COLORS[key] || '#999';
    const cost = pd.costToday || 0;
    const requests = pd.requestsToday || 0;
    const tokensIn = pd.tokensToday?.input || 0;
    const tokensOut = pd.tokensToday?.output || 0;
    const errors = pd.errors || {};

    let modelsHtml = '';
    const models = modelsByProvider[key];
    if (models && Object.keys(models).length > 0) {
      const sorted = Object.entries(models).sort((a, b) => b[1].cost - a[1].cost);
      modelsHtml = `<div class="cost-provider-models">
        <div class="cost-provider-models-title">Models</div>
        ${sorted.map(([m, d]) => `<div class="cost-model-row">
          <span class="cost-model-name">${costEscapeHtml(m)}</span>
          <span class="cost-model-cost">${d.count} calls / ${costFmt(d.cost)}</span>
        </div>`).join('')}
      </div>`;
    }

    let errorHtml = '';
    if ((errors.count429 || 0) > 0) errorHtml += `<div class="cost-provider-error">Rate limited: ${errors.count429} x 429 errors</div>`;
    if ((errors.count401 || 0) > 0) errorHtml += `<div class="cost-provider-error">Auth error: ${errors.count401} x 401 errors</div>`;
    if ((errors.countOther || 0) > 0) errorHtml += `<div class="cost-provider-error">Other errors: ${errors.countOther}</div>`;

    const totalReqs = pd.totalRequests || 0;
    return `<div class="cost-provider-card">
      <div class="cost-provider-name"><span class="cost-provider-dot" style="background:${color}"></span>${costEscapeHtml(name)}</div>
      <div class="cost-provider-stat"><span class="cost-provider-stat-label">Calls today</span><span class="cost-provider-stat-value">${requests}</span></div>
      <div class="cost-provider-stat"><span class="cost-provider-stat-label">Tokens in / out</span><span class="cost-provider-stat-value">${costFmtTokens(tokensIn)} / ${costFmtTokens(tokensOut)}</span></div>
      <div class="cost-provider-stat"><span class="cost-provider-stat-label">Cost today</span><span class="cost-provider-stat-value">${costFmt(cost)}</span></div>
      <div class="cost-provider-stat" style="color:var(--ci-text-tertiary);font-size:12px;"><span class="cost-provider-stat-label">All time</span><span class="cost-provider-stat-value">${totalReqs.toLocaleString()} calls</span></div>
      ${modelsHtml}
      ${errorHtml}
    </div>`;
  }).join('');
}

function renderCostLog(callLog) {
  const container = document.getElementById('cost-log-rows');
  if (!container) return;
  const recent = callLog.slice(-50).reverse();

  if (recent.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ci-text-tertiary);font-size:13px;">No recent activity</div>';
    return;
  }

  container.innerHTML = recent.map(entry => {
    const time = new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = new Date(entry.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const op = entry.op || 'unknown';
    const label = COST_OP_LABELS[op] || op;
    const color = COST_OP_COLORS[op] || '#999';
    return `<div class="cost-log-row">
      <div class="cost-log-time">${date} ${time}</div>
      <div><span class="cost-log-op-tag" style="background:${color}15;color:${color}">${costEscapeHtml(label)}</span></div>
      <div class="cost-log-provider">${costEscapeHtml(entry.provider || '--')}</div>
      <div class="cost-log-model" title="${costEscapeHtml(entry.model || '--')}">${costEscapeHtml(entry.model || '--')}</div>
      <div class="cost-log-tokens">${costFmtTokens(entry.input || 0)} / ${costFmtTokens(entry.output || 0)}</div>
      <div class="cost-log-cost">${costFmt(entry.cost || 0)}</div>
    </div>`;
  }).join('');
}

function renderCostChart(usage) {
  const container = document.getElementById('cost-chart-container');
  if (!container) return;

  const dayMap = {};
  COST_PROVIDERS.forEach(key => {
    const pd = usage[key] || {};
    (pd.dailyHistory || []).forEach(entry => {
      if (!entry.date) return;
      dayMap[entry.date] = (dayMap[entry.date] || 0) + (entry.estimatedCost || 0);
    });
  });

  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    days.push({ date: ds, cost: dayMap[ds] || 0 });
  }

  const todayKey = costTodayStr();
  const todayEntry = days.find(d => d.date === todayKey);
  if (todayEntry && (usage.costToday || 0) > todayEntry.cost) {
    todayEntry.cost = usage.costToday || 0;
  }

  const maxCost = Math.max(...days.map(d => d.cost), 0.01);

  if (maxCost <= 0) {
    container.innerHTML = '<div style="text-align:center;padding:48px 24px;color:var(--ci-text-secondary);font-size:14px;">No cost history yet</div>';
    return;
  }

  const ySteps = 4;
  const yLabels = [];
  for (let i = ySteps; i >= 0; i--) yLabels.push(costFmt(maxCost * i / ySteps));

  const barsHtml = days.map(d => {
    const pct = d.cost > 0 ? Math.max((d.cost / maxCost) * 100, 2) : 0;
    const color = costBarColor(d.cost);
    const dayLabel = d.date.slice(5);
    const isToday = d.date === todayKey;
    return `<div class="cost-chart-bar-wrap">
      <div class="cost-chart-bar" style="height:${pct}%;background:${color};${isToday ? 'outline:2px solid var(--ci-accent-primary);outline-offset:1px;' : ''}">
        <div class="cost-chart-bar-tooltip">${d.date}: ${costFmt(d.cost)}</div>
      </div>
      <div class="cost-chart-label" style="${isToday ? 'font-weight:700;color:var(--ci-text-primary);' : ''}">${dayLabel}</div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="cost-chart-wrapper">
    <div class="cost-chart-y-axis">${yLabels.map(l => `<div class="cost-chart-y-label">${l}</div>`).join('')}</div>
    <div class="cost-chart-bars" style="flex:1;">${barsHtml}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab switching
// ═══════════════════════════════════════════════════════════════════════════

function initTabs() {
  const tabs = document.querySelectorAll('.page-tab');
  const panels = document.querySelectorAll('.tab-panel');
  let costLoaded = false;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));

      if (target === 'usage' && !costLoaded) {
        costLoaded = true;
        loadAndRenderCosts();
      }
    });
  });

  // Auto-select usage tab if URL hash is #usage
  if (location.hash === '#usage') {
    const usageTab = document.querySelector('[data-tab="usage"]');
    if (usageTab) usageTab.click();
  }
}

// ── Boot ──
loadPipelineSettings();
loadUsageDashboard();
initTabs();
// Refresh dashboards every 30s — but only when tab is visible
setInterval(() => {
  if (document.hidden) return;
  loadUsageDashboard();
  // Only refresh cost dashboard if the usage tab is active
  if (document.getElementById('tab-usage')?.classList.contains('active')) {
    loadAndRenderCosts();
  }
}, 30000);
