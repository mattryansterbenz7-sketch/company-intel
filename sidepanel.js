const searchBtn = document.getElementById('search-btn');
const settingsBtn = document.getElementById('settings-btn');
const savedBtn = document.getElementById('saved-btn');
const companyNameEl = document.getElementById('company-name');
const companyLinksEl = document.getElementById('company-links');
const contentEl = document.getElementById('content');
const settingsPanel = document.getElementById('settings-panel');
const savePrefsBtn = document.getElementById('save-prefs-btn');
const saveConfirm = document.getElementById('save-confirm');
const saveBtn = document.getElementById('save-btn');
const saveJobBtn = document.getElementById('save-job-btn');
const savePanel = document.getElementById('save-panel');
const saveNotes = document.getElementById('save-notes');
const saveConfirmBtn = document.getElementById('save-confirm-btn');
let saveMode = 'company'; // 'company' or 'job'
let currentSaveTags = [];
let allKnownTags = [];
let detectedDomain = null;
let settingsOpen = false;
let currentResearch = null;
let currentSavedEntry = null; // saved entry for the current company (for knownContacts etc.)
let currentUrl = null;
let currentJobTitle = null;
let currentJobDescription = null;
let currentJobMeta = null;
let currentPrefs = null;
let saveRating = 0;
let currentTabId = null;

// Load prefs from sync, falling back to local (migration path for pre-sync installs).
// If found only in local, copies to sync so future reads succeed.
function normalizeCompanyName(name) {
  return (name || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function companiesMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (na === nb) return true;
  // One contains the other (handles "Product Genius" vs "Product Genius AI")
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function loadPrefsWithMigration(callback) {
  chrome.storage.sync.get(['prefs'], (syncResult) => {
    void chrome.runtime.lastError;
    if (syncResult.prefs && Object.keys(syncResult.prefs).length > 0) {
      callback(syncResult.prefs);
      return;
    }
    chrome.storage.local.get(['prefs'], (localResult) => {
      void chrome.runtime.lastError;
      if (localResult.prefs && Object.keys(localResult.prefs).length > 0) {
        chrome.storage.sync.set({ prefs: localResult.prefs }, () => void chrome.runtime.lastError);
      }
      callback(localResult.prefs || null);
    });
  });
}

function applyPrefsToForm(prefs) {
  if (!prefs) return;
  document.getElementById('pref-roles').value = prefs.roles || '';
  document.getElementById('pref-avoid').value = prefs.avoid || '';
  document.getElementById('pref-interests').value = prefs.interests || '';
  document.getElementById('pref-linkedin-url').value = prefs.linkedinUrl || '';
  document.getElementById('pref-resume-text').value = prefs.resumeText || '';
  document.getElementById('pref-job-match-bg').value = prefs.jobMatchBackground || '';
  document.getElementById('pref-role-loved').value = prefs.roleLoved || '';
  document.getElementById('pref-role-hated').value = prefs.roleHated || '';
  const toggle = document.getElementById('pref-job-match-toggle');
  toggle.checked = !!prefs.jobMatchEnabled;
  document.getElementById('job-match-fields').style.display = prefs.jobMatchEnabled ? 'block' : 'none';
  (prefs.workArrangement || []).forEach(val => {
    const cb = document.querySelector(`input[name="work-arr"][value="${val}"]`);
    if (cb) cb.checked = true;
  });
  document.getElementById('pref-location-city').value = prefs.locationCity || '';
  document.getElementById('pref-location-state').value = prefs.locationState || '';
  document.getElementById('pref-max-travel').value = prefs.maxTravel || '';
  document.getElementById('pref-salary-floor').value = prefs.salaryFloor || prefs.minSalary || '';
  document.getElementById('pref-salary-strong').value = prefs.salaryStrong || '';
}

// Load preferences into settings fields (with local→sync migration)
loadPrefsWithMigration((prefs) => {
  currentPrefs = prefs;
  applyPrefsToForm(prefs);
});

// Open saved dashboard
savedBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('saved.html') });
});

function openSavePanel(mode) {
  saveMode = mode;
  const isJob = mode === 'job';
  const modeLabel = document.getElementById('save-mode-label');
  if (modeLabel) modeLabel.textContent = isJob ? 'Saving Job Posting' : 'Saving Company';
  saveConfirmBtn.textContent = isJob ? 'Save Job Posting' : 'Save Company';

  const statusRow = document.getElementById('save-status-row');
  const statusSelect = document.getElementById('save-status-select');
  if (statusRow && statusSelect) {
    statusSelect.innerHTML = Object.entries(JOB_STATUSES)
      .map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
    statusRow.style.display = 'block';
  }

  savePanel.classList.add('visible');
  saveNotes.value = '';
  saveRating = 0;
  currentSaveTags = [];
  document.querySelectorAll('.save-star').forEach(s => s.classList.remove('filled'));
  renderSaveTagChips();

  // Load known tags for autocomplete
  chrome.storage.local.get(['allTags'], ({ allTags }) => {
    allKnownTags = allTags || [];
  });
}

function renderSaveTagChips() {
  const chipsEl = document.getElementById('save-tags-chips');
  if (!chipsEl) return;
  chipsEl.innerHTML = currentSaveTags.map(tag =>
    `<span class="save-tag-chip">${tag}<span class="remove-tag" data-tag="${tag}">✕</span></span>`
  ).join('');
  chipsEl.querySelectorAll('.remove-tag').forEach(el => {
    el.addEventListener('click', () => {
      currentSaveTags = currentSaveTags.filter(t => t !== el.dataset.tag);
      renderSaveTagChips();
    });
  });
}

// Tag input logic
const saveTagInput = document.getElementById('save-tag-input');
const saveTagSuggestions = document.getElementById('save-tag-suggestions');

saveTagInput.addEventListener('input', () => {
  const val = saveTagInput.value.trim().toLowerCase();
  if (!val) { saveTagSuggestions.style.display = 'none'; return; }
  const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !currentSaveTags.includes(t));
  if (matches.length === 0) { saveTagSuggestions.style.display = 'none'; return; }
  saveTagSuggestions.innerHTML = matches.slice(0, 6).map(t =>
    `<div class="save-tag-suggestion" data-tag="${t}">${t}</div>`
  ).join('');
  saveTagSuggestions.style.display = 'block';
  saveTagSuggestions.querySelectorAll('.save-tag-suggestion').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addSaveTag(el.dataset.tag);
    });
  });
});

saveTagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = saveTagInput.value.trim();
    if (val) addSaveTag(val);
  }
  if (e.key === 'Escape') saveTagSuggestions.style.display = 'none';
});

saveTagInput.addEventListener('blur', () => {
  setTimeout(() => { saveTagSuggestions.style.display = 'none'; }, 150);
});

function addSaveTag(tag) {
  const clean = tag.trim();
  if (!clean || currentSaveTags.includes(clean)) { saveTagInput.value = ''; return; }
  currentSaveTags.push(clean);
  saveTagInput.value = '';
  saveTagSuggestions.style.display = 'none';
  renderSaveTagChips();
}

// Save Company button
saveBtn.addEventListener('click', () => {
  if (saveBtn.classList.contains('saved')) return;
  if (savePanel.classList.contains('visible') && saveMode === 'company') {
    savePanel.classList.remove('visible');
    return;
  }
  openSavePanel('company');
});

// Save Job button
saveJobBtn.addEventListener('click', () => {
  if (saveJobBtn.classList.contains('saved')) return;
  if (savePanel.classList.contains('visible') && saveMode === 'job') {
    savePanel.classList.remove('visible');
    return;
  }
  openSavePanel('job');
});

// Save stars
document.querySelectorAll('.save-star').forEach(star => {
  star.addEventListener('click', () => {
    saveRating = parseInt(star.dataset.val);
    document.querySelectorAll('.save-star').forEach((s, i) => {
      s.classList.toggle('filled', i < saveRating);
    });
  });
});

// Save confirm
saveConfirmBtn.addEventListener('click', () => {
  if (saveConfirmBtn.classList.contains('saved')) return;
  const company = companyNameEl.textContent;
  const isJobSave = saveMode === 'job';
  const jobStageValue = isJobSave ? (document.getElementById('save-status-select')?.value || 'needs_review') : null;

  const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
  const companyLinkedin = currentResearch?.companyLinkedin || (/linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null);

  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const existing = savedCompanies || [];

    // Find existing company record (all records are now type:'company')
    const dupIdx = existing.findIndex(c => companiesMatch(c.company, company));

    if (dupIdx !== -1) {
      // Update existing record
      const prev = existing[dupIdx];
      const merged = {
        ...prev,
        notes:          saveNotes.value.trim() || prev.notes,
        rating:         saveRating || prev.rating,
        tags:           [...new Set([...(prev.tags || []), ...currentSaveTags])],
        companyWebsite: prev.companyWebsite  || companyWebsite  || null,
        companyLinkedin:prev.companyLinkedin || companyLinkedin || null,
        intelligence:   prev.intelligence   || currentResearch?.intelligence || null,
        reviews:        prev.reviews?.length ? prev.reviews : (currentResearch?.reviews || null),
        leaders:        prev.leaders?.length ? prev.leaders : (currentResearch?.leaders || null),
        employees:      prev.employees || currentResearch?.employees || null,
        funding:        prev.funding   || currentResearch?.funding   || null,
        founded:        prev.founded   || currentResearch?.founded   || null,
        ...(isJobSave ? {
          isOpportunity: true,
          jobStage:     jobStageValue,
          jobTitle:     currentJobTitle || prev.jobTitle || null,
          jobUrl:       currentUrl || prev.jobUrl || null,
          jobMatch:     currentResearch?.jobMatch || prev.jobMatch || null,
          jobSnapshot:  currentResearch?.jobSnapshot || prev.jobSnapshot || null,
        } : {
          status: prev.status || 'co_watchlist',
        }),
      };
      const updated = [merged, ...existing.filter((_, i) => i !== dupIdx)];
      chrome.storage.local.set({ savedCompanies: updated }, () => {
        void chrome.runtime.lastError;
        saveConfirmBtn.textContent = '✓ Saved'; saveConfirmBtn.classList.add('saved');
        if (isJobSave) { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
        else           { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
        showCrmLink(merged);
      });
      return;
    }

    // New record (always type:'company')
    const entry = {
      id:             Date.now().toString(36) + Math.random().toString(36).substr(2),
      type:           'company',
      company,
      savedAt:        Date.now(),
      notes:          saveNotes.value.trim(),
      rating:         saveRating || null,
      tags:           [...currentSaveTags],
      url:            isJobSave ? null : (currentUrl || null),
      oneLiner:       currentResearch?.intelligence?.oneLiner || null,
      category:       currentResearch?.intelligence?.category || null,
      employees:      currentResearch?.employees || null,
      funding:        currentResearch?.funding   || null,
      founded:        currentResearch?.founded   || null,
      companyWebsite,
      companyLinkedin,
      intelligence:   currentResearch?.intelligence || null,
      reviews:        currentResearch?.reviews      || null,
      leaders:        currentResearch?.leaders      || null,
      status:         isJobSave ? 'co_watchlist' : 'co_watchlist',
      ...(isJobSave ? {
        isOpportunity: true,
        jobStage:     jobStageValue,
        jobTitle:     currentJobTitle || null,
        jobUrl:       currentUrl || null,
        jobMatch:     currentResearch?.jobMatch    || null,
        jobSnapshot:  currentResearch?.jobSnapshot || null,
      } : {}),
    };

    // Persist any new tags
    const newTags = currentSaveTags.filter(t => !allKnownTags.includes(t));
    if (newTags.length > 0) {
      allKnownTags = [...allKnownTags, ...newTags];
      chrome.storage.local.set({ allTags: allKnownTags });
    }

    chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, () => {
      void chrome.runtime.lastError;
      saveConfirmBtn.textContent = '✓ Saved'; saveConfirmBtn.classList.add('saved');
      if (isJobSave) { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
      else           { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
      showCrmLink(entry);
    });
  });
});

// Detect company on load and auto-research
chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  currentUrl = tabs[0]?.url || null;
  currentTabId = tabs[0]?.id || null;
  chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_COMPANY' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.company) {
      contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
      return;
    }
    companyNameEl.textContent = response.company;
    currentJobTitle = response.jobTitle || null;
    currentJobMeta = response.jobMeta || null;
    detectedDomain = response.domain || null;
    updateJobTitleBar();
    triggerResearch(response.company);

    // Concurrently extract description — fires in parallel with research
    if (currentJobTitle) {
      startJobDescriptionFlow(tabs[0].id);
    }
  });
});

function startJobDescriptionFlow(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'GET_JOB_DESCRIPTION' }, (descResponse) => {
    void chrome.runtime.lastError;
    if (!descResponse) return;

    // Update meta with more accurate post-panel data
    if (descResponse.jobMeta?.workArrangement || descResponse.jobMeta?.salary) {
      currentJobMeta = descResponse.jobMeta;
      renderJobSnapshot(descResponse.jobMeta);
    }

    // Always render location match immediately, even without description
    renderJobOpportunity(null, descResponse.jobMeta || currentJobMeta || null);

    // Full analysis only if description was extracted
    if (descResponse.jobDescription) {
      const run = (prefs) => { currentPrefs = currentPrefs || prefs; triggerJobAnalysis(companyNameEl.textContent, descResponse.jobDescription); };
      if (currentPrefs) { run(currentPrefs); } else { loadPrefsWithMigration((prefs) => run(prefs || null)); }
    }
  });
}

// Open Setup page in a new tab
settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('preferences.html') });
});

// Job match toggle
document.getElementById('pref-job-match-toggle').addEventListener('change', (e) => {
  document.getElementById('job-match-fields').style.display = e.target.checked ? 'block' : 'none';
});

// Import LinkedIn profile
document.getElementById('import-linkedin-btn').addEventListener('click', () => {
  const btn = document.getElementById('import-linkedin-btn');
  const status = document.getElementById('import-profile-status');
  btn.disabled = true;
  status.textContent = 'Importing…';
  status.className = 'import-profile-status';

  const linkedinUrl = document.getElementById('pref-linkedin-url').value.trim();
  if (!linkedinUrl) {
    status.textContent = 'Enter your LinkedIn profile URL above first.';
    status.className = 'import-profile-status err';
    btn.disabled = false;
    return;
  }

  const slugMatch = linkedinUrl.match(/\/in\/([^/?#]+)/);
  if (!slugMatch) {
    status.textContent = 'Invalid LinkedIn URL — should be linkedin.com/in/yourname';
    status.className = 'import-profile-status err';
    btn.disabled = false;
    return;
  }
  const profileSlug = slugMatch[1].toLowerCase();

  chrome.tabs.query({}, (tabs) => {
    const profileTab = tabs.find(t => {
      if (!t.url) return false;
      const m = t.url.match(/\/in\/([^/?#]+)/);
      return m && m[1].toLowerCase() === profileSlug;
    });

    if (!profileTab) {
      status.textContent = 'Open your LinkedIn profile in a tab first, then click Import.';
      status.className = 'import-profile-status err';
      btn.disabled = false;
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: profileTab.id },
      func: () => {
        const parts = [];
        const name = document.querySelector('h1')?.textContent?.trim();
        const headline = document.querySelector('.text-body-medium.break-words')?.textContent?.trim();
        if (name) parts.push('Name: ' + name);
        if (headline) parts.push('Headline: ' + headline + '\n');

        function sectionText(id) {
          const anchor = document.getElementById(id);
          if (!anchor) return null;
          let el = anchor;
          for (let i = 0; i < 6; i++) {
            el = el.parentElement;
            if (!el) break;
            const t = el.innerText && el.innerText.trim();
            if (t && t.length > 80) return t;
          }
          return null;
        }

        const about = sectionText('about');
        if (about) parts.push('About:\n' + about.replace(/^About\s*\n/, '') + '\n');
        const exp = sectionText('experience');
        if (exp) parts.push('Experience:\n' + exp.replace(/^Experience\s*\n/, '') + '\n');
        const edu = sectionText('education');
        if (edu) parts.push('Education:\n' + edu.replace(/^Education\s*\n/, '') + '\n');
        const skills = sectionText('skills');
        if (skills) parts.push('Skills:\n' + skills.replace(/^Skills\s*\n/, ''));

        if (parts.length <= 2) {
          const main = document.querySelector('main') || document.querySelector('.scaffold-layout__main');
          const t = main && main.innerText && main.innerText.trim();
          if (t && t.length > 100) parts.push(t);
        }

        const result = parts.join('\n').trim();
        return result.length > 0 ? result.slice(0, 4000) : null;
      }
    }, (results) => {
      void chrome.runtime.lastError;
      btn.disabled = false;
      const profileText = results && results[0] && results[0].result;
      if (profileText) {
        document.getElementById('pref-resume-text').value = profileText;
        status.textContent = 'Imported!';
        status.className = 'import-profile-status ok';
        setTimeout(() => { status.textContent = ''; }, 3000);
      } else {
        status.textContent = 'Could not read profile — make sure the page has fully loaded.';
        status.className = 'import-profile-status err';
      }
    });
  });
});

// Upload resume file (.txt / .md)
document.getElementById('upload-resume-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const status = document.getElementById('import-profile-status');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result?.trim();
    if (text) {
      document.getElementById('pref-resume-text').value = text;
      status.textContent = `Loaded: ${file.name}`;
      status.className = 'import-profile-status ok';
      setTimeout(() => { status.textContent = ''; }, 3000);
    } else {
      status.textContent = 'File appears empty.';
      status.className = 'import-profile-status err';
    }
  };
  reader.onerror = () => {
    status.textContent = 'Could not read file.';
    status.className = 'import-profile-status err';
  };
  reader.readAsText(file);
  e.target.value = ''; // allow re-uploading same file
});

// Save preferences
savePrefsBtn.addEventListener('click', () => {
  const cityVal = document.getElementById('pref-location-city').value.trim();
  const stateVal = document.getElementById('pref-location-state').value.trim();

  // Require both fields together, and city must look like a real place name (letters/spaces/hyphens only)
  if (cityVal && !stateVal) {
    document.getElementById('pref-location-state').style.borderColor = '#f87171';
    setTimeout(() => document.getElementById('pref-location-state').style.borderColor = '', 2000);
    return;
  }
  if (stateVal && !cityVal) {
    document.getElementById('pref-location-city').style.borderColor = '#f87171';
    setTimeout(() => document.getElementById('pref-location-city').style.borderColor = '', 2000);
    return;
  }
  if (cityVal && !/^[A-Za-z\s\-'.]+$/.test(cityVal)) {
    document.getElementById('pref-location-city').style.borderColor = '#f87171';
    setTimeout(() => document.getElementById('pref-location-city').style.borderColor = '', 2000);
    return;
  }

  const prefs = {
    roles: document.getElementById('pref-roles').value.trim(),
    avoid: document.getElementById('pref-avoid').value.trim(),
    interests: document.getElementById('pref-interests').value.trim(),
    jobMatchEnabled: document.getElementById('pref-job-match-toggle').checked,
    linkedinUrl: document.getElementById('pref-linkedin-url').value.trim(),
    resumeText: document.getElementById('pref-resume-text').value.trim(),
    jobMatchBackground: document.getElementById('pref-job-match-bg').value.trim(),
    roleLoved: document.getElementById('pref-role-loved').value.trim(),
    roleHated: document.getElementById('pref-role-hated').value.trim(),
    workArrangement: [...document.querySelectorAll('input[name="work-arr"]:checked')].map(el => el.value),
    locationCity: document.getElementById('pref-location-city').value.trim(),
    locationState: document.getElementById('pref-location-state').value.trim(),
    userLocation: [document.getElementById('pref-location-city').value.trim(), document.getElementById('pref-location-state').value.trim()].filter(Boolean).join(', '),
    maxTravel: document.getElementById('pref-max-travel').value.trim(),
    salaryFloor: document.getElementById('pref-salary-floor').value.trim(),
    salaryStrong: document.getElementById('pref-salary-strong').value.trim()
  };
  chrome.storage.sync.set({ prefs }, () => {
    saveConfirm.classList.add('show');
    setTimeout(() => saveConfirm.classList.remove('show'), 2500);
  });
});

// Company bar toggle
document.getElementById('company-bar-toggle').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  const content = document.getElementById('company-content');
  const chevron = document.getElementById('company-chevron');
  const isOpen = chevron.classList.contains('open');
  chevron.classList.toggle('open', !isOpen);
  content.style.display = isOpen ? 'none' : 'block';
});

// Job bar toggle
document.getElementById('job-bar').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  const content = document.getElementById('job-content');
  const chevron = document.getElementById('job-chevron');
  const isOpen = chevron.classList.contains('open');
  chevron.classList.toggle('open', !isOpen);
  content.style.display = isOpen ? 'none' : 'block';
});

// Refresh button — re-detect company then research
searchBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    currentUrl = tabs[0]?.url || null;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_COMPANY' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.company) {
        contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
        return;
      }
      companyNameEl.textContent = response.company;
      currentJobTitle = response.jobTitle || null;
      currentJobMeta = response.jobMeta || null;
      detectedDomain = response.domain || null;
      // Clear stale job opportunity content before new data arrives
      const jobOpp = document.getElementById('job-opportunity');
      if (jobOpp) jobOpp.innerHTML = '';
      updateJobTitleBar();
      triggerResearch(response.company, true); // force bypass cache on manual refresh

      if (currentJobTitle) {
        startJobDescriptionFlow(tabs[0].id);
      }
    });
  });
});

function triggerResearch(company, forceRefresh = false) {
  if (!company || company === '—') {
    contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
    return;
  }

  // Show save button — mark as already saved if this company exists
  showSaveBar();
  checkAlreadySaved(company);

  // Show job meta immediately from DOM badges (no API wait needed)
  if (currentJobMeta && currentJobTitle) {
    renderJobSnapshot(currentJobMeta);
  }

  // Phase 1: show skeleton while Apollo loads
  contentEl.innerHTML = `
    <div class="section">
      <div class="section-title">Company Overview</div>
      <div class="skeleton-grid">
        <div class="skeleton-stat"></div><div class="skeleton-stat"></div>
        <div class="skeleton-stat"></div><div class="skeleton-stat"></div>
      </div>
    </div>
    <div class="loading" style="padding:24px 16px"><div class="spinner"></div>Analyzing ${company}...</div>`;

  chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
    loadPrefsWithMigration((prefs) => {
    void chrome.runtime.lastError;
    currentPrefs = prefs || currentPrefs;

    // On force refresh, wipe the cache entry so background doesn't serve stale data
    if (forceRefresh && researchCache?.[company.toLowerCase()]) {
      const pruned = { ...researchCache };
      delete pruned[company.toLowerCase()];
      chrome.storage.local.set({ researchCache: pruned });
    }

    // If we have a fresh cached result, render immediately — skip all API calls
    const cacheKey = company.toLowerCase();
    const cached = researchCache?.[cacheKey];
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL) {
      currentResearch = cached.data;
      renderResults(cached.data);
      if (cached.data.leaders?.length > 0) {
        const toFetch = cached.data.leaders.slice(0, 4);
        chrome.runtime.sendMessage({ type: 'GET_LEADER_PHOTOS', leaders: toFetch, company }, (photos) => {
          void chrome.runtime.lastError;
          if (!photos) return;
          photos.forEach((url, i) => {
            if (!url) return;
            const el = document.getElementById(`leader-avatar-${i}`);
            if (!el) return;
            const img = document.createElement('img');
            img.className = 'leader-avatar';
            img.onerror = () => { img.style.display = 'none'; };
            img.src = url;
            el.replaceWith(img);
          });
        });
      }
      return;
    }

    // Phase 1: Apollo quick lookup — renders stats while Claude runs
    chrome.runtime.sendMessage(
      { type: 'QUICK_LOOKUP', company, domain: detectedDomain },
      (quick) => {
        void chrome.runtime.lastError;
        if (quick && (quick.employees || quick.funding || quick.companyWebsite)) {
          if (quick.companyWebsite) setFavicon(quick.companyWebsite);
          renderQuickData(quick);
        }
      }
    );

    // Phase 2: Full research — fills in the rest when ready
    chrome.runtime.sendMessage(
      { type: 'RESEARCH_COMPANY', company, domain: detectedDomain, prefs: prefs || null },
      (response) => {
        void chrome.runtime.lastError;
        if (!response || response.error) {
          contentEl.innerHTML = '<div class="error">' + (response?.error || 'Something went wrong') + '</div>';
          return;
        }
        currentResearch = response;
        renderResults(response);

        // Write research data back to saved entry if missing
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          void chrome.runtime.lastError;
          const entries = savedCompanies || [];
          const idx = entries.findIndex(c => companiesMatch(c.company, company));
          if (idx !== -1) {
            let changed = false;
            const validLinkedin = url => url && !url.includes('/company/unavailable');
            const linkedinFromUrl = /linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null;
            const bestLinkedin = validLinkedin(response.companyLinkedin) ? response.companyLinkedin : (linkedinFromUrl || null);
            if (!entries[idx].companyWebsite && response.companyWebsite) { entries[idx].companyWebsite = response.companyWebsite; changed = true; }
            if ((!entries[idx].companyLinkedin || !validLinkedin(entries[idx].companyLinkedin)) && bestLinkedin) { entries[idx].companyLinkedin = bestLinkedin; changed = true; }
            if (response.jobListings?.length)  { entries[idx].jobListings  = response.jobListings;  changed = true; }
            if (response.leaders?.length)      { entries[idx].leaders      = response.leaders;      changed = true; }
            if (response.intelligence)         { entries[idx].intelligence = response.intelligence; changed = true; }
            if (changed) chrome.storage.local.set({ savedCompanies: entries }, () => void chrome.runtime.lastError);
          }
        });

        // Load leader photos asynchronously after render
        if (response.leaders && response.leaders.length > 0) {
          const toFetch = response.leaders.slice(0, 4);
          chrome.runtime.sendMessage(
            { type: 'GET_LEADER_PHOTOS', leaders: toFetch, company },
            (photos) => {
              void chrome.runtime.lastError;
              if (!photos) return;
              photos.forEach((url, i) => {
                if (!url) return;
                const el = document.getElementById(`leader-avatar-${i}`);
                if (!el) return;
                const img = document.createElement('img');
                img.className = 'leader-avatar';
                img.onerror = () => { img.style.display = 'none'; };
                img.src = url;
                el.replaceWith(img);
              });
            }
          );
        }
      }
    );
    }); // loadPrefsWithMigration
  }); // local.get researchCache
}

function updateJobTitleBar() {
  const jobBar = document.getElementById('job-bar');
  const titleEl = document.getElementById('job-title-bar');
  const jobContent = document.getElementById('job-content');
  const jobChevron = document.getElementById('job-chevron');
  if (!jobBar || !titleEl) return;
  if (currentJobTitle) {
    titleEl.textContent = currentJobTitle;
    jobBar.style.display = 'flex';
    if (jobContent) jobContent.style.display = 'block';
    if (jobChevron) jobChevron.classList.add('open');
    saveJobBtn.classList.remove('saved');
    saveJobBtn.textContent = '+ Save Job Posting';
    // Check if this job posting was already saved
    const company = companyNameEl?.textContent;
    if (company && currentJobTitle) {
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const dup = (savedCompanies || []).find(
          c => c.isOpportunity &&
            c.company.toLowerCase() === company.toLowerCase() &&
            (c.jobTitle || '').toLowerCase() === currentJobTitle.toLowerCase()
        );
        if (dup) { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
      });
    }
  } else {
    jobBar.style.display = 'none';
    if (jobContent) jobContent.style.display = 'none';
  }
}

const JOB_STATUSES = {
  needs_review: 'Saved — Needs Review',
  want_to_apply: 'I Want to Apply',
  applied: 'Applied',
  intro_requested: 'Intro Requested',
  conversations: 'Conversations in Progress',
  offer_stage: 'Offer Stage',
  accepted: 'Accepted',
  rejected: "Rejected / DQ'd"
};

function showCrmLink(savedEntry) {
  const crmLink = document.getElementById('crm-link');
  if (!crmLink || !savedEntry) return;
  crmLink.href = chrome.runtime.getURL(`company.html?id=${savedEntry.id}`);
  crmLink.style.display = 'inline';
}

function showSaveBar() {
  saveBtn.textContent = '+ Save Company';
  saveBtn.classList.remove('saved');
  savePanel.classList.remove('visible');
  saveConfirmBtn.classList.remove('saved');
  const crmLink = document.getElementById('crm-link');
  if (crmLink) crmLink.style.display = 'none';
}

function checkAlreadySaved(company) {
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const entries = savedCompanies || [];
    const match = entries.find(c => companiesMatch(c.company, company));
    if (match) {
      currentSavedEntry = match;
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('saved');
      const crmLink = document.getElementById('crm-link');
      if (crmLink) {
        crmLink.href = chrome.runtime.getURL(`company.html?id=${match.id}`);
        crmLink.style.display = 'inline';
      }
      // Refresh contacts section if renderResults already ran
      const contactsSection = document.getElementById('sp-contacts-section');
      if (contactsSection) renderContactsSection(contactsSection, match.knownContacts || []);
    }
  });
}

function renderJobSnapshot(snap) {
  const inlineEl = document.getElementById('job-snapshot-inline');
  if (!inlineEl || !snap) return;
  const arrClass = snap.workArrangement === 'Remote' ? 'remote' : snap.workArrangement === 'Hybrid' ? 'hybrid' : snap.workArrangement === 'On-site' ? 'onsite' : '';
  const arrIcon = snap.workArrangement === 'Remote' ? '🌐' : snap.workArrangement === 'Hybrid' ? '🏠' : snap.workArrangement === 'On-site' ? '🏢' : '';
  const bits = [];
  if (snap.salary) bits.push(`<span class="job-snap-item salary"><span class="job-snap-icon">💰</span>${snap.salary}</span>`);
  if (snap.workArrangement) bits.push(`<span class="job-snap-item ${arrClass}"><span class="job-snap-icon">${arrIcon}</span>${snap.workArrangement}${snap.location ? ' · ' + snap.location : ''}</span>`);
  if (snap.employmentType) bits.push(`<span class="job-snap-item type"><span class="job-snap-icon">🕐</span>${snap.employmentType}</span>`);
  inlineEl.innerHTML = bits.join('');
}

function triggerJobAnalysis(company, jobDescription) {
  const prefs = currentPrefs; // snapshot at call time
  chrome.runtime.sendMessage(
    { type: 'ANALYZE_JOB', company, jobTitle: currentJobTitle, jobDescription, prefs },
    (data) => {
      void chrome.runtime.lastError;
      if (!data) return;
      if (currentResearch) {
        currentResearch.jobMatch = data.jobMatch || null;
        if (data.jobSnapshot) currentResearch.jobSnapshot = data.jobSnapshot;
      }
      if (data.jobSnapshot) renderJobSnapshot(data.jobSnapshot);
      renderJobOpportunity(data.jobMatch || null, data.jobSnapshot || null);
    }
  );
}

function renderJobOpportunity(jobMatch, jobSnapshot) {
  const jobOpportunityEl = document.getElementById('job-opportunity');
  if (!jobOpportunityEl || !currentJobTitle) return;

  function scoreToVerdict(score) {
    if (score >= 8) return { label: 'Strong Match', cls: 'high' };
    if (score >= 6) return { label: 'Good Match', cls: 'mid' };
    if (score >= 4) return { label: 'Mixed Signals', cls: 'mixed' };
    return { label: 'Likely Not a Fit', cls: 'low' };
  }

  const jobArr = jobSnapshot?.workArrangement || currentJobMeta?.workArrangement;
  const jobLoc = jobSnapshot?.location || currentJobMeta?.location;
  const userWants = currentPrefs?.workArrangement || [];
  let locationMatchHtml = '';
  if (jobArr) {
    if (userWants.length > 0) {
      if (userWants.includes(jobArr)) {
        let detail = jobArr;
        if (jobArr === 'Remote' && currentPrefs?.remoteGeo) detail += ` · ${currentPrefs.remoteGeo}`;
        else if (jobLoc) detail += ` · ${jobLoc}`;
        locationMatchHtml = `<div class="location-match ok"><span class="loc-icon">✓</span> ${detail} — matches your preference</div>`;
      } else {
        let jobDetail = jobArr + (jobLoc ? ` · ${jobLoc}` : '');
        locationMatchHtml = `<div class="location-match bad"><span class="loc-icon">✗</span> ${jobDetail} — you want ${userWants.join('/')}</div>`;
      }
    } else {
      locationMatchHtml = `<div class="location-match neutral"><span class="loc-icon">📍</span> ${jobArr}${jobLoc ? ' · ' + jobLoc : ''}</div>`;
    }
  }

  if (!locationMatchHtml && !jobMatch) {
    jobOpportunityEl.innerHTML = '';
    return;
  }

  const hasMatch = !!(jobMatch);
  const v = hasMatch ? scoreToVerdict(jobMatch.score) : null;
  jobOpportunityEl.innerHTML = `
    <div class="section section-job job-opportunity-section">
      <div class="section-title">Job Opportunity</div>
      ${locationMatchHtml}
      ${(jobSnapshot?.salary || currentJobMeta?.salary) ? `<div class="salary-display"><span class="salary-label">Base Salary</span><span class="salary-value">${jobSnapshot?.salary || currentJobMeta?.salary}</span></div>` : ''}
      ${hasMatch && jobMatch.jobSummary ? `<div class="job-summary">${jobMatch.jobSummary}</div>` : ''}
      ${hasMatch ? `
        <div class="verdict-row" style="margin-top:12px">
          <span class="verdict-badge ${v.cls}">${v.label}</span>
          <span class="fit-verdict">${jobMatch.verdict}</span>
        </div>
        ${jobMatch.strongFits ? `<details open class="flags-green"><summary>Green Flags</summary><div class="detail-body">${renderBullets(jobMatch.strongFits, 'fit')}</div></details>` : ''}
        ${(jobMatch.redFlags || jobMatch.watchOuts) ? `<details open class="flags-red"><summary>Red Flags</summary><div class="detail-body">${renderBullets(jobMatch.redFlags || jobMatch.watchOuts, 'flag')}</div></details>` : ''}
      ` : ''}
    </div>`;
}

function renderQuickData(data) {
  const companySlug = companyNameEl.textContent.toLowerCase().replace(/\s+/g, '-');
  const crunchbaseUrl = `https://www.crunchbase.com/organization/${companySlug}`;

  // Company links
  const links = [];
  if (data.companyWebsite) links.push(`<a class="company-link" href="${data.companyWebsite}" target="_blank">↗ Website</a>`);
  if (data.companyLinkedin) links.push(`<a class="company-link" href="${data.companyLinkedin}" target="_blank">in LinkedIn</a>`);
  companyLinksEl.innerHTML = links.length > 0 ? `<div class="company-links">${links.join('')}</div>` : '';

  // Stats
  const statDefs = [
    { label: 'Employees', value: data.employees, url: data.companyLinkedin ? data.companyLinkedin.replace(/\/?$/, '/') + 'people/' : null },
    { label: 'Total Funding', value: data.funding, url: crunchbaseUrl },
    { label: 'Industry', value: data.industry, url: null },
    { label: 'Founded', value: data.founded, url: null }
  ].filter(s => s.value && s.value !== 'null');

  if (statDefs.length === 0) return;

  const statsHtml = statDefs.map(s => {
    const inner = `<div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div>`;
    return s.url ? `<a class="stat" href="${s.url}" target="_blank">${inner}</a>` : `<div class="stat">${inner}</div>`;
  }).join('');

  contentEl.innerHTML = `
    <div class="section">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
    </div>
    <div class="loading" style="padding:24px 16px"><div class="spinner"></div>Analyzing ${companyNameEl.textContent}...</div>`;
}

function renderBullets(items, type) {
  // Handles both array (new) and string (legacy) formats
  let bullets;
  if (Array.isArray(items)) {
    bullets = items.filter(Boolean);
  } else {
    // Split prose on sentence boundaries to approximate bullets
    bullets = String(items).split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 4);
  }
  if (bullets.length === 0) return '';
  const icon = type === 'fit' ? '✓' : '✗';
  const cls = type === 'fit' ? 'bullet-fit' : 'bullet-flag';
  return `<ul class="match-bullets">${bullets.map(b => `<li class="${cls}"><span class="bullet-icon">${icon}</span>${b.trim()}</li>`).join('')}</ul>`;
}

function setFavicon(domain) {
  const favicon = document.getElementById('company-favicon');
  if (!favicon) return;
  if (!domain) { favicon.style.display = 'none'; return; }
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  favicon.src = `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=64`;
  favicon.style.display = 'block';
  favicon.onerror = () => { favicon.style.display = 'none'; };
}

function renderResults(data) {
  // Job snapshot badges — use DOM meta (jobSnapshot comes via ANALYZE_JOB separately)
  renderJobSnapshot(currentJobMeta || null);

  // Company favicon
  setFavicon(data.companyWebsite || detectedDomain);

  // Company links bar
  const links = [];
  if (data.companyWebsite) links.push(`<a class="company-link" href="${data.companyWebsite}" target="_blank">↗ Website</a>`);
  if (data.companyLinkedin) links.push(`<a class="company-link" href="${data.companyLinkedin}" target="_blank">in LinkedIn</a>`);
  companyLinksEl.innerHTML = links.length > 0 ? `<div class="company-links">${links.join('')}</div>` : '';

  // Stats
  const companySlug = companyNameEl.textContent.toLowerCase().replace(/\s+/g, '-');
  const crunchbaseUrl = `https://www.crunchbase.com/organization/${companySlug}`;
  const statDefs = [
    { label: 'Employees', value: data.employees, url: data.companyLinkedin ? data.companyLinkedin.replace(/\/?$/, '/') + 'people/' : null },
    { label: 'Total Funding', value: data.funding, url: crunchbaseUrl },
    { label: 'Industry', value: data.industry, url: null },
    { label: 'Founded', value: data.founded, url: null }
  ].filter(s => s.value && s.value !== 'null');

  const statsHtml = statDefs.length > 0
    ? statDefs.map(s => {
        const inner = `<div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div>`;
        return s.url
          ? `<a class="stat" href="${s.url}" target="_blank">${inner}</a>`
          : `<div class="stat">${inner}</div>`;
      }).join('')
    : '<div class="stat"><div class="stat-value" style="color:#555">No firmographic data available</div></div>';

  // Intelligence / What They Do
  const intel = data.intelligence || {};
  const intelHtml = intel.oneLiner ? `
    <div class="one-liner">${intel.oneLiner}</div>
    ${intel.category ? `<span class="intel-category">${intel.category}</span>` : ''}
    ${intel.eli5 ? `<details><summary>Simple explanation</summary><div class="detail-body">${intel.eli5}</div></details>` : ''}
    ${intel.whosBuyingIt ? `<details><summary>Who buys it</summary><div class="detail-body">${intel.whosBuyingIt}</div></details>` : ''}
    ${intel.howItWorks ? `<details><summary>How it works</summary><div class="detail-body">${intel.howItWorks}</div></details>` : ''}
  ` : '<div style="color:#555;font-size:13px">No product data available</div>';

  function scoreToVerdict(score) {
    if (score >= 8) return { label: 'Strong Match', cls: 'high' };
    if (score >= 6) return { label: 'Good Match', cls: 'mid' };
    if (score >= 4) return { label: 'Mixed Signals', cls: 'mixed' };
    return { label: 'Likely Not a Fit', cls: 'low' };
  }

  // Company fit intentionally omitted — only job-level fit (via ANALYZE_JOB) is shown

  // Job opportunity rendered independently by triggerJobAnalysis/renderJobOpportunity

  // Reviews
  const reviewsHtml = data.reviews && data.reviews.length > 0
    ? data.reviews.map(r => {
        const inner = `${r.snippet}<div class="review-source">${r.source}</div>`;
        return r.url
          ? `<a class="review-item" href="${r.url}" target="_blank">${inner}</a>`
          : `<div class="review-item">${inner}</div>`;
      }).join('')
    : '<div class="review-item" style="color:#555">No reviews found</div>';

  // Leaders
  const leadersHtml = data.leaders && data.leaders.length > 0
    ? data.leaders.map((l, i) => {
        const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(l.name + ' ' + companyNameEl.textContent)}`;
        const initials = l.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        return `
          <div class="leader-item">
            <div class="leader-avatar-initials" id="leader-avatar-${i}">${initials}</div>
            <div class="leader-info">
              <div class="leader-name">${l.name}</div>
              <div class="leader-title">${l.title}</div>
            </div>
            <div class="leader-links">
              <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
              ${l.newsUrl ? `<a class="leader-link" href="${l.newsUrl}" target="_blank">News</a>` : ''}
            </div>
          </div>`;
      }).join('')
    : '<div style="color:#555;font-size:13px">No leadership data found</div>';

  // Hiring signals — current posting first, then other open roles
  const currentPosting = currentJobTitle && currentUrl
    ? [{ title: currentJobTitle, url: currentUrl, snippet: 'Currently viewing this posting', current: true }]
    : [];
  const otherListings = (data.jobListings || []).filter(j => j.url !== currentUrl).slice(0, 1);
  const allListings = [...currentPosting, ...otherListings];
  const jobsHtml = allListings.length > 0
    ? allListings.map(j => `
        <a class="job-item${j.current ? ' current-posting' : ''}" href="${j.url}" target="_blank">
          <div class="job-title">${j.title}${j.current ? ' <span style="font-size:10px;color:#6366f1;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Viewing</span>' : ''}</div>
          <div class="job-snippet">${j.snippet || ''}</div>
        </a>`).join('')
    : '<div style="color:#555;font-size:13px">No open roles found</div>';

  // Job opportunity is rendered separately by renderJobOpportunity() — don't touch #job-opportunity here

  // Known contacts — from saved entry (populated when Activity panel emails are scanned)
  const knownContacts = currentSavedEntry?.knownContacts || [];
  const contactsHtml = knownContacts.length > 0
    ? knownContacts.map(c => {
        const initials = c.name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
        const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + companyNameEl.textContent)}`;
        return `<div class="leader-item">
          <div class="leader-avatar-initials" style="background:linear-gradient(135deg,#0d9488,#0077b5);color:#fff">${initials}</div>
          <div class="leader-info">
            <div class="leader-name">${c.name}</div>
            <div class="leader-title" style="color:#0077b5">${c.email}</div>
          </div>
          <div class="leader-links">
            <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
          </div>
        </div>`;
      }).join('')
    : null;

  contentEl.innerHTML = `
    <div class="section section-overview">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
      ${intelHtml}
    </div>
    <div class="section section-signals">
      <div class="section-title">Hiring Signals</div>
      ${jobsHtml}
    </div>
    ${contactsHtml ? `<div class="section section-leadership" id="sp-contacts-section">
      <div class="section-title">Known Contacts</div>
      ${contactsHtml}
    </div>` : `<div id="sp-contacts-section"></div>`}
    <div class="section section-leadership">
      <div class="section-title">Leadership</div>
      ${leadersHtml}
    </div>
    <div class="section section-reviews">
      <div class="section-title">Reviews & Signal</div>
      ${reviewsHtml}
    </div>
  `;
}

function renderContactsSection(el, contacts) {
  if (!contacts.length) return;
  const html = contacts.map(c => {
    const initials = c.name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
    const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + companyNameEl.textContent)}`;
    return `<div class="leader-item">
      <div class="leader-avatar-initials" style="background:linear-gradient(135deg,#0d9488,#0077b5);color:#fff">${initials}</div>
      <div class="leader-info">
        <div class="leader-name">${c.name}</div>
        <div class="leader-title" style="color:#0077b5">${c.email}</div>
      </div>
      <div class="leader-links">
        <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
      </div>
    </div>`;
  }).join('');
  el.outerHTML = `<div class="section section-leadership" id="sp-contacts-section">
    <div class="section-title">Known Contacts</div>
    ${html}
  </div>`;
}
