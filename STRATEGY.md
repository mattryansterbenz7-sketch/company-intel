# CompanyIntel — Strategy & Architecture

## What Is This?

CompanyIntel is a Chrome extension that turns your browser into a personal CRM for job searching and company research. When you visit a company website or LinkedIn page, it automatically researches the company — pulling firmographics, leadership, reviews, hiring signals, and funding data — then lets you save it to a pipeline you manage like a Kanban board. It connects your Gmail and meeting notes (via Granola) so you always have full context on where a relationship stands.

Built by Matt Sterbenz as a personal tool for managing a GTM job search. It's a single-user Chrome extension — all data lives locally in the browser, no backend server.

---

## Core Value Proposition

1. **Instant research**: Visit any company page, get a full profile without manual data entry
2. **Pipeline management**: Track companies and opportunities through customizable Kanban stages
3. **Relationship context**: Emails, meeting transcripts, and contacts surface automatically
4. **AI-powered analysis**: Job match scoring, company intelligence, contextual chat with full history

---

## Architecture

### Platform
- **Chrome Extension, Manifest V3** — service worker background, content scripts, side panel
- **No backend** — all data stored in `chrome.storage.local` / `chrome.storage.sync` / `localStorage`
- **No module system** — standalone JS files, `importScripts()` in service worker, shared functions duplicated where needed
- **No build step** — raw HTML/JS/CSS, load directly as unpacked extension

### API Integrations
| Service | Purpose | Auth |
|---------|---------|------|
| **Claude (Anthropic)** | Company intelligence, job match scoring, chat, deep fit analysis, next-step extraction | API key in `config.js` |
| **Apollo.io** | Firmographics: employees, funding, industry, founded year | API key |
| **Serper** | Google search for leadership, reviews, job listings, product info | API key |
| **Gmail** | Email threads + contacts for companies, calendar events | Chrome OAuth (`chrome.identity`) |
| **Granola** | Meeting notes and transcripts via MCP API | OAuth 2.0 with PKCE |

### Data Model (Single Source of Truth)

All companies and opportunities are stored as a single array (`savedCompanies`) in `chrome.storage.local`. Opportunities are NOT separate records — they are companies with `isOpportunity: true` set. This eliminates sync issues between company and job data.

**Key fields on each entry:**
- **Company data**: `company`, `companyWebsite`, `companyLinkedin`, `employees`, `funding`, `industry`, `intelligence`, `leaders`, `reviews`
- **Opportunity data**: `isOpportunity`, `jobStage`, `jobTitle`, `jobUrl`, `jobMatch`, `jobDescription`, `jobSnapshot`
- **Relationship data**: `knownContacts[]`, `cachedEmails[]`, `cachedMeetings[]`, `cachedMeetingTranscript`
- **User data**: `notes`, `tags`, `rating`, `status`, `stageTimestamps`
- **Research cache**: Separate `researchCache` object keyed by company name, 24h TTL

### Message-Based Communication
Content scripts and UI pages talk to the service worker via `chrome.runtime.sendMessage`:
```
QUICK_LOOKUP, RESEARCH_COMPANY, ANALYZE_JOB, CHAT_MESSAGE,
GMAIL_FETCH_EMAILS, CALENDAR_FETCH_EVENTS, GRANOLA_SEARCH,
DEEP_FIT_ANALYSIS, EXTRACT_NEXT_STEPS
```

---

## Key Files

| File | Size | What It Does |
|------|------|-------------|
| `manifest.json` | — | Extension config: permissions, OAuth, content scripts, service worker |
| `config.js` | — | API keys (gitignored). Copy `config.example.js` to set up |
| `background.js` | ~62KB | Service worker. All API calls, research pipeline, job analysis, Gmail/calendar fetching, Granola MCP, chat handler, caching |
| `content.js` | ~34KB | Runs on all pages. Detects company/job on LinkedIn, Greenhouse, Lever, Workday, generic sites. Extracts job descriptions, salary, work arrangement |
| `widget.js` | ~26KB | Floating button on non-LinkedIn pages. Shadow DOM, draggable, shows quick company info |
| `sidepanel.js` | ~59KB | Side panel UI. Company research display, save flow, job match results, search, settings access |
| `sidepanel.html` | ~37KB | Side panel markup + CSS |
| `saved.js` | ~85KB | Main dashboard. Grid/Kanban views, pipeline management, drag-and-drop, stage editor, celebrations, stat cards, activity tracking, filtering/sorting |
| `saved.html` | ~40KB | Dashboard markup + CSS. Stage editor modal, celebration editor, stat card editor |
| `company.js` | ~96KB | Company detail view. Three-column layout (properties / hub tabs / sidebar), all panels (Intel, Notes, Emails, Meetings, Contacts, Leadership, Opportunity, Hiring) |
| `company.html` | ~43KB | Company detail markup + CSS. Floating AI chat widget |
| `chat.js` | ~16KB | Shared AI chat panel. Used by both company detail and opportunity views. Builds rich context (emails, meetings, company data), session-only history |
| `preferences.js` | ~21KB | Settings page. Job match preferences, Gmail/Granola connections, profile/resume import |
| `preferences.html` | ~21KB | Settings markup + CSS |
| `docs.html` | ~39KB | Documentation page. Feature descriptions, architecture diagrams, integration setup |
| `docs.js` | ~1KB | Documentation nav highlighting |

---

## What's Been Built

### Commit History (newest first)
1. **Configurable stat cards** — info tooltips, editor modal, `stageTimestamps` migration
2. **Chat reliability** — 60s timeout, error surfacing, API status checking
3. **Chat UX** — whitespace fix (flex spacer), Granola tool name resolution
4. **Granola session expiry** — clear stale tokens on 401, validate on preferences load
5. **Pipeline celebrations** — emoji confetti (thumbsup/money/stop/peace), sounds (pop/cha-ching/farewell), configurable per stage via editor
6. **AI chat overhaul** — session-only history, full transcripts in context, rich system prompt with timeline, email snippets, known contacts, 2048 max_tokens
7. **Perks detection** — stipends/allowances classified separately from base salary
8. **Hub tabs, unified data model** — Intel/Notes/Emails/Meetings tabs, company + opportunity as single record, known contacts extraction, email caching, documentation page
9. **Floating widget** — non-LinkedIn company detection, shadow DOM, unified company/job statuses
10. **Initial release** — full research pipeline, side panel, save flow, kanban, job matching

### Feature Inventory

**Research & Intelligence**
- Auto-research on any company website or LinkedIn page (Apollo + Serper + Claude)
- Company intelligence summary (ELI5, who's buying, how it works)
- Leadership detection with LinkedIn photos
- Employee reviews (Glassdoor, Blind, RepVue, Reddit)
- Hiring signals (LinkedIn, Greenhouse, Lever, Ashby job boards)
- Research cache with 24h TTL

**Pipeline Management**
- Dual Kanban: company pipeline + opportunity pipeline
- Grid view with cards, ratings, tags, status dropdowns
- Customizable stages (rename, recolor, reorder, add/remove)
- Drag-and-drop stage transitions
- Confetti celebrations on stage moves (configurable type + sound per stage)
- Filtering by tag, status, rating, search text
- Sorting by date, name, rating

**Activity Tracking**
- Configurable stat cards with ring progress indicators
- Each card maps to specific pipeline stages (or "all saved")
- Daily/weekly/monthly/custom date range periods
- Editable goals per card per period
- Info tooltip explaining calculation for each card
- Editor modal to add/remove/rename cards and change stage mappings
- Generic `stageTimestamps` system (records when entry first reaches each stage)

**Job Match Scoring**
- Claude scores jobs 1-10 against user's resume, preferred roles, salary, work arrangement
- Strong fits + red flags breakdown
- Salary extraction (base vs OTE detection)
- Work arrangement detection (Remote/Hybrid/On-site)
- Perks vs salary classification (stipends routed to perks, not base comp)
- Deep fit analysis: narrative combining transcripts + emails + job description

**Relationship Tracking**
- Gmail email threads grouped by company domain
- Known contacts extracted from email From/To headers
- Contact-to-leader matching (shows email on leadership cards)
- Granola meeting notes + full transcripts fetched via MCP API
- Calendar events for upcoming meetings with company contacts

**AI Chat**
- Contextual chat on every company/opportunity page
- System prompt includes: company profile, intelligence, leadership, contacts, emails (20 with snippets), meetings (up to 5 transcripts with dates), reviews, job details, user background
- Session-only history (fresh per page visit)
- Follow-up chips ("Say more", "Key takeaways")
- Load emails / Load meeting notes action buttons
- Floating widget chat (bottom-right of company detail)
- Meeting-specific chat (scoped to meeting context only)
- 60s timeout protection, error surfacing

---

## Key Design Decisions

### Why companies and opportunities share one record
Early versions had separate `savedCompanies` and `savedJobs` arrays. This caused constant sync issues — update a company's notes and the linked job wouldn't reflect it. Unifying them into a single entry with `isOpportunity: true` eliminated the problem entirely.

### Why `stageTimestamps` instead of `appliedAt` / `introAt` / `interviewedAt`
The original approach hard-coded three activity timestamps with brittle regex matching. When users renamed stages or added custom ones, tracking silently broke. The generic `stageTimestamps: { [stageKey]: timestamp }` map scales to any pipeline configuration without code changes.

### Why session-only chat history
Persistent chat history (via localStorage) caused stale context — conversations about Company A's old status bled into new sessions. Fresh history per page visit ensures the AI always works from current data.

### Why no backend
This is a personal tool. All data stays in the browser. API keys are stored locally in `config.js` (gitignored). Gmail uses Chrome's built-in OAuth. This means zero infrastructure cost, zero privacy concerns with data leaving the machine.

### Why no build step
Simplicity. Raw HTML/JS/CSS loads directly as an unpacked Chrome extension. No webpack, no React, no npm. This keeps iteration fast — edit a file, reload the extension, see the change.

---

## Known Issues & Technical Debt

### Architecture
- **Research cache vs entry data drift**: Research data (leaders, jobListings, intelligence) is stored in both `researchCache` and on the entry. They can drift out of sync. The fix is to have the company detail view read research fields from `researchCache` rather than the entry.
- **LinkedIn URL not persisting**: Apollo returns `companyLinkedin` in fresh research but cache hits don't backfill missing fields on the entry.
- **Shared functions duplicated**: `stageColor()`, `scoreToVerdict()`, stage defaults, `escapeHtml()` etc. are copy-pasted across files. A shared utility file would reduce drift.
- **No test coverage**: The extension has no automated tests.

### Content Detection
- **LinkedIn detection is fragile**: CSS class selectors change frequently. No wait/retry for dynamic React content. Falls back to "linkedin" (the domain name) when selectors miss.
- **"New Opportunity" as jobTitle**: Some entries have this placeholder stored as data. Needs one-time cleanup migration.

### Data
- **Dirty jobTitle data**: Some entries have "Undefined [title]" from undefined variable concatenation during save.
- **Old timestamp fields**: `appliedAt`/`introAt`/`interviewedAt` still exist on migrated entries (harmless but messy).

---

## What's Left to Build

### High Priority
1. **LinkedIn detection reliability** — wait for React content, use URL structure as signal, handle auth vs public DOM differences
2. **Research cache as source of truth** — company detail view should read from cache, entry stores only user data
3. **Calendar-based contact detection** — extract attendees from Google Calendar events at company domains

### Medium Priority
4. **Granola transcript reliability** — the MCP tool names vary; current code tries `get_meeting_transcript`, `get_meeting`, `get_transcript` but we haven't confirmed which is correct
5. **Token refresh for Granola** — currently only stores access_token, not refresh_token; sessions expire and require manual reconnect
6. **Shared utility file** — extract duplicated functions into a common module
7. **jobTitle data cleanup** — migration to strip "Undefined" prefix and null out "New Opportunity"

### Nice to Have
8. **Notification system** — alerts when a company you're tracking posts new jobs or has news
9. **Export/import** — backup and restore pipeline data
10. **Multi-device sync** — move more data to `chrome.storage.sync` (currently only prefs sync)
11. **Analytics dashboard** — conversion rates through funnel stages, response rate tracking
12. **LinkedIn profile enrichment** — auto-fill contact details from LinkedIn profile pages

---

## Setup

1. Clone the repo
2. Copy `config.example.js` to `config.js` and add your API keys (Anthropic, Apollo, Serper)
3. Load as unpacked extension in `chrome://extensions`
4. Open Preferences to connect Gmail and Granola
5. Visit a company website or LinkedIn page — the side panel opens automatically
