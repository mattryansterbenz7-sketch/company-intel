const params = new URLSearchParams(window.location.search);
const entryId = params.get('id');
let entry = null;
let _cachedUserFirstName = '';
chrome.storage.sync.get(['prefs'], d => { const n = d.prefs?.name || d.prefs?.fullName || ''; _cachedUserFirstName = n.split(/\s/)[0]; });

// escapeHtml — provided by ui-utils.js
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
  { id: 'chat',          title: 'Coop',                  full: true  },
];

let panelOrder      = JSON.parse(localStorage.getItem('ci_panel_order')     || 'null') || PANEL_DEFS.map(p => p.id);
let collapsedPanels = JSON.parse(localStorage.getItem('ci_panel_collapsed') || '{}');

// ── Utilities ─────────────────────────────────────────────────────────────────
// parseLocalDate, truncLabel — provided by ui-utils.js

function computeLastActivity(entry) {
  const candidates = [];

  // A. Emails
  const companyDomain = (entry.companyWebsite || '')
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  const extractEmailDomain = (fromStr) => {
    if (!fromStr) return '';
    const m = fromStr.match(/<([^>]+)>/) || [null, fromStr];
    const addr = (m[1] || '').trim().toLowerCase();
    const at = addr.lastIndexOf('@');
    return at >= 0 ? addr.slice(at + 1) : '';
  };
  const parseSender = (fromStr) => {
    if (!fromStr) return '';
    const before = fromStr.includes('<') ? fromStr.split('<')[0].trim() : fromStr.trim();
    const first = before.split(/\s+/)[0];
    return (first && !first.includes('@') && first.length > 1) ? first : '';
  };
  (entry.cachedEmails || []).forEach(thread => {
    const fromRaw = thread.from || (thread.messages?.[0]?.from) || '';
    // Only count emails from the company's own domain — filters bulk/promo senders
    // (RepVue, LinkedIn, etc.) and keeps legitimate no-reply@company.com.
    if (!companyDomain) return;
    const senderDomain = extractEmailDomain(fromRaw);
    if (!senderDomain || (senderDomain !== companyDomain && !senderDomain.endsWith('.' + companyDomain))) return;

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

  // F. Stage transitions — entering a pipeline stage is itself activity
  if (entry.stageTimestamps) {
    const stageLabel = (key) => {
      const s = (typeof stages !== 'undefined' && stages) ? stages.find(x => x.key === key) : null;
      return s ? s.label : key;
    };
    Object.entries(entry.stageTimestamps).forEach(([key, ts]) => {
      if (!ts || typeof ts !== 'number') return;
      candidates.push({ timestamp: ts, label: truncLabel('Stage: ' + stageLabel(key)), type: 'stage' });
    });
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
  const blocked = new Set((entry.removedContacts || []).map(e => e.toLowerCase()));

  // Get the user's own email to exclude
  const userEmail = (entry.gmailUserEmail || '').toLowerCase();

  // Get the company domain to determine auto-add vs suggest
  const companyDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

  let added = 0;
  for (const contact of extracted) {
    const email = (contact.email || '').toLowerCase();
    if (!email || existingEmails.has(email)) continue;
    if (email === userEmail) continue;
    if (blocked.has(email)) continue;

    // Skip generic/no-reply addresses
    if (/noreply|no-reply|mailer-daemon|postmaster|notifications|support@|info@|hello@|team@/i.test(email)) continue;

    // Auto-add all non-generic contacts — emails were fetched specifically for this company
    const newContact = {
      name: contact.name,
      email: contact.email,
      source: contact.source || 'auto-extracted',
      addedAt: Date.now(),
    };
    if (contact.phone) newContact.phone = contact.phone;
    if (contact.title) newContact.title = contact.title;
    if (contact.linkedinUrl) newContact.linkedinUrl = contact.linkedinUrl;
    existing.push(newContact);
    existingEmails.add(email);
    added++;
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

// scoreToVerdict, stageTypeVisual — provided by ui-utils.js

// stageColor: returns the type-driven dot color for a given stage key.
function stageColor(key) {
  const s = stages.find(st => st.key === key) || stages[0] || DEFAULT_STAGES[0];
  if (s && s.stageType && typeof stageTypeVisual === 'function') {
    return stageTypeVisual(s.stageType).dotColor;
  }
  return s ? s.color : '#64748b';
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

// Delegated image-error handler — replaces all inline onerror attributes (CSP compliance).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const strategy = img.dataset.imgFallback;
  if (strategy === 'hide') img.style.display = 'none';
}, true);

// Delegated click handler — stops propagation on Granola links inside meeting cards.
document.addEventListener('click', (e) => {
  if (e.target.closest('.mtg-granola-link')) e.stopPropagation();
}, true);

function init() {
  chrome.storage.local.get(['savedCompanies', 'allTags', 'opportunityStages', 'customStages'], (data) => {
    allTags = data.allTags || [];
    const storedStages = data.opportunityStages || data.customStages;
    stages  = (storedStages && storedStages.length) ? storedStages : DEFAULT_STAGES;

    // Lazy-fill stageType for any stage still missing it (defensive against pre-migration data).
    // The canonical migration runs in saved.js on load; this is a safety net only.
    const OPP_TYPE_MAP = {
      needs_review: 'queue', want_to_apply: 'queue',
      applied: 'outreach', intro_requested: 'outreach',
      conversations: 'active', offer_stage: 'active', accepted: 'active',
      rejected: 'closed_lost',
    };
    stages.forEach(s => { if (!s.stageType) s.stageType = OPP_TYPE_MAP[s.key] || 'active'; });
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
    ? `<img class="hdr-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" data-img-fallback="hide">`
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
      style="border-color:${color}66;color:${color}">
      ${statusOptions}
    </select>
    <div class="hdr-stars" id="hdr-stars">${stars}</div>
    ${entry.url ? `<a class="hdr-ext-link" href="${safeUrl(entry.url)}" target="_blank">↗ Job Posting</a>` : ''}
    ${entry.jobUrl && /linkedin\.com\/jobs\/view\//i.test(entry.jobUrl)
      ? `<button class="hdr-rescrape-btn" id="hdr-rescrape-btn" title="Re-fetch all LinkedIn data (firmographics, skills, recruiter, etc.) and rescore">↺ Refresh LinkedIn data</button>`
      : ''}
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('preferences.html')}" target="_blank">⚙ My Profile</a>
  `;

  document.title = `${entry.company}${entry.jobTitle ? ' · ' + entry.jobTitle : ''} — Coop.ai`;

  document.getElementById('hdr-title').addEventListener('blur', e => {
    const val = e.target.value.trim();
    saveEntry({ jobTitle: val });
    document.title = `${entry.company}${val ? ' · ' + val : ''} — Coop.ai`;
  });

  document.getElementById('hdr-status').addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value);
    sel.style.borderColor = c + '66';
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

  const rescrapeBtn = document.getElementById('hdr-rescrape-btn');
  if (rescrapeBtn) {
    rescrapeBtn.addEventListener('click', () => {
      rescrapeBtn.disabled = true;
      rescrapeBtn.textContent = '↺ Opening LinkedIn tab…';
      chrome.runtime.sendMessage({ type: 'RESCRAPE_LINKEDIN_JOB', entryId: entry.id }, resp => {
        void chrome.runtime.lastError;
        if (resp?.error) {
          rescrapeBtn.disabled = false;
          rescrapeBtn.textContent = '↺ Refresh LinkedIn data';
          rescrapeBtn.title = 'Error: ' + resp.error;
          rescrapeBtn.style.color = '#ef4444';
          return;
        }
        // Reload page to show updated fields + new score
        rescrapeBtn.textContent = '✓ Refreshed — reloading…';
        setTimeout(() => window.location.reload(), 800);
      });
    });
  }
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
      ${e.url ? `<a class="sb-link opp" href="${safeUrl(e.url)}" target="_blank">↗ Job Posting</a>` : ''}
      <a class="sb-link li" href="${safeUrl(linkedInUrl)}" target="_blank">🔗 LinkedIn</a>
      ${e.companyWebsite
        ? `<a class="sb-link web" href="${safeUrl(e.companyWebsite)}" target="_blank">🌐 ${e.companyWebsite.replace(/^https?:\/\//,'').replace(/\/$/,'')}</a>`
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

  container.innerHTML = `
    <div class="sb-notes-wrap" id="sb-notes-wrap">
      <div class="sb-notes-editable" id="sb-notes-editable" contenteditable="true" style="font-size:13px;color:#33475b;line-height:1.6;min-height:60px;padding:10px 12px;border:1px solid #dfe3eb;border-radius:8px;background:#f5f8fa;outline:none">${htmlContent || ''}</div>
    </div>
    <button class="sb-notes-toggle" id="sb-notes-toggle" style="display:none">Show more</button>`;

  const editable = container.querySelector('#sb-notes-editable');
  const notesWrap = container.querySelector('#sb-notes-wrap');
  const notesToggle = container.querySelector('#sb-notes-toggle');

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

  // Expand/collapse
  const COLLAPSE_HEIGHT = 120;
  function applyCollapse() {
    if (!notesWrap || !notesToggle) return;
    notesWrap.classList.remove('sb-notes-collapsed');
    const full = notesWrap.scrollHeight;
    if (full > COLLAPSE_HEIGHT) {
      notesWrap.classList.add('sb-notes-collapsed');
      notesToggle.style.display = 'block';
    } else {
      notesToggle.style.display = 'none';
    }
  }
  // Defer so DOM is painted before measuring
  requestAnimationFrame(applyCollapse);

  if (notesToggle) {
    notesToggle.addEventListener('click', () => {
      const collapsed = notesWrap.classList.toggle('sb-notes-collapsed');
      notesToggle.textContent = collapsed ? 'Show more' : 'Show less';
    });
  }

  // Auto-save
  let _sbSaveTimer = null;
  function saveSbNotes() {
    const html = editable.innerHTML;
    if (html !== (entry.notes || '')) saveEntry({ notes: html });
  }
  editable.addEventListener('blur', () => { clearTimeout(_sbSaveTimer); saveSbNotes(); applyCollapse(); });
  editable.addEventListener('input', () => { clearTimeout(_sbSaveTimer); _sbSaveTimer = setTimeout(saveSbNotes, 3000); });

  // Ctrl+B / Ctrl+I
  editable.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); }
  });

  editable.addEventListener('focus', () => {
    editable.style.borderColor = '#7c98b6';
    // Expand while editing so no content is hidden
    if (notesWrap) notesWrap.classList.remove('sb-notes-collapsed');
    if (notesToggle) notesToggle.textContent = 'Show less';
  });
  editable.addEventListener('blur', () => { editable.style.borderColor = '#dfe3eb'; });
}

// ── Right Sidebar (Leadership) ────────────────────────────────────────────────

function renderRightSidebar() {
  const leaders = entry.leaders || [];
  const right = document.getElementById('opp-right');

  if (!leaders.length) {
    const listings = entry.jobListings || [];
    const hiringHtml = listings.length
      ? listings.map(j => `<div class="p-hiring-item"><span style="color:#3d5468;font-size:14px">•</span><span style="font-size:13px">${j.title || 'Open Role'}${j.url ? ` <a href="${safeUrl(j.url)}" target="_blank" class="p-hiring-link">↗</a>` : ''}${j.location ? `<span style="color:#64748b;font-size:12px"> · ${j.location}</span>` : ''}</span></div>`).join('')
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
            <a class="leader-link li" href="${safeUrl(liUrl)}" target="_blank">LinkedIn</a>
            ${l.newsUrl ? `<a class="leader-link news" href="${safeUrl(l.newsUrl)}" target="_blank">News</a>` : ''}
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
              ${j.url ? `<a href="${safeUrl(j.url)}" target="_blank" class="p-hiring-link">↗</a>` : ''}
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
          if (avatarEl) {
            // Inline onerror handlers break on names with apostrophes (O'Neill)
            // and are an XSS vector if the name ever contains a quote. Build
            // the <img> via DOM + event listener instead.
            const initials = leaders[i].name.split(' ').map(n => n[0] || '').join('').slice(0, 2).toUpperCase();
            const img = document.createElement('img');
            img.src = url;
            img.alt = leaders[i].name;
            img.addEventListener('error', () => { avatarEl.textContent = initials; });
            avatarEl.innerHTML = '';
            avatarEl.appendChild(img);
          }
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
             ? `<a class="panel-subtitle-link" href="${safeUrl(entry.url)}" target="_blank">${entry.jobTitle} ↗</a>`
             : entry.jobTitle
               ? `<span class="panel-subtitle-link">${entry.jobTitle}</span>`
               : `<a class="panel-subtitle-link" href="${safeUrl(entry.url)}" target="_blank">View Job Posting ↗</a>`}
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
              <div class="p-score-num">${Number(e.jobMatch.score).toFixed(1)}<span style="font-size:15px;color:#64748b;font-weight:400">/10</span></div>
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
      const _normFlag = f => typeof f === 'string' ? { text: f, source: null, evidence: null } : { text: f?.text || '', source: f?.source || null, evidence: f?.evidence || null };
      const _flagSrcLabel = s => ({ job_posting: 'From job posting', company_data: 'From company research', preferences: 'From your preferences', candidate_profile: 'From your profile', dealbreaker_keyword: 'From your dealbreaker keywords' }[s] || (s ? `Source: ${s}` : 'No source linked'));
      const _flagSrcIcon = s => ({ job_posting: '📄', company_data: '🏢', preferences: '⚙', candidate_profile: '👤', dealbreaker_keyword: '⛔' }[s] || 'ⓘ');
      const _flagTip = f => (_flagSrcLabel(f.source) + (f.evidence ? ` — "${f.evidence}"` : ' — no evidence quoted')).replace(/"/g, '&quot;');
      const fits  = (e.jobMatch?.strongFits || []).map(_normFlag).filter(f => f.text);
      const flags = (e.jobMatch?.redFlags   || []).map(_normFlag).filter(f => f.text);
      const quals = e.jobMatch?.qualifications || [];
      const breakdown = e.jobMatch?.scoreBreakdown;
      if (!fits.length && !flags.length && !quals.length) {
        return `<div class="p-empty">No match analysis yet. Make sure your profile is set up in Settings, then save this role from the LinkedIn job posting page.</div>`;
      }
      // Green gradient: strongest first (dark green → light green)
      const greenShades = ['#15803d','#16a34a','#22c55e','#4ade80','#86efac','#bbf7d0'];
      const fitsCol  = fits.length  ? `<div><div class="p-label">Green Flags</div><ul class="p-bullets">${fits.map((f, i) => {
        const color = greenShades[Math.min(i, greenShades.length - 1)];
        return `<li class="fit" title="${_flagTip(f)}" style="cursor:help;"><span style="color:${color};font-size:16px;">&#x2714;</span><span>${linkReviewSources(escapeHtml(f.text), e.reviews, e.dismissedReviews)} <span style="opacity:0.5;font-size:10px;">${_flagSrcIcon(f.source)}</span></span></li>`;
      }).join('')}</ul></div>`  : '';
      // Red gradient: worst first (dark red → light red)
      const redShades = ['#991b1b','#dc2626','#ef4444','#f87171','#fca5a5','#fecaca'];
      const flagsCol = flags.length ? `<div><div class="p-label">Red Flags</div><ul  class="p-bullets">${flags.map((f, i) => {
        const color = redShades[Math.min(i, redShades.length - 1)];
        return `<li class="flag" title="${_flagTip(f)}" style="cursor:help;"><span style="color:${color};font-size:16px;">&#x25CF;</span><span>${linkReviewSources(escapeHtml(f.text), e.reviews, e.dismissedReviews)} <span style="opacity:0.5;font-size:10px;">${_flagSrcIcon(f.source)}</span></span></li>`;
      }).join('')}</ul></div>` : '';
      let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">${fitsCol}${flagsCol}</div>`;

      // Qualifications checklist + B1 visibility surface
      const userCorrections = e.jobMatch?.userCorrections || null;
      const corrCount = userCorrections ? Object.keys(userCorrections.requirements || {}).length + (userCorrections.overall ? 1 : 0) : 0;
      const expanded = !!(window.__b1Expanded && window.__b1Expanded[e.id]);
      const hardDQ = e.jobMatch?.hardDQ || e.hardDQ;
      const hasHardDQ = hardDQ && hardDQ.flagged;
      if (quals.length || hasHardDQ) {
        const metCount = quals.filter(q => q.status === 'met' && !q.dismissed).length;
        const reqCount = quals.filter(q => q.importance === 'required').length;
        const reqMetCount = quals.filter(q => q.importance === 'required' && q.status === 'met' && !q.dismissed).length;
        const icons = { met: '✓', partial: '◐', unmet: '✗', unknown: '✗' };
        const iconColors = { met: '#00BDA5', partial: '#d97706', unmet: '#f87171', unknown: '#f87171' };
        const badgeColors = { required: '#f87171', preferred: '#d97706', bonus: '#94a3b8' };
        const badgeBgs = { required: 'rgba(248,113,113,0.1)', preferred: 'rgba(245,158,11,0.1)', bonus: 'rgba(148,163,184,0.1)' };
        const seeWhyLabel = expanded ? 'Hide details ▴' : 'See why ▾';
        const pendingPill = (userCorrections?.pendingRescore && corrCount)
          ? `<span style="font-size:10px;font-weight:700;background:#FFF1EC;color:#FF7A59;padding:2px 7px;border-radius:10px;margin-left:6px">${corrCount} pending re-score</span>`
          : '';
        html += `<div style="margin-top:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div class="p-label" style="margin:0">${_cachedUserFirstName ? _cachedUserFirstName + "'s" : ''} Qualifications <span style="font-weight:400;color:#6B6560">(${metCount}/${quals.length} met${reqCount ? `, ${reqMetCount}/${reqCount} required` : ''})</span>${pendingPill}</div>
            <button class="b1-toggle" data-entry-id="${e.id}" style="background:none;border:none;color:#FF7A59;font-size:11px;font-weight:600;cursor:pointer;padding:2px 6px">${seeWhyLabel}</button>
          </div>`;
        // hardDQ callout (always visible when present, not gated by expand)
        if (hasHardDQ) {
          const reasons = (hardDQ.reasons || []).filter(Boolean);
          html += `<div style="margin-top:8px;padding:10px 12px;background:rgba(248,113,113,0.08);border-left:3px solid #f87171;border-radius:4px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#991b1b">Hard DQ flagged</div>
            <div style="font-size:12px;color:#33475b;margin-top:4px;line-height:1.5">${reasons.length ? reasons.map(r => `• ${r}`).join('<br>') : 'A dealbreaker was triggered.'}</div>
            <div style="font-size:10px;color:#7c98b6;margin-top:6px;font-style:italic">When Hard DQ is flagged, the overall score is capped at 4.</div>
          </div>`;
        }
        if (quals.length) {
          html += `<div style="display:flex;flex-direction:column;gap:2px;margin-top:8px">`;
          quals.forEach(q => {
            const corr = userCorrections?.requirements?.[q.id] || null;
            const dimStyle = q.dismissed ? 'opacity:0.35;' : '';
            const strikeStyle = q.dismissed ? 'text-decoration:line-through;' : '';
            const corrBorder = corr ? 'border-left:3px solid #FF7A59;padding-left:8px;' : '';
            const corrCaption = corr ? `<div style="font-size:10px;color:#FF7A59;font-weight:600;margin-top:2px">you said: ${corr.action === 'meets' ? 'I meet this' : corr.action === 'not_relevant' ? 'not relevant' : 'wrong evidence'}</div>` : '';
            const correctionButtons = expanded && !q.dismissed ? `
              <div class="b1-corr-row" style="margin-top:4px;display:flex;gap:8px">
                <button class="b1-corr" data-qual-id="${q.id}" data-action="meets" style="background:none;border:none;color:#7c98b6;font-size:10px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline">I meet this</button>
                <button class="b1-corr" data-qual-id="${q.id}" data-action="not_relevant" style="background:none;border:none;color:#7c98b6;font-size:10px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline">Not relevant</button>
                <button class="b1-corr" data-qual-id="${q.id}" data-action="wrong_evidence" style="background:none;border:none;color:#7c98b6;font-size:10px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline">Wrong evidence</button>
              </div>` : '';
            html += `<div class="qual-row" data-qual-id="${q.id}" style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid #f0eeeb;${dimStyle}${corrBorder}">
              <span style="flex-shrink:0;width:18px;text-align:center;font-size:13px;font-weight:700;color:${iconColors[q.status] || '#94a3b8'};margin-top:1px">${icons[q.status] || '?'}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:#33475b;line-height:1.4;${strikeStyle}">${q.requirement}</div>
                ${q.evidence ? `<div style="font-size:11px;color:#7c98b6;margin-top:2px;line-height:1.4">${q.evidence}</div>` : ''}
                ${corrCaption}
                ${correctionButtons}
              </div>
              <span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;text-transform:uppercase;letter-spacing:0.04em;background:${badgeBgs[q.importance] || badgeBgs.bonus};color:${badgeColors[q.importance] || badgeColors.bonus}">${(q.sources?.length ? q.sources[0] : q.importance) || q.importance}</span>
              <button class="opp-qual-dismiss" data-qual-id="${q.id}" style="background:none;border:none;color:#c4c0bc;cursor:pointer;font-size:14px;padding:0 2px;line-height:1" title="${q.dismissed ? 'Restore' : 'Dismiss'}">${q.dismissed ? '↩' : '×'}</button>
            </div>`;
          });
          html += `</div>`;
        }
        // Expanded-only: overall feedback textarea + rescore button
        if (expanded) {
          const overallNote = userCorrections?.overall?.note || '';
          html += `<div style="margin-top:14px;padding:12px;background:#f9f7f3;border-radius:6px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#516f90;margin-bottom:6px">This score feels wrong? Tell Coop why.</div>
            <textarea class="b1-overall-note" data-entry-id="${e.id}" placeholder="e.g. you're underweighting my GTM leadership experience" style="width:100%;min-height:54px;padding:8px;border:1px solid #e8e5e0;border-radius:4px;font-family:inherit;font-size:12px;color:#33475b;resize:vertical">${overallNote}</textarea>
            <button class="b1-overall-save" data-entry-id="${e.id}" style="margin-top:6px;background:none;border:1px solid #dfe3eb;color:#516f90;font-size:11px;font-weight:600;padding:4px 10px;border-radius:4px;cursor:pointer">Save feedback</button>
          </div>
          ${userCorrections?.pendingRescore && corrCount ? `<button class="b1-rescore" data-entry-id="${e.id}" style="margin-top:12px;width:100%;background:#FF7A59;color:#fff;border:none;padding:10px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Re-score with corrections (${corrCount} pending)</button>` : ''}`;
        }
        html += `</div>`;
      }

      // Score breakdown
      if (breakdown) {
        const components = [
          { key: 'qualificationFit', label: _cachedUserFirstName ? `${_cachedUserFirstName}'s Qualifications` : 'Qualifications' },
          { key: 'preferenceFit', label: 'Green Flags' },
          { key: 'dealbreakers', label: 'Red Flag Impact' },
          { key: 'compFit', label: 'Compensation' },
          { key: 'roleFit', label: 'Role & Co. Fit' }
        ];
        html += `<div style="margin-top:20px"><div class="p-label">Score Breakdown</div><div style="margin-top:8px">`;
        components.forEach(c => {
          const val = breakdown[c.key] || 5;
          const pct = val * 10;
          const color = val >= 7 ? '#00BDA5' : val >= 4 ? '#d97706' : '#f87171';
          html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:11px;color:#6B6560;width:110px;flex-shrink:0;font-weight:500">${c.label}</span>
            <div style="flex:1;height:6px;background:#e8e5e0;border-radius:3px;overflow:hidden"><div style="height:100%;border-radius:3px;width:${pct}%;background:${color}"></div></div>
            <span style="font-size:11px;font-weight:700;width:20px;text-align:right;color:${color}">${Number(val).toFixed(1)}</span>
          </div>`;
        });
        html += `</div></div>`;
      }

      return html;
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
            ${r.source ? (r.url ? `<a href="${safeUrl(r.url)}" target="_blank">${r.source}</a>` : r.source) : ''}
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
            ${j.url ? `<a href="${safeUrl(j.url)}" target="_blank" class="p-hiring-link">↗</a>` : ''}
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

// ── Email helpers ─────────────────────────────────────────────────────────────

function renderEmailsFromData(emails) {
  const statusEl = document.getElementById('act-emails-status');
  const listEl   = document.getElementById('act-emails-list');
  if (!statusEl || !listEl) return;
  statusEl.style.display = 'none';

  // Apply ignore-list filter at render time (keep raw cache; ignore-list is a user-preference layer)
  const ignoreList = new Set((entry.emailSenderIgnoreList || []).map(a => a.toLowerCase()));
  const visibleEmails = ignoreList.size
    ? emails.filter(e => {
        const addr = (e.from || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || (e.from || '').toLowerCase();
        return !ignoreList.has(addr);
      })
    : emails;

  if (!visibleEmails.length) {
    listEl.innerHTML = '<div class="p-empty">No emails for this company.</div>';
    return;
  }

  listEl.innerHTML = renderEmailThreads(visibleEmails);
  bindThreadToggles(listEl);
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

  // Auto-load emails — derive domain from website, knownContacts, or cached sender history
  const _pubProvRe = /^(gmail|yahoo|outlook|hotmail|icloud|aol|proton)\./i;
  let domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!domain) {
    domain = (entry.knownContacts || []).map(c => (c.email || '').split('@')[1]).filter(d => d && !_pubProvRe.test(d))[0] || '';
  }
  if (!domain) {
    const counts = {};
    (entry.cachedEmails || []).forEach(e => {
      const m = (e.from || '').match(/<([^>]+)>/);
      const addr = (m ? m[1] : e.from || '').toLowerCase().trim();
      const d = addr.split('@')[1];
      if (d && !_pubProvRe.test(d)) counts[d] = (counts[d] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    domain = sorted[0]?.[0] || '';
  }
  const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName: entry.company || '', linkedinSlug }, result => {
    const statusEl = document.getElementById('act-emails-status');
    const listEl = document.getElementById('act-emails-list');
    if (!statusEl || !listEl) return;
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Gmail in Setup to see emails.'; return; }
    if (!result?.emails?.length) { statusEl.textContent = 'No emails found for this company.'; return; }

    // Cache raw emails first, then render with ignore-list applied at render time
    saveEntry({ cachedEmails: result.emails, cachedEmailsAt: Date.now() });
    renderEmailsFromData(result.emails);
    if (result.extractedContacts?.length) mergeExtractedContacts(result.extractedContacts);
  });

  // Show cached meetings immediately while Granola refreshes
  const cachedM = (entry.cachedMeetings || []).map(m => ({ ...m, _isManual: false }));
  const manualM0 = (entry.manualMeetings || []).map(m => ({ ...m, _isManual: true }));
  if (cachedM.length || manualM0.length) {
    const statusEl0 = document.getElementById('act-meetings-status');
    const contentEl0 = document.getElementById('act-meetings-content');
    if (statusEl0) statusEl0.style.display = 'none';
    if (contentEl0) {
      const merged0 = [...cachedM, ...manualM0].sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
      _oppRenderMeetingsTimeline(contentEl0, merged0);
    }
  }

  // Auto-load Granola meeting notes
  chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company }, result => {
    const statusEl = document.getElementById('act-meetings-status');
    const contentEl = document.getElementById('act-meetings-content');
    if (!statusEl || !contentEl) return;
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Granola in Setup to see meeting notes.'; return; }
    const granolaMeetings = result?.meetings || [];
    const granolaNotes = result?.notes || null;
    if (granolaMeetings.length) {
      saveEntry({ cachedMeetings: granolaMeetings, cachedMeetingNotes: granolaNotes, cachedMeetingNotesAt: Date.now() });
    }
    statusEl.style.display = 'none';
    const manualM = (entry.manualMeetings || []).map(m => ({ ...m, _isManual: true }));
    const granolaM = granolaMeetings.map(m => ({ ...m, _isManual: false }));
    const merged = [...granolaM, ...manualM].sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
    _oppRenderMeetingsTimeline(contentEl, merged);
  });
}

// ── Avatar / date helpers for opportunity.js meetings ───────────────────────
const _OPP_AVATAR_COLORS = ['#FC636B', '#3B82F6', '#36B37E', '#F5A623', '#7C6EF0'];
function _oppHashColor(name) {
  if (!name) return _OPP_AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  return _OPP_AVATAR_COLORS[Math.abs(h) % _OPP_AVATAR_COLORS.length];
}
function _oppInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function _oppAvatarHtml(names) {
  if (!names || !names.length) return '';
  const list = names.slice(0, 3);
  const overflow = Math.max(0, names.length - 3);
  const avatars = list.map(name => {
    const color = name === 'Me' ? '#36B37E' : _oppHashColor(name);
    return `<span class="mtg-avatar" style="background:${color}" title="${escapeHtml(name)}">${escapeHtml(_oppInitials(name))}</span>`;
  }).join('');
  const plus = overflow ? `<span class="mtg-avatar mtg-avatar-overflow">+${overflow}</span>` : '';
  return `<div class="mtg-avatar-row">${avatars}${plus}</div>`;
}
function _oppNamesHtml(names) {
  if (!names || !names.length) return '';
  return escapeHtml(names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : ''));
}
function _oppParseAttendees(val) {
  if (Array.isArray(val)) return val.map(a => (typeof a === 'string' ? a : a.name || a.email || '').trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim()) return val.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}
function _oppDateGroupLabel(dateKey) {
  if (!dateKey) return 'Unknown date';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateKey + 'T12:00:00'); if (isNaN(d)) return dateKey;
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - today.getDay());
  const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfWeek.getDate() - 7);
  if (d >= startOfWeek) return 'This week';
  if (d >= startOfLastWeek) return 'Last week';
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (d >= thisMonth) return 'Earlier this month';
  return d.toLocaleDateString('en-US', { month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function _oppRenderMeetingsTimeline(contentEl, meetings) {
  const allMeetings = meetings || [];

  // ── Panel header ────────────────────────────────────────────────────────────
  const meetingCount = allMeetings.length;
  const countLabel = meetingCount
    ? `${meetingCount} with ${escapeHtml(entry.company || 'this company')}`
    : '';
  let html = `<div class="mtg-panel-head">
    <span class="mtg-panel-title">Meetings</span>
    ${countLabel ? `<span class="mtg-panel-count">${countLabel}</span>` : ''}
  </div>`;

  // ── "+ Add meeting" button and form ────────────────────────────────────────
  html += `<button class="mtg-add-btn" id="opp-mtg-add-btn">+ Add meeting</button>`;
  html += `
    <div class="mtg-add-form" id="opp-mtg-add-form" style="display:none">
      <div class="mtg-add-title">Log a meeting</div>
      <div class="mtg-add-fields">
        <input type="text" class="mtg-add-input" id="opp-mm-title" placeholder="Meeting title…">
        <div style="display:flex;gap:8px">
          <input type="date" class="mtg-add-input" id="opp-mm-date" style="flex:1">
          <input type="text" class="mtg-add-input" id="opp-mm-time" placeholder="e.g. 2:00 PM" style="flex:1">
        </div>
        <input type="text" class="mtg-add-input" id="opp-mm-attendees" placeholder="e.g. Sarah Chen, VP Sales">
        <textarea class="mtg-add-input" id="opp-mm-notes" rows="4" placeholder="Key takeaways, decisions, action items…"></textarea>
        <div class="mtg-transcript-toggle" id="opp-mm-transcript-toggle">+ Add full transcript</div>
        <textarea class="mtg-add-input" id="opp-mm-transcript" rows="8" placeholder="Paste full meeting transcript…" style="display:none"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="mtg-add-save" id="opp-mm-save">Save meeting</button>
          <button class="mtg-add-cancel" id="opp-mm-cancel">Cancel</button>
        </div>
      </div>
    </div>`;

  if (!allMeetings.length) {
    html += '<div class="p-empty">No meetings found.</div>';
    contentEl.innerHTML = html;
    _oppWireAddMeetingForm(contentEl, allMeetings);
    return;
  }

  const groups = [];
  const groupMap = {};
  allMeetings.forEach(m => {
    const label = _oppDateGroupLabel(m.date || '');
    if (!groupMap[label]) { groupMap[label] = { label, items: [] }; groups.push(groupMap[label]); }
    groupMap[label].items.push(m);
  });

  html += '<div class="mtg-list">';
  for (const group of groups) {
    html += `<div class="mtg-date-group">${escapeHtml(group.label)}</div>`;
    for (const m of group.items) {
      const d = m.date ? new Date(m.date + 'T12:00:00') : null;
      const dayNum = (d && !isNaN(d)) ? d.getDate() : '';
      const monShort = (d && !isNaN(d)) ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
      const timeShort = m.time ? m.time.replace(':00', '').replace(' ', '').toLowerCase() : '';
      const attendeeNames = _oppParseAttendees(m.attendees);
      const avatarHtml = _oppAvatarHtml(attendeeNames);
      const namesHtml = _oppNamesHtml(attendeeNames);
      let takeaways = [];
      if (m.summaryMarkdown) {
        takeaways = m.summaryMarkdown.split('\n').filter(l => /^[-*•]\s/.test(l.trim())).map(l => l.replace(/^[-*•]\s+/, '').trim()).filter(Boolean).slice(0, 3);
      }
      const summary = m.summary || '';
      let contentHtml;
      if (takeaways.length) {
        contentHtml = `<ul class="mtg-takeaways">${takeaways.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
      } else if (summary) {
        contentHtml = `<p class="mtg-summary">${escapeHtml(summary)}</p>`;
      } else {
        contentHtml = `<p class="mtg-summary"><em>No notes yet</em></p>`;
      }
      const granolaChip = m.url
        ? `<a class="mtg-granola-link" href="${safeUrl(m.url)}" target="_blank" rel="noopener noreferrer"><span class="granola-glyph"></span>Granola ↗</a>`
        : '';
      html += `
        <div class="mtg-card" data-opp-meeting-id="${escapeHtml(m.id)}">
          <div class="mtg-date">
            <div class="mtg-date-day">${dayNum}</div>
            <div class="mtg-date-mon">${monShort}</div>
            ${timeShort ? `<div class="mtg-date-time">${escapeHtml(timeShort)}</div>` : ''}
          </div>
          <div class="mtg-body">
            <div class="mtg-title-row"><div class="mtg-title">${escapeHtml(m.title || 'Untitled')}</div></div>
            ${(avatarHtml || namesHtml) ? `<div class="mtg-participants">${avatarHtml}<span class="mtg-names">${namesHtml}</span></div>` : ''}
            ${contentHtml}
          </div>
          <div class="mtg-card-actions">${granolaChip}</div>
        </div>`;
    }
  }
  html += '</div>';
  contentEl.innerHTML = html;

  _oppWireAddMeetingForm(contentEl, allMeetings);

  // Meeting card click → detail view
  contentEl.querySelectorAll('.mtg-card[data-opp-meeting-id]').forEach(card => {
    card.addEventListener('click', () => {
      const mid = card.dataset.oppMeetingId;
      const meeting = allMeetings.find(m => m.id === mid);
      if (meeting) _oppRenderMeetingDetail(contentEl, meeting, allMeetings);
    });
  });
}

function _oppWireAddMeetingForm(contentEl, meetings) {
  let _mmEditId = null;
  const addBtn = contentEl.querySelector('#opp-mtg-add-btn');
  const addForm = contentEl.querySelector('#opp-mtg-add-form');
  const mmTitle = contentEl.querySelector('#opp-mm-title');
  const mmDate = contentEl.querySelector('#opp-mm-date');
  const mmTime = contentEl.querySelector('#opp-mm-time');
  const mmAttendees = contentEl.querySelector('#opp-mm-attendees');
  const mmNotes = contentEl.querySelector('#opp-mm-notes');
  const mmTranscript = contentEl.querySelector('#opp-mm-transcript');
  const mmTranscriptToggle = contentEl.querySelector('#opp-mm-transcript-toggle');
  const mmSave = contentEl.querySelector('#opp-mm-save');
  const mmCancel = contentEl.querySelector('#opp-mm-cancel');

  if (!addBtn || !addForm) return;

  mmDate.value = new Date().toISOString().slice(0, 10);

  addBtn.addEventListener('click', () => {
    _mmEditId = null;
    mmTitle.value = ''; mmTime.value = ''; mmAttendees.value = '';
    mmNotes.value = ''; mmTranscript.value = '';
    mmDate.value = new Date().toISOString().slice(0, 10);
    mmTranscript.style.display = 'none';
    mmTranscriptToggle.textContent = '+ Add full transcript';
    mmSave.textContent = 'Save meeting';
    addForm.style.display = '';
    addBtn.style.display = 'none';
    mmTitle.focus();
  });

  mmTranscriptToggle.addEventListener('click', () => {
    const showing = mmTranscript.style.display !== 'none';
    mmTranscript.style.display = showing ? 'none' : '';
    mmTranscriptToggle.textContent = showing ? '+ Add full transcript' : '− Hide transcript';
  });

  mmCancel.addEventListener('click', () => {
    addForm.style.display = 'none';
    addBtn.style.display = '';
    _mmEditId = null;
  });

  mmSave.addEventListener('click', () => {
    const title = mmTitle.value.trim();
    const date = mmDate.value || new Date().toISOString().slice(0, 10);
    const time = mmTime.value.trim();
    const attendees = mmAttendees.value.trim();
    const notes = mmNotes.value.trim();
    const transcript = mmTranscript.value.trim();
    if (!title && !notes && !transcript) return;

    const current = entry.manualMeetings || [];
    if (_mmEditId) {
      const idx = current.findIndex(m => m.id === _mmEditId);
      if (idx !== -1) {
        current[idx] = { ...current[idx], title, date, time, attendees, notes, transcript, updatedAt: Date.now() };
      }
    } else {
      current.unshift({ id: 'mm_' + Date.now(), title, date, time, attendees, notes, transcript, createdAt: Date.now() });
    }
    saveEntry({ manualMeetings: current });
    _mmEditId = null;
    // Re-render with updated manual meetings merged into Granola meetings
    const granolaM = (entry.cachedMeetings || []).map(m => ({ ...m, _isManual: false }));
    const manualM = (entry.manualMeetings || []).map(m => ({ ...m, _isManual: true }));
    const merged = [...granolaM, ...manualM].sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
    _oppRenderMeetingsTimeline(contentEl, merged);
  });
}

// Minimal markdown renderer for Granola summaryMarkdown in opportunity context
function _oppRenderSummaryMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let out = '';
  let inList = false;
  let inOl = false;
  const flushList = () => {
    if (inList) { out += '</ul>'; inList = false; }
    if (inOl) { out += '</ol>'; inOl = false; }
  };
  const inline = (s) => {
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
    return s;
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flushList(); continue; }
    const hm = t.match(/^#{1,6}\s+(.+)$/);
    if (hm) { flushList(); out += `<h5>${inline(hm[1])}</h5>`; continue; }
    const ulm = t.match(/^[-*•]\s+(.+)$/);
    if (ulm) { if (!inList) { flushList(); out += '<ul>'; inList = true; } out += `<li>${inline(ulm[1])}</li>`; continue; }
    const olm = t.match(/^\d+\.\s+(.+)$/);
    if (olm) { if (!inOl) { flushList(); out += '<ol>'; inOl = true; } out += `<li>${inline(olm[1])}</li>`; continue; }
    flushList();
    out += `<p>${inline(t)}</p>`;
  }
  flushList();
  return out;
}

function _oppRenderMeetingDetail(contentEl, meeting, allMeetings) {
  const d = meeting.date ? new Date(meeting.date + 'T12:00:00') : null;
  const dateStr = (d && !isNaN(d))
    ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : (meeting.date || '');
  const timeStr = meeting.time || '';
  const granolaUrl = meeting.url || null;
  const attendeeNames = _oppParseAttendees(meeting.attendees);
  const avatarHtml = _oppAvatarHtml(attendeeNames);
  const namesHtml = _oppNamesHtml(attendeeNames);

  const notesSource = meeting._isManual
    ? (meeting.notes || '')
    : (meeting.summaryMarkdown || meeting.summary || '');

  const resolvedTranscript = meeting.transcript ? meeting.transcript : '';
  const summaryBodyHtml = notesSource
    ? `<div class="detail-summary">${_oppRenderSummaryMarkdown(notesSource)}</div>`
    : '';

  // Transcript body
  const SPEAKER_LINE = /^([A-Z][A-Za-z .'-]{0,40}):\s(.*)$/;
  let transcriptBodyHtml = '';
  if (resolvedTranscript) {
    const lines = resolvedTranscript.split('\n');
    const speakerCount = lines.reduce((n, l) => n + (SPEAKER_LINE.test(l) ? 1 : 0), 0);
    if (speakerCount >= 2) {
      const blocks = [];
      let cur = null;
      lines.forEach(line => {
        const m = line.match(SPEAKER_LINE);
        if (m) { if (cur) blocks.push(cur); cur = { speaker: m[1], utterance: m[2] }; }
        else if (cur) { cur.utterance += ' ' + line; }
      });
      if (cur) blocks.push(cur);
      transcriptBodyHtml = blocks.map(b =>
        `<div class="tx-block"><span class="tx-speaker">${escapeHtml(b.speaker)}</span><span class="tx-utterance">${escapeHtml(b.utterance.trim())}</span></div>`
      ).join('');
    } else {
      transcriptBodyHtml = resolvedTranscript.split('\n').filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
    }
  }

  contentEl.innerHTML = `
    <button class="panel-back" id="opp-mtg-back">← Meetings</button>
    <div class="detail-head">
      <div class="detail-title-row">
        <div class="detail-title">${escapeHtml(meeting.title || 'Untitled')}</div>
        ${granolaUrl ? `<a class="detail-granola-btn" href="${safeUrl(granolaUrl)}" target="_blank" rel="noopener noreferrer"><span class="granola-logo-lg"></span>Open in Granola</a>` : ''}
      </div>
      <div class="detail-meta">
        ${avatarHtml}
        ${namesHtml ? `<span>${namesHtml}</span>` : ''}
        ${(avatarHtml || namesHtml) && (dateStr || timeStr) ? `<span class="detail-meta-sep">·</span>` : ''}
        ${dateStr ? `<span>${escapeHtml(dateStr)}${timeStr ? ' · ' + escapeHtml(timeStr) : ''}</span>` : ''}
        ${meeting._isManual ? `<span class="detail-meta-sep">·</span><span class="mtg-manual-badge">Manual</span>` : ''}
      </div>
    </div>

    ${summaryBodyHtml ? `
    <div class="detail-section">
      <div class="detail-section-head">
        <h3>Summary</h3>
        ${!meeting._isManual ? `<span class="detail-source-badge"><span class="granola-glyph"></span>from Granola</span>` : ''}
        ${granolaUrl ? `<a class="edit-link" href="${safeUrl(granolaUrl)}" target="_blank" rel="noopener noreferrer">View in Granola ↗</a>` : ''}
      </div>
      ${summaryBodyHtml}
    </div>` : ''}

    ${resolvedTranscript ? `
    <div class="detail-transcript" id="opp-mtg-transcript-collapse">
      <div class="detail-transcript-head" id="opp-mtg-transcript-toggle-btn">
        <h3>Full transcript</h3>
        <span class="detail-transcript-chevron">›</span>
      </div>
      <div class="detail-transcript-body">
        <div class="detail-transcript-inner">${transcriptBodyHtml}</div>
      </div>
    </div>` : ''}

    <div class="detail-coop">
      <div class="detail-coop-head">
        <span class="detail-coop-title">My notes</span>
        <span class="detail-coop-pill">Coop</span>
        <span class="detail-coop-sync detail-coop-saved-indicator" id="opp-detail-coop-saved-indicator">↑ Saved to Private notes</span>
      </div>
      <div class="detail-coop-compose" id="opp-detail-coop-compose">
        <div class="detail-coop-editable notes-empty-edit" id="opp-detail-coop-editable" contenteditable="true"></div>
        <div class="detail-coop-compose-actions">
          <button class="detail-coop-save-btn" id="opp-detail-coop-save-btn" disabled>Save note</button>
        </div>
      </div>
      <div class="detail-coop-hint">Written here? It also appears in ${escapeHtml(entry.company || 'company')} Private notes with a link back to this meeting.</div>
      <div class="detail-coop-notes-list" id="opp-detail-coop-notes-list"></div>
    </div>
  `;

  // Transcript toggle
  const transcriptCollapse = contentEl.querySelector('#opp-mtg-transcript-collapse');
  const transcriptToggleBtn = contentEl.querySelector('#opp-mtg-transcript-toggle-btn');
  if (transcriptCollapse && transcriptToggleBtn) {
    transcriptToggleBtn.addEventListener('click', () => transcriptCollapse.classList.toggle('open'));
  }

  // Back button
  contentEl.querySelector('#opp-mtg-back').addEventListener('click', () => {
    const granolaM = (entry.cachedMeetings || []).map(m => ({ ...m, _isManual: false }));
    const manualM = (entry.manualMeetings || []).map(m => ({ ...m, _isManual: true }));
    const merged = [...granolaM, ...manualM].sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
    _oppRenderMeetingsTimeline(contentEl, merged);
  });

  // My notes composer
  const coopEditable = contentEl.querySelector('#opp-detail-coop-editable');
  const coopSaveBtn = contentEl.querySelector('#opp-detail-coop-save-btn');
  const coopNotesList = contentEl.querySelector('#opp-detail-coop-notes-list');
  const coopSavedIndicator = contentEl.querySelector('#opp-detail-coop-saved-indicator');

  function _renderOppDetailNotesList() {
    const meetingNotes = (entry.notesFeed || [])
      .filter(n => n.meetingId === meeting.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!coopNotesList) return;
    if (!meetingNotes.length) {
      coopNotesList.innerHTML = '';
      return;
    }
    coopNotesList.innerHTML = meetingNotes.map(n => {
      const nd = new Date(n.createdAt);
      const nDateStr = nd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `
        <div class="note-card" data-detail-note-id="${escapeHtml(n.id)}">
          <div class="note-card-header">
            <span class="note-card-date">${nDateStr}</span>
            <span class="note-card-actions">
              <button class="note-del-btn opp-detail-note-del" data-detail-note-id="${escapeHtml(n.id)}" title="Delete">✕</button>
            </span>
          </div>
          <div class="note-card-body">${n.content}</div>
        </div>`;
    }).join('');

    coopNotesList.querySelectorAll('.opp-detail-note-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const nid = btn.dataset.detailNoteId;
        entry.notesFeed = (entry.notesFeed || []).filter(n => n.id !== nid);
        // Don't write HTML to entry.notes — that field is now markdown owned by the
        // Notes tab editor (#258). notesFeed is the per-meeting note storage.
        saveEntry({ notesFeed: entry.notesFeed });
        _renderOppDetailNotesList();
      });
    });
  }

  _renderOppDetailNotesList();

  if (coopEditable && coopSaveBtn) {
    coopEditable.addEventListener('input', () => {
      const hasContent = !!coopEditable.textContent.trim();
      coopEditable.classList.toggle('notes-empty-edit', !hasContent);
      coopSaveBtn.disabled = !hasContent;
    });
    coopEditable.addEventListener('focus', () => coopEditable.classList.remove('notes-empty-edit'));
    coopEditable.addEventListener('blur', () => {
      if (!coopEditable.textContent.trim()) coopEditable.classList.add('notes-empty-edit');
    });

    const _saveOppDetailNote = () => {
      const text = coopEditable.textContent.trim();
      if (!text) return;
      const now = Date.now();
      const content = coopEditable.innerHTML;
      const newNote = {
        id: 'note_' + now.toString(36) + Math.random().toString(36).substr(2),
        content,
        createdAt: now,
        updatedAt: now,
        meetingId: meeting.id,
      };
      entry.notesFeed = [newNote, ...(entry.notesFeed || [])];
      // Don't write HTML to entry.notes — markdown owned by Notes tab editor (#258).
      saveEntry({ notesFeed: entry.notesFeed });
      coopEditable.innerHTML = '';
      coopEditable.classList.add('notes-empty-edit');
      coopSaveBtn.disabled = true;
      _renderOppDetailNotesList();
      if (coopSavedIndicator) {
        coopSavedIndicator.style.opacity = '1';
        setTimeout(() => { coopSavedIndicator.style.opacity = ''; }, 2000);
      }
    };

    coopSaveBtn.addEventListener('click', _saveOppDetailNote);
    coopEditable.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); _saveOppDetailNote(); }
    });
  }
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

// Qualification dismiss handler (delegated)
document.addEventListener('click', e => {
  const dismissBtn = e.target.closest('.opp-qual-dismiss');
  if (!dismissBtn) return;
  const qualId = dismissBtn.dataset.qualId;
  if (!qualId) return;
  const entryId = new URLSearchParams(window.location.search).get('id');
  if (!entryId) return;
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const companies = savedCompanies || [];
    const idx = companies.findIndex(c => c.id === entryId);
    if (idx === -1 || !companies[idx].jobMatch?.qualifications) return;
    const qual = companies[idx].jobMatch.qualifications.find(q => q.id === qualId);
    if (!qual) return;
    qual.dismissed = !qual.dismissed;
    chrome.storage.local.set({ savedCompanies: companies }, () => {
      const row = dismissBtn.closest('.qual-row');
      if (row) {
        row.style.opacity = qual.dismissed ? '0.35' : '';
        const reqEl = row.querySelector('div[style*="font-weight:600"]');
        if (reqEl) reqEl.style.textDecoration = qual.dismissed ? 'line-through' : '';
        dismissBtn.textContent = qual.dismissed ? '↩' : '×';
        dismissBtn.title = qual.dismissed ? 'Restore' : 'Dismiss';
      }
    });
  });
});

// B1: Qualification visibility — toggle, corrections, re-score
window.__b1Expanded = window.__b1Expanded || {};

function _b1RefreshEntryAndRender() {
  const entryId = new URLSearchParams(window.location.search).get('id');
  if (!entryId) return;
  chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
    const fresh = (savedCompanies || []).find(c => c.id === entryId);
    if (fresh) entry = fresh;
    renderPanels();
  });
}
function _b1UpdateEntry(updater) {
  const entryId = new URLSearchParams(window.location.search).get('id');
  if (!entryId) return Promise.resolve();
  return new Promise(resolve => {
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const companies = savedCompanies || [];
      const idx = companies.findIndex(c => c.id === entryId);
      if (idx === -1) { resolve(); return; }
      const jm = companies[idx].jobMatch || {};
      jm.userCorrections = jm.userCorrections || { requirements: {}, overall: null, pendingRescore: false };
      updater(jm.userCorrections, companies[idx]);
      jm.userCorrections.pendingRescore = true;
      companies[idx].jobMatch = jm;
      chrome.storage.local.set({ savedCompanies: companies }, () => { _b1RefreshEntryAndRender(); resolve(); });
    });
  });
}

document.addEventListener('click', e => {
  const toggle = e.target.closest('.b1-toggle');
  if (toggle) {
    const id = toggle.dataset.entryId;
    window.__b1Expanded[id] = !window.__b1Expanded[id];
    renderPanels();
    return;
  }
  const corr = e.target.closest('.b1-corr');
  if (corr) {
    const qid = corr.dataset.qualId;
    const action = corr.dataset.action;
    _b1UpdateEntry(uc => {
      uc.requirements = uc.requirements || {};
      uc.requirements[qid] = { action, note: null, correctedAt: Date.now() };
    });
    return;
  }
  const saveBtn = e.target.closest('.b1-overall-save');
  if (saveBtn) {
    const id = saveBtn.dataset.entryId;
    const ta = document.querySelector(`.b1-overall-note[data-entry-id="${id}"]`);
    const note = (ta?.value || '').trim();
    _b1UpdateEntry(uc => {
      uc.overall = note ? { note, correctedAt: Date.now() } : null;
    });
    return;
  }
  const rescoreBtn = e.target.closest('.b1-rescore');
  if (rescoreBtn) {
    const id = rescoreBtn.dataset.entryId;
    rescoreBtn.disabled = true;
    rescoreBtn.textContent = 'Re-scoring…';
    chrome.runtime.sendMessage({ type: 'SCORE_OPPORTUNITY', entryId: id }, () => {
      void chrome.runtime.lastError;
      _b1RefreshEntryAndRender();
    });
    return;
  }
});

// Re-render job match panel when scoring completes (no page refresh needed)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SCORE_COMPLETE' && msg.entryId === entryId) {
    _b1RefreshEntryAndRender();
  }
});

init();
