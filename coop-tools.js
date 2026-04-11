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
    description: "Returns one slice of the user's Career OS profile. Use when answering questions about the user's background, experience, story, dealbreakers, preferences, skills, or learnings. Fetch only the section you need — do not fetch 'story' unless the question is actually about the user's story.",
    input_schema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['story', 'experience', 'dealbreakers', 'preferences', 'attracted_to', 'skills', 'learnings'],
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

async function _tool_get_profile_section({ section }) {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const keys = ['profileStory', 'profileExperience', 'profileExperienceEntries', 'profilePrinciples', 'profileMotivators',
    'profileVoice', 'profileSkills', 'storyTime', 'profileAttractedTo', 'profileDealbreakers',
    'profileSkillTags', 'profileRoleICP', 'profileCompanyICP', 'profileInterviewLearnings'];
  const d = await new Promise(r => chrome.storage.local.get(keys, r));
  switch (section) {
    case 'story': {
      const s = d.profileStory || d.storyTime?.profileSummary || d.storyTime?.rawInput || '';
      return { section, content: s.slice(0, 16000) };
    }
    case 'experience': {
      let text = (d.profileExperience || '').slice(0, 12000);
      const entries = d.profileExperienceEntries || [];
      if (entries.length) {
        text += '\n\nStructured experience (tagged skills are confirmed proficiency):';
        entries.forEach(e => {
          if (!e.company && !(e.tags || []).length) return;
          const tags = (e.tags || []).join(', ');
          text += `\n- ${e.company || 'Unknown'}${e.titles ? ` (${e.titles})` : ''}${e.dateRange ? ` [${e.dateRange}]` : ''}${tags ? `: ${tags}` : ''}`;
        });
      }
      return { section, content: text };
    }
    case 'dealbreakers':
      return { section, content: d.profileDealbreakers || [] };
    case 'attracted_to':
      return { section, content: d.profileAttractedTo || [] };
    case 'preferences':
      return {
        section,
        content: {
          roleICP: d.profileRoleICP || null,
          companyICP: d.profileCompanyICP || null,
          salaryFloor: prefs.salaryFloor || null,
          oteFloor: prefs.oteFloor || null,
          workArrangement: prefs.workArrangement || [],
          location: prefs.userLocation || null,
          maxTravel: prefs.maxTravel || null,
        },
      };
    case 'skills':
      return { section, content: { skills: d.profileSkills || '', tags: d.profileSkillTags || [] } };
    case 'learnings':
      return { section, content: (d.profileInterviewLearnings || []).slice(-20) };
    default:
      return { error: `Unknown section: ${section}` };
  }
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
