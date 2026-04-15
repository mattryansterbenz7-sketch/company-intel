---
name: Queue page patterns
description: Score breakdown section uses bar rows + segmented toggle strip + detail panels (replaced accordion dimRows)
type: project
---

Queue card score breakdown has three layers:
1. `qc-breakdown` div with `queue-dim-bar-row` items (always visible, clickable to select)
2. `queue-dim-toggle` segmented strip with `queue-dim-toggle-btn` buttons (one per dimension)
3. `queue-dim-details` container with `queue-dim-detail` panels (one active at a time via `.active` class)

Qualifications is auto-selected on load. Clicking active toggle deselects. Bar row clicks proxy to toggle `.click()`.

**Why:** Replaced per-dimension accordion expand/collapse with single-selection model.
**How to apply:** When reviewing queue.js changes, check that all three layers stay in sync during DOM generation and that click handlers propagate correctly.
