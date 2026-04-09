# F1 — Coop's opinions live in settings, not in code

**Status:** Proposed
**Date:** 2026-04-07
**Owner:** Matt
**Pairs with:** none (architectural cleanup)

## Problem

Coop currently editorializes on top of user-provided data because interpretation language is hardcoded into prompt strings across ~20 sites in `background.js`. The user enters a salary floor of $100K; the code rewrites it as `"Base salary WALK AWAY (reject below): $100K"` before sending it to the model. Same pattern for work arrangement ("DEALBREAKERS… drop the score by at least 3 points"), structured dealbreakers ("severity 5 = absolute"), and post-processor score caps (`if (hardDQ.flagged && score > 4) score = 4`).

The result: when the user asks Coop to draft a cover letter for a $100K Enterprise AE role, Coop responds with a 6-paragraph "hard pass / pump the brakes" lecture instead of drafting. The user has no single place to dial this back — fixing it requires editing prompt strings in 9+ sites and reasoning about how they interact with the post-processor.

This violates the principle: **code should carry mechanics, settings should carry opinions.**

## Goal

Every piece of interpretation Coop applies to the user's data should be:
1. Visible in one place in the Coop settings UI
2. Editable by the user without touching code
3. The single source of truth — no override stacks, no hidden post-processor verdicts

The user's profile data (Green Lights, Red Lights, Dealbreakers, floors, ICP, etc.) stays where it is. Those are facts. The *interpretation* of those facts moves out of code and into settings.

## Audit — what's hardcoded today

### A. Salary / OTE floor framing (9 sites)
All inject the phrase "walk away below" / "WALK AWAY (reject below)" / "walk away if base pay is below" alongside the user's floor number.
- `background.js:1332, 1334` — quick-fit scoring
- `background.js:2124, 2126` — deep-fit narrative
- `background.js:3054, 3056` — daily brief
- `background.js:4090, 4092` — Coop chat (`handleCoopMessage`)
- `background.js:4791` — pipeline advisor / activity context

### B. Work-arrangement penalty (3 sites)
- `background.js:1290` — quick-fit preprocessor auto-injects hardDQ keyword hit (severity 4–5) on remote/hybrid mismatch
- `background.js:1409` — quick-fit rubric: `"this IS a hard DQ — Hybrid requires in-office days which a remote-only candidate cannot do"`
- `background.js:2132` — deep-fit rubric: `"Work arrangement and location are DEALBREAKERS… drop the score by at least 3 points"`

### C. Dealbreaker severity scale (3 sites)
- `background.js:1254, 1273` — preprocessor: `if (numSev >= 4) keywordHits.hardDQ.push(...)`
- `background.js:1308` — prompt: `"severity 1-5 where 5=absolute dealbreaker"`
- `background.js:1544–1549` — post-processor forces `hardDQ.flagged = true` and injects red flags after the model responds

### D. Score cap enforcement (2 sites)
- `background.js:1529` — `if (hardDQ.flagged && score > 4) { score capped to 4 }` — silently overrides the model's judgment
- `background.js:2197` — same pattern in deep-fit

### E. Pushback license (kept, not removed)
- `background.js:258` — `"Be direct, opinionated, and honest. Push back when something doesn't align with what you know about him. Don't be sycophantic."`
- `background.js:271` — `"Be opinionated and direct, but never confused about who you are."`

These stay. They're the right baseline for strategy questions. The reason they currently feel oppressive is the *combination* with A–D, not the strings themselves.

### F. Defensive scoring guardrails (mixed — some keep, some move)
- `1405, 2134` — "Only flag concerns the candidate has EXPLICITLY stated" → KEEP (anti-hallucination)
- `1407, 2134` — `"No equity mentioned" is NEVER a red flag` → KEEP (anti-hallucination)
- `2140` — "Do NOT flag missing salary as a red flag" → KEEP (anti-hallucination)
- `1441` — `"dealbreakers: 1-10. 10=no issues, 1=fatal dealbreaker triggered"` → MOVE (this is interpretation)
- `1402` — quickTake length / lead-with-most-important → KEEP (formatting)

### G. Length / formatting defaults (kept)
- `background.js:273` — LENGTH RULES → KEEP (mechanics, not opinion)

### H. Mode awareness — currently MISSING
There is zero distinction in code between:
- **Evaluative requests:** "is this a fit?", "should I apply?", "compare these two"
- **Production requests:** "draft a cover letter", "write a follow-up email", "answer this application question"

So Coop applies the same pushback logic to a draft request as to a strategy question. This is the root cause of the cover-letter lecture.

## Solution

### Single source of truth: `coopConfig.operatingPrinciples`

Add one freeform textarea to the Coop settings UI:

> **Coop's Operating Principles**
> Tell Coop how to interpret your data. He'll use these principles in every conversation. Edit anytime — no code changes needed.

The string the user types here gets injected into every system prompt that builds Coop's behavior, in a labeled block:

```
=== HOW TO INTERPRET MATT'S DATA ===
{operatingPrinciples}
```

A sensible default ships in the box so it works on first install:

```
- Treat my floors and dealbreakers as preferences with weight, not as
  refusal triggers. Flag concerns once, then help me with what I asked.
- When I ask you to draft something (cover letter, email, application
  answer), draft it. Save fit critique for when I explicitly ask
  "should I apply?" or "is this a fit?".
- When evaluating, be honest and specific. When producing, produce.
- A score below my floor is a concern, not a hard pass. Tell me once,
  not every turn.
- Hard DQ is reserved for things I have explicitly marked hard DQ in
  my dealbreakers list — nothing else.
```

The user can rewrite this freely. This is the only place they go.

### Strip hardcoded opinions from the ~20 sites

Every site listed in A–D emits **neutral data only**:

- A → `Base salary floor: $100K` (no "walk away," no verb)
- B → `Preferred work arrangement: Remote` (no "DEALBREAKER," no point penalty)
- C → `Dealbreakers (with user-assigned severity 1-5):` followed by the structured list, no scale interpretation
- D → **Removed entirely.** No more silent score caps. The model decides the score using the rubric + the user's operating principles. If the user wants hard caps, they say so in operating principles.

### Mode awareness (gap H)

In `handleCoopMessage`, detect production-mode requests via:
1. Source tag: messages from journey buttons (`✎ Cover letter`, etc.) carry `_journeyMode: 'draft'`
2. Regex on user message: `/^(write|draft|help me write|compose|generate)\b.*(cover letter|email|reply|response|message|answer|intro|follow.?up)/i`

When `_draftMode` is true, the operating principles block gets a one-line prefix:
```
=== HOW TO INTERPRET MATT'S DATA ===
[NOTE: Matt has asked you to draft something. Production mode. Default to producing the draft.]
{operatingPrinciples}
```

This is a *hint*, not an override. The user's principles still rule. The hint just nudges the right policy.

### Helper functions (one place, all sites read from them)

Add a small `coopInterp` helper module at the top of `background.js`:

```js
const coopInterp = {
  // Returns the operating principles block to inject into any system prompt
  principlesBlock() {
    const principles = coopConfig.operatingPrinciples || DEFAULT_OPERATING_PRINCIPLES;
    return `\n=== HOW TO INTERPRET MATT'S DATA ===\n${principles}`;
  },

  // Returns neutral floor labels for prompt construction
  floorBlock(prefs) {
    const parts = [];
    if (prefs.salaryFloor)  parts.push(`Base salary floor: $${prefs.salaryFloor}`);
    if (prefs.salaryStrong) parts.push(`Base salary strong: $${prefs.salaryStrong}`);
    if (prefs.oteFloor)     parts.push(`OTE floor: $${prefs.oteFloor}`);
    if (prefs.oteStrong)    parts.push(`OTE strong: $${prefs.oteStrong}`);
    return parts.length ? `\n[Compensation]\n${parts.join('\n')}` : '';
  },

  // Detects production-mode requests
  isDraftRequest(messages, contextFlags) {
    if (contextFlags?._journeyMode === 'draft') return true;
    const last = messages[messages.length - 1]?.content || '';
    return /^(write|draft|help me write|compose|generate)\b.*(cover letter|email|reply|response|message|answer|intro|follow.?up)/i.test(last);
  },
};
```

Every prompt-building site (handleCoopMessage, quickFit, deepFit, dailyBrief, pipelineAdvisor) reads from these. Zero duplication.

### Settings UI

In the existing Coop settings page (`preferences.html` or wherever `coopConfig` lives), add one section above existing personality presets:

```
## Coop's Operating Principles

[textarea, ~10 rows, monospace]

Default text pre-filled. "Reset to default" button.

[Save]
```

Below the textarea, a small italic note:
> Coop reads these principles every conversation. They shape how he interprets your floors, dealbreakers, and preferences. Edit anytime.

### What we delete

- Lines 1332, 1334, 2124, 2126, 3054, 3056, 4090, 4092, 4791 — replaced with `coopInterp.floorBlock(prefs)`
- Lines 1290, 1409, 2132 — work-arrangement hardcoded penalty removed; user's work arrangement preference still emitted as neutral data
- Lines 1308 — severity scale interpretation removed; structured dealbreakers emitted as data only
- Lines 1529, 2197 — score cap post-processor **deleted**
- Lines 1544–1549 — keyword hardDQ post-processor flag injection **deleted**
- Lines 1254, 1273 — preprocessor `keywordHits.hardDQ` accumulation **deleted**

### What we keep

- Identity prompt (line 264–273) — Coop is Coop, length rules, formatting capabilities
- Pushback license (line 258) — `"Be direct, opinionated, and honest. Push back…"` — paired now with operating principles that tell him *when* to push back
- Anti-hallucination guardrails (1405, 1407, 2134, 2140) — these are mechanics, not opinions
- All scoring rubric structure (dimensions, output schema, JSON shape) — mechanics

## Migration

- One-time: `coopConfig.operatingPrinciples` defaults to the seed text above on first load if unset
- No data migration needed — user profile, dealbreakers, floors all stay in their existing storage

## Verification checklist

- [ ] Asking Coop to "draft a cover letter for this role" produces a draft, not a fit lecture, even when role is below floor
- [ ] Asking "is this a fit?" still produces honest critique citing floors and dealbreakers
- [ ] Editing operating principles to say `"be more aggressive about flagging concerns"` measurably changes Coop's tone within one conversation
- [ ] Editing operating principles to say `"never refuse to help me with a task"` removes all pushback
- [ ] Quick-fit and deep-fit scores still respect dealbreakers — but via the model reading the rubric + principles, not via post-processor caps
- [ ] No prompt string in `background.js` contains the substring `"walk away"`, `"WALK AWAY"`, `"hard DQ"`, `"DEALBREAKERS"` (case-sensitive search)
- [ ] One settings textarea, no override stack

## Out of scope

- Detecting evaluative vs production requests beyond the simple regex + journey-button source. Smarter classification can come later if needed.
- Per-conversation policy overrides ("for this chat only, be harsher"). Not needed for v1.
- Multiple operating-principles profiles ("strategy mode" / "production mode" preset toggle). Not needed for v1 — the textarea is the dial.
- Score calibration sliders, pushback aggressiveness dropdowns, etc. The textarea replaces all of these with one freeform field the user controls completely.

## Follow-ups (not in this PRD)

- Once the textarea ships, monitor whether the default seed produces the right Coop behavior across the cover letter case, the strategy case, and the daily brief case. Tune the seed if needed.
- Consider exposing operating principles as part of Coop's memory synthesis loop (so Coop can suggest edits based on observed user reactions).
