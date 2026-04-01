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


// ── API Usage Dashboard ──

function loadUsageDashboard() {
  chrome.runtime.sendMessage({ type: 'GET_API_USAGE' }, usage => {
    void chrome.runtime.lastError;
    chrome.storage.local.get(['apiCreditAllocations', 'integrations'], data => {
      const alloc = data.apiCreditAllocations || {};
      const integrations = data.integrations || {};
      renderUsageTable(usage || {}, alloc, integrations);
    });
  });
}

function renderSparkline(history) {
  if (!history?.length || history.length < 2) return '';
  const last7 = history.slice(-7);
  const max = Math.max(...last7.map(d => d.requests), 1);
  const w = 40, h = 16;
  const points = last7.map((d, i) => {
    const x = (i / Math.max(last7.length - 1, 1)) * w;
    const y = h - (d.requests / max) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return `<svg class="usage-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="#7c98b6" stroke-width="1.2"/></svg>`;
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

function estimateAnthropicCost(pd) {
  // Rough estimate: blend of Haiku (~$0.25/$1.25 per M) and Sonnet (~$3/$15 per M)
  // Assume ~80% Haiku, 20% Sonnet based on typical usage
  const inTok = pd.tokensToday?.input || 0;
  const outTok = pd.tokensToday?.output || 0;
  const costIn = inTok * (0.8 * 0.25 + 0.2 * 3) / 1000000;
  const costOut = outTok * (0.8 * 1.25 + 0.2 * 15) / 1000000;
  const total = costIn + costOut;
  return total < 0.01 ? '<$0.01' : '$' + total.toFixed(2);
}

function renderUsageTable(usage, alloc, integrations) {
  const container = document.getElementById('usage-table');
  if (!container) return;

  const BILLING_URLS = {
    anthropic: 'https://console.anthropic.com/settings/billing',
    openai: 'https://platform.openai.com/settings/organization/billing/overview',
    serper: 'https://serper.dev/dashboard',
    apollo: 'https://app.apollo.io/#/settings/credits/current',
    granola: null,
  };

  const providers = [
    { id: 'anthropic', name: 'Anthropic', keyCheck: 'anthropic_key', type: 'ai' },
    { id: 'serper', name: 'Serper', keyCheck: 'serper_key', type: 'credit' },
    { id: 'apollo', name: 'Apollo', keyCheck: 'apollo_key', type: 'credit' },
    { id: 'openai', name: 'OpenAI', keyCheck: 'openai_key', type: 'ai-fallback' },
    { id: 'granola', name: 'Granola', keyCheck: 'granola_key', type: 'data' },
  ];

  let html = '';
  for (const prov of providers) {
    const pd = usage[prov.id] || { totalRequests: 0, requestsToday: 0, tokensToday: { input: 0, output: 0 }, lastRateLimit: {}, dailyHistory: [], errors: { count429: 0, count401: 0, countOther: 0 } };
    const configured = !!integrations[prov.keyCheck];
    const dimmed = !configured ? ' dimmed' : '';

    // Status dot + label
    let dotColor = 'gray', statusText = 'Idle', statusClass = 'gray';
    if (!configured) {
      statusText = 'No key'; statusClass = 'gray';
    } else if (pd.errors?.count401 > 0) {
      dotColor = 'red'; statusText = 'Auth error'; statusClass = 'red';
    } else if (pd.errors?.count429 > 0 && pd.totalRequests > 0) {
      dotColor = 'yellow'; statusText = `${pd.errors.count429} retries`; statusClass = 'yellow';
    } else if (pd.totalRequests > 0) {
      dotColor = 'green'; statusText = 'Healthy'; statusClass = 'green';
    } else if (configured) {
      dotColor = 'green'; statusText = 'Ready'; statusClass = 'green';
    }

    // Credit-based status override
    const creditAlloc = alloc[prov.id];
    if (prov.type === 'credit' && creditAlloc > 0 && configured) {
      const pct = Math.round((pd.totalRequests || 0) / creditAlloc * 100);
      if (pct >= 90) { dotColor = 'red'; statusText = `${pct}% used`; statusClass = 'red'; }
      else if (pct >= 70) { dotColor = 'yellow'; statusText = `${pct}% used`; statusClass = 'yellow'; }
      else if (pd.totalRequests > 0) { dotColor = 'green'; statusText = `${pct}% used`; statusClass = 'green'; }
    }

    // Details
    let details = '';
    if (prov.type === 'ai') {
      const tokIn = pd.tokensToday?.input || 0;
      const tokOut = pd.tokensToday?.output || 0;
      if (tokIn || tokOut) {
        details += `${formatTokens(tokIn)} in · ${formatTokens(tokOut)} out today`;
        details += ` · <span class="usage-cost">Est. ${estimateAnthropicCost(pd)}</span>`;
      }
      if (pd.lastRateLimit?.tokensRemaining != null) {
        details += `<br>Rate: ${formatTokens(pd.lastRateLimit.tokensRemaining)}/${formatTokens(pd.lastRateLimit.tokensLimit || 0)} tokens/min`;
      }
    } else if (prov.type === 'credit') {
      if (creditAlloc > 0) {
        const pct = Math.min((pd.totalRequests || 0) / creditAlloc * 100, 100);
        const barColor = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';
        details += `<div class="usage-progress"><div class="usage-progress-bar ${barColor}" style="width:${pct}%"></div></div>`;
        details += `${pd.totalRequests || 0} / <span class="usage-alloc-link" data-provider="${prov.id}">${creditAlloc.toLocaleString()}</span> credits`;
      } else if (configured) {
        details += `<span class="usage-alloc-link" data-provider="${prov.id}">Set credit limit</span>`;
      }
    } else if (prov.type === 'ai-fallback') {
      details += 'Fallback provider';
      if (pd.errors?.count429 > 0) details += ` · ${pd.errors.count429} rate limits retried via chain`;
    } else if (prov.type === 'data') {
      if (pd.totalRequests > 0) details += 'Meeting notes & transcripts';
    }

    if (!configured) details = '<span style="font-style:italic">No key configured</span>';

    const billingUrl = BILLING_URLS[prov.id];
    const billingLink = billingUrl ? `<a href="${billingUrl}" target="_blank" rel="noopener noreferrer" class="usage-billing-link" title="View billing dashboard">↗</a>` : '';

    html += `<div class="usage-row${dimmed}">
      <div class="usage-provider">${prov.name} ${billingLink}</div>
      <div class="usage-counts">
        <span class="usage-count-today">${pd.requestsToday || 0} req</span>
        <span class="usage-count-total">${(pd.totalRequests || 0).toLocaleString()} total ${renderSparkline(pd.dailyHistory)}</span>
      </div>
      <div class="usage-status"><span class="usage-dot ${dotColor}"></span><span class="usage-status-text ${statusClass}">${statusText}</span></div>
      <div class="usage-details">${details}</div>
    </div>`;
  }

  container.innerHTML = html;

  // Inline credit allocation edit
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
        chrome.runtime.sendMessage({ type: 'SET_CREDIT_ALLOCATION', provider: prov, credits: val }, () => {
          loadUsageDashboard(); // re-render with new allocation
        });
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); input.blur(); } });
    });
  });

  // Reset button
  document.getElementById('usage-reset-btn')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_API_USAGE' }, () => loadUsageDashboard());
  });
}

// ── Boot ──
renderIntegrations();
loadUsageDashboard();
setInterval(loadUsageDashboard, 30000);
