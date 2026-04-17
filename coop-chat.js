// coop-chat.js — Unified Coop chat handler, tool-use loop, tiered routing.
// Handles all 4 message types: CHAT_MESSAGE, GLOBAL_CHAT_MESSAGE, COOP_CHAT, COOP_MESSAGE.

import { state } from './bg-state.js';
import { dlog, getUserName, truncateToTokenBudget, buildIdentityPrompt, coopInterp } from './utils.js';
import { claudeApiCall, chatWithFallback, getModelForTask, trackApiCall } from './api.js';
import { applyCoopMemoryActions } from './memory.js';
import { COOP_TOOLS, COOP_TOOLS_OPENAI, runCoopTool, serializeToolResult } from './coop-tools.js';
import { buildProfileManifestString } from './knowledge.js';

// Blocking insight extraction — inlined from memory.js's private _doExtractInsightsFromChat.
// Used when the user's message contains a trigger phrase ("remember this", "from now on", etc.)
// so the insight is saved before the chat response returns.
async function _doBlockingInsightExtraction(userMsg, reply, source) {
  try {
    const { coopMemory } = await new Promise(r => chrome.storage.local.get(['coopMemory'], r));
    const mem = coopMemory || { entries: [] };
    const existingIndex = (mem.entries || []).map(e => `- [${e.type}] ${e.name}: ${e.description}`).join('\n') || '(none)';

    const res = await claudeApiCall({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `You observed a conversation between the user and Coop, their AI career advisor. Decide whether anything in this exchange should be saved to Coop's persistent memory so it can inform future conversations.

Coop's memory mirrors Claude Code's project-memory format. Each saved entry has:
- type: one of "user" | "feedback" | "project" | "reference"
- name: short title (3-6 words)
- description: one-line hook (under 150 chars), what makes this entry useful
- body: the full memory content. For feedback/project, structure as: rule/fact, then "Why:" line, then "How to apply:" line.

Type definitions:
- user: facts about who the user is, their role, goals, expertise, preferences as a person
- feedback: corrections or validated approaches the user has given Coop ("don't do X", "yes that worked")
- project: specific in-flight work, opportunities, deadlines, strategic decisions tied to a company/role
- reference: pointers to where info lives (links, dashboards, tools, accounts)

Return ONLY a JSON object:
{
  "actions": [
    { "op": "create", "type": "...", "name": "...", "description": "...", "body": "..." },
    { "op": "update", "match_name": "existing entry name", "body": "new body" },
    { "op": "delete", "match_name": "existing entry name" }
  ]
}

Rules:
- ONLY save things that will be useful in FUTURE conversations. Skip ephemeral chatter, restated context, or facts already obvious from their profile.
- Prefer updating an existing entry over creating a near-duplicate.
- If nothing is worth saving, return {"actions": []}. Empty arrays are PERFECTLY FINE and often correct.
- Never save sensitive credentials.
- Do NOT save raw application answers — those belong in the experience profile, not memory.
- PRIORITY: If Coop flagged an experience gap and the user responded with a concrete story, personal anecdote, or example from their background, SAVE IT as a type="user" memory. Name it after the experience (e.g. "Healthcare CRM rollout at ABC", "Founding AE at early-stage SaaS"). Body = the story in the user's own phrasing, compressed to 3-6 sentences. This is the main loop — don't miss these.

Body formatting (CRITICAL — match Claude Code's project memory style):
- For type=user: 1-3 sentences. Plain prose. No frontmatter, no labels.
- For type=feedback or type=project: structure as:
  Line 1: the rule, decision, or fact (one clear sentence).
  Line 2: empty.
  Line 3: "**Why:** <one sentence on motivation, constraint, or stakeholder>"
  Line 4: "**How to apply:** <one sentence on when this kicks in / how it should shape Coop's behavior>"
- For type=reference: one line with the pointer + a brief note on what lives there.
- Do NOT use bullet lists. Do NOT use headers. Do NOT echo the type or name inside the body.
- Names should be 3-6 words, specific (not "User feedback" — say "Avoid trailing summaries").
- Descriptions should be a one-line hook (under 150 chars) that helps Coop decide if the memory is relevant in a future conversation.

Conversation:
User: ${userMsg}
Assistant: ${reply}

Existing memory index (avoid duplicates):
${existingIndex}` }]
    }, 3, 'insight');
    const data = await res.json();
    if (!res.ok) { console.warn('[Insights] Skipped — API busy (', res.status, ')'); return; }

    const text = (data.content?.[0]?.text || '').trim();
    let actions;
    try {
      const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonStr);
      actions = parsed.actions || [];
    } catch (e) { return; }

    if (!actions.length) return;
    await applyCoopMemoryActions(actions, source);
    console.log(`[CoopMemory] Applied ${actions.length} action(s) from ${source}`);
  } catch (err) {
    console.error('[CoopMemory] Error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Slim system prompt for G2 tool-use path
// ═══════════════════════════════════════════════════════════════════════════

// NOTE ON SIZE: Haiku's prompt-cache minimum is ~2048 tokens. The cached prefix
// for breakpoint 1 is (tools + base). COOP_TOOLS ≈ 700 tokens; base MUST be
// large enough that tools+base comfortably exceeds 2048 or neither breakpoint
// writes a cache. The padding in the TOOL PATTERNS / GROUNDING / RESPONSE
// DISCIPLINE sections below is deliberate — do not trim without remeasuring.
function _buildSlimCoopSystemPrompt({ boundCompany, isGlobalChat, todayStr, profileSummary, applicationMode, questionArchetype, careerOSChat, voiceProfile }) {
  const principles = coopInterp.principlesBlock() +
    (applicationMode ? coopInterp.draftHint?.() || '' : '');
  const base = [
    buildIdentityPrompt(state.coopConfig, { globalChat: isGlobalChat, contextType: 'company', userName: getUserName() }),
    `\n=== TODAY ===\n${todayStr}`,
    principles,
    profileSummary ? `\n=== USER AT A GLANCE ===\n${profileSummary}` : '',
    `\n=== TOOL USE ===
You have access to tools that fetch context on demand. Follow these rules exactly:

1. For ANY question about a specific company, ALWAYS call get_company_context first unless you already have the answer from the current conversation.
2. For ANY question about what was said, discussed, emailed, or in a meeting — ALWAYS call get_communications. DO NOT guess. DO NOT ask the user to paste content you can fetch yourself.
3. For questions about the user's background, experience, story, skills — call get_profile_section(section: "profile"). For dealbreakers, job criteria, comp, ICP — call get_profile_section(section: "preferences"). Use tier: "full" only for drafts, scoring, or deep analysis; "standard" is the default.
4. For cross-pipeline questions ("what should I focus on", "compare my top 3") — call get_pipeline_overview.
5. For "remember when I said..." — call search_memory.
6. Trivial questions (greetings, "switch to Sonnet", "what time is it") — answer directly. No tools.
7. Call tools in PARALLEL when you need more than one in the same turn. Emit multiple tool_use blocks in one response.
8. Tool results come back as JSON. Translate to natural language when answering — never paste JSON to the user.
9. Hard cap: 5 tool calls per message. After that, answer with what you have and say what was missing.
10. NEVER pretend to perform an action you have no tool for. If the user asks you to change a setting, switch models, send an email, update a task, modify the pipeline, or take any other action and you do NOT have a matching tool, say so plainly: "I can't do that from chat right now — use [the model picker in the chat header / the preferences page / the relevant UI]." Do NOT say "Done" or "Switched" or "Updated" for things you cannot actually do. This is critical — fake confirmations destroy the user's trust.

=== TOOL USAGE PATTERNS (examples) ===
These are reference patterns. Match the user's question to the closest pattern, then call the indicated tool(s).

- "What did Sarah say about equity?" → get_communications(keywords: ["equity", "comp", "compensation", "options", "rsu"])
- "What was discussed in our last call?" → get_communications(types: ["meetings"], limit: 3)
- "Did they ever email me back?" → get_communications(types: ["emails"], limit: 10)
- "Should I apply to this?" → get_company_context + get_profile_section(section: "preferences") IN PARALLEL
- "Is this a fit?" → get_company_context + get_profile_section(section: "preferences") IN PARALLEL
- "Draft a cover letter for this" → get_company_context + get_profile_section(section: "profile", tier: "full") IN PARALLEL
- "Draft a reply to this email" → get_communications(types: ["emails"], limit: 5) — use the thread context
- "What's my background in X?" → get_profile_section(section: "profile")
- "What are my dealbreakers?" → get_profile_section(section: "preferences")
- "What should I focus on this week?" → get_pipeline_overview(filter: "needs_action")
- "Who's in my pipeline right now?" → get_pipeline_overview(filter: "active")
- "Compare Acme and Globex" → get_company_context for BOTH IN PARALLEL
- "Remember when I said I didn't want to manage people?" → search_memory(query: "manage people")
- "What did I learn from my last interview?" → get_profile_section(section: "profile")
- "Help me answer this application question" → get_company_context + get_profile_section(section: "profile", tier: "full") IN PARALLEL
- "What do you know about me?" → get_memory_narrative
- "Give me your honest take on my job search" → get_memory_narrative + get_pipeline_overview IN PARALLEL
- "How well do you know me?" → get_memory_narrative
- "What have you learned from our conversations?" → get_profile_section(section: "learnings")
- "What's my salary requirement?" → get_profile_section(sections: ["prefs:compensation"])
- "What's my experience in healthcare?" → get_profile_section(sections: ["profile:experience"]) + search_memory(query: "healthcare")

=== ANTI-PATTERNS (do not do these) ===
- Do NOT ask the user to paste transcript content you can fetch with get_communications.
- Do NOT fetch full-tier profile when standard is sufficient — save tokens for drafts, scoring, and deep analysis.
- Do NOT call get_pipeline_overview for a single-company question.
- Do NOT call get_company_context repeatedly in the same turn for the same company.
- Do NOT call the same tool twice with identical arguments in one message.
- Do NOT refuse to answer because a tool returned an error — explain what was missing and answer what you can with what you have.
- Do NOT prefix answers with "Based on the tool results..." or "Let me check..." — just answer naturally.
- Do NOT dump raw JSON field names into the reply. Translate to plain language.

=== GROUNDING RULES ===
- If a claim about the company, a meeting, an email, or a person can only be answered by fetching context, call the tool. Do not guess from the company name or user's prior messages alone.
- If after calling tools you still don't have the answer, say so explicitly: "I don't see that in your emails/transcripts/profile." Never fabricate quotes, dates, names, or numbers.
- Quoted lines from transcripts/emails must come verbatim from tool results. If you can't find an exact quote, paraphrase and note it's a paraphrase.
- If the user asks a follow-up that refers to "they" or "it" or "that", resolve the reference from earlier in THIS conversation first. Only re-fetch if the referent is ambiguous or the prior context is thin.

=== SOURCE ATTRIBUTION ===
When your answer draws on specific data from tool results, weave the source naturally into your response:
- For emails: "Sarah mentioned in her March 12 email..." or "Based on the recruiting thread from last week..."
- For meetings: "In your call with the Acme team on March 15..." or "During the intro conversation..."
- For reviews: "A Glassdoor reviewer noted..." or "Employee reviews mention..."
- For profile data: "Your experience at [company]..." or "Given your background in..."
Do NOT use formal citation brackets or footnotes. Reference sources conversationally so the user knows where each claim comes from.

=== MISSING DATA TRANSPARENCY ===
If a question clearly needs data you haven't loaded or that doesn't exist, mention it briefly:
- "I don't have meeting transcripts for this company — want me to check?"
- "No emails found for [company]. Have you corresponded with them through a different channel?"
- "Your profile doesn't include [specific area] — adding it in preferences would help me answer this better."
Do NOT over-explain gaps. One sentence, then answer with what you have.

=== RESPONSE DISCIPLINE ===
- Match the length rules in your identity block: default 1-3 sentences; go longer only for drafts, comparisons, lists, or when the user explicitly asks for depth.
- Lead with the answer. No preamble. No "Great question." No recap of what the user said. No trailing summary of what you just did.
- When drafting (cover letters, emails, replies, intros, follow-ups): produce the draft first, then a one-line note on any assumption you made. Do NOT lecture on fit unless explicitly asked.
- DRAFT FORMATTING (strict): wrap every draft in \`---\` delimiters on their own lines. Exactly one opening \`---\` immediately before the draft, exactly one closing \`---\` immediately after. Include the subject line (if any) INSIDE the delimiters. Never quote the draft with "..." — use \`---\` only. Any intro/preamble goes BEFORE the opening \`---\`; any footnote/assumption goes AFTER the closing \`---\`. This is required so the copy button captures only the sendable content.
- When evaluating: be specific and honest. Point to the exact signal (a transcript line, a dealbreaker, a firmographic). Vague advice is worse than no advice.`,
  ].join('\n');

  // Mode-specific prompt extensions go in the tail (not cached — they vary per chat surface)
  const tailParts = [];

  if (applicationMode) {
    const vp = voiceProfile || {};
    const toneMap = {
      conversational: 'Conversational, confident, specific. Sound like a smart person talking.',
      professional: 'Professional but human. Clear and polished without being stiff.',
      direct: 'Direct and concise. No softening, no hedging. Say exactly what you mean.',
    };
    const lengthMap = {
      brief: '1-2 sentences',
      standard: '2-5 sentences',
      detailed: '5-8 sentences',
    };
    const toneInstr = toneMap[vp.tone] || toneMap.conversational;
    const lengthInstr = lengthMap[vp.defaultLength] || lengthMap.standard;
    const antiPhrases = (vp.antiPhrases || []).slice(0, 15);
    const maxExcl = Number.isFinite(vp.maxExclamations) ? vp.maxExclamations : 1;
    const signoffs = (vp.preferredSignoffs || []).filter(Boolean);

    let voiceBlock = `VOICE & TONE:\n- Write as the user in first person. ${toneInstr}\n- Not an AI writing — no dramatic framing, no buzzword stacking, no filler.\n- NEVER wrap the answer in quotation marks.`;
    if (antiPhrases.length) voiceBlock += `\n- AVOID these phrases entirely: ${antiPhrases.join('; ')}.`;
    if (maxExcl === 0) voiceBlock += `\n- No exclamation points.`;
    else voiceBlock += `\n- Max ${maxExcl} exclamation point${maxExcl > 1 ? 's' : ''} per answer.`;
    if (signoffs.length) voiceBlock += `\n- Preferred sign-offs: ${signoffs.join(', ')}.`;

    tailParts.push(`\n=== APPLICATION HELPER MODE ===
SITUATION: The user is filling out a job application form. They need short, authentic answers for application text box fields — not cover letters, not essays, not LinkedIn posts.

${voiceBlock}

LENGTH: ${lengthInstr} unless the user specifies otherwise.

OUTPUT FORMAT:
- Give ONE clean answer the user can copy-paste directly.
- No preamble, no alternatives unless asked, no commentary after.
- NEVER wrap in quotation marks.

CRITICAL: You have the user's FULL profile available via tools. ALWAYS call get_profile_section(section: "profile", tier: "full") + get_company_context IN PARALLEL on the first application question. DRAFT the answer from what you already know, then ask only for specific missing details. NEVER ask the user to provide information you can fetch.

When the user first enters this mode, respond: "Paste the application question and I'll write your answer."`);

    // Archetype-specific prompt hints
    const archetype = questionArchetype;
    if (archetype === 'motivation') {
      tailParts.push(`\n=== QUESTION TYPE: MOTIVATION ===
This is a "why" question (why this company, why this role, why this career). Draw from the user's profile AND what you know about the company. Be specific — reference their actual experience and something concrete about the company (industry, stage, product, mission). Generic enthusiasm is worse than no answer. Connect the two: why THEIR background + THIS company = a real match.`);
    } else if (archetype === 'behavioral') {
      tailParts.push(`\n=== QUESTION TYPE: BEHAVIORAL ===
This is a "tell me about a time" question. Use a REAL example from the user's experience (via their profile). Structure naturally — situation, action, result — but conversational, not robotic STAR format. Pick the most relevant story. If multiple could work, pick the strongest and note the alternative in a brief aside.`);
    } else if (archetype === 'technical') {
      tailParts.push(`\n=== QUESTION TYPE: TECHNICAL ===
This is a "describe your approach" or technical question. Pull from the user's skills, project experience, and domain expertise. Be specific about tools, methodologies, and outcomes. Show depth without being pedantic.`);
    } else if (archetype === 'freeform') {
      tailParts.push(`\n=== QUESTION TYPE: FREEFORM ===
This is an open-ended question ("anything else?", "what should we know?"). Use this as an opportunity to surface something compelling from the user's profile that hasn't been covered — a unique project, a relevant insight, or genuine enthusiasm for the company. Keep it tight.`);
    }
  }

  if (careerOSChat) {
    tailParts.push(`\n=== MY PROFILE EDITOR MODE ===
You are on the My Profile preferences page. The user can ask you to view, add, or update their structured profile.

You have full visibility into their structured profile fields via get_profile_section(section: "preferences", tier: "full"):
- Attracted To: structured entries with text, category, severity, and keyword triggers
- Dealbreakers: structured entries with text, category, severity (hard/soft), and keyword triggers
- Skill Tags: array of searchable skill labels
- Role ICP: target function (array), seniority, scope, selling motion, team size preference
- Company ICP: stage (array), size range (array), industry preferences (array), culture markers
- Interview Learnings: text + source company + date

When the user asks to ADD or UPDATE profile data, respond with your explanation AND a code fence containing the structured update:

\`\`\`career-os-update
{"action":"add","target":"dealbreakers","data":{"text":"Companies that glorify grit culture","category":"culture","severity":"hard","keywords":["grit","hustle","grind"]}}
\`\`\`

Valid targets: attractedTo, dealbreakers, skillTags, roleICP, companyICP, learnings
Valid actions: add

For skillTags, data is a string array: {"action":"add","target":"skillTags","data":["Salesforce","HubSpot"]}
For ICP updates, data is a partial object to merge: {"action":"add","target":"roleICP","data":{"seniority":"VP","targetFunction":["GTM","Sales"]}}
Note: targetFunction, stage, sizeRange, and industryPreferences are arrays of strings.

When asked "what are my dealbreakers?" or similar, call get_profile_section then read back the structured data clearly.
Always suggest relevant keywords when adding entries — keywords enable deterministic matching during job scoring.

You can also change system settings when asked. Use a \`\`\`settings-update code fence:

\`\`\`settings-update
{"action":"update","setting":"chatModel","value":"claude-haiku-4-5-20251001","label":"Claude Haiku"}
\`\`\`

Valid settings:
- chatModel: the default model for Coop chat (e.g. "gpt-4.1-mini", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250514")
- scoringModel: model used for job scoring
- researchModel: model used for company research

When the user asks to switch models, change defaults, or adjust settings, respond with the settings-update block AND a brief confirmation of what will change and the cost impact.`);
  }

  // Entry update proposals and task creation — always available on bound chats
  if (!isGlobalChat && !careerOSChat) {
    tailParts.push(`\n=== ENTRY UPDATE PROPOSALS ===
When the user asks you to update, change, or fix data about this company/opportunity, respond with your explanation AND a code fence containing the update:

\`\`\`entry-update
{"field":"status","value":"interviewing","label":"Move to Interviewing"}
\`\`\`

You can propose multiple updates in one response — use a separate code fence for each.

Valid fields and example values:
- status: "watching", "applied", "interviewing", "offer", "rejected", "passed", "closed"
- jobTitle: any string (the role title)
- jobStage: "interested", "applied", "phone-screen", "interview", "final-round", "offer", "rejected"
- rating: 1-5 (integer)
- tags: ["tag1", "tag2"] (replaces all tags)
- addTags: ["new-tag"] (appends without removing existing)
- removeTags: ["old-tag"] (removes specific tags)
- notes: "text to append" (appends to existing notes, does NOT replace)
- companyWebsite: URL string
- companyLinkedin: URL string

Always include a "label" field with a short human-readable description of the change.
Only propose changes when the user explicitly asks. Don't proactively suggest updates unless something is clearly wrong or missing.`);
  }

  tailParts.push(`\n=== TASK CREATION ===
When the user asks you to create a task, reminder, or to-do, respond with your confirmation AND a code fence:

\`\`\`create-task
{"text":"Follow up with Sarah about the interview","company":"Amagi","dueDate":"2026-04-05","priority":"normal","label":"Task: Follow up with Sarah"}
\`\`\`

Fields:
- text (required): what needs to be done
- company (optional): company name if task is related to one
- dueDate (optional): YYYY-MM-DD format. If the user says "tomorrow", calculate the date. If not specified, use today.
- priority (optional): "low", "normal" (default), or "high"
- label (required): short human-readable description for the proposal card

You can create multiple tasks in one response with separate code fences.
When the user says things like "remind me to", "don't forget to", "I need to", "add a task", "todo" — create a task.`);

  const bindingLine = isGlobalChat
    ? `\n=== CURRENT BINDING ===\nGlobal pipeline chat. No company is bound. All tool calls that take company_name MUST include it explicitly.`
    : `\n=== CURRENT BINDING ===\nThis chat is bound to: ${boundCompany || '(unknown)'}\nTool calls that take company_name can omit it — it will auto-resolve to this entry.`;
  tailParts.push(bindingLine);

  const tail = tailParts.join('\n');
  return { base, tail };
}

// ── Missed-tool nudge helper ─────────────────────────────────────────────────
// Detects when a model narrates that it will fetch data (or claims it has none)
// without actually calling any tools — a known failure mode where the model
// returns a text-only turn instead of emitting tool_use blocks.
const _FAKE_FETCH_RE = /give me a moment|let me (?:check|look|fetch|pull|grab|search|find)|i'?ll (?:check|look|fetch|pull|grab|search|find)|one (?:moment|sec(?:ond)?)|hold on while i|stand by/i;
const _DATA_DENIAL_RE = /don'?t have (?:any |recent )?(?:emails?|meetings?|notes|transcripts?)|no (?:emails?|meetings?|notes|transcripts?) (?:for|on|from)|i don'?t see any (?:emails?|meetings?|notes|transcripts?)/i;

function _shouldNudgeForMissedTool(responseText, toolCallLog) {
  if (toolCallLog.length > 0) return null; // tools already ran this message — no nudge
  if (_FAKE_FETCH_RE.test(responseText)) return 'fake-fetch';
  if (_DATA_DENIAL_RE.test(responseText)) return 'data-denial';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// G2 Tool-Use Handler (Haiku + tool loop)
// ═══════════════════════════════════════════════════════════════════════════

async function handleCoopMessageToolUse({ messages, context, globalChat, chatModel, careerOSChat }) {
  if (!messages || !Array.isArray(messages)) {
    console.error('[Coop][ToolUse] messages is missing or not an array');
    return { reply: 'Chat error: no messages provided.', error: 'No messages' };
  }
  context = context || {};
  const today = new Date();
  const todayStr = context.todayDate || today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const boundCompany = context.company || null;
  const boundEntryId = context.entryId || null;
  const isGlobalChat = !!globalChat || !boundCompany;
  const applicationMode = !!(context._applicationMode && state.coopConfig.automations?.applicationModeDetection !== false);

  // Model selection: resolve effective model early so we can size the system prompt.
  const model = chatModel || getModelForTask('chat');
  const isOpenAI = model.startsWith('gpt-');
  if (isOpenAI && !state.OPENAI_KEY) {
    console.warn(`[Coop][ToolUse] OpenAI key missing for ${model}, falling back to Haiku`);
  }
  const effectiveModel = (isOpenAI && !state.OPENAI_KEY) ? 'claude-haiku-4-5-20251001'
    : (!isOpenAI && !state.ANTHROPIC_KEY && state.OPENAI_KEY) ? 'gpt-4.1-mini'
    : model;
  const useOpenAI = effectiveModel.startsWith('gpt-');
  const isHaiku = effectiveModel.includes('haiku');

  // Profile embedding strategy:
  // - Haiku: embed full standard-tier profile + prefs (~3k tokens) to exceed
  //   Haiku 4.5's 4096-token prompt cache minimum.
  // - All other models (GPT-nano, Sonnet, etc.): embed a compact manifest
  //   (~150 tokens) listing available sections. The model uses get_profile_section
  //   to load specific sections on demand, saving ~2850 tokens per message.
  let profileSummary, embeddedDocs;
  const { voiceProfile } = await new Promise(r =>
    chrome.storage.local.get(['voiceProfile'], r));

  if (isHaiku) {
    const { coopProfileStandard, coopPrefsStandard } = await new Promise(r =>
      chrome.storage.local.get(['coopProfileStandard', 'coopPrefsStandard'], r));
    profileSummary = [coopProfileStandard, coopPrefsStandard].filter(Boolean).join('\n\n');
    embeddedDocs = ['profile', 'preferences'];
  } else {
    profileSummary = await buildProfileManifestString();
    embeddedDocs = ['manifest'];
  }

  const system = _buildSlimCoopSystemPrompt({ boundCompany, isGlobalChat, todayStr, profileSummary, applicationMode, questionArchetype: context._questionArchetype, careerOSChat: !!careerOSChat, voiceProfile });
  const toolCtx = { boundCompany, boundEntryId };

  const _approxTokens = (s) => Math.round(s.length / 4);
  console.log(`[Coop][ToolUse] model=${effectiveModel} (requested=${model}) provider=${useOpenAI ? 'openai' : 'anthropic'} embed=${isHaiku ? 'standard' : 'manifest'}`);
  console.log(`[Coop][ToolUse] prompt base ~${_approxTokens(system.base)} tok | tail ~${_approxTokens(system.tail)} tok`);

  let conversation = messages.slice();

  // Screenshot injection — attach pending screenshot to the last user message
  const screenshotFlag = context._hasScreenshot || context.hasScreenshot;
  const screenshotData = state._pendingScreenshot || context._screenshotData || null;
  if (screenshotFlag && screenshotData) {
    state._pendingScreenshot = null;
    for (let i = conversation.length - 1; i >= 0; i--) {
      if (conversation[i].role === 'user') {
        const textContent = typeof conversation[i].content === 'string' ? conversation[i].content : String(conversation[i].content);
        conversation[i] = {
          role: 'user',
          content: [
            { type: 'text', text: textContent },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotData } }
          ]
        };
        dlog(`[Coop][ToolUse][Screenshot] Injected ${Math.round(screenshotData.length / 1024)}KB into message #${i}`);
        break;
      }
    }
  }

  const totalUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  const toolCallLog = [];
  let finalReply = null;

  let nudgedOnce = false; // guard: fire the missed-tool nudge at most once per message

  for (let step = 0; step < 5; step++) {
    let data, res;

    if (useOpenAI) {
      // OpenAI tool-use path
      const oaiMessages = [{ role: 'system', content: system.base + '\n' + system.tail }];
      for (const m of conversation) {
        if (m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result') {
          // Convert Claude tool_result format to OpenAI tool messages
          for (const tr of m.content) {
            oaiMessages.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
          }
        } else if (m.role === 'assistant' && Array.isArray(m.content)) {
          // Convert Claude assistant content blocks to OpenAI format
          const textParts = m.content.filter(b => b.type === 'text').map(b => b.text).join('');
          const toolCalls = m.content.filter(b => b.type === 'tool_use').map(b => ({
            id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) }
          }));
          const oaiMsg = { role: 'assistant' };
          if (textParts) oaiMsg.content = textParts;
          if (toolCalls.length) oaiMsg.tool_calls = toolCalls;
          oaiMessages.push(oaiMsg);
        } else if (Array.isArray(m.content)) {
          // User message with image blocks
          const oaiContent = m.content.map(block => {
            if (block.type === 'image' && block.source?.type === 'base64') {
              return { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
            }
            return block;
          });
          oaiMessages.push({ role: m.role, content: oaiContent });
        } else {
          oaiMessages.push(m);
        }
      }
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.OPENAI_KEY}` },
        body: JSON.stringify({ model: effectiveModel, messages: oaiMessages, max_tokens: 2048, tools: COOP_TOOLS_OPENAI }),
      });
      trackApiCall('openai', res.clone(), effectiveModel, 'chat', boundCompany || (globalChat ? 'global' : undefined));
      if (!res || !res.ok) {
        const errText = res ? await res.text().catch(() => '') : 'no response';
        console.error('[Coop][ToolUse] OpenAI API error:', res?.status, errText.slice(0, 300));
        return { error: `Tool-use API error (${res?.status || 'no response'})`, routed: 'tool-use' };
      }
      data = await res.json();
      const u = data.usage || {};
      totalUsage.input  += u.prompt_tokens     || 0;
      totalUsage.output += u.completion_tokens  || 0;

      const choice = data.choices?.[0];
      const finish = choice?.finish_reason;
      console.log(`[Coop][ToolUse] step ${step} stop=${finish} in=${u.prompt_tokens||0} out=${u.completion_tokens||0} (OpenAI)`);

      if (finish === 'tool_calls' && choice.message?.tool_calls?.length) {
        // Convert OpenAI tool_calls to Claude format for internal conversation tracking
        const claudeBlocks = [];
        if (choice.message.content) claudeBlocks.push({ type: 'text', text: choice.message.content });
        for (const tc of choice.message.tool_calls) {
          claudeBlocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') });
        }
        conversation.push({ role: 'assistant', content: claudeBlocks });

        const results = [];
        for (const tc of choice.message.tool_calls) {
          const input = JSON.parse(tc.function.arguments || '{}');
          const toolResult = await runCoopTool(tc.function.name, input, toolCtx);
          const serialized = serializeToolResult(toolResult);
          toolCallLog.push({ name: tc.function.name, input, resultPreview: serialized.slice(0, 200), _meta: toolResult?._meta || null });
          console.log(`[Coop][ToolUse]   → ${tc.function.name}(${JSON.stringify(input).slice(0, 120)}) → ${serialized.length} chars`);
          results.push({ type: 'tool_result', tool_use_id: tc.id, content: serialized });
        }
        conversation.push({ role: 'user', content: results });
        continue;
      }

      const oaiReplyText = choice?.message?.content || '';
      const nudgeReason = !nudgedOnce ? _shouldNudgeForMissedTool(oaiReplyText, toolCallLog) : null;
      if (nudgeReason) {
        nudgedOnce = true;
        console.log('[Coop][ToolUse] nudge fired:', nudgeReason);
        // Preserve the model's narration turn in the conversation, then inject a corrective user turn
        conversation.push({ role: 'assistant', content: oaiReplyText });
        conversation.push({ role: 'user', content: "You said you would fetch or that you don't have data, but you didn't call any tools. Call the relevant tool now (`get_communications` for emails/meetings, `get_company_context` for company facts, `get_profile_section` for user background) before answering. Do not narrate — just call the tool." });
        continue;
      }
      finalReply = oaiReplyText;
      break;

    } else {
      // Claude tool-use path (with prompt caching)
      res = await claudeApiCall({
        model: effectiveModel,
        max_tokens: 2048,
        system: [
          { type: 'text', text: system.base, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: system.tail, cache_control: { type: 'ephemeral' } },
        ],
        messages: conversation,
        tools: COOP_TOOLS,
      }, 3, 'chat', boundCompany || (globalChat ? 'global' : undefined));
      if (!res || !res.ok) {
        const errText = res ? await res.text().catch(() => '') : 'no response';
        console.error('[Coop][ToolUse] API error:', res?.status, errText.slice(0, 300));
        return { error: `Tool-use API error (${res?.status || 'no response'})`, routed: 'tool-use' };
      }
      data = await res.json();
      const u = data.usage || {};
      totalUsage.input         += u.input_tokens                || 0;
      totalUsage.output        += u.output_tokens               || 0;
      totalUsage.cacheCreation += u.cache_creation_input_tokens || 0;
      totalUsage.cacheRead     += u.cache_read_input_tokens     || 0;

      console.log(`[Coop][ToolUse] step ${step} stop=${data.stop_reason} in=${u.input_tokens||0} out=${u.output_tokens||0} cacheW=${u.cache_creation_input_tokens||0} cacheR=${u.cache_read_input_tokens||0}`);

      if (data.stop_reason === 'tool_use') {
        conversation.push({ role: 'assistant', content: data.content });
        const results = [];
        for (const block of (data.content || [])) {
          if (block.type !== 'tool_use') continue;
          const toolResult = await runCoopTool(block.name, block.input, toolCtx);
          const serialized = serializeToolResult(toolResult);
          toolCallLog.push({ name: block.name, input: block.input, resultPreview: serialized.slice(0, 200), _meta: toolResult?._meta || null });
          console.log(`[Coop][ToolUse]   → ${block.name}(${JSON.stringify(block.input).slice(0, 120)}) → ${serialized.length} chars`);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: serialized });
        }
        conversation.push({ role: 'user', content: results });
        continue;
      }

      // end_turn, stop_sequence, max_tokens, etc.
      const claudeReplyText = (data.content || []).find(b => b.type === 'text')?.text || '';
      const claudeNudgeReason = !nudgedOnce ? _shouldNudgeForMissedTool(claudeReplyText, toolCallLog) : null;
      if (claudeNudgeReason) {
        nudgedOnce = true;
        console.log('[Coop][ToolUse] nudge fired:', claudeNudgeReason);
        // Preserve the model's narration turn in the conversation, then inject a corrective user turn
        conversation.push({ role: 'assistant', content: data.content });
        conversation.push({ role: 'user', content: "You said you would fetch or that you don't have data, but you didn't call any tools. Call the relevant tool now (`get_communications` for emails/meetings, `get_company_context` for company facts, `get_profile_section` for user background) before answering. Do not narrate — just call the tool." });
        continue;
      }
      finalReply = claudeReplyText;
      break;
    }
  }

  if (finalReply === null) {
    finalReply = "I reached the tool-call limit while gathering context. Let me know what specifically you need and I'll try again.";
  }

  // Blocking insight extraction for memory triggers ("remember this", "from now on", etc.)
  const lastUserMsg = conversation[0] ? (messages[messages.length - 1]?.content || '') : '';
  const lastUserText = typeof lastUserMsg === 'string' ? lastUserMsg : (Array.isArray(lastUserMsg) ? (lastUserMsg.find(b => b.type === 'text')?.text || '') : '');
  const hasTrigger = /remember this|remember that|don't forget|from now on|always\s+(?:lead|start|use|mention|include)|never\s+(?:say|mention|use|include)|update my profile|add this to/i.test(lastUserText);
  if (hasTrigger) {
    const source = isGlobalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
    await _doBlockingInsightExtraction(lastUserText, finalReply, source);
  }

  // Build context manifest from tool call metadata
  // embeddedDocs is set above (either ['profile','preferences'] for Haiku or ['manifest'] for others)
  const contextManifest = _buildContextManifest(toolCallLog, embeddedDocs);

  return {
    reply: finalReply,
    model: effectiveModel,
    usage: totalUsage,
    toolCalls: toolCallLog,
    contextManifest,
    routed: 'tool-use',
  };
}

// ── Context Manifest Builder ─────────────────────────────────────────────────

const _TOOL_LABELS = {
  get_company_context: 'Company Context',
  get_communications: 'Communications',
  get_profile_section: 'Your Profile',
  get_pipeline_overview: 'Pipeline Overview',
  search_memory: 'Memory Search',
  get_memory_narrative: 'Memory Narrative',
  fetch_url: 'Web Page',
  update_coop_setting: 'Settings',
};

function _buildContextManifest(toolCallLog, embeddedDocs) {
  const hasToolCalls = toolCallLog.length > 0;
  const hasEmbedded = embeddedDocs && embeddedDocs.length > 0;
  if (!hasToolCalls && !hasEmbedded) return null;

  const sourceCount = { emails: 0, meetings: 0, profiles: 0, companies: 0, memories: 0, pipeline: 0 };
  const tools = [];

  // Add synthetic entries for always-embedded docs (profile/prefs in system prompt)
  if (hasEmbedded) {
    sourceCount.profiles++;
    const isManifest = embeddedDocs.includes('manifest');
    tools.push({
      name: '_embedded',
      label: isManifest ? 'Profile Manifest' : 'Your Profile',
      target: null,
      meta: {
        type: 'profile', section: 'embedded',
        tier: isManifest ? 'manifest' : 'standard',
        embedded: true,
        loadedSections: isManifest ? ['section index (~150 tok)'] : embeddedDocs,
      },
    });
  }

  for (const t of toolCallLog) {
    const meta = t._meta || {};
    let label = _TOOL_LABELS[t.name] || t.name;

    // For profile tool calls, use a more specific label based on what was loaded
    if (t.name === 'get_profile_section' && meta.type === 'profile') {
      if (meta.section === 'granular' && meta.loadedSections?.length) {
        label = 'Your Preferences';
      } else if (meta.section === 'preferences') {
        label = 'Your Preferences';
      } else if (meta.section === 'learnings') {
        label = 'Your Learnings';
      }
    }

    const target = meta.company || t.input?.company_name || null;

    tools.push({ name: t.name, label, target, meta });

    // Aggregate source counts
    if (meta.type === 'company') sourceCount.companies++;
    if (meta.type === 'communications') {
      sourceCount.emails += meta.emailCount || 0;
      sourceCount.meetings += meta.meetingCount || 0;
    }
    if (meta.type === 'profile' || meta.type === 'learnings') sourceCount.profiles++;
    if (meta.type === 'memory') sourceCount.memories += meta.matchCount || 0;
    if (meta.type === 'narrative') sourceCount.memories++;
    if (meta.type === 'pipeline') sourceCount.pipeline++;
  }

  // Build human-readable summary
  const parts = [];
  if (sourceCount.companies) parts.push('company profile');
  if (sourceCount.emails) parts.push(`${sourceCount.emails} email${sourceCount.emails > 1 ? 's' : ''}`);
  if (sourceCount.meetings) parts.push(`${sourceCount.meetings} meeting${sourceCount.meetings > 1 ? 's' : ''}`);
  if (sourceCount.profiles) parts.push('your profile');
  if (sourceCount.pipeline) parts.push('pipeline overview');
  if (sourceCount.memories) parts.push('memory');

  return {
    summary: parts.join(', ') || 'no context loaded',
    tools,
    sourceCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unified Coop Chat Handler (all surfaces)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleCoopMessage({ messages, context, globalChat, pipeline, enrichments, chatModel, careerOSChat }) {
  try {
    return await handleCoopMessageToolUse({ messages, context, globalChat, chatModel, careerOSChat });
  } catch (err) {
    console.error('[Coop] fatal error:', err);
    return { error: err.message || 'Chat failed unexpectedly' };
  }
}

/* Legacy chat path removed — all chat routes through handleCoopMessageToolUse */

// ── Thin wrappers for backward-compatible message routing ─────────────────

export async function handleChatMessage({ messages, context, chatModel }) {
  return handleCoopMessage({ messages, context, globalChat: false, chatModel });
}

export async function handleGlobalChatMessage({ messages, pipeline, enrichments, chatModel }) {
  return handleCoopMessage({ messages, context: {}, globalChat: true, pipeline, enrichments, chatModel });
}

// ── Coop Assist Rewrite ───────────────────────────────────────────────────────
export async function handleCoopAssistRewrite(message) {
  const { text, mode, pageContext } = message;
  if (!text || text.trim().length < 10) return { error: 'Text too short' };

  const { voiceProfile, coopProfileSummary, prefs } = await new Promise(r => {
    chrome.storage.local.get(['voiceProfile', 'coopProfileSummary'], local => {
      chrome.storage.sync.get(['prefs'], sync => r({ ...local, ...sync }));
    });
  });
  const userName = (prefs && (prefs.name || prefs.fullName)) || getUserName('the user');
  const profileBlurb = coopProfileSummary || '';
  const antiPhrases = (voiceProfile && voiceProfile.antiPhrases && voiceProfile.antiPhrases.length)
    ? voiceProfile.antiPhrases
    : ['i hope this email finds you well', 'i wanted to reach out', 'circle back', 'kindly', 'leverage'];
  const maxExcl = (voiceProfile && Number.isFinite(voiceProfile.maxExclamations)) ? voiceProfile.maxExclamations : 1;
  const modeInstr = ({
    'voice':   'Rewrite this so it sounds authentically like the user — direct, specific, no corporate filler. Keep length similar.',
    'tighten': 'Tighten this. Cut filler, keep meaning. Aim ~30% shorter.',
    'punchy':  'Make this punchier. Stronger verbs, shorter sentences. Keep the user\'s voice.',
    'warm':    'Keep the same content but warm the tone — friendlier without being saccharine.',
  })[mode] || 'Rewrite this in the user\'s voice.';

  const system = `You are Coop, a writing assistant helping ${userName} rewrite text in their authentic voice.

VOICE RULES:
- Direct, specific, no corporate filler.
- Avoid these phrases entirely: ${antiPhrases.slice(0, 12).join('; ')}.
- Max ${maxExcl} exclamation point${maxExcl !== 1 ? 's' : ''} in the whole reply.
- Sign-offs (only if a sign-off is present in the original): "—${userName}" or just "${userName}".
- Never invent facts not in the original text.
- ALWAYS return a rewritten version, even if the input is short, informal, or nonsensical. Never refuse, never ask for clarification, never explain — just rewrite.
${profileBlurb ? '\nABOUT THE USER:\n' + profileBlurb.slice(0, 600) : ''}
${pageContext ? '\nCONTEXT (where they\'re writing):\n' + pageContext.slice(0, 300) : ''}

OUTPUT: Return ONLY the rewritten text. No preamble, no explanation, no quotes around it.`;

  const userMsg = `${modeInstr}\n\nORIGINAL:\n${text}`;
  const result = await chatWithFallback({
    model: 'claude-haiku-4-5-20251001',
    system,
    messages: [{ role: 'user', content: userMsg }],
    max_tokens: 800,
    tag: 'CoopAssist-Rewrite',
    opTag: 'rewrite',
  });
  if (result.error) return { error: result.error };
  let rewrite = (result.reply || '').trim();
  if ((rewrite.startsWith('"') && rewrite.endsWith('"')) || (rewrite.startsWith('\u201c') && rewrite.endsWith('\u201d'))) {
    rewrite = rewrite.slice(1, -1).trim();
  }
  return { rewrite, modelUsed: result.modelUsed };
}
