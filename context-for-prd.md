# Coop.ai Scoring System — Context for PRD Design Session

> Paste this into a Claude session to give it full context on how scoring works today.
> Generated 2026-04-09 from the live codebase.

---

## What Coop.ai Is

A Chrome Extension (MV3) personal CRM for job searching. Auto-detects companies from any website, enriches with multi-source research, scores job postings against user preferences, manages a pipeline with Kanban workflow, and provides AI chat with full context. All data stays local in the browser — no backend.

---

## How Scoring Works Today

When a job is saved (via "Send to Coop" on LinkedIn or manually), it enters a scoring pipeline:

1. **Company scout** — 1 Serper web search, cached 7 days
2. **Load user profile** — green flags, dealbreakers, skills, resume, ICP, comp thresholds
3. **Deterministic keyword pre-scan** — scan job description for green flag and dealbreaker keywords before the LLM runs
4. **Deterministic comp check** — compare posted salary numbers against user's floor/strong targets
5. **Deterministic work arrangement check** — remote-only pref vs hybrid/onsite job
6. **LLM scoring call** — single prompt to chatWithFallback (GPT-4.1 mini → Haiku → Sonnet → GPT-4.1), returns structured JSON
7. **Red flag validation** — post-processor drops any red flags that can't trace back to a configured dealbreaker
8. **Save to entry** — score, breakdown, flags, qualifications, role brief all saved to `entry.jobMatch`

### The LLM Scoring Prompt

The prompt asks the model to produce:
- **Overall score** (1-10)
- **5 sub-scores** (scoreBreakdown)
- **quickTake** — 2-4 decisive signal bullets
- **strongFits** / **redFlags** — evidence-backed
- **qualifications** — line-by-line requirement matching
- **roleBrief** — summary, why interesting, concerns, comp summary
- **hardDQ** — only for severity-5 dealbreakers

### Current Weighting Formula

```
OVERALL SCORE = weighted average, rounded to nearest integer:
  qualificationFit × 0.25 + preferenceFit × 0.25 + dealbreakers × 0.20 + compFit × 0.15 + roleFit × 0.15
```

The model is told to use this formula and do the math.

### The 5 Sub-Score Definitions

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| **qualificationFit** | 25% | Would they hire this candidate? Experience, seniority, scale, skills vs job requirements. Candidate's preferences do NOT affect this. |
| **preferenceFit** | 25% | Holistic "desire fit" — green flags, role ICP, company ICP, preferred seniority, stage, selling motion. Absence of a green flag is neutral, not negative. |
| **dealbreakers** | 20% | Impact of configured dealbreakers. 10 = nothing triggered. Only scores low when actively triggered by evidence. |
| **compFit** | 15% | Comp alignment. 10 = exceeds strong target, 5 = meets floor or unknown/not disclosed, 1 = clearly below floor. |
| **roleFit** | 15% | Day-to-day work fit — would the candidate thrive in the actual responsibilities? Type of work, autonomy, scope, team dynamics. |

### Known Issue

Scores cluster around 4/10 when the user (a senior GTM professional) would rate them 6-7. The LLM consistently under-scores preferenceFit and roleFit. Previously preferenceFit and roleFit were nearly identical definitions (double-penalizing), which was just fixed. The old system also had "do not anchor on 5-6" language that artificially skewed scores.

---

## User Profile Data Model

All user preferences live in two storage locations:

### `chrome.storage.sync` (syncs across devices)
```js
prefs: {
  name: "Matt Sterbenz",
  resumeText: "...",           // raw resume text
  salaryFloor: "150000",       // base salary floor
  salaryStrong: "180000",      // base salary strong target
  oteFloor: "250000",          // OTE floor
  oteStrong: "300000",         // OTE strong target
  userLocation: "Denver, CO",
  workArrangement: "Remote",   // or ["Remote", "Hybrid"]
  // ... other prefs
}
```

### `chrome.storage.local` (structured profile data)

**Green flags** (`profileAttractedTo`):
```js
[{
  id: "abc123",
  text: "Founding AE role at Series A/B startup",
  category: "role",           // role, company, comp, culture, other
  keywords: ["founding", "series a", "series b"],  // trigger keywords for pre-scan
  severity: 4,                // 1-5 importance weight
  source: "manual",
  createdAt: 1712345678000
}]
```

**Dealbreakers** (`profileDealbreakers`):
```js
[{
  id: "def456",
  text: "Pure account management / renewal role with no new business",
  category: "role",           // role, company, comp, culture, other
  severity: 3,                // 1-5 (5 = hard disqualifier)
  keywords: ["account management", "renewals only"],
  unknownNeutral: true,       // if true, absence of evidence = neutral (don't flag)
  // For comp dealbreakers:
  compThreshold: 150000,      // numeric threshold
  compType: "base",           // "base" or "ote"
  compUnknownNeutral: true,   // don't penalize if comp not disclosed
  source: "manual",
  createdAt: 1712345678000
}]
```

**Role ICP** (`profileRoleICP`):
```js
{
  text: "Free-form description of ideal role...",
  targetFunction: ["Sales", "Business Development"],
  seniority: "Senior IC / Player-Coach",
  scope: "$1M-5M ARR",
  sellingMotion: "New business, enterprise",
  teamSizePreference: "Small team (< 10)"
}
```

**Company ICP** (`profileCompanyICP`):
```js
{
  text: "Free-form description of ideal company...",
  stage: ["Series A", "Series B"],
  sizeRange: ["11-50", "51-200"],
  industryPreferences: ["SaaS", "AI/ML", "Developer Tools"],
  cultureMarkers: ["builder culture", "transparent"]
}
```

**Skills** (`profileSkillTags`): `["Enterprise Sales", "New Logo Prospecting", ...]`

**Resume** (`profileResume`): `{ content: "full resume text...", uploadedAt: timestamp }`

**Experience** (`profileExperience`): Rich text (HTML) of detailed experience

**Story Time** (`storyTime`): `{ rawInput, profileSummary, learnedInsights: [{text, source, createdAt}] }`

---

## Operating Principles

User-editable in Coop settings. Injected into every scoring prompt. Current defaults:

```
- Treat my floors and dealbreakers as preferences with weight, not as refusal triggers. Flag concerns once, then help me with what I asked.
- When I ask you to draft something, draft it. Save fit critique for when I explicitly ask.
- When evaluating, be honest and specific. When producing, produce.
- A score below my floor is a concern, not a hard pass. Tell me once, not every turn.
- Hard DQ is reserved only for things I have explicitly marked as hard DQ in my dealbreakers list — nothing else.
- Use the data I've given you as the source of truth for what I want. Don't editorialize on top of it.
```

---

## Where Scores Appear in the UI

1. **Apply Queue** (`queue.html/queue.js`) — Tinder-style swipe cards. Shows score circle, score breakdown bars with hover tooltips, qualification match, quick take signals, strong fits, red flags. Buttons: Pass / Interested / Applied.

2. **Side Panel** (`sidepanel.html/sidepanel.js`) — Score breakdown in a collapsible `<details>` accordion. Bars with hover tooltips.

3. **Company Detail** (`company.html/company.js`) — Shows score as "X/10" with verdict label. No breakdown bars currently.

4. **Dashboard** (`saved.html/saved.js`) — Score shown on Kanban cards and grid cards as a small badge.

### Score Breakdown Bar UI (queue.js)

Each bar shows: label + ⓘ icon | colored bar (green/amber/red) | numeric score. Hovering shows a tooltip explaining what the dimension measures and its weight.

---

## Red Flag Enforcement

The system is strict about what can be a red flag:
- **Must cite a configured dealbreaker** — every red flag must trace back to an entry in `profileDealbreakers`
- **Or be a below-floor comp fact** — posted salary clearly below the user's floor (not "strong" target)
- **Post-processor drops invalid flags** — even if the LLM invents a red flag, the JS code strips it if it can't match to a configured source
- **"Neutral if absent"** — most dealbreakers are configured as neutral-if-absent, meaning silence in the posting doesn't trigger them

---

## Scoring Prompt Constraints

Key rules baked into the scoring prompt:
- Green flag absence is neutral, never negative
- Red flags ONLY from configured dealbreakers or below-floor comp
- Comp unknown = 5 (neutral), not a penalty
- Qualification score is employer-perspective only (prefs don't affect it)
- Location comes from job posting fields only, not company HQ
- Model must do the weighted average math explicitly

---

## What Needs PRD Work

Matt's observation: scores cluster around 4/10 when human judgment says 6-7. He wants:

1. **The weighting formula exposed in settings** — let users adjust weights per dimension
2. **Better transparency** — show the math, not just bars. "Here's how I got to 6: qual 8×25% + pref 5×25% + ..."
3. **Calibration tools** — ability to say "this score feels wrong" and have it actually learn
4. **Design for the settings UI** — how to present weight sliders, dimension definitions, and preview the impact

The scoring prompt, weighting, sub-score definitions, and UI all need to be designed together.

---

## File Map (relevant files)

| File | What's there |
|------|-------------|
| `background.js:1400-1905` | Full scoring pipeline — prompt construction, LLM call, parsing, red flag validation, save |
| `background.js:278-304` | Operating principles + coopInterp |
| `queue.js:145-300` | Apply Queue card rendering — score circle, breakdown bars, tooltips, qualification match |
| `queue.html:145-155` | Breakdown bar CSS |
| `sidepanel.js:2580-3015` | Side panel score display + renderScoreBreakdown() |
| `sidepanel.html:375-385` | Side panel breakdown CSS |
| `company.js:966-976` | Company detail score display (no breakdown bars yet) |
| `preferences.js:880-930` | Profile data model + migrations |
| `preferences.html` | Settings page UI |
