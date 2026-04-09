# Coop.ai

A Chrome extension that turns your browser into a personal CRM for a job search. Built by Matt Sterbenz as a personal tool. All data stays local — no backend, no server, nothing leaves the machine.

<!-- screenshot: saved kanban dashboard -->

## The problem

A typical job search runs on a stack of half-working tools: a Google Sheet pipeline that goes stale within a week, six tabs of LinkedIn and Glassdoor for every new company, a bookmark extension that saves jobs but knows nothing about them, and a ChatGPT window where you re-paste your resume and the company description every conversation just to ask "should I apply to this?"

Coop.ai collapses that stack into one surface. Land on a company page, get the research. Save it, get a pipeline entry. Open the chat, your AI advisor already has your profile, the company data, the job description, your emails with people there, and your meeting transcripts loaded.

## What makes it interesting technically

- **Local-first by design.** No backend. No accounts. All data lives in `chrome.storage.local`. API keys are user-supplied via an Integrations page.
- **Manifest V3 service worker** handles all side effects. Every UI surface (sidepanel, full-page company view, kanban dashboard, opportunity queue) talks to it through `chrome.runtime.sendMessage`.
- **Multi-provider fallback chain for chat.** GPT-4.1 mini → Claude Haiku → Sonnet → GPT-4.1, with provider exhaustion flags so a rate-limited provider isn't retried in the same session. The UI surfaces which model actually answered.
- **Multi-source research pipeline.** Apollo for firmographics → Serper for parallel searches (leadership, reviews, jobs, product) → Claude Haiku synthesizes everything into structured JSON. Cached 24h.
- **Coop has memory.** A passive insight extractor watches the chat with a 60-second debounce and stores typed memories (about you, feedback, projects, references). Future conversations surface relevant ones automatically.
- **Operating principles as user-editable config.** A single textarea in settings carries every interpretation Coop applies to the user's data. Floors, dealbreakers, draft-vs-evaluate behavior — all of it lives in plain text the user can rewrite. Code carries mechanics; settings carry opinions.
- **Strict no-auto-fire discipline.** No API call ever runs without an explicit click. Detection is free; enrichment is not.
- **Coop Assist is a content script, not a panel.** Ambient writing assistance runs local heuristics first against Matt's voice profile (anti-phrases, exclamation ceiling, sign-off rules, LLM-slop detection), then merges in cached LLM proofread suggestions on idle. Rewrites go through the same chat fallback chain. Blocklisted on banking, auth, health, and gov domains.
- **Unified data model.** Companies and opportunities share one record (`isOpportunity: true`). Eliminates the sync bugs that come with parallel stores.
- **Generic stage timestamps.** No hardcoded `appliedAt`/`introAt` fields — a `stageTimestamps` map keyed by stage ID scales to any custom pipeline.

## Feature highlights

- On-demand company research from any page (LinkedIn, Greenhouse, Lever, Workday, Ashby, generic) with content-script detectors and a domain fallback
- Kanban opportunity pipeline with customizable stages and drag-drop reordering
- Job match scoring (1–10) against your background, role preferences, work arrangement, and salary floor
- Coop, an AI advisor that auto-binds to whatever entry you're viewing and can be manually pinned with a paperclip button
- Gmail integration (OAuth via `chrome.identity`) — email threads attach to companies by domain, with read-state tracking
- Google Calendar integration — meeting events surface as known contacts
- Granola integration — meeting transcripts attach to the right entry, filtered against the false-positive of your own name appearing in every title
- Apply Queue: Tinder-style swipe triage for unscored opportunities, with Open Application auto-binding Coop in the sidepanel
- Active Review mode for re-evaluating stalled Applied+ opportunities
- Score breakdown with strong fits, red flags, qualification matching, and a click-through to the full reasoning
- Stat-card drill-downs on the dashboard — every count is clickable and opens the underlying list
- Cover letter and follow-up draft journeys that route through Coop with a production-mode hint, so drafting requests get drafts, not fit lectures
- Inbox surface that pulls Gmail threads tagged to opportunities into a single review pane
- Coop Assist: ambient writing assistant that runs on every page (minus a privacy blocklist), flags anti-phrases and LLM slop against your voice profile, and rewrites fields in four modes — In my voice, Tighten, Punchier, Warmer

<!-- screenshot: sidepanel research view on a LinkedIn job -->
<!-- screenshot: company detail view, three columns -->
<!-- screenshot: coop chat with bound entry pill -->
<!-- screenshot: apply queue swipe card -->
<!-- screenshot: operating principles settings textarea -->

## Status

Personal tool. Actively used. Not productized, not on the Chrome Web Store, not for sale. Built to give one person an edge in their own search.
