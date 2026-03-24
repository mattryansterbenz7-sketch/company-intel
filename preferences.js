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

// ── Save ───────────────────────────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', () => savePrefs(true));

// Auto-save on blur for all inputs/textareas/selects
document.querySelectorAll('.pref-input, input[name="work-arr"], #pref-job-match-toggle').forEach(el => {
  el.addEventListener('change', () => savePrefs(false));
  if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'url') {
    el.addEventListener('blur', () => savePrefs(false));
  }
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

  chrome.storage.local.get(['granolaToken'], ({ granolaToken }) => {
    setConnected(!!granolaToken);
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
