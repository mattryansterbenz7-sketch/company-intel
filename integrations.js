// integrations.js — provider config + key management UI

const PROVIDERS = [
  // ── AI Engine ──
  {
    id: 'anthropic', name: 'Anthropic (Claude)', category: 'AI Engine',
    description: 'Powers all AI features — company intelligence, job match scoring, chat, and passive learning.',
    storageKey: 'anthropic_key', placeholder: 'sk-ant-api03-...', required: true,
    status: 'active', docsUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'openai', name: 'OpenAI', category: 'AI Engine',
    description: 'Alternative AI engine — powers web search fallback when Serper is exhausted.',
    storageKey: 'openai_key', placeholder: 'sk-...',
    status: 'active', docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini', name: 'Google Gemini', category: 'AI Engine',
    description: 'Ultra-cheap extraction — Flash-Lite is ~20× cheaper than Haiku ($0.05/M input). Used as fallback in the model chain.',
    storageKey: 'gemini_key', placeholder: 'AIza...',
    status: 'active', docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  // ── Company Data & Enrichment ──
  {
    id: 'apollo', name: 'Apollo.io', category: 'Company Data & Enrichment',
    description: 'Company firmographics — employees, funding, industry, founded year, leadership.',
    storageKey: 'apollo_key', placeholder: 'Your Apollo API key',
    status: 'active', docsUrl: 'https://app.apollo.io/',
  },
  {
    id: 'peopledatalabs', name: 'PeopleDataLabs', category: 'Company Data & Enrichment',
    description: 'Person and company enrichment — alternative to Apollo.',
    status: 'planned',
  },
  {
    id: 'clearbit', name: 'Clearbit', category: 'Company Data & Enrichment',
    description: 'Company and contact enrichment.',
    status: 'planned',
  },
  {
    id: 'crunchbase', name: 'Crunchbase', category: 'Company Data & Enrichment',
    description: 'Funding rounds, investors, company financials.',
    status: 'planned',
  },
  // ── Search Providers ──
  {
    id: 'serper', name: 'Serper (Google Search)', category: 'Search Providers',
    description: 'Google search — leadership profiles, reviews, hiring signals, web research.',
    storageKey: 'serper_key', placeholder: 'Your Serper API key',
    status: 'active', docsUrl: 'https://serper.dev/',
  },
  {
    id: 'claude_search', name: 'Claude Web Search', category: 'Search Providers',
    description: 'AI-powered web search via Anthropic — automatic fallback when Serper is exhausted.',
    storageKey: 'anthropic_key', placeholder: 'Your Anthropic API key (same as AI Engine above)',
    sharedWith: 'Anthropic (Claude)',
    status: 'active', docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai_search', name: 'OpenAI Web Search', category: 'Search Providers',
    description: 'Web search via OpenAI — fallback after Claude search.',
    storageKey: 'openai_key', placeholder: 'Your OpenAI API key (same as AI Engine above)',
    sharedWith: 'OpenAI',
    status: 'active', docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google_cse', name: 'Google Custom Search', category: 'Search Providers',
    description: 'Direct Google search — free 100 queries/day, fallback when Serper credits are exhausted.',
    storageKey: 'google_cse_key', placeholder: 'Your Google API key',
    extraFields: [{ key: 'google_cse_cx', label: 'Search Engine ID (CX)', placeholder: 'Your CX ID' }],
    docsUrl: 'https://programmablesearchengine.google.com/',
  },
  {
    id: 'brave', name: 'Brave Search', category: 'Search Providers',
    description: 'Independent search index — privacy-focused alternative.',
    status: 'planned',
  },
  {
    id: 'tavily', name: 'Tavily', category: 'Search Providers',
    description: 'AI-optimized search — pre-processed results for LLMs.',
    status: 'planned',
  },
  // ── Email & Calendar ──
  {
    id: 'gmail', name: 'Gmail', category: 'Email & Calendar',
    description: 'Email threads and known contacts per company.',
    status: 'active', oauth: true,
  },
  {
    id: 'gcal', name: 'Google Calendar', category: 'Email & Calendar',
    description: 'Upcoming meetings with company contacts. Shares Gmail OAuth.',
    status: 'active', oauth: true, sharedWith: 'gmail',
  },
  {
    id: 'outlook', name: 'Outlook / Microsoft 365', category: 'Email & Calendar',
    description: 'Email and calendar for Microsoft users.',
    status: 'planned',
  },
  // ── Meeting Transcripts ──
  {
    id: 'granola', name: 'Granola', category: 'Meeting Transcripts',
    description: 'Meeting notes and full call transcripts. Uses Personal API key (Business plan).',
    storageKey: 'granola_key', placeholder: 'Your Granola Personal API key',
    status: 'active', docsUrl: 'https://granola.ai/settings',
  },
  {
    id: 'otter', name: 'Otter.ai', category: 'Meeting Transcripts',
    description: 'Meeting transcription and notes.',
    status: 'planned',
  },
  {
    id: 'fireflies', name: 'Fireflies.ai', category: 'Meeting Transcripts',
    description: 'Meeting transcription and conversation intelligence.',
    status: 'planned',
  },
  {
    id: 'fathom', name: 'Fathom', category: 'Meeting Transcripts',
    description: 'AI meeting assistant and transcript capture.',
    status: 'planned',
  },
  // ── Communication ──
  {
    id: 'slack', name: 'Slack', category: 'Communication',
    description: 'Track conversations with recruiters and contacts.',
    status: 'planned',
  },
  {
    id: 'linkedin_api', name: 'LinkedIn', category: 'Communication',
    description: 'Profile enrichment and connection data.',
    status: 'planned',
  },
];

// ── Render ──

async function renderIntegrations() {
  const container = document.getElementById('providers-container');
  const { integrations = {}, gmailConnected = false } = await new Promise(r =>
    chrome.storage.local.get(['integrations', 'gmailConnected'], r)
  );
  const keyStatus = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r));
  keyStatus.gmail = !!gmailConnected;
  keyStatus.granola = !!integrations.granola_key;

  // Group by category
  const categories = {};
  PROVIDERS.forEach(p => {
    if (!categories[p.category]) categories[p.category] = [];
    categories[p.category].push(p);
  });

  // Split into two columns
  const leftCats = ['AI Engine', 'Search Providers'];
  const rightCats = ['Company Data & Enrichment', 'Email & Calendar', 'Meeting Transcripts', 'Communication'];

  let leftHtml = '', rightHtml = '';
  for (const [cat, providers] of Object.entries(categories)) {
    const catHtml = `<div class="category-title">${cat}</div>` + providers.map(p => renderProviderCard(p, integrations, keyStatus)).join('');
    if (leftCats.includes(cat)) leftHtml += catHtml;
    else rightHtml += catHtml;
  }

  const leftCol = document.getElementById('providers-left');
  const rightCol = document.getElementById('providers-right');
  if (leftCol) leftCol.innerHTML = leftHtml;
  if (rightCol) rightCol.innerHTML = rightHtml;
  bindEvents(integrations);
}

function renderProviderCard(p, integrations, keyStatus) {
  if (p.status === 'planned') {
    return `<div class="provider-card planned">
      <div class="provider-header">
        <div class="provider-name">${p.name} <span class="badge-planned">Coming soon</span></div>
      </div>
      <div class="provider-desc">${p.description}</div>
    </div>`;
  }

  if (p.status === 'ready') {
    // Ready to activate but not wired up yet
    const hasKey = !!integrations[p.storageKey];
    return `<div class="provider-card">
      <div class="provider-header">
        <div class="provider-name">${p.name} <span class="badge-planned">Ready to activate</span></div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="status-dot ${hasKey ? 'green' : 'grey'}"></span>
          <span class="status-label">${hasKey ? 'Key set' : 'Not configured'}</span>
        </div>
      </div>
      <div class="provider-desc">${p.description}</div>
      <div class="key-row">
        <input class="key-input" type="password" id="key-${p.storageKey}" value="${integrations[p.storageKey] || ''}" placeholder="${p.placeholder || ''}">
        <button class="key-toggle" data-target="key-${p.storageKey}">Show</button>
      </div>
      ${(p.extraFields || []).map(f => `
        <div class="key-row">
          <input class="key-input" type="password" id="key-${f.key}" value="${integrations[f.key] || ''}" placeholder="${f.placeholder || f.label}">
          <button class="key-toggle" data-target="key-${f.key}">Show</button>
        </div>
      `).join('')}
      <div class="provider-actions">
        <button class="btn-save" data-provider="${p.id}">Save</button>
      </div>
    </div>`;
  }

  // OAuth providers (Gmail, Granola, GCal)
  if (p.oauth) {
    return renderOAuthCard(p, keyStatus);
  }

  // API key providers
  const inStorage = !!integrations[p.storageKey];
  const inConfig = !!keyStatus[p.id];
  const hasKey = inStorage || inConfig;
  const isExhausted = keyStatus[p.id + 'Exhausted'];
  let statusDot = 'grey', statusText = 'Not configured';
  if (hasKey && isExhausted) { statusDot = 'yellow'; statusText = 'Credits exhausted'; }
  else if (inStorage) { statusDot = 'green'; statusText = 'Connected'; }
  else if (inConfig) { statusDot = 'green'; statusText = 'Connected (via config)'; }

  const badges = [];
  if (p.required) badges.push('<span class="badge-required">Required</span>');
  const docsLink = p.docsUrl ? `<a href="${p.docsUrl}" target="_blank" style="font-size:11px;color:#FF7A59;text-decoration:none;font-weight:600">Get API key →</a>` : '';

  return `<div class="provider-card">
    <div class="provider-header">
      <div class="provider-name">${p.name} ${badges.join(' ')}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="status-dot ${statusDot}"></span>
        <span class="status-label ${statusDot === 'green' ? 'connected' : statusDot === 'yellow' ? 'exhausted' : ''}">${statusText}</span>
      </div>
    </div>
    <div class="provider-desc">${p.description} ${docsLink}</div>
    ${p.sharedWith ? `<div style="font-size:11px;color:#7c98b6;margin-bottom:8px">🔗 Shares API key with ${p.sharedWith} — enter it here or in AI Engine above</div>` : ''}
    <div class="key-row">
      <input class="key-input" type="password" id="key-${p.id}" data-storage-key="${p.storageKey}" value="${integrations[p.storageKey] || ''}" placeholder="${hasKey && !integrations[p.storageKey] ? 'Set via config.js (override here)' : p.placeholder || ''}">
      <button class="key-toggle" data-target="key-${p.id}">Show</button>
    </div>
    <div class="provider-actions">
      <button class="btn-save" data-provider="${p.id}">Save</button>
      <button class="btn-test" data-provider="${p.id}" ${!hasKey && !integrations[p.storageKey] ? 'disabled' : ''}>Test Connection</button>
      <span class="test-result" id="test-${p.id}"></span>
    </div>
  </div>`;
}

function renderOAuthCard(p, keyStatus) {
  if (p.sharedWith) {
    // GCal shares Gmail OAuth — just show status
    return `<div class="provider-card">
      <div class="provider-header">
        <div class="provider-name">${p.name}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="status-dot ${keyStatus.gmail ? 'green' : 'grey'}"></span>
          <span class="status-label ${keyStatus.gmail ? 'connected' : ''}">${keyStatus.gmail ? 'Connected via Gmail' : 'Connect Gmail first'}</span>
        </div>
      </div>
      <div class="provider-desc">${p.description}</div>
    </div>`;
  }

  if (p.id === 'gmail') {
    return `<div class="provider-card">
      <div class="provider-header">
        <div class="provider-name">${p.name}</div>
        <div class="oauth-status" id="gmail-status-row">
          <span class="status-dot grey" id="gmail-dot"></span>
          <span class="status-label" id="gmail-status-text">Checking...</span>
        </div>
      </div>
      <div class="provider-desc">${p.description}</div>
      <div class="provider-actions">
        <button class="oauth-btn oauth-connect" id="gmail-connect-btn">Connect Gmail</button>
        <button class="oauth-btn oauth-disconnect" id="gmail-disconnect-btn" style="display:none">Disconnect</button>
      </div>
      <div class="oauth-note">Uses Chrome's built-in OAuth. Read-only access. No password stored.</div>
    </div>`;
  }

  if (p.id === 'granola') {
    return `<div class="provider-card">
      <div class="provider-header">
        <div class="provider-name">${p.name}</div>
        <div class="oauth-status" id="granola-status-row">
          <span class="status-dot grey" id="granola-dot"></span>
          <span class="status-label" id="granola-status-text">Checking...</span>
        </div>
      </div>
      <div class="provider-desc">${p.description}</div>
      <div class="provider-actions">
        <button class="oauth-btn oauth-connect" id="granola-connect-btn">Connect Granola</button>
        <button class="oauth-btn oauth-disconnect" id="granola-disconnect-btn" style="display:none">Disconnect</button>
      </div>
    </div>`;
  }

  return '';
}

// ── Events ──

function bindEvents(integrations) {
  // Show/hide key toggle
  document.querySelectorAll('.key-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? 'Hide' : 'Show';
    });
  });

  // Save buttons
  document.querySelectorAll('.btn-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provider = PROVIDERS.find(p => p.id === btn.dataset.provider);
      if (!provider) return;
      const { integrations: current = {} } = await new Promise(r => chrome.storage.local.get(['integrations'], r));
      if (provider.storageKey) {
        const input = document.getElementById('key-' + provider.id) || document.getElementById('key-' + provider.storageKey);
        if (input) current[provider.storageKey] = input.value.trim();
      }
      if (provider.extraFields) {
        provider.extraFields.forEach(f => {
          const input = document.getElementById('key-' + f.key);
          if (input) current[f.key] = input.value.trim();
        });
      }
      chrome.storage.local.set({ integrations: current }, () => {
        btn.textContent = '✓ Saved';
        setTimeout(() => { btn.textContent = 'Save'; renderIntegrations(); }, 1500);
      });
    });
  });

  // Test buttons
  document.querySelectorAll('.btn-test').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provider = PROVIDERS.find(p => p.id === btn.dataset.provider);
      if (!provider?.storageKey) return;
      const input = document.getElementById('key-' + provider.id) || document.getElementById('key-' + provider.storageKey);
      let key = input?.value?.trim();
      // If input is empty, test the currently active key (from config.js or storage)
      if (!key) {
        const activeKey = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r));
        if (!activeKey?.[provider.id]) {
          const resultEl = document.getElementById('test-' + provider.id);
          resultEl.textContent = 'No key to test';
          resultEl.className = 'test-result fail';
          setTimeout(() => { resultEl.textContent = ''; }, 3000);
          return;
        }
        // Use a sentinel to tell background to test with the active in-memory key
        key = '__USE_ACTIVE_KEY__';
      }
      const resultEl = document.getElementById('test-' + provider.id);
      btn.disabled = true;
      btn.textContent = 'Testing...';
      const result = await new Promise(r => chrome.runtime.sendMessage({ type: 'TEST_API_KEY', provider: provider.id, key }, r));
      btn.disabled = false;
      btn.textContent = 'Test Connection';
      if (result?.ok) {
        resultEl.textContent = '✓ Connected';
        resultEl.className = 'test-result ok';
        if (provider.id === 'granola') chrome.runtime.sendMessage({ type: 'GRANOLA_BUILD_INDEX' });
      } else if (result?.reason) {
        // Distinguish between auth failures and credit/billing issues
        const isCredits = /credit|billing|rate/i.test(result.reason);
        resultEl.textContent = isCredits ? `⚠ ${result.reason}` : `✗ ${result.reason}`;
        resultEl.className = isCredits ? 'test-result warn' : 'test-result fail';
      } else {
        resultEl.textContent = `✗ Failed (${result?.status || result?.error || 'unknown'})`;
        resultEl.className = 'test-result fail';
      }
      setTimeout(() => { resultEl.textContent = ''; }, 5000);
    });
  });

  // Gmail OAuth
  initGmailOAuth();
  // Granola is now API key-based — no OAuth init needed
}

// ── Gmail OAuth (moved from preferences.js pattern) ──

function initGmailOAuth() {
  const connectBtn = document.getElementById('gmail-connect-btn');
  const disconnBtn = document.getElementById('gmail-disconnect-btn');
  const dot = document.getElementById('gmail-dot');
  const text = document.getElementById('gmail-status-text');
  if (!connectBtn) return;

  function setConnected(yes) {
    dot.className = 'status-dot ' + (yes ? 'green' : 'grey');
    text.textContent = yes ? 'Connected' : 'Not connected';
    text.className = 'status-label' + (yes ? ' connected' : '');
    connectBtn.style.display = yes ? 'none' : '';
    disconnBtn.style.display = yes ? '' : 'none';
  }

  // Check current state
  chrome.storage.local.get(['gmailConnected'], ({ gmailConnected }) => {
    setConnected(!!gmailConnected);
  });

  connectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GMAIL_AUTH' }, result => {
      void chrome.runtime.lastError;
      if (result?.token) setConnected(true);
      else text.textContent = 'Connection failed';
    });
  });

  disconnBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GMAIL_REVOKE' }, () => {
      void chrome.runtime.lastError;
      setConnected(false);
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// Data Pipeline Configuration
// ═══════════════════════════════════════════════════════════════════════════

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
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini Flash-Lite' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'gemini-2.0-flash', label: 'Gemini Flash' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

const AI_MODEL_DEFAULTS = {
  companyIntelligence: 'claude-haiku-4-5-20251001',
  firmographicExtraction: 'claude-haiku-4-5-20251001',
  quickFitScoring: 'claude-haiku-4-5-20251001',
  nextStepExtraction: 'claude-haiku-4-5-20251001',
  chat: 'claude-sonnet-4-6',
};

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

let _pipelineConfig = null;
let _pipelineKeyStatus = null;

function savePipelineConfig(config) {
  _pipelineConfig = config;
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

function pipelineStatusDot(providerId, keyStatus) {
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
        ${pipelineStatusDot(item.id, keyStatus)}
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
        ${pipelineStatusDot(item.id, keyStatus)}
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

function buildModelDropdown(taskKey, models) {
  const current = models[taskKey] || AI_MODEL_DEFAULTS[taskKey] || AI_MODEL_OPTIONS[0].value;
  return AI_MODEL_OPTIONS.map(o =>
    `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`
  ).join('');
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
    const dot = providerId && keyStatus ? pipelineStatusDot(providerId, keyStatus).replace(/<span class="status-label">.*?<\/span>/, '') : '';
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

// ── Drag-to-reorder helper ──
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
      loadPipelineConfig();
    });
  });
}

// ── Main pipeline config loader ──
async function loadPipelineConfig() {
  const config = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_PIPELINE_CONFIG' }, r));
  const keyStatus = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r));
  if (!config) return;
  _pipelineConfig = config;
  _pipelineKeyStatus = keyStatus;

  const body = document.getElementById('pipeline-config-body');
  if (!body) return;

  body.innerHTML =
    renderEnrichmentOrder(config, keyStatus) +
    renderSearchChain(config, keyStatus) +
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

  // ── All model dropdowns (Pipeline Overview) ──
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

// ── Pipeline section collapsible toggle ──
function initPipelineCollapse() {
  const header = document.getElementById('pipeline-config-header');
  const body = document.getElementById('pipeline-config-body');
  if (!header || !body) return;

  header.addEventListener('click', () => {
    const collapsed = header.classList.toggle('collapsed');
    body.classList.toggle('hidden', collapsed);
    // Load pipeline config on first expand
    if (!collapsed && !_pipelineConfig) {
      loadPipelineConfig();
    }
  });
}

// ── Boot ──
renderIntegrations();
initPipelineCollapse();
