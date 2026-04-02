const params = new URLSearchParams(window.location.search);
const entryId = params.get('id');
let entry = null;
let allTags = [];
let stages = [];

const DEFAULT_STAGES = [
  { key: 'needs_review',    label: 'AI Scoring Queue',           color: '#64748b' },
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

function parseLocalDate(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00').getTime();
  const ms = new Date(s).getTime();
  return isNaN(ms) ? 0 : ms;
}

function truncLabel(str, max = 40) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

function computeLastActivity(entry) {
  const candidates = [];

  // A. Emails
  const BULK_RE = /noreply|no-reply|notifications?@|mailer-daemon|newsletter|digest@|linkedin\.com|updates?@|marketing@/i;
  const parseSender = (fromStr) => {
    if (!fromStr) return '';
    const before = fromStr.includes('<') ? fromStr.split('<')[0].trim() : fromStr.trim();
    const first = before.split(/\s+/)[0];
    return (first && !first.includes('@') && first.length > 1) ? first : '';
  };
  (entry.cachedEmails || []).forEach(thread => {
    const fromRaw = thread.from || (thread.messages?.[0]?.from) || '';
    if (BULK_RE.test(fromRaw)) return;

    let ts = 0, senderName = '';
    if (thread.messages && thread.messages.length) {
      const lastMsg = thread.messages[thread.messages.length - 1];
      ts = new Date(lastMsg.date).getTime();
      senderName = parseSender(lastMsg.from);
      if (!senderName && thread.from) senderName = parseSender(thread.from);
      if (!senderName && thread.messages[0]?.from) senderName = parseSender(thread.messages[0].from);
    }
    if (!senderName && thread.from) senderName = parseSender(thread.from);
    if (!ts || isNaN(ts)) ts = thread.date ? new Date(thread.date).getTime() : 0;
    if (!ts || isNaN(ts)) ts = thread.internalDate ? parseInt(thread.internalDate) : 0;
    if (!ts || isNaN(ts)) return;
    const label = senderName
      ? truncLabel('Email from ' + senderName)
      : truncLabel('Email: ' + (thread.subject || 'No subject'));
    candidates.push({ timestamp: ts, label, type: 'email' });
  });

  // B. Meetings (Granola)
  (entry.cachedMeetings || []).forEach(m => {
    let ts = m.createdAt ? parseLocalDate(m.createdAt) : 0;
    if (!ts) ts = parseLocalDate(m.date);
    if (!ts) return;
    candidates.push({ timestamp: ts, label: truncLabel('Call: ' + (m.title || 'Meeting')), type: 'meeting' });
  });

  // C. Calendar events (past only)
  const now = Date.now();
  (entry.cachedCalendarEvents || []).forEach(evt => {
    const ts = new Date(evt.start).getTime();
    if (!ts || isNaN(ts) || ts > now) return;
    candidates.push({ timestamp: ts, label: truncLabel('Meeting: ' + (evt.summary || evt.title || 'Event')), type: 'calendar' });
  });

  // D. Activity log
  (entry.activityLog || []).forEach(log => {
    const ts = parseLocalDate(log.date);
    if (!ts) return;
    const typeLabels = {
      linkedin_dm: 'LinkedIn DM',
      phone_call: 'Phone call',
      coffee_chat: 'Coffee chat',
      text: 'Text',
      referral: 'Referral',
      applied: 'Applied',
      other: ''
    };
    const prefix = typeLabels[log.type] || '';
    const label = log.type === 'applied' ? 'Applied'
      : prefix ? truncLabel(prefix + ': ' + (log.note || ''))
      : truncLabel(log.note || 'Activity');
    candidates.push({ timestamp: ts, label, type: 'activity_log' });
  });

  // E. Applied date (editable field — NOT stageTimestamps)
  if (entry.appliedDate && entry.appliedDate > 0) {
    candidates.push({ timestamp: entry.appliedDate, label: 'Applied', type: 'applied' });
  }

  if (!candidates.length) return { timestamp: 0, label: null };
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return candidates[0];
}

function parseEmailContactLocal(fromStr) {
  if (!fromStr) return null;
  const match = fromStr.match(/^(.+?)\s*<([^>]+)>/);
  if (match) {
    const name = match[1].replace(/"/g, '').trim();
    const email = match[2].trim().toLowerCase();
    if (name && email && !/noreply|no-reply/i.test(email)) return { name, email };
  }
  const plain = fromStr.trim().toLowerCase();
  if (plain.includes('@') && !/noreply/i.test(plain)) {
    return { name: plain.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), email: plain };
  }
  return null;
}

function mergeExtractedContacts(extracted) {
  const existing = entry.knownContacts || [];
  const existingEmails = new Set(existing.map(c => (c.email || '').toLowerCase()).filter(Boolean));

  // Get the user's own email to exclude
  const userEmail = (entry.gmailUserEmail || '').toLowerCase();

  // Get the company domain to determine auto-add vs suggest
  const companyDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

  let added = 0;
  for (const contact of extracted) {
    const email = (contact.email || '').toLowerCase();
    if (!email || existingEmails.has(email)) continue;
    if (email === userEmail) continue;

    // Skip generic/no-reply addresses
    if (/noreply|no-reply|mailer-daemon|postmaster|notifications|support@|info@|hello@|team@/i.test(email)) continue;

    // Auto-add: email matches company domain, or matches a leader name
    const emailDomain = email.split('@')[1] || '';
    const isCompanyDomain = companyDomain && emailDomain.includes(companyDomain.split('.')[0]);
    const matchesLeader = (entry.leaders || []).some(l =>
      l.name && contact.name && l.name.toLowerCase().includes(contact.name.split(' ')[0].toLowerCase())
    );

    if (isCompanyDomain || matchesLeader) {
      existing.push({
        name: contact.name,
        email: contact.email,
        source: contact.source || 'auto-extracted',
        addedAt: Date.now(),
      });
      existingEmails.add(email);
      added++;
    }
  }

  if (added > 0) {
    saveEntry({ knownContacts: existing });
  }
}

const OPP_TAG_PALETTE = [
  { border: '#6366f1', color: '#4338ca', bg: 'rgba(99,102,241,0.15)' },
  { border: '#10b981', color: '#047857', bg: 'rgba(16,185,129,0.15)' },
  { border: '#f97316', color: '#c2410c', bg: 'rgba(249,115,22,0.15)' },
  { border: '#ec4899', color: '#be185d', bg: 'rgba(236,72,153,0.15)' },
  { border: '#0ea5e9', color: '#0369a1', bg: 'rgba(14,165,233,0.15)' },
  { border: '#a855f7', color: '#7e22ce', bg: 'rgba(168,85,247,0.15)' },
  { border: '#22c55e', color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  { border: '#eab308', color: '#a16207', bg: 'rgba(234,179,8,0.15)' },
  { border: '#ef4444', color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  { border: '#14b8a6', color: '#0f766e', bg: 'rgba(20,184,166,0.15)' },
];
let _oppCustomTagColors = {};
chrome.storage.local.get(['tagColors'], d => { _oppCustomTagColors = d.tagColors || {}; });

const OPP_SEMANTIC_TAG_COLORS = {
  'application rejected': 8, 'rejected': 8, "didn't apply": 8,
  'job posted': 2, 'linkedin easy apply': 4,
  'vc-backed': 1, 'bootstrapped': 6, 'founding team': 5,
  'referral': 9, 'recruiter': 3, '***action required***': 8,
};

function tagColor(tag) {
  if (_oppCustomTagColors[tag] !== undefined) {
    return OPP_TAG_PALETTE[_oppCustomTagColors[tag] % OPP_TAG_PALETTE.length];
  }
  const semantic = OPP_SEMANTIC_TAG_COLORS[tag.toLowerCase()];
  if (semantic !== undefined) return OPP_TAG_PALETTE[semantic];
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  return OPP_TAG_PALETTE[Math.abs(hash) % OPP_TAG_PALETTE.length];
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

    // Compute last activity
    const computed = computeLastActivity(entry);
    if (computed.timestamp > 0) {
      // Display it — the rendering code will pick it up
    }

    // Extract contacts from cached emails on load
    if (entry.cachedEmails?.length) {
      const contacts = [];
      for (const thread of entry.cachedEmails) {
        const parsed = parseEmailContactLocal(thread.from);
        if (parsed) contacts.push({ ...parsed, source: 'email' });
      }
      if (contacts.length) mergeExtractedContacts(contacts);
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
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('preferences.html')}" target="_blank">⚙ Career OS</a>
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

    ${(() => {
      const act = computeLastActivity(e);
      if (!act.label) return '';
      const d = new Date(act.timestamp);
      return `<div class="sb-section">
        <div class="sb-title">Last Activity</div>
        <div class="sb-stat">
          <span class="sb-stat-value" style="font-weight:600">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div class="sb-stat">
          <span class="sb-stat-label">${act.label}</span>
        </div>
      </div>`;
    })()}

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
      <div id="sb-notes-container" data-editing="0"></div>
    </div>
  `;

  renderSidebarNotes();

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

function renderSidebarNotes() {
  const container = document.getElementById('sb-notes-container');
  if (!container) return;

  // Convert old plain text / markdown to HTML
  let htmlContent = entry.notes || '';
  if (htmlContent && !/<[a-z][\s>]/i.test(htmlContent)) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      htmlContent = marked.parse(htmlContent);
    } else {
      htmlContent = htmlContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    }
  }

  container.innerHTML = `<div class="sb-notes-editable" id="sb-notes-editable" contenteditable="true" style="font-size:13px;color:#33475b;line-height:1.6;min-height:60px;padding:10px 12px;border:1px solid #dfe3eb;border-radius:8px;background:#f5f8fa;outline:none">${htmlContent || ''}</div>`;

  const editable = container.querySelector('#sb-notes-editable');

  // Placeholder
  function updatePlaceholder() {
    const empty = !editable.textContent.trim();
    editable.dataset.empty = empty ? '1' : '0';
    if (empty && !editable.querySelector('*')) editable.style.color = '#b0c1d4';
    else editable.style.color = '#33475b';
  }
  if (!editable.textContent.trim()) {
    editable.innerHTML = '<p style="color:#b0c1d4;font-style:italic">Add notes…</p>';
    editable.addEventListener('focus', function clearPlaceholder() {
      if (editable.dataset.empty === '1') { editable.innerHTML = ''; editable.style.color = '#33475b'; }
      editable.removeEventListener('focus', clearPlaceholder);
    }, { once: true });
  }
  editable.addEventListener('input', updatePlaceholder);
  updatePlaceholder();

  // Auto-save
  let _sbSaveTimer = null;
  function saveSbNotes() {
    const html = editable.innerHTML;
    if (html !== (entry.notes || '')) saveEntry({ notes: html });
  }
  editable.addEventListener('blur', () => { clearTimeout(_sbSaveTimer); saveSbNotes(); });
  editable.addEventListener('input', () => { clearTimeout(_sbSaveTimer); _sbSaveTimer = setTimeout(saveSbNotes, 3000); });

  // Ctrl+B / Ctrl+I
  editable.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); }
  });

  editable.addEventListener('focus', () => { editable.style.borderColor = '#7c98b6'; });
  editable.addEventListener('blur', () => { editable.style.borderColor = '#dfe3eb'; });
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

    // Cache emails and extract contacts
    saveEntry({ cachedEmails: result.emails, cachedEmailsAt: Date.now() });
    if (result.extractedContacts?.length) mergeExtractedContacts(result.extractedContacts);
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
