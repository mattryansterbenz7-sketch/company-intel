// coop-tools.js — G2 Coop tool-use definitions and handlers.
// PRD: prds/G2-coop-tool-use.md
// Flag: state.coopConfig.useToolUse

import { getUserName } from './utils.js';
import { buildCoopMemoryBlock } from './memory.js';

// ═══════════════════════════════════════════════════════════════════════════
// Tool definitions (sent to Claude as `tools` array)
// ═══════════════════════════════════════════════════════════════════════════

export const COOP_TOOLS = [
  {
    name: 'get_company_context',
    description: 'Returns core data for a company or opportunity: firmographics, leadership, role details, stage, rating. If company_name is omitted, uses the currently bound company. REQUIRED in global chat. Use this before answering questions about a specific company unless you clearly already know the answer from the conversation.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Optional. Fuzzy-matched against saved entries. Omit to use the bound company.' },
      },
      required: [],
    },
  },
  {
    name: 'get_communications',
    description: 'Returns recent emails and meeting transcripts for a company. Use this for ANY question about what was said, discussed, or written ("what did X say about Y"). Pass keywords to expand matching meeting transcripts to full text; otherwise only summaries are returned. DO NOT guess what was said — call this tool.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
        types: { type: 'array', items: { type: 'string', enum: ['emails', 'meetings'] } },
        limit: { type: 'integer', default: 5 },
        keywords: { type: 'array', items: { type: 'string' }, description: 'If provided, meetings matching any keyword are expanded to full transcript.' },
      },
      required: [],
    },
  },
  {
    name: 'get_profile_section',
    description: "Returns the user's compiled Career OS profile or preferences as markdown. Use 'profile' for background/story/experience/skills, 'preferences' for job search criteria/flags/comp/ICP. Use 'full' tier for scoring, cover letters, deep career questions; 'standard' for general chat.",
    input_schema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['profile', 'preferences'],
          description: "'profile' = who the user is (story, experience, skills, voice). 'preferences' = what they want (ICP, flags, comp, location, learnings).",
        },
        tier: {
          type: 'string',
          enum: ['standard', 'full'],
          description: "Detail level. 'standard' (~800 tokens) for most questions. 'full' (~2000 tokens) for scoring, applications, cover letters.",
        },
      },
      required: ['section'],
    },
  },
  {
    name: 'get_pipeline_overview',
    description: 'Returns all saved companies/opportunities at a glance: stage, rating, action status, last activity. Use for cross-pipeline questions ("what should I focus on", "which roles are in my court", "compare my top 3"). Not needed for single-company questions.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['active', 'all', 'needs_action'], description: "Default 'active'." },
        stage: { type: 'string', description: 'Optional pipeline stage filter.' },
      },
      required: [],
    },
  },
  {
    name: 'search_memory',
    description: "Keyword search over the user's learned insights and saved Coop memory. Use when the user refers to something they've told you before ('remember when I mentioned...', 'what did I say about healthcare').",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', default: 5 },
      },
      required: ['query'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Fuzzy matching & resolution
// ═══════════════════════════════════════════════════════════════════════════

// Fuzzy-match a user-supplied name against savedCompanies.
// Returns { entry, confidence, matchedFrom } on ≥0.85, else { candidates } top 3.
function _coopFuzzyMatchCompany(name, entries) {
  if (!name) return { error: 'no name' };
  const norm = s => (s || '').toLowerCase().replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an|\.com)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
  const target = norm(name);
  if (!target) return { error: 'empty after normalize' };
  const scored = entries.map(e => {
    const candidate = norm(e.company || '');
    if (!candidate) return { e, score: 0 };
    if (candidate === target) return { e, score: 1 };
    if (candidate.includes(target)) return { e, score: 0.92 };
    if (target.includes(candidate)) return { e, score: 0.88 };
    // Dice coefficient on bigrams
    const bigrams = s => { const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; };
    const A = bigrams(target), B = bigrams(candidate);
    if (!A.size || !B.size) return { e, score: 0 };
    let overlap = 0;
    for (const x of A) if (B.has(x)) overlap++;
    return { e, score: (2 * overlap) / (A.size + B.size) };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top && top.score >= 0.85) {
    return { entry: top.e, confidence: Number(top.score.toFixed(2)), matchedFrom: name };
  }
  return { candidates: scored.slice(0, 3).filter(s => s.score > 0.3).map(s => s.e.company) };
}

// Resolve the company for a tool call. Returns { entry } or { error }.
async function _coopResolveCompany(inputName, ctx) {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entries = savedCompanies || [];
  // No name + bound company → use bound
  if (!inputName && ctx.boundCompany) {
    const match = entries.find(e => e.company === ctx.boundCompany || (e.id && e.id === ctx.boundEntryId));
    if (match) return { entry: match, matchedFrom: 'bound' };
  }
  // No name + no bound → error
  if (!inputName) {
    return { error: 'No company_name provided and no company bound to this chat. Pass company_name or ask the user to bind an entry.' };
  }
  const result = _coopFuzzyMatchCompany(inputName, entries);
  if (result.entry) return { entry: result.entry, matchedFrom: result.matchedFrom, confidence: result.confidence };
  if (result.candidates?.length) return { error: 'Company not found', suggestions: result.candidates };
  return { error: 'Company not found', suggestions: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// Result capping
// ═══════════════════════════════════════════════════════════════════════════

const TOOL_RESULT_SIZE_CAP = 60000; // chars, ~15k tokens

export function _capToolResult(obj) {
  const s = JSON.stringify(obj);
  if (s.length <= TOOL_RESULT_SIZE_CAP) return obj;
  return { ...obj, _truncated: true, _note: `Result exceeded ${TOOL_RESULT_SIZE_CAP}-char cap. Some fields may be trimmed.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool handlers
// ═══════════════════════════════════════════════════════════════════════════

async function _tool_get_company_context({ company_name }, ctx) {
  const r = await _coopResolveCompany(company_name, ctx);
  if (r.error) return r;
  const e = r.entry;
  const out = {
    name: e.company,
    matchedFrom: r.matchedFrom || null,
    confidence: r.confidence || null,
    stage: e.jobStage || e.status || null,
    actionStatus: e.actionStatus || null,
    rating: e.rating || null,
    isOpportunity: !!e.isOpportunity,
    website: e.companyWebsite || null,
    linkedin: e.companyLinkedin || null,
    employees: e.employees || null,
    industry: e.industry || null,
    funding: e.funding || null,
    leaders: (e.leaders || []).slice(0, 6).map(l => ({ name: l.name, title: l.title, linkedin: l.linkedin || null })),
    intelligence: e.intelligence?.eli5 || e.intelligence?.oneLiner || e.intelligence?.summary || null,
    tags: e.tags || [],
    notes: (e.notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) || null,
    stageTimestamps: e.stageTimestamps || null,
    nextStep: e.nextStep || null,
  };
  if (e.isOpportunity || e.jobTitle) {
    out.role = {
      title: e.jobTitle || null,
      description: (e.jobDescription || '').slice(0, 2500),
      match: e.jobMatch ? { score: e.jobMatch.score, verdict: e.jobMatch.verdict } : null,
    };
  }
  return _capToolResult(out);
}

async function _tool_get_communications({ company_name, types, limit, keywords }, ctx) {
  const r = await _coopResolveCompany(company_name, ctx);
  if (r.error) return r;
  const e = r.entry;
  const wantEmails = !types || types.includes('emails');
  const wantMeetings = !types || types.includes('meetings');
  const lim = Math.min(limit || 5, 15);
  const kwList = (keywords || []).map(k => k.toLowerCase()).filter(Boolean);
  const out = { company: e.company, emails: [], meetings: [] };

  if (wantEmails) {
    const ems = (e.cachedEmails || []).slice(0, lim);
    out.emails = ems.map(em => ({
      id: em.id || null,
      subject: em.subject || '',
      from: (em.from || '').replace(/<[^>]+>/, '').trim(),
      date: em.date || null,
      snippet: (em.snippet || em.body || '').slice(0, 400),
      matchedVia: em.matchedVia || null,
    }));
  }

  if (wantMeetings) {
    const mtgs = [...(e.cachedMeetings || []), ...(e.manualMeetings || [])].slice(0, lim);
    out.meetings = mtgs.map(m => {
      const transcript = m.transcript || m.notes || '';
      const summary = m.summaryMarkdown || m.summary || '';
      const haystack = (transcript + ' ' + summary + ' ' + (m.title || '')).toLowerCase();
      const kwHit = kwList.length && kwList.some(k => haystack.includes(k));
      return {
        id: m.id || null,
        title: m.title || 'Untitled',
        date: m.date || null,
        attendees: (m.attendees || []).slice(0, 8).map(a => typeof a === 'string' ? a : (a.name || a.email || '')),
        summary: summary.slice(0, 800),
        transcript: kwHit ? transcript.slice(0, 20000) : transcript.slice(0, 500),
        transcriptLength: kwHit ? 'expanded' : (transcript.length > 500 ? 'summary-only' : 'full'),
      };
    });
  }

  return _capToolResult(out);
}

async function _tool_get_profile_section({ section, tier }) {
  const t = tier || 'standard';
  const keys = t === 'full'
    ? ['coopProfileFull', 'coopPrefsFull']
    : ['coopProfileStandard', 'coopPrefsStandard'];
  const d = await new Promise(r => chrome.storage.local.get(keys, r));

  if (section === 'profile') {
    const content = t === 'full' ? d.coopProfileFull : d.coopProfileStandard;
    if (content) return { section, tier: t, content };
    // Fallback: compile on-demand if not yet compiled
    const { compileProfile } = await import('./profile-compiler.js');
    const compiled = await compileProfile();
    return { section, tier: t, content: t === 'full' ? compiled.coopProfileFull : compiled.coopProfileStandard };
  }

  if (section === 'preferences') {
    const content = t === 'full' ? d.coopPrefsFull : d.coopPrefsStandard;
    if (content) return { section, tier: t, content };
    const { compileProfile } = await import('./profile-compiler.js');
    const compiled = await compileProfile();
    return { section, tier: t, content: t === 'full' ? compiled.coopPrefsFull : compiled.coopPrefsStandard };
  }

  return { error: `Unknown section: ${section}. Use 'profile' or 'preferences'.` };
}

async function _tool_get_pipeline_overview({ filter, stage }) {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  let entries = savedCompanies || [];
  const INACTIVE = new Set(['rejected', 'closed_lost', 'closed_won', 'archived', 'passed', 'not_interested']);
  if (!filter || filter === 'active') {
    entries = entries.filter(e => !INACTIVE.has(e.jobStage) && !INACTIVE.has(e.status));
  } else if (filter === 'needs_action') {
    entries = entries.filter(e => e.actionStatus === 'my_court' && !INACTIVE.has(e.jobStage));
  }
  if (stage) entries = entries.filter(e => e.jobStage === stage);
  const out = {
    filter: filter || 'active',
    stage: stage || null,
    count: entries.length,
    entries: entries.slice(0, 50).map(e => ({
      name: e.company,
      stage: e.jobStage || e.status || null,
      rating: e.rating || null,
      actionStatus: e.actionStatus || null,
      jobTitle: e.jobTitle || null,
      score: e.jobMatch?.score || null,
      nextStep: e.nextStep || null,
    })),
  };
  return _capToolResult(out);
}

async function _tool_search_memory({ query, limit }) {
  const { coopMemory } = await new Promise(r => chrome.storage.local.get(['coopMemory'], r));
  const entries = (coopMemory?.entries || []);
  const q = (query || '').toLowerCase().trim();
  if (!q) return { query, matches: [] };
  const terms = q.split(/\s+/).filter(t => t.length > 2);
  const scored = entries.map(e => {
    const hay = ((e.text || '') + ' ' + (e.name || '')).toLowerCase();
    const hits = terms.filter(t => hay.includes(t)).length;
    return { e, hits };
  }).filter(s => s.hits > 0).sort((a, b) => b.hits - a.hits);
  return {
    query,
    matches: scored.slice(0, Math.min(limit || 5, 15)).map(s => ({
      type: s.e.type || 'note',
      name: s.e.name || null,
      text: (s.e.text || '').slice(0, 800),
      source: s.e.source || null,
      savedAt: s.e.savedAt || s.e.createdAt || null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool router
// ═══════════════════════════════════════════════════════════════════════════

export async function runCoopTool(name, input, ctx) {
  try {
    switch (name) {
      case 'get_company_context':   return await _tool_get_company_context(input || {}, ctx);
      case 'get_communications':    return await _tool_get_communications(input || {}, ctx);
      case 'get_profile_section':   return await _tool_get_profile_section(input || {}, ctx);
      case 'get_pipeline_overview': return await _tool_get_pipeline_overview(input || {}, ctx);
      case 'search_memory':         return await _tool_search_memory(input || {}, ctx);
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error('[Coop][ToolUse] Tool error:', name, err);
    return { error: `Tool handler threw: ${err.message || String(err)}` };
  }
}
