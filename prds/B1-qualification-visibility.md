# B1 — Qualification Scoring Visibility

**Status:** Draft, awaiting approval
**Owner:** Opus session, 2026-04-07
**Backlog item:** B1 (P1.7 — Coop transparency)

## Problem

Coop scores every opportunity for qualification fit (1–10) and produces a met/partial/unmet checklist of requirements, but the surface today shows only the score, a 2–3 sentence narrative, and a status icon per requirement. When a score feels wrong — or when a `hardDQ` flag is tripped — Matt can't see *why* in any depth, and can't push back. The reasoning is in the data (`jobMatch.qualifications[]`, `jobMatch.hardDQ`, `jobMatch.scoreBreakdown`) but the UI doesn't expose it, and there's no feedback path that loops corrections back into Coop's memory.

This is a **read + correct** feature. It does not change how scoring or DQ work. It does not auto-DQ on low scores. It just opens the black box and gives Matt a way to talk back.

## Goal

On the opportunity detail page, add an inline-expandable "See why" surface under the existing qualification score that shows the full reasoning Coop already produced, plus a feedback loop so Matt can correct individual requirements and the overall score and trigger a re-score on demand.

## Non-goals

- Changing the qualification scoring prompt or logic.
- Auto-moving entries to DQ / closed_lost based on score (Matt was explicit: this is purely visibility, never automation).
- Building a separate "Scoring" tab. Lives inline where the score already is.
- Touching ICP scoring (there is no separate ICP score — ICP is input context that shapes `preferenceFit`).
- Real-time re-scoring on every click. Corrections are queued and re-scored on user demand.

## Surface

**Location:** `opportunity.js` qualification section (around lines 754–767, where the existing checklist already renders). New "See why" affordance expands inline; no modal, no new tab, no navigation.

**Collapsed state:** Same as today — score badge, narrative text, and the existing requirements checklist.

**Expanded state ("See why" clicked):** Reveals four sections, in order:

1. **Score breakdown.** Reads from `jobMatch.scoreBreakdown` and renders the existing qualificationFit alongside the other dimensions (preferenceFit, compFit, roleFit) so Matt can see *which dimension* dragged the overall score down. Bar chart, same as queue.js:215–232 already does — copy the rendering, don't re-derive.

2. **Hard DQ reasoning, if any.** If `jobMatch.hardDQ.flagged === true`, render a callout showing the `hardDQ.reason` field plus which dealbreaker tripped (work arrangement, salary floor, etc.). Mention that hardDQ caps the overall score at 4 (`background.js:1501-1504`) so Matt understands the score ceiling.

3. **Per-requirement detail.** The `qualifications[]` array, but expanded:
   - Status icon (met / partial / unmet / unknown) — same as today
   - Importance badge (required / preferred / bonus)
   - Evidence quote (already stored, max 15 words)
   - **NEW:** three inline correction buttons per requirement: `I meet this`, `Not relevant`, `Wrong evidence`

4. **Overall score feedback.** Below the requirements list, a single textarea + button: *"This score feels wrong? Tell Coop why."* Freeform reason, no character limit.

## Correction model

Corrections are stored on the entry under a new field, `jobMatch.userCorrections`, shaped:

```js
{
  requirements: {
    [requirementId]: {
      action: 'meets' | 'not_relevant' | 'wrong_evidence',
      note: string | null,        // optional freeform from a follow-up prompt
      correctedAt: number
    }
  },
  overall: {
    note: string,
    correctedAt: number
  } | null,
  pendingRescore: boolean         // true once any correction is added; false after re-score completes
}
```

When any correction is added:
- The relevant requirement renders with a "corrected" visual treatment (left border accent + small "you said: meets this" caption underneath)
- `pendingRescore` flips to `true`
- A "Re-score with corrections (N pending)" button appears at the bottom of the expanded surface
- Until the user clicks it, **no API call fires** (per Matt: on-demand only)

## Re-score flow

Clicking "Re-score with corrections":

1. Build a corrections block to inject into the existing scoring prompt:
   ```
   IMPORTANT: The candidate has corrected your previous assessment. Treat these as ground truth and rescore accordingly:
   - Requirement "5+ years SaaS sales": candidate confirms they MEET this (your prior call: partial)
   - Requirement "Healthcare experience": candidate says NOT RELEVANT to this role
   - Overall: candidate says "you're underweighting my GTM leadership experience — I led sales at two seed-stage SaaS startups"
   ```
2. Fire the existing `runQuickFit` (or whichever scorer produced the original — `background.js:1360`) with this block prepended to the user message. Same model, same prompt, same downstream handling.
3. On success: overwrite `jobMatch` fields normally, set `pendingRescore: false`, keep the `userCorrections` block intact (it's the audit trail).
4. Also append each correction to `storyTime.learnedInsights` with `source: 'qualification_correction'`, mirroring the existing flag-dismiss feedback pattern (`queue.js:390-458`). This is what makes the loop persistent — future scoring runs see these insights and don't make the same mistake twice.

If a future re-score still gets it wrong, Matt can correct again. The `learnedInsights` accumulate. The `userCorrections` block on this specific entry gets overwritten with the new round.

## UI details

- The "See why" affordance is a small chevron/text link (`See why ▾` / `Hide ▴`) sitting next to the existing qualification score header. Default: collapsed.
- Once any correction exists on an entry, the collapsed state shows a small "N corrections pending re-score" pill so Matt notices it from a glance even without expanding.
- The correction buttons are unobtrusive (text-only, faded until hovered) so they don't crowd the existing checklist.
- Re-score button is the only "loud" CTA in the expanded surface — orange `--ci-accent` background, full width.
- After a re-score completes, briefly toast "Score updated" and re-render in the expanded state so Matt can see what changed.

## Open questions

None — Matt resolved both during PRD discussion:
- Surface location: inline on opportunity.js (a)
- Re-score timing: on demand (b)

## Implementation sketch

Files touched:
- `opportunity.js` — expanded "See why" rendering, correction handlers, re-score button wiring (~150 lines added in/around the existing qualifications section)
- `background.js` — extend `runQuickFit` to accept and inject a `userCorrections` block when present; small append to the user message construction
- `saved.js` — minor: show the "N corrections pending" pill on opportunity cards if `jobMatch.userCorrections` exists with `pendingRescore: true`
- No schema migration. `jobMatch.userCorrections` is additive and lazily defaulted on read.

No new files. No new dependencies. No new background message types — re-score reuses the existing scoring path (`ANALYZE_JOB` or whatever the current entry point is — confirm at implementation time).

## Risk

The only real risk is the corrections-injected prompt confusing the scoring model (e.g. it ignores the corrections or double-counts them). Mitigation: the correction block is prepended with explicit "treat as ground truth" framing, and the existing scoring prompt is conservative enough that this should land. If the first round of testing shows the model ignoring corrections, fall back to a two-step approach: first call summarizes the corrections into structured deltas, second call re-scores with those deltas.
