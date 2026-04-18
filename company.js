// company.js — full-screen company detail view with drag-between-columns panels

// Shared Coop thinking SVG (thinking expression: eyes up, hand on chin, animated thought bubbles)
const COOP_THINKING_SVG = (size = 56) => `<svg class="coop-thinking-face" width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="#3B5068"/><clipPath id="ct${size}"><circle cx="50" cy="50" r="48"/></clipPath><g clip-path="url(#ct${size})"><ellipse cx="50" cy="100" rx="48" ry="28" fill="#435766"/><path d="M26 100L40 77L50 88L60 77L74 100" fill="#364854"/><path d="M40 77L50 94L60 77" fill="#F0EAE0"/><path d="M41 78Q44 73 50 76Q44 79 41 78Z" fill="#3D4F5F"/><path d="M59 78Q56 73 50 76Q56 79 59 78Z" fill="#3D4F5F"/><ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/><rect x="42" y="70" width="16" height="9" rx="2" fill="#E8C4A0"/><path d="M28 43Q28 27 39 21Q50 16 61 21Q72 27 72 43Q72 53 68 58L63 64L56 68L50 70L44 68L37 64Q32 58 28 53Q28 48 28 43Z" fill="#EDBB92"/><path d="M37 64L44 68L50 70L56 68L63 64" fill="none" stroke="#B8865E" stroke-width="0.8" opacity="0.45"/><ellipse cx="28" cy="44" rx="3" ry="4.5" fill="#DFB088"/><ellipse cx="72" cy="44" rx="3" ry="4.5" fill="#DFB088"/><path d="M27 40Q27 15 50 10Q73 15 73 40L71 32Q69 16 50 13Q31 16 29 32Z" fill="#2D1F16"/><path d="M29 31Q30 13 50 10Q70 13 71 31Q69 17 50 13Q31 17 29 31Z" fill="#3D2A1E"/><path d="M33 23Q38 13 50 11Q58 11 63 15" fill="#3D2A1E" opacity="0.7"/><ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="40" cy="42.5" r="3" fill="#5B8C3E"/><circle cx="40" cy="42.5" r="2.2" fill="#4A7A30"/><circle cx="40.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/><ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="58" cy="42.5" r="3" fill="#5B8C3E"/><circle cx="58" cy="42.5" r="2.2" fill="#4A7A30"/><circle cx="58.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/><path d="M36 42.5Q41 40 46 42.5" fill="#EDBB92" opacity="0.5"/><path d="M54 42.5Q59 40 64 42.5" fill="#EDBB92" opacity="0.5"/><path d="M35 37Q38 35 41 35Q44 35 47 37" fill="#2D1F16" opacity="0.8"/><path d="M53 35.5Q56 33 59 33Q62 33 65 35.5" fill="#2D1F16" opacity="0.8"/><path d="M47 53Q48 55 50 55.5Q52 55 53 53" fill="none" stroke="#C8966E" stroke-width="0.7" stroke-linecap="round"/><path d="M43 60Q47 62 50 62Q53 62 57 60" fill="none" stroke="#9B7055" stroke-width="1" stroke-linecap="round"/><path d="M65 84Q72 76 69 68Q67 63 62 62" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/><path d="M65 84Q68 80 69 76" fill="none" stroke="#364854" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/><path d="M48 66Q50 62 56 61Q62 62 63 66Q62 69 58 70Q52 71 49 68Z" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/><circle cx="76" cy="28" r="6" fill="rgba(255,255,255,0.7)" stroke="#ccc" stroke-width="0.5"><animate attributeName="cy" values="28;24;28" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/></circle><circle cx="71" cy="37" r="3.5" fill="rgba(255,255,255,0.5)" stroke="#ddd" stroke-width="0.4"><animate attributeName="cy" values="37;34;37" dur="2.3s" repeatCount="indefinite"/></circle><circle cx="67" cy="42" r="2" fill="rgba(255,255,255,0.4)" stroke="#ddd" stroke-width="0.3"><animate attributeName="cy" values="42;40;42" dur="1.8s" repeatCount="indefinite"/></circle></g></svg>`;

function coopThinkingHTML(label = 'Coop is thinking...', sub = '') {
  return `<div class="coop-thinking-face-wrap"><div class="coop-thinking-orbit"></div>${COOP_THINKING_SVG(56)}</div><div class="coop-thinking-dots"><span></span><span></span><span></span></div><div class="coop-thinking-label">${label}</div>${sub ? `<div class="coop-thinking-sub">${sub}</div>` : ''}<div class="coop-thinking-bar"><div class="coop-thinking-bar-fill"></div></div>`;
}

// window.confirm() is unavailable in Chrome extension pages — any logic gated
// behind it silently never fires. Use this <dialog>-based replacement with the
// same shape: `if (await ciConfirm('Delete X?')) { ... }`.
function ciConfirm(message, { confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ci-confirm-dialog';
    dlg.style.cssText = 'border:1px solid var(--ci-border-default,#dfe3eb);border-radius:10px;padding:0;max-width:360px;background:var(--ci-bg-surface,#fff);color:var(--ci-text-primary,#1c2b3a);font:14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.15);';
    const btnDanger = 'background:#dc2626;color:#fff;border:none;';
    const btnPrimary = 'background:#2563eb;color:#fff;border:none;';
    dlg.innerHTML = `
      <div style="padding:18px 20px 4px 20px;font-weight:600;">${String(message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>
      <div style="padding:12px 20px 18px 20px;text-align:right;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" data-action="cancel" style="padding:7px 14px;border-radius:6px;border:1px solid var(--ci-border-default,#dfe3eb);background:transparent;color:inherit;cursor:pointer;font-size:13px;">${cancelLabel}</button>
        <button type="button" data-action="confirm" style="padding:7px 14px;border-radius:6px;${danger ? btnDanger : btnPrimary};cursor:pointer;font-size:13px;font-weight:600;">${confirmLabel}</button>
      </div>`;
    document.body.appendChild(dlg);
    const cleanup = (result) => { try { dlg.close(); } catch(_){} dlg.remove(); resolve(result); };
    dlg.querySelector('[data-action=confirm]').addEventListener('click', () => cleanup(true));
    dlg.querySelector('[data-action=cancel]').addEventListener('click', () => cleanup(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cleanup(false); });
    try { dlg.showModal(); } catch(_) { dlg.setAttribute('open', ''); }
    dlg.querySelector('[data-action=confirm]').focus();
  });
}

let _cachedUserName = '';
chrome.storage.sync.get(['prefs'], d => { _cachedUserName = (d.prefs && (d.prefs.name || d.prefs.fullName)) || ''; });

let entry = null;
let allCompanies = [];
// _deepFitInFlight removed — deep fit unified into scoreOpportunity
let allKnownTags = [];
let customCompanyStages = [];
let customOpportunityStages = [];
let customFieldDefs = []; // user-created fields
let gmailUserEmail = ''; // user's own Gmail address, used to exclude self from Known Contacts
let _stageCelebrations = {}; // loaded from storage for confetti/sound on stage changes
let _researchAttempted = false; // guards against repeated RESEARCH_COMPANY calls per page session
let _cacheMetadata = null; // { ts, _usage } from researchCache for current company

// Auto-set "Action On" based on stage
// defaultActionStatus, autoNextStepForStage, applyAutoStage,
// parseLocalDate, truncLabel — provided by ui-utils.js

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

function getUpcomingCalendarEvent(entry) {
  const events = entry.cachedCalendarEvents || [];
  const now = Date.now();
  const twoWeeks = now + 14 * 24 * 60 * 60 * 1000;
  const future = events
    .filter(e => { const t = new Date(e.start).getTime(); return t > now && t <= twoWeeks; })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return future.length ? future[0] : null;
}

function isSemanticallySimlar(a, b) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const wa = norm(a), wb = norm(b);
  if (!wa.length || !wb.length) return false;
  const shared = wa.filter(w => wb.includes(w)).length;
  if (shared >= 2) return true;
  const names = s => (s.match(/\b[A-Z][a-z]{2,}/g) || []).map(n => n.toLowerCase());
  const namesA = names(a), namesB = names(b);
  return namesA.some(n => namesB.includes(n));
}

function autoPopulateNextStep(entry) {
  const upcoming = getUpcomingCalendarEvent(entry);
  if (!upcoming) return null;
  const eventTitle = (upcoming.summary || upcoming.title || '').trim();
  if (!eventTitle) return null;
  const eventDate = new Date(upcoming.start).toISOString().split('T')[0];
  const currentStep = (entry.nextStep || '').trim();
  const currentDate = entry.nextStepDate || '';
  if (currentDate === eventDate && currentStep) return null;
  if (!currentStep) return { nextStep: eventTitle, nextStepDate: eventDate };
  if (isSemanticallySimlar(currentStep, eventTitle)) return { nextStep: eventTitle, nextStepDate: eventDate };
  return { nextStep: eventTitle + ' → ' + currentStep, nextStepDate: eventDate };
}

function detectScheduledStatus(entry) {
  const events = entry.cachedCalendarEvents || [];
  const now = new Date();
  return events.some(e => new Date(e.start) > now);
}

const DEFAULT_FIELD_DEFS = [
  { id: 'companyWebsite',  label: 'Website',   type: 'url'  },
  { id: 'companyLinkedin', label: 'LinkedIn',  type: 'url'  },
  { id: 'employees',       label: 'Employees', type: 'text' },
  { id: 'funding',         label: 'Funding',   type: 'text' },
  { id: 'founded',         label: 'Founded',   type: 'text' },
  { id: 'industry',        label: 'Industry',  type: 'text' },
  { id: 'revenue',         label: 'Revenue',   type: 'text' },
  { id: 'companyType',     label: 'Type',      type: 'text' },
];

const DEFAULT_LAYOUT = {
  left:  ['opportunity', 'tags'],
  main:  [], // replaced by hardcoded hub tabs
  right: ['contacts', 'leadership', 'hiring'],
};

const PANEL_TITLES = {
  properties:    'Properties',
  stats:         'Company Stats',
  links:         'Links',
  tags:          'Tags',
  notes:         'Notes',
  overview:      'Overview',
  intel:         'Company Intel',
  reviews:       'Employee Reviews',
  leadership:    'Leadership',
  contacts:      'Contacts',
  opportunity:   'Overview',
  hiring:        'Hiring Signals',
  activity:      'Activity',
  chat:          'Coop',
};

const DEFAULT_COMPANY_STAGES = [
  { key: 'co_watchlist',  label: 'Watch List',     color: '#64748b' },
  { key: 'co_researching',label: 'Researching',    color: '#22d3ee' },
  { key: 'co_networking', label: 'Networking',     color: '#a78bfa' },
  { key: 'co_interested', label: 'Strong Interest',color: '#fb923c' },
  { key: 'co_applied',    label: 'Applied There',  color: '#60a5fa' },
  { key: 'co_archived',   label: 'Archived',       color: '#374151' },
];
const DEFAULT_OPP_STAGES = [
  { key: 'needs_review',    label: 'AI Scoring Queue',           color: '#64748b' },
  { key: 'want_to_apply',   label: 'Want to Apply',             color: '#22d3ee' },
  { key: 'applied',         label: 'Applied',                   color: '#60a5fa' },
  { key: 'intro_requested', label: 'Intro Requested',           color: '#a78bfa' },
  { key: 'conversations',   label: 'Conversations in Progress', color: '#fb923c' },
  { key: 'offer_stage',     label: 'Offer Stage',               color: '#a3e635' },
  { key: 'accepted',        label: 'Accepted',                  color: '#4ade80' },
  { key: 'rejected',        label: "Rejected / DQ'd",           color: '#f87171' },
];

let panelLayout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
let collapsedPanels = {};

// ── Bootstrap ──────────────────────────────────────────────────────────────

function init() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { showError('No company ID specified.'); return; }

  chrome.storage.local.get(['savedCompanies', 'allTags', 'companyStages', 'opportunityStages', 'customStages', 'companyFieldDefs', 'researchCache', 'gmailUserEmail', 'stageCelebrations'], data => {
    if (data.stageCelebrations) _stageCelebrations = data.stageCelebrations;
    allCompanies = data.savedCompanies || [];
    // Derive tags from actual entries — allTags can get stale if tags are removed from entries
    allKnownTags = [...new Set(allCompanies.flatMap(c => c.tags || []))].sort();
    customCompanyStages     = data.companyStages     || DEFAULT_COMPANY_STAGES;
    customOpportunityStages = data.opportunityStages || data.customStages || DEFAULT_OPP_STAGES;
    // Migration: rename old "Needs Review" labels → "AI Scoring Queue"
    if (customOpportunityStages[0]?.key === 'needs_review' && /needs.review/i.test(customOpportunityStages[0].label)) {
      customOpportunityStages[0].label = 'AI Scoring Queue';
      chrome.storage.local.set({ opportunityStages: customOpportunityStages });
    }
    customFieldDefs = data.companyFieldDefs || [];
    entry = allCompanies.find(c => c.id === id);
    if (!entry) { showError('Company not found.'); return; }

    gmailUserEmail = (data.gmailUserEmail || entry.gmailUserEmail || '').toLowerCase();

    // Deduplicate existing contacts by name (merges split records like two Noah Maffitts)
    if (entry.knownContacts?.length) {
      const deduped = deduplicateContacts(entry.knownContacts);
      if (deduped.length !== entry.knownContacts.length) {
        entry = { ...entry, knownContacts: deduped };
        saveEntry({ knownContacts: deduped });
      }
    }

    // Extract contacts from cached emails immediately (purges self, finds any missed contacts)
    if (entry.cachedEmails?.length) applyContactsFromEmails(entry.cachedEmails);

    // Also run mergeExtractedContacts on cached emails (idempotent — skips existing contacts)
    if (entry.cachedEmails?.length) {
      const cachedExtracted = [];
      for (const thread of entry.cachedEmails) {
        const parsed = parseEmailContactLocal(thread.from);
        if (parsed) cachedExtracted.push({ ...parsed, source: 'email' });
        if (thread.messages) {
          for (const msg of thread.messages) {
            const p = parseEmailContactLocal(msg.from);
            if (p) cachedExtracted.push({ ...p, source: 'email' });
          }
        }
      }
      if (cachedExtracted.length) mergeExtractedContacts(cachedExtracted);
    }

    // Backfill from LinkedIn firmographics (persisted)
    backfillFromLinkedinFirmo();

    // Backfill from research cache (persisted)
    backfillFromResearchCache();

    // If key fields still missing after backfill, try targeted re-enrichment
    setTimeout(() => {
      reEnrichMissingFields();
      // Run unified field sync on page load — fills gaps from existing data
      chrome.runtime.sendMessage({ type: 'SYNC_ENTRY_FIELDS', entryId: entry.id }, () => {
        void chrome.runtime.lastError;
        // Reload entry from storage to pick up any changes
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          const fresh = (savedCompanies || []).find(c => c.id === entry.id);
          if (fresh && fresh.jobTitle && !entry.jobTitle) {
            entry.jobTitle = fresh.jobTitle;
            renderHeader();
          }
        });
      });
    }, 1500);

    // Fill missing firmographic fields from research cache (display-only, not persisted)
    const cacheEntry = (data.researchCache || {})[entry.company?.toLowerCase()];
    const cached = cacheEntry?.data;
    if (cached) {
      if (!entry.funding  && cached.funding)  entry = { ...entry, funding:  cached.funding  };
      if (!entry.founded  && cached.founded)  entry = { ...entry, founded:  cached.founded  };
      if (!entry.industry && cached.industry) entry = { ...entry, industry: cached.industry };
      if (!entry.employees && cached.employees) entry = { ...entry, employees: cached.employees };
      if (!entry.revenue && cached.revenue) entry = { ...entry, revenue: cached.revenue };
      if (!entry.companyType && cached.companyType) entry = { ...entry, companyType: cached.companyType };
      if (!entry.techStack?.length && cached.techStack?.length) entry = { ...entry, techStack: cached.techStack };
      if (!entry.recentNews?.length && cached.recentNews?.length) entry = { ...entry, recentNews: cached.recentNews };
      if (!entry.jobListings?.length && cached.jobListings?.length) entry = { ...entry, jobListings: cached.jobListings };
    }
    // Store cache metadata (timestamp and usage info) for display in Intel tab
    if (cacheEntry) {
      _cacheMetadata = { ts: cacheEntry.ts, _usage: cacheEntry._usage };
    }

    // Pull website/LinkedIn from linked opportunity if missing on company entry
    const linkedOppForSync = allCompanies.find(o =>
      o.type === 'job' && (o.linkedCompanyId === id || o.company === entry.company)
    );
    if (linkedOppForSync) {
      const updates = {};
      if (!entry.companyWebsite  && linkedOppForSync.companyWebsite)  updates.companyWebsite  = linkedOppForSync.companyWebsite;
      if (!entry.companyLinkedin && linkedOppForSync.companyLinkedin) updates.companyLinkedin = linkedOppForSync.companyLinkedin;
      if (Object.keys(updates).length) saveEntry(updates);
    }

    // Load persisted layout
    try {
      const saved = localStorage.getItem('ci_co_layout_' + id);
      if (saved) panelLayout = JSON.parse(saved);
    } catch(e) {}

    // Migrate old panel names
    ['left','main','right'].forEach(col => {
      panelLayout[col] = panelLayout[col].map(p =>
        (p === 'stats' || p === 'links') ? 'properties' :
        p === 'opportunities' ? 'opportunity' : p
      );
      // Deduplicate
      panelLayout[col] = [...new Set(panelLayout[col])];
    });
    // Main column is now hardcoded hub tabs — clear any saved panels there
    panelLayout.main = [];
    // Notes moved to hub Notes tab — remove from left column
    panelLayout.left = panelLayout.left.filter(p => p !== 'notes');
    // Chat replaced by floating chat — remove from all columns
    ['left','main','right'].forEach(col => { panelLayout[col] = panelLayout[col].filter(p => p !== 'chat'); });
    // Opportunity moved to top-left — remove from right, ensure it's first in left
    panelLayout.right = panelLayout.right.filter(p => p !== 'opportunity');
    if (!panelLayout.left.includes('opportunity')) panelLayout.left.unshift('opportunity');
    else if (panelLayout.left[0] !== 'opportunity') {
      panelLayout.left = ['opportunity', ...panelLayout.left.filter(p => p !== 'opportunity')];
    }

    // Ensure all default panels are present
    const placed = new Set([...panelLayout.left, ...panelLayout.main, ...panelLayout.right]);
    const allDefaults = [...DEFAULT_LAYOUT.left, ...DEFAULT_LAYOUT.main, ...DEFAULT_LAYOUT.right];
    allDefaults.forEach(p => { if (!placed.has(p)) panelLayout.right.push(p); });

    // Load collapsed state
    try { collapsedPanels = JSON.parse(localStorage.getItem('ci_co_collapsed_' + id) || '{}'); } catch(e) {}

    document.title = `${entry.company} — Coop.ai`;
    renderHeader();
    renderColumns();
    if (typeof initChatPanels === 'function') initChatPanels(entry);
    initFloatingChat();

    // Auto-refresh on open — show cache immediately, fetch fresh in background
    loadHubEmails(true);
    loadHubMeetings(false);

    const focus = new URLSearchParams(location.search).get('focus');
    if (focus === 'opportunity') {
      setTimeout(() => {
        const panel = document.getElementById('panel-opportunity');
        if (panel) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          panel.classList.add('panel-focus-highlight');
          setTimeout(() => panel.classList.remove('panel-focus-highlight'), 2000);
        }
      }, 150);
    }
  });
}

function showError(msg) {
  document.getElementById('co-header').innerHTML = `<span style="color:#e5483b">${msg}</span>`;
}

function saveEntry(changes) {
  Object.assign(entry, changes);
  const idx = allCompanies.findIndex(c => c.id === entry.id);
  if (idx !== -1) allCompanies[idx] = entry;
  chrome.storage.local.set({ savedCompanies: allCompanies });
}

// Replace "microphone:" with the user's name in transcripts.
// Other speaker labels (real names resolved in granola.js, or fallback "speaker:") are
// handled here: "speaker:" is resolved to the other attendee when there is exactly one,
// or left as-is when the transcript already contains real names.
function resolveTranscriptSpeakers(transcript, meeting) {
  if (!transcript) return transcript;
  // "microphone" = the user (device-level label from Granola)
  const userName = (typeof _cachedUserName !== 'undefined' && _cachedUserName) || 'Me';

  // Only resolve the generic "speaker:" fallback label — real names are already in the
  // transcript when granola.js could match an attendee ID or name field.
  let genericSpeakerName = 'Other';
  const attendees = (meeting?.attendeeNames || meeting?.attendees || '').toString();
  if (attendees) {
    const myNameLower = userName.toLowerCase();
    const names = attendees.split(/[,;]/).map(n => n.trim()).filter(n =>
      n && n.length > 1 && !n.toLowerCase().includes(myNameLower)
    );
    // Only substitute the generic label when there is exactly one other attendee,
    // so we don't smear all attendee names onto a single line.
    if (names.length === 1) genericSpeakerName = names[0].split(' ')[0];
  }

  return transcript
    .replace(/^microphone:/gm, `${userName}:`)
    .replace(/^speaker:/gm, `${genericSpeakerName}:`)
    .replace(/\bmicrophone:/g, `${userName}:`)
    .replace(/\bspeaker:/g, `${genericSpeakerName}:`);
}

function backfillFromResearchCache() {
  return new Promise(resolve => {
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const key = entry.company?.toLowerCase();
      const cached = researchCache?.[key]?.data;
      if (!cached) { resolve(false); return; }
      const updates = {};
      if (!entry.companyWebsite && cached.companyWebsite) updates.companyWebsite = cached.companyWebsite;
      if (!entry.companyLinkedin && cached.companyLinkedin) updates.companyLinkedin = cached.companyLinkedin;
      if (!entry.employees && cached.employees) updates.employees = cached.employees;
      if (!entry.industry && cached.industry) updates.industry = cached.industry;
      if (!entry.funding && cached.funding) updates.funding = cached.funding;
      if (Object.keys(updates).length === 0) { resolve(false); return; }
      saveEntry(updates);
      resolve(true);
    });
  });
}

function backfillFromLinkedinFirmo() {
  const f = entry.linkedinFirmo;
  if (!f) return false;
  const updates = {};
  if (!entry.employees && f.employees) updates.employees = f.employees;
  if (!entry.industry && f.industry) updates.industry = f.industry;
  if (!entry.location && f.location) updates.location = f.location;
  if (Object.keys(updates).length === 0) return false;
  saveEntry(updates);
  return true;
}

// Re-enrich missing firmographic fields on page load
// If key fields are still null after cache backfill, do a targeted search
async function reEnrichMissingFields() {
  const missing = [];
  if (!entry.employees) missing.push('employees');
  if (!entry.funding) missing.push('funding');
  if (!entry.industry) missing.push('industry');
  if (!entry.companyLinkedin) missing.push('linkedin');
  if (missing.length === 0) return;

  console.log(`[ReEnrich] Missing fields for ${entry.company}:`, missing.join(', '));

  // Try a quick Serper search specifically for firmographics
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'QUICK_ENRICH_FIRMO',
        company: entry.company,
        domain: entry.companyWebsite || '',
        missing
      }, r => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(r);
      });
    });

    if (result && !result.error) {
      const updates = {};
      if (!entry.employees && result.employees) { updates.employees = result.employees; console.log(`[ReEnrich] Found employees: ${result.employees}`); }
      if (!entry.funding && result.funding) { updates.funding = result.funding; }
      if (!entry.industry && result.industry) { updates.industry = result.industry; }
      if (!entry.companyLinkedin && result.linkedin) { updates.companyLinkedin = result.linkedin; console.log(`[ReEnrich] Found LinkedIn: ${result.linkedin}`); }
      if (Object.keys(updates).length) {
        saveEntry(updates);
        // Update the overview display
        const empEl = document.querySelector('[data-field="employees"]');
        if (empEl && updates.employees) empEl.textContent = updates.employees;
        // Also update the research cache so this doesn't repeat
        chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
          const cache = researchCache || {};
          const key = entry.company.toLowerCase();
          if (cache[key]?.data) {
            Object.assign(cache[key].data, updates);
            chrome.storage.local.set({ researchCache: cache });
          }
        });
      }
    }
  } catch (e) {
    console.warn('[ReEnrich] Failed:', e.message);
  }
}

// Unified re-scoring: one call handles all context (JD + flags + emails + meetings + notes).
// Triggers: stage transition, manual Rescore button, role brief update.
// Does NOT trigger on email/meeting arrival — data accumulates, score catches up on stage change.
function maybeRescore(reason) {
  if (!entry.isOpportunity) return;
  const stage = entry.jobStage || 'needs_review';
  if (stage === 'rejected') return;

  console.log('[Rescore] Triggering unified score for', entry.company, '— reason:', reason);
  chrome.runtime.sendMessage({ type: 'SCORE_OPPORTUNITY', entryId: entry.id }, result => {
    void chrome.runtime.lastError;
    if (result && !result.error) {
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const fresh = (savedCompanies || []).find(c => c.id === entry.id);
        if (fresh) {
          Object.assign(entry, fresh);
          renderPanel('opportunity');
          bindPanelBodyEvents('opportunity');
        }
      });
    }
  });
}

function maybeExtractNextSteps() {
  const contextAge = Math.max(entry.cachedEmailsAt || 0, entry.cachedMeetingNotesAt || 0);
  const lastExtraction = entry.nextStepExtractedAt || 0;
  if (!contextAge || lastExtraction >= contextAge) return;
  if (entry.nextStepManuallySetAt && entry.nextStepManuallySetAt > lastExtraction) return;

  const emailContext = (entry.cachedEmails || []).slice(0, 5).map(e =>
    `- "${e.subject}" from ${e.from} (${e.date})`
  ).join('\n');

  chrome.runtime.sendMessage({
    type: 'EXTRACT_NEXT_STEPS',
    notes: entry.cachedMeetingNotes || null,
    transcripts: entry.cachedMeetingTranscript || null,
    calendarEvents: entry.cachedCalendarEvents || [],
    emailContext
  }, result => {
    void chrome.runtime.lastError;
    if (result?.nextStep || result?.nextStepDate) {
      saveEntry({
        nextStep: result.nextStep || null,
        nextStepDate: result.nextStepDate || null,
        nextStepSource: result.nextStepSource || null,
        nextStepEvidence: result.nextStepEvidence || null,
        nextStepExtractedAt: Date.now()
      });
      renderPanel('opportunity');
    }
  });
}

function saveLayout() {
  localStorage.setItem('ci_co_layout_' + entry.id, JSON.stringify(panelLayout));
}

function saveCollapsed() {
  localStorage.setItem('ci_co_collapsed_' + entry.id, JSON.stringify(collapsedPanels));
}

function stageColor(key, stages) {
  const s = stages.find(s => s.key === key);
  return s ? s.color : '#64748b';
}

// ── Header ─────────────────────────────────────────────────────────────────

function renderHeader() {
  const faviconDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const favicon = faviconDomain
    ? `<img class="hdr-favicon" src="https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64" alt="" onerror="this.style.display='none'">`
    : '';

  const statusColor = stageColor(entry.status || 'co_watchlist', customCompanyStages);
  const statusOptions = customCompanyStages.map(s =>
    `<option value="${s.key}" ${(entry.status || 'co_watchlist') === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const stars = [1,2,3,4,5].map(i =>
    `<button class="hdr-star ${(entry.rating||0) >= i ? 'filled' : ''}" data-val="${i}">★</button>`
  ).join('');

  const nameVal = (entry.company || '').replace(/"/g, '&quot;');
  const oppStageColor = entry.isOpportunity
    ? stageColor(entry.jobStage || 'needs_review', customOpportunityStages)
    : null;
  const oppStageOptions = customOpportunityStages.map(s =>
    `<option value="${s.key}" ${(entry.jobStage || 'needs_review') === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const hdr = document.getElementById('co-header');
  hdr.innerHTML = `
    <a href="saved.html" style="text-decoration:none;font-size:14px;font-weight:700;color:#f1f5f9;letter-spacing:-0.01em;margin-right:4px">Company<span style="color:#FF7A59">Intel</span></a>
    <div class="hdr-divider"></div>
    ${favicon}
    <input class="hdr-name-input" id="hdr-name" value="${nameVal}" placeholder="Company name">
    ${entry.isOpportunity
      ? `<div class="hdr-stage-group" style="margin-left:8px"><select class="hdr-status" id="hdr-opp-stage" style="border-color:${oppStageColor}66;color:${oppStageColor}">${oppStageOptions}</select></div>`
      : `<button class="hdr-opp-btn" id="hdr-add-opp" style="margin-left:8px">+ Add to Pipeline</button>`}
    <div class="hdr-spacer"></div>
    <div class="hdr-stage-group">
      <select class="hdr-status" id="hdr-status" style="border-color:${statusColor}66;color:${statusColor}">
        ${statusOptions}
      </select>
    </div>
    <div class="hdr-stars" id="hdr-stars"><span class="hdr-stars-label">Excitement</span>${stars}</div>
    <button class="hdr-refresh-btn" id="hdr-refresh-btn" title="Refresh all data"><span class="hdr-refresh-icon">↻</span></button>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('preferences.html')}" target="_blank">⚙ Setup</a>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('integrations.html')}" target="_blank" style="margin-left:4px">🔗</a>
    <a class="hdr-prefs-link" href="${chrome.runtime.getURL('docs.html')}" target="_blank" style="margin-left:4px">Docs</a>
  `;

  document.getElementById('hdr-back')?.addEventListener('click', () => window.close());

  // Editable company name
  const nameInput = document.getElementById('hdr-name');
  nameInput?.addEventListener('blur', () => {
    const val = nameInput.value.trim();
    if (val && val !== entry.company) {
      saveEntry({ company: val });
      document.title = `${val} — Coop.ai`;
    }
  });
  nameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

  document.getElementById('hdr-status')?.addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value, customCompanyStages);
    sel.style.borderColor = c + '66'; sel.style.color = c;
    saveEntry({ status: sel.value });
  });

  document.getElementById('hdr-opp-stage')?.addEventListener('change', e => {
    const sel = e.target;
    const c = stageColor(sel.value, customOpportunityStages);
    sel.style.borderColor = c + '66'; sel.style.color = c;
    // Record stage entry timestamp + clear timestamps for stages ahead when moving backward
    const toIdx = customOpportunityStages.findIndex(s => s.key === sel.value);
    const ts = { ...(entry.stageTimestamps || {}) };
    if (!ts[sel.value]) ts[sel.value] = Date.now();
    for (const s of customOpportunityStages) {
      const sIdx = customOpportunityStages.findIndex(st => st.key === s.key);
      if (sIdx > toIdx && ts[s.key]) delete ts[s.key];
    }
    const stageChanges = { jobStage: sel.value, stageTimestamps: ts };
    applyAutoStage(entry, sel.value, stageChanges);
    // Auto-seed applied date
    if (sel.value === 'applied' && !entry.appliedDate) {
      stageChanges.appliedDate = Date.now();
    }
    saveEntry(stageChanges);
    // Update Action On dropdown if visible
    const actionSel = document.getElementById('opp-action-status');
    if (actionSel && stageChanges.actionStatus) actionSel.value = stageChanges.actionStatus;
    // Fire celebration if configured
    const celebCfg = _getCelebrationConfig(sel.value);
    if (celebCfg) _fireCelebration({ ...celebCfg, stageKey: sel.value });
    // Auto-rescore on stage transition — unified scoring picks up all accumulated context
    if (sel.value !== 'rejected' && entry.isOpportunity) {
      maybeRescore('stage_transition');
    }
  });

  document.getElementById('hdr-stars')?.querySelectorAll('.hdr-star').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val);
      saveEntry({ rating: val });
      document.querySelectorAll('.hdr-star').forEach((s, i) => s.classList.toggle('filled', i < val));
    });
  });

  const addOppBtn = document.getElementById('hdr-add-opp');
  if (addOppBtn) addOppBtn.addEventListener('click', addToOpportunityPipeline);

  const viewPipelineBtn = document.getElementById('hdr-view-pipeline');
  if (viewPipelineBtn) viewPipelineBtn.addEventListener('click', () => renderPanel('opportunity'));

  const refreshBtn = document.getElementById('hdr-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
    refreshBtn.title = 'Refreshing...';

    // Show progress toast
    const toast = document.createElement('div');
    toast.id = 'refresh-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2d3e50;color:#e2e8f0;padding:10px 20px;border-radius:10px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);display:flex;align-items:center;gap:8px;';
    toast.innerHTML = `${COOP_THINKING_SVG(20)} <span id="refresh-status">Starting refresh...</span>`;
    document.body.appendChild(toast);
    const setStatus = t => { const s = document.getElementById('refresh-status'); if (s) s.textContent = t; };

    const tasks = [];

    // 1. Re-research company (clear cache, re-run)
    setStatus('Re-researching company...');
    try {
      // Clear cached research
      await new Promise(r => {
        chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
          const cache = researchCache || {};
          delete cache[entry.company.toLowerCase()];
          chrome.storage.local.set({ researchCache: cache }, r);
        });
      });
      const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const researchResult = await new Promise(r => {
        chrome.runtime.sendMessage({
          type: 'RESEARCH_COMPANY', company: entry.company, domain
        }, r);
      });
      if (researchResult && !researchResult.error) {
        const updates = {};
        if (researchResult.employees) updates.employees = researchResult.employees;
        if (researchResult.funding) updates.funding = researchResult.funding;
        if (researchResult.industry) updates.industry = researchResult.industry;
        if (researchResult.founded) updates.founded = researchResult.founded;
        if (researchResult.revenue) updates.revenue = researchResult.revenue;
        if (researchResult.companyType) updates.companyType = researchResult.companyType;
        if (researchResult.techStack?.length) updates.techStack = researchResult.techStack;
        if (researchResult.recentNews?.length) updates.recentNews = researchResult.recentNews;
        if (researchResult.companyWebsite) updates.companyWebsite = researchResult.companyWebsite;
        if (researchResult.companyLinkedin) updates.companyLinkedin = researchResult.companyLinkedin;
        if (researchResult.intelligence) {
          updates.intelligence = researchResult.intelligence;
          // Clear stale top-level fields so intelligence takes priority
          if (researchResult.intelligence.oneLiner) updates.oneLiner = researchResult.intelligence.oneLiner;
          if (researchResult.intelligence.category) updates.category = researchResult.intelligence.category;
        }
        if (researchResult.reviews?.length) updates.reviews = researchResult.reviews;
        if (researchResult.leaders?.length) updates.leaders = researchResult.leaders;
        if (Object.keys(updates).length) saveEntry(updates);
        tasks.push('research');
      }
    } catch (e) { console.warn('[MasterRefresh] Research failed:', e); }

    // 2. Refresh emails
    setStatus('Fetching emails...');
    loadHubEmails(true);
    tasks.push('emails');

    // 3. Refresh meetings (rebuild Granola index first)
    setStatus('Fetching meetings...');
    await new Promise(r => chrome.runtime.sendMessage({ type: 'GRANOLA_BUILD_INDEX' }, () => { void chrome.runtime.lastError; r(); }));
    loadHubMeetings(true);
    tasks.push('meetings');

    // 4. Re-enrich missing firmographics
    setStatus('Checking firmographics...');
    await reEnrichMissingFields();
    tasks.push('firmographics');

    // 5. Refresh role brief (if opportunity)
    if (entry.isOpportunity && entry.jobDescription) {
      setStatus('Regenerating role brief...');
      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'GENERATE_ROLE_BRIEF',
            company: entry.company, jobTitle: entry.jobTitle,
            jobDescription: entry.jobDescription,
            meetings: entry.cachedMeetings || [], emails: entry.cachedEmails || [],
            granolaNote: entry.cachedMeetingNotes || ''
          }, result => {
            if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
            if (result?.content) {
              const updates = { roleBrief: { content: result.content, generatedAt: Date.now() } };
              // Apply extracted fields from role brief
              if (result.briefFields) {
                if (result.briefFields.jobTitle && !entry.jobTitle) updates.jobTitle = result.briefFields.jobTitle;
                if (result.briefFields.baseSalaryRange && !entry.baseSalaryRange) updates.baseSalaryRange = result.briefFields.baseSalaryRange;
                if (result.briefFields.oteTotalComp && !entry.oteTotalComp) updates.oteTotalComp = result.briefFields.oteTotalComp;
                if (result.briefFields.equity && !entry.equity) updates.equity = result.briefFields.equity;
              }
              saveEntry(updates);
              tasks.push('role-brief');
            }
            resolve();
          });
        });
      } catch (e) { console.warn('[MasterRefresh] Role brief failed:', e); }
    }

    // 6. Unified field sync — background.js scans all data and fills gaps
    setStatus('Syncing fields...');
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'SYNC_ENTRY_FIELDS', entryId: entry.id }, r => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(r);
        });
      });
      tasks.push('field-sync');
    } catch (e) { console.warn('[MasterRefresh] Field sync failed:', e); }

    // Done — refresh the page UI
    setStatus(`Done! Updated: ${tasks.join(', ')}`);
    setTimeout(() => {
      toast.remove();
      // Reload the page to show all fresh data
      window.location.reload();
    }, 1500);
  });
}

function commitUrl(field, val) {
  const key = field === 'website' ? 'companyWebsite' : 'companyLinkedin';
  saveEntry({ [key]: val });
  renderHeader(); // re-render to show updated link/input state
  renderPanel('properties'); // keep properties panel in sync
}

function addToOpportunityPipeline() {
  saveEntry({ isOpportunity: true, jobStage: 'needs_review' });
  renderHeader();
  renderPanel('opportunity');
}

function createOpportunity() { addToOpportunityPipeline(); } // backward compat

// scoreToVerdict — provided by ui-utils.js

function generateFieldSuggestions(e) {
  const suggestions = {};
  const dismissed = e._dismissedSuggestions || {};

  // Helper: only suggest if field is empty and not dismissed
  const suggest = (field, value, source, confidence) => {
    if (!value || dismissed[field]) return;
    suggestions[field] = { value, source, confidence };
  };

  // 1. Role — auto-fill from jobTitle (always, no ambiguity)
  if (!e.jobTitle && e.jobMatch?.jobTitle) {
    suggest('jobTitle', e.jobMatch.jobTitle, 'Job match analysis', 'high');
  }

  // Normalize salary strings: "$90K/yr - $130K/yr" → "$90K - $130K"
  const normSalary = s => s ? s.replace(/\/yr/gi, '').replace(/\/year/gi, '').replace(/\s+/g, ' ').trim() : s;

  // 2. Base Salary — from stored fields or job match
  if (!e.baseSalaryRange) {
    const sal = e.jobMatch?.salary?.base || e.jobSnapshot?.salary || e.jobMatch?.baseSalaryRange;
    if (sal) suggest('baseSalaryRange', normSalary(sal), e.jobMatch?.salary?.base ? 'AI scoring' : 'Job posting', 'high');
  }

  // 3. OTE — from stored fields or job match
  if (!e.oteTotalComp) {
    const ote = e.jobMatch?.salary?.ote || e.jobSnapshot?.oteTotalComp || e.jobMatch?.oteTotalComp;
    if (ote) suggest('oteTotalComp', normSalary(ote), 'AI scoring', 'high');
  }

  // 4. Equity — from job match or snapshot
  if (!e.equity) {
    const eq = e.jobMatch?.equity || e.jobSnapshot?.equity;
    if (eq) suggest('equity', eq, 'Job posting', 'medium');
  }

  // 5. Work arrangement — from job snapshot or match
  // (not a text field — but useful context)

  // 6. Next Step — from upcoming calendar event
  const upcoming = getUpcomingCalendarEvent(e);
  if (!e.nextStep && upcoming) {
    const title = upcoming.summary || upcoming.title || '';
    if (title) suggest('nextStep', title, 'Calendar event', 'high');
  }

  // 7. Next Step Date — from upcoming calendar event
  if (!e.nextStepDate && upcoming) {
    const date = new Date(upcoming.start).toISOString().split('T')[0];
    suggest('nextStepDate', date, 'Calendar event', 'high');
  }

  // 8. Action On — infer from context
  if (!e.actionStatus || e.actionStatus === 'my_court') {
    // If there's a future calendar event, suggest "Scheduled"
    if (upcoming) suggest('actionStatus', 'scheduled', 'Upcoming meeting detected', 'high');
  }

  return suggestions;
}

function renderSuggestionPill(field, suggestion) {
  if (!suggestion) return '';
  return `<div class="field-suggestion" data-field="${field}" data-value="${escapeHtml(suggestion.value)}">
    <span class="suggestion-icon">\u2728</span>
    <span class="suggestion-value">${escapeHtml(suggestion.value)}</span>
    <span class="suggestion-source">${escapeHtml(suggestion.source)}</span>
    <button class="suggestion-accept" data-field="${field}" title="Accept">\u2713</button>
    <button class="suggestion-dismiss" data-field="${field}" title="Dismiss">\u2715</button>
  </div>`;
}

function buildOpportunity() {
  const propsHtml = buildProperties();

  // Auto-fill Role from job match (no suggestion pill — immediate)
  if (entry.isOpportunity && !entry.jobTitle && entry.jobMatch?.jobTitle) {
    entry.jobTitle = entry.jobMatch.jobTitle;
    saveEntry({ jobTitle: entry.jobTitle });
  }

  // Auto-fill comp fields from suggestions (show pill for provenance but pre-populate the input)
  if (entry.isOpportunity) {
    const normSal = s => s ? s.replace(/\/yr/gi, '').replace(/\/year/gi, '').replace(/\s+/g, ' ').trim() : s;
    if (!entry.baseSalaryRange) {
      const sal = entry.jobMatch?.salary?.base || entry.jobSnapshot?.salary || entry.jobMatch?.baseSalaryRange;
      if (sal) { entry.baseSalaryRange = normSal(sal); saveEntry({ baseSalaryRange: entry.baseSalaryRange }); }
    }
    if (!entry.oteTotalComp) {
      const ote = entry.jobMatch?.salary?.ote || entry.jobSnapshot?.oteTotalComp || entry.jobMatch?.oteTotalComp;
      if (ote) { entry.oteTotalComp = normSal(ote); saveEntry({ oteTotalComp: entry.oteTotalComp }); }
    }
    if (!entry.equity) {
      const eq = entry.jobMatch?.equity || entry.jobSnapshot?.equity;
      if (eq) { entry.equity = eq; saveEntry({ equity: entry.equity }); }
    }
  }

  // Fix duplicate/concatenated titles (data cleanup)
  if (entry.jobTitle) {
    const title = entry.jobTitle;
    // Detect repeated title: "Senior Account Manager Senior Account Manager with..."
    const words = title.split(/\s+/);
    const half = Math.floor(words.length / 2);
    if (half >= 2) {
      const firstHalf = words.slice(0, half).join(' ').toLowerCase();
      const rest = title.toLowerCase();
      if (rest.indexOf(firstHalf) === 0 && rest.indexOf(firstHalf, 1) > 0) {
        // Found duplicate — take the longer variant
        const secondStart = rest.indexOf(firstHalf, 1);
        const cleaned = title.slice(secondStart).trim();
        entry.jobTitle = cleaned;
        saveEntry({ jobTitle: cleaned });
      }
    }
  }

  // Auto-clear past-due next step date
  if (entry.nextStepDate) {
    const today = new Date().toISOString().split('T')[0];
    if (entry.nextStepDate < today) {
      saveEntry({ nextStepDate: null, nextStep: null });
      entry.nextStepDate = null;
      entry.nextStep = null;
    }
  }

  const suggestions = entry.isOpportunity ? generateFieldSuggestions(entry) : {};

  if (!entry.isOpportunity) {
    return `${propsHtml}
    <div id="prop-add-area">
      <button class="prop-add-btn" id="prop-add-btn">+ Add field</button>
    </div>
    <div class="opp-divider"></div>
    <button class="new-opp-btn" id="add-opp-btn">+ Add to Opportunity Pipeline</button>`;
  }

  const stageOptions = customOpportunityStages.map(s =>
    `<option value="${s.key}" ${entry.jobStage === s.key ? 'selected' : ''}>${s.label}</option>`
  ).join('');
  const title = (entry.jobTitle && entry.jobTitle !== 'New Opportunity') ? entry.jobTitle : '';

  const matchHtml = entry.jobMatch?.score ? (() => {
    const v = scoreToVerdict(entry.jobMatch.score);
    const sc = stageColor(entry.jobStage, customOpportunityStages);
    return `<div class="prop-row">
      <span class="prop-label">Match</span>
      <div class="prop-val-wrap" style="gap:6px">
        <span style="font-size:13px;font-weight:700;color:#33475b">${Number(entry.jobMatch.score).toFixed(1)}/10</span>
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(45,62,80,0.07);color:#516f90">${v.label}</span>
      </div>
    </div>`;
  })() : '';

  const jobUrlHtml = `<div class="prop-row">
    <span class="prop-label">Posting URL</span>
    <div class="prop-val-wrap">
      <input class="prop-input${entry.jobUrl ? '' : ' prop-empty'}" id="opp-job-url" type="url" value="${(entry.jobUrl || '').replace(/"/g, '&quot;')}" placeholder="https://…">
    </div>
  </div>`;

  return `${propsHtml}
    <div class="opp-divider"></div>
    <div class="prop-row">
      <span class="prop-label">Stage</span>
      <div class="prop-val-wrap">
        <select class="prop-input" id="opp-stage-select">${stageOptions}</select>
      </div>
    </div>
    <div class="prop-row">
      <span class="prop-label">Role</span>
      <div class="prop-val-wrap">
        ${title && entry.jobUrl
          ? `<a href="${safeUrl(entry.jobUrl)}" target="_blank" class="prop-link-display" id="opp-title-link" style="font-weight:600;font-size:13px">${title}</a><button class="prop-link-edit" id="opp-title-edit-btn" title="Edit">✎</button>`
          : `<input class="prop-input ${!title ? 'prop-empty' : ''}" id="opp-title-input" value="${title}" placeholder="Add job title…">`}
      </div>
    </div>
    ${jobUrlHtml}
    ${matchHtml}
    ${entry.baseSalaryRange || entry.oteTotalComp || entry.equity || suggestions.baseSalaryRange || suggestions.oteTotalComp || suggestions.equity ? `
    <div class="prop-row${!entry.baseSalaryRange && suggestions.baseSalaryRange ? ' has-suggestion' : ''}">
      <span class="prop-label">Base Salary</span>
      <div class="prop-val-wrap"><input class="prop-input${entry.baseSalaryRange ? '' : ' prop-empty'}" id="opp-base-salary" value="${(entry.baseSalaryRange || '').replace(/"/g,'&quot;')}" placeholder="e.g. $150K - $180K"></div>
      ${!entry.baseSalaryRange && suggestions.baseSalaryRange ? renderSuggestionPill('baseSalaryRange', suggestions.baseSalaryRange) : ''}
    </div>
    <div class="prop-row${!entry.oteTotalComp && suggestions.oteTotalComp ? ' has-suggestion' : ''}">
      <span class="prop-label">OTE / Total</span>
      <div class="prop-val-wrap"><input class="prop-input${entry.oteTotalComp ? '' : ' prop-empty'}" id="opp-ote" value="${(entry.oteTotalComp || '').replace(/"/g,'&quot;')}" placeholder="e.g. $250K OTE"></div>
      ${!entry.oteTotalComp && suggestions.oteTotalComp ? renderSuggestionPill('oteTotalComp', suggestions.oteTotalComp) : ''}
    </div>
    <div class="prop-row${!entry.equity && suggestions.equity ? ' has-suggestion' : ''}">
      <span class="prop-label">Equity</span>
      <div class="prop-val-wrap"><input class="prop-input${entry.equity ? '' : ' prop-empty'}" id="opp-equity" value="${(entry.equity || '').replace(/"/g,'&quot;')}" placeholder="e.g. 0.1% - 0.2%"></div>
      ${!entry.equity && suggestions.equity ? renderSuggestionPill('equity', suggestions.equity) : ''}
    </div>
    ${entry.compSource ? `<div class="prop-row"><span class="prop-label" style="font-size:10px;color:#94a3b8">Comp Source</span><div class="prop-val-wrap"><span style="font-size:11px;color:#94a3b8">${entry.compAutoExtracted ? '✨ ' : ''}${entry.compSource}</span></div></div>` : ''}
    ` : `
    <div class="prop-row${suggestions.baseSalaryRange ? ' has-suggestion' : ''}">
      <span class="prop-label">Base Salary</span>
      <div class="prop-val-wrap"><input class="prop-input prop-empty" id="opp-base-salary" value="" placeholder="e.g. $150K - $180K"></div>
      ${suggestions.baseSalaryRange ? renderSuggestionPill('baseSalaryRange', suggestions.baseSalaryRange) : ''}
    </div>
    `}
    <div class="prop-row">
      <span class="prop-label">Action On</span>
      <div class="prop-val-wrap">
        <select class="prop-input" id="opp-action-status" style="min-height:auto;padding:6px 8px">
          <option value="my_court" ${(entry.actionStatus || 'my_court') === 'my_court' ? 'selected' : ''}>🏀 My Court</option>
          <option value="their_court" ${entry.actionStatus === 'their_court' ? 'selected' : ''}>⏳ Their Court</option>
          <option value="scheduled" ${entry.actionStatus === 'scheduled' ? 'selected' : ''}>📅 Scheduled</option>
        </select>
      </div>
    </div>
    ${(() => {
      const nsSrc = entry.nextStepSource;
      const nsEv = entry.nextStepEvidence;
      if (!entry.nextStep && !entry.nextStepDate) return '';
      const lbl = !nsSrc ? 'Manually set' : nsSrc === 'calendar' ? 'From calendar event' : nsSrc === 'transcript' ? 'From meeting transcript' : nsSrc === 'notes' ? 'From meeting notes' : nsSrc === 'email' ? 'From recent email' : `Source: ${nsSrc}`;
      const icon = !nsSrc ? '✎' : nsSrc === 'calendar' ? '📅' : nsSrc === 'transcript' ? '🎙' : nsSrc === 'notes' ? '📝' : nsSrc === 'email' ? '✉' : '·';
      const tip = (lbl + (nsEv ? ` — "${nsEv}"` : '')).replace(/"/g, '&quot;');
      return `<span class="next-step-source-pill" title="${tip}" style="display:none;"></span>`;
    })()}
    <div class="prop-row${!entry.nextStep && suggestions.nextStep ? ' has-suggestion' : ''}">
      <span class="prop-label">Next Step</span>
      <div class="prop-val-wrap" style="display:flex;align-items:center;gap:6px;">
        <input class="prop-input ${!entry.nextStep ? 'prop-empty' : ''}" id="opp-next-step-input" value="${(entry.nextStep || '').replace(/"/g,'&quot;')}" placeholder="Next step…" style="flex:1;">
        ${entry.nextStep ? (() => {
          const nsSrc = entry.nextStepSource;
          const nsEv = entry.nextStepEvidence;
          const lbl = !nsSrc ? 'Manually set' : nsSrc === 'calendar' ? 'From calendar event' : nsSrc === 'transcript' ? 'From meeting transcript' : nsSrc === 'notes' ? 'From meeting notes' : nsSrc === 'email' ? 'From recent email' : `Source: ${nsSrc}`;
          const icon = !nsSrc ? '✎' : nsSrc === 'calendar' ? '📅' : nsSrc === 'transcript' ? '🎙' : nsSrc === 'notes' ? '📝' : nsSrc === 'email' ? '✉' : '·';
          const tip = (lbl + (nsEv ? ` — "${nsEv}"` : '')).replace(/"/g, '&quot;');
          return `<span class="prop-source-icon" title="${tip}" style="font-size:11px;opacity:0.55;cursor:help;">${icon}</span>`;
        })() : ''}
      </div>
      ${!entry.nextStep && suggestions.nextStep ? renderSuggestionPill('nextStep', suggestions.nextStep) : ''}
    </div>
    <div class="prop-row${!entry.nextStepDate && suggestions.nextStepDate ? ' has-suggestion' : ''}">
      <span class="prop-label">Next Step Date</span>
      <div class="prop-val-wrap" style="display:flex;align-items:center;gap:6px;">
        <input class="prop-input${entry.nextStepDate ? ' has-value' : ''}" id="opp-next-step-date" type="date" value="${entry.nextStepDate || ''}" style="flex:1;">
        ${entry.nextStepDate ? (() => {
          const nsSrc = entry.nextStepSource;
          const nsEv = entry.nextStepEvidence;
          const lbl = !nsSrc ? 'Manually set' : nsSrc === 'calendar' ? 'From calendar event' : nsSrc === 'transcript' ? 'From meeting transcript' : nsSrc === 'notes' ? 'From meeting notes' : nsSrc === 'email' ? 'From recent email' : `Source: ${nsSrc}`;
          const icon = !nsSrc ? '✎' : nsSrc === 'calendar' ? '📅' : nsSrc === 'transcript' ? '🎙' : nsSrc === 'notes' ? '📝' : nsSrc === 'email' ? '✉' : '·';
          const tip = (lbl + (nsEv ? ` — "${nsEv}"` : '')).replace(/"/g, '&quot;');
          return `<span class="prop-source-icon" title="${tip}" style="font-size:11px;opacity:0.55;cursor:help;">${icon}</span>`;
        })() : ''}
      </div>
      ${!entry.nextStepDate && suggestions.nextStepDate ? renderSuggestionPill('nextStepDate', suggestions.nextStepDate) : ''}
    </div>
    ${entry.appliedDate || entry.stageTimestamps?.applied ? (() => {
      const ts = entry.appliedDate || entry.stageTimestamps?.applied;
      const dateVal = ts ? new Date(ts).toISOString().split('T')[0] : '';
      return `<div class="prop-row">
        <span class="prop-label">Applied Date</span>
        <div class="prop-val-wrap">
          <input class="prop-input${dateVal ? ' has-value' : ''}" id="opp-applied-date" type="date" value="${dateVal}">
        </div>
      </div>`;
    })() : ''}
    ${(() => {
      const act = computeLastActivity(entry);
      if (!act.label) return '';
      const d = new Date(act.timestamp);
      return `<div class="prop-row">
        <span class="prop-label">Last Activity</span>
        <div class="prop-val-wrap" title="${act.label} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}"><span style="font-weight:600">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span> <span style="color:#516f90">${act.label}</span></div>
      </div>`;
    })()}
    <div id="prop-add-area">
      <button class="prop-add-btn" id="prop-add-btn">+ Add field</button>
    </div>
  `;
}

// Legacy stub (kept only while old type:'job' data exists — migration handles cleanup)
function _legacyCreateJobRecord() {
  const newEntry = {
    id: Date.now().toString(), type: 'job',
    company: entry.company,
    companyWebsite: entry.companyWebsite || '',
    companyLinkedin: entry.companyLinkedin || '',
    intelligence: entry.intelligence || null,
    reviews: entry.reviews || [],
    leaders: entry.leaders || [],
    oneLiner: entry.oneLiner || '',
    category: entry.category || '',
    employees: entry.employees || '',
    funding: entry.funding || '',
    founded: entry.founded || '',
    industry: entry.industry || '',
    linkedCompanyId: entry.id,
    status: 'needs_review',
    savedAt: Date.now(),
    jobTitle: 'New Opportunity',
  };
  allCompanies = [newEntry, ...allCompanies];
  chrome.storage.local.set({ savedCompanies: allCompanies }, () => {
    coopNavigate(chrome.runtime.getURL('opportunity.html') + '?id=' + newEntry.id);
    renderHeader(); // refresh button to "View Opportunity"
    renderPanel('opportunities'); // refresh opportunities panel if visible
  });
}

// ── Columns & Panels ───────────────────────────────────────────────────────

function renderColumns() {
  ['left', 'right'].forEach(col => {
    const colEl = document.getElementById('col-' + col);
    colEl.innerHTML = panelLayout[col].map(pid => buildPanelHTML(pid)).join('');
  });
  renderMainTabs();
  bindPanelEvents();
  bindDragDrop();
}

function buildActivityTimeline(e) {
  const events = [];

  // A. Emails
  (e.cachedEmails || []).forEach(thread => {
    let ts = 0, senderName = '';
    if (thread.messages && thread.messages.length) {
      const lastMsg = thread.messages[thread.messages.length - 1];
      ts = new Date(lastMsg.date).getTime();
      if (lastMsg.from) { const m = lastMsg.from.match(/^([^<]+)/); senderName = m ? m[1].trim().split(/\s+/)[0] : ''; }
    }
    if (!ts || isNaN(ts)) ts = thread.date ? new Date(thread.date).getTime() : 0;
    if (!ts || isNaN(ts)) ts = thread.internalDate ? parseInt(thread.internalDate) : 0;
    if (!ts || isNaN(ts)) return;
    events.push({
      ts, icon: '\u{1F4E7}', badgeType: 'email', badge: 'Email',
      title: thread.subject || 'No subject',
      subtitle: senderName ? 'From ' + senderName : (thread.from || '').replace(/<.*>/, '').trim() || null,
      preview: thread.snippet ? thread.snippet.slice(0, 120) : null
    });
  });

  // B. Calendar events (past)
  const now = Date.now();
  (e.cachedCalendarEvents || []).forEach(evt => {
    const ts = new Date(evt.start).getTime();
    if (!ts || isNaN(ts) || ts > now) return;
    const attendees = (evt.attendees || []).filter(a => !a.self).slice(0, 3).map(a => a.displayName || a.email?.split('@')[0] || '').filter(Boolean);
    events.push({
      ts, icon: '\u{1F4C5}', badgeType: 'meeting', badge: 'Meeting',
      title: evt.summary || evt.title || 'Calendar event',
      subtitle: attendees.length ? 'with ' + attendees.join(', ') : null,
      preview: evt.location || null
    });
  });

  // C. Granola meetings
  (e.cachedMeetings || []).forEach(m => {
    let ts = m.createdAt ? parseLocalDate(m.createdAt) : 0;
    if (!ts) ts = parseLocalDate(m.date);
    if (!ts || isNaN(ts)) return;
    events.push({
      ts, icon: '\u{1F399}\uFE0F', badgeType: 'call', badge: 'Call',
      title: m.title || 'Meeting',
      subtitle: 'Granola recording',
      preview: m.summary ? m.summary.slice(0, 120) : 'Meeting notes available'
    });
  });

  // D. Activity log
  const typeIcons = { linkedin_dm: '\u{1F4AC}', phone_call: '\u{1F4DE}', coffee_chat: '\u2615', text: '\u{1F4AC}', referral: '\u{1F91D}', applied: '\u2705', other: '\u{1F4DD}' };
  const typeNames = { linkedin_dm: 'LinkedIn DM', phone_call: 'Phone Call', coffee_chat: 'Coffee Chat', text: 'Text', referral: 'Referral', applied: 'Applied', other: 'Other' };
  (e.activityLog || []).forEach(log => {
    const ts = parseLocalDate(log.date);
    if (!ts) return;
    events.push({
      ts, icon: typeIcons[log.type] || '\u{1F4DD}', badgeType: 'activity', badge: typeNames[log.type] || 'Activity',
      title: typeNames[log.type] || 'Activity',
      fullNote: log.note || '',
      isActivity: true
    });
  });

  // E. Applied date
  if (e.appliedDate && e.appliedDate > 0) {
    const hasLogApplied = (e.activityLog || []).some(a => a.type === 'applied' && Math.abs(new Date(a.date).getTime() - e.appliedDate) < 86400000);
    if (!hasLogApplied) {
      events.push({
        ts: e.appliedDate, icon: '\u2705', badgeType: 'milestone', badge: 'Milestone',
        title: 'Applied',
        subtitle: e.jobTitle ? 'for ' + e.jobTitle : null,
        preview: null
      });
    }
  }

  // F. Stage changes
  const allStages = [...(customOpportunityStages || []), ...(customCompanyStages || [])];
  for (const [key, ts] of Object.entries(e.stageTimestamps || {})) {
    if (/^\d{10,}$/.test(key)) continue;
    if (typeof ts !== 'number' || ts <= 0) continue;
    const sd = allStages.find(s => s.key === key);
    events.push({
      ts, icon: '\u{1F4CB}', badgeType: 'stage', badge: 'Stage',
      title: sd ? sd.label : key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      subtitle: 'Pipeline stage reached',
      preview: null, isStage: true
    });
  }

  // Dedup: merge calendar + Granola within 24h with shared title words
  const deduped = [];
  const used = new Set();
  events.sort((a, b) => b.ts - a.ts);
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const ev = events[i];
    if (ev.badgeType === 'meeting' || ev.badgeType === 'call') {
      for (let j = i + 1; j < events.length; j++) {
        if (used.has(j)) continue;
        const other = events[j];
        if ((other.badgeType === 'meeting' || other.badgeType === 'call') && Math.abs(ev.ts - other.ts) < 86400000) {
          const wordsA = (ev.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const wordsB = (other.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
          if (wordsA.some(w => wordsB.includes(w))) {
            if (other.badgeType === 'call') { ev.icon = '\u{1F4C5}\u{1F399}\uFE0F'; ev.title = other.title; ev.preview = other.preview; ev.badgeType = 'call'; ev.badge = 'Call'; }
            else { ev.icon = '\u{1F4C5}\u{1F399}\uFE0F'; ev.preview = ev.preview || other.preview; }
            used.add(j);
          }
        }
      }
    }
    deduped.push(ev);
  }

  if (!deduped.length) return '<div class="p-empty">No activity tracked yet. Emails, meetings, and manual logs will appear here as they\'re detected.</div>';

  // Filter out user-removed activities
  const removedSet = new Set((e.removedActivities || []).map(r => r));
  const filtered = deduped.filter(ev => {
    const key = `${ev.badgeType}-${ev.ts}-${(ev.title || '').slice(0, 30)}`;
    return !removedSet.has(key);
  });

  if (!filtered.length) return '<div class="p-empty">No activity tracked yet. Emails, meetings, and manual logs will appear here as they\'re detected.</div>';

  return filtered.map((ev, idx) => {
    const dateStr = new Date(ev.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const actKey = `${ev.badgeType}-${ev.ts}-${(ev.title || '').slice(0, 30)}`;
    const headerHtml = `
      <div class="timeline-header">
        <span class="timeline-badge timeline-badge-${ev.badgeType}">${ev.badge}</span>
        <span class="timeline-date">${dateStr}</span>
        <button class="timeline-remove-btn" data-act-key="${escapeHtml(actKey)}" title="Remove this activity">&times;</button>
      </div>
      <div class="timeline-title">${escapeHtml(ev.title)}</div>`;
    if (ev.isActivity) {
      const preview = escapeHtml((ev.fullNote || '').replace(/\s+/g, ' ').slice(0, 120));
      return `<div class="timeline-entry timeline-${ev.badgeType}">
        <div class="timeline-dot-col">
          <div class="timeline-dot">${ev.icon}</div>
          <div class="timeline-line"></div>
        </div>
        <div class="timeline-content">
          ${headerHtml}
          <div class="timeline-note" data-expanded="false">
            <div class="timeline-note-head" role="button" tabindex="0" aria-expanded="false" aria-controls="note-body-${idx}">
              <span class="timeline-note-chev">&#9658;</span>
              <span class="timeline-note-preview">${preview}</span>
            </div>
            <div class="timeline-note-body" id="note-body-${idx}">${escapeHtml(ev.fullNote)}</div>
          </div>
        </div>
      </div>`;
    }
    return `<div class="timeline-entry timeline-${ev.badgeType}${ev.isStage ? ' timeline-stage' : ''}">
      <div class="timeline-dot-col">
        <div class="timeline-dot">${ev.icon}</div>
        <div class="timeline-line"></div>
      </div>
      <div class="timeline-content">
        ${headerHtml}
        ${ev.subtitle ? `<div class="timeline-subtitle">${escapeHtml(ev.subtitle)}</div>` : ''}
        ${ev.preview ? `<div class="timeline-preview">${escapeHtml(ev.preview)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function initActivityTab() {
  const container = document.getElementById('activity-timeline');
  if (!container) return;
  container.innerHTML = buildActivityTimeline(entry);

  // Bind remove buttons on timeline entries
  container.querySelectorAll('.timeline-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.actKey;
      const removed = [...new Set([...(entry.removedActivities || []), key])];
      saveEntry({ removedActivities: removed });
      entry.removedActivities = removed;
      initActivityTab();
    });
  });

  // Bind expand/collapse on activity note shells
  container.querySelectorAll('.timeline-note-head').forEach(head => {
    const toggle = () => {
      const shell = head.closest('.timeline-note');
      const expanded = shell.getAttribute('data-expanded') === 'true';
      shell.setAttribute('data-expanded', expanded ? 'false' : 'true');
      head.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // Inject "Log activity" button + form into Activity tab
  const logSection = document.getElementById('activity-log-section');
  if (logSection) {
    logSection.innerHTML = `
      <button class="mtg-add-btn" id="activity-log-btn-act" style="margin-top:12px">+ Log activity</button>
      <div id="activity-log-form-act" style="display:none" class="mtg-add-form">
        <div class="mtg-add-title">Log an activity</div>
        <div class="mtg-add-fields">
          <select class="mtg-add-input" id="al-type-act">
            <option value="linkedin_dm">LinkedIn DM</option>
            <option value="phone_call">Phone Call</option>
            <option value="coffee_chat">Coffee Chat</option>
            <option value="text">Text Message</option>
            <option value="referral">Referral / Intro</option>
            <option value="email_sent">Email Sent</option>
            <option value="other">Other</option>
          </select>
          <textarea class="mtg-add-input mtg-add-textarea" id="al-note-act" placeholder="What happened? Paste full message thread, call debrief, or intro context — all of it is preserved." rows="4"></textarea>
          <input type="date" class="mtg-add-input" id="al-date-act" style="width:auto" value="${new Date().toISOString().slice(0,10)}">
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="mtg-add-save" id="al-save-act">Save</button>
            <button class="mtg-add-cancel" id="al-cancel-act">Cancel</button>
          </div>
        </div>
      </div>`;

    document.getElementById('activity-log-btn-act')?.addEventListener('click', () => {
      document.getElementById('activity-log-form-act').style.display = 'block';
    });
    document.getElementById('al-cancel-act')?.addEventListener('click', () => {
      document.getElementById('activity-log-form-act').style.display = 'none';
    });
    document.getElementById('al-save-act')?.addEventListener('click', () => {
      const type = document.getElementById('al-type-act').value;
      const note = document.getElementById('al-note-act').value.trim();
      const date = document.getElementById('al-date-act').value;
      if (!date) return;
      entry.activityLog = entry.activityLog || [];
      entry.activityLog.push({ type, note, date, createdAt: Date.now() });
      saveEntry({ activityLog: entry.activityLog });
      document.getElementById('activity-log-form-act').style.display = 'none';
      document.getElementById('al-note-act').value = '';
      container.innerHTML = buildActivityTimeline(entry);
    });
  }
}

// E1: Email → task auto-extraction
const E1_EXCLUDED_STAGES = new Set(['dq', 'closed_lost', 'closed', 'rejected', 'withdrawn', 'scoring_queue', 'apply_queue']);
function isE1Eligible(e) {
  if (!e || !e.isOpportunity) return false;
  const stage = (e.jobStage || e.status || '').toLowerCase();
  return !E1_EXCLUDED_STAGES.has(stage);
}

function normalizeTaskText(s) {
  return (s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenJaccard(a, b) {
  const A = new Set(normalizeTaskText(a).split(' ').filter(w => w.length > 2));
  const B = new Set(normalizeTaskText(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(w => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}

function maybeExtractEmailTasks(newEmails) {
  if (!newEmails || !newEmails.length) return;
  if (!isE1Eligible(entry)) return;
  chrome.storage.local.get(['userTasks'], data => {
    const allTasks = data.userTasks || [];
    const companyName = entry.company;
    const existingForCompany = allTasks.filter(t => t.company === companyName);
    const openTexts = existingForCompany.filter(t => !t.completed).map(t => t.text);

    chrome.runtime.sendMessage({
      type: 'EXTRACT_EMAIL_TASKS',
      entry: { company: entry.company, jobTitle: entry.jobTitle, jobStage: entry.jobStage, status: entry.status, actionStatus: entry.actionStatus },
      emails: newEmails,
      existingTaskTexts: openTexts
    }, result => {
      void chrome.runtime.lastError;
      const proposed = result?.tasks || [];
      if (!proposed.length) return;

      chrome.storage.local.get(['userTasks'], d2 => {
        const tasks = d2.userTasks || [];
        const companyTasks = tasks.filter(t => t.company === companyName);
        const existingSourceIds = new Set(companyTasks.map(t => t.sourceEmailId).filter(Boolean));
        let added = 0;
        proposed.forEach(p => {
          if (p.sourceEmailId && existingSourceIds.has(p.sourceEmailId)) return;
          const dupe = companyTasks.some(t => !t.completed && tokenJaccard(t.text, p.text) > 0.85);
          if (dupe) return;
          tasks.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: p.text,
            company: companyName,
            companyId: entry.id,
            dueDate: p.dueDate || null,
            priority: p.priority === 'low' ? 'low' : 'normal',
            completed: false,
            createdAt: Date.now(),
            source: 'email',
            sourceEmailId: p.sourceEmailId || null,
            reviewed: false,
            rationale: p.rationale || null
          });
          added++;
        });
        if (added) {
          chrome.storage.local.set({ userTasks: tasks }, () => {
            if (document.getElementById('company-tasks-container')) renderCompanyTasks();
          });
        }
      });
    });
  });
}

function rescanAllEmailsForTasks() {
  const cached = (entry.cachedEmails || []).slice(0, 10);
  if (!cached.length) return;
  maybeExtractEmailTasks(cached);
}

function initTasksTab() {
  const container = document.getElementById('company-tasks-container');
  if (!container) return;
  renderCompanyTasks();
}

function renderCompanyTasks() {
  const container = document.getElementById('company-tasks-container');
  if (!container) return;
  const companyName = entry.company;

  chrome.storage.local.get(['userTasks'], data => {
    const allTasks = data.userTasks || [];
    const companyTasks = allTasks.filter(t => t.company === companyName);
    const priVal = p => p === 'high' ? 0 : p === 'normal' ? 1 : 2;
    companyTasks.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const da = a.dueDate || '9999-12-31', db = b.dueDate || '9999-12-31';
      if (da !== db) return da.localeCompare(db);
      return priVal(a.priority) - priVal(b.priority);
    });

    function dateLabel(dateStr) {
      if (!dateStr) return { text: '', cls: '' };
      const d = new Date(dateStr + 'T12:00:00');
      const now = new Date(); now.setHours(12,0,0,0);
      const diff = Math.round((d - now) / 86400000);
      if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'overdue' };
      if (diff === 0) return { text: 'Today', cls: 'today' };
      if (diff === 1) return { text: 'Tomorrow', cls: 'upcoming' };
      return { text: `in ${diff}d`, cls: 'upcoming' };
    }

    const unreviewedCount = companyTasks.filter(t => t.source === 'email' && !t.reviewed && !t.completed).length;

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-top:8px;">
        <div style="font-size:13px;font-weight:700;color:#516f90;text-transform:uppercase;letter-spacing:0.06em">Tasks for ${escapeHtml(companyName)}${unreviewedCount ? ` <span style="background:#FF7A59;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:4px">${unreviewedCount} new</span>` : ''}</div>
        <div style="display:flex;gap:6px">
          <button class="mtg-add-btn" id="company-task-rescan-btn" title="Re-scan most recent 10 emails for tasks" style="background:#fff;color:#516f90;border:1px solid #dfe3eb">↻ Scan emails</button>
          <button class="mtg-add-btn" id="company-task-add-btn">+ Add Task</button>
        </div>
      </div>
      <div id="company-task-form-wrap"></div>
      <div id="company-task-list">
        ${companyTasks.length ? companyTasks.map(t => {
          const dl = dateLabel(t.dueDate);
          const isAuto = t.source === 'email';
          const unreviewed = isAuto && !t.reviewed && !t.completed;
          const priColors = { high: { bg: '#FEE2E2', color: '#991B1B' }, normal: { bg: '#FEF3C7', color: '#92400E' }, low: { bg: '#DBEAFE', color: '#1D4ED8' } };
          const pc = priColors[t.priority] || priColors.normal;
          return `<div class="ct-item${t.completed ? ' ct-completed' : ''}" data-task-id="${t.id}" style="${unreviewed ? 'border-left:3px solid #FF7A59;' : ''}">
            <div style="width:18px;height:18px;margin-top:1px;border-radius:50%;border:2px solid ${t.completed ? '#5DCAA5' : '#dfe3eb'};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;color:${t.completed ? '#fff' : 'transparent'};background:${t.completed ? '#5DCAA5' : 'transparent'};flex-shrink:0" class="ct-check">${t.completed ? '✓' : ''}</div>
            <div style="flex:1;min-width:0">
              <div class="ct-text" title="Click to edit" style="font-size:13px;font-weight:600;color:#2d3e50;cursor:pointer;${t.completed ? 'text-decoration:line-through' : ''}">${escapeHtml(t.text)}</div>
              <div style="font-size:11px;color:#7c98b6;display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
                <span class="ct-priority" title="Click to change priority" style="font-size:10px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:3px;cursor:pointer;background:${pc.bg};color:${pc.color}">${t.priority || 'normal'}</span>
                ${isAuto ? `<span style="font-size:10px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:3px;background:#FFF1EC;color:#FF7A59">from email</span>` : ''}
                <span class="ct-date" title="Click to set due date" style="cursor:pointer;color:${dl.cls === 'overdue' ? '#ef4444' : dl.cls === 'today' ? '#FF7A59' : '#7c98b6'};font-weight:${dl.cls ? '600' : '400'}">${dl.text || (t.dueDate ? t.dueDate : '<span style="opacity:0.5">set date</span>')}</span>
                ${isAuto && t.sourceEmailId ? `<a href="#" class="ct-jump" data-email-id="${t.sourceEmailId}" style="color:#516f90;text-decoration:underline">view source</a>` : ''}
                ${unreviewed ? `<a href="#" class="ct-keep" style="color:#FF7A59;font-weight:600">keep</a> · <a href="#" class="ct-dismiss" style="color:#7c98b6">dismiss</a>` : ''}
              </div>
              ${isAuto && t.rationale ? `<div style="font-size:11px;color:#7c98b6;font-style:italic;margin-top:2px">"${escapeHtml(t.rationale)}"</div>` : ''}
            </div>
            <button class="ct-del" data-task-id="${t.id}">&times;</button>
          </div>`;
        }).join('') : '<div style="text-align:center;color:#7c98b6;padding:24px;font-size:13px;">No tasks for this company yet</div>'}
      </div>`;

    container.querySelector('#company-task-rescan-btn')?.addEventListener('click', () => {
      const btn = container.querySelector('#company-task-rescan-btn');
      btn.textContent = 'Scanning…'; btn.disabled = true;
      rescanAllEmailsForTasks();
      setTimeout(() => { btn.textContent = '↻ Scan emails'; btn.disabled = false; renderCompanyTasks(); }, 1500);
    });

    container.querySelectorAll('.ct-keep').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const id = el.closest('[data-task-id]').dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          const t = tasks.find(t => t.id === id);
          if (t) { t.reviewed = true; chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks()); }
        });
      });
    });
    container.querySelectorAll('.ct-dismiss').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const id = el.closest('[data-task-id]').dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          const t = tasks.find(t => t.id === id);
          if (t) { t.reviewed = true; t.completed = true; chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks()); }
        });
      });
    });
    container.querySelectorAll('.ct-jump').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const emailId = el.dataset.emailId;
        const emailsTab = document.querySelector('.hub-tab[data-tab="emails"]');
        if (emailsTab) emailsTab.click();
        setTimeout(() => {
          const target = document.querySelector(`[data-email-id="${emailId}"]`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
      });
    });

    // Wire events
    container.querySelector('#company-task-add-btn')?.addEventListener('click', () => {
      const wrap = container.querySelector('#company-task-form-wrap');
      wrap.innerHTML = `
        <div class="mtg-add-form" style="margin-bottom:12px">
          <div class="mtg-add-fields">
            <input type="text" class="mtg-add-input" id="ct-text" placeholder="What needs to be done?">
            <div style="display:flex;gap:8px">
              <input type="date" class="mtg-add-input" id="ct-date" style="width:auto">
              <select class="mtg-add-input" id="ct-priority" style="width:auto">
                <option value="high">High</option>
                <option value="normal" selected>Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="mtg-add-save" id="ct-save">Add Task</button>
              <button class="mtg-add-cancel" id="ct-cancel">Cancel</button>
            </div>
          </div>
        </div>`;
      wrap.querySelector('#ct-text')?.focus();
      wrap.querySelector('#ct-save').addEventListener('click', () => {
        const text = wrap.querySelector('#ct-text').value.trim();
        if (!text) return;
        const dueDate = wrap.querySelector('#ct-date').value || null;
        const priority = wrap.querySelector('#ct-priority').value;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          tasks.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text, company: companyName, companyId: entry.id,
            dueDate, priority, completed: false, createdAt: Date.now()
          });
          chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks());
        });
      });
      wrap.querySelector('#ct-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
    });

    container.querySelectorAll('.ct-check').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.closest('[data-task-id]').dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          const t = tasks.find(t => t.id === id);
          if (t) { t.completed = !t.completed; chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks()); }
        });
      });
    });
    container.querySelectorAll('.ct-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = (d.userTasks || []).filter(t => t.id !== id);
          chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks());
        });
      });
    });

    // Inline edit: text
    container.querySelectorAll('.ct-text').forEach(el => {
      el.addEventListener('click', () => {
        const taskItem = el.closest('[data-task-id]');
        if (!taskItem || taskItem.querySelector('[data-ct-editing]')) return;
        const id = taskItem.dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          const t = tasks.find(t => t.id === id);
          if (!t) return;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = t.text;
          input.className = 'ct-edit-input';
          input.setAttribute('data-ct-editing', '');
          let saved = false;
          const save = () => {
            if (saved) return; saved = true;
            const val = input.value.trim();
            if (val && val !== t.text) { t.text = val; chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks()); }
            else renderCompanyTasks();
          };
          input.addEventListener('blur', save);
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); saved = true; renderCompanyTasks(); }
          });
          el.replaceWith(input);
          input.focus();
          input.select();
        });
      });
    });

    // Inline edit: priority (cycle)
    container.querySelectorAll('.ct-priority').forEach(el => {
      el.addEventListener('click', () => {
        const taskItem = el.closest('[data-task-id]');
        if (!taskItem) return;
        const id = taskItem.dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          const t = tasks.find(t => t.id === id);
          if (!t) return;
          const cycles = ['normal', 'high', 'low'];
          const idx = cycles.indexOf(t.priority || 'normal');
          t.priority = cycles[(idx + 1) % cycles.length];
          chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks());
        });
      });
    });

    // Inline edit: due date
    container.querySelectorAll('.ct-date').forEach(el => {
      el.addEventListener('click', () => {
        const taskItem = el.closest('[data-task-id]');
        if (!taskItem || taskItem.querySelector('[data-ct-editing]')) return;
        const id = taskItem.dataset.taskId;
        chrome.storage.local.get(['userTasks'], d => {
          const tasks = d.userTasks || [];
          const t = tasks.find(t => t.id === id);
          if (!t) return;
          const input = document.createElement('input');
          input.type = 'date';
          input.value = t.dueDate || '';
          input.className = 'ct-edit-date';
          input.setAttribute('data-ct-editing', '');
          let saved = false;
          const save = () => {
            if (saved) return; saved = true;
            const val = input.value || null;
            if (val !== (t.dueDate || null)) { t.dueDate = val; chrome.storage.local.set({ userTasks: tasks }, () => renderCompanyTasks()); }
            else renderCompanyTasks();
          };
          input.addEventListener('change', save);
          input.addEventListener('blur', save);
          input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); saved = true; renderCompanyTasks(); } });
          el.replaceWith(input);
          input.focus();
          input.click();
        });
      });
    });
  });
}

const DEFAULT_TAB_ORDER = ['intel', 'activity', 'tasks', 'notes', 'emails', 'meetings', 'docs'];
const TAB_LABELS = { intel: 'Role Brief', activity: 'Activity', tasks: 'Tasks', notes: 'Notes', emails: 'Emails', meetings: 'Meetings', docs: 'Docs' };
const TAB_PANE_HTML = {
  activity: '<div id="activity-log-section"></div><div id="activity-timeline"></div>',
  tasks: '<div id="company-tasks-container"></div>',
  intel: '', // filled by buildIntelTab()
  notes: '<div id="hub-notes-container" data-editing="0"></div>',
  emails: '<div class="p-empty" id="act-emails-status">Loading emails\u2026</div><div id="act-emails-list"></div>',
  meetings: '<div class="p-empty" id="act-meetings-status">Loading meetings\u2026</div><div id="act-meetings-content"></div>',
  docs: `<div class="docs-section">
    <div class="docs-upload-zone" id="docs-drop-zone">
      <div class="docs-upload-text">Drop files here or click to upload</div>
      <div class="docs-upload-sub">PDF, images (.png, .jpg), or paste text</div>
      <input type="file" id="docs-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple style="display:none">
      <button class="docs-upload-btn" id="docs-upload-btn">Choose files</button>
    </div>
    <div class="docs-paste-zone">
      <textarea class="docs-paste-input" id="docs-paste-input" placeholder="Or paste a job description, offer details, or any text here..." rows="3"></textarea>
      <button class="docs-paste-btn" id="docs-paste-save">Save text</button>
    </div>
    <div class="docs-list" id="docs-list"></div>
  </div>`,
};

function renderMainTabs() {
  const colEl = document.getElementById('col-main');
  let tabOrder = JSON.parse(localStorage.getItem('ci_tabOrder') || 'null') || DEFAULT_TAB_ORDER;
  // Ensure new tabs are included even if user has a cached order
  for (const t of DEFAULT_TAB_ORDER) { if (!tabOrder.includes(t)) tabOrder.push(t); }
  const defaultTab = tabOrder[0]; // first tab is the default

  const tabButtons = tabOrder.map(t =>
    `<button class="hub-tab${t === defaultTab ? ' active' : ''}" data-tab="${t}" draggable="true">${TAB_LABELS[t] || t}</button>`
  ).join('');

  const panes = tabOrder.map(t => {
    const content = t === 'intel' ? buildIntelTab() : (TAB_PANE_HTML[t] || '');
    return `<div class="hub-pane${t === defaultTab ? ' active' : ''}" id="hub-${t}">${content}</div>`;
  }).join('');

  colEl.innerHTML = `
    <div class="hub-tabs-container">
      <div class="hub-tab-bar">${tabButtons}</div>
      ${panes}
    </div>`;
  bindHubTabs();
}

function buildRoleBriefSection() {
  if (!entry.isOpportunity) return '';

  const brief = entry.roleBrief;
  const quickBrief = entry.jobMatch?.roleBrief; // unified brief from quick fit
  const hasData = entry.jobDescription || entry.cachedMeetings?.length || entry.cachedEmails?.length || entry.manualMeetings?.length;

  // Check if stale
  let staleHtml = '';
  if (brief?.generatedAt) {
    const sv = brief.sourceVersions || {};
    const newEmails = (entry.cachedEmails?.length || 0) > (sv.emailCount || 0);
    const newMeetings = ((entry.cachedMeetings?.length || 0) + (entry.manualMeetings?.length || 0)) > (sv.meetingCount || 0);
    const newNotes = (entry.notes?.length || 0) !== (sv.notesLength || 0);
    if (newEmails || newMeetings || newNotes) {
      const parts = [];
      if (newMeetings) parts.push('new meetings');
      if (newEmails) parts.push('new emails');
      if (newNotes) parts.push('updated notes');
      staleHtml = `<div class="rb-stale-bar"><span>${parts.join(' and ')} since last update</span><button class="rb-refresh-btn rb-stale-refresh" id="rb-stale-refresh">Refresh</button></div>`;
    }
  }

  if (brief?.content) {
    const d = new Date(brief.generatedAt);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const emailCount = brief.sourceVersions?.emailCount || 0;
    const meetingCount = brief.sourceVersions?.meetingCount || 0;
    const metaParts = [];
    if (meetingCount) metaParts.push(`${meetingCount} meeting${meetingCount === 1 ? '' : 's'}`);
    if (emailCount) metaParts.push(`${emailCount} email${emailCount === 1 ? '' : 's'}`);
    const metaStr = metaParts.length ? ` \u00b7 ${metaParts.join(', ')}` : '';

    // Render markdown content as HTML
    let briefHtml = brief.content;
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      briefHtml = marked.parse(brief.content);
    } else {
      briefHtml = brief.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    }

    // Original job posting collapsible
    const jdHtml = entry.jobDescription ? `
      <div class="rb-jd-divider"></div>
      <details class="rb-jd-toggle">
        <summary class="rb-jd-summary">Original job posting <span class="rb-jd-chevron">\u203a</span></summary>
        <div class="rb-jd-body">${(entry.jobDescription || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
      </details>` : '';

    return `
      <div class="hub-section-label" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          Role Brief
          <div class="rb-meta">Updated ${dateStr}${metaStr}</div>
        </div>
        <button class="rb-refresh-btn" id="rb-refresh-btn">\u21bb Refresh brief</button>
      </div>
      ${staleHtml}
      <div class="rb-card">
        <div class="rb-content" id="rb-content">${briefHtml}</div>
        ${jdHtml}
      </div>`;
  }

  // Show unified quick brief from scoring if no full brief exists
  if (quickBrief && (quickBrief.roleSummary || quickBrief.whyInteresting)) {
    const sections = [];
    if (quickBrief.roleSummary) sections.push(`<div style="margin-bottom:10px"><strong>What this role is:</strong> ${quickBrief.roleSummary}</div>`);
    if (quickBrief.whyInteresting) sections.push(`<div style="margin-bottom:10px"><strong>Why it could be interesting:</strong> ${quickBrief.whyInteresting}</div>`);
    if (quickBrief.concerns) sections.push(`<div style="margin-bottom:10px"><strong>Open questions:</strong> ${quickBrief.concerns}</div>`);
    if (quickBrief.qualificationMatch) sections.push(`<div style="margin-bottom:10px"><strong>Qualification match${quickBrief.qualificationScore ? ` (${quickBrief.qualificationScore}/5)` : ''}:</strong> ${quickBrief.qualificationMatch}</div>`);
    if (quickBrief.compSummary) sections.push(`<div><strong>Compensation:</strong> ${quickBrief.compSummary}</div>`);
    return `
      <div class="hub-section-label">Role Brief</div>
      ${staleHtml}
      <div class="rb-card">
        <div class="rb-content">${sections.join('')}</div>
        <div style="margin-top:10px;font-size:11px;color:#7c98b6;">Auto-generated from scoring${entry.scoredAt ? ' · ' + new Date(entry.scoredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</div>
      </div>
      ${hasData ? '<button class="rb-generate-btn" id="rb-generate-btn" style="margin-top:8px">Generate detailed brief</button>' : ''}`;
  }

  if (hasData) {
    return `
      <div class="hub-section-label">Role Brief</div>
      <div class="rb-empty">
        <button class="rb-generate-btn" id="rb-generate-btn">Generate role brief</button>
        <div class="rb-empty-sub">Synthesizes job posting + meetings + emails into one structured brief</div>
      </div>`;
  }

  return `
    <div class="hub-section-label">Role Brief</div>
    <div class="rb-empty-msg">No role data yet. Save a job posting or record meetings to generate a brief.</div>`;
}

// Bind dismiss/restore handlers for reviews displayed in the Intel tab hub block
function bindHubReviews() {
  const block = document.getElementById('hub-reviews-block');
  if (!block) return;
  let _undoTimer = null;

  const rerenderHub = () => {
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    block.innerHTML = `<div class="hub-section-label">Employee Reviews</div>${buildReviews()}`;
    bindHubReviews();
  };

  const showUndoHub = (rid) => {
    if (_undoTimer) clearTimeout(_undoTimer);
    block.querySelector('.p-review-undo')?.remove();
    const banner = document.createElement('div');
    banner.className = 'p-review-undo';
    banner.innerHTML = `Review dismissed · <button class="p-review-undo-btn">undo</button>`;
    const firstReview = block.querySelector('.hub-section-label + *') || block.querySelector('.p-review') || block.querySelector('.p-empty');
    if (firstReview) block.insertBefore(banner, firstReview);
    else block.appendChild(banner);
    banner.querySelector('.p-review-undo-btn').addEventListener('click', () => {
      clearTimeout(_undoTimer);
      _undoTimer = null;
      const ids = entry.dismissedReviews || [];
      const idx = ids.lastIndexOf(rid);
      if (idx !== -1) saveEntry({ dismissedReviews: [...ids.slice(0, idx), ...ids.slice(idx + 1)] });
      rerenderHub();
    });
    _undoTimer = setTimeout(() => { banner.remove(); _undoTimer = null; }, 6000);
  };

  block.querySelectorAll('.p-review-dismiss').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.rid;
      saveEntry({ dismissedReviews: [...(entry.dismissedReviews || []), rid] });
      block.innerHTML = `<div class="hub-section-label">Employee Reviews</div>${buildReviews()}`;
      bindHubReviews();
      showUndoHub(rid);
    });
  });

  block.querySelector('.p-review-restore')?.addEventListener('click', () => {
    saveEntry({ dismissedReviews: [] });
    rerenderHub();
  });
}

function buildIntelTab() {
  const overview = buildOverview();
  const intel    = buildIntel();
  const hasIntel = !intel.includes('p-empty');

  // Fit section — always shown for opportunities; prompt to add if not
  const fitHtml = (entry.isOpportunity || entry.jobMatch)
    ? buildFitSection()
    : `<div class="hub-section-label">Job Fit Analysis</div>
       <div class="p-empty" style="text-align:left">Add this company to the Opportunity Pipeline to enable fit analysis against your preferences, meetings, and emails.</div>`;

  const conflictBanner = entry.dataConflict ? `
    <div class="data-conflict-banner">
      <span>\u26a0\ufe0f The intel for this company may be inaccurate \u2014 enrichment data may belong to a different company.</span>
      <button class="conflict-reenrich-btn" id="reenrich-btn">Re-enrich \u2192</button>
    </div>` : '';

  // Research metadata (when last researched, APIs used, cost)
  const researchMetaHtml = (() => {
    if (!_cacheMetadata?.ts) return '';
    const date = new Date(_cacheMetadata.ts);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    const apisUsed = _cacheMetadata._usage?.apisUsed || [];
    const cost = _cacheMetadata._usage?.costFormatted || '';
    let metaStr = `Last researched ${dateStr}`;
    if (apisUsed.length) metaStr += ` — ${apisUsed.join(', ')}`;
    if (cost) metaStr += ` — ${cost}`;
    return `<div style="font-size:11px;color:#a09a94;text-align:center;margin-top:16px;padding-top:12px;border-top:1px solid #f0f0f0;">${metaStr}</div>`;
  })();

  return `
    ${conflictBanner}
    <div class="hub-intel-block">${overview}</div>
    ${hasIntel ? `<div class="hub-intel-block">${intel}</div>` : ''}
    ${entry.isOpportunity ? `<div class="hub-intel-block" id="hub-role-brief-block">${buildRoleBriefSection()}</div>` : ''}
    <div class="hub-intel-block" id="hub-fit-block">${fitHtml}</div>
    <div class="hub-intel-block" id="hub-reviews-block">
      <div class="hub-section-label">Employee Reviews</div>
      ${buildReviews()}
    </div>
    <div class="hub-intel-block" id="hub-hiring-block">
      <div class="hub-section-label">Hiring Signals</div>
      ${buildHiring()}
    </div>
    ${researchMetaHtml}
  `.trim();
}

// Called when the Intel tab is first opened — fetches missing research data and triggers fit analysis
function initIntelTab() {
  // Trigger fresh research if reviews or hiring signals are missing
  const needsResearch = !entry.reviews?.length || !entry.jobListings?.length;
  if (needsResearch && !_researchAttempted) {
    _researchAttempted = true;
    const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    chrome.runtime.sendMessage({ type: 'RESEARCH_COMPANY', company: entry.company, domain }, data => {
      void chrome.runtime.lastError;
      if (!data || data.error) return;
      const updates = {};
      if (data.reviews?.length && !entry.reviews?.length)     updates.reviews     = data.reviews;
      if (data.jobListings?.length)                           updates.jobListings  = data.jobListings;
      if (data.leaders?.length   && !entry.leaders?.length)   updates.leaders     = data.leaders;
      if (data.intelligence      && !entry.intelligence)      updates.intelligence = data.intelligence;
      if (!Object.keys(updates).length) return;
      saveEntry(updates);
      // Re-render only the sections that changed
      const reviewsEl = document.getElementById('hub-reviews-block');
      if (reviewsEl && updates.reviews) { reviewsEl.innerHTML = `<div class="hub-section-label">Employee Reviews</div>${buildReviews()}`; bindHubReviews(); }
      const hiringEl  = document.getElementById('hub-hiring-block');
      if (hiringEl  && updates.jobListings) hiringEl.innerHTML  = `<div class="hub-section-label">Hiring Signals</div>${buildHiring()}`;
    });
  }

  bindHubReviews();

  // Bind re-enrich button for data conflict banner
  document.getElementById('reenrich-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('reenrich-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Re-enriching...'; }
    // Clear stale enrichment data
    saveEntry({
      intelligence: null, reviews: null, leaders: null,
      employees: null, funding: null, industry: null, founded: null,
      roleBrief: null, dataConflict: false,
    });
    // Re-run research
    chrome.runtime.sendMessage({
      type: 'RESEARCH_COMPANY',
      company: entry.company,
      domain: (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null,
      prefs: null,
      companyLinkedin: entry.companyLinkedin || null,
    }, result => {
      void chrome.runtime.lastError;
      if (result) {
        saveEntry({
          intelligence: result.intelligence || null,
          reviews: result.reviews || null,
          leaders: result.leaders || null,
          employees: result.employees || entry.employees || null,
          funding: result.funding || entry.funding || null,
          industry: result.industry || entry.industry || null,
          founded: result.founded || entry.founded || null,
          dataConflict: result.dataConflict || false,
        });
      }
      // Reload the page to show fresh data
      location.reload();
    });
  });

  // Bind role brief events
  bindRoleBriefEvents();

  // Auto-generate long-form role brief only for opportunities in configured rescore stages
  // All other stages require manual trigger via the Generate button
  if (entry.isOpportunity && !entry.roleBrief && !entry.jobMatch?.roleBrief?.roleSummary
      && (entry.jobDescription || entry.cachedMeetings?.length || entry.cachedEmails?.length)) {
    chrome.storage.local.get(['coopConfig'], ({ coopConfig }) => {
      const rescoreStages = coopConfig?.rescoreStages || [];
      const currentStage = entry.jobStage || 'needs_review';
      if (rescoreStages.length && rescoreStages.includes(currentStage)) {
        setTimeout(() => generateRoleBrief(), 1000);
      }
    });
  }
}

function generateRoleBrief() {
  const btn = document.getElementById('rb-refresh-btn') || document.getElementById('rb-generate-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `${COOP_THINKING_SVG(16)} Generating...`; }

  chrome.runtime.sendMessage({
    type: 'GENERATE_ROLE_BRIEF',
    company: entry.company,
    jobTitle: entry.jobTitle,
    jobDescription: entry.jobDescription,
    jobSnapshot: entry.jobSnapshot,
    emails: (entry.cachedEmails || []).slice(0, 15).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet })),
    meetings: [...(entry.cachedMeetings || []), ...(entry.manualMeetings || [])].slice(0, 10),
    meetingTranscript: entry.cachedMeetingTranscript || null,
    notes: entry.notes || '',
    knownContacts: (entry.knownContacts || []).slice(0, 10),
  }, result => {
    void chrome.runtime.lastError;
    if (result?.content) {
      const sourceVersions = {
        jobDescriptionLength: (entry.jobDescription || '').length,
        emailCount: (entry.cachedEmails || []).length,
        meetingCount: (entry.cachedMeetings || []).length + (entry.manualMeetings || []).length,
        notesLength: (entry.notes || '').length,
      };
      saveEntry({ roleBrief: { content: result.content, generatedAt: Date.now(), sourceVersions } });

      // Backfill empty or placeholder fields from role brief extraction
      console.log('[RoleBrief] briefFields:', result.briefFields ? JSON.stringify(result.briefFields) : 'null/undefined');
      if (result.briefFields) {
        const _isBlank = v => !v || /^(not specified|unknown|n\/a|none|null|undefined|-|—)$/i.test((v + '').trim());
        const updates = {};
        let count = 0;
        if (result.briefFields.jobTitle && _isBlank(entry.jobTitle) || entry.jobTitle === 'New Opportunity') {
          if (result.briefFields.jobTitle) { updates.jobTitle = result.briefFields.jobTitle; count++; }
        }
        if (result.briefFields.baseSalaryRange && _isBlank(entry.baseSalaryRange)) {
          updates.baseSalaryRange = result.briefFields.baseSalaryRange; count++;
        }
        if (result.briefFields.oteTotalComp && _isBlank(entry.oteTotalComp)) {
          updates.oteTotalComp = result.briefFields.oteTotalComp; count++;
        }
        if (result.briefFields.equity && _isBlank(entry.equity)) {
          updates.equity = result.briefFields.equity; count++;
        }
        if (count > 0) {
          saveEntry(updates);
          console.log(`[RoleBrief] Backfilled ${count} fields:`, Object.keys(updates));
        }
      }

      // Re-render the Role Brief block
      const rbBlock = document.getElementById('hub-role-brief-block');
      if (rbBlock) {
        rbBlock.innerHTML = buildRoleBriefSection();
        bindRoleBriefEvents();
      }
      // Run unified field sync after brief is saved, then queue rescore
      chrome.runtime.sendMessage({ type: 'SYNC_ENTRY_FIELDS', entryId: entry.id }, () => {
        void chrome.runtime.lastError;
        // Chain into scoring — brief is now persisted, use QUEUE_SCORE to avoid blocking
        if (entry.isOpportunity && (entry.jobStage || 'needs_review') !== 'rejected') {
          console.log('[BriefCascade] Brief saved, queuing rescore for', entry.company);
          chrome.runtime.sendMessage({ type: 'QUEUE_SCORE', entryId: entry.id }, () => void chrome.runtime.lastError);
        }
      });
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '\u21bb Refresh brief'; }
    }
  });
}

function bindRoleBriefEvents() {
  document.getElementById('rb-generate-btn')?.addEventListener('click', generateRoleBrief);
  document.getElementById('rb-refresh-btn')?.addEventListener('click', generateRoleBrief);
  document.getElementById('rb-stale-refresh')?.addEventListener('click', generateRoleBrief);
}

// ── Auto-refresh role brief when new interaction data arrives ─────────────────
// Checks if the brief is stale (newer emails or meetings than brief.generatedAt).
// Only fires for opportunities that already have a brief — does not auto-generate.
// Guards against looping: timestamp gate prevents re-triggering while generation is in flight.
let _autoRefreshBriefLastTriggered = 0;
function maybeAutoRefreshBrief() {
  if (!entry?.isOpportunity) return;
  // Debounce: skip if triggered within last 60 seconds (brief generation takes ~15-30s)
  if (Date.now() - _autoRefreshBriefLastTriggered < 60000) return;
  const brief = entry.roleBrief;
  if (!brief?.generatedAt) return; // no brief yet — let user trigger first generation manually

  const sv = brief.sourceVersions || {};
  const newEmails = (entry.cachedEmails?.length || 0) > (sv.emailCount || 0);
  const newMeetings = ((entry.cachedMeetings?.length || 0) + (entry.manualMeetings?.length || 0)) > (sv.meetingCount || 0);
  if (!newEmails && !newMeetings) return;

  const parts = [];
  if (newMeetings) parts.push('new meetings');
  if (newEmails) parts.push('new emails');
  console.log('[BriefCascade] Auto-refreshing role brief —', parts.join(' and '), 'detected for', entry.company);
  _autoRefreshBriefLastTriggered = Date.now();
  // Use a short delay so UI renders first and storage is settled
  setTimeout(generateRoleBrief, 1500);
}

// ── SCORE_COMPLETE listener — refreshes panel after brief-cascade scoring ─────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCORE_COMPLETE' && msg.entryId === entry?.id) {
    // Pull fresh scoring fields into in-memory entry and re-render the fit section
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const fresh = (savedCompanies || []).find(c => c.id === entry.id);
      if (fresh) {
        Object.assign(entry, fresh);
        const fitBlock = document.getElementById('hub-fit-block');
        if (fitBlock) fitBlock.innerHTML = buildFitSection();
      }
    });
    sendResponse({ ok: true });
  }
  return true;
});

function buildFitSection() {
  // Unified scoring — one source of truth: jobMatch
  const jm         = entry.jobMatch || {};
  const score      = jm.score;
  const _normFlag = f => typeof f === 'string' ? { text: f, source: null, evidence: null } : { text: f?.text || '', source: f?.source || null, evidence: f?.evidence || null };
  const strongFits = (jm.strongFits || []).map(_normFlag).filter(f => f.text);
  const redFlags   = (jm.redFlags || jm.watchOuts || []).map(_normFlag).filter(f => f.text);
  const _flagSrcLabel = s => ({ job_posting: 'From job posting', company_data: 'From company research', preferences: 'From your preferences', candidate_profile: 'From your profile', dealbreaker_keyword: 'From your dealbreaker keywords' }[s] || (s ? `Source: ${s}` : 'No source linked'));
  const _flagSrcIcon = s => ({ job_posting: '📄', company_data: '🏢', preferences: '⚙', candidate_profile: '👤', dealbreaker_keyword: '⛔' }[s] || 'ⓘ');
  const _flagTipHtml = f => (_flagSrcLabel(f.source) + (f.evidence ? ` — "${f.evidence}"` : ' — no evidence quoted')).replace(/"/g, '&quot;');
  const jobSummary = jm.jobSummary  || entry.jobSummary || '';
  const reason     = jm.verdict || entry.fitReason || '';
  const v          = score ? scoreToVerdict(score) : null;

  const coopTake = jm.coopTake || '';
  let html = `<div class="hub-section-label">Job Fit Analysis</div>`;

  if (score) {
    const fb = entry.matchFeedback;
    const upA = fb?.type === 'up' ? ' active up' : '';
    const noteA = fb?.type === 'note' ? ' active note' : '';
    const downA = fb?.type === 'down' ? ' active down' : '';
    html += `<div class="fit-score-row">
      <span class="fit-score"><span class="fit-score-label">Coop's Score</span>${typeof score === 'number' ? score.toFixed(1) : score}<span class="fit-score-denom">/10</span></span>
      <span class="fit-verdict" style="color:${v.color}">${v.label}</span>
      <span class="verdict-thumbs">
        <button class="thumb-btn${upA}" data-dir="up" title="Agree">👍</button>
        <button class="thumb-btn${noteA}" data-dir="note" title="Note on wording/format">💬</button>
        <button class="thumb-btn${downA}" data-dir="down" title="Disagree">👎</button>
      </span>
    </div>
    <div id="co-thumb-form" style="display:none"></div>`;
    if (coopTake) {
      html += `<div style="font-size:13px;color:#516f90;margin:8px 0;line-height:1.5;border-left:3px solid #d97706;padding-left:10px;font-style:italic;">${escapeHtml(coopTake)}</div>`;
    } else if (reason) {
      html += `<div style="font-size:13px;color:#516f90;margin:8px 0;line-height:1.5">${escapeHtml(reason)}</div>`;
    }
    if (jm.interactionSummary) {
      html += `<div style="font-size:13px;color:#374151;margin:10px 0 4px;line-height:1.6;border-left:3px solid #059669;padding-left:10px;background:#f0fdf4;border-radius:0 4px 4px 0;padding:8px 10px;"><span style="font-size:11px;font-weight:600;color:#059669;display:block;margin-bottom:4px;letter-spacing:0.04em">FROM CONVERSATIONS</span>${escapeHtml(jm.interactionSummary)}</div>`;
    }
  }

  // Refresh button + scored timestamp
  const scoredAtStr = entry.scoredAt ? new Date(entry.scoredAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  html += `<div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;">
    <button class="fit-refresh-btn" id="fit-refresh-btn" title="Re-score using latest job data, emails, and meeting notes">
      ↻ ${score ? 'Refresh analysis' : 'Run fit analysis'}
    </button>
    ${scoredAtStr ? `<span style="font-size:12px;color:var(--ci-text-secondary);">Last scored ${scoredAtStr}</span>` : ''}
  </div>`;

  // Job summary (from posting)
  if (jobSummary) {
    html += `<div class="fit-job-summary">${escapeHtml(jobSummary)}</div>`;
  }

  if (!score) {
    html += `<div class="p-empty" style="text-align:left;margin:8px 0">No fit analysis yet. Click "Run fit analysis" above — or save a job posting to automatically generate one.</div>`;
  }

  // New format: dimension breakdown with flagsFired
  const flagsFired = jm.flagsFired || {};
  const isNewFormat = jm.scoreBreakdown?.roleFit !== undefined;

  if (isNewFormat && score) {
    const breakdown = jm.scoreBreakdown || {};
    const dimRationale = jm.dimensionRationale || {};
    const qualifications = jm.qualifications || [];
    const compAssess = jm.compAssessment || {};
    const DIM_DEFS = [
      { key: 'qualificationFit', label: 'Qualification' },
      { key: 'roleFit', label: 'Role fit' },
      { key: 'cultureFit', label: 'Culture fit' },
      { key: 'companyFit', label: 'Company fit' },
      { key: 'compFit', label: 'Comp fit' },
    ];
    const dimTier = v => v >= 7 ? 'high' : v >= 5 ? 'mid' : 'low';
    html += `<div class="fit-dims">`;
    DIM_DEFS.forEach(dim => {
      const val = breakdown[dim.key];
      if (val == null) return;
      const tier = dimTier(val);
      const fired = flagsFired[dim.key] || {};
      const greens = (fired.green || []).sort((a, b) => (b.sev || 0) - (a.sev || 0));
      const reds = (fired.red || []).sort((a, b) => (b.sev || 0) - (a.sev || 0));
      const rationale = dimRationale[dim.key] || dimRationale[dim.key.replace('Fit', '')] || '';

      // Build detail content for this dimension
      let detailHtml = '';

      // Rationale
      if (rationale) {
        detailHtml += `<div class="fit-dim-rationale">${linkReviewSources(escapeHtml(rationale), entry.reviews, entry.dismissedReviews)}</div>`;
      }

      // Green + red flags with full text (not truncated)
      if (greens.length || reds.length) {
        detailHtml += `<div class="fit-dim-flags">`;
        greens.forEach(f => {
          detailHtml += `<div class="fit-dim-flag green"><span class="fit-dim-flag-icon">+</span><span class="fit-dim-flag-text">${escapeHtml(f.text || f.label || '')}</span>${f.evidence ? `<span class="fit-dim-flag-evidence">${linkReviewSources(escapeHtml(f.evidence), entry.reviews, entry.dismissedReviews)}</span>` : ''}</div>`;
        });
        reds.forEach(f => {
          detailHtml += `<div class="fit-dim-flag red"><span class="fit-dim-flag-icon">-</span><span class="fit-dim-flag-text">${escapeHtml(f.text || f.label || '')}</span>${f.evidence ? `<span class="fit-dim-flag-evidence">${linkReviewSources(escapeHtml(f.evidence), entry.reviews, entry.dismissedReviews)}</span>` : ''}</div>`;
        });
        detailHtml += `</div>`;
      }

      // Qualification-specific: show requirements table
      if (dim.key === 'qualificationFit' && qualifications.length) {
        const statusIcon = s => s === 'met' ? '✓' : s === 'partial' ? '◐' : s === 'unmet' ? '✗' : '?';
        const statusColor = s => s === 'met' ? '#0F6E56' : s === 'partial' ? '#D97706' : s === 'unmet' ? '#DC2626' : '#9CA3AF';
        detailHtml += `<div class="fit-dim-quals">`;
        qualifications.forEach(q => {
          detailHtml += `<div class="fit-dim-qual-row">
            <span class="fit-dim-qual-status" style="color:${statusColor(q.status)}">${statusIcon(q.status)}</span>
            <div class="fit-dim-qual-body">
              <div class="fit-dim-qual-req">${escapeHtml(q.requirement || '')}</div>
              ${q.evidence ? `<div class="fit-dim-qual-ev">${escapeHtml(q.evidence)}</div>` : ''}
            </div>
            <span class="fit-dim-qual-imp">${q.importance || ''}</span>
          </div>`;
        });
        detailHtml += `</div>`;
      }

      // Comp-specific: show comp assessment
      if (dim.key === 'compFit' && (compAssess.baseDisclosed || compAssess.oteDisclosed)) {
        const fmtAmt = v => v ? `$${(v / 1000).toFixed(0)}k` : 'undisclosed';
        const vsLabel = v => v === 'above_strong' ? 'Above strong' : v === 'above_floor' ? 'Above floor' : v === 'at_floor' ? 'At floor' : v === 'below_floor' ? 'Below floor' : 'Unknown';
        const vsColor = v => v === 'above_strong' ? '#0F6E56' : v === 'above_floor' ? '#0F6E56' : v === 'at_floor' ? '#D97706' : v === 'below_floor' ? '#DC2626' : '#9CA3AF';
        detailHtml += `<div class="fit-dim-comp">`;
        if (compAssess.baseDisclosed) detailHtml += `<div class="fit-dim-comp-row"><span>Base: ${fmtAmt(compAssess.baseAmount)}</span><span style="color:${vsColor(compAssess.baseVsFloor)};font-weight:600;">${vsLabel(compAssess.baseVsFloor)}</span></div>`;
        if (compAssess.oteDisclosed) detailHtml += `<div class="fit-dim-comp-row"><span>OTE: ${fmtAmt(compAssess.oteAmount)}</span><span style="color:${vsColor(compAssess.oteVsFloor)};font-weight:600;">${vsLabel(compAssess.oteVsFloor)}</span></div>`;
        detailHtml += `</div>`;
      }

      const hasDetail = detailHtml.length > 0;
      const chevron = hasDetail ? `<span class="fit-dim-chevron">▸</span>` : '';

      html += `<details class="fit-dim-section">
        <summary class="fit-dim-row${hasDetail ? ' clickable' : ''}">
          ${chevron}
          <span class="fit-dim-label">${dim.label}</span>
          <div class="fit-dim-bar"><div class="fit-dim-bar-fill ${tier}" style="width:${val * 10}%"></div></div>
          <span class="fit-dim-val ${tier}">${Number(val).toFixed(1)}</span>
        </summary>
        ${hasDetail ? `<div class="fit-dim-detail">${detailHtml}</div>` : ''}
      </details>`;
    });
    html += `</div>`;
  } else {
    // Legacy format: flat green/red flags
    html += `<div class="fit-flags-grid">
      <div class="fit-flags-col fit-flags-green">
        <div class="fit-flags-header">✓ Green Flags</div>
        ${strongFits.length
          ? strongFits.map(f => `<div class="fit-flag" title="${_flagTipHtml(f)}" style="cursor:help;">${escapeHtml(f.text)} <span style="opacity:0.5;font-size:10px;">${_flagSrcIcon(f.source)}</span></div>`).join('')
          : `<div class="fit-flag-none">${score ? 'None identified' : 'Run analysis to generate'}</div>`}
      </div>
      <div class="fit-flags-col fit-flags-red">
        <div class="fit-flags-header">⚠ Red Flags</div>
        ${redFlags.length
          ? redFlags.map(f => `<div class="fit-flag" title="${_flagTipHtml(f)}" style="cursor:help;">${escapeHtml(f.text)} <span style="opacity:0.5;font-size:10px;">${_flagSrcIcon(f.source)}</span></div>`).join('')
          : `<div class="fit-flag-none">${score ? 'None identified' : 'Run analysis to generate'}</div>`}
      </div>
    </div>`;
  }

  return html;
}

function bindHubTabs() {
  const container = document.querySelector('.hub-tabs-container');
  if (!container) return;
  const tabBar = container.querySelector('.hub-tab-bar');

  let emailsLoaded = false, meetingsLoaded = false, intelInited = false, docsInited = false, activityInited = false, tasksInited = false;

  // Init the default (first) tab
  let tabOrder = JSON.parse(localStorage.getItem('ci_tabOrder') || 'null') || DEFAULT_TAB_ORDER;
  // Ensure new tabs are included even if user has a cached order
  for (const t of DEFAULT_TAB_ORDER) { if (!tabOrder.includes(t)) tabOrder.push(t); }
  const defaultTab = tabOrder[0];
  setTimeout(() => {
    if (defaultTab === 'intel' && !intelInited) { intelInited = true; initIntelTab(); }
    else if (defaultTab === 'activity' && !activityInited) { activityInited = true; initActivityTab(); }
    else if (defaultTab === 'tasks') { tasksInited = true; initTasksTab(); }
    else if (defaultTab === 'emails' && !emailsLoaded) { emailsLoaded = true; loadHubEmails(); }
    else if (defaultTab === 'meetings' && !meetingsLoaded) { meetingsLoaded = true; loadHubMeetings(); }
    else if (defaultTab === 'docs' && !docsInited) { docsInited = true; initDocsTab(); }
  }, 0);

  // Tab click handlers
  container.querySelectorAll('.hub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.hub-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('hub-' + tab.dataset.tab)?.classList.add('active');

      if (tab.dataset.tab === 'activity' && !activityInited) { activityInited = true; initActivityTab(); }
      if (tab.dataset.tab === 'activity') initActivityTab();
      if (tab.dataset.tab === 'tasks') { tasksInited = true; initTasksTab(); }
      if (tab.dataset.tab === 'intel' && !intelInited) { intelInited = true; initIntelTab(); }
      if (tab.dataset.tab === 'emails' && !emailsLoaded) { emailsLoaded = true; loadHubEmails(); }
      if (tab.dataset.tab === 'meetings' && !meetingsLoaded) { meetingsLoaded = true; loadHubMeetings(); }
      if (tab.dataset.tab === 'docs' && !docsInited) { docsInited = true; initDocsTab(); }
    });
  });

  // Drag-to-reorder tabs
  let dragTab = null;
  tabBar.querySelectorAll('.hub-tab').forEach(tab => {
    tab.addEventListener('dragstart', e => {
      dragTab = tab;
      e.dataTransfer.effectAllowed = 'move';
      tab.style.opacity = '0.4';
    });
    tab.addEventListener('dragend', () => {
      tab.style.opacity = '';
      dragTab = null;
      tabBar.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('drag-over'));
    });
    tab.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tab.classList.add('drag-over');
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
    tab.addEventListener('drop', e => {
      e.preventDefault();
      tab.classList.remove('drag-over');
      if (!dragTab || dragTab === tab) return;
      // Reorder in DOM
      const tabs = [...tabBar.querySelectorAll('.hub-tab')];
      const fromIdx = tabs.indexOf(dragTab);
      const toIdx = tabs.indexOf(tab);
      if (fromIdx < toIdx) tab.after(dragTab);
      else tab.before(dragTab);
      // Save new order
      const newOrder = [...tabBar.querySelectorAll('.hub-tab')].map(t => t.dataset.tab);
      localStorage.setItem('ci_tabOrder', JSON.stringify(newOrder));
    });
  });

  renderNotesEditor();

  // Thumbs feedback on match verdict
  document.addEventListener('click', e => {
    const thumbBtn = e.target.closest('.thumb-btn');
    if (!thumbBtn || !thumbBtn.closest('.fit-score-row, .verdict-row')) return;
    const dir = thumbBtn.dataset.dir;
    const formEl = document.getElementById('co-thumb-form');
    if (!formEl) return;
    document.querySelectorAll('.fit-score-row .thumb-btn, .verdict-row .thumb-btn').forEach(b => b.classList.remove('active', 'up', 'down'));
    thumbBtn.classList.add('active', dir);
    const placeholder = dir === 'up' ? 'What resonated?' : dir === 'note' ? 'Feedback on wording, length, format...' : 'What felt off?';
    formEl.style.display = 'block';
    formEl.innerHTML = `<div class="thumb-feedback-form"><input class="thumb-feedback-input" id="co-thumb-note" type="text" placeholder="${placeholder}"><button class="thumb-feedback-submit" id="co-thumb-submit">Submit</button></div>`;
    formEl.querySelector('#co-thumb-note')?.focus();
    const submit = () => {
      const note = document.getElementById('co-thumb-note')?.value?.trim() || '';
      saveEntry({ matchFeedback: { type: dir, note, date: Date.now() } });
      formEl.innerHTML = `<div style="font-size:11px;color:#7da8c4;padding:4px 0">Thanks for the feedback</div>`;
      setTimeout(() => { formEl.style.display = 'none'; }, 2000);
    };
    document.getElementById('co-thumb-submit')?.addEventListener('click', submit);
    document.getElementById('co-thumb-note')?.addEventListener('keydown', e2 => { if (e2.key === 'Enter') submit(); });
  });

  // Fit analysis refresh button — re-runs the unified scorer
  document.addEventListener('click', e => {
    if (e.target.id !== 'fit-refresh-btn') return;
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = '↻ Scoring…';
    // Show Coop thinking overlay on fit section
    const fitBlock = document.getElementById('hub-fit-block');
    if (fitBlock) {
      fitBlock.style.position = 'relative';
      const overlay = document.createElement('div');
      overlay.className = 'coop-thinking-overlay';
      overlay.id = 'coop-thinking-fit';
      overlay.innerHTML = coopThinkingHTML('Coop is scoring...', 'Analyzing job fit & qualifications');
      fitBlock.appendChild(overlay);
    }
    chrome.runtime.sendMessage({ type: 'SCORE_OPPORTUNITY', entryId: entry.id }, result => {
      void chrome.runtime.lastError;
      document.getElementById('coop-thinking-fit')?.remove();
      if (result && !result.error) {
        chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
          const fresh = (savedCompanies || []).find(c => c.id === entry.id);
          if (fresh) {
            Object.assign(entry, fresh);
            const idx = allCompanies.findIndex(c => c.id === entry.id);
            if (idx !== -1) allCompanies[idx] = entry;
          }
          if (fitBlock) fitBlock.innerHTML = buildFitSection();
          btn.disabled = false;
          btn.textContent = '↻ Refresh analysis';
        });
      } else {
        btn.disabled = false;
        btn.textContent = '↻ Refresh analysis';
      }
    });
  }, { capture: true });

}

// ── Documents tab ────────────────────────────────────────────────────────────

function initDocsTab() {
  const dropZone = document.getElementById('docs-drop-zone');
  const fileInput = document.getElementById('docs-file-input');
  const uploadBtn = document.getElementById('docs-upload-btn');
  const pasteInput = document.getElementById('docs-paste-input');
  const pasteSaveBtn = document.getElementById('docs-paste-save');
  if (!dropZone) return;

  // Render existing docs
  renderDocsList();

  // Click to upload
  uploadBtn.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', e => {
    if (e.target === uploadBtn || e.target === fileInput) return;
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // Drag and drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
  });

  // Paste text save
  pasteSaveBtn.addEventListener('click', () => {
    const text = pasteInput.value.trim();
    if (!text) return;
    const filename = 'Pasted text — ' + text.slice(0, 30).replace(/\n/g, ' ');
    const doc = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      filename,
      type: 'text',
      extractedText: text,
      addedAt: new Date().toISOString(),
      tokenEstimate: Math.ceil(text.length / 4)
    };
    const docs = entry.contextDocuments || [];
    docs.push(doc);
    saveEntry({ contextDocuments: docs });
    pasteInput.value = '';
    renderDocsList();
  });

  // Delete handler (delegated)
  document.getElementById('docs-list')?.addEventListener('click', e => {
    const delBtn = e.target.closest('.doc-delete');
    if (!delBtn) return;
    const docId = delBtn.dataset.docId;
    const docs = (entry.contextDocuments || []).filter(d => d.id !== docId);
    saveEntry({ contextDocuments: docs });
    renderDocsList();
  });
}

async function handleFiles(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      await handlePdfFile(file);
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      await handleImageFile(file);
    }
  }
}

async function handlePdfFile(file) {
  // Add placeholder card
  const placeholderId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const docs = entry.contextDocuments || [];
  const placeholder = { id: placeholderId, filename: file.name, type: 'pdf', extractedText: '', addedAt: new Date().toISOString(), tokenEstimate: 0, _extracting: true };
  docs.push(placeholder);
  saveEntry({ contextDocuments: docs });
  renderDocsList();

  try {
    const pdfjsLib = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    const text = pages.join('\n\n');
    // Update placeholder with extracted text
    const currentDocs = entry.contextDocuments || [];
    const idx = currentDocs.findIndex(d => d.id === placeholderId);
    if (idx !== -1) {
      currentDocs[idx].extractedText = text;
      currentDocs[idx].tokenEstimate = Math.ceil(text.length / 4);
      delete currentDocs[idx]._extracting;
      saveEntry({ contextDocuments: currentDocs });
    }
    renderDocsList();
  } catch (e) {
    console.error('[Docs] PDF extraction failed:', e);
    // Remove failed placeholder
    const currentDocs = (entry.contextDocuments || []).filter(d => d.id !== placeholderId);
    saveEntry({ contextDocuments: currentDocs });
    renderDocsList();
  }
}

async function handleImageFile(file) {
  const placeholderId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const docs = entry.contextDocuments || [];
  const placeholder = { id: placeholderId, filename: file.name, type: 'image', extractedText: '', addedAt: new Date().toISOString(), tokenEstimate: 0, _extracting: true };
  docs.push(placeholder);
  saveEntry({ contextDocuments: docs });
  renderDocsList();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
    const extToMime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    const ext = file.name.split('.').pop().toLowerCase();
    const mediaType = extToMime[ext] || 'image/png';

    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'EXTRACT_IMAGE_TEXT', imageBase64: base64, mediaType, filename: file.name }, resolve);
    });

    const text = result?.text || '';
    const currentDocs = entry.contextDocuments || [];
    const idx = currentDocs.findIndex(d => d.id === placeholderId);
    if (idx !== -1) {
      currentDocs[idx].extractedText = text;
      currentDocs[idx].tokenEstimate = Math.ceil(text.length / 4);
      delete currentDocs[idx]._extracting;
      saveEntry({ contextDocuments: currentDocs });
    }
    renderDocsList();
  } catch (e) {
    console.error('[Docs] Image extraction failed:', e);
    const currentDocs = (entry.contextDocuments || []).filter(d => d.id !== placeholderId);
    saveEntry({ contextDocuments: currentDocs });
    renderDocsList();
  }
}

function renderDocsList() {
  const listEl = document.getElementById('docs-list');
  if (!listEl) return;
  const docs = entry.contextDocuments || [];
  if (!docs.length) {
    listEl.innerHTML = '';
    return;
  }

  const typeIcons = { pdf: '\ud83d\udcc4', image: '\ud83d\uddbc\ufe0f', text: '\ud83d\udcdd' };
  let totalTokens = 0;

  listEl.innerHTML = docs.map(d => {
    totalTokens += d.tokenEstimate || 0;
    const icon = typeIcons[d.type] || '\ud83d\udcc4';
    const date = d.addedAt ? new Date(d.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const preview = d._extracting
      ? '<div class="doc-extracting-text">Extracting text…</div>'
      : `<div class="doc-preview">${escapeHtml((d.extractedText || '').slice(0, 150))}${d.extractedText?.length > 150 ? '...' : ''}</div>`;
    return `<div class="doc-card${d._extracting ? ' extracting' : ''}" data-doc-id="${d.id}">
      <div class="doc-icon">${icon}</div>
      <div class="doc-info">
        <div class="doc-filename">${escapeHtml(d.filename)}</div>
        <div class="doc-meta">${date} · ~${d.tokenEstimate} tokens</div>
        ${preview}
      </div>
      <button class="doc-delete" data-doc-id="${d.id}" title="Remove">\u2715</button>
    </div>`;
  }).join('');

  // Token budget warning
  if (totalTokens > 4000) {
    listEl.insertAdjacentHTML('beforeend', `<div class="docs-budget-warn">Context budget exceeded (${totalTokens} tokens). Oldest documents may be truncated in AI conversations.</div>`);
  }
}

function formatCacheAge(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

function renderEmailsFromData(emails) {
  const statusEl = document.getElementById('act-emails-status');
  const listEl   = document.getElementById('act-emails-list');
  if (!statusEl || !listEl) return;
  statusEl.style.display = 'none';

  // Pass delete handler so users can remove individual emails from the cached inbox
  const onDelete = (threadId) => {
    const filtered = (entry.cachedEmails || []).filter(e => e.threadId !== threadId);
    saveEntry({ cachedEmails: filtered });
    renderEmailsFromData(filtered);
  };

  listEl.innerHTML = renderEmailThreads(emails, onDelete);
  bindThreadToggles(listEl);

  // Bind delete buttons
  listEl.querySelectorAll('.email-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.thread;
      onDelete(tid);
    });
  });
}

function loadHubEmails(forceRefresh) {
  const statusEl  = document.getElementById('act-emails-status');
  const listEl    = document.getElementById('act-emails-list');
  if (!statusEl || !listEl) return;

  // Serve from cache if available and not forcing refresh
  if (!forceRefresh && entry.cachedEmails?.length) {
    renderEmailsFromData(entry.cachedEmails);
    // Still extract any contacts we may have missed from cached emails
    applyContactsFromEmails(entry.cachedEmails);
    return;
  }

  statusEl.style.display = '';
  statusEl.textContent = 'Loading emails…';
  if (listEl) listEl.innerHTML = '';

  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
  const knownContactEmails = (entry.knownContacts || []).map(c => c.email);
  const priorEmailIds = new Set((entry.cachedEmails || []).map(e => e.id).filter(Boolean));
  chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName: entry.company || '', linkedinSlug, knownContactEmails }, result => {
    void chrome.runtime.lastError;
    if (!document.getElementById('act-emails-status')) return; // pane unmounted
    if (result?.error === 'not_connected') { statusEl.textContent = 'Connect Gmail in Setup to see emails.'; return; }
    if (!result?.emails?.length)           { statusEl.textContent = 'No emails found for this company.'; return; }

    // E1: identify genuinely new emails (since wholesale overwrite below) and trigger task extraction
    const newEmails = result.emails.filter(e => e.id && !priorEmailIds.has(e.id));
    maybeExtractEmailTasks(newEmails);

    const now = Date.now();
    const emailUpdates = { cachedEmails: result.emails, cachedEmailsAt: now };
    if (result.userEmail) {
      emailUpdates.gmailUserEmail = result.userEmail;
      gmailUserEmail = result.userEmail.toLowerCase(); // update module-level variable immediately
    }
    saveEntry(emailUpdates);
    renderEmailsFromData(result.emails);
    applyContactsFromEmails(result.emails);
    if (result.extractedContacts?.length) {
      mergeExtractedContacts(result.extractedContacts);
    }
    const activityContainer = document.getElementById('activity-timeline');
    if (activityContainer && document.querySelector('.hub-tab[data-tab="activity"]')?.classList.contains('active')) {
      activityContainer.innerHTML = buildActivityTimeline(entry);
    }
    // Check for new field suggestions
    if (entry.isOpportunity && Object.keys(generateFieldSuggestions(entry)).length) {
      renderPanel('opportunity');
      bindPanelBodyEvents('opportunity');
    }
    // Tier 1: free regex field sync on new email data
    chrome.runtime.sendMessage({ type: 'SYNC_ENTRY_FIELDS', entryId: entry.id }, () => void chrome.runtime.lastError);
    // Tier 2: lightweight AI extraction on new email snippets (Nano, ~$0.0001)
    if (newEmails.length) {
      const emailText = newEmails.slice(0, 5).map(e => `[${e.date||''}] "${e.subject}" from ${e.from}\n${e.snippet || ''}`).join('\n\n');
      chrome.runtime.sendMessage({ type: 'EXTRACT_FIELDS_FROM_CONTENT', entryId: entry.id, content: emailText, contentType: 'emails' }, () => void chrome.runtime.lastError);
    }
    // Auto-refresh role brief if new emails arrived since brief was last generated
    if (newEmails.length) maybeAutoRefreshBrief();
  });
}

function loadHubMeetings(forceRefresh) {
  const statusEl  = document.getElementById('act-meetings-status');
  const contentEl = document.getElementById('act-meetings-content');
  if (!statusEl || !contentEl) return;

  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const knownContactEmails = (entry.knownContacts || []).flatMap(c => [c.email, ...(c.aliases || [])]);
  const contactNames = (entry.knownContacts || []).map(c => c.name).filter(Boolean);

  // Show cached calendar events immediately — never block UI on fetches
  if (entry.cachedCalendarEvents?.length) {
    statusEl.style.display = 'none';
    renderMeetingsTimeline(entry.cachedCalendarEvents, entry.cachedMeetingNotes);
  } else if (entry.manualMeetings?.length) {
    // Show manual meetings immediately while calendar loads
    statusEl.style.display = 'none';
    renderMeetingsTimeline([], null);
  } else {
    statusEl.textContent = 'Loading meetings…';
  }

  // Always refresh calendar (fast)
  chrome.runtime.sendMessage({ type: 'CALENDAR_FETCH_EVENTS', domain, companyName: entry.company, knownContactEmails }, calResult => {
    void chrome.runtime.lastError;
    if (!document.getElementById('act-meetings-status')) return;
    const calEvents = calResult?.events || [];
    const calError = calResult?.error;

    if (calError === 'needs_reauth') {
      statusEl.textContent = `Calendar access error. Disconnect and reconnect Gmail in Setup.`;
      statusEl.style.display = '';
      return;
    }

    if (calEvents.length) {
      saveEntry({ cachedCalendarEvents: calEvents });
      // Extract company-domain attendees from calendar events as contacts
      applyContactsFromCalendar(calEvents);
      if (detectScheduledStatus(entry)) {
        const current = entry.actionStatus || 'my_court';
        if (current === 'my_court' || current === 'their_court') {
          saveEntry({ actionStatus: 'scheduled' });
        }
      } else if (entry.actionStatus === 'scheduled') {
        saveEntry({ actionStatus: defaultActionStatus(entry.jobStage || entry.status) || 'my_court' });
      }
      statusEl.style.display = 'none';
      renderMeetingsTimeline(calEvents, entry.cachedMeetingNotes);
      const activityContainer = document.getElementById('activity-timeline');
      if (activityContainer && document.querySelector('.hub-tab[data-tab="activity"]')?.classList.contains('active')) {
        activityContainer.innerHTML = buildActivityTimeline(entry);
      }
      // Auto-populate next step from upcoming calendar event
      const nextStepChanges = autoPopulateNextStep(entry);
      if (nextStepChanges) {
        saveEntry(nextStepChanges);
        renderPanel('opportunity');
        bindPanelBodyEvents('opportunity');
      } else if (entry.isOpportunity && Object.keys(generateFieldSuggestions(entry)).length) {
        // Check for new field suggestions after calendar data arrived
        renderPanel('opportunity');
        bindPanelBodyEvents('opportunity');
      }
      // If no date found and no next step at all, try AI extraction
      maybeExtractNextSteps();
    } else if (!entry.cachedCalendarEvents?.length) {
      // Still render the meetings timeline so the "+ Add meeting" button is available
      statusEl.style.display = 'none';
      renderMeetingsTimeline([], null);
    }
  });

  // Set context overrides from cache so embedded chat panels have context immediately
  function applyGranolaContextOverrides() {
    if (typeof setChatContext !== 'function') return;
    const allCtx = entry.cachedMeetingTranscript || entry.cachedMeetingNotes || '';
    if (allCtx) {
      setChatContext(entry.id, allCtx);               // floating chat (uses base entry.id as key)
    }
    (entry.cachedMeetings || []).forEach(m => {
      if (m.transcript) setChatContext(`${entry.id}-meeting-${m.id}`, resolveTranscriptSpeakers(m.transcript, m));
    });
    // Manual meetings context
    (entry.manualMeetings || []).forEach(m => {
      const ctx = m.transcript || m.notes || '';
      if (ctx) setChatContext(`${entry.id}-meeting-${m.id}`, ctx);
    });
  }
  applyGranolaContextOverrides();

  // Refresh Granola only if forced or we have no notes or cache is older than 30 minutes
  const granolaAge = (entry.cachedMeetingNotes && entry.cachedMeetingNotesAt)
    ? (Date.now() - entry.cachedMeetingNotesAt) / 60000
    : Infinity;
  const missingStructuredMeetings = !entry.cachedMeetings?.length;
  if (!forceRefresh && granolaAge < 30 && !missingStructuredMeetings) return;

  Promise.race([
    new Promise(r => {
      const companyDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
      chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company, companyDomain, contactNames }, result => {
        void chrome.runtime.lastError;
        r(result || { notes: null });
      });
    }),
    new Promise(r => setTimeout(() => r({ notes: null, error: 'timeout' }), 20000))
  ]).then(granolaResult => {
    if (!document.getElementById('act-meetings-content')) return;
    const granolaNotes = granolaResult?.notes || null;
    const granolaTranscript = granolaResult?.transcript || null;
    const granolaMeetings = granolaResult?.meetings || null;
    if (granolaNotes || granolaTranscript || granolaMeetings?.length) {
      saveEntry({
        cachedMeetingNotes: granolaNotes,
        cachedMeetingTranscript: granolaTranscript,
        cachedMeetings: granolaMeetings,
        cachedMeetingNotesAt: Date.now(),
      });
      applyGranolaContextOverrides();
      if (granolaResult.extractedContacts?.length) {
        mergeExtractedContacts(granolaResult.extractedContacts);
      }
      const calEvents = entry.cachedCalendarEvents || [];
      renderMeetingsTimeline(calEvents, granolaNotes);
      const activityContainer = document.getElementById('activity-timeline');
      if (activityContainer && document.querySelector('.hub-tab[data-tab="activity"]')?.classList.contains('active')) {
        activityContainer.innerHTML = buildActivityTimeline(entry);
      }

      // Auto-populate next step + date if not already set
      maybeExtractNextSteps();
      // Tier 1: free regex field sync on new meeting data
      chrome.runtime.sendMessage({ type: 'SYNC_ENTRY_FIELDS', entryId: entry.id }, () => void chrome.runtime.lastError);
      // Tier 2: lightweight AI extraction on meeting content (Nano, ~$0.0001)
      const meetingText = (granolaMeetings || []).slice(0, 3).map(m =>
        `${m.title || 'Meeting'} | ${m.date || ''}\n${(m.summaryMarkdown || m.transcript || m.summary || '').slice(0, 1000)}`
      ).join('\n\n');
      if (meetingText.length > 30) {
        chrome.runtime.sendMessage({ type: 'EXTRACT_FIELDS_FROM_CONTENT', entryId: entry.id, content: meetingText, contentType: 'meetings' }, () => void chrome.runtime.lastError);
      }
      // Auto-refresh role brief if new meetings arrived since brief was last generated
      maybeAutoRefreshBrief();
    }
  });
}

// ── Avatar / date helpers (used by renderMeetingsTimeline + renderMeetingDetail) ──

const _MTG_AVATAR_COLORS = ['#FC636B', '#3B82F6', '#36B37E', '#F5A623', '#7C6EF0'];
function _mtgHashColor(name) {
  if (!name) return _MTG_AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  return _MTG_AVATAR_COLORS[Math.abs(h) % _MTG_AVATAR_COLORS.length];
}
function _mtgInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function _mtgAvatarHtml(names) {
  if (!names || !names.length) return '';
  const list = names.slice(0, 3);
  const overflow = Math.max(0, names.length - 3);
  const avatars = list.map(name => {
    const color = name === 'Me' ? '#36B37E' : _mtgHashColor(name);
    return `<span class="mtg-avatar" style="background:${color}" title="${escapeHtml(name)}">${escapeHtml(_mtgInitials(name))}</span>`;
  }).join('');
  const plus = overflow ? `<span class="mtg-avatar mtg-avatar-overflow">+${overflow}</span>` : '';
  return `<div class="mtg-avatar-row">${avatars}${plus}</div>`;
}
function _mtgNamesHtml(names) {
  if (!names || !names.length) return '';
  return escapeHtml(names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : ''));
}
function _mtgParseAttendees(attendeesVal) {
  if (Array.isArray(attendeesVal)) return attendeesVal.map(a => (typeof a === 'string' ? a : a.name || a.email || '').trim()).filter(Boolean);
  if (typeof attendeesVal === 'string' && attendeesVal.trim()) return attendeesVal.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}
function _dateGroupLabel(dateKey) {
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

function renderMeetingsTimeline(events, granolaNotes, granolaError) {
  const contentEl = document.getElementById('act-meetings-content');
  if (!contentEl) return;

  const dismissed = new Set(entry.dismissedMeetings || []);
  const granolaM = (entry.cachedMeetings || []).filter(m => !dismissed.has(m.id)).map(m => ({ ...m, _isManual: false }));
  const manualM = (entry.manualMeetings || []).map(m => ({ ...m, _isManual: true }));
  const meetings = [...granolaM, ...manualM].sort((a, b) => {
    const da = a.date || ''; const db = b.date || '';
    return da < db ? 1 : da > db ? -1 : 0;
  });
  let html = '';

  // ── "+ Add meeting" button and form ────────────────────────────────────────
  html += `<button class="mtg-add-btn" id="mtg-add-btn">+ Add meeting</button>`;
  html += `
    <div class="mtg-add-form" id="mtg-add-form" style="display:none">
      <div class="mtg-add-title">Log a meeting</div>
      <div class="mtg-add-fields">
        <input type="text" class="mtg-add-input" id="mm-title" placeholder="Meeting title…">
        <div style="display:flex;gap:8px">
          <input type="date" class="mtg-add-input" id="mm-date" style="flex:1">
          <input type="text" class="mtg-add-input" id="mm-time" placeholder="e.g. 2:00 PM" style="flex:1">
        </div>
        <input type="text" class="mtg-add-input" id="mm-attendees" placeholder="e.g. Sarah Chen, VP Sales">
        <textarea class="mtg-add-input" id="mm-notes" rows="4" placeholder="Key takeaways, decisions, action items…"></textarea>
        <div class="mtg-transcript-toggle" id="mm-transcript-toggle">+ Add full transcript</div>
        <textarea class="mtg-add-input" id="mm-transcript" rows="8" placeholder="Paste full meeting transcript…" style="display:none"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="mtg-add-save" id="mm-save">Save meeting</button>
          <button class="mtg-add-cancel" id="mm-cancel">Cancel</button>
        </div>
      </div>
    </div>`;


  // ── Combined meeting list (Granola + Manual, sorted by date desc) ──────────
  if (meetings.length) {
    // Group by date key, preserving sort order
    const groups = [];
    const groupMap = {};
    meetings.forEach(m => {
      const label = _dateGroupLabel(m.date || '');
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
        const attendeeNames = _mtgParseAttendees(m.attendees);
        const avatarHtml = _mtgAvatarHtml(attendeeNames);
        const namesHtml = _mtgNamesHtml(attendeeNames);

        // Takeaways: parse from summaryMarkdown bullet lines if available
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

        const granolaChip = (!m._isManual && m.url)
          ? `<a class="mtg-granola-link" href="${safeUrl(m.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"><span class="granola-glyph"></span>Granola ↗</a>`
          : '';

        const dismissBtn = !m._isManual
          ? `<button class="mtg-card-dismiss" data-dismiss-id="${escapeHtml(m.id)}" title="Not related to this company">✕</button>`
          : '';
        const manualActions = m._isManual
          ? `<button class="mtg-card-edit" data-mm-edit="${escapeHtml(m.id)}" title="Edit">✎</button><button class="mtg-card-del" data-mm-del="${escapeHtml(m.id)}" title="Delete">✕</button>`
          : dismissBtn;

        html += `
          <div class="mtg-card" data-meeting-id="${escapeHtml(m.id)}" data-is-manual="${m._isManual ? '1' : '0'}">
            <div class="mtg-date">
              <div class="mtg-date-day">${dayNum}</div>
              <div class="mtg-date-mon">${monShort}</div>
              ${timeShort ? `<div class="mtg-date-time">${escapeHtml(timeShort)}</div>` : ''}
            </div>
            <div class="mtg-body">
              <div class="mtg-title-row">
                <div class="mtg-title">${escapeHtml(m.title || 'Untitled')}</div>
                ${m._isManual ? '<span class="mtg-manual-badge">Manual</span>' : ''}
              </div>
              ${(avatarHtml || namesHtml) ? `<div class="mtg-participants">${avatarHtml}<span class="mtg-names">${namesHtml}</span></div>` : ''}
              ${contentHtml}
            </div>
            <div class="mtg-card-actions">
              ${granolaChip}
              ${manualActions}
            </div>
          </div>`;
      }
    }
    html += '</div>';

  } else if (events.length) {
    // Fallback: calendar-only view
    const groups = [];
    const groupMap2 = {};
    [...events].reverse().forEach(ev => {
      const evD = new Date(ev.start);
      const key = isNaN(evD) ? ev.start : evD.toISOString().slice(0, 10);
      const label = _dateGroupLabel(key);
      if (!groupMap2[label]) { groupMap2[label] = { label, items: [] }; groups.push(groupMap2[label]); }
      groupMap2[label].items.push(ev);
    });

    html += '<div class="mtg-list">';
    for (const group of groups) {
      html += `<div class="mtg-date-group">${escapeHtml(group.label)}</div>`;
      for (const ev of group.items) {
        const evD = new Date(ev.start);
        const dayNum = isNaN(evD) ? '' : evD.getDate();
        const monShort = isNaN(evD) ? '' : evD.toLocaleDateString('en-US', { month: 'short' });
        const timeStr = (ev.start.includes('T') && !isNaN(evD))
          ? evD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase()
          : '';
        const attendeeNames = (ev.attendees || []).filter(a => !a.self).map(a => a.name || a.email).filter(Boolean);
        const avatarHtml = _mtgAvatarHtml(attendeeNames);
        const namesHtml = _mtgNamesHtml(attendeeNames);
        html += `
          <div class="mtg-card mtg-card-cal">
            <div class="mtg-date">
              <div class="mtg-date-day">${dayNum}</div>
              <div class="mtg-date-mon">${monShort}</div>
              ${timeStr ? `<div class="mtg-date-time">${escapeHtml(timeStr)}</div>` : ''}
            </div>
            <div class="mtg-body">
              <div class="mtg-title-row"><div class="mtg-title">${escapeHtml(ev.title)}</div></div>
              ${(avatarHtml || namesHtml) ? `<div class="mtg-participants">${avatarHtml}<span class="mtg-names">${namesHtml}</span></div>` : ''}
            </div>
          </div>`;
      }
    }
    html += '</div>';
  }

  if (!meetings.length && !events.length) html += '<div class="p-empty">No meetings found.</div>';

  contentEl.innerHTML = html;

  // Init "ask all meetings" chat panel
  if (typeof initChatPanels === 'function') initChatPanels(entry);

  // ── Manual meeting form wiring ─────────────────────────────────────────────
  let _mmEditId = null; // tracks which manual meeting is being edited
  const addBtn = contentEl.querySelector('#mtg-add-btn');
  const addForm = contentEl.querySelector('#mtg-add-form');
  const mmTitle = contentEl.querySelector('#mm-title');
  const mmDate = contentEl.querySelector('#mm-date');
  const mmTime = contentEl.querySelector('#mm-time');
  const mmAttendees = contentEl.querySelector('#mm-attendees');
  const mmNotes = contentEl.querySelector('#mm-notes');
  const mmTranscript = contentEl.querySelector('#mm-transcript');
  const mmTranscriptToggle = contentEl.querySelector('#mm-transcript-toggle');
  const mmSave = contentEl.querySelector('#mm-save');
  const mmCancel = contentEl.querySelector('#mm-cancel');

  if (addBtn && addForm) {
    // Default date to today
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

      if (!title && !notes && !transcript) return; // require at least something

      const current = entry.manualMeetings || [];

      if (_mmEditId) {
        // Update existing
        const idx = current.findIndex(m => m.id === _mmEditId);
        if (idx !== -1) {
          current[idx] = { ...current[idx], title, date, time, attendees, notes, transcript, updatedAt: Date.now() };
        }
      } else {
        // Create new
        current.unshift({
          id: 'mm_' + Date.now(),
          title, date, time, attendees, notes, transcript,
          createdAt: Date.now(),
        });
      }

      saveEntry({ manualMeetings: current });

      // Set chat context for this manual meeting
      if (typeof setChatContext === 'function') {
        const m = _mmEditId ? current.find(x => x.id === _mmEditId) : current[0];
        if (m) setChatContext(`${entry.id}-meeting-${m.id}`, m.transcript || m.notes || '');
      }

      _mmEditId = null;
      renderMeetingsTimeline(events, granolaNotes);
    });
  }

  // ── Edit / Delete handlers for manual meetings ─────────────────────────────
  contentEl.querySelectorAll('[data-mm-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mid = btn.dataset.mmEdit;
      const m = (entry.manualMeetings || []).find(x => x.id === mid);
      if (!m || !addForm) return;
      _mmEditId = mid;
      mmTitle.value = m.title || '';
      mmDate.value = m.date || '';
      mmTime.value = m.time || '';
      mmAttendees.value = m.attendees || '';
      mmNotes.value = m.notes || '';
      mmTranscript.value = m.transcript || '';
      mmTranscript.style.display = m.transcript ? '' : 'none';
      mmTranscriptToggle.textContent = m.transcript ? '− Hide transcript' : '+ Add full transcript';
      mmSave.textContent = 'Update meeting';
      addForm.style.display = '';
      addBtn.style.display = 'none';
      mmTitle.focus();
    });
  });

  contentEl.querySelectorAll('[data-mm-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mid = btn.dataset.mmDel;
      const current = (entry.manualMeetings || []).filter(x => x.id !== mid);
      saveEntry({ manualMeetings: current });
      renderMeetingsTimeline(events, granolaNotes);
    });
  });

  // Dismiss wrong Granola meetings
  contentEl.querySelectorAll('.mtg-card-dismiss').forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.color = '#e5483b'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.5'; btn.style.color = '#99acc2'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mid = btn.dataset.dismissId;
      // Add to dismissed meetings list on the entry
      const dismissed = entry.dismissedMeetings || [];
      if (!dismissed.includes(mid)) dismissed.push(mid);
      saveEntry({ dismissedMeetings: dismissed });
      // Remove from cached meetings
      const cached = (entry.cachedMeetings || []).filter(m => m.id !== mid);
      saveEntry({ cachedMeetings: cached });
      // Remove the card from DOM
      const card = btn.closest('.mtg-card');
      if (card) { card.style.opacity = '0.3'; setTimeout(() => card.remove(), 300); }
    });
  });

  // Meeting card click → detail view (for both Granola and manual meetings)
  contentEl.querySelectorAll('.mtg-card[data-meeting-id]').forEach(card => {
    card.addEventListener('click', () => {
      const mid = card.dataset.meetingId;
      const isManual = card.dataset.isManual === '1';
      let meeting;
      if (isManual) {
        meeting = (entry.manualMeetings || []).find(m => m.id === mid);
        if (meeting) {
          // Manual meetings render detail with notes as body
          renderManualMeetingDetail(contentEl, meeting, events, granolaNotes);
        }
      } else {
        meeting = (entry.cachedMeetings || []).find(m => m.id === mid);
        if (meeting) renderMeetingDetail(contentEl, meeting, events, granolaNotes);
      }
    });
  });

}

function renderManualMeetingDetail(contentEl, meeting, events, granolaNotes) {
  // Set context for this meeting's chat before rendering
  if (typeof setChatContext === 'function') {
    const ctx = meeting.transcript ? resolveTranscriptSpeakers(meeting.transcript, meeting) : (meeting.notes || '');
    setChatContext(`${entry.id}-meeting-${meeting.id}`, ctx);
  }
  _renderMeetingDetailShared(contentEl, meeting, events, granolaNotes);
}

function renderMeetingDetail(contentEl, meeting, events, granolaNotes) {
  // Set context for this meeting's chat before rendering
  const resolvedTranscript = meeting.transcript ? resolveTranscriptSpeakers(meeting.transcript, meeting) : '';
  if (typeof setChatContext === 'function' && resolvedTranscript) {
    setChatContext(`${entry.id}-meeting-${meeting.id}`, resolvedTranscript);
  }
  _renderMeetingDetailShared(contentEl, meeting, events, granolaNotes);
}

function _renderMeetingDetailShared(contentEl, meeting, events, granolaNotes) {
  const d = meeting.date ? new Date(meeting.date + 'T12:00:00') : null;
  const dateStr = (d && !isNaN(d))
    ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : (meeting.date || '');
  const timeStr = meeting.time || '';
  const granolaUrl = meeting.url || null;
  const attendeeNames = _mtgParseAttendees(meeting.attendees);
  const avatarHtml = _mtgAvatarHtml(attendeeNames);
  const namesHtml = _mtgNamesHtml(attendeeNames);

  // Notes body (manual: meeting.notes; Granola: summaryMarkdown or summary)
  const notesSource = meeting._isManual
    ? (meeting.notes || '')
    : (meeting.summaryMarkdown || meeting.summary || '');

  // Transcript
  const resolvedTranscript = meeting.transcript ? resolveTranscriptSpeakers(meeting.transcript, meeting) : '';

  // Render notes with markdown helper
  const notesHtml = notesSource
    ? `<div class="detail-notes">${typeof renderMarkdown === 'function' ? renderMarkdown(notesSource) : escapeHtml(notesSource)}</div>`
    : '';

  // Transcript body: try to detect speaker-diarized format ("Speaker Name: utterance").
  // The same pattern is used for both detection and parsing so mid-sentence colons
  // in utterance text don't accidentally start a new speaker block. Require two or
  // more matching lines before treating the transcript as diarized.
  const SPEAKER_LINE = /^([A-Z][A-Za-z .'-]{0,40}):\s(.*)$/;
  let transcriptBodyHtml = '';
  if (resolvedTranscript) {
    const lines = resolvedTranscript.split('\n');
    const speakerLineCount = lines.reduce((n, l) => n + (SPEAKER_LINE.test(l) ? 1 : 0), 0);
    if (speakerLineCount >= 2) {
      const blocks = [];
      let current = null;
      lines.forEach(line => {
        const m = line.match(SPEAKER_LINE);
        if (m) {
          if (current) blocks.push(current);
          current = { speaker: m[1], utterance: m[2] };
        } else if (current) {
          current.utterance += ' ' + line;
        }
      });
      if (current) blocks.push(current);
      transcriptBodyHtml = blocks.map(b =>
        `<div class="tx-block"><span class="tx-speaker">${escapeHtml(b.speaker)}</span><span class="tx-utterance"> ${escapeHtml(b.utterance.trim())}</span></div>`
      ).join('');
    } else {
      transcriptBodyHtml = resolvedTranscript.split('\n').filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
    }
  }

  contentEl.innerHTML = `
    <button class="panel-back" id="mtg-back">← Meetings</button>
    <div class="detail-head">
      <div class="detail-title-row">
        <div class="detail-title">${escapeHtml(meeting.title || 'Untitled')}</div>
        ${granolaUrl ? `<a class="detail-granola-btn" href="${safeUrl(granolaUrl)}" target="_blank" rel="noopener noreferrer"><span class="granola-logo-lg"></span>Open in Granola</a>` : ''}
      </div>
      <div class="detail-meta">
        ${avatarHtml}
        ${namesHtml ? `<span>${namesHtml}</span>` : ''}
        ${(avatarHtml || namesHtml) && (dateStr || timeStr) ? `<span class="detail-meta-sep">·</span>` : ''}
        ${dateStr ? `<span>${escapeHtml(dateStr)}${timeStr ? ' at ' + escapeHtml(timeStr) : ''}</span>` : ''}
        ${meeting._isManual ? `<span class="detail-meta-sep">·</span><span class="mtg-manual-badge">Manual</span>` : ''}
      </div>
    </div>

    ${notesHtml ? `
    <div class="detail-section">
      <div class="detail-section-head">
        <h3>Summary</h3>
        ${!meeting._isManual ? `<span class="detail-source-badge"><span class="granola-glyph"></span>from Granola</span>` : ''}
        ${granolaUrl ? `<a class="edit-link" href="${safeUrl(granolaUrl)}" target="_blank" rel="noopener noreferrer">View in Granola ↗</a>` : ''}
      </div>
      ${notesHtml}
    </div>` : ''}

    ${resolvedTranscript ? `
    <div class="detail-transcript" id="mtg-transcript-collapse">
      <div class="detail-transcript-head" id="mtg-transcript-toggle-btn">
        <h3>Full transcript</h3>
        <span class="detail-transcript-chevron">›</span>
      </div>
      <div class="detail-transcript-body">
        <div class="detail-transcript-inner">${transcriptBodyHtml}</div>
      </div>
    </div>` : ''}

    <div class="detail-coop">
      <div class="detail-coop-head">
        <h3>My notes</h3>
        <span class="coop-label"><span class="coop-dot"></span>Coop</span>
        <span class="detail-coop-saved-indicator" id="detail-coop-saved-indicator">✓ Saved to Private notes</span>
      </div>
      <div class="detail-coop-compose" id="detail-coop-compose">
        <div class="detail-coop-editable notes-empty-edit" id="detail-coop-editable" contenteditable="true"></div>
        <div class="detail-coop-compose-actions">
          <button class="detail-coop-save-btn" id="detail-coop-save-btn" disabled>+ Add note</button>
        </div>
      </div>
      <div class="detail-coop-notes-list" id="detail-coop-notes-list"></div>
    </div>
  `;

  if (typeof initChatPanels === 'function') initChatPanels(entry);

  // Transcript toggle (styled collapse, not <details>)
  const transcriptCollapse = contentEl.querySelector('#mtg-transcript-collapse');
  const transcriptToggleBtn = contentEl.querySelector('#mtg-transcript-toggle-btn');
  if (transcriptCollapse && transcriptToggleBtn) {
    transcriptToggleBtn.addEventListener('click', () => {
      transcriptCollapse.classList.toggle('open');
    });
  }

  // ── My notes composer ───────────────────────────────────────────────────────
  const coopEditable = contentEl.querySelector('#detail-coop-editable');
  const coopSaveBtn = contentEl.querySelector('#detail-coop-save-btn');
  const coopNotesList = contentEl.querySelector('#detail-coop-notes-list');
  const coopSavedIndicator = contentEl.querySelector('#detail-coop-saved-indicator');

  function _renderDetailNotesList() {
    const meetingNotes = (entry.notesFeed || [])
      .filter(n => n.meetingId === meeting.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!coopNotesList) return;
    if (!meetingNotes.length) {
      coopNotesList.innerHTML = '<div class="detail-coop-empty">No notes for this meeting yet.</div>';
      return;
    }
    coopNotesList.innerHTML = meetingNotes.map(n => {
      const d = new Date(n.createdAt);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `
        <div class="note-card" data-detail-note-id="${escapeHtml(n.id)}">
          <div class="note-card-header">
            <span class="note-card-date">${dateStr} · ${timeStr}</span>
            <span class="note-card-actions">
              <button class="note-del-btn detail-note-del-btn" data-detail-note-id="${escapeHtml(n.id)}" title="Delete">✕</button>
            </span>
          </div>
          <div class="note-card-body">${n.content}</div>
        </div>`;
    }).join('');

    coopNotesList.querySelectorAll('.detail-note-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nid = btn.dataset.detailNoteId;
        entry.notesFeed = (entry.notesFeed || []).filter(n => n.id !== nid);
        const latest = entry.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        saveEntry({ notesFeed: entry.notesFeed, notes: latest?.content || '' });
        _renderDetailNotesList();
        // Re-render the private notes panel if it's visible
        if (typeof renderNotesFeed === 'function') renderNotesFeed();
      });
    });
  }

  _renderDetailNotesList();

  if (coopEditable && coopSaveBtn) {
    coopEditable.addEventListener('input', () => {
      const hasContent = !!coopEditable.textContent.trim();
      coopEditable.classList.toggle('notes-empty-edit', !hasContent);
      coopSaveBtn.disabled = !hasContent;
    });

    coopEditable.addEventListener('focus', () => {
      coopEditable.classList.remove('notes-empty-edit');
    });

    coopEditable.addEventListener('blur', () => {
      if (!coopEditable.textContent.trim()) coopEditable.classList.add('notes-empty-edit');
    });

    function _saveDetailNote() {
      const content = sanitizeNotesHtml(coopEditable.innerHTML).trim();
      if (!content || !coopEditable.textContent.trim()) return;
      const now = Date.now();
      const newNote = {
        id: 'note_' + now.toString(36) + Math.random().toString(36).substr(2),
        content,
        createdAt: now,
        updatedAt: now,
        meetingId: meeting.id,
      };
      entry.notesFeed = [newNote, ...(entry.notesFeed || [])];
      const latest = entry.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      saveEntry({ notesFeed: entry.notesFeed, notes: latest?.content || '' });
      coopEditable.innerHTML = '<p><br></p>';
      coopEditable.classList.add('notes-empty-edit');
      coopSaveBtn.disabled = true;
      _renderDetailNotesList();
      // Re-render the private notes panel if it's visible
      if (typeof renderNotesFeed === 'function') renderNotesFeed();
      // Brief flash on the saved indicator
      if (coopSavedIndicator) {
        coopSavedIndicator.style.opacity = '1';
        setTimeout(() => { coopSavedIndicator.style.opacity = ''; }, 2000);
      }
    }

    coopSaveBtn.addEventListener('click', _saveDetailNote);

    coopEditable.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        _saveDetailNote();
      }
    });

    coopEditable.addEventListener('paste', e => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      if (html) {
        document.execCommand('insertHTML', false, sanitizeNotesHtml(html));
      } else {
        document.execCommand('insertText', false, text);
      }
    });
  }

  contentEl.querySelector('#mtg-back').addEventListener('click', () => {
    renderMeetingsTimeline(events, granolaNotes);
  });
}

function buildPanelHTML(pid) {
  if (pid === 'properties') return ''; // merged into opportunity panel
  const title = PANEL_TITLES[pid] || pid;
  const collapsed = !!collapsedPanels[pid];
  const body = buildPanelBody(pid);
  return `
    <div class="panel" id="panel-${pid}" data-panel="${pid}" draggable="true">
      <div class="panel-header">
        <span class="panel-drag-hint">⠿</span>
        <span class="panel-title">${title}</span>
        <button class="panel-collapse-btn" data-panel="${pid}">${collapsed ? '▼' : '▲'}</button>
      </div>
      <div class="panel-body${collapsed ? ' collapsed' : ''}" id="pbody-${pid}">
        ${body}
      </div>
    </div>`;
}

function renderPanel(pid) {
  const el = document.getElementById('panel-' + pid);
  if (!el) return;
  const body = document.getElementById('pbody-' + pid);
  if (body) body.innerHTML = buildPanelBody(pid);
  bindPanelBodyEvents(pid);
}

function buildPanelBody(pid) {
  switch (pid) {
    case 'properties': return buildProperties();
    case 'stats':      return buildStats();    // legacy fallback
    case 'links':      return buildLinks();    // legacy fallback
    case 'tags':       return buildTags();
    case 'notes':      return buildNotes();
    case 'overview':   return buildOverview();
    case 'intel':      return buildIntel();
    case 'reviews':    return buildReviews();
    case 'leadership': return buildLeadership();
    case 'contacts':   return buildContacts();
    case 'opportunity':    return buildOpportunity();
    case 'opportunities':  return buildOpportunity(); // legacy alias
    case 'hiring':     return buildHiring();
    case 'activity':   return buildActivity();
    case 'chat':       return `<button class="open-float-chat-btn" data-action="open-float-chat">✦ Open AI Chat</button>`;
    default: return '<div class="p-empty">No content.</div>';
  }
}

function buildProperties() {
  const allFields = [...DEFAULT_FIELD_DEFS, ...customFieldDefs];
  const rows = allFields.map(f => {
    const isCustom = !DEFAULT_FIELD_DEFS.find(d => d.id === f.id);

    // Website and LinkedIn render as clean hyperlinks
    if (f.id === 'companyWebsite' || f.id === 'companyLinkedin') {
      const icon = f.id === 'companyWebsite' ? '🌐' : '🔗';
      const displayText = f.id === 'companyWebsite'
        ? (entry[f.id] ? entry[f.id].replace(/^https?:\/\//, '').replace(/\/$/, '') : null)
        : (entry[f.id] ? 'LinkedIn' : null);
      const placeholder = f.id === 'companyWebsite' ? 'Add website URL…' : 'Add LinkedIn URL…';
      return `<div class="prop-row prop-link-row" data-field="${f.id}">
        ${entry[f.id]
          ? `<a class="prop-link-display" href="${safeUrl(entry[f.id])}" target="_blank">${icon} ${displayText}</a>
             <button class="prop-link-edit" data-field="${f.id}" title="Edit">✎</button>`
          : `<span class="prop-link-icon">${icon}</span>
             <input class="prop-input prop-empty prop-link-input" data-field="${f.id}" value="" placeholder="${placeholder}" type="url">`}
      </div>`;
    }

    const rawVal = entry[f.id];
    const val = (typeof rawVal === 'string' ? rawVal : rawVal != null ? String(rawVal) : '').replace(/"/g, '&quot;');
    // Always show employees and industry; hide other empty metadata fields
    const alwaysShow = ['employees', 'industry'].includes(f.id);
    const isMetadataField = ['employees', 'funding', 'founded', 'industry', 'revenue', 'companyType'].includes(f.id);
    if (isMetadataField && !val && !alwaysShow) return '';
    const isUrl = f.type === 'url';
    const openLink = isUrl && entry[f.id]
      ? `<a class="prop-open-link" href="${safeUrl(entry[f.id])}" target="_blank">↗</a>` : '';
    return `<div class="prop-row" data-field="${f.id}">
      <span class="prop-label">${f.label}</span>
      <div class="prop-val-wrap">
        <input class="prop-input${!val ? ' prop-empty' : ''}" data-field="${f.id}" value="${val}" placeholder="—" ${isUrl ? 'type="url"' : ''}>
        ${openLink}
      </div>
      ${isCustom ? `<button class="prop-delete-btn" data-field="${f.id}" title="Remove field">✕</button>` : ''}
    </div>`;
  }).join('');

  return `<div class="prop-fields" id="prop-fields">${rows}</div>`;
}

function buildStats() {
  const rows = [
    ['Employees', entry.employees],
    ['Funding',   entry.funding],
    ['Revenue',   entry.revenue],
    ['Founded',   entry.founded],
    ['Industry',  entry.industry || entry.intelligence?.category || entry.category],
    ['Type',      entry.companyType],
  ].filter(([, v]) => v);
  if (!rows.length) return '<div class="p-empty">No stats available.</div>';
  return rows.map(([label, val]) => `
    <div class="p-stat">
      <span class="p-stat-label">${label}</span>
      <span class="p-stat-value">${val}</span>
    </div>`).join('');
}

function buildLinks() {
  const li = entry.companyLinkedin || `https://www.linkedin.com/company/${encodeURIComponent((entry.company||'').toLowerCase().replace(/\s+/g,'-'))}`;
  return `
    ${entry.companyWebsite ? `<a class="p-link web" href="${safeUrl(entry.companyWebsite)}" target="_blank">🌐 ${entry.companyWebsite.replace(/^https?:\/\//,'')}</a>` : ''}
    <a class="p-link li" href="${safeUrl(li)}" target="_blank">in LinkedIn</a>
    ${entry.url ? `<a class="p-link" style="color:#FF7A59" href="${safeUrl(entry.url)}" target="_blank">↗ Source Page</a>` : ''}
  `.trim() || '<div class="p-empty">No links saved.</div>';
}

function buildTags() {
  const tags = entry.tags || [];
  const tagHTML = tags.map(t => {
    const c = tagColor(t);
    return `<span class="p-tag" style="border-color:${c.border};color:${c.color};background:${c.bg}">${t}<span class="tag-rm" data-tag="${t}">✕</span></span>`;
  }).join('');
  return `<div class="p-tags" id="co-tags">
    ${tagHTML}
    <div class="tag-wrap" id="tag-add-wrap">
      <button class="tag-add-btn" id="tag-add-btn">+ tag</button>
    </div>
  </div>`;
}

function buildNotes() {
  return `<textarea class="p-notes" id="co-notes" placeholder="Add notes about this company…">${entry.notes || ''}</textarea>`;
}

function buildOverview() {
  const intel = entry.intelligence || {};
  // intelligence fields take priority — they're fresher than top-level entry fields
  const oneLiner = intel.oneLiner || entry.oneLiner || '';
  const eli5 = intel.eli5 || '';
  const cat = intel.category || entry.category || '';
  // Use oneLiner if available; fall back to eli5 if not — never show both
  const description = oneLiner || eli5;
  if (!description && !cat) return '<div class="p-empty">No overview available.</div>';
  return `
    ${cat ? `<span class="p-category">${cat}</span>` : ''}
    ${description ? `<div class="p-oneliner">${description}</div>` : ''}
  `.trim();
}

function buildIntel() {
  const intel = entry.intelligence || {};
  const parts = [
    intel.whosBuyingIt  ? ['Who Buys It',  intel.whosBuyingIt]  : null,
    intel.howItWorks    ? ['How It Works', intel.howItWorks]    : null,
  ].filter(Boolean);
  if (!parts.length) return '<div class="p-empty">No intel available.</div>';
  const innerHtml = parts.length === 2
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:10px;">
        ${parts.map(([label, text]) => `<div>
          <div class="p-section-label">${label}</div>
          <div class="p-text" style="margin-top:6px;">${text}</div>
        </div>`).join('')}
      </div>`
    : parts.map(([label, text]) => `<div style="margin-top:10px;">
        <div class="p-section-label">${label}</div>
        <div class="p-text" style="margin-top:6px;">${text}</div>
      </div>`).join('');
  // Tech stack pills
  const techStack = entry.techStack || [];
  const techHtml = techStack.length ? `
    <div style="margin-top:14px;">
      <div class="p-section-label">Tech Stack</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
        ${techStack.slice(0, 15).map(t => `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--ci-bg-inset);color:var(--ci-text-secondary);border:1px solid var(--ci-border-light);">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>` : '';

  // Recent news
  const news = entry.recentNews || [];
  const newsHtml = news.length ? `
    <div style="margin-top:14px;">
      <div class="p-section-label">Recent News</div>
      ${news.slice(0, 4).map(n => `<div style="margin-top:6px;font-size:12px;color:var(--ci-text-secondary);">
        <span style="font-weight:500;color:var(--ci-text-primary);">${escapeHtml(n.headline || '')}</span>
        ${n.date ? `<span style="color:var(--ci-text-tertiary);margin-left:6px;">${escapeHtml(n.date)}</span>` : ''}
        ${n.significance ? `<div style="color:var(--ci-text-tertiary);margin-top:2px;">${escapeHtml(n.significance)}</div>` : ''}
      </div>`).join('')}
    </div>` : '';

  return `<details class="p-section" open>
    <summary style="cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:8px;padding:6px 0;">
      <span style="font-size:12px;color:#FF7A59;transition:transform 0.15s;display:inline-block;" class="intel-chevron">▾</span>
      <span class="p-section-label" style="margin:0;color:#2d3e50;">Company Intel</span>
    </summary>
    ${innerHtml}${techHtml}${newsHtml}
  </details>`;
}

function _getReviewId(r) {
  return r.url || `${r.source || 'Web'}|${(r.snippet || '').slice(0, 80)}`;
}

function buildReviews() {
  const allReviews = (entry.reviews || []).slice(0, 5);
  if (!allReviews.length) return '<div class="p-empty">No reviews saved.</div>';
  const dismissed = new Set(entry.dismissedReviews || []);
  const visible = allReviews.filter(r => !dismissed.has(_getReviewId(r)));
  const hiddenCount = allReviews.length - visible.length;

  const reviewsHtml = visible.map(r => {
    const rid = _getReviewId(r).replace(/"/g, '&quot;');
    const snippet = escapeHtml(r.snippet || '');
    const source = escapeHtml(r.source || '');
    return `
    <div class="p-review">
      <button class="p-review-dismiss" data-rid="${rid}" title="Dismiss">×</button>
      "${snippet}"
      <div class="p-review-src">${source ? (r.url ? `<a href="${safeUrl(r.url)}" target="_blank">${source}</a>` : source) : ''}</div>
    </div>`;
  }).join('');

  const hiddenFooter = hiddenCount > 0
    ? `<div class="p-review-hidden">${hiddenCount} review${hiddenCount === 1 ? '' : 's'} hidden · <button class="p-review-restore">show</button></div>`
    : '';

  if (!visible.length && hiddenCount > 0) {
    return `<div class="p-empty">All reviews dismissed.</div>${hiddenFooter}`;
  }
  return (reviewsHtml + hiddenFooter) || '<div class="p-empty">No reviews saved.</div>';
}


// ── Auto-extraction: merge contacts from background.js extractedContacts ─────
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
  const userEmail = (entry.gmailUserEmail || gmailUserEmail || '').toLowerCase();

  // Get the company domain for strict domain filtering
  const companyDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  const companyBaseDomain = companyDomain ? companyDomain.split('.')[0] : '';

  // Returns true if the email domain matches this company (exact or sibling base name)
  const isCompanyDomainEmail = (emailAddr) => {
    if (!companyDomain) return false;
    const senderDomain = (emailAddr.split('@')[1] || '').toLowerCase();
    if (senderDomain === companyDomain) return true;
    // Sibling domain: same base name, different TLD (e.g. company.io vs company.ai)
    if (companyBaseDomain && senderDomain.split('.')[0] === companyBaseDomain) return true;
    return false;
  };

  let added = 0;
  for (const contact of extracted) {
    const email = (contact.email || '').toLowerCase();
    if (!email || existingEmails.has(email)) continue;
    if (email === userEmail) continue;
    if (blocked.has(email)) continue;

    // Skip generic/no-reply addresses
    if (/noreply|no-reply|mailer-daemon|postmaster|notifications|support@|info@|hello@|team@/i.test(email)) continue;

    // Domain guard: contacts sourced from bootstrap/name searches (type 'email-sender') may
    // come from emails that merely mention the company name — their sender could be anyone.
    // Only add them if their email domain actually matches this company.
    // Contacts matched via explicit domain search ('email-domain', 'email-sibling-domain',
    // 'granola-email-domain', 'granola-folder', 'granola-title', 'granola-attendee-name')
    // pass through; all others need a domain match.
    // Exception: when companyWebsite is missing we have no domain baseline, so we allow
    // any non-generic contact from the email fetch — the fetch was already scoped to this
    // company by name, so the signal is reliable enough.
    const matchType = (contact.matchedVia?.type || '').toLowerCase();
    const isDomainMatched = matchType === 'email-domain' || matchType === 'email-sibling-domain';
    if (!isDomainMatched && !isCompanyDomainEmail(email) && companyDomain) {
      // Not a domain-confirmed match and not from this company's domain — skip to prevent bleed
      continue;
    }

    const newContact = {
      name: contact.name,
      email: contact.email,
      source: contact.source || 'auto-extracted',
      addedAt: Date.now(),
      matchedVia: contact.matchedVia || null,
    };
    // Carry through signature-parsed fields (phone, title, linkedinUrl)
    if (contact.phone) newContact.phone = contact.phone;
    if (contact.title) newContact.title = contact.title;
    if (contact.linkedinUrl) newContact.linkedinUrl = contact.linkedinUrl;
    existing.push(newContact);
    existingEmails.add(email);
    added++;
  }

  if (added > 0) {
    saveEntry({ knownContacts: existing });
    // Re-render contacts panel if visible
    renderPanel('contacts');
  }
}

// Extract contacts from emails and apply to entry, purging self
function applyContactsFromEmails(emails) {
  const { newContacts, detectedUserEmail } = extractContactsFromEmails(emails);
  const blocked = new Set((entry.removedContacts || []).map(e => e.toLowerCase()));
  let current = (entry.knownContacts || []).map(c => ({ ...c, aliases: c.aliases ? [...c.aliases] : [] }));

  // Purge user's own email
  const selfEmail = detectedUserEmail || gmailUserEmail;
  if (selfEmail) {
    current = current.filter(c =>
      c.email.toLowerCase() !== selfEmail &&
      !c.aliases.some(a => a.toLowerCase() === selfEmail)
    );
  }

  let changed = selfEmail && (entry.knownContacts || []).some(c =>
    c.email.toLowerCase() === selfEmail || (c.aliases || []).some(a => a.toLowerCase() === selfEmail)
  );

  newContacts.forEach(nc => {
    // Skip contacts the user has explicitly removed
    if (blocked.has(nc.email.toLowerCase())) return;
    // Same name → merge as alias instead of new card
    const match = current.find(c => namesMatch(c.name, nc.name));
    if (match) {
      const emailLower = nc.email.toLowerCase();
      if (!match.aliases) match.aliases = [];
      if (match.email !== emailLower && !match.aliases.includes(emailLower)) {
        match.aliases.push(emailLower);
        changed = true;
      }
    } else {
      current.push(nc);
      changed = true;
    }
  });

  if (!changed) return;
  saveEntry({ knownContacts: current });
  renderPanel('contacts');
  renderPanel('leadership');
  bindPanelBodyEvents('contacts');
  bindPanelBodyEvents('leadership');
}

// Filter out non-human / mass email addresses
function isNonHumanEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  return /^(noreply|no-reply|no\.reply|donotreply|alerts?|notifications?|newsletter|marketing|updates?|digest|mailer|support|info|hello|team|news|feedback|billing|admin|postmaster|webmaster|contact|sales|help|service|system|bot|automated|unsubscribe)$/.test(local)
    || /noreply|no-reply|donotreply|notification|newsletter|mailer-daemon|bounce/i.test(local);
}

// Extracts contacts from all participants in company-related emails
function extractContactsFromEmails(emails) {
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';
  const isCompanyEmail = email => {
    const d = (email.split('@')[1] || '').toLowerCase();
    return d === domain || (baseDomain && d.split('.')[0] === baseDomain);
  };
  // Classify which specific domain rule an email matched, for traceability.
  const classifyDomain = email => {
    const d = (email.split('@')[1] || '').toLowerCase();
    if (d === domain) return { type: 'email-domain', detail: `Email participant on @${domain}` };
    if (baseDomain && d.split('.')[0] === baseDomain) return { type: 'email-sibling-domain', detail: `Email participant on sibling domain @${d} (base name matches @${domain})` };
    return { type: 'email-domain', detail: `Email participant on @${d}` };
  };

  const parseAddrs = field => {
    if (!field) return [];
    return field.split(/,\s*/).map(addr => {
      const m = addr.match(/^(.*?)\s*<([^>]+)>$/) || [null, '', addr.trim()];
      const name = (m[1] || '').replace(/^["']+|["']+$/g, '').trim();
      const email = (m[2] || '').trim().toLowerCase();
      return { name, email };
    }).filter(a => a.email.includes('@'));
  };

  // Detect the user's own email: the most frequent non-domain from: address is almost certainly the user
  const fromFreq = {};
  emails.forEach(e => {
    parseAddrs(e.from).forEach(({ email }) => {
      if (domain && isCompanyEmail(email)) return;
      fromFreq[email] = (fromFreq[email] || 0) + 1;
    });
  });
  const detectedUserEmail = gmailUserEmail ||
    (entry.gmailUserEmail || '').toLowerCase() ||
    Object.entries(fromFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const existing = new Set((entry.knownContacts || []).map(c => c.email.toLowerCase()));
  const newContacts = [];

  emails.forEach(e => {
    const allAddrs = [...parseAddrs(e.from), ...parseAddrs(e.to), ...parseAddrs(e.cc)];
    // Only process emails that involve someone from the company domain
    // If no domain is known, skip contact extraction entirely — we can't filter
    if (!domain) return;
    const hasCompanyParticipant = allAddrs.some(a => isCompanyEmail(a.email));
    if (!hasCompanyParticipant) return;

    allAddrs.forEach(({ name, email }) => {
      if (!email) return;
      if (detectedUserEmail && email === detectedUserEmail) return;
      if (existing.has(email)) return;
      // Only add contacts from the company's domain
      if (!isCompanyEmail(email)) return;
      // Filter out non-human / mass email senders
      if (isNonHumanEmail(email)) return;
      existing.add(email);
      newContacts.push({ name: name || email.split('@')[0], email, source: 'email', detectedAt: Date.now(), matchedVia: classifyDomain(email) });
    });
  });

  return { newContacts, detectedUserEmail };
}

// Extract company-domain attendees from calendar events and merge into knownContacts
function applyContactsFromCalendar(calEvents) {
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  const baseDomain = domain ? domain.split('.')[0] : '';
  if (!domain) return; // can't filter without a known domain

  const isCompanyEmail = (email) => {
    const d = (email.split('@')[1] || '').toLowerCase();
    return d === domain || (baseDomain && d.split('.')[0] === baseDomain);
  };

  const userEmail = (entry.gmailUserEmail || gmailUserEmail || '').toLowerCase();
  const blocked = new Set((entry.removedContacts || []).map(e => e.toLowerCase()));
  const existing = entry.knownContacts || [];
  const existingEmails = new Set(existing.map(c => (c.email || '').toLowerCase()).filter(Boolean));

  let added = 0;
  calEvents.forEach(evt => {
    (evt.attendees || []).forEach(att => {
      if (att.self) return;
      const email = (att.email || '').toLowerCase();
      if (!email || !email.includes('@')) return;
      if (!isCompanyEmail(email)) return;
      if (email === userEmail) return;
      if (blocked.has(email)) return;
      if (existingEmails.has(email)) return;
      if (isNonHumanEmail(email)) return;
      const name = att.name || att.displayName || email.split('@')[0];
      const eventTitle = evt.title || evt.summary || 'Calendar event';
      existing.push({
        name,
        email,
        source: 'calendar',
        detectedAt: Date.now(),
        matchedVia: { type: 'calendar', detail: `Calendar attendee in "${eventTitle}"` },
      });
      existingEmails.add(email);
      added++;
    });
  });

  if (added > 0) {
    saveEntry({ knownContacts: existing });
    renderPanel('contacts');
  }
}

// Fuzzy name match: both share at least first + last word
function namesMatch(a, b) {
  const words = s => s.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const wa = words(a), wb = words(b);
  return wa.length >= 2 && wb.length >= 2 &&
    wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
}

// Merge contacts with the same name into one record with aliases
function deduplicateContacts(contacts) {
  const merged = [];
  contacts.forEach(c => {
    const existing = merged.find(m => namesMatch(m.name, c.name));
    if (existing) {
      const newEmails = [c.email, ...(c.aliases || [])].filter(
        e => e !== existing.email && !(existing.aliases || []).includes(e)
      );
      if (newEmails.length) existing.aliases = [...(existing.aliases || []), ...newEmails];
    } else {
      merged.push({ ...c, aliases: c.aliases ? [...c.aliases] : [] });
    }
  });
  return merged;
}

function buildLeadership() {
  const leaders = entry.leaders || [];
  if (!leaders.length) return '<div class="p-empty">No leadership data available.</div>';
  const contacts = entry.knownContacts || [];
  return leaders.map(l => {
    const initials = (l.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const matched = contacts.find(c => namesMatch(c.name, l.name || ''));
    const safeName = (l.name||'').replace(/"/g,'&quot;');
    const contactAction = matched
      ? `<span class="leader-is-contact">✓ Contact</span>`
      : `<button class="leader-add-contact-btn" data-name="${safeName}">+ Add as Contact</button>`;
    return `
      <div class="leader-card">
        <div class="leader-avatar" id="lavatar-${entry.id}-${encodeURIComponent(l.name||'')}">
          ${initials}
        </div>
        <div style="min-width:0;flex:1">
          <div class="leader-name">${l.name||''}</div>
          <div class="leader-role">${l.title||''}</div>
          ${matched ? `<div class="leader-email">${matched.email}</div>` : ''}
          <div class="leader-links">
            ${l.linkedinUrl||l.linkedin ? `<a class="leader-link li" href="${safeUrl(l.linkedinUrl||l.linkedin)}" target="_blank">LinkedIn</a>` : ''}
            ${l.newsUrl ? `<a class="leader-link news" href="${safeUrl(l.newsUrl)}" target="_blank">${/linkedin\.com/i.test(l.newsUrl) ? 'LinkedIn' : 'News'}</a>` : ''}
            ${contactAction}
          </div>
          <div class="leader-email-form" style="display:none">
            <input class="leader-email-input" type="email" placeholder="Email address…">
            <div class="leader-email-form-actions">
              <button class="leader-email-save-btn">Save</button>
              <button class="leader-email-cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function buildContacts() {
  const contacts = entry.knownContacts || [];
  const leaders = entry.leaders || [];
  // Human-readable short label + full reason for each matchedVia type.
  // Contacts created before this field existed fall back to the generic source icon.
  const MATCHED_VIA_LABELS = {
    'email-domain':          { label: '✉ email · domain match',        fallback: 'Matched because the sender/recipient email is on the company domain.' },
    'email-sibling-domain':  { label: '✉ email · sibling domain',      fallback: 'Matched on a sibling domain sharing the company base name.' },
    'email-sender':          { label: '✉ email · name match',          fallback: 'Matched via a Gmail thread found by searching the company name.' },
    'granola-email-domain':  { label: '📅 meeting · email domain',     fallback: 'Matched because a meeting attendee email is on the company domain.' },
    'granola-folder':        { label: '📅 meeting · Granola folder',   fallback: 'Matched because the meeting lives in a Granola folder named for the company.' },
    'granola-attendee-name': { label: '📅 meeting · attendee name',    fallback: 'Matched because a meeting attendee name matched an existing known contact.' },
    'granola-title':         { label: '📅 meeting · title match',      fallback: 'Matched because the meeting title mentions the company name.' },
    'granola-meeting':       { label: '📅 meeting',                    fallback: 'Matched via a Granola meeting associated with the company.' },
    'manual':                { label: '✎ manual',                      fallback: 'Added manually.' },
    'leader-promoted':       { label: '✎ leader · promoted',           fallback: 'Promoted from the leadership card into contacts.' },
    'calendar':              { label: '📅 calendar',                   fallback: 'Matched as an attendee in a Google Calendar event associated with this company.' },
  };
  const formatMatchedVia = (c) => {
    const mv = c.matchedVia;
    if (!mv || !mv.type) {
      // Legacy fallback for contacts created before traceability existed
      const legacy = c.source === 'manual' ? '✎ manual' : c.source === 'email' ? '✉ email' : '📅 calendar';
      return { label: legacy, detail: 'This contact was added before match reasoning was recorded, so only the high-level source is known.' };
    }
    const def = MATCHED_VIA_LABELS[mv.type] || { label: mv.type, fallback: 'No description available.' };
    return { label: def.label, detail: mv.detail || def.fallback };
  };
  const cardsHtml = contacts.length === 0
    ? `<div class="p-empty" style="font-size:12px;color:#7c98b6">No contacts yet. Add one below or scan emails.</div>`
    : contacts.map(c => {
        const initials = c.name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
        const mv = formatMatchedVia(c);
        const sourceLabel = mv.label;
        const sourceTitle = mv.detail.replace(/"/g, '&quot;');
        const safeEmail = c.email.replace(/"/g, '&quot;');
        const allEmails = [c.email, ...(c.aliases || [])];
        const emailsHtml = allEmails.map(em => {
          const se = em.replace(/"/g, '&quot;');
          return `<div class="contact-email-row">
            <span class="contact-email">${em}</span>
            <button class="contact-copy-btn" data-email="${se}" title="Copy email">⎘</button>
          </div>`;
        }).join('');
        const leader = leaders.find(l => namesMatch(l.name || '', c.name));
        const liUrl = c.linkedinUrl || leader?.linkedinUrl || leader?.linkedin || (leader?.newsUrl && /linkedin\.com/i.test(leader.newsUrl) ? leader.newsUrl : null);
        const liHtml = liUrl ? `<a class="contact-li-link" href="${safeUrl(liUrl)}" target="_blank">LinkedIn</a>` : '';
        const avatarContent = c.photoUrl
          ? `<img src="${safeUrl(c.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" onerror="this.parentElement.textContent='${initials}'">`
          : initials;
        return `
          <div class="contact-card" data-email="${safeEmail}">
            <div class="contact-avatar" id="cavatar-${encodeURIComponent(c.email)}">${avatarContent}</div>
            <div style="min-width:0;overflow:hidden;flex:1">
              <div class="contact-name">${c.name}</div>
              ${c.title ? `<div class="contact-title">${c.title}</div>` : ''}
              ${emailsHtml}
              ${c.phone ? `<div style="font-size:11px;color:var(--ci-text-secondary);margin-top:2px;">${escapeHtml(c.phone)}</div>` : ''}
              ${liHtml}
              <div class="contact-source" title="${sourceTitle}">${sourceLabel}</div>
            </div>
            <div class="contact-card-actions">
              <button class="contact-edit-btn" data-email="${safeEmail}" title="Edit">✎</button>
              <button class="contact-remove-btn" data-email="${safeEmail}" title="Remove">×</button>
            </div>
          </div>`;
      }).join('');
  return `
    ${cardsHtml}
    <div class="contact-add-row">
      <button class="contact-add-btn" id="contact-add-btn">+ Add contact</button>
    </div>
    <div class="contact-add-form" id="contact-add-form" style="display:none">
      <input class="contact-add-input" id="contact-add-name" placeholder="Name">
      <input class="contact-add-input" id="contact-add-title" placeholder="Title / Role (optional)">
      <input class="contact-add-input" id="contact-add-email" placeholder="Email">
      <div class="contact-add-actions">
        <button class="contact-confirm-btn" id="contact-add-save">Add</button>
        <button class="contact-cancel-btn" id="contact-add-cancel">Cancel</button>
      </div>
    </div>`;
}

function buildOpportunities() {
  const opps = allCompanies.filter(o => o.type === 'job' && o.linkedCompanyId === entry.id);
  const oppCards = opps.map(o => {
    const sc = stageColor(o.status || 'needs_review', customOpportunityStages);
    const stage = customOpportunityStages.find(s => s.key === (o.status||'needs_review'));
    return `<a class="opp-card" href="${chrome.runtime.getURL('opportunity.html')}?id=${o.id}">
      <div class="opp-card-title">${(o.jobTitle && o.jobTitle !== 'New Opportunity') ? o.jobTitle : `Custom Role @ ${o.company || entry.company}`}</div>
      <div class="opp-card-meta">Saved ${new Date(o.savedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
      <span class="opp-card-status" style="border-color:${sc};color:${sc};background:${hexToRgba(sc,0.08)}">${stage?.label||o.status||''}</span>
    </a>`;
  }).join('');
  const actionBtn = opps.length > 0
    ? `<a class="new-opp-btn view-opp-btn" href="${chrome.runtime.getURL('opportunity.html')}?id=${opps[0].id}">View Opportunity →</a>`
    : `<button class="new-opp-btn" id="new-opp-btn">+ Add as Opportunity</button>`;
  return `
    ${oppCards}
    ${actionBtn}
  `;
}

function buildHiring() {
  // Pull job listings from the entry itself or from any linked opportunity
  const allListings = entry.jobListings || (() => {
    const linked = allCompanies.find(o => o.type === 'job' && o.linkedCompanyId === entry.id);
    return linked?.jobListings || [];
  })();
  // Filter to listings that mention the company name to avoid false positives from keyword overlap
  const companyLower = (entry.company || '').toLowerCase();
  const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const listings = allListings.filter(j => {
    const title = (j.title || '').toLowerCase();
    const url = (j.url || '').toLowerCase();
    const inTitle = title.includes(companyLower) || (domain && title.includes(domain));
    const inUrl = domain && url.includes(domain);
    if (!inTitle && !inUrl) return false;
    // Skip results where the title is basically just the company name with no job context
    const stripped = title.replace(companyLower, '').replace(domain || '', '').replace(/[^a-z0-9]/g, '');
    if (stripped.length < 5) return false;
    return true;
  });
  if (!listings.length) return `<div class="p-empty" style="font-size:13px;color:#7c98b6;padding:10px 0">No additional open roles found.</div>`;
  return listings.map(j => `
    <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f0f3f8">
      <span style="color:#3d5468;font-size:14px;flex-shrink:0">•</span>
      <span style="font-size:13px;color:#33475b">
        ${j.title || 'Open Role'}
        ${j.url ? `<a href="${safeUrl(j.url)}" target="_blank" style="color:#0077b5;text-decoration:none;margin-left:4px">↗</a>` : ''}
        ${j.location ? `<span style="color:#64748b;font-size:12px"> · ${j.location}</span>` : ''}
      </span>
    </div>`).join('');
}

function buildActivity() {
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
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const CO_TAG_PALETTE = [
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
let _coCustomTagColors = {};
chrome.storage.local.get(['tagColors'], d => { _coCustomTagColors = d.tagColors || {}; });

const CO_SEMANTIC_TAG_COLORS = {
  'application rejected': 8, 'rejected': 8, "didn't apply": 8,
  'job posted': 2, 'linkedin easy apply': 4,
  'vc-backed': 1, 'bootstrapped': 6, 'founding team': 5,
  'referral': 9, 'recruiter': 3, '***action required***': 8,
};

function tagColor(tag) {
  if (_coCustomTagColors[tag] !== undefined) {
    return CO_TAG_PALETTE[_coCustomTagColors[tag] % CO_TAG_PALETTE.length];
  }
  const semantic = CO_SEMANTIC_TAG_COLORS[tag.toLowerCase()];
  if (semantic !== undefined) return CO_TAG_PALETTE[semantic];
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  return CO_TAG_PALETTE[Math.abs(hash) % CO_TAG_PALETTE.length];
}

// ── Panel event binding ─────────────────────────────────────────────────────

function bindPanelEvents() {
  // Collapse toggles
  document.querySelectorAll('.panel-collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.panel;
      collapsedPanels[pid] = !collapsedPanels[pid];
      saveCollapsed();
      const body = document.getElementById('pbody-' + pid);
      body.classList.toggle('collapsed', !!collapsedPanels[pid]);
      btn.textContent = collapsedPanels[pid] ? '▼' : '▲';
    });
  });

  // Bind interactive content for each panel
  ['properties','stats','links','tags','overview','intel','reviews','leadership','contacts','opportunity','chat'].forEach(pid => {
    bindPanelBodyEvents(pid);
  });
}

function loadPhotosForPanel(pid) {
  if (pid === 'leadership') {
    const leaders = (entry.leaders || []).filter(l => l.name);
    if (!leaders.length) return;
    // Respect fetchScope: 'nobody' means no photo fetches at all
    chrome.storage.local.get(['pipelineConfig'], ({ pipelineConfig: pc }) => {
      if ((pc?.photos?.fetchScope) === 'nobody') return;
      chrome.runtime.sendMessage({ type: 'GET_LEADER_PHOTOS', leaders, company: entry.company || '' }, photos => {
      void chrome.runtime.lastError;
      if (!photos) return;
      leaders.forEach((l, i) => {
        const photoUrl = photos[i];
        if (!photoUrl) return;
        const el = document.getElementById(`lavatar-${entry.id}-${encodeURIComponent(l.name||'')}`);
        if (!el) return;
        const initials = (l.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        const img = document.createElement('img');
        img.src = photoUrl; img.alt = initials;
        img.addEventListener('error', () => { el.textContent = initials; });
        el.innerHTML = ''; el.appendChild(img);
      });
      });
    });
  }

  if (pid === 'contacts') {
    // Enrich contacts from Google People API (photos, title, phone, LinkedIn) — free, uses existing OAuth
    const contacts = (entry.knownContacts || []).filter(c => c.email);
    if (!contacts.length) return;
    const emails = contacts.map(c => c.email);
    chrome.runtime.sendMessage({ type: 'ENRICH_CONTACTS_GOOGLE', emails }, result => {
      void chrome.runtime.lastError;
      if (!result || result.error) {
        // Fall back to web search photos if Google People API unavailable
        chrome.storage.local.get(['pipelineConfig'], ({ pipelineConfig: pc }) => {
          const scope = pc?.photos?.fetchScope || 'leaders_only';
          if (scope !== 'leaders_contacts') return;
          chrome.runtime.sendMessage(
            { type: 'GET_LEADER_PHOTOS', leaders: contacts.map(c => ({ name: c.name })), company: entry.company || '' },
            photos => {
              void chrome.runtime.lastError;
              if (!photos) return;
              contacts.forEach((c, i) => {
                if (!photos[i]) return;
                const el = document.getElementById('cavatar-' + encodeURIComponent(c.email));
                if (!el) return;
                const _initials = (c.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                const _img = document.createElement('img');
                _img.src = photos[i]; _img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
                _img.addEventListener('error', () => { el.textContent = _initials; });
                el.innerHTML = ''; el.appendChild(_img);
              });
            }
          );
        });
        return;
      }
      // Apply enrichment to DOM and persist new data
      let changed = false;
      contacts.forEach(c => {
        const enriched = result[c.email];
        if (!enriched) return;
        // Photo
        if (enriched.photoUrl) {
          const el = document.getElementById('cavatar-' + encodeURIComponent(c.email));
          if (el) {
            const _initials = (c.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
            const _img = document.createElement('img');
            _img.src = enriched.photoUrl;
            _img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
            _img.addEventListener('error', () => { el.textContent = _initials; });
            el.innerHTML = ''; el.appendChild(_img);
          }
          if (!c.photoUrl) { c.photoUrl = enriched.photoUrl; changed = true; }
        }
        // Title — only backfill if not already set
        if (enriched.title && !c.title) {
          c.title = enriched.title; changed = true;
          const card = document.querySelector(`.contact-card[data-email="${CSS.escape(c.email)}"]`);
          const nameEl = card?.querySelector('.contact-name');
          if (nameEl && !nameEl.nextElementSibling?.classList?.contains('contact-title')) {
            const titleDiv = document.createElement('div');
            titleDiv.className = 'contact-title';
            titleDiv.textContent = enriched.title;
            nameEl.insertAdjacentElement('afterend', titleDiv);
          }
        }
        // Phone
        if (enriched.phone && !c.phone) { c.phone = enriched.phone; changed = true; }
        // LinkedIn
        if (enriched.linkedinUrl && !c.linkedinUrl) { c.linkedinUrl = enriched.linkedinUrl; changed = true; }
      });
      if (changed) saveEntry({ knownContacts: entry.knownContacts });
    });
    return;
  }
}

function bindPanelBodyEvents(pid) {
  // prop-link-edit appears in both 'properties' and 'opportunity' panels
  // (buildOpportunity calls buildProperties internally), so bind unconditionally.
  document.querySelectorAll('.prop-link-edit').forEach(btn => {
    if (btn._linkEditBound) return;
    btn._linkEditBound = true;
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const row = btn.closest('.prop-link-row');
      const currentVal = entry[field] || '';
      const icon = field === 'companyWebsite' ? '🌐' : field === 'jobUrl' ? '📄' : '🔗';
      row.innerHTML = `<span class="prop-link-icon">${icon}</span>
        <input class="prop-input prop-link-input" data-field="${field}" value="${currentVal}" type="url" style="flex:1" placeholder="${field === 'jobUrl' ? 'https://…' : ''}">`;
      const input = row.querySelector('input');
      input.focus();
      const commit = () => { saveEntry({ [field]: input.value.trim() }); renderPanel(pid); bindPanelBodyEvents(pid); };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { renderPanel(pid); bindPanelBodyEvents(pid); } });
    });
  });

  if (pid === 'contacts') {
    const body = document.getElementById('pbody-contacts');
    if (!body) return;

    // Remove contact
    body.querySelectorAll('.contact-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.dataset.email;
        const contact = (entry.knownContacts || []).find(c => c.email === email);
        const allEmails = contact ? [contact.email, ...(contact.aliases || [])] : [email];
        const blocked = [...new Set([...(entry.removedContacts || []), ...allEmails])];
        saveEntry({
          knownContacts: (entry.knownContacts || []).filter(c => c.email !== email),
          removedContacts: blocked
        });
        renderPanel('contacts'); bindPanelBodyEvents('contacts');
      });
    });

    // Copy email
    body.querySelectorAll('.contact-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.email).catch(() => {});
        const orig = btn.textContent; btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });

    // Edit button → expand inline edit form
    body.querySelectorAll('.contact-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.dataset.email;
        const contact = (entry.knownContacts || []).find(c => c.email === email);
        if (!contact) return;
        const card = btn.closest('.contact-card');
        if (!card) return;
        const initials = contact.name.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase() || '?';
        const allEmails = [contact.email, ...(contact.aliases || [])];

        const emailRowsHtml = allEmails.map((em, i) => `
          <div class="contact-edit-email-row">
            <input class="contact-edit-input email-val" value="${em.replace(/"/g,'&quot;')}" placeholder="Email">
            ${allEmails.length > 1 ? `<button class="contact-email-del-btn" data-idx="${i}" title="Remove this email">×</button>` : ''}
          </div>`).join('');

        card.innerHTML = `
          <div class="contact-avatar">${initials}</div>
          <div class="contact-edit-form">
            <input class="contact-edit-input" id="ced-name" value="${contact.name.replace(/"/g,'&quot;')}" placeholder="Name">
            <input class="contact-edit-input" id="ced-title" value="${(contact.title || '').replace(/"/g,'&quot;')}" placeholder="Title / Role (optional)">
            <div class="contact-edit-emails">${emailRowsHtml}</div>
            <button class="contact-add-email-btn">+ Add email</button>
            <div class="contact-add-actions" style="margin-top:6px">
              <button class="contact-confirm-btn contact-save-edit">Save</button>
              <button class="contact-cancel-btn contact-cancel-edit">Cancel</button>
            </div>
          </div>`;

        card.querySelector('#ced-name').focus();

        // Remove individual email row
        card.querySelectorAll('.contact-email-del-btn').forEach(d => {
          d.addEventListener('click', () => d.closest('.contact-edit-email-row').remove());
        });

        // Add new email row
        card.querySelector('.contact-add-email-btn').addEventListener('click', () => {
          const row = document.createElement('div');
          row.className = 'contact-edit-email-row';
          row.innerHTML = `<input class="contact-edit-input email-val" placeholder="Email">
            <button class="contact-email-del-btn" title="Remove">×</button>`;
          row.querySelector('.contact-email-del-btn').addEventListener('click', () => row.remove());
          card.querySelector('.contact-edit-emails').appendChild(row);
          row.querySelector('input').focus();
        });

        const save = () => {
          const newName = card.querySelector('#ced-name').value.trim();
          const newTitle = card.querySelector('#ced-title').value.trim();
          const emails = [...card.querySelectorAll('.email-val')]
            .map(i => i.value.trim().toLowerCase()).filter(e => e.includes('@'));
          if (!emails.length) return;
          saveEntry({ knownContacts: (entry.knownContacts || []).map(c =>
            c.email === email ? { ...c, name: newName || c.name, title: newTitle || undefined, email: emails[0], aliases: emails.slice(1) } : c
          )});
          renderPanel('contacts'); bindPanelBodyEvents('contacts');
        };
        card.querySelector('.contact-save-edit').addEventListener('click', save);
        card.querySelector('.contact-cancel-edit').addEventListener('click', () => {
          renderPanel('contacts'); bindPanelBodyEvents('contacts');
        });
      });
    });

    // Add contact form
    const addBtn = document.getElementById('contact-add-btn');
    const addForm = document.getElementById('contact-add-form');
    if (addBtn) addBtn.addEventListener('click', () => {
      addBtn.style.display = 'none';
      addForm.style.display = '';
      document.getElementById('contact-add-name').focus();
    });
    const doAdd = () => {
      const name = document.getElementById('contact-add-name')?.value.trim();
      const title = document.getElementById('contact-add-title')?.value.trim();
      const email = document.getElementById('contact-add-email')?.value.trim().toLowerCase();
      if (!email || !email.includes('@')) return;
      const existing = entry.knownContacts || [];
      if (existing.some(c => c.email === email)) return;
      const newContact = { name: name || email.split('@')[0], email, source: 'manual', detectedAt: Date.now(), matchedVia: { type: 'manual', detail: 'Added manually via the Add contact form' } };
      if (title) newContact.title = title;
      saveEntry({ knownContacts: [...existing, newContact] });
      renderPanel('contacts'); bindPanelBodyEvents('contacts');
    };
    document.getElementById('contact-add-save')?.addEventListener('click', doAdd);
    document.getElementById('contact-add-cancel')?.addEventListener('click', () => {
      renderPanel('contacts'); bindPanelBodyEvents('contacts');
    });
    document.getElementById('contact-add-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    loadPhotosForPanel('contacts');
  }

  if (pid === 'leadership') {
    const body = document.getElementById('pbody-leadership');
    if (!body) return;

    body.querySelectorAll('.leader-add-contact-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.leader-card');
        btn.style.display = 'none';
        const form = card.querySelector('.leader-email-form');
        form.style.display = '';
        form.querySelector('.leader-email-input').focus();
      });
    });

    body.querySelectorAll('.leader-email-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.leader-card');
        card.querySelector('.leader-email-form').style.display = 'none';
        card.querySelector('.leader-add-contact-btn').style.display = '';
      });
    });

    body.querySelectorAll('.leader-email-save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.leader-card');
        const name = card.querySelector('.leader-name')?.textContent?.trim() || '';
        const email = card.querySelector('.leader-email-input')?.value?.trim().toLowerCase() || '';
        if (!email || !email.includes('@')) {
          card.querySelector('.leader-email-input')?.focus();
          return;
        }
        const existing = entry.knownContacts || [];
        if (!existing.some(c => c.email === email)) {
          saveEntry({ knownContacts: [...existing, { name, email, source: 'manual', detectedAt: Date.now(), matchedVia: { type: 'leader-promoted', detail: `Promoted from leadership card "${name}"` } }] });
        }
        renderPanel('leadership'); bindPanelBodyEvents('leadership');
        renderPanel('contacts'); bindPanelBodyEvents('contacts');
      });
    });

    // Allow Enter key in email input to save
    body.querySelectorAll('.leader-email-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.closest('.leader-card').querySelector('.leader-email-save-btn').click();
        if (e.key === 'Escape') input.closest('.leader-card').querySelector('.leader-email-cancel-btn').click();
      });
    });

    loadPhotosForPanel('leadership');
  }

  if (pid === 'reviews') {
    const body = document.getElementById('pbody-reviews');
    if (!body) return;

    let _undoTimer = null;

    // Re-render reviews list and re-bind all handlers
    const rebind = () => {
      if (_undoTimer) clearTimeout(_undoTimer);
      _undoTimer = null;
      body.innerHTML = buildReviews();
      attachReviewHandlers();
    };

    const showUndo = (rid) => {
      if (_undoTimer) clearTimeout(_undoTimer);
      body.querySelector('.p-review-undo')?.remove();
      const banner = document.createElement('div');
      banner.className = 'p-review-undo';
      banner.innerHTML = `Review dismissed · <button class="p-review-undo-btn">undo</button>`;
      body.insertBefore(banner, body.firstChild);
      banner.querySelector('.p-review-undo-btn').addEventListener('click', () => {
        clearTimeout(_undoTimer);
        _undoTimer = null;
        const ids = entry.dismissedReviews || [];
        const idx = ids.lastIndexOf(rid);
        if (idx !== -1) saveEntry({ dismissedReviews: [...ids.slice(0, idx), ...ids.slice(idx + 1)] });
        rebind();
      });
      _undoTimer = setTimeout(() => { banner.remove(); _undoTimer = null; }, 6000);
    };

    function attachReviewHandlers() {
      body.querySelectorAll('.p-review-dismiss').forEach(btn => {
        btn.addEventListener('click', () => {
          const rid = btn.dataset.rid;
          saveEntry({ dismissedReviews: [...(entry.dismissedReviews || []), rid] });
          body.innerHTML = buildReviews();
          attachReviewHandlers();
          showUndo(rid);
        });
      });
      body.querySelector('.p-review-restore')?.addEventListener('click', () => {
        saveEntry({ dismissedReviews: [] });
        rebind();
      });
    }

    attachReviewHandlers();
  }

  if (pid === 'notes') {
    const ta = document.getElementById('co-notes');
    if (ta) ta.addEventListener('blur', () => saveEntry({ notes: ta.value }));
  }

  if (pid === 'properties') {

    document.querySelectorAll('.prop-input').forEach(input => {
      input.addEventListener('blur', () => {
        const field = input.dataset.field;
        const val = input.value.trim();
        const isDefault = !!DEFAULT_FIELD_DEFS.find(d => d.id === field);
        if (isDefault) {
          saveEntry({ [field]: val });
          if (field === 'companyWebsite' || field === 'companyLinkedin') renderPanel('properties');
        } else {
          saveEntry({ customFields: { ...(entry.customFields||{}), [field]: val } });
        }
        const row = input.closest('.prop-row');
        const openLink = row?.querySelector('.prop-open-link');
        if (openLink) { openLink.href = val; openLink.style.display = val ? '' : 'none'; }
        input.classList.toggle('prop-empty', !val);
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    document.querySelectorAll('.prop-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        customFieldDefs = customFieldDefs.filter(f => f.id !== field);
        chrome.storage.local.set({ companyFieldDefs: customFieldDefs }, () => {
          renderPanel('properties');
          bindPanelBodyEvents('properties');
        });
      });
    });

    const addBtn = document.getElementById('prop-add-btn');
    if (addBtn) addBtn.addEventListener('click', openAddFieldForm);
  }

  if (pid === 'tags') {
    document.querySelectorAll('.tag-rm').forEach(el => {
      el.addEventListener('click', () => {
        saveEntry({ tags: (entry.tags||[]).filter(t => t !== el.dataset.tag) });
        renderPanel('tags');
        bindPanelBodyEvents('tags');
      });
    });
    const addBtn = document.getElementById('tag-add-btn');
    if (addBtn) addBtn.addEventListener('click', openTagInput);
  }

  if (pid === 'opportunity' || pid === 'opportunities') {
    const addBtn = document.getElementById('add-opp-btn');
    if (addBtn) addBtn.addEventListener('click', addToOpportunityPipeline);

    const stageSelect = document.getElementById('opp-stage-select');
    if (stageSelect) stageSelect.addEventListener('change', () => {
      const c = stageColor(stageSelect.value, customOpportunityStages);
      saveEntry({ jobStage: stageSelect.value });
      renderHeader();
    });

    const titleInput = document.getElementById('opp-title-input');
    if (titleInput) {
      titleInput.addEventListener('blur', () => saveEntry({ jobTitle: titleInput.value.trim() || null }));
      titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') titleInput.blur(); });
    }
    const jobUrlInput = document.getElementById('opp-job-url');
    if (jobUrlInput) {
      jobUrlInput.addEventListener('blur', () => {
        const val = jobUrlInput.value.trim() || null;
        saveEntry({ jobUrl: val });
        renderPanel('opportunity');
        bindPanelBodyEvents('opportunity');
      });
      jobUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') jobUrlInput.blur(); });
    }
    // Edit button for linked role title — swaps link for input
    const titleEditBtn = document.getElementById('opp-title-edit-btn');
    if (titleEditBtn) {
      titleEditBtn.addEventListener('click', () => {
        const wrap = titleEditBtn.parentElement;
        const val = entry.jobTitle || '';
        wrap.innerHTML = `<input class="prop-input" id="opp-title-input" value="${val.replace(/"/g, '&quot;')}">`;
        const inp = document.getElementById('opp-title-input');
        inp.focus();
        inp.addEventListener('blur', () => { saveEntry({ jobTitle: inp.value.trim() || null }); renderPanel('opportunity'); bindPanelBodyEvents('opportunity'); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      });
    }

    // Comp field bindings
    const baseSalaryInput = document.getElementById('opp-base-salary');
    if (baseSalaryInput) {
      baseSalaryInput.addEventListener('blur', () => saveEntry({ baseSalaryRange: baseSalaryInput.value.trim() || null, compSource: 'Manual', compAutoExtracted: false }));
      baseSalaryInput.addEventListener('keydown', e => { if (e.key === 'Enter') baseSalaryInput.blur(); });
    }
    const oteInput = document.getElementById('opp-ote');
    if (oteInput) {
      oteInput.addEventListener('blur', () => saveEntry({ oteTotalComp: oteInput.value.trim() || null, compSource: 'Manual', compAutoExtracted: false }));
      oteInput.addEventListener('keydown', e => { if (e.key === 'Enter') oteInput.blur(); });
    }
    const equityInput = document.getElementById('opp-equity');
    if (equityInput) {
      equityInput.addEventListener('blur', () => saveEntry({ equity: equityInput.value.trim() || null }));
      equityInput.addEventListener('keydown', e => { if (e.key === 'Enter') equityInput.blur(); });
    }

    const actionSelect = document.getElementById('opp-action-status');
    if (actionSelect) {
      actionSelect.addEventListener('change', () => saveEntry({ actionStatus: actionSelect.value }));
    }

    const nextStepInput = document.getElementById('opp-next-step-input');
    if (nextStepInput) {
      nextStepInput.addEventListener('blur', () => saveEntry({ nextStep: nextStepInput.value.trim() || null, nextStepSource: null, nextStepEvidence: null, nextStepManuallySetAt: Date.now() }));
      nextStepInput.addEventListener('keydown', e => { if (e.key === 'Enter') nextStepInput.blur(); });
    }

    const nextStepDate = document.getElementById('opp-next-step-date');
    if (nextStepDate) {
      nextStepDate.addEventListener('change', () => {
        nextStepDate.classList.toggle('has-value', !!nextStepDate.value);
        saveEntry({ nextStepDate: nextStepDate.value || null, nextStepSource: null, nextStepEvidence: null, nextStepManuallySetAt: Date.now() });
      });
    }

    const appliedDateInput = document.getElementById('opp-applied-date');
    if (appliedDateInput) {
      appliedDateInput.addEventListener('change', () => {
        const val = appliedDateInput.value;
        const ts = val ? new Date(val + 'T12:00:00').getTime() : null;
        appliedDateInput.classList.toggle('has-value', !!val);
        saveEntry({ appliedDate: ts });
      });
    }

    // Suggestion accept/dismiss
    document.querySelectorAll('.suggestion-accept').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        const pill = btn.closest('.field-suggestion');
        const value = pill?.dataset.value;
        if (field && value) {
          saveEntry({ [field]: value });
          renderPanel('opportunity');
          bindPanelBodyEvents('opportunity');
        }
      });
    });

    document.querySelectorAll('.suggestion-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        const dismissed = entry._dismissedSuggestions || {};
        dismissed[field] = true;
        saveEntry({ _dismissedSuggestions: dismissed });
        btn.closest('.field-suggestion')?.remove();
      });
    });

  }

  if (pid === 'chat') {
    const body = document.getElementById('pbody-chat');
    body?.querySelector('[data-action="open-float-chat"]')?.addEventListener('click', () => {
      document.getElementById('fch-trigger')?.click();
    });
  }

}

function openAddFieldForm() {
  const area = document.getElementById('prop-add-area');
  area.innerHTML = `
    <div class="prop-add-form">
      <input class="prop-add-input" id="prop-new-label" placeholder="Field name (e.g. HQ City)" autocomplete="off">
      <select class="prop-add-type" id="prop-new-type">
        <option value="text">Text</option>
        <option value="url">URL</option>
        <option value="number">Number</option>
      </select>
      <button class="prop-add-confirm" id="prop-add-confirm">Add</button>
      <button class="prop-add-cancel" id="prop-add-cancel">✕</button>
    </div>`;
  document.getElementById('prop-new-label').focus();
  document.getElementById('prop-add-confirm').addEventListener('click', confirmAddField);
  document.getElementById('prop-add-cancel').addEventListener('click', () => {
    renderPanel('properties'); bindPanelBodyEvents('properties');
  });
  document.getElementById('prop-new-label').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAddField();
    if (e.key === 'Escape') { renderPanel('properties'); bindPanelBodyEvents('properties'); }
  });
}

function confirmAddField() {
  const label = document.getElementById('prop-new-label')?.value.trim();
  const type  = document.getElementById('prop-new-type')?.value || 'text';
  if (!label) return;
  const id = 'cf_' + label.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') + '_' + Date.now();
  customFieldDefs = [...customFieldDefs, { id, label, type }];
  chrome.storage.local.set({ companyFieldDefs: customFieldDefs }, () => {
    renderPanel('properties');
    bindPanelBodyEvents('properties');
  });
}

function openTagInput() {
  const wrap = document.getElementById('tag-add-wrap');
  wrap.innerHTML = `<input class="tag-input" id="tag-input" placeholder="tag name" autocomplete="off">
    <div class="tag-sugg" id="tag-sugg" style="display:none"></div>`;
  const input = document.getElementById('tag-input');
  const sugg  = document.getElementById('tag-sugg');
  input.focus();

  function updateSugg() {
    const val = input.value.trim().toLowerCase();
    const existing = entry.tags || [];
    const matches = allKnownTags.filter(t => !existing.includes(t) && (!val || t.toLowerCase().includes(val)));
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.innerHTML = matches.slice(0, 8).map(t => `<div class="tag-sugg-item" data-tag="${t}">${t}</div>`).join('');
    sugg.style.display = 'block';
    sugg.querySelectorAll('.tag-sugg-item').forEach(s => {
      s.addEventListener('mousedown', e => { e.preventDefault(); commitTag(s.dataset.tag); });
    });
  }

  updateSugg();
  input.addEventListener('focus', updateSugg);
  input.addEventListener('input', updateSugg);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTag(input.value.trim()); }
    if (e.key === 'Escape') { renderPanel('tags'); bindPanelBodyEvents('tags'); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.getElementById('tag-input')) { renderPanel('tags'); bindPanelBodyEvents('tags'); }
    }, 200);
  });
}

function commitTag(tag) {
  const clean = tag.trim();
  if (!clean) return;
  const existing = entry.tags || [];
  if (existing.includes(clean)) { renderPanel('tags'); bindPanelBodyEvents('tags'); return; }
  if (!allKnownTags.includes(clean)) {
    allKnownTags = [...allKnownTags, clean];
    chrome.storage.local.set({ allTags: allKnownTags });
  }
  saveEntry({ tags: [...existing, clean] });
  renderPanel('tags');
  bindPanelBodyEvents('tags');
}

// ── Drag & Drop between columns ────────────────────────────────────────────

function bindDragDrop() {
  let draggingPanel = null;
  let draggingCol   = null;
  let dragAllowed   = false;

  const INTERACTIVE = 'textarea, input, select, a, button, details, summary, .tag-rm, .tag-add-btn, .panel-collapse-btn';

  document.querySelectorAll('.panel').forEach(panelEl => {
    panelEl.addEventListener('mousedown', e => {
      // Allow drag unless mousedown was on an interactive element
      dragAllowed = !e.target.closest(INTERACTIVE);
    });

    panelEl.addEventListener('dragstart', e => {
      if (!dragAllowed) { e.preventDefault(); return; }
      draggingPanel = panelEl.dataset.panel;
      draggingCol   = panelEl.closest('.co-col').dataset.col;
      panelEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingPanel);
      dragAllowed = false;
    });

    panelEl.addEventListener('dragend', () => {
      document.querySelectorAll('.panel.dragging').forEach(p => p.classList.remove('dragging'));
      document.querySelectorAll('.drop-line').forEach(l => l.remove());
      document.querySelectorAll('.co-col').forEach(c => c.classList.remove('drag-over'));
      draggingPanel = null;
      draggingCol   = null;
    });
  });

  document.querySelectorAll('.co-col').forEach(colEl => {
    colEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggingPanel) return;
      colEl.classList.add('drag-over');

      // Move drop-line to show insertion point
      document.querySelectorAll('.drop-line').forEach(l => l.remove());
      const panels = [...colEl.querySelectorAll('.panel:not(.dragging)')];
      const line = document.createElement('div');
      line.className = 'drop-line';
      let insertBefore = null;
      for (const p of panels) {
        const rect = p.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { insertBefore = p; break; }
      }
      if (insertBefore) colEl.insertBefore(line, insertBefore);
      else colEl.appendChild(line);
    });

    colEl.addEventListener('dragleave', e => {
      if (!colEl.contains(e.relatedTarget)) {
        colEl.classList.remove('drag-over');
        document.querySelectorAll('.drop-line').forEach(l => l.remove());
      }
    });

    colEl.addEventListener('drop', e => {
      e.preventDefault();
      if (!draggingPanel) return;
      const targetCol = colEl.dataset.col;

      document.querySelectorAll('.drop-line').forEach(l => l.remove());
      colEl.classList.remove('drag-over');

      // Determine insertion point from mouse Y vs panel midpoints
      const panels = [...colEl.querySelectorAll('.panel:not(.dragging)')];
      let insertBeforePanelId = null;
      for (const p of panels) {
        const rect = p.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { insertBeforePanelId = p.dataset.panel; break; }
      }

      // Update layout arrays
      panelLayout[draggingCol] = panelLayout[draggingCol].filter(p => p !== draggingPanel);
      const newCol = panelLayout[targetCol].filter(p => p !== draggingPanel);
      if (insertBeforePanelId) {
        const idx = newCol.indexOf(insertBeforePanelId);
        newCol.splice(idx === -1 ? newCol.length : idx, 0, draggingPanel);
      } else {
        newCol.push(draggingPanel);
      }
      panelLayout[targetCol] = newCol;

      saveLayout();
      renderColumns();
    });
  });
}

function initFloatingChat() {
  const floatEl   = document.getElementById('ci-float-chat');
  const trigger   = document.getElementById('fch-trigger');
  const header    = document.getElementById('fch-header');
  const body      = document.getElementById('fch-body');
  const closeBtn  = document.getElementById('fch-close');
  const minBtn    = document.getElementById('fch-minimize');
  const sizeBtn   = document.getElementById('fch-size-toggle');
  const nameEl    = document.getElementById('fch-company-name');
  if (!floatEl || !trigger) return;

  if (nameEl && entry.company) nameEl.textContent = `— ${entry.company}`;

  // Build the chat panel once
  const chatContainer = document.createElement('div');
  chatContainer.setAttribute('data-chat-panel', entry.id);
  body.appendChild(chatContainer);
  buildChatPanel(chatContainer, entry);

  let isMinimized = false;
  // sizeState: 0=normal, 1=large, 2=fullscreen
  let sizeState = 0;
  const SIZE_ICONS = ['⤢', '⤡', '⊡'];
  const SIZE_CLASSES = ['', 'fch-maximized', 'fch-fullscreen'];

  function open() {
    floatEl.classList.remove('fch-hidden', 'fch-minimized');
    trigger.style.display = 'none';
    isMinimized = false;
    setTimeout(() => chatContainer.querySelector('.chat-input')?.focus(), 150);
  }

  function close() {
    floatEl.classList.add('fch-hidden');
    floatEl.classList.remove('fch-minimized', 'fch-maximized', 'fch-fullscreen');
    trigger.style.display = '';
    isMinimized = false; sizeState = 0;
    sizeBtn.textContent = SIZE_ICONS[0];
  }

  function minimize() {
    isMinimized = !isMinimized;
    floatEl.classList.toggle('fch-minimized', isMinimized);
    minBtn.textContent = isMinimized ? '+' : '−';
    if (isMinimized) {
      floatEl.classList.remove('fch-maximized', 'fch-fullscreen');
      sizeState = 0; sizeBtn.textContent = SIZE_ICONS[0];
    }
  }

  function cycleSize() {
    floatEl.classList.remove(...SIZE_CLASSES.filter(Boolean));
    sizeState = (sizeState + 1) % SIZE_CLASSES.length;
    if (SIZE_CLASSES[sizeState]) floatEl.classList.add(SIZE_CLASSES[sizeState]);
    sizeBtn.textContent = SIZE_ICONS[sizeState];
    if (isMinimized) { isMinimized = false; floatEl.classList.remove('fch-minimized'); minBtn.textContent = '−'; }
  }

  trigger.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  minBtn.addEventListener('click', minimize);
  sizeBtn.addEventListener('click', cycleSize);

  // Drag to reposition
  let dragging = false, startX, startY, startRight, startBottom;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('.fch-btn')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = floatEl.getBoundingClientRect();
    startRight  = window.innerWidth  - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newRight  = Math.max(0, Math.min(window.innerWidth  - 60, startRight  - dx));
    const newBottom = Math.max(0, Math.min(window.innerHeight - 52, startBottom - dy));
    floatEl.style.right  = newRight  + 'px';
    floatEl.style.bottom = newBottom + 'px';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });

  // Open automatically if URL has ?chat=1
  if (new URLSearchParams(location.search).get('chat') === '1') open();
}

function openChatPanel() {
  const panel = document.getElementById('panel-chat');
  if (!panel) return;
  // Expand if collapsed
  const body = document.getElementById('pbody-chat');
  if (body && body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    const btn = panel.querySelector('.panel-collapse-btn');
    if (btn) btn.textContent = '▲';
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => {
    const input = panel.querySelector('.chat-input');
    if (input) input.focus();
  }, 300);
}

function sanitizeNotesHtml(html) {
  const allowed = ['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'del', 'div', 'span'];
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  div.querySelectorAll('*').forEach(el => {
    if (!allowed.includes(el.tagName.toLowerCase())) {
      el.replaceWith(...el.childNodes);
    }
    // Strip style/class attributes except on allowed elements
    el.removeAttribute('class');
    el.removeAttribute('style');
  });
  return div.innerHTML;
}

// Convert old plain text / markdown notes to simple HTML for the WYSIWYG editor
function notesToHtml(raw) {
  if (!raw) return '';
  // If it already looks like HTML, return sanitized
  if (/<[a-z][\s>]/i.test(raw)) return sanitizeNotesHtml(raw);
  // Convert markdown-ish patterns to HTML
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    return sanitizeNotesHtml(marked.parse(raw));
  }
  // Plain text fallback
  return raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function migrateNotesFeed() {
  // Migrate old single entry.notes string to notesFeed[] array
  if (!entry.notesFeed && entry.notes) {
    entry.notesFeed = [{
      id: 'note_migrated',
      content: notesToHtml(entry.notes),
      createdAt: entry.savedAt || Date.now(),
      updatedAt: entry.savedAt || Date.now(),
    }];
    saveEntry({ notesFeed: entry.notesFeed });
  }
  if (!entry.notesFeed) entry.notesFeed = [];
}

function renderNotesEditor() {
  const container = document.getElementById('hub-notes-container');
  if (!container) return;
  migrateNotesFeed();

  const feed = entry.notesFeed || [];

  // Compose area at top + feed below
  container.innerHTML = `
    <div class="notes-compose">
      <div class="notes-toolbar">
        <button class="notes-tb-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="notes-tb-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="notes-tb-btn" data-cmd="formatBlock:H2" title="Heading">H</button>
        <span class="notes-tb-sep"></span>
        <button class="notes-tb-btn" data-cmd="insertUnorderedList" title="Bullet list">•</button>
        <button class="notes-tb-btn" data-cmd="insertOrderedList" title="Numbered list">1.</button>
        <button class="notes-tb-btn" data-cmd="createLink" title="Link">🔗</button>
        <div style="margin-left:auto">
          <button class="notes-save-btn" id="notes-save-btn">+ Add note</button>
        </div>
      </div>
      <div class="notes-editable notes-compose-area" id="hub-notes-editable" contenteditable="true"><p><br></p></div>
    </div>
    <div class="notes-feed" id="notes-feed">
      ${feed.length ? feed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => renderNoteCard(n)).join('') : '<div class="notes-feed-empty">No notes yet — add one above</div>'}
    </div>`;

  const editable = container.querySelector('#hub-notes-editable');
  const saveBtn = container.querySelector('#notes-save-btn');

  // Placeholder
  function updatePlaceholder() {
    editable.classList.toggle('notes-empty-edit', !editable.textContent.trim());
  }
  updatePlaceholder();
  editable.addEventListener('input', updatePlaceholder);

  // Toolbar
  container.querySelectorAll('.notes-tb-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd.startsWith('formatBlock:')) {
        const tag = cmd.split(':')[1];
        const current = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, current.toLowerCase() === tag.toLowerCase() ? 'P' : tag);
      } else if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      editable.focus();
    });
  });

  // Save button — add new note
  saveBtn.addEventListener('mousedown', e => e.preventDefault());
  saveBtn.addEventListener('click', () => {
    const html = sanitizeNotesHtml(editable.innerHTML);
    if (!editable.textContent.trim()) return;
    const note = {
      id: 'note_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
      content: html,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!entry.notesFeed) entry.notesFeed = [];
    entry.notesFeed.push(note);
    // Also update legacy notes field with latest for backward compat (chat context, etc.)
    saveEntry({ notesFeed: entry.notesFeed, notes: html });
    editable.innerHTML = '<p><br></p>';
    updatePlaceholder();
    renderNotesFeed();
  });

  // Keyboard shortcuts
  editable.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); }
    // Ctrl+Enter to save
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  // Paste handler
  editable.addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) {
      document.execCommand('insertHTML', false, sanitizeNotesHtml(html));
    } else {
      document.execCommand('insertText', false, text);
    }
  });

  // Auto-save compose area on blur so content isn't lost if the user navigates away
  editable.addEventListener('blur', () => {
    if (!editable.textContent.trim()) return;
    saveBtn.click();
  });

  // Bind edit/delete on existing note cards
  bindNoteCardEvents();
}

function renderNoteCard(n) {
  const d = new Date(n.createdAt);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // Resolve meeting source chip if note is tagged to a meeting
  let meetingChipHtml = '';
  if (n.meetingId) {
    const allMeetings = [...(entry.cachedMeetings || []), ...(entry.manualMeetings || [])];
    const srcMeeting = allMeetings.find(m => m.id === n.meetingId);
    if (srcMeeting) {
      const chipTitle = escapeHtml(srcMeeting.title || 'Meeting');
      meetingChipHtml = `<span class="note-card-meeting-chip" title="${chipTitle}">↗ ${chipTitle}</span>`;
    }
  }
  return `
    <div class="note-card" data-note-id="${n.id}">
      <div class="note-card-header">
        <span class="note-card-date">${dateStr} · ${timeStr}</span>
        ${meetingChipHtml}
        <span class="note-card-actions">
          <button class="note-del-btn" data-note-id="${n.id}" title="Delete">✕</button>
        </span>
      </div>
      <div class="note-card-body-wrap collapsed" data-note-id="${n.id}">
        <div class="note-card-body" data-note-id="${n.id}">${n.content}</div>
      </div>
      <button class="note-card-toggle" data-note-id="${n.id}" style="display:none">Show more</button>
    </div>`;
}

function renderNotesFeed() {
  const feedEl = document.getElementById('notes-feed');
  if (!feedEl) return;
  const feed = (entry.notesFeed || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  feedEl.innerHTML = feed.length
    ? feed.map(n => renderNoteCard(n)).join('')
    : '<div class="notes-feed-empty">No notes yet — add one above</div>';
  bindNoteCardEvents();
}

function bindNoteCardEvents() {
  const container = document.getElementById('hub-notes-container');
  if (!container) return;

  // Show/hide toggle based on whether content overflows collapsed height
  container.querySelectorAll('.note-card-body-wrap').forEach(wrap => {
    const toggle = wrap.nextElementSibling;
    if (!toggle || !toggle.classList.contains('note-card-toggle')) return;
    // Temporarily measure full height vs collapsed max-height
    wrap.classList.remove('collapsed');
    const full = wrap.scrollHeight;
    wrap.classList.add('collapsed');
    if (full > 120) {
      toggle.style.display = 'block';
    }
  });

  // Toggle expand/collapse
  container.querySelectorAll('.note-card-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const id = toggle.dataset.noteId;
      const wrap = container.querySelector(`.note-card-body-wrap[data-note-id="${id}"]`);
      if (!wrap) return;
      const collapsed = wrap.classList.toggle('collapsed');
      toggle.textContent = collapsed ? 'Show more' : 'Show less';
    });
  });

  // Delete
  container.querySelectorAll('.note-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.noteId;
      entry.notesFeed = (entry.notesFeed || []).filter(n => n.id !== id);
      const latest = entry.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      saveEntry({ notesFeed: entry.notesFeed, notes: latest?.content || '' });
      renderNotesFeed();
    });
  });

  // Edit — make card body contenteditable inline
  container.querySelectorAll('.note-card-body').forEach(bodyEl => {
    bodyEl.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const id = bodyEl.dataset.noteId;
      if (bodyEl.contentEditable === 'true') return;
      const wrap = container.querySelector(`.note-card-body-wrap[data-note-id="${id}"]`);
      // Expand while editing so nothing is clipped
      if (wrap) wrap.classList.remove('collapsed');
      bodyEl.contentEditable = 'true';
      bodyEl.classList.add('note-card-editing');
      bodyEl.focus();

      let done = false;
      const finishEdit = () => {
        if (done) return;
        done = true;
        bodyEl.removeEventListener('blur', finishEdit);
        bodyEl.removeEventListener('keydown', onKeydown);
        bodyEl.contentEditable = 'false';
        bodyEl.classList.remove('note-card-editing');
        const note = (entry.notesFeed || []).find(n => n.id === id);
        if (note) {
          note.content = sanitizeNotesHtml(bodyEl.innerHTML);
          note.updatedAt = Date.now();
          saveEntry({ notesFeed: entry.notesFeed, notes: note.content });
        }
        // Re-evaluate overflow after edit
        if (wrap) {
          wrap.classList.add('collapsed');
          const toggle = wrap.nextElementSibling;
          if (toggle && toggle.classList.contains('note-card-toggle')) {
            wrap.classList.remove('collapsed');
            const full = wrap.scrollHeight;
            wrap.classList.add('collapsed');
            toggle.style.display = full > 120 ? 'block' : 'none';
            toggle.textContent = 'Show more';
          }
        }
      };

      const onKeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          bodyEl.blur();
        }
      };

      bodyEl.addEventListener('blur', finishEdit);
      bodyEl.addEventListener('keydown', onKeydown);
    });
  });
}

// escapeHtml — provided by ui-utils.js

function renderMarkdown(text) {
  // Escape HTML first, then apply markdown patterns
  let s = escapeHtml(text);
  // Headers: ## Heading
  s = s.replace(/^### (.+)$/gm, '<strong style="font-size:12px;color:#7c98b6;text-transform:uppercase;letter-spacing:.04em">$1</strong>');
  s = s.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:14px;color:#2d3e50;margin:10px 0 4px">$1</div>');
  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Citation links: [[N]](url) — render as clickable superscript
  s = s.replace(/\[\[(\d+)\]\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" style="font-size:10px;color:#0077b5;vertical-align:super;text-decoration:none">[$1]</a>');
  // Plain markdown links: [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" style="color:#0077b5">$1</a>');
  // Bullet lines: "- item"
  s = s.replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>');
  // Line breaks
  s = s.replace(/\n/g, '<br>');
  return s;
}

function initColumnResize() {
  const colLeft  = document.getElementById('col-left');
  const colRight = document.getElementById('col-right');

  const savedLeft  = localStorage.getItem('ci_col_left_w');
  const savedRight = localStorage.getItem('ci_col_right_w');
  if (savedLeft)  colLeft.style.width  = savedLeft;
  if (savedRight) colRight.style.width = savedRight;

  function bindHandle(handleId, col, storageKey, direction) {
    const handle = document.getElementById(handleId);
    if (!handle) return;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('resizing');
      const startX = e.clientX;
      const startW = col.getBoundingClientRect().width;
      const onMove = e => {
        const delta = direction === 'right' ? e.clientX - startX : startX - e.clientX;
        col.style.width = Math.max(200, Math.min(560, startW + delta)) + 'px';
      };
      const onUp = () => {
        handle.classList.remove('resizing');
        localStorage.setItem(storageKey, col.style.width);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  bindHandle('resize-left',  colLeft,  'ci_col_left_w',  'right');
  bindHandle('resize-right', colRight, 'ci_col_right_w', 'left');
}

// ── Celebrations (mirrors saved.js logic) ──────────────────────────────────

function _getDefaultCelebration(key) {
  if (/applied/i.test(key)) return { type: 'thumbsup', sound: 'pop', count: 15 };
  if (/conversations?|mutual/i.test(key)) return { type: 'confetti', sound: 'pop', count: 30 };
  if (/offer|accepted|referral/i.test(key)) return { type: 'money', sound: 'chaching', count: 40 };
  if (/stalled/i.test(key)) return { type: 'stopsign', sound: 'none', count: 20 };
  if (/rejected|closed|dq/i.test(key)) return { type: 'peace', sound: 'farewell', count: 25 };
  return null;
}

function _getCelebrationConfig(newStatus) {
  const cfg = _stageCelebrations[newStatus] || _getDefaultCelebration(newStatus);
  if (!cfg || cfg.type === 'none') return null;
  return cfg;
}

const _CO_EMOJI_MAP = {
  thumbsup:'👍', money:'🤑', peace:'✌️', stopsign:'🛑', fire:'🔥', rocket:'🚀',
  star:'⭐', heart:'❤️', clap:'👏', trophy:'🏆', lightning:'⚡', muscle:'💪',
  party:'🥳', champagne:'🍾', crown:'👑', gem:'💎', skull:'💀', wave:'👋',
  eyes:'👀', hundred:'💯', sparkles:'✨', fireworks:'🎆', unicorn:'🦄',
  cake:'🎂', medal:'🥇', rainbow:'🌈', bell_emoji:'🛎️', cool:'😎',
};

function _showCelebrationBanner(stageLabel, emoji) {
  try {
    const existing = document.getElementById('ci-celebration-banner');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'ci-celebration-banner';
    el.style.cssText = [
      'position:fixed','left:50%','top:22%','transform:translate(-50%,-12px) scale(0.9)',
      'background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%)',
      'border:1px solid #fdba74','border-radius:14px','padding:14px 22px',
      'box-shadow:0 18px 48px rgba(255,122,89,0.28),0 4px 14px rgba(0,0,0,0.08)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:16px','font-weight:700','color:#9a3412',
      'z-index:99998','pointer-events:none','opacity:0',
      'display:flex','align-items:center','gap:12px',
      'transition:opacity 260ms ease, transform 260ms cubic-bezier(.2,1.4,.4,1)',
    ].join(';');
    el.innerHTML = `<span style="font-size:26px;line-height:1;">${emoji}</span><span>Moved to <span style="color:#ff7a59;">${stageLabel}</span></span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%, 0) scale(1)'; });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -8px) scale(0.96)';
      setTimeout(() => el.remove(), 320);
    }, 1700);
  } catch(e) {}
}

function _fireCelebration(config) {
  const { type, sound, count } = config;
  if (sound === 'chaching') _playChaChingSound();
  else if (sound === 'pop') _playConfettiPop();
  else if (sound === 'farewell') _playFarewellVoice();

  // Banner
  try {
    const stageKey = config.stageKey || (typeof entry !== 'undefined' && entry?.jobStage);
    const stageLabel = (typeof customOpportunityStages !== 'undefined' && customOpportunityStages?.find?.(s => s.key === stageKey)?.label) || stageKey || '';
    if (stageLabel) _showCelebrationBanner(stageLabel, _CO_EMOJI_MAP[type] || '🎊');
  } catch(e) {}

  const colors = ['#ff4444', '#ffbb00', '#00cc88', '#4488ff', '#cc44ff', '#ff8844', '#00ccff', '#ffcc00'];
  const isEmoji = type !== 'confetti' && type in _CO_EMOJI_MAP;
  const baseEmoji = _CO_EMOJI_MAP[type] || '🎊';
  const n = count || 30;
  const particles = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font-size:' + (isEmoji ? '22px' : '10px') + ';';
    if (isEmoji) { el.textContent = type === 'money' && Math.random() > 0.5 ? '💵' : baseEmoji; }
    else { el.style.width = '8px'; el.style.height = '8px'; el.style.borderRadius = '2px'; el.style.background = colors[i % colors.length]; }
    document.body.appendChild(el);
    particles.push({ el, x: window.innerWidth / 2 + (Math.random() - 0.5) * 200, y: window.innerHeight, vx: (Math.random() - 0.5) * 12, vy: -(Math.random() * 14 + 8), life: 1 });
  }
  function animate() {
    let alive = 0;
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= 0.008;
      p.el.style.left = p.x + 'px'; p.el.style.top = p.y + 'px'; p.el.style.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.el.remove(); else alive++;
    }
    if (alive > 0) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function _playConfettiPop() {
  try { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.setValueAtTime(600, c.currentTime); o.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.1); g.gain.setValueAtTime(0.3, c.currentTime); g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.15); o.start(); o.stop(c.currentTime + 0.15); } catch(e) {}
}

function _playChaChingSound() {
  try { const c = new AudioContext(); const t = c.currentTime; [800, 1200, 1600].forEach((f, i) => { const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = f; g.gain.setValueAtTime(0.2, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.01, t + i * 0.12 + 0.2); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.2); }); } catch(e) {}
}

function _playFarewellVoice() {
  try { const u = new SpeechSynthesisUtterance(['peace', 'adios', 'see ya', 'bye'][Math.floor(Math.random() * 4)]); u.rate = 1.1; u.pitch = 1.0; u.volume = 0.6; speechSynthesis.speak(u); } catch(e) {}
}

// ── Boot ───────────────────────────────────────────────────────────────────
init();
initColumnResize();
