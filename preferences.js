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

// ── Tab navigation ──────────────────────────────────────────────────────────

function initCosTabs() {
  const tabs = document.querySelectorAll('.cos-tab');
  const panels = document.querySelectorAll('.cos-tab-panel');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
      panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
      // Re-check see-more buttons when switching tabs (scrollHeight may change)
      setTimeout(() => {
        document.querySelectorAll('textarea.field-input').forEach(ta => {
          if (ta._seeMoreCheck) ta._seeMoreCheck();
        });
      }, 50);
    });
  });
}

// ── Textarea "See more / See less" toggles ──────────────────────────────────

function initTextareaSeeMore() {
  const COLLAPSED_H = 80;

  document.querySelectorAll('textarea.field-input').forEach(ta => {
    if (ta.closest('.coop-chat-input-row') || ta.closest('.learning-add-row')) return;
    if (ta.style.display === 'none') return;

    // Force collapsed state via inline style
    ta.style.height = COLLAPSED_H + 'px';
    ta.style.overflow = 'hidden';
    ta.style.resize = 'none';

    const btn = document.createElement('button');
    btn.className = 'ta-see-more';
    btn.type = 'button';
    btn.innerHTML = 'See more &#9660;';
    ta.parentNode.insertBefore(btn, ta.nextSibling);

    let expanded = false;

    function collapse() {
      expanded = false;
      ta.style.height = COLLAPSED_H + 'px';
      ta.style.overflow = 'hidden';
      btn.innerHTML = 'See more &#9660;';
      checkOverflow();
    }

    function expand() {
      expanded = true;
      ta.style.height = ta.scrollHeight + 'px';
      ta.style.overflow = 'visible';
      btn.innerHTML = 'See less &#9650;';
      btn.classList.add('visible');
    }

    function checkOverflow() {
      if (expanded) return;
      // scrollHeight is the full content height; compare against collapsed
      btn.classList.toggle('visible', ta.scrollHeight > COLLAPSED_H + 4);
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (expanded) collapse();
      else expand();
    });

    // Expand on focus so you can edit freely, auto-grow while typing, collapse on blur
    ta.addEventListener('focus', () => {
      ta.style.height = ta.scrollHeight + 'px';
      ta.style.overflow = 'visible';
      expanded = true;
      btn.innerHTML = 'See less &#9650;';
      btn.classList.add('visible');
      // Keep cursor area visible without jumping to top/bottom
      requestAnimationFrame(() => {
        const rect = ta.getBoundingClientRect();
        if (rect.top < 60) {
          ta.scrollIntoView({ block: 'start', behavior: 'instant' });
          window.scrollBy(0, -60); // offset for sticky tabs
        }
      });
    });
    ta.addEventListener('blur', () => {
      if (ta.scrollHeight > COLLAPSED_H + 4) {
        collapse();
      }
    });

    ta._seeMoreCheck = checkOverflow;
    checkOverflow();
    ta.addEventListener('input', () => {
      if (expanded) {
        const scrollY = window.scrollY;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
        window.scrollTo(0, scrollY);
      } else checkOverflow();
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

  // If data.summary contains raw JSON (from fallback parse), try to re-parse and render properly
  if (data.summary && typeof data.summary === 'string' && /^\s*[\[{]/.test(data.summary)) {
    try {
      const reparsed = JSON.parse(data.summary);
      if (reparsed && typeof reparsed === 'object') {
        renderInterpretation(panelKey, reparsed);
        return;
      }
    } catch {}
  }

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
  } else if (data.categories) {
    html = data.categories.map(cat => {
      const skills = (cat.skills || []).map(s => typeof s === 'string' ? s : (s.skill || s.name || JSON.stringify(s)));
      return `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:600;color:#516f90;text-transform:uppercase;letter-spacing:0.03em">${escHtml(cat.name)}</div><div style="font-size:12px;color:#33475b;margin-top:2px">${skills.map(s => escHtml(s)).join(' · ')}</div></div>`;
    }).join('');
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

function initCoopSummarize() {
  const targets = [
    { id: 'profile-story', label: 'story' },
    { id: 'profile-experience', label: 'experience and accomplishments' },
    { id: 'profile-skills', label: 'skills and intangibles' },
    { id: 'profile-principles', label: 'operating principles' },
    { id: 'profile-motivators', label: 'motivators and values' },
  ];
  targets.forEach(({ id, label }) => {
    const ta = document.getElementById(id);
    if (!ta) return;
    const btn = document.createElement('button');
    btn.className = 'icp-autofill-btn';
    btn.style.cssText = 'margin-top:8px;';
    btn.textContent = 'Have Coop summarize';
    ta.parentNode.insertBefore(btn, ta.nextSibling);

    btn.addEventListener('click', async () => {
      const content = ta.value.trim();
      if (!content) { btn.textContent = 'Nothing to summarize — add content first'; setTimeout(() => btn.textContent = 'Have Coop summarize', 2500); return; }
      btn.disabled = true;
      btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is summarizing...';
      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'COOP_CHAT',
            messages: [{ role: 'user', content: `Consolidate and organize the following ${label} content. Remove redundancy, group related items, preserve every specific fact/number/metric/company name. Format it as clean, scannable bullet points grouped by theme. Keep the user's voice and specifics — just make it more organized and digestible. If you notice obvious gaps (e.g. no metrics, no dates, vague claims), add a brief "Gaps to fill:" section at the end suggesting what to add.\n\nContent:\n${content}` }],
            globalChat: true,
            careerOSChat: true
          }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
        });
        if (result?.reply) {
          ta.value = result.reply;
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          showSaveStatus();
        }
      } catch (err) {
        console.error('[CoopSummarize] Error:', err);
      }
      btn.disabled = false;
      btn.textContent = 'Have Coop summarize';
    });
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
        panel.innerHTML = '<div style="color:#A09A94;font-size:12px">Nothing here yet — add content above to see Coop\'s interpretation</div>';
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
      // Check if stored data is a stale fallback (raw JSON wrapped in summary)
      const isStale = stored?.data?.summary && typeof stored.data.summary === 'string' && /^\s*[\[{]/.test(stored.data.summary);
      if (stored?.data && !isStale) {
        _interpretedHashes[panelKey] = stored.sourceHash || 0;
        renderInterpretation(panelKey, stored.data);
      } else if (isStale) {
        // Clear stale fallback and regenerate
        chrome.storage.local.remove(storageKey + 'Interpretation');
        const fieldId2 = { story: 'profile-story', experience: 'profile-experience', skills: 'profile-skills', principles: 'profile-principles', motivators: 'profile-motivators', voice: 'profile-voice', faq: 'profile-faq', greenLights: 'profile-green-lights', redLights: 'profile-red-lights' }[panelKey];
        const el2 = fieldId2 ? document.getElementById(fieldId2) : null;
        if (el2?.value?.trim()) requestInterpretation(panelKey, storageKey, el2.value.trim());
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

  async function handleFile(file) {
    if (!file) return;
    let content = '';
    if (file.name.toLowerCase().endsWith('.pdf')) {
      // Parse PDF using pdf.js
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          pages.push(textContent.items.map(item => item.str).join(' '));
        }
        content = pages.join('\n\n').trim();
      } catch (err) {
        console.error('[Resume] PDF parse error:', err);
        // Fallback: try reading as text
        content = await file.text();
      }
    } else {
      content = await file.text();
    }
    content = content.trim();
    if (content) {
      saveBucket('profileResume', { filename: file.name, content });
      showResumeFile(file.name);
      showResumePreview(content);
    }
  }

  function showResumeFile(name) {
    dropZone.style.display = 'none';
    fileInfo.style.display = 'flex';
    filenameEl.textContent = name;
  }

  function showResumePreview(content) {
    let preview = document.getElementById('resume-text-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'resume-text-preview';
      preview.style.cssText = 'margin-top:12px;';
      fileInfo.parentNode.appendChild(preview);
    }
    const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
    preview.innerHTML = `
      <div class="ai-toggle" id="resume-coop-toggle">
        <span class="ai-toggle-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.5 2 6 4.5 6 7c0 1-.5 2-1.5 2.5C3.5 10 2 11.5 2 13.5 2 15.5 3.5 17 5 17.5c.5.5 1 1.5 1 2.5v2h4v-2c0-1 .5-2 1-2.5.5-.5 1-1.5 1-2.5s-.5-2-1-2.5c-.5-.5-1-1.5-1-2.5 0-1.5 1-3 3-3s3 1.5 3 3c0 1-.5 2-1 2.5-.5.5-1 1.5-1 2.5s.5 2 1 2.5c.5.5 1 1.5 1 2.5v2h4v-2c0-1 .5-2 1-2.5 1.5-.5 3-2 3-4 0-2-1.5-3.5-2.5-4C17.5 9 17 8 17 7c0-2.5-2.5-5-5-5z" stroke="url(#ai-g1)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="ai-toggle-text">How Coop reads this</span>
        <svg class="ai-toggle-chevron" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"/></svg>
      </div>
      <div class="ai-panel" id="resume-coop-panel" style="display:none;white-space:pre-wrap;font-size:12px;max-height:300px;overflow-y:auto;">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
    const toggle = preview.querySelector('#resume-coop-toggle');
    const panel = preview.querySelector('#resume-coop-panel');
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      panel.style.display = toggle.classList.contains('open') ? 'block' : 'none';
    });
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
    if (profileResume?.filename) {
      showResumeFile(profileResume.filename);
      if (profileResume.content) showResumePreview(profileResume.content);
    }
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

          // Count what was imported
          const sections = [];
          if (text.includes('Name:')) sections.push('name');
          if (text.includes('Headline:')) sections.push('headline');
          if (text.includes('About:')) sections.push('about');
          if (text.includes('Experience:')) sections.push('experience');
          if (text.includes('Education:')) sections.push('education');
          if (text.includes('Skills:')) sections.push('skills');
          status.textContent = sections.length
            ? `Imported ${sections.join(', ')} → Experience & Accomplishments`
            : 'Imported profile data → Experience & Accomplishments';
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

// ── Structured profile migration ─────────────────────────────────────────────

const STRUCTURED_CATEGORIES = ['role_type', 'industry', 'culture', 'product', 'team_structure', 'comp', 'other'];

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function migrateToStructured(callback) {
  chrome.storage.local.get([
    'profileGreenLights', 'profileRedLights',
    'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags',
    'profileRoleICP', 'profileCompanyICP', 'profileInterviewLearnings',
    '_migratedStructuredV1'
  ], data => {
    void chrome.runtime.lastError;

    const migrations = {};

    // Migrate green lights → profileAttractedTo
    if (!data.profileAttractedTo?.length && data.profileGreenLights) {
      const lines = data.profileGreenLights.split('\n').map(l => l.trim()).filter(Boolean);
      migrations.profileAttractedTo = lines.map(text => ({
        id: generateId(),
        text,
        category: 'other',
        keywords: [],
        source: 'migrated',
        createdAt: Date.now()
      }));
    }

    // Migrate red lights → profileDealbreakers
    if (!data.profileDealbreakers?.length && data.profileRedLights) {
      const lines = data.profileRedLights.split('\n').map(l => l.trim()).filter(Boolean);
      migrations.profileDealbreakers = lines.map(text => ({
        id: generateId(),
        text,
        category: 'other',
        severity: 'soft',
        keywords: [],
        source: 'migrated',
        createdAt: Date.now()
      }));
    }

    // Init empty structured fields if they don't exist
    if (!data.profileSkillTags) migrations.profileSkillTags = [];
    if (!data.profileRoleICP) migrations.profileRoleICP = { text: '', targetFunction: '', seniority: '', scope: '', sellingMotion: '', teamSizePreference: '' };
    if (!data.profileCompanyICP) migrations.profileCompanyICP = { text: '', stage: '', sizeRange: '', industryPreferences: [], cultureMarkers: [] };
    if (!data.profileInterviewLearnings) migrations.profileInterviewLearnings = [];

    migrations._migratedStructuredV1 = true;

    chrome.storage.local.set(migrations, () => {
      void chrome.runtime.lastError;
      callback(Object.assign({}, data, migrations));
    });
  });
}

// ── Structured entry CRUD ────────────────────────────────────────────────────

function addStructuredEntry(storageKey, entry, callback) {
  chrome.storage.local.get([storageKey], data => {
    const arr = data[storageKey] || [];
    arr.push({ ...entry, id: generateId(), createdAt: Date.now() });
    chrome.storage.local.set({ [storageKey]: arr }, () => {
      void chrome.runtime.lastError;
      showSaveStatus();
      if (callback) callback(arr);
    });
  });
}

function updateStructuredEntry(storageKey, id, updates, callback) {
  chrome.storage.local.get([storageKey], data => {
    const arr = data[storageKey] || [];
    const idx = arr.findIndex(e => e.id === id);
    if (idx === -1) return;
    arr[idx] = { ...arr[idx], ...updates };
    chrome.storage.local.set({ [storageKey]: arr }, () => {
      void chrome.runtime.lastError;
      showSaveStatus();
      if (callback) callback(arr);
    });
  });
}

function deleteStructuredEntry(storageKey, id, callback) {
  chrome.storage.local.get([storageKey], data => {
    const arr = (data[storageKey] || []).filter(e => e.id !== id);
    chrome.storage.local.set({ [storageKey]: arr }, () => {
      void chrome.runtime.lastError;
      showSaveStatus();
      if (callback) callback(arr);
    });
  });
}

// ── Render structured entries ────────────────────────────────────────────────

function renderStructuredList(containerId, storageKey, entries, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const listEl = container.querySelector('.structured-list') || (() => {
    const el = document.createElement('div');
    el.className = 'structured-list';
    container.insertBefore(el, container.querySelector('.entry-form-wrap'));
    return el;
  })();

  if (!entries.length) {
    listEl.innerHTML = '<div class="structured-empty">No entries yet — add one below</div>';
    return;
  }

  // Sort by severity descending (highest priority first)
  const sorted = [...entries].sort((a, b) => {
    const sevA = typeof a.severity === 'number' ? a.severity : (a.severity === 'hard' ? 4 : 2);
    const sevB = typeof b.severity === 'number' ? b.severity : (b.severity === 'hard' ? 4 : 2);
    return sevB - sevA;
  });

  listEl.innerHTML = sorted.map(entry => {
    const sev = typeof entry.severity === 'number' ? entry.severity : (entry.severity === 'hard' ? 4 : 2);
    const colors = ['#94a3b8','#eab308','#f97316','#ef4444','#dc2626'];
    const labels = ['Minor','Preference','Notable','Dealbreaker','Hard Stop'];
    return `
    <div class="structured-entry" data-id="${entry.id}">
      <div class="entry-content">
        <div class="entry-badges">
          <span class="entry-category-badge">${escHtml(entry.category || 'other')}</span>
          <span class="entry-severity-badge" style="background:${colors[sev-1]};color:#fff;font-size:9px;padding:2px 7px;border-radius:4px;font-weight:700;">${sev} · ${labels[sev-1]}</span>
        </div>
        <div class="entry-text">${escHtml(entry.text)}</div>
        ${entry.keywords?.length ? `<div class="entry-keywords">${entry.keywords.map(k => `<span class="keyword-pill">${escHtml(k)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="entry-actions">
        <button class="entry-edit-btn" title="Edit">&#9998;</button>
        <button class="entry-delete-btn" title="Delete">&times;</button>
      </div>
    </div>
  `;
  }).join('');

  // Wire up delete buttons
  listEl.querySelectorAll('.entry-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.structured-entry').dataset.id;
      deleteStructuredEntry(storageKey, id, arr => renderStructuredList(containerId, storageKey, arr, opts));
    });
  });

  // Wire up edit buttons
  listEl.querySelectorAll('.entry-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const entryEl = btn.closest('.structured-entry');
      const id = entryEl.dataset.id;
      const entry = entries.find(e => e.id === id);
      if (!entry) return;
      showEntryForm(containerId, storageKey, opts, entry);
    });
  });
}

function showEntryForm(containerId, storageKey, opts = {}, editEntry = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Remove any existing form
  const existingForm = container.querySelector('.entry-form-wrap');
  if (existingForm) existingForm.remove();

  const formWrap = document.createElement('div');
  formWrap.className = 'entry-form-wrap';

  if (editEntry) {
    // Insert inline: right after the entry being edited
    const entryEl = container.querySelector(`.structured-entry[data-id="${editEntry.id}"]`);
    if (entryEl) {
      entryEl.style.display = 'none'; // hide the entry while editing
      entryEl.insertAdjacentElement('afterend', formWrap);
    } else {
      container.appendChild(formWrap);
    }
  } else {
    container.appendChild(formWrap);
  }

  const catOptions = STRUCTURED_CATEGORIES.map(c =>
    `<option value="${c}" ${editEntry?.category === c ? 'selected' : ''}>${c.replace(/_/g, ' ')}</option>`
  ).join('');

  formWrap.innerHTML = `
    <div class="entry-form">
      <textarea class="field-input entry-form-text" placeholder="Describe this signal..." rows="2">${escHtml(editEntry?.text || '')}</textarea>
      <div class="entry-form-row">
        <select class="field-input entry-form-category">${catOptions}</select>
        ${opts.showSeverity ? `
          <div class="severity-scale" style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:#6b7280;white-space:nowrap;">Severity:</span>
            ${[1,2,3,4,5].map(n => {
              const current = editEntry?.severity ?? 2;
              const numSev = typeof current === 'number' ? current : (current === 'hard' ? 4 : 2);
              const colors = ['#94a3b8','#eab308','#f97316','#ef4444','#dc2626'];
              return `<button class="sev-num-btn ${numSev === n ? 'active' : ''}" data-sev="${n}" style="width:28px;height:28px;border-radius:50%;border:2px solid ${colors[n-1]};background:${numSev === n ? colors[n-1] : 'transparent'};color:${numSev === n ? '#fff' : colors[n-1]};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">${n}</button>`;
            }).join('')}
            <span style="font-size:10px;color:#94a3b8;margin-left:2px;">${editEntry?.severity >= 4 || editEntry?.severity === 'hard' ? 'dealbreaker' : 'preference'}</span>
          </div>` : ''}
      </div>
      <div class="entry-form-row">
        <input type="text" class="field-input entry-form-keywords" placeholder="Keywords (comma-separated, e.g. grit, hustle)" value="${escHtml((editEntry?.keywords || []).join(', '))}">
      </div>
      <div class="entry-form-actions">
        <button class="entry-form-save">${editEntry ? 'Update' : 'Add'}</button>
        <button class="entry-form-cancel">Cancel</button>
      </div>
    </div>`;

  // Severity scale toggle
  formWrap.querySelectorAll('.sev-num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const colors = ['#94a3b8','#eab308','#f97316','#ef4444','#dc2626'];
      formWrap.querySelectorAll('.sev-num-btn').forEach(b => {
        b.classList.remove('active');
        const n = parseInt(b.dataset.sev);
        b.style.background = 'transparent';
        b.style.color = colors[n-1];
      });
      btn.classList.add('active');
      const n = parseInt(btn.dataset.sev);
      btn.style.background = colors[n-1];
      btn.style.color = '#fff';
      // Update label
      const label = formWrap.querySelector('.severity-scale span:last-child');
      if (label) label.textContent = n >= 4 ? 'dealbreaker' : 'preference';
    });
  });

  // Save
  formWrap.querySelector('.entry-form-save').addEventListener('click', () => {
    const text = formWrap.querySelector('.entry-form-text').value.trim();
    if (!text) return;
    const category = formWrap.querySelector('.entry-form-category').value;
    const keywords = formWrap.querySelector('.entry-form-keywords').value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const severity = parseInt(formWrap.querySelector('.sev-num-btn.active')?.dataset.sev) || 2;

    const entryData = { text, category, keywords, source: 'manual' };
    if (opts.showSeverity) entryData.severity = severity;

    if (editEntry) {
      updateStructuredEntry(storageKey, editEntry.id, entryData, arr => {
        renderStructuredList(containerId, storageKey, arr, opts);
        formWrap.innerHTML = '';
        showAddButton(containerId, storageKey, opts);
      });
    } else {
      addStructuredEntry(storageKey, entryData, arr => {
        renderStructuredList(containerId, storageKey, arr, opts);
        formWrap.innerHTML = '';
        showAddButton(containerId, storageKey, opts);
      });
    }
  });

  // Cancel — restore hidden entry and remove form
  formWrap.querySelector('.entry-form-cancel').addEventListener('click', () => {
    if (editEntry) {
      const entryEl = container.querySelector(`.structured-entry[data-id="${editEntry.id}"]`);
      if (entryEl) entryEl.style.display = '';
    }
    formWrap.remove();
    showAddButton(containerId, storageKey, opts);
  });

  // Hide the add button while form is open
  const addBtn = container.querySelector('.entry-add-btn');
  if (addBtn) addBtn.style.display = 'none';
}

function showAddButton(containerId, storageKey, opts) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let addBtn = container.querySelector('.entry-add-btn');
  if (!addBtn) {
    addBtn = document.createElement('button');
    addBtn.className = 'entry-add-btn';
    addBtn.textContent = '+ Add entry';
    addBtn.addEventListener('click', () => showEntryForm(containerId, storageKey, opts));
    container.appendChild(addBtn);
  }
  addBtn.style.display = '';
}

function initStructuredSection(containerId, storageKey, opts = {}) {
  chrome.storage.local.get([storageKey], data => {
    let entries = data[storageKey] || [];
    // Migrate soft/hard to 1-5 numeric severity
    let migrated = false;
    entries = entries.map(e => {
      if (typeof e.severity === 'string') {
        migrated = true;
        return { ...e, severity: e.severity === 'hard' ? 4 : 2 };
      }
      return e;
    });
    if (migrated) chrome.storage.local.set({ [storageKey]: entries });
    renderStructuredList(containerId, storageKey, entries, opts);
    showAddButton(containerId, storageKey, opts);
  });
}

// ── Skill tags ──────────────────────────────────────────────────────────────

function initSkillTags() {
  const container = document.getElementById('skill-tags-container');
  if (!container) return;

  chrome.storage.local.get(['profileSkillTags'], data => {
    const tags = data.profileSkillTags || [];
    renderSkillTags(tags);
  });

  const input = document.getElementById('skill-tag-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const tag = input.value.trim().replace(/,/g, '');
        if (!tag) return;
        chrome.storage.local.get(['profileSkillTags'], data => {
          const tags = data.profileSkillTags || [];
          if (!tags.includes(tag)) {
            tags.push(tag);
            chrome.storage.local.set({ profileSkillTags: tags }, () => {
              showSaveStatus();
              renderSkillTags(tags);
            });
          }
        });
        input.value = '';
      }
    });
  }
}

function renderSkillTags(tags) {
  const wrap = document.getElementById('skill-tags-wrap');
  if (!wrap) return;
  wrap.innerHTML = tags.map(t => `<span class="skill-tag">${escHtml(t)} <button class="skill-tag-x" data-tag="${escHtml(t)}">&times;</button></span>`).join('');
  wrap.querySelectorAll('.skill-tag-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      chrome.storage.local.get(['profileSkillTags'], data => {
        const tags = (data.profileSkillTags || []).filter(t => t !== tag);
        chrome.storage.local.set({ profileSkillTags: tags }, () => {
          showSaveStatus();
          renderSkillTags(tags);
        });
      });
    });
  });
}

// ── ICP fields ──────────────────────────────────────────────────────────────

function initICPAutofill() {
  document.getElementById('role-icp-autofill')?.addEventListener('click', async function() {
    const btn = this;
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is thinking...';

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: [{ role: 'user', content: `Based on everything you know about me — my story, experience, motivators, green lights, red lights, skills, and all our past conversations — fill in my Role ICP. Respond ONLY in JSON with these exact keys: {"text": "2-3 sentence freeform description of my ideal role", "targetFunction": "e.g. GTM, Sales Leadership", "seniority": "e.g. VP, Director", "scope": "e.g. Full P&L, Regional", "sellingMotion": "e.g. Enterprise, PLG", "teamSizePreference": "e.g. 5-15 direct reports"}` }],
          globalChat: true,
          careerOSChat: true
        }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
      });

      if (result?.reply) {
        const match = result.reply.match(/\{[\s\S]*\}/);
        if (match) {
          const data = JSON.parse(match[0]);
          // Only fill empty fields — never overwrite user's manual entries
          const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = val; };
          fillIfEmpty('role-icp-text', data.text);
          fillIfEmpty('role-icp-function', data.targetFunction);
          fillIfEmpty('role-icp-seniority', data.seniority);
          fillIfEmpty('role-icp-scope', data.scope);
          fillIfEmpty('role-icp-selling-motion', data.sellingMotion);
          fillIfEmpty('role-icp-team-size', data.teamSizePreference);
          saveRoleICP();
        }
      }
    } catch (err) {
      console.error('[ICP Autofill] Error:', err);
    }
    btn.disabled = false;
    btn.textContent = 'Let Coop fill this in';
  });

  document.getElementById('company-icp-autofill')?.addEventListener('click', async function() {
    const btn = this;
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is thinking...';

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: [{ role: 'user', content: `Based on everything you know about me — my story, experience, motivators, green lights, red lights, skills, and all our past conversations — fill in my Company ICP. Respond ONLY in JSON with these exact keys: {"text": "2-3 sentence freeform description of my ideal company", "stage": "e.g. Series B-D, Growth", "sizeRange": "e.g. 50-500 employees", "industryPreferences": ["SaaS", "FinTech"], "cultureMarkers": ["transparent", "ownership"]}` }],
          globalChat: true,
          careerOSChat: true
        }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
      });

      if (result?.reply) {
        const match = result.reply.match(/\{[\s\S]*\}/);
        if (match) {
          const data = JSON.parse(match[0]);
          // Only fill empty fields — never overwrite user's manual entries
          const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = typeof val === 'string' ? val : Array.isArray(val) ? val.join(', ') : val; };
          fillIfEmpty('company-icp-text', data.text);
          fillIfEmpty('company-icp-stage', data.stage);
          fillIfEmpty('company-icp-size', data.sizeRange);
          fillIfEmpty('company-icp-industries', data.industryPreferences);
          fillIfEmpty('company-icp-culture', data.cultureMarkers);
          saveCompanyICP();
        }
      }
    } catch (err) {
      console.error('[ICP Autofill] Error:', err);
    }
    btn.disabled = false;
    btn.textContent = 'Let Coop fill this in';
  });
}

function initFlagsAutofill() {
  async function autofillFlags(btnId, storageKey, containerId, opts, prompt) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async function() {
      btn.disabled = true;
      btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is thinking...';

      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'COOP_CHAT',
            messages: [{ role: 'user', content: prompt }],
            globalChat: true,
            careerOSChat: true
          }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
        });

        if (result?.reply) {
          const match = result.reply.match(/\[[\s\S]*\]/);
          if (match) {
            const entries = JSON.parse(match[0]);
            if (Array.isArray(entries) && entries.length) {
              chrome.storage.local.get([storageKey], data => {
                const existing = data[storageKey] || [];
                const newEntries = entries.map(e => ({
                  id: generateId(),
                  text: e.text,
                  category: e.category || 'other',
                  severity: e.severity || 'soft',
                  keywords: e.keywords || [],
                  source: 'coop-autofill',
                  createdAt: Date.now()
                }));
                const merged = [...existing, ...newEntries];
                chrome.storage.local.set({ [storageKey]: merged }, () => {
                  showSaveStatus();
                  renderStructuredList(containerId, storageKey, merged, opts);
                });
              });
            }
          }
        }
      } catch (err) {
        console.error('[Flags Autofill] Error:', err);
      }
      btn.disabled = false;
      btn.textContent = 'Let Coop fill this in';
    });
  }

  autofillFlags('green-flags-autofill', 'profileAttractedTo', 'attracted-to-entries', { showSeverity: true },
    `Based on everything you know about me — my story, experience, motivators, skills, past conversations, and learned insights — generate my green flags (things that attract me to opportunities). Respond ONLY with a JSON array: [{"text": "description", "category": "role_type|industry|culture|product|team_structure|comp|other", "keywords": ["keyword1", "keyword2"]}]. Include 5-8 entries. Keywords should be specific terms that would appear in job postings.`
  );

  autofillFlags('red-flags-autofill', 'profileDealbreakers', 'dealbreaker-entries', { showSeverity: true },
    `Based on everything you know about me — my story, experience, motivators, skills, past conversations, and learned insights — generate my red flags (dealbreakers). Respond ONLY with a JSON array: [{"text": "description", "category": "role_type|industry|culture|product|team_structure|comp|other", "severity": "hard|soft", "keywords": ["keyword1", "keyword2"]}]. Include 5-8 entries. Use "hard" for absolute dealbreakers, "soft" for preferences. Keywords should be specific terms that would appear in job postings.`
  );
}

function initFlagsSeverityRating() {
  async function rateSeverity(btnId, storageKey, containerId, opts, flagType) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const data = await new Promise(r => chrome.storage.local.get([storageKey], r));
      const entries = data[storageKey] || [];
      if (!entries.length) { btn.textContent = 'No entries to rate'; setTimeout(() => btn.textContent = 'Have Coop rate severity', 2500); return; }

      btn.disabled = true;
      btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is rating...';

      const entrySummary = entries.map((e, i) => `${i}: "${e.text}" [${e.category}]`).join('\n');
      const prompt = `Based on everything you know about this person — their story, experience, motivators, values, career goals, and past conversations — rate the severity/importance of each ${flagType} flag on a 1-5 scale.

Scale:
1 = Minor (nice to have, won't reject over this)
2 = Preference (notable, slight scoring impact)
3 = Notable (significant factor, meaningful impact)
4 = Dealbreaker (major red/green flag, strong scoring impact)
5 = ${flagType === 'green' ? 'Must-have (absolute requirement, role without this is a non-starter)' : 'Hard stop (absolute dealbreaker, auto-DQ)'}

Consider what you know about this person's priorities. Someone who values autonomy highly should have "Autonomy / Freedom" rated 4-5. Generic nice-to-haves like "problem solving" might be 1-2.

Entries:
${entrySummary}

Respond ONLY with a JSON array of numbers in the same order: [3, 4, 2, 5, ...] — one severity per entry.`;

      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'COOP_CHAT',
            messages: [{ role: 'user', content: prompt }],
            globalChat: true,
            careerOSChat: true
          }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
        });

        if (result?.reply) {
          const match = result.reply.match(/\[[\s\S]*?\]/);
          if (match) {
            const ratings = JSON.parse(match[0]);
            let updated = false;
            entries.forEach((e, i) => {
              if (ratings[i] && typeof ratings[i] === 'number' && ratings[i] >= 1 && ratings[i] <= 5) {
                e.severity = ratings[i];
                updated = true;
              }
            });
            if (updated) {
              chrome.storage.local.set({ [storageKey]: entries }, () => {
                showSaveStatus();
                renderStructuredList(containerId, storageKey, entries, opts);
                showAddButton(containerId, storageKey, opts);
              });
            }
          }
        }
      } catch (err) {
        console.error('[FlagRate] Error:', err);
      }
      btn.disabled = false;
      btn.textContent = 'Have Coop rate severity';
    });
  }

  rateSeverity('green-flags-rate', 'profileAttractedTo', 'attracted-to-entries', { showSeverity: true }, 'green');
  rateSeverity('red-flags-rate', 'profileDealbreakers', 'dealbreaker-entries', { showSeverity: true }, 'red');
}

function initICPFields() {
  // Role ICP
  const roleFields = ['role-icp-text', 'role-icp-function', 'role-icp-seniority', 'role-icp-scope', 'role-icp-selling-motion', 'role-icp-team-size'];
  const companyFields = ['company-icp-text', 'company-icp-stage', 'company-icp-size', 'company-icp-industries', 'company-icp-culture'];

  chrome.storage.local.get(['profileRoleICP', 'profileCompanyICP'], data => {
    const role = data.profileRoleICP || {};
    const company = data.profileCompanyICP || {};

    setVal('role-icp-text', role.text);
    setVal('role-icp-function', role.targetFunction);
    setVal('role-icp-seniority', role.seniority);
    setVal('role-icp-scope', role.scope);
    setVal('role-icp-selling-motion', role.sellingMotion);
    setVal('role-icp-team-size', role.teamSizePreference);

    setVal('company-icp-text', company.text);
    setVal('company-icp-stage', company.stage);
    setVal('company-icp-size', company.sizeRange);
    setVal('company-icp-industries', (company.industryPreferences || []).join(', '));
    setVal('company-icp-culture', (company.cultureMarkers || []).join(', '));
  });

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }

  // Auto-save on blur
  roleFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', saveRoleICP);
  });
  companyFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', saveCompanyICP);
  });
}

function saveRoleICP() {
  const gv = id => (document.getElementById(id)?.value || '').trim();
  const icp = {
    text: gv('role-icp-text'),
    targetFunction: gv('role-icp-function'),
    seniority: gv('role-icp-seniority'),
    scope: gv('role-icp-scope'),
    sellingMotion: gv('role-icp-selling-motion'),
    teamSizePreference: gv('role-icp-team-size'),
  };
  saveBucket('profileRoleICP', icp);
}

function saveCompanyICP() {
  const gv = id => (document.getElementById(id)?.value || '').trim();
  const icp = {
    text: gv('company-icp-text'),
    stage: gv('company-icp-stage'),
    sizeRange: gv('company-icp-size'),
    industryPreferences: gv('company-icp-industries').split(',').map(s => s.trim()).filter(Boolean),
    cultureMarkers: gv('company-icp-culture').split(',').map(s => s.trim()).filter(Boolean),
  };
  saveBucket('profileCompanyICP', icp);
}

// ── Interview learnings ─────────────────────────────────────────────────────

function initInterviewLearnings() {
  const container = document.getElementById('learnings-container');
  if (!container) return;

  chrome.storage.local.get(['profileInterviewLearnings'], data => {
    renderLearnings(data.profileInterviewLearnings || []);
  });

  document.getElementById('learning-add-btn')?.addEventListener('click', () => {
    const text = document.getElementById('learning-text')?.value.trim();
    const source = document.getElementById('learning-source')?.value.trim();
    if (!text) return;
    const entry = { id: generateId(), text, source, date: new Date().toISOString().slice(0, 10) };
    chrome.storage.local.get(['profileInterviewLearnings'], data => {
      const arr = data.profileInterviewLearnings || [];
      arr.push(entry);
      chrome.storage.local.set({ profileInterviewLearnings: arr }, () => {
        showSaveStatus();
        renderLearnings(arr);
        document.getElementById('learning-text').value = '';
        document.getElementById('learning-source').value = '';
      });
    });
  });
}

function renderLearnings(entries) {
  const list = document.getElementById('learnings-list');
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = '<div class="structured-empty">No learnings yet</div>';
    return;
  }
  list.innerHTML = entries.map(e => `
    <div class="learning-entry" data-id="${e.id}">
      <div class="learning-text">${escHtml(e.text)}</div>
      <div class="learning-meta">${e.source ? escHtml(e.source) : ''} ${e.date ? `· ${e.date}` : ''}</div>
      <button class="entry-delete-btn learning-delete" title="Delete">&times;</button>
    </div>
  `).join('');
  list.querySelectorAll('.learning-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.learning-entry').dataset.id;
      chrome.storage.local.get(['profileInterviewLearnings'], data => {
        const arr = (data.profileInterviewLearnings || []).filter(e => e.id !== id);
        chrome.storage.local.set({ profileInterviewLearnings: arr }, () => {
          showSaveStatus();
          renderLearnings(arr);
        });
      });
    });
  });
}

// ── Coop chat drawer ────────────────────────────────────────────────────────

function initCoopChatDrawer() {
  const toggle = document.getElementById('coop-chat-toggle');
  const drawer = document.getElementById('coop-chat-drawer');
  const closeBtn = document.getElementById('coop-chat-close');
  const input = document.getElementById('coop-chat-input');
  const sendBtn = document.getElementById('coop-chat-send');
  const messages = document.getElementById('coop-chat-messages');
  const modelToggle = document.getElementById('coop-model-toggle');
  if (!toggle || !drawer) return;

  const COOP_MODELS = [
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', icon: '◆', cost: '$', tier: 'Fast & cheap', provider: 'openai' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', icon: '◆', cost: '$', tier: 'Fastest', provider: 'openai' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku', icon: '⚡', cost: '$', tier: 'Fast & cheap', provider: 'anthropic' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', icon: '✦', cost: '$$', tier: 'Balanced', provider: 'anthropic' },
    { id: 'gpt-4.1', label: 'GPT-4.1', icon: '◆', cost: '$$', tier: 'Balanced', provider: 'openai' },
    { id: 'gpt-5', label: 'GPT-5', icon: '◆', cost: '$$$', tier: 'Most capable', provider: 'openai' },
    { id: 'claude-opus-4-0-20250514', label: 'Claude Opus', icon: '★', cost: '$$$', tier: 'Most capable', provider: 'anthropic' },
  ];
  let availableModels = COOP_MODELS;
  let selectedModelIdx = 0;
  let totalTokens = { input: 0, output: 0 };

  // Load key status + pipeline config, set default model from Pipeline settings
  Promise.all([
    new Promise(r => chrome.runtime.sendMessage({ type: 'GET_KEY_STATUS' }, s => { void chrome.runtime.lastError; r(s); })),
    new Promise(r => chrome.storage.local.get(['pipelineConfig'], d => r(d.pipelineConfig)))
  ]).then(([status, pipelineCfg]) => {
    if (status) {
      availableModels = COOP_MODELS.filter(m => {
        if (m.provider === 'openai') return !!status.openai;
        if (m.provider === 'anthropic') return !!status.anthropic;
        return true;
      });
      if (!availableModels.length) availableModels = COOP_MODELS;
    }
    const configModel = pipelineCfg?.aiModels?.chat;
    if (configModel) {
      const idx = availableModels.findIndex(m => m.id === configModel);
      if (idx >= 0) selectedModelIdx = idx;
    }
    updateModelLabel();
  });

  function updateModelLabel() {
    const m = availableModels[selectedModelIdx] || availableModels[0];
    if (modelToggle && m) modelToggle.textContent = m.icon + ' ' + m.label + ' ▾';
  }

  if (modelToggle) {
    modelToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = drawer.querySelector('.coop-model-dropdown');
      if (existing) { existing.remove(); return; }

      const dd = document.createElement('div');
      dd.className = 'coop-model-dropdown';
      dd.innerHTML = availableModels.map((m, i) => `
        <div class="coop-model-opt ${i === selectedModelIdx ? 'active' : ''}" data-idx="${i}">
          <div>
            <div class="coop-model-name">${m.icon} ${m.label}</div>
            <div class="coop-model-tier">${m.tier}</div>
          </div>
          <span class="coop-model-cost" style="color:${m.cost === '$' ? '#5DCAA5' : m.cost === '$$' ? '#ca8a04' : '#FF7A59'}">${m.cost}</span>
        </div>
      `).join('');
      drawer.querySelector('.coop-chat-header').appendChild(dd);

      dd.querySelectorAll('.coop-model-opt').forEach(opt => {
        opt.addEventListener('click', () => {
          selectedModelIdx = parseInt(opt.dataset.idx);
          updateModelLabel();
          dd.remove();
        });
      });
      const closeDd = (ev) => { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', closeDd); } };
      setTimeout(() => document.addEventListener('click', closeDd), 0);
    });
  }

  let chatHistory = [];
  let isOpen = false;

  // Listen for insight extraction confirmations
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'INSIGHTS_CAPTURED' && msg.insights?.length) {
      const allMsgs = messages.querySelectorAll('.coop-msg-assistant');
      const lastMsg = allMsgs[allMsgs.length - 1];
      if (lastMsg && !lastMsg.querySelector('.coop-learned')) {
        const note = document.createElement('div');
        note.className = 'coop-learned';
        note.style.cssText = 'margin-top:8px;padding:6px 10px;background:rgba(93,202,165,0.15);border:1px solid rgba(93,202,165,0.3);border-radius:6px;font-size:11px;color:#5DCAA5;font-weight:600;';
        note.textContent = '✓ Saved to memory: ' + msg.insights.map(t => t.length > 50 ? t.slice(0, 47) + '...' : t).join('; ');
        lastMsg.appendChild(note);
        messages.scrollTop = messages.scrollHeight;
      }
    }
  });

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    drawer.classList.toggle('open', isOpen);
    toggle.classList.toggle('open', isOpen);
    if (isOpen && !chatHistory.length) {
      appendMessage('assistant', "Hey! I can see your full Career OS profile. Ask me anything — or tell me something and I'll propose an update.\n\nTry: *\"Add a dealbreaker for grit culture\"* or *\"What are my dealbreakers?\"*");
    }
  });
  closeBtn?.addEventListener('click', () => {
    isOpen = false;
    drawer.classList.remove('open');
    toggle.classList.remove('open');
  });

  function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `coop-msg coop-msg-${role}`;
    // Parse proposals from assistant messages
    if (role === 'assistant') {
      const { html, proposals } = parseCoopResponse(content);
      div.innerHTML = html;
      if (proposals.length) {
        proposals.forEach(p => {
          const proposalEl = document.createElement('div');
          proposalEl.className = 'coop-proposal';
          const proposalLabel = p._type === 'settings'
            ? `Switch ${p.setting === 'chatModel' ? 'chat model' : p.setting === 'scoringModel' ? 'scoring model' : p.setting === 'researchModel' ? 'research model' : p.setting} to ${p.label || p.value}`
            : p._type === 'task'
            ? (p.label || `Task: ${p.text}`)
            : (p.description || p.text || `Update ${p.target || 'profile'}`);
          proposalEl.innerHTML = `
            <div class="coop-proposal-text">${escHtml(proposalLabel)}</div>
            <div class="coop-proposal-actions">
              <button class="coop-accept-btn">Accept</button>
              <button class="coop-reject-btn">Dismiss</button>
            </div>`;
          proposalEl.querySelector('.coop-accept-btn').addEventListener('click', () => {
            applyCoopProposal(p);
            // If a model setting was changed, sync the local picker state
            if (p._type === 'settings' && (p.setting === 'chatModel' || p.setting === 'scoringModel' || p.setting === 'researchModel')) {
              if (p.setting === 'chatModel') {
                const idx = availableModels.findIndex(m => m.id === p.value);
                if (idx >= 0) selectedModelIdx = idx;
                updateModelLabel();
              }
            }
            proposalEl.querySelector('.coop-proposal-actions').innerHTML = '<span style="color:#5DCAA5;font-weight:600">Applied</span>';
          });
          proposalEl.querySelector('.coop-reject-btn').addEventListener('click', () => {
            proposalEl.querySelector('.coop-proposal-actions').innerHTML = '<span style="color:#7c98b6">Dismissed</span>';
          });
          div.appendChild(proposalEl);
        });
      }
    } else {
      div.textContent = content;
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMessage('user', text);
    chatHistory.push({ role: 'user', content: text });

    // Show typing indicator with elapsed time
    const typing = document.createElement('div');
    typing.className = 'coop-msg coop-msg-assistant coop-typing';
    typing.innerHTML = '<span class="ai-spinner"></span> Thinking...';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    const startTime = Date.now();
    const thinkTimer = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      typing.innerHTML = `<span class="ai-spinner"></span> Thinking... <span style="color:#a8a5a0;font-size:10px">${elapsed}s</span>`;
    }, 200);

    const selectedModel = availableModels[selectedModelIdx] || availableModels[0];

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: chatHistory,
          globalChat: true,
          careerOSChat: true,
          chatModel: selectedModel.id
        }, result => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });

      clearInterval(thinkTimer);
      typing.remove();
      if (response?.reply) {
        chatHistory.push({ role: 'assistant', content: response.reply });
        appendMessage('assistant', response.reply);
        // Show token usage + estimated cost
        if (response.usage) {
          totalTokens.input += response.usage.input || 0;
          totalTokens.output += response.usage.output || 0;
          const tokenEl = document.createElement('div');
          tokenEl.className = 'coop-token-info';
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const modelLabel = response.model || selectedModel.label;
          const cost = estimateTokenCost(response.model || selectedModel.id, response.usage.input || 0, response.usage.output || 0);
          const sessionCost = estimateTokenCost(response.model || selectedModel.id, totalTokens.input, totalTokens.output);
          const routeTag = response.routed === 'slim' ? ' · ⚡ slim' : response.routed === 'medium' ? ' · ⚡ medium' : '';
          tokenEl.textContent = `${modelLabel} · ${(response.usage.input||0).toLocaleString()}→${(response.usage.output||0).toLocaleString()} tokens · ~$${cost} · ${elapsed}s${routeTag} · session: ~$${sessionCost}`;
          messages.appendChild(tokenEl);
          messages.scrollTop = messages.scrollHeight;
        }
      } else {
        appendMessage('assistant', 'Sorry, something went wrong. Try again.');
      }
    } catch (err) {
      clearInterval(thinkTimer);
      typing.remove();
      appendMessage('assistant', `Error: ${err.message}`);
    }
  }

  sendBtn?.addEventListener('click', sendMessage);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  // Auto-grow input as user types
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
  }
}

function parseCoopResponse(content) {
  const proposals = [];
  // Look for ```career-os-update code fences
  const fenceRegex = /```career-os-update\n([\s\S]*?)```/g;
  let match;
  let cleaned = content;
  while ((match = fenceRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) proposals.push(...parsed);
      else proposals.push(parsed);
    } catch {}
    cleaned = cleaned.replace(match[0], '');
  }
  // Look for ```settings-update code fences
  const settingsRegex = /```settings-update\n([\s\S]*?)```/g;
  while ((match = settingsRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      proposals.push({ ...parsed, _type: 'settings' });
    } catch {}
    cleaned = cleaned.replace(match[0], '');
  }
  // Look for ```create-task code fences
  const taskRegex = /```create-task\n([\s\S]*?)```/g;
  while ((match = taskRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      proposals.push({ ...parsed, _type: 'task' });
    } catch {}
    cleaned = cleaned.replace(match[0], '');
  }
  // Simple markdown → HTML
  let html = escHtml(cleaned.trim())
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  return { html, proposals };
}

function applyCoopProposal(proposal) {
  // Handle task creation
  if (proposal._type === 'task') {
    const newTask = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: proposal.text,
      company: proposal.company || '',
      dueDate: proposal.dueDate || new Date().toISOString().slice(0, 10),
      priority: proposal.priority || 'normal',
      completed: false,
      createdAt: Date.now(),
      source: 'coop',
    };
    chrome.storage.local.get(['userTasks'], d => {
      const all = d.userTasks || [];
      all.push(newTask);
      chrome.storage.local.set({ userTasks: all }, () => showSaveStatus());
    });
    return;
  }
  // Handle settings updates
  if (proposal._type === 'settings') {
    chrome.runtime.sendMessage({
      type: 'UPDATE_PIPELINE_SETTING',
      key: proposal.setting,
      value: proposal.value
    }, () => {
      void chrome.runtime.lastError;
      showSaveStatus();
      // Update the model picker label if chat model changed
      if (proposal.setting === 'chatModel') {
        updateModelLabel();
      }
    });
    return;
  }

  const { action, target, data } = proposal;
  if (!target || !data) return;

  const storageKey = target === 'attractedTo' ? 'profileAttractedTo'
    : target === 'dealbreakers' ? 'profileDealbreakers'
    : target === 'skillTags' ? 'profileSkillTags'
    : target === 'roleICP' ? 'profileRoleICP'
    : target === 'companyICP' ? 'profileCompanyICP'
    : target === 'learnings' ? 'profileInterviewLearnings'
    : null;
  if (!storageKey) return;

  if (action === 'add') {
    if (storageKey === 'profileSkillTags') {
      chrome.storage.local.get([storageKey], d => {
        const tags = d[storageKey] || [];
        const newTags = Array.isArray(data) ? data : [data];
        newTags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
        chrome.storage.local.set({ [storageKey]: tags }, () => { showSaveStatus(); renderSkillTags(tags); });
      });
    } else if (storageKey === 'profileRoleICP' || storageKey === 'profileCompanyICP') {
      chrome.storage.local.get([storageKey], d => {
        const existing = d[storageKey] || {};
        // Only fill empty fields — never overwrite user's manual entries
        const merged = { ...existing };
        for (const [k, v] of Object.entries(data)) {
          if (!existing[k] || (typeof existing[k] === 'string' && !existing[k].trim()) || (Array.isArray(existing[k]) && !existing[k].length)) {
            merged[k] = v;
          }
        }
        chrome.storage.local.set({ [storageKey]: merged }, () => { showSaveStatus(); initICPFields(); });
      });
    } else {
      const entry = { ...data, id: generateId(), source: 'coop', createdAt: Date.now() };
      chrome.storage.local.get([storageKey], d => {
        const arr = d[storageKey] || [];
        arr.push(entry);
        chrome.storage.local.set({ [storageKey]: arr }, () => {
          showSaveStatus();
          const containerId = target === 'attractedTo' ? 'attracted-to-entries' : target === 'dealbreakers' ? 'dealbreaker-entries' : 'learnings-container';
          const opts = target === 'dealbreakers' ? { showSeverity: true } : {};
          if (target === 'learnings') renderLearnings(arr);
          else renderStructuredList(containerId, storageKey, arr, opts);
        });
      });
    }
  }
}

// ── Cost estimation ─────────────────────────────────────────────────────────

function estimateTokenCost(modelId, inputTokens, outputTokens) {
  // Rates per 1M tokens (approximate, as of 2026)
  const rates = {
    'gpt-4.1-mini':  { input: 0.40,  output: 1.60 },
    'gpt-4.1-nano':  { input: 0.10,  output: 0.40 },
    'gpt-4.1':       { input: 2.00,  output: 8.00 },
    'gpt-5':         { input: 10.00, output: 30.00 },
    'claude-haiku':  { input: 0.25,  output: 1.25 },
    'claude-sonnet': { input: 3.00,  output: 15.00 },
    'claude-opus':   { input: 15.00, output: 75.00 },
  };
  // Match model ID to rates
  const key = Object.keys(rates).find(k => modelId?.toLowerCase().includes(k.replace('claude-', ''))) || 'gpt-4.1-mini';
  const r = rates[key];
  const cost = (inputTokens / 1_000_000 * r.input) + (outputTokens / 1_000_000 * r.output);
  return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3);
}

// ── Coop's memory viewer ────────────────────────────────────────────────────

let _memoryFilter = 'all';

function initCoopMemory() {
  renderCoopMemory();
}

function renderCoopMemory() {
  const listEl = document.getElementById('coop-memory-list');
  const filtersEl = document.getElementById('coop-memory-filters');
  const patternsEl = document.getElementById('coop-memory-patterns');
  if (!listEl) return;

  chrome.storage.local.get(['storyTime'], data => {
    const st = data.storyTime || {};
    const insights = (st.learnedInsights || []).map((item, idx) => {
      if (typeof item === 'string') return { insight: item, category: 'general', priority: 'normal', idx };
      return { ...item, idx };
    });
    const patterns = st.answerPatterns || [];

    // Category counts
    const cats = {};
    insights.forEach(i => { const c = i.category || 'general'; cats[c] = (cats[c] || 0) + 1; });

    // Filters
    const allCats = ['all', ...Object.keys(cats).sort()];
    filtersEl.innerHTML = allCats.map(c =>
      `<button class="memory-filter-btn ${_memoryFilter === c ? 'active' : ''}" data-filter="${c}">${c === 'all' ? `All (${insights.length})` : `${c.replace(/_/g, ' ')} (${cats[c]})`}</button>`
    ).join('');
    filtersEl.querySelectorAll('.memory-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => { _memoryFilter = btn.dataset.filter; renderCoopMemory(); });
    });

    // Filter
    const filtered = _memoryFilter === 'all' ? insights : insights.filter(i => (i.category || 'general') === _memoryFilter);

    if (!filtered.length) {
      listEl.innerHTML = '<div style="text-align:center;color:#7c98b6;padding:20px;font-size:13px;">No learned insights yet. Chat with Coop and he\'ll start building memory.</div>';
    } else {
      // Show newest first
      listEl.innerHTML = [...filtered].reverse().map(i => `
        <div class="memory-entry" data-idx="${i.idx}">
          <div class="memory-insight">${escHtml(i.insight)}</div>
          <div class="memory-meta">
            <span class="memory-cat ${i.category || 'general'}">${(i.category || 'general').replace(/_/g, ' ')}</span>
            ${i.priority === 'high' ? '<span class="memory-cat high">high priority</span>' : ''}
            ${i.source ? `<span>${escHtml(i.source)}</span>` : ''}
            ${i.date ? `<span>${i.date}</span>` : ''}
          </div>
          <button class="memory-delete" data-idx="${i.idx}" title="Delete this insight">&times;</button>
        </div>
      `).join('');

      listEl.querySelectorAll('.memory-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          chrome.storage.local.get(['storyTime'], d => {
            const st2 = d.storyTime || {};
            if (st2.learnedInsights) {
              st2.learnedInsights.splice(idx, 1);
              chrome.storage.local.set({ storyTime: st2 }, () => {
                showSaveStatus();
                renderCoopMemory();
              });
            }
          });
        });
      });
    }

    // Answer patterns
    if (patterns.length) {
      patternsEl.innerHTML = `
        <div class="memory-section-title">Answer patterns (${patterns.length})</div>
        ${[...patterns].reverse().slice(0, 10).map((p, i) => `
          <div class="memory-entry" data-pattern-idx="${patterns.length - 1 - i}">
            <div class="memory-insight">${escHtml(p.text?.slice(0, 200) || '')}</div>
            <div class="memory-meta">
              <span class="memory-cat answer_pattern">answer pattern</span>
              ${p.context ? `<span>${escHtml(p.context)}</span>` : ''}
              ${p.date ? `<span>${p.date}</span>` : ''}
              ${p.source ? `<span>${escHtml(p.source)}</span>` : ''}
            </div>
            <button class="memory-delete" data-pattern-idx="${patterns.length - 1 - i}" title="Delete">&times;</button>
          </div>
        `).join('')}`;

      patternsEl.querySelectorAll('.memory-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.patternIdx);
          chrome.storage.local.get(['storyTime'], d => {
            const st2 = d.storyTime || {};
            if (st2.answerPatterns) {
              st2.answerPatterns.splice(idx, 1);
              chrome.storage.local.set({ storyTime: st2 }, () => {
                showSaveStatus();
                renderCoopMemory();
              });
            }
          });
        });
      });
    } else {
      patternsEl.innerHTML = '';
    }
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

// ── URL detection + fetch in textareas ───────────────────────────────────────

function initUrlFetchInTextareas() {
  const watchFields = [
    'profile-story', 'profile-experience', 'profile-principles',
    'profile-motivators', 'profile-voice', 'profile-faq',
    'profile-skills'
  ];

  watchFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('paste', () => {
      // Check after paste event processes
      setTimeout(async () => {
        const text = el.value;
        const urlMatch = text.match(/https?:\/\/[^\s<>"')\]]+/gi);
        if (!urlMatch) return;

        // Only fetch URLs we haven't fetched before (check for marker)
        const newUrls = urlMatch.filter(u => !text.includes(`[Fetched from ${u}]`));
        if (!newUrls.length) return;

        for (const url of newUrls.slice(0, 2)) {
          // Show inline status
          const marker = `\n\n[Fetching ${url}...]`;
          el.value += marker;

          try {
            const result = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, r => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(r);
              });
            });

            if (result?.text) {
              el.value = el.value.replace(marker, `\n\n[Fetched from ${url}]\n${result.text.slice(0, 3000)}`);
            } else {
              el.value = el.value.replace(marker, `\n\n[Could not fetch ${url}]`);
            }
          } catch (err) {
            el.value = el.value.replace(marker, `\n\n[Could not fetch ${url}: ${err.message}]`);
          }

          // Trigger save
          el.dispatchEvent(new Event('blur'));
        }
      }, 100);
    });
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
      if (panel) panel.textContent = 'Nothing here yet — add your motivators to see Coop\'s interpretation';
    }

    // Set header name
    setHeaderName();

    // Now that textareas have content, add See more/less toggles
    initTextareaSeeMore();
  });

  // Init tab navigation
  initCosTabs();

  // Init UI behaviors
  initCollapsibleCards();
  initAIToggles();
  initCoopSummarize();
  initFlagsSeverityRating();
  loadStoredInterpretations();
  initResumeUpload();
  initLinkedInImport();
  initAutoSave();
  initUrlFetchInTextareas();

  // Init structured profile (v2)
  migrateToStructured(structData => {
    initStructuredSection('attracted-to-entries', 'profileAttractedTo', { showSeverity: true });
    initStructuredSection('dealbreaker-entries', 'profileDealbreakers', { showSeverity: true });
    initSkillTags();
    initICPFields();
    initICPAutofill();
    initFlagsAutofill();
    initInterviewLearnings();
    initCoopMemory();
  });
  initCoopChatDrawer();
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

const btnBack = document.getElementById('btn-back');
if (btnBack) btnBack.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('saved.html');
});
