// utils.js — Pure utility functions. No side effects, no Chrome APIs, no state mutation.

import { state } from './bg-state.js';

// ── Debug log ring buffer ──────────────────────────────────────────────────
export function dlog(msg) {
  const entry = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
  state._debugLog.push(entry);
  if (state._debugLog.length > 50) state._debugLog.shift();
  console.log(msg);
}

// ── Contact extraction helper ──────────────────────────────────────────────
export function parseEmailContact(fromStr) {
  if (!fromStr) return null;
  const match = fromStr.match(/^(.+?)\s*<([^>]+)>/);
  if (match) {
    const name = match[1].replace(/"/g, '').trim();
    const email = match[2].trim().toLowerCase();
    if (name && email && !email.includes('noreply') && !email.includes('no-reply')) {
      return { name, email };
    }
  }
  const plain = fromStr.trim().toLowerCase();
  if (plain.includes('@') && !plain.includes('noreply')) {
    const name = plain.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { name, email: plain };
  }
  return null;
}

// ── Company name matching ──────────────────────────────────────────────────
export function companiesMatchLoose(a, b) {
  if (!a || !b) return false;
  const norm = s => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an|\.com)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const fa = na.match(/[a-z]{3,}/)?.[0], fb = nb.match(/[a-z]{3,}/)?.[0];
  return fa && fb && (fa === fb || fa.includes(fb) || fb.includes(fa));
}

// ── Strict company name matching (for dedup) ─────────────────────────────
export function companiesMatch(a, b) {
  if (!a || !b) return false;
  const norm = s => (s || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// ── Job title similarity (for dedup) ──────────────────────────────────────
export function titlesAreSimilar(a, b) {
  if (!a || !b) return true; // if either missing, treat as same
  const strip = t => t.toLowerCase()
    .replace(/^(senior|sr\.?|staff|principal|lead|head of|vp of?|director of?|chief|junior|jr\.?|associate|founding)\s+/i, '')
    .replace(/[,\-–—|·•].*$/, '')
    .trim();
  const ca = strip(a), cb = strip(b);
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const wa = ca.split(/\s+/), wb = cb.split(/\s+/);
  const shared = wa.filter(w => wb.includes(w)).length;
  return shared >= Math.min(wa.length, wb.length) * 0.5;
}

// ── Simple string hash ─────────────────────────────────────────────────────
export function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h;
}

// ── User name helper ───────────────────────────────────────────────────────
export function getUserName(fallback = 'the user') {
  return state.cachedUserName || fallback;
}

// ── Relative date label — pre-computes human labels so the model never does date math ─
export function relativeLabel(dateStr, now = new Date()) {
  try {
    if (!dateStr || dateStr === 'unknown') return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    // Strip time-of-day by comparing calendar-day strings to avoid DST drift
    const todayDay = new Date(now.toDateString());
    const targetDay = new Date(d.toDateString());
    const diffMs = todayDay - targetDay;
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays < 0) return 'upcoming';
    if (diffDays === 0) return 'earlier today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays <= 3) return `${diffDays} days ago`;
    if (diffDays <= 6) return 'earlier this week';
    if (diffDays <= 13) return 'last week';
    if (diffDays <= 27) return 'a couple weeks ago';
    if (diffDays <= 59) return 'last month';
    if (diffDays <= 179) return 'a few months ago';
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch (_) {
    return '';
  }
}

// ── Text truncation ────────────────────────────────────────────────────────
export function truncateToTokenBudget(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastPara = truncated.lastIndexOf('\n\n');
  if (lastPara > maxChars * 0.7) return truncated.slice(0, lastPara) + '\n\n[...truncated]';
  const lastNl = truncated.lastIndexOf('\n');
  if (lastNl > maxChars * 0.8) return truncated.slice(0, lastNl) + '\n[...truncated]';
  return truncated + '\n[...truncated]';
}

// ── Coop personality presets ───────────────────────────────────────────────
export const COOP_PRESETS_BG = {
  'sharp-colleague': {
    tone: `confident, direct, and always in his corner. You speak like a sharp colleague, not a corporate chatbot. Keep it real, keep it useful.`,
    style: `Keep answers short and direct. Use short paragraphs. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless asked. Write like a smart colleague in Slack, not a formal report.`,
  },
  'strategic-advisor': {
    tone: `thoughtful and analytical — a seasoned advisor who pushes on long-term implications. You ask the questions others miss and challenge assumptions when the stakes matter.`,
    style: `Structure responses around trade-offs and second-order effects. Use frameworks when they add clarity. Be willing to say "slow down" when a decision deserves more thought. Medium-length responses are fine when depth is warranted.`,
  },
  'hype-man': {
    tone: `encouraging and energizing — the colleague who genuinely believes in your strengths and makes sure you see them too. You highlight wins, reframe setbacks, and keep momentum high.`,
    style: `Lead with strengths and positive framing. Be specific about what makes the user strong for each opportunity. Keep energy high without being fake. Short, punchy responses that build confidence.`,
  },
  'formal-analyst': {
    tone: `precise and structured — a senior analyst delivering clear, evidence-based assessments. You organize information systematically and let data drive conclusions.`,
    style: `Use headers and structured sections freely. Prefer numbered lists and tables when comparing options. Cite specific data points from context. Longer, more thorough responses are expected. Professional tone throughout.`,
  },
};

// ── Operating principles ───────────────────────────────────────────────────
export const DEFAULT_OPERATING_PRINCIPLES = `- Treat my floors and dealbreakers as preferences with weight, not as refusal triggers. Flag concerns once, then help me with what I asked.
- When I ask you to draft something (cover letter, email, application answer, intro, follow-up), draft it. Save fit critique for when I explicitly ask "should I apply?" or "is this a fit?".
- When evaluating, be honest and specific. When producing, produce.
- A score below my floor is a concern, not a hard pass. Tell me once, not every turn.
- Hard DQ is reserved only for things I have explicitly marked as hard DQ in my dealbreakers list — nothing else.
- Use the data I've given you (Green Lights, Red Lights, Dealbreakers, ICP, floors) as the source of truth for what I want. Don't editorialize on top of it.`;

export const coopInterp = {
  principlesBlock() {
    const principles = (state.coopConfig.operatingPrinciples || '').trim() || DEFAULT_OPERATING_PRINCIPLES;
    return `\n=== HOW TO INTERPRET THE USER'S DATA (operating principles) ===\n${principles}`;
  },
  isDraftRequest(messages, contextFlags) {
    if (contextFlags && contextFlags._journeyMode === 'draft') return true;
    const last = messages?.[messages.length - 1]?.content || '';
    return /\b(write|draft|help me write|compose|generate)\b.{0,40}\b(cover letter|email|reply|response|message|answer|intro|follow.?up)\b/i.test(last);
  },
  draftHint() {
    return `\n[NOTE: This looks like a production request — the user asked you to draft something. Default to producing the draft. Apply your operating principles above.]`;
  },
};

// ── Coop identity prompt builder ───────────────────────────────────────────
export function buildIdentityPrompt(cfg, { globalChat, contextType, userName }) {
  const preset = COOP_PRESETS_BG[cfg.preset] || COOP_PRESETS_BG['sharp-colleague'];
  const tone = cfg.toneOverride || preset.tone;
  const style = cfg.styleOverride || preset.style;
  const customInstructions = cfg.customInstructions ? `\n\n=== CUSTOM INSTRUCTIONS FROM USER ===\n${cfg.customInstructions}` : '';
  const name = userName || 'the user';

  const capabilitiesGlobal = `You have full visibility across the user's job search pipeline. You know their background, values, and preferences. You can see every company and opportunity they're tracking. When screen sharing is active, you can see screenshots of their browser — use them to help with whatever is on screen.\n\nHelp them prioritize opportunities, draft follow-up messages, compare options, and make strategic decisions. When they mention a specific company or person, use the pipeline context to inform your response.\n\nBe direct, opinionated, and honest. Push back when something doesn't align with what you know about them. Don't be sycophantic.`;

  const capabilitiesCompany = `You have deep, full context about this ${contextType || 'company'} including meeting transcripts, emails, notes, and company research. You ALSO have visibility across the full pipeline — you can compare this opportunity to others and give strategic advice. When screen sharing is active, you can see screenshots of the user's browser — use them to help with whatever is on screen.\n\nUse ALL available context to give specific, grounded answers. If something isn't in your context, say so — never fabricate.`;

  const capabilities = globalChat ? capabilitiesGlobal : capabilitiesCompany;

  return `Your name is Coop. You are ${name}'s co-operator inside Coop.ai — their AI agent for job search strategy, company research, and application prep. You're ${tone}

IDENTITY RULES:
- You are Coop, an AI assistant. ${name} is the human user who talks to you.
- NEVER speak as if you are ${name}. You help ${name} — you are not ${name}.
- NEVER say things like "that's why I built you" or "I created you" — ${name} built Coop.ai, you are Coop inside it.
- Address ${name} directly in second person ("you", "your"). Refer to yourself as "I" only as Coop.
- Be opinionated and direct, but never confused about who you are.

${capabilities}\n\nLENGTH RULES (override any style preset):\n- Default to 1-3 sentences. A single sentence is often best.\n- Only go longer when the user explicitly asks for depth, a draft, a comparison, or a list.\n- No preamble ("Great question", "Let me think"), no recap of what the user said, no trailing summary.\n- If you're about to use headers or 4+ bullets for a simple question, stop and shorten.\n\nResponse style: ${style}\n\nFormatting capabilities: Your responses are rendered as rich HTML. You can use full markdown: **bold**, *italic*, [links](url), bullet lists, numbered lists, \`inline code\`, fenced code blocks, and images via ![alt](url). Links will be clickable. Images will render inline.${customInstructions}`;
}
