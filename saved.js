let allCompanies = [];
let allKnownTags = [];
let activeType = 'all';
let activeRatings = new Set(); // empty = any
let activeStatus = 'all';
let activeTag = null;
let viewMode = localStorage.getItem('ci_viewMode') || 'grid';

const DEFAULT_OPPORTUNITY_STAGES = [
  { key: 'needs_review',    label: 'Saved — Needs Review',      color: '#64748b' },
  { key: 'want_to_apply',   label: 'I Want to Apply',           color: '#22d3ee' },
  { key: 'applied',         label: 'Applied',                   color: '#60a5fa' },
  { key: 'intro_requested', label: 'Intro Requested',           color: '#a78bfa' },
  { key: 'conversations',   label: 'Conversations in Progress', color: '#fb923c' },
  { key: 'offer_stage',     label: 'Offer Stage',               color: '#a3e635' },
  { key: 'accepted',        label: 'Accepted',                  color: '#4ade80' },
  { key: 'rejected',        label: "Rejected / DQ'd",           color: '#f87171' },
];
const DEFAULT_COMPANY_STAGES = [
  { key: 'co_watchlist',   label: 'Watch List',      color: '#64748b' },
  { key: 'co_researching', label: 'Researching',     color: '#22d3ee' },
  { key: 'co_networking',  label: 'Networking',      color: '#a78bfa' },
  { key: 'co_interested',  label: 'Strong Interest', color: '#fb923c' },
  { key: 'co_applied',     label: 'Applied There',   color: '#60a5fa' },
  { key: 'co_archived',    label: 'Archived',        color: '#374151' },
];
let customOpportunityStages = [...DEFAULT_OPPORTUNITY_STAGES];
let customCompanyStages = [...DEFAULT_COMPANY_STAGES];
let activePipeline = localStorage.getItem('ci_activePipeline') || 'all'; // 'all' | 'opportunity' | 'company'

function currentStages() {
  return activePipeline === 'company' ? customCompanyStages : customOpportunityStages;
}
function stageMap() { return Object.fromEntries(currentStages().map(s => [s.key, s.label])); }
function stageColor(key) {
  const all = [...customOpportunityStages, ...customCompanyStages];
  return (all.find(s => s.key === key) || currentStages()[0]).color;
}
function stageStyle(key) {
  const c = stageColor(key);
  const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  return { border: c, color: c, bg: `rgba(${r},${g},${b},0.1)` };
}
function updateStageDynamicCSS() {
  let el = document.getElementById('dynamic-stage-css');
  if (!el) { el = document.createElement('style'); el.id = 'dynamic-stage-css'; document.head.appendChild(el); }
  const defaultKeys = new Set([...DEFAULT_OPPORTUNITY_STAGES, ...DEFAULT_COMPANY_STAGES].map(s => s.key));
  const allCustom = [...customOpportunityStages, ...customCompanyStages].filter(s => !defaultKeys.has(s.key));
  el.textContent = allCustom.map(s => {
    const r = parseInt(s.color.slice(1,3),16), g = parseInt(s.color.slice(3,5),16), b = parseInt(s.color.slice(5,7),16);
    return `.status-select[data-status="${s.key}"] { background-color: rgba(${r},${g},${b},0.12); border: 1.5px solid ${s.color}; color: ${s.color}; }`;
  }).join('\n');
}

function scoreToVerdict(score) {
  if (score >= 8) return { label: 'Strong Match', cls: 'high' };
  if (score >= 6) return { label: 'Good Match', cls: 'mid' };
  if (score >= 4) return { label: 'Mixed Signals', cls: 'mixed' };
  return { label: 'Likely Not a Fit', cls: 'low' };
}

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
  chrome.storage.local.get(['savedCompanies', 'allTags', 'opportunityStages', 'companyStages', 'customStages'], (data) => {
    const { savedCompanies, allTags } = data;
    // Migration: old customStages → opportunityStages
    const storedOpp = data.opportunityStages || data.customStages;
    if (storedOpp && storedOpp.length > 0) customOpportunityStages = storedOpp;
    if (data.companyStages && data.companyStages.length > 0) customCompanyStages = data.companyStages;
    updateStageDynamicCSS();
    allCompanies = (savedCompanies || []).sort((a, b) => b.savedAt - a.savedAt);
    allKnownTags = allTags || [];
    // Sync any tags from saved entries that aren't in allTags yet
    const tagsFromEntries = [...new Set(allCompanies.flatMap(c => c.tags || []))];
    const merged = [...new Set([...allKnownTags, ...tagsFromEntries])];
    if (merged.length !== allKnownTags.length) {
      allKnownTags = merged;
      chrome.storage.local.set({ allTags: allKnownTags });
    }
    updatePipelineUI();
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
    btn.style.cssText = `border-color:${c.border};color:${activeTag === tag ? '#fff' : c.color};background:${activeTag === tag ? c.bg : 'transparent'};display:inline-flex;align-items:center;gap:5px;`;

    const label = document.createElement('span');
    label.textContent = tag;
    label.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      updateTagsToolbar();
      render();
    });

    const del = document.createElement('span');
    del.textContent = '✕';
    del.title = `Remove "${tag}" from all entries`;
    del.style.cssText = 'font-size:10px;opacity:0.6;cursor:pointer;font-weight:700;';
    del.addEventListener('mouseenter', () => { del.style.opacity = '1'; del.style.color = '#e5483b'; });
    del.addEventListener('mouseleave', () => { del.style.opacity = '0.6'; del.style.color = ''; });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Remove tag "${tag}" from all entries?`)) return;
      allCompanies = allCompanies.map(c => ({ ...c, tags: (c.tags || []).filter(t => t !== tag) }));
      allKnownTags = allKnownTags.filter(t => t !== tag);
      chrome.storage.local.set({ savedCompanies: allCompanies, allTags: allKnownTags });
      if (activeTag === tag) activeTag = null;
      updateTagsToolbar();
      render();
    });

    btn.appendChild(label);
    btn.appendChild(del);
    toolbar.appendChild(btn);
  });
}

function updateStatusToolbar() {
  const toolbar = document.getElementById('status-toolbar');
  if (activePipeline === 'all') { toolbar.style.display = 'none'; return; }
  const statuses = stageMap();

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
  const kanbanBoard = document.getElementById('kanban-board');
  const statusToolbar = document.getElementById('status-toolbar');

  let filtered = allCompanies.filter(c => {
    const matchesSearch = !query ||
      c.company.toLowerCase().includes(query) ||
      (c.notes || '').toLowerCase().includes(query) ||
      (c.category || '').toLowerCase().includes(query) ||
      (c.jobTitle || '').toLowerCase().includes(query) ||
      (c.oneLiner || '').toLowerCase().includes(query) ||
      (c.tags || []).some(t => t.toLowerCase().includes(query));
    const matchesType = activePipeline === 'opportunity' ? !!c.isOpportunity
      : activePipeline === 'company' ? true
      : true;
    const matchesRating = activeRatings.size === 0 || activeRatings.has(c.rating || 0);
    const matchesStatus = activeStatus === 'all' || (c.status || 'needs_review') === activeStatus;
    const matchesTag = activeTag === null || (c.tags || []).includes(activeTag);
    return matchesSearch && matchesType && matchesRating && matchesStatus && matchesTag;
  });

  // Update stats
  document.getElementById('company-count').textContent = allCompanies.length;
  document.getElementById('job-count').textContent = allCompanies.filter(c => !!c.isOpportunity).length;

  if (viewMode === 'kanban' && activePipeline !== 'all') {
    grid.style.display = 'none';
    kanbanBoard.style.display = 'flex';
    if (statusToolbar) statusToolbar.style.display = 'none';
    renderKanban(filtered);
    return;
  }

  kanbanBoard.style.display = 'none';
  grid.style.display = '';
  if (statusToolbar) statusToolbar.style.display = '';

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

    const isJob = !!c.isOpportunity;
    const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
    const status = activePipeline === 'opportunity' ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');
    const arrClass = c.workArrangement === 'Remote' ? 'remote' : c.workArrangement === 'Hybrid' ? 'hybrid' : c.workArrangement === 'On-site' ? 'onsite' : '';
    const statusOptions = Object.entries(stageMap()).map(([val, label]) =>
      `<option value="${val}" ${status === val ? 'selected' : ''}>${label}</option>`
    ).join('');
    const faviconDomain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    const faviconHtml = faviconDomain
      ? `<img class="card-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">`
      : '';
    const statusColor = stageColor(status);
    return `
      <div class="card" id="card-${c.id}" data-id="${c.id}" data-type="company" style="border-left: 3px solid ${statusColor}; cursor:pointer">
        <div class="card-header">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
              ${faviconHtml}
              <span class="card-type ${isJob ? 'job' : 'company'}">${isJob ? 'Opportunity' : 'Company'}</span>
              <a class="card-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank">${c.company}</a>
            </div>
            ${isJob && c.jobTitle ? `<div class="card-job" style="font-size:13px;color:#cbd5e1;font-weight:500;margin-bottom:2px">${c.jobTitle}</div>` : ''}
            ${isJob && (c.salary || c.workArrangement) ? `<div class="card-job-chips">
              ${c.salary ? `<span class="job-chip salary">💰 ${c.salary}</span>` : ''}
              ${c.workArrangement ? `<span class="job-chip ${arrClass}">${c.workArrangement === 'Remote' ? '🌐' : c.workArrangement === 'Hybrid' ? '🏠' : '🏢'} ${c.workArrangement}${c.location ? ' · ' + c.location : ''}</span>` : ''}
            </div>` : ''}
            ${isJob && c.jobMatch?.score ? (() => {
              const v = scoreToVerdict(c.jobMatch.score);
              return `<div class="card-job-overview">
                ${c.jobMatch.jobSummary ? `<div class="card-job-summary">${c.jobMatch.jobSummary}</div>` : ''}
                <div class="card-verdict-row">
                  <span class="card-verdict-badge ${v.cls}">${v.label}</span>
                  <span class="card-verdict-text">${c.jobMatch.verdict || ''}</span>
                </div>
              </div>`;
            })() : isJob && c.jobMatchScore ? `<div class="card-job-match">Role match: <b>${c.jobMatchScore}/10</b>${c.jobMatchVerdict ? ` — ${c.jobMatchVerdict}` : ''}</div>` : ''}
          </div>
          <button class="card-delete" data-id="${c.id}" title="Remove">✕</button>
        </div>
        <select class="status-select" data-id="${c.id}" data-status="${status}" data-stage-field="${stageField}">${statusOptions}</select>
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
        ${(c.intelligence || c.jobMatch) ? `
        <details class="card-analysis">
          <summary>Full Analysis</summary>
          <div class="analysis-body">
            ${c.jobMatch?.strongFits?.length ? `<div><div class="analysis-section-label">Green Flags</div><ul class="analysis-bullets">${c.jobMatch.strongFits.map(f => `<li class="fit"><span>🟢</span><span>${f}</span></li>`).join('')}</ul></div>` : ''}
            ${c.jobMatch?.redFlags?.length ? `<div><div class="analysis-section-label">Red Flags</div><ul class="analysis-bullets">${c.jobMatch.redFlags.map(f => `<li class="flag"><span>🔴</span><span>${f}</span></li>`).join('')}</ul></div>` : ''}
            ${c.intelligence?.eli5 ? `<div><div class="analysis-section-label">Simple Explanation</div><div class="analysis-section-body">${c.intelligence.eli5}</div></div>` : ''}
            ${c.intelligence?.whosBuyingIt ? `<div><div class="analysis-section-label">Who Buys It</div><div class="analysis-section-body">${c.intelligence.whosBuyingIt}</div></div>` : ''}
            ${c.intelligence?.howItWorks ? `<div><div class="analysis-section-label">How It Works</div><div class="analysis-section-body">${c.intelligence.howItWorks}</div></div>` : ''}
            ${c.reviews?.length ? `<div><div class="analysis-section-label">Employee Reviews</div>${c.reviews.slice(0,3).map(r => `<div class="analysis-review">"${r.snippet}"<div class="analysis-review-src">${r.source || ''}</div></div>`).join('')}</div>` : ''}
          </div>
        </details>` : ''}
        <div class="card-footer">
          <span class="card-date">${new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <div class="card-links">
            ${!isJob ? `<button class="add-opp-btn" data-id="${c.id}">+ Pipeline</button>` : ''}
            ${c.jobUrl ? `<a class="card-link" href="${c.jobUrl}" target="_blank">↗ Job</a>` : c.url ? `<a class="card-link" href="${c.url}" target="_blank">↗ Page</a>` : ''}
            ${c.companyLinkedin ? `<a class="card-link card-link-li" href="${c.companyLinkedin}" target="_blank">LinkedIn</a>` : `<a class="card-link card-link-li" href="https://www.linkedin.com/company/${encodeURIComponent(c.company.toLowerCase().replace(/\s+/g, '-'))}" target="_blank">LinkedIn</a>`}
            ${c.companyWebsite ? `<a class="card-link card-link-web" href="${c.companyWebsite}" target="_blank">Website</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  // Tag remove
  grid.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
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
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCompany(star.dataset.id, { rating: parseInt(star.dataset.val) });
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
      const field = sel.dataset.stageField || 'status';
      updateCompany(sel.dataset.id, { [field]: sel.value });
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

  // Add opportunity from company card
  grid.querySelectorAll('.add-opp-btn').forEach(btn => {
    btn.addEventListener('click', () => createOpportunityFromCompany(btn.dataset.id));
  });

  // Click company card body → open full-screen company view
  grid.querySelectorAll('.card[data-type="company"]').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, textarea, input, .card-tag, .star, .card-stars, details, summary')) return;
      window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
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

function createOpportunityFromCompany(companyId) {
  const company = allCompanies.find(c => c.id === companyId);
  if (!company) return;
  if (company.isOpportunity) {
    window.open(chrome.runtime.getURL('company.html') + '?id=' + companyId, '_blank');
    return;
  }
  updateCompany(companyId, { isOpportunity: true, jobStage: 'needs_review' });
}

// Keep saved view in sync when data changes from the sidepanel
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.savedCompanies || changes.allTags)) {
    load();
  }
});

// Kanban view
function renderKanban(filtered) {
  const board = document.getElementById('kanban-board');
  const stages = currentStages();
  const validKeys = new Set(stages.map(s => s.key));
  board.innerHTML = stages.map(({ key: statusKey, label: statusLabel }) => {
    const cards = filtered.filter(c => {
      const s = (activePipeline === 'opportunity' ? c.jobStage : c.status) || stages[0].key;
      // Entries with unknown status fall into the first column
      return validKeys.has(s) ? s === statusKey : statusKey === stages[0].key;
    });
    const s = stageStyle(statusKey);
    return `
      <div class="kanban-col">
        <div class="kanban-col-header" style="border-color:${s.border};background:${s.bg};color:${s.color}">
          <span class="kanban-col-title">${statusLabel}</span>
          <span class="kanban-col-count">${cards.length}</span>
        </div>
        <div class="kanban-cards" data-status="${statusKey}" style="border-color:${s.border};background:rgba(0,0,0,0.15)">
          ${cards.length ? cards.map(c => renderKanbanCard(c)).join('') : '<div class="kanban-empty">Empty</div>'}
        </div>
      </div>`;
  }).join('');

  bindKanbanEvents(board);
}

function renderKanbanCard(c) {
  const isJob = !!c.isOpportunity;
  const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
  const currentStage = activePipeline === 'opportunity' ? (c.jobStage || 'needs_review') : (c.status || 'co_watchlist');
  const arrClass = c.workArrangement === 'Remote' ? 'remote' : c.workArrangement === 'Hybrid' ? 'hybrid' : c.workArrangement === 'On-site' ? 'onsite' : '';
  const faviconDomain = c.companyWebsite?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const faviconHtml = faviconDomain ? `<img class="card-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">` : '';
  const stars = [1,2,3,4,5].map(i =>
    `<span class="star ${(c.rating||0) >= i ? 'filled' : ''}" data-id="${c.id}" data-val="${i}">★</span>`
  ).join('');
  const statusOptions = Object.entries(stageMap()).map(([val, label]) =>
    `<option value="${val}" ${currentStage === val ? 'selected' : ''}>${label}</option>`
  ).join('');

  const hasDetails = c.jobMatch?.jobSummary || c.jobMatch?.strongFits?.length || c.jobMatch?.redFlags?.length
    || c.intelligence?.eli5 || c.intelligence?.whosBuyingIt || c.reviews?.length;
  const detailsHtml = hasDetails ? `
    <details class="kanban-details">
      <summary class="kanban-details-toggle">Details</summary>
      <div class="kanban-details-body">
        ${c.jobMatch?.jobSummary ? `<div class="kanban-detail-summary">${c.jobMatch.jobSummary}</div>` : ''}
        ${c.jobMatch?.verdict ? `<div class="kanban-detail-verdict">${c.jobMatch.verdict}</div>` : ''}
        ${c.jobMatch?.strongFits?.length ? `<details class="card-analysis"><summary>Green Flags</summary><div class="analysis-body"><ul class="analysis-bullets">${c.jobMatch.strongFits.map(f => `<li class="fit"><span>🟢</span><span>${f}</span></li>`).join('')}</ul></div></details>` : ''}
        ${c.jobMatch?.redFlags?.length ? `<details class="card-analysis"><summary>Red Flags</summary><div class="analysis-body"><ul class="analysis-bullets">${c.jobMatch.redFlags.map(f => `<li class="flag"><span>🔴</span><span>${f}</span></li>`).join('')}</ul></div></details>` : ''}
        ${c.intelligence?.eli5 ? `<details class="card-analysis"><summary>About the Company</summary><div class="analysis-body"><div class="analysis-section-body">${c.intelligence.eli5}</div></div></details>` : ''}
        ${c.intelligence?.whosBuyingIt ? `<details class="card-analysis"><summary>Who Buys It</summary><div class="analysis-body"><div class="analysis-section-body">${c.intelligence.whosBuyingIt}</div></div></details>` : ''}
        ${c.reviews?.length ? `<details class="card-analysis"><summary>Reviews & Signal</summary><div class="analysis-body">${c.reviews.slice(0,3).map(r => `<div class="analysis-review">"${r.snippet}"<div class="analysis-review-src">${r.source || ''}</div></div>`).join('')}</div></details>` : ''}
      </div>
    </details>` : '';

  return `
    <div class="kanban-card" draggable="true" data-id="${c.id}" data-type="company" id="kcard-${c.id}" style="border-left: 3px solid ${stageColor(currentStage)};">
      <div class="kanban-card-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            ${faviconHtml}
            <span class="card-type ${isJob ? 'job' : 'company'}">${isJob ? 'Opp' : 'Co.'}</span>
            <a class="kanban-card-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank">${c.company}</a>
          </div>
          ${isJob && c.jobTitle ? `<div class="kanban-card-job">${c.jobTitle}</div>` : ''}
        </div>
        <button class="card-delete" data-id="${c.id}" title="Remove" style="flex-shrink:0">✕</button>
      </div>
      ${isJob && c.jobMatch?.score ? (() => { const v = scoreToVerdict(c.jobMatch.score); return `<div><span class="card-verdict-badge ${v.cls}">${v.label}</span></div>`; })() : ''}
      ${isJob && (c.salary || c.workArrangement) ? `<div class="card-job-chips">
        ${c.salary ? `<span class="job-chip salary">💰 ${c.salary}</span>` : ''}
        ${c.workArrangement ? `<span class="job-chip ${arrClass}">${c.workArrangement === 'Remote' ? '🌐' : c.workArrangement === 'Hybrid' ? '🏠' : '🏢'} ${c.workArrangement}</span>` : ''}
      </div>` : ''}
      ${c.oneLiner ? `<div class="kanban-card-oneliner">${c.oneLiner}</div>` : ''}
      ${detailsHtml}
      <select class="status-select" data-id="${c.id}" data-status="${currentStage}" data-stage-field="${stageField}">${statusOptions}</select>
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
      <textarea class="card-notes" data-id="${c.id}" placeholder="Notes...">${c.notes || ''}</textarea>
      <div class="card-footer" style="margin-top:0">
        <span class="card-date">${new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <div class="card-links">
          ${!isJob ? `<button class="add-opp-btn" data-id="${c.id}">+ Pipeline</button>` : ''}
          ${c.jobUrl ? `<a class="card-link" href="${c.jobUrl}" target="_blank">↗</a>` : c.url ? `<a class="card-link" href="${c.url}" target="_blank">↗</a>` : ''}
          ${c.companyLinkedin
            ? `<a class="card-link card-link-li" href="${c.companyLinkedin}" target="_blank">LinkedIn</a>`
            : `<a class="card-link card-link-li" href="https://www.linkedin.com/company/${encodeURIComponent(c.company.toLowerCase().replace(/\s+/g, '-'))}" target="_blank">LinkedIn</a>`}
          ${c.companyWebsite ? `<a class="card-link card-link-web" href="${c.companyWebsite}" target="_blank">Website</a>` : ''}
        </div>
      </div>
    </div>`;
}

function bindKanbanEvents(board) {
  let draggingId = null;
  let dragAllowed = false;

  board.querySelectorAll('.kanban-card').forEach(card => {
    // Track whether drag started from an interactive element
    card.addEventListener('mousedown', (e) => {
      dragAllowed = !e.target.closest('textarea, input, select, a, button, summary, details');
    });
    card.addEventListener('dragstart', (e) => {
      if (!dragAllowed) { e.preventDefault(); return; }
      draggingId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggingId = null;
      dragAllowed = false;
      board.querySelectorAll('.kanban-cards').forEach(col => col.classList.remove('drag-over'));
    });
  });

  board.querySelectorAll('.kanban-cards').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!draggingId) return;
      const newStatus = col.dataset.status;
      const entry = allCompanies.find(c => c.id === draggingId);
      if (!entry) return;
      const stageField = activePipeline === 'opportunity' ? 'jobStage' : 'status';
      const curStage = activePipeline === 'opportunity' ? entry.jobStage : entry.status;
      if (curStage !== newStatus) updateCompany(draggingId, { [stageField]: newStatus });
    });
  });

  board.querySelectorAll('.card-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Remove ${allCompanies.find(c => c.id === btn.dataset.id)?.company || 'this entry'}?`)) {
        deleteCompany(btn.dataset.id);
      }
    });
  });

  board.querySelectorAll('.card-notes').forEach(ta => {
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => updateCompany(ta.dataset.id, { notes: ta.value }));
  });

  board.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      sel.dataset.status = sel.value;
      const field = sel.dataset.stageField || 'status';
      updateCompany(sel.dataset.id, { [field]: sel.value });
    });
  });

  board.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCompany(star.dataset.id, { rating: parseInt(star.dataset.val) });
    });
  });

  board.querySelectorAll('.add-opp-btn').forEach(btn => {
    btn.addEventListener('click', () => createOpportunityFromCompany(btn.dataset.id));
  });

  // Click card body → open full-screen view
  board.querySelectorAll('.kanban-card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, textarea, input, .card-tag, .star, .card-stars, details, summary')) return;
      window.open(chrome.runtime.getURL('company.html') + '?id=' + cardEl.dataset.id, '_blank');
    });
  });

  // Tag remove
  board.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = allCompanies.find(c => c.id === el.dataset.id);
      if (!entry) return;
      updateCompany(el.dataset.id, { tags: (entry.tags || []).filter(t => t !== el.dataset.tag) });
      updateTagsToolbar();
    });
  });

  // Tag add button
  board.querySelectorAll('.tag-add-btn').forEach(btn => {
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
}

// View toggle
document.getElementById('view-grid-btn').addEventListener('click', () => {
  viewMode = 'grid';
  localStorage.setItem('ci_viewMode', 'grid');
  document.getElementById('view-grid-btn').classList.add('active');
  document.getElementById('view-kanban-btn').classList.remove('active');
  render();
});
document.getElementById('view-kanban-btn').addEventListener('click', () => {
  viewMode = 'kanban';
  localStorage.setItem('ci_viewMode', 'kanban');
  document.getElementById('view-kanban-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
  render();
});
// Restore toggle state on load
if (viewMode === 'kanban') {
  document.getElementById('view-kanban-btn').classList.add('active');
  document.getElementById('view-grid-btn').classList.remove('active');
}
// Restore pipeline state on load (updatePipelineUI is defined later, call after DOM ready)
document.addEventListener('DOMContentLoaded', () => {}, { once: true });
// Pipeline UI is initialized via updatePipelineUI() called from load()

// Stage editor
const STAGE_COLOR_PALETTE = ['#64748b','#22d3ee','#60a5fa','#a78bfa','#fb923c','#a3e635','#4ade80','#f87171','#f59e0b','#e879f9','#34d399','#f472b6'];
let stageEditorOpen = false;
let editingStages = [];

function openStageEditor() {
  if (activePipeline === 'all') return; // must be in a specific pipeline to edit
  editingStages = currentStages().map(s => ({ ...s }));
  const pipelineName = activePipeline === 'company' ? 'Company Pipeline' : 'Opportunity Pipeline';
  document.getElementById('stage-editor-title').textContent = `Edit ${pipelineName} Stages`;
  document.getElementById('stage-editor-subtitle').textContent = `Rename, recolor, reorder, or add stages for the ${pipelineName}`;
  renderStageEditor();
  document.getElementById('stage-editor-modal').style.display = 'flex';
  stageEditorOpen = true;
}
function closeStageEditor() {
  document.getElementById('stage-editor-modal').style.display = 'none';
  stageEditorOpen = false;
}
function saveStages() {
  const saved = editingStages.filter(s => s.label.trim());
  if (activePipeline === 'company') {
    customCompanyStages = saved;
    chrome.storage.local.set({ companyStages: saved }, () => {
      updateStageDynamicCSS(); updateStatusToolbar(); render(); closeStageEditor();
    });
  } else {
    customOpportunityStages = saved;
    chrome.storage.local.set({ opportunityStages: saved }, () => {
      updateStageDynamicCSS(); updateStatusToolbar(); render(); closeStageEditor();
    });
  }
}
function renderStageEditor() {
  const list = document.getElementById('stage-editor-list');
  list.innerHTML = editingStages.map((s, i) => `
    <div class="stage-row" data-i="${i}">
      <span class="stage-drag-handle">⠿</span>
      <button class="stage-color-swatch" data-i="${i}" style="background:${s.color};border-color:${s.color}" title="Click to change color"></button>
      <input class="stage-label-input" data-i="${i}" value="${s.label}" placeholder="Stage name">
      <div style="display:flex;gap:4px">
        <button class="stage-move-btn" data-i="${i}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="stage-move-btn" data-i="${i}" data-dir="1" title="Move down" ${i === editingStages.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <button class="stage-delete-btn" data-i="${i}" title="Delete stage">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.stage-label-input').forEach(inp => {
    inp.addEventListener('input', () => { editingStages[inp.dataset.i].label = inp.value; });
  });
  list.querySelectorAll('.stage-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      const curr = STAGE_COLOR_PALETTE.indexOf(editingStages[i].color);
      editingStages[i].color = STAGE_COLOR_PALETTE[(curr + 1) % STAGE_COLOR_PALETTE.length];
      renderStageEditor();
    });
  });
  list.querySelectorAll('.stage-move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i), dir = parseInt(btn.dataset.dir);
      const j = i + dir;
      if (j < 0 || j >= editingStages.length) return;
      [editingStages[i], editingStages[j]] = [editingStages[j], editingStages[i]];
      renderStageEditor();
    });
  });
  list.querySelectorAll('.stage-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      if (editingStages.length <= 1) return;
      editingStages.splice(i, 1);
      renderStageEditor();
    });
  });
}
document.getElementById('stage-editor-add').addEventListener('click', () => {
  editingStages.push({ key: 'stage_' + Date.now(), label: 'New Stage', color: STAGE_COLOR_PALETTE[editingStages.length % STAGE_COLOR_PALETTE.length] });
  renderStageEditor();
});
document.getElementById('stage-editor-save').addEventListener('click', saveStages);
document.getElementById('stage-editor-close').addEventListener('click', closeStageEditor);
document.getElementById('stage-editor-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('stage-editor-modal')) closeStageEditor();
});
document.getElementById('edit-stages-btn').addEventListener('click', openStageEditor);

// Search
document.getElementById('search').addEventListener('input', render);

// Pipeline buttons
function updatePipelineUI() {
  document.getElementById('pipeline-all-btn').classList.toggle('active', activePipeline === 'all');
  document.getElementById('pipeline-opp-btn').classList.toggle('active', activePipeline === 'opportunity');
  document.getElementById('pipeline-co-btn').classList.toggle('active',  activePipeline === 'company');

  const isAll = activePipeline === 'all';

  // Kanban is only meaningful inside a specific pipeline
  const kanbanBtn = document.getElementById('view-kanban-btn');
  if (kanbanBtn) {
    kanbanBtn.disabled = isAll;
    kanbanBtn.style.opacity = isAll ? '0.3' : '1';
    kanbanBtn.title = isAll ? 'Select a pipeline to use Kanban view' : '';
  }

  // Edit Stages only applies to a specific pipeline
  const editBtn = document.getElementById('edit-stages-btn');
  if (editBtn) {
    editBtn.style.opacity = isAll ? '0.35' : '1';
    editBtn.title = isAll ? 'Select a pipeline to edit its stages' : 'Edit pipeline stages';
  }

  const header = document.getElementById('pipeline-header');
  const headerText = document.getElementById('pipeline-header-text');
  if (header && headerText) {
    if (activePipeline === 'opportunity') {
      headerText.textContent = 'Opportunity Pipeline';
      header.style.display = '';
    } else if (activePipeline === 'company') {
      headerText.textContent = 'Saved Company Pipeline';
      header.style.display = '';
    } else {
      header.style.display = 'none';
    }
  }
}

[
  ['pipeline-all-btn', 'all'],
  ['pipeline-opp-btn', 'opportunity'],
  ['pipeline-co-btn',  'company'],
].forEach(([id, pipeline]) => {
  document.getElementById(id).addEventListener('click', () => {
    activePipeline = pipeline;
    localStorage.setItem('ci_activePipeline', activePipeline);
    activeStatus = 'all';
    // Kanban doesn't apply to "All Saved" — drop back to grid
    if (pipeline === 'all' && viewMode === 'kanban') {
      viewMode = 'grid';
      localStorage.setItem('ci_viewMode', 'grid');
      document.getElementById('view-grid-btn').classList.add('active');
      document.getElementById('view-kanban-btn').classList.remove('active');
    }
    updatePipelineUI();
    updateStatusToolbar();
    render();
  });
});

// Rating dropdown
(function() {
  const dropBtn  = document.getElementById('rating-dropdown-btn');
  const dropMenu = document.getElementById('rating-dropdown-menu');
  const dropLabel = document.getElementById('rating-dropdown-label');
  const clearBtn = document.getElementById('rating-clear-btn');

  function updateRatingLabel() {
    if (activeRatings.size === 0) {
      dropLabel.textContent = 'Any Rating';
      dropBtn.classList.remove('active');
    } else {
      const stars = ['★','★★','★★★','★★★★','★★★★★'];
      const parts = [5,4,3,2,1,0]
        .filter(v => activeRatings.has(v))
        .map(v => v === 0 ? 'Unrated' : stars[v-1]);
      dropLabel.textContent = parts.join(', ');
      dropBtn.classList.add('active');
    }
  }

  dropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropMenu.classList.toggle('open');
    dropBtn.classList.toggle('open', open);
  });

  dropMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const val = parseInt(cb.value);
      if (cb.checked) activeRatings.add(val);
      else activeRatings.delete(val);
      updateRatingLabel();
      render();
    });
  });

  clearBtn.addEventListener('click', () => {
    activeRatings.clear();
    dropMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateRatingLabel();
    render();
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('rating-dropdown').contains(e.target)) {
      dropMenu.classList.remove('open');
      dropBtn.classList.remove('open');
    }
  });

});


load();
