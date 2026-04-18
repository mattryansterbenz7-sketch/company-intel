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
let savedCompaniesCache = []; // kept in sync for logo lookups

// Sidebar collapse state — active expanded, others collapsed by default
let sidebarCollapsed = { active: false, monitoring: true, closed: true };

// Pipeline stage buckets
const ACTIVE_STAGES = ['reached_out', 'convo_started', 'initial_call_scheduled', 'initial_call_held', 'hm_scheduled', 'hm_held', 'offer_stage', 'closed_won'];
const MONITORING_STAGES = ['applied', 'stalled'];

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

// ── Utilities ────────────────────────────────────────────────────────────────

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
// alias for company-colored logo initials
const companyColor = avatarColor;

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Date-grouping bucket for the list (sentence-case labels)
function dateGroup(ts) {
  if (!ts) return 'Older';
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfLastWeek = startOfToday - 13 * 86400000;
  const startOfThisWeek = startOfToday - 6 * 86400000;
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfThisWeek) return 'This week';
  if (ts >= startOfLastWeek) return 'Last week';
  // Month name
  const month = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return month;
}

// ── Gravatar / photo helpers ─────────────────────────────────────────────────

// Minimal MD5 implementation for Gravatar (no external dependency needed)
function _md5(str) {
  function safeAdd(x, y) { const lsw=(x&0xffff)+(y&0xffff); const msw=(x>>16)+(y>>16)+(lsw>>16); return (msw<<16)|(lsw&0xffff); }
  function bitRotateLeft(num,cnt) { return (num<<cnt)|(num>>>(32-cnt)); }
  function md5cmn(q,a,b,x,s,t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b); }
  function md5ff(a,b,c,d,x,s,t) { return md5cmn((b&c)|((~b)&d),a,b,x,s,t); }
  function md5gg(a,b,c,d,x,s,t) { return md5cmn((b&d)|(c&(~d)),a,b,x,s,t); }
  function md5hh(a,b,c,d,x,s,t) { return md5cmn(b^c^d,a,b,x,s,t); }
  function md5ii(a,b,c,d,x,s,t) { return md5cmn(c^(b|(~d)),a,b,x,s,t); }
  function md5blks(s) {
    const nblk=((s.length+8)>>6)+1; const blks=new Array(nblk*16).fill(0);
    for(let i=0;i<s.length;i++) blks[i>>2]|=s.charCodeAt(i)<<((i%4)*8);
    blks[s.length>>2]|=0x80<<((s.length%4)*8);
    blks[nblk*16-2]=s.length*8; return blks;
  }
  const x=md5blks(str); let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<x.length;i+=16) {
    const [oa,ob,oc,od]=[a,b,c,d];
    a=md5ff(a,b,c,d,x[i],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);
    a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);
    a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i],20,-373897302);
    a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);
    a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);
    a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);
    a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);
    a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);
    a=md5ii(a,b,c,d,x[i],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);
    a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);
    a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);
    a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
  }
  function hex(n) { let s=''; for(let j=0;j<4;j++) s+=('0'+((n>>>(j*8+4))&0xf).toString(16)).slice(-1)+('0'+((n>>>(j*8))&0xf).toString(16)).slice(-1); return s; }
  return hex(a)+hex(b)+hex(c)+hex(d);
}

function gravatarUrl(email, size) {
  size = size || 80;
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  const hash = _md5(clean);
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}

function renderSenderAvatar(emailAddr, fromName, size, extraClass) {
  size = size || 26;
  extraClass = extraClass || 'email-avatar';
  const initialsStr = initials(fromName || emailAddr);
  const color = avatarColor(emailAddr || fromName || '');
  const photoUrl = gravatarUrl(emailAddr, size * 3);
  return `<div class="${extraClass} email-avatar-photo" style="width:${size}px;height:${size}px;">
    <img src="${photoUrl}" alt="" loading="lazy"
         onerror="this.closest('.email-avatar-photo').classList.add('email-avatar-fallback');this.remove();">
    <span class="email-avatar-initials" style="background:${color};">${escHtml(initialsStr)}</span>
  </div>`;
}

// ── Company logo helpers ─────────────────────────────────────────────────────

function companyLogoUrl(company) {
  if (!company) return null;
  const entry = (savedCompaniesCache || []).find(c => c.company === company);
  let domain = null;
  if (entry && entry.companyWebsite) {
    try { domain = new URL(entry.companyWebsite).hostname.replace(/^www\./, ''); } catch (e) {}
  }
  if (domain) return `https://logo.clearbit.com/${domain}`;
  // Fallback: Google favicon service
  const guess = String(company).toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(guess)}&sz=64`;
}

function renderSidebarCompanyLogo(company) {
  const logoUrl = companyLogoUrl(company);
  const color = companyColor(company);
  const initialsStr = initials(company);
  return `<div class="sb-item-logo sb-item-logo-wrap">
    <img src="${logoUrl}" alt="" loading="lazy"
         onerror="this.closest('.sb-item-logo').classList.add('sb-logo-fallback');this.remove();">
    <span class="sb-item-logo-initials" style="background:${color};">${escHtml(initialsStr)}</span>
  </div>`;
}

function renderCompanyTag(company) {
  if (!company) return '';
  const logoUrl = companyLogoUrl(company);
  return `<span class="email-company-tag">
    <img class="email-company-tag-logo" src="${logoUrl}" alt="" loading="lazy"
         onerror="this.remove();">
    ${escHtml(company)}
  </span>`;
}

// ── Email body parser — strip Gmail artifacts ─────────────────────────────────

function renderEmailBody(raw) {
  if (!raw) return '(no body)';
  // Strip HTML tags if present (keep text content)
  let s = raw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  // Normalize Gmail bullet markers
  s = s.replace(/^\s*[·o*]\s+/gm, '• ');
  // Collapse excessive blank lines
  s = s.replace(/\n{3,}/g, '\n\n');
  return escHtml(s.trim());
}

// ── Data Loading ────────────────────────────────────────────────────────────

chrome.storage.local.get(['savedCompanies', 'lastInboxViewedAt', 'gmailUserEmail', 'opportunityStages', 'customStages', 'readEmailKeys'], data => {
  gmailUserEmail = (data.gmailUserEmail || '').toLowerCase();
  allCompanies = data.savedCompanies || [];
  savedCompaniesCache = allCompanies;
  const stages = data.opportunityStages || data.customStages || [];
  configuredStages = stages.map(s => ({ key: s.key, label: s.label || s.name || s.key }));
  readEmailKeys = new Set(Array.isArray(data.readEmailKeys) ? data.readEmailKeys : []);
  const isFirstOpen = data.lastInboxViewedAt === undefined || data.lastInboxViewedAt === null;
  lastViewedAt = isFirstOpen ? Date.now() : data.lastInboxViewedAt;
  chrome.storage.local.set({ lastInboxViewedAt: Date.now() });
  buildEmailIndex();
  if (gmailUserEmail) refreshInboxEmails();
  init();
});

// Live-refresh when pipeline config or email data changes elsewhere
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.opportunityStages || changes.customStages) {
    const v = (changes.opportunityStages?.newValue) || (changes.customStages?.newValue) || [];
    configuredStages = v.map(s => ({ key: s.key, label: s.label || s.name || s.key }));
    if (typeof renderEmailList === 'function') renderEmailList();
  }
  if (changes.savedCompanies?.newValue) {
    allCompanies = changes.savedCompanies.newValue;
    savedCompaniesCache = allCompanies;
    buildEmailIndex();
    buildSidebar();
    renderEmailList();
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
      if (!email.subject && !email.body && !email.snippet) return;
      if (blockedSenders.size) {
        const fromAddr = (email.from || '').toLowerCase();
        for (const blocked of blockedSenders) {
          if (fromAddr.includes(blocked)) return;
        }
      }
      const key = emailKey(email);
      const ts = email.date ? new Date(email.date).getTime() : 0;
      const isInReadSet = readEmailKeys.has(key);
      const newerThanLastView = ts > lastViewedAt;
      const isUnread = newerThanLastView && !isInReadSet;
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
  chrome.storage.local.set({ readEmailKeys: [...readEmailKeys] });
}

// ── Initialization ──────────────────────────────────────────────────────────

function init() {
  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    coopNavigate(chrome.runtime.getURL('saved.html'));
  });

  // Stats
  updateStats();

  // Refresh button
  document.getElementById('inbox-refresh-btn')?.addEventListener('click', () => refreshInboxEmails());

  // Search — now in list head
  const searchEl = document.getElementById('inbox-search');
  let searchTimeout;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = searchEl.value.trim().toLowerCase();
      renderEmailList();
    }, 200);
  });

  // Stage filter dropdown
  initFilterDropdown();

  // Direction tabs
  document.querySelectorAll('.list-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      directionFilter = tab.dataset.tab;
      document.querySelectorAll('.list-tab').forEach(t => t.classList.toggle('active', t === tab));
      selectedEmailIdx = -1;
      renderEmailList();
    });
  });

  // Mark all read
  document.getElementById('list-mark-all')?.addEventListener('click', () => {
    const visible = getFilteredEmails();
    visible.forEach(e => markEmailRead(e));
    renderEmailList();
    buildSidebar();
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); navigateEmails(1); }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); navigateEmails(-1); }
    if (e.key === 'Escape') { selectedEmailIdx = -1; renderDetail(null); highlightRow(); }
  });

  buildSidebar();
  renderEmailList();
}

function updateStats() {
  const companies = [...new Set(allEmails.map(e => e._companyId))];
  document.getElementById('inbox-stats').textContent = `${allEmails.length} emails · ${companies.length} companies`;
}

// ── Stage filter dropdown (port of #232 pattern) ────────────────────────────

function initFilterDropdown() {
  const btn = document.getElementById('list-filter-btn');
  const menu = document.getElementById('list-filter-menu');
  const label = document.getElementById('list-filter-label');
  if (!btn || !menu) return;

  const buildMenuItems = () => {
    const stages = getStages();
    const options = [
      { key: 'active', label: 'Active' },
      { key: 'all', label: 'All' },
      ...stages,
    ];
    menu.innerHTML = options.map(opt => `
      <div class="list-filter-opt ${stageFilter === opt.key ? 'active' : ''}" data-stage="${escHtml(opt.key)}">
        ${escHtml(opt.label)}
      </div>
    `).join('');
    menu.querySelectorAll('.list-filter-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        stageFilter = opt.dataset.stage;
        label.textContent = opt.textContent.trim();
        btn.classList.toggle('filtered', stageFilter !== 'active');
        menu.classList.remove('open');
        btn.classList.remove('open');
        selectedEmailIdx = -1;
        renderEmailList();
        buildSidebar();
      });
    });
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    buildMenuItems();
    const open = menu.classList.toggle('open');
    btn.classList.toggle('open', open);
    if (open) {
      const r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.left = r.left + 'px';
    }
  });

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('open');
      btn.classList.remove('open');
    }
  });
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

function buildSidebar() {
  const el = document.getElementById('inbox-sidebar');

  // Compute per-company counts from all emails (not stage-filtered for sidebar grouping)
  const companyCounts = {};
  const companyUnread = {};

  allEmails.forEach(e => {
    companyCounts[e._companyId] = (companyCounts[e._companyId] || 0) + 1;
    if (e._unread) companyUnread[e._companyId] = (companyUnread[e._companyId] || 0) + 1;
  });

  // Group companies into buckets by stage
  const buckets = { active: [], monitoring: [], closed: [] };

  Object.keys(companyCounts).forEach(id => {
    const info = companyMap[id];
    if (!info) return;
    const stage = info.stage || '';
    const unreadCount = companyUnread[id] || 0;
    const emailCount = companyCounts[id] || 0;
    const item = { id, name: info.name, stage, unreadCount, emailCount };
    if (ACTIVE_STAGES.includes(stage)) buckets.active.push(item);
    else if (MONITORING_STAGES.includes(stage)) buckets.monitoring.push(item);
    else buckets.closed.push(item);
  });

  // Sort each bucket alphabetically
  Object.values(buckets).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));

  const totalUnread = Object.values(companyUnread).reduce((n, c) => n + c, 0);

  let html = `<div class="sb-all ${selectedCompanyId === null ? 'active' : ''}" id="sb-all-btn">
    <span>All Mail</span>
    ${totalUnread > 0 ? `<span class="unread-count">${totalUnread > 99 ? '99+' : totalUnread}</span>` : ''}
  </div>`;

  html += renderSbSection('Active', buckets.active, 'active');
  html += renderSbSection('Monitoring', buckets.monitoring, 'monitoring');
  html += renderSbSection('Closed', buckets.closed, 'closed');

  el.innerHTML = html;

  // Bind: All Mail
  el.querySelector('#sb-all-btn')?.addEventListener('click', () => {
    selectedCompanyId = null;
    highlightedCompanyId = null;
    selectedEmailIdx = -1;
    buildSidebar();
    renderEmailList();
    renderDetail(null);
  });

  // Bind: section heads (collapse/expand)
  el.querySelectorAll('.sb-section-head').forEach(head => {
    head.addEventListener('click', () => {
      const bucket = head.dataset.bucket;
      sidebarCollapsed[bucket] = !sidebarCollapsed[bucket];
      buildSidebar();
    });
  });

  // Bind: company rows
  el.querySelectorAll('.sb-item').forEach(row => {
    row.addEventListener('click', () => {
      selectedCompanyId = row.dataset.companyId;
      highlightedCompanyId = null;
      selectedEmailIdx = -1;
      buildSidebar();
      renderEmailList();
      renderDetail(null);
    });
  });
}

function renderSbSection(label, items, bucketId) {
  const collapsed = sidebarCollapsed[bucketId];
  const rowsHtml = collapsed ? '' : items.map(c => {
    const isActive = selectedCompanyId === c.id;
    const isHighlighted = selectedCompanyId === null && highlightedCompanyId === c.id;
    return `<div class="sb-item ${c.unreadCount > 0 ? 'unread' : ''} ${isActive || isHighlighted ? 'active' : ''}" data-company-id="${escHtml(c.id)}">
      <span class="unread-dot"></span>
      ${renderSidebarCompanyLogo(c.name)}
      <span class="sb-item-name">${escHtml(c.name)}</span>
      <span class="sb-item-count">${c.emailCount}</span>
    </div>`;
  }).join('');

  return `<div class="sb-section">
    <div class="sb-section-head" data-bucket="${bucketId}">
      <span>${label} · ${items.length}</span>
      <span class="caret">${collapsed ? '▸' : '▾'}</span>
    </div>
    ${rowsHtml}
  </div>`;
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
  if (configuredStages.length) {
    return configuredStages.map(s => ({ key: s.key, label: s.label }));
  }
  const present = new Set();
  allEmails.forEach(e => { if (e._stage) present.add(e._stage); });
  return [...present].map(k => ({ key: k, label: k.replace(/_/g, ' ') }));
}

function renderEmailList() {
  const listBodyEl = document.getElementById('inbox-list-body');
  const emails = getFilteredEmails();
  const companyName = selectedCompanyId ? (companyMap[selectedCompanyId]?.name || 'Unknown') : 'All Mail';
  const unreadCount = emails.filter(e => e._unread).length;

  // Update list head fields
  document.getElementById('list-title').textContent = companyName;
  document.getElementById('list-count').textContent = `${emails.length}${unreadCount > 0 ? ` · ${unreadCount} unread` : ''}`;

  if (!emails.length) {
    listBodyEl.innerHTML = `<div style="text-align:center;padding:60px 24px;color:#A09A94;">
      <div style="font-size:36px;opacity:0.25;margin-bottom:10px;">📭</div>
      <div style="font-size:14px;font-weight:600;color:#6B6560;margin-bottom:4px;">${searchQuery ? 'No matches' : 'Nothing here yet'}</div>
      <div style="font-size:12px;line-height:1.5;">${searchQuery ? `No emails matching "${escHtml(searchQuery)}"` : 'Try adjusting filters or selecting another company.'}</div>
    </div>`;
    return;
  }

  let html = '';
  let lastGroup = null;
  emails.slice(0, 300).forEach((e, i) => {
    const grp = dateGroup(e._ts);
    if (grp !== lastGroup) {
      html += `<div class="date-group">${escHtml(grp)}</div>`;
      lastGroup = grp;
    }
    html += renderEmailRow(e, i);
  });

  listBodyEl.innerHTML = html;

  listBodyEl.querySelectorAll('.email-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      selectedEmailIdx = idx;
      const email = getFilteredEmails()[idx];
      if (email) {
        markEmailRead(email);
        highlightedCompanyId = email._companyId || null;
        renderDetail(email);
        renderEmailList();
        buildSidebar();
        // Scroll highlighted company into view in sidebar
        if (highlightedCompanyId) {
          const sidebarItem = document.querySelector(`.sb-item[data-company-id="${highlightedCompanyId}"]`);
          if (sidebarItem) sidebarItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      highlightRow();
    });
  });
}

function renderEmailRow(e, i) {
  const isSelected = i === selectedEmailIdx;
  const showCompany = !selectedCompanyId;
  const fromName = parseFromName(e.from);
  const fromEmail = parseFromEmail(e.from);
  const companyTag = showCompany ? renderCompanyTag(e._company) : '';
  const readClass = e._unread ? 'unread' : 'read';

  return `<div class="email-row ${readClass} ${isSelected ? 'active' : ''}" data-idx="${i}">
    ${renderSenderAvatar(fromEmail, fromName, 26, 'email-avatar')}
    <div class="email-body">
      <div class="email-row-head">
        <span class="email-from">${escHtml(fromName)}</span>
        <span class="email-sep">·</span>
        <span class="email-subject">${escHtml(e.subject || '(no subject)')}</span>
      </div>
      <div class="email-row-sub">
        <span class="email-preview">${escHtml(e.snippet || '')}</span>
        ${companyTag}
      </div>
    </div>
    <div class="email-time">${formatDate(e.date)}</div>
  </div>`;
}

function highlightRow() {
  document.querySelectorAll('#inbox-list-body .email-row').forEach((row, i) => {
    row.classList.toggle('active', i === selectedEmailIdx);
  });
}

function navigateEmails(dir) {
  const emails = getFilteredEmails();
  if (!emails.length) return;
  selectedEmailIdx = Math.max(0, Math.min(emails.length - 1, selectedEmailIdx + dir));
  highlightRow();
  renderDetail(emails[selectedEmailIdx]);
  const row = document.querySelector(`#inbox-list-body .email-row[data-idx="${selectedEmailIdx}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

// ── Email Detail ────────────────────────────────────────────────────────────

function stageLabel(stageKey) {
  const found = configuredStages.find(s => s.key === stageKey);
  return found ? found.label : stageKey.replace(/_/g, ' ');
}

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

  const fromName = parseFromName(email.from);
  const fromEmail = parseFromEmail(email.from);
  const companyHref = email._companyId ? chrome.runtime.getURL('company.html') + '?id=' + email._companyId : null;
  const gmailUrl = email.threadId
    ? `https://mail.google.com/mail/u/0/#inbox/${email.threadId}`
    : `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(email.subject || '')}`;

  // Find thread siblings
  const threadEmails = email.threadId
    ? allEmails.filter(e => e.threadId === email.threadId).sort((a, b) => a._ts - b._ts)
    : [email];

  // Build detail HTML
  const companyTagHtml = email._company ? `<span class="detail-tag company">
    <img class="detail-tag-logo" src="${escHtml(companyLogoUrl(email._company) || '')}" alt="" loading="lazy" onerror="this.remove();">
    ${escHtml(email._company)}
  </span>` : '';
  const stageTagHtml = email._stage ? `<span class="detail-tag stage">${escHtml(stageLabel(email._stage))}</span>` : '';
  const tagsRowHtml = (companyTagHtml || stageTagHtml) ? `<div class="detail-tags-row">${companyTagHtml}${stageTagHtml}</div>` : '';

  let bodyHtml = '';
  if (threadEmails.length > 1) {
    bodyHtml = `<div class="thread-count-bar">${threadEmails.length} messages in thread</div>`;
    threadEmails.forEach((te, i) => {
      const isLast = i === threadEmails.length - 1;
      const body = renderEmailBody(stripQuotedContent(te.body || te.snippet || ''));
      const teName = parseFromName(te.from);
      const teEmail = parseFromEmail(te.from);
      const teAvatar = renderSenderAvatar(teEmail, teName, 28, 'thread-msg-avatar');
      bodyHtml += `<div class="thread-msg ${isLast ? '' : 'collapsed'}">
        <div class="thread-msg-header">
          ${teAvatar}
          <span class="thread-msg-from">${escHtml(teName)}</span>
          <span class="thread-msg-date">${formatDate(te.date)}</span>
          <span class="thread-msg-chevron">▾</span>
        </div>
        <div class="thread-msg-body">${body}</div>
      </div>`;
    });
  } else {
    const body = renderEmailBody(stripQuotedContent(email.body || email.snippet || ''));
    bodyHtml = `<div class="detail-body">${body}</div>`;
  }

  detailEl.innerHTML = `<div class="detail-scroll">
    <div class="detail-head">
      <div class="detail-subject">${escHtml(email.subject || '(no subject)')}</div>
      <div class="detail-from-row">
        ${renderSenderAvatar(fromEmail, fromName, 36, 'detail-avatar')}
        <div class="detail-from-body">
          <div class="detail-from-name">${escHtml(fromName)}</div>
          <div class="detail-from-meta">${escHtml(fromEmail)}${email.to ? ` → ${escHtml(email.to)}` : ''}</div>
        </div>
        <div class="detail-date">${formatFullDate(email.date)}</div>
      </div>
      ${tagsRowHtml}
    </div>
    ${bodyHtml}
    <div class="detail-actions">
      <button class="action-btn danger" id="detail-remove-btn" title="Remove all emails from this sender">Remove sender</button>
      <button class="action-btn" id="detail-unread-btn">${email._unread ? 'Mark read' : 'Mark unread'}</button>
      ${companyHref ? `<a class="action-btn" href="${companyHref}" target="_blank">View company</a>` : ''}
      <a class="action-btn" href="${escHtml(gmailUrl)}" target="_blank">Open in Gmail ↗</a>
      <button class="action-btn primary" id="detail-draft-btn">Draft reply in Coop</button>
    </div>
  </div>`;

  detailEl.querySelector('.detail-scroll').scrollTop = 0;

  // Thread collapse/expand
  detailEl.querySelectorAll('.thread-msg.collapsed .thread-msg-header').forEach(header => {
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => header.closest('.thread-msg').classList.toggle('collapsed'));
  });

  // Mark read/unread
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

  // Remove sender
  detailEl.querySelector('#detail-remove-btn')?.addEventListener('click', () => deleteEmail(email));

  // Draft reply in Coop — navigate to company page with chat focused
  detailEl.querySelector('#detail-draft-btn')?.addEventListener('click', () => {
    if (companyHref) {
      // Open company page; drafting happens in Coop chat there
      window.open(companyHref, '_blank');
    }
  });
}

// ── Delete / remove sender ──────────────────────────────────────────────────

function deleteEmail(email) {
  const key = emailKey(email);
  const entry = entryMap[email._companyId];

  const fromAddrMatch = (email.from || '').match(/<([^>]+)>/);
  const senderAddr = (fromAddrMatch ? fromAddrMatch[1] : email.from || '').toLowerCase().trim();

  if (entry && senderAddr) {
    if (!entry.blockedEmailSenders) entry.blockedEmailSenders = [];
    if (!entry.blockedEmailSenders.includes(senderAddr)) {
      entry.blockedEmailSenders.push(senderAddr);
    }
  }

  if (entry?.cachedEmails) {
    entry.cachedEmails = entry.cachedEmails.filter(e => {
      const eAddr = ((e.from || '').match(/<([^>]+)>/) || [])[1] || e.from || '';
      return eAddr.toLowerCase().trim() !== senderAddr;
    });
  }

  allEmails.splice(0, allEmails.length, ...allEmails.filter(e => {
    if (e._companyId !== email._companyId) return true;
    const eAddr = ((e.from || '').match(/<([^>]+)>/) || [])[1] || e.from || '';
    return eAddr.toLowerCase().trim() !== senderAddr;
  }));

  readEmailKeys.delete(key);

  if (entry) {
    const updated = allCompanies.map(c => c.id === entry.id ? entry : c);
    chrome.storage.local.set({ savedCompanies: updated, readEmailKeys: [...readEmailKeys] });
  }
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

// ── Private provider domain list ────────────────────────────────────────────

const _PUBLIC_PROVIDER_RE = /^(gmail|yahoo|outlook|hotmail|icloud|aol|proton)\./i;

function _deriveDomain(entry) {
  if (entry.companyWebsite) {
    return entry.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  }
  const contactDomain = (entry.knownContacts || [])
    .map(c => (c.email || '').split('@')[1])
    .filter(d => d && !_PUBLIC_PROVIDER_RE.test(d))[0];
  if (contactDomain) return contactDomain;
  const counts = {};
  (entry.cachedEmails || []).forEach(e => {
    const m = (e.from || '').match(/<([^>]+)>/);
    const addr = (m ? m[1] : e.from || '').toLowerCase().trim();
    const d = addr.split('@')[1];
    if (d && !_PUBLIC_PROVIDER_RE.test(d)) counts[d] = (counts[d] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || '';
}

// ── Gmail refresh ────────────────────────────────────────────────────────────

async function refreshInboxEmails() {
  const btn = document.getElementById('inbox-refresh-btn');
  const labelEl = btn?.querySelector('.refresh-label');

  let companiesToRefresh = allCompanies.filter(entry => _deriveDomain(entry));
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
  console.log('[Inbox] Auto-refresh firing for', total, 'companies');

  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  let done = 0;

  const fetchOne = (entry) => new Promise(resolve => {
    const domain = _deriveDomain(entry);
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

  const CONCURRENCY = 4;
  for (let i = 0; i < companiesToRefresh.length; i += CONCURRENCY) {
    await Promise.all(companiesToRefresh.slice(i, i + CONCURRENCY).map(fetchOne));
  }

  chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
    buildEmailIndex();
    buildSidebar();
    renderEmailList();
    updateStats();
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
    if (labelEl) labelEl.textContent = 'Refresh';
  });
}

// ── Strip quoted content ─────────────────────────────────────────────────────

function stripQuotedContent(text) {
  if (!text) return '';
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
