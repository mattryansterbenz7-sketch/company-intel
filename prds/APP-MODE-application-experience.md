# PRD APP-MODE — Application Mode as a Dedicated Coop Experience

## Status

**Draft** — awaiting Matt's review before implementation.

## Problem

Application mode today is "chat with a different system prompt." The user clicks "Help me apply," Coop says "paste the question," the user copies the answer back into the form field. This works but has seven concrete gaps:

1. **No automatic activation.** Visiting `greenhouse.io/.../applications` doesn't flip Coop into application mode. The user must click a chip or type a trigger phrase.

2. **Coop Assist is application-blind.** The floating writing pill on form fields has zero awareness that the user is answering "Why do you want this role?" — it runs the same generic heuristics as a Gmail compose box.

3. **No question-type intelligence.** "Why this company?", "Describe a time you...", and "Expected salary?" are all treated identically. Coop can't pre-draft from prior answers or recognize common archetypes.

4. **No answer library.** The "Save answer" button exists but saved answers have no retrieval surface. If you answered "Why sales?" at Sitecore, that answer doesn't surface when Stripe asks the same thing.

5. **Copy-paste friction.** The user must manually copy from sidepanel chat and paste into the form field. No bridge between Coop's draft and the ATS textarea.

6. **Writing rules are baked into prompts, not configurable.** "No em dashes," "avoid buzzwords," "2-5 sentences" are hardcoded in the APPLICATION HELPER MODE block. The user can't tune voice, length, or banned terms.

7. **Coop's identity is hardcoded.** The system prompt tells Coop to "write as the user" but doesn't leverage the fact that the user built Coop — a genuinely differentiating story that could strengthen "tell us about yourself" answers. This context should come from the user's profile, not a hardcoded instruction.

---

## Vision

Application mode should feel like having a sharp co-applicant sitting next to you. You open the application form, Coop already knows the company and role, and as you tab through fields he has a draft waiting — tuned to your voice, aware of what you've said to similar companies, and smart enough to know "Why sales?" needs a different answer shape than "Describe a challenging deal."

### Core principles

- **Zero friction activation** — Coop detects you're on an application form and shifts mode automatically.
- **Token efficiency** — Most application answers are 2-5 sentences. Don't burn full-context tool calls on "What city are you in?" Use tiered intelligence: regex for factual fields, lightweight AI for short answers, full context only for narrative questions.
- **Answer memory** — Every application answer is an asset. Build a library over time that makes the 50th application faster than the 5th.
- **Voice fidelity** — The user's writing rules (banned words, tone, length defaults) are stored as preferences, not embedded in prompts. Coop Assist and application mode share the same voice config.

---

## Design

### Phase 1: Application context awareness + voice config

**Auto-activation (sidepanel.js)**
- Detect ATS application form URLs (not just job listing URLs): `/applications/`, `/apply/`, form pages on greenhouse/lever/workday/ashby
- When detected, auto-set `isApplicationMode = true` without requiring a click or keyword
- Show a subtle "Application mode" indicator in the chat header
- Still allow manual activation via chip/keyword as fallback

**Voice & writing rules (preferences.js)**
- New "Writing style" section in preferences:
  - **Banned terms** — user-editable list (seeded with current anti-phrases + em dash, "leverage," "utilize," etc.)
  - **Tone** — dropdown: Conversational / Professional / Direct (maps to prompt modifiers)
  - **Default length** — slider or dropdown: Brief (1-2 sentences) / Standard (2-5) / Detailed (5-8)
  - **Max exclamation points** — number input (default 1)
  - **Sign-off style** — input field (default: first name only)
- Store as `prefs.writingStyle` in chrome.storage.sync
- Inject into both APPLICATION HELPER MODE prompt and Coop Assist rewrite system prompt — single source of truth

**Coop identity from profile**
- Remove any hardcoded identity context from system prompts
- When generating application answers, include a `[APPLICANT CONTEXT]` block pulled from the user's Story Time profile (the "Career Identity" and "Projects" sections)
- If the user's profile mentions building an AI tool, that context naturally flows into "tell me about yourself" answers without special-casing

### Phase 2: Question-type intelligence + answer templates

**Question archetype detection**
- Before sending a pasted question to the LLM, classify it locally (regex or lightweight model):
  - `factual` — city, salary expectation, start date, LinkedIn URL, work authorization → answer from stored prefs, no LLM needed
  - `motivation` — "Why this company/role/career change?" → pull company research + role brief + profile
  - `behavioral` — "Tell me about a time..." → pull relevant experience from profile, structure as STAR
  - `technical` — "Describe your approach to..." → pull skills + project context
  - `freeform` — "Anything else?" → draft from profile + opportunity context
- Route `factual` through regex/template (zero cost). Route others through tiered AI.

**Smart prompt templates**
- Each archetype has a default prompt template that the user can customize:
  - `motivation`: "Draw from my profile and what I know about {company}. Be specific about why their {industry/stage/product} resonates with my experience at {relevant_company}."
  - `behavioral`: "Use a real example from my experience. STAR format but conversational, not robotic."
- Templates stored in `prefs.applicationTemplates` — editable in preferences
- Defaults are good enough that most users never touch them

### Phase 3: Answer library + cross-application memory

**Answer library**
- Every application answer Coop generates gets auto-saved with metadata: `{ question, answer, company, role, archetype, date }`
- Store in chrome.storage.local as `applicationAnswers[]`
- New "Answers" tab in the opportunity detail view — browse past answers for this company
- Global answer library accessible from preferences or a dedicated page

**Answer recall**
- When the user pastes a new question, Coop checks the answer library for similar prior questions (fuzzy match on question text)
- If found, start from the prior answer as a base and adapt for the new company/role context
- Show: "Based on your answer to {prior_company}: [draft]" with an "Original" toggle

**Quick-grab panel**
- Compact panel (collapsible in sidepanel) showing frequently-needed items:
  - LinkedIn URL, portfolio URL, GitHub
  - Salary expectation (from prefs)
  - Work authorization status
  - Location / willingness to relocate
  - "Why sales?" / "Why this career change?" — most-reused narrative answers
- One-click copy on each item

### Phase 4: Field-level bridge (Coop Assist integration)

**ATS field detection in Coop Assist**
- When `coop-assist.js` detects focus on a textarea inside an ATS application form:
  - Read the field label / preceding text to identify the question
  - Send to sidepanel: `{ type: 'APPLICATION_FIELD_FOCUS', question, fieldId }`
  - Sidepanel auto-drafts an answer (or surfaces a saved one)
- The floating Coop pill gains an "Insert Coop draft" option that pastes the sidepanel's draft into the field

**Round-trip flow**
1. User focuses "Why do you want this role?" textarea on Greenhouse
2. Coop Assist detects → sends question to sidepanel
3. Sidepanel checks answer library → found similar → adapts for this company
4. Floating pill shows: "Coop has a draft" with preview
5. User clicks "Insert" → answer fills the textarea
6. User edits in-place → Coop Assist provides real-time voice coaching
7. On blur, final answer auto-saves to answer library

---

## What NOT to build

- **Auto-submit** — Coop drafts, the user submits. Always.
- **Field scraping without user action** — Don't read all form fields on page load. Only activate on focus.
- **Application tracking** — The pipeline already tracks applications. Don't duplicate.
- **Cover letter generator as a separate tool** — Cover letters are just another question archetype. Route through the same system.

---

## Phasing summary

| Phase | Scope | Key deliverable |
|-------|-------|-----------------|
| 1 | Auto-activation + voice config + identity from profile | Application mode that activates itself and writes in the user's configured voice |
| 2 | Question archetypes + smart templates | Zero-cost factual answers, archetype-tuned prompts for narrative questions |
| 3 | Answer library + recall | Cross-application memory, quick-grab panel |
| 4 | Coop Assist bridge | Field-level integration between floating pill and sidepanel drafts |

Each phase is independently shippable. Phase 1 is the foundation — everything else builds on it.

---

## Open questions for Matt

1. **Phase 1 scope check** — Is auto-activation + voice config + profile identity enough for a first ship? Or do you want question archetypes (Phase 2) in the initial release?

2. **Answer library storage** — `chrome.storage.local` has a ~10MB quota. With ~100 answers at ~1KB each that's fine, but if you want to store full application form snapshots it could get tight. Cap at answers only?

3. **Quick-grab items** — What items do you find yourself repeatedly looking up during applications? The list above is a guess — what's actually in your copy-paste buffer?

4. **Coop Assist bridge priority** — Phase 4 is the most complex (cross-script communication, field detection, paste injection). Is this a must-have or a nice-to-have after the core experience works?

5. **Template customization UI** — How much control do you want over prompt templates? A simple text editor per archetype, or something more structured (variables, tone overrides per archetype)?
