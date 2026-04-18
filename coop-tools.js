// coop-tools.js — G2 Coop tool-use definitions and handlers.
// PRD: prds/G2-coop-tool-use.md
// Flag: state.coopConfig.useToolUse

import { getUserName, relativeLabel } from './utils.js';
import { buildCoopMemoryBlock } from './memory.js';
import { getKnowledgeDoc } from './knowledge.js';

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
    description: "Returns the user's profile data, preferences, or learnings as markdown. PREFERRED: use the 'sections' parameter with specific doc IDs for targeted access — this is more efficient and shows the user exactly what you loaded. Only fall back to 'section' + 'tier' when you need the full document. Use 'full' tier only for scoring, cover letters, deep career questions.",
    input_schema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: "PREFERRED. Specific knowledge doc IDs for targeted access. Request only what you need. Available IDs: profile:story, profile:experience, profile:skills, profile:principles, profile:voice, profile:faq, profile:resume, profile:links, prefs:roleICP, prefs:companyICP, prefs:greenFlags, prefs:redFlags, prefs:compensation, prefs:location, prefs:learnings. Example: ['prefs:compensation', 'prefs:roleICP'] for a salary question.",
        },
        section: {
          type: 'string',
          enum: ['profile', 'preferences', 'learnings'],
          description: "Fallback: load an entire section. 'profile' = who the user is. 'preferences' = what they want. 'learnings' = accumulated insights. Prefer 'sections' array for targeted access.",
        },
        tier: {
          type: 'string',
          enum: ['standard', 'full'],
          description: "Detail level when using 'section'. 'standard' (~800 tokens) for most questions. 'full' (~2000 tokens) for scoring, applications, cover letters.",
        },
      },
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
  {
    name: 'get_memory_narrative',
    description: "Returns Coop's synthesized narrative memory of the user — a holistic summary of who they are, what they want, how they think, and what Coop has learned from past interactions. Use for deep personalization questions, 'what do you know about me', advisor-style reflection, or when profile + preferences alone aren't enough context.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch text content from a URL. Use when the user pastes a URL or asks about a web page. Returns the extracted text from the page.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'update_coop_setting',
    description: 'Update a Coop configuration setting. Use this when the user asks to change their chat model, toggle features, or adjust preferences.',
    input_schema: {
      type: 'object',
      properties: {
        setting: {
          type: 'string',
          enum: ['chatModel'],
          description: 'The setting key to change. Currently supported: chatModel',
        },
        value: {
          type: 'string',
          description: 'The new value for the setting.',
        },
      },
      required: ['setting', 'value'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// OpenAI tool format conversion
// ═══════════════════════════════════════════════════════════════════════════

// Claude uses `input_schema`, OpenAI uses `function.parameters` wrapper
export const COOP_TOOLS_OPENAI = COOP_TOOLS.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

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

  // Actual trimming: identify large text fields and proportionally reduce them
  const trimmed = JSON.parse(JSON.stringify(obj)); // Deep clone
  const trimmedFields = [];

  // Identify and measure large text fields that are candidates for trimming
  const collectLargeFields = (o, path = '') => {
    const result = [];
    if (Array.isArray(o)) {
      o.forEach((item, i) => {
        result.push(...collectLargeFields(item, `${path}[${i}]`));
      });
    } else if (o && typeof o === 'object') {
      for (const [key, val] of Object.entries(o)) {
        const newPath = path ? `${path}.${key}` : key;
        if (typeof val === 'string' && val.length > 1000) {
          result.push({ path: newPath, value: val, size: val.length });
        } else if (val && typeof val === 'object') {
          result.push(...collectLargeFields(val, newPath));
        }
      }
    }
    return result;
  };

  const largeFields = collectLargeFields(trimmed);
  if (!largeFields.length) {
    // No large text fields to trim; just mark as truncated
    return { ...obj, _truncated: true, _note: `Result exceeded ${TOOL_RESULT_SIZE_CAP}-char cap.` };
  }

  // Sort by size descending; trim largest first
  largeFields.sort((a, b) => b.size - a.size);

  // Trim iteratively until we're under budget
  let currentSize = JSON.stringify(trimmed).length;
  const budgetRemaining = TOOL_RESULT_SIZE_CAP;

  for (const field of largeFields) {
    if (currentSize <= budgetRemaining) break;

    const overage = currentSize - budgetRemaining;
    const pathParts = field.path.split(/[\.\[\]]+/).filter(Boolean);
    let obj_ref = trimmed;

    // Navigate to the parent of the field to trim
    for (let i = 0; i < pathParts.length - 1; i++) {
      const key = pathParts[i];
      if (isNaN(key)) {
        obj_ref = obj_ref[key];
      } else {
        obj_ref = obj_ref[parseInt(key)];
      }
    }

    const lastKey = pathParts[pathParts.length - 1];
    const val = isNaN(lastKey) ? obj_ref[lastKey] : obj_ref[parseInt(lastKey)];

    // Trim proportionally: aim to save ~150% of overage to be safe
    const targetTrim = Math.ceil(overage * 1.5);
    const newLen = Math.max(1000, val.length - targetTrim);
    const trimmedVal = val.slice(0, newLen) + ' …[trimmed]';

    if (isNaN(lastKey)) {
      obj_ref[lastKey] = trimmedVal;
    } else {
      obj_ref[parseInt(lastKey)] = trimmedVal;
    }

    if (!trimmedFields.includes(field.path)) {
      trimmedFields.push(field.path);
    }

    currentSize = JSON.stringify(trimmed).length;
  }

  return {
    ...trimmed,
    _truncated: true,
    _truncatedFields: trimmedFields,
    _note: `Result exceeded ${TOOL_RESULT_SIZE_CAP}-char cap. Trimmed ${trimmedFields.length} field(s).`
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool handlers
// ═══════════════════════════════════════════════════════════════════════════

// Build the exact string injected into the prompt for an email.
function _buildEmailRaw(em) {
  const header = [
    `From: ${em.from || '(unknown)'}`,
    em.to ? `To: ${em.to}` : null,
    `Date: ${em.date || '(unknown)'}`,
    `Subject: ${em.subject || '(no subject)'}`,
  ].filter(Boolean).join('\n');
  const body = (em.body || em.snippet || '').trim();
  return `${header}\n\n${body}`;
}

async function _tool_get_company_context({ company_name }, ctx) {
  const r = await _coopResolveCompany(company_name, ctx);
  if (r.error) return r;
  const e = r.entry;
  const lines = [`# ${e.company}`];
  const meta = [];
  if (e.jobStage || e.status) meta.push(`Stage: ${e.jobStage || e.status}`);
  if (e.actionStatus) meta.push(`Action: ${e.actionStatus}`);
  if (e.rating) meta.push(`Rating: ${e.rating}/5`);
  if (meta.length) lines.push(meta.join(' | '));
  lines.push('');

  // Firmographics
  const firm = [];
  if (e.employees) firm.push(`- Employees: ${e.employees}`);
  if (e.industry) firm.push(`- Industry: ${e.industry}`);
  if (e.funding) firm.push(`- Funding: ${e.funding}`);
  if (e.revenue) firm.push(`- Revenue: ${e.revenue}`);
  if (e.companyType) firm.push(`- Type: ${e.companyType}`);
  if (e.techStack?.length) firm.push(`- Tech Stack: ${e.techStack.slice(0, 10).join(', ')}`);
  if (e.companyWebsite) firm.push(`- Website: ${e.companyWebsite}`);
  if (e.companyLinkedin) firm.push(`- LinkedIn: ${e.companyLinkedin}`);
  if (firm.length) { lines.push('## Company'); lines.push(...firm); lines.push(''); }

  const intel = e.intelligence?.eli5 || e.intelligence?.oneLiner || e.intelligence?.summary;
  if (intel) { lines.push('## Intelligence'); lines.push(intel); lines.push(''); }

  // Leadership
  const leaders = (e.leaders || []).slice(0, 6);
  if (leaders.length) {
    lines.push('## Leadership');
    leaders.forEach(l => lines.push(`- **${l.name}** — ${l.title || 'Unknown'}${l.linkedin ? ` (${l.linkedin})` : ''}`));
    lines.push('');
  }

  // Role (if opportunity)
  if (e.isOpportunity || e.jobTitle) {
    lines.push('## Role');
    if (e.jobTitle) lines.push(`- Title: ${e.jobTitle}`);
    if (e.jobMatch?.score != null) lines.push(`- Score: ${e.jobMatch.score}/10 (${e.jobMatch.verdict || ''})`);
    if (e.jobDescription) { lines.push('### Job Description'); lines.push(e.jobDescription.slice(0, 2500)); lines.push(''); }
  }

  // Pipeline state
  if (e.nextStep || e.stageTimestamps || (e.tags || []).length) {
    lines.push('## Pipeline');
    if (e.nextStep) lines.push(`- Next step: ${e.nextStep}`);
    if (e.tags?.length) lines.push(`- Tags: ${e.tags.join(', ')}`);
    if (e.stageTimestamps) {
      const stamps = Object.entries(e.stageTimestamps).sort((a, b) => b[1] - a[1]).slice(0, 5);
      stamps.forEach(([k, v]) => lines.push(`- ${k}: ${new Date(v).toLocaleDateString()}`));
    }
    lines.push('');
  }

  // Notes
  const notes = (e.notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (notes) { lines.push('## Notes'); lines.push(notes.slice(0, 1200)); }

  // Build _meta for context manifest
  const _sections = [];
  if (firm.length) _sections.push('firmographics');
  if (intel) _sections.push('intelligence');
  if (leaders.length) _sections.push('leadership');
  if (e.isOpportunity || e.jobTitle) _sections.push('role');
  if (e.nextStep || e.stageTimestamps || (e.tags || []).length) _sections.push('pipeline');
  if (notes) _sections.push('notes');

  const content = lines.join('\n');
  return {
    content,
    _meta: {
      type: 'company',
      company: e.company,
      sections: _sections,
      leaderCount: leaders.length,
      hasJobDescription: !!(e.jobDescription),
      hasScore: e.jobMatch?.score != null,
      rawContent: content,
    },
  };
}

// Sort items by date descending (newest first). Handles various date formats.
function _sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const da = new Date(a.date || 0), db = new Date(b.date || 0);
    return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
  });
}

async function _tool_get_communications({ company_name, types, limit, keywords }, ctx) {
  const r = await _coopResolveCompany(company_name, ctx);
  if (r.error) return r;
  const e = r.entry;
  const wantEmails = !types || types.includes('emails');
  const wantMeetings = !types || types.includes('meetings');
  const lim = Math.min(limit || 5, 15);
  const kwList = (keywords || []).map(k => k.toLowerCase()).filter(Boolean);
  const lines = [`# Communications — ${e.company}`];

  if (wantEmails) {
    const ems = _sortByDateDesc(e.cachedEmails || []).slice(0, lim);
    lines.push('');
    lines.push(`## Emails (${ems.length})`);
    if (!ems.length) { lines.push('No emails found.'); }
    ems.forEach((em, idx) => {
      const from = (em.from || '').replace(/<[^>]+>/, '').trim();
      lines.push(`### ${em.subject || '(no subject)'}`);
      const emRel = relativeLabel(em.date);
      const emDateStr = `${em.date || 'unknown'}${emRel ? ` (${emRel})` : ''}`;
      lines.push(`From: ${from} | Date: ${emDateStr}${em.matchedVia ? ` | Via: ${em.matchedVia}` : ''}`);
      // Most recent email gets full text; older emails get snippets
      const cap = idx === 0 ? 2000 : 400;
      lines.push(((em.body || em.snippet || '').slice(0, cap)));
      lines.push('');
    });
  }

  if (wantMeetings) {
    const mtgs = _sortByDateDesc([...(e.cachedMeetings || []), ...(e.manualMeetings || [])]).slice(0, lim);
    lines.push(`## Meetings (${mtgs.length})`);
    if (!mtgs.length) { lines.push('No meetings found.'); }
    mtgs.forEach((m, idx) => {
      const transcript = m.transcript || m.notes || '';
      const summary = m.summaryMarkdown || m.summary || '';
      const haystack = (transcript + ' ' + summary + ' ' + (m.title || '')).toLowerCase();
      const kwHit = kwList.length && kwList.some(k => haystack.includes(k));
      const attendees = (m.attendees || []).slice(0, 8).map(a => typeof a === 'string' ? a : (a.name || a.email || '')).join(', ');
      lines.push(`### ${m.title || 'Untitled'}`);
      const mtgRel = relativeLabel(m.date);
      const mtgDateStr = `${m.date || 'unknown'}${mtgRel ? ` (${mtgRel})` : ''}`;
      lines.push(`Date: ${mtgDateStr}${attendees ? ` | Attendees: ${attendees}` : ''}`);
      if (summary) { lines.push('**Summary:**'); lines.push(summary.slice(0, 800)); }
      // Most recent meeting gets full transcript; older meetings follow keyword/preview rules
      if (idx === 0 && transcript) {
        lines.push('**Transcript (most recent — full):**');
        lines.push(transcript.slice(0, 20000));
      } else if (kwHit) {
        lines.push('**Transcript (keyword match — expanded):**');
        lines.push(transcript.slice(0, 20000));
      } else if (transcript.length > 500) {
        lines.push('**Transcript (preview — pass keywords to expand):**');
        lines.push(transcript.slice(0, 500) + '...');
      } else if (transcript) {
        lines.push('**Transcript:**');
        lines.push(transcript);
      }
      lines.push('');
    });
  }

  const md = lines.join('\n');

  // Build _meta for context manifest (also sorted newest-first)
  const sortedEmails = wantEmails ? _sortByDateDesc(e.cachedEmails || []).slice(0, lim) : [];
  const emailSources = sortedEmails.map(em => ({
    kind: 'email',
    id: `email_${em.id || em.date || Math.random().toString(36).slice(2)}`,
    subject: em.subject || '(no subject)',
    from: (em.from || '').replace(/<[^>]+>/, '').trim(),
    to: em.to || '',
    date: em.date || 'unknown',
    rawContent: _buildEmailRaw(em),
    truncatedAt: em._truncatedAt || null,
  }));
  const sortedMtgs = wantMeetings ? _sortByDateDesc([...(e.cachedMeetings || []), ...(e.manualMeetings || [])]).slice(0, lim) : [];
  const meetingSources = sortedMtgs.map(m => {
    const transcript = m.transcript || m.notes || '';
    const slicedAt = transcript.length > 20000 ? 20000 : null;
    const attendees = (m.attendees || []).slice(0, 8).map(a => typeof a === 'string' ? a : (a.name || a.email || '')).join(', ');
    return {
      kind: 'meeting',
      id: `meeting_${m.id || m.date || Math.random().toString(36).slice(2)}`,
      title: m.title || 'Untitled',
      attendees,
      date: m.date || 'unknown',
      source: m._isManual ? 'manual' : 'granola',
      rawContent: transcript.slice(0, 20000),
      truncatedAt: slicedAt,
    };
  });

  return {
    content: md.length > TOOL_RESULT_SIZE_CAP ? md.slice(0, TOOL_RESULT_SIZE_CAP) + '\n\n[truncated]' : md,
    _meta: {
      type: 'communications',
      company: e.company,
      emailCount: emailSources.length,
      meetingCount: meetingSources.length,
      sources: [...emailSources, ...meetingSources],
    },
  };
}

// Extract ## headings from markdown content for transparency display
function _extractSectionHeaders(content) {
  if (!content) return [];
  return (content.match(/^##\s+.+$/gm) || []).map(h => h.replace(/^##\s+/, '').trim());
}

async function _tool_get_profile_section({ section, tier, sections: sectionIds }) {
  // Granular access: fetch specific knowledge doc sections by ID
  if (sectionIds && sectionIds.length) {
    const parts = [];
    const loadedSections = [];
    for (const id of sectionIds) {
      const doc = await getKnowledgeDoc(id);
      if (doc) {
        parts.push(`## ${doc.title}\n${doc.content}`);
        loadedSections.push(id);
      }
    }
    if (!parts.length) {
      return { error: `No knowledge docs found for: ${sectionIds.join(', ')}. Knowledge docs may not be compiled yet.` };
    }
    const content = parts.join('\n\n');
    return {
      section: 'granular',
      content,
      _meta: {
        type: 'profile',
        section: 'granular',
        tier: 'granular',
        loadedSections,
        charCount: content.length,
        tokenEstimate: Math.round(content.length / 4),
        rawContent: content,
      },
    };
  }

  // Learnings section: return compiled learnings from memory
  if (section === 'learnings') {
    const doc = await getKnowledgeDoc('learnings:compiled');
    if (doc && doc.content) {
      return {
        section: 'learnings',
        content: doc.content,
        _meta: {
          type: 'learnings',
          section: 'learnings',
          entryCount: doc.entryCount || 0,
          charCount: doc.content.length,
          tokenEstimate: Math.round(doc.content.length / 4),
        },
      };
    }
    return { section: 'learnings', content: 'No learnings have been accumulated yet. Coop learns from conversations over time.' };
  }

  // Standard tier access (backward compatible)
  const t = tier || 'standard';
  const keys = t === 'full'
    ? ['coopProfileFull', 'coopPrefsFull']
    : ['coopProfileStandard', 'coopPrefsStandard'];
  const d = await new Promise(r => chrome.storage.local.get(keys, r));

  if (section === 'profile') {
    const content = t === 'full' ? d.coopProfileFull : d.coopProfileStandard;
    if (content) return {
      section, tier: t, content,
      _meta: { type: 'profile', section, tier: t, sectionHeaders: _extractSectionHeaders(content), charCount: content.length, tokenEstimate: Math.round(content.length / 4), rawContent: content },
    };
    // Fallback: compile on-demand if not yet compiled
    const { compileProfile } = await import('./profile-compiler.js');
    const compiled = await compileProfile();
    const fallbackContent = t === 'full' ? compiled.coopProfileFull : compiled.coopProfileStandard;
    return {
      section, tier: t, content: fallbackContent,
      _meta: { type: 'profile', section, tier: t, sectionHeaders: _extractSectionHeaders(fallbackContent), charCount: (fallbackContent || '').length, tokenEstimate: Math.round((fallbackContent || '').length / 4), rawContent: fallbackContent || '' },
    };
  }

  if (section === 'preferences') {
    const content = t === 'full' ? d.coopPrefsFull : d.coopPrefsStandard;
    if (content) return {
      section, tier: t, content,
      _meta: { type: 'profile', section, tier: t, sectionHeaders: _extractSectionHeaders(content), charCount: content.length, tokenEstimate: Math.round(content.length / 4), rawContent: content },
    };
    const { compileProfile } = await import('./profile-compiler.js');
    const compiled = await compileProfile();
    const fallbackContent = t === 'full' ? compiled.coopPrefsFull : compiled.coopPrefsStandard;
    return {
      section, tier: t, content: fallbackContent,
      _meta: { type: 'profile', section, tier: t, sectionHeaders: _extractSectionHeaders(fallbackContent), charCount: (fallbackContent || '').length, tokenEstimate: Math.round((fallbackContent || '').length / 4), rawContent: fallbackContent || '' },
    };
  }

  return { error: `Unknown section: ${section}. Use 'profile', 'preferences', or 'learnings'.` };
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

  const lines = [`# Pipeline Overview`];
  lines.push(`Filter: ${filter || 'active'}${stage ? ` | Stage: ${stage}` : ''} | ${entries.length} entries`);
  lines.push('');

  // Group by stage
  const byStage = {};
  entries.slice(0, 50).forEach(e => {
    const s = e.jobStage || e.status || 'unknown';
    if (!byStage[s]) byStage[s] = [];
    byStage[s].push(e);
  });

  for (const [stageKey, items] of Object.entries(byStage)) {
    lines.push(`## ${stageKey} (${items.length})`);
    items.forEach(e => {
      const parts = [`**${e.company}**`];
      if (e.jobTitle) parts.push(e.jobTitle);
      if (e.jobMatch?.score != null) parts.push(`Score: ${e.jobMatch.score}/10`);
      if (e.rating) parts.push(`Rating: ${e.rating}/5`);
      if (e.actionStatus) parts.push(`[${e.actionStatus}]`);
      lines.push(`- ${parts.join(' — ')}`);
      if (e.nextStep) lines.push(`  Next: ${e.nextStep}`);
    });
    lines.push('');
  }

  const content = lines.join('\n');
  return {
    content,
    _meta: {
      type: 'pipeline',
      filter: filter || 'active',
      entryCount: entries.length,
      stages: Object.keys(byStage),
    },
  };
}

async function _tool_search_memory({ query, limit }) {
  const { coopMemory } = await new Promise(r => chrome.storage.local.get(['coopMemory'], r));
  const entries = (coopMemory?.entries || []);
  const q = (query || '').toLowerCase().trim();
  if (!q) return { content: `# Memory Search: "${query}"\nNo results.` };
  const terms = q.split(/\s+/).filter(t => t.length > 2);
  const scored = entries.map(e => {
    const hay = ((e.text || '') + ' ' + (e.body || '') + ' ' + (e.name || '')).toLowerCase();
    const hits = terms.filter(t => hay.includes(t)).length;
    return { e, hits };
  }).filter(s => s.hits > 0).sort((a, b) => b.hits - a.hits);
  const matches = scored.slice(0, Math.min(limit || 5, 15));

  const lines = [`# Memory Search: "${query}"`];
  if (!matches.length) { lines.push('No matching memories found.'); }
  matches.forEach(s => {
    const e = s.e;
    lines.push(`## [${e.type || 'note'}] ${e.name || 'Untitled'}`);
    if (e.source) lines.push(`Source: ${e.source} | Saved: ${e.savedAt || e.createdAt || 'unknown'}`);
    lines.push((e.body || e.text || '').slice(0, 800));
    lines.push('');
  });

  const content = lines.join('\n');
  return {
    content,
    _meta: { type: 'memory', query, matchCount: matches.length },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Serialize tool result for LLM consumption
// ═══════════════════════════════════════════════════════════════════════════

// Tools return { content: "markdown string" } or { error: "..." } or legacy JSON.
// Extract the string directly to avoid wrapping markdown in JSON overhead.
export function serializeToolResult(result) {
  if (typeof result?.content === 'string') return result.content;
  if (typeof result?.error === 'string') return `Error: ${result.error}${result.suggestions ? '\nDid you mean: ' + result.suggestions.join(', ') : ''}`;
  return JSON.stringify(result);
}

// ═══════════════════════════════════════════════════════════════════════════
async function _tool_get_memory_narrative() {
  const { coopContextWindow } = await new Promise(r => chrome.storage.local.get(['coopContextWindow'], r));
  const md = coopContextWindow?.markdown;
  if (!md) return { content: 'No memory narrative has been generated yet. The user can generate one from the Coop settings page under Memory.' };
  const generatedAt = coopContextWindow.generatedAt;
  const age = generatedAt ? Math.floor((Date.now() - new Date(generatedAt).getTime()) / 86400000) : null;
  const ageLine = age !== null ? `\n\n_(Last synthesized ${age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`})_` : '';
  return {
    content: md + ageLine,
    _meta: { type: 'narrative', ageInDays: age },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
async function _tool_update_coop_setting({ setting, value }) {
  const VALID_CHAT_MODELS = new Set([
    'gpt-4.1-nano',
    'gemini-2.0-flash-lite',
    'gpt-4.1-mini',
    'claude-haiku-4-5-20251001',
    'gemini-2.0-flash',
    'claude-sonnet-4-6',
    'gpt-4.1',
  ]);

  if (setting === 'chatModel') {
    if (!VALID_CHAT_MODELS.has(value)) {
      return {
        error: `Invalid chat model: "${value}". Valid options: ${Array.from(VALID_CHAT_MODELS).join(', ')}`,
      };
    }

    const { coopConfig } = await new Promise(r => chrome.storage.local.get(['coopConfig'], r));
    const cfg = { ...coopConfig, chatModel: value };
    await new Promise(r => chrome.storage.local.set({ coopConfig: cfg }, r));

    const modelNames = {
      'gpt-4.1-nano':              'GPT-4.1 Nano',
      'gemini-2.0-flash-lite':     'Gemini Flash-Lite',
      'gpt-4.1-mini':              'GPT-4.1 Mini',
      'claude-haiku-4-5-20251001': 'Claude Haiku',
      'gemini-2.0-flash':          'Gemini Flash',
      'claude-sonnet-4-6':         'Claude Sonnet',
      'gpt-4.1':                   'GPT-4.1',
    };

    return {
      content: `✓ Chat model switched to ${modelNames[value]}. This applies to new messages.`,
      _meta: { type: 'setting', setting, value },
    };
  }

  return {
    error: `Unknown setting: "${setting}". Currently supported: chatModel`,
  };
}

// ── fetch_url ────────────────────────────────────────────────────────────────

async function _tool_fetch_url({ url }) {
  if (!url) return { error: 'No URL provided' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `HTTP ${res.status}`, url };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
    if (text.length < 50) return { content: '(Page returned very little text content)', url, _meta: { type: 'url', url, charCount: 0 } };
    return { content: text, url, _meta: { type: 'url', url, charCount: text.length } };
  } catch (err) {
    return { error: `Failed to fetch: ${err.message}`, url };
  }
}

// Tool router
// ═══════════════════════════════════════════════════════════════════════════

export async function runCoopTool(name, input, ctx) {
  try {
    switch (name) {
      case 'get_company_context':    return await _tool_get_company_context(input || {}, ctx);
      case 'get_communications':     return await _tool_get_communications(input || {}, ctx);
      case 'get_profile_section':    return await _tool_get_profile_section(input || {}, ctx);
      case 'get_pipeline_overview':  return await _tool_get_pipeline_overview(input || {}, ctx);
      case 'search_memory':          return await _tool_search_memory(input || {}, ctx);
      case 'get_memory_narrative':   return await _tool_get_memory_narrative();
      case 'fetch_url':              return await _tool_fetch_url(input || {});
      case 'update_coop_setting':    return await _tool_update_coop_setting(input || {});
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error('[Coop][ToolUse] Tool error:', name, err);
    return { error: `Tool handler threw: ${err.message || String(err)}` };
  }
}
