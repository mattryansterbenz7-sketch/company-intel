# Feature: Story Time + Global AI Chat

## What We're Building

A three-tier AI chat system that turns CompanyIntel into a personal career advisor that knows who Matt is, can see the entire pipeline, and gets smarter over time.

**Tier 1 — Story Time (persistent personal context)**
A rich personal profile stored in `chrome.storage.local` that gets injected into EVERY AI chat (global and company-scoped). Includes a dedicated input area on the preferences page where the user can free-write about themselves. The AI also passively learns and updates this profile from conversations, meeting transcripts, and email patterns over time.

**Tier 2 — Global Chat (pipeline-wide advisor)**
A chat widget on the saved/dashboard page (`saved.html`) that can see across ALL saved companies and opportunities. Primary use case: "Draft a follow-up to Krisztian at Captivate" — the AI knows the full pipeline context and can reference any company.

**Tier 3 — Upgraded Company Chat (existing, enhanced)**
The existing per-company chat on `company.html` now inherits Story Time context, so it always knows who the user is. It defaults to focusing on the current company/opportunity but can reference others if asked.

---

## Step 1: Story Time Data Layer + Preferences UI

### Storage
Add a new key `storyTime` in `chrome.storage.local`:
```js
storyTime: {
  // User's direct input — their narrative, background, values, etc.
  rawInput: "",
  
  // AI-consolidated profile summary (rewritten periodically from rawInput + learned insights)
  profileSummary: "",
  
  // Raw observations extracted from conversations (append-only scratch pad)
  learnedInsights: [
    { source: "chat:captivate", date: "2026-03-26", insight: "Values founder transparency..." },
    { source: "transcript:product-genius", date: "2026-03-24", insight: "Asked about autonomy and ownership..." }
  ],
  
  // Timestamp of last profile consolidation
  lastConsolidated: null
}
```

### Preferences UI (preferences.html + preferences.js)
Add a new section on the preferences page called **"Story Time — Tell Me About You"** placed ABOVE the existing job match preferences section. Include:

1. **A large free-text textarea** (min 6 rows, expandable) with placeholder: "Tell me about yourself — your career story, what drives you, what you're looking for, what environments bring out your best work. Be as detailed and honest as you want. This context helps every AI conversation in CompanyIntel understand who you are."
2. **A "Save" button** that stores the content to `storyTime.rawInput`
3. Below the textarea, show a collapsible section: **"What the AI has learned about you"** — displays `storyTime.profileSummary` as read-only text (or "No profile generated yet" if empty). Include a **"Refresh Profile"** button that triggers a consolidation (described in Step 3).
4. Load existing `storyTime.rawInput` into the textarea on page load.

### Inject Story Time into existing company chat
In `background.js` `handleChatMessage`, add a new system prompt section between "ABOUT THE USER" prefs and the company context:

```
// === YOUR STORY (from Story Time) ===
{storyTime.profileSummary || storyTime.rawInput}

// === AI-LEARNED INSIGHTS ===
{last 20 learned insights, one per line}
```

This immediately upgrades every existing company-scoped chat.

---

## Step 2: Global Chat on Dashboard

### UI (saved.html + saved.js)
Add a floating chat widget in the bottom-right corner of `saved.html`. Style it identically to the existing chat widget on `company.html` — same bubble style, input field, send button, expand/collapse behavior. Use shadow DOM or scoped styles consistent with existing approach.

### System Prompt Construction
When global chat opens, build the system prompt:

1. **Story Time context** — same as Step 1 injection (`profileSummary` or `rawInput` + learned insights)

2. **Full pipeline summary** — load ALL entries from `savedCompanies` in `chrome.storage.local` and build a structured compact summary:
```
// === YOUR PIPELINE (N companies, M opportunities) ===
For each entry:
- [Company Name] | Stage: [jobStage or status] | Role: [jobTitle or "—"] | Rating: [rating]/5 | Contacts: [first 2-3 knownContacts names] | Last note: [first 80 chars of notes] | Tags: [tags]
```
Keep this compact — one line per entry. No emails, no transcripts, no full intel at this stage.

3. **User preferences** — same prefs injection as existing chat (roles, background, loves, hates, salary, location)

4. **System instruction:**
```
You are Matt's strategic career advisor with full visibility across his job search pipeline. You know his background, values, and preferences from Story Time. You can see every company and opportunity he's tracking.

Help him prioritize opportunities, draft follow-up messages, compare options, and make strategic decisions. When he mentions a specific company or person, use the pipeline context to inform your response.

If he asks you to draft a message, email, or follow-up for a specific company — pull from what you know about that company's stage, contacts, notes, and context to write something specific and actionable.

Be direct, opinionated, and honest. Push back when something doesn't align with what you know about him. Don't be sycophantic.
```

### Company-Specific Enrichment
When the user mentions a company name in the global chat that matches a saved entry (case-insensitive match against `entry.company`):

1. Before generating the AI response, fetch that company's full data:
   - `cachedEmails` (or trigger `GMAIL_FETCH_EMAILS` if not cached)
   - `cachedMeetings` / Granola transcripts (or trigger `GRANOLA_SEARCH` if not cached)
   - Full `intelligence`, `leaders`, `reviews`, `jobDescription`, `jobMatch`
2. Append this as additional context in the messages array (as a system message or user context block):
```
// === ENRICHED CONTEXT: [Company Name] ===
[Same structured format as existing company chat — emails, transcripts, intel, leadership, reviews, job details]
```
3. Only enrich for the specific company(ies) mentioned — don't load everything.

### Message Handling
Add a new message type in the chrome.runtime messaging:
- `GLOBAL_CHAT_MESSAGE` — similar to `CHAT_MESSAGE` but with flag `globalChat: true`
- In `background.js`, handle this by building the global system prompt (pipeline summary + Story Time) instead of the company-scoped one
- Reuse the same Claude API call pattern (claude-sonnet-4-6, max_tokens: 2048)

---

## Step 3: Passive Learning (Profile Enrichment)

After EVERY chat response (both global and company-scoped), make a lightweight follow-up Claude API call to extract personal insights:

### Extraction Call
```js
// After the main chat response is returned to the user:
const extractionPrompt = `You just had a conversation with the user. Based on the conversation below, extract any NEW personal insights about the user — things like values, preferences, communication style, concerns, patterns, career goals, or relationship dynamics that would help you advise them better in the future.

Return ONLY a JSON array of insight strings. If there are no new insights, return an empty array [].

Conversation:
${lastUserMessage}
${lastAssistantResponse}

Existing insights (don't repeat these):
${storyTime.learnedInsights.slice(-20).map(i => i.insight).join('\n')}
`;
```

Use `claude-haiku-4-5` for this call to keep it fast and cheap (this is a background extraction, not user-facing).

### Storage
Append any new insights to `storyTime.learnedInsights[]` with source (which chat/company it came from) and date.

### Profile Consolidation
When the user clicks "Refresh Profile" on preferences page (or could be auto-triggered later):
1. Take `storyTime.rawInput` + all `storyTime.learnedInsights`
2. Send to Claude with prompt: "Consolidate the following raw personal narrative and learned observations into a clear, structured personal profile summary. Preserve the user's voice and specifics. Organize into sections like: Background & Experience, Values & Preferences, Working Style, Career Goals, Dealbreakers, Relationship Patterns. Keep it under 2000 words."
3. Store result in `storyTime.profileSummary`
4. This consolidated summary is what gets injected into all future chats (more token-efficient than raw input + all insights)

---

## What NOT to Build
- No persistent chat history across sessions (keep session-only for now)
- No new HTML pages — Story Time goes on preferences.html, Global Chat goes on saved.html
- No action-taking from chat (no moving stages, no sending emails, no creating entries)
- No auto-consolidation schedule — manual "Refresh Profile" button only for now
- No web search from chat yet — use only data already in the system (research cache, reviews, etc.)
- Don't break existing company-scoped chat — it should continue working exactly as before, just now with Story Time context added

## File Changes Expected
- `preferences.html` — new Story Time section
- `preferences.js` — Story Time load/save/consolidation handlers
- `saved.html` — global chat widget markup + styles
- `saved.js` — global chat UI logic, pipeline summary builder, company mention detection
- `background.js` — new `GLOBAL_CHAT_MESSAGE` handler, Story Time injection into existing chat, passive learning extraction after all chats
- `chat.js` — may need `buildGlobalContext()` function alongside existing `buildContext()`
