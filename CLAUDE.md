# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this is

**Coop.ai** (formerly CompanyIntel) — a Chrome Extension (Manifest V3) that functions as a personal CRM for job searching. It auto-detects companies from any website, enriches them with multi-source research, scores job postings against user preferences, manages a pipeline with Kanban workflow, and provides AI-powered chat with full context (emails, meetings, notes, transcripts).

Built by Matt Sterbenz as a personal tool for managing a GTM job search. All data stays local in the browser — no backend server, no infrastructure cost, no data leaving the machine.

### Core value proposition

1. **Instant research**: Visit any company page, get a full profile without manual data entry
2. **Pipeline management**: Track companies and opportunities through customizable Kanban stages
3. **Relationship context**: Emails, meeting transcripts, and contacts surface automatically
4. **AI-powered analysis**: Job match scoring, company intelligence, contextual chat with full history

## Why This Exists

A typical job search involves a painful stack of manual workflows:

**Manual research** — every new company means opening tabs, checking LinkedIn, Glassdoor, the company site, trying to piece together what they do, how big they are, who works there, and whether they're worth pursuing. This repeats for every single opportunity.

**Spreadsheet pipeline tracking** — an Excel sheet with columns for stage, next steps, dates, key players, notes, comp details, drop-down statuses. Works as a snapshot but breaks down the moment things start moving. Impossible to keep current across dozens of active opportunities.

**Bookmark tools** — extensions like Teal that let you save job postings to apply to later, but with no research, no context, no pipeline management attached.

**Manual AI advisor sessions** — copying Granola meeting transcripts into ChatGPT projects, screenshotting email threads, re-explaining professional background and goals every conversation, just to get help with "what should I say next" or "does this opportunity make sense for me." The AI never had the full picture, couldn't hold the timeline straight, and the context had to be manually rebuilt constantly.

**Application free-form questions** — every application asks things like "why are you interested in this role" which requires synthesizing your own story, what the company is about, and why the role connects the two. Doing this well for every application is hours of work with no leverage.

**Qualification guesswork** — trying to assess whether a company and role are actually a fit before investing time, based on a job description that's always an incomplete picture of the real role.

Coop.ai replaces all of this with a single surface where research happens automatically, the pipeline stays current, communication history (emails, meetings, transcripts) attaches itself to each opportunity, and an AI advisor already has the full context — your professional profile, the company data, the job details, the relationship history — so you ask the question instead of spending 20 minutes rebuilding context first.

## Commands

There is no build, test, or lint tooling. Workflow is edit → reload the extension at `chrome://extensions` → verify in the browser.

## Debugging

- **Service worker (`background.js`)**: `chrome://extensions` → click the "service worker" link on the Coop.ai card. Closing/reopening DevTools force-restarts the worker.
- **Side panel**: right-click inside the panel → Inspect.
- **Full-page views** (`saved.html`, `company.html`, `preferences.html`, etc.): regular DevTools in the tab.
- **Content script (`content.js`)**: DevTools on the host page; look for its logs in the page console, not the worker console.

## Rules & Principles

### API Discipline
- NEVER make API calls (enrichment, scoring, search) without explicit user action. No auto-firing on page load, popup open, or sidebar load.
- If a company has cached or saved data, load that first. Only hit APIs when the user clicks a button to research, refresh, or enrich.
- The enrichment fallback chain (Apollo → Serper → Google → OpenAI → Claude) means one lookup can burn multiple API calls. Treat every chain trigger as expensive.
- Provider exhaustion flags (`_apolloExhausted`, `_serperExhausted`) must be respected. Never retry an exhausted provider in the same session.

### Design Direction
- Visual style matches the claude.ai web app: warm off-white backgrounds, clean typography, minimal borders, calm and spacious feel.
- Objective company data (firmographics, leadership, reviews, hiring signals) is the hero output. Fit scoring is secondary context, not the primary signal.

### Development Guardrails
- Don't refactor files outside the scope of the current task.
- Don't add new dependencies or libraries without asking first.
- Don't ask clarifying questions unless genuinely blocked — make reasonable assumptions and note them.
- Always use the Integrations page / `chrome.storage.local` for API keys. Never hardcode keys or add new `config.js` entries.
- When adding new API calls, always route through the existing wrapper functions (`claudeApiCall`, `openAiChatCall`, `chatWithFallback`) — never call APIs directly.
- `confirm()` dialogs don't work in Chrome extension pages — never use them.

### Known Patterns to Preserve
- Session-only chat history — don't add persistent chat storage
- Single `savedCompanies[]` array — don't create separate data stores
- Generic `stageTimestamps` — don't add hardcoded timestamp fields for specific stages
- Message-based IPC through `chrome.runtime.sendMessage` — all side effects go through background.js

## Loading the extension

No build step. Load directly in Chrome:

1. `chrome://extensions` → Enable "Developer mode"
2. "Load unpacked" → select this directory
3. After code changes, click the reload icon on the extension card. To force-restart the service worker, click the "service worker" link and close/reopen DevTools.

## Configuration

API keys are set via the Integrations page in the extension UI (stored in `chrome.storage.local`). `config.js` exists only as a fallback for initial setup:

```js
const CONFIG = {
  ANTHROPIC_KEY: '...',
  APOLLO_KEY: '...',
  SERPER_KEY: '...',
  OPENAI_KEY: '...'
};
```

Granola uses a REST API key (set in Integrations). Gmail/Calendar uses Chrome's `identity` API for OAuth.

## File structure

| File | Purpose |
|------|---------|
| `background.js` | Service worker. All API calls, research pipeline, chat handling, scoring, caching, fallback chain |
| `saved.js` | Dashboard — Kanban/grid views, stage columns, drag-drop, filtering, stat cards, global chat |
| `company.js` | Full-screen company detail — three-column layout, meetings tab, emails tab, floating chat |
| `sidepanel.js` | Side panel UI — company detection, research display, save flow, inline chat, settings |
| `content.js` | Runs on all pages. Detects company/job from LinkedIn, Greenhouse, Lever, Workday, Ashby, generic sites |
| `chat.js` | Shared AI chat panel component, used by company.js and opportunity.js |
| `opportunity.js` | Opportunity detail view (job-focused variant of company.js). `opportunity.html` is live — opened from company.js "View Opportunity" buttons |
| `integrations.js` | Integrations config page — API key CRUD, test connection, provider status |
| `preferences.js` | Settings page — job match prefs, Story Time profile, salary/OTE, Coop operating principles |
| `queue.js` | Apply Queue — Tinder-style swipe triage over pipeline opportunities |
| `coop-assist.js` | Ambient Grammarly-style writing assistant. Content script on all pages. Watches focused text fields, runs local voice heuristics + cached LLM proofread, surfaces a floating pill → suggestions + rewrite modes (In my voice / Tighten / Punchier / Warmer). Domain blocklist for banking/auth/gov |
| `onboarding.js` / `onboardingSteps.js` | Self-serve Coop onboarding (G1 Phase 1). Static step manifest + persistent state, injected as first-message in side panel chat when an unmet step exists |
| `widget.js` | Floating button (dead code — disabled at line 3, removed from manifest. File kept for reference) |

HTML pages: `sidepanel.html`, `saved.html`, `company.html`, `opportunity.html`, `preferences.html`, `integrations.html`

## Architecture

### Platform
- **Chrome Extension, Manifest V3** — service worker background, content scripts, side panel
- **No backend** — all data in `chrome.storage.local` / `chrome.storage.sync`
- **No module system** — standalone JS files, shared functions duplicated where needed
- **No build step** — raw HTML/JS/CSS, load directly as unpacked extension

### Message-based IPC

All communication uses `chrome.runtime.sendMessage`. The service worker (`background.js`) handles all side effects.

| Type | Purpose |
|------|---------|
| `QUICK_LOOKUP` | Fast enrichment (employees, funding, industry) |
| `RESEARCH_COMPANY` | Full research pipeline (Apollo → Serper → Claude synthesis) |
| `CHAT_MESSAGE` | Company-scoped AI chat with full context |
| `GLOBAL_CHAT_MESSAGE` | Pipeline-wide AI chat (saved.js "Pipeline Advisor") |
| `GMAIL_FETCH_EMAILS` | Fetch email threads by company domain |
| `CALENDAR_FETCH_EVENTS` | Get calendar events with company contacts |
| `GRANOLA_SEARCH` | Search Granola meeting notes by company/contact |
| `GET_COMPANY` | Content script → detect company from current page DOM |
| `GET_JOB_DESCRIPTION` | Content script → extract job posting text |
| `SCORE_OPPORTUNITY` | Unified scoring — flags, qualifications, role brief, job snapshot, conversation insights |
| `QUEUE_SCORE` | Queue an entry for scoring (used on save, post-research) |
| `SCORE_COMPLETE` | Broadcast after scoring completes — listeners update UI |
| `EXTRACT_NEXT_STEPS` | AI-generated next steps from meeting data |

### Research pipeline

```
RESEARCH_COMPANY
  → enrichFromApollo(company, domain)          // firmographics, leaders, linkedin
  → [fallback] enrichFromWebResearch()          // Serper search + Claude Haiku synthesis
  → parallel searches via Serper:
      reviews, leadership, job listings, product overview
  → Claude Haiku synthesis → structured JSON
  → result cached 24h in researchCache
```

### External APIs

| Service | Used for | Auth |
|---------|----------|------|
| **Anthropic (Claude)** | Research synthesis, job scoring, chat, insight extraction | API key via Integrations |
| **OpenAI** | Chat (default GPT-4.1 mini), fallback for Claude rate limits | API key via Integrations |
| **Apollo.io** | Company firmographics (employees, funding, industry) | API key via Integrations |
| **Serper** | Web search (reviews, leadership, jobs, product info) | API key via Integrations |
| **Gmail API** | Email threads by company domain | Chrome OAuth (`chrome.identity`) |
| **Google Calendar** | Meeting events with company contacts | Chrome OAuth (`chrome.identity`) |
| **Granola** | Meeting notes and transcripts | REST API key via Integrations |

### Chat model fallback chain

`chatWithFallback()` in background.js tries the user's selected model first, then cycles through all available models if it fails (rate limit, quota, network error):

**GPT-4.1 mini → Haiku → Sonnet → GPT-4.1**

Skips providers with no API key configured. The UI shows a fallback note when a different model answers. The user can manually switch models via a click-to-cycle toggle in the chat header.

## Data model

Single `savedCompanies[]` array in `chrome.storage.local`. Each entry is either a company or opportunity (`isOpportunity: true`).

Key fields: `company`, `companyWebsite`, `companyLinkedin`, `employees`, `funding`, `industry`, `intelligence`, `leaders[]`, `reviews[]`, `knownContacts[]`, `cachedEmails[]`, `cachedMeetings[]`, `notes`, `tags[]`, `rating`, `status`, `jobStage`, `jobTitle`, `jobDescription`, `jobMatch`, `jobSnapshot`, `fitScore`, `fitReason`, `scoredAt`, `stageTimestamps`, `actionStatus` (my_court/their_court).

User preferences in `chrome.storage.sync` (syncs across devices): `prefs` object with resume, roles, salary floors, work arrangement, etc.

Story Time profile in `chrome.storage.local`: `storyTime` with `rawInput`, `profileSummary`, `learnedInsights[]`.

Research cache: separate `researchCache` object in `chrome.storage.local`, keyed by normalized company name, 24h TTL.

## Key patterns

- **Session-only chat history** — fresh context each page visit, avoids stale data
- **Excitement score modifier** — post-processes job match scores based on user rating
- **Stage timestamps** — generic `stageTimestamps` object tracks when each stage was entered
- **Action On auto-set** — `defaultActionStatus(stageKey)` maps stages to my_court/their_court (defined in saved.js, company.js, sidepanel.js)
- **Research cache** — 24h TTL in `researchCache`, keyed by normalized company name
- **Provider exhaustion flags** — `_apolloExhausted`, `_serperExhausted` prevent repeated calls to exhausted APIs
- **`claudeApiCall()`** — wrapper with exponential backoff on 429
- **`openAiChatCall()`** — mirror of claudeApiCall for OpenAI
- **`chatWithFallback()`** — unified chat call that cycles through all providers on failure
- **`scoreOpportunity()`** — single scoring function in scoring.js. Produces score, flags, qualifications, role brief, job snapshot, conversation insights in one AI call. Triggered via `SCORE_OPPORTUNITY` message, broadcasts `SCORE_COMPLETE` when done.
- **Auto-rescore triggers** — three opt-in triggers (all OFF by default) in Data Pipeline settings: profile changes, salary/work pref changes, new interaction data. Retroactive rescore fires when an entry moves into an eligible stage with stale interaction data.

## Content detection

`content.js` has platform-specific detectors:
- **LinkedIn**: profiles, job postings, company pages (CSS selectors, fragile)
- **Greenhouse, Lever, Workday, Ashby**: ATS career pages
- **Generic**: `og:site_name`, page title, domain extraction

Known fragility: LinkedIn selectors change frequently. Falls back to domain name.

## Key design decisions

### Why companies and opportunities share one record
Early versions had separate `savedCompanies` and `savedJobs` arrays. This caused constant sync issues — update a company's notes and the linked job wouldn't reflect it. Unifying them into a single entry with `isOpportunity: true` eliminated the problem entirely.

### Why `stageTimestamps` instead of `appliedAt` / `introAt` / `interviewedAt`
The original approach hard-coded three activity timestamps with brittle regex matching. When users renamed stages or added custom ones, tracking silently broke. The generic `stageTimestamps: { [stageKey]: timestamp }` map scales to any pipeline configuration without code changes.

### Why session-only chat history
Persistent chat history (via localStorage) caused stale context — conversations about a company's old status bled into new sessions. Fresh history per page visit ensures the AI always works from current data.

### Why no backend
This is a personal tool. All data stays in the browser. API keys are stored locally. Gmail uses Chrome's built-in OAuth. Zero infrastructure cost, zero privacy concerns with data leaving the machine.

### Why no build step
Simplicity. Raw HTML/JS/CSS loads directly as an unpacked Chrome extension. No webpack, no React, no npm. Edit a file, reload the extension, see the change.

## Debt & roadmap

**Architecture**
- Research cache vs entry data drift — research fields live on both `researchCache` and the entry and can diverge. Long-term fix: company detail view reads from cache; entry holds only user data.
- Shared functions (`stageColor`) are copy-pasted across files (company.js, saved.js, opportunity.js). `escapeHtml`, `scoreToVerdict`, `defaultActionStatus` already consolidated in ui-utils.js.
- No automated tests.

**Content detection**
- LinkedIn selectors change frequently and have no wait/retry for dynamic React content. Needs URL-structure signals + auth-vs-public DOM handling. Falls back to domain name today.

**Data**
- ~~Dirty `jobTitle` data~~ — migrated via `_migratedLegacyFields` in background.js.
- ~~Legacy `appliedAt` / `introAt` / `interviewedAt`~~ — migrated to `stageTimestamps` via `_migratedLegacyFields` in background.js.

**Watch out for**
- The user's own name appears in all Granola meeting titles — matching filters names that appear in >60% of notes.
- `saveEntry()` in company.js uses `Object.assign(entry, changes)` — mutates both in-memory and storage.
- Content script can be injected twice — use `if (typeof x === 'undefined') var x = null;` guards.

**Roadmap**
- LinkedIn detection reliability
- Research cache as source of truth
- `stageColor()` consolidation into ui-utils.js
- Export/import backup
- Analytics dashboard (funnel conversion, response rate)
