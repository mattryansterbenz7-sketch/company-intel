// preferences.js — Career OS preferences editor

// ── Storage helpers ──────────────────────────────────────────────────────────

function showSaveStatus() {
  const el = document.getElementById('save-status');
  const textEl = document.getElementById('save-status-text');
  if (!el) return;
  clearTimeout(el._timer);
  clearTimeout(el._doneTimer);
  // Show spinner
  el.classList.add('show', 'saving');
  if (textEl) textEl.textContent = 'Saving…';
  // After brief spin, show checkmark
  el._doneTimer = setTimeout(() => {
    el.classList.remove('saving');
    if (textEl) textEl.textContent = 'Saved';
  }, 400);
  // Hide after delay
  el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}

// Save new bucket keys to chrome.storage.local
function saveBucket(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    void chrome.runtime.lastError;
    showSaveStatus();
  });
}

// Save sync prefs (location, salary, work arrangement, job match toggle)
function saveSyncPrefs(showConfirm = true) {
  const cityVal  = document.getElementById('pref-location-city').value.trim();
  const stateVal = document.getElementById('pref-location-state').value.trim();

  // Read existing sync prefs first to preserve any keys we don't manage here
  chrome.storage.sync.get(['prefs'], ({ prefs: existing }) => {
    void chrome.runtime.lastError;
    const prefs = Object.assign({}, existing || {}, {
      jobMatchEnabled:   document.getElementById('pref-job-match-toggle').checked,
      linkedinUrl:       document.getElementById('link-linkedin').value.trim(),
      workArrangement:   [...document.querySelectorAll('input[name="work-arr"]:checked')].map(el => el.value),
      locationCity:      cityVal,
      locationState:     stateVal,
      userLocation:      [cityVal, stateVal].filter(Boolean).join(', '),
      maxTravel:         document.getElementById('pref-max-travel').value.trim(),
      salaryFloor:       document.getElementById('pref-salary-floor').value.trim(),
      salaryStrong:      document.getElementById('pref-salary-strong').value.trim(),
      oteFloor:          document.getElementById('pref-ote-floor').value.trim(),
      oteStrong:         document.getElementById('pref-ote-strong').value.trim(),
    });
    chrome.storage.sync.set({ prefs }, () => {
      void chrome.runtime.lastError;
      if (showConfirm) showSaveStatus();
    });
  });
}

// Save profile links bucket
function saveProfileLinks() {
  const data = {
    linkedin:    document.getElementById('link-linkedin').value.trim(),
    github:      document.getElementById('link-github').value.trim(),
    website:     document.getElementById('link-website').value.trim(),
    email:       document.getElementById('link-email').value.trim(),
    phone:       document.getElementById('link-phone').value.trim(),
    bookingLink: document.getElementById('link-booking').value.trim(),
  };
  saveBucket('profileLinks', data);
  // Also keep linkedinUrl in sync prefs for backward compat
  saveSyncPrefs(false);
}

// ── Collapsible cards ────────────────────────────────────────────────────────

function initCollapsibleCards() {
  const cards = document.querySelectorAll('.card[data-card]');
  const stored = JSON.parse(localStorage.getItem('careerOS_collapsed') || '{}');

  cards.forEach(card => {
    const key = card.dataset.card;
    if (stored[key]) card.classList.add('collapsed');

    card.querySelector('.card-header').addEventListener('click', () => {
      card.classList.toggle('collapsed');
      const state = JSON.parse(localStorage.getItem('careerOS_collapsed') || '{}');
      state[key] = card.classList.contains('collapsed');
      localStorage.setItem('careerOS_collapsed', JSON.stringify(state));
    });
  });
}

// ── "How the AI reads this" toggles + live AI interpretations ────────────────

// Map data-ai keys to storage bucket keys
const AI_SECTION_MAP = {
  story: 'profileStory',
  experience: 'profileExperience',
  skills: 'profileSkills',
  principles: 'profilePrinciples',
  motivators: 'profileMotivators',
  voice: 'profileVoice',
  faq: 'profileFAQ',
  greenLights: 'profileGreenLights',
  redLights: 'profileRedLights',
};

// Track last-interpreted content hash to avoid redundant calls
const _interpretedHashes = {};
let _interpretTimers = {};

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h;
}

function renderInterpretation(panelKey, data) {
  const panel = document.querySelector(`.ai-panel[data-ai-panel="${panelKey}"]`);
  if (!panel || !data) return;

  let html = '';
  if (data.bullets) {
    html = data.bullets.map(b => `<div style="margin-bottom:6px"><span style="color:#7c98b6;margin-right:4px">•</span>${escHtml(b)}</div>`).join('');
  } else if (data.entries) {
    html = data.entries.map(e => `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:600;color:#516f90;text-transform:uppercase;letter-spacing:0.03em">${escHtml(e.role)}</div><div style="font-size:12px;color:#33475b;margin-top:2px">${escHtml(e.summary)}</div></div>`).join('');
  } else if (data.summary) {
    html = `<div style="font-size:12px;color:#33475b;line-height:1.6">${escHtml(data.summary)}</div>`;
  } else if (data.drivers || data.energizers || data.drains) {
    if (data.drivers?.length) html += `<div style="margin-bottom:6px"><span style="font-size:11px;font-weight:600;color:#516f90">Drivers:</span> ${data.drivers.map(d => escHtml(d)).join(', ')}</div>`;
    if (data.energizers?.length) html += `<div style="margin-bottom:6px"><span style="font-size:11px;font-weight:600;color:#0F6E56">Energizers:</span> ${data.energizers.map(d => escHtml(d)).join(', ')}</div>`;
    if (data.drains?.length) html += `<div><span style="font-size:11px;font-weight:600;color:#A32D2D">Drains:</span> ${data.drains.map(d => escHtml(d)).join(', ')}</div>`;
  } else if (data.style) {
    html = `<div style="font-size:12px;color:#33475b;line-height:1.6">${escHtml(data.style)}</div>`;
  } else if (data.responses) {
    html = data.responses.map(r => `<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:600;color:#33475b">"${escHtml(r.question)}"</div><div style="font-size:11px;color:#7c98b6;margin-top:2px">${escHtml(r.approach)}</div></div>`).join('');
  } else if (data.signals) {
    html = data.signals.map(s => `<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:600;color:#33475b">${escHtml(s.signal)}</div><div style="font-size:11px;color:#7c98b6;margin-top:2px">${escHtml(s.interpretation)}</div></div>`).join('');
  }

  panel.innerHTML = html || '<div style="color:#A09A94;font-size:12px">Could not parse interpretation.</div>';
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function requestInterpretation(panelKey, storageKey, content) {
  if (!content.trim()) return;
  const hash = simpleHash(content);
  if (_interpretedHashes[panelKey] === hash) return; // no change

  const panel = document.querySelector(`.ai-panel[data-ai-panel="${panelKey}"]`);
  if (panel) panel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#7c98b6;font-size:12px"><span class="ai-spinner"></span> Updating interpretation...</div>';

  chrome.runtime.sendMessage({ type: 'INTERPRET_PROFILE_SECTION', section: storageKey, content }, result => {
    void chrome.runtime.lastError;
    if (result?.interpretation) {
      _interpretedHashes[panelKey] = hash;
      renderInterpretation(panelKey, result.interpretation);
    } else if (panel) {
      panel.innerHTML = `<div style="color:#A09A94;font-size:12px">${result?.error || 'Interpretation failed — try again later.'}</div>`;
    }
  });
}

function initAIToggles() {
  // Toggle open/close
  document.querySelectorAll('.ai-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      const panelKey = toggle.dataset.ai;
      const card = toggle.closest('.card-body') || toggle.closest('.light-card') || toggle.closest('.card');
      const textarea = card ? card.querySelector('textarea') : null;
      const panel = document.querySelector(`.ai-panel[data-ai-panel="${panelKey}"]`);
      if (panel && textarea && !textarea.value.trim()) {
        panel.innerHTML = '<div style="color:#A09A94;font-size:12px">Nothing here yet — add content above to see the AI\'s interpretation</div>';
      }
    });
  });

  // Trigger interpretation on blur (with debounce)
  Object.entries(AI_SECTION_MAP).forEach(([panelKey, storageKey]) => {
    // Find the textarea for this section
    const fieldId = {
      story: 'profile-story', experience: 'profile-experience', skills: 'profile-skills',
      principles: 'profile-principles', motivators: 'profile-motivators',
      voice: 'profile-voice', faq: 'profile-faq',
      greenLights: 'profile-green-lights', redLights: 'profile-red-lights',
    }[panelKey];
    const el = fieldId ? document.getElementById(fieldId) : null;
    if (!el) return;

    // On blur: request interpretation if content changed
    el.addEventListener('blur', () => {
      const content = el.value.trim();
      if (!content) return;
      clearTimeout(_interpretTimers[panelKey]);
      _interpretTimers[panelKey] = setTimeout(() => requestInterpretation(panelKey, storageKey, content), 500);
    });

    // Debounce on input: 3 seconds of no typing
    el.addEventListener('input', () => {
      clearTimeout(_interpretTimers[panelKey]);
      _interpretTimers[panelKey] = setTimeout(() => {
        const content = el.value.trim();
        if (content) requestInterpretation(panelKey, storageKey, content);
      }, 3000);
    });
  });
}

// Load stored interpretations on page load
function loadStoredInterpretations() {
  const keys = Object.values(AI_SECTION_MAP).map(k => k + 'Interpretation');
  chrome.storage.local.get(keys, data => {
    void chrome.runtime.lastError;
    Object.entries(AI_SECTION_MAP).forEach(([panelKey, storageKey]) => {
      const stored = data[storageKey + 'Interpretation'];
      if (stored?.data) {
        _interpretedHashes[panelKey] = stored.sourceHash || 0;
        renderInterpretation(panelKey, stored.data);
      } else {
        // No stored interpretation — auto-generate if the section has content
        const fieldId = {
          story: 'profile-story', experience: 'profile-experience', skills: 'profile-skills',
          principles: 'profile-principles', motivators: 'profile-motivators',
          voice: 'profile-voice', faq: 'profile-faq',
          greenLights: 'profile-green-lights', redLights: 'profile-red-lights',
        }[panelKey];
        const el = fieldId ? document.getElementById(fieldId) : null;
        const content = el?.value?.trim();
        if (content) {
          requestInterpretation(panelKey, storageKey, content);
        } else {
          const panel = document.querySelector(`.ai-panel[data-ai-panel="${panelKey}"]`);
          if (panel) panel.innerHTML = '<div style="color:#A09A94;font-size:12px">Add content above to generate an AI interpretation</div>';
        }
      }
    });
  });
}

// ── Page header: user's first name ───────────────────────────────────────────

function setHeaderName() {
  // Try profileLinks first, then storyTime, then sync prefs
  chrome.storage.local.get(['profileLinks', 'storyTime'], data => {
    void chrome.runtime.lastError;
    let firstName = '';

    // Check if we have a name from LinkedIn import stored in storyTime or elsewhere
    chrome.storage.sync.get(['prefs'], ({ prefs }) => {
      void chrome.runtime.lastError;
      // Try to extract name from LinkedIn URL or profile data
      const links = data.profileLinks || {};
      const st = data.storyTime || {};

      // If we have a profileSummary, try to extract name from it
      if (st.profileSummary) {
        const nameMatch = st.profileSummary.match(/^(?:Name:\s*)(.+?)(?:\n|$)/i);
        if (nameMatch) firstName = nameMatch[1].split(' ')[0];
      }

      // If we have raw input that starts with "Name:", extract it
      if (!firstName && st.rawInput) {
        const nameMatch = st.rawInput.match(/^(?:Name:\s*)(.+?)(?:\n|$)/im);
        if (nameMatch) firstName = nameMatch[1].split(' ')[0];
      }

      // Check if name is in profileLinks email (before @)
      if (!firstName && links.email) {
        const emailName = links.email.split('@')[0];
        // Only use if it looks like a real name (not a username with numbers)
        if (emailName && /^[a-zA-Z]+$/.test(emailName) && emailName.length > 2) {
          firstName = emailName.charAt(0).toUpperCase() + emailName.slice(1);
        }
      }

      const titleEl = document.getElementById('page-title');
      if (firstName && titleEl) {
        titleEl.textContent = `${firstName}'s Career OS`;
      }
    });
  });
}

// ── Resume upload ────────────────────────────────────────────────────────────

function initResumeUpload() {
  const fileInput = document.getElementById('resume-file-input');
  const uploadBtn = document.getElementById('resume-upload-btn');
  const replaceBtn = document.getElementById('resume-replace-btn');
  const dropZone = document.getElementById('resume-drop-zone');
  const fileInfo = document.getElementById('resume-file-info');
  const filenameEl = document.getElementById('resume-filename');

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const content = ev.target.result?.trim();
      if (content) {
        saveBucket('profileResume', { filename: file.name, content });
        showResumeFile(file.name);
      }
    };
    reader.readAsText(file);
  }

  function showResumeFile(name) {
    dropZone.style.display = 'none';
    fileInfo.style.display = 'flex';
    filenameEl.textContent = name;
  }

  function showUploadZone() {
    dropZone.style.display = 'block';
    fileInfo.style.display = 'none';
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFile(e.target.files?.[0]));

  replaceBtn.addEventListener('click', () => {
    showUploadZone();
    fileInput.value = '';
    fileInput.click();
  });

  // Drag & drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#AFA9EC'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = '#d8d5d0'; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '#d8d5d0';
    handleFile(e.dataTransfer.files?.[0]);
  });

  // Load existing resume
  chrome.storage.local.get(['profileResume'], ({ profileResume }) => {
    void chrome.runtime.lastError;
    if (profileResume?.filename) showResumeFile(profileResume.filename);
  });
}

// ── LinkedIn import from tab ─────────────────────────────────────────────────

function initLinkedInImport() {
  document.getElementById('import-linkedin-btn').addEventListener('click', () => {
    const status = document.getElementById('import-status');
    status.textContent = 'Looking for your LinkedIn tab...';
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
          // Store the imported text in profileExperience (the new bucket for this data)
          document.getElementById('profile-experience').value = text;
          saveBucket('profileExperience', text);

          // Try to extract name for the header
          const nameMatch = text.match(/^Name:\s*(.+?)$/m);
          if (nameMatch) {
            const firstName = nameMatch[1].split(' ')[0];
            const titleEl = document.getElementById('page-title');
            if (firstName && titleEl) titleEl.textContent = `${firstName}'s Career OS`;
          }

          // Also keep in sync prefs for backward compat
          chrome.storage.sync.get(['prefs'], ({ prefs: existing }) => {
            void chrome.runtime.lastError;
            const prefs = Object.assign({}, existing || {}, { resumeText: text });
            chrome.storage.sync.set({ prefs });
          });

          status.textContent = 'Imported from LinkedIn';
          status.className = 'import-status';
        } else {
          status.textContent = 'Could not read profile. Make sure the tab is fully loaded.';
          status.className = 'import-status err';
        }
      });
    });
  });
}

// ── Stages & Colors ──────────────────────────────────────────────────────────

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
  { key: 'needs_review',    label: 'AI Scoring Queue',           color: '#64748b' },
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
    <div class="section-label" style="margin-top:20px;">STAGES &amp; COLORS</div>
    <div class="stages-grid">
      <div class="stage-card">
        <div class="stage-card-title">Company Stages</div>
        <div id="company-stage-rows">${stageRows(companyStages, 'company')}</div>
      </div>
      <div class="stage-card">
        <div class="stage-card-title">Opportunity Stages</div>
        <div id="opp-stage-rows">${stageRows(oppStages, 'opp')}</div>
      </div>
    </div>
    <div class="stage-card" style="margin-bottom:12px">
      <div class="stage-card-title">Color Palette</div>
      <div class="color-palette-label">Click a color below, then click the dot on any stage to apply it</div>
      <div class="color-palette">${palette}</div>
    </div>`;

  let selectedColor = null;

  section.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      section.querySelectorAll('.color-swatch').forEach(s => s.style.outline = '');
      sw.style.outline = '3px solid #AFA9EC';
      sw.style.outlineOffset = '2px';
      selectedColor = sw.dataset.color;
    });
  });

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
        dot.nextElementSibling.click();
      }
    });
  });

  section.querySelectorAll('.stage-color-input').forEach(input => {
    input.addEventListener('input', () => {
      input.previousElementSibling.style.background = input.value;
      saveStages();
    });
  });

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
    showSaveStatus();
  });
}

// ── Data migration ───────────────────────────────────────────────────────────

function migrateOldData(syncPrefs, callback) {
  chrome.storage.local.get([
    'storyTime',
    'profileStory', 'profileExperience', 'profilePrinciples', 'profileMotivators',
    'profileVoice', 'profileFAQ', 'profileGreenLights', 'profileRedLights',
    'profileSkills', 'profileBackgroundStrengths', 'profileLinks', 'profileResume'
  ], data => {
    void chrome.runtime.lastError;
    const migrations = {};
    const hasNewBuckets = data.profileStory || data.profileExperience || data.profileGreenLights || data.profileRedLights;

    // Only migrate if old data exists and new buckets are empty
    if (!hasNewBuckets) {
      // Migrate storyTime rawInput -> profileStory
      if (data.storyTime?.rawInput && !data.profileStory) {
        migrations.profileStory = data.storyTime.rawInput;
      }

      // Merge roles + roleLoved + interests -> Green Lights
      if (!data.profileGreenLights) {
        const parts = [syncPrefs.roles, syncPrefs.roleLoved, syncPrefs.interests].filter(Boolean);
        if (parts.length) migrations.profileGreenLights = parts.join('\n\n');
      }

      // Merge avoid + roleHated -> Red Lights
      if (!data.profileRedLights) {
        const parts = [syncPrefs.avoid, syncPrefs.roleHated].filter(Boolean);
        if (parts.length) migrations.profileRedLights = parts.join('\n\n');
      }

      // Migrate jobMatchBackground or old profileBackgroundStrengths -> profileSkills
      if (!data.profileSkills) {
        const legacy = data.profileBackgroundStrengths || syncPrefs.jobMatchBackground;
        if (legacy) migrations.profileSkills = legacy;
      }

      // Migrate linkedinUrl into profileLinks if profileLinks doesn't exist
      if (syncPrefs.linkedinUrl && !data.profileLinks) {
        migrations.profileLinks = {
          linkedin: syncPrefs.linkedinUrl,
          github: '', website: '', email: '', phone: '', bookingLink: ''
        };
      }
    }

    if (Object.keys(migrations).length > 0) {
      chrome.storage.local.set(migrations, () => {
        void chrome.runtime.lastError;
        callback(Object.assign({}, data, migrations));
      });
    } else {
      callback(data);
    }
  });
}

// ── Auto-save on blur ────────────────────────────────────────────────────────

function initAutoSave() {
  // Bucket textarea fields
  const bucketFields = {
    'profile-story':               'profileStory',
    'profile-experience':          'profileExperience',
    'profile-principles':          'profilePrinciples',
    'profile-motivators':          'profileMotivators',
    'profile-voice':               'profileVoice',
    'profile-faq':                 'profileFAQ',
    'profile-green-lights':        'profileGreenLights',
    'profile-red-lights':          'profileRedLights',
    'profile-skills':              'profileSkills',
  };

  Object.entries(bucketFields).forEach(([elId, storageKey]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('blur', () => {
      saveBucket(storageKey, el.value.trim());
    });
  });

  // Profile links fields — save all on any blur
  const linkIds = ['link-linkedin', 'link-github', 'link-website', 'link-email', 'link-phone', 'link-booking'];
  linkIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', saveProfileLinks);
  });

  // Sync prefs fields — save on blur/change
  const syncFields = [
    'pref-location-city', 'pref-location-state', 'pref-max-travel',
    'pref-salary-floor', 'pref-salary-strong', 'pref-ote-floor', 'pref-ote-strong'
  ];
  syncFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => saveSyncPrefs(true));
    el.addEventListener('change', () => saveSyncPrefs(true));
  });

  // Work arrangement checkboxes
  document.querySelectorAll('input[name="work-arr"]').forEach(cb => {
    cb.addEventListener('change', () => saveSyncPrefs(true));
  });

  // Job match toggle
  document.getElementById('pref-job-match-toggle').addEventListener('change', () => saveSyncPrefs(true));
}

// ── Boot ─────────────────────────────────────────────────────────────────────

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

// Initialize everything
loadPrefsWithMigration(syncPrefs => {
  // Load sync prefs into fields
  document.getElementById('pref-job-match-toggle').checked = !!syncPrefs.jobMatchEnabled;
  document.getElementById('pref-location-city').value   = syncPrefs.locationCity  || '';
  document.getElementById('pref-location-state').value  = syncPrefs.locationState || '';
  document.getElementById('pref-max-travel').value      = syncPrefs.maxTravel     || '';
  document.getElementById('pref-salary-floor').value    = syncPrefs.salaryFloor   || '';
  document.getElementById('pref-salary-strong').value   = syncPrefs.salaryStrong  || '';
  document.getElementById('pref-ote-floor').value       = syncPrefs.oteFloor      || '';
  document.getElementById('pref-ote-strong').value      = syncPrefs.oteStrong     || '';

  const arr = syncPrefs.workArrangement || [];
  document.querySelectorAll('input[name="work-arr"]').forEach(cb => {
    cb.checked = arr.includes(cb.value);
  });

  // Run migration, then load bucket data
  migrateOldData(syncPrefs, localData => {
    // Profile links
    const links = localData.profileLinks || {};
    document.getElementById('link-linkedin').value = links.linkedin || syncPrefs.linkedinUrl || '';
    document.getElementById('link-github').value   = links.github   || '';
    document.getElementById('link-website').value   = links.website  || '';
    document.getElementById('link-email').value     = links.email    || '';
    document.getElementById('link-phone').value     = links.phone    || '';
    document.getElementById('link-booking').value   = links.bookingLink || '';

    // Bucket textareas
    document.getElementById('profile-story').value               = localData.profileStory              || '';
    document.getElementById('profile-experience').value           = localData.profileExperience         || syncPrefs.resumeText || '';
    document.getElementById('profile-principles').value           = localData.profilePrinciples         || '';
    document.getElementById('profile-motivators').value           = localData.profileMotivators         || '';
    document.getElementById('profile-voice').value                = localData.profileVoice              || '';
    document.getElementById('profile-faq').value                  = localData.profileFAQ                || '';
    document.getElementById('profile-green-lights').value         = localData.profileGreenLights        || '';
    document.getElementById('profile-red-lights').value           = localData.profileRedLights          || '';
    document.getElementById('profile-skills').value               = localData.profileSkills             || localData.profileBackgroundStrengths || '';

    // Update "How the AI reads this" panels for empty motivators
    const motivatorsVal = document.getElementById('profile-motivators').value.trim();
    if (!motivatorsVal) {
      const panel = document.querySelector('.ai-panel[data-ai-panel="motivators"]');
      if (panel) panel.textContent = 'Nothing here yet — add your motivators to see the AI\'s interpretation';
    }

    // Set header name
    setHeaderName();
  });

  // Init UI behaviors
  initCollapsibleCards();
  initAIToggles();
  loadStoredInterpretations();
  initResumeUpload();
  initLinkedInImport();
  initAutoSave();
});

// ── Stages ───────────────────────────────────────────────────────────────────

chrome.storage.local.get(['companyStages', 'opportunityStages', 'customStages'], data => {
  void chrome.runtime.lastError;
  const companyStages = data.companyStages || DEFAULT_COMPANY_STAGES;
  const oppStages = data.opportunityStages || data.customStages || DEFAULT_OPP_STAGES;
  // Migration: rename old "Needs Review" / "Saved — Needs Review" → "AI Scoring Queue"
  const first = oppStages[0];
  if (first && first.key === 'needs_review' && /needs.review/i.test(first.label)) {
    first.label = 'AI Scoring Queue';
    chrome.storage.local.set({ opportunityStages: oppStages });
  }
  renderStagesSection(companyStages, oppStages);
});

// ── Back button ──────────────────────────────────────────────────────────────

document.getElementById('btn-back').addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('saved.html');
});
