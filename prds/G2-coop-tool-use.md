# G2 — Coop Tool-Use (On-Demand Context Loading)

**Status:** Draft, pending approval
**Author:** Matt + Claude (2026-04-09 session)
**Related:** BUG-coop-bind-context.md, F1-coop-opinions-from-settings.md

---

## Vision

Coop should feel like an assistant that *reaches for* context rather than one that *drowns in* it.

Today, every Coop message — whether you asked "switch to Haiku" or "draft a founder intro email" — shoves your entire Career OS profile, the bound company's full research, emails, meeting transcripts, and pipeline at the model. The result is a 50,000-token prompt for a 10-word question. It's slow money that makes Coop expensive to use casually.

This PRD turns Coop into an agent that **asks for what it needs, when it needs it**. The model decides whether to load your profile, pull recent emails, read a meeting transcript, or scan the pipeline — and loads only the slice relevant to the question in front of it.

That unlocks two things:

1. **Coop becomes ~5-10× cheaper per message.** Casual use stops feeling costly.
2. **Coop gains real agent capability.** Tool use is the door to everything we can't build today — re-researching a company mid-conversation, creating tasks through structured calls instead of code fences, fetching fresh data from Gmail or Granola on demand, and eventually multi-step workflows like autonomous application drafting. Cost is the urgent reason. Agent capability is the permanent reason.

---

## What changes for you

**Before** (every message, regardless of complexity):
- Coop sees your full profile, the bound company's full intelligence dump, full email history, full meeting transcripts, full pipeline, plus identity + principles. ~50k tokens.
- Cost: $0.03 – $0.07 per message. $1.50 – $2.50 per active day.
- Latency: ~2 seconds.
- You have no visibility into what Coop is "looking at."

**After**:
- Coop sees ~3k tokens: identity, operating principles, current bind state, and a menu of tools it can call.
- For a question like "switch to Sonnet," Coop answers directly. No tools loaded. ~$0.0005.
- For "what did Krisztian say about equity?", Coop calls `get_communications(keywords=["equity"])`, gets ~8k tokens of the relevant transcript, and answers. ~$0.005.
- For "draft an intro message," Coop calls `get_company_context()` and `get_communications()` in parallel, then writes. ~$0.006.
- **A small UI affordance in the chat shows which tools were called** — "Coop pulled: company context, last 3 emails" — so you can see Coop's reasoning and catch missed context.

**The tradeoff**: latency goes from ~2s to ~4-6s on messages that need tools. Not instant, but still conversational. The cost win is worth the seconds.

---

## The tradeoff in one table

|   | Today | After |
|---|---|---|
| Avg cost per message | $0.03 – $0.07 | $0.002 – $0.008 |
| Typical daily cost (25 msgs) | $1.50 – $2.50 | $0.05 – $0.20 |
| Latency, simple question | ~2s | ~2s (no tools needed) |
| Latency, complex question | ~2s | ~4-6s (tool round-trips) |
| Context transparency | None | Tool call list visible in chat UI |
| Token bloat ceiling | Grows as Career OS grows | Stays flat — tools summarize on fetch |
| Agent-style workflows | Blocked | Unlocked |

---

## Goals

1. **A typical bound-company follow-up costs under $0.01.**
2. **Coop correctly answers detail questions without guessing.** No regression on "what did Krisztian say about X" style recall.
3. **You can see which tools Coop called for each message.** Debuggable and trust-building.
4. **Instant rollback.** A settings toggle flips Coop back to the legacy path if anything breaks.
5. **Architectural groundwork for future tools** — web fetch, Gmail draft send, task creation via tool, multi-step agents — is in place.

## Non-goals

- Changing what data is stored. `savedCompanies[]`, `researchCache`, `coopMemory`, `prefs` all stay as-is.
- Persistent chat history. Session-only stays.
- OpenAI tool-use translation. Claude Haiku only in v1. (OpenAI's tool format is different enough to be a separate task.)
- Touching Coop Assist, Tier 1 slim routing, or Apply Queue scoring. Those paths are already cheap.
- Removing the legacy path on day one. It stays behind a feature flag until the tool-use path has proven out over a week of real use.

---

## How it works (high level)

Today Coop builds a single giant system prompt and sends one API call. The new flow is a short loop:

1. Coop sends a **slim system prompt** (~3k tokens: identity, principles, bind state, tool menu) plus the user's message.
2. The model either answers directly OR emits one or more `tool_use` requests.
3. For each tool request, the extension runs the handler locally and returns the result.
4. Results are fed back into the conversation and the model continues.
5. Loop repeats up to a cap of **5 tool calls per message**. After that, Coop answers with what it has and notes that more data was needed.
6. Final reply is returned to the side panel, along with the list of tools that were called.

The loop happens server-side inside `handleCoopMessageToolUse`. The side panel UI only ever sees the user's prompt and Coop's final reply — plus the new tool-call badge.

---

## Tool inventory (v1)

Five tools. The design principle is *narrow but high-leverage* — fewer tools reduces the chance of the model picking the wrong one. Each tool covers one conceptual need ("tell me about a company", "show me what was said") rather than mirroring the underlying data model.

| Tool | Purpose | Typical size |
|---|---|---|
| `get_company_context` | Company overview, firmographics, leadership, job/role details in one call | 3-5k tokens |
| `get_communications` | Recent emails + meeting transcripts for a company, with keyword expansion | 1-15k tokens |
| `get_profile_section` | One slice of the Career OS profile (story, experience, dealbreakers, etc.) | 0.5-4k tokens |
| `get_pipeline_overview` | All saved entries at a glance with stage, rating, action status, next step | 2-4k tokens |
| `search_memory` | Keyword search against learned insights and saved notes | 0.3-2k tokens |

**Full JSON schemas and return examples are in Appendix A.**

### Why these five

The tradeoff on tool count: too many tools confuses the model; too few forces every tool to return bloated data. Five is the smallest set that cleanly separates the five main reasons Coop ever loads context.

**A decision worth flagging**: `get_emails` and `get_meeting_transcripts` started as two separate tools. They were merged into `get_communications` because detail questions almost always need both ("what did Krisztian say in the call and then email?"), and splitting would force two round-trips for the common case. The tradeoff is that simple email-only questions load ~1k of unused meeting metadata. Acceptable.

**Not in v1** (considered and deferred):
- `search_learned_insights` separate from `search_memory` — collapsed, one semantic layer is enough for now
- `get_tasks` — tasks are accessed rarely in chat; punt
- `get_contacts` for cross-company contact lookup — punt
- `refresh_company_research` — would let Coop re-research a stale company on demand; valuable but needs its own approval flow because it burns API credits

These are all good followups once v1 is proven.

---

## Three key design decisions

All three confirmed in the 2026-04-09 conversation:

### Return format: structured JSON

Tool results come back as JSON objects, not pre-formatted text. JSON is ~30-50% cheaper in tokens, unambiguous for the model to parse, and trivial for the tool handler to generate. The risk — "model sounds robotic reading JSON" — is handled by one line in the system prompt: *"Tool results are JSON. Translate to natural language when answering the user."* Haiku handles this fine.

### Company lookup: fuzzy match with confidence threshold

When a tool takes a `company_name` parameter, the handler fuzzy-matches against saved entries using the existing normalized matcher (already in `researchCache`). Match confidence ≥0.85 → return the match with a `matchedFrom` field so the model knows it was fuzzy. Below 0.85 → return an error with the top 3 candidates so the model can ask "did you mean X or Y?"

Matt types lowercase and abbreviated company names all the time. Strict exact-match would force constant re-asks. Returning empty nulls would invite hallucination around missing fields. Fuzzy + confidence threshold is the only one of the three options that handles typos without enabling guessing.

### Bound-company resolution: hybrid (auto with optional override)

`company_name` is an optional parameter on all company-scoped tools. If omitted and the chat is bound to an entry, the tool auto-resolves to that entry. If omitted and the chat is unbound (global chat), the tool returns an error instructing the model to pass `company_name` explicitly or ask the user to bind.

Clean in both bound and global-chat modes with one line of prompt instruction. The model doesn't have to repeat "Captiwate" into every tool call when it's already the subject of the conversation, but global chat still requires explicit naming so it doesn't pick a wrong company.

---

## User-visible UX: the tool-call badge

Every Coop reply that used tools will show a small line beneath the message:

> *Coop pulled: company context, last 3 emails*

Tapping/hovering the line reveals the exact tool calls and parameters used, for debugging. If Coop answered without calling any tools, the badge doesn't appear.

This is a required part of v1, not a followup. Two reasons:

1. **Debugging.** When Coop gives a wrong or incomplete answer, you need to know whether it was a tool-call miss (Coop never pulled the right data) or a reasoning miss (Coop had the data and still got it wrong). Without the badge, they look identical from the outside.
2. **Trust.** Seeing that Coop *actually read your emails* before writing an intro message is more convincing than Coop claiming it did. Makes Coop feel less like a black box.

Rendering location: beneath the Coop reply, above the existing usage badge (model · tokens · cost). Similar visual weight to the usage badge — muted gray text, small font.

---

## Definition of done

Outcomes, not just checkboxes:

- [ ] A typical bound-company follow-up on Haiku costs under $0.01
- [ ] "What did Krisztian say about equity?" on Captiwate returns a correct answer using `get_communications` — no hallucination, no asking the user to paste the transcript
- [ ] "Switch to Sonnet" costs under $0.001 (zero tools called)
- [ ] Tool-call badge appears in the chat UI listing the tools Coop pulled for each message
- [ ] A `useToolUse` toggle in preferences flips between legacy and tool-use code paths instantly
- [ ] Aggregate token + cost accounting is correct across multi-step tool loops (not just the last API call)
- [ ] Legacy `handleCoopMessage` path still runs and produces correct answers when the toggle is off
- [ ] At least one successful end-to-end test on a real bound company, verified against a human-judged correct answer

Technical sub-items (in service of the outcomes above):

- 5 tool handlers implemented, matching the schemas in Appendix A
- Tool-use loop with a 5-call cap and clean aggregation of usage across iterations
- Slim system prompt with split cache markers (identity+principles as stable block, bind state as volatile block)
- Feature flag gated on `coopConfig.useToolUse`
- `claudeApiCall` extended to accept `tools` parameter; response parsing handles `tool_use` stop reason

---

## Risks and open questions

1. **Tool-call misses.** Haiku might confidently answer without calling a tool it should have. Mitigation: strong system-prompt wording (*"DO NOT guess — call the tool"*), plus the UI badge so misses are visible. Revisit with fine-tuning or model escalation if frequent.

2. **Latency regression.** Tool round-trips add 1-2s per loop. A 2-tool message goes from 2s to 5-6s. Mitigation: batch tool calls in parallel when the model emits multiple `tool_use` blocks in one turn (Anthropic supports this natively). Second mitigation: show a "Coop is looking things up..." state in the UI during tool loops so the wait feels intentional.

3. **No OpenAI fallback.** The feature flag forces Haiku. If Haiku is rate-limited, user gets an error instead of a fallback. Acceptable for v1. Revisit if rate limits become frequent — OpenAI tool-use translation is a separate followup.

4. **Session history bleed.** The tool-use loop adds intermediate `tool_use` and `tool_result` messages to the conversation array. These must stay *inside the loop* and not be persisted back to the UI's `messages` store. Needs careful testing.

5. **Cache on slim base.** The ~3k-token slim system prompt qualifies for prompt caching (>1024 tokens). But bind state (`CURRENT BINDING: Captiwate`) changes when the user switches companies. Split into two cache blocks: stable identity+principles+tools as block 1, volatile bind state as block 2. Same pattern as the G1 cache restructure that shipped earlier today.

6. **Tool return size cap.** Full meeting transcripts can be 20k+ tokens. Cap all tool returns at 15k tokens with a truncation marker, documented in the tool's description so the model knows.

7. **Legacy path deletion timeline.** When do we remove `handleCoopMessageLegacy`? Proposal: one week of real use under the flag on default-on, zero regressions, then delete.

---

## Migration phases

**Phase 1 — tonight.** This PRD. Get approval on shape, tool boundaries, and scope. No code.

**Phase 2 — next session.** Implement tools, handler loop, feature flag, and UI badge. **Do not test against the live API during the build.** Rely on code review and console-log sanity checks. Commit behind the flag with the flag defaulted OFF.

**Phase 3 — after Phase 2 is pushed.** Flip the flag on in preferences, send exactly one test message on a bound company. If the answer is correct and cost is under $0.01, flip default-on. If wrong, debug with local logs, not more API calls.

**Phase 4 — one week after Phase 3.** If no regressions, delete the legacy path. Otherwise, file bugs and keep the flag.

The hard rule across all phases: **no iterative testing at midnight**. The whole reason we're building this is that credit burn hurts. Building it carefully, shipping it once, then testing once is the discipline.

---

## Appendix A — Tool schemas

Full JSON schemas and example returns for each tool. This section is implementation spec, not the product surface — skip on first read.

### `get_company_context`

**Description**: Returns core data for a company/opportunity: basics, firmographics, leadership, job/role details, pipeline stage, rating.

**Input schema**:
```json
{
  "type": "object",
  "properties": {
    "company_name": {
      "type": "string",
      "description": "Optional. If omitted, uses the currently bound company. Required in global chat."
    }
  },
  "required": []
}
```

**Example return**:
```json
{
  "name": "Captiwate",
  "matchedFrom": "captivate",
  "confidence": 0.94,
  "stage": "active_review",
  "actionStatus": "my_court",
  "rating": 4,
  "employees": "2-10",
  "industry": "B2B SaaS",
  "funding": {
    "rounds": [{"type": "angel", "amount": "650k", "investor": "Thomas Peterffy"}],
    "totalRaised": "650k"
  },
  "leaders": [
    {"name": "Krisztian Berecz", "title": "Founder", "linkedin": "..."}
  ],
  "intelligence": "Two-to-three sentence synthesized positioning statement.",
  "role": {
    "title": "VP of Sales",
    "seniority": "VP",
    "comp": {"base": 120000, "ote": null, "equity": "undisclosed"},
    "description": "Trimmed job description, ~500 tokens max"
  },
  "stageTimestamps": {"discovered": "2026-03-01", "active_review": "2026-03-15"},
  "tags": ["founder-track", "b2b-saas"]
}
```

**Error shapes**:
- `{"error": "Company not found", "suggestions": ["Captiwate", "Captivate Labs"]}`
- `{"error": "Multiple matches", "candidates": [...]}`
- `{"error": "No bound company in this chat. Pass company_name or bind to an entry first."}`

**Size**: 3-5k tokens typical, capped at 8k (role description truncated if needed).

---

### `get_communications`

**Description**: Returns recent email threads AND meeting transcripts for a company, with optional keyword expansion.

**Input schema**:
```json
{
  "type": "object",
  "properties": {
    "company_name": {"type": "string"},
    "types": {
      "type": "array",
      "items": {"enum": ["emails", "meetings"]},
      "default": ["emails", "meetings"]
    },
    "limit": {"type": "integer", "default": 5},
    "keywords": {
      "type": "array",
      "items": {"type": "string"},
      "description": "If provided, meetings matching any keyword are expanded to full transcript. Otherwise only summaries."
    }
  },
  "required": []
}
```

**Example return**:
```json
{
  "company": "Captiwate",
  "emails": [
    {
      "id": "...",
      "subject": "Re: Following up on our chat",
      "from": "krisztian@captiwate.com",
      "date": "2026-03-28",
      "snippet": "first 300 chars of body",
      "matchedVia": "domain"
    }
  ],
  "meetings": [
    {
      "id": "...",
      "title": "Captiwate x Matt",
      "date": "2026-03-17",
      "attendees": ["Krisztian Berecz"],
      "summary": "2-3 sentence summary",
      "transcript": "full or truncated based on keyword match",
      "transcriptLength": "full"
    }
  ]
}
```

**Size**: 1k tokens (no content) to 15k tokens (full transcript expansion). Hard cap 15k with truncation marker.

---

### `get_profile_section`

**Description**: Returns one slice of the Career OS profile.

**Input schema**:
```json
{
  "type": "object",
  "properties": {
    "section": {
      "type": "string",
      "enum": ["story", "experience", "dealbreakers", "preferences", "attracted_to", "skills", "learnings"]
    }
  },
  "required": ["section"]
}
```

**Example return (`dealbreakers`)**:
```json
{
  "section": "dealbreakers",
  "content": [
    {"text": "Companies that glorify grit culture", "severity": "hard", "category": "culture"}
  ]
}
```

For unstructured sections (`story`, `experience`), `content` is a string.

**Size**: 500 tokens to 4k tokens. `story` is the biggest.

---

### `get_pipeline_overview`

**Description**: Returns all saved entries at a glance.

**Input schema**:
```json
{
  "type": "object",
  "properties": {
    "filter": {"enum": ["active", "all", "needs_action"], "default": "active"},
    "stage": {"type": "string", "description": "Optional pipeline stage filter"}
  },
  "required": []
}
```

**Example return**:
```json
{
  "filter": "active",
  "count": 14,
  "entries": [
    {
      "name": "Captiwate",
      "stage": "active_review",
      "rating": 4,
      "actionStatus": "my_court",
      "jobTitle": "VP of Sales",
      "lastActivity": "2026-03-28",
      "nextStep": "Push for term sheet clarity"
    }
  ]
}
```

**Size**: 2-4k tokens for a typical 10-20 entry pipeline.

---

### `search_memory`

**Description**: Returns learned insights and saved notes matching a query.

**Input schema**:
```json
{
  "type": "object",
  "properties": {
    "query": {"type": "string"},
    "limit": {"type": "integer", "default": 5}
  },
  "required": ["query"]
}
```

**Example return**:
```json
{
  "query": "healthcare experience",
  "matches": [
    {
      "type": "user",
      "text": "I spent 3 years at a healthcare analytics startup selling to CMOs",
      "source": "chat:Amagi",
      "savedAt": "2026-03-12"
    }
  ]
}
```

Simple keyword match in v1. Upgrade to semantic/embedding search as a followup.

**Size**: 300 tokens to 2k tokens.

---

## Appendix B — Handler skeleton

Implementation sketch. Not final code. Included so reviewers can see the loop shape before Phase 2.

```js
const COOP_TOOLS = [
  { name: "get_company_context",   description: "...", input_schema: {...} },
  { name: "get_communications",    description: "...", input_schema: {...} },
  { name: "get_profile_section",   description: "...", input_schema: {...} },
  { name: "get_pipeline_overview", description: "...", input_schema: {...} },
  { name: "search_memory",         description: "...", input_schema: {...} },
];

async function handleCoopMessageToolUse({ messages, context, chatModel }) {
  const boundCompany = context._manualBind || context.company || null;
  const system = buildSlimSystemPrompt({ boundCompany, isGlobalChat: !boundCompany });

  let conversation = [...messages];
  let totalUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  const toolCallLog = [];
  let finalReply = null;

  for (let step = 0; step < 5; step++) {
    const res = await claudeApiCall({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system,
      messages: conversation,
      tools: COOP_TOOLS,
    });
    const data = await res.json();

    totalUsage.input          += data.usage?.input_tokens                 || 0;
    totalUsage.output         += data.usage?.output_tokens                || 0;
    totalUsage.cacheCreation  += data.usage?.cache_creation_input_tokens  || 0;
    totalUsage.cacheRead      += data.usage?.cache_read_input_tokens      || 0;

    if (data.stop_reason === 'end_turn' || data.stop_reason === 'stop_sequence') {
      finalReply = data.content?.find(b => b.type === 'text')?.text || '';
      break;
    }

    if (data.stop_reason === 'tool_use') {
      conversation.push({ role: 'assistant', content: data.content });
      const toolResults = [];
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;
        const result = await runCoopTool(block.name, block.input, { boundCompany, context });
        toolCallLog.push({ name: block.name, input: block.input });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      conversation.push({ role: 'user', content: toolResults });
      continue;
    }

    finalReply = data.content?.find(b => b.type === 'text')?.text || 'Something went wrong.';
    break;
  }

  return {
    reply: finalReply,
    model: 'claude-haiku-4-5-20251001',
    usage: totalUsage,
    toolCalls: toolCallLog,  // surfaced to UI for the badge
    routed: 'tool-use',
  };
}
```

---

## Non-scope followups

- **Semantic memory search** — `search_memory` is keyword-only in v1. Upgrade to embeddings once keyword misses become obvious.
- **OpenAI tool-use translation** — Claude Haiku only in v1. OpenAI has a different tool-use API shape and needs its own translator.
- **Profile trimming** — Even with tool use, `get_profile_section("story")` might return 4k tokens of raw Story Time input. Separate pass to distill long-form profile sections.
- **`refresh_company_research` tool** — Would let Coop re-research a stale company on demand, but burns API credits and needs its own approval flow before being exposed to the model.
- **Task creation via tool** — Replace the `\`\`\`create-task` code fence pattern with a structured tool call. Cleaner, more reliable.
- **Web fetch tool** — Replace the auto-URL-fetch inside `handleCoopMessage` with an on-demand tool call.
- **Multi-step agent workflows** — Once tool use is stable, compose longer loops (autonomous application drafting, multi-company research sweeps). This PRD lays the groundwork.
