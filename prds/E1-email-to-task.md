# E1 — Email → Task Generation

**Status:** Draft, awaiting approval
**Owner:** Opus session, 2026-04-07
**Backlog item:** E1 (P2)

## Problem

Emails on active opportunities frequently imply concrete TODOs for Matt ("can you send your availability", "let me know your salary range", "follow up after Thursday's call"). Today these only surface inside the email view or get rolled into the single `nextStep` string per opportunity. They don't become discrete, checkable items in the existing tasks system, so they slip.

## Goal

Add a third creation path to the existing `userTasks` store: emails on active opportunities auto-generate tasks. Tasks land in the same surfaces users already use (global Tasks tab on saved.html, per-company Tasks tab on company.html). No new surfaces, no new data store.

## Non-goals

- Rebuilding the tasks system. Existing schema, UIs, completion model all stay.
- Replacing the existing `nextStep` / `nextStepDate` extraction. That continues to serve as the opportunity-level headline summary; E1 produces discrete actionable items alongside it.
- Auto-generating tasks from meetings, transcripts, or notes. Email-only for v1.
- Auto-completing or auto-archiving tasks based on later emails. Manual completion only.

## Eligibility filter

Auto-extraction only runs for entries where **all** of the following are true:
- `isOpportunity === true`
- `jobStage` is not `dq`, `closed_lost`, or any "closed" terminal state
- `jobStage` is not `scoring_queue` or `apply_queue` (per Matt's spec — these are pre-pipeline)
- Entry has at least one `cachedEmails` entry newer than the last extraction run

## Trigger model

E1 follows the same pattern as the existing `nextStep` auto-extractor (`company.js:517`, `background.js:4714`): **piggyback on user-triggered context refreshes, gated by a freshness check.** No background sweeps, no page-load auto-fires.

Concretely:

1. The Emails tab on the company detail page already calls `GMAIL_FETCH_EMAILS` and overwrites `entry.cachedEmails` wholesale (`company.js:2249`). Today's flow has no incremental cursor — every refresh re-pulls up to 100 messages.
2. **New step:** before the overwrite, capture the set of existing email IDs. After the overwrite, diff against the new set to identify genuinely new IDs.
3. If the entry is eligible (active opportunity, see filter above) **and** there is at least one new ID, fire `EXTRACT_EMAIL_TASKS` against just the new emails.
4. A manual "Re-scan emails for tasks" button on the company Tasks tab lets users force a re-run against all cached emails (e.g. after fixing a misassigned email or correcting an entry's domain).

The diff is what makes this safe: without it, every visit to the Emails tab would re-extract tasks from all 100 messages and pile up duplicates forever. With it, extraction fires exactly once per email.

**Why this pattern (not a new fetch path):** `fetchGmailEmails` stays a pure data-fetcher. The diff + extraction trigger lives at the call site in `company.js`, the same way `nextStep` extraction lives in `company.js:524` rather than inside the calendar/email/transcript fetchers.

## Schema changes (additive)

Add three fields to task objects in `userTasks`:

```js
{
  // ...existing fields
  source: 'manual' | 'chat' | 'email',  // default 'manual' on existing tasks
  sourceEmailId: string | null,         // Gmail message ID, only when source === 'email'
  reviewed: boolean                      // false on creation when source === 'email', true otherwise
}
```

Existing tasks are migrated lazily: when read, any task missing `source` is treated as `'manual'`, `reviewed: true`. No data migration script required.

## Extraction prompt contract

`EXTRACT_EMAIL_TASKS` calls Claude Haiku (cheap, fast) with:
- The entry's `company`, `jobTitle`, current `jobStage`, `actionStatus`
- The new email(s): subject, from, to, snippet, body (truncated to ~2k chars each)
- Existing open tasks for this entry (text only) so the model can dedupe
- The current date

The model returns a JSON array. Each item:
```json
{
  "text": "Send Sunita your availability for next week",
  "dueDate": "2026-04-10" | null,
  "priority": "low" | "normal" | "high",
  "sourceEmailId": "<gmail-message-id>",
  "rationale": "Isaiah's intro email asks for availability so Sunita can send a calendar invite"
}
```

The model is instructed to return an empty array if no clear TODO is implied. Prompt biases conservative: prefer zero tasks over speculative ones.

## Dedupe rules

Before saving a returned task, check existing `userTasks` for the same `companyId`:
- If a task with the same `sourceEmailId` already exists → skip (idempotent re-runs).
- If a task with `completed: false` has a normalized text similarity > ~0.85 to the new one → skip (avoid "send availability" being created twice from a thread).
- Otherwise → save as a new task with `source: 'email'`, `reviewed: false`.

Normalization for similarity: lowercase, strip punctuation, drop stopwords, compare token overlap (Jaccard). Cheap, no embeddings.

## UI changes

**Both Tasks tabs (saved.html global, company.html per-company):**
- Auto-generated tasks render with a small "from email" pill next to the text.
- Unreviewed auto-tasks (`reviewed: false`) get a left border accent and a dot indicator, similar to unread email styling.
- Clicking the task body opens an inline action row: **Keep**, **Edit**, **Dismiss**, plus a "View source email" link that opens the company page Emails tab scrolled to that email.
- **Keep**, **Edit**, and **Dismiss** all set `reviewed: true`. **Dismiss** also sets `completed: true` so it falls out of the active list.

**Badges:**
- Tasks tab in saved.html shows a count of unreviewed auto-tasks across all entries (small red dot + number).
- Tasks tab on company.html shows the same count scoped to that entry.

**No changes** to the manual creation flow, the chat creation flow, or the existing task item rendering for `source: 'manual'` / `'chat'` tasks.

## Relationship to `nextStep` / `nextStepDate`

Both stay. They do different jobs and read different slices of the data:

|                       | `nextStep` (today)                                | E1 tasks (proposed)                  |
|-----------------------|---------------------------------------------------|--------------------------------------|
| Output count          | Exactly 1                                          | 0–N per email                        |
| Lives on              | The opportunity entry (`entry.nextStep`)           | Global `userTasks` store             |
| Sources               | Calendar + transcripts + notes + email *headers*   | Email *bodies* only                  |
| Email depth           | Subject/from/date of last 5                        | Full body of new emails              |
| Re-fires when         | Any context bucket is newer than last extraction   | New email IDs appear                 |
| Replaces previous?    | Yes — overwrites the single field                  | No — appends, dedupe-checked         |
| Manual override       | Honored via `nextStepManuallySetAt`                | N/A — each task is independent       |

**Key insight:** `nextStep` doesn't really see email *bodies* today — only subject/from/date for the last 5. The Vibrant/Granola situation that motivated E1 (Coop should know what Isaiah said in his intro email) isn't something the existing extractor would catch either. It processes meeting transcripts deeply but emails shallowly. E1 closes that gap.

E1 does not modify `EXTRACT_NEXT_STEPS` or its trigger. The two extractions can fire in the same user-initiated email refresh but write to different fields and won't fight.

## Open questions for Matt

1. **Re-run cost ceiling.** Should the manual "Re-scan emails for tasks" button cap at the most recent N emails (say 10) to bound cost, or scan all cached?
2. **Dismiss vs delete.** Today tasks are hard-deleted. Auto-tasks dismissed by the user — keep them as `completed: true, reviewed: true` so the model can see them for dedupe in future runs, or hard-delete them like the rest? Recommend: soft-keep, since dedupe value is real.
3. **Priority/dueDate from the model.** Trust the model's `priority` and `dueDate` outputs, or always default to `normal` / `null` and let the user set them? Recommend: trust, but cap at `normal` (no auto-`high`).
4. **Cross-opportunity dedupe.** If two opportunities share an email thread (rare but possible with intros), should the task only attach to one entry or both? Recommend: attach to whichever entry the email is currently associated with — don't try to be clever.

## Implementation sketch (post-approval)

Files touched:
- `background.js` — add `EXTRACT_EMAIL_TASKS` handler, prompt, dedupe logic; hook into `GMAIL_FETCH_EMAILS` post-success path
- `saved.js` — render `source` pill, unreviewed styling, action row, badge count
- `company.js` — same as saved.js plus the "Re-scan emails for tasks" button on the Tasks tab and "View source email" jump
- Schema migration helper (lazy read-time defaulting) — colocated wherever `userTasks` is loaded

No new files. No new dependencies.
