(function () {
  // Disabled — the hover-reveal sidebar in content.js replaces this widget entirely
  return;
  if (document.getElementById('ci-widget-host')) return;

  // ── Company detection (generic pages) ──────────────────────────────────
  function detectCompany() {
    const domain = location.hostname.replace('www.', '');
    const siteName = document.querySelector('meta[property="og:site_name"]');
    if (siteName?.content?.trim()) return { company: siteName.content.trim(), domain };

    const rawTitle = document.title.replace(/^\(\d+\)\s*/, '').trim();
    const segments = rawTitle.split(/\s*[|·—–]\s*/).map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      const last = segments[segments.length - 1];
      if (last.length > 1 && last.length < 50 && !/jobs|careers|hiring/i.test(last))
        return { company: last, domain };
    }
    if (segments.length > 0 && segments[0].length < 35 && !/jobs|careers|hiring/i.test(segments[0]))
      return { company: segments[0], domain };

    const raw = domain.replace(/\.(com|io|ai|co|net|org|dev|app|co\.uk).*/, '');
    const stripped = raw.replace(/^(use|get|try|go|my|join|app|the|hey|meet|say|hello)/i, '');
    const name = stripped.length > 1 ? stripped : raw;
    return { company: name.charAt(0).toUpperCase() + name.slice(1), domain };
  }

  // ── Inject host ─────────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = 'ci-widget-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;bottom:0;right:0;width:0;height:0;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ── CSS ─────────────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    #trigger {
      position: fixed;
      right: 16px;
      width: 48px;
      height: 48px;
      background: #FF7A59;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      box-shadow: 0 4px 16px rgba(255,122,89,0.45), 0 1px 4px rgba(0,0,0,0.18);
      pointer-events: all;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s;
      user-select: none;
    }
    #trigger:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 22px rgba(255,122,89,0.55), 0 2px 6px rgba(0,0,0,0.2);
    }
    #trigger:active { cursor: grabbing; transform: scale(0.96); }
    #trigger.open {
      background: #2d3e50;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
    }
    #trigger svg { display: block; }

    #panel {
      position: fixed;
      right: 74px;
      top: 50vh;
      transform: translateY(-50%) scale(0.96);
      width: 360px;
      max-height: 86vh;
      background: #1C2D3A;
      border: 1px solid #2D3E50;
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      color: #e2e8f0;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #panel.open {
      opacity: 1;
      pointer-events: all;
      transform: translateY(-50%) scale(1);
    }
    #panel.repositioning { transition: none; }

    #ci-header {
      padding: 13px 14px;
      background: #243342;
      border-bottom: 1px solid #2D3E50;
      display: flex;
      align-items: center;
      gap: 9px;
      cursor: default;
      user-select: none;
      flex-shrink: 0;
    }

    #ci-favicon {
      width: 22px; height: 22px;
      border-radius: 5px;
      flex-shrink: 0;
      object-fit: contain;
      display: none;
    }
    #ci-meta { flex: 1; min-width: 0; }
    #ci-detected { font-size: 10px; font-weight: 700; color: #516F90; text-transform: uppercase; letter-spacing: 0.1em; }
    #ci-company { font-size: 14px; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .ci-hbtn {
      background: none; border: none; cursor: pointer;
      color: #516F90; font-size: 17px; padding: 4px 5px;
      border-radius: 6px; line-height: 1;
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0; pointer-events: all;
    }
    .ci-hbtn:hover { color: #e2e8f0; background: rgba(255,255,255,0.06); }
    #ci-close:hover { color: #f87171; }

    #ci-body {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #ci-body::-webkit-scrollbar { width: 4px; }
    #ci-body::-webkit-scrollbar-track { background: transparent; }
    #ci-body::-webkit-scrollbar-thumb { background: #2D3E50; border-radius: 4px; }

    .ci-section-title {
      font-size: 10px; font-weight: 800; color: #516F90;
      text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;
    }
    .ci-one-liner { font-size: 13px; color: #e2e8f0; line-height: 1.55; font-weight: 500; }
    .ci-category {
      display: inline-block; font-size: 11px; color: #FF7A59;
      background: rgba(255,122,89,0.1); border: 1px solid rgba(255,122,89,0.25);
      border-radius: 20px; padding: 2px 10px; font-weight: 500;
    }

    .ci-links { display: flex; gap: 10px; flex-wrap: wrap; }
    .ci-link { font-size: 12px; color: #FF7A59; text-decoration: none; font-weight: 500; }
    .ci-link:hover { color: #ffaa94; }

    .ci-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ci-stat {
      background: #243342; border: 1px solid #2D3E50;
      border-radius: 8px; padding: 10px 12px;
      text-decoration: none; display: block;
    }
    .ci-stat-label { font-size: 10px; color: #516F90; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
    .ci-stat-value { font-size: 14px; font-weight: 700; color: #f8fafc; }

    .ci-skeleton-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ci-skeleton {
      height: 56px; background: #243342; border-radius: 8px;
      animation: ci-pulse 1.4s ease-in-out infinite;
    }
    @keyframes ci-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    .ci-spinner-row { display: flex; align-items: center; gap: 10px; color: #516F90; font-size: 12px; padding: 4px 0; }
    .ci-spinner {
      width: 16px; height: 16px; border: 2px solid #2D3E50;
      border-top-color: #FF7A59; border-radius: 50%;
      animation: ci-spin 0.8s linear infinite; flex-shrink: 0;
    }
    @keyframes ci-spin { to { transform: rotate(360deg); } }

    details {
      border: 1px solid #2D3E50; border-radius: 8px; overflow: hidden;
    }
    summary {
      padding: 10px 14px; font-size: 11px; font-weight: 700;
      color: #99afc4; cursor: pointer; list-style: none;
      display: flex; align-items: center; justify-content: space-between;
      background: #243342;
      text-transform: uppercase; letter-spacing: 0.07em;
    }
    summary::-webkit-details-marker { display: none; }
    summary::after { content: '›'; font-size: 16px; transition: transform 0.2s; }
    details[open] summary::after { transform: rotate(90deg); }
    .ci-detail-body { padding: 12px 14px; font-size: 13px; color: #99afc4; line-height: 1.6; }

    .ci-leader {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid #2D3E50;
    }
    .ci-leader:last-child { border-bottom: none; }
    .ci-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: #2D3E50; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      color: #516F90; font-size: 13px;
      object-fit: cover;
    }
    .ci-leader-name { font-size: 13px; font-weight: 600; color: #f8fafc; text-decoration: none; }
    .ci-leader-name:hover { color: #FF7A59; }
    .ci-leader-title { font-size: 11px; color: #516F90; margin-top: 2px; }

    .ci-review { padding: 8px 0; border-bottom: 1px solid #2D3E50; }
    .ci-review:last-child { border-bottom: none; }
    .ci-review-text { font-size: 12px; color: #99afc4; line-height: 1.5; font-style: italic; }
    .ci-review-source { font-size: 11px; color: #3d5468; margin-top: 3px; }

    .ci-save-btn {
      width: 100%; padding: 10px; background: #FF7A59; border: none;
      border-radius: 8px; color: #fff; font-size: 13px; font-weight: 700;
      cursor: pointer; transition: background 0.15s; font-family: inherit;
    }
    .ci-save-btn:hover { background: #e8623f; }
    .ci-save-btn.saved {
      background: transparent; border: 1px solid #2D3E50;
      color: #516F90; cursor: default;
    }
    .ci-crm-link {
      display: block; text-align: center; font-size: 13px; font-weight: 600;
      color: #FF7A59; text-decoration: none; padding: 8px 0 2px;
      transition: color 0.15s;
    }
    .ci-crm-link:hover { color: #ffaa94; }

    .ci-empty { color: #516F90; font-size: 13px; text-align: center; padding: 32px 0; line-height: 1.6; }
    .ci-error { color: #f87171; font-size: 13px; padding: 8px 0; }
    .ci-no-data { font-size: 12px; color: #3d5468; }
  `;

  // ── HTML ─────────────────────────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="trigger" title="Company Intel">
      <svg id="trigger-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/>
        <line x1="16.5" y1="16.5" x2="22" y2="22"/>
      </svg>
    </div>
    <div id="panel">
      <div id="ci-header">
        <img id="ci-favicon" alt="">
        <div id="ci-meta">
          <div id="ci-detected">Detected</div>
          <div id="ci-company">—</div>
        </div>
        <button class="ci-hbtn" id="ci-refresh" title="Refresh">↻</button>
        <button class="ci-hbtn" id="ci-close" title="Close">✕</button>
      </div>
      <div id="ci-body">
        <div class="ci-empty">Click CI to research this company</div>
      </div>
    </div>
  `;

  shadow.appendChild(styleEl);
  shadow.appendChild(wrapper);

  // ── State ────────────────────────────────────────────────────────────────
  let isOpen = false;
  let currentCompany = null;
  let currentDomain = null;
  let currentResearch = null;
  let hasResearched = false;

  // Drag state
  let isDraggingTrigger = false;
  let didDrag = false;
  let triggerDragStartY = 0, triggerDragStartTop = 0;
  let triggerTop = window.innerHeight - 74;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const trigger = shadow.getElementById('trigger');
  const panel = shadow.getElementById('panel');
  const body = shadow.getElementById('ci-body');
  const companyEl = shadow.getElementById('ci-company');
  const faviconEl = shadow.getElementById('ci-favicon');
  const ciHeader = shadow.getElementById('ci-header');
  const refreshBtn = shadow.getElementById('ci-refresh');
  const closeBtn = shadow.getElementById('ci-close');

  // ── Init position ────────────────────────────────────────────────────────
  trigger.style.top = triggerTop + 'px';

  function updatePanelPosition() {
    const triggerCenter = triggerTop + 25;
    const half = Math.min(window.innerHeight * 0.43, 280);
    const clamped = Math.max(half + 10, Math.min(window.innerHeight - half - 10, triggerCenter));
    panel.style.top = clamped + 'px';
  }

  const ICON_SEARCH = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>`;
  const ICON_CLOSE  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  function setTriggerIcon(open) {
    trigger.innerHTML = open ? ICON_CLOSE : ICON_SEARCH;
  }

  // ── Toggle ───────────────────────────────────────────────────────────────
  trigger.addEventListener('click', () => {
    if (didDrag) { didDrag = false; return; }
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    trigger.classList.toggle('open', isOpen);
    setTriggerIcon(isOpen);
    if (isOpen) updatePanelPosition();
    if (isOpen && !hasResearched) {
      const detected = detectCompany();
      currentCompany = detected.company;
      currentDomain = detected.domain;
      companyEl.textContent = currentCompany || '—';
      if (currentCompany) research(currentCompany, currentDomain);
    }
  });

  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panel.classList.remove('open');
    trigger.classList.remove('open');
    setTriggerIcon(false);
  });

  refreshBtn.addEventListener('click', () => {
    if (currentCompany) {
      hasResearched = false;
      research(currentCompany, currentDomain, true);
    }
  });

  // ── Drag (trigger slides up/down along right edge) ───────────────────────
  trigger.addEventListener('mousedown', e => {
    isDraggingTrigger = true;
    didDrag = false;
    triggerDragStartY = e.clientY;
    triggerDragStartTop = triggerTop;
  });

  document.addEventListener('mousemove', e => {
    if (!isDraggingTrigger) return;
    const dy = e.clientY - triggerDragStartY;
    if (Math.abs(dy) > 3) didDrag = true;
    triggerTop = Math.max(20, Math.min(window.innerHeight - 70, triggerDragStartTop + dy));
    trigger.style.top = triggerTop + 'px';
    if (isOpen) {
      panel.classList.add('repositioning');
      updatePanelPosition();
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingTrigger) {
      isDraggingTrigger = false;
      panel.classList.remove('repositioning');
    }
  });

  // ── Research ─────────────────────────────────────────────────────────────
  function research(company, domain, forceRefresh = false) {
    // Guard against invalidated extension context (e.g. after extension reload)
    if (!chrome?.storage?.local || !chrome?.runtime?.sendMessage) {
      const body = shadow.getElementById('ci-body');
      if (body) body.innerHTML = '<div style="padding:16px;font-size:13px;color:#94a3b8;text-align:center">Extension reloaded — refresh page to continue.</div>';
      return;
    }

    showSkeleton(company);

    try {
      if (!forceRefresh) {
        chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
          void chrome.runtime.lastError;
          const cached = researchCache?.[company.toLowerCase()];
          const TTL = 24 * 60 * 60 * 1000;
          if (cached && Date.now() - cached.ts < TTL) {
            hasResearched = true;
            currentResearch = cached.data;
            render(cached.data);
            return;
          }
          fetchResearch(company, domain);
        });
      } else {
        chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
          void chrome.runtime.lastError;
          if (researchCache?.[company.toLowerCase()]) {
            const pruned = { ...researchCache };
            delete pruned[company.toLowerCase()];
            chrome.storage.local.set({ researchCache: pruned });
          }
          fetchResearch(company, domain);
        });
      }
    } catch(e) {
      const body = shadow.getElementById('ci-body');
      if (body) body.innerHTML = '<div style="padding:16px;font-size:13px;color:#94a3b8;text-align:center">Extension reloaded — refresh page to continue.</div>';
    }
  }

  function fetchResearch(company, domain) {
    // Phase 1: quick Apollo lookup for fast stats
    chrome.runtime.sendMessage({ type: 'QUICK_LOOKUP', company, domain }, quick => {
      void chrome.runtime.lastError;
      if (quick?.companyWebsite) setFavicon(quick.companyWebsite);
      if (quick && (quick.employees || quick.funding)) renderQuickStats(quick, company);
    });

    // Phase 2: full research
    chrome.runtime.sendMessage({ type: 'RESEARCH_COMPANY', company, domain }, data => {
      void chrome.runtime.lastError;
      if (!data || data.error) {
        body.innerHTML = `<div class="ci-error">${data?.error || 'Something went wrong'}</div>`;
        return;
      }
      hasResearched = true;
      currentResearch = data;
      render(data);
    });
  }

  // ── Favicon ───────────────────────────────────────────────────────────────
  function setFavicon(website) {
    if (!website) return;
    const d = website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    faviconEl.src = `https://www.google.com/s2/favicons?domain=${d}&sz=64`;
    faviconEl.style.display = 'block';
    faviconEl.onerror = () => { faviconEl.style.display = 'none'; };
  }

  // ── Skeleton ──────────────────────────────────────────────────────────────
  function showSkeleton(company) {
    body.innerHTML = `
      <div>
        <div class="ci-section-title">Company Overview</div>
        <div class="ci-skeleton-grid">
          <div class="ci-skeleton"></div><div class="ci-skeleton"></div>
          <div class="ci-skeleton"></div><div class="ci-skeleton"></div>
        </div>
      </div>
      <div class="ci-spinner-row"><div class="ci-spinner"></div>Analyzing ${company}…</div>
    `;
  }

  function renderQuickStats(data, company) {
    const stats = [
      { label: 'Employees', value: data.employees },
      { label: 'Funding', value: data.funding },
      { label: 'Industry', value: data.industry },
      { label: 'Founded', value: data.founded }
    ].filter(s => s.value && s.value !== 'null');
    if (stats.length === 0) return;
    const statsHtml = stats.map(s =>
      `<div class="ci-stat"><div class="ci-stat-label">${s.label}</div><div class="ci-stat-value">${s.value}</div></div>`
    ).join('');
    body.innerHTML = `
      <div>
        <div class="ci-section-title">Company Overview</div>
        <div class="ci-stat-grid">${statsHtml}</div>
      </div>
      <div class="ci-spinner-row"><div class="ci-spinner"></div>Analyzing ${company}…</div>
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render(data) {
    if (data.companyWebsite) setFavicon(data.companyWebsite);

    const intel = data.intelligence || {};

    const links = [];
    if (data.companyWebsite) links.push(`<a class="ci-link" href="${data.companyWebsite}" target="_blank">↗ Website</a>`);
    if (data.companyLinkedin) links.push(`<a class="ci-link" href="${data.companyLinkedin}" target="_blank">in LinkedIn</a>`);

    const statDefs = [
      { label: 'Employees', value: data.employees },
      { label: 'Total Funding', value: data.funding },
      { label: 'Industry', value: data.industry },
      { label: 'Founded', value: data.founded }
    ].filter(s => s.value && s.value !== 'null');

    const statsHtml = statDefs.length > 0
      ? `<div class="ci-stat-grid">${statDefs.map(s =>
          `<div class="ci-stat"><div class="ci-stat-label">${s.label}</div><div class="ci-stat-value">${s.value}</div></div>`
        ).join('')}</div>`
      : '<div class="ci-no-data">No firmographic data available</div>';

    const leadersHtml = (data.leaders || []).slice(0, 4).map((l, i) => `
      <div class="ci-leader">
        <div class="ci-avatar" id="ci-la-${i}">👤</div>
        <div>
          ${l.newsUrl
            ? `<a class="ci-leader-name" href="${l.newsUrl}" target="_blank">${l.name}</a>`
            : `<div class="ci-leader-name">${l.name}</div>`}
          <div class="ci-leader-title">${l.title || ''}</div>
        </div>
      </div>
    `).join('');

    const reviewsHtml = (data.reviews || []).slice(0, 3).map(r => `
      <div class="ci-review">
        <div class="ci-review-text">"${r.snippet}"</div>
        <div class="ci-review-source">${r.source || ''}</div>
      </div>
    `).join('');

    body.innerHTML = `
      ${links.length ? `<div class="ci-links">${links.join('')}</div>` : ''}
      ${intel.oneLiner ? `<div class="ci-one-liner">${intel.oneLiner}</div>` : ''}
      ${intel.category ? `<span class="ci-category">${intel.category}</span>` : ''}

      <div>
        <div class="ci-section-title">Company Overview</div>
        ${statsHtml}
      </div>

      ${intel.whosBuyingIt ? `<details><summary>Who Buys It</summary><div class="ci-detail-body">${intel.whosBuyingIt}</div></details>` : ''}
      ${intel.howItWorks ? `<details><summary>How It Works</summary><div class="ci-detail-body">${intel.howItWorks}</div></details>` : ''}

      ${leadersHtml ? `<div><div class="ci-section-title">Leadership</div>${leadersHtml}</div>` : ''}
      ${reviewsHtml ? `<details><summary>Reviews</summary><div class="ci-detail-body">${reviewsHtml}</div></details>` : ''}

      <button class="ci-save-btn" id="ci-save-btn">+ Save Company</button>
    `;

    // Save button
    const saveBtn = shadow.getElementById('ci-save-btn');
    checkSaved(currentCompany, saveBtn);
    saveBtn?.addEventListener('click', () => {
      if (!saveBtn.classList.contains('saved')) saveCompany(saveBtn);
    });

    // Fetch leader photos async
    if (data.leaders?.length > 0) {
      chrome.runtime.sendMessage(
        { type: 'GET_LEADER_PHOTOS', leaders: data.leaders.slice(0, 4), company: currentCompany },
        photos => {
          void chrome.runtime.lastError;
          if (!photos) return;
          photos.forEach((url, i) => {
            if (!url) return;
            const el = shadow.getElementById(`ci-la-${i}`);
            if (!el) return;
            const img = document.createElement('img');
            img.className = 'ci-avatar';
            img.style.cssText = 'width:36px;height:36px;border-radius:50%;object-fit:cover;';
            img.onerror = () => { img.style.display = 'none'; };
            img.src = url;
            el.replaceWith(img);
          });
        }
      );
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
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
    if (na.includes(nb) || nb.includes(na)) return true;
    return false;
  }

  function checkSaved(company, btn) {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const match = (savedCompanies || []).find(c => companiesMatch(c.company, company));
      if (!match || !btn) return;
      btn.textContent = '✓ Saved';
      btn.classList.add('saved');
      // Add "View in CRM" link below the button
      const crmUrl = chrome.runtime.getURL(`company.html?id=${match.id}`);
      const link = document.createElement('a');
      link.href = crmUrl;
      link.target = '_blank';
      link.className = 'ci-crm-link';
      link.textContent = 'View full profile →';
      btn.insertAdjacentElement('afterend', link);
    });
  }

  function saveCompany(btn) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      type: 'company',
      company: currentCompany,
      url: currentResearch?.companyWebsite || location.href,
      savedAt: Date.now(),
      oneLiner: currentResearch?.intelligence?.oneLiner || null,
      category: currentResearch?.intelligence?.category || null,
      employees: currentResearch?.employees || null,
      funding: currentResearch?.funding || null,
      founded: currentResearch?.founded || null,
      companyWebsite: currentResearch?.companyWebsite || null,
      companyLinkedin: currentResearch?.companyLinkedin || null,
      tags: [],
      notes: '',
      status: 'needs_review'
    };

    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const existing = savedCompanies || [];
      const dup = existing.some(c => companiesMatch(c.company, currentCompany));
      if (dup) { btn.textContent = '✓ Saved'; btn.classList.add('saved'); return; }
      chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, () => {
        btn.textContent = '✓ Saved';
        btn.classList.add('saved');
        const crmUrl = chrome.runtime.getURL(`company.html?id=${entry.id}`);
        const link = document.createElement('a');
        link.href = crmUrl;
        link.target = '_blank';
        link.className = 'ci-crm-link';
        link.textContent = 'View full profile →';
        btn.insertAdjacentElement('afterend', link);
      });
    });
  }
})();
