// coop-chat.js — Unified Coop chat handler, tool-use loop, tiered routing.
// Handles all 4 message types: CHAT_MESSAGE, GLOBAL_CHAT_MESSAGE, COOP_CHAT, COOP_MESSAGE.

import { state } from './bg-state.js';
import { dlog, getUserName, truncateToTokenBudget, buildIdentityPrompt, coopInterp } from './utils.js';
import { claudeApiCall, chatWithFallback, getModelForTask, trackApiCall } from './api.js';
import { applyCoopMemoryActions } from './memory.js';
import { buildCoopPipelineSummary, detectContextIntent, buildCrossCompanyMeetings, buildCrossCompanyEmails, buildCrossCompanyContacts } from './coop-context.js';
import { COOP_TOOLS, COOP_TOOLS_OPENAI, runCoopTool, serializeToolResult } from './coop-tools.js';

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
function _buildSlimCoopSystemPrompt({ boundCompany, isGlobalChat, todayStr, profileSummary, applicationMode, careerOSChat, voiceProfile }) {
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
    const archetype = context._questionArchetype;
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

  // Fetch compiled standard-tier docs for inline embedding.
  // Haiku 4.5 cache minimum is 4096 tokens — summaries alone (~400 tokens) aren't enough.
  // Standard profile (~700 tokens) + standard prefs (~2300 tokens) push base well above threshold.
  const { coopProfileStandard, coopPrefsStandard, voiceProfile } = await new Promise(r =>
    chrome.storage.local.get(['coopProfileStandard', 'coopPrefsStandard', 'voiceProfile'], r));
  const profileSummary = [coopProfileStandard, coopPrefsStandard].filter(Boolean).join('\n\n');
  const system = _buildSlimCoopSystemPrompt({ boundCompany, isGlobalChat, todayStr, profileSummary, applicationMode, careerOSChat: !!careerOSChat, voiceProfile });
  const toolCtx = { boundCompany, boundEntryId };

  // G2.1 diagnostic: one-shot fingerprint so we can confirm base is (a) above
  // Haiku 4.5's 4096-token cache minimum and (b) byte-identical across steps.
  const _fp = (s) => {
    let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(16);
  };
  const _approxTokens = (s) => Math.round(s.length / 4);
  console.log(`[Coop][ToolUse] prompt base len=${system.base.length} ~tok=${_approxTokens(system.base)} fp=${_fp(system.base)} | tail len=${system.tail.length} ~tok=${_approxTokens(system.tail)} fp=${_fp(system.tail)}`);

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

  // Model selection: respect user's model picker, fall back to configured default
  const model = chatModel || getModelForTask('chat');
  const isOpenAI = model.startsWith('gpt-');

  // Verify we have the right API key for the selected model
  if (isOpenAI && !state.OPENAI_KEY) {
    console.warn(`[Coop][ToolUse] OpenAI key missing for ${model}, falling back to Haiku`);
  }
  const effectiveModel = (isOpenAI && !state.OPENAI_KEY) ? 'claude-haiku-4-5-20251001'
    : (!isOpenAI && !state.ANTHROPIC_KEY && state.OPENAI_KEY) ? 'gpt-4.1-mini'
    : model;
  const useOpenAI = effectiveModel.startsWith('gpt-');
  console.log(`[Coop][ToolUse] model=${effectiveModel} (requested=${model}) provider=${useOpenAI ? 'openai' : 'anthropic'}`);

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

      finalReply = choice?.message?.content || '';
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
      finalReply = (data.content || []).find(b => b.type === 'text')?.text || '';
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
  // Include the always-embedded profile/prefs as a synthetic entry so transparency UI reflects it
  const embeddedDocs = [];
  if (coopProfileStandard) embeddedDocs.push('profile');
  if (coopPrefsStandard) embeddedDocs.push('preferences');
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
    tools.push({
      name: '_embedded',
      label: 'Your Profile',
      target: null,
      meta: { type: 'profile', section: 'embedded', tier: 'standard', embedded: true, loadedSections: embeddedDocs },
    });
  }

  for (const t of toolCallLog) {
    const meta = t._meta || {};
    const label = _TOOL_LABELS[t.name] || t.name;
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
  // G2 tool-use is the ONLY path. All modes (application helper, Career OS editor, company chat,
  // global chat) now route through tool-use. Legacy path below is kept only as fatal-error fallback.
  try {
    return await handleCoopMessageToolUse({ messages, context, globalChat, chatModel, careerOSChat });
  } catch (err) {
    console.error('[Coop][ToolUse] fatal error, falling back to legacy path:', err);
    // Fall through to legacy
  }
  context = context || {};
  const today = new Date();
  const todayStr = context.todayDate ||
    today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const daysAgo = dateStr => {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return null;
    return Math.round((today - d) / 86400000);
  };
  const relTime = dateStr => {
    const n = daysAgo(dateStr);
    if (n === null) return '';
    if (n === 0) return ' (today)';
    if (n === 1) return ' (yesterday)';
    if (n < 7)  return ` (${n} days ago)`;
    if (n < 30) return ` (${Math.round(n/7)} weeks ago)`;
    return ` (${Math.round(n/30)} months ago)`;
  };

  // Layer 1: Coop identity
  const identityPrompt = buildIdentityPrompt(state.coopConfig, {
    globalChat,
    contextType: context.type === 'job' ? 'job opportunity' : 'company',
    userName: getUserName(),
  });

  const _principlesBlock = coopInterp.principlesBlock() +
    (coopInterp.isDraftRequest(messages, context) ? coopInterp.draftHint() : '');

  const _gapToStoryBlock = `\n=== GAP → STORY LOOP ===
When you flag that the user lacks direct experience for something (e.g., "you don't have healthcare account experience", "no direct SaaS CFO exposure"), DO NOT stop there. End your response with a short, specific invitation like:
"Do you have a story here I should know about? If you've done something adjacent — share it in a sentence or two and I'll remember it for next time."
Then, when the user shares a story in response, acknowledge it concretely ("Got it — adding this: [1-line paraphrase]") so they know it was captured. Your passive memory extractor will save it automatically; your job is just to invite the story and confirm the capture. Skip the invitation only if the user has explicitly told you to stop asking, or if the gap is so minor it's not worth a story.`;

  const systemParts = [identityPrompt, `\n=== TODAY ===\n${todayStr}`, _principlesBlock, _gapToStoryBlock,
    `\nCRITICAL RULE: You have the user's FULL profile loaded in your context — their story, experience, accomplishments, skills, resume, preferences, and everything they've told you. ALWAYS use this data first. When helping with applications, DRAFT an answer from what you already know, then ask only for specific missing details. NEVER ask the user to provide information that's already in your context. If they ask you to write something about their background, write it immediately using what you have.`];

  // Layer 2: Application helper mode
  if (context._applicationMode && state.coopConfig.automations?.applicationModeDetection !== false) {
    const _vp = await new Promise(r => chrome.storage.local.get(['voiceProfile'], d => r(d.voiceProfile || {})));
    const _toneMap = { conversational: 'Conversational, confident, specific. Sound like a smart person talking.', professional: 'Professional but human. Clear and polished without being stiff.', direct: 'Direct and concise. No softening, no hedging. Say exactly what you mean.' };
    const _lengthMap = { brief: '1-2 sentences', standard: '2-5 sentences', detailed: '5-8 sentences' };
    const _toneInstr = _toneMap[_vp.tone] || _toneMap.conversational;
    const _lengthInstr = _lengthMap[_vp.defaultLength] || _lengthMap.standard;
    const _anti = (_vp.antiPhrases || []).slice(0, 15);
    const _maxEx = Number.isFinite(_vp.maxExclamations) ? _vp.maxExclamations : 1;
    const _signoffs = (_vp.preferredSignoffs || []).filter(Boolean);
    let _voiceBlock = `VOICE & TONE:\n- Write as the user in first person. ${_toneInstr}\n- Not an AI writing — no dramatic framing, no buzzword stacking, no filler.\n- NEVER wrap the answer in quotation marks.`;
    if (_anti.length) _voiceBlock += `\n- AVOID these phrases entirely: ${_anti.join('; ')}.`;
    _voiceBlock += _maxEx === 0 ? `\n- No exclamation points.` : `\n- Max ${_maxEx} exclamation point${_maxEx > 1 ? 's' : ''} per answer.`;
    if (_signoffs.length) _voiceBlock += `\n- Preferred sign-offs: ${_signoffs.join(', ')}.`;
    systemParts.push(`\n=== APPLICATION HELPER MODE ===\nSITUATION: The user is filling out a job application form. They need short, authentic answers for application text box fields — not cover letters, not essays, not LinkedIn posts.\n\n${_voiceBlock}\n\nLENGTH: ${_lengthInstr} unless the user specifies otherwise.\n\nOUTPUT FORMAT:\n- Give ONE clean answer the user can copy-paste directly.\n- No preamble, no alternatives unless asked, no commentary after.\n- NEVER wrap in quotation marks.\n\nWhen the user first enters this mode, respond: "Paste the application question and I'll write your answer."`);
    // Archetype-specific hints (legacy path)
    const _arch = context._questionArchetype;
    if (_arch === 'motivation') systemParts.push(`\n=== QUESTION TYPE: MOTIVATION ===\nThis is a "why" question. Draw from the user's profile AND what you know about the company. Be specific — reference their actual experience and something concrete about the company. Connect the two.`);
    else if (_arch === 'behavioral') systemParts.push(`\n=== QUESTION TYPE: BEHAVIORAL ===\nThis is a "tell me about a time" question. Use a REAL example from the user's experience. Structure naturally — situation, action, result — but conversational, not robotic.`);
    else if (_arch === 'technical') systemParts.push(`\n=== QUESTION TYPE: TECHNICAL ===\nDescribe your approach / technical question. Pull from the user's skills and project experience. Be specific about tools and outcomes.`);
    else if (_arch === 'freeform') systemParts.push(`\n=== QUESTION TYPE: FREEFORM ===\nOpen-ended "anything else?" question. Surface something compelling from the user's profile that hasn't been covered. Keep it tight.`);
  }

  // Layer 2b: My Profile editor mode
  if (careerOSChat) {
    systemParts.push(`\n=== MY PROFILE EDITOR MODE ===
You are on the My Profile preferences page. The user can ask you to view, add, or update their structured profile.

You have full visibility into their structured profile fields:
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

When asked "what are my dealbreakers?" or similar, read back the structured data clearly.
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

  // Layer 3: Profile context (compiled .md — same source of truth as G2 tool-use path)
  const { coopProfileFull, coopPrefsFull } = await new Promise(r =>
    chrome.storage.local.get(['coopProfileFull', 'coopPrefsFull'], r));
  const profileContext = [coopProfileFull, coopPrefsFull].filter(Boolean).join('\n\n');
  if (profileContext) {
    systemParts.push(profileContext);
  } else {
    console.warn('[Coop Chat] WARNING: Compiled profile is empty — run profile compiler or fill in My Profile sections');
  }

  // Layer 4: Pipeline summary
  let pipelineEntries = [];
  if (pipeline) {
    systemParts.push(pipeline);
  } else {
    const pipelineResult = await buildCoopPipelineSummary();
    if (pipelineResult.summary) systemParts.push(pipelineResult.summary);
    pipelineEntries = pipelineResult.entries || [];
  }

  // Intent detection for cross-company context (global/careerOS chats only)
  const _earlyLastUserMsg = messages[messages.length - 1]?.content || '';
  const contextIntent = (globalChat || careerOSChat) && pipelineEntries.length
    ? detectContextIntent(_earlyLastUserMsg, pipelineEntries)
    : { modules: new Set(), mentionedCompanies: [], needsCrossCompany: false };

  // Layer 5: Deep company context (when on a company page)
  if (!globalChat && context.company) {
    const overview = [`\n=== CURRENT COMPANY / OPPORTUNITY ===`];
    if (context.company)   overview.push(`Company: ${context.company}`);
    if (context.jobTitle)  overview.push(`Role: ${context.jobTitle}`);
    if (context.status)    overview.push(`Pipeline stage: ${context.status}`);
    if (context.employees) overview.push(`Size: ${context.employees}`);
    if (context.funding)   overview.push(`Funding: ${context.funding}`);
    if (context.tags?.length) overview.push(`Tags: ${context.tags.join(', ')}`);
    if (context.notesFeed?.length) {
      const noteLines = context.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => {
        const d = new Date(n.createdAt);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const text = (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return `[${dateStr}] ${text}`;
      }).join('\n');
      overview.push(`User notes:\n${noteLines}`);
    } else if (context.notes) {
      overview.push(`User notes: ${(context.notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    }
    systemParts.push(overview.join('\n'));

    if (context.intelligence?.eli5 || context.intelligence?.whosBuyingIt || context.intelligence?.howItWorks) {
      const intel = [`\n=== COMPANY INTELLIGENCE ===`];
      if (context.intelligence.eli5)         intel.push(`What they do: ${context.intelligence.eli5}`);
      if (context.intelligence.whosBuyingIt) intel.push(`Who buys it: ${context.intelligence.whosBuyingIt}`);
      if (context.intelligence.howItWorks)   intel.push(`How it works: ${context.intelligence.howItWorks}`);
      systemParts.push(intel.join('\n'));
    }
    if (context.leaders?.length) systemParts.push(`\n=== LEADERSHIP ===\n${context.leaders.map(l => `- ${l.name} — ${l.title || 'unknown'}`).join('\n')}`);
    if (context.knownContacts?.length) {
      systemParts.push(`\n=== KNOWN CONTACTS AT ${(context.company || '').toUpperCase()} ===\n${context.knownContacts.map(c => `- ${[c.name, c.title, c.email ? `<${c.email}>` : ''].filter(Boolean).join(' | ')}`).join('\n')}`);
    }
    if (context.roleBrief) {
      const briefStr = typeof context.roleBrief === 'string' ? context.roleBrief : JSON.stringify(context.roleBrief);
      systemParts.push(`\n=== ROLE BRIEF (AI-synthesized understanding) ===\n${briefStr.slice(0, 4000)}`);
    }
    if (context.jobDescription || context.jobMatch) {
      const job = [`\n=== JOB DETAILS ===`];
      if (context.jobDescription) job.push(`Full job description:\n${context.jobDescription.slice(0, 5000)}`);
      if (context.jobMatch?.verdict)           job.push(`Match verdict: ${context.jobMatch.verdict}`);
      if (context.jobMatch?.score)             job.push(`Match score: ${context.jobMatch.score}/10`);
      if (context.jobMatch?.strongFits?.length) job.push(`Strong fits: ${context.jobMatch.strongFits.map(f => typeof f === 'string' ? f : f?.text || '').join('; ')}`);
      if (context.jobMatch?.redFlags?.length)   job.push(`Red flags: ${context.jobMatch.redFlags.map(f => typeof f === 'string' ? f : f?.text || '').join('; ')}`);
      if (context.matchFeedback) {
        const fb = context.matchFeedback;
        job.push(`User feedback on match: ${fb.type === 'up' ? '👍 Agreed' : '👎 Disagreed'}${fb.note ? ` — "${fb.note}"` : ''}`);
      }
      systemParts.push(job.join('\n'));
    }
    if (context.reviews?.length) systemParts.push(`\n=== EMPLOYEE REVIEWS ===\n${context.reviews.slice(0, 4).map(r => `- "${r.snippet}" (${r.source || ''})`).join('\n')}`);
    if (context.emails?.length) {
      const wantsDeepEmail = !!context._manualBind ||
        /\b(email|thread|correspondence|reply|sent|wrote|said|draft)\b/i.test(_earlyLastUserMsg);
      const snippetCap = wantsDeepEmail ? 1500 : 200;
      const emailLines = context.emails.slice(0, 20).map(e => {
        const lines = [`[${e.date || ''}] "${e.subject}" — ${e.from}`];
        if (e.snippet) lines.push(`  ${e.snippet.slice(0, snippetCap)}`);
        return lines.join('\n');
      }).join('\n');
      systemParts.push(`\n=== EMAIL HISTORY (${context.emails.length} emails${wantsDeepEmail ? ', expanded' : ''}) ===\n${emailLines}`);
    }
    if (context.meetings?.length) {
      const wantsDeepMeeting = !!context._manualBind ||
        /\b(transcript|granola|meeting notes?|call notes?|factor in|what did .* say|conversation with)\b/i.test(_earlyLastUserMsg);
      const FULL_BUDGET = 20000;
      const CAP_BUDGET  = 4000;

      const lowerMsg = (_earlyLastUserMsg || '').toLowerCase();
      const tokens = lowerMsg.match(/[a-z]{3,}/g) || [];
      const stop = new Set(['the','and','for','with','that','this','what','factor','please','about','tell','give','know']);
      const signal = tokens.filter(t => !stop.has(t));
      function scoreMeeting(m) {
        const hay = ((m.title || '') + ' ' + (m.calendarTitle || '') + ' ' + (Array.isArray(m.attendees) ? m.attendees.join(' ') : (m.attendees || m.attendeeNames || ''))).toLowerCase();
        let s = 0;
        for (const t of signal) if (hay.includes(t)) s += (t.length >= 5 ? 2 : 1);
        return s;
      }
      const ranked = context.meetings.map(m => ({ m, score: scoreMeeting(m) })).sort((a, b) => b.score - a.score);
      const topScore = ranked[0]?.score || 0;
      const bestMatchId = topScore > 0 ? ranked[0].m.id : null;

      const mtgLines = context.meetings.map(m => {
        const rel = relTime(m.date);
        const header = `--- Meeting: ${m.title || 'Untitled'} | ${m.date || 'unknown date'}${rel}${m.time ? ' at ' + m.time : ''} ---`;
        let body = '';
        if (m.summaryMarkdown) body += `-- Granola AI Summary --\n${m.summaryMarkdown}\n\n`;
        let transcript = (m.transcript || '');
        const attendeeNames = (m.attendeeNames || m.attendees || '').toString();
        if (attendeeNames) {
          const myName = getUserName('Me');
          const others = attendeeNames.split(/[,;]/).map(n => n.trim()).filter(n => n && !n.toLowerCase().includes(myName.toLowerCase()));
          const otherName = others.length === 1 ? others[0].split(' ')[0] : others.length > 1 ? others.map(n => n.split(' ')[0]).join('/') : 'Other';
          transcript = transcript.replace(/\bmicrophone:/g, myName + ':').replace(/\bspeaker:/g, otherName + ':');
        } else {
          transcript = transcript.replace(/\bmicrophone:/g, getUserName('Me') + ':').replace(/\bspeaker:/g, 'Other:');
        }
        let budget = CAP_BUDGET;
        if (bestMatchId && m.id === bestMatchId) budget = FULL_BUDGET;
        else if (wantsDeepMeeting && context.meetings.length === 1) budget = FULL_BUDGET;
        else if (wantsDeepMeeting) budget = 8000;
        body += transcript.slice(0, budget);
        if (transcript.length > budget) body += `\n… (${transcript.length - budget} more chars truncated)`;
        return `${header}\n${body}`;
      }).join('\n\n');
      const expansionNote = (bestMatchId || wantsDeepMeeting)
        ? ` (expanded: ${bestMatchId ? 'name/title match' : 'deep meeting intent'})`
        : '';
      console.log(`[Chat Prompt] Meetings rendered${expansionNote} | topScore=${topScore} | wantsDeep=${wantsDeepMeeting} | bind=${!!context._manualBind}`);
      systemParts.push(`\n=== MEETING TRANSCRIPTS (${context.meetings.length} meetings)${expansionNote} ===\n${mtgLines}`);
    } else if (context.granolaNote) {
      const blobCap = (context._manualBind || /\b(transcript|granola|meeting|call)\b/i.test(_earlyLastUserMsg)) ? 40000 : 12000;
      systemParts.push(`\n=== MEETING NOTES / TRANSCRIPTS ===\n${context.granolaNote.slice(0, blobCap)}`);
    }
    if (context.manualMeetings?.length) {
      const manualLines = context.manualMeetings.map(m => {
        const rel = relTime(m.date);
        return `--- Meeting (manual): ${m.title || 'Untitled'} | ${m.date || 'unknown'}${rel} ---\n${(m.transcript || m.notes || '(no notes)').slice(0, 4000)}`;
      }).join('\n\n');
      systemParts.push(`\n=== MANUALLY LOGGED MEETINGS (${context.manualMeetings.length}) ===\n${manualLines}`);
    }
    if (context.contextDocuments?.length) {
      let used = 0;
      const docParts = [];
      for (const doc of context.contextDocuments) {
        const tokens = doc.tokenEstimate || Math.ceil(doc.extractedText.length / 4);
        if (used + tokens > 4000) { docParts.push(`\n## Uploaded: ${doc.filename} (truncated)\n${doc.extractedText.slice(0, (4000 - used) * 4)}`); break; }
        docParts.push(`\n## Uploaded: ${doc.filename}\n${doc.extractedText}`);
        used += tokens;
      }
      systemParts.push(`\n=== UPLOADED DOCUMENTS ===\n${docParts.join('\n')}`);
    }
  }

  // Layer 5b: Content-aware cross-company context (global/careerOS chats)
  if (contextIntent.needsCrossCompany && pipelineEntries.length) {
    console.log(`[Coop] Intent detected modules: ${[...contextIntent.modules].join(', ')} | mentioned: ${contextIntent.mentionedCompanies.length} companies`);
    if (contextIntent.modules.has('meetings')) {
      const mtgCtx = buildCrossCompanyMeetings(pipelineEntries, { mentionedCompanies: contextIntent.mentionedCompanies });
      if (mtgCtx) systemParts.push(mtgCtx);
    }
    if (contextIntent.modules.has('emails')) {
      const emailCtx = buildCrossCompanyEmails(pipelineEntries, { mentionedCompanies: contextIntent.mentionedCompanies });
      if (emailCtx) systemParts.push(emailCtx);
    }
    if (contextIntent.modules.has('contacts')) {
      const contactCtx = buildCrossCompanyContacts(pipelineEntries, { mentionedCompanies: contextIntent.mentionedCompanies });
      if (contactCtx) systemParts.push(contactCtx);
    }
  }

  // Layer 6: Entry update proposals (company context only)
  if (!globalChat && !careerOSChat && context.company) {
    systemParts.push(`\n=== ENTRY UPDATE PROPOSALS ===
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

  // Layer 7: Task creation (always available)
  systemParts.push(`\n=== TASK CREATION ===
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

  // Layer 8: On-demand enrichments for mentioned companies (global chat)
  if (enrichments) systemParts.push(enrichments);

  // Send to AI
  const lastUserMsg = messages[messages.length - 1]?.content || '';
  const hasTrigger = /remember this|remember that|don't forget|from now on|always\s+(?:lead|start|use|mention|include)|never\s+(?:say|mention|use|include)|update my profile|add this to/i.test(lastUserMsg);

  // ── Canonical cacheable base ──────────────────────────────────────────────
  const profileLayer = systemParts.find(p => typeof p === 'string' && (p.includes('[Your Story]') || p.includes('[Personal Info]') || p.includes('[Experience')));
  const baseSystem = [
    identityPrompt,
    `\n=== TODAY ===\n${todayStr}`,
    _principlesBlock,
    _gapToStoryBlock,
    `\nCRITICAL RULE: You have the user's FULL profile loaded in your context — their story, experience, accomplishments, skills, resume, preferences, and everything they've told you. ALWAYS use this data first. When helping with applications, DRAFT an answer from what you already know, then ask only for specific missing details. NEVER ask the user to provide information that's already in your context. If they ask you to write something about their background, write it immediately using what you have.`,
    profileLayer || '',
  ].join('\n');

  const TIER2_ESCAPE_HATCH = `\n=== CONTEXT LIMIT ===\nYour context for this message is intentionally slim — you have the user's profile + company overview + job details, but NOT the full company intelligence dump, employee reviews, email history, or meeting transcripts. If the user asks a question that genuinely requires any of that deeper data to answer correctly (e.g. specific funding rounds not in the overview, employee review sentiment, what was said in a specific meeting, what an email thread contained), DO NOT guess or fabricate. Instead respond with exactly this token and nothing else: [[NEEDS_FULL_CONTEXT]]\nThe system will automatically retry with full context. Only use this escape hatch when you genuinely cannot answer — for casual questions, strategy discussion, drafting, or anything the profile+overview is enough for, just answer normally.`;
  const NEEDS_ESCALATION_RE = /\[\[NEEDS_FULL_CONTEXT\]\]/;

  // ── Smart context routing ──────────────────────────────────────────────
  const lowerMsg = lastUserMsg.toLowerCase().trim();
  const userMsgCount = messages.filter(m => m.role === 'user').length;
  const isFirstMessage = userMsgCount === 1;
  const fullSystemText = systemParts.join('\n');
  const fullSize = fullSystemText.length;

  // Tier 1: Simple data entry — Nano + minimal context
  const SIMPLE_CAREER_OS = [
    /^(?:add|create|new)\s+(?:a\s+)?(?:dealbreaker|attracted|skill|tag|learning)/i,
    /^(?:add|remove)\s+tag/i,
    /^(?:switch|change|use|set)\s+(?:to\s+)?(?:model|haiku|sonnet|opus|gpt|nano|mini)/i,
    /^(?:add|append)\s+(?:a\s+)?note/i,
  ];
  const SIMPLE_ENTRY_UPDATE = [
    /^(?:set|change|update|move)\s+(?:status|stage|rating)\s/i,
    /^(?:add|remove)\s+tag/i,
    /^(?:mark|move)\s+(?:as|to)\s+(?:watching|applied|interviewing|offer|rejected|passed|closed)/i,
    /^(?:rate|rating)\s+\d/i,
  ];
  const isSimpleCareerOS = careerOSChat && SIMPLE_CAREER_OS.some(p => p.test(lowerMsg));
  const isSimpleEntry = !globalChat && !careerOSChat && context.company && SIMPLE_ENTRY_UPDATE.some(p => p.test(lowerMsg));

  // ── Screenshot handling ────────────────────────────────────────────────
  let hasImages = false;
  const screenshotFlag = context._hasScreenshot || context.hasScreenshot;
  const screenshotData = state._pendingScreenshot || context._screenshotData || null;
  dlog(`[Screenshot] Flag check: ${screenshotFlag}, port: ${state._pendingScreenshot ? Math.round(state._pendingScreenshot.length/1024)+'KB' : 'null'}, context: ${context._screenshotData ? Math.round(context._screenshotData.length/1024)+'KB' : 'null'}`);
  if (screenshotFlag && screenshotData) {
    const screenshot = screenshotData;
    state._pendingScreenshot = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const textContent = typeof messages[i].content === 'string' ? messages[i].content : String(messages[i].content);
        messages[i] = {
          role: 'user',
          content: [
            { type: 'text', text: textContent },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } }
          ]
        };
        hasImages = true;
        dlog(`[Screenshot] ✅ Injected ${Math.round(screenshot.length / 1024)}KB into message #${i}`);
        break;
      }
    }
  } else if (screenshotFlag && !screenshotData) {
    dlog(`[Screenshot] ❌ Flag set but no screenshot data — port and context fallback both empty`);
  }
  if (hasImages) {
    const visionModels = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'];
    if (!visionModels.some(v => (chatModel || '').includes(v.split('-')[0]))) {
      chatModel = state.ANTHROPIC_KEY ? 'claude-haiku-4-5-20251001' : 'gpt-4.1-mini';
    }
    console.log(`[Coop] Using vision model: ${chatModel}`);
  }

  // ── Screen sharing context ──────────────────────────────────────────────
  if (hasImages) {
    systemParts.push(`\n=== SCREEN SHARING (VISION ACTIVE) ===\nThe user is sharing their screen with you. A screenshot of their current browser tab is attached to their latest message as an image. You CAN see it — describe what you see, answer questions about it, and use the visual context to help them. This is a real screenshot, not a placeholder.`);
  }
  if (context.visiblePageContent) {
    systemParts.push(`\n=== PAGE TEXT FROM USER'S ACTIVE TAB (extracted automatically — you CAN see this) ===\nURL: ${context.currentTabUrl || 'unknown'}\nIMPORTANT: The text below was automatically extracted from the page the user is currently viewing. When the user asks about what's on their screen, refer to this text AND the screenshot (if attached).\n\n${context.visiblePageContent.slice(0, 4000)}`);
  } else if (context.currentTabUrl && (context._hasScreenshot || context.hasScreenshot)) {
    systemParts.push(`\n=== CURRENT TAB ===\nURL: ${context.currentTabUrl}\nTab sharing is active. Use the screenshot to see what's on the page.`);
  }

  if ((isSimpleCareerOS || isSimpleEntry) && !hasImages) {
    const slimParts = [systemParts[0]];
    const profileLayer2 = systemParts.find(p => p.includes('[Your Story]') || p.includes('[Personal Info]') || p.includes('[Experience'));
    if (profileLayer2) slimParts.push(profileLayer2);
    if (isSimpleCareerOS) {
      const layer = systemParts.find(p => p.includes('CAREER OS EDITOR MODE'));
      if (layer) slimParts.push(layer);
    }
    if (isSimpleEntry) {
      const layer = systemParts.find(p => p.includes('ENTRY UPDATE PROPOSALS'));
      if (layer) slimParts.push(layer);
      slimParts.push(`Company: ${context.company}${context.jobTitle ? ' | Role: ' + context.jobTitle : ''}${context.status ? ' | Status: ' + context.status : ''}`);
    }
    const slimSystem = slimParts.join('\n');
    const slimModel = state.OPENAI_KEY ? 'gpt-4.1-nano' : 'claude-haiku-4-5-20251001';
    console.log(`[Coop] ROUTED → Tier 1 (slim) | ${slimModel} | ${slimSystem.length} chars (${Math.round((1 - slimSystem.length/fullSize) * 100)}% saved)`);
    try {
      const result = await chatWithFallback({ model: slimModel, system: slimSystem, messages, max_tokens: 1024, tag: 'Chat-Slim', opTag: 'chat', context: context.company || (globalChat ? 'global' : undefined) });
      if (!result.error) return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'slim' };
    } catch (e) { console.warn('[Coop] Tier 1 failed, escalating:', e.message); }
  }

  // Tier 2: Medium context — follow-ups
  const NEEDS_FULL_CONTEXT = [
    /compare|rank|prioritize|pipeline|all (?:my |the )?(?:companies|opportunities|roles)/i,
    /interview prep|help me prepare|mock interview/i,
    /draft|write|compose|email|message|cover letter|follow.?up/i,
    /what (?:do you|should|would you) (?:think|recommend|suggest)/i,
    /strategy|strategic|game plan|next steps for my search/i,
    /my (?:story|background|experience|resume|profile|preferences|dealbreakers)/i,
    /remember|from now on|always|never/i,
    /apply|application|help me answer|brag|accomplish|achievement|award|recognition|qualification/i,
    /do you know|tell me about|what do you know/i,
    /salesbricks|rep\.ai|navless|tourial|captivate/i,
    /\b(?:best|worst|recent|strongest)\b.*\b(?:conversation|meeting|email|call|interview)\b/i,
    /\b(?:all|across|every)\b.*\b(?:meeting|email|conversation|contact)\b/i,
    /who (?:have i|did i|am i) (?:talk|speak|met|email|contact)/i,
    /\b(?:transcript|granola|meeting notes?|call notes?|factor in)\b/i,
    /\b(?:my\s+(?:conversation|call|meeting|chat|discussion)|what\s+(?:did|we|was)\s+(?:we\s+)?(?:talk|discuss|said|say))/i,
  ];
  const needsFullContext = NEEDS_FULL_CONTEXT.some(p => p.test(lowerMsg)) || contextIntent.needsCrossCompany || !!context._manualBind;
  const isFollowUp = !isFirstMessage && !needsFullContext && !hasImages;

  // Tier 2.5: Vision-optimized
  if (hasImages && !needsFullContext && !context._manualBind) {
    const visionTailParts = [];
    if (!globalChat && context.company) {
      const companyOverview = systemParts.find(p => typeof p === 'string' && p.includes('CURRENT COMPANY / OPPORTUNITY'));
      if (companyOverview) visionTailParts.push(companyOverview);
      const intelSection = systemParts.find(p => typeof p === 'string' && p.includes('COMPANY INTELLIGENCE'));
      if (intelSection) visionTailParts.push(intelSection);
      const jobSection = systemParts.find(p => typeof p === 'string' && p.includes('JOB DETAILS'));
      if (jobSection) visionTailParts.push(jobSection);
      const entryLayer = systemParts.find(p => typeof p === 'string' && p.includes('ENTRY UPDATE PROPOSALS'));
      if (entryLayer) visionTailParts.push(entryLayer);
    }
    const visionSection = systemParts.find(p => typeof p === 'string' && (p.includes('SCREEN SHARING') || p.includes('PAGE TEXT FROM')));
    if (visionSection) visionTailParts.push(visionSection);
    const pageTextSection = systemParts.find(p => typeof p === 'string' && p.includes('PAGE TEXT FROM') && p !== visionSection);
    if (pageTextSection) visionTailParts.push(pageTextSection);
    const tabSection = systemParts.find(p => typeof p === 'string' && p.includes('CURRENT TAB'));
    if (tabSection) visionTailParts.push(tabSection);
    const visionTail = visionTailParts.join('\n');
    const visionModel = chatModel || (state.ANTHROPIC_KEY ? 'claude-haiku-4-5-20251001' : 'gpt-4.1-mini');
    const visionTotal = baseSystem.length + visionTail.length;
    console.log(`[Coop] ROUTED → Tier 2.5 (vision) | ${visionModel} | base:${baseSystem.length} tail:${visionTail.length} chars (${Math.round((1 - visionTotal/fullSize) * 100)}% saved vs full)`);
    try {
      const result = await chatWithFallback({ model: visionModel, system: { base: baseSystem, tail: visionTail }, messages, max_tokens: 2048, tag: 'Chat-Vision', opTag: 'chat', context: context.company || (globalChat ? 'global' : undefined) });
      if (!result.error) {
        const source = globalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
        if (hasTrigger) await _doBlockingInsightExtraction(lastUserMsg, result.reply, source);
        return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'vision' };
      }
    } catch (e) { console.warn('[Coop] Vision tier failed, escalating to full:', e.message); }
  }

  if (isFollowUp) {
    const mediumTailParts = [];
    if (careerOSChat) {
      const layer = systemParts.find(p => typeof p === 'string' && p.includes('CAREER OS EDITOR MODE'));
      if (layer) mediumTailParts.push(layer);
    }
    if (!globalChat && context.company) {
      const companyOverview = systemParts.find(p => typeof p === 'string' && p.includes('CURRENT COMPANY / OPPORTUNITY'));
      if (companyOverview) mediumTailParts.push(companyOverview);
      const jobSection = systemParts.find(p => typeof p === 'string' && p.includes('JOB DETAILS'));
      if (jobSection) mediumTailParts.push(jobSection);
      const entryLayer = systemParts.find(p => typeof p === 'string' && p.includes('ENTRY UPDATE PROPOSALS'));
      if (entryLayer) mediumTailParts.push(entryLayer);
    }
    mediumTailParts.push(TIER2_ESCAPE_HATCH);
    const mediumTail = mediumTailParts.join('\n');
    const mediumModel = chatModel || state.pipelineConfig.aiModels?.chat || 'gpt-4.1-mini';
    const mediumTotal = baseSystem.length + mediumTail.length;
    console.log(`[Coop] ROUTED → Tier 2 (medium, follow-up #${userMsgCount}) | ${mediumModel} | base:${baseSystem.length} tail:${mediumTail.length} chars (${Math.round((1 - mediumTotal/fullSize) * 100)}% saved)`);
    try {
      const result = await chatWithFallback({ model: mediumModel, system: { base: baseSystem, tail: mediumTail }, messages, max_tokens: 2048, tag: 'Chat-Medium', opTag: 'chat', context: context.company || (globalChat ? 'global' : undefined) });
      if (!result.error) {
        if (NEEDS_ESCALATION_RE.test(result.reply || '')) {
          console.log('[Coop] Tier 2 → escalating to Tier 3 via [[NEEDS_FULL_CONTEXT]] token');
        } else {
          const source = globalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
          if (hasTrigger) await _doBlockingInsightExtraction(lastUserMsg, result.reply, source);
          return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'medium' };
        }
      }
    } catch (e) { console.warn('[Coop] Tier 2 failed, escalating to full:', e.message); }
  }

  // Tier 3: Full pipeline

  // Auto-fetch URLs in the user's message
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  const urls = state.coopConfig.automations?.autoFetchUrls !== false ? (lastUserMsg.match(urlPattern) || []).slice(0, 3) : [];
  if (urls.length) {
    const fetched = [];
    for (const url of urls) {
      try {
        console.log('[Coop] Fetching URL:', url);
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const html = await res.text();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 6000);
          if (text.length > 50) {
            fetched.push(`\n=== WEB PAGE: ${url} ===\n${text}`);
          }
        }
      } catch (e) {
        console.warn('[Coop] Failed to fetch URL:', url, e.message);
      }
    }
    if (fetched.length) {
      systemParts.push(fetched.join('\n'));
      systemParts.push('\nThe user shared URL(s) above. Use the fetched page content to inform your response. Summarize what you find relevant.');
    }
  }

  try {
    const baseContent = new Set([
      identityPrompt,
      _principlesBlock,
      _gapToStoryBlock,
      profileLayer,
    ]);
    const tailParts = systemParts.filter((p, i) => {
      if (typeof p !== 'string') return false;
      if (i === 1) return false; // TODAY header
      if (baseContent.has(p)) return false;
      if (p.startsWith('\nCRITICAL RULE:')) return false;
      return true;
    });
    const tailText = tailParts.join('\n');
    let model = chatModel || getModelForTask('chat');
    console.log(`[Coop] ROUTED → Tier 3 (full) | ${model} | base:${baseSystem.length} tail:${tailText.length} chars | global: ${!!globalChat} | company: ${context.company || '(none)'}`);
    const result = await chatWithFallback({ model, system: { base: baseSystem, tail: tailText }, messages, max_tokens: 2048, tag: globalChat ? 'GlobalChat' : 'Chat', opTag: 'chat', context: context.company || (globalChat ? 'global' : undefined) });
    if (result.error) return result;
    const source = globalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
    if (hasTrigger) {
      await _doBlockingInsightExtraction(lastUserMsg, result.reply, source);
    }
    return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'full' };
  } catch (err) {
    console.error('[Coop] Error:', err);
    return { error: err.message };
  }
}

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
