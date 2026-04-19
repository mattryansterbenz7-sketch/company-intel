---
name: Stage color hex matching brittleness
description: DEFAULT_OPP_STAGES/DEFAULT_COMPANY_STAGES hexes differ from design-token accent hexes
type: feedback
---

Don't map stage color treatments by comparing `stage.color` hex against design-token hex values (`#36b37e`, `#4573d2`, `#f5a623`, `#e8384f`).

**Why:** the shipped DEFAULT stage palette in company.js lines 209–226 uses a different set of hexes (`#64748b`, `#22d3ee`, `#a78bfa`, `#fb923c`, `#60a5fa`, `#a3e635`, `#4ade80`, `#f87171`). No default stage color will ever hex-match an accent token, so the hex branch is dead for default users. Custom stages with arbitrary hexes also won't match. Result: most stages fall through to the key-substring heuristic (which itself is partial — "watchlist", "networking", "interested", "archived", "needs_review", "intro_requested" all return empty → default coral).

**How to apply:** if a feature needs stage-color theming, either (a) map by stage `.key` to a semantic bucket, (b) use the raw `stage.color` value directly as inline style (with contrast fallback), or (c) extend stage metadata to carry a semantic color role. Don't pretend hex-match works against arbitrary palettes.
