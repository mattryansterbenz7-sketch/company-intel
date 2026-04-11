// ── Coop.ai Inbox ───────────────────────────────────────────────────────────

let allCompanies = [];
let lastViewedAt = 0;
let allEmails = [];
let companyMap = {};
let entryMap = {};
let selectedCompanyId = null;
let highlightedCompanyId = null; // tracks which company the currently-open email belongs to
let selectedEmailIdx = -1;
let searchQuery = '';
let stageFilter = 'active';
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
  allEmails.forEach(e => { if (emailKey(e) === k) e._unread = false; });
  chrome.storage.local.set({ readEmailKeys: [...readEmailKeys] });
}

function markEmailUnread(email) {
  const k = emailKey(email);
  if (!k) return;
  readEmailKeys.delete(k);
  allEmails.forEach(e => { if (emailKey(e) === k) e._unread = true; });
  chrome.storage.local.set({ readEmailKeys: [...readEmailKeys] });
}

// escHtml — provided by ui-utils.js

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

// Stable color from a string — for avatar backgrounds
const AVATAR_PALETTE = [
  '#FF7A59','#0EA5E9','#10B981','#8B5CF6','#F59E0B','#EC4899',
  '#14B8A6','#6366F1','#EF4444','#84CC16','#F97316','#06B6D4',
];
function avatarColor(seed) {
  if (!seed) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function avatarInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarHtml(name, size) {
  const initials = avatarInitials(name);
  const color = avatarColor(name || '');
  const cls = size === 'sm' ? 'thread-msg-avatar' : size === 'lg' ? 'detail-avatar' : 'email-avatar';
  return `<div class="${cls}" style="background:${color}">${escHtml(initials)}</div>`;
}

// Date-grouping bucket for the list
function dateGroup(ts) {
  if (!ts) return 'Older';
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 6 * 86400000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfWeek) return 'This Week';
  if (ts >= startOfMonth) return 'This Month';
  return 'Older';
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

// Live-refresh stage list when pipeline config changes elsewhere
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.opportunityStages || changes.customStages) {
    const v = (changes.opportunityStages?.newValue) || (changes.customStages?.newValue) || [];
    configuredStages = v.map(s => ({ key: s.key, label: s.label || s.name || s.key }));
    if (typeof renderEmailList === 'function') renderEmailList();
  }
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

    const blockedSenders = new Set((entry.blockedEmailSenders || []).map(s => s.toLowerCase()));

    entry.cachedEmails.forEach(email => {
      // Skip ghost emails with no subject and no content
      if (!email.subject && !email.body && !email.snippet) return;
      // Skip emails from senders explicitly blocked for this company
      if (blockedSenders.size) {
        const fromAddr = (email.from || '').toLowerCase();
        for (const blocked of blockedSenders) {
          if (fromAddr.includes(blocked)) return;
        }
      }
      const key = emailKey(email);
      // Unread = "I haven't clicked it yet AND it arrived since I last opened the inbox".
      // Once an email is in readEmailKeys, it stays read forever, regardless of dates.
      // Older-than-last-view emails are auto-read on first sight (no manual click needed).
      const ts = email.date ? new Date(email.date).getTime() : 0;
      const isInReadSet = readEmailKeys.has(key);
      const newerThanLastView = ts > lastViewedAt;
      const isUnread = newerThanLastView && !isInReadSet;
      // Auto-add older emails to readEmailKeys so they persist as read across sessions
      if (!isUnread && !isInReadSet && key) readEmailKeys.add(key);
      allEmails.push({
        ...email,
        _company: entry.company,
        _companyId: entry.id,
        _favDomain: favDomain,
        _stage: stage,
        _ts: ts,
        _unread: isUnread,
      });
    });
  });

  allEmails.sort((a, b) => b._ts - a._ts);

  // Persist any auto-read additions so the read state survives reloads
  chrome.storage.local.set({ readEmailKeys: [...readEmailKeys] });
}

// ── Initialization ──────────────────────────────────────────────────────────

function init() {
  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    coopNavigate(chrome.runtime.getURL('saved.html'));
  });

  // Stats
  const companies = [...new Set(allEmails.map(e => e._companyId))];
  document.getElementById('inbox-stats').textContent = `${allEmails.length} emails across ${companies.length} companies`;

  // Refresh button
  document.getElementById('inbox-refresh-btn')?.addEventListener('click', () => refreshInboxEmails());

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
  let filteredForSidebar = allEmails;
  if (stageFilter === 'active') {
    filteredForSidebar = allEmails.filter(e => companyMap[e._companyId]?.isOpportunity && !TERMINAL_STAGE_RE.test(e._stage || ''));
  } else if (stageFilter !== 'all') {
    filteredForSidebar = allEmails.filter(e => e._stage === stageFilter);
  }
  filteredForSidebar.forEach(e => {
    companyCounts[e._companyId] = (companyCounts[e._companyId] || 0) + 1;
    if (e._unread) companyUnread[e._companyId] = (companyUnread[e._companyId] || 0) + 1;
    if (!companyLatest[e._companyId] || e._ts > companyLatest[e._companyId]) {
      companyLatest[e._companyId] = e._ts;
    }
  });

  // In active mode: sort by pipeline stage order, then by latest email within each stage.
  // Otherwise: sort by latest email date.
  const stageOrder = {};
  configuredStages.forEach((s, i) => { stageOrder[s.key] = i; });

  const sortedCompanies = Object.keys(companyCounts).sort((a, b) => {
    if (stageFilter === 'active') {
      const stageA = companyMap[a]?.stage || '';
      const stageB = companyMap[b]?.stage || '';
      const orderA = stageOrder[stageA] ?? 999;
      const orderB = stageOrder[stageB] ?? 999;
      if (orderA !== orderB) return orderA - orderB;
    }
    return (companyLatest[b] || 0) - (companyLatest[a] || 0);
  });
  const totalUnread = Object.values(companyUnread).reduce((a, b) => a + b, 0);

  let html = `<div class="sidebar-section-label">Companies</div>`;
  html += `<div class="sidebar-item sidebar-item-all ${selectedCompanyId === null ? 'active' : ''}" data-company="all">
    <span class="sidebar-item-name">All Mail</span>
    ${totalUnread > 0 ? `<span class="sidebar-item-count unread">${totalUnread > 99 ? '99+' : totalUnread}</span>` : ''}
  </div>`;

  sortedCompanies.forEach(id => {
    const info = companyMap[id];
    if (!info) return;
    const count = companyCounts[id] || 0;
    const unread = companyUnread[id] || 0;
    const favHtml = info.favDomain
      ? `<img class="sidebar-item-favicon" src="https://www.google.com/s2/favicons?domain=${info.favDomain}&sz=32" onerror="this.style.display='none'">`
      : '';
    const isHighlighted = selectedCompanyId === null && highlightedCompanyId === id;
    html += `<div class="sidebar-item ${selectedCompanyId === id ? 'active' : ''} ${isHighlighted ? 'email-highlighted' : ''}" data-company="${id}">
      ${favHtml}
      <span class="sidebar-item-name">${escHtml(info.name)}</span>
      ${unread > 0 ? `<span class="sidebar-item-count unread">${unread}</span>` : ''}
    </div>`;
  });

  sidebar.innerHTML = html;

  sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const val = item.dataset.company;
      selectedCompanyId = val === 'all' ? null : val;
      highlightedCompanyId = null;
      selectedEmailIdx = -1;
      buildSidebar();
      renderEmailList();
      renderDetail(null);
    });
  });
}

// ── Email List ──────────────────────────────────────────────────────────────

const TERMINAL_STAGE_RE = /rejected|dq|archive|closed.lost/i;

function getFilteredEmails() {
  let emails = selectedCompanyId ? allEmails.filter(e => e._companyId === selectedCompanyId) : allEmails;
  if (stageFilter === 'active') {
    emails = emails.filter(e => companyMap[e._companyId]?.isOpportunity && !TERMINAL_STAGE_RE.test(e._stage || ''));
  } else if (stageFilter !== 'all') {
    emails = emails.filter(e => e._stage === stageFilter);
  }
  if (directionFilter === 'inbound') {
    emails = emails.filter(e => {
      const from = (e.from || '').toLowerCase();
      return !gmailUserEmail || !from.includes(gmailUserEmail);
    });
  } else if (directionFilter === 'outbound') {
    emails = emails.filter(e => {
      const from = (e.from || '').toLowerCase();
      return !!gmailUserEmail && from.includes(gmailUserEmail);
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
  // Source of truth: configured pipeline stages only, in pipeline order.
  // Legacy/orphaned stage values from old entries are intentionally excluded
  // from the filter dropdown — they remain visible under "All Stages".
  if (configuredStages.length) {
    return configuredStages.map(s => ({ key: s.key, label: s.label }));
  }
  // No config loaded yet — fall back to whatever stages exist on emails
  const present = new Set();
  allEmails.forEach(e => { if (e._stage) present.add(e._stage); });
  return [...present].map(k => ({ key: k, label: k.replace(/_/g, ' ') }));
}

function renderEmailList() {
  const listEl = document.getElementById('inbox-list');
  const emails = getFilteredEmails();
  const companyName = selectedCompanyId ? (companyMap[selectedCompanyId]?.name || 'Unknown') : 'All Mail';
  const stages = getStages(); // [{ key, label }]
  const unreadCount = emails.filter(e => e._unread).length;

  // Stage chip pills (replacing dropdown)
  const stageChips = [
    `<button class="filter-chip ${stageFilter === 'active' ? 'active' : ''}" data-stage="active">Active</button>`,
    `<button class="filter-chip ${stageFilter === 'all' ? 'active' : ''}" data-stage="all">All</button>`,
    ...stages.map(s => `<button class="filter-chip ${stageFilter === s.key ? 'active' : ''}" data-stage="${escHtml(s.key)}">${escHtml(s.label)}</button>`),
  ].join('');
  const directionChips = [
    `<button class="filter-chip ${directionFilter === 'all' ? 'active' : ''}" data-dir="all">All Mail</button>`,
    `<button class="filter-chip ${directionFilter === 'inbound' ? 'active' : ''}" data-dir="inbound">Inbox</button>`,
    `<button class="filter-chip ${directionFilter === 'outbound' ? 'active' : ''}" data-dir="outbound">Sent</button>`,
  ].join('');

  let html = `<div class="list-header">
    <div class="list-header-left">
      <span class="list-header-title">${escHtml(companyName)}</span>
      <span class="list-header-count">${emails.length}${unreadCount > 0 ? ` · ${unreadCount} unread` : ''}</span>
    </div>
    <button class="list-mark-read-btn" id="mark-all-read-btn"${unreadCount === 0 ? ' disabled' : ''}>Mark all read</button>
  </div>
  <div class="list-filters">
    <div class="filter-chips">${directionChips}</div>
    <div class="filter-chips">${stageChips}</div>
  </div>`;

  if (!emails.length) {
    html += `<div style="text-align:center;padding:60px 24px;color:#A09A94;">
      <div style="font-size:36px;opacity:0.25;margin-bottom:10px;">📭</div>
      <div style="font-size:14px;font-weight:600;color:#6B6560;margin-bottom:4px;">${searchQuery ? 'No matches' : 'Nothing here yet'}</div>
      <div style="font-size:12px;line-height:1.5;">${searchQuery ? `No emails matching "${escHtml(searchQuery)}"` : 'Try adjusting filters or selecting another company.'}</div>
    </div>`;
  } else {
    let lastGroup = null;
    emails.slice(0, 300).forEach((e, i) => {
      const grp = dateGroup(e._ts);
      if (grp !== lastGroup) {
        html += `<div class="date-group-header">${grp}</div>`;
        lastGroup = grp;
      }
      const isSelected = i === selectedEmailIdx;
      const showCompany = !selectedCompanyId;
      const fromName = parseFromName(e.from);
      const stageDef = configuredStages.find(s => s.key === e._stage);
      const stagePill = (showCompany && stageDef) ? `<span class="email-stage-pill" style="background:rgba(255,122,89,0.10);color:#c2410c;">${escHtml(stageDef.label)}</span>` : '';
      html += `<div class="email-row ${isSelected ? 'selected' : ''} ${e._unread ? 'unread' : ''}" data-idx="${i}">
        ${avatarHtml(fromName)}
        <div class="email-content">
          <div class="email-row-top">
            <span class="email-from">${escHtml(fromName)}</span>
            <span class="email-date">${formatDate(e.date)}</span>
          </div>
          <div class="email-subject">${escHtml(e.subject || '(no subject)')}</div>
          <div class="email-snippet">${escHtml(e.snippet || '')}</div>
          ${(showCompany || stagePill) ? `<div class="email-row-bottom">
            ${showCompany ? `<span class="email-company-pill">${escHtml(e._company)}</span>` : ''}
            ${stagePill}
          </div>` : ''}
        </div>
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
        highlightedCompanyId = email._companyId || null;
        renderDetail(email);
        // Reflect read state in list + sidebar counts
        renderEmailList();
        buildSidebar();
        // Scroll to and highlight the associated company in sidebar
        if (highlightedCompanyId) {
          const sidebarItem = document.querySelector(`.sidebar-item[data-company="${highlightedCompanyId}"]`);
          if (sidebarItem) sidebarItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      highlightRow();
    });
  });

  // Filter chip listeners
  listEl.querySelectorAll('.filter-chip[data-stage]').forEach(chip => {
    chip.addEventListener('click', () => {
      stageFilter = chip.dataset.stage;
      selectedEmailIdx = -1;
      renderEmailList();
      buildSidebar();
    });
  });
  listEl.querySelectorAll('.filter-chip[data-dir]').forEach(chip => {
    chip.addEventListener('click', () => {
      directionFilter = chip.dataset.dir;
      selectedEmailIdx = -1;
      renderEmailList();
    });
  });

  // Mark all visible as read
  document.getElementById('mark-all-read-btn')?.addEventListener('click', () => {
    const visible = getFilteredEmails();
    visible.forEach(e => markEmailRead(e));
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
      <div class="detail-empty-title">No email selected</div>
      <div class="detail-empty-hint">Click any email on the left, or use <kbd>J</kbd> <kbd>K</kbd> to navigate.</div>
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

  const fromName = parseFromName(email.from);
  const fromEmail = parseFromEmail(email.from);
  const companyHref = email._companyId ? chrome.runtime.getURL('company.html') + '?id=' + email._companyId : null;

  let html = `<div class="detail-header">
    <div class="detail-subject">${escHtml(email.subject || '(no subject)')}</div>
    <div class="detail-from-row">
      ${avatarHtml(fromName, 'lg')}
      <div class="detail-from-info">
        <div class="detail-from-name">${escHtml(fromName)}</div>
        ${fromEmail ? `<div class="detail-from-email">${escHtml(fromEmail)}</div>` : ''}
      </div>
    </div>
    <div class="detail-meta-row">
      <span class="detail-meta-date">${formatFullDate(email.date)}</span>
      ${email._company ? (companyHref
        ? `<a class="detail-meta-pill" href="${companyHref}" target="_blank">🏢 ${escHtml(email._company)}</a>`
        : `<span class="detail-meta-pill">🏢 ${escHtml(email._company)}</span>`) : ''}
      ${email.to ? `<span class="detail-meta-pill" title="To: ${escHtml(email.to)}">→ ${escHtml(parseFromName(email.to))}</span>` : ''}
    </div>
  </div>`;

  if (threadEmails.length > 1) {
    html += `<div class="thread-count-bar">${threadEmails.length} messages in thread</div>`;
    threadEmails.forEach((te, i) => {
      const isLast = i === threadEmails.length - 1;
      const body = stripQuotedContent(te.body || te.snippet || '');
      const teName = parseFromName(te.from);
      html += `<div class="thread-msg ${isLast ? '' : 'collapsed'}">
        <div class="thread-msg-header">
          ${avatarHtml(teName, 'sm')}
          <span class="thread-msg-from">${escHtml(teName)}</span>
          <span class="thread-msg-date">${formatDate(te.date)}</span>
          <span class="thread-msg-chevron">▾</span>
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
    <button class="detail-btn" id="detail-unread-btn">${email._unread ? 'Mark read' : 'Mark unread'}</button>
    <button class="detail-btn detail-btn-delete" id="detail-remove-btn" title="Remove all emails from this sender and block them from re-associating with ${escHtml(email._company)}">Remove sender</button>
  </div>`;

  detailEl.innerHTML = html;
  detailEl.scrollTop = 0;

  detailEl.querySelectorAll('.thread-msg.collapsed .thread-msg-header').forEach(header => {
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => header.closest('.thread-msg').classList.toggle('collapsed'));
  });

  detailEl.querySelector('#detail-unread-btn')?.addEventListener('click', () => {
    if (email._unread) {
      markEmailRead(email);
    } else {
      markEmailUnread(email);
    }
    renderDetail(email);
    renderEmailList();
    buildSidebar();
  });

  detailEl.querySelector('#detail-remove-btn')?.addEventListener('click', () => deleteEmail(email));
}

function deleteEmail(email) {
  const key = emailKey(email);
  const entry = entryMap[email._companyId];

  // Extract the raw sender address to block
  const fromAddrMatch = (email.from || '').match(/<([^>]+)>/);
  const senderAddr = (fromAddrMatch ? fromAddrMatch[1] : email.from || '').toLowerCase().trim();

  // Block sender on this company so they don't re-appear after Refresh
  if (entry && senderAddr) {
    if (!entry.blockedEmailSenders) entry.blockedEmailSenders = [];
    if (!entry.blockedEmailSenders.includes(senderAddr)) {
      entry.blockedEmailSenders.push(senderAddr);
    }
  }

  // Remove ALL emails from this sender for this company (not just this one)
  if (entry?.cachedEmails) {
    entry.cachedEmails = entry.cachedEmails.filter(e => {
      const eAddr = ((e.from || '').match(/<([^>]+)>/) || [])[1] || e.from || '';
      return eAddr.toLowerCase().trim() !== senderAddr;
    });
  }

  // Remove all in-memory emails from this sender for this company
  allEmails.splice(0, allEmails.length, ...allEmails.filter(e => {
    if (e._companyId !== email._companyId) return true;
    const eAddr = ((e.from || '').match(/<([^>]+)>/) || [])[1] || e.from || '';
    return eAddr.toLowerCase().trim() !== senderAddr;
  }));

  // Clean up readEmailKeys for removed emails
  readEmailKeys.delete(key);

  if (entry) {
    const updated = allCompanies.map(c => c.id === entry.id ? entry : c);
    chrome.storage.local.set({ savedCompanies: updated, readEmailKeys: [...readEmailKeys] });
  }
  // Advance to next or clear
  const emails = getFilteredEmails();
  if (emails.length > 0) {
    const next = Math.min(selectedEmailIdx, emails.length - 1);
    selectedEmailIdx = next;
    renderDetail(emails[next]);
  } else {
    selectedEmailIdx = -1;
    renderDetail(null);
  }
  renderEmailList();
  buildSidebar();
}

async function refreshInboxEmails() {
  const btn = document.getElementById('inbox-refresh-btn');
  const labelEl = btn?.querySelector('.refresh-label');

  let companiesToRefresh = allCompanies.filter(entry => entry.companyWebsite);
  if (stageFilter === 'active') {
    companiesToRefresh = companiesToRefresh.filter(entry =>
      entry.isOpportunity && !TERMINAL_STAGE_RE.test(entry.jobStage || entry.status || '')
    );
  } else if (stageFilter !== 'all') {
    companiesToRefresh = companiesToRefresh.filter(entry =>
      (entry.jobStage || entry.status || '') === stageFilter
    );
  }

  const total = companiesToRefresh.length;
  if (!total) return;

  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  let done = 0;

  const fetchOne = (entry) => new Promise(resolve => {
    const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!domain) { done++; if (labelEl) labelEl.textContent = `${done}/${total}`; resolve(); return; }
    const knownContactEmails = (entry.knownContacts || []).map(c => c.email);
    chrome.runtime.sendMessage({
      type: 'GMAIL_FETCH_EMAILS',
      domain,
      companyName: entry.company || '',
      linkedinSlug: (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop(),
      knownContactEmails,
    }, result => {
      void chrome.runtime.lastError;
      if (result?.emails?.length) {
        entry.cachedEmails = result.emails;
        entry.cachedEmailsAt = Date.now();
      }
      done++;
      if (labelEl) labelEl.textContent = `${done}/${total}`;
      resolve();
    });
  });

  // Run 4 fetches at a time
  const CONCURRENCY = 4;
  for (let i = 0; i < companiesToRefresh.length; i += CONCURRENCY) {
    await Promise.all(companiesToRefresh.slice(i, i + CONCURRENCY).map(fetchOne));
  }

  chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
    buildEmailIndex();
    buildSidebar();
    renderEmailList();
    // Restore button
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
    if (labelEl) labelEl.textContent = 'Refresh';
  });
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
