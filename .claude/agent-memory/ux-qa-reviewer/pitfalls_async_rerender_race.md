---
name: Async re-render races with appended elements
description: Common bug pattern when appending toasts/banners after a function that replaces container.innerHTML via chrome.storage.local.get
type: feedback
---

When a rerender function does `chrome.storage.local.get(..., cb => container.innerHTML = '...')`, it returns synchronously but the innerHTML replacement happens later in a storage callback. Anything appended to `container` between the rerender call and the storage callback firing gets wiped when innerHTML is replaced.

**Why:** Seen multiple times in saved.js / company.js delete flows where an undo banner is appended right after a rerender — the banner flashes in and disappears, or never appears, because the async innerHTML replacement clobbers it.

**How to apply:** When reviewing code that looks like:
```
rerenderFn();         // async — starts a storage.get
appendBanner(container);  // sync — attaches to the same container
```
…flag it. Either (a) append the banner OUTSIDE the re-rendered container (e.g., pipeline overview appends to `.activity-tasks-col`, not `#activity-tasks-list`), or (b) pass a callback to rerenderFn and append in the completion callback.
