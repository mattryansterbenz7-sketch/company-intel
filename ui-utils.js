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
      result = result.replace(re, `<a href="${escapeHtml(review.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;text-underline-offset:2px;">$1</a>`);
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

// ── Flag display ─────────────────────────────────────────────────────────────

function boldKeyPhrase(text) {
  const splitRe = /\s+(matches|signals|aligns|mirrors|fits|exceeds|suggests|indicates|required|doesn't|limits|conflicts|may feel|verify|confirm|typical)\b/i;
  const m = text.match(splitRe);
  if (m) { const idx = text.indexOf(m[0]); return `<strong>${text.slice(0, idx)}</strong>${text.slice(idx)}`; }
  const dashSplit = text.match(/^(.+?)\s*[;—–]\s*(.+)$/);
  if (dashSplit) return `<strong>${dashSplit[1]}</strong> — ${dashSplit[2]}`;
  return text;
}
