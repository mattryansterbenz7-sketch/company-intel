# BUG — Coop bind to entry doesn't surface meeting transcripts (and side panel header desyncs)

**Status:** Fix shipped 2026-04-07. Needs verification.
**Severity:** High — defeats the entire point of the manual bind feature (#11).
**Repro entry:** Vibrant Practice / Isaiah Crossman / Sunita Mohanty intro thread.

## Symptom

After clicking the 📎 bind button in the side panel Coop chat header and selecting "Vibrant Practice" from search results:

1. Chat header shows the bind chip ("Vibrant Practi…") — looks bound.
2. User asks Coop to draft a reply leveraging the Granola transcript with Isaiah.
3. Coop replies: *"I don't have access to your transcript with Isaiah from today. I can only see the email chain that's visible in your current screen."*
4. Scrolling up in the side panel reveals the detected card still shows **+ Save Company** for Vibrant Practice, even though Vibrant is already saved AND bound to the chat session below it. The header should show **View in CRM**.

Meanwhile, opening the same Vibrant Practice entry in the full CRM (`company.html`) clearly shows the full Granola transcript stored on the entry — so the data exists; it just isn't reaching Coop's prompt.

## Root causes (four interacting bugs)

### 1. `currentSavedEntry` wiped by re-detection on aggregator surfaces
On Gmail / Calendar / LinkedIn inbox, content.js detects something — usually `og:site_name` ("Gmail") or a fragment from the page — that doesn't match the bound entry's `companyWebsite` domain. The previous logic in `sidepanel.js:1173` cleared `_manualLinkId` and `currentSavedEntry` whenever `tabDomain.includes(linkedDomain)` was false. So any tab activation, refresh, or re-detection blew the bind away silently.

### 2. Side panel header never re-rendered on bind
The bind handler (`sidepanel.js:3157`) only set `currentSavedEntry` and updated the chip label. It did NOT call `showCrmLink(match)` or hydrate `currentResearch`. The detected card kept its pre-bind "Save Company" state, leaving the user no visual confirmation that the bind actually associated with a saved entry.

### 3. `granolaNote` only read the legacy flat field
`buildChatContext` looked at `entry.cachedMeetingTranscript || entry.cachedMeetingNotes` only. Older entries — and entries hydrated by company.js's structured Granola sync — store transcripts inside `cachedMeetings[].transcript` with no flat field set. Result: `granolaNote: null`, and although `meetings: entry.cachedMeetings` was passed through, any entry where the flat field was empty looked transcript-less in logs.

### 4. `currentSavedEntry` is a stale snapshot
Even when the bind survived, `currentSavedEntry` was the object captured at bind-click time. If company.js (in another tab/window) wrote new `cachedMeetings` to storage afterward, the side panel never saw it — there was no re-read on send.

## Fix (sidepanel.js)

| # | Change | Location |
|---|---|---|
| 1 | **Sticky bind**: when `_manualLinkId` is set, detection callbacks always preserve the bound entry — no domain check, no clearing. Manual binds only release on explicit user unbind/rebind. | `~1173` |
| 2 | **Header sync on bind**: bind handler now calls `showCrmLink(match)` and hydrates `currentResearch` from the saved entry, so the detected card immediately flips to "View in CRM" + research panels populate. | `~3175` |
| 3 | **Granola fallback in chat context**: `granolaNote` falls back to joining `cachedMeetings[].transcript || .summary` when the flat field is empty. | `~4005` |
| 4 | **Fresh re-read on send**: `send()` re-fetches the bound entry from `chrome.storage.local` immediately before `buildChatContext()`, so the latest cachedMeetings/cachedEmails are always used. Adds a `[SP Chat]` console log of meeting/transcript counts for diagnosis. | `~4021` |
| 5 | **Auto-fetch Granola on bind**: if the bound entry has no transcript text (checked across all three storage locations), bind handler fires `GRANOLA_SEARCH` immediately, persists results back to `savedCompanies`, and shows in-flight status in the chat. | `~3180` |

## Verification checklist

- [ ] Bind to Vibrant Practice from a Gmail thread → detected card flips to "View in CRM" instantly
- [ ] Ask Coop "what did Isaiah say in our call?" → response cites actual transcript content
- [ ] Switch to a different tab and back → bind chip persists, header stays "View in CRM"
- [ ] Bind to an entry that has no Granola data yet → "Fetching meeting notes…" appears, then resolves
- [ ] Console log on send shows `meetings: N, granolaNote: <chars>` — both non-zero for entries with meeting data

## Out of scope (follow-ups)

- Background-side `CHAT_MESSAGE` could also re-read the entry by id to fully eliminate stale-snapshot risk (currently only side panel does so).
- The detected card still shows "Vibrant Practice" as the *detected* company on Gmail. We could relabel it ("Bound to: …") when a manual bind is active, instead of showing detection state at all.
