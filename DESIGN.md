# DESIGN.md

Design language for Coop.ai. Every UI decision runs through this doc. When a principle here and a stylistic instinct disagree, the principle wins.

This is a living document but not a collaborative one — it has a point of view on purpose. If it starts hedging, it stops being useful.

## Why this exists

The visual grammar now associated with AI-generated software — gradient badges, emoji-as-icons, oversized scores, rubber-stamp graphics, highlighter-yellow field values, rainbow "AI magic" accents — is becoming the tell that a product was vibe-coded rather than designed. As more people ship tools built with Claude Code and similar, that aesthetic is converging into a recognizable look.

Coop's ideas are substantive. The surface has to communicate that, not disappear into the slop wave. This doc is how we hold the line.

## Reference set

Three products triangulate the bar. When unsure, ask: "would this fit next to these?"

- **Linear** — the canonical "this is what product SaaS looks like when a designer actually worked on it" reference. Benchmark for *not looking vibe-coded*.
- **Raycast** — monochrome discipline, density without clutter, outline icons (not emoji), negative space does the separating.
- **Superhuman** — typographic hierarchy carries the weight. Real font pairing (size + weight + spacing), not a single weight at three sizes. Speed is implied by the UI.

**Granola** is the secondary reference for meeting-related surfaces specifically — see [#113](https://github.com/mattryansterbenz7-sketch/company-intel/issues/113).

## What Coop refuses to look like

A concrete, growing list. If a change adds any of these, it doesn't ship.

- **Emoji used as icons.** 🔥 HOT / 🐋 TIER 1 / 🚩 FLAG / ✨ AI / 🎯 MATCH. If a concept needs an icon, it gets a real outline icon (or no icon).
- **Gradient pills and badges.** Flat fills in semantic colors, or no fill.
- **Stacked decorative pills.** Three pills in a row with different gradient colors conveying vaguely similar things. If two pills mean roughly the same thing, one of them is wrong.
- **Oversized scores with decorative accents.** A score is data. It presents like data — numerical, typographically weighted, no flame or rocket emoji, no orange gradient bar, no "/10" in a giant circle unless the circle earns its size by carrying real visual weight in the layout.
- **Rubber-stamp / ribbon / badge graphics.** "QUALIFIED" diagonally over a field. Never.
- **Highlighter-yellow field values.** Data is black text on white. Emphasis is weight, not background color.
- **Red-flag emoji (🚩) as a visual concern marker.** If a value warrants attention, the design surfaces that — outline, color, position — not a decorative emoji after it.
- **Rainbow gradients as "AI magic" signals.** Anthropic orange is the brand accent. We don't pretend to be magical.
- **Linear CSS easing.** Default transitions are a tell. Everything eases.
- **Generic spinners on operations longer than 400ms.** See motion rule 4.
- **Three drop shadows stacked on three nested containers.** Depth is earned by layering *content*, not boxes.

## Visual principles

### 1 · Typography does the work

Hierarchy is size, weight, spacing, and rhythm — not color, not decoration. Three headings in three shades of gray is a design failure if size and weight could have carried it.

A real type scale: display / h1 / h2 / body / caption / mono. At most two weights per surface. Line-height is part of the hierarchy, not an afterthought.

### 2 · Color is semantic, not decorative

Color means something. It carries exactly one job per context:
- **Red** = destructive or danger
- **Green** = success or positive confirmation
- **Amber / orange** = brand accent, used sparingly (attention, active state)
- **Gray scale** = everything else

Color used decoratively — "this section looks better with a blue tint" — comes out. If you can't answer *"what does this color mean?"*, don't use it.

### 3 · Monochrome first, color earned

Default a new surface to grayscale. Add color only where a semantic meaning requires it. A screen in pure grayscale should still communicate its hierarchy clearly — if it doesn't, the problem is hierarchy, not color.

### 4 · One border, or no border — not three

Borders, backgrounds, and shadows are three ways to separate content. Pick **one** at a time. Cards inside cards inside tinted sections with drop shadows is a layering failure. Negative space and typography do the separating first; a single thin border or a subtle background fill is the second pass.

### 5 · Density over decoration

Dense, well-organized information beats spacious decorated information. The reference products (Linear, Raycast, Superhuman) all carry high information density because they've earned it with hierarchy and restraint. Low-density screens that feel "spacious" are usually under-designed, not premium.

### 6 · Earn every pixel of ornament

If a pill, badge, icon, divider, or accent isn't telling the user something they didn't already know — kill it. Decoration without information is the slop signature.

## Motion principles

Motion is not a polish layer. It's one of the clearest premium signals in software, and the principles are as important as the visual ones.

### 1 · Motion explains, not decorates

Every animation answers one of three questions:
- **What just happened?** State change — card moved, field updated, message sent.
- **Where am I going?** Navigation — panel opens, view expands, modal appears from its source.
- **What's the system doing right now?** Progress — data loading, AI generating, save pending.

If an animation doesn't answer one of those, it's decoration. It comes out.

### 2 · Fast by default, slow only when earned

- Small state changes (hover, toggle, field update): **120–200ms**
- Standard transitions (card move, panel reveal, tab switch): **200–300ms**
- Larger spatial moves (side panel opens, full-page transition): **300–400ms**
- Anything over 400ms is tied to real work and must be narrated (see rule 4).

### 3 · Consistency is the product, not variety

Pick one duration scale and one easing family. Use values from it everywhere. Feeling intentional comes from discipline, not cleverness.

**Duration scale**
- `--motion-xs: 120ms`
- `--motion-sm: 200ms`
- `--motion-md: 300ms`
- `--motion-lg: 400ms`

**Easing**
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` — arrivals (default for things appearing)
- `--ease-in: cubic-bezier(0.7, 0, 0.84, 0)` — exits
- `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` — tactile interactions (drags, toggles, drops)
- **Linear easing is banned.** The default CSS `transition: all 0.3s` is the tell.

### 4 · Slow operations get narrative motion, not spinners

This is the single biggest motion opportunity. Today, the research pipeline, scoring, and enrichment all show generic loading states. Premium treatment:

- **Research pipeline**: show the actual chain (Apollo → Serper → Claude) with inline status updating as each stage completes. Fields fill in as data arrives, rather than everything appearing at once after a spinner.
- **Scoring**: the five dimensions resolve progressively — each dimension's check completes visibly before the final score eases in.
- **AI chat**: streaming text at a rate that feels like thinking, not typing. Granola-quality is the bar ([#79](https://github.com/mattryansterbenz7-sketch/company-intel/issues/79)).
- **Save / sync**: optimistic UI — update acknowledges instantly, persistence happens silently, errors surface inline.

The rule: **if something takes longer than 400ms, the UI has to tell the user what it's doing.** Spinners are the slop default. Narrative progress is the premium move.

## Chat is a first-class surface

The chat experience with Coop — in the side panel and in the full-screen views (company, opportunity, meeting) — is not a secondary UI. It's one of the primary surfaces a user touches every session, and it's where the slop aesthetic tends to compound most quickly (pill chips, model badges, gradient accents, generic streaming, cluttered headers).

Every rule above applies to chat, but with extra attention to:

- **Message rendering** — typographic rhythm, generous line-height, code blocks and lists that feel native to a real writing surface. No chat-bubble gradients, no avatar glow effects.
- **Streaming** — tokens arrive at the pace of thought, not the pace of the API. See [#79](https://github.com/mattryansterbenz7-sketch/company-intel/issues/79). Granola-quality is the bar.
- **Tool-use transparency** — when Coop calls a tool, the user sees *what* and *why* in restrained, in-line UI. Not a collapsible gray box; a first-class element.
- **Prompt chips** — contextually scoped to the surface (meeting surfaces don't show "Cover letter"; see [#191](https://github.com/mattryansterbenz7-sketch/company-intel/issues/191)). Visually quiet, pill-shaped but not decorative.
- **Header affordances** — clear separation between navigation actions (back, open-in-CRM) and panel controls (resize, pin, close). See [#193](https://github.com/mattryansterbenz7-sketch/company-intel/issues/193).
- **Model indicator** — honest, compact, not a gradient badge. Shows actual model in use. Fallback state surfaces naturally (see [#173](https://github.com/mattryansterbenz7-sketch/company-intel/issues/173)).
- **Motion during slow responses** — when a long tool call is running, narrative progress: "Reading 3 emails from Brian Bird..." rather than a spinner.

Chat gets its own sub-issue in the audit queue, covering both side panel and full-screen variants.

## How this gets enforced

- **Every UI diff references this doc.** "Does this comply with DESIGN.md?" is a mandatory check before merge.
- **The `ux-qa-reviewer` agent runs with this doc in its system prompt.** After each UI change, it posts a review flagging any violations.
- **Motion changes are human-reviewed until the agent is calibrated.** Visual judgment is easier to codify than motion judgment. Matt reviews every motion-touching diff until a recorded baseline proves the reviewer can catch regressions on its own.
- **Audit queue under [#189](https://github.com/mattryansterbenz7-sketch/company-intel/issues/189).** Sub-issues apply these principles to specific surfaces. The principles come first; the surface audit is the application.

## Signoff

This doc is a product artifact, not a committee output. Matt owns it. Amendments happen deliberately, not by drift. If something isn't covered here and a designer/agent needs to make a call, the default is *restraint* — add less, not more.
