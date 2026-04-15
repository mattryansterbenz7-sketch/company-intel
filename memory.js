// memory.js — Coop memory store, insight extraction, profile consolidation.

import { state } from './bg-state.js';
import { getModelForTask, claudeApiCall, chatWithFallback } from './api.js';

// ── Story Time: Passive Learning (insight extraction after every chat) ───────

export function extractInsightsFromChat(userMessage, assistantResponse, source) {
  if (state.coopConfig.automations?.insightExtraction === false) return;
  // Debounce: accumulate latest message pair, fire after 60s of chat inactivity
  state._pendingInsightArgs = { userMessage, assistantResponse, source };
  if (state._insightExtractionTimer) clearTimeout(state._insightExtractionTimer);
  state._insightExtractionTimer = setTimeout(() => {
    const args = state._pendingInsightArgs;
    state._pendingInsightArgs = null;
    state._insightExtractionTimer = null;
    if (args) _doExtractInsightsFromChat(args.userMessage, args.assistantResponse, args.source);
  }, 60_000);
}

async function _doExtractInsightsFromChat(userMessage, assistantResponse, source) {
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
User: ${userMessage}
Assistant: ${assistantResponse}

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

// ── Coop memory store (Claude Code-style typed entries) ─────────────────────

const VALID_MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];

function _newMemId() {
  return 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function applyCoopMemoryActions(actions, source) {
  const { coopMemory } = await new Promise(r => chrome.storage.local.get(['coopMemory'], r));
  const mem = coopMemory && Array.isArray(coopMemory.entries) ? coopMemory : { entries: [] };
  const now = new Date().toISOString();
  const findByName = name => mem.entries.findIndex(e => e.name?.toLowerCase() === (name || '').toLowerCase());

  for (const a of actions) {
    if (!a || !a.op) continue;
    if (a.op === 'create') {
      if (!a.type || !VALID_MEMORY_TYPES.includes(a.type)) continue;
      if (!a.name || !a.body) continue;
      // Skip if name collides — convert to update instead
      const existing = findByName(a.name);
      if (existing !== -1) {
        mem.entries[existing] = { ...mem.entries[existing], body: a.body, description: a.description || mem.entries[existing].description, updatedAt: now, source };
      } else {
        mem.entries.push({
          id: _newMemId(),
          type: a.type,
          name: a.name.slice(0, 80),
          description: (a.description || '').slice(0, 200),
          body: a.body,
          createdAt: now,
          updatedAt: now,
          source,
        });
      }
    } else if (a.op === 'update') {
      const idx = findByName(a.match_name);
      if (idx === -1) continue;
      mem.entries[idx] = {
        ...mem.entries[idx],
        body: a.body || mem.entries[idx].body,
        description: a.description || mem.entries[idx].description,
        updatedAt: now,
        source,
      };
    } else if (a.op === 'delete') {
      const idx = findByName(a.match_name);
      if (idx !== -1) mem.entries.splice(idx, 1);
    }
  }

  // Cap at 200 entries to keep prompts bounded
  if (mem.entries.length > 200) {
    mem.entries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    mem.entries = mem.entries.slice(0, 200);
  }
  mem.updatedAt = now;
  chrome.storage.local.set({ coopMemory: mem });
}

// Build a MEMORY.md-style block for prompt injection
export function buildCoopMemoryBlock(coopMemory) {
  if (!coopMemory?.entries?.length) return '';
  const groups = { user: [], feedback: [], project: [], reference: [] };
  for (const e of coopMemory.entries) {
    if (groups[e.type]) groups[e.type].push(e);
  }
  const sections = [];
  for (const type of ['user', 'feedback', 'project', 'reference']) {
    const list = groups[type];
    if (!list.length) continue;
    sections.push(`### ${type.toUpperCase()}\n` + list.map(e =>
      `[${e.name}] ${e.description || ''}\n${e.body}`
    ).join('\n\n'));
  }
  if (!sections.length) return '';
  return `\n=== COOP MEMORY (persistent, typed) ===\nThese are things you've learned about the user across past conversations. Treat as authoritative unless contradicted by current context.\n\n${sections.join('\n\n')}\n=== END COOP MEMORY ===\n`;
}

// ── Insight routing ─────────────────────────────────────────────────────────

export async function routeInsights(insights, source) {
  if (!insights?.length) return;

  const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));
  const st = storyTime || {};

  let profileChanged = false;
  const profileUpdates = {};

  // Route insights to coopMemory (single source of truth)
  const memoryActions = [];
  for (const insight of insights) {
    const category = insight.category || 'general';

    // Create coopMemory entry for actionable insights
    if (['green_light', 'red_light', 'scoring_feedback', 'experience_update'].includes(category)) {
      memoryActions.push({
        op: 'create',
        type: 'feedback',
        name: `${category}: ${(insight.text || '').slice(0, 60)}`,
        description: `Learned from ${source} on ${new Date().toISOString().slice(0, 10)}`,
        body: insight.text + (insight.context ? `\nContext: ${insight.context}` : ''),
      });
    }

    // Route to specific profile fields (structured entries preferred, legacy fallback)
    if (insight.target_field === 'profileGreenLights' && category === 'green_light') {
      profileUpdates.profileAttractedTo = true;
      profileChanged = true;
    }
    if (insight.target_field === 'profileRedLights' && category === 'red_light') {
      profileUpdates.profileDealbreakers = true;
      profileChanged = true;
    }
    if (insight.target_field === 'rawInput' && category === 'experience_update') {
      st.rawInput = (st.rawInput || '') + '\n\n[Learned ' + new Date().toISOString().slice(0, 10) + '] ' + insight.text;
    }
    if (category === 'answer_pattern') {
      st.answerPatterns = st.answerPatterns || [];
      if (st.answerPatterns.length < 50) {
        st.answerPatterns.push({ text: insight.text, context: insight.context, date: new Date().toISOString().slice(0, 10), source });
      }
    }
  }

  // Save storyTime (profile field routing still writes here)
  chrome.storage.local.set({ storyTime: st });

  // Write insights to coopMemory — now the single source of truth
  if (memoryActions.length) {
    await applyCoopMemoryActions(memoryActions, source);
  }

  // Write to structured flag arrays (profileAttractedTo / profileDealbreakers)
  if (profileChanged) {
    chrome.storage.local.get(['profileAttractedTo', 'profileDealbreakers'], data => {
      const updates = {};
      for (const insight of insights) {
        if (insight.target_field === 'profileGreenLights' && insight.category === 'green_light') {
          const arr = data.profileAttractedTo || [];
          arr.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: insight.text,
            category: 'other',
            keywords: [],
            source: source,
            createdAt: Date.now()
          });
          updates.profileAttractedTo = arr;
        }
        if (insight.target_field === 'profileRedLights' && insight.category === 'red_light') {
          const arr = data.profileDealbreakers || [];
          arr.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: insight.text,
            category: 'other',
            severity: 'soft',
            keywords: [],
            source: source,
            createdAt: Date.now()
          });
          updates.profileDealbreakers = arr;
        }
      }
      if (Object.keys(updates).length) chrome.storage.local.set(updates);
    });
  }

  // Broadcast captured insights for UI confirmation
  const capturedTexts = insights.filter(i => i.priority === 'high' || i.category !== 'general').map(i => i.text);
  if (capturedTexts.length) {
    chrome.runtime.sendMessage({ type: 'INSIGHTS_CAPTURED', insights: capturedTexts }).catch(() => {});
  }
}

// ── Story Time: Profile Consolidation ────────────────────────────────────────

export async function consolidateProfile(rawInput, insights) {
  const prompt = `You are compressing a personal career profile for use as AI context. Extract EVERY specific fact, number, metric, skill, preference, criterion, and lesson — express each in the most concise form possible.

Rules:
- NEVER drop a specific fact, number, company name, metric, or stated preference
- Strip storytelling and conversational padding. Keep substance, lose wrapper
- Convert paragraphs into dense, scannable notes. Short phrases, not sentences
- Preserve the user's exact words for values and preferences
- Group into sections: Career Identity, Experience (subsection per role), Skills & Capabilities, Green Lights, Red Lights, Values & Working Style, Career Goals, Projects
- Within Experience, preserve: company, title, metrics (ARR, ACV, team size, %), accomplishments, lessons
- Target 2500-3500 words ceiling. Do NOT cut real content to hit a shorter number
- If learned insights are included, weave into relevant sections

Goal: someone reading this knows EVERYTHING the original said, without conversational padding.

=== USER'S OWN WORDS ===
${rawInput || '(none provided)'}

=== AI-LEARNED OBSERVATIONS ===
${insights || '(none yet)'}`;

  try {
    const result = await chatWithFallback({
      model: getModelForTask('profileConsolidate'),
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      tag: 'consolidateProfile',
      opTag: 'profile'
    });
    if (result.error) {
      return { error: result.error };
    }
    return { profileSummary: result.reply || '' };
  } catch (err) {
    return { error: err.message };
  }
}
