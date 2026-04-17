# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

For product vision, roadmap, and strategic direction, see [STRATEGY.md](STRATEGY.md).

For design language, motion principles, and what Coop refuses to look like, see [DESIGN.md](DESIGN.md). Referenced on every UI diff; the `ux-qa-reviewer` agent runs with it in context.

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

### Service worker & core modules

| File | Purpose |
|------|---------|
| `background.js` | Service worker entry point. Message router, startup logic, migration guards |
| `api.js` | API call wrappers for all providers with fallback chain, cost tracking per model, usage monitoring |
| `bg-state.js` | Shared mutable state container — API keys, pipeline config, caches, feature flags |
| `research.js` | Enrichment pipeline orchestrating company research across providers with caching |
| `scoring.js` | Job match scoring engine — profile interpretation, structural matching, queue-based processing |
| `search.js` | Search provider implementations (Apollo enrichment, Serper image search), photo fetching |
| `sync.js` | Field synchronization across entries, role brief extraction, data backfill |
| `profile-compiler.js` | Compiles user profile + preferences into tiered markdown docs (Summary/Standard/Full) |
| `utils.js` | Pure utilities — debug logging, company name matching, email parsing, hash functions |

### Integration modules

| File | Purpose |
|------|---------|
| `calendar.js` | Google Calendar event fetching, attendee filtering by company |
| `gmail.js` | Gmail OAuth, token management, email body extraction, rejection detection, contact parsing |
| `granola.js` | Granola REST API — note fetching, meeting search, index building with rate-limiting |

### Coop AI system

| File | Purpose |
|------|---------|
| `coop.js` | Coop agent identity and avatar SVG rendering |
| `coop-chat.js` | Unified chat handler — message routing, tool-use loop, insight extraction triggers |
| `coop-context.js` | Pipeline summary generation, intent detection, cross-company aggregation (meetings, emails, contacts) |
| `coop-tools.js` | Tool-use definitions and handlers for Claude model integration |
| `coop-settings.js` | Coop config UI — models, personality, memory, behavior, usage tracking |
| `memory.js` | Persistent memory store — passive insight extraction from conversations, profile consolidation |
| `navigate.js` | Navigation helper for extension pages — side-panel tab reuse, in-place navigation |
| `sounds.js` | Procedural audio via Web Audio API for subtle UI feedback, mute toggle |

### UI pages (each has `.js` + `.html`)

| Page | Purpose |
|------|---------|
| `saved` | Dashboard — Kanban/grid views, stage columns, drag-drop, filtering, stat cards, global chat |
| `company` | Full-screen company detail — three-column layout, meetings tab, emails tab, floating chat |
| `opportunity` | Opportunity detail view (job-focused variant of company page) |
| `sidepanel` | Side panel — company detection, research display, save flow, inline chat |
| `preferences` | Settings — job match prefs, Story Time profile, salary/OTE, Coop operating principles |
| `integrations` | API key CRUD, test connection, provider status |
| `queue` | Apply Queue — Tinder-style swipe triage over pipeline opportunities |
| `inbox` | Email inbox with stage/direction filtering, read status, company grouping |
| `docs` | Documentation page with scroll-nav and full-text search |
| `coop-settings` | Coop-specific configuration (separate from main preferences) |

### Content scripts

| File | Purpose |
|------|---------|
| `content.js` | Runs on all pages. Detects company/job from LinkedIn, Greenhouse, Lever, Workday, Ashby, generic sites |
| `coop-assist.js` | Ambient writing assistant. Watches text fields, voice heuristics + LLM rewrite modes (In my voice / Tighten / Punchier / Warmer) |
| `onboarding.js` / `onboardingSteps.js` | Self-serve onboarding — static step manifest + persistent state, injected into side panel chat |

### Shared UI

| File | Purpose |
|------|---------|
| `chat.js` | Shared AI chat panel component, used by company.js and opportunity.js |
| `ui-utils.js` | Consolidated shared functions — `escapeHtml`, `scoreToVerdict`, `defaultActionStatus` |
| `design-tokens.css` | 38 CSS custom properties controlling all visual styling |

### PRDs (`prds/`)

Shipped PRDs live in `prds/shipped/` as historical records. Draft/future PRDs live as GitHub issues (source of truth — not duplicated as files).

| File | Purpose |
|------|---------|
| `shipped/S4-scoring-overhaul.md` | Deterministic 5-dimension scoring model |
| `shipped/S3-scoring-quality-pass.md` | Scoring quality & cost visibility fixes |
| `shipped/H1-save-flow-consolidation.md` | Unified save path across all surfaces |
| `shipped/G2-coop-tool-use.md` | Coop tool-use architecture (on-demand context) |
| `shipped/G5-profile-md-compilation.md` | Profile .md compilation + legacy removal |
| `shipped/J1-linkedin-data-capture-expansion.md` | LinkedIn job posting data capture |

### Marketing (`marketing/`)

| File | Purpose |
|------|---------|
| `NARRATIVE.md` | Origin story — why Coop exists, told from Matt's perspective |
| `SHOWCASE.md` | Product overview with feature highlights |
| `DEMO_SCRIPT.md` | 90-second demo recording script |
| `SOCIAL_THREAD.md` | LinkedIn/social launch posts |
| `landing.html` | Public-facing landing page |

### Dev / reference

| File | Purpose |
|------|---------|
| `config.example.js` | Template config with placeholder API key structure |
| `generate-icons.html` | Canvas-based icon generator for Coop logo at various sizes |
| `icon-preview.html` | Design reference previewing icon options at multiple sizes |
| `system-audit.html` | Architecture reference with tabbed navigation |
| `context-for-prd.md` | Scoring system context dump for PRD design sessions |
| `archive/` | Preserved design work from removed features (e.g. widget floating button CSS/animations) |

## Architecture

### Platform
- **Chrome Extension, Manifest V3** — service worker background, content scripts, side panel
- **No backend** — all data in `chrome.storage.local` / `chrome.storage.sync`
- **ES modules for service worker** — background.js imports from ~15 modules; UI pages use standalone JS files
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
- Legacy migrations (`_migratedLegacyFields`, `_migratedPunctuation2`, `jobMigrationV1Done`) still run on startup behind guard flags. Safe to remove after 6+ months once all users have upgraded.

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

## GitHub Board Management

All issues live on the [Coop.ai project board](https://github.com/users/mattryansterbenz7-sketch/projects/1).

### GraphQL IDs

| Resource | ID |
|----------|----|
| Project | `PVT_kwHOEA1iCM4BTJyy` |
| Status field | `PVTSSF_lAHOEA1iCM4BTJyyzhAegdY` |
| Priority field | `PVTSSF_lAHOEA1iCM4BTJyyzhAekQU` |

| Column | Option ID |
|--------|-----------|
| Needs Spec | `227f3e8b` |
| Backlog | `43f0ed97` |
| Up Next | `2cee5689` |
| In Progress | `7556d12e` |
| Blocked / Needs Matt | `fb391763` |
| Monitoring | `2eea7b72` |
| Done | `c24e13e2` |

**Note:** The "Blocked / Needs Matt" column sits between Backlog and Up Next. It's a universal "waiting on Matt" inbox — PM parks strategy/design questions (`blocked:strategy`), Doer parks mid-execution forks (`blocked:execution`), and either parks design-riff/pair-session work (`blocked:collab`). Each item must have a `**PM → Matt (strategize):**`, `**Doer → Matt (unblock):**`, or `**PM → Matt (collab):**` comment explaining the specific question.

| Priority | Option ID |
|----------|-----------|
| P1 | `d1b218cb` |
| P2 | `7f7a7752` |
| P3 | `78404ef6` |

### Labels

**Type:** `bug`, `feature`, `polish`, `strategy`, `concern`
**Size:** `small`, `medium`, `large`
**Model tier:** `model:haiku`, `model:sonnet`, `model:opus` (see Model Assignment section)
**Area (filterable surface):** `area:chat`, `area:scoring`, `area:research`, `area:side-panel`, `area:board-ui`, `area:company-view`, `area:onboarding`, `area:integrations`, `area:preferences`, `area:design-system`
**Blocked state (optional):** `blocked:strategy` (PM needs Matt's direction), `blocked:execution` (Doer hit mid-execution fork), `blocked:collab` (design/exploratory — pair with Matt interactively, Doer skips)

Every new issue should have type + size + model + area labels. `/issue` applies these automatically.

### Column assignment

- **Needs Spec** — idea without a clear implementation path; needs design or PRD before coding starts
- **Backlog** — well-defined, no urgency; ready to pick up whenever. Also the home of parent/tracker issues (Tasks-checkbox bodies).
- **Up Next** — prioritized, executable leaves ready for Doer. Must pass the Up Next gate (PRD + acceptance criteria + `model:` label + `area:*` label + single-session scope + not a tracker).
- **In Progress** — actively being coded; Doer moves here before writing any code.
- **Blocked / Needs Matt** — paused waiting on Matt's input. PM moves issues here when it needs strategy/design direction to spec; Doer moves issues here when it hits a mid-execution fork. Each item has a `**PM → Matt (strategize):**` or `**Doer → Matt (unblock):**` comment with the specific question.
- **Monitoring** — Doer-finished, closed, awaiting Matt's verification. Must have a `## How to verify` comment with reload reminder + checklist.
- **Done** — Matt-verified; issue already closed (closure happens at Monitoring transition, not here).

### Priority assignment

- **P1** — blocking, regression, data loss, or active-roadmap feature on a deadline
- **P2** — meaningful bug or improvement that degrades UX; should ship soon
- **P3** — nice-to-have, cosmetic, low urgency

### Workflow rules

1. Move issue to **In Progress** before writing any code — never after.
2. When code is pushed to `origin/main`: move to **Monitoring**, close the GitHub issue, and post a `## How to verify` comment with reload reminder + markdown checklist. Closed + Monitoring = "Doer says done, awaiting Matt's verification."
3. The Doer never moves issues to the **Done** column. Matt drags to Done after verifying.
4. Never leave an issue open if it is in the Done column (Done is a terminal, verified state — the issue should already be closed when it lands there).
5. **Refinement routing: Matt → PM → Doer, never Matt → Doer directly.** Feedback on Monitoring items goes to the PM thread. PM decides: tweak (reopen + re-spec + promote via Up Next) or rethink (close + new scoped issue). Doer only accepts work that comes through Up Next.
6. **Up Next gate.** PM must not promote an issue to Up Next unless it passes: (a) concrete PRD with acceptance criteria, (b) `model:*` label, (c) `area:*` label, (d) single-session scope (not `large` + `strategy`), (e) not a parent/tracker (Tasks-checkbox bodies stay in Backlog as navigation aids).
7. **Blocked routing.** If PM can't spec without Matt's direction, move to **Blocked / Needs Matt** with a `**PM → Matt (strategize):**` comment. If Doer hits a mid-execution fork, same column with `**Doer → Matt (unblock):**`. When Matt answers, the responsible thread pulls it back to the appropriate stage.

### Adding issues to the board

Every new issue must be added to the board immediately after creation — the `/issue` skill handles this automatically. For manual additions, use `addProjectV2ItemById` to get the item ID, then call `updateProjectV2ItemFieldValue` twice (Status, Priority).

```bash
# 1. Add to project, capture item ID
ITEM_ID=$(gh api graphql -f query='
  mutation {
    addProjectV2ItemById(input: {
      projectId: "PVT_kwHOEA1iCM4BTJyy"
      contentId: "ISSUE_NODE_ID"
    }) { item { id } }
  }' --jq '.data.addProjectV2ItemById.item.id')

# 2. Set Status column
gh api graphql -f query="
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: \"PVT_kwHOEA1iCM4BTJyy\"
      itemId: \"$ITEM_ID\"
      fieldId: \"PVTSSF_lAHOEA1iCM4BTJyyzhAegdY\"
      value: { singleSelectOptionId: \"COLUMN_OPTION_ID\" }
    }) { projectV2Item { id } }
  }"

# 3. Set Priority
gh api graphql -f query="
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: \"PVT_kwHOEA1iCM4BTJyy\"
      itemId: \"$ITEM_ID\"
      fieldId: \"PVTSSF_lAHOEA1iCM4BTJyyzhAekQU\"
      value: { singleSelectOptionId: \"PRIORITY_OPTION_ID\" }
    }) { projectV2Item { id } }
  }"
```

### Board hygiene

- **Never** use `updateProjectV2Field` — it mutates field definitions and wipes all item assignments. Always use `updateProjectV2ItemFieldValue`.
- Before creating a new issue, scan open issues for duplicates. Close exact duplicates with a comment pointing to the canonical issue.
- Don't touch issues in the Done column — they are historical records.
- Always hyperlink issue references as `[#123](https://github.com/mattryansterbenz7-sketch/company-intel/issues/123)` — never bare `#123`.

## Model Assignment

Every issue must be labeled with the most efficient Claude model to action it. Apply the label at issue creation; respect it when picking up work.

### Labels

| Label | Model | Use when |
|-------|-------|----------|
| `model:haiku` | Claude Haiku 4.5 | Task is isolated, well-defined, and fits in one file. Small bugs with obvious causes, copy/text changes, CSS tweaks, adding a simple field to existing UI. |
| `model:sonnet` | Claude Sonnet 4.6 | Standard feature development (1–3 files), moderate debugging, API integration following an existing pattern, most board tasks. Default when uncertain. |
| `model:opus` | Claude Opus 4.7 | Complex architecture spanning many files/systems, bugs with unclear root cause, Needs Spec issues requiring design thinking, P1s with high stakes, performance/cost analysis. |

### Assignment heuristics

Ask: *If I described this task to a capable engineer in one sentence, how much would they need to think?*

- **No thinking needed** (mechanical execution) → Haiku
- **Some judgment required** (moderate complexity) → Sonnet
- **Deep reasoning required** (ambiguous, high-stakes, cross-system) → Opus

When in doubt, assign Sonnet. Upgrade to Opus only for genuinely hard problems — it's slower and more expensive.

### Respecting the label

When picking up an issue to work on:
1. Check its model label: `gh issue view NUMBER --json labels --jq '.labels[].name'`
2. If the label differs from the current model, flag it to the user: *"This issue is tagged `model:opus` — consider switching models before we start."*
3. Don't override the label silently — surface it and let Matt decide.
