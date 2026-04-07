// ── CompanyIntel Inbox ──────────────────────────────────────────────────────

let allCompanies = [];
let lastViewedAt = 0;
let allEmails = [];
let companyMap = {};
let entryMap = {};
let selectedCompanyId = null;
let selectedEmailIdx = -1;
let searchQuery = '';
let stageFilter = 'all';
let directionFilter = 'all'; // all, inbound, outbound
let gmailUserEmail = '';
let configuredStages = []; // [{ key, label }] from opportunityStages/customStages
let readEmailKeys = new Set();

function emailKey(email) {
  return email.id || email.messageId || email.threadId || `${email.subject || ''}|${email.date || ''}|${email.from || ''}`;
}

function markEmailRead(email) {
  const k = emailKey(email);
  if (!k || readEmailKeys.has(k)) return;
  readEmailKeys.add(k);
  // Mark in-memory copies so the next render reflects it
  allEmails.forEach(e => { if (emailKey(e) === k) e._unread = false; });
  chrome.storage.local.set({ readEmailKeys: [...readEmailKeys] });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const now = new Date();
  const diff = Math.round((now - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  if (diff < 365) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function parseFromName(from) {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.replace(/<[^>]+>/, '').trim() || 'Unknown';
}

function parseFromEmail(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

// ── Data Loading ────────────────────────────────────────────────────────────

chrome.storage.local.get(['savedCompanies', 'lastInboxViewedAt', 'gmailUserEmail', 'opportunityStages', 'customStages', 'readEmailKeys'], data => {
  gmailUserEmail = (data.gmailUserEmail || '').toLowerCase();
  allCompanies = data.savedCompanies || [];
  const stages = data.opportunityStages || data.customStages || [];
  configuredStages = stages.map(s => ({ key: s.key, label: s.label || s.name || s.key }));
  readEmailKeys = new Set(Array.isArray(data.readEmailKeys) ? data.readEmailKeys : []);
  // First ever open: set to now so nothing shows as unread
  // Subsequent opens: use the stored timestamp
  const isFirstOpen = data.lastInboxViewedAt === undefined || data.lastInboxViewedAt === null;
  lastViewedAt = isFirstOpen ? Date.now() : data.lastInboxViewedAt;
  chrome.storage.local.set({ lastInboxViewedAt: Date.now() });
  buildEmailIndex();
  init();
});

function buildEmailIndex() {
  allEmails = [];
  companyMap = {};
  entryMap = {};

  allCompanies.forEach(entry => {
    entryMap[entry.id] = entry;
    if (!entry.cachedEmails?.length) return;
    const favDomain = entry.companyWebsite ? entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    const stage = entry.jobStage || entry.status || 'saved';
    companyMap[entry.id] = { name: entry.company, favDomain, id: entry.id, stage, isOpportunity: !!entry.isOpportunity };

    entry.cachedEmails.forEach(email => {
      const key = emailKey(email);
      const newerThanLastView = email.date ? new Date(email.date).getTime() > lastViewedAt : false;
      allEmails.push({
        ...email,
        _company: entry.company,
        _companyId: entry.id,
        _favDomain: favDomain,
        _stage: stage,
        _ts: email.date ? new Date(email.date).getTime() : 0,
        _unread: newerThanLastView && !readEmailKeys.has(key),
      });
    });
  });

  allEmails.sort((a, b) => b._ts - a._ts);
}

// ── Initialization ──────────────────────────────────────────────────────────

function init() {
  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('saved.html'), '_blank');
  });

  // Stats
  const companies = [...new Set(allEmails.map(e => e._companyId))];
  document.getElementById('inbox-stats').textContent = `${allEmails.length} emails across ${companies.length} companies`;

  // Search
  const searchEl = document.getElementById('inbox-search');
  let searchTimeout;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = searchEl.value.trim().toLowerCase();
      renderEmailList();
    }, 200);
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); navigateEmails(1); }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); navigateEmails(-1); }
    if (e.key === 'Escape') { selectedEmailIdx = -1; renderDetail(null); highlightRow(); }
  });

  buildSidebar();
  renderEmailList();
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function buildSidebar() {
  const sidebar = document.getElementById('inbox-sidebar');
  const companyCounts = {};
  const companyUnread = {};
  const companyLatest = {};

  // Respect stage filter in sidebar counts
  const filteredForSidebar = stageFilter !== 'all' ? allEmails.filter(e => e._stage === stageFilter) : allEmails;
  filteredForSidebar.forEach(e => {
    companyCounts[e._companyId] = (companyCounts[e._companyId] || 0) + 1;
    if (e._unread) companyUnread[e._companyId] = (companyUnread[e._companyId] || 0) + 1;
    if (!companyLatest[e._companyId] || e._ts > companyLatest[e._companyId]) {
      companyLatest[e._companyId] = e._ts;
    }
  });

  const sortedCompanies = Object.keys(companyCounts).sort((a, b) => (companyLatest[b] || 0) - (companyLatest[a] || 0));
  const totalUnread = Object.values(companyUnread).reduce((a, b) => a + b, 0);

  let html = `<div class="sidebar-section-label">Companies</div>`;
  html += `<div class="sidebar-item sidebar-item-all ${selectedCompanyId === null ? 'active' : ''}" data-company="all">
    <span class="sidebar-item-name">All Mail</span>
    ${totalUnread > 0 ? `<span class="sidebar-item-count unread">${totalUnread > 99 ? '99+' : totalUnread}</span>` : `<span class="sidebar-item-count">${allEmails.length}</span>`}
  </div>`;

  sortedCompanies.forEach(id => {
    const info = companyMap[id];
    if (!info) return;
    const count = companyCounts[id] || 0;
    const unread = companyUnread[id] || 0;
    const favHtml = info.favDomain
      ? `<img class="sidebar-item-favicon" src="https://www.google.com/s2/favicons?domain=${info.favDomain}&sz=32" onerror="this.style.display='none'">`
      : '';
    html += `<div class="sidebar-item ${selectedCompanyId === id ? 'active' : ''}" data-company="${id}">
      ${favHtml}
      <span class="sidebar-item-name">${escHtml(info.name)}</span>
      ${unread > 0 ? `<span class="sidebar-item-count unread">${unread}</span>` : `<span class="sidebar-item-count">${count}</span>`}
    </div>`;
  });

  sidebar.innerHTML = html;

  sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.dataset.company;
      selectedCompanyId = val === 'all' ? null : val;
      selectedEmailIdx = -1;
      buildSidebar();
      renderEmailList();
      renderDetail(null);
    });
  });
}

// ── Email List ──────────────────────────────────────────────────────────────

function getFilteredEmails() {
  let emails = selectedCompanyId ? allEmails.filter(e => e._companyId === selectedCompanyId) : allEmails;
  if (stageFilter !== 'all') {
    emails = emails.filter(e => e._stage === stageFilter);
  }
  if (directionFilter === 'inbound') {
    emails = emails.filter(e => {
      const from = (e.from || '').toLowerCase();
      return !from.includes(gmailUserEmail || 'mattsterbenz') && !from.includes('matt sterbenz');
    });
  } else if (directionFilter === 'outbound') {
    emails = emails.filter(e => {
      const from = (e.from || '').toLowerCase();
      return from.includes(gmailUserEmail || 'mattsterbenz') || from.includes('matt sterbenz');
    });
  }
  if (searchQuery) {
    emails = emails.filter(e =>
      (e.subject || '').toLowerCase().includes(searchQuery) ||
      (e.from || '').toLowerCase().includes(searchQuery) ||
      (e.snippet || '').toLowerCase().includes(searchQuery)
    );
  }
  return emails;
}

function getStages() {
  // Source of truth: configured pipeline stages, in pipeline order.
  // Fall back to whatever stages currently appear on emails (for legacy data).
  const present = new Set();
  allEmails.forEach(e => { if (e._stage) present.add(e._stage); });
  if (configuredStages.length) {
    const fromConfig = configuredStages.map(s => ({ key: s.key, label: s.label }));
    // Append any stages that exist on emails but aren't in the configured list
    const configuredKeys = new Set(configuredStages.map(s => s.key));
    [...present].filter(k => !configuredKeys.has(k)).forEach(k => fromConfig.push({ key: k, label: k.replace(/_/g, ' ') }));
    return fromConfig;
  }
  return [...present].map(k => ({ key: k, label: k.replace(/_/g, ' ') }));
}

function renderEmailList() {
  const listEl = document.getElementById('inbox-list');
  const emails = getFilteredEmails();
  const companyName = selectedCompanyId ? (companyMap[selectedCompanyId]?.name || 'Unknown') : 'All Mail';
  const stages = getStages(); // [{ key, label }]

  let html = `<div class="list-header">
    <span class="list-header-title">${escHtml(companyName)}</span>
    <span class="list-header-count">${emails.length} email${emails.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="list-filters">
    <div class="filter-row">
      <select class="filter-select" id="stage-filter">
        <option value="all"${stageFilter === 'all' ? ' selected' : ''}>All Stages</option>
        ${stages.map(s => `<option value="${s.key}"${stageFilter === s.key ? ' selected' : ''}>${escHtml(s.label)}</option>`).join('')}
      </select>
      <select class="filter-select" id="direction-filter">
        <option value="all"${directionFilter === 'all' ? ' selected' : ''}>All Emails</option>
        <option value="inbound"${directionFilter === 'inbound' ? ' selected' : ''}>Inbound</option>
        <option value="outbound"${directionFilter === 'outbound' ? ' selected' : ''}>Sent by Me</option>
      </select>
      <button class="filter-btn ${directionFilter === 'all' && stageFilter === 'all' ? '' : 'active'}" id="clear-filters">Clear</button>
    </div>
  </div>`;

  if (!emails.length) {
    html += `<div style="text-align:center;padding:40px;color:#A09A94;font-size:13px;">
      ${searchQuery ? `No emails matching "${escHtml(searchQuery)}"` : 'No emails found'}
    </div>`;
  } else {
    emails.slice(0, 300).forEach((e, i) => {
      const isSelected = i === selectedEmailIdx;
      const showCompany = !selectedCompanyId;
      html += `<div class="email-row ${isSelected ? 'selected' : ''} ${e._unread ? 'unread' : ''}" data-idx="${i}">
        <div class="email-dot ${e._unread ? '' : 'read'}"></div>
        <div class="email-content">
          <div class="email-from">${escHtml(parseFromName(e.from))}</div>
          <div class="email-subject">${escHtml(e.subject || '(no subject)')}</div>
          <div class="email-snippet">${escHtml(e.snippet || '')}</div>
          ${showCompany ? `<span class="email-company-pill">${escHtml(e._company)}</span>` : ''}
        </div>
        <div class="email-date">${formatDate(e.date)}</div>
      </div>`;
    });
  }

  listEl.innerHTML = html;

  listEl.querySelectorAll('.email-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      selectedEmailIdx = idx;
      const email = getFilteredEmails()[idx];
      if (email) {
        markEmailRead(email);
        renderDetail(email);
        // Reflect read state in list + sidebar counts
        renderEmailList();
        buildSidebar();
      }
      highlightRow();
    });
  });

  // Filter event listeners
  document.getElementById('stage-filter')?.addEventListener('change', (e) => {
    stageFilter = e.target.value;
    selectedEmailIdx = -1;
    renderEmailList();
    buildSidebar();
  });
  document.getElementById('direction-filter')?.addEventListener('change', (e) => {
    directionFilter = e.target.value;
    selectedEmailIdx = -1;
    renderEmailList();
  });
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    stageFilter = 'all';
    directionFilter = 'all';
    selectedEmailIdx = -1;
    renderEmailList();
    buildSidebar();
  });
}

function highlightRow() {
  document.querySelectorAll('.email-row').forEach((row, i) => {
    row.classList.toggle('selected', i === selectedEmailIdx);
  });
}

function navigateEmails(dir) {
  const emails = getFilteredEmails();
  if (!emails.length) return;
  selectedEmailIdx = Math.max(0, Math.min(emails.length - 1, selectedEmailIdx + dir));
  highlightRow();
  renderDetail(emails[selectedEmailIdx]);
  // Scroll row into view
  const row = document.querySelector(`.email-row[data-idx="${selectedEmailIdx}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

// ── Email Detail ────────────────────────────────────────────────────────────

function renderDetail(email) {
  const detailEl = document.getElementById('inbox-detail');

  if (!email) {
    detailEl.className = 'inbox-detail empty';
    detailEl.innerHTML = `<div class="detail-empty">
      <div class="detail-empty-icon">✉</div>
      Select an email to read
    </div>`;
    return;
  }

  detailEl.className = 'inbox-detail';

  // Find thread siblings
  const threadEmails = email.threadId
    ? allEmails.filter(e => e.threadId === email.threadId).sort((a, b) => a._ts - b._ts)
    : [email];

  const gmailUrl = email.threadId
    ? `https://mail.google.com/mail/u/0/#inbox/${email.threadId}`
    : `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(email.subject || '')}`;

  const companyUrl = email._companyId
    ? chrome.runtime.getURL('company.html') + '?id=' + email._companyId
    : null;

  let html = `<div class="detail-header">
    <div class="detail-subject">${escHtml(email.subject || '(no subject)')}</div>
    <div class="detail-meta">
      <div><strong>From:</strong> ${escHtml(email.from || '')}</div>
      ${email.to ? `<div><strong>To:</strong> ${escHtml(email.to)}</div>` : ''}
      <div><strong>Date:</strong> ${formatFullDate(email.date)}</div>
      <div><strong>Company:</strong> ${escHtml(email._company || '')}</div>
    </div>
  </div>`;

  if (threadEmails.length > 1) {
    html += `<div style="padding:8px 20px;font-size:11px;font-weight:600;color:#A09A94;background:#FAFAF9;border-bottom:1px solid #F0EEEB;">${threadEmails.length} messages in thread</div>`;
    threadEmails.forEach((te, i) => {
      const isLast = i === threadEmails.length - 1;
      const body = stripQuotedContent(te.body || te.snippet || '');
      html += `<div class="thread-msg ${isLast ? '' : 'collapsed'}">
        <div class="thread-msg-header" ${!isLast ? 'onclick="this.parentElement.classList.toggle(\'collapsed\')"' : ''}>
          <span class="thread-msg-from">${escHtml(parseFromName(te.from))} ${!isLast ? '<span style="color:#A09A94;font-weight:400;">— click to expand</span>' : ''}</span>
          <span class="thread-msg-date">${formatDate(te.date)}</span>
        </div>
        <div class="thread-msg-body">${escHtml(body)}</div>
      </div>`;
    });
  } else {
    const body = stripQuotedContent(email.body || email.snippet || '');
    html += `<div class="detail-body">${escHtml(body)}</div>`;
  }

  html += `<div class="detail-footer">
    <a class="detail-btn primary" href="${gmailUrl}" target="_blank">Open in Gmail ↗</a>
    ${companyUrl ? `<a class="detail-btn" href="${companyUrl}" target="_blank">View Company</a>` : ''}
  </div>`;

  detailEl.innerHTML = html;
  detailEl.scrollTop = 0;
}

function stripQuotedContent(text) {
  if (!text) return '';
  // Remove common quoted reply patterns
  const lines = text.split('\n');
  const cutLines = [];
  for (const line of lines) {
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^-{3,}\s*Original Message\s*-{3,}$/i.test(line.trim())) break;
    if (/^>{2,}/.test(line.trim())) break;
    if (/^From:.*@/.test(line.trim()) && cutLines.length > 3) break;
    cutLines.push(line);
  }
  return cutLines.join('\n').trim();
}
