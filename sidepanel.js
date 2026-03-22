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
let currentUrl = null;
let currentJobTitle = null;
let currentJobDescription = null;
let currentJobMeta = null;
let currentPrefs = null;
let saveRating = 0;

// Load preferences into settings fields
chrome.storage.local.get(['prefs'], ({ prefs }) => {
  if (prefs) {
    document.getElementById('pref-roles').value = prefs.roles || '';
    document.getElementById('pref-avoid').value = prefs.avoid || '';
    document.getElementById('pref-interests').value = prefs.interests || '';
    document.getElementById('pref-job-match-bg').value = prefs.jobMatchBackground || '';
    const toggle = document.getElementById('pref-job-match-toggle');
    toggle.checked = !!prefs.jobMatchEnabled;
    document.getElementById('job-match-fields').style.display = prefs.jobMatchEnabled ? 'block' : 'none';
    (prefs.workArrangement || []).forEach(val => {
      const cb = document.querySelector(`input[name="work-arr"][value="${val}"]`);
      if (cb) cb.checked = true;
    });
    document.getElementById('pref-remote-geo').value = prefs.remoteGeo || '';
    document.getElementById('pref-hybrid-location').value = prefs.hybridLocation || '';
    document.getElementById('pref-onsite-location').value = prefs.onsiteLocation || '';
    document.getElementById('pref-salary-floor').value = prefs.salaryFloor || prefs.minSalary || '';
    document.getElementById('pref-salary-strong').value = prefs.salaryStrong || '';
  }
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
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    type: isJobSave ? 'job' : 'company',
    company,
    jobTitle: currentJobTitle || null,
    url: currentUrl || null,
    rating: saveRating || null,
    notes: saveNotes.value.trim(),
    tags: [...currentSaveTags],
    savedAt: Date.now(),
    oneLiner: currentResearch?.intelligence?.oneLiner || null,
    category: currentResearch?.intelligence?.category || null,
    employees: currentResearch?.employees || null,
    funding: currentResearch?.funding || null,
    founded: currentResearch?.founded || null,
    companyWebsite: currentResearch?.companyWebsite || null,
    companyLinkedin: currentResearch?.companyLinkedin || null,
    jobMatchScore: currentResearch?.jobMatch?.score || null,
    jobMatchVerdict: currentResearch?.jobMatch?.verdict || null,
    salary: currentResearch?.jobSnapshot?.salary || null,
    workArrangement: currentResearch?.jobSnapshot?.workArrangement || null,
    location: currentResearch?.jobSnapshot?.location || null,
    status: (isJobSave ? document.getElementById('save-status-select')?.value : null) || 'needs_review'
  };
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const existing = savedCompanies || [];

    // Prevent duplicate company entries — update existing instead of adding a second
    if (!isJobSave) {
      const dupIdx = existing.findIndex(
        c => (c.type || 'company') === 'company' && c.company.toLowerCase() === company.toLowerCase()
      );
      if (dupIdx !== -1) {
        // Merge: keep old entry but apply new notes/rating/tags/status
        const merged = {
          ...existing[dupIdx],
          notes: entry.notes || existing[dupIdx].notes,
          rating: entry.rating || existing[dupIdx].rating,
          tags: [...new Set([...(existing[dupIdx].tags || []), ...entry.tags])],
          status: entry.status
        };
        const updated = [merged, ...existing.filter((_, i) => i !== dupIdx)];
        chrome.storage.local.set({ savedCompanies: updated }, () => {
          saveConfirmBtn.textContent = '✓ Saved';
          saveConfirmBtn.classList.add('saved');
          saveBtn.textContent = '✓ Saved';
          saveBtn.classList.add('saved');
        });
        return;
      }
    }

    let updated = [entry, ...existing];

    // Saving a job also auto-saves the company (if not already saved)
    if (entry.type === 'job') {
      const alreadyHasCompany = existing.some(
        c => (c.type || 'company') === 'company' && c.company.toLowerCase() === company.toLowerCase()
      );
      if (!alreadyHasCompany) {
        updated = [entry, {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          type: 'company',
          company,
          url: entry.companyWebsite || null,
          savedAt: Date.now(),
          oneLiner: entry.oneLiner,
          category: entry.category,
          employees: entry.employees,
          funding: entry.funding,
          founded: entry.founded,
          companyWebsite: entry.companyWebsite,
          companyLinkedin: entry.companyLinkedin,
          tags: [...currentSaveTags],
          status: 'needs_review',
          notes: ''
        }, ...existing];
      }
    }

    // Persist any new tags to the global tag list
    const newTags = currentSaveTags.filter(t => !allKnownTags.includes(t));
    if (newTags.length > 0) {
      allKnownTags = [...allKnownTags, ...newTags];
      chrome.storage.local.set({ allTags: allKnownTags });
    }

    chrome.storage.local.set({ savedCompanies: updated }, () => {
      saveConfirmBtn.textContent = '✓ Saved';
      saveConfirmBtn.classList.add('saved');
      if (isJobSave) {
        saveJobBtn.textContent = '✓ Saved'; saveJobBtn.classList.add('saved');
      } else {
        saveBtn.textContent = '✓ Saved'; saveBtn.classList.add('saved');
      }
    });
  });
});

// Detect company on load and auto-research
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
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
      if (currentPrefs) { run(currentPrefs); } else { chrome.storage.local.get(['prefs'], ({ prefs }) => run(prefs || null)); }
    }
  });
}

// Toggle settings panel
settingsBtn.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  settingsPanel.classList.toggle('visible', settingsOpen);
  settingsBtn.classList.toggle('active', settingsOpen);
  contentEl.style.display = settingsOpen ? 'none' : 'block';
  companyLinksEl.style.display = settingsOpen ? 'none' : 'block';
});

// Job match toggle
document.getElementById('pref-job-match-toggle').addEventListener('change', (e) => {
  document.getElementById('job-match-fields').style.display = e.target.checked ? 'block' : 'none';
});

// Save preferences
savePrefsBtn.addEventListener('click', () => {
  const prefs = {
    roles: document.getElementById('pref-roles').value.trim(),
    avoid: document.getElementById('pref-avoid').value.trim(),
    interests: document.getElementById('pref-interests').value.trim(),
    jobMatchEnabled: document.getElementById('pref-job-match-toggle').checked,
    jobMatchBackground: document.getElementById('pref-job-match-bg').value.trim(),
    workArrangement: [...document.querySelectorAll('input[name="work-arr"]:checked')].map(el => el.value),
    remoteGeo: document.getElementById('pref-remote-geo').value.trim(),
    hybridLocation: document.getElementById('pref-hybrid-location').value.trim(),
    onsiteLocation: document.getElementById('pref-onsite-location').value.trim(),
    salaryFloor: document.getElementById('pref-salary-floor').value.trim(),
    salaryStrong: document.getElementById('pref-salary-strong').value.trim()
  };
  chrome.storage.local.set({ prefs }, () => {
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
  if (settingsOpen) {
    settingsOpen = false;
    settingsPanel.classList.remove('visible');
    settingsBtn.classList.remove('active');
    contentEl.style.display = 'block';
    companyLinksEl.style.display = 'block';
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
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

  chrome.storage.local.get(['prefs', 'researchCache'], ({ prefs, researchCache }) => {
    void chrome.runtime.lastError;
    currentPrefs = prefs || null;

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
  });
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

function showSaveBar() {
  saveBtn.textContent = '+ Save Company';
  saveBtn.classList.remove('saved');
  savePanel.classList.remove('visible');
  saveConfirmBtn.classList.remove('saved');
}

function checkAlreadySaved(company) {
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    void chrome.runtime.lastError;
    const entries = savedCompanies || [];
    const alreadySaved = entries.some(
      c => (c.type || 'company') === 'company' && c.company.toLowerCase() === company.toLowerCase()
    );
    if (alreadySaved) {
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('saved');
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
      ${hasMatch && jobMatch.jobSummary ? `<div class="job-summary">${jobMatch.jobSummary}</div>` : ''}
      ${hasMatch ? `
        <div class="verdict-row" style="margin-top:12px">
          <span class="verdict-badge ${v.cls}">${v.label}</span>
          <span class="fit-verdict">${jobMatch.verdict}</span>
        </div>
        ${jobMatch.strongFits ? `<details open><summary>Strong Fits</summary><div class="detail-body">${renderBullets(jobMatch.strongFits, 'fit')}</div></details>` : ''}
        ${(jobMatch.redFlags || jobMatch.watchOuts) ? `<details><summary>Red Flags</summary><div class="detail-body">${renderBullets(jobMatch.redFlags || jobMatch.watchOuts, 'flag')}</div></details>` : ''}
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
  const otherListings = (data.jobListings || []).filter(j => j.url !== currentUrl);
  const allListings = [...currentPosting, ...otherListings];
  const jobsHtml = allListings.length > 0
    ? allListings.map(j => `
        <a class="job-item${j.current ? ' current-posting' : ''}" href="${j.url}" target="_blank">
          <div class="job-title">${j.title}${j.current ? ' <span style="font-size:10px;color:#6366f1;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Viewing</span>' : ''}</div>
          <div class="job-snippet">${j.snippet || ''}</div>
        </a>`).join('')
    : '<div style="color:#555;font-size:13px">No open roles found</div>';

  // Job opportunity is rendered separately by renderJobOpportunity() — don't touch #job-opportunity here

  contentEl.innerHTML = `
    <div class="section section-intel">
      <div class="section-title">What They Do</div>
      ${intelHtml}
    </div>
    <div class="section section-overview">
      <div class="section-title">Company Overview</div>
      <div class="stat-grid">${statsHtml}</div>
    </div>
    <div class="section section-signals">
      <div class="section-title">Hiring Signals</div>
      ${jobsHtml}
    </div>
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
