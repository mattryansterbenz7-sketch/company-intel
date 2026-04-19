---
name: Stage-change UIs must sync both header and sidebar dropdowns
description: Opportunity page has TWO stage dropdowns — hdr-opp-stage (header pill) and opp-stage-select (sidebar properties). Stage-change handlers that update only one go out of sync.
type: feedback
---

The opportunity page (`company.js` for isOpportunity entries) has two stage selectors:

- `hdr-opp-stage` — the prominent colored pill in the page header (line ~621)
- `opp-stage-select` — the dropdown in the sidebar properties panel (line ~1012)

The existing `hdr-opp-stage` change handler (line ~656) is the authoritative stage-change flow. It:
- Clears timestamps for stages ahead when moving backward
- Updates `actionStatus` via `applyAutoStage()`
- Fires configured stage celebrations (`_fireCelebration`)
- Calls `maybeRescore('stage_transition')` for non-rejected moves
- Updates the Action On dropdown

Custom handlers that advance stages via `saveEntry({ jobStage: ... })` directly (e.g., new "Apply" / "Not interested" buttons in Role Brief v2 footer) typically:
- Skip the celebration fire
- Skip `maybeRescore`
- Only update one dropdown (usually `opp-stage-select`), leaving `hdr-opp-stage` visually stale
- Miss the Action On sync

**Why:** The header pill is the user's primary stage indicator. If it shows "Want to Apply" after clicking Apply, the user is confused. And missing `_fireCelebration` is a UX regression for users who've configured celebrations.

**How to apply:**
- When reviewing new stage-change flows, check both dropdowns get synced.
- Better: dispatch a synthetic `change` event on `hdr-opp-stage` to route through the canonical handler, OR factor the handler into a `changeStage(newStage)` helper both paths call.
- Flag 🟡 when a new flow mutates jobStage directly without syncing hdr-opp-stage or running the celebration + rescore side effects.
