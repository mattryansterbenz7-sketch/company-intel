---
name: CSS toggle patterns
description: How segmented toggle strips are styled across the extension (saved.html view-toggle vs queue.html dim-toggle)
type: project
---

Two toggle patterns exist:
1. **saved.html `view-toggle`**: `--ci-accent-primary` (#FC636B coral) active bg, `--ci-bg-inset` inactive bg, `border-radius: 8px 0 0 8px / 0 8px 8px 0`, `--ci-border-default` border. Active state uses coral bg with white text.
2. **queue.html `queue-dim-toggle`**: `--ci-bg-header` (#151B26 dark navy) active bg, transparent inactive bg, `border-radius: 8px` on container with `overflow: hidden`. Active state uses navy bg with white text.

**Why:** Different active colors for different contexts (coral for global view switch, navy for score dimension drill-down).
**How to apply:** When adding new toggles, choose the pattern that matches the context. The visual inconsistency between the two is intentional.
