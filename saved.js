let allCompanies = [];
let allKnownTags = [];
let activeType = 'all';
let activeRating = 'all';
let activeStatus = 'all';
let activeTag = null;

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
  needs_review: 'Saved — Needs Review',
  want_to_apply: 'I Want to Apply',
  applied: 'Applied',
  intro_requested: 'Intro Requested',
  conversations: 'Conversations in Progress',
  offer_stage: 'Offer Stage',
  accepted: 'Accepted',
  rejected: "Rejected / DQ'd"
};

// Deterministic color for a tag string
function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  const palette = [
    { border: '#818cf8', color: '#a5b4fc', bg: 'rgba(99,102,241,0.12)' },
    { border: '#34d399', color: '#6ee7b7', bg: 'rgba(52,211,153,0.12)' },
    { border: '#fb923c', color: '#fdba74', bg: 'rgba(251,146,60,0.12)' },
    { border: '#f472b6', color: '#f9a8d4', bg: 'rgba(244,114,182,0.12)' },
    { border: '#38bdf8', color: '#7dd3fc', bg: 'rgba(56,189,248,0.12)' },
    { border: '#c084fc', color: '#d8b4fe', bg: 'rgba(192,132,252,0.12)' },
    { border: '#4ade80', color: '#86efac', bg: 'rgba(74,222,128,0.12)' },
    { border: '#f59e0b', color: '#fcd34d', bg: 'rgba(245,158,11,0.12)' },
  ];
  return palette[Math.abs(hash) % palette.length];
}

function load() {
  chrome.storage.local.get(['savedCompanies', 'allTags'], ({ savedCompanies, allTags }) => {
    allCompanies = (savedCompanies || []).sort((a, b) => b.savedAt - a.savedAt);
    allKnownTags = allTags || [];
    // Sync any tags from saved entries that aren't in allTags yet
    const tagsFromEntries = [...new Set(allCompanies.flatMap(c => c.tags || []))];
    const merged = [...new Set([...allKnownTags, ...tagsFromEntries])];
    if (merged.length !== allKnownTags.length) {
      allKnownTags = merged;
      chrome.storage.local.set({ allTags: allKnownTags });
    }
    updateStatusToolbar();
    updateTagsToolbar();
    render();
  });
}

function updateTagsToolbar() {
  const toolbar = document.getElementById('tags-toolbar');
  const allTagsInUse = [...new Set(allCompanies.flatMap(c => c.tags || []))].sort();
  if (allTagsInUse.length === 0) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = 'flex';

  toolbar.innerHTML = '<span class="filter-label">Tags:</span>';
  const allBtn = document.createElement('button');
  allBtn.className = 'tag-filter-btn' + (activeTag === null ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.style.cssText = 'border-color:#334155;color:#64748b;';
  if (activeTag === null) allBtn.style.cssText = 'border-color:#6366f1;color:#818cf8;background:rgba(99,102,241,0.12);';
  allBtn.addEventListener('click', () => { activeTag = null; updateTagsToolbar(); render(); });
  toolbar.appendChild(allBtn);

  allTagsInUse.forEach(tag => {
    const c = tagColor(tag);
    const btn = document.createElement('button');
    btn.className = 'tag-filter-btn' + (activeTag === tag ? ' active' : '');
    btn.textContent = tag;
    btn.style.cssText = `border-color:${c.border};color:${activeTag === tag ? '#fff' : c.color};background:${activeTag === tag ? c.bg : 'transparent'};`;
    btn.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      updateTagsToolbar();
      render();
    });
    toolbar.appendChild(btn);
  });
}

function updateStatusToolbar() {
  const toolbar = document.getElementById('status-toolbar');
  const statuses = activeType === 'job' ? JOB_STATUSES
    : activeType === 'company' ? COMPANY_STATUSES
    : { ...JOB_STATUSES, ...COMPANY_STATUSES };

  const currentStatus = activeStatus;
  toolbar.innerHTML = '<span class="filter-label">Status:</span>';

  const allBtn = document.createElement('button');
  allBtn.className = 'status-filter-btn' + (currentStatus === 'all' ? ' active' : '');
  allBtn.dataset.status = 'all';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => { activeStatus = 'all'; updateStatusToolbar(); render(); });
  toolbar.appendChild(allBtn);

  Object.entries(statuses).forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.className = 'status-filter-btn' + (currentStatus === val ? ' active' : '');
    btn.dataset.status = val;
    btn.textContent = label;
    btn.addEventListener('click', () => { activeStatus = val; updateStatusToolbar(); render(); });
    toolbar.appendChild(btn);
  });
}

function render() {
  const query = document.getElementById('search').value.toLowerCase();
  const grid = document.getElementById('grid');

  let filtered = allCompanies.filter(c => {
    const matchesSearch = !query ||
      c.company.toLowerCase().includes(query) ||
      (c.notes || '').toLowerCase().includes(query) ||
      (c.category || '').toLowerCase().includes(query) ||
      (c.jobTitle || '').toLowerCase().includes(query) ||
      (c.oneLiner || '').toLowerCase().includes(query) ||
      (c.tags || []).some(t => t.toLowerCase().includes(query));
    const matchesType = activeType === 'all' || (c.type || 'company') === activeType;
    const matchesRating = activeRating === 'all' || (c.rating || 0) >= parseInt(activeRating);
    const matchesStatus = activeStatus === 'all' || (c.status || 'saved') === activeStatus;
    const matchesTag = activeTag === null || (c.tags || []).includes(activeTag);
    return matchesSearch && matchesType && matchesRating && matchesStatus && matchesTag;
  });

  // Update stats
  document.getElementById('company-count').textContent = allCompanies.filter(c => (c.type || 'company') === 'company').length;
  document.getElementById('job-count').textContent = allCompanies.filter(c => c.type === 'job').length;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><b>${allCompanies.length === 0 ? 'No saved companies yet' : 'No results'}</b>${allCompanies.length === 0 ? 'Open CompanyIntel on any company page and hit Save.' : 'Try a different search or filter.'}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(c => {
    const stars = [1,2,3,4,5].map(i =>
      `<span class="star ${(c.rating||0) >= i ? 'filled' : ''}" data-id="${c.id}" data-val="${i}">★</span>`
    ).join('');

    const statBits = [
      c.employees ? `👥 ${c.employees}` : null,
      c.funding ? `💰 ${c.funding}` : null,
      c.founded ? `📅 ${c.founded}` : null
    ].filter(Boolean);

    const isJob = (c.type || 'company') === 'job';
    const status = c.status || 'needs_review';
    const arrClass = c.workArrangement === 'Remote' ? 'remote' : c.workArrangement === 'Hybrid' ? 'hybrid' : c.workArrangement === 'On-site' ? 'onsite' : '';
    const statusMap = isJob ? JOB_STATUSES : COMPANY_STATUSES;
    const statusOptions = Object.entries(statusMap).map(([val, label]) =>
      `<option value="${val}" ${status === val ? 'selected' : ''}>${label}</option>`
    ).join('');
    const faviconDomain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    const faviconHtml = faviconDomain
      ? `<img class="card-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">`
      : '';
    return `
      <div class="card" id="card-${c.id}">
        <div class="card-header">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
              ${faviconHtml}
              <span class="card-type ${isJob ? 'job' : 'company'}">${isJob ? 'Job Posting' : 'Company'}</span>
              <div class="card-company">${c.company}</div>
            </div>
            ${isJob && c.jobTitle ? `<div class="card-job" style="font-size:13px;color:#cbd5e1;font-weight:500;margin-bottom:2px">${c.jobTitle}</div>` : ''}
            ${isJob && (c.salary || c.workArrangement) ? `<div class="card-job-chips">
              ${c.salary ? `<span class="job-chip salary">💰 ${c.salary}</span>` : ''}
              ${c.workArrangement ? `<span class="job-chip ${arrClass}">${c.workArrangement === 'Remote' ? '🌐' : c.workArrangement === 'Hybrid' ? '🏠' : '🏢'} ${c.workArrangement}${c.location ? ' · ' + c.location : ''}</span>` : ''}
            </div>` : ''}
            ${isJob && c.jobMatchScore ? `<div class="card-job-match">Role match: <b>${c.jobMatchScore}/10</b>${c.jobMatchVerdict ? ` — ${c.jobMatchVerdict}` : ''}</div>` : ''}
          </div>
          <button class="card-delete" data-id="${c.id}" title="Remove">✕</button>
        </div>
        <select class="status-select" data-id="${c.id}" data-status="${status}">${statusOptions}</select>
        ${c.category ? `<span class="card-category">${c.category}</span>` : ''}
        ${c.oneLiner ? `<div class="card-oneliner">${c.oneLiner}</div>` : ''}
        ${statBits.length > 0 ? `<div class="card-stats">${statBits.map(s => `<span class="card-stat">${s}</span>`).join('')}</div>` : ''}
        <div class="card-tags" id="tags-${c.id}">
          ${(c.tags || []).map(tag => {
            const cl = tagColor(tag);
            return `<span class="card-tag" style="border-color:${cl.border};color:${cl.color};background:${cl.bg}" data-tag="${tag}" data-id="${c.id}">${tag}<span class="tag-remove" data-tag="${tag}" data-id="${c.id}">✕</span></span>`;
          }).join('')}
          <div class="tag-inline-wrap" id="tag-add-wrap-${c.id}">
            <button class="tag-add-btn" data-id="${c.id}">+ tag</button>
          </div>
        </div>
        <div class="card-stars">${stars}</div>
        <textarea class="card-notes" data-id="${c.id}" placeholder="Add notes...">${c.notes || ''}</textarea>
        <div class="card-footer">
          <span class="card-date">${new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <div class="card-links">
            ${c.url ? `<a class="card-link" href="${c.url}" target="_blank">↗ ${isJob ? 'View posting' : 'View saved page'}</a>` : ''}
            ${c.companyWebsite ? `<a class="card-link" href="${c.companyWebsite}" target="_blank">Website</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  // Tag remove
  grid.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const tag = el.dataset.tag;
      const entry = allCompanies.find(c => c.id === id);
      if (!entry) return;
      updateCompany(id, { tags: (entry.tags || []).filter(t => t !== tag) });
      updateTagsToolbar();
    });
  });

  // Tag add button — show inline input
  grid.querySelectorAll('.tag-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const wrap = document.getElementById(`tag-add-wrap-${id}`);
      wrap.innerHTML = `<input class="tag-inline-input" id="tag-input-${id}" placeholder="tag name" autocomplete="off"><div class="tag-suggestions-inline" id="tag-sugg-${id}" style="display:none"></div>`;
      const input = document.getElementById(`tag-input-${id}`);
      const sugg = document.getElementById(`tag-sugg-${id}`);
      input.focus();

      input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        const entry = allCompanies.find(c => c.id === id);
        const existing = entry?.tags || [];
        if (!val) { sugg.style.display = 'none'; return; }
        const matches = allKnownTags.filter(t => t.toLowerCase().includes(val) && !existing.includes(t));
        if (matches.length === 0) { sugg.style.display = 'none'; return; }
        sugg.innerHTML = matches.slice(0, 5).map(t => `<div class="tag-suggestion-inline" data-tag="${t}">${t}</div>`).join('');
        sugg.style.display = 'block';
        sugg.querySelectorAll('.tag-suggestion-inline').forEach(s => {
          s.addEventListener('mousedown', (e) => { e.preventDefault(); commitTag(id, s.dataset.tag); });
        });
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const val = input.value.trim(); if (val) commitTag(id, val); }
        if (e.key === 'Escape') { render(); }
      });
      input.addEventListener('blur', () => setTimeout(() => { if (document.getElementById(`tag-input-${id}`)) render(); }, 200));
    });
  });

  // Star click
  grid.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const id = star.dataset.id;
      const val = parseInt(star.dataset.val);
      updateCompany(id, { rating: val });
    });
  });

  // Notes save on blur
  grid.querySelectorAll('.card-notes').forEach(ta => {
    ta.addEventListener('blur', () => {
      updateCompany(ta.dataset.id, { notes: ta.value });
    });
  });

  // Status change — update color immediately, then persist
  grid.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      sel.dataset.status = sel.value;
      updateCompany(sel.dataset.id, { status: sel.value });
    });
  });

  // Delete
  grid.querySelectorAll('.card-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Remove ${btn.dataset.id ? allCompanies.find(c=>c.id===btn.dataset.id)?.company : 'this company'}?`)) {
        deleteCompany(btn.dataset.id);
      }
    });
  });
}

function commitTag(id, tag) {
  const clean = tag.trim();
  if (!clean) return;
  const entry = allCompanies.find(c => c.id === id);
  if (!entry) return;
  const existing = entry.tags || [];
  if (existing.includes(clean)) { render(); return; }
  const newTags = [...existing, clean];
  // Add to global tag list if new
  if (!allKnownTags.includes(clean)) {
    allKnownTags = [...allKnownTags, clean];
    chrome.storage.local.set({ allTags: allKnownTags });
  }
  updateCompany(id, { tags: newTags });
  updateTagsToolbar();
}

function updateCompany(id, changes) {
  allCompanies = allCompanies.map(c => c.id === id ? { ...c, ...changes } : c);
  chrome.storage.local.set({ savedCompanies: allCompanies }, render);
}

function deleteCompany(id) {
  allCompanies = allCompanies.filter(c => c.id !== id);
  chrome.storage.local.set({ savedCompanies: allCompanies }, render);
}

// Keep saved view in sync when data changes from the sidepanel
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.savedCompanies || changes.allTags)) {
    load();
  }
});

// Search
document.getElementById('search').addEventListener('input', render);

// Type filters
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeType = btn.dataset.type;
    activeStatus = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    updateStatusToolbar();
    render();
  });
});

// Star filters
document.querySelectorAll('.star-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeRating = btn.dataset.rating;
    document.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});


load();
