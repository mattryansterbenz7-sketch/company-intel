---
name: Score color hex divergence across surfaces
description: Two different hex palettes map to the same 4-tier score spectrum — saved.js uses darker desaturated, company.js rb2 uses bright saturated
type: feedback
---

Job score colors use the same 4-tier threshold (>=7.5 / >=6.0 / >=4.5 / <4.5) across surfaces BUT two different hex palettes:

- `saved.js` / `saved.html` (Kanban card `.kc-score`): `#047857 / #b45309 / #c2410c / #b91c1c` — darker, desaturated
- `company.js` Role Brief tab v2 rb2-score: `#36B37E / #F5A623 / #FC636B / #E8384F` — bright, saturated (matches design tokens)

The bright palette IS the token palette (`--ci-accent-teal / --ci-accent-amber / --ci-accent-primary / --ci-accent-red`). The kanban hexes predate the token scheme.

**Why:** The memoed spec says "same thresholds AND classes" but reality has diverged in hex values. The score number for the same opportunity may look different on the Kanban card vs. the full-page Role Brief tab.

**How to apply:**
- When reviewing score color rendering, note which palette is in use.
- Flag as a 🟡 consistency issue if a new surface uses one palette when the others use the other.
- Also watch for: a THIRD threshold scheme used for dimension-score mini-rows (`val >= 7 / >= 5 / else` — 3 tiers, no threshold at 4.5). The rb2-bars micro-bars use yet ANOTHER 3-tier scheme (`< 4.5 coral, < 6.0 amber, else teal`). Three threshold schemes can appear in one card.
- The "canonical" token palette is bright/saturated — kanban should eventually migrate.
