# PRD J1 — LinkedIn Job Posting Data Capture Expansion

## Status
- Phase 1: **Shipped** (2026-04-11, commit c93dcd1)
- Phase 2: **Shipped** (2026-04-11, commit c93dcd1)
- Phase 3: **Ready to build** — UI surfaces for captured data
- Phase 4: **Ready to build** — Skills match against candidate profile

---

## Problem

When a user saves a job posting from LinkedIn via "Send to Coop," only a fraction of the available signal is captured. The page contains structured, machine-readable data that is almost entirely ignored.

| Data available on page | Currently captured? |
|------------------------|---------------------|
| Job description | Yes (H1 fix) |
| Job title | Yes |
| Company name | Yes |
| Work arrangement, salary chip, employment type | Partial |
| Easy Apply flag | Yes |
| **Company employee count** | **No** — wrong selectors (company page, not job page) |
| **Company industry** | **No** — same selector problem |
| **Company HQ / location** | **No** |
| **Company founded year** | **No** |
| **Company website** | **No** |
| **JSON-LD JobPosting schema** | **No** — never parsed |
| **Skills tags** | **No** |
| **Seniority level** | **No** |
| **Job function** | **No** |
| **Applicant count** | **No** |
| **Posted date** | **No** |
| **Reposted indicator** | **No** |
| **LinkedIn salary estimate** | **No** |
| **External apply URL** | **No** |
| **Who posted the job** (recruiter name, title, LinkedIn URL) | **No** |
| **Connections at company** (count + link) | **No** |

Every field above is on the page DOM. Zero API cost. None require a network call.

**Downstream impact of missing this:**
- Scoring Company Fit dimension runs without firmographics — employee count, industry, HQ are all null
- Recruiter who posted is the highest-value contact at save time — not captured anywhere
- LinkedIn salary estimate exists even when comp is undisclosed — ignored
- Skills tags are structured and machine-readable — never used for matching
- Seniority and job function are one-word structured fields — ignored entirely

---

## Key architectural decisions

### `leaders[]` not `knownContacts[]` for hiring team

`knownContacts[]` is email-keyed throughout the codebase. Dedup, Gmail matching, the contacts panel, and manual add all assume email as the primary identifier. A recruiter scraped from the job page has no email — only name, title, and LinkedIn URL.

**Decision**: recruiters from the job posting page are added to `leaders[]` — the same array used for leadership contacts surfaced from Apollo and web research. `leaders[]` already handles email-optional contacts, already has a card UI, and already renders on the company/opportunity detail page.

- `knownContacts[]` = people you've communicated with (Gmail-sourced, email required) — automatically tracked communications and activity
- `leaders[]` = people you know *about* at the company (Apollo, web research, job posting) — no email required

A `role: 'recruiter'` tag on the card distinguishes posting-sourced contacts from leadership sourced via research. If the recruiter later emails you, Gmail extraction promotes them into `knownContacts` automatically.

---

---

## Phase 1 — JSON-LD + Firmographic Fix

**Value**: highest. Fixes broken employee/industry/website capture on every LinkedIn job save. Directly improves scoring. Zero risk.

**What's broken today**: `extractLinkedInCompanyFirmo()` points at `.org-top-card-summary-info-list` — a selector that only exists on LinkedIn *company pages*, not on `/jobs/view/` pages. Result: `employees` and `industry` are null on almost every LinkedIn job save.

### What gets built

**`extractLinkedInJobJsonLd()`** — parse the `<script type="application/ld+json">` block LinkedIn embeds on every job posting. Machine-readable, very reliable. Fields available:
- `title` — clean job title
- `description` — full JD as HTML (strip tags → plaintext)
- `datePosted` — ISO date string
- `employmentType` — `FULL_TIME` / `PART_TIME` / `CONTRACTOR` / `INTERN`
- `jobLocationType` — `TELECOMMUTE` = remote
- `jobLocation[].address` — structured city/state/country
- `hiringOrganization.name` — company name (canonical)
- `hiringOrganization.sameAs` — company LinkedIn URL
- `baseSalary.value.minValue` / `maxValue` / `unitText` — disclosed salary
- `skills` — sometimes present as flat array
- `occupationalCategory` — job function

**`extractLinkedInJobDom()`** — DOM fills for anything JSON-LD missed. Job-page-specific selectors for the About box (right sidebar):
- Employee count — `"201-500 employees"` string from About box `li`
- Industry — `"Software Development"` from About box
- HQ location — `"San Francisco, CA"`
- Founded year — `"Founded 2018"`
- Company website — external link in About box
- Company LinkedIn URL — `/company/acme` link in About box
- Seniority level — `"Mid-Senior level"` from job insight panel
- Job function — `"Sales, Business Development"` from job insight panel
- Skills tags — chips from "How you match" or job details section (max 20)
- Applicant count — `"47 applicants"` or `"Over 200 applicants"` verbatim
- Posted date — relative (`"2 days ago"`) resolved to ISO date at save time
- Reposted flag — boolean
- LinkedIn salary estimate — market estimate shown when comp not disclosed
- External apply URL — destination URL when job uses "Apply on company website"
- Work arrangement — from existing chip parsing (already partial)

**`extractLinkedInJobPosting()`** — unified composer. JSON-LD first, DOM fills gaps. Replaces the current patchwork of `extractJobDescriptionForPanel()`, `extractLinkedInJobMeta()`, and `extractLinkedInCompanyFirmo()`.

### New entry fields

```
companyWebsite         string | null   "https://acme.com"
hqLocation             string | null   "San Francisco, CA"
founded                string | null   "2018"
seniorityLevel         string | null   "Mid-Senior level"
jobFunction            string | null   "Sales, Business Development"
jobSkills              string[]        ["Salesforce", "CRM", "B2B SaaS"]
externalApplyUrl       string | null   apply destination URL
postedDate             string | null   "2026-04-09"
applicantCount         string | null   "Over 200 applicants"
isReposted             boolean
linkedinSalaryEstimate string | null   "$120K–$180K/yr (LinkedIn estimated)"
```

### Scoring integration

New fields passed into `scoreOpportunity` jobParts:
- Firmographics block: employees, industry, HQ, founded, seniority, job function
- Skills block: `Required Skills: Salesforce, CRM, B2B SaaS`
- Posting context: applicant count, reposted flag, posted date

All feed existing dimensions — no new dimensions, no new API calls.

### Files touched

| File | Change |
|------|--------|
| `content.js` | Add `extractLinkedInJobJsonLd()`, `extractLinkedInJobDom()`, `extractLinkedInJobPosting()`. Replace old extractors. Pass new fields in SAVE_OPPORTUNITY. |
| `sync.js` | Accept + write all new fields in `handleSaveOpportunity`. |
| `scoring.js` | Add firmoBlock, skillsBlock, postingMetaBlock to jobParts. |

**Cost: $0. Pure DOM reads.**

---

## Phase 2 — Hiring Team + Connections

**Value**: relationship intelligence at save time. The recruiter who posted the job and the connections at the company are the two highest-value relationship signals available on the page — currently both ignored.

### Hiring team (`hiringTeam[]`)

LinkedIn shows a "Meet the hiring team" card on most job postings. Extract:
- Name
- Title
- LinkedIn profile URL (strip tracking params)
- Role tag: always `'recruiter'` (they posted the job)
- Source: `'job_posting'`

Stored in `entry.leaders[]` — the existing array used for leadership contacts. Deduped by `linkedinUrl`. NOT stored in `knownContacts[]` — no email available at save time.

**Shape** (extends existing leader card shape):
```js
{
  name: "Jane Smith",
  title: "Head of Recruiting",
  linkedin: "https://linkedin.com/in/jane-smith",
  role: "recruiter",       // distinguishes from research-sourced leaders
  source: "job_posting",
  addedAt: 1712345678000
}
```

Rendered in the existing Leaders section on the company/opportunity detail page. `role: 'recruiter'` shown as a badge on the card. If Gmail later detects an email from this person, existing contact extraction promotes them into `knownContacts` automatically.

### LinkedIn connections

The job page shows "X connections work here" when the logged-in user has connections at the company. Extract:
- `linkedinConnectionsCount` (int) — number of connections
- `linkedinConnectionsUrl` (string) — link to see the list on LinkedIn

Neither value requires any API call. LinkedIn renders it directly in the DOM.

### Files touched

| File | Change |
|------|--------|
| `content.js` | Add `extractLinkedInRecruiter()`, `extractLinkedInConnections()`. Pass in SAVE_OPPORTUNITY. |
| `sync.js` | Accept `recruiter`, `linkedinConnectionsCount`, `linkedinConnectionsUrl` in `handleSaveOpportunity`. Merge recruiter into `leaders[]` (dedup by linkedin URL). Write connections fields to entry. |

**Cost: $0. Pure DOM reads.**

---

## Phase 3 — UI Surfaces (Opportunity Detail)

**Value**: all the data captured in Phases 1–2 needs to actually be visible and actionable. Currently even if we stored it, nothing renders it.

### Posting metadata chip row

Below the job title on the opportunity detail page, a single-line chip row:

```
[Mid-Senior]  ·  [Sales]  ·  [Posted Apr 9]  ·  [47 applicants]  ·  [↩ Reposted]
```

- Chips are small muted pill badges
- "Reposted" chip: amber
- Applicant count chip: green if "early applicant", amber if 50–200, red if "Over 200"
- Posted date: human-readable ("Apr 9" not "2026-04-09")
- Only renders chips for fields that exist

### Skills panel

Below the job description, collapsible:

```
Required Skills
[Salesforce]  [CRM]  [B2B SaaS]  [Sales Strategy]  [Forecasting]
```

Chips are plain for now. Matching against candidate skill profile is Phase 4.

### Hiring team in Leaders section

Recruiter from the job posting renders as a leader card in the existing Leaders section. A `[Recruiter]` badge distinguishes them from research-sourced leaders. No email shown. LinkedIn URL opens in new tab.

```
Leadership & Hiring Team
┌──────────────────────────────────────────────┐
│  Jane Smith          [Recruiter]  [LinkedIn ↗]│
│  Head of Recruiting                          │
│  Posted this job                             │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│  John CEO                         [LinkedIn ↗]│
│  Chief Executive Officer                     │
└──────────────────────────────────────────────┘
```

### Connections callout

If `entry.linkedinConnectionsCount > 0`, shown in the hiring team section or contacts area:

```
🔗  3 connections at Acme Corp   [View on LinkedIn ↗]
```

Click opens `linkedinConnectionsUrl` in new tab.

### Compensation — LinkedIn estimate

If `entry.linkedinSalaryEstimate` exists:
- No disclosed comp present: show estimate labeled `"LinkedIn estimated"`
- Disclosed comp also present: show disclosed comp first, estimate as secondary note below

### Side panel save confirmation

After "Send to Coop" saves, the existing confirmation card shows score + stage. Add one line if connections were found:

```
✓ Saved to Coop · Scoring in progress
🔗 3 connections at Acme Corp
```

### Files touched

| File | Change |
|------|--------|
| `opportunity.js` | Render chip row, skills panel, hiring team section, connections callout, salary estimate display. |
| `opportunity.html` | Markup slots for new sections if needed. |
| `sidepanel.js` | Add connections line to save confirmation card. |

**Cost: $0. Display only.**

---

## Phase 4 — Skills Match (Candidate Profile Integration)

**Value**: the skills gap between what a job requires and what you have is one of the most useful signals in scoring — currently inferred by the AI from prose, not computed from structured data.

### What gets built

**Candidate skill tags in Career OS** — already partially exists (`profileSkillTags[]`). Ensure it's populated and surfaced.

**Skill match computation at save time**: when `entry.jobSkills[]` and `profileSkillTags[]` both exist, compute:
- `matchedSkills[]` — skills in both lists (case-insensitive, fuzzy)
- `missingSkills[]` — job skills not in your profile

Store on entry. Feed into scoring prompt as structured data (not just prose).

**Skills panel update**: matched skills get a green check, missing skills get a neutral or amber indicator.

```
Required Skills
[✓ Salesforce]  [✓ CRM]  [✓ B2B SaaS]  [? Sales Strategy]  [✗ Forecasting]
```

**Scoring**: `skillsMatchBlock` added to jobParts with explicit matched/missing breakdown — gives the AI concrete evidence for qualification scoring instead of having to infer from resume text.

### Files touched

| File | Change |
|------|--------|
| `content.js` | No change (skills already captured in Phase 1). |
| `sync.js` | Compute `matchedSkills`, `missingSkills` in `handleSaveOpportunity` if both arrays present. |
| `scoring.js` | Add structured skills match block to jobParts. |
| `opportunity.js` | Render matched/missing skill chips. |
| `preferences.js` / Career OS | Ensure `profileSkillTags[]` is easy to populate and up to date. |

**Cost: $0. Local computation only.**

---

## What this does NOT change

- Non-LinkedIn ATS platforms (Greenhouse, Lever, Workday, Ashby) — separate project
- Research pipeline (Apollo, Serper) — none of this requires any API call
- Scoring dimensions or weights — only adds more structured input to existing dimensions
- `knownContacts[]` schema — not modified
- Kanban card view — no changes (too compact for this data)
- Company detail page — opportunity detail only

---

## Reliability notes

- **JSON-LD**: most stable source. LinkedIn maintains it for search engine indexing. Rarely breaks.
- **About box selectors**: simpler DOM structure than the action bar. More stable than LinkedIn selectors generally.
- **Recruiter card**: has been consistent for 2+ years.
- **Connections count**: straightforward text node. Stable.
- **Skill chips, seniority, applicant count**: moderate stability — inside the job details panel which LinkedIn iterates on occasionally.

All extraction is best-effort — if a selector returns nothing, the field is null and nothing breaks. No extraction failure can prevent a save from completing.
