# Coop.ai — Product Strategy

## What it is

A Chrome extension that replaces the job search stack — the spreadsheet, the tabs, the bookmark tools, the ChatGPT window where you re-paste your resume every conversation — with a single surface where research happens automatically, the pipeline stays current, and an AI advisor already has the full context.

Built by Matt Sterbenz as a personal tool. All data stays local. No backend, no accounts, no data leaving the machine.

## Who it's for

One person, right now. But the architecture is user-agnostic — profile data, preferences, operating principles, and voice profile are all configurable. Any job seeker could use it if it were packaged.

## What makes it different

**The advisor has the same picture you do.** Coop doesn't get context from a prompt you just pasted — he gets it from data the extension has been quietly assembling: your profile, the company research, the job description, the emails you've exchanged, the meeting transcripts, the pipeline stage, the score breakdown. You stop being the integration layer between four tools and a model.

**Code carries mechanics, settings carry opinions.** Every interpretation Coop applies to user data lives in user-editable config (Operating Principles textarea, voice profile, scoring preferences). The code emits neutral facts; the settings tell Coop how to read them. No hardcoded taste.

**No API call fires without a click.** Detection is free; enrichment is not. One research lookup can burn five providers. The extension respects that.

## What exists today

### Core loop
1. **Detect** — Content script identifies company/job from any page (LinkedIn, Greenhouse, Lever, Workday, Ashby, generic fallback)
2. **Research** — Apollo firmographics → Serper parallel searches → Claude synthesis → structured JSON, cached 24h
3. **Save** — One-click save to pipeline, unified company/opportunity record
4. **Score** — 5-dimension job match (role fit, comp, work arrangement, culture, qualifications) against user profile
5. **Manage** — Kanban pipeline with drag-drop, stage timestamps, action status (my court / their court)
6. **Advise** — Coop chat with full context, tool-use for on-demand data, multi-provider fallback chain

### Surfaces
- **Side Panel** — detects current page, offers research, inline chat
- **Dashboard** — Kanban/grid views, stat cards, global pipeline advisor chat
- **Company Detail** — three-column layout, emails tab, meetings tab, floating chat
- **Opportunity Detail** — job-focused variant of company detail
- **Apply Queue** — Tinder-style swipe triage for unscored opportunities
- **Inbox** — email threads grouped by company, stage/direction filtering
- **Preferences** — profile, experience, ICP, scoring config, operating principles
- **Coop Settings** — AI models, personality, memory, behavior, usage tracking

### Integrations
- Gmail (OAuth) — emails attach to companies by domain
- Google Calendar — meetings surface as contacts
- Granola — meeting transcripts attach to entries
- Apollo — company firmographics
- Serper — web search for reviews, leadership, jobs, product info
- Claude / OpenAI / Gemini — chat, scoring, research synthesis

## Where it's going

### Phase 1 — Make what exists great (current focus)
Fix bugs, improve scoring trust, tighten data quality, polish UI. The product works but rough edges erode confidence. Items tracked on [GitHub project board](https://github.com/users/mattryansterbenz7-sketch/projects/1).

### Phase 2 — Coop writes for you
Coop moves from advisor to drafter. Starts with email replies ("Draft reply with Coop" in the Emails tab), expands to cold outreach, follow-up scheduling, and application free-response answers. All filtered through a Voice Profile system that learns from every edit you make. See PRD: `prds/APP-MODE-application-experience.md`.

**Prerequisite:** Voice Profile — a structured model of how you write, built from sample emails and application responses, refined by a feedback loop that captures your edits to Coop's drafts.

### Phase 3 — Coop applies for you
Autonomous Apply Queue. Send opportunities to a queue, Coop works through them — scanning form fields, filling answers from your profile + answer library + voice profile, surfacing targeted questions when stuck. Trust ladder from "draft only" to "fully autonomous." See PRD: `prds/AUTO-APPLY-autonomous-apply-queue.md`.

**Prerequisite:** Application mode (Phase 2), score calibration, voice profile.

### Phase 4 — Coop manages your pipeline
Email event automation — auto-detect rejections, assessment requests, interview scheduling, offers from incoming emails. Confidence-gated (high confidence auto-applies, medium suggests, low ignores). Always reversible. Collapses 80% of manual pipeline maintenance.

### Phase 5 — Coop everywhere you write
Ambient writing assistant on every page. Local heuristics for voice anti-patterns, LLM rewrites in your voice, context-aware suggestions ("You met Sarah on April 1 — want to reference that?"). Currently shelved (coop-assist.js exists but not loaded) — revisit when cost/value ratio improves.

## Design principles

1. **Local-first.** All data in `chrome.storage.local`. No backend, no infrastructure cost, no privacy concerns.
2. **No auto-fire.** No API call without explicit user action. Detection is free; enrichment is not.
3. **Code carries mechanics, settings carry opinions.** Interpretations live in user-editable config, not hardcoded in prompts.
4. **Compounding > one-shot.** Every interaction makes Coop better — answer library, voice feedback, memory insights.
5. **Zero net-new data entry.** Pull from what exists (emails, meetings, profile) — don't create new forms to fill.
6. **Context transparency.** Coop fetches context on-demand via tools, never pre-injects it. Users can see what Coop knows.
