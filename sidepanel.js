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
let _sessionSaves = [];

// Auto-set "Action On" based on stage
function defaultActionStatus(stageKey) {
  if (/needs_review|want_to_apply|interested/i.test(stageKey)) return 'my_court';
  if (/applied|intro_requested|conversations|offer|accepted/i.test(stageKey)) return 'their_court';
  return null;
}
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

// Open full saved view
function openDashboard() {
  window.open(chrome.runtime.getURL('saved.html'), '_blank');
}
savedBtn.addEventListener('click', openDashboard);
document.getElementById('sp-logo')?.addEventListener('click', openDashboard);


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

    // Auto-tag Easy Apply jobs
    if (isJobSave && currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
      currentSaveTags.push('linkedin easy apply');
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

  // Auto-tag Easy Apply jobs
  if (isJobSave && currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
    currentSaveTags.push('linkedin easy apply');
  }

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
  // Auto-tag Easy Apply jobs
  if (currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
    currentSaveTags.push('linkedin easy apply');
  }
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
    // Auto-tag Easy Apply jobs
    if (currentJobMeta?.easyApply && !currentSaveTags.includes('linkedin easy apply')) {
      currentSaveTags.push('linkedin easy apply');
    }
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

function showPipelineStats() {
  const el = document.getElementById('sp-pipeline-stats');
  if (!el) return;
  chrome.storage.local.get(['savedCompanies', 'activityGoals', 'statCardConfigs'], data => {
    const companies = data.savedCompanies || [];
    const opps = companies.filter(c => c.isOpportunity);
    // Mirror the dashboard's selected period — same logic as saved.js getPeriodRange
    const period = localStorage.getItem('ci_activityPeriod') || 'daily';
    const goals = (data.activityGoals || {})[period] || {};
    const cards = data.statCardConfigs || [
      { key: 'saved', label: 'Opportunities Saved', stages: ['*'], color: '#0ea5e9' },
      { key: 'applied', label: 'Applications', stages: ['applied'], color: '#FF7A59' },
      { key: 'interviewed', label: 'New Conversations Started', stages: ['conversations'], color: '#fb923c' },
    ];

    // Replicate the exact same period range calculation as the dashboard
    const now = new Date();
    let start, end;
    const customRange = localStorage.getItem('ci_activityCustomRange');
    if (customRange) {
      try {
        const cr = JSON.parse(customRange);
        start = new Date(cr.start + 'T00:00:00').getTime();
        end = new Date(cr.end + 'T23:59:59').getTime();
      } catch(e) {}
    }
    if (!start) {
      if (period === 'daily') {
        const s = new Date(now); s.setHours(0,0,0,0);
        const e = new Date(now); e.setHours(23,59,59,999);
        start = s.getTime(); end = e.getTime();
      } else if (period === 'weekly') {
        const day = now.getDay();
        const mon = new Date(now); mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day)); mon.setHours(0,0,0,0);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
        start = mon.getTime(); end = sun.getTime();
      } else {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        start = s.getTime(); end = e.getTime();
      }
    }
    const inPeriod = ts => ts && ts >= start && ts <= end;

    // Same counting logic as dashboard — supports activity + snapshot modes
    const counts = cards.slice(0, 3).map(card => {
      let count;
      if (card.mode === 'snapshot') {
        count = card.stages.includes('*') ? opps.length : opps.filter(c => card.stages.includes(c.jobStage || 'needs_review')).length;
      } else {
        if (card.stages.includes('*')) {
          count = opps.filter(c => inPeriod(c.savedAt)).length;
        } else {
          count = opps.filter(c => card.stages.some(sk => inPeriod(c.stageTimestamps?.[sk]))).length;
        }
      }
      const goal = goals[card.key] || 0;
      return { ...card, count, goal };
    });

    // Mini ring SVG (16x16)
    function miniRing(count, goal, color) {
      if (!goal) return '';
      const pct = Math.min(1, count / goal);
      const r = 6, cx = 8, cy = 8, c = 2 * Math.PI * r;
      return `<svg class="sp-stat-ring" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2D3E50" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2"
          stroke-dasharray="${pct * c} ${c}" stroke-linecap="round"
          transform="rotate(-90 ${cx} ${cy})"/>
      </svg>`;
    }

    el.innerHTML = counts.map(c =>
      `<div class="sp-stat-chip">
        ${miniRing(c.count, c.goal, c.color)}
        <span class="sp-stat-num">${c.count}${c.goal ? `<span class="sp-stat-denom">/${c.goal}</span>` : ''}</span>
        <span class="sp-stat-label">${c.label}</span>
      </div>`
    ).join('<span style="color:#2D3E50">·</span>');
    el.style.display = 'flex';

    // Click to open dashboard
    el.onclick = () => {
      window.open(chrome.runtime.getURL('saved.html'), '_blank');
      window.close();
    };
  });
}

function markAsSaved() {
  saveConfirmBtn.textContent = '✓ Saved'; saveConfirmBtn.classList.add('saved');
  if (saveMode === 'job') { saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved'); }
  else                    { saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved'); }
}

// Show pipeline stats immediately on load
showPipelineStats();

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
    if (response.easyApply != null) {
      if (!currentJobMeta) currentJobMeta = {};
      currentJobMeta.easyApply = response.easyApply;
    }
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

    // Render saved match if available, otherwise show location match while scoring runs
    if (currentSavedEntry?.jobMatch) {
      renderJobOpportunity(currentSavedEntry.jobMatch, currentSavedEntry.jobSnapshot || descResponse.jobMeta || currentJobMeta || null);
    } else {
      renderJobOpportunity(null, descResponse.jobMeta || currentJobMeta || null);
    }

    // Store description for use in save + chat context
    if (descResponse.jobDescription) {
      currentJobDescription = descResponse.jobDescription;
      // If already saved with a job match score, use it — don't re-score
      if (currentSavedEntry?.jobMatch) {
        console.log('[SP] Using saved job match — skipping re-score');
        renderJobOpportunity(currentSavedEntry.jobMatch, currentSavedEntry.jobSnapshot || descResponse.jobMeta || currentJobMeta || null);
        return;
      }
      const run = (prefs) => { currentPrefs = currentPrefs || prefs; triggerJobAnalysis(companyNameEl.textContent, descResponse.jobDescription); };
      if (currentPrefs) { run(currentPrefs); } else { loadPrefsWithMigration((prefs) => run(prefs || null)); }
    }
  });
}

// Open Setup page in a new tab
settingsBtn.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('preferences.html'), '_blank');
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
  // Always re-query the CURRENT active tab — don't use stale currentTabId
  searchBtn.classList.add('refreshing');
  searchBtn.disabled = true;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab?.id) {
      contentEl.innerHTML = '<div class="empty">Navigate to a company page or job posting to get started.</div>';
      searchBtn.classList.remove('refreshing');
      searchBtn.disabled = false;
      return;
    }
    currentTabId = tab.id;
    currentUrl = tab.url || null;
    const prevCompany = companyNameEl.textContent;

    // Try to inject content script first in case it wasn't loaded
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});

    // Give content script a moment to initialize, then query
    setTimeout(() => {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_COMPANY' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.company) {
        // Try extracting company from tab title as fallback
        const titleCompany = tab.title?.split(/\s*[|·—–]\s*/)?.[0]?.trim();
        if (titleCompany && titleCompany.length > 1 && titleCompany.length < 50) {
          companyNameEl.textContent = titleCompany;
          triggerResearch(titleCompany, true);
          setTimeout(() => { searchBtn.classList.remove('refreshing'); searchBtn.disabled = false; }, 1000);
          return;
        }
        contentEl.innerHTML = '<div class="empty">Could not detect company on this page. Try navigating to a company website or job posting.</div>';
        searchBtn.classList.remove('refreshing');
        searchBtn.disabled = false;
        return;
      }
      // Flash if company changed
      if (prevCompany && prevCompany !== '—' && prevCompany !== response.company) {
        companyNameEl.style.animation = 'sp-company-flash 0.5s ease';
        setTimeout(() => companyNameEl.style.animation = '', 500);
      }
      // Reset state for fresh research
      companyNameEl.textContent = response.company;
      currentJobTitle = response.jobTitle || null;
      currentJobMeta = response.jobMeta || null;
      detectedDomain = response.domain || null;
      detectedCompanyLinkedin = response.companyLinkedinUrl || null;
      currentResearch = null;
      currentSavedEntry = null;
      const jobOpp = document.getElementById('job-opportunity');
      if (jobOpp) jobOpp.innerHTML = '';
      updateJobTitleBar();
      triggerResearch(response.company, true);
      if (currentJobTitle) startJobDescriptionFlow(tab.id);

      // Stop spinning after research starts (content loading handles the rest)
      setTimeout(() => {
        searchBtn.classList.remove('refreshing');
        searchBtn.disabled = false;
      }, 1000);
    });
    }, 300); // small delay for content script injection
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

  // If saved data was already loaded by checkAlreadySaved, skip API calls
  if (currentResearch && !forceRefresh) {
    console.log('[SP] Using saved research data — skipping API calls');
    return;
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

    // Derive a usable domain — LinkedIn pages have domain=null but may have a LinkedIn company URL
    const enrichDomain = (detectedDomain && !/linkedin\.com/i.test(detectedDomain)) ? detectedDomain : null;

    // Phase 1: Apollo quick lookup — renders stats while Claude runs
    chrome.runtime.sendMessage(
      { type: 'QUICK_LOOKUP', company, domain: enrichDomain, companyLinkedin: detectedCompanyLinkedin },
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
      { type: 'RESEARCH_COMPANY', company, domain: enrichDomain, companyLinkedin: detectedCompanyLinkedin, prefs: prefs || null },
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

    // Company stage dropdown — only show if NOT an opportunity (opportunity stage is primary)
    if (!savedEntry.isOpportunity) {
      const coOptions = coStages.map(s =>
        `<option value="${s.key}" ${(savedEntry.status || 'co_watchlist') === s.key ? 'selected' : ''}>${s.label}</option>`
      ).join('');
      fields.push(['Company', `<select class="sp-stage-select" id="sp-co-stage">${coOptions}</select>`]);
    }

    // Action On dropdown
    const actionOpts = '<option value="my_court"' + ((savedEntry.actionStatus || 'my_court') === 'my_court' ? ' selected' : '') + '>🏀 My Court</option><option value="their_court"' + (savedEntry.actionStatus === 'their_court' ? ' selected' : '') + '>⏳ Their Court</option>';
    fields.push(['Action On', `<select class="sp-stage-select" id="sp-action-status">${actionOpts}</select>`]);

    if (savedEntry.nextStep) fields.push(['Next Step', savedEntry.nextStep]);

    if (!fields.length) { el.style.display = 'none'; return; }

    el.innerHTML = fields.map(([k, v]) =>
      `<div class="sp-opp-row"><span class="sp-opp-key">${k}</span><span class="sp-opp-val">${v}</span></div>`
    ).join('') + `<div class="sp-notes-row">
      <textarea class="sp-notes-input" id="sp-notes-input" placeholder="Add notes...">${savedEntry.notes || ''}</textarea>
    </div>`;
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
        setTimeout(() => showPipelineStats(), 300);
      });
    }

    const oppSelect = el.querySelector('#sp-opp-stage');
    if (oppSelect) {
      oppSelect.addEventListener('change', () => {
        const ts = { ...(savedEntry.stageTimestamps || {}) };
        if (!ts[oppSelect.value]) ts[oppSelect.value] = Date.now();
        const stageChanges = { jobStage: oppSelect.value, stageTimestamps: ts, lastActivity: Date.now() };
        // Auto-set Action On based on stage
        const autoAction = defaultActionStatus(oppSelect.value);
        if (autoAction) stageChanges.actionStatus = autoAction;
        updateEntry(stageChanges);
        // Update Action On dropdown if visible
        const actionSel = el.querySelector('#sp-action-status');
        if (actionSel && autoAction) actionSel.value = autoAction;
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
        // Refresh stats
        setTimeout(() => showPipelineStats(), 300);
      });
    }

    // Notes
    const actionSelect = el.querySelector('#sp-action-status');
    if (actionSelect) {
      actionSelect.addEventListener('change', () => {
        updateEntry({ actionStatus: actionSelect.value });
      });
    }

    const notesInput = el.querySelector('#sp-notes-input');
    if (notesInput) {
      notesInput.addEventListener('blur', () => {
        updateEntry({ notes: notesInput.value.trim() || null });
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
  showPipelineStats();
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

  // Show queue buttons when job is detected, hide Save Company
  const queuePanel = document.getElementById('queue-save-panel');
  const queueConfirm = document.getElementById('queue-save-confirm');
  if (currentJobTitle) {
    saveBtn.style.display = 'none';
    if (queuePanel) queuePanel.style.display = 'block';
    if (queueConfirm) queueConfirm.style.display = 'none';
    // Reset queue button states
    const qBtn = document.getElementById('save-queue-btn');
    const rBtn = document.getElementById('save-research-btn');
    if (qBtn) { qBtn.disabled = false; qBtn.textContent = 'Save to AI queue'; }
    if (rBtn) { rBtn.disabled = false; rBtn.textContent = 'Save + research now'; }
  } else {
    saveBtn.style.display = '';
    if (queuePanel) queuePanel.style.display = 'none';
    if (queueConfirm) queueConfirm.style.display = 'none';
  }
}

function checkAlreadySaved(company) {
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const entries = savedCompanies || [];
    const match = entries.find(c => companiesMatch(c.company, company));
    if (match) {
      currentSavedEntry = match;
      // Fix company name if detected as "Unknown Company" but saved entry has real name
      if ((!company || company === 'Unknown Company') && match.company) {
        companyNameEl.textContent = match.company;
      }
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('saved');
      // Also mark queue buttons as saved if job detected
      if (currentJobTitle && match.isOpportunity) {
        const queuePanel = document.getElementById('queue-save-panel');
        if (queuePanel) queuePanel.style.display = 'none';
        const qBtn = document.getElementById('save-queue-btn');
        const rBtn = document.getElementById('save-research-btn');
        if (qBtn) { qBtn.disabled = true; qBtn.textContent = 'Saved'; }
        if (rBtn) { rBtn.disabled = true; rBtn.textContent = 'Saved'; }
      }
      showCrmLink(match);

      // Use saved research data instead of re-fetching from API
      if (match.intelligence || match.employees || match.industry) {
        const savedResearch = {
          intelligence: match.intelligence,
          employees: match.employees,
          funding: match.funding,
          founded: match.founded,
          industry: match.industry,
          companyWebsite: match.companyWebsite,
          companyLinkedin: match.companyLinkedin,
          reviews: match.reviews || [],
          leaders: match.leaders || [],
          jobListings: match.jobListings || [],
          jobMatch: match.jobMatch,
          jobSnapshot: match.jobSnapshot,
          enrichmentSource: 'Saved data',
        };
        currentResearch = savedResearch;
        if (match.companyWebsite) setFavicon(match.companyWebsite);
        renderResults(savedResearch);
        // Render existing job match in the job opportunity section
        if (match.jobMatch) {
          renderJobOpportunity(match.jobMatch, match.jobSnapshot || currentJobMeta || null);
        }
      }

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

  // LinkedIn chips are authoritative for work arrangement — AI snapshot can misinterpret territory mentions as "On-site"
  const jobArr = currentJobMeta?.workArrangement || jobSnapshot?.workArrangement;
  const jobLoc = currentJobMeta?.location || jobSnapshot?.location;
  const userWants = currentPrefs?.workArrangement || [];
  let locationMatchHtml = '';
  let locationSummary = '';
  if (jobArr) {
    if (userWants.length > 0) {
      // Match if jobArr exactly matches OR if jobArr text contains any preferred arrangement
      // e.g., "Flexible (Remote and On-site)" matches a "Remote" preference
      const jobArrLower = jobArr.toLowerCase();
      const isMatch = userWants.includes(jobArr) || userWants.some(w => jobArrLower.includes(w.toLowerCase())) || /flexible|hybrid.*remote|remote.*on.?site/i.test(jobArr);
      if (isMatch) {
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
  const easyApplyBadge = currentJobMeta?.easyApply ? '<span class="easy-apply-badge">⚡ Easy Apply</span>' : '';

  const autoOpen = hasMatch || locationMatchHtml;
  jobOpportunityEl.innerHTML = `
    <details class="jopp-dropdown"${autoOpen ? ' open' : ''}>
      <summary class="jopp-summary">
        <span class="jopp-summary-left">Job Opportunity</span>
        <span class="jopp-summary-right">${easyApplyBadge}${locationSummary}${summaryBadge}</span><span class="jopp-chevron">›</span>
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
          const noteActive = fb?.type === 'note' ? ' active note' : '';
          return `
          <div class="verdict-row" style="margin-top:12px">
            ${jobMatch.score ? `<span style="font-size:18px;font-weight:800;color:${jobMatch.score >= 7 ? '#00BDA5' : jobMatch.score >= 4 ? '#d97706' : '#f87171'};margin-right:4px">${jobMatch.score}<span style="font-size:12px;opacity:0.6">/10</span></span>` : ''}
            <span class="verdict-badge ${v.cls}">${v.label}</span>
            <span class="verdict-thumbs">
              <button class="thumb-btn${upActive}" data-dir="up" title="Agree with assessment">👍</button>
              <button class="thumb-btn${noteActive}" data-dir="note" title="Leave a note on the wording/format">💬</button>
              <button class="thumb-btn${downActive}" data-dir="down" title="Disagree with assessment">👎</button>
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
  const placeholder = dir === 'up' ? 'What resonated?' : dir === 'note' ? 'Feedback on wording, length, format...' : 'What felt off?';
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
  ].filter(s => s.value && s.value !== 'null' && !/not found|unknown|unavailable|n\/a/i.test(s.value));

  if (statDefs.length === 0) return;

  const statsHtml = statDefs.map(s => {
    const inner = `<div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div>`;
    return s.url ? `<a class="stat" href="${s.url}" target="_blank">${inner}</a>` : `<div class="stat">${inner}</div>`;
  }).join('');

  const sourceTag = data.enrichmentSource ? `<div style="font-size:10px;color:#4a6580;margin-top:6px">Source: ${data.enrichmentSource}</div>` : '';
  contentEl.innerHTML = `
    <div class="section">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
      ${sourceTag}
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
  return `<ul class="match-bullets">${bullets.map(b => `<li class="${cls}"><span class="bullet-icon">${icon}</span><span>${boldKeyPhrase(b.trim())}</span></li>`).join('')}</ul>`;
}

// Bold the key signal phrase in a flag bullet — typically the first clause
function boldKeyPhrase(text) {
  // Split on common connecting words — bold the part before them
  const splitRe = /\s+(matches|signals|aligns|mirrors|fits|exceeds|suggests|indicates|required|doesn't|limits|conflicts|may feel|verify|confirm|typical)\b/i;
  const m = text.match(splitRe);
  if (m) {
    const idx = text.indexOf(m[0]);
    return `<strong>${text.slice(0, idx)}</strong>${text.slice(idx)}`;
  }
  // Fallback: split on semicolon or em dash — bold the first part
  const dashSplit = text.match(/^(.+?)\s*[;—–]\s*(.+)$/);
  if (dashSplit) return `<strong>${dashSplit[1]}</strong> — ${dashSplit[2]}`;
  // No split point found — just return as-is
  return text;
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
  const ds = data.dataSources || {};
  const statDefs = [
    { label: 'Employees', value: data.employees, url: data.companyLinkedin ? data.companyLinkedin.replace(/\/?$/, '/') + 'people/' : null, src: ds.employees },
    { label: 'Total Funding', value: data.funding, url: crunchbaseUrl, src: ds.funding },
    { label: 'Industry', value: data.industry, url: null, src: ds.industry },
    { label: 'Founded', value: data.founded, url: null, src: ds.founded }
  ].filter(s => s.value && s.value !== 'null' && !/not found|unknown|unavailable|n\/a/i.test(s.value));

  const statsHtml = statDefs.length > 0
    ? statDefs.map(s => {
        const srcTag = s.src ? `<div class="stat-src">${s.src}</div>` : '';
        const inner = `<div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div>${srcTag}`;
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
        const inner = `${r.rating ? `<span style="color:#fbbf24;font-weight:700">${r.rating}★</span> ` : ''}${r.snippet}<div class="review-source">${r.source}</div>`;
        return r.url
          ? `<a class="review-item" href="${r.url}" target="_blank">${inner}</a>`
          : `<div class="review-item">${inner}</div>`;
      }).join('')
    : '<div class="review-item" style="color:#555">No reviews found</div>';

  // Leaders
  const leadersHtml = data.leaders && data.leaders.length > 0
    ? data.leaders.filter(l => l.name).map((l, i) => {
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
            <div class="leader-title" style="color:#0077b5;display:flex;align-items:center;gap:4px;">${c.email}<button class="copy-email-btn" data-copy-email="${c.email.replace(/"/g,'&quot;')}">⎘</button></div>
          </div>
          <div class="leader-links">
            <a class="leader-link" href="${liUrl}" target="_blank">LinkedIn</a>
          </div>
        </div>`;
      }).join('')
    : null;

  const srcLabel = (s) => s ? `<span class="data-src">${s}</span>` : '';
  contentEl.innerHTML = `
    <div class="section section-overview">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
      ${intelHtml}
      ${ds.intelligence ? srcLabel(ds.intelligence) : ''}
    </div>
    <div class="section section-signals">
      <div class="section-title">Hiring Signals ${srcLabel(ds.jobListings)}</div>
      ${jobsHtml}
    </div>
    ${contactsHtml ? `<div class="section section-leadership" id="sp-contacts-section">
      <div class="section-title">Known Contacts ${srcLabel('Gmail')}</div>
      ${contactsHtml}
    </div>` : `<div id="sp-contacts-section"></div>`}
    <div class="section section-leadership">
      <div class="section-title">Leadership ${srcLabel(ds.leaders)}</div>
      ${leadersHtml}
    </div>
    <div class="section section-reviews">
      <div class="section-title">Reviews & Signal ${srcLabel(ds.reviews)}</div>
      ${reviewsHtml}
    </div>
  `;
}

// Delegated copy email handler (replaces inline onclick)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy-email]');
  if (!btn) return;
  const email = btn.dataset.copyEmail;
  navigator.clipboard.writeText(email).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
});

function renderContactsSection(el, contacts) {
  if (!contacts.length) return;
  const html = contacts.map(c => {
    const initials = c.name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
    const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + companyNameEl.textContent)}`;
    return `<div class="leader-item">
      <div class="leader-avatar-initials" style="background:linear-gradient(135deg,#0d9488,#0077b5);color:#fff">${initials}</div>
      <div class="leader-info">
        <div class="leader-name">${c.name}</div>
        <div class="leader-title" style="color:#0077b5;display:flex;align-items:center;gap:4px;">${c.email}<button class="copy-email-btn" data-copy-email="${c.email.replace(/"/g,'&quot;')}">⎘</button></div>
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

(function initSidePanelInlineChat() {
  const chatEl = document.getElementById('sp-chat');
  const msgsEl = document.getElementById('sp-chat-messages');
  const inputEl = document.getElementById('sp-chat-input');
  const sendBtn = document.getElementById('sp-chat-send');
  const detachBtn = document.getElementById('sp-chat-detach');
  const chatResize = document.getElementById('sp-chat-resize');
  const chatSpacer = document.getElementById('sp-chat-spacer');
  console.log('[SP Chat] Init:', { chatEl: !!chatEl, msgsEl: !!msgsEl, inputEl: !!inputEl, sendBtn: !!sendBtn });
  if (!chatEl || !msgsEl || !inputEl || !sendBtn) { console.warn('[SP Chat] Missing elements — aborting init'); return; }

  // Restore saved chat height
  const savedChatH = localStorage.getItem('ci_sp_chat_height');
  if (savedChatH) msgsEl.style.maxHeight = savedChatH + 'px';

  // Drag top edge to resize chat height
  if (chatResize) {
    chatResize.addEventListener('mousedown', e => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = msgsEl.offsetHeight;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      const onMove = ev => {
        const newH = Math.max(60, Math.min(500, startH + (startY - ev.clientY)));
        msgsEl.style.maxHeight = newH + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem('ci_sp_chat_height', parseInt(msgsEl.style.maxHeight));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  let history = [];
  let isApplicationMode = false;

  // Model switcher — default GPT-4.1 mini, click to cycle
  const CHAT_MODELS = [
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', icon: '◆' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku', icon: '⚡' },
    { id: 'claude-sonnet-4-5-20250514', label: 'Sonnet', icon: '✦' },
    { id: 'gpt-4.1', label: 'GPT-4.1', icon: '◆' },
  ];
  let chatModelIdx = 0;
  const modelToggle = document.getElementById('sp-model-toggle');
  const modelLabel = document.getElementById('sp-model-label');
  function updateModelLabel() {
    if (modelLabel) modelLabel.textContent = CHAT_MODELS[chatModelIdx].icon + ' ' + CHAT_MODELS[chatModelIdx].label;
  }
  updateModelLabel();
  if (modelToggle) {
    modelToggle.addEventListener('click', () => {
      chatModelIdx = (chatModelIdx + 1) % CHAT_MODELS.length;
      updateModelLabel();
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
  }

  function renderMd(text) {
    let html = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (fenced)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="sp-code-block"><code>${code.trim()}</code><button class="sp-code-copy" title="Copy">📋</button></pre>`);

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="sp-inline-code">$1</code>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="sp-chat-img" src="$2" alt="$1" loading="lazy">');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="sp-chat-link">$1</a>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4 class="sp-chat-h">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="sp-chat-h">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h3 class="sp-chat-h">$1</h3>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr class="sp-chat-hr">');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul class="sp-chat-ul">${m}</ul>`);

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Line breaks (double newline = paragraph, single = br)
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, '');

    // Auto-link bare URLs
    html = html.replace(/(^|[^"=])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" class="sp-chat-link">$2</a>');

    return html;
  }

  function renderMessages(showThinking) {
    if (history.length === 0) {
      msgsEl.innerHTML = '<div class="sp-chat-empty">Ask about this role, company, or get help applying.</div>';
    } else {
      msgsEl.innerHTML = history.map((m, idx) => {
        const bubble = m.role === 'assistant' ? renderMd(m.content) : escHtml(m.content);
        const copyBtn = (m.role === 'assistant' && isApplicationMode && m.content && !m.content.startsWith('Paste the application'))
          ? `<button class="sp-chat-copy" data-idx="${idx}" title="Copy to clipboard">📋</button>`
          : '';
        return `<div class="sp-chat-msg sp-chat-msg-${m.role}"><div class="sp-chat-bubble">${bubble}</div>${copyBtn}</div>`;
      }).join('') + (showThinking ? '<div class="sp-chat-msg sp-chat-msg-assistant"><div class="sp-chat-bubble sp-chat-thinking"><span class="sp-thinking-dots"><span class="sp-thinking-dot"></span><span class="sp-thinking-dot"></span><span class="sp-thinking-dot"></span></span></div></div>' : '');
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Bind copy buttons
    msgsEl.querySelectorAll('.sp-chat-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const text = history[idx]?.content || '';
        // Strip any quotation mark wrapping and preamble
        const clean = text.replace(/^["']|["']$/g, '').trim();
        navigator.clipboard.writeText(clean).then(() => {
          btn.textContent = '✓';
          btn.style.color = '#00BDA5';
          setTimeout(() => { btn.textContent = '📋'; btn.style.color = ''; }, 1500);
        });
      });
    });

    // Code block copy buttons
    msgsEl.querySelectorAll('.sp-code-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.closest('pre')?.querySelector('code')?.textContent || '';
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1500);
        });
      });
    });
  }

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
      _applicationMode: isApplicationMode,
    };
  }

  async function send() {
    const text = inputEl.value.trim();
    console.log('[SP Chat] Send called, text:', text?.slice(0, 50));
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = '';
    history.push({ role: 'user', content: text });
    renderMessages(true);
    sendBtn.disabled = true;

    const context = buildChatContext();
    const apiMessages = history.map(m => ({ role: m.role, content: m.content }));

    let result;
    try {
      result = await Promise.race([
        new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', messages: apiMessages, context, chatModel: CHAT_MODELS[chatModelIdx].id }, r => {
            if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
            else resolve(r);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000))
      ]);
    } catch (e) {
      result = { error: e.message === 'timeout' ? 'Request timed out.' : e.message };
    }

    sendBtn.disabled = false;
    // If the backend fell back to a different model, show which one was used
    const replyText = result?.reply || result?.error || 'Something went wrong.';
    const fallbackNote = (result?.model && result.model !== CHAT_MODELS[chatModelIdx].id)
      ? `\n\n*— answered by ${result.model.includes('gpt') ? 'GPT-4.1 mini' : result.model} (fallback)*`
      : '';
    history.push({ role: 'assistant', content: replyText + fallbackNote });
    renderMessages();
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
  });

  // Quick action buttons
  chatEl.querySelector('.sp-chat-actions')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-prompt]');
    if (btn) {
      isApplicationMode = btn.dataset.prompt.toLowerCase().includes('application');
      inputEl.value = btn.dataset.prompt;
      send();
      return;
    }
    if (e.target.closest('[data-action="clear"]')) {
      history = [];
      isApplicationMode = false;
      renderMessages();
    }
  });

  // Detach to floating window
  // Expand/collapse chat within sidebar
  let chatExpanded = false;
  detachBtn?.addEventListener('click', () => {
    chatExpanded = !chatExpanded;
    if (chatExpanded) {
      msgsEl.style.maxHeight = '70vh';
      msgsEl.style.minHeight = '200px';
      detachBtn.textContent = '⤡'; // collapse icon
      detachBtn.title = 'Collapse chat';
    } else {
      msgsEl.style.maxHeight = localStorage.getItem('ci_sp_chat_height') ? localStorage.getItem('ci_sp_chat_height') + 'px' : '300px';
      msgsEl.style.minHeight = '60px';
      detachBtn.textContent = '⤢'; // expand icon
      detachBtn.title = 'Expand chat';
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  });

  // Show chat when company is detected
  const observer = new MutationObserver(() => {
    if (companyNameEl.textContent && companyNameEl.textContent !== 'Detecting…') {
      chatEl.style.display = 'block';
    }
  });
  observer.observe(companyNameEl, { childList: true, characterData: true, subtree: true });
  if (companyNameEl.textContent && companyNameEl.textContent !== 'Detecting…') {
    chatEl.style.display = 'block';
  }

  renderMessages();
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

// ── Queue Save Buttons ──────────────────────────────────────────────────────

function buildQueueEntry() {
  const company = companyNameEl.textContent;
  const companyWebsite = currentResearch?.companyWebsite || (detectedDomain && !/linkedin\.com/i.test(detectedDomain) ? `https://${detectedDomain}` : null);
  const companyLinkedin = currentResearch?.companyLinkedin || detectedCompanyLinkedin || (/linkedin\.com\/company\//i.test(currentUrl || '') ? currentUrl : null);
  const snap = currentResearch?.jobSnapshot || currentJobMeta;
  const tags = ['Job Posted'];
  if (currentJobMeta?.easyApply && !tags.includes('linkedin easy apply')) {
    tags.push('linkedin easy apply');
  }

  return {
    id:               Date.now().toString(36) + Math.random().toString(36).substr(2),
    type:             'company',
    company,
    savedAt:          Date.now(),
    notes:            '',
    rating:           null,
    tags,
    url:              null,
    oneLiner:         currentResearch?.intelligence?.oneLiner || null,
    category:         currentResearch?.intelligence?.category || null,
    employees:        currentResearch?.employees || null,
    funding:          currentResearch?.funding   || null,
    founded:          currentResearch?.founded   || null,
    companyWebsite,
    companyLinkedin,
    intelligence:     currentResearch?.intelligence || null,
    reviews:          currentResearch?.reviews      || null,
    leaders:          currentResearch?.leaders      || null,
    status:           'co_watchlist',
    isOpportunity:    true,
    jobStage:         'needs_review',
    jobTitle:         currentJobTitle || null,
    jobUrl:           currentUrl || null,
    jobMatch:         currentResearch?.jobMatch    || null,
    jobSnapshot:      snap || null,
    jobDescription:   currentJobDescription        || null,
    baseSalaryRange:  snap?.baseSalaryRange || (snap?.salaryType === 'base' ? snap?.salary : null) || null,
    oteTotalComp:     snap?.oteTotalComp || (snap?.salaryType === 'ote' ? snap?.salary : null) || null,
    equity:           snap?.equity || null,
    compSource:       snap?.salary || snap?.baseSalaryRange || snap?.oteTotalComp ? 'Job posting' : null,
    compAutoExtracted: !!(snap?.salary || snap?.baseSalaryRange || snap?.oteTotalComp),
  };
}

function queueSaveEntry(callback) {
  const company = companyNameEl.textContent;

  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const existing = savedCompanies || [];

    // Duplicate check
    const dupIdx = existing.findIndex(c => companiesMatch(c.company, company));
    if (dupIdx !== -1) {
      const prev = existing[dupIdx];
      if (prev.isOpportunity && prev.jobTitle && currentJobTitle && titlesAreSimilar(prev.jobTitle, currentJobTitle)) {
        // Same role — silently enrich
        enrichExistingOpportunity(prev, existing, dupIdx);
        showToast(`Updated existing opportunity at ${prev.company}`);
        callback(prev);
        return;
      }
      // Different role or company-only save — create new entry alongside
    }

    const entry = buildQueueEntry();

    // Persist
    chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, () => {
      void chrome.runtime.lastError;

      // Mark UI as saved
      saveJobBtn.textContent = '✓ Saved';
      saveJobBtn.classList.add('saved');
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('saved');

      // Queue quick fit scoring
      chrome.runtime.sendMessage({ type: 'QUEUE_QUICK_FIT', entryId: entry.id });

      // Compute structural matches
      loadPrefsWithMigration((prefs) => {
        chrome.runtime.sendMessage(
          { type: 'COMPUTE_STRUCTURAL_MATCHES', entry, prefs: prefs || currentPrefs || {} },
          (matches) => {
            void chrome.runtime.lastError;
            if (matches) {
              // Save structural matches back onto entry
              chrome.storage.local.get(['savedCompanies'], ({ savedCompanies: latest }) => {
                const entries = latest || [];
                const idx = entries.findIndex(c => c.id === entry.id);
                if (idx !== -1) {
                  Object.assign(entries[idx], { structuralMatches: matches });
                  chrome.storage.local.set({ savedCompanies: entries });
                }
              });
            }
          }
        );
      });

      // Track in session
      _sessionSaves.push({
        id: entry.id,
        company: entry.company,
        jobTitle: entry.jobTitle,
        quickFitScore: null,
        quickFitReason: null,
      });

      showPipelineStats();
      showCrmLink(entry);
      callback(entry);
    });
  });
}

function renderQueueConfirmation(entry) {
  const panel = document.getElementById('queue-save-confirm');
  const queuePanel = document.getElementById('queue-save-panel');
  if (!panel) return;
  if (queuePanel) queuePanel.style.display = 'none';
  savePanel.classList.remove('visible');

  let confirmRating = 0;
  let confirmTags = [...(entry.tags || [])];

  function renderTags() {
    const tagsEl = panel.querySelector('.confirm-tags');
    if (!tagsEl) return;
    tagsEl.innerHTML = confirmTags.map(t =>
      `<span class="confirm-tag">${t}<span class="remove-tag" data-tag="${t}">✕</span></span>`
    ).join('') + `<span class="confirm-add-tag" id="confirm-add-tag-btn">+ Add</span>`;
    tagsEl.querySelectorAll('.remove-tag').forEach(el => {
      el.addEventListener('click', () => {
        confirmTags = confirmTags.filter(t => t !== el.dataset.tag);
        renderTags();
        autoSaveConfirmField(entry.id, { tags: [...confirmTags] });
      });
    });
    const addBtn = tagsEl.querySelector('#confirm-add-tag-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const tag = prompt('Add tag:');
        if (tag && tag.trim() && !confirmTags.includes(tag.trim())) {
          confirmTags.push(tag.trim());
          renderTags();
          autoSaveConfirmField(entry.id, { tags: [...confirmTags] });
        }
      });
    }
  }

  function renderStars() {
    const starsEl = panel.querySelector('.confirm-stars');
    if (!starsEl) return;
    starsEl.innerHTML = [1,2,3,4,5].map(v =>
      `<span class="confirm-star${v <= confirmRating ? ' filled' : ''}" data-val="${v}">&#9733;</span>`
    ).join('');
    starsEl.querySelectorAll('.confirm-star').forEach(star => {
      star.addEventListener('mouseenter', () => {
        const hv = parseInt(star.dataset.val);
        starsEl.querySelectorAll('.confirm-star').forEach((s, i) => s.classList.toggle('hovered', i < hv));
      });
      star.addEventListener('click', () => {
        confirmRating = parseInt(star.dataset.val);
        renderStars();
        autoSaveConfirmField(entry.id, { rating: confirmRating });
      });
    });
    starsEl.addEventListener('mouseleave', () => {
      starsEl.querySelectorAll('.confirm-star').forEach(s => s.classList.remove('hovered'));
    });
  }

  function renderSessionFeed() {
    if (_sessionSaves.length === 0) return '';
    const items = _sessionSaves.slice().reverse().map(s => {
      let scoreCls = 'pending';
      let scoreText = '...';
      if (s.quickFitScore != null) {
        scoreText = s.quickFitScore + '/10';
        scoreCls = s.quickFitScore >= 7 ? 'high' : s.quickFitScore >= 4 ? 'mid' : 'low';
      }
      return `<div class="save-session-item" data-session-id="${s.id}">
        <div class="item-info">
          <div class="item-company">${s.company}</div>
          <div class="item-title">${s.jobTitle || ''}</div>
        </div>
        <span class="item-score ${scoreCls}">${scoreText}</span>
      </div>`;
    }).join('');
    return `<div class="save-session-feed" id="session-feed">
      <div class="feed-label">Saved this session</div>
      ${items}
    </div>`;
  }

  panel.innerHTML = `
    <div class="confirm-banner">Saved — AI fit scoring queued</div>
    <div class="confirm-company">${entry.company}</div>
    <div class="confirm-title">${entry.jobTitle || ''}</div>
    <div class="confirm-stars"></div>
    <textarea class="confirm-note" placeholder="Quick note... (optional)"></textarea>
    <div class="confirm-tags"></div>
    ${renderSessionFeed()}
  `;
  panel.style.display = 'block';

  renderStars();
  renderTags();

  // Auto-save note on blur
  const noteEl = panel.querySelector('.confirm-note');
  if (noteEl) {
    noteEl.addEventListener('blur', () => {
      autoSaveConfirmField(entry.id, { notes: noteEl.value.trim() });
    });
  }
}

function autoSaveConfirmField(entryId, changes) {
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const entries = savedCompanies || [];
    const idx = entries.findIndex(c => c.id === entryId);
    if (idx === -1) return;
    Object.assign(entries[idx], changes);
    chrome.storage.local.set({ savedCompanies: entries });
  });
}

function updateSessionFeedScore(entryId, score, reason) {
  const item = _sessionSaves.find(s => s.id === entryId);
  if (item) {
    item.quickFitScore = score;
    item.quickFitReason = reason;
  }
  // Re-render feed items in DOM if visible
  const feedEl = document.getElementById('session-feed');
  if (!feedEl) return;
  const itemEl = feedEl.querySelector(`[data-session-id="${entryId}"]`);
  if (!itemEl) return;
  const scoreEl = itemEl.querySelector('.item-score');
  if (scoreEl && score != null) {
    scoreEl.textContent = score + '/10';
    scoreEl.className = 'item-score ' + (score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low');
  }
}

// Listen for QUICK_FIT_COMPLETE messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'QUICK_FIT_COMPLETE' && message.entryId) {
    updateSessionFeedScore(message.entryId, message.score, message.reason);
  }
});

// "Save to AI queue" button
document.getElementById('save-queue-btn')?.addEventListener('click', function() {
  if (this.disabled) return;
  this.disabled = true;
  this.textContent = 'Saving...';
  queueSaveEntry((entry) => {
    renderQueueConfirmation(entry);
  });
});

// "Save + research now" button
document.getElementById('save-research-btn')?.addEventListener('click', function() {
  if (this.disabled) return;
  this.disabled = true;
  this.textContent = 'Saving & researching...';
  const qBtn = document.getElementById('save-queue-btn');
  if (qBtn) { qBtn.disabled = true; qBtn.textContent = 'Saved'; }

  queueSaveEntry((entry) => {
    // Hide confirmation — keep the existing research/scoring view
    const queueConfirm = document.getElementById('queue-save-confirm');
    if (queueConfirm) queueConfirm.style.display = 'none';
    const queuePanel = document.getElementById('queue-save-panel');
    if (queuePanel) queuePanel.style.display = 'none';

    // Trigger full research
    const company = companyNameEl.textContent;
    const enrichDomain = (detectedDomain && !/linkedin\.com/i.test(detectedDomain)) ? detectedDomain : null;
    chrome.runtime.sendMessage(
      { type: 'RESEARCH_COMPANY', company, domain: enrichDomain, companyLinkedin: detectedCompanyLinkedin, prefs: currentPrefs || null },
      (response) => {
        void chrome.runtime.lastError;
        if (!response || response.error) return;
        currentResearch = response;
        renderResults(response);

        // Now trigger job analysis with the research context
        if (currentJobDescription) {
          triggerJobAnalysis(company, currentJobDescription);
        }
      }
    );
  });
});
