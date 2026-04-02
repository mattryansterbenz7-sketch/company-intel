// pipeline.js — pipeline settings UI (moved from integrations.js)

const ENRICHMENT_META = {
  apollo: { name: 'Apollo', desc: 'Company firmographics from Apollo.io' },
  webResearch: { name: 'Web Research', desc: 'Search + AI extraction from web results' },
};

const SEARCH_META = {
  serper: { name: 'Serper', desc: 'Google Search via Serper', cost: 'cheap' },
  google_cse: { name: 'Google CSE', desc: 'Google Custom Search (free tier)', cost: 'cheap' },
  openai: { name: 'OpenAI Search', desc: 'Web search via OpenAI', cost: 'expensive' },
  claude: { name: 'Claude Search', desc: 'Web search via Anthropic', cost: 'expensive' },
};

const AI_MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
];

const AI_MODEL_TASKS = [
  { key: 'companyIntelligence', label: 'Company Intelligence', desc: 'Research synthesis' },
  { key: 'firmographicExtraction', label: 'Firmographic Extraction', desc: 'Web data parsing' },
  { key: 'jobMatchScoring', label: 'Job Match Scoring', desc: 'Job fit analysis' },
  { key: 'deepFitAnalysis', label: 'Deep Fit Analysis', desc: 'Detailed opportunity review' },
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

function savePipelineConfig(config) {
  chrome.runtime.sendMessage({ type: 'SET_PIPELINE_CONFIG', config });
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

function renderAIModels(config) {
  const models = config.aiModels || {};
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">AI Models</div>';
  html += '<div class="pipeline-sub-desc">Choose which model handles each task.</div>';
  html += '<div class="pipeline-counts-grid">';
  AI_MODEL_TASKS.forEach(task => {
    const current = models[task.key] || AI_MODEL_OPTIONS[0].value;
    const options = AI_MODEL_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    html += `<div class="pipeline-count-row">
      <div><div class="pipeline-count-label" style="font-weight:600">${task.label}</div><div style="font-size:10px;color:#7c98b6">${task.desc}</div></div>
      <select class="pipeline-model-select" data-model-key="${task.key}">${options}</select>
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
      loadPipelineSettings(); // re-render
    });
  });
}

async function loadPipelineSettings() {
  const config = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_PIPELINE_CONFIG' }, r));
  const keyStatus = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r));
  if (!config) return;

  const body = document.getElementById('pipeline-body');
  if (!body) return;

  body.innerHTML =
    renderEnrichmentOrder(config, keyStatus) +
    renderSearchChain(config, keyStatus) +
    renderAIModels(config) +
    renderSearchCounts(config);

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

  // ── Model dropdowns ──
  body.querySelectorAll('[data-model-key]').forEach(select => {
    select.addEventListener('change', () => {
      if (!config.aiModels) config.aiModels = {};
      config.aiModels[select.dataset.modelKey] = select.value;
      savePipelineConfig(config);
    });
  });

  // ── Stepper buttons ──
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

  // ── Drag-to-reorder (enrichment) ──
  setupDragReorder('enrichment-list', config.enrichmentOrder, 'enrichment', config);
  // ── Drag-to-reorder (search) ──
  setupDragReorder('search-chain-list', config.searchFallbackOrder, 'search', config);
}

// ── Boot ──
loadPipelineSettings();
