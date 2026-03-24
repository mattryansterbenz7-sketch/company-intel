const params = new URLSearchParams(window.location.search);
const entryId = params.get('id');
let entry = null;
let allTags = [];
let stages = [];

const DEFAULT_STAGES = [
  { key: 'needs_review',    label: 'Saved — Needs Review',      color: '#64748b' },
  { key: 'want_to_apply',   label: 'I Want to Apply',           color: '#22d3ee' },
  { key: 'applied',         label: 'Applied',                   color: '#60a5fa' },
  { key: 'intro_requested', label: 'Intro Requested',           color: '#a78bfa' },
  { key: 'conversations',   label: 'Conversations in Progress', color: '#fb923c' },
  { key: 'offer_stage',     label: 'Offer Stage',               color: '#a3e635' },
  { key: 'accepted',        label: 'Accepted',                  color: '#4ade80' },
  { key: 'rejected',        label: "Rejected / DQ'd",           color: '#f87171' },
];

const PANEL_DEFS = [
  { id: 'overview',      title: 'Opportunity Overview', full: false },
  { id: 'job_match',     title: 'Job Match Analysis',   full: true  },
  { id: 'company_intel', title: 'Company Intel',        full: false },
  { id: 'reviews',       title: 'Employee Reviews',     full: false },
  { id: 'activity',      title: 'Activity',             full: true  },
  { id: 'chat',          title: 'Ask AI',               full: true  },
];

let panelOrder      = JSON.parse(localStorage.getItem('ci_panel_order')     || 'null') || PANEL_DEFS.map(p => p.id);
let collapsedPanels = JSON.parse(localStorage.getItem('ci_panel_collapsed') || '{}');

// ── Utilities ─────────────────────────────────────────────────────────────────

function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  const palette = [
    { border: '#818cf8', color: '#a5b4fc', bg: 'rgba(99,102,241,0.12)'  },
    { border: '#34d399', color: '#6ee7b7', bg: 'rgba(52,211,153,0.12)'  },
    { border: '#fb923c', color: '#fdba74', bg: 'rgba(251,146,60,0.12)'  },
    { border: '#f472b6', color: '#f9a8d4', bg: 'rgba(244,114,182,0.12)' },
    { border: '#38bdf8', color: '#7dd3fc', bg: 'rgba(56,189,248,0.12)'  },
    { border: '#c084fc', color: '#d8b4fe', bg: 'rgba(192,132,252,0.12)' },
    { border: '#4ade80', color: '#86efac', bg: 'rgba(74,222,128,0.12)'  },
    { border: '#f59e0b', color: '#fcd34d', bg: 'rgba(245,158,11,0.12)'  },
  ];
  return palette[Math.abs(hash) % palette.length];
}

function scoreToVerdict(score) {
  if (score >= 8) return { label: 'Strong Match',      cls: 'high'  };
  if (score >= 6) return { label: 'Good Match',        cls: 'mid'   };
  if (score >= 4) return { label: 'Mixed Signals',     cls: 'mixed' };
  return              { label: 'Likely Not a Fit',  cls: 'low'   };
}

function stageColor(key) {
  return (stages.find(s => s.key === key) || stages[0] || DEFAULT_STAGES[0]).color;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function saveEntry(changes) {
  Object.assign(entry, changes);
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const arr = savedCompanies || [];
    const idx = arr.findIndex(c => c.id === entryId);
    if (idx !== -1) {
      arr[idx] = { ...arr[idx], ...changes };
      chrome.storage.local.set({ savedCompanies: arr });
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  chrome.storage.local.get(['savedCompanies', 'allTags', 'opportunityStages', 'customStages'], (data) => {
    allTags = data.allTags || [];
    const storedStages = data.opportunityStages || data.customStages;
    stages  = (storedStages && storedStages.length) ? storedStages : DEFAULT_STAGES;
    const allCompanies = data.savedCompanies || [];
    entry = allCompanies.find(c => c.id === entryId);

    // Pull website/LinkedIn from linked company entry if missing on this opportunity
    if (entry && (!entry.companyWebsite || !entry.companyLinkedin)) {
      const linkedCompany = entry.linkedCompanyId
        ? allCompanies.find(c => c.id === entry.linkedCompanyId)
        : allCompanies.find(c => c.type !== 'job' && c.company === entry.company && (c.companyWebsite || c.companyLinkedin));
      if (linkedCompany) {
        const updates = {};
        if (!entry.companyWebsite  && linkedCompany.companyWebsite)  updates.companyWebsite  = linkedCompany.companyWebsite;
        if (!entry.companyLinkedin && linkedCompany.companyLinkedin) updates.companyLinkedin = linkedCompany.companyLinkedin;
        if (Object.keys(updates).length) saveEntry(updates);
      }
    }

    if (!entry) {
      const savedUrl = chrome.runtime.getURL('saved.html');
      document.getElementById('opp-header').innerHTML =
        `<a class="hdr-back" href="${savedUrl}">← Back</a>
         <span style="color:#7da8c4;font-size:14px;margin-left:14px">Entry not found — it may have been deleted.</span>`;
      document.getElementById('opp-body').style.display = 'none';
      return;
    }

    // Ensure any newly added default panels are in the saved order
    const knownIds = new Set(panelOrder);
    PANEL_DEFS.forEach(p => { if (!knownIds.has(p.id)) panelOrder.push(p.id); });

    renderHeader();
    renderSidebar();
    renderRightSidebar();
    renderPanels();
    if (typeof initChatPanels === 'function') initChatPanels(entry);
    bindActivityPanel();
    bindPanelDrag();
  });
}

// ── Header ────────────────────────────────────────────────────────────────────

function renderHeader() {
  const faviconDomain = entry.companyWebsite
    ? entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    : null;
  const faviconHtml = faviconDomain
    ? `<img class="hdr-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">`
    : '';

  const statusOptions = stages.map(s =>
    `<option value="${s.key}" ${(entry.status || 'needs_review') === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const stars = [1,2,3,4,5].map(i =>
    `<button class="hdr-star ${(entry.rating || 0) >= i ? 'filled' : ''}" data-val="${i}">★</button>`
  ).join('');

  const savedUrl = chrome.runtime.getURL('saved.html');
  const color    = stageColor(entry.status || 'needs_review');
  const titleVal = (entry.jobTitle || 'New Opportunity').replace(/"/g, '&quot;');

  document.getElementById('opp-header').innerHTML = `
    <a class="hdr-back" href="${savedUrl}">← Back</a>
    <div class="hdr-divider"></div>
    ${faviconHtml}
    <span class="hdr-company">${entry.company}</span>
    <span class="hdr-sep">/</span>
    <input class="hdr-title" id="hdr-title" value="${titleVal}" placeholder="Job title…">
    <div class="hdr-spacer"></div>
    <select class="hdr-status" id="hdr-status"
      style="border-color:${color};color:${color}">
      ${statusOptions}
    </select>
    <div class="hdr-stars" id="hdr-stars">${stars}</div>
    ${entry.url ? `<a class="hdr-ext-link" href="${entry.url}" target="_blank">↗ Job Posting</a>` : ''}
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('preferences.html')}" target="_blank">⚙ Preferences</a>
  `;

  document.title = `${entry.company}${entry.jobTitle ? ' · ' + entry.jobTitle : ''} — CompanyIntel`;

  document.getElementById('hdr-title').addEventListener('blur', e => {
    const val = e.target.value.trim();
    saveEntry({ jobTitle: val });
    document.title = `${entry.company}${val ? ' · ' + val : ''} — CompanyIntel`;
  });

  document.getElementById('hdr-status').addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value);
    sel.style.borderColor = c;
    sel.style.color = c;
    saveEntry({ status: sel.value });
  });

  document.getElementById('hdr-stars').querySelectorAll('.hdr-star').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val);
      saveEntry({ rating: val });
      document.getElementById('hdr-stars').querySelectorAll('.hdr-star').forEach((b, i) => {
        b.classList.toggle('filled', i < val);
      });
    });
  });
}

// ── Left Sidebar ──────────────────────────────────────────────────────────────

function renderSidebar() {
  const e = entry;
  const arrClass = e.workArrangement === 'Remote' ? 'remote'
    : e.workArrangement === 'Hybrid'  ? 'hybrid'
    : e.workArrangement === 'On-site' ? 'onsite' : '';
  const arrIcon = e.workArrangement === 'Remote' ? '🌐'
    : e.workArrangement === 'Hybrid' ? '🏠' : '🏢';

  const chips = [
    e.salary          ? `<span class="sb-chip salary">💰 ${e.salary}</span>` : '',
    e.workArrangement ? `<span class="sb-chip ${arrClass}">${arrIcon} ${e.workArrangement}${e.location ? ' · ' + e.location : ''}</span>` : '',
  ].filter(Boolean).join('');

  const stats = [
    e.employees ? ['Employees', e.employees] : null,
    e.funding   ? ['Funding',   e.funding]   : null,
    e.founded   ? ['Founded',   e.founded]   : null,
    e.industry  ? ['Industry',  e.industry]  : null,
  ].filter(Boolean);

  const linkedInUrl = e.companyLinkedin ||
    `https://www.linkedin.com/company/${encodeURIComponent(e.company.toLowerCase().replace(/\s+/g, '-'))}`;

  const tags = (e.tags || []).map(tag => {
    const c = tagColor(tag);
    return `<span class="s-tag" style="border-color:${c.border};color:${c.color};background:${c.bg}">${tag}<span class="stag-rm" data-tag="${tag}">✕</span></span>`;
  }).join('');

  document.getElementById('opp-sidebar').innerHTML = `
    ${chips ? `
    <div class="sb-section">
      <div class="sb-title">Role Details</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px">${chips}</div>
    </div>` : ''}

    ${stats.length ? `
    <div class="sb-section">
      <div class="sb-title">Company Stats</div>
      ${stats.map(([l, v]) => `
        <div class="sb-stat">
          <span class="sb-stat-label">${l}</span>
          <span class="sb-stat-value">${v}</span>
        </div>`).join('')}
    </div>` : ''}

    <div class="sb-section">
      <div class="sb-title">Links</div>
      ${e.url ? `<a class="sb-link opp" href="${e.url}" target="_blank">↗ Job Posting</a>` : ''}
      <a class="sb-link li" href="${linkedInUrl}" target="_blank">🔗 LinkedIn</a>
      ${e.companyWebsite
        ? `<a class="sb-link web" href="${e.companyWebsite}" target="_blank">🌐 ${e.companyWebsite.replace(/^https?:\/\//,'').replace(/\/$/,'')}</a>`
        : `<div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:#b0c1d4">🌐</span>
            <input id="sb-website-input" placeholder="Add website URL…" style="flex:1;font-size:12px;font-weight:600;border:none;border-bottom:1px dashed #b0c1d4;outline:none;background:transparent;color:#33475b;padding:2px 0;font-family:inherit;" autocomplete="off">
           </div>`}
    </div>

    <div class="sb-section">
      <div class="sb-title">Tags</div>
      <div class="sb-tags" id="sb-tags">
        ${tags}
        <div style="position:relative;display:inline-flex" id="stag-add-wrap">
          <button class="stag-add-btn" id="stag-add-btn">+ tag</button>
        </div>
      </div>
    </div>

    <div class="sb-section" style="flex:1">
      <div class="sb-title">Notes</div>
      <textarea class="sb-notes" id="sb-notes" placeholder="Add notes…">${e.notes || ''}</textarea>
    </div>
  `;

  document.getElementById('sb-notes').addEventListener('blur', ev => saveEntry({ notes: ev.target.value }));

  const websiteInput = document.getElementById('sb-website-input');
  if (websiteInput) {
    const commit = () => {
      const val = websiteInput.value.trim();
      if (val) { saveEntry({ companyWebsite: val }); renderSidebar(); }
    };
    websiteInput.addEventListener('blur', commit);
    websiteInput.addEventListener('keydown', e => { if (e.key === 'Enter') websiteInput.blur(); });
  }

  document.querySelectorAll('.stag-rm').forEach(btn => {
    btn.addEventListener('click', () => {
      saveEntry({ tags: (entry.tags || []).filter(t => t !== btn.dataset.tag) });
      renderSidebar();
    });
  });

  document.getElementById('stag-add-btn').addEventListener('click', () => {
    const wrap = document.getElementById('stag-add-wrap');
    wrap.innerHTML = `<input class="stag-input" id="stag-input" placeholder="tag name" autocomplete="off">`;
    const input = document.getElementById('stag-input');
    input.focus();
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  commitTag(input.value);
      if (ev.key === 'Escape') renderSidebar();
    });
    input.addEventListener('blur', () => setTimeout(() => commitTag(input.value), 150));
  });
}

function commitTag(val) {
  const clean = val.trim();
  if (clean && !(entry.tags || []).includes(clean)) {
    const newTags = [...(entry.tags || []), clean];
    if (!allTags.includes(clean)) {
      allTags = [...allTags, clean];
      chrome.storage.local.set({ allTags });
    }
    saveEntry({ tags: newTags });
  }
  renderSidebar();
}

// ── Right Sidebar (Leadership) ────────────────────────────────────────────────

function renderRightSidebar() {
  const leaders = entry.leaders || [];
  const right = document.getElementById('opp-right');

  if (!leaders.length) {
    const listings = entry.jobListings || [];
    const hiringHtml = listings.length
      ? listings.map(j => `<div class="p-hiring-item"><span style="color:#3d5468;font-size:14px">•</span><span style="font-size:13px">${j.title || 'Open Role'}${j.url ? ` <a href="${j.url}" target="_blank" class="p-hiring-link">↗</a>` : ''}${j.location ? `<span style="color:#64748b;font-size:12px"> · ${j.location}</span>` : ''}</span></div>`).join('')
      : `<div class="rs-empty">No additional open roles found.</div>`;
    right.innerHTML = `
      <div class="rs-title">Leadership</div>
      <div class="rs-empty">No leadership data found. Research this company from the side panel to populate this section.</div>
      <div class="rs-title" style="margin-top:22px">Hiring Signals</div>
      ${hiringHtml}
    `;
    return;
  }

  const cards = leaders.map(l => {
    const initials = l.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const liUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(l.name + ' ' + entry.company)}`;
    return `
      <div class="leader-card" id="lcard-${encodeURIComponent(l.name)}">
        <div class="leader-avatar" id="lavatar-${encodeURIComponent(l.name)}">${initials}</div>
        <div class="leader-info">
          <div class="leader-name">${l.name}</div>
          <div class="leader-role">${l.title || ''}</div>
          <div class="leader-links">
            <a class="leader-link li" href="${liUrl}" target="_blank">LinkedIn</a>
            ${l.newsUrl ? `<a class="leader-link news" href="${l.newsUrl}" target="_blank">News</a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  const listings = entry.jobListings || [];
  const hiringHtml = `
    <div class="rs-title" style="margin-top:22px">Hiring Signals</div>
    ${listings.length
      ? listings.map(j => `
          <div class="p-hiring-item">
            <span style="color:#3d5468;font-size:14px">•</span>
            <span style="font-size:13px">
              ${j.title || 'Open Role'}
              ${j.url ? `<a href="${j.url}" target="_blank" class="p-hiring-link">↗</a>` : ''}
              ${j.location ? `<span style="color:#64748b;font-size:12px"> · ${j.location}</span>` : ''}
            </span>
          </div>`).join('')
      : `<div class="rs-empty">No additional open roles found.</div>`}
  `;

  right.innerHTML = `
    <div class="rs-title">Leadership</div>
    ${cards}
    ${hiringHtml}
  `;

  // Async photo fetch
  if (leaders.length) {
    chrome.runtime.sendMessage(
      { type: 'GET_LEADER_PHOTOS', leaders: leaders.slice(0, 5), company: entry.company },
      (photos) => {
        void chrome.runtime.lastError;
        if (!photos) return;
        photos.forEach((url, i) => {
          if (!url || !leaders[i]) return;
          const avatarEl = document.getElementById(`lavatar-${encodeURIComponent(leaders[i].name)}`);
          if (avatarEl) avatarEl.innerHTML = `<img src="${url}" alt="${leaders[i].name}" onerror="this.parentElement.textContent='${leaders[i].name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}'">`;
        });
      }
    );
  }
}

// ── Panels ────────────────────────────────────────────────────────────────────

function renderPanels() {
  const panelsEl = document.getElementById('panels');
  const defMap   = Object.fromEntries(PANEL_DEFS.map(p => [p.id, p]));

  panelsEl.innerHTML = panelOrder.map(pid => {
    const def = defMap[pid];
    if (!def) return '';
    const collapsed = !!collapsedPanels[pid];
    const titleSubtitle = pid === 'overview' && (entry.jobTitle || entry.url)
      ? `<div style="display:flex;flex-direction:column;gap:2px">
           <span class="panel-title">${def.title}</span>
           ${entry.jobTitle && entry.url
             ? `<a class="panel-subtitle-link" href="${entry.url}" target="_blank">${entry.jobTitle} ↗</a>`
             : entry.jobTitle
               ? `<span class="panel-subtitle-link">${entry.jobTitle}</span>`
               : `<a class="panel-subtitle-link" href="${entry.url}" target="_blank">View Job Posting ↗</a>`}
         </div>`
      : `<span class="panel-title">${def.title}</span>`;
    return `
      <div class="panel${def.full ? ' panel-full' : ''}" data-panel="${pid}" draggable="true">
        <div class="panel-header">
          ${titleSubtitle}
          <div class="panel-controls">
            <span class="panel-drag-hint">⠿</span>
            <button class="panel-collapse-btn" data-panel="${pid}">${collapsed ? '▼' : '▲'}</button>
          </div>
        </div>
        <div class="panel-body${collapsed ? ' collapsed' : ''}" id="pbody-${pid}">
          ${renderPanelBody(pid)}
        </div>
      </div>`;
  }).join('');

  panelsEl.querySelectorAll('.panel-collapse-btn').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const pid = btn.dataset.panel;
      collapsedPanels[pid] = !collapsedPanels[pid];
      localStorage.setItem('ci_panel_collapsed', JSON.stringify(collapsedPanels));
      btn.textContent = collapsedPanels[pid] ? '▼' : '▲';
      document.getElementById(`pbody-${pid}`).classList.toggle('collapsed', !!collapsedPanels[pid]);
    });
  });
}

function renderPanelBody(pid) {
  const e = entry;

  switch (pid) {

    case 'overview': {
      const hasJobMatch = e.jobMatch?.jobSummary || e.jobMatch?.verdict || e.jobMatch?.score;
      const hasCompanyDesc = e.intelligence?.oneLiner || e.oneLiner || e.intelligence?.eli5;

      if (!hasJobMatch && !hasCompanyDesc) {
        return `<div class="p-empty">No summary yet. Save this job from a LinkedIn job posting to generate a personalized analysis.</div>`;
      }

      let html = '';

      // Job match score + verdict (if from a real job posting)
      if (e.jobMatch?.score) {
        const v = scoreToVerdict(e.jobMatch.score);
        html += `
          <div class="p-score-row">
            <div>
              <div class="p-score-num">${e.jobMatch.score}<span style="font-size:15px;color:#64748b;font-weight:400">/10</span></div>
              <div class="p-score-sub">Match Score</div>
            </div>
            <span class="p-verdict-badge ${v.cls}">${v.label}</span>
          </div>`;
      }
      if (e.jobMatch?.verdict) html += `<div class="p-verdict-text">${e.jobMatch.verdict}</div>`;
      if (e.jobMatch?.jobSummary) html += `<div><div class="p-label">Job Summary</div><div class="p-summary">${e.jobMatch.jobSummary}</div></div>`;

      // Company description fallback when no job posting analysis
      if (!hasJobMatch && hasCompanyDesc) {
        if (e.category || e.intelligence?.category) {
          html += `<span class="p-category-badge">${e.category || e.intelligence.category}</span>`;
        }
        const oneliner = e.intelligence?.oneLiner || e.oneLiner;
        if (oneliner) html += `<div class="p-about-oneliner">${oneliner}</div>`;
        if (e.intelligence?.eli5) html += `<div class="p-summary" style="margin-top:4px">${e.intelligence.eli5}</div>`;
      }

      return html;
    }

    case 'job_match': {
      const fits  = e.jobMatch?.strongFits || [];
      const flags = e.jobMatch?.redFlags   || [];
      if (!fits.length && !flags.length) {
        return `<div class="p-empty">No match analysis yet. Make sure your profile is set up in Settings, then save this role from the LinkedIn job posting page.</div>`;
      }
      const fitsCol  = fits.length  ? `<div><div class="p-label">Green Flags</div><ul class="p-bullets">${fits.map(f  => `<li class="fit"><span>🟢</span><span>${f}</span></li>`).join('')}</ul></div>`  : '';
      const flagsCol = flags.length ? `<div><div class="p-label">Red Flags</div><ul  class="p-bullets">${flags.map(f => `<li class="flag"><span>🔴</span><span>${f}</span></li>`).join('')}</ul></div>` : '';
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">${fitsCol}${flagsCol}</div>`;
    }

    case 'company_intel': {
      const hasStats = e.employees || e.funding || e.founded;
      const hasIntel = e.intelligence?.eli5 || e.intelligence?.whosBuyingIt || e.intelligence?.howItWorks;
      if (!hasStats && !hasIntel) {
        return `<div class="p-empty">No company intelligence yet. Research this company from the side panel to populate this section.</div>`;
      }
      let html = '';
      if (hasStats) {
        const stats = [
          e.employees ? ['Employees', e.employees] : null,
          e.funding   ? ['Funding',   e.funding]   : null,
          e.founded   ? ['Founded',   e.founded]   : null,
        ].filter(Boolean);
        html += `<div class="p-stat-grid">${stats.map(([l, v]) => `<div class="p-stat"><div class="p-stat-label">${l}</div><div class="p-stat-val">${v}</div></div>`).join('')}</div>`;
      }
      if (e.intelligence?.eli5)        html += `<div class="p-intel-block"><div class="p-intel-label">Simple Explanation</div><div class="p-intel-text">${e.intelligence.eli5}</div></div>`;
      if (e.intelligence?.whosBuyingIt) html += `<div class="p-intel-block"><div class="p-intel-label">Who Buys It</div><div class="p-intel-text">${e.intelligence.whosBuyingIt}</div></div>`;
      if (e.intelligence?.howItWorks)   html += `<div class="p-intel-block"><div class="p-intel-label">How It Works</div><div class="p-intel-text">${e.intelligence.howItWorks}</div></div>`;
      return html;
    }

    case 'reviews': {
      if (!e.reviews?.length) {
        return `<div class="p-empty">No employee reviews found. Research this company from the side panel to pull in Glassdoor / RepVue signals.</div>`;
      }
      return e.reviews.map(r => `
        <div class="p-review">
          "${r.snippet}"
          <div class="p-review-src">
            ${r.source || ''}${r.url ? ` · <a href="${r.url}" target="_blank">View source</a>` : ''}
          </div>
        </div>`).join('');
    }

    case 'hiring': {
      const listings = e.jobListings || [];
      if (!listings.length) return `<div class="p-empty">No additional open roles found for this company.</div>`;
      return listings.map(j => `
        <div class="p-hiring-item">
          <span style="color:#3d5468;font-size:16px">•</span>
          <span>
            ${j.title || 'Open Role'}
            ${j.url ? `<a href="${j.url}" target="_blank" class="p-hiring-link">↗</a>` : ''}
            ${j.location ? `<span style="color:#64748b;font-size:13px"> · ${j.location}</span>` : ''}
          </span>
        </div>`).join('');
    }

    case 'activity':
      return `
        <div class="activity-tabs">
          <button class="activity-tab active" data-tab="emails">Emails</button>
          <button class="activity-tab" data-tab="meetings">Meetings</button>
        </div>
        <div class="activity-pane active" id="act-emails-pane">
          <div class="p-empty" id="act-emails-status">Loading emails…</div>
          <div id="act-emails-list"></div>
        </div>
        <div class="activity-pane" id="act-meetings-pane">
          <div class="p-empty" id="act-meetings-status">Loading meeting notes…</div>
          <div id="act-meetings-content"></div>
        </div>`;

    case 'chat':
      return `<div data-chat-panel="${e.id}"></div>`;

    default: return '';
  }
}

// ── Activity panel ────────────────────────────────────────────────────────────

function bindActivityPanel() {
  // Tab switching
  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.activity-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.activity-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = document.getElementById('act-' + tab.dataset.tab + '-pane');
      if (pane) pane.classList.add('active');
    });
  });

  // Auto-load emails
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName: entry.company || '', linkedinSlug }, result => {
    const statusEl = document.getElementById('act-emails-status');
    const listEl = document.getElementById('act-emails-list');
    if (!statusEl || !listEl) return;
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Gmail in Setup to see emails.'; return; }
    if (!result?.emails?.length) { statusEl.textContent = 'No emails found for this company.'; return; }
    statusEl.style.display = 'none';
    listEl.innerHTML = renderEmailThreads(result.emails);
    bindThreadToggles(listEl);
  });

  // Auto-load Granola meeting notes
  chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company }, result => {
    const statusEl = document.getElementById('act-meetings-status');
    const contentEl = document.getElementById('act-meetings-content');
    if (!statusEl || !contentEl) return;
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Granola in Setup to see meeting notes.'; return; }
    if (!result?.notes) { statusEl.textContent = 'No meeting notes found for this company.'; return; }
    statusEl.style.display = 'none';
    contentEl.innerHTML = `<div class="meeting-note">${escapeHtml(result.notes)}</div>`;
  });
}

// ── Panel drag & drop ─────────────────────────────────────────────────────────

function bindPanelDrag() {
  const panelsEl = document.getElementById('panels');
  let draggingId = null;

  panelsEl.querySelectorAll('.panel').forEach(panel => {
    panel.addEventListener('mousedown', ev => {
      panel.draggable = !!ev.target.closest('.panel-header');
    });

    panel.addEventListener('dragstart', ev => {
      if (!panel.draggable) { ev.preventDefault(); return; }
      draggingId = panel.dataset.panel;
      panel.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
    });

    panel.addEventListener('dragend', () => {
      panel.classList.remove('dragging');
      panelsEl.querySelectorAll('.panel').forEach(p => p.classList.remove('drag-over'));
      draggingId = null;
    });

    panel.addEventListener('dragover', ev => {
      ev.preventDefault();
      if (draggingId && draggingId !== panel.dataset.panel) panel.classList.add('drag-over');
    });

    panel.addEventListener('dragleave', () => panel.classList.remove('drag-over'));

    panel.addEventListener('drop', ev => {
      ev.preventDefault();
      panel.classList.remove('drag-over');
      if (!draggingId || draggingId === panel.dataset.panel) return;
      const from = panelOrder.indexOf(draggingId);
      const to   = panelOrder.indexOf(panel.dataset.panel);
      if (from === -1 || to === -1) return;
      panelOrder.splice(from, 1);
      panelOrder.splice(to, 0, draggingId);
      localStorage.setItem('ci_panel_order', JSON.stringify(panelOrder));
      renderPanels();
      bindPanelDrag();
    });
  });
}

init();
