// preferences.js — full-screen preferences editor

function loadPrefsWithMigration(callback) {
  chrome.storage.sync.get(['prefs'], syncResult => {
    void chrome.runtime.lastError;
    if (syncResult.prefs && Object.keys(syncResult.prefs).length > 0) {
      callback(syncResult.prefs);
      return;
    }
    chrome.storage.local.get(['prefs'], localResult => {
      void chrome.runtime.lastError;
      if (localResult.prefs && Object.keys(localResult.prefs).length > 0) {
        chrome.storage.sync.set({ prefs: localResult.prefs }, () => void chrome.runtime.lastError);
      }
      callback(localResult.prefs || {});
    });
  });
}

function savePrefs(showConfirm = true) {
  const cityVal  = document.getElementById('pref-location-city').value.trim();
  const stateVal = document.getElementById('pref-location-state').value.trim();

  const prefs = {
    roles:             document.getElementById('pref-roles').value.trim(),
    avoid:             document.getElementById('pref-avoid').value.trim(),
    interests:         document.getElementById('pref-interests').value.trim(),
    jobMatchEnabled:   document.getElementById('pref-job-match-toggle').checked,
    linkedinUrl:       document.getElementById('pref-linkedin-url').value.trim(),
    resumeText:        document.getElementById('pref-resume-text').value.trim(),
    jobMatchBackground:document.getElementById('pref-job-match-bg').value.trim(),
    roleLoved:         document.getElementById('pref-role-loved').value.trim(),
    roleHated:         document.getElementById('pref-role-hated').value.trim(),
    workArrangement:   [...document.querySelectorAll('input[name="work-arr"]:checked')].map(el => el.value),
    locationCity:      cityVal,
    locationState:     stateVal,
    userLocation:      [cityVal, stateVal].filter(Boolean).join(', '),
    maxTravel:         document.getElementById('pref-max-travel').value.trim(),
    salaryFloor:       document.getElementById('pref-salary-floor').value.trim(),
    salaryStrong:      document.getElementById('pref-salary-strong').value.trim(),
  };

  chrome.storage.sync.set({ prefs }, () => {
    void chrome.runtime.lastError;
    if (showConfirm) {
      ['save-confirm', 'save-confirm-bar'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
      });
    }
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────

loadPrefsWithMigration(prefs => {
  if (!prefs) return;

  document.getElementById('pref-job-match-toggle').checked = !!prefs.jobMatchEnabled;
  document.getElementById('pref-linkedin-url').value    = prefs.linkedinUrl        || '';
  document.getElementById('pref-resume-text').value     = prefs.resumeText         || '';
  document.getElementById('pref-job-match-bg').value    = prefs.jobMatchBackground || '';
  document.getElementById('pref-role-loved').value      = prefs.roleLoved          || '';
  document.getElementById('pref-role-hated').value      = prefs.roleHated          || '';
  document.getElementById('pref-roles').value           = prefs.roles              || '';
  document.getElementById('pref-avoid').value           = prefs.avoid              || '';
  document.getElementById('pref-interests').value       = prefs.interests          || '';
  document.getElementById('pref-location-city').value   = prefs.locationCity       || '';
  document.getElementById('pref-location-state').value  = prefs.locationState      || '';
  document.getElementById('pref-max-travel').value      = prefs.maxTravel          || '';
  document.getElementById('pref-salary-floor').value    = prefs.salaryFloor        || '';
  document.getElementById('pref-salary-strong').value   = prefs.salaryStrong       || '';

  const arr = prefs.workArrangement || [];
  document.querySelectorAll('input[name="work-arr"]').forEach(cb => {
    cb.checked = arr.includes(cb.value);
  });
});

// ── Story Time ────────────────────────────────────────────────────────────

(function initStoryTime() {
  const inputEl = document.getElementById('story-time-input');
  const saveBtn = document.getElementById('story-time-save');
  const statusEl = document.getElementById('story-time-status');
  const toggleEl = document.getElementById('story-time-profile-toggle');
  const chevronEl = document.getElementById('story-time-chevron');
  const bodyEl = document.getElementById('story-time-profile-body');
  const textEl = document.getElementById('story-time-profile-text');
  const refreshBtn = document.getElementById('story-time-refresh');

  // Load existing Story Time data
  chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
    const st = storyTime || {};
    inputEl.value = st.rawInput || '';
    renderProfile(st);
  });

  function renderProfile(st) {
    if (st.profileSummary) {
      textEl.textContent = st.profileSummary;
      textEl.classList.remove('story-time-profile-empty');
    } else {
      textEl.textContent = 'No profile generated yet. Write about yourself above, save it, then click "Refresh Profile" to generate a consolidated AI summary.';
      textEl.classList.add('story-time-profile-empty');
    }
  }

  // Save raw input
  saveBtn.addEventListener('click', () => {
    chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
      const st = storyTime || {};
      st.rawInput = inputEl.value.trim();
      chrome.storage.local.set({ storyTime: st }, () => {
        void chrome.runtime.lastError;
        statusEl.classList.add('show');
        setTimeout(() => statusEl.classList.remove('show'), 2000);
      });
    });
  });

  // Toggle profile visibility
  toggleEl.addEventListener('click', () => {
    const isOpen = bodyEl.classList.toggle('open');
    chevronEl.innerHTML = isOpen ? '&#9660;' : '&#9654;';
  });

  // Refresh Profile (consolidation) — will be fully implemented in Step 3
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Generating...';

    const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));
    const st = storyTime || {};
    const rawInput = st.rawInput || '';
    const insights = (st.learnedInsights || []).map(i => i.insight).join('\n');

    if (!rawInput && !insights) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh Profile';
      textEl.textContent = 'Write about yourself first, then refresh.';
      return;
    }

    const result = await new Promise(resolve =>
      chrome.runtime.sendMessage({
        type: 'CONSOLIDATE_PROFILE',
        rawInput,
        insights
      }, resolve)
    );

    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh Profile';

    if (result?.profileSummary) {
      st.profileSummary = result.profileSummary;
      st.lastConsolidated = Date.now();
      chrome.storage.local.set({ storyTime: st });
      renderProfile(st);
    } else {
      textEl.textContent = result?.error || 'Could not generate profile. Try again.';
    }
  });
})();

// ── Save ───────────────────────────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', () => savePrefs(true));

// Auto-save on blur for all inputs/textareas/selects
document.querySelectorAll('.pref-input, input[name="work-arr"], #pref-job-match-toggle').forEach(el => {
  el.addEventListener('change', () => savePrefs(false));
  if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'url') {
    el.addEventListener('blur', () => savePrefs(false));
  }
});

// ── Stages & Colors editor ─────────────────────────────────────────────────

const PRESET_COLORS = [
  '#64748b','#94a3b8','#374151','#1e293b',
  '#ef4444','#f87171','#dc2626','#b91c1c',
  '#f97316','#fb923c','#FF7A59','#ea580c',
  '#eab308','#facc15','#ca8a04','#a16207',
  '#22c55e','#4ade80','#16a34a','#15803d',
  '#14b8a6','#2dd4bf','#0d9488','#0f766e',
  '#06b6d4','#22d3ee','#0891b2','#0e7490',
  '#3b82f6','#60a5fa','#2563eb','#1d4ed8',
  '#8b5cf6','#a78bfa','#7c3aed','#6d28d9',
  '#ec4899','#f472b6','#db2777','#be185d',
  '#a3e635','#bef264','#84cc16','#65a30d',
  '#ffffff','#f1f5f9','#e2e8f0','#000000',
];

const DEFAULT_COMPANY_STAGES = [
  { key: 'co_watchlist',   label: 'Watch List',      color: '#64748b' },
  { key: 'co_researching', label: 'Researching',     color: '#22d3ee' },
  { key: 'co_networking',  label: 'Networking',      color: '#a78bfa' },
  { key: 'co_interested',  label: 'Strong Interest', color: '#fb923c' },
  { key: 'co_applied',     label: 'Applied There',   color: '#4ade80' },
  { key: 'co_archived',    label: 'Archived',        color: '#374151' },
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

function renderStagesSection(companyStages, oppStages) {
  const section = document.getElementById('stages-section');
  if (!section) return;

  const palette = PRESET_COLORS.map(c =>
    `<div class="color-swatch" style="background:${c}" data-color="${c}" title="${c}"></div>`
  ).join('');

  const stageRows = (stages, prefix) => stages.map((s, i) => `
    <div class="stage-row" data-index="${i}" data-group="${prefix}">
      <div class="stage-color-wrap">
        <div class="stage-color-dot" style="background:${s.color}"></div>
        <input type="color" class="stage-color-input" value="${s.color}" data-index="${i}" data-group="${prefix}">
      </div>
      <input type="text" class="stage-label-input" value="${s.label.replace(/"/g,'&quot;')}" data-index="${i}" data-group="${prefix}">
    </div>`).join('');

  section.innerHTML = `
    <div class="pref-card-title" style="font-size:13px;font-weight:800;color:#516f90;text-transform:uppercase;letter-spacing:0.09em;padding-bottom:14px;border-bottom:1px solid #eaf0f6;margin-bottom:20px">Stages &amp; Colors</div>
    <div class="stages-grid">
      <div class="pref-card">
        <div class="pref-card-title">Company Stages</div>
        <div id="company-stage-rows">${stageRows(companyStages, 'company')}</div>
      </div>
      <div class="pref-card">
        <div class="pref-card-title">Opportunity Stages</div>
        <div id="opp-stage-rows">${stageRows(oppStages, 'opp')}</div>
      </div>
    </div>
    <div class="pref-card" style="margin-bottom:28px">
      <div class="pref-card-title">Color Palette</div>
      <div class="color-palette-label">Click a color below, then click the dot on any stage to apply it</div>
      <div class="color-palette">${palette}</div>
    </div>`;

  let selectedColor = null;

  // Palette swatch click — select a color
  section.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      section.querySelectorAll('.color-swatch').forEach(s => s.style.outline = '');
      sw.style.outline = '3px solid #FF7A59';
      sw.style.outlineOffset = '2px';
      selectedColor = sw.dataset.color;
    });
  });

  // Color dot click — apply selected palette color, or open native picker
  section.querySelectorAll('.stage-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      if (selectedColor) {
        dot.style.background = selectedColor;
        const input = dot.nextElementSibling;
        input.value = selectedColor;
        saveStages();
        selectedColor = null;
        section.querySelectorAll('.color-swatch').forEach(s => s.style.outline = '');
      } else {
        dot.nextElementSibling.click(); // open native color picker
      }
    });
  });

  // Native color picker change
  section.querySelectorAll('.stage-color-input').forEach(input => {
    input.addEventListener('input', () => {
      input.previousElementSibling.style.background = input.value;
      saveStages();
    });
  });

  // Label input
  section.querySelectorAll('.stage-label-input').forEach(input => {
    input.addEventListener('blur', saveStages);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

function saveStages() {
  const readGroup = (prefix) => {
    const rows = document.querySelectorAll(`.stage-row[data-group="${prefix}"]`);
    const defaults = prefix === 'company' ? DEFAULT_COMPANY_STAGES : DEFAULT_OPP_STAGES;
    return [...rows].map((row, i) => ({
      key: defaults[i]?.key || `${prefix}_${i}`,
      label: row.querySelector('.stage-label-input').value.trim() || defaults[i]?.label || '',
      color: row.querySelector('.stage-color-input').value,
    }));
  };
  const companyStages = readGroup('company');
  const oppStages = readGroup('opp');
  chrome.storage.local.set({ companyStages, opportunityStages: oppStages }, () => {
    void chrome.runtime.lastError;
    const el = document.getElementById('save-confirm');
    if (el) { el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2000); }
  });
}

// Load and render stages
chrome.storage.local.get(['companyStages', 'opportunityStages', 'customStages'], data => {
  void chrome.runtime.lastError;
  const companyStages = data.companyStages || DEFAULT_COMPANY_STAGES;
  const oppStages = data.opportunityStages || data.customStages || DEFAULT_OPP_STAGES;
  renderStagesSection(companyStages, oppStages);
});

document.getElementById('btn-back').addEventListener('click', () => {
  window.location.href = chrome.runtime.getURL('saved.html');
});

// ── Import from LinkedIn tab ───────────────────────────────────────────────

document.getElementById('import-linkedin-btn').addEventListener('click', () => {
  const status = document.getElementById('import-status');
  status.textContent = 'Looking for your LinkedIn tab…';
  status.className = 'import-status';

  chrome.tabs.query({ url: 'https://www.linkedin.com/in/*' }, tabs => {
    if (!tabs.length) {
      status.textContent = 'No LinkedIn profile tab found. Open your profile in LinkedIn first.';
      status.className = 'import-status err';
      return;
    }
    const tab = tabs[0];
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function sectionText(keyword) {
          const headings = [...document.querySelectorAll('section h2, section h3')];
          const h = headings.find(el => el.textContent.trim().toLowerCase().includes(keyword.toLowerCase()));
          return h ? h.closest('section')?.innerText?.trim() : null;
        }
        const parts = [];
        const name = document.querySelector('h1')?.innerText?.trim();
        if (name) parts.push('Name: ' + name);
        const headline = document.querySelector('.text-body-medium')?.innerText?.trim();
        if (headline) parts.push('Headline: ' + headline);
        const about = sectionText('about');
        if (about) parts.push('About:\n' + about.replace(/^About\s*\n/, ''));
        const exp = sectionText('experience');
        if (exp) parts.push('Experience:\n' + exp.replace(/^Experience\s*\n/, ''));
        const edu = sectionText('education');
        if (edu) parts.push('Education:\n' + edu.replace(/^Education\s*\n/, ''));
        const skills = sectionText('skills');
        if (skills) parts.push('Skills:\n' + skills.replace(/^Skills\s*\n/, ''));
        return parts.join('\n\n');
      }
    }, results => {
      const text = results?.[0]?.result?.trim();
      if (text) {
        document.getElementById('pref-resume-text').value = text;
        status.textContent = 'Imported from LinkedIn ✓';
        status.className = 'import-status';
        savePrefs(false);
      } else {
        status.textContent = 'Could not read profile. Make sure the tab is fully loaded.';
        status.className = 'import-status err';
      }
    });
  });
});

// ── Upload resume file ─────────────────────────────────────────────────────

document.getElementById('upload-resume-file').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const status = document.getElementById('import-status');
  const reader = new FileReader();
  reader.onload = ev => {
    const text = ev.target.result?.trim();
    if (text) {
      document.getElementById('pref-resume-text').value = text;
      status.textContent = `Loaded: ${file.name} ✓`;
      status.className = 'import-status';
      savePrefs(false);
    }
  };
  reader.readAsText(file);
});

// ── Integrations ───────────────────────────────────────────────────────────

// Gmail
(function initGmailUI() {
  const statusEl   = document.getElementById('gmail-status');
  const connectBtn = document.getElementById('gmail-connect-btn');
  const disconnBtn = document.getElementById('gmail-disconnect-btn');

  function setConnected(yes) {
    statusEl.textContent  = yes ? 'Connected' : 'Not connected';
    statusEl.className    = 'integration-status' + (yes ? ' connected' : '');
    connectBtn.style.display = yes ? 'none' : '';
    disconnBtn.style.display = yes ? '' : 'none';
  }

  chrome.storage.local.get(['gmailConnected'], ({ gmailConnected }) => {
    setConnected(!!gmailConnected);
  });

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    const result = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'GMAIL_AUTH' }, resolve)
    );
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Gmail';
    if (result?.success) {
      setConnected(true);
    } else {
      statusEl.textContent = result?.error || 'Connection failed';
      statusEl.className = 'integration-status';
    }
  });

  disconnBtn.addEventListener('click', async () => {
    await new Promise(resolve => chrome.runtime.sendMessage({ type: 'GMAIL_REVOKE' }, resolve));
    setConnected(false);
  });
})();

// Granola
(function initGranolaUI() {
  const statusEl   = document.getElementById('granola-status');
  const connectBtn = document.getElementById('granola-connect-btn');
  const disconnBtn = document.getElementById('granola-disconnect-btn');

  function setConnected(yes) {
    statusEl.textContent  = yes ? 'Connected' : 'Not connected';
    statusEl.className    = 'integration-status' + (yes ? ' connected' : '');
    connectBtn.style.display = yes ? 'none' : '';
    disconnBtn.style.display = yes ? '' : 'none';
  }

  chrome.storage.local.get(['granolaToken'], async ({ granolaToken }) => {
    if (!granolaToken) { setConnected(false); return; }
    // Validate token is still live — a stale token shows "Connected" but fails silently elsewhere
    try {
      const res = await fetch('https://mcp.granola.ai/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': `Bearer ${granolaToken}` },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CompanyIntel', version: '1.0' } } })
      });
      if (res.status === 401) {
        chrome.storage.local.remove('granolaToken');
        setConnected(false);
        statusEl.textContent = 'Session expired — please reconnect';
      } else {
        setConnected(true);
      }
    } catch(e) {
      // Network error — assume still connected, let the next actual use surface errors
      setConnected(true);
    }
  });

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';

    const extensionId = chrome.runtime.id;
    const redirectUri = `https://${extensionId}.chromiumapp.org/granola`;

    try {
      // Step 1: Discover OAuth metadata
      const discovery = await fetch('https://mcp.granola.ai/.well-known/oauth-authorization-server');
      const meta = await discovery.json();

      // Step 2: Dynamic Client Registration — register ourselves, get back a client_id
      let clientId = 'companyintel';
      if (meta.registration_endpoint) {
        try {
          const reg = await fetch(meta.registration_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_name: 'Company Intel',
              redirect_uris: [redirectUri],
              grant_types: ['authorization_code'],
              response_types: ['code'],
              token_endpoint_auth_method: 'none',
            })
          });
          const regData = await reg.json();
          if (regData.client_id) clientId = regData.client_id;
        } catch(e) { /* fall through with default */ }
      }

      // Step 3: Generate PKCE code_verifier + code_challenge
      const codeVerifier = Array.from(crypto.getRandomValues(new Uint8Array(48)))
        .map(b => b.toString(36)).join('').slice(0, 64);
      const encoded = new TextEncoder().encode(codeVerifier);
      const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      // Step 4: Build auth URL with PKCE
      const state = Math.random().toString(36).slice(2);
      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: meta.scopes_supported?.join(' ') || 'read',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      const authUrl = `${meta.authorization_endpoint}?${authParams}`;

      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async redirectUrl => {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Granola';
        if (chrome.runtime.lastError || !redirectUrl) {
          statusEl.textContent = 'Connection cancelled or failed';
          return;
        }

        // Extract code from redirect
        const redirected = new URL(redirectUrl);
        const code = redirected.searchParams.get('code');
        if (!code) {
          // Try implicit token in fragment as fallback
          const fragment = new URLSearchParams(redirected.hash.slice(1));
          const token = fragment.get('access_token');
          if (token) { chrome.storage.local.set({ granolaToken: token }); setConnected(true); }
          else statusEl.textContent = 'Could not get token from Granola';
          return;
        }

        // Step 5: Exchange code for token (with PKCE verifier)
        try {
          const tokenRes = await fetch(meta.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              code_verifier: codeVerifier,
            })
          });
          const tokenData = await tokenRes.json();
          if (tokenData.access_token) {
            chrome.storage.local.set({ granolaToken: tokenData.access_token });
            setConnected(true);
          } else {
            statusEl.textContent = tokenData.error_description || tokenData.error || 'Could not get token from Granola';
          }
        } catch(e) {
          statusEl.textContent = 'Token exchange failed';
        }
      });
    } catch(e) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect Granola';
      statusEl.textContent = 'Could not reach Granola server';
    }
  });

  disconnBtn.addEventListener('click', () => {
    chrome.storage.local.remove('granolaToken');
    setConnected(false);
  });
})();
