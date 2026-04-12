# PRD S4 — Scoring System Overhaul

## Status

**Shipped** (2026-04-10). `analyzeJob` fully removed in follow-up consolidation (2026-04-11).

## Problem (pre-S4)

The scoring system had three independent issues that compounded into one outcome: score predictability was poor and it was unclear why scores landed where they did.

### Issue 1: Two scoring paths, incompatible data shapes

Two scoring functions produced different data under different field names. `scoreOpportunity` wrote to `entry.quickFitDimensions` (6 dims); `analyzeJob` wrote to `entry.jobMatch` (flat, no dimension breakdown). The queue UI expected `entry.jobMatch.scoreBreakdown` — a field neither function produced. Result: dimension breakdown bars were always empty after a real score.

### Issue 2: Dimension model mismatch

The dimension names across the two functions and the queue UI didn't align. A backward-compat mapping in queue.js papered over old→new format differences but couldn't bridge the fundamental mismatch.

### Issue 3: Score predictability

The AI was asked to compute dimension scores and a weighted average, but often ignored the math and picked a round number. No verification — the system trusted whatever the AI returned.

---

## Design: Unified Deterministic Scoring

### Core principle

The AI evaluates evidence. The code computes the score. This makes scoring predictable, auditable, and tunable.

### Single dimension model (5 dimensions)

Unify on 5 dimensions that match what the queue UI already renders:

| Dimension | Key | Weight (default) | What it measures |
|-----------|-----|-------------------|-----------------|
| Qualification | `qualificationFit` | 20% | Does the candidate's experience match the role requirements? |
| Role Fit | `roleFit` | 20% | Does the role match stated preferences, green lights, target role ICP? |
| Culture Fit | `cultureFit` | 25% | Company culture signals, operating principles alignment, team dynamics |
| Company Fit | `companyFit` | 20% | Company stage, industry, growth trajectory vs. company ICP |
| Comp Fit | `compFit` | 15% | Compensation vs. floors and strong numbers |

Drop the separate `workArrangement` and `redFlags` dimensions. Work arrangement folds into roleFit (it's a preference). Red flags fold into their parent dimension — a comp dealbreaker lowers compFit, a culture dealbreaker lowers cultureFit.

### Scoring flow

```
1. AI evaluates → returns flags + evidence per dimension (no scores)
2. Code scores each dimension deterministically:
   - Start at 5.0 (neutral)
   - Each green flag: +delta (based on flag weight)
   - Each red flag: -delta (based on severity)
   - Clamp to [1, 10]
3. Code computes weighted average → final score
4. Hard DQ cap: if any hard dealbreaker fires, cap at 3
5. Excitement modifier: nudge ±0.3 based on user rating (existing logic)
```

### What the AI returns (new prompt)

```json
{
  "flags": [
    {
      "dimension": "qualificationFit",
      "type": "green",
      "text": "8+ years enterprise SaaS closing experience",
      "evidence": "JD: 'proven track record closing $500K+ deals'",
      "configuredEntry": "Enterprise sales experience",
      "delta": 1.5
    },
    {
      "dimension": "compFit",
      "type": "red",
      "text": "Base salary below floor",
      "evidence": "Posted range: $120K-$140K vs. $150K floor",
      "configuredEntry": null,
      "severity": "hard",
      "delta": -3.0
    }
  ],
  "qualifications": [...],
  "compAssessment": { "baseAmount": 130000, "baseVsFloor": "below_floor", ... },
  "coopTake": "One-sentence verdict",
  "jobSnapshot": { ... }
}
```

The AI suggests `delta` values, but the code can override them based on configured severity weights. This gives the user a tuning knob without changing the AI prompt.

### What the code computes

For each dimension:
1. Collect all flags where `flag.dimension === dimKey`
2. Sum deltas: `dimScore = clamp(5.0 + sum(deltas), 1, 10)`
3. Round to 1 decimal

Final score: `sum(dimScore * weight) / 100`, rounded to nearest 0.5.

This makes every score explainable: "Role Fit is 7.5 because +1.5 (greenfield ownership) +1.0 (startup stage match) = 5.0 + 2.5 = 7.5".

### Storage: single path

After scoring, `scoreOpportunity` writes everything to `entry.jobMatch`:

```js
entry.jobMatch = {
  score: 7.5,
  scoreBreakdown: {
    qualificationFit: 8.0,
    roleFit: 7.5,
    cultureFit: 6.0,
    companyFit: 7.0,
    compFit: 5.0,
  },
  scoringWeightsSnapshot: { qualificationFit: 20, roleFit: 20, cultureFit: 25, companyFit: 20, compFit: 15 },
  flagsFired: {
    qualificationFit: { green: [...], red: [...] },
    roleFit: { green: [...], red: [...] },
    // ...
  },
  neutralFlags: { ... },
  dimensionRationale: { qualificationFit: "...", ... },
  qualifications: [...],
  compAssessment: { ... },
  quickTake: [...],     // 2-4 headline signals
  coopTake: "...",
  roleBrief: { roleSummary, whyInteresting, concerns, compSummary, qualificationMatch },
  conversationInsights: "...",  // only when emails/meetings/notes exist
  hardDQ: { flagged: false, reasons: [] },
  scoreRationale: "qual 8×20% + role 7.5×20% + ...",
  lastUpdatedAt: Date.now(),
  lastScoringUsage: { model, input, output, cost },
};
```

Also stored on the entry: `jobSnapshot` (salary, workArrangement, equity, location, employmentType) and surface fields (`fitScore`, `fitReason`, `quickTake`).

`strongFits` and `redFlags` are explicitly deleted — replaced by `flagsFired` (grouped by dimension with severity deltas).

### Single scoring function

`analyzeJob` was fully removed. All scoring goes through `scoreOpportunity` via the `SCORE_OPPORTUNITY` message. It loads all context directly from the saved entry (JD, firmographics, emails, meetings, notes, contacts) — no separate "quick" vs "full" context modes. One function, one path, no competing writes.

---

## What shipped

1. Deterministic 5-dimension scoring in `scoreOpportunity` — AI returns fired flags + evidence, code computes scores
2. All results stored on `entry.jobMatch` with `scoreBreakdown`
3. `analyzeJob` removed entirely — all callers (saved.js rescore, score-match, stage-transition) migrated to `SCORE_OPPORTUNITY`
4. `ANALYZE_JOB (removed)` message handler removed from background.js
5. `jobSnapshot` extraction (salary, arrangement, equity) folded into `scoreOpportunity`
6. Comp auto-extraction from jobSnapshot to top-level entry fields
7. Queue UI reads unified `entry.jobMatch.scoreBreakdown` — breakdown bars, flag drawers, math rows all work

---

## Files touched

| File | Changes |
|------|---------|
| `scoring.js` | Deterministic scoring in `scoreOpportunity`, `analyzeJob` deleted, jobSnapshot extraction added |
| `background.js` | `ANALYZE_JOB (removed)` handler removed, `analyzeJob` import removed |
| `saved.js` | All 3 `ANALYZE_JOB` callers migrated to `SCORE_OPPORTUNITY`, auto-rescore on stage transitions removed, dead richContext removed |
| `sidepanel.js` | Dead `triggerJobAnalysis` removed, stale comments updated |
| `queue.js` | Reads unified `entry.jobMatch.scoreBreakdown` |
| `docs.html` | Scoring docs updated to reflect unified model |
| `CLAUDE.md` | `ANALYZE_JOB (removed)` removed from IPC table |
