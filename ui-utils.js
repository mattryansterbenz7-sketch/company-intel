// ui-utils.js — Shared UI utility functions.
// Loaded as a plain <script> before page-specific JS in all HTML pages.
// Attaches to window so every page script can call them without imports.

// ── Auto-close side panel on full-page extension views ──────────────────────
// When a full-page view (saved, company, opportunity, etc.) loads, close the
// side panel so it doesn't redundantly consume screen space.
if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && !location.pathname.includes('sidepanel')) {
  chrome.runtime.sendMessage({ type: 'CLOSE_SIDE_PANEL' });
}

// ── HTML escaping ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const escHtml = escapeHtml;

// ── URL sanitization for href/src attributes ────────────────────────────────

function safeUrl(str) {
  if (str == null || str === '') return '';
  const trimmed = String(str).trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return escapeHtml(trimmed);
}

// ── Score verdict mapping ────────────────────────────────────────────────────

function scoreToVerdict(score) {
  if (score >= 8)   return { label: 'Strong match',   cls: 'high',     color: '#059669' };
  if (score >= 6.5) return { label: 'Good match',     cls: 'mid',      color: '#2563eb' };
  if (score >= 5)   return { label: 'Possible match', cls: 'possible', color: '#7c3aed' };
  if (score >= 3)   return { label: 'Mixed signals',  cls: 'mixed',    color: '#d97706' };
  return                   { label: 'Weak match',     cls: 'low',      color: '#dc2626' };
}

// ── Excitement modifier ──────────────────────────────────────────────────────

function applyExcitementModifier(baseScore, rating) {
  if (!baseScore || !rating || rating === 3) return { final: baseScore, mod: 0 };
  const mod = { 1: -1, 2: -0.5, 4: 0.5, 5: 1 }[rating] || 0;
  const final = Math.max(1, Math.min(10, Math.round((baseScore + mod) * 10) / 10));
  return { final, mod };
}

// ── Follow-up chips parser ───────────────────────────────────────────────────
//
// Coop appends a <chips type="draft|answer|summary">["L1","L2","L3"]</chips>
// block at the end of every response. This helper strips that block from
// the visible text and returns the chip labels + reply type so renderers can
// display them without an extra API call.
//
// Returns: { cleanedText: string, chips: string[], replyType: string|null }
// On any parse failure, chips is [] and cleanedText is the original text.

function parseFollowUpChips(text) {
  if (!text) return { cleanedText: text, chips: [], replyType: null };
  const m = text.match(/<chips(?:\s+type="([^"]+)")?>\s*(\[[\s\S]*?\])\s*<\/chips>/);
  if (!m) return { cleanedText: text, chips: [], replyType: null };
  let chips = [];
  try {
    const parsed = JSON.parse(m[2]);
    if (Array.isArray(parsed)) {
      chips = parsed.filter(c => typeof c === 'string' && c.trim()).slice(0, 3);
    }
  } catch (_) { /* swallow — leave chips as [] */ }
  const cleanedText = text.replace(m[0], '').trim();
  return { cleanedText, chips, replyType: m[1] || null };
}

// ── Stage type taxonomy ──────────────────────────────────────────────────────
//
// 5 hardcoded types drive visual treatment across all stage-label render sites.
// Types are the design-system contract; stage names stay fully user-editable.
//
// Type → visual spec:
//   queue       → neutral gray dot  (pre-apply triage, queue.html surfaces)
//   outreach    → blue dot          (outbound/submitted, awaiting first response)
//   active      → amber dot         (live dialogue, interview process, terminal-positive)
//   paused      → muted gray dot    (stalled, not terminal)
//   closed_lost → red dot           (hardcoded terminal — always last, cannot be deleted)

/**
 * Given a stageType string, return { dotColor, isQuietColumn, isTerminal }.
 * Falls back to 'active' visual for unknown types.
 */
function stageTypeVisual(type) {
  return ({
    queue:       { dotColor: 'var(--ci-stage-queue)',    isQuietColumn: false, isTerminal: false },
    outreach:    { dotColor: 'var(--ci-stage-outreach)', isQuietColumn: true,  isTerminal: false },
    active:      { dotColor: 'var(--ci-stage-active)',   isQuietColumn: false, isTerminal: false },
    paused:      { dotColor: 'var(--ci-stage-paused)',   isQuietColumn: false, isTerminal: false },
    closed_lost: { dotColor: 'var(--ci-stage-lost)',     isQuietColumn: false, isTerminal: true  },
  })[type] || { dotColor: 'var(--ci-stage-active)', isQuietColumn: false, isTerminal: false };
}

/**
 * Consolidated stageColor — replaces the per-file copies in saved.js, company.js, opportunity.js.
 *
 * @param {string|Object} keyOrStage  Stage key string OR a stage object with .key/.stageType
 * @param {Array}         [stagesArr] Optional stages array to look up the object when a key is passed.
 *                                    If omitted, falls through to dotColor from stageTypeVisual().
 * @returns {string} CSS color string (token var() or hex fallback)
 */
function stageColor(keyOrStage, stagesArr) {
  let stageObj = null;
  if (keyOrStage && typeof keyOrStage === 'object') {
    stageObj = keyOrStage;
  } else if (stagesArr) {
    stageObj = stagesArr.find(s => s.key === keyOrStage);
  }
  if (stageObj && stageObj.stageType) {
    return stageTypeVisual(stageObj.stageType).dotColor;
  }
  // Legacy fallback: return the stage's custom hex color if present, or active token
  if (stageObj && stageObj.color) return stageObj.color;
  return 'var(--ci-stage-active)';
}

/**
 * Derive the dismiss/reject stage key from a stages array.
 * Looks for the first closed_lost-typed stage; falls back to the literal 'rejected' key.
 *
 * @param {Array} stages  Array of stage objects with .key and .stageType
 * @returns {string}
 */
function getDismissStageKey(stages) {
  return (stages && stages.find(s => s.stageType === 'closed_lost'))?.key || 'rejected';
}

// ── Pipeline stage helpers ───────────────────────────────────────────────────

function defaultActionStatus(stageKey) {
  if (/needs_review|want_to_apply|interested/i.test(stageKey)) return 'my_court';
  if (/applied|intro_requested|conversations|offer|accepted/i.test(stageKey)) return 'their_court';
  return null;
}

function autoNextStepForStage(stageKey) {
  const map = {
    'needs_review':    'Coop → Review job score and decide whether to pursue',
    'want_to_apply':   'Coop → Prepare and submit application',
    'applied':         'Coop → Awaiting response from company',
    'intro_requested': 'Coop → Waiting for intro to be made',
    'conversations':   'Coop → Awaiting next steps from recruiter',
    'offer_stage':     'Coop → Review and respond to offer',
    'accepted':        'Coop → Complete onboarding steps',
  };
  return map[stageKey] || null;
}

function applyAutoStage(entry, stageKey, changes) {
  const autoAction = defaultActionStatus(stageKey);
  if (!autoAction) return;
  changes.actionStatus = autoAction;
  const autoStep = autoNextStepForStage(stageKey);
  if (autoStep) {
    const existing = entry?.nextStep || '';
    if (!existing || existing.startsWith('Coop → ')) {
      changes.nextStep = autoStep;
      changes.nextStepSource = 'coop-auto';
    }
  }
}

// ── Date & string helpers ────────────────────────────────────────────────────

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

// ── Review source linking ────────────────────────────────────────────────────

/** Turn escaped text mentioning review sources (Glassdoor, RepVue, etc.) into clickable links */
function linkReviewSources(escapedText, reviews, dismissedIds = []) {
  if (!escapedText || !reviews?.length) return escapedText;
  const dismissed = new Set(dismissedIds);
  const active = dismissed.size
    ? reviews.filter(r => !dismissed.has(r.url || `${r.source || 'Web'}|${(r.snippet || '').slice(0, 80)}`))
    : reviews;
  const sources = ['Glassdoor', 'RepVue', 'Reddit', 'Blind', 'Indeed'];
  let result = escapedText;
  for (const src of sources) {
    const review = active.find(r => r.source === src && r.url);
    if (!review) continue;
    const re = new RegExp(`\\b(${src})\\b`, 'gi');
    if (re.test(result)) {
      result = result.replace(re, `<a href="${safeUrl(review.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;text-underline-offset:2px;">$1</a>`);
    }
  }
  return result;
}

// ── Tag color palette ────────────────────────────────────────────────────────

const TAG_PALETTE = [
  { border: '#6366f1', color: '#4338ca', bg: 'rgba(99,102,241,0.15)' },   // Indigo
  { border: '#10b981', color: '#047857', bg: 'rgba(16,185,129,0.15)' },   // Emerald
  { border: '#f97316', color: '#c2410c', bg: 'rgba(249,115,22,0.15)' },   // Orange
  { border: '#ec4899', color: '#be185d', bg: 'rgba(236,72,153,0.15)' },   // Pink
  { border: '#0ea5e9', color: '#0369a1', bg: 'rgba(14,165,233,0.15)' },   // Sky
  { border: '#a855f7', color: '#7e22ce', bg: 'rgba(168,85,247,0.15)' },   // Purple
  { border: '#22c55e', color: '#15803d', bg: 'rgba(34,197,94,0.15)' },    // Green
  { border: '#eab308', color: '#a16207', bg: 'rgba(234,179,8,0.15)' },    // Yellow
  { border: '#ef4444', color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },    // Red
  { border: '#14b8a6', color: '#0f766e', bg: 'rgba(20,184,166,0.15)' },   // Teal
];

const SEMANTIC_TAG_COLORS = {
  'application rejected': 8, 'rejected': 8, "didn't apply": 8,
  'job posted': 2, 'linkedin easy apply': 4,
  'vc-backed': 1, 'bootstrapped': 6, 'founding team': 5,
  'co-founding interest': 5, 'intro request': 0, 'intro requested': 0,
  'referral': 9, 'referral agreement': 9, 'recruiter': 3,
  '***action required***': 8,
};

function tagColorIndex(tag) {
  const semantic = SEMANTIC_TAG_COLORS[tag.toLowerCase()];
  if (semantic !== undefined) return semantic;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  return Math.abs(hash) % TAG_PALETTE.length;
}

function tagColor(tag) {
  const customIdx = typeof customTagColors !== 'undefined' && customTagColors[tag];
  const idx = (customIdx !== undefined && customIdx !== false) ? customIdx : tagColorIndex(tag);
  return TAG_PALETTE[idx % TAG_PALETTE.length];
}

// ── Tool-use inline row renderer ─────────────────────────────────────────────
//
// Replaces the old collapsible gray-box "context manifest" with first-class
// inline rows rendered inside the assistant message. Each tool call gets one
// row: colored dot + "Verb Subject from Source" label + done/active state.
//
// Category → dot color:
//   emails      → blue   (#3B82F6)
//   meetings    → teal   (#14B8A6)
//   profile     → purple (#7C6EF0)
//   memory      → amber  (#F5A623)
//   company/def → coral  (--ci-accent-primary)
//
// Function name kept for call-site compatibility.
//
// @param {Object|null} manifest  - contextManifest from response
// @param {Array}       toolCalls - _toolCalls array (fallback for old messages)
// @param {string}      prefix    - CSS class prefix ('chat' or 'sp-chat')
// @returns {string} HTML string
function renderContextManifest(manifest, toolCalls, prefix) {
  if (!toolCalls?.length && !manifest?.tools?.length) return '';

  // ── Category → dot color & human label ──────────────────────────────────
  const _categoryDot = (type) => {
    if (type === 'communications' || type === 'emails') return '#3B82F6';
    if (type === 'meetings') return '#14B8A6';
    if (type === 'profile' || type === 'learnings') return '#7C6EF0';
    if (type === 'memory' || type === 'narrative') return '#F5A623';
    return 'var(--ci-accent-primary, #FC636B)'; // company / default = coral
  };

  // Build a human-readable label from tool metadata, following the
  // "{verb} {quantified subject} from {source}" pattern in the PRD.
  const _buildLabel = (toolName, meta) => {
    if (!meta || Object.keys(meta).length === 0) {
      // Fallback: map raw tool names to readable phrases
      const fallbackMap = {
        get_company_context:  'Loaded company context',
        get_communications:   'Pulled emails + meetings',
        get_profile_section:  'Loaded voice profile',
        get_pipeline_overview:'Loaded pipeline overview',
        search_memory:        'Searched memory',
        get_memory_narrative: 'Loaded memory narrative',
      };
      return fallbackMap[toolName] || toolName;
    }
    const type = meta.type || '';
    if (type === 'communications') {
      const emailCount  = (meta.sources || []).filter(s => s.kind === 'email').length;
      const meetCount   = (meta.sources || []).filter(s => s.kind === 'meeting').length;
      const parts = [];
      if (emailCount) parts.push(`${emailCount} email${emailCount !== 1 ? 's' : ''}`);
      if (meetCount)  parts.push(`${meetCount} meeting${meetCount !== 1 ? 's' : ''}`);
      const subject = parts.length ? parts.join(' + ') : 'communications';
      const contact = meta.contact ? ` with ${meta.contact}` : '';
      return `Pulled ${subject}${contact}`;
    }
    if (type === 'profile') {
      const section = meta.section === 'preferences' ? 'preferences'
        : meta.section === 'learnings' ? 'learnings'
        : (meta.loadedSections?.length ? meta.loadedSections.map(s => s.replace(/^(profile|prefs):/, '')).join(', ') : 'profile');
      return `Loaded ${section}`;
    }
    if (type === 'memory') {
      return meta.query ? `Searched memory for "${meta.query.slice(0, 40)}"` : 'Searched memory';
    }
    if (type === 'narrative') {
      return 'Loaded memory narrative';
    }
    if (type === 'company') {
      const company = meta.company ? ` — ${meta.company}` : '';
      return `Loaded company context${company}`;
    }
    if (type === 'pipeline') {
      const n = meta.entryCount != null ? ` ${meta.entryCount} entries` : '';
      return `Loaded pipeline${n}`;
    }
    if (type === 'learnings') {
      const n = meta.entryCount != null ? ` ${meta.entryCount}` : '';
      return `Loaded${n} accumulated insights`;
    }
    if (type === 'url') {
      return `Fetched ${(meta.url || '').slice(0, 50)}`;
    }
    return meta.label || toolName;
  };

  // ── Build rows from manifest tools (preferred) or raw toolCalls (fallback) ─
  let rows = '';

  if (manifest?.tools?.length) {
    rows = manifest.tools.map(t => {
      const meta     = t.meta || {};
      const dotColor = _categoryDot(meta.type);
      const label    = _buildLabel(t.name || '', meta);
      // All tool calls in a completed (non-streaming) response are done
      return `<div class="tool-use-row">
        <span class="tool-use-dot" style="background:${dotColor};"></span>
        <span class="tool-use-label">${escapeHtml(label)}</span>
        <span class="tool-use-state done">✓</span>
      </div>`;
    }).join('');
  } else if (toolCalls?.length) {
    // Legacy fallback — no manifest metadata available
    const seen = new Set();
    rows = toolCalls.map(t => {
      if (seen.has(t.name)) return '';
      seen.add(t.name);
      const label    = _buildLabel(t.name, null);
      const dotColor = _categoryDot(null);
      return `<div class="tool-use-row">
        <span class="tool-use-dot" style="background:${dotColor};"></span>
        <span class="tool-use-label">${escapeHtml(label)}</span>
        <span class="tool-use-state done">✓</span>
      </div>`;
    }).filter(Boolean).join('');
  }

  if (!rows) return '';

  return `<div class="tool-use-block">${rows}</div>`;
}

// ── Legacy stubs — kept for call-site compatibility ──────────────────────────
// The old collapsible gray-box manifest has been replaced by inline tool-use
// rows (see renderContextManifest above). These stubs prevent call sites in
// chat.js / initChatPanels from throwing.

/** No-op: inline rows need no post-render event binding. */
function bindContextManifestEvents(_container) { /* no-op */ }

/**
 * Inject shared tool-use row CSS once per page.
 * Idempotent — safe to call multiple times.
 */
function injectContextManifestStyles(_prefix) {
  const styleId = 'tool-use-row-styles';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* ── Inline tool-use rows (replaces old collapsible manifest) ── */
    .tool-use-block {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 6px;
      margin-bottom: 2px;
    }
    .tool-use-row {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      color: var(--ci-text-tertiary, #8A8E94);
      line-height: 1.4;
      padding: 1px 0;
    }
    .tool-use-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      display: inline-block;
    }
    .tool-use-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-use-state {
      font-size: 10px;
      flex-shrink: 0;
    }
    .tool-use-state.done {
      color: var(--ci-text-tertiary, #8A8E94);
    }
    .tool-use-state.active {
      color: var(--ci-accent-amber, #F5A623);
      font-style: italic;
    }
    /* Amber progress line — shown only while a tool call is active */
    .tool-use-progress {
      height: 2px;
      background: linear-gradient(90deg, var(--ci-accent-amber, #F5A623), transparent);
      border-radius: 1px;
      margin-left: 13px;
      animation: toolUseProgress 1.4s ease-in-out infinite;
    }
    @keyframes toolUseProgress {
      0%   { transform: scaleX(0); transform-origin: left; opacity: 0.8; }
      50%  { transform: scaleX(1); transform-origin: left; opacity: 1; }
      100% { transform: scaleX(0); transform-origin: right; opacity: 0.8; }
    }
  `;
  document.head.appendChild(style);
}

// ── Auto-save on blur ────────────────────────────────────────────────────────
//
// Hook autosave-on-blur to an input. On blur, calls `callback(value)`.
// Shows a ".settings-saved-chip" element near the input on successful save.
//
// @param {HTMLElement} input - the input/textarea/contenteditable element
// @param {(value: string) => Promise<void> | void} callback - save handler
// @param {Object} [options]
// @param {HTMLElement} [options.chipTarget] - element to attach chip to (defaults to input.parentElement)
// @param {string} [options.chipLabel='Saved'] - label text
// @param {number} [options.chipMs=1500] - how long to show the chip
function autoSaveOnBlur(input, callback, options = {}) {
  const chipLabel = options.chipLabel || 'Saved';
  const chipMs = options.chipMs || 1500;
  let lastValue = input.value;
  input.addEventListener('blur', async () => {
    const v = input.value;
    if (v === lastValue) return;
    lastValue = v;
    const chipTarget = options.chipTarget || input.parentElement;
    try {
      await Promise.resolve(callback(v));
      let chip = chipTarget.querySelector(':scope > .settings-saved-chip');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'settings-saved-chip';
        chip.textContent = '\u2713 ' + chipLabel;
        chipTarget.appendChild(chip);
      }
      chip.classList.add('visible');
      clearTimeout(chip._hideTimer);
      chip._hideTimer = setTimeout(() => chip.classList.remove('visible'), chipMs);
    } catch (err) {
      console.error('[autoSaveOnBlur] save failed:', err);
    }
  });
}

// ── Task row renderer ─────────────────────────────────────────────────────────
//
// Shared primitive consumed by:
//   #261 saved dashboard (tasks panel, left 30%)
//   #260 opportunity shell (Tasks tab)
//   #253 side panel (Today view)
//
// task shape: { id, title|text, dueDate, priority, completed, companyId, company, source }
// options:
//   showCompanyChip {boolean=true}  — render the company/opp chip below the title
//   compact         {boolean=false} — smaller padding for dense surfaces
//
// CSS lives in task-row.css (shared file loaded by every consumer).

/**
 * Derive a stable background color for a company initials logo.
 * Uses a lightweight hash of the company name so the same company always
 * gets the same color across renders.
 * @param {string} name
 * @returns {{ bg: string, color: string }}
 */
function _taskOppLogoColors(name) {
  const PALETTES = [
    { bg: '#FFE9D6', color: '#B24A00' },
    { bg: '#E1E6FF', color: '#3344C0' },
    { bg: '#E4F5E8', color: '#1B7E53' },
    { bg: '#EEE8FE', color: '#5840C0' },
    { bg: '#FFE0E2', color: '#B8434A' },
    { bg: '#E0F4FF', color: '#0369A1' },
    { bg: '#FFF3CD', color: '#92400E' },
    { bg: '#F0E8FF', color: '#7E22CE' },
  ];
  if (!name) return PALETTES[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return PALETTES[Math.abs(h) % PALETTES.length];
}

/**
 * Render a single task as an HTML row matching the v6 mockup treatment.
 * @param {Object} task
 * @param {Object} [options]
 * @param {boolean} [options.showCompanyChip=true]
 * @param {boolean} [options.compact=false]
 * @returns {string} HTML string
 */
function renderTaskRow(task, options = {}) {
  const { showCompanyChip = true, compact = false } = options;

  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

  const title  = escapeHtml(task.title || task.text || '');
  const completed = !!task.completed;
  const dueDate   = task.dueDate || '';

  // Priority pill
  const priRaw  = (task.priority || '').toLowerCase();
  const priCls  = (priRaw === 'high' || priRaw === 'p1') ? 'p1'
                : (priRaw === 'normal' || priRaw === 'p2' || priRaw === 'medium') ? 'p2'
                : 'p3';
  const priLabel = priCls === 'p1' ? 'P1' : priCls === 'p2' ? 'P2' : 'P3';

  // Date chip
  let dateCls = '';
  let dateLabel = '';
  if (dueDate) {
    if (dueDate < todayStr) {
      const ms  = new Date(todayStr + 'T12:00:00') - new Date(dueDate + 'T12:00:00');
      const days = Math.round(ms / 86400000);
      dateCls   = 'overdue';
      dateLabel = days === 1 ? '1d' : `${days}d`;
    } else if (dueDate === todayStr) {
      dateCls   = 'today';
      dateLabel = 'Today';
    } else if (dueDate === tomorrowStr) {
      dateCls   = 'upcoming';
      dateLabel = 'Tomorrow';
    } else {
      dateCls   = 'upcoming';
      const d   = new Date(dueDate + 'T12:00:00');
      dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  // Company / opp logo
  const company    = task.company || '';
  const initials   = company ? company.slice(0, 2) : '';
  const logoColors = company ? _taskOppLogoColors(company) : null;
  const logoHtml   = logoColors
    ? `<div class="task-opp-logo" style="background:${logoColors.bg};color:${logoColors.color};">${escapeHtml(initials)}</div>`
    : `<div class="task-opp-logo task-opp-logo--none">—</div>`;

  // Chip below title — also carries task-company-editable for inline-edit handler
  const chipHtml = showCompanyChip
    ? `<span class="task-row-opp-chip task-company-editable" data-task-id="${escapeHtml(String(task.id || ''))}">${company ? escapeHtml(company) : '<span style="opacity:0.6">No opp</span>'}</span>`
    : '';

  const taskId = escapeHtml(String(task.id || ''));
  const rowCls = ['task-row', completed ? 'tr-done' : '', compact ? 'tr-compact' : ''].filter(Boolean).join(' ');

  return `<div class="${rowCls}" data-task-id="${taskId}">
    <div class="task-check-box${completed ? ' checked' : ''}" data-check="${taskId}"></div>
    ${logoHtml}
    <div class="task-row-main">
      <span class="task-row-title task-text-editable" data-task-id="${taskId}">${title}</span>
      ${chipHtml}
    </div>
    <div class="task-row-controls">
      <span class="task-pri-pill ${priCls}">${priLabel}</span>
      ${dateLabel
        ? `<span class="task-date-chip ${dateCls} task-due-editable" data-task-id="${taskId}" data-due="${escapeHtml(dueDate)}">${escapeHtml(dateLabel)}</span>`
        : `<span class="task-date-chip task-due-editable" data-task-id="${taskId}" data-due="" style="opacity:0.45">+ date</span>`}
      ${!completed ? `<button class="task-act-btn task-snooze" data-task-id="${taskId}" title="Snooze 1 day" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--ci-text-tertiary);font-size:13px;">&#9201;</button>` : ''}
      <button class="task-act-btn task-trash" data-task-id="${taskId}" title="Delete task" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--ci-text-tertiary);font-size:13px;">&#128465;</button>
    </div>
  </div>`;
}
window.renderTaskRow = renderTaskRow;

// ── Flag display ─────────────────────────────────────────────────────────────

function boldKeyPhrase(text) {
  const splitRe = /\s+(matches|signals|aligns|mirrors|fits|exceeds|suggests|indicates|required|doesn't|limits|conflicts|may feel|verify|confirm|typical)\b/i;
  const m = text.match(splitRe);
  if (m) { const idx = text.indexOf(m[0]); return `<strong>${text.slice(0, idx)}</strong>${text.slice(idx)}`; }
  const dashSplit = text.match(/^(.+?)\s*[;—–]\s*(.+)$/);
  if (dashSplit) return `<strong>${dashSplit[1]}</strong> — ${dashSplit[2]}`;
  return text;
}
