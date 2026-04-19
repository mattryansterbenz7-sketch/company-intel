---
name: Shared class names across multiple rendering surfaces
description: The same CSS class (e.g. .task-no-company) is used on two different row wrappers (.task-row vs .task-item); new rules must account for both
type: feedback
---

saved.html has two task-rendering surfaces that share class names:

- Pipeline Overview uses `.task-row` wrappers and defines `.task-no-company { opacity: 0; } .task-row:hover .task-no-company { opacity: 0.5; }` — ghost-reveal pattern.
- Tasks full-view (renderTasksView) uses `.task-item` wrappers and has `.task-no-company { color: tertiary; font-style: italic; }` — always-visible italic label.

**Why:** Writing `opacity: 0` on the bare `.task-no-company` selector cascades into the Tasks full-view where no `.task-row` parent exists, making the label permanently invisible (regression seen in the #252 inline-edit diff).

**How to apply:** When touching `.task-no-company`, `.task-no-date`, `.task-text`, `.task-company`, `.task-check`, `.task-meta` in saved.html, scope new rules to `.task-row .task-no-company` (or `.task-item .task-no-company`) to avoid bleeding into the other surface.
