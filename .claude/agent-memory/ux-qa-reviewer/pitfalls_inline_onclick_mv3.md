---
name: Inline onclick blocked by MV3 CSP
description: MV3 default script-src 'self' blocks onclick="..." attributes — MANDATORY grep on every UI review, enforced as Step 0 mechanical check
type: feedback
---

Inline event handler attributes (`onclick="..."`, `onchange="..."`, `onfocus="..."`, `onkeydown="..."`, etc.) injected via innerHTML or template strings are blocked by Manifest V3's default `script-src 'self'` CSP. The button still renders; the handler silently no-ops. Chrome logs no visible error in extension pages.

**Why:** Coop.ai uses MV3 with no CSP override in manifest.json, and MV3 forbids `'unsafe-inline'`. This rule was in memory as advisory guidance and the agent STILL let 17 inline handlers ship across 8 extension-page files ([#274](https://github.com/mattryansterbenz7-sketch/company-intel/issues/274) — sidepanel.js, saved.js, inbox.js, company.js, opportunity.js, queue.js, coop.js, coop-settings.js). Judgment-based flagging has proven insufficient for this pattern; it needs a deterministic grep.

**How to apply — MANDATORY mechanical pre-check (Step 0 of Review Process):**

On every UI-touching review, for each `*.js` file in the diff **except** `content.js` and `coop-assist.js`, run:

    Grep(pattern='\bon[a-z]+\s*=\s*["\']', path=<file>, output_mode='content', -n=true)

Any match fails the review. Report every occurrence with `file:line` as 🔴 Critical and block merge. Do not proceed to the qualitative checks while any match exists. Fix is always: rebind to the page's existing delegated click listener (grep for `addEventListener('click'` to find it) and use a `data-action` attribute or class hook.

**Exception:** `content.js` and `coop-assist.js` are content scripts running in host-page context (not extension-page CSP); do not grep these for this rule.

**History:** First surfaced on docs-tab review (three Collapse buttons in `_docsRenderPreview`). Promoted to mandatory Step 0 mechanical check after [#274](https://github.com/mattryansterbenz7-sketch/company-intel/issues/274) showed the soft-advisory version of this memory wasn't enough.
