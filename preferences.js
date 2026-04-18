// preferences.js — Career OS preferences editor

// Lightweight toast — replaces window.alert() which is unavailable in Chrome
// extension pages. Inject on first use, auto-dismiss after 3.5s.
function prefsToast(msg, { kind = 'info' } = {}) {
  let host = document.getElementById('prefs-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'prefs-toast';
    host.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2b3a;color:#fff;padding:10px 18px;border-radius:8px;font:13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,0.25);z-index:10000;opacity:0;transition:opacity 180ms ease;pointer-events:none;max-width:420px;';
    document.body.appendChild(host);
  }
  host.textContent = msg;
  host.style.background = kind === 'error' ? '#b91c1c' : '#1c2b3a';
  host.style.opacity = '1';
  clearTimeout(host._t);
  host._t = setTimeout(() => { host.style.opacity = '0'; }, 3500);
}

// ── Coop thinking animation ───────────────────────────────────────────────────
let _coopThinkingCount = 0;
function setCoopThinking(active, label = 'Working on it') {
  const svg     = document.querySelector('.coop-bar svg');
  const roleEl  = document.querySelector('.coop-bar-role');
  if (!svg || !roleEl) return;
  _coopThinkingCount = Math.max(0, _coopThinkingCount + (active ? 1 : -1));
  if (_coopThinkingCount > 0) {
    svg.classList.add('coop-thinking');
    roleEl.innerHTML = `${label}<span class="coop-thinking-dots"><span></span><span></span><span></span></span>`;
  } else {
    svg.classList.remove('coop-thinking');
    roleEl.textContent = 'Your co-operator';
  }
}

// ── Coop model config (loaded once at startup) ───────────────────────────────
let _coopModels = {};
chrome.storage.local.get(['pipelineConfig'], d => {
  if (d.pipelineConfig?.aiModels) _coopModels = d.pipelineConfig.aiModels;
});

// ── API cost badge ────────────────────────────────────────────────────────────
function refreshCostBadge() {
  chrome.runtime.sendMessage({ type: 'GET_API_USAGE' }, usage => {
    void chrome.runtime.lastError;
    if (!usage) return;
    const total = typeof usage.costToday === 'number' ? usage.costToday : 0;
    const badge = document.getElementById('api-cost-badge');
    if (!badge) return;
    if (total >= 0.01) {
      badge.textContent = `~$${total.toFixed(2)} today`;
      badge.style.display = '';
      badge.style.color = total > 1 ? 'var(--ci-accent-red)' : total > 0.25 ? '#854F0B' : 'var(--ci-text-tertiary)';
    } else {
      badge.style.display = 'none';
    }
  });
}
refreshCostBadge();

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
    const stalenessRaw = parseInt(document.getElementById('pref-staleness-days')?.value);
    const prefs = Object.assign({}, existing || {}, {
      name:                    document.getElementById('pref-name')?.value.trim() || existing?.name || '',
      jobMatchEnabled:         document.getElementById('pref-job-match-toggle').checked,
      linkedinUrl:             document.getElementById('link-linkedin').value.trim(),
      workArrangement:         [...document.querySelectorAll('input[name="work-arr"]:checked')].map(el => el.value),
      locationCity:            cityVal,
      locationState:           stateVal,
      userLocation:            [cityVal, stateVal].filter(Boolean).join(', '),
      maxTravel:               document.getElementById('pref-max-travel').value.trim(),
      salaryFloor:             document.getElementById('pref-salary-floor').value.trim(),
      salaryStrong:            document.getElementById('pref-salary-strong').value.trim(),
      oteFloor:                document.getElementById('pref-ote-floor').value.trim(),
      oteStrong:               document.getElementById('pref-ote-strong').value.trim(),
      stalenessThresholdDays:  isNaN(stalenessRaw) ? 7 : Math.max(0, stalenessRaw),
    });
    chrome.storage.sync.set({ prefs }, () => {
      void chrome.runtime.lastError;
      if (showConfirm) showSaveStatus();
      syncICPFlags();
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

  // Sub-link smooth scroll + active tracking
  document.querySelectorAll('.cos-sub-link').forEach(link => {
    link.addEventListener('click', () => {
      const el = document.getElementById(link.dataset.anchor);
      if (!el) return;
      // Ensure the ICP tab is active first
      const icpTab = document.querySelector('.cos-tab[data-tab="icp"]');
      if (icpTab && !icpTab.classList.contains('active')) icpTab.click();
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    });
  });

  // Highlight sub-link based on scroll position
  const subLinks = document.querySelectorAll('.cos-sub-link');
  if (subLinks.length) {
    const anchors = [...subLinks].map(l => ({ link: l, el: document.getElementById(l.dataset.anchor) })).filter(a => a.el);
    window.addEventListener('scroll', () => {
      const icpTab = document.querySelector('.cos-tab[data-tab="icp"]');
      if (!icpTab?.classList.contains('active')) return;
      let current = anchors[0];
      for (const a of anchors) {
        if (a.el.getBoundingClientRect().top <= 120) current = a;
      }
      subLinks.forEach(l => l.classList.remove('viewing'));
      if (current) current.link.classList.add('viewing');
    }, { passive: true });
  }
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

// escHtml — provided by ui-utils.js

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
      setCoopThinking(true, 'Summarizing');
      btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is summarizing...';
      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'COOP_CHAT',
            messages: [{ role: 'user', content: `Consolidate and organize the following ${label} content. Remove redundancy, group related items, preserve every specific fact/number/metric/company name. Format it as clean, scannable bullet points grouped by theme. Keep the user's voice and specifics — just make it more organized and digestible. If you notice obvious gaps (e.g. no metrics, no dates, vague claims), add a brief "Gaps to fill:" section at the end suggesting what to add.\n\nContent:\n${content}` }],
            globalChat: true,
            careerOSChat: true,
            chatModel: _coopModels.coopAutofill
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
      setCoopThinking(false);
      btn.disabled = false;
      btn.textContent = 'Have Coop summarize';
    });
  });
}

function initAIToggles() {
  // Toggle open/close — generate interpretation on demand if none exists
  document.querySelectorAll('.ai-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      const panelKey = toggle.dataset.ai;
      const card = toggle.closest('.card-body') || toggle.closest('.light-card') || toggle.closest('.card');
      const textarea = card ? card.querySelector('textarea') : null;
      const panel = document.querySelector(`.ai-panel[data-ai-panel="${panelKey}"]`);
      if (panel && textarea && !textarea.value.trim()) {
        panel.innerHTML = '<div style="color:#A09A94;font-size:12px">Nothing here yet — add content above to see Coop\'s interpretation</div>';
      } else if (panel && toggle.classList.contains('open') && !_interpretedHashes[panelKey]) {
        // Generate on demand when toggle is opened for the first time
        const storageKey = AI_SECTION_MAP[panelKey];
        const content = textarea?.value?.trim();
        if (content && storageKey) {
          requestInterpretation(panelKey, storageKey, content);
        }
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
        // No stored interpretation — only generate on demand (when user opens the toggle), not on page load
        // This prevents 9+ API calls every time the preferences page is opened
        const fieldId = {
          story: 'profile-story', experience: 'profile-experience', skills: 'profile-skills',
          principles: 'profile-principles', motivators: 'profile-motivators',
          voice: 'profile-voice', faq: 'profile-faq',
          greenLights: 'profile-green-lights', redLights: 'profile-red-lights',
        }[panelKey];
        const el = fieldId ? document.getElementById(fieldId) : null;
        const content = el?.value?.trim();
        if (!content) {
          const panel = document.querySelector(`.ai-panel[data-ai-panel="${panelKey}"]`);
          if (panel) panel.innerHTML = '<div style="color:#A09A94;font-size:12px">Add content above to generate an AI interpretation</div>';
        }
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

const STRUCTURED_CATEGORIES = [
  { key: 'culture',        label: 'Culture & Values',   color: '#7c3aed',
    tip: 'Coop scans Glassdoor reviews, leadership bio language, and JD culture signals ("ownership", "grit", "hustle", "process-heavy") for these flags.' },
  { key: 'role_type',      label: 'Role & Scope',        color: '#2563eb',
    tip: 'Coop reads job titles, reporting lines, decision-making authority language, and scope descriptors in the JD (e.g. "player-coach", "IC", "full P&L").' },
  { key: 'comp',           label: 'Compensation',        color: '#059669',
    tip: 'Coop cross-checks posted salary ranges, equity language, and benefits against your floors. Keywords trigger automatic flags even when salary is inferred.' },
  { key: 'product',        label: 'Product & Market',    color: '#d97706',
    tip: 'Coop checks the company\'s product category, market segment, and value prop — useful for filtering commodity products or undifferentiated markets.' },
  { key: 'industry',       label: 'Industry',            color: '#0d9488',
    tip: 'Matched against company research tags (industry/vertical from Apollo or web research). "HR Tech" flags a company categorized in that vertical.' },
  { key: 'team_structure', label: 'Team & Leadership',   color: '#9333ea',
    tip: 'Coop looks at team size signals, management layers, reporting structure language, and leadership patterns (founder-led, PE-backed, committee-driven, etc.).' },
  { key: 'location',       label: 'Location & Travel',   color: '#6b7280',
    tip: 'Cross-checked against your work arrangement preference and max travel. Flags on-site-only roles when you want remote, or heavy travel requirements.' },
  { key: 'other',          label: 'Other',               color: '#94a3b8',
    tip: 'Anything that doesn\'t fit a standard category. Coop still scans for keywords — just no category-specific scoring logic applied.' },
];
// Lookup helpers
const CAT_BY_KEY = Object.fromEntries(STRUCTURED_CATEGORIES.map(c => [c.key, c]));
function getCatMeta(key) { return CAT_BY_KEY[key] || { key, label: key.replace(/_/g,' '), color: '#94a3b8', tip: '' }; }

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

const DEFAULT_SCORING_WEIGHTS = {
  qualificationFit: 20,
  roleFit: 20,
  cultureFit: 25,
  companyFit: 20,
  compFit: 15
};

const CATEGORY_TO_DIMENSION = {
  role:     'roleFit',
  culture:  'cultureFit',
  company:  'companyFit',
  comp:     'compFit',
  team:     'cultureFit',
  industry: 'companyFit',
  product:  'companyFit',
  other:    'roleFit',
};

function migrateFlagDimensions(flags) {
  let dirty = false;
  const migrated = (flags || []).map(f => {
    if (!f.dimension) {
      dirty = true;
      return { ...f, dimension: CATEGORY_TO_DIMENSION[f.category] || 'roleFit' };
    }
    return f;
  });
  return { migrated, dirty };
}

// ── ICP & Scoring Section ────────────────────────────────────────────────────

const ICP_DIMENSIONS = [
  { key: 'qualificationFit', label: 'Qualification fit', color: '#378ADD', subtitle: 'Employer lens', noFlags: true },
  { key: 'roleFit',          label: 'Role fit',          color: '#3B6D11', subtitle: 'Day-to-day work' },
  { key: 'cultureFit',       label: 'Culture fit',       color: '#7F77DD', subtitle: 'Values & environment' },
  { key: 'companyFit',       label: 'Company fit',       color: '#BA7517', subtitle: 'Stage & product' },
  { key: 'compFit',          label: 'Comp fit',          color: '#0F6E56', subtitle: 'Base, OTE & equity', compFitBracket: true },
];

const SEV_GREEN_LABELS = ['Mild signal', 'Preference', 'Green factor', 'Dream factor', 'Hard qualifier'];
const SEV_GREEN_COLORS = ['#94a3b8', '#86a88e', '#4ade80', '#22c55e', '#16a34a'];
const SEV_RED_LABELS   = ['Mild signal', 'Preference', 'Notable', 'Serious concern', 'Hard disqualifier'];
const SEV_RED_COLORS   = ['#94a3b8', '#eab308', '#f97316', '#ef4444', '#dc2626'];

let _icpWeights = { ...DEFAULT_SCORING_WEIGHTS };
let _icpGreens  = [];
let _icpReds    = [];

function initICPScoring() {
  chrome.storage.local.get(['profileAttractedTo', 'profileDealbreakers', 'scoringWeights', 'compBracketSeverities', 'compBracketThresholds'], data => {
    _icpGreens = data.profileAttractedTo || [];
    _icpReds   = data.profileDealbreakers || [];
    _compBracketSeverities = data.compBracketSeverities || { base: {}, ote: {} };
    _compBracketThresholds = data.compBracketThresholds || { base: {}, ote: {} };

    // Validate loaded weights — must have all required keys and sum to 100
    const loaded = data.scoringWeights;
    const requiredKeys = Object.keys(DEFAULT_SCORING_WEIGHTS);
    const isValid = loaded &&
      requiredKeys.every(k => typeof loaded[k] === 'number') &&
      requiredKeys.reduce((s, k) => s + loaded[k], 0) === 100;
    if (isValid) {
      _icpWeights = { ...loaded };
    } else {
      _icpWeights = { ...DEFAULT_SCORING_WEIGHTS };
      chrome.storage.local.set({ scoringWeights: _icpWeights });
    }

    renderICPSliders();
    ICP_DIMENSIONS.forEach(dim => renderICPDimRow(dim));
    document.getElementById('icp-reset-weights')?.addEventListener('click', () => {
      _icpWeights = { ...DEFAULT_SCORING_WEIGHTS };
      renderICPSliders();
      ICP_DIMENSIONS.forEach(dim => updateDimWeightPill(dim.key));
      saveICPWeights();
    });

    // Signal that ICP flag cards are now in the DOM
    document.dispatchEvent(new Event('icp-scoring-ready'));

    // Sync ICP-generated flags on load (keeps flags current with ICP settings)
    syncICPFlags();
  });
}

function renderICPSliders() {
  const row = document.getElementById('icp-sliders-row');
  if (!row) return;
  row.innerHTML = ICP_DIMENSIONS.map(dim => `
    <div class="scoring-slider-col">
      <div class="scoring-slider-label" style="color:${dim.color}">${dim.label.replace(' ', '<br>')}</div>
      <div class="scoring-slider-pct" id="slider-pct-${dim.key}">${_icpWeights[dim.key]}%</div>
      <div class="scoring-slider-wrap">
        <input type="range" min="0" max="50" step="1" value="${_icpWeights[dim.key]}"
               id="slider-${dim.key}" data-dim="${dim.key}" style="accent-color:${dim.color}">
      </div>
      <div class="scoring-slider-sub" style="color:${dim.color}">${dim.subtitle}</div>
    </div>`).join('');

  ICP_DIMENSIONS.forEach(dim => {
    document.getElementById(`slider-${dim.key}`)?.addEventListener('input', e => {
      const newVal = parseInt(e.target.value);
      autoBalanceICPWeights(dim.key, newVal);
    });
  });
  updateWeightTotal();
}

function autoBalanceICPWeights(changedKey, newVal) {
  const others = ICP_DIMENSIONS.map(d => d.key).filter(k => k !== changedKey);
  const oldVal = _icpWeights[changedKey];
  const delta = newVal - oldVal;
  const otherSum = others.reduce((s, k) => s + _icpWeights[k], 0);

  _icpWeights[changedKey] = newVal;

  if (otherSum > 0 && delta !== 0) {
    let remaining = -delta;
    others.forEach((k, i) => {
      if (i === others.length - 1) {
        _icpWeights[k] = Math.max(0, 100 - ICP_DIMENSIONS.map(d => d.key).filter(j => j !== k).reduce((s, j) => s + _icpWeights[j], 0));
      } else {
        const share = Math.round((_icpWeights[k] / otherSum) * -delta);
        _icpWeights[k] = Math.max(0, _icpWeights[k] + share);
        remaining -= share;
      }
    });
  }

  // Sync all slider visuals
  ICP_DIMENSIONS.forEach(dim => {
    const slider = document.getElementById(`slider-${dim.key}`);
    if (slider) slider.value = _icpWeights[dim.key];
    const pct = document.getElementById(`slider-pct-${dim.key}`);
    if (pct) pct.textContent = `${_icpWeights[dim.key]}%`;
    updateDimWeightPill(dim.key);
  });
  updateWeightTotal();
  saveICPWeights();
}

function updateWeightTotal() {
  const total = Object.values(_icpWeights).reduce((s, v) => s + v, 0);
  const el = document.getElementById('icp-weight-total');
  if (!el) return;
  el.textContent = `${total}%`;
  el.className = total === 100 ? 'valid' : 'invalid';
}

function updateDimWeightPill(key) {
  const pill = document.getElementById(`dim-weight-pill-${key}`);
  if (pill) pill.textContent = `${_icpWeights[key]}%`;
}

function saveICPWeights() {
  chrome.storage.local.set({ scoringWeights: _icpWeights }, () => showSaveStatus());
}

function renderICPDimRow(dim) {
  const el = document.getElementById(`icp-dim-${dim.key}`);
  if (!el) return;

  // Preserve open/closed state and scroll position across re-render
  const wasOpen = document.getElementById(`dim-body-${dim.key}`)?.classList.contains('open');
  const scrollY = window.scrollY;

  const greens = _icpGreens.filter(f => (f.dimension || 'roleFit') === dim.key).sort((a, b) => (typeof b.severity === 'number' ? b.severity : 2) - (typeof a.severity === 'number' ? a.severity : 2));
  const reds   = _icpReds.filter(f => (f.dimension || 'roleFit') === dim.key).sort((a, b) => (typeof b.severity === 'number' ? b.severity : 2) - (typeof a.severity === 'number' ? a.severity : 2));

  const countsHtml = dim.noFlags
    ? `<span class="icp-dim-auto-note">auto-scored from resume</span>`
    : dim.compFitBracket
      ? `<span class="icp-dim-auto-note">7 brackets · Base &amp; OTE</span>`
      : `<div class="icp-flag-counts">
           <span class="icp-count-pill green">${greens.length} green</span>
           <span class="icp-count-pill red">${reds.length} red</span>
         </div>`;

  el.innerHTML = `
    <div class="icp-dim-header" data-dim="${dim.key}">
      <span class="icp-dim-dot" style="background:${dim.color}"></span>
      <span class="icp-dim-title">${dim.label}</span>
      ${countsHtml}
      <span class="icp-dim-weight-pill" id="dim-weight-pill-${dim.key}">${_icpWeights[dim.key]}%</span>
      <span class="icp-dim-chevron${wasOpen ? ' open' : ''}" id="dim-chev-${dim.key}">›</span>
    </div>
    <div class="icp-dim-body${wasOpen ? ' open' : ''}" id="dim-body-${dim.key}">
      ${renderICPDimBody(dim, greens, reds)}
    </div>`;

  el.querySelector('.icp-dim-header').addEventListener('click', () => toggleICPDim(dim.key));
  bindICPDimEvents(dim, el);

  // Restore scroll position
  window.scrollTo(0, scrollY);
}

// Bracket tier definitions mirroring scoring.js COMP_BRACKET_TIERS
const COMP_BRACKET_TIERS_UI = [
  { key: 'well_above',     label: 'Well above',       type: 'green', defaultSev: 5, thresholdFn: (f, s) => s * 1.15 },
  { key: 'above_target',   label: 'Above target',     type: 'green', defaultSev: 4, thresholdFn: (f, s) => s * 1.07 },
  { key: 'meets_target',   label: 'Meets target',     type: 'green', defaultSev: 3, thresholdFn: (f, s) => s },
  { key: 'above_floor',    label: 'Above floor',      type: 'green', defaultSev: 2, thresholdFn: (f, s) => (f + s) / 2 },
  { key: 'meets_floor',    label: 'Meets floor',      type: 'green', defaultSev: 1, thresholdFn: (f, s) => f },
  { key: 'slightly_below', label: 'Slightly below',   type: 'red',   defaultSev: 1, thresholdFn: (f, s) => f * 0.9 },
  { key: 'below_floor',    label: 'Below floor',      type: 'red',   defaultSev: 2, thresholdFn: (f, s) => f * 0.8 },
  { key: 'well_below',     label: 'Well below',       type: 'red',   defaultSev: 3, thresholdFn: (f, s) => f * 0.65 },
  { key: 'far_below',      label: 'Far below',        type: 'red',   defaultSev: 4, thresholdFn: (f, s) => f * 0.5 },
  { key: 'critically_low', label: 'Critically low',   type: 'red',   defaultSev: 5, thresholdFn: () => 0 },
];

let _compBracketSeverities  = { base: {}, ote: {} };
let _compBracketThresholds  = { base: {}, ote: {} };

function loadCompBracketSeverities(cb) {
  chrome.storage.local.get(['compBracketSeverities', 'compBracketThresholds'], d => {
    _compBracketSeverities = d.compBracketSeverities || { base: {}, ote: {} };
    _compBracketThresholds = d.compBracketThresholds || { base: {}, ote: {} };
    cb?.();
  });
}

function saveCompBracketSeverities() {
  chrome.storage.local.set({ compBracketSeverities: _compBracketSeverities });
}

function saveCompBracketThresholds() {
  chrome.storage.local.set({ compBracketThresholds: _compBracketThresholds });
}

function renderCompBracketEditor() {
  const fmtK = v => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;

  function bracketSection(compType, floor, strong, label) {
    if (!floor) return `<div class="comp-bracket-empty">No ${label} floor set — configure in Compensation above.</div>`;
    const sevs   = _compBracketSeverities[compType]  || {};
    const threshs = _compBracketThresholds[compType] || {};

    const greens = COMP_BRACKET_TIERS_UI.filter(t => t.type === 'green');
    const reds   = COMP_BRACKET_TIERS_UI.filter(t => t.type === 'red');

    const renderRow = (tier, redIndex) => {
      const computed = tier.thresholdFn(floor, strong);
      const custom   = threshs[tier.key];
      const threshVal = custom || computed;
      const threshK   = Math.round(threshVal / 1000);
      const sev = typeof sevs[tier.key] === 'number' ? sevs[tier.key] : tier.defaultSev;
      const sevColor = tier.type === 'green' ? SEV_GREEN_COLORS[sev - 1] : SEV_RED_COLORS[sev - 1];
      const isLastRed = tier.type === 'red' && redIndex === reds.length - 1;
      const threshCell = isLastRed
        ? `<span class="comp-bracket-thresh">&lt;${fmtK(threshVal)}</span>`
        : `<span class="comp-bracket-thresh"><span class="comp-thresh-lbl">\u2265$</span><input type="number" class="comp-thresh-input${custom ? ' custom' : ''}" data-comp="${compType}" data-tier="${tier.key}" data-default="${Math.round(computed / 1000)}" value="${threshK}" min="1" step="1" title="Edit threshold (in $k). Tab or Enter to save.">k</span>`;
      return `<div class="comp-bracket-row comp-bracket-row--${tier.type}">
        <span class="comp-bracket-dot comp-bracket-dot--${tier.type}"></span>
        <span class="comp-bracket-label">${tier.label}</span>
        ${threshCell}
        <button class="comp-sev-btn" data-comp="${compType}" data-tier="${tier.key}" data-sev="${sev}"
          style="background:${sevColor};"
          title="Click to change severity (1\u20135)">${sev}</button>
      </div>`;
    };

    const greenCol = greens.map((t, i) => renderRow(t, i)).join('');
    const redCol   = reds.map((t, i) => renderRow(t, i)).join('');

    return `<div class="comp-bracket-section">
      <div class="comp-bracket-section-title">${label}</div>
      <div class="comp-bracket-cols">
        <div class="comp-bracket-col comp-bracket-col--green">${greenCol}</div>
        <div class="comp-bracket-col comp-bracket-col--red">${redCol}</div>
      </div>
    </div>`;
  }

  const _parseSalary = id => {
    const raw = (document.getElementById(id)?.value || '').replace(/[^0-9.]/g, '');
    const n = parseFloat(raw);
    return n > 0 ? (n < 1000 ? n * 1000 : n) : 0;
  };
  const salaryFloor  = _parseSalary('pref-salary-floor');
  const salaryStrong = _parseSalary('pref-salary-strong') || salaryFloor * 1.3;
  const oteFloor     = _parseSalary('pref-ote-floor');
  const oteStrong    = _parseSalary('pref-ote-strong') || oteFloor * 1.3;

  return `<div id="comp-bracket-editor">
    <div class="comp-bracket-intro">
      Thresholds are computed from your comp settings — click a number to override it. Click a severity badge to cycle it (1\u20135). <span class="comp-bracket-intro-muted">Higher severity = more score impact.</span>
    </div>
    ${bracketSection('base', salaryFloor, salaryStrong, 'Base')}
    ${bracketSection('ote', oteFloor, oteStrong, 'OTE')}
    <div class="comp-bracket-footnote">
      <div><strong>Undisclosed comp</strong> — If comp is not listed in the posting, no flag fires (score impact: 0).</div>
      <div><strong>Dedup</strong> — Only the single highest-severity green and red flag fire per comp type. Flags don't stack.</div>
    </div>
  </div>`;
}

function bindCompBracketEditorEvents(el) {
  el.querySelectorAll('.comp-sev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const compType = btn.dataset.comp;
      const tierKey  = btn.dataset.tier;
      const cur = parseInt(btn.dataset.sev) || 1;
      const next = cur >= 5 ? 1 : cur + 1;
      if (!_compBracketSeverities[compType]) _compBracketSeverities[compType] = {};
      _compBracketSeverities[compType][tierKey] = next;
      saveCompBracketSeverities();
      btn.dataset.sev = next;
      btn.textContent = next;
      const tier = COMP_BRACKET_TIERS_UI.find(t => t.key === tierKey);
      const colors = tier?.type === 'green' ? SEV_GREEN_COLORS : SEV_RED_COLORS;
      btn.style.background = colors[next - 1];
    });
  });

  el.querySelectorAll('.comp-thresh-input').forEach(input => {
    const commit = () => {
      const compType = input.dataset.comp;
      const tierKey  = input.dataset.tier;
      const defaultK = parseFloat(input.dataset.default);
      const val = parseFloat(input.value);
      if (!_compBracketThresholds[compType]) _compBracketThresholds[compType] = {};
      if (!val || val === defaultK) {
        // Revert to computed default
        delete _compBracketThresholds[compType][tierKey];
        input.style.borderBottomColor = 'var(--ci-border-subtle)';
        input.style.color = 'inherit';
      } else {
        _compBracketThresholds[compType][tierKey] = val * 1000; // store in dollars
        input.style.borderBottomColor = 'var(--ci-accent-blue)';
        input.style.color = 'var(--ci-accent-blue)';
      }
      saveCompBracketThresholds();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = input.dataset.default; input.blur(); }
    });
  });
}

function renderICPDimBody(dim, greens, reds) {
  const qualNote = dim.noFlags ? `<div class="icp-qual-note">Qualification fit is calculated from your resume and experience — not flags. It answers "would they hire me?" based on seniority, skills, and stated requirements in the job posting.</div>` : '';

  if (dim.compFitBracket) {
    return `
      <div class="icp-dim-weight-row">
        <label>Scoring weight</label>
        <input type="range" min="0" max="50" step="1" value="${_icpWeights[dim.key]}"
               id="body-slider-${dim.key}" data-dim="${dim.key}" class="dim-slider-${dim.key}">
        <span class="icp-dim-weight-val" id="body-slider-val-${dim.key}">${_icpWeights[dim.key]}%</span>
      </div>
      ${renderCompBracketEditor()}`;
  }

  const flagCols = dim.noFlags ? '' : `
    <div class="icp-flags-cols">
      <div class="icp-flags-col" id="col-green-${dim.key}">
        <div class="icp-col-label green">Green flags</div>
        ${greens.map(f => renderICPFlagCard(f, 'green')).join('')}
        <button class="icp-add-flag-btn" data-dim="${dim.key}" data-type="green">+ Add green flag</button>
      </div>
      <div class="icp-flags-col" id="col-red-${dim.key}">
        <div class="icp-col-label red">Red flags</div>
        ${reds.map(f => renderICPFlagCard(f, 'red')).join('')}
        <button class="icp-add-flag-btn" data-dim="${dim.key}" data-type="red">+ Add red flag</button>
      </div>
    </div>
    <div class="icp-sev-legend">
      <span style="font-size:11px;color:var(--ci-text-tertiary);font-weight:600;margin-right:4px;">Severity:</span>
      ${[5,4,3,2,1].map(n => `
        <span class="icp-sev-legend-item">
          <span class="icp-sev-legend-dot" style="background:${SEV_RED_COLORS[n-1]}">${n}</span>
          ${n === 5 ? 'Hard disqualifier' : n === 4 ? 'Serious concern / Dream factor' : n === 3 ? 'Notable' : n === 2 ? 'Preference' : 'Mild signal'}
        </span>`).join('')}
    </div>`;

  return `
    <div class="icp-dim-weight-row">
      <label>Scoring weight</label>
      <input type="range" min="0" max="50" step="1" value="${_icpWeights[dim.key]}"
             id="body-slider-${dim.key}" data-dim="${dim.key}" class="dim-slider-${dim.key}">
      <span class="icp-dim-weight-val" id="body-slider-val-${dim.key}">${_icpWeights[dim.key]}%</span>
    </div>
    ${qualNote}${flagCols}`;
}

function renderICPFlagCard(flag, type) {
  const sev = typeof flag.severity === 'number' ? flag.severity : (flag.severity === 'hard' ? 4 : 2);
  const colors = type === 'green' ? SEV_GREEN_COLORS : SEV_RED_COLORS;
  const kws = (flag.keywords || []).map(k => `<span class="icp-kw">${escHtml(k)}</span>`).join('');
  const icpBadge = (flag.source === 'icp' && !flag.manuallyEdited)
    ? `<span class="icp-auto-badge" title="Auto-generated from your ICP settings — edit to customize">⚙ ICP</span>`
    : '';
  return `
    <div class="icp-flag-card ${type}" data-id="${flag.id}">
      <div class="icp-flag-text">${escHtml(flag.text)}${icpBadge}</div>
      ${kws ? `<div class="icp-flag-keywords">${kws}</div>` : ''}
      <span class="icp-flag-sev" style="background:${colors[sev-1]}">${sev}</span>
      <div class="icp-flag-actions">
        <button class="icp-flag-action-btn edit" data-id="${flag.id}">Edit</button>
        <button class="icp-flag-action-btn del" data-id="${flag.id}">✕</button>
      </div>
    </div>`;
}

function bindICPDimEvents(dim, el) {
  if (dim.noFlags) {
    // Wire the body weight slider only
    el.querySelector(`#body-slider-${dim.key}`)?.addEventListener('input', e => {
      autoBalanceICPWeights(dim.key, parseInt(e.target.value));
      const val = document.getElementById(`body-slider-val-${dim.key}`);
      if (val) val.textContent = `${_icpWeights[dim.key]}%`;
    });
    return;
  }

  if (dim.compFitBracket) {
    el.querySelector(`#body-slider-${dim.key}`)?.addEventListener('input', e => {
      autoBalanceICPWeights(dim.key, parseInt(e.target.value));
      const val = document.getElementById(`body-slider-val-${dim.key}`);
      if (val) val.textContent = `${_icpWeights[dim.key]}%`;
    });
    bindCompBracketEditorEvents(el);
    return;
  }

  // Body weight slider
  el.querySelector(`#body-slider-${dim.key}`)?.addEventListener('input', e => {
    autoBalanceICPWeights(dim.key, parseInt(e.target.value));
    const val = document.getElementById(`body-slider-val-${dim.key}`);
    if (val) val.textContent = `${_icpWeights[dim.key]}%`;
  });

  // Add flag buttons
  el.querySelectorAll('.icp-add-flag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      showICPInlineForm(dim, type, null, btn);
    });
  });

  // Edit / delete on flag cards
  el.addEventListener('click', e => {
    const editBtn = e.target.closest('.icp-flag-action-btn.edit');
    const delBtn  = e.target.closest('.icp-flag-action-btn.del');
    if (editBtn) {
      const id = editBtn.dataset.id;
      const flag = [..._icpGreens, ..._icpReds].find(f => f.id === id);
      const type = _icpGreens.find(f => f.id === id) ? 'green' : 'red';
      if (flag) showICPInlineForm(dim, type, flag, editBtn.closest('.icp-flag-card'));
    }
    if (delBtn) {
      const id = delBtn.dataset.id;
      deleteICPFlag(dim.key, id);
    }
  });
}

function showICPInlineForm(dim, type, editFlag, anchorEl) {
  // Remove any open form
  document.querySelectorAll('.icp-inline-form').forEach(f => f.remove());
  // Re-show any hidden flag being edited
  document.querySelectorAll('.icp-flag-card[data-hidden]').forEach(c => { c.style.display = ''; delete c.dataset.hidden; });

  const sev = editFlag ? (typeof editFlag.severity === 'number' ? editFlag.severity : 2) : (type === 'green' ? 3 : 3);
  const colors = type === 'green' ? SEV_GREEN_COLORS : SEV_RED_COLORS;
  const labels = type === 'green' ? SEV_GREEN_LABELS : SEV_RED_LABELS;
  const keywords = editFlag?.keywords || [];
  const formTitle = editFlag ? `Edit ${type} flag` : `New ${type} flag`;

  const form = document.createElement('div');
  form.className = `icp-inline-form ${type}`;
  form.innerHTML = `
    <div class="icp-inline-form-title">${formTitle.toUpperCase()}</div>
    <textarea placeholder="Describe what ${type === 'green' ? 'attracts you' : 'concerns you'} — Coop will match this against job postings" rows="3">${escHtml(editFlag?.text || '')}</textarea>
    <div class="icp-kw-input-row" id="icp-kw-row-${dim.key}">
      ${keywords.map(k => `<span class="icp-kw-pill">${escHtml(k)}<button class="icp-kw-pill-x" data-kw="${escHtml(k)}">×</button></span>`).join('')}
      ${keywords.length === 0 ? `<span class="icp-kw-placeholder">+ keyword</span>` : ''}
      <input class="icp-kw-text-input" type="text" placeholder="${keywords.length > 0 ? '+ keyword' : ''}" id="icp-kw-input-${dim.key}">
    </div>
    <div class="icp-sev-dim-row">
      <div class="icp-sev-pills-wrap">
        <label>${type === 'green' ? 'Importance' : 'Severity'}</label>
        <div class="icp-sev-pills" data-type="${type}">
          ${[1,2,3,4,5].map(n => `<button type="button" class="icp-sev-pill${sev === n ? ' active' : ''}" data-sev="${n}" style="--sev-color:${colors[n-1]}">${n}</button>`).join('')}
          <span class="icp-sev-label">${labels[sev-1]}</span>
        </div>
      </div>
      <div class="icp-dim-pills-wrap">
        <label>Scores toward</label>
        <div class="icp-dim-pills">
          ${ICP_DIMENSIONS.filter(d => !d.noFlags).map(d => `<button type="button" class="icp-dim-pill${(editFlag?.dimension || dim.key) === d.key ? ' active' : ''}" data-dim="${d.key}" style="--dim-color:${d.color}">${d.label}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="icp-form-btns">
      <button class="icp-form-cancel">Cancel</button>
      <button class="icp-form-save">Save flag</button>
    </div>`;

  // Hide the card being edited
  if (editFlag) {
    const card = document.querySelector(`.icp-flag-card[data-id="${editFlag.id}"]`);
    if (card) { card.style.display = 'none'; card.dataset.hidden = '1'; card.insertAdjacentElement('afterend', form); }
    else { anchorEl.insertAdjacentElement('beforebegin', form); }
  } else {
    // Insert before the add button
    anchorEl.insertAdjacentElement('beforebegin', form);
  }

  // Keyword input logic
  let currentKeywords = [...keywords];
  const kwRow = form.querySelector('.icp-kw-input-row');
  const kwInput = form.querySelector('.icp-kw-text-input');
  const kwPlaceholder = form.querySelector('.icp-kw-placeholder');

  function renderKwPills() {
    kwRow.innerHTML = '';
    currentKeywords.forEach(k => {
      const pill = document.createElement('span');
      pill.className = 'icp-kw-pill';
      pill.innerHTML = `${escHtml(k)}<button class="icp-kw-pill-x" type="button">×</button>`;
      pill.querySelector('.icp-kw-pill-x').addEventListener('click', () => {
        currentKeywords = currentKeywords.filter(kw => kw !== k);
        renderKwPills();
      });
      kwRow.appendChild(pill);
    });
    kwRow.appendChild(kwInput);
    kwInput.focus();
  }

  kwRow.addEventListener('click', () => kwInput.focus());
  kwInput.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && kwInput.value.trim()) {
      e.preventDefault();
      const kw = kwInput.value.trim().replace(/,$/, '');
      if (kw && !currentKeywords.includes(kw)) currentKeywords.push(kw);
      kwInput.value = '';
      renderKwPills();
    }
    if (e.key === 'Backspace' && !kwInput.value && currentKeywords.length) {
      currentKeywords.pop();
      renderKwPills();
    }
  });

  // Severity pill toggle
  form.querySelectorAll('.icp-sev-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      form.querySelectorAll('.icp-sev-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const sevLabel = form.querySelector('.icp-sev-label');
      if (sevLabel) sevLabel.textContent = labels[parseInt(pill.dataset.sev) - 1];
    });
  });

  // Dimension pill toggle
  form.querySelectorAll('.icp-dim-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      form.querySelectorAll('.icp-dim-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  form.querySelector('.icp-form-cancel').addEventListener('click', () => {
    form.remove();
    document.querySelectorAll('.icp-flag-card[data-hidden]').forEach(c => { c.style.display = ''; delete c.dataset.hidden; });
  });

  form.querySelector('.icp-form-save').addEventListener('click', () => {
    const text = form.querySelector('textarea').value.trim();
    if (!text) return;
    const severity = parseInt(form.querySelector('.icp-sev-pill.active')?.dataset.sev) || 3;

    // Add trailing keywords from input box if any
    const rawKw = kwInput.value.trim().replace(/,$/, '');
    if (rawKw && !currentKeywords.includes(rawKw)) currentKeywords.push(rawKw);

    const selectedDim = form.querySelector('.icp-dim-pill.active')?.dataset.dim || dim.key;
    if (editFlag) {
      updateICPFlag(type, editFlag.id, { text, severity, keywords: currentKeywords, dimension: selectedDim });
    } else {
      addICPFlag(type, { text, severity, keywords: currentKeywords, dimension: selectedDim });
    }
    form.remove();
  });
}

function addICPFlag(type, fields) {
  const storageKey = type === 'green' ? 'profileAttractedTo' : 'profileDealbreakers';
  // Read from storage first to avoid overwriting changes from other forms
  chrome.storage.local.get([storageKey], data => {
    const arr = data[storageKey] || [];
    const newFlag = { id: generateId(), category: 'other', source: 'manual', createdAt: Date.now(), ...fields };
    arr.push(newFlag);
    // Sync in-memory arrays
    if (type === 'green') _icpGreens = arr; else _icpReds = arr;
    chrome.storage.local.set({ [storageKey]: arr }, () => {
      showSaveStatus();
      const dim = ICP_DIMENSIONS.find(d => d.key === fields.dimension);
      if (dim) renderICPDimRow(dim);
    });
  });
}

function updateICPFlag(type, id, fields) {
  const storageKey = type === 'green' ? 'profileAttractedTo' : 'profileDealbreakers';
  // Read from storage first to avoid overwriting changes from other forms
  chrome.storage.local.get([storageKey], data => {
    const arr = data[storageKey] || [];
    const idx = arr.findIndex(f => f.id === id);
    if (idx === -1) return;
    const oldDim = arr[idx].dimension || 'roleFit';
    const wasICP = arr[idx].source === 'icp';
    arr[idx] = { ...arr[idx], ...fields };
    if (wasICP) arr[idx].manuallyEdited = true;
    // Sync in-memory arrays
    if (type === 'green') _icpGreens = arr; else _icpReds = arr;
    chrome.storage.local.set({ [storageKey]: arr }, () => {
      showSaveStatus();
      // Re-render new dimension
      const newDim = ICP_DIMENSIONS.find(d => d.key === fields.dimension);
      if (newDim) renderICPDimRow(newDim);
      // Also re-render old dimension if it changed (removes stale card)
      if (oldDim !== fields.dimension) {
        const old = ICP_DIMENSIONS.find(d => d.key === oldDim);
        if (old) renderICPDimRow(old);
      }
    });
  });
}

function deleteICPFlag(dimKey, id) {
  // Read from storage first to avoid overwriting changes from other forms
  chrome.storage.local.get(['profileAttractedTo', 'profileDealbreakers'], data => {
    let greens = data.profileAttractedTo || [];
    let reds = data.profileDealbreakers || [];
    const inGreens = greens.find(f => f.id === id);
    if (inGreens) {
      greens = greens.filter(f => f.id !== id);
      _icpGreens = greens;
      chrome.storage.local.set({ profileAttractedTo: greens }, () => showSaveStatus());
    } else {
      reds = reds.filter(f => f.id !== id);
      _icpReds = reds;
      chrome.storage.local.set({ profileDealbreakers: reds }, () => showSaveStatus());
    }
    const dim = ICP_DIMENSIONS.find(d => d.key === dimKey);
    if (dim) renderICPDimRow(dim);
  });
}

function toggleICPDim(key) {
  const body = document.getElementById(`dim-body-${key}`);
  const chev = document.getElementById(`dim-chev-${key}`);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  if (chev) chev.classList.toggle('open', isOpen);
}

// Called after autofill writes to storage — refreshes the visible ICP sections
function refreshICPScoring() {
  chrome.storage.local.get(['profileAttractedTo', 'profileDealbreakers'], data => {
    _icpGreens = data.profileAttractedTo  || [];
    _icpReds   = data.profileDealbreakers || [];
    ICP_DIMENSIONS.forEach(dim => renderICPDimRow(dim));
  });
}

function migrateToStructured(callback) {
  chrome.storage.local.get([
    'profileGreenLights', 'profileRedLights',
    'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags',
    'profileRoleICP', 'profileCompanyICP', 'profileInterviewLearnings',
    'scoringWeights',
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
    if (!data.profileRoleICP) migrations.profileRoleICP = { text: '', targetFunction: [], seniority: '', scope: '', sellingMotion: '', teamSizePreference: '' };
    if (!data.profileCompanyICP) migrations.profileCompanyICP = { text: '', stage: [], sizeRange: [], industryPreferences: [], cultureMarkers: [] };
    if (!data.profileInterviewLearnings) migrations.profileInterviewLearnings = [];

    // Init scoringWeights if missing
    if (!data.scoringWeights) migrations.scoringWeights = DEFAULT_SCORING_WEIGHTS;

    // Add dimension field to existing flags
    const { migrated: migratedGreens, dirty: greensDirty } =
      migrateFlagDimensions(migrations.profileAttractedTo || data.profileAttractedTo);
    const { migrated: migratedReds, dirty: redsDirty } =
      migrateFlagDimensions(migrations.profileDealbreakers || data.profileDealbreakers);
    if (greensDirty) migrations.profileAttractedTo = migratedGreens;
    if (redsDirty)   migrations.profileDealbreakers = migratedReds;

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
      // Sync ICP in-memory arrays so dimension accordion stays current
      if (storageKey === 'profileAttractedTo') _icpGreens = arr;
      else if (storageKey === 'profileDealbreakers') _icpReds = arr;
      ICP_DIMENSIONS.forEach(dim => renderICPDimRow(dim));
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
      if (storageKey === 'profileAttractedTo') _icpGreens = arr;
      else if (storageKey === 'profileDealbreakers') _icpReds = arr;
      ICP_DIMENSIONS.forEach(dim => renderICPDimRow(dim));
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
      if (storageKey === 'profileAttractedTo') _icpGreens = arr;
      else if (storageKey === 'profileDealbreakers') _icpReds = arr;
      ICP_DIMENSIONS.forEach(dim => renderICPDimRow(dim));
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

  const isGreen = storageKey === 'profileAttractedTo';
  const greenColors = ['#94a3b8','#86a88e','#4ade80','#22c55e','#16a34a'];
  const redColors   = ['#94a3b8','#eab308','#f97316','#ef4444','#dc2626'];
  const greenLabels = ['Nice perk','Good signal','Strong draw','Huge benefit','Dream factor'];
  const redLabels   = ['Minor','Preference','Notable','Serious concern','Disqualifier'];
  const sevColors = isGreen ? greenColors : redColors;
  const sevLabels = isGreen ? greenLabels : redLabels;

  // Group by category, sort each group by severity desc
  const groups = {};
  entries.forEach(e => {
    const k = e.category || 'other';
    if (!groups[k]) groups[k] = [];
    groups[k].push(e);
  });
  Object.values(groups).forEach(arr => arr.sort((a, b) => {
    const sa = typeof a.severity === 'number' ? a.severity : 2;
    const sb = typeof b.severity === 'number' ? b.severity : 2;
    return sb - sa;
  }));

  // Render in canonical category order, unknown cats appended at end
  const catOrder = STRUCTURED_CATEGORIES.map(c => c.key);
  const orderedKeys = [...catOrder.filter(k => groups[k]), ...Object.keys(groups).filter(k => !catOrder.includes(k))];

  listEl.innerHTML = orderedKeys.map(catKey => {
    const meta = getCatMeta(catKey);
    const groupEntries = groups[catKey];
    const maxSev = Math.max(...groupEntries.map(e => typeof e.severity === 'number' ? e.severity : 2));

    const entriesHtml = groupEntries.map(entry => {
      const sev = typeof entry.severity === 'number' ? entry.severity : 2;
      const sevDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sevColors[sev-1]};flex-shrink:0;" title="Priority ${sev} — ${sevLabels[sev-1]}"></span>`;
      return `
      <div class="structured-entry" data-id="${entry.id}">
        <div class="entry-content">
          <div style="display:flex;align-items:flex-start;gap:7px;">
            ${sevDot}
            <div style="flex:1;min-width:0;">
              <div class="entry-text" style="margin:0;">${escHtml(entry.text)}</div>
              ${entry.keywords?.length ? `<div class="entry-keywords" style="margin-top:4px;">${entry.keywords.map(k => `<span class="keyword-pill">${escHtml(k)}</span>`).join('')}</div>` : ''}
            </div>
          </div>
          <div style="font-size:10px;color:${sevColors[sev-1]};font-weight:700;margin-top:3px;padding-left:15px;">${sevLabels[sev-1]}</div>
        </div>
        <div class="entry-actions">
          <button class="entry-edit-btn" title="Edit">&#9998;</button>
          <button class="entry-delete-btn" title="Delete">&times;</button>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="flag-category-group" data-cat="${catKey}">
      <div class="flag-category-header" title="${escHtml(meta.tip)}">
        <span class="flag-cat-dot" style="background:${meta.color}"></span>
        <span class="flag-cat-label" style="color:${meta.color}">${meta.label}</span>
        <span class="flag-cat-count">${groupEntries.length}</span>
        <span class="flag-cat-tip-icon" title="${escHtml(meta.tip)}">?</span>
      </div>
      ${entriesHtml}
    </div>`;
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
    `<option value="${c.key}" ${editEntry?.category === c.key ? 'selected' : ''}>${c.label}</option>`
  ).join('');

  formWrap.innerHTML = `
    <div class="entry-form">
      <textarea class="field-input entry-form-text" placeholder="Describe this signal..." rows="2">${escHtml(editEntry?.text || '')}</textarea>
      <div class="entry-form-row" style="flex-wrap:wrap;gap:6px;">
        <select class="field-input entry-form-category" style="flex:1;min-width:140px;">${catOptions}</select>
        ${opts.showSeverity ? (() => {
          const isGreenForm = storageKey === 'profileAttractedTo';
          const sevColors = isGreenForm ? ['#94a3b8','#86a88e','#4ade80','#22c55e','#16a34a'] : ['#94a3b8','#eab308','#f97316','#ef4444','#dc2626'];
          const sevLabels = isGreenForm ? ['nice perk','good signal','strong draw','huge benefit','dream factor'] : ['minor','preference','notable','serious concern','disqualifier'];
          const current = editEntry?.severity ?? 2;
          const numSev = typeof current === 'number' ? current : (current === 'hard' ? 4 : 2);
          return `
          <div class="severity-scale" data-flag-type="${isGreenForm ? 'green' : 'red'}" style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:#6b7280;white-space:nowrap;">${isGreenForm ? 'Importance:' : 'Severity:'}</span>
            ${[1,2,3,4,5].map(n =>
              `<button class="sev-num-btn ${numSev === n ? 'active' : ''}" data-sev="${n}" style="width:28px;height:28px;border-radius:50%;border:2px solid ${sevColors[n-1]};background:${numSev === n ? sevColors[n-1] : 'transparent'};color:${numSev === n ? '#fff' : sevColors[n-1]};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">${n}</button>`
            ).join('')}
            <span style="font-size:10px;color:#94a3b8;margin-left:2px;">${sevLabels[numSev - 1]}</span>
          </div>`;
        })() : ''}
      </div>
      <div class="comp-threshold-row" style="display:${(storageKey === 'profileDealbreakers' && (editEntry?.category === 'comp')) ? 'flex' : 'none'};align-items:center;gap:8px;flex-wrap:wrap;">
        <select class="field-input comp-type-select" style="width:auto;font-size:12px;padding:4px 8px;">
          <option value="base" ${editEntry?.compType === 'base' || !editEntry?.compType ? 'selected' : ''}>Base salary</option>
          <option value="ote" ${editEntry?.compType === 'ote' ? 'selected' : ''}>OTE</option>
        </select>
        <span style="font-size:12px;color:#6B6560;">floor</span>
        <input type="text" class="field-input comp-threshold-input" placeholder="e.g. 150000" value="${editEntry?.compThreshold || ''}" style="width:100px;font-size:12px;padding:4px 8px;">
        <label style="font-size:11px;color:#6B6560;display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="comp-unknown-neutral" ${editEntry?.compUnknownNeutral !== false ? 'checked' : ''}> If not disclosed = neutral
        </label>
      </div>
      <div class="entry-form-row" style="gap:6px;flex-wrap:wrap;">
        <input type="text" class="field-input entry-form-keywords" placeholder="Keywords (comma-separated, e.g. grit, hustle)" value="${escHtml((editEntry?.keywords || []).join(', '))}" style="flex:1;min-width:200px;">
        <select class="field-input entry-form-dimension" style="width:auto;font-size:12px;padding:4px 8px;">
          <option value="roleFit" ${(editEntry?.dimension || CATEGORY_TO_DIMENSION[editEntry?.category] || 'roleFit') === 'roleFit' ? 'selected' : ''}>→ Role fit</option>
          <option value="cultureFit" ${(editEntry?.dimension || CATEGORY_TO_DIMENSION[editEntry?.category]) === 'cultureFit' ? 'selected' : ''}>→ Culture fit</option>
          <option value="companyFit" ${(editEntry?.dimension || CATEGORY_TO_DIMENSION[editEntry?.category]) === 'companyFit' ? 'selected' : ''}>→ Company fit</option>
          <option value="compFit" ${(editEntry?.dimension || CATEGORY_TO_DIMENSION[editEntry?.category]) === 'compFit' ? 'selected' : ''}>→ Comp fit</option>
        </select>
      </div>
      <label style="font-size:11px;color:var(--ci-text-secondary);display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0;">
        <input type="checkbox" class="entry-unknown-neutral" ${editEntry?.unknownNeutral !== false ? 'checked' : ''}>
        If not confirmed in job data = neutral <span style="color:var(--ci-text-tertiary)">(no score impact, Coop won't mention it)</span>
      </label>
      <div class="entry-form-actions">
        <button class="entry-form-save">${editEntry ? 'Update' : 'Add'}</button>
        <button class="entry-form-cancel">Cancel</button>
      </div>
    </div>`;

  // Category hint line — show what Coop scans for the selected category
  const catSelect = formWrap.querySelector('.entry-form-category');
  const compRow = formWrap.querySelector('.comp-threshold-row');

  const catHint = document.createElement('div');
  catHint.style.cssText = 'font-size:11px;color:var(--ci-text-tertiary);line-height:1.4;margin-top:2px;padding:0 2px;';
  catSelect?.parentNode.insertAdjacentElement('afterend', catHint);

  const dimSelect = formWrap.querySelector('.entry-form-dimension');
  const updateCatHint = () => {
    const meta = getCatMeta(catSelect?.value || '');
    catHint.textContent = meta.tip || '';
    if (compRow) compRow.style.display = (storageKey === 'profileDealbreakers' && catSelect?.value === 'comp') ? 'flex' : 'none';
    // Auto-sync dimension when category changes (unless user manually overrode)
    if (dimSelect && CATEGORY_TO_DIMENSION[catSelect?.value]) {
      dimSelect.value = CATEGORY_TO_DIMENSION[catSelect.value];
    }
  };
  catSelect?.addEventListener('change', updateCatHint);
  updateCatHint();

  // Severity scale toggle
  formWrap.querySelectorAll('.sev-num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const scaleEl = formWrap.querySelector('.severity-scale');
      const isGreenForm = scaleEl?.dataset.flagType === 'green';
      const colors = isGreenForm ? ['#94a3b8','#86a88e','#4ade80','#22c55e','#16a34a'] : ['#94a3b8','#eab308','#f97316','#ef4444','#dc2626'];
      const sevLabels = isGreenForm ? ['nice perk','good signal','strong draw','huge benefit','dream factor'] : ['minor','preference','notable','serious concern','disqualifier'];
      formWrap.querySelectorAll('.sev-num-btn').forEach(b => {
        b.classList.remove('active');
        const n = parseInt(b.dataset.sev);
        b.style.background = 'transparent';
        b.style.color = colors[n-1];
        b.style.borderColor = colors[n-1];
      });
      btn.classList.add('active');
      const n = parseInt(btn.dataset.sev);
      btn.style.background = colors[n-1];
      btn.style.color = '#fff';
      // Update label
      const label = formWrap.querySelector('.severity-scale span:last-child');
      if (label) label.textContent = sevLabels[n - 1];
    });
  });

  // Save
  formWrap.querySelector('.entry-form-save').addEventListener('click', () => {
    const text = formWrap.querySelector('.entry-form-text').value.trim();
    if (!text) return;
    const category = formWrap.querySelector('.entry-form-category').value;
    const keywords = formWrap.querySelector('.entry-form-keywords').value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const severity = parseInt(formWrap.querySelector('.sev-num-btn.active')?.dataset.sev) || 2;

    const dimension = formWrap.querySelector('.entry-form-dimension')?.value || CATEGORY_TO_DIMENSION[category] || 'roleFit';
    const entryData = { text, category, keywords, dimension, source: 'manual' };
    if (opts.showSeverity) entryData.severity = severity;
    // Unknown = neutral applies to all entries
    entryData.unknownNeutral = formWrap.querySelector('.entry-unknown-neutral')?.checked !== false;
    // Comp threshold fields (dealbreakers only)
    if (storageKey === 'profileDealbreakers' && category === 'comp') {
      const threshold = formWrap.querySelector('.comp-threshold-input')?.value.replace(/[^0-9]/g, '');
      if (threshold) entryData.compThreshold = parseInt(threshold);
      entryData.compType = formWrap.querySelector('.comp-type-select')?.value || 'base';
      entryData.compUnknownNeutral = entryData.unknownNeutral; // keep in sync for deterministic comp check
    }

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

// ── Skills & Intangibles auto-generate ──────────────────────────────────────

function initSkillsAutoGenerate() {
  const btn = document.getElementById('skills-coop-generate');
  const metaEl = document.getElementById('skills-autofill-meta');
  const editor = document.getElementById('profile-skills-rt');
  const hiddenTa = document.getElementById('profile-skills');
  if (!btn || !editor) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setCoopThinking(true, 'Analyzing skills');
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is analyzing your profile...';
    if (metaEl) metaEl.textContent = '';

    try {
      const data = await new Promise(r => chrome.storage.local.get([
        'profileResume', 'profileStory', 'profileExperience', 'profileExperienceEntries',
        'profileSkills', 'profilePrinciples', 'profileMotivators',
        'storyTime', 'profileSkillTags'
      ], r));

      const sources = [];
      let sourceContent = '';

      // Experience entries (structured)
      const expEntries = data.profileExperienceEntries || [];
      if (expEntries.length) {
        sources.push('Experience');
        sourceContent += '\n=== EXPERIENCE ENTRIES ===\n';
        expEntries.forEach(e => {
          sourceContent += `\n## ${e.company} (${e.dateRange || ''})\n`;
          if (e.titles) sourceContent += `Titles: ${e.titles}\n`;
          if (e.description) sourceContent += `${e.description}\n`;
          if (e.accomplishments) sourceContent += `Accomplishments: ${e.accomplishments}\n`;
          if (e.exposures) sourceContent += `Skills/Exposures: ${e.exposures}\n`;
        });
      }

      const resume = data.profileResume;
      if (resume?.content) {
        sources.push('Resume');
        sourceContent += `\n=== RESUME ===\n${resume.content.slice(0, 4000)}\n`;
      }
      const story = data.profileStory || data.storyTime?.rawInput;
      if (story) {
        sources.push('Story');
        sourceContent += `\n=== STORY ===\n${story.slice(0, 3000)}\n`;
      }
      const principles = data.profilePrinciples;
      if (principles) {
        sources.push('Principles');
        sourceContent += `\n=== OPERATING PRINCIPLES ===\n${principles.slice(0, 1500)}\n`;
      }
      const motivators = data.profileMotivators;
      if (motivators) {
        sources.push('Motivators');
        sourceContent += `\n=== MOTIVATORS ===\n${motivators.slice(0, 1500)}\n`;
      }
      const skillTags = data.profileSkillTags || [];
      if (skillTags.length) {
        sourceContent += `\n=== EXISTING SKILL TAGS ===\n${skillTags.join(', ')}\n`;
      }
      const stProfile = data.storyTime?.profileSummary;
      if (stProfile) {
        sourceContent += `\n=== STORY TIME PROFILE ===\n${stProfile.slice(0, 2000)}\n`;
      }

      if (!sourceContent.trim()) {
        setCoopThinking(false);
        btn.disabled = false;
        btn.textContent = 'Let Coop fill this in';
        if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-accent-red)">No profile data found — add experience or upload a resume first</span>';
        return;
      }

      const prompt = `Based on the following profile data, generate a comprehensive "Core Competencies & Intangibles" section. Use HTML formatting for rich display.

Structure it as:
1. Major competency categories as <h3> headings (e.g. "Revenue & Commercial Leadership", "GTM Strategy", "Technical Skills")
2. Under each heading, bold sub-themes with bullet points of specific capabilities
3. Include both hard skills (tools, methodologies, platforms) and soft skills (leadership style, deal instincts, relationship building)
4. Reference specific metrics, company names, and achievements from their experience
5. End with an "Intangibles" section covering what makes this person uniquely effective

Use these HTML tags: <h3> for headings, <b> for bold, <ul><li> for bullets, <p> for paragraphs.
Do NOT use markdown. Output only the HTML content, no wrapper tags.

${sourceContent}`;

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: [{ role: 'user', content: prompt }],
          globalChat: true,
          careerOSChat: true,
          chatModel: _coopModels.coopAutofill
        }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
      });

      if (result?.reply) {
        // Strip any markdown artifacts, keep HTML
        let html = result.reply
          .replace(/```html?\n?/g, '').replace(/```/g, '')
          .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          .replace(/^## (.+)$/gm, '<h3>$1</h3>')
          .replace(/^# (.+)$/gm, '<h3>$1</h3>')
          .replace(/^- (.+)$/gm, '<li>$1</li>')
          .trim();

        editor.innerHTML = html;
        if (hiddenTa) hiddenTa.value = html;
        saveBucket('profileSkills', html);
        showSaveStatus();

        // Show sources + token usage
        const usage = result.usage;
        let metaHtml = `<span class="source-label">Sources:</span> ${sources.join(', ')}`;
        if (usage) {
          const totalTokens = (usage.input || 0) + (usage.output || 0);
          metaHtml += ` <span class="exp-autofill-usage">${totalTokens.toLocaleString()} tokens</span>`;
        }
        if (metaEl) metaEl.innerHTML = metaHtml;
      } else if (result?.error) {
        if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-accent-red)">Coop couldn\'t generate skills — try again</span>';
      }
    } catch (err) {
      console.error('[SkillsGenerate] Error:', err);
      if (metaEl) metaEl.innerHTML = `<span style="color:var(--ci-accent-red)">Error: ${err.message}</span>`;
    }

    setCoopThinking(false);
    setCoopThinking(false);
    btn.disabled = false;
    btn.textContent = 'Let Coop fill this in';
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
    setCoopThinking(true, 'Filling in');
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is thinking...';

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: [{ role: 'user', content: `Based on everything you know about me — my story, experience, motivators, green lights, red lights, skills, and all our past conversations — fill in my Role ICP. Respond ONLY in JSON with these exact keys: {"text": "2-3 sentence freeform description of my ideal role", "targetFunction": ["array of job functions based on my background, e.g. Engineering, Product, Sales, Marketing"], "seniority": "e.g. VP, Director, IC", "scope": "e.g. Full P&L, Regional, Team of 10", "sellingMotion": "e.g. Enterprise, PLG, Mid-market (or leave blank if not applicable)", "teamSizePreference": "e.g. 5-15 direct reports"}. targetFunction must be an array of strings derived from my actual background — do not default to sales functions unless my profile clearly indicates that.` }],
          globalChat: true,
          careerOSChat: true,
          chatModel: _coopModels.coopAutofill
        }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
      });

      if (result?.reply) {
        const match = result.reply.match(/\{[\s\S]*\}/);
        if (match) {
          const data = JSON.parse(match[0]);
          // Only fill empty fields — never overwrite user's manual entries
          const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = val; };
          const fillPicklistIfEmpty = (id, val, options, saveFn) => {
            const current = getPicklistValues(id, options);
            if (current.length === 0 && val) {
              const arr = normalizeToArray(val);
              if (arr.length) renderPicklist(id, options, arr, saveFn);
            }
          };
          fillIfEmpty('role-icp-text', data.text);
          fillPicklistIfEmpty('role-icp-function', data.targetFunction, ICP_PICKLIST_OPTIONS.targetFunction, saveRoleICP);
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
    setCoopThinking(false);
    btn.disabled = false;
    btn.textContent = 'Let Coop fill this in';
  });

  document.getElementById('company-icp-autofill')?.addEventListener('click', async function() {
    const btn = this;
    btn.disabled = true;
    setCoopThinking(true, 'Filling in');
    btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is thinking...';

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: [{ role: 'user', content: `Based on everything you know about me — my story, experience, motivators, green lights, red lights, skills, and all our past conversations — fill in my Company ICP. Respond ONLY in JSON with these exact keys: {"text": "2-3 sentence freeform description of my ideal company", "stage": ["Series B", "Series C"], "sizeRange": ["51-200", "201-500"], "industryPreferences": ["SaaS", "FinTech"], "cultureMarkers": ["transparent", "ownership"]}. stage, sizeRange, and industryPreferences must be arrays of strings.` }],
          globalChat: true,
          careerOSChat: true,
          chatModel: _coopModels.coopAutofill
        }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
      });

      if (result?.reply) {
        const match = result.reply.match(/\{[\s\S]*\}/);
        if (match) {
          const data = JSON.parse(match[0]);
          // Only fill empty fields — never overwrite user's manual entries
          const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = typeof val === 'string' ? val : Array.isArray(val) ? val.join(', ') : val; };
          const fillPicklistIfEmpty = (id, val, options, saveFn) => {
            const current = getPicklistValues(id, options);
            if (current.length === 0 && val) {
              const arr = normalizeToArray(val);
              if (arr.length) renderPicklist(id, options, arr, saveFn);
            }
          };
          fillIfEmpty('company-icp-text', data.text);
          fillPicklistIfEmpty('company-icp-stage', data.stage, ICP_PICKLIST_OPTIONS.stage, saveCompanyICP);
          fillPicklistIfEmpty('company-icp-size', data.sizeRange, ICP_PICKLIST_OPTIONS.sizeRange, saveCompanyICP);
          fillPicklistIfEmpty('company-icp-industries', data.industryPreferences, ICP_PICKLIST_OPTIONS.industryPreferences, saveCompanyICP);
          fillIfEmpty('company-icp-culture', data.cultureMarkers);
          saveCompanyICP();
        }
      }
    } catch (err) {
      console.error('[ICP Autofill] Error:', err);
    }
    setCoopThinking(false);
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
            careerOSChat: true,
            chatModel: _coopModels.coopAutofill
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
                  refreshICPScoring();
                });
              });
            }
          }
        }
      } catch (err) {
        console.error('[Flags Autofill] Error:', err);
      }
      setCoopThinking(false);
      btn.disabled = false;
      btn.textContent = 'Let Coop fill this in';
    });
  }

  autofillFlags('green-flags-autofill', 'profileAttractedTo', 'attracted-to-entries', { showSeverity: true },
    `Based on everything you know about me — my story, experience, motivators, skills, past conversations, and learned insights — generate my green flags (things that attract me to opportunities). Respond ONLY with a JSON array: [{"text": "description", "category": "role_type|industry|culture|product|team_structure|comp|location|other", "keywords": ["keyword1", "keyword2"]}]. Include 5-8 entries. Keywords should be specific terms that would appear in job postings.`
  );

  autofillFlags('red-flags-autofill', 'profileDealbreakers', 'dealbreaker-entries', { showSeverity: true },
    `Based on everything you know about me — my story, experience, motivators, skills, past conversations, and learned insights — generate my red flags (dealbreakers). Respond ONLY with a JSON array: [{"text": "description", "category": "role_type|industry|culture|product|team_structure|comp|location|other", "severity": "hard|soft", "keywords": ["keyword1", "keyword2"]}]. Include 5-8 entries. Use "hard" for absolute dealbreakers, "soft" for preferences. Keywords should be specific terms that would appear in job postings.`
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
      setCoopThinking(true, 'Rating severity');
      btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is rating...';

      const entrySummary = entries.map((e, i) => `${i}: "${e.text}" [${e.category}]`).join('\n');
      const prompt = `Based on everything you know about this person — their story, experience, motivators, values, career goals, and past conversations — rate the severity/importance of each ${flagType} flag on a 1-5 scale.

Scale:
${flagType === 'green' ? `1 = Nice Perk (small positive, won't move the needle alone)
2 = Good Signal (notable positive, slight scoring boost)
3 = Strong Draw (significant attractor, meaningful boost)
4 = Huge Benefit (major draw, this makes a role exciting)
5 = Dream Factor (the kind of thing that makes a role a dream job)` : `1 = Minor (nice to have, won't reject over this)
2 = Preference (notable, slight scoring impact)
3 = Notable (significant factor, meaningful impact)
4 = Serious concern (major red flag, strong scoring impact)
5 = Disqualifier (basic qualification issue — e.g. location, legal, can't work there at all)`}

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
            careerOSChat: true,
            chatModel: _coopModels.coopAutofill
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
      setCoopThinking(false);
      btn.disabled = false;
      btn.textContent = 'Have Coop rate severity';
    });
  }

  rateSeverity('green-flags-rate', 'profileAttractedTo', 'attracted-to-entries', { showSeverity: true }, 'green');
  rateSeverity('red-flags-rate', 'profileDealbreakers', 'dealbreaker-entries', { showSeverity: true }, 'red');
}

// ── Picklist definitions ──
const ICP_PICKLIST_OPTIONS = {
  targetFunction: [
    'GTM', 'Sales', 'Revenue Operations', 'Account Management',
    'Customer Success', 'Marketing', 'Business Development',
    'Partnerships', 'Sales Engineering', 'Product Marketing'
  ],
  stage: [
    'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C',
    'Series D+', 'Growth', 'Public', 'Bootstrapped'
  ],
  sizeRange: [
    '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+'
  ],
  industryPreferences: [
    'SaaS', 'AI/ML', 'FinTech', 'HealthTech', 'DevTools',
    'Infrastructure', 'Security', 'E-Commerce', 'EdTech',
    'MarTech', 'RevTech', 'Data & Analytics', 'Cloud', 'Enterprise Software'
  ]
};

function normalizeToArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) return val.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function renderPicklist(containerId, options, selectedValues, onChangeCb) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const selected = new Set(selectedValues);

  // Render predefined chips
  options.forEach(opt => {
    const chip = document.createElement('span');
    chip.className = 'icp-chip' + (selected.has(opt) ? ' selected' : '');
    chip.textContent = opt;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      onChangeCb();
    });
    container.appendChild(chip);
  });

  // Render custom values (not in predefined list)
  selectedValues.filter(v => !options.includes(v)).forEach(custom => {
    appendCustomChip(container, custom, onChangeCb);
  });

  // "+ Add" button
  const addBtn = document.createElement('button');
  addBtn.className = 'icp-add-custom';
  addBtn.textContent = '+ Other';
  addBtn.addEventListener('click', () => {
    addBtn.style.display = 'none';
    const input = document.createElement('input');
    input.className = 'icp-custom-input';
    input.placeholder = 'Type & press Enter';
    container.appendChild(input);
    input.focus();
    const commit = () => {
      const val = input.value.trim();
      input.remove();
      addBtn.style.display = '';
      if (val && !getPicklistValues(containerId, options).includes(val)) {
        appendCustomChip(container, val, onChangeCb);
        container.appendChild(addBtn); // move add button to end
        onChangeCb();
      }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { input.remove(); addBtn.style.display = ''; } });
    input.addEventListener('blur', commit);
  });
  container.appendChild(addBtn);
}

function appendCustomChip(container, value, onChangeCb) {
  const chip = document.createElement('span');
  chip.className = 'icp-chip-custom';
  chip.dataset.customValue = value;
  chip.innerHTML = `${escHtml(value)} <button class="chip-remove">&times;</button>`;
  chip.querySelector('.chip-remove').addEventListener('click', () => {
    chip.remove();
    onChangeCb();
  });
  // Insert before the "+ Other" button
  const addBtn = container.querySelector('.icp-add-custom');
  if (addBtn) container.insertBefore(chip, addBtn);
  else container.appendChild(chip);
}

function getPicklistValues(containerId, options) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const values = [];
  // Selected predefined chips
  container.querySelectorAll('.icp-chip.selected').forEach(chip => values.push(chip.textContent));
  // Custom chips
  container.querySelectorAll('.icp-chip-custom').forEach(chip => values.push(chip.dataset.customValue));
  return values;
}

function initICPFields() {
  // Text fields (unchanged)
  const roleTextFields = ['role-icp-text', 'role-icp-seniority', 'role-icp-scope', 'role-icp-selling-motion', 'role-icp-team-size'];
  const companyTextFields = ['company-icp-text', 'company-icp-culture'];

  chrome.storage.local.get(['profileRoleICP', 'profileCompanyICP'], data => {
    const role = data.profileRoleICP || {};
    const company = data.profileCompanyICP || {};

    setVal('role-icp-text', role.text);
    setVal('role-icp-seniority', role.seniority);
    setVal('role-icp-scope', role.scope);
    setVal('role-icp-selling-motion', role.sellingMotion);
    setVal('role-icp-team-size', role.teamSizePreference);

    setVal('company-icp-text', company.text);
    setVal('company-icp-culture', (company.cultureMarkers || []).join(', '));

    // Picklists
    renderPicklist('role-icp-function', ICP_PICKLIST_OPTIONS.targetFunction, normalizeToArray(role.targetFunction), saveRoleICP);
    renderPicklist('company-icp-stage', ICP_PICKLIST_OPTIONS.stage, normalizeToArray(company.stage), saveCompanyICP);
    renderPicklist('company-icp-size', ICP_PICKLIST_OPTIONS.sizeRange, normalizeToArray(company.sizeRange), saveCompanyICP);
    renderPicklist('company-icp-industries', ICP_PICKLIST_OPTIONS.industryPreferences, normalizeToArray(company.industryPreferences), saveCompanyICP);

    // Re-check see more/less for ICP textareas now that content is loaded
    setTimeout(() => {
      ['role-icp-text', 'company-icp-text'].forEach(id => {
        const ta = document.getElementById(id);
        if (!ta) return;
        const btn = ta.nextElementSibling;
        if (btn?.classList?.contains('ta-see-more')) {
          btn.classList.toggle('visible', ta.scrollHeight > 84);
        }
      });
    }, 100);
  });

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }

  // Auto-save on blur for remaining text fields
  roleTextFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', saveRoleICP);
  });
  companyTextFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', saveCompanyICP);
  });
}

function saveRoleICP() {
  const gv = id => (document.getElementById(id)?.value || '').trim();
  const icp = {
    text: gv('role-icp-text'),
    targetFunction: getPicklistValues('role-icp-function', ICP_PICKLIST_OPTIONS.targetFunction),
    seniority: gv('role-icp-seniority'),
    scope: gv('role-icp-scope'),
    sellingMotion: gv('role-icp-selling-motion'),
    teamSizePreference: gv('role-icp-team-size'),
  };
  chrome.storage.local.set({ profileRoleICP: icp }, () => {
    void chrome.runtime.lastError;
    showSaveStatus();
    syncICPFlags();
  });
}

function saveCompanyICP() {
  const gv = id => (document.getElementById(id)?.value || '').trim();
  const icp = {
    text: gv('company-icp-text'),
    stage: getPicklistValues('company-icp-stage', ICP_PICKLIST_OPTIONS.stage),
    sizeRange: getPicklistValues('company-icp-size', ICP_PICKLIST_OPTIONS.sizeRange),
    industryPreferences: getPicklistValues('company-icp-industries', ICP_PICKLIST_OPTIONS.industryPreferences),
    cultureMarkers: gv('company-icp-culture').split(',').map(s => s.trim()).filter(Boolean),
  };
  chrome.storage.local.set({ profileCompanyICP: icp }, () => {
    void chrome.runtime.lastError;
    showSaveStatus();
    syncICPFlags();
  });
}

// ── ICP → Flags auto-sync ────────────────────────────────────────────────────

function generateFlagsFromICP(prefs, roleICP, companyICP) {
  const green = [], red = [];
  const now = Date.now();

  function mkFlag(icpKey, text, dimension, severity, keywords, category, isRed) {
    return {
      id: `icp_${icpKey}`, text,
      category,
      keywords: keywords || [],
      dimension, severity,
      source: 'icp', icpKey,
      createdAt: now,
      unknownNeutral: !isRed,
    };
  }

  // ── Work arrangement ──────────────────────────────────────────────────────
  const arr = (prefs.workArrangement || []).filter(Boolean);
  const willRemote = arr.some(a => /^remote$/i.test(a));
  const willHybrid = arr.some(a => /^hybrid$/i.test(a));
  const willOnsite = arr.some(a => /on.?site|onsite/i.test(a));
  const acceptCount = (willRemote ? 1 : 0) + (willHybrid ? 1 : 0) + (willOnsite ? 1 : 0);

  if (acceptCount > 0 && acceptCount < 3) {
    const labelParts = [], kwParts = [];
    if (willRemote)  { labelParts.push('Remote');    kwParts.push('remote', 'remote-first', 'work from home', 'fully remote', 'distributed'); }
    if (willHybrid)  { labelParts.push('Hybrid');    kwParts.push('hybrid'); }
    if (willOnsite)  { labelParts.push('In-office'); kwParts.push('in-office', 'on-site', 'onsite', 'office'); }
    green.push(mkFlag('work_arr', `${labelParts.join(' / ')} work arrangement preferred`,
      'roleFit', 3, kwParts, 'location', false));

    if (!willOnsite && !willHybrid) {
      // Remote-only: any office attendance is a hard DQ
      red.push(mkFlag('work_arr_office_req', 'In-office or hybrid attendance required',
        'roleFit', 5,
        ['in-office', 'on-site', 'onsite', 'office required', 'hybrid required', 'days in office', 'in office'],
        'location', true));
    } else if (!willOnsite) {
      // Remote + hybrid: fully in-office is a strong concern
      red.push(mkFlag('work_arr_no_onsite', 'Fully in-office required (no remote or hybrid option)',
        'roleFit', 4,
        ['fully in-office', 'in-office only', '5 days in office', 'no remote', 'office required'],
        'location', true));
    }
    if (!willRemote && !willHybrid) {
      // Onsite-only: remote-only is a concern
      red.push(mkFlag('work_arr_remote_only', 'Remote-only, no in-office presence possible',
        'roleFit', 4,
        ['remote only', 'fully remote', '100% remote', 'distributed only', 'no office'],
        'location', true));
    } else if (!willRemote && willHybrid) {
      // Hybrid + onsite: remote-only is a mild concern
      red.push(mkFlag('work_arr_remote_only', 'Remote-only, no office presence option',
        'roleFit', 3,
        ['remote only', 'fully remote', '100% remote'],
        'location', true));
    }
  }

  // ── Role ICP ─────────────────────────────────────────────────────────────
  if (roleICP) {
    const { targetFunction, seniority, scope, sellingMotion } = roleICP;
    if (targetFunction?.length) {
      green.push(mkFlag('role_function',
        `Target function: ${targetFunction.join(', ')}`,
        'roleFit', 3,
        targetFunction.map(f => f.toLowerCase()),
        'role_type', false));
    }
    if (seniority?.trim()) {
      green.push(mkFlag('role_seniority',
        `Seniority: ${seniority.trim()}`,
        'roleFit', 3,
        seniority.split(/[,\/\s]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 1),
        'role_type', false));
    }
    if (scope?.trim()) {
      green.push(mkFlag('role_scope',
        `Role scope: ${scope.trim()}`,
        'roleFit', 2,
        scope.split(/[,\/]/).map(s => s.trim().toLowerCase()).filter(Boolean),
        'role_type', false));
    }
    if (sellingMotion?.trim()) {
      green.push(mkFlag('role_selling_motion',
        `Selling motion: ${sellingMotion.trim()}`,
        'roleFit', 2,
        sellingMotion.split(/[,\/]/).map(s => s.trim().toLowerCase()).filter(Boolean),
        'role_type', false));
    }
  }

  // ── Company ICP ──────────────────────────────────────────────────────────
  if (companyICP) {
    const { stage, sizeRange, industryPreferences, cultureMarkers } = companyICP;
    if (stage?.length) {
      green.push(mkFlag('co_stage',
        `Company stage: ${stage.join(', ')}`,
        'companyFit', 3,
        stage.map(s => s.toLowerCase()),
        'product', false));
    }
    if (sizeRange?.length) {
      green.push(mkFlag('co_size',
        `Company size: ${sizeRange.join(', ')} employees`,
        'companyFit', 2,
        sizeRange,
        'product', false));
    }
    if (industryPreferences?.length) {
      green.push(mkFlag('co_industry',
        `Industry: ${industryPreferences.join(', ')}`,
        'companyFit', 2,
        industryPreferences.map(s => s.toLowerCase()),
        'industry', false));
    }
    if (cultureMarkers?.length) {
      const markers = cultureMarkers.filter(m => m.trim());
      if (markers.length) {
        green.push(mkFlag('co_culture',
          markers.join(', '),
          'cultureFit', 2,
          markers.map(m => m.toLowerCase()),
          'culture', false));
      }
    }
  }

  return { green, red };
}

function syncICPFlags(onDone) {
  chrome.storage.local.get(['profileAttractedTo', 'profileDealbreakers', 'profileRoleICP', 'profileCompanyICP'], localData => {
    chrome.storage.sync.get(['prefs'], syncData => {
      void chrome.runtime.lastError;
      const prefs = syncData.prefs || {};
      const roleICP = localData.profileRoleICP || {};
      const companyICP = localData.profileCompanyICP || {};
      const { green: newGreens, red: newReds } = generateFlagsFromICP(prefs, roleICP, companyICP);

      // Remove old ICP-sourced flags (preserve any the user has manually edited)
      const greens = (localData.profileAttractedTo || []).filter(f => f.source !== 'icp' || f.manuallyEdited);
      const reds   = (localData.profileDealbreakers || []).filter(f => f.source !== 'icp' || f.manuallyEdited);

      const finalGreens = [...greens, ...newGreens];
      const finalReds   = [...reds, ...newReds];

      chrome.storage.local.set({ profileAttractedTo: finalGreens, profileDealbreakers: finalReds }, () => {
        void chrome.runtime.lastError;
        _icpGreens = finalGreens;
        _icpReds   = finalReds;
        ICP_DIMENSIONS.forEach(dim => renderICPDimRow(dim));
        if (onDone) onDone();
      });
    });
  });
}

// ── Interview learnings ─────────────────────────────────────────────────────

function initInterviewLearnings() {
  const container = document.getElementById('learnings-container');
  if (!container) return;

  chrome.storage.local.get(['profileInterviewLearnings'], data => {
    // Filter out corrupted entries with no text
    const clean = (data.profileInterviewLearnings || []).filter(e => e.text?.trim());
    if (clean.length !== (data.profileInterviewLearnings || []).length) {
      chrome.storage.local.set({ profileInterviewLearnings: clean }); // auto-fix
    }
    renderLearnings(clean);
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
    { id: 'gpt-4.1-nano',              label: 'GPT-4.1 Nano',       icon: '◆', cost: '$',   tier: 'Fastest',       provider: 'openai' },
    { id: 'gemini-2.0-flash-lite',     label: 'Gemini Flash-Lite',  icon: '✦', cost: '$',   tier: 'Cheapest',      provider: 'gemini' },
    { id: 'gpt-4.1-mini',              label: 'GPT-4.1 Mini',       icon: '◆', cost: '$',   tier: 'Fast & cheap',  provider: 'openai' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku',       icon: '⚡', cost: '$',   tier: 'Fast & cheap',  provider: 'anthropic' },
    { id: 'gemini-2.0-flash',          label: 'Gemini Flash',       icon: '✦', cost: '$',   tier: 'Fast & cheap',  provider: 'gemini' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',  icon: '✦', cost: '$$',  tier: 'Balanced',      provider: 'anthropic' },
    { id: 'gpt-4.1',                   label: 'GPT-4.1',            icon: '◆', cost: '$$',  tier: 'Balanced',      provider: 'openai' },
    { id: 'gpt-5',                     label: 'GPT-5',              icon: '◆', cost: '$$$', tier: 'Most capable',  provider: 'openai' },
    { id: 'claude-opus-4-0-20250514',  label: 'Claude Opus',        icon: '★', cost: '$$$', tier: 'Most capable',  provider: 'anthropic' },
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
        if (m.provider === 'gemini') return !!status.gemini;
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
  window.__coopChatHistory = chatHistory;
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
      appendMessage('assistant', "Hey! I can see your full profile. Ask me anything — or tell me something and I'll propose an update.\n\nTry: *\"Add a dealbreaker for grit culture\"* or *\"What are my dealbreakers?\"*");
    }
  });
  // Docked mode removed — drawer is toggle-only now
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
    window.dispatchEvent(new Event('coop-chat-history-changed'));
    setCoopThinking(true, 'Thinking');

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
        window.dispatchEvent(new Event('coop-chat-history-changed'));
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
    } finally {
      setCoopThinking(false);
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
    'gpt-4.1-mini':           { input: 0.40,  output: 1.60 },
    'gpt-4.1-nano':           { input: 0.10,  output: 0.40 },
    'gpt-4.1':                { input: 2.00,  output: 8.00 },
    'gpt-5':                  { input: 10.00, output: 30.00 },
    'claude-haiku':           { input: 0.25,  output: 1.25 },
    'claude-sonnet':          { input: 3.00,  output: 15.00 },
    'claude-opus':            { input: 15.00, output: 75.00 },
    'gemini-2.0-flash':       { input: 0.10,  output: 0.40 },
    'gemini-2.0-flash-lite':  { input: 0.05,  output: 0.20 },
  };
  // Match model ID to rates
  const key = Object.keys(rates).find(k => modelId?.toLowerCase().includes(k.replace('claude-', ''))) || 'gpt-4.1-mini';
  const r = rates[key];
  const cost = (inputTokens / 1_000_000 * r.input) + (outputTokens / 1_000_000 * r.output);
  return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3);
}

// ── Structured Experience Entries ────────────────────────────────────────────

const EXPERIENCE_TAG_VOCAB = [
  // Industries / verticals
  'martech', 'adtech', 'salestech', 'revops', 'fintech', 'healthtech', 'edtech', 'logistics', 'supply chain',
  'demo automation', 'conversational AI', 'sales enablement', 'marketing automation', 'CDP', 'CRM',
  'analytics', 'data infrastructure', 'developer tools', 'vertical SaaS', 'horizontal SaaS', 'cybersecurity', 'HR tech', 'legaltech', 'proptech', 'insurtech',
  // Stage / business model
  'B2B SaaS', 'B2C', 'AI-native', 'PLG', 'enterprise', 'mid-market', 'SMB', 'startup', 'seed', 'series A', 'series B', 'series C', 'pre-IPO', 'public company', 'bootstrapped',
  // Role context
  'GTM', 'founding AE', 'first sales hire', 'IC', 'player-coach', 'people manager', 'sales leadership', 'team builder',
  // GTM motion
  'inbound', 'outbound', 'channel', 'partnerships', 'land and expand', 'expansion', 'renewals', 'new logo',
  // Skills / craft
  'pricing strategy', 'forecasting', 'pipeline management', 'discovery', 'demos', 'negotiation', 'closing',
  'territory planning', 'quota carrying', 'enterprise selling', 'multi-threading', 'C-suite selling',
  'customer success', 'onboarding', 'implementation', 'GTM ops', 'rev ops', 'sales engineering', 'competitive selling', 'strategic accounts',
  // Tools & tech stack
  'Salesforce', 'HubSpot', 'Outreach', 'Salesloft', 'Gong', 'Chorus', 'ZoomInfo', 'Apollo', 'LinkedIn Sales Navigator',
  'Slack', 'Notion', 'Asana', 'Looker', 'Tableau', 'Marketo', 'Pardot',
  // Methodologies
  'MEDDIC', 'MEDDPICC', 'Challenger', 'Sandler', 'SPIN', 'Command of the Message', 'Force Management', 'SPICED', 'Gap Selling',
  // Deal context
  'six-figure ACV', 'seven-figure ACV', 'transactional', 'complex sales', 'long sales cycle', 'short sales cycle', 'PLG-assisted', 'product-led sales'
];

// Dimension metadata — used to color-code chips
const TAG_DIMENSIONS = {
  industry:  { label: 'Industry',    color: '#d97706' },
  stage:     { label: 'Stage',       color: '#7c3aed' },
  role:      { label: 'Role',        color: '#059669' },
  motion:    { label: 'Motion',      color: '#0d9488' },
  skills:    { label: 'Skills',      color: '#2563eb' },
  tools:     { label: 'Tools',       color: '#6b7280' },
  deal:      { label: 'Deal',        color: '#e11d48' },
};

const TAG_DIMENSION_MAP = (() => {
  const m = {};
  const assign = (dim, tags) => tags.forEach(t => { m[t.toLowerCase()] = dim; });
  assign('industry', ['martech','adtech','salestech','revops','fintech','healthtech','edtech','logistics','supply chain','demo automation','conversational AI','sales enablement','marketing automation','CDP','CRM','analytics','data infrastructure','developer tools','vertical SaaS','horizontal SaaS','cybersecurity','HR tech','legaltech','proptech','insurtech']);
  assign('stage', ['B2B SaaS','B2C','AI-native','PLG','enterprise','mid-market','SMB','startup','seed','series A','series B','series C','pre-IPO','public company','bootstrapped']);
  assign('role', ['GTM','founding AE','first sales hire','IC','player-coach','people manager','sales leadership','team builder']);
  assign('motion', ['inbound','outbound','channel','partnerships','land and expand','expansion','renewals','new logo']);
  assign('skills', ['pricing strategy','forecasting','pipeline management','discovery','demos','negotiation','closing','territory planning','quota carrying','enterprise selling','multi-threading','C-suite selling','customer success','onboarding','implementation','GTM ops','rev ops','sales engineering','competitive selling','strategic accounts']);
  assign('tools', ['Salesforce','HubSpot','Outreach','Salesloft','Gong','Chorus','ZoomInfo','Apollo','LinkedIn Sales Navigator','Slack','Notion','Asana','Looker','Tableau','Marketo','Pardot','MEDDIC','MEDDPICC','Challenger','Sandler','SPIN','Command of the Message','Force Management','SPICED','Gap Selling']);
  assign('deal', ['six-figure ACV','seven-figure ACV','transactional','complex sales','long sales cycle','short sales cycle','PLG-assisted','product-led sales']);
  return m;
})();

function getTagDim(tag) {
  return TAG_DIMENSIONS[TAG_DIMENSION_MAP[(tag || '').toLowerCase()]] || null;
}

function tagChipHtml(tag, idx, suggested = false) {
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
  const dim = getTagDim(tag);
  const dot = dim ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dim.color};flex-shrink:0;margin-right:2px;" title="${dim.label}"></span>` : '';
  const title = dim ? `${dim.label}: ${tag}` : tag;
  if (suggested) {
    return `<span class="exp-tag suggested" data-idx="${idx}" data-tag="${esc(tag)}" title="Click to accept — ${title}">${dot}${esc(tag)}<span class="exp-tag-x suggested-x" data-idx="${idx}" data-tag="${esc(tag)}" title="Reject">×</span></span>`;
  }
  return `<span class="exp-tag" data-tag="${esc(tag)}" title="${title}">${dot}${esc(tag)}<span class="exp-tag-x" data-idx="${idx}" data-tag="${esc(tag)}" title="Remove">×</span></span>`;
}

function initStructuredExperience() {
  const list = document.getElementById('experience-entries-list');
  const addBtn = document.getElementById('experience-add-btn');
  const hiddenTa = document.getElementById('profile-experience');
  if (!list || !addBtn) return;

  // Shared datalist for tag autocomplete
  if (!document.getElementById('exp-tag-datalist')) {
    const dl = document.createElement('datalist');
    dl.id = 'exp-tag-datalist';
    dl.innerHTML = EXPERIENCE_TAG_VOCAB.map(t => `<option value="${t}">`).join('');
    document.body.appendChild(dl);
  }

  let entries = [];

  chrome.storage.local.get(['profileExperienceEntries'], d => {
    entries = d.profileExperienceEntries || [];
    renderEntries();
  });

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function getTagDimFinal(tag, entry) {
    const fromVocab = TAG_DIMENSION_MAP[(tag || '').toLowerCase()];
    if (fromVocab) return TAG_DIMENSIONS[fromVocab] || null;
    const customDim = (entry?.customTagDims || {})[tag];
    if (customDim) return TAG_DIMENSIONS[customDim] || null;
    return null;
  }

  function tagChipHtmlEntry(tag, idx, suggested, entry) {
    const dim = getTagDimFinal(tag, entry);
    const dot = dim ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dim.color};flex-shrink:0;" title="${dim.label}"></span>` : '';
    const title = dim ? `${dim.label}: ${tag}` : tag;
    if (suggested) {
      return `<span class="exp-tag suggested" data-idx="${idx}" data-tag="${esc(tag)}" title="Click to accept — ${title}">${dot}${esc(tag)}<span class="exp-tag-x suggested-x" data-idx="${idx}" data-tag="${esc(tag)}" title="Reject">×</span></span>`;
    }
    return `<span class="exp-tag" data-tag="${esc(tag)}" title="${title}">${dot}${esc(tag)}<span class="exp-tag-x" data-idx="${idx}" data-tag="${esc(tag)}" title="Remove">×</span></span>`;
  }

  function buildTagSectionHtml(e, i) {
    const dimOrder = ['industry','stage','role','motion','skills','tools','deal'];
    const groups = {};
    (e.tags || []).forEach(t => {
      const dimKey = TAG_DIMENSION_MAP[(t||'').toLowerCase()] || (e.customTagDims||{})[t] || 'other';
      if (!groups[dimKey]) groups[dimKey] = { accepted: [], suggested: [] };
      groups[dimKey].accepted.push(t);
    });
    (e.suggestedTags || []).filter(t => !(e.tags||[]).includes(t)).forEach(t => {
      const dimKey = TAG_DIMENSION_MAP[(t||'').toLowerCase()] || 'other';
      if (!groups[dimKey]) groups[dimKey] = { accepted: [], suggested: [] };
      groups[dimKey].suggested.push(t);
    });

    const renderDimRow = (dimKey) => {
      const g = groups[dimKey];
      if (!g || (g.accepted.length + g.suggested.length === 0)) return '';
      const dimMeta = TAG_DIMENSIONS[dimKey] || { label: 'Other', color: '#9ca3af' };
      const chips = [
        ...g.accepted.map(t => tagChipHtmlEntry(t, i, false, e)),
        ...g.suggested.map(t => tagChipHtmlEntry(t, i, true, e))
      ].join('');
      return `<div class="exp-dim-row">
        <span class="exp-dim-label" style="color:${dimMeta.color}">${dimMeta.label}</span>
        <div class="exp-dim-chips">${chips}</div>
        <button class="exp-dim-add" data-idx="${i}" data-dim="${dimKey}" title="Add ${dimMeta.label} tag">+</button>
      </div>`;
    };

    const rows = [...dimOrder, 'other'].map(renderDimRow).filter(Boolean).join('');

    return `<div class="exp-tag-section" data-idx="${i}">
      ${rows || '<span style="color:var(--ci-text-tertiary);font-size:11px;padding-left:70px">No tags yet — click &quot;+ Add tag&quot; or use Coop to suggest</span>'}
      <div class="exp-tag-add-row">
        <button class="exp-tag-add" data-idx="${i}">+ Add tag</button>
      </div>
    </div>`;
  }

  function renderEntries() {
    list.innerHTML = entries.map((e, i) => `
      <div class="exp-entry" data-idx="${i}">
        <button class="exp-entry-delete" data-idx="${i}" title="Delete">×</button>
        <div class="exp-entry-header">
          <div class="exp-entry-company">${esc(e.company) || '<span style="color:var(--ci-text-tertiary)">Company name</span>'}</div>
          <div class="exp-entry-dates">${esc(e.dateRange) || ''}</div>
        </div>
        ${buildTagSectionHtml(e, i)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="field">
            <label class="field-label">Company</label>
            <input type="text" class="field-input exp-field" data-idx="${i}" data-key="company" value="${esc(e.company)}" placeholder="e.g. Acme Corp">
          </div>
          <div class="field">
            <label class="field-label">Website</label>
            <input type="url" class="field-input exp-field" data-idx="${i}" data-key="website" value="${esc(e.website || '')}" placeholder="e.g. acme.com">
          </div>
        </div>
        <div class="field">
          <label class="field-label">What the company does</label>
          <div class="exp-rt-wrap">
            <div class="rt-toolbar exp-rt-toolbar" data-target="exp-desc-${i}">
              <button data-cmd="bold" title="Bold"><b>B</b></button>
              <button data-cmd="italic" title="Italic"><i>I</i></button>
              <div class="rt-sep"></div>
              <button data-cmd="insertUnorderedList" title="Bullet list">\u2022\u2261</button>
              <button data-cmd="insertOrderedList" title="Numbered list">1.</button>
              <button data-cmd="indent" title="Indent">\u2192</button>
              <button data-cmd="outdent" title="Outdent">\u2190</button>
              <div class="rt-sep"></div>
              <button data-cmd="formatBlock" data-val="H3" title="Heading">H</button>
              <div class="rt-sep"></div>
              <button data-cmd="insertColumns" title="Insert columns">\u2AF4</button>
            </div>

            <div class="rt-editable exp-rt-field field-input" id="exp-desc-${i}" contenteditable="true" data-idx="${i}" data-key="description" data-placeholder="Product, customers, market, how it evolved...">${e.description || ''}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="field">
            <label class="field-label">Title(s) held</label>
            <input type="text" class="field-input exp-field" data-idx="${i}" data-key="titles" value="${esc(e.titles)}" placeholder="e.g. AE &rarr; Senior AE &rarr; Head of Revenue">
          </div>
          <div class="field">
            <label class="field-label">Date range</label>
            <div class="exp-date-range" data-idx="${i}">
              <div class="exp-date-group">
                <select class="exp-date-month" data-idx="${i}" data-key="dateStart" title="Start month">
                  <option value="">Month</option>
                  ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, mi) => `<option value="${String(mi+1).padStart(2,'0')}"${(e.dateStart||'').split('-')[1] === String(mi+1).padStart(2,'0') ? ' selected' : ''}>${m}</option>`).join('')}
                </select>
                <input type="number" class="exp-date-year" data-idx="${i}" data-key="dateStart" min="1990" max="2035" placeholder="Year" value="${(e.dateStart||'').split('-')[0] || ''}" title="Start year">
              </div>
              <span class="exp-date-sep">\u2013</span>
              <div class="exp-date-group">
                <select class="exp-date-month" data-idx="${i}" data-key="dateEnd" title="End month" ${e.datePresent ? 'disabled' : ''}>
                  <option value="">Month</option>
                  ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, mi) => `<option value="${String(mi+1).padStart(2,'0')}"${!e.datePresent && (e.dateEnd||'').split('-')[1] === String(mi+1).padStart(2,'0') ? ' selected' : ''}>${m}</option>`).join('')}
                </select>
                <input type="number" class="exp-date-year" data-idx="${i}" data-key="dateEnd" min="1990" max="2035" placeholder="Year" value="${!e.datePresent ? ((e.dateEnd||'').split('-')[0] || '') : ''}" title="End year" ${e.datePresent ? 'disabled' : ''}>
              </div>
              <label class="exp-date-present"><input type="checkbox" class="exp-present-cb" data-idx="${i}" ${e.datePresent ? 'checked' : ''}> Present</label>
            </div>
          </div>
        </div>
        <div class="exp-entry-section-label">Key accomplishments</div>
        <div class="exp-rt-wrap">
          <div class="rt-toolbar exp-rt-toolbar" data-target="exp-acc-${i}">
            <button data-cmd="bold" title="Bold"><b>B</b></button>
            <button data-cmd="italic" title="Italic"><i>I</i></button>
            <div class="rt-sep"></div>
            <button data-cmd="insertUnorderedList" title="Bullet list">\u2022\u2261</button>
            <button data-cmd="insertOrderedList" title="Numbered list">1.</button>
            <button data-cmd="indent" title="Sub-bullet">\u2192</button>
            <button data-cmd="outdent" title="Outdent">\u2190</button>
            <div class="rt-sep"></div>
            <button data-cmd="formatBlock" data-val="H3" title="Heading">H</button>
            <div class="rt-sep"></div>
            <button data-cmd="insertColumns" title="Insert columns">\u2AF4</button>
          </div>
          <div class="rt-editable exp-rt-field field-input" id="exp-acc-${i}" contenteditable="true" data-idx="${i}" data-key="accomplishments" data-placeholder="Revenue milestones, team built, processes created, awards..." style="min-height:60px;">${e.accomplishments || ''}</div>
        </div>
        <div class="exp-entry-section-label">Skills &amp; exposures</div>
        <div class="exp-rt-wrap">
          <div class="rt-toolbar exp-rt-toolbar" data-target="exp-exp-${i}">
            <button data-cmd="bold" title="Bold"><b>B</b></button>
            <button data-cmd="italic" title="Italic"><i>I</i></button>
            <div class="rt-sep"></div>
            <button data-cmd="insertUnorderedList" title="Bullet list">\u2022\u2261</button>
            <button data-cmd="insertOrderedList" title="Numbered list">1.</button>
            <button data-cmd="indent" title="Sub-bullet">\u2192</button>
            <button data-cmd="outdent" title="Outdent">\u2190</button>
            <div class="rt-sep"></div>
            <button data-cmd="formatBlock" data-val="H3" title="Heading">H</button>
            <div class="rt-sep"></div>
            <button data-cmd="insertColumns" title="Insert columns">\u2AF4</button>
          </div>
          <div class="rt-editable exp-rt-field field-input" id="exp-exp-${i}" contenteditable="true" data-idx="${i}" data-key="exposures" data-placeholder="Tools, methodologies, domains, deal sizes, team sizes...">${e.exposures || ''}</div>
        </div>
      </div>
    `).join('');
    bindEntryEvents();
  }

  function htmlToText(html) {
    if (!html) return '';
    // Convert common HTML to readable plain text
    return html
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n**$1**\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '  - $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function save() {
    chrome.storage.local.set({ profileExperienceEntries: entries });
    // Sync to legacy profileExperience for Coop context backwards compat
    const text = entries.map(e => {
      const parts = [`## ${e.company || 'Company'} (${e.dateRange || ''})`];
      if (e.website) parts.push(`**Website:** ${e.website}`);
      if (e.titles) parts.push(`**Titles:** ${e.titles}`);
      if (e.description) parts.push(htmlToText(e.description));
      if (e.accomplishments) parts.push(`**Accomplishments:**\n${htmlToText(e.accomplishments)}`);
      if (e.exposures) parts.push(`**Skills/Exposures:** ${htmlToText(e.exposures)}`);
      if (e.tags && e.tags.length) parts.push(`**Tags:** ${e.tags.join(', ')}`);
      return parts.join('\n');
    }).join('\n\n---\n\n');

    // Build a dimension-grouped tag rollup so Coop can correctly interpret each tag's meaning
    const dimOrder = ['industry','stage','role','motion','skills','tools','deal'];
    const dimGroups = {};
    entries.forEach(e => {
      (e.tags || []).forEach(t => {
        const dimKey = TAG_DIMENSION_MAP[(t||'').toLowerCase()] || (e.customTagDims||{})[t] || 'other';
        if (!dimGroups[dimKey]) dimGroups[dimKey] = {};
        if (!dimGroups[dimKey][t]) dimGroups[dimKey][t] = [];
        if (e.company) dimGroups[dimKey][t].push(e.company);
      });
    });
    const rollupSections = [...dimOrder, 'other']
      .filter(k => dimGroups[k] && Object.keys(dimGroups[k]).length)
      .map(k => {
        const dimLabel = TAG_DIMENSIONS[k]?.label || 'Other';
        const lines = Object.entries(dimGroups[k]).map(([tag, cos]) => `- ${tag}: ${cos.join(', ')}`).join('\n');
        return `### ${dimLabel}\n${lines}`;
      });
    const fullText = rollupSections.length
      ? `## Experience tag rollup\n${rollupSections.join('\n\n')}\n\n---\n\n${text}`
      : text;
    saveBucket('profileExperience', fullText);
    if (hiddenTa) hiddenTa.value = fullText;
    showSaveStatus();
  }

  function parseDateRange(str) {
    // Parse strings like "Mar 2021 – Present", "2019-03 – 2022-01", "January 2020 - December 2023"
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
      january:1, february:2, march:3, april:4, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
    const present = /present|current|now|ongoing/i.test(str);
    const parts = str.split(/\s*[–—-]\s*/);
    const parseOne = s => {
      if (!s) return '';
      // "2021-03" format
      const isoMatch = s.match(/(\d{4})-(\d{2})/);
      if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
      // "Mar 2021" or "March 2021"
      const wordMatch = s.match(/([a-z]+)\s+(\d{4})/i);
      if (wordMatch) {
        const m = months[wordMatch[1].toLowerCase()];
        if (m) return `${wordMatch[2]}-${String(m).padStart(2, '0')}`;
      }
      // "2021" alone
      const yearMatch = s.match(/\b(20\d{2}|19\d{2})\b/);
      if (yearMatch) return `${yearMatch[1]}-01`;
      return '';
    };
    return { start: parseOne(parts[0]), end: present ? '' : parseOne(parts[1]), present };
  }

  function formatDateRange(entry) {
    const fmtMonth = val => {
      if (!val) return '';
      const [y, m] = val.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(m) - 1]} ${y}`;
    };
    const start = fmtMonth(entry.dateStart);
    const end = entry.datePresent ? 'Present' : fmtMonth(entry.dateEnd);
    if (!start && !end) return entry.dateRange || '';
    return [start, end].filter(Boolean).join(' – ');
  }

  function bindEntryEvents() {
    // Plain text/input fields
    list.querySelectorAll('.exp-field').forEach(el => {
      el.addEventListener('blur', () => {
        const idx = parseInt(el.dataset.idx);
        const key = el.dataset.key;
        entries[idx][key] = el.value.trim();
        save();
      });
    });
    // Rich text contenteditable fields
    list.querySelectorAll('.exp-rt-field').forEach(editor => {
      editor.addEventListener('blur', () => {
        const idx = parseInt(editor.dataset.idx);
        const key = editor.dataset.key;
        entries[idx][key] = editor.innerHTML.trim();
        save();
      });
      // URL auto-fetch on paste
      editor.addEventListener('paste', () => {
        setTimeout(async () => {
          const html = editor.innerHTML;
          const urlMatch = html.match(/https?:\/\/[^\s<>"')\]&]+/gi);
          if (!urlMatch) return;
          const newUrls = urlMatch.filter(u => !html.includes(`Fetched from ${u}`));
          if (!newUrls.length) return;

          for (const url of newUrls.slice(0, 2)) {
            // Insert fetching marker
            const markerId = 'fetch-' + Date.now();
            const marker = document.createElement('div');
            marker.id = markerId;
            marker.style.cssText = 'font-size:11px;color:var(--ci-text-tertiary);padding:4px 0;';
            marker.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border:2px solid rgba(175,169,236,0.3);border-top-color:#AFA9EC;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Fetching ${url.length > 60 ? url.slice(0, 60) + '...' : url}</span>`;
            editor.appendChild(marker);

            try {
              const result = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, r => {
                  if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                  else resolve(r);
                });
              });

              const el = document.getElementById(markerId);
              if (el && result?.text) {
                const content = result.text.slice(0, 3000);
                el.outerHTML = `<details style="font-size:12px;margin:6px 0;border:1px solid var(--ci-border-subtle);border-radius:6px;padding:6px 10px;background:var(--ci-bg-base);"><summary style="cursor:pointer;font-weight:600;color:var(--ci-text-secondary);font-size:11px;">Fetched from ${url.length > 50 ? url.slice(0, 50) + '...' : url}</summary><div style="white-space:pre-wrap;margin-top:6px;color:var(--ci-text-secondary);line-height:1.5;">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div></details>`;
              } else if (el) {
                el.outerHTML = `<div style="font-size:11px;color:var(--ci-text-tertiary);padding:2px 0;">Could not fetch ${url}</div>`;
              }
            } catch (err) {
              const el = document.getElementById(markerId);
              if (el) el.outerHTML = `<div style="font-size:11px;color:var(--ci-accent-red);padding:2px 0;">Could not fetch: ${err.message}</div>`;
            }

            // Save updated content
            const idx = parseInt(editor.dataset.idx);
            const key = editor.dataset.key;
            entries[idx][key] = editor.innerHTML.trim();
            save();
          }
        }, 100);
      });
      editor.addEventListener('keyup', () => {
        const toolbar = list.querySelector(`.exp-rt-toolbar[data-target="${editor.id}"]`);
        if (toolbar) updateToolbarState(toolbar, editor);
      });
      editor.addEventListener('mouseup', () => {
        const toolbar = list.querySelector(`.exp-rt-toolbar[data-target="${editor.id}"]`);
        if (toolbar) updateToolbarState(toolbar, editor);
      });
    });
    // Wire toolbar buttons for experience entries
    list.querySelectorAll('.exp-rt-toolbar').forEach(toolbar => {
      toolbar.addEventListener('mousedown', e => e.preventDefault());
      toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = toolbar.dataset.target;
          const editor = document.getElementById(targetId);
          if (!editor) return;
          editor.focus();
          const cmd = btn.dataset.cmd;
          const val = btn.dataset.val || null;
          if (cmd === 'insertColumns') {
            const existing = document.querySelector('.rt-col-picker');
            if (existing) { existing.remove(); return; }
            const picker = document.createElement('div');
            picker.className = 'rt-col-picker';
            picker.style.cssText = 'position:absolute;top:100%;left:0;background:#fff;border:1px solid var(--ci-border-default);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.1);padding:6px;display:flex;gap:4px;z-index:100;';
            [2, 3].forEach(n => {
              const opt = document.createElement('button');
              opt.textContent = `${n} cols`;
              opt.style.cssText = 'font-size:11px;padding:5px 10px;border:1px solid var(--ci-border-default);border-radius:5px;background:var(--ci-bg-inset);cursor:pointer;font-family:inherit;font-weight:600;color:var(--ci-text-secondary);';
              opt.addEventListener('click', () => {
                picker.remove();
                editor.focus();
                const cols = Array.from({ length: n }, (_, i) => {
                  const hdrClass = i === 0 ? 'green' : i === 1 ? 'red' : '';
                  const hdrText = n === 2 ? (i === 0 ? 'Pros / Strengths' : 'Cons / Gaps') : `Column ${i + 1}`;
                  return `<div class="rt-column"><div class="rt-column-header ${hdrClass}">${hdrText}</div><p>...</p></div>`;
                }).join('');
                document.execCommand('insertHTML', false, `<div class="rt-columns" style="grid-template-columns:repeat(${n},1fr)">${cols}</div><p><br></p>`);
              });
              picker.appendChild(opt);
            });
            toolbar.style.position = 'relative';
            toolbar.appendChild(picker);
            setTimeout(() => document.addEventListener('click', function rm(e) { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', rm); } }), 10);
          } else {
            document.execCommand(cmd, false, val);
          }
          updateToolbarState(toolbar, editor);
        });
      });
    });
    // Date fields (month select + year input)
    function readDateGroup(idx, key) {
      const monthEl = list.querySelector(`.exp-date-month[data-idx="${idx}"][data-key="${key}"]`);
      const yearEl = list.querySelector(`.exp-date-year[data-idx="${idx}"][data-key="${key}"]`);
      const month = monthEl?.value || '';
      const year = yearEl?.value || '';
      return (year && month) ? `${year}-${month}` : year ? `${year}-01` : '';
    }
    list.querySelectorAll('.exp-date-month, .exp-date-year').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.dataset.idx);
        const key = el.dataset.key;
        entries[idx][key] = readDateGroup(idx, key);
        entries[idx].dateRange = formatDateRange(entries[idx]);
        save();
      });
    });
    list.querySelectorAll('.exp-present-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        entries[idx].datePresent = cb.checked;
        list.querySelectorAll(`.exp-date-month[data-idx="${idx}"][data-key="dateEnd"], .exp-date-year[data-idx="${idx}"][data-key="dateEnd"]`).forEach(el => {
          el.disabled = cb.checked;
          if (cb.checked) el.value = el.tagName === 'SELECT' ? '' : '';
        });
        if (cb.checked) entries[idx].dateEnd = '';
        entries[idx].dateRange = formatDateRange(entries[idx]);
        save();
      });
    });
    list.querySelectorAll('.exp-entry-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        entries.splice(parseInt(btn.dataset.idx), 1);
        renderEntries();
        save();
      });
    });
    // See more / See less for experience rich text fields
    const EXP_COLLAPSED_H = 80;
    list.querySelectorAll('.exp-rt-wrap').forEach(wrap => {
      const editor = wrap.querySelector('.rt-editable');
      if (!editor) return;
      // Remove existing see-more button if re-rendering
      wrap.querySelectorAll('.exp-see-more').forEach(b => b.remove());

      editor.style.maxHeight = EXP_COLLAPSED_H + 'px';
      editor.style.overflow = 'hidden';

      const seeBtn = document.createElement('button');
      seeBtn.className = 'ta-see-more exp-see-more';
      seeBtn.type = 'button';
      seeBtn.innerHTML = 'See more &#9660;';
      wrap.appendChild(seeBtn);

      let expanded = false;
      function collapse() {
        expanded = false;
        editor.style.maxHeight = EXP_COLLAPSED_H + 'px';
        editor.style.overflow = 'hidden';
        seeBtn.innerHTML = 'See more &#9660;';
        checkOverflow();
      }
      function expand() {
        if (expanded) return;
        expanded = true;
        // Save cursor position before layout change
        const sel = window.getSelection();
        const savedRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
        editor.style.maxHeight = 'none';
        editor.style.overflow = 'visible';
        seeBtn.innerHTML = 'See less &#9650;';
        seeBtn.classList.add('visible');
        // Restore cursor position after layout reflow
        if (savedRange) {
          requestAnimationFrame(() => {
            sel.removeAllRanges();
            sel.addRange(savedRange);
          });
        }
      }
      function checkOverflow() {
        if (expanded) return;
        seeBtn.classList.toggle('visible', editor.scrollHeight > EXP_COLLAPSED_H + 4);
      }
      let blurTimer = null;
      let expandedViaClick = false;
      seeBtn.addEventListener('mousedown', e => e.preventDefault()); // prevent stealing focus from editor
      seeBtn.addEventListener('click', e => {
        e.preventDefault();
        if (expanded) { expandedViaClick = false; collapse(); }
        else { expandedViaClick = true; expand(); }
      });
      editor.addEventListener('focus', expand);
      editor.addEventListener('blur', () => {
        if (expandedViaClick) return;
        blurTimer = setTimeout(() => {
          if (wrap.contains(document.activeElement)) return;
          collapse();
        }, 400);
      });
      // Cancel blur-collapse if focus returns quickly (e.g. clicking toolbar or see-more)
      editor.addEventListener('focus', () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } });
      checkOverflow();
      setTimeout(checkOverflow, 200);
    });

    // Tag chip interactions
    list.querySelectorAll('.exp-tag-x').forEach(x => {
      x.addEventListener('click', ev => {
        ev.stopPropagation();
        const idx = parseInt(x.dataset.idx);
        const tag = x.dataset.tag;
        if (x.classList.contains('suggested-x')) {
          // Reject suggestion
          entries[idx].suggestedTags = (entries[idx].suggestedTags || []).filter(t => t !== tag);
        } else {
          entries[idx].tags = (entries[idx].tags || []).filter(t => t !== tag);
        }
        renderEntries();
        save();
      });
    });
    list.querySelectorAll('.exp-tag.suggested').forEach(chip => {
      chip.addEventListener('click', ev => {
        if (ev.target.classList.contains('exp-tag-x')) return;
        const idx = parseInt(chip.dataset.idx);
        const tag = chip.dataset.tag;
        entries[idx].tags = entries[idx].tags || [];
        if (!entries[idx].tags.includes(tag)) entries[idx].tags.push(tag);
        entries[idx].suggestedTags = (entries[idx].suggestedTags || []).filter(t => t !== tag);
        renderEntries();
        save();
      });
    });
    const dimOptions = Object.entries(TAG_DIMENSIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    function attachTagInput(container, idx, forceDim) {
      // Don't open a second picker in the same row
      if (container.querySelector('.exp-tag-input')) return;

      const select = document.createElement('select');
      select.className = 'exp-dim-select';
      select.innerHTML = `<option value="">Category…</option>${dimOptions}`;
      if (forceDim) { select.value = forceDim; select.style.display = 'none'; }

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'exp-tag-input';
      input.placeholder = forceDim ? `${TAG_DIMENSIONS[forceDim]?.label || ''} tag…` : 'tag name…';
      input.setAttribute('list', 'exp-tag-datalist');

      container.append(select, input);
      input.focus();

      const commit = () => {
        const val = input.value.trim();
        const dim = select.value || TAG_DIMENSION_MAP[(val||'').toLowerCase()] || '';
        if (val) {
          entries[idx].tags = entries[idx].tags || [];
          if (!entries[idx].tags.includes(val)) {
            entries[idx].tags.push(val);
            if (dim && !TAG_DIMENSION_MAP[(val).toLowerCase()]) {
              entries[idx].customTagDims = entries[idx].customTagDims || {};
              entries[idx].customTagDims[val] = dim;
            }
          }
          renderEntries();
          save();
        } else {
          select.remove(); input.remove();
        }
      };
      input.addEventListener('blur', () => setTimeout(commit, 120));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { select.remove(); input.remove(); }
      });
      select.addEventListener('change', () => {
        input.placeholder = TAG_DIMENSIONS[select.value]?.label ? `${TAG_DIMENSIONS[select.value].label} tag…` : 'tag name…';
        input.focus();
      });
    }

    list.querySelectorAll('.exp-tag-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        attachTagInput(btn.parentNode, idx, null);
        btn.style.display = 'none';
      });
    });

    list.querySelectorAll('.exp-dim-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const dim = btn.dataset.dim;
        attachTagInput(btn.parentNode.querySelector('.exp-dim-chips'), idx, dim);
      });
    });
  }

  // Expose for the Coop tag button below
  initStructuredExperience._getEntries = () => entries;
  initStructuredExperience._setSuggestions = (suggestionsByIdx) => {
    Object.keys(suggestionsByIdx).forEach(k => {
      const i = parseInt(k);
      if (entries[i]) entries[i].suggestedTags = suggestionsByIdx[k];
    });
    renderEntries();
    save();
  };

  addBtn.addEventListener('click', () => {
    entries.push({ company: '', website: '', description: '', titles: '', dateRange: '', dateStart: '', dateEnd: '', datePresent: false, accomplishments: '', exposures: '' });
    renderEntries();
    const lastCompany = list.querySelector('.exp-entry:last-child input[data-key="company"]');
    if (lastCompany) lastCompany.focus();
  });

  // ── Coop auto-fill experience from resume/story/profile ──
  const coopBtn = document.getElementById('experience-coop-autofill');
  const metaEl = document.getElementById('experience-autofill-meta');
  const tooltipEl = document.getElementById('experience-source-tooltip');

  if (coopBtn) {
    coopBtn.addEventListener('click', async () => {
      coopBtn.disabled = true;
      setCoopThinking(true, 'Reading profile');
      coopBtn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,122,89,0.3);border-top-color:#FF7A59;border-radius:50%;animation:aiSpin 0.5s linear infinite"></span> Coop is reading your profile...';
      if (metaEl) metaEl.textContent = '';

      try {
        // Gather all source data
        const data = await new Promise(r => chrome.storage.local.get([
          'profileResume', 'profileStory', 'profileExperience',
          'profileSkills', 'profilePrinciples', 'profileMotivators',
          'storyTime', 'profileExperienceEntries'
        ], r));

        const sources = [];
        let sourceContent = '';

        const resume = data.profileResume;
        if (resume?.content) {
          sources.push('Resume');
          sourceContent += `\n=== RESUME ===\n${resume.content.slice(0, 4000)}\n`;
        }
        const story = data.profileStory || data.storyTime?.rawInput;
        if (story) {
          sources.push('Story');
          sourceContent += `\n=== STORY ===\n${story.slice(0, 3000)}\n`;
        }
        const skills = data.profileSkills;
        if (skills) {
          sources.push('Skills');
          sourceContent += `\n=== SKILLS ===\n${skills.slice(0, 1500)}\n`;
        }
        const stProfile = data.storyTime?.profileSummary;
        if (stProfile) {
          sources.push('Story Time profile');
          sourceContent += `\n=== STORY TIME PROFILE ===\n${stProfile.slice(0, 2000)}\n`;
        }
        const stInsights = data.storyTime?.learnedInsights;
        if (stInsights?.length) {
          sourceContent += `\n=== LEARNED INSIGHTS ===\n${stInsights.slice(0, 20).map(i => `- ${i}`).join('\n')}\n`;
        }

        // Update tooltip with actual sources found
        if (tooltipEl) {
          if (sources.length) {
            tooltipEl.innerHTML = `Coop will extract from:<br>${sources.map(s => `<span class="source-label">${s}</span>`).join(' &middot; ')}`;
          } else {
            tooltipEl.innerHTML = 'No profile data found yet.<br>Upload a resume or fill in your Story first.';
          }
        }

        if (!sourceContent.trim()) {
          coopBtn.disabled = false;
          coopBtn.textContent = 'Let Coop fill this in';
          if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-accent-red)">No data found — upload a resume or fill in your Story first</span>';
          return;
        }

        const existingCount = entries.length;
        const prompt = `Extract structured work experience from the following profile data. For each company/role, return a JSON array of objects with these exact keys:
[{"company": "Company Name", "description": "What the company does (1-2 sentences)", "titles": "Title progression e.g. AE → Senior AE → Head of Revenue", "dateRange": "e.g. Mar 2021 – Present", "accomplishments": "Key accomplishments with specific metrics, bullet-point style", "exposures": "Tools, methodologies, domains, deal sizes, team sizes"}]

Rules:
- Extract EVERY distinct company/role you can find
- Preserve specific metrics, numbers, team sizes, revenue figures
- Order chronologically (most recent first)
- If date ranges are unclear, make your best guess based on context
- For accomplishments, use bullet-point style with specific numbers where available
- Respond with ONLY the JSON array, no other text
${existingCount > 0 ? `\nThe user already has ${existingCount} experience entries. Only add companies NOT already listed: ${entries.map(e => e.company).filter(Boolean).join(', ')}` : ''}

${sourceContent}`;

        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'COOP_CHAT',
            messages: [{ role: 'user', content: prompt }],
            globalChat: true,
            careerOSChat: true,
            chatModel: _coopModels.coopAutofill
          }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
        });

        if (result?.reply) {
          const match = result.reply.match(/\[[\s\S]*\]/);
          let added = 0;
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed) && parsed.length) {
              parsed.forEach(exp => {
                const dr = parseDateRange(exp.dateRange || '');
                entries.push({
                  company: exp.company || '',
                  website: exp.website || '',
                  description: exp.description || '',
                  titles: exp.titles || '',
                  dateRange: exp.dateRange || '',
                  dateStart: dr.start,
                  dateEnd: dr.end,
                  datePresent: dr.present,
                  accomplishments: exp.accomplishments || '',
                  exposures: exp.exposures || '',
                });
              });
              added = parsed.length;
              renderEntries();
              save();
            }
          }

          if (added > 0) {
            // Show sources + token usage
            const usage = result.usage;
            let metaHtml = `<span class="source-label">Sources:</span> ${sources.join(', ')}`;
            if (usage) {
              const totalTokens = (usage.input || 0) + (usage.output || 0);
              metaHtml += ` <span class="exp-autofill-usage">${totalTokens.toLocaleString()} tokens</span>`;
            }
            if (metaEl) metaEl.innerHTML = metaHtml;
          } else {
            if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-text-tertiary)">No new experience entries found — try adding more detail to your Resume or Story</span>';
          }
        } else if (result?.error) {
          if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-accent-red)">Coop couldn\'t generate experience — try again</span>';
        }
      } catch (err) {
        console.error('[ExperienceAutofill] Error:', err);
        if (metaEl) metaEl.innerHTML = `<span style="color:var(--ci-accent-red)">Error: ${err.message}</span>`;
      }

      setCoopThinking(false);
      coopBtn.disabled = false;
      coopBtn.textContent = 'Let Coop fill this in';
    });
  }

  // ── Coop, tag my experience ──
  const tagBtn = document.getElementById('experience-coop-tag');
  if (tagBtn) {
    tagBtn.addEventListener('click', async () => {
      const currentEntries = initStructuredExperience._getEntries();
      if (!currentEntries.length) {
        if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-accent-red)">Add experience entries first</span>';
        return;
      }
      tagBtn.disabled = true;
      setCoopThinking(true, 'Tagging experience');
      const origText = tagBtn.textContent;
      tagBtn.textContent = 'Coop is tagging...';
      if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-text-tertiary)">Coop is analyzing each role...</span>';

      try {
        const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const summary = currentEntries.map((e, i) => `[${i}] ${e.company || 'Unknown'} — ${stripHtml(e.description).slice(0, 400)}\n    Titles: ${e.titles || ''}\n    Exposures: ${stripHtml(e.exposures).slice(0, 300)}\n    Existing tags: ${(e.tags || []).join(', ') || 'none'}`).join('\n\n');

        const prompt = `You are tagging work experience entries so a downstream AI can correctly classify the candidate's background. Tags cover 7 distinct dimensions — try to include at least one tag from each that applies:

1. **Industry** — vertical the company operates in (e.g. martech, salestech, fintech, healthtech, developer tools)
2. **Stage** — company stage/model at time of tenure (e.g. seed, series B, pre-IPO, B2B SaaS, PLG, AI-native)
3. **Role** — the candidate's role context (e.g. IC, founding AE, player-coach, people manager, first sales hire)
4. **Motion** — GTM motion they ran (e.g. outbound, land and expand, channel, renewals, new logo)
5. **Skills** — craft and competencies demonstrated (e.g. enterprise selling, multi-threading, C-suite selling, pricing strategy, negotiation)
6. **Tools** — tech stack and methodologies used (e.g. Salesforce, Gong, Outreach, MEDDIC, Challenger, ZoomInfo, HubSpot)
7. **Deal** — deal characteristics (e.g. six-figure ACV, complex sales, long sales cycle, transactional)

For each entry below, suggest 6-12 tags spanning these dimensions. Only suggest tags NOT already in the existing tags list for that entry. Be specific and accurate — if the description doesn't support a tag, don't invent one.

Strongly prefer tags from this canonical vocabulary when applicable (but you may invent new ones if a better-fitting tag exists):
${EXPERIENCE_TAG_VOCAB.join(', ')}

Entries:
${summary}

Respond with ONLY a JSON object mapping entry index to an array of suggested tag strings. Example:
{"0": ["martech", "B2B SaaS", "PLG"], "1": ["salestech", "AI-native"]}`;

        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'COOP_CHAT',
            messages: [{ role: 'user', content: prompt }],
            globalChat: true,
            careerOSChat: true,
            chatModel: _coopModels.coopAutofill
          }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
        });

        if (result?.reply) {
          const match = result.reply.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            initStructuredExperience._setSuggestions(parsed);
            const total = Object.values(parsed).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
            if (metaEl) metaEl.innerHTML = `<span style="color:var(--ci-text-tertiary)">${total} tags suggested — click to accept, × to reject</span>`;
          } else {
            if (metaEl) metaEl.innerHTML = '<span style="color:var(--ci-accent-red)">Coop didn\'t return valid tags — try again</span>';
          }
        } else if (result?.error) {
          if (metaEl) metaEl.innerHTML = `<span style="color:var(--ci-accent-red)">${result.error}</span>`;
        }
      } catch (err) {
        console.error('[ExperienceTagging] Error:', err);
        if (metaEl) metaEl.innerHTML = `<span style="color:var(--ci-accent-red)">Error: ${err.message}</span>`;
      }

      setCoopThinking(false);
      tagBtn.disabled = false;
      tagBtn.textContent = origText;
    });
  }
}

// ── FAQ Q&A Pairs ──────────────────────────────────────────────────────────

function initFaqPairs() {
  const list = document.getElementById('faq-pairs-list');
  const addBtn = document.getElementById('faq-add-pair');
  const hiddenTa = document.getElementById('profile-faq');
  if (!list || !addBtn) return;

  let pairs = [];

  // Load from storage — try structured first, fall back to parsing old text
  chrome.storage.local.get(['profileFaqPairs', 'profileFAQ'], d => {
    if (d.profileFaqPairs?.length) {
      pairs = d.profileFaqPairs;
    } else if (d.profileFAQ) {
      // Migration: parse old freeform text into Q&A pairs
      const lines = d.profileFAQ.replace(/<[^>]+>/g, '\n').split('\n').filter(l => l.trim());
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (/^['""]/.test(l) || /\?$/.test(l) || /^(why|what|how|tell|where|when|describe|walk)/i.test(l)) {
          pairs.push({ q: l.replace(/^['""]+|['""]+$/g, ''), a: lines[i + 1]?.trim() || '' });
          i++; // skip next line (assumed answer)
        }
      }
      if (!pairs.length && lines.length) {
        pairs.push({ q: '', a: lines.join('\n') });
      }
    }
    renderPairs();
  });

  function renderPairs() {
    list.innerHTML = pairs.map((p, i) => `
      <div class="faq-pair" data-idx="${i}">
        <div>
          <div class="faq-pair-label q">Question</div>
          <div class="rt-editable faq-rt-field field-input" id="faq-q-${i}" contenteditable="true" data-idx="${i}" data-key="q" data-placeholder="e.g., Why are you looking?" style="min-height:32px;font-weight:600;">${p.q || ''}</div>
        </div>
        <div>
          <div class="faq-pair-label a">Answer</div>
          <div class="exp-rt-wrap">
            <div class="rt-toolbar faq-rt-toolbar" data-target="faq-a-${i}">
              <button data-cmd="bold" title="Bold"><b>B</b></button>
              <button data-cmd="italic" title="Italic"><i>I</i></button>
              <div class="rt-sep"></div>
              <button data-cmd="insertUnorderedList" title="Bullet list">\u2022\u2261</button>
              <button data-cmd="insertOrderedList" title="Numbered list">1.</button>
              <button data-cmd="indent" title="Sub-bullet">\u2192</button>
              <button data-cmd="outdent" title="Outdent">\u2190</button>
              <div class="rt-sep"></div>
              <button data-cmd="formatBlock" data-val="H3" title="Heading">H</button>
            </div>
            <div class="rt-editable faq-rt-field field-input" id="faq-a-${i}" contenteditable="true" data-idx="${i}" data-key="a" data-placeholder="Your polished response..." style="min-height:50px;">${p.a || ''}</div>
          </div>
        </div>
        <button class="faq-pair-delete" data-idx="${i}" title="Delete">\u00d7</button>
      </div>
    `).join('');
    bindPairEvents();
  }

  function faqHtmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n**$1**\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '  - $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function save() {
    chrome.storage.local.set({ profileFaqPairs: pairs });
    // Sync to old profileFAQ field — strip HTML for clean Coop context
    const text = pairs.map(p => `Q: ${faqHtmlToText(p.q)}\nA: ${faqHtmlToText(p.a)}`).join('\n\n');
    saveBucket('profileFAQ', text);
    if (hiddenTa) hiddenTa.value = text;
    showSaveStatus();
  }

  function bindPairEvents() {
    // Rich text contenteditable fields (both Q and A)
    list.querySelectorAll('.faq-rt-field').forEach(editor => {
      editor.addEventListener('blur', () => {
        const idx = parseInt(editor.dataset.idx);
        const key = editor.dataset.key;
        pairs[idx][key] = editor.innerHTML.trim();
        save();
      });
      editor.addEventListener('keyup', () => {
        const toolbar = list.querySelector(`.faq-rt-toolbar[data-target="${editor.id}"]`);
        if (toolbar) updateToolbarState(toolbar, editor);
      });
      editor.addEventListener('mouseup', () => {
        const toolbar = list.querySelector(`.faq-rt-toolbar[data-target="${editor.id}"]`);
        if (toolbar) updateToolbarState(toolbar, editor);
      });
    });
    // Wire toolbar buttons for FAQ answer fields
    list.querySelectorAll('.faq-rt-toolbar').forEach(toolbar => {
      toolbar.addEventListener('mousedown', e => e.preventDefault());
      toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = toolbar.dataset.target;
          const editor = document.getElementById(targetId);
          if (!editor) return;
          editor.focus();
          const cmd = btn.dataset.cmd;
          const val = btn.dataset.val || null;
          document.execCommand(cmd, false, val);
          updateToolbarState(toolbar, editor);
        });
      });
    });
    // Delete buttons
    list.querySelectorAll('.faq-pair-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        pairs.splice(parseInt(btn.dataset.idx), 1);
        renderPairs();
        save();
      });
    });
  }

  addBtn.addEventListener('click', () => {
    pairs.push({ q: '', a: '' });
    renderPairs();
    const lastQ = list.querySelector('.faq-pair:last-child .faq-rt-field[data-key="q"]');
    if (lastQ) lastQ.focus();
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

// ── Rich text editor ────────────────────────────────────────────────────────

// Fix Enter key inside columns — prevent browser from escaping the column
function initColumnEnterFix() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const column = sel.getRangeAt(0).startContainer.nodeType === 3
      ? sel.getRangeAt(0).startContainer.parentElement?.closest('.rt-column')
      : sel.getRangeAt(0).startContainer.closest?.('.rt-column');
    if (!column) return;
    // Let browser handle Enter natively inside list items — it creates new <li> correctly
    const node = sel.getRangeAt(0).startContainer;
    const inList = node.nodeType === 3 ? node.parentElement?.closest('li') : node.closest?.('li');
    if (inList) return;
    // We're inside a column but not in a list — handle Enter ourselves
    e.preventDefault();
    const newP = document.createElement('p');
    newP.innerHTML = '<br>';
    const range = sel.getRangeAt(0);
    range.deleteContents();
    // If cursor is inside a text node or inline element, split at cursor
    const block = range.startContainer.nodeType === 3
      ? range.startContainer.parentElement
      : range.startContainer;
    const closestBlock = block.closest('p, li, div:not(.rt-column):not(.rt-columns):not(.rt-column-header)');
    if (closestBlock && column.contains(closestBlock) && closestBlock !== column) {
      // Split the block at cursor position
      const afterRange = document.createRange();
      afterRange.setStart(range.startContainer, range.startOffset);
      afterRange.setEndAfter(closestBlock.lastChild || closestBlock);
      const afterContent = afterRange.extractContents();
      newP.innerHTML = '';
      newP.appendChild(afterContent);
      if (!newP.textContent.trim() && !newP.querySelector('br')) newP.innerHTML = '<br>';
      if (!closestBlock.textContent.trim() && !closestBlock.querySelector('br')) closestBlock.innerHTML = '<br>';
      closestBlock.after(newP);
    } else {
      // Append new paragraph at end of column
      column.appendChild(newP);
    }
    // Move cursor into new paragraph
    const newRange = document.createRange();
    newRange.setStart(newP, 0);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  });
}

function initRichTextEditors() {
  // Wire toolbar buttons
  document.querySelectorAll('.rt-toolbar').forEach(toolbar => {
    toolbar.addEventListener('mousedown', e => e.preventDefault()); // prevent blur on contenteditable
    toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = toolbar.dataset.target;
        const editor = document.getElementById(targetId);
        if (!editor) return;
        editor.focus();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val || null;
        if (cmd === 'insertColumns') {
          // Show column count picker
          const existing = document.querySelector('.rt-col-picker');
          if (existing) { existing.remove(); return; }
          const picker = document.createElement('div');
          picker.className = 'rt-col-picker';
          picker.style.cssText = 'position:absolute;top:100%;left:0;background:#fff;border:1px solid var(--ci-border-default);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.1);padding:6px;display:flex;gap:4px;z-index:100;';
          [2, 3, 4].forEach(n => {
            const opt = document.createElement('button');
            opt.textContent = `${n} cols`;
            opt.style.cssText = 'font-size:11px;padding:5px 10px;border:1px solid var(--ci-border-default);border-radius:5px;background:var(--ci-bg-inset);cursor:pointer;font-family:inherit;font-weight:600;color:var(--ci-text-secondary);';
            opt.addEventListener('click', () => {
              picker.remove();
              editor.focus();
              const cols = Array.from({ length: n }, (_, i) => {
                const hdrClass = i === 0 ? 'green' : i === 1 ? 'red' : '';
                const hdrText = n === 2 ? (i === 0 ? 'Pros / Strengths' : 'Cons / Gaps') : `Column ${i + 1}`;
                return `<div class="rt-column"><div class="rt-column-header ${hdrClass}">${hdrText}</div><p>...</p></div>`;
              }).join('');
              document.execCommand('insertHTML', false, `<div class="rt-columns" style="grid-template-columns:repeat(${n},1fr)">${cols}</div><p><br></p>`);
            });
            picker.appendChild(opt);
          });
          toolbar.style.position = 'relative';
          toolbar.appendChild(picker);
          setTimeout(() => document.addEventListener('click', function rm(e) { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', rm); } }, { once: false }), 10);
        } else {
          document.execCommand(cmd, false, val);
        }
        updateToolbarState(toolbar, editor);
      });
    });
  });

  // Auto-save on blur for contenteditable editors
  document.querySelectorAll('.rt-editable[data-bucket]').forEach(editor => {
    const bucket = editor.dataset.bucket;
    const hiddenTextarea = editor.id.replace('-rt', '');
    const ta = document.getElementById(hiddenTextarea);

    editor.addEventListener('blur', () => {
      const html = editor.innerHTML.trim();
      // Sync to hidden textarea for backwards compat
      if (ta) ta.value = html;
      saveBucket(bucket, html);
    });

    // Update toolbar active states on selection change
    editor.addEventListener('keyup', () => {
      const toolbar = document.querySelector(`.rt-toolbar[data-target="${editor.id}"]`);
      if (toolbar) updateToolbarState(toolbar, editor);
    });
    editor.addEventListener('mouseup', () => {
      const toolbar = document.querySelector(`.rt-toolbar[data-target="${editor.id}"]`);
      if (toolbar) updateToolbarState(toolbar, editor);
    });
  });
}

// Inject column controls on hover
function initColumnControls() {
  // Use event delegation so it works for both static and dynamically created editors
  document.addEventListener('mouseover', e => {
    const cols = e.target.closest('.rt-columns');
    if (!cols || cols.querySelector('.rt-col-controls')) return;
    const editor = cols.closest('.rt-editable');
    if (!editor) return;
    const controls = document.createElement('div');
    controls.className = 'rt-col-controls';
    controls.contentEditable = 'false';
    controls.innerHTML = `<button class="rt-col-btn" data-action="add" title="Add column">+</button><button class="rt-col-btn" data-action="remove" title="Remove last column">\u2212</button><button class="rt-col-btn" data-action="delete" title="Delete columns">\u00d7</button>`;
    cols.appendChild(controls);
    controls.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const action = ev.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'delete') {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        cols.replaceWith(p);
      } else if (action === 'add') {
        const colCount = cols.querySelectorAll('.rt-column').length;
        const newCol = document.createElement('div');
        newCol.className = 'rt-column';
        newCol.innerHTML = `<div class="rt-column-header">Column ${colCount + 1}</div><p>...</p>`;
        cols.insertBefore(newCol, controls);
        cols.style.gridTemplateColumns = `repeat(${colCount + 1}, 1fr)`;
      } else if (action === 'remove') {
        const columns = cols.querySelectorAll('.rt-column');
        if (columns.length > 1) {
          columns[columns.length - 1].remove();
          cols.style.gridTemplateColumns = `repeat(${columns.length - 1}, 1fr)`;
        }
      }
      editor.dispatchEvent(new Event('blur'));
    });
  });
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget?.closest('.rt-columns')) {
      const editor = e.target.closest('.rt-editable');
      if (editor) editor.querySelectorAll('.rt-col-controls').forEach(c => c.remove());
    }
  });
}

function updateToolbarState(toolbar, editor) {
  toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    }
  });
}

function initRichTextSeeMore() {
  const COLLAPSED_H = 90;
  document.querySelectorAll('.rt-editable').forEach(editor => {
    const wrap = editor.closest('.rt-editor-wrap');
    if (!wrap) return;

    // Start collapsed
    editor.style.maxHeight = COLLAPSED_H + 'px';
    editor.style.overflow = 'hidden';

    const btn = document.createElement('button');
    btn.className = 'ta-see-more';
    btn.type = 'button';
    btn.innerHTML = 'See more &#9660;';
    wrap.appendChild(btn);

    let expanded = false;

    function collapse() {
      expanded = false;
      editor.style.maxHeight = COLLAPSED_H + 'px';
      editor.style.overflow = 'hidden';
      btn.innerHTML = 'See more &#9660;';
      checkOverflow();
    }
    function expand() {
      if (expanded) return;
      expanded = true;
      const sel = window.getSelection();
      const savedRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      editor.style.maxHeight = 'none';
      editor.style.overflow = 'visible';
      btn.innerHTML = 'See less &#9650;';
      btn.classList.add('visible');
      if (savedRange) {
        requestAnimationFrame(() => { sel.removeAllRanges(); sel.addRange(savedRange); });
      }
    }
    function checkOverflow() {
      if (expanded) return;
      btn.classList.toggle('visible', editor.scrollHeight > COLLAPSED_H + 4);
    }

    let blurTimer = null;
    let expandedViaClick = false; // when user clicks "See more", don't auto-collapse on blur
    btn.addEventListener('mousedown', e => e.preventDefault()); // prevent stealing focus from editor
    btn.addEventListener('click', e => {
      e.preventDefault();
      if (expanded) { expandedViaClick = false; collapse(); }
      else { expandedViaClick = true; expand(); }
    });
    editor.addEventListener('focus', () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } expand(); });
    // Delay collapse on blur — don't collapse if focus moved to toolbar or within the editor wrap
    // Skip collapse entirely if expanded via explicit "See more" click
    editor.addEventListener('blur', () => {
      if (expandedViaClick) return;
      blurTimer = setTimeout(() => {
        if (wrap.contains(document.activeElement)) return;
        collapse();
      }, 400);
    });

    checkOverflow();
    // Re-check after content loads
    setTimeout(checkOverflow, 500);
  });
}

function loadRichTextEditors(data) {
  document.querySelectorAll('.rt-editable[data-bucket]').forEach(editor => {
    const bucket = editor.dataset.bucket;
    const content = data[bucket] || '';
    if (content) {
      // If content looks like plain text (no HTML tags), wrap in paragraphs
      if (!/<[a-z][\s\S]*>/i.test(content)) {
        editor.innerHTML = content.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('');
      } else {
        editor.innerHTML = content;
      }
    }
    // Also sync to hidden textarea
    const hiddenId = editor.id.replace('-rt', '');
    const ta = document.getElementById(hiddenId);
    if (ta) ta.value = content;
  });
}

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
    'pref-name', 'pref-location-city', 'pref-location-state', 'pref-max-travel',
    'pref-salary-floor', 'pref-salary-strong', 'pref-ote-floor', 'pref-ote-strong',
    'pref-staleness-days'
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
  if (document.getElementById('pref-name')) document.getElementById('pref-name').value = syncPrefs.name || '';
  document.getElementById('pref-job-match-toggle').checked = !!syncPrefs.jobMatchEnabled;
  document.getElementById('pref-location-city').value   = syncPrefs.locationCity  || '';
  document.getElementById('pref-location-state').value  = syncPrefs.locationState || '';
  document.getElementById('pref-max-travel').value      = syncPrefs.maxTravel     || '';
  document.getElementById('pref-salary-floor').value    = syncPrefs.salaryFloor   || '';
  document.getElementById('pref-salary-strong').value   = syncPrefs.salaryStrong  || '';
  document.getElementById('pref-ote-floor').value       = syncPrefs.oteFloor      || '';
  document.getElementById('pref-ote-strong').value      = syncPrefs.oteStrong     || '';
  const stalenessEl = document.getElementById('pref-staleness-days');
  if (stalenessEl) stalenessEl.value = syncPrefs.stalenessThresholdDays != null ? syncPrefs.stalenessThresholdDays : 7;

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

    // Load rich text editors with stored data
    loadRichTextEditors(localData);
    initRichTextEditors();
    initRichTextSeeMore();
    initColumnControls();
    initColumnEnterFix();

    // Update "How the AI reads this" panels for empty motivators
    const motivatorsEl = document.getElementById('profile-motivators-rt');
    const motivatorsVal = motivatorsEl ? motivatorsEl.textContent.trim() : document.getElementById('profile-motivators').value.trim();
    if (!motivatorsVal) {
      const panel = document.querySelector('.ai-panel[data-ai-panel="motivators"]');
      if (panel) panel.textContent = 'Nothing here yet — add your motivators to see Coop\'s interpretation';
    }

    // Set header name
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
    initICPScoring();
    initSkillTags();
    initSkillsAutoGenerate();
    initICPFields();
    initICPAutofill();
    initFlagsAutofill();
    initInterviewLearnings();
    initFaqPairs();
    initStructuredExperience();

    // Deep-link handler
    const urlParams = new URLSearchParams(window.location.search);
    const targetSection = urlParams.get('section');
    const addTag = urlParams.get('addTag');
    const targetDim = urlParams.get('dim');
    const targetFlagId = urlParams.get('flagId');

    if (targetSection === 'experience') {
      // Switch to the Experience tab
      document.querySelectorAll('.cos-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'fit'));
      document.querySelectorAll('.cos-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'fit'));

      // Expand the Experience card and scroll to it
      const expCard = document.getElementById('experience-entries-list')?.closest('.cos-collapsible');
      if (expCard) {
        expCard.classList.add('open');
        setTimeout(() => {
          expCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (addTag) {
            const banner = document.createElement('div');
            banner.style.cssText = 'margin:8px 0 12px;padding:10px 14px;background:#FFF8E1;border:1px solid #FFD54F;border-radius:8px;font-size:13px;color:#5D4037;display:flex;align-items:center;gap:8px;';
            banner.innerHTML = `<span style="font-size:16px;">🏷️</span> <span>Tag <strong>${addTag.replace(/</g, '&lt;')}</strong> on the experience entry where you used this skill, then rescore.</span>`;
            const list = document.getElementById('experience-entries-list');
            if (list) list.parentNode.insertBefore(banner, list);
          }
        }, 150);
      }
    }

    // ICP deep-link: ?dim=roleFit or ?dim=roleFit&flagId=abc123
    if (targetDim) {
      const applyDimDeepLink = () => {
        // Switch to the ICP & Preferences tab
        document.querySelectorAll('.cos-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'icp'));
        document.querySelectorAll('.cos-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'icp'));

        // Expand parent collapsible if ICP section is inside one
        const icpCollapsible = document.getElementById('icp-scoring-section')?.closest('.cos-collapsible');
        if (icpCollapsible) icpCollapsible.classList.add('open');

        // Expand the target dimension
        const dimBody = document.getElementById('dim-body-' + targetDim);
        const dimChev = document.getElementById('dim-chev-' + targetDim);
        if (dimBody && !dimBody.classList.contains('open')) {
          dimBody.classList.add('open');
          if (dimChev) dimChev.classList.add('open');
        }

        setTimeout(() => {
          if (targetFlagId) {
            // Scroll to and highlight the specific flag card
            const flagEl = document.querySelector(`.icp-flag-card[data-id="${targetFlagId}"]`);
            console.log('[DeepLink] looking for flagId:', targetFlagId, 'found:', !!flagEl,
              'all flag cards:', document.querySelectorAll('.icp-flag-card').length,
              'all ids:', [...document.querySelectorAll('.icp-flag-card')].map(c => c.dataset.id));
            if (flagEl) {
              flagEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              flagEl.classList.add('flag-highlight');
              const editBtn = flagEl.querySelector('.icp-flag-action-btn.edit');
              if (editBtn) setTimeout(() => editBtn.click(), 400);
              setTimeout(() => flagEl.classList.remove('flag-highlight'), 2500);
            }
          } else {
            const dimEl = document.getElementById('icp-dim-' + targetDim);
            if (dimEl) dimEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      };

      // Flag cards are rendered async inside initICPScoring's storage callback.
      // Wait for that to complete before trying to find flag elements.
      if (targetFlagId && !document.querySelector(`.icp-flag-card[data-id="${targetFlagId}"]`)) {
        document.addEventListener('icp-scoring-ready', applyDimDeepLink, { once: true });
      } else {
        applyDimDeepLink();
      }
    }
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

// ── Quick Links editor ───────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const _persistQL = debounce(() => persistQuickLinks(), 300);

function persistQuickLinks() {
  const rows = document.querySelectorAll('#ql-list .ql-row');
  const links = [];
  rows.forEach(row => {
    const label = row.querySelector('.ql-input-label')?.value?.trim() || '';
    const url   = row.querySelector('.ql-input-url')?.value?.trim()   || '';
    links.push({ label, url });
  });
  chrome.storage.sync.get(['prefs'], ({ prefs: existing }) => {
    void chrome.runtime.lastError;
    const prefs = Object.assign({}, existing || {}, { quickLinks: links });
    chrome.storage.sync.set({ prefs }, () => void chrome.runtime.lastError);
  });
}

function renderQuickLinksEditor(links) {
  const list = document.getElementById('ql-list');
  if (!list) return;
  list.innerHTML = '';

  const defaults = [
    { label: 'LinkedIn Profile', url: '' },
    { label: 'Personal Website', url: '' },
    { label: 'GitHub', url: '' },
    { label: 'Portfolio', url: '' },
  ];
  const rows = (links && links.length) ? links : defaults;

  rows.forEach(link => {
    addQLRow(list, link.label, link.url);
  });
}

function addQLRow(list, label, url) {
  const row = document.createElement('div');
  row.className = 'ql-row';
  row.innerHTML =
    `<input type="text" class="ql-input-label" placeholder="Label" value="${escapeHtml(label || '')}">` +
    `<input type="url"  class="ql-input-url"   placeholder="https://..." value="${escapeHtml(url || '')}">` +
    `<button class="ql-del" title="Remove">&times;</button>`;
  row.querySelector('.ql-del').addEventListener('click', () => {
    row.remove();
    persistQuickLinks();
  });
  row.querySelector('.ql-input-label').addEventListener('input', _persistQL);
  row.querySelector('.ql-input-url').addEventListener('input', _persistQL);
  list.appendChild(row);
}

// Boot: load existing quickLinks (lazy-seed defaults if missing)
chrome.storage.sync.get(['prefs'], ({ prefs }) => {
  void chrome.runtime.lastError;
  renderQuickLinksEditor((prefs || {}).quickLinks);
  // Seed defaults to storage if none exist yet
  if (!(prefs || {}).quickLinks) persistQuickLinks();
});

// "Add link" button
const qlAddBtn = document.getElementById('ql-add');
if (qlAddBtn) {
  qlAddBtn.addEventListener('click', () => {
    const list = document.getElementById('ql-list');
    if (list) {
      addQLRow(list, '', '');
      list.lastElementChild?.querySelector('.ql-input-label')?.focus();
    }
  });
}

// Hash-based deep-link scroll: preferences.html#pref-quicklinks
if (window.location.hash === '#pref-quicklinks') {
  setTimeout(() => {
    document.getElementById('pref-quicklinks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}
