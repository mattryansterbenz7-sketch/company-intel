// integrations.js — registry-driven provider config + key management UI
// INTEGRATION_REGISTRY and checkIntegrationGate() are defined in integrations-registry.js,
// loaded before this file via <script> in integrations.html.

// ── SVG check / x icons for test results ──
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="display:inline-block;vertical-align:middle"><path d="M2.5 6.5L5 9l4.5-5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_X    = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="display:inline-block;vertical-align:middle"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_WARN = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="display:inline-block;vertical-align:middle"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M6 4v2.5M6 8.2v.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// ── Render ──

async function renderIntegrations() {
  const { integrations = {}, gmailConnected = false } = await new Promise(r =>
    chrome.storage.local.get(['integrations', 'gmailConnected'], r)
  );
  const keyStatus = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r));

  // Build a flat configuredKeys map: { providerId: boolean }
  const configuredKeys = buildConfiguredKeys(integrations, keyStatus, gmailConnected);

  // Render gate banner
  renderGateBanner(configuredKeys);

  // Split registry into tiers
  const required    = INTEGRATION_REGISTRY.filter(p => p.tier === 'required');
  const recommended = INTEGRATION_REGISTRY.filter(p => p.tier === 'recommended');
  const deprecated  = INTEGRATION_REGISTRY.filter(p => p.tier === 'deprecated');

  // Required: group by REQUIRED_GROUPS order, render sub-headers
  document.getElementById('required-cards').innerHTML =
    renderRequiredTier(required, integrations, keyStatus, gmailConnected, configuredKeys);

  document.getElementById('recommended-cards').innerHTML =
    recommended.map(p => renderProviderCard(p, integrations, keyStatus, gmailConnected)).join('');

  document.getElementById('deprecated-cards').innerHTML =
    deprecated.map(p => renderDeprecatedCard(p, integrations, keyStatus)).join('');

  bindEvents(integrations);
}

// Build a { providerId: boolean } map from storage + keyStatus
function buildConfiguredKeys(integrations, keyStatus, gmailConnected) {
  const map = {};
  for (const p of INTEGRATION_REGISTRY) {
    if (p.oauth) {
      if (p.id === 'gmail') {
        map[p.id] = !!gmailConnected;
      } else if (p.id === 'gcal') {
        // GCal shares Gmail OAuth
        map[p.id] = !!gmailConnected;
      } else {
        map[p.id] = false;
      }
    } else if (p.storageKey) {
      const inStorage = !!integrations[p.storageKey];
      const inConfig  = !!(keyStatus && keyStatus[p.id]);
      map[p.id] = inStorage || inConfig;
    } else {
      map[p.id] = false;
    }
  }
  return map;
}

function renderGateBanner(configuredKeys) {
  const gate   = checkIntegrationGate(configuredKeys);
  const banner = document.getElementById('gate-banner');
  if (!banner) return;

  if (gate.satisfied) {
    banner.className = 'gate-banner satisfied';
    banner.style.display = 'flex';
    banner.innerHTML = `
      <span class="gate-dot satisfied"></span>
      <div>
        <div class="gate-banner-text"><b>All required integrations connected.</b> Coop is ready to research and score.</div>
        ${gate.recommendedMissing.length ? `<div class="gate-banner-sub">${gate.recommendedMissing.length} recommended integration${gate.recommendedMissing.length > 1 ? 's' : ''} not connected — add them to enhance Coop's context.</div>` : ''}
      </div>`;
  } else {
    const labels = gate.missingGroups.map(g => {
      const found = REQUIRED_GROUPS.find(r => r.group === g);
      return found ? found.label.split(' · ')[0] : g;
    });
    banner.className = 'gate-banner missing';
    banner.style.display = 'flex';
    banner.innerHTML = `
      <span class="gate-dot missing"></span>
      <div>
        <div class="gate-banner-text"><b>Missing required integrations:</b> ${labels.join(', ')}.</div>
        <div class="gate-banner-sub">Connect the highlighted groups below to unlock full Coop functionality.</div>
      </div>`;
  }
}

function renderRequiredTier(providers, integrations, keyStatus, gmailConnected, configuredKeys) {
  let html = '';
  const gate = checkIntegrationGate(configuredKeys);

  for (const { group, label } of REQUIRED_GROUPS) {
    const members = providers.filter(p => p.group === group);
    if (!members.length) continue;
    const groupSatisfied = !gate.missingGroups.includes(group);
    const subHeadStyle   = groupSatisfied ? '' : 'color:var(--ci-accent-primary);';
    html += `<div class="group-subhead" style="${subHeadStyle}">${label}</div>`;
    html += members.map(p => renderProviderCard(p, integrations, keyStatus, gmailConnected)).join('');
  }
  return html;
}

// ── Per-card rendering ──

function renderProviderCard(p, integrations, keyStatus, gmailConnected) {
  if (p.oauth) return renderOAuthCard(p, keyStatus, gmailConnected);

  const inStorage  = !!integrations[p.storageKey];
  const inConfig   = !!(keyStatus && keyStatus[p.id]);
  const hasKey     = inStorage || inConfig;
  const isExhausted = keyStatus && keyStatus[p.id + 'Exhausted'];

  let statusClass = 's-none', statusText = 'Not connected';
  if (hasKey && isExhausted) { statusClass = 's-exhausted'; statusText = 'Credits exhausted'; }
  else if (inStorage)        { statusClass = 's-connected'; statusText = 'Connected'; }
  else if (inConfig)         { statusClass = 's-connected'; statusText = 'Connected (via config)'; }

  const chipClass  = `chip-${p.tier}`;
  const chipLabel  = p.tier.charAt(0).toUpperCase() + p.tier.slice(1);
  const docsLink   = p.docsUrl ? `<a href="${p.docsUrl}" target="_blank">Get a key →</a>` : '';
  const nameClass  = p.tier === 'deprecated' ? 'prov-name deprecated-name' : 'prov-name';

  const hasKeyForTest = hasKey || inStorage;
  const currentVal = integrations[p.storageKey] || '';
  const placeholder = hasKey && !inStorage ? 'Set via config.js (override here)' : (p.placeholder || '');

  return `<div class="provider-card">
    <div class="prov-logo ${p.logoClass || ''}">${p.logoText || ''}</div>
    <div class="prov-main">
      <div class="prov-head">
        <span class="${nameClass}">${p.name}</span>
        <span class="tier-chip ${chipClass}">${chipLabel}</span>
      </div>
      <p class="prov-desc">${p.description}</p>
      <div class="prov-meta">
        ${docsLink}
        ${p.costHint ? `<span class="cost">${p.costHint}</span>` : ''}
      </div>
      <div class="key-row">
        <input class="key-input" type="password" id="key-${p.id}" data-storage-key="${p.storageKey}"
          value="${currentVal}" placeholder="${placeholder}">
        <button class="btn btn-ghost key-toggle-btn" data-target="key-${p.id}">Show</button>
      </div>
      <div class="actions-row">
        <button class="btn btn-primary btn-save" data-provider="${p.id}">Save</button>
        <button class="btn btn-test" data-provider="${p.id}" ${!hasKeyForTest && !currentVal ? 'disabled' : ''}>Test</button>
        <span class="test-result" id="test-${p.id}"></span>
      </div>
    </div>
    <span class="prov-status ${statusClass}"><span class="dot"></span>${statusText}</span>
  </div>`;
}

function renderOAuthCard(p, keyStatus, gmailConnected) {
  if (p.id === 'gcal') {
    // Google Calendar shares Gmail OAuth
    const connected = !!gmailConnected;
    const statusClass = connected ? 's-connected' : 's-none';
    const statusText  = connected ? 'Connected via Gmail' : 'Connect Gmail first';
    const scopeItems  = (p.scopes || []).map(s => `<li>${s}</li>`).join('');
    return `<div class="provider-card">
      <div class="prov-logo ${p.logoClass || ''}">${p.logoText || ''}</div>
      <div class="prov-main">
        <div class="prov-head">
          <span class="prov-name">${p.name}</span>
          <span class="tier-chip chip-required">Required</span>
        </div>
        <p class="prov-desc">${p.description}</p>
        <div class="prov-meta">${p.costHint ? `<span>${p.costHint}</span>` : ''}</div>
        ${scopeItems.length ? `<ul class="scope-list">${scopeItems}</ul>` : ''}
      </div>
      <span class="prov-status ${statusClass}"><span class="dot"></span>${statusText}</span>
    </div>`;
  }

  if (p.id === 'gmail') {
    const connected  = !!gmailConnected;
    const statusClass = connected ? 's-connected' : 's-none';
    const statusText  = connected ? 'Connected' : 'Not connected';
    const scopeItems  = (p.scopes || []).map(s => `<li>${s}</li>`).join('');
    return `<div class="provider-card">
      <div class="prov-logo ${p.logoClass || ''}">${p.logoText || ''}</div>
      <div class="prov-main">
        <div class="prov-head">
          <span class="prov-name">${p.name}</span>
          <span class="tier-chip chip-required">Required</span>
        </div>
        <p class="prov-desc">${p.description}</p>
        <div class="prov-meta">${p.costHint ? `<span>${p.costHint}</span>` : ''}</div>
        <div class="actions-row" id="gmail-actions">
          <button class="btn btn-oauth" id="gmail-connect-btn" ${connected ? 'style="display:none"' : ''}>
            <span style="width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#EA4335,#FBBC05);display:inline-block;flex-shrink:0;"></span>
            Connect Google account
          </button>
          <button class="btn btn-disconnect" id="gmail-disconnect-btn" ${!connected ? 'style="display:none"' : ''}>Disconnect</button>
          <span id="gmail-status-inline" style="font-size:12px;color:var(--ci-text-tertiary)"></span>
        </div>
        ${scopeItems.length ? `<ul class="scope-list">${scopeItems}</ul>` : ''}
        <div class="oauth-note">Uses Chrome's built-in OAuth. Read-only access. No password stored.</div>
      </div>
      <span class="prov-status ${statusClass}" id="gmail-status-pill"><span class="dot"></span><span id="gmail-status-text">${statusText}</span></span>
    </div>`;
  }

  return '';
}

function renderDeprecatedCard(p, integrations, keyStatus) {
  const currentVal = integrations[p.storageKey] || '';
  return `<div class="provider-card">
    <div class="prov-logo ${p.logoClass || ''}">${p.logoText || ''}</div>
    <div class="prov-main">
      <div class="prov-head">
        <span class="prov-name deprecated-name">${p.name}</span>
        <span class="tier-chip chip-deprecated">Deprecated</span>
      </div>
      <p class="prov-desc">${p.description}</p>
      <div class="prov-meta">
        ${p.docsUrl ? `<a href="${p.docsUrl}" target="_blank">Get a key →</a>` : ''}
        ${p.costHint ? `<span>${p.costHint}</span>` : ''}
      </div>
      <div class="key-row">
        <input class="key-input" type="password" id="key-${p.id}" data-storage-key="${p.storageKey}"
          value="${currentVal}" placeholder="${p.placeholder || ''}">
        <button class="btn btn-ghost key-toggle-btn" data-target="key-${p.id}">Show</button>
      </div>
      <div class="actions-row">
        <button class="btn btn-ghost btn-save" data-provider="${p.id}">Save</button>
        <span class="test-result" id="test-${p.id}"></span>
      </div>
      ${p.deprecationNote ? `<div class="dep-warning"><b>Heads up:</b> ${p.deprecationNote}</div>` : ''}
    </div>
    <span class="prov-status s-none"><span class="dot"></span>Not connected</span>
  </div>`;
}

// ── Events ──

function bindEvents(integrations) {
  // Show/hide key toggle
  document.querySelectorAll('.key-toggle-btn').forEach(btn => {
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
      const provider = INTEGRATION_REGISTRY.find(p => p.id === btn.dataset.provider);
      if (!provider) return;
      const { integrations: current = {} } = await new Promise(r =>
        chrome.storage.local.get(['integrations'], r)
      );
      if (provider.storageKey) {
        const input = document.getElementById('key-' + provider.id);
        if (input) current[provider.storageKey] = input.value.trim();
      }
      chrome.storage.local.set({ integrations: current }, () => {
        const orig = btn.textContent;
        btn.textContent = 'Saved';
        setTimeout(() => { btn.textContent = orig; renderIntegrations(); }, 1500);
      });
    });
  });

  // Test buttons
  document.querySelectorAll('.btn-test').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provider = INTEGRATION_REGISTRY.find(p => p.id === btn.dataset.provider);
      if (!provider?.storageKey) return;
      const input = document.getElementById('key-' + provider.id);
      let key = input?.value?.trim();
      if (!key) {
        const activeKey = await new Promise(r =>
          chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, r)
        );
        if (!activeKey?.[provider.id]) {
          const resultEl = document.getElementById('test-' + provider.id);
          if (resultEl) {
            resultEl.innerHTML = `${ICON_X} No key to test`;
            resultEl.className = 'test-result fail';
            setTimeout(() => { resultEl.textContent = ''; resultEl.className = 'test-result'; }, 3000);
          }
          return;
        }
        key = '__USE_ACTIVE_KEY__';
      }
      const resultEl = document.getElementById('test-' + provider.id);
      btn.disabled = true;
      btn.textContent = 'Testing…';
      const result = await new Promise(r =>
        chrome.runtime.sendMessage({ type: 'TEST_API_KEY', provider: provider.id, key }, r)
      );
      btn.disabled = false;
      btn.textContent = 'Test';
      if (!resultEl) return;
      if (result?.ok) {
        resultEl.innerHTML = `${ICON_CHECK} Connected`;
        resultEl.className = 'test-result ok';
        if (provider.id === 'granola') chrome.runtime.sendMessage({ type: 'GRANOLA_BUILD_INDEX' });
      } else if (result?.reason) {
        const isCredits = /credit|billing|rate/i.test(result.reason);
        resultEl.innerHTML = isCredits ? `${ICON_WARN} ${result.reason}` : `${ICON_X} ${result.reason}`;
        resultEl.className = isCredits ? 'test-result warn' : 'test-result fail';
      } else {
        resultEl.innerHTML = `${ICON_X} Failed (${result?.status || result?.error || 'unknown'})`;
        resultEl.className = 'test-result fail';
      }
      setTimeout(() => { resultEl.textContent = ''; resultEl.className = 'test-result'; }, 5000);
    });
  });

  // Gmail OAuth
  initGmailOAuth();
}

// ── Gmail OAuth ──

function initGmailOAuth() {
  const connectBtn  = document.getElementById('gmail-connect-btn');
  const disconnBtn  = document.getElementById('gmail-disconnect-btn');
  const statusPill  = document.getElementById('gmail-status-pill');
  const statusText  = document.getElementById('gmail-status-text');
  const statusInline = document.getElementById('gmail-status-inline');
  if (!connectBtn) return;

  function setConnected(yes) {
    if (statusPill) statusPill.className = 'prov-status ' + (yes ? 's-connected' : 's-none');
    if (statusText) statusText.textContent = yes ? 'Connected' : 'Not connected';
    connectBtn.style.display = yes ? 'none' : '';
    disconnBtn.style.display = yes ? '' : 'none';
    if (statusInline) statusInline.textContent = '';
  }

  chrome.storage.local.get(['gmailConnected'], ({ gmailConnected }) => {
    setConnected(!!gmailConnected);
  });

  connectBtn.addEventListener('click', () => {
    if (statusInline) statusInline.textContent = 'Connecting…';
    chrome.runtime.sendMessage({ type: 'GMAIL_AUTH' }, result => {
      void chrome.runtime.lastError;
      if (result?.token) { setConnected(true); }
      else { if (statusInline) statusInline.textContent = 'Connection failed'; }
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
// Data Pipeline Configuration (unchanged from prior implementation)
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
  chrome.runtime.sendMessage({ type: 'SET_PIPELINE_CONFIG', config }, () => {
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
  if (providerId === 'webResearch') {
    const healthy = keyStatus.anthropic && (keyStatus.serper || keyStatus.google_cse || keyStatus.openai);
    return healthy
      ? '<span class="status-dot healthy"></span><span class="status-label">healthy</span>'
      : '<span class="status-dot nokey"></span><span class="status-label">no key</span>';
  }
  if (!keyField) return '';
  const hasKey = keyStatus[keyField];
  if (!hasKey) return '<span class="status-dot nokey"></span><span class="status-label">no key</span>';
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
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Auto-research on sidebar open</div>
      <div style="font-size:10px;color:var(--ci-text-tertiary)">When disabled, full research only runs when you click the Research button.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="scoring-auto-research" ${scoring.autoResearch ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Company scout on quick score</div>
      <div style="font-size:10px;color:var(--ci-text-tertiary)">Runs 1 lightweight search when scoring a job so the AI has real company context. Costs 1 Serper credit per new company, cached after first fetch.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="scoring-scout-enabled" ${scoring.scoutEnabled ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Scout results per search</div>
      <div style="font-size:10px;color:var(--ci-text-tertiary)">More results = richer context for scoring, but larger prompt.</div>
    </div>
    <div class="pipeline-stepper">
      <button data-scout-count-dir="-1">-</button>
      <span id="scout-count-val">${scoring.scoutResultCount || 3}</span>
      <button data-scout-count-dir="1">+</button>
    </div>
  </div>`;
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
  html += `<div class="pipeline-count-row" style="margin-bottom:10px">
    <div><div class="pipeline-count-label" style="font-weight:600">Max leader photos per company</div><div style="font-size:10px;color:var(--ci-text-tertiary)">Photos fetched per company research. Set to 0 for initials only.</div></div>
    <div class="pipeline-stepper">
      <button data-photo-max-dir="-1">-</button>
      <span id="photo-max-val">${photos.maxPerCompany ?? 3}</span>
      <button data-photo-max-dir="1">+</button>
    </div>
  </div>`;
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
      <div class="pipeline-status"><span class="pipeline-cost ${costClass}">${costLabel}</span></div>
    </div>`;
  });
  html += '</div></div>';
  html += '<div style="margin-bottom:10px"><div class="pipeline-count-label" style="font-weight:600;margin-bottom:4px">Fetch photos for</div>';
  html += '<div class="photo-scope-radios">';
  PHOTO_SCOPE_OPTIONS.forEach(opt => {
    html += `<label class="photo-scope-label">
      <input type="radio" name="photo-scope" value="${opt.value}" ${photos.fetchScope === opt.value ? 'checked' : ''}> ${opt.label}
    </label>`;
  });
  html += '</div></div>';
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

  function overviewDropdown(taskKey) {
    return `<select class="pipeline-overview-select" data-model-key="${taskKey}">${buildModelDropdown(taskKey, models)}</select>`;
  }
  function pill(label, providerId) {
    const dot = providerId && keyStatus ? pipelineStatusDot(providerId, keyStatus).replace(/<span class="status-label">.*?<\/span>/, '') : '';
    return `<span class="flow-pill">${dot}${label}</span>`;
  }
  const arrow = '<span class="flow-arrow">&rarr;</span>';

  html += '<div class="flow-row"><span class="flow-label">On research:</span><div class="flow-chain">';
  const enrichPills = enrichOrder.map(p => pill(ENRICHMENT_META[p.id]?.name || p.id, p.id)).join(arrow);
  html += enrichPills + arrow;
  html += pill(`Scout &times;${counts.reviewScout || 3}`) + arrow;
  html += pill(`Drills 0-${counts.reviewDrill || 2}`) + arrow;
  html += pill(`Parallel &times;3`) + arrow;
  html += overviewDropdown('companyIntelligence');
  html += '</div></div>';

  const scoring = config.scoring || {};
  const scoutPill = scoring.scoutEnabled !== false
    ? pill(`Scout &times;${scoring.scoutResultCount || 3}`, 'serper') + arrow
    : '';
  html += `<div class="flow-row"><span class="flow-label">On save:</span><div class="flow-chain">
    ${scoutPill}${pill('Quick score')} ${arrow} ${overviewDropdown('quickFitScoring')}
  </div></div>`;
  html += `<div class="flow-row"><span class="flow-label">On refresh:</span><div class="flow-chain">
    ${scoutPill}${pill('Re-score')} ${arrow} ${overviewDropdown('quickFitScoring')}
  </div></div>`;
  html += `<div class="flow-row"><span class="flow-label">On chat:</span><div class="flow-chain">
    ${pill('Chat')} ${arrow} ${overviewDropdown('chat')}
  </div></div>`;

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
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Enable fallback</div>
      <div style="font-size:10px;color:var(--ci-text-tertiary)">If disabled, Coop will show an error instead of trying another model.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-enabled" ${fb.enabled ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Allow expensive fallback models</div>
      <div style="font-size:10px;color:var(--ci-text-tertiary)">When OFF, fallback is limited to cheap models (Haiku, GPT-4.1 Mini). When ON, Sonnet and GPT-4.1 are also available as fallbacks.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-allow-expensive" ${fb.allowExpensive ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;
  html += `<div class="pipeline-count-row">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Show fallback indicator in chat</div>
      <div style="font-size:10px;color:var(--ci-text-tertiary)">Display a notice when Coop used a different model than your selected one.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-show-indicator" ${fb.showIndicator ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;
  const cheapModels = ['Haiku ($1/$5 per MTok)', 'GPT-4.1 Mini ($0.40/$1.60 per MTok)'];
  const expensiveModels = ['Sonnet ($3/$15 per MTok)', 'GPT-4.1 ($2/$8 per MTok)'];
  html += `<div style="margin-top:10px;padding:10px 12px;background:var(--ci-bg-inset);border-radius:8px;font-size:11px;color:var(--ci-text-tertiary)">
    <div style="font-weight:600;margin-bottom:4px;color:var(--ci-text-primary)">Current fallback order:</div>
    <div>Your selected model → ${cheapModels.join(' → ')}${fb.allowExpensive ? ' → ' + expensiveModels.join(' → ') : ''}</div>
    ${!fb.enabled ? '<div style="color:var(--ci-accent-red);margin-top:4px;font-weight:600">Fallback disabled — errors will surface directly.</div>' : ''}
  </div>`;
  html += '</div>';
  return html;
}

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
        if (toast) { toast.style.opacity = '1'; setTimeout(() => { toast.style.opacity = '0'; }, 1800); }
        const any = cfg.automations.rescoreOnProfileChange || cfg.automations.rescoreOnPrefChange || cfg.automations.rescoreOnNewData;
        stageList.style.opacity = any ? '1' : '0.4';
        stageList.style.pointerEvents = any ? '' : 'none';
      }

      container.querySelectorAll('.rescore-trigger-cb').forEach(cb => {
        cb.addEventListener('change', () => { cfg.automations[cb.dataset.key] = cb.checked; saveCoopConfig(); });
      });
      container.querySelectorAll('.rescore-stage-cb').forEach(cb => {
        cb.addEventListener('change', saveCoopConfig);
      });
    });
  });
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
    row.addEventListener('dragend', () => { row.style.opacity = ''; dragIdx = null; });
    row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
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

  body.querySelectorAll('[data-enrichment-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.enrichmentToggle);
      config.enrichmentOrder[idx].enabled = input.checked;
      input.closest('.pipeline-row').classList.toggle('disabled', !input.checked);
      savePipelineConfig(config);
    });
  });

  body.querySelectorAll('[data-search-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.searchToggle);
      config.searchFallbackOrder[idx].enabled = input.checked;
      input.closest('.pipeline-row').classList.toggle('disabled', !input.checked);
      savePipelineConfig(config);
    });
  });

  body.querySelectorAll('[data-model-key]').forEach(select => {
    select.addEventListener('change', () => {
      if (!config.aiModels) config.aiModels = {};
      config.aiModels[select.dataset.modelKey] = select.value;
      savePipelineConfig(config);
      body.querySelectorAll(`[data-model-key="${select.dataset.modelKey}"]`).forEach(s => {
        if (s !== select) s.value = select.value;
      });
    });
  });

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

  body.querySelectorAll('input[name="photo-scope"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!config.photos) config.photos = {};
      config.photos.fetchScope = radio.value;
      savePipelineConfig(config);
    });
  });

  const cacheTTL = document.getElementById('photo-cache-ttl');
  if (cacheTTL) {
    cacheTTL.addEventListener('change', () => {
      if (!config.photos) config.photos = {};
      config.photos.cacheTTLDays = parseInt(cacheTTL.value);
      savePipelineConfig(config);
    });
  }

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

  setupDragReorder('enrichment-list', config.enrichmentOrder, 'enrichment', config);
  setupDragReorder('search-chain-list', config.searchFallbackOrder, 'search', config);
  if (config.photos?.sourceOrder) {
    setupDragReorder('photo-source-list', config.photos.sourceOrder, 'photosrc', config);
  }
}

function initPipelineCollapse() {
  const header = document.getElementById('pipeline-config-header');
  const body   = document.getElementById('pipeline-config-body');
  if (!header || !body) return;
  header.addEventListener('click', () => {
    const collapsed = header.classList.toggle('collapsed');
    body.classList.toggle('hidden', collapsed);
    if (!collapsed && !_pipelineConfig) loadPipelineConfig();
  });
}

// ── Boot ──
renderIntegrations();
initPipelineCollapse();
