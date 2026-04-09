# F2 · Open Application → Auto-bind Coop

## Desired UX

When the user taps **Open Application** on a queue card:

1. Job URL opens in a new tab.
2. Side panel opens on that tab.
3. Coop is immediately bound to the opportunity — name shows in the bind button, chat has full context (emails, meetings, transcripts, job match), ready for the first message.
4. No extra clicks. No "Bind" lookup. No home screen.

---

## What exists today

**`queue.js` (line 381–403)**

Before opening the tab, writes a handoff token to `chrome.storage.session`:

```js
await chrome.storage.session.set({ pendingSidePanelBind: { entryId: c.id, ts: Date.now() } });
const tab = await chrome.tabs.create({ url: c.jobUrl, active: true });
await chrome.sidePanel.open({ tabId: tab.id });
```

**`sidepanel.js` (line 3144–3175)**

On panel load, an IIFE reads the handoff token:

```js
(async () => {
  const pending = await readFromSessionOrLocal('pendingSidePanelBind');
  // freshness guard (2 min TTL)
  const entry = savedCompanies.find(e => e.id === pending.entryId);
  currentSavedEntry = entry;
  window.__coopBind.set(entry.id, { auto: true }); // sets _boundEntryId, _autoBindActive = true
  clearPendingBind();
})();
```

---

## Why it doesn't work

### Root cause: auto-bind is not sticky

The `__coopBind` auto-bind sets `_autoBindActive = true` but does **not** set `_manualLinkId`.

After the IIFE runs, the new tab finishes loading and fires `chrome.tabs.onUpdated`. The tab-change handler runs, checks `_manualLinkId` (line 1203) — it's `null` — and falls through to the **reset path** (line 1232–1233):

```js
currentResearch = null;
currentSavedEntry = null;   // ← kills the IIFE's bind
```

Then `triggerResearch(company, true)` → `checkAlreadySaved(company)` runs. If content script detects the right company name and it fuzzy-matches the entry, the bind is reconstructed. If detection fails (ATS page with no OG tags, redirect URL, blank form), it calls `renderHomeState()` and the panel shows blank.

### Secondary failure: `onUpdated` fires multiple times

Tab load fires `onUpdated` with status `"loading"` (blank content) then `"complete"`. Each triggers a new detection cycle. Even if the first cycle gets it right, the second one resets and re-runs. The bind button flickers.

### Summary

| Scenario | Result |
|---|---|
| ATS page (Greenhouse, Lever, Ashby) — company name detectable | Eventually re-binds via name match. May flicker. Works. |
| LinkedIn job URL | Eventually re-binds if `/jobs/view/{id}` resolves. May flicker. |
| Company career site, redirect URL, or application form | Content script fails → home state → blank panel. Fails. |
| `_manualLinkId` is set | Sticky — never blown away. Always works. |

---

## Fix

### Part 1 — Make the queue auto-bind sticky

In the pending-bind IIFE, after setting `window.__coopBind.set(entry.id, { auto: true })`, also set `_manualLinkId`:

```js
// Expose _manualLinkId setter (or set it directly in __coopBind.set)
window.__coopBind.setManual(entry.id);  // new method
```

**Or simpler**: add a `queueBind` variant to `__coopBind`:

```js
// In __coopBind definition:
setFromQueue(id) {
  _boundEntryId = id;
  _autoBindActive = true;
  _manualLinkId = id;      // <-- this is what makes it sticky
  currentSavedEntry = ...  // already set before this call
  updateBindBtnLabel();
},
```

Then in the pending-bind IIFE: `window.__coopBind.setFromQueue(entry.id)`.

This makes the queue auto-bind survive tab load cycles — the tab-change handler sees `_manualLinkId`, skips the reset, and preserves `currentSavedEntry`.

### Part 2 — Render the company state immediately

Even with `_manualLinkId` set, the tab-change handler currently calls `triggerResearch(linked.company, false)` and re-renders. Since `currentSavedEntry` is already loaded (from the IIFE), `checkAlreadySaved` returns immediately from cached data and `currentResearch` is set — so `triggerResearch` short-circuits at line 1678:

```js
if (currentResearch && !forceRefresh) {
  console.log('[SP] Using saved research data — skipping API calls');
  return;
}
```

This means the UI renders from saved data (fast, no API). The only gap: we need `currentResearch` to be pre-populated in the IIFE (same way `checkAlreadySaved` does it), so the company card renders before any tab-change event fires.

Add to the pending-bind IIFE (after loading the entry):

```js
// Pre-populate research from saved entry so triggerResearch short-circuits
if (entry.intelligence || entry.employees || entry.industry) {
  currentResearch = {
    intelligence: entry.intelligence,
    employees: entry.employees,
    funding: entry.funding,
    founded: entry.founded,
    industry: entry.industry,
    companyWebsite: entry.companyWebsite,
    reviews: entry.reviews || [],
    leaders: entry.leaders || [],
    jobMatch: entry.jobMatch,
    jobSnapshot: entry.jobSnapshot,
  };
}
```

### Part 3 — Show company UI (not home state) immediately

The panel opens showing the home state until company detection completes. Add to the IIFE:

```js
// Show company UI immediately — don't wait for content script detection
const homeEl = document.getElementById('sp-home');
if (homeEl) homeEl.style.display = 'none';
const contentEl = document.getElementById('company-content');
if (contentEl) contentEl.style.display = '';
companyNameEl.textContent = entry.company;
if (entry.jobTitle) currentJobTitle = entry.jobTitle;
updateJobTitleBar();
if (currentResearch) renderResults(currentResearch);
if (entry.jobMatch) renderJobOpportunity(entry.jobMatch, entry.jobSnapshot || null);
showSaveBar();
saveBtn.textContent = '✓ Saved';
saveBtn.classList.add('saved');
showCrmLink(entry);
```

---

## Implementation scope

| File | Change |
|---|---|
| `sidepanel.js` — `__coopBind` definition | Add `setFromQueue(id)` method that also sets `_manualLinkId` |
| `sidepanel.js` — pending-bind IIFE | Pre-populate `currentResearch`, render company UI, call `setFromQueue` |
| No changes needed | `queue.js`, `background.js`, `content.js` |

---

## Verification checklist

- [ ] Click **Open Application** on a queue card with a saved Greenhouse URL → panel opens showing the opportunity bound immediately, bind button shows company name
- [ ] Same test with a LinkedIn job URL
- [ ] Same test with a direct company career page URL where content script fails detection
- [ ] Panel shows company data (not home screen) before content script fires
- [ ] Bind button is stable — does not flicker from bound → unbound → bound
- [ ] Chat context includes job match, meetings, emails without clicking anything
- [ ] Closing and reopening the panel on the same tab does NOT re-bind from the (already-cleared) pending token
- [ ] Navigating away from the tab and back re-uses the sticky `_manualLinkId` bind
- [ ] Clicking the bind button's ✕ unbinds and shows home state (user explicitly cleared it)
