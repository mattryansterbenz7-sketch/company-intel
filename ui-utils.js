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
function linkReviewSources(escapedText, reviews) {
  if (!escapedText || !reviews?.length) return escapedText;
  const sources = ['Glassdoor', 'RepVue', 'Reddit', 'Blind', 'Indeed'];
  let result = escapedText;
  for (const src of sources) {
    const review = reviews.find(r => r.source === src && r.url);
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

// ── Context manifest renderer (transparency "show your work" panel) ──────────

/**
 * Render a collapsible context manifest panel below a Coop chat message.
 * Shows what data sources Coop loaded, with expandable detail.
 *
 * @param {Object|null} manifest  - The contextManifest from the response ({ summary, tools, sourceCount })
 * @param {Array}       toolCalls - The _toolCalls array from the message (fallback for old messages)
 * @param {string}      prefix    - CSS class prefix: 'chat' or 'sp-chat'
 * @returns {string} HTML string
 */
function renderContextManifest(manifest, toolCalls, prefix) {
  // Nothing to show
  if (!toolCalls?.length) return '';

  const p = prefix || 'chat';
  const id = 'ctx_' + Math.random().toString(36).slice(2, 8);

  // Fallback for old messages without manifest — show flat tool badge
  if (!manifest) {
    const labels = {
      get_company_context: 'company context',
      get_communications: 'emails + meetings',
      get_profile_section: 'profile',
      get_pipeline_overview: 'pipeline',
      search_memory: 'memory',
      get_memory_narrative: 'memory narrative',
    };
    const unique = [...new Set(toolCalls.map(t => labels[t.name] || t.name))];
    return `<div class="${p}-usage" style="color:#7C6EF0;">↳ Coop pulled: ${unique.join(', ')}</div>`;
  }

  // Tool type → dot color
  const dotColors = {
    company: '#5B8DEF',
    communications: '#36B37E',
    profile: '#7C6EF0',
    learnings: '#7C6EF0',
    pipeline: '#F5A623',
    memory: '#8A8E94',
    narrative: '#8A8E94',
    url: '#E06C75',
    setting: '#8A8E94',
  };

  // Build detail rows
  const detailRows = manifest.tools.map(t => {
    const meta = t.meta || {};
    const dotColor = dotColors[meta.type] || '#8A8E94';
    const targetStr = t.target ? ` — ${escapeHtml(t.target)}` : '';
    let subRows = '';

    // Communications: show email/meeting sources
    if (meta.type === 'communications' && meta.sources?.length) {
      const emailSources = meta.sources.filter(s => s.kind === 'email');
      const meetingSources = meta.sources.filter(s => s.kind === 'meeting');
      if (emailSources.length) {
        subRows += emailSources.map(s =>
          `<div class="${p}-ctx-sub">📧 ${escapeHtml(s.subject)} <span class="${p}-ctx-date">${escapeHtml(s.from)}, ${escapeHtml(s.date)}</span></div>`
        ).join('');
      }
      if (meetingSources.length) {
        subRows += meetingSources.map(s =>
          `<div class="${p}-ctx-sub">📅 ${escapeHtml(s.title)} <span class="${p}-ctx-date">${escapeHtml(s.date)}</span></div>`
        ).join('');
      }
    }

    // Profile: show what sections were loaded
    if (meta.type === 'profile' && meta.loadedSections?.length) {
      const _sectionLabels = {
        'profile': 'profile', 'preferences': 'preferences',
        'profile:story': 'Story', 'profile:experience': 'Experience', 'profile:skills': 'Skills',
        'profile:principles': 'Operating Principles', 'profile:voice': 'Voice', 'profile:faq': 'FAQ',
        'profile:resume': 'Resume', 'profile:education': 'Education', 'profile:links': 'Links',
        'prefs:roleICP': 'Role ICP', 'prefs:companyICP': 'Company ICP',
        'prefs:greenFlags': 'Green Flags', 'prefs:redFlags': 'Red Flags',
        'prefs:compensation': 'Compensation', 'prefs:location': 'Location',
        'prefs:learnings': 'Learnings',
      };
      const sectionNames = meta.loadedSections.map(s => _sectionLabels[s] || s.replace(/^(profile|prefs):/, '')).join(', ');
      const suffix = meta.embedded ? ' (always loaded)' : '';
      subRows += `<div class="${p}-ctx-sub">${escapeHtml(sectionNames + suffix)}</div>`;
    } else if (meta.type === 'profile' && meta.sectionHeaders?.length) {
      subRows += `<div class="${p}-ctx-sub">${escapeHtml(meta.sectionHeaders.join(', '))}</div>`;
    } else if (meta.type === 'profile' && meta.tier) {
      subRows += `<div class="${p}-ctx-sub">${escapeHtml(meta.section || 'profile')} (${meta.tier} tier)</div>`;
    }

    // Company: show what data was included
    if (meta.type === 'company' && meta.sections?.length) {
      subRows += `<div class="${p}-ctx-sub">${escapeHtml(meta.sections.join(', '))}</div>`;
    }

    // Pipeline: show filter and count
    if (meta.type === 'pipeline') {
      subRows += `<div class="${p}-ctx-sub">${meta.entryCount} entries (${escapeHtml(meta.filter || 'active')})</div>`;
    }

    // Memory: show match count
    if (meta.type === 'memory' && meta.matchCount != null) {
      subRows += `<div class="${p}-ctx-sub">${meta.matchCount} match${meta.matchCount !== 1 ? 'es' : ''} for "${escapeHtml(meta.query || '')}"</div>`;
    }

    // Learnings: show entry count
    if (meta.type === 'learnings') {
      subRows += `<div class="${p}-ctx-sub">${meta.entryCount || 0} accumulated insight${(meta.entryCount || 0) !== 1 ? 's' : ''}</div>`;
    }

    // URL: show the fetched URL
    if (meta.type === 'url' && meta.url) {
      subRows += `<div class="${p}-ctx-sub">${escapeHtml(meta.url.slice(0, 80))}</div>`;
    }

    return `<div class="${p}-ctx-row">
      <span class="${p}-ctx-dot" style="background:${dotColor};"></span>
      <strong>${escapeHtml(t.label)}</strong>${targetStr}
    </div>${subRows}`;
  }).join('');

  // If no meaningful data was loaded, show a simpler line
  const summaryText = manifest.summary === 'no context loaded'
    ? 'no additional context loaded'
    : manifest.summary;

  // Use data-ctx-toggle instead of inline onclick (CSP blocks inline handlers in extensions)
  return `<div class="${p}-ctx-manifest">
    <div class="${p}-ctx-header" data-ctx-toggle>
      <span style="color:#7C6EF0;">↳</span>
      <span class="${p}-ctx-summary">${detailRows ? 'Loaded ' : ''}${escapeHtml(summaryText)}</span>
      ${detailRows ? `<span class="${p}-ctx-chevron">▸</span>` : ''}
    </div>
    ${detailRows ? `<div class="${p}-ctx-detail" style="display:none;">${detailRows}</div>` : ''}
  </div>`;
}

/**
 * Bind click handlers for context manifest expand/collapse.
 * Must be called after rendering messages into the DOM.
 * Safe to call multiple times — re-binds only new unbound elements.
 */
function bindContextManifestEvents(container) {
  if (!container) return;
  container.querySelectorAll('[data-ctx-toggle]').forEach(header => {
    if (header._ctxBound) return;
    header._ctxBound = true;
    header.addEventListener('click', () => {
      const detail = header.parentElement.querySelector('[class$="-ctx-detail"]');
      const chevron = header.querySelector('[class$="-ctx-chevron"]');
      if (!detail) return;
      const isHidden = detail.style.display === 'none';
      detail.style.display = isHidden ? 'block' : 'none';
      if (chevron) chevron.textContent = isHidden ? '▾' : '▸';
    });
  });
}

// ── Context manifest CSS (injected once per page) ────────────────────────────

function injectContextManifestStyles(prefix) {
  const p = prefix || 'chat';
  const styleId = `${p}-ctx-manifest-styles`;
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .${p}-ctx-manifest {
      margin-top: 6px;
      font-family: var(--ci-font-mono, 'SF Mono', Monaco, monospace);
      font-size: 10px;
      line-height: 1.5;
    }
    .${p}-ctx-header {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      color: #7C6EF0;
      padding: 2px 0;
      user-select: none;
    }
    .${p}-ctx-header:hover {
      opacity: 0.8;
    }
    .${p}-ctx-summary {
      flex: 1;
    }
    .${p}-ctx-chevron {
      font-size: 8px;
      opacity: 0.6;
      transition: transform 0.15s ease;
    }
    .${p}-ctx-detail {
      background: var(--ci-bg-inset, #F5F6F8);
      border: 1px solid var(--ci-border-subtle, #E4E7EB);
      border-radius: var(--ci-radius-sm, 6px);
      padding: 8px 10px;
      margin-top: 4px;
      max-height: 200px;
      overflow-y: auto;
      font-size: 10px;
      color: var(--ci-text-secondary, #6F7782);
    }
    .${p}-ctx-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
    }
    .${p}-ctx-row strong {
      color: var(--ci-text-primary, #0A0B0D);
      font-weight: 600;
    }
    .${p}-ctx-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .${p}-ctx-sub {
      padding-left: 18px;
      font-size: 9px;
      color: var(--ci-text-tertiary, #8A8E94);
      line-height: 1.6;
    }
    .${p}-ctx-date {
      opacity: 0.7;
    }
  `;
  document.head.appendChild(style);
}

// ── Flag display ─────────────────────────────────────────────────────────────

function boldKeyPhrase(text) {
  const splitRe = /\s+(matches|signals|aligns|mirrors|fits|exceeds|suggests|indicates|required|doesn't|limits|conflicts|may feel|verify|confirm|typical)\b/i;
  const m = text.match(splitRe);
  if (m) { const idx = text.indexOf(m[0]); return `<strong>${text.slice(0, idx)}</strong>${text.slice(idx)}`; }
  const dashSplit = text.match(/^(.+?)\s*[;—–]\s*(.+)$/);
  if (dashSplit) return `<strong>${dashSplit[1]}</strong> — ${dashSplit[2]}`;
  return text;
}
