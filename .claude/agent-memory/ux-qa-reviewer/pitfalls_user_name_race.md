---
name: User-name async load race vs render
description: Loading _chatUserFirstName via storage callback can lose a race against initial panel render
type: project
---

chat.js #251 derives the user's first name once via an IIFE that calls `chrome.storage.sync.get(['prefs'])`. The result is assigned to module-scope `_chatUserFirstName`. `renderHistory()` and `renderPrevSessions()` read the variable at render time.

Race: if the initial render (especially previous-sessions render, which runs after its own `chrome.storage.local.get` callback) lands before the name lookup resolves, the label renders as "You" instead of the configured first name. There is no re-render trigger — the panel does NOT repaint when `_chatUserFirstName` later updates.

**Why:** Chrome storage callbacks resolve in indeterminate order. The user's identity won't appear on historical messages or the initial view until a subsequent render is triggered (e.g. they send a message).

**How to apply:**
1. Store async-loaded values with a `chrome.storage.onChanged` listener so mid-session prefs edits take effect.
2. Consider resolving `_chatUserFirstName` BEFORE rendering, or re-render after the load resolves.
3. This pattern (module-level async load + subsequent synchronous renders) is a common source of intermittent "label says 'You' on first load but updates later" bugs in chat.js.
