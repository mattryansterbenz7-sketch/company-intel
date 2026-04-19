---
name: Label stacked-cue purge (issue #248)
description: Platform-wide rewrite of label/caption/header rules removing the banned uppercase+tracking+tertiary+bold-800 stacked-cue formula
type: project
---

Issue #248: DESIGN.md disallows the stacked-cue formula (uppercase + letter-spacing + tertiary color + font-weight 800) for labels/captions/section headers. Across `saved.html`, `integrations.html`, `coop-settings.html` the diff removes this formula in ~33 rules. Pattern summary:

- `font-size: 10-11px` → `12-13px`
- `font-weight: 800` → `700` (for strong labels), `700` → `600` (subordinate)
- `color: var(--ci-text-tertiary)` → `secondary` (default) or `primary` (for real section headers with borders)
- `text-transform: uppercase` removed
- `letter-spacing: 0.04em-0.09em` removed
- Pill/badge fill colors preserved; only typographic cues stripped

**Why:** Stacked cues produce a "system-app" look incompatible with the claude.ai aesthetic. Sentence case + weight/size hierarchy does the same job without the tech feel.

**How to apply:**
- Display/hero typography (page-title, headlines, score numbers, swipe-indicators) keeps font-weight 800 — the purge only targets labels/captions/section headers, not big display numbers.
- When hierarchy-shifting a rule, check parent container (size bump from 10→12px inside a 10px parent can invert hierarchy).
- For grid columns with fixed widths sized to old 10px text, the 12px bump may overflow; check especially `Tokens`/`Context`/longer header labels in cramped grids.
- DOM-text in ALL-CAPS like "PASS"/"APPLY" should convert to sentence case at the same time.
- `.swipe-overlay .swipe-label` keeps `letter-spacing: 0.04em` **without** uppercase — that's fine; the banned pattern is the full stack, not tracking alone.
