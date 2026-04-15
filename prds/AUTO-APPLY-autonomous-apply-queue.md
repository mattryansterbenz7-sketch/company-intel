# PRD AUTO-APPLY — Autonomous Apply Queue

## Status

**Future** — dependent on scoring calibration (B2), voice profile system, and application mode (APP-MODE) shipping first.

## Problem

Applying to jobs is high-volume, low-leverage manual work. Each application takes 30-60 minutes of copying context between tabs, answering repetitive questions, and clicking through multi-step forms. At 30+ active opportunities, this doesn't scale. The user spends more time filling forms than evaluating fit.

Coop already has the data to fill most fields — company intel, job description, Story Time profile, voice profile, answer library, user prefs. The missing piece is the automation layer that connects that data to ATS form fields and manages the submission pipeline.

---

## Vision

A queue-based system where the user sends opportunities to Coop's Apply Queue, and Coop works through them — filling fields, drafting answers, and (at higher trust levels) submitting autonomously. When Coop can't confidently answer something, it surfaces one targeted question instead of dumping the whole application back on the user.

Going from "1 hour per application" to "queue 20, answer a few clarifying questions, done."

---

## Prerequisites

These must ship before autonomous apply is viable:

1. **Score calibration** (B2 in backlog) — The Apply Queue must queue the right jobs. Unreliable scoring means Coop wastes effort on bad-fit opportunities.
2. **Voice profile system** — An autonomous agent that sounds like generic LLM slop hurts the user's brand more than it helps. Every draft must pass through the voice filter.
3. **Application mode** (APP-MODE PRD) — Question archetype detection, answer library, and smart templates are the foundation the queue's answer generation builds on.

---

## User Experience

1. Browsing a job posting (or viewing one in pipeline) -> "Send to Coop's Apply Queue" button
2. Item lands in Apply Queue (sibling to triage Queue)
3. Coop works through queue in background. Status updates as it progresses.
4. When Coop hits something it can't answer confidently -> item flips to `needs_input`, surfaces ONE targeted question, not the whole application
5. Done -> status `applied`, full transcript of every field saved to entry

---

## The Apply Loop

```
For each queued application:
  1. Open application URL in a new tab (chrome.tabs.create)
  2. Content script scans DOM -> extracts every form field schema
  3. Sends schema to background.js -> Coop (Claude)
  4. Coop receives: field schema + JD + company intel + Story Time profile
     + voice profile + resume + answer library + user prefs
  5. Coop returns: { fills: [...], blockers: [...] }
  6. Content script applies fills (set value + dispatch input/change for React forms)
  7. If blockers -> status: needs_input, surface to user
  8. If no blockers -> pre-submit screenshot (audit) -> click submit
  9. Wait for confirmation page -> status: applied
  10. Close tab
```

---

## Key Engineering Pieces

### Field detection (content.js)

Walks `input`/`textarea`/`select`, label association via `for=`, wrapping label, `aria-label`, nearest text node. Per-ATS overrides for Greenhouse, Lever, Workday, Ashby. Generic fallback.

### Field filling

- Text/textarea: native value setter trick + dispatch `input`/`change`/`blur` events (React/Angular forms don't respond to simple `.value = x`)
- Selects: find option by label match + dispatch `change`
- File uploads: the hard part — first encounter per ATS = `needs_input` blocker, then remember pattern. Resume uploaded once, ATS session caches OR File System Access API where supported
- Multi-page forms: detect Next/Continue buttons, navigate sequentially, re-scan fields per page

### Background (background.js)

New `APPLY_FILL_FORM` message type. Prompt makes Coop conservative — only fill if highly confident, otherwise mark as blocker.

### Apply Queue UI (applyQueue.html / applyQueue.js)

Status pills, expandable transcript per item, pause/resume, per-item retry/skip/manual-mark-done.

---

## The Trust Ladder

User dials up autonomy as confidence grows. Default Level 2.

| Level | Behavior |
|-------|----------|
| **Level 1 — Draft only** | Coop fills, user reviews every field, user clicks submit |
| **Level 2 — Confirm before submit** (default) | Coop fills, opens tab in foreground, user eyeballs 30s, clicks submit |
| **Level 3 — Auto-submit with notification** | Coop fills + submits in background tab, notification with "View what I submitted" link. Per-company opt-in. |
| **Level 4 — Fully autonomous** | Queue runs unattended, dashboard check later. For users who've watched it work for weeks. |

Setting lives in Coop preferences.

---

## "Always Ask" List

A configurable list of patterns/topics Coop will always surface as blockers rather than auto-fill, regardless of autonomy level. Editable in Coop preferences.

Suggested initial seeds (user to override):
- Demographic/EEO questions — per user preference
- File uploads on first encounter with new ATS (technical limitation)
- Anything with credit card / payment / hidden agreement keywords (safety check, not configurable)

The user configures what Coop is allowed to answer autonomously.

---

## Data Model

```javascript
// chrome.storage.local

applyQueue: [
  {
    id,
    companyId,
    jobTitle,
    applicationUrl,
    status,          // queued | in_progress | needs_input | applied | failed | skipped
    blockers,        // [{ fieldId, question, reason }]
    transcript,      // [{ fieldLabel, value, source }] — full audit of what was filled
    autonomyLevel,
    createdAt,
    startedAt,
    completedAt,
    error
  }
]

coopAutonomy: {
  defaultLevel: 2,
  alwaysAsk: [...],
  submitConfirmationRequired: true,
  perCompanyOverrides: { [companyId]: level }
}
```

---

## Risks & Mitigations

1. **Coop fills wrong -> user looks bad**: Level 2 default. Full audit transcript. Voice profile prevents tonal mismatches. Conservative confidence threshold.
2. **Non-standard forms**: Per-ATS detectors for the big 5 (Greenhouse, Lever, Workday, Ashby + generic). Failed detection -> `needs_input` -> user fills manually + Coop learns the pattern.
3. **CAPTCHAs**: Rare on ATSs but a hard wall. If hit -> `needs_input`, user solves manually, Coop continues with remaining fields.
4. **File upload limitation**: First time per ATS = `needs_input` blocker. Resume pattern learned after first successful upload.
5. **Hidden payment/commitment**: Coop scans page pre-submit for "credit card", "payment", "agreement", "I confirm" -> abort if hit, never auto-submit.
6. **Wrong-company submission**: Pre-submit validation. URL match + company name appears on page. If mismatch -> abort and flag.
7. **ATS selector breakage**: Same fragility as LinkedIn detection, multiplied by 4-5 platforms. Each with dozens of field variants. Requires ongoing maintenance of per-platform adapters.

### The honest brand risk

The biggest risk isn't technical — autonomous submission is brand-defining. One bad submission to a top-tier target hurts more than 50 good ones help. Trust ladder + audit transcript + always-ask list are non-negotiable.

---

## Build Sequence

**Milestone 1 — Draft mode (proves field detection)**
- Form scanner in content.js
- `APPLY_FILL_FORM` message + Coop prompt
- Manual review UI overlay on application page
- Ship Level 1 only

**Milestone 2 — The queue**
- Apply Queue page + data model
- "Send to Apply Queue" button on opportunities + job pages
- Sequential processor in background.js
- Ship Level 2 (foreground tab, user clicks submit)

**Milestone 3 — Answer library integration**
- Wire up answer library from APP-MODE Phase 3
- Voice profile applied to every draft
- Ship Level 3 (background tab, auto-submit with notification)

**Milestone 4 — Trust + audit**
- Per-application transcript view
- Autonomy level controls in preferences
- Always Ask list editor
- Pre-submit safety checks (URL/company match, payment keyword scan)
- Ship Level 4 (fully autonomous queue)

---

## What NOT to build

- **Auto-submit as default** — Trust ladder starts at Level 2. Users opt into higher autonomy.
- **Separate application tracker** — The pipeline already tracks applications. The queue is a processing stage, not a data store.
- **Universal form filler** — Only ATS platforms with known structure. Don't try to fill arbitrary web forms.
- **CAPTCHA solving** — Surface to user as a blocker. Don't integrate third-party CAPTCHA services.
