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
let detectedCompanyLinkedin = null;
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

// Open full saved view and close the side panel so they don't compete
savedBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('saved.html') });
  window.close();
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
  currentSaveTags = isJob ? ['Job Posted'] : [];
  document.querySelectorAll('.save-star').forEach(s => s.classList.remove('filled'));
  renderSaveTagChips();

  // Derive tags from actual entries so stale/removed tags never appear
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    allKnownTags = [...new Set((savedCompanies || []).flatMap(c => c.tags || []))].sort();
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

function showSaveTagSuggestions() {
  const val = saveTagInput.value.trim().toLowerCase();
  const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !currentSaveTags.includes(t));
  if (matches.length === 0) { saveTagSuggestions.style.display = 'none'; return; }
  saveTagSuggestions.innerHTML = matches.slice(0, 8).map(t =>
    `<div class="save-tag-suggestion" data-tag="${t}">${t}</div>`
  ).join('');
  saveTagSuggestions.style.display = 'block';
  saveTagSuggestions.querySelectorAll('.save-tag-suggestion').forEach(el => {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); addSaveTag(el.dataset.tag); });
  });
}

saveTagInput.addEventListener('focus', showSaveTagSuggestions);
saveTagInput.addEventListener('input', showSaveTagSuggestions);

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
const allStars = [...document.querySelectorAll('.save-star')];
allStars.forEach(star => {
  star.addEventListener('mouseenter', () => {
    const hoverVal = parseInt(star.dataset.val);
    allStars.forEach((s, i) => s.classList.toggle('hovered', i < hoverVal));
  });
  star.addEventListener('click', () => {
    saveRating = parseInt(star.dataset.val);
    allStars.forEach((s, i) => s.classList.toggle('filled', i < saveRating));
  });
});
document.getElementById('save-stars').addEventListener('mouseleave', () => {
  allStars.forEach(s => s.classList.remove('hovered'));
});

// Save confirm
// Title similarity: strip seniority prefixes and compare core role words
function titlesAreSimilar(a, b) {
  if (!a || !b) return true; // if either is missing, treat as same
  const strip = t => t.toLowerCase()
    .replace(/^(senior|sr\.?|staff|principal|lead|head of|vp of?|director of?|chief|junior|jr\.?|associate|founding)\s+/i, '')
    .replace(/[,\-–—|·•].*$/, '') // strip suffixes like ", B2B SAAS"
    .trim();
  const ca = strip(a), cb = strip(b);
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  // Check word overlap — if >50% of words match
  const wa = ca.split(/\s+/), wb = cb.split(/\s+/);
  const shared = wa.filter(w => wb.includes(w)).length;
  return shared >= Math.min(wa.length, wb.length) * 0.5;
}

function showToast(msg) {
  const el = document.getElementById('sp-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

saveConfirmBtn.addEventListener('click', () => {
  if (saveConfirmBtn.classList.contains('saved')) return;
  const company = companyNameEl.textContent;
  const isJobSave = saveMode === 'job';
  const jobStageValue = isJobSave ? (document.getElementById('save-status-select')?.value || 'needs_review') : null;

  const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
  const companyLinkedin = currentResearch?.companyLinkedin || detectedCompanyLinkedin || (/linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null);

  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const existing = savedCompanies || [];

    const dupIdx = existing.findIndex(c => companiesMatch(c.company, company));

    if (dupIdx !== -1) {
      const prev = existing[dupIdx];

      // Smart duplicate detection for job saves
      if (isJobSave && prev.isOpportunity && prev.jobTitle && currentJobTitle) {
        if (titlesAreSimilar(prev.jobTitle, currentJobTitle)) {
          // Same role — silently enrich existing opportunity
          enrichExistingOpportunity(prev, existing, dupIdx);
          return;
        } else {
          // Different role — ask the user
          showDuplicateDialog(prev, existing, dupIdx);
          return;
        }
      }

      // Non-job save or no existing opportunity — merge as before
      mergeAndSave(prev, existing, dupIdx);
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
      ...(isJobSave ? (() => {
        const snap = currentResearch?.jobSnapshot;
        return {
          isOpportunity:  true,
          jobStage:       jobStageValue,
          jobTitle:       currentJobTitle || null,
          jobUrl:         currentUrl || null,
          jobMatch:       currentResearch?.jobMatch    || null,
          jobSnapshot:    snap || null,
          jobDescription: currentJobDescription        || null,
          baseSalaryRange:  snap?.baseSalaryRange || (snap?.salaryType === 'base' ? snap?.salary : null) || null,
          oteTotalComp:     snap?.oteTotalComp || (snap?.salaryType === 'ote' ? snap?.salary : null) || null,
          equity:           snap?.equity || null,
          compSource:       snap?.salary || snap?.baseSalaryRange || snap?.oteTotalComp ? 'Job posting' : null,
          compAutoExtracted: !!(snap?.salary || snap?.baseSalaryRange || snap?.oteTotalComp),
        };
      })() : {}),
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

function mergeAndSave(prev, existing, dupIdx) {
  const isJobSave = saveMode === 'job';
  const jobStageValue = isJobSave ? (document.getElementById('save-status-select')?.value || 'needs_review') : null;
  const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
  const companyLinkedin = currentResearch?.companyLinkedin || detectedCompanyLinkedin || (/linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null);

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
      isOpportunity:  true,
      jobStage:       prev.jobStage || jobStageValue,
      jobTitle:       currentJobTitle || prev.jobTitle || null,
      jobUrl:         currentUrl || prev.jobUrl || null,
      jobMatch:       prev.jobMatch || currentResearch?.jobMatch || null,
      jobSnapshot:    currentResearch?.jobSnapshot || prev.jobSnapshot || null,
      jobDescription: currentJobDescription || prev.jobDescription || null,
    } : {
      status: prev.status || 'co_watchlist',
    }),
  };
  const updated = [merged, ...existing.filter((_, i) => i !== dupIdx)];
  chrome.storage.local.set({ savedCompanies: updated }, () => {
    void chrome.runtime.lastError;
    markAsSaved();
    showCrmLink(merged);
  });
}

function enrichExistingOpportunity(prev, existing, dupIdx) {
  // Silently enrich — keep existing jobMatch untouched, backfill missing data
  const enriched = { ...prev };
  // Use longer/more detailed job description
  if (currentJobDescription && (!prev.jobDescription || currentJobDescription.length > prev.jobDescription.length)) {
    enriched.jobDescription = currentJobDescription;
  }
  // Backfill missing snapshot data
  if (currentResearch?.jobSnapshot) {
    enriched.jobSnapshot = { ...(prev.jobSnapshot || {}), ...currentResearch.jobSnapshot };
    // Only overwrite salary if it was missing
    if (prev.jobSnapshot?.salary) enriched.jobSnapshot.salary = prev.jobSnapshot.salary;
  }
  // Add new URL if different
  if (currentUrl && currentUrl !== prev.jobUrl) enriched.jobUrl = currentUrl;
  // Backfill company data
  enriched.intelligence = prev.intelligence || currentResearch?.intelligence || null;
  enriched.reviews = prev.reviews?.length ? prev.reviews : (currentResearch?.reviews || null);
  enriched.leaders = prev.leaders?.length ? prev.leaders : (currentResearch?.leaders || null);
  enriched.tags = [...new Set([...(prev.tags || []), ...currentSaveTags])];
  // Backfill comp fields (don't overwrite existing)
  const snap = currentResearch?.jobSnapshot;
  if (!enriched.baseSalaryRange && (snap?.baseSalaryRange || (snap?.salaryType === 'base' && snap?.salary))) {
    enriched.baseSalaryRange = snap.baseSalaryRange || snap.salary;
    enriched.compSource = enriched.compSource || 'Job posting';
    enriched.compAutoExtracted = true;
  }
  if (!enriched.oteTotalComp && (snap?.oteTotalComp || (snap?.salaryType === 'ote' && snap?.salary))) {
    enriched.oteTotalComp = snap.oteTotalComp || snap.salary;
    enriched.compSource = enriched.compSource || 'Job posting';
    enriched.compAutoExtracted = true;
  }
  if (!enriched.equity && snap?.equity) enriched.equity = snap.equity;

  const updated = [enriched, ...existing.filter((_, i) => i !== dupIdx)];
  chrome.storage.local.set({ savedCompanies: updated }, () => {
    void chrome.runtime.lastError;
    markAsSaved();
    showToast(`Updated existing opportunity at ${prev.company} with new details.`);
    showCrmLink(enriched);
  });
}

function showDuplicateDialog(prev, existing, dupIdx) {
  const dialog = document.getElementById('dup-dialog');
  const titleEl = document.getElementById('dup-dialog-title');
  const bodyEl = document.getElementById('dup-dialog-body');
  titleEl.textContent = `Existing opportunity at ${prev.company}`;
  bodyEl.innerHTML = `You're already tracking <strong>${prev.jobTitle}</strong> at ${prev.company}. This posting is for <strong>${currentJobTitle}</strong>. Is this a different role?`;
  dialog.classList.add('visible');

  const updateBtn = document.getElementById('dup-btn-update');
  const newBtn = document.getElementById('dup-btn-new');

  // Clean up old listeners
  const newUpdateBtn = updateBtn.cloneNode(true);
  const newNewBtn = newBtn.cloneNode(true);
  updateBtn.replaceWith(newUpdateBtn);
  newBtn.replaceWith(newNewBtn);

  newUpdateBtn.addEventListener('click', () => {
    dialog.classList.remove('visible');
    enrichExistingOpportunity(prev, existing, dupIdx);
  });
  newNewBtn.addEventListener('click', () => {
    dialog.classList.remove('visible');
    // Create brand new opportunity entry for the different role
    const company = companyNameEl.textContent;
    const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
    const companyLinkedin = currentResearch?.companyLinkedin || detectedCompanyLinkedin || null;
    const entry = {
      id:             Date.now().toString(36) + Math.random().toString(36).substr(2),
      type:           'company',
      company,
      savedAt:        Date.now(),
      notes:          saveNotes.value.trim(),
      rating:         saveRating || null,
      tags:           [...currentSaveTags],
      companyWebsite: companyWebsite || prev.companyWebsite || null,
      companyLinkedin: companyLinkedin || prev.companyLinkedin || null,
      intelligence:   prev.intelligence || currentResearch?.intelligence || null,
      reviews:        prev.reviews || currentResearch?.reviews || null,
      leaders:        prev.leaders || currentResearch?.leaders || null,
      employees:      prev.employees || currentResearch?.employees || null,
      funding:        prev.funding || currentResearch?.funding || null,
      founded:        prev.founded || currentResearch?.founded || null,
      status:         'co_watchlist',
      isOpportunity:  true,
      jobStage:       document.getElementById('save-status-select')?.value || 'needs_review',
      jobTitle:       currentJobTitle || null,
      jobUrl:         currentUrl || null,
      jobMatch:       currentResearch?.jobMatch || null,
      jobSnapshot:    currentResearch?.jobSnapshot || null,
      jobDescription: currentJobDescription || null,
    };
    chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, () => {
      void chrome.runtime.lastError;
      markAsSaved();
      showCrmLink(entry);
    });
  });
}

function markAsSaved() {
  saveConfirmBtn.textContent = '✓ Saved'; saveConfirmBtn.classList.add('saved');
  if (saveMode === 'job') { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
  else                    { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
}

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
    detectedCompanyLinkedin = response.companyLinkedinUrl || null;
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
    if (descResponse.jobMeta?.workArrangement || descResponse.jobMeta?.salary || descResponse.jobMeta?.perks?.length) {
      currentJobMeta = descResponse.jobMeta;
      renderJobSnapshot(descResponse.jobMeta);
    }

    // Always render location match immediately, even without description
    renderJobOpportunity(null, descResponse.jobMeta || currentJobMeta || null);

    // Store description for use in save + chat context
    if (descResponse.jobDescription) {
      currentJobDescription = descResponse.jobDescription;
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
  const tabId = currentTabId;
  if (!tabId) {
    contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
    return;
  }
  chrome.tabs.get(tabId, tab => {
    if (chrome.runtime.lastError || !tab) return;
    currentUrl = tab.url || null;
    chrome.tabs.sendMessage(tabId, { type: 'GET_COMPANY' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.company) {
        contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
        return;
      }
      companyNameEl.textContent = response.company;
      currentJobTitle = response.jobTitle || null;
      currentJobMeta = response.jobMeta || null;
      detectedDomain = response.domain || null;
      detectedCompanyLinkedin = response.companyLinkedinUrl || null;
      const jobOpp = document.getElementById('job-opportunity');
      if (jobOpp) jobOpp.innerHTML = '';
      updateJobTitleBar();
      triggerResearch(response.company, true);
      if (currentJobTitle) startJobDescriptionFlow(tabId);
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
    <div class="research-loader" id="research-loader"><span class="research-loader-icon">🔍</span><span class="research-loader-text" id="research-loader-text"></span></div>`;
  startResearchLoaderCycle(company);

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
    // Check if this company already has a saved opportunity (any role)
    if (currentSavedEntry?.isOpportunity) {
      saveJobBtn.textContent = '✓ Saved';
      saveJobBtn.classList.add('saved');
    } else {
      saveJobBtn.classList.remove('saved');
      saveJobBtn.textContent = '+ Save Job Posting';
      // Also check storage in case currentSavedEntry hasn't been set yet
      const company = companyNameEl?.textContent;
      if (company) {
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          const dup = (savedCompanies || []).find(
            c => c.isOpportunity && companiesMatch(c.company, company)
          );
          if (dup) { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
        });
      }
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

const COMPANY_STATUSES = {
  co_watchlist:   'Watch List',
  co_researching: 'Researching',
  co_networking:  'Networking',
  co_interested:  'Strong Interest',
  co_applied:     'Applied There',
  co_archived:    'Archived',
};

function renderOppFields(savedEntry) {
  const el = document.getElementById('sp-opp-fields');
  if (!el) return;
  if (!savedEntry) { el.style.display = 'none'; return; }

  // Load custom stages from storage for accurate dropdowns
  chrome.storage.local.get(['opportunityStages', 'companyStages', 'customStages'], data => {
    void chrome.runtime.lastError;
    const oppStages = data.opportunityStages || data.customStages || Object.entries(JOB_STATUSES).map(([key, label]) => ({ key, label }));
    const coStages = data.companyStages || Object.entries(COMPANY_STATUSES).map(([key, label]) => ({ key, label }));

    // Only show stage dropdowns and next step — other fields are in Company Overview below
    const fields = [];

    // Opportunity stage dropdown (most important — show first)
    if (savedEntry.isOpportunity) {
      const oppOptions = oppStages.map(s =>
        `<option value="${s.key}" ${(savedEntry.jobStage || 'needs_review') === s.key ? 'selected' : ''}>${s.label}</option>`
      ).join('');
      fields.push(['Stage', `<select class="sp-stage-select sp-stage-opp" id="sp-opp-stage">${oppOptions}</select>`]);
    }

    // Company stage dropdown
    const coOptions = coStages.map(s =>
      `<option value="${s.key}" ${(savedEntry.status || 'co_watchlist') === s.key ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    fields.push(['Company', `<select class="sp-stage-select" id="sp-co-stage">${coOptions}</select>`]);

    if (savedEntry.nextStep) fields.push(['Next Step', savedEntry.nextStep]);

    if (!fields.length) { el.style.display = 'none'; return; }

    el.innerHTML = fields.map(([k, v]) =>
      `<div class="sp-opp-row"><span class="sp-opp-key">${k}</span><span class="sp-opp-val">${v}</span></div>`
    ).join('');
    el.style.display = 'block';

    // Bind stage change handlers
    const updateEntry = (changes) => {
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const entries = savedCompanies || [];
        const idx = entries.findIndex(c => c.id === savedEntry.id);
        if (idx === -1) return;
        Object.assign(entries[idx], changes);
        Object.assign(savedEntry, changes);
        if (currentSavedEntry?.id === savedEntry.id) Object.assign(currentSavedEntry, changes);
        chrome.storage.local.set({ savedCompanies: entries });
      });
    };

    const coSelect = el.querySelector('#sp-co-stage');
    if (coSelect) {
      coSelect.addEventListener('change', () => {
        updateEntry({ status: coSelect.value });
        coSelect.style.animation = 'sp-stage-flash 0.4s ease';
        setTimeout(() => coSelect.style.animation = '', 400);
      });
    }

    const oppSelect = el.querySelector('#sp-opp-stage');
    if (oppSelect) {
      oppSelect.addEventListener('change', () => {
        const ts = { ...(savedEntry.stageTimestamps || {}) };
        if (!ts[oppSelect.value]) ts[oppSelect.value] = Date.now();
        updateEntry({ jobStage: oppSelect.value, stageTimestamps: ts, lastActivity: Date.now() });
        oppSelect.style.animation = 'sp-stage-flash 0.4s ease';
        setTimeout(() => oppSelect.style.animation = '', 400);
        // Update the header stage text
        const stageEl = document.getElementById('crm-stage');
        if (stageEl) {
          const label = oppStages.find(s => s.key === oppSelect.value)?.label || oppSelect.value;
          stageEl.textContent = label;
        }
        // Fire celebration
        _spFireCelebration(oppSelect.value);
      });
    }
  });
}

function showCrmLink(savedEntry) {
  const crmLink = document.getElementById('crm-link');
  if (!crmLink || !savedEntry) return;
  const focusParam = savedEntry.isOpportunity ? '&focus=opportunity' : '';
  crmLink.href = chrome.runtime.getURL(`company.html?id=${savedEntry.id}${focusParam}`);
  crmLink.style.display = 'inline';
  crmLink.onclick = () => window.close();
  // Stage is now shown as dropdown in sp-opp-fields — hide the header text
  const stageEl = document.getElementById('crm-stage');
  if (stageEl) stageEl.style.display = 'none';
  renderOppFields(savedEntry);
}

function showSaveBar() {
  saveBtn.textContent = '+ Save Company';
  saveBtn.classList.remove('saved');
  savePanel.classList.remove('visible');
  saveConfirmBtn.classList.remove('saved');
  const crmLink = document.getElementById('crm-link');
  if (crmLink) crmLink.style.display = 'none';
  const stageEl = document.getElementById('crm-stage');
  if (stageEl) stageEl.style.display = 'none';
  const oppFields = document.getElementById('sp-opp-fields');
  if (oppFields) oppFields.style.display = 'none';
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
      showCrmLink(match);
      // Auto-tag with 'Job Posted' when viewing from a job page
      if (currentJobTitle && !(match.tags || []).includes('Job Posted')) {
        match.tags = [...(match.tags || []), 'Job Posted'];
        currentSavedEntry = match;
        const updated = entries.map(c => companiesMatch(c.company, match.company) ? match : c);
        chrome.storage.local.set({ savedCompanies: updated }, () => void chrome.runtime.lastError);
      }
      // Refresh contacts section if renderResults already ran
      const contactsSection = document.getElementById('sp-contacts-section');
      if (contactsSection) renderContactsSection(contactsSection, match.knownContacts || []);
      // Auto-sync contacts in background if cache is stale (>4 hours)
      const SYNC_INTERVAL = 4 * 60 * 60 * 1000;
      if (!match.cachedEmailsAt || Date.now() - match.cachedEmailsAt > SYNC_INTERVAL) {
        syncContactsForEntry(match);
      }
    }
  });
}

// Silently fetch emails and update knownContacts for a saved entry
function syncContactsForEntry(savedEntry) {
  const domain = (savedEntry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!domain) return;
  const linkedinSlug = (savedEntry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  const knownContactEmails = (savedEntry.knownContacts || []).map(c => c.email);
  chrome.runtime.sendMessage(
    { type: 'GMAIL_FETCH_EMAILS', domain, companyName: savedEntry.company || '', linkedinSlug, knownContactEmails },
    result => {
      void chrome.runtime.lastError;
      if (!result?.emails?.length) return;
      const userEmail = (result.userEmail || '').toLowerCase();
      if (userEmail) chrome.storage.local.set({ gmailUserEmail: userEmail });

      const parseAddrs = field => {
        if (!field) return [];
        return field.split(/,\s*/).map(addr => {
          const m = addr.match(/^(.*?)\s*<([^>]+)>$/) || [null, '', addr.trim()];
          return { name: (m[1] || '').replace(/^["']+|["']+$/g, '').trim(), email: (m[2] || '').trim().toLowerCase() };
        }).filter(a => a.email.includes('@'));
      };

      // Detect user's own email by most frequent non-domain from: address
      const fromFreq = {};
      result.emails.forEach(e => {
        parseAddrs(e.from).forEach(({ email }) => {
          if (domain && email.endsWith('@' + domain)) return;
          fromFreq[email] = (fromFreq[email] || 0) + 1;
        });
      });
      const selfEmail = userEmail ||
        Object.entries(fromFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

      let current = (savedEntry.knownContacts || []).map(c => ({ ...c, aliases: c.aliases ? [...c.aliases] : [] }));
      if (selfEmail) current = current.filter(c => c.email.toLowerCase() !== selfEmail);

      const existing = new Set(current.map(c => c.email.toLowerCase()));
      const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';
      const namesMatch = (a, b) => {
        const words = s => s.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const wa = words(a), wb = words(b);
        return wa.length >= 2 && wb.length >= 2 && wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
      };
      result.emails.forEach(e => {
        const all = [...parseAddrs(e.from), ...parseAddrs(e.to), ...parseAddrs(e.cc)];
        const hasCompany = all.some(a => {
          const d = (a.email.split('@')[1] || '').toLowerCase();
          return d === domain || (baseDomain && d.split('.')[0] === baseDomain);
        });
        if (!hasCompany) return;
        all.forEach(({ name, email }) => {
          if (!email || (selfEmail && email === selfEmail) || existing.has(email)) return;
          existing.add(email);
          // Merge into existing contact if same name, otherwise add new
          const match = name && name.split(/\s+/).length >= 2
            ? current.find(c => namesMatch(c.name, name)) : null;
          if (match) {
            match.aliases.push(email);
          } else {
            current.push({ name: name || email.split('@')[0], email, aliases: [], source: 'email', detectedAt: Date.now() });
          }
        });
      });

      const cacheUpdates = { cachedEmails: result.emails, cachedEmailsAt: Date.now() };
      if (result.userEmail) cacheUpdates.gmailUserEmail = result.userEmail;

      const origLen = (savedEntry.knownContacts || []).length;
      const contactsChanged = current.length !== origLen ||
        current.some((c, i) => (c.aliases || []).length !== ((savedEntry.knownContacts || [])[i]?.aliases || []).length);
      if (contactsChanged) cacheUpdates.knownContacts = current;

      // Persist updates to storage
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        void chrome.runtime.lastError;
        const all = savedCompanies || [];
        const idx = all.findIndex(c => c.id === savedEntry.id);
        if (idx === -1) return;
        all[idx] = { ...all[idx], ...cacheUpdates };
        currentSavedEntry = all[idx];
        chrome.storage.local.set({ savedCompanies: all }, () => {
          void chrome.runtime.lastError;
          // Re-render contacts section if visible
          if (contactsChanged) {
            const contactsSection = document.getElementById('sp-contacts-section');
            if (contactsSection) renderContactsSection(contactsSection, all[idx].knownContacts || []);
          }
        });
      });
    }
  );
}

function renderJobSnapshot(snap) {
  const inlineEl = document.getElementById('job-snapshot-inline');
  if (!inlineEl || !snap) return;
  const arrClass = snap.workArrangement === 'Remote' ? 'remote' : snap.workArrangement === 'Hybrid' ? 'hybrid' : snap.workArrangement === 'On-site' ? 'onsite' : '';
  const arrIcon = snap.workArrangement === 'Remote' ? '🌐' : snap.workArrangement === 'Hybrid' ? '🏠' : snap.workArrangement === 'On-site' ? '🏢' : '';
  const bits = [];
  if (snap.salary) bits.push(`<span class="job-snap-item salary"><span class="job-snap-icon">💰</span>${snap.salary}${snap.salaryType === 'ote' ? ' OTE' : ''}</span>`);
  if (snap.workArrangement) bits.push(`<span class="job-snap-item ${arrClass}"><span class="job-snap-icon">${arrIcon}</span>${snap.workArrangement}${snap.location ? ' · ' + snap.location : ''}</span>`);
  if (snap.employmentType) bits.push(`<span class="job-snap-item type"><span class="job-snap-icon">🕐</span>${snap.employmentType}</span>`);
  (snap.perks || []).forEach(p => bits.push(`<span class="job-snap-item perk"><span class="job-snap-icon">🎁</span>${p}</span>`));
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
  let locationSummary = '';
  if (jobArr) {
    if (userWants.length > 0) {
      if (userWants.includes(jobArr)) {
        let detail = jobArr;
        if (jobArr === 'Remote' && currentPrefs?.remoteGeo) detail += ` · ${currentPrefs.remoteGeo}`;
        else if (jobLoc) detail += ` · ${jobLoc}`;
        locationMatchHtml = `<div class="location-match ok"><span class="loc-icon">✓</span> ${detail} — matches your preference</div>`;
        locationSummary = `<span class="jopp-sum-loc ok">✓ ${jobArr}</span>`;
      } else {
        let jobDetail = jobArr + (jobLoc ? ` · ${jobLoc}` : '');
        locationMatchHtml = `<div class="location-match bad"><span class="loc-icon">✗</span> ${jobDetail} — you want ${userWants.join('/')}</div>`;
        locationSummary = `<span class="jopp-sum-loc bad">✗ ${jobArr}</span>`;
      }
    } else {
      locationMatchHtml = `<div class="location-match neutral"><span class="loc-icon">📍</span> ${jobArr}${jobLoc ? ' · ' + jobLoc : ''}</div>`;
      locationSummary = `<span class="jopp-sum-loc">${jobArr}</span>`;
    }
  }

  const hasMatch = !!(jobMatch);
  const v = hasMatch ? scoreToVerdict(jobMatch.score) : null;

  // If no data yet, show loading state
  if (!locationMatchHtml && !hasMatch) {
    jobOpportunityEl.innerHTML = `
      <details class="jopp-dropdown">
        <summary class="jopp-summary">
          <span class="jopp-summary-left">Job Opportunity</span>
          <span class="jopp-summary-right"><span class="jopp-loader"><span class="jopp-loader-icon">🔍</span><span class="jopp-loader-text"></span></span></span><span class="jopp-chevron">›</span>
        </summary>
        <div class="jopp-body"><div class="jopp-loading-area"><span class="jopp-loader-icon jopp-loader-lg">🔍</span><span class="jopp-loader-text"></span></div></div>
      </details>`;
    startLoaderTextCycle(jobOpportunityEl);
    return;
  }

  const summaryBadge = v ? `<span class="verdict-badge-sm ${v.cls}">${v.label}</span>` : '';

  jobOpportunityEl.innerHTML = `
    <details class="jopp-dropdown">
      <summary class="jopp-summary">
        <span class="jopp-summary-left">Job Opportunity</span>
        <span class="jopp-summary-right">${locationSummary}${summaryBadge}</span><span class="jopp-chevron">›</span>
      </summary>
      <div class="jopp-body">
        ${locationMatchHtml}
        ${(jobSnapshot?.salary || currentJobMeta?.salary) ? `<div class="salary-display"><span class="salary-label">${jobSnapshot?.salaryType === 'ote' ? 'OTE' : 'Base Salary'}</span><span class="salary-value">${jobSnapshot?.salary || currentJobMeta?.salary}</span></div>` : ''}
        ${(jobSnapshot?.perks?.length || currentJobMeta?.perks?.length) ? `<div class="perks-display">${(jobSnapshot?.perks || currentJobMeta?.perks || []).map(p => `<span class="perk-chip">🎁 ${p}</span>`).join('')}</div>` : ''}
        ${hasMatch && jobMatch.jobSummary ? `<div class="job-summary">${jobMatch.jobSummary}</div>` : ''}
        ${hasMatch ? (() => {
          const fb = currentResearch?.matchFeedback;
          const upActive = fb?.type === 'up' ? ' active up' : '';
          const downActive = fb?.type === 'down' ? ' active down' : '';
          return `
          <div class="verdict-row" style="margin-top:12px">
            <span class="verdict-badge ${v.cls}">${v.label}</span>
            <span class="verdict-thumbs">
              <button class="thumb-btn${upActive}" data-dir="up" id="sp-thumb-up" title="Agree with assessment">👍</button>
              <button class="thumb-btn${downActive}" data-dir="down" id="sp-thumb-down" title="Disagree with assessment">👎</button>
            </span>
            <span class="fit-verdict">${jobMatch.verdict}</span>
          </div>
          <div id="sp-thumb-form" style="display:none"></div>
          ${jobMatch.strongFits ? `<details open class="flags-green"><summary>Green Flags</summary><div class="detail-body">${renderBullets(jobMatch.strongFits, 'fit')}</div></details>` : ''}
          ${(jobMatch.redFlags || jobMatch.watchOuts) ? `<details open class="flags-red"><summary>Red Flags</summary><div class="detail-body">${renderBullets(jobMatch.redFlags || jobMatch.watchOuts, 'flag')}</div></details>` : ''}
        `;
        })() : ''}
      </div>
    </details>`;
}

function startResearchLoaderCycle(company) {
  const phrases = [
    `Researching ${company}...`,
    'Pulling company intel...',
    'Scanning for leadership...',
    'Checking reviews & signals...',
    'Analyzing fit...',
    'Scoring match...',
  ];
  let idx = 0;
  const el = document.getElementById('research-loader-text');
  if (!el) return;
  const update = () => { el.textContent = phrases[idx]; idx = (idx + 1) % phrases.length; };
  update();
  const interval = setInterval(() => {
    if (!el.isConnected) { clearInterval(interval); return; }
    update();
  }, 1800);
}

function startLoaderTextCycle(container) {
  const phrases = ['Researching role...', 'Analyzing fit...', 'Scoring match...', 'Checking alignment...'];
  let idx = 0;
  const els = container.querySelectorAll('.jopp-loader-text');
  if (!els.length) return;
  const update = () => { els.forEach(el => el.textContent = phrases[idx]); idx = (idx + 1) % phrases.length; };
  update();
  const interval = setInterval(() => {
    if (!container.isConnected) { clearInterval(interval); return; }
    update();
  }, 1800);
}

// Thumbs feedback handler (delegated)
document.addEventListener('click', e => {
  const thumbBtn = e.target.closest('.thumb-btn');
  if (!thumbBtn) return;
  const dir = thumbBtn.dataset.dir;
  const formEl = document.getElementById('sp-thumb-form');
  if (!formEl) return;

  // Toggle active state
  document.querySelectorAll('.thumb-btn').forEach(b => b.classList.remove('active', 'up', 'down'));
  thumbBtn.classList.add('active', dir);

  // Show inline feedback form
  const placeholder = dir === 'up' ? 'What resonated?' : 'What felt off?';
  formEl.style.display = 'block';
  formEl.innerHTML = `<div class="thumb-feedback-form">
    <input class="thumb-feedback-input" id="sp-thumb-note" type="text" placeholder="${placeholder}">
    <button class="thumb-feedback-submit" id="sp-thumb-submit">Submit</button>
  </div>`;
  formEl.querySelector('#sp-thumb-note')?.focus();

  const submit = () => {
    const note = document.getElementById('sp-thumb-note')?.value?.trim() || '';
    const feedback = { type: dir, note, date: Date.now() };
    // Save to current research and persist to entry
    if (currentResearch) currentResearch.matchFeedback = feedback;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const companies = savedCompanies || [];
      const company = companyNameEl.textContent;
      const idx = companies.findIndex(c => companiesMatch(c.company, company));
      if (idx !== -1) {
        companies[idx] = { ...companies[idx], matchFeedback: feedback };
        chrome.storage.local.set({ savedCompanies: companies });
      }
    });
    formEl.innerHTML = `<div style="font-size:11px;color:#7da8c4;padding:4px 0">Thanks for the feedback</div>`;
    setTimeout(() => { formEl.style.display = 'none'; }, 2000);
  };

  document.getElementById('sp-thumb-submit')?.addEventListener('click', submit);
  document.getElementById('sp-thumb-note')?.addEventListener('keydown', e2 => {
    if (e2.key === 'Enter') submit();
  });
});

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
    <div class="research-loader" id="research-loader"><span class="research-loader-icon">🔍</span><span class="research-loader-text" id="research-loader-text"></span></div>`;
  startResearchLoaderCycle(companyNameEl.textContent);
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
  const description = intel.oneLiner || intel.eli5 || '';
  const intelHtml = description ? `
    <div class="one-liner">${description}</div>
    ${intel.category ? `<span class="intel-category">${intel.category}</span>` : ''}
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
            <div class="leader-title" style="color:#0077b5;display:flex;align-items:center;gap:4px;">${c.email}<button class="copy-email-btn" onclick="copyEmail(this,'${c.email.replace(/'/g,"\\'")}')">⎘</button></div>
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

function copyEmail(btn, email) {
  navigator.clipboard.writeText(email).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
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
        <div class="leader-title" style="color:#0077b5;display:flex;align-items:center;gap:4px;">${c.email}<button class="copy-email-btn" onclick="copyEmail(this,'${c.email.replace(/'/g,"\\'")}')">⎘</button></div>
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

// ── Side Panel Chat (launches floating widget on page) ──────────────────────

(function initSidePanelChatLauncher() {
  const chatEl = document.getElementById('sp-chat');
  const launchBtn = document.getElementById('sp-chat-launch');
  if (!chatEl || !launchBtn) return;

  function buildChatContext() {
    const company = companyNameEl?.textContent || '';
    const entry = currentSavedEntry || {};
    const research = currentResearch || {};
    return {
      todayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      todayTimestamp: Date.now(),
      type: currentJobTitle ? 'job' : 'company',
      company,
      jobTitle: currentJobTitle || entry.jobTitle || null,
      status: entry.status || null,
      notes: entry.notes || null,
      tags: entry.tags || [],
      intelligence: research.intelligence || entry.intelligence || null,
      jobMatch: research.jobMatch || entry.jobMatch || null,
      matchFeedback: entry.matchFeedback || null,
      jobDescription: currentJobDescription || entry.jobDescription || null,
      reviews: research.reviews || entry.reviews || [],
      leaders: research.leaders || entry.leaders || [],
      employees: research.employees || entry.employees || null,
      funding: research.funding || entry.funding || null,
      knownContacts: entry.knownContacts || [],
      emails: (entry.cachedEmails || []).slice(0, 20).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet })),
      meetings: entry.cachedMeetings || [],
      granolaNote: entry.cachedMeetingTranscript || entry.cachedMeetingNotes || null,
    };
  }

  launchBtn.addEventListener('click', () => {
    if (!currentTabId) return;
    const context = buildChatContext();
    chrome.tabs.sendMessage(currentTabId, { type: 'OPEN_FLOATING_CHAT', context }, r => {
      void chrome.runtime.lastError;
    });
  });

  // Show button when company is detected
  const observer = new MutationObserver(() => {
    if (companyNameEl.textContent && companyNameEl.textContent !== 'Detecting…') {
      chatEl.style.display = 'block';
    }
  });
  observer.observe(companyNameEl, { childList: true, characterData: true, subtree: true });
  if (companyNameEl.textContent && companyNameEl.textContent !== 'Detecting…') {
    chatEl.style.display = 'block';
  }
})();

// ── Celebrations (for stage changes in sidepanel) ──────────────────────────

let _spStageCelebrations = {};
chrome.storage.local.get(['stageCelebrations'], d => { if (d.stageCelebrations) _spStageCelebrations = d.stageCelebrations; });

function _spGetDefaultCeleb(key) {
  if (/applied/i.test(key)) return { type: 'thumbsup', sound: 'pop', count: 15 };
  if (/conversations?|mutual/i.test(key)) return { type: 'confetti', sound: 'pop', count: 30 };
  if (/offer|accepted|referral/i.test(key)) return { type: 'money', sound: 'chaching', count: 40 };
  if (/stalled/i.test(key)) return { type: 'stopsign', sound: 'none', count: 20 };
  if (/rejected|closed|dq/i.test(key)) return { type: 'peace', sound: 'farewell', count: 25 };
  return null;
}

function _spFireCelebration(stageKey) {
  const cfg = _spStageCelebrations[stageKey] || _spGetDefaultCeleb(stageKey);
  if (!cfg || cfg.type === 'none') return;
  const { type, sound, count } = cfg;

  if (sound === 'pop') { try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.setValueAtTime(600, c.currentTime); o.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.1); g.gain.setValueAtTime(0.3, c.currentTime); g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.15); o.start(); o.stop(c.currentTime + 0.15); } catch(e) {} }
  else if (sound === 'chaching') { try { const c = new AudioContext(); const t = c.currentTime; [800,1200,1600].forEach((f,i) => { const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = f; g.gain.setValueAtTime(0.2, t+i*0.12); g.gain.exponentialRampToValueAtTime(0.01, t+i*0.12+0.2); o.start(t+i*0.12); o.stop(t+i*0.12+0.2); }); } catch(e) {} }
  else if (sound === 'farewell') { try { const u = new SpeechSynthesisUtterance(['peace','adios','see ya','bye'][Math.floor(Math.random()*4)]); u.rate=1.1; u.pitch=1; u.volume=0.6; speechSynthesis.speak(u); } catch(e) {} }

  const colors = ['#ff4444','#ffbb00','#00cc88','#4488ff','#cc44ff','#ff8844','#00ccff','#ffcc00'];
  const isEmoji = type === 'thumbsup' || type === 'money' || type === 'stopsign' || type === 'peace';
  const baseEmoji = type === 'thumbsup' ? '👍' : type === 'stopsign' ? '🛑' : type === 'peace' ? '✌️' : '🤑';
  const n = count || 30;
  const particles = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font-size:' + (isEmoji ? '22px' : '10px') + ';';
    if (isEmoji) el.textContent = type === 'money' && Math.random() > 0.5 ? '💵' : baseEmoji;
    else { el.style.width = '8px'; el.style.height = '8px'; el.style.borderRadius = '2px'; el.style.background = colors[i % colors.length]; }
    document.body.appendChild(el);
    particles.push({ el, x: window.innerWidth/2 + (Math.random()-0.5)*200, y: window.innerHeight, vx: (Math.random()-0.5)*12, vy: -(Math.random()*14+8), life: 1 });
  }
  function animate() {
    let alive = 0;
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= 0.008;
      p.el.style.left = p.x+'px'; p.el.style.top = p.y+'px'; p.el.style.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.el.remove(); else alive++;
    }
    if (alive > 0) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
