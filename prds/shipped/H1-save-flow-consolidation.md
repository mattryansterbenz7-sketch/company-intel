# PRD H1 — Save Flow Consolidation

## Problem

There are four different save paths that create opportunity entries, each with its own code, its own entry-building logic, and its own JD handling. This causes:

### 1. Inconsistent data quality

| Save path | Where | Builds entry in | JD captured? | JD backfill? |
|-----------|-------|-----------------|--------------|--------------|
| "Send to Coop" pill | LinkedIn page (content.js) | content.js:1562 | **No — bug** (`descData.description` instead of `descData.jobDescription`) | No |
| "Save to AI queue" | Side panel | sidepanel.js `buildQueueEntry()` :5179 | Sometimes (race) | Yes — re-requests from content script |
| "Save + research now" | Side panel | sidepanel.js `buildQueueEntry()` :5179 | Sometimes (race) | Yes (same as above) |
| "+ Save Job Posting" | Side panel (opens form panel) | sidepanel.js `saveConfirmBtn` handler :495 | Sometimes (race) | No |

Three different functions build the same object shape with slightly different field sets. The "Send to Coop" path (the most convenient one, and likely the most used) has a field name typo that means **every entry saved through it has a null job description**. This is a primary cause of thin scoring results ("No requirements identified").

### 2. Confusing UX

Four buttons that do roughly the same thing with different names:
- "Send to Coop" (LinkedIn only, content script)
- "Save to AI queue" (side panel)
- "Save + research now" (side panel)
- "+ Save Job Posting" (side panel, opens a form)

The user has to understand when each appears and what each does differently. The save panel (notes, stars, stage picker) adds friction to the most common action (quick-save a job posting) for fields that can be edited later.

### 3. LinkedIn-only injection

The "Send to Coop" button — the best UX (one click, no side panel needed) — only injects on LinkedIn. Other job boards (Greenhouse, Lever, Workday, Ashby, company career pages) require opening the side panel even though the content script already detects jobs on those platforms.

---

## Design

### Three actions, one save function

Every job save calls a single `saveOpportunityEntry()` function. It lives in a shared location (content.js for on-page buttons, messaged to background.js for side panel calls). One function, one entry shape, one JD handling strategy.

**Action 1: "Send to Coop"** (primary — save + score)
- **On-page**: Injected as a pill button on any page where the content script detects a job posting. On LinkedIn, positioned in the action bar next to Apply/Save. On other job boards, positioned as a floating pill near the job title or apply button.
- **Side panel**: Replaces "Save to AI queue" as the primary button when a job title is detected.
- **Behavior**: Extracts JD + metadata from the page, builds the entry, saves to storage, queues for scoring. If JD extraction fails at save time, the scoring-layer fallback (fetch URL / Serper search) handles it.

**Action 2: "Send to Coop + Research"** (secondary — save + full research + score)
- **Side panel only**. Secondary/smaller button below "Send to Coop".
- **Behavior**: Same as "Send to Coop" but also triggers the full enrichment pipeline (Apollo → Serper → Claude synthesis) before scoring. For when you want deep company intelligence, not just a quick score.

**Action 3: "Save Company"** (no job detected)
- **Side panel only**. Shown when no job title is detected on the current page.
- **Behavior**: Saves a company-only entry. No `isOpportunity` flag, no job fields, no scoring. The existing "Research" button remains independent — it works whether or not the company is saved.

### What gets killed

- **"+ Save Job Posting" button** — replaced by "Send to Coop" in the side panel
- **Save panel form** (notes, stars, stage picker before save) — these fields are editable after save from the Kanban card, company detail page, or opportunity detail page. Pre-save friction for a quick-capture flow adds no value.
- **`buildQueueEntry()`** — replaced by the unified `saveOpportunityEntry()`
- **The inline entry builder in `saveConfirmBtn`** — replaced by the unified function
- **The inline entry builder in content.js `injectCoopButton`** — replaced by the unified function

### What stays

- **"Research" button** in the side panel — independent action, works on saved or unsaved companies
- **"Save Company" button** — for non-job pages
- **Queue confirmation card** — still shown after save in the side panel (score pending indicator, link to queue)
- **Duplicate detection** — same logic (company name match + title similarity), applied in the unified function

---

## Unified save function

```
saveOpportunityEntry({ company, jobTitle, jobUrl, jobDescription, jobMeta, linkedinFirmo, source })
```

**Inputs** (all extracted by the caller before invoking):
- `company` — company name (required)
- `jobTitle` — job title text (required for opportunity; null = company-only save)
- `jobUrl` — canonical job posting URL
- `jobDescription` — full JD text (up to 8000 chars). May be null if extraction failed.
- `jobMeta` — structured metadata: `{ workArrangement, salary, employmentType, location, perks }`
- `linkedinFirmo` — LinkedIn firmographics from DOM scrape: `{ employees, industry }`
- `source` — `'linkedin_page'`, `'sidepanel'`, `'other_ats'` (for analytics/debugging)

**Returns**: the saved entry object.

**Steps**:
1. Duplicate check — find existing entry with matching company + similar job title
2. If duplicate opportunity exists: enrich it with any new fields, return existing entry
3. Build entry object (single canonical shape, all fields)
4. Save to `chrome.storage.local` (prepend to `savedCompanies` array)
5. Queue `QUEUE_SCORE` for scoring
6. Return entry

**JD defense layers** (from most to least preferred):
1. Content script extracts JD from the page DOM before save (best quality — full text)
2. Scoring-layer fallback: if JD still null when scorer runs, fetch the jobUrl directly (works for Greenhouse/Lever/Workday/Ashby)
3. Scoring-layer fallback: if direct fetch fails (LinkedIn auth wall), Serper search for `"company" "title" job description`

---

## Scoring data strategy: page-first, Serper as fallback

### Scoring data strategy: always scout, research is for the dossier

Every "Send to Coop" score includes three data sources:

1. **The JD itself** — "About us" section, culture signals, team size, funding stage, role details. Extracted from the page DOM (up to 8000 chars).
2. **LinkedIn firmographics** — employee count and industry, scraped from the DOM.
3. **`scoutCompany()`** — 2 Serper searches (company overview + employee reviews/culture). Cached 7 days. The one category of data the JD genuinely doesn't contain is employee reviews (Glassdoor, RepVue, Reddit). Cost: ~$0.002 per company.

Scout always runs unless the entry already has `intelligence` from a prior full research. The cost delta of skipping it (~$0.002) isn't worth losing review signals.

**"Send to Coop + Research"** adds the full enrichment pipeline on top: Apollo firmographics, leadership profiles, product deep-dive, competitive landscape, Claude synthesis. This populates the company detail page — it's about the company dossier, not scoring quality.

### Cost impact

- **"Send to Coop"**: 2 Serper queries + 1 Haiku call per score (~$0.01-0.012)
- **"Send to Coop + Research"**: Above + Apollo + multi-query Serper + Haiku synthesis (~$0.03-0.05)

---

## On-page button injection

### Current: LinkedIn only

The "Send to Coop" pill injects into LinkedIn's action bar by trying 6+ container selectors, falling back to the Apply button's parent, then the Save button's parent.

### New: Any detected job posting

Extend injection to any page where `detectCompanyAndJob()` returns a job title.

**LinkedIn**: Same action bar injection (existing selectors).

**Greenhouse/Lever/Ashby/Workday**: Find the apply button or job title header and inject adjacent to it. These pages have simpler, more stable DOM structures than LinkedIn.

**Generic career pages**: Floating pill (fixed position, bottom-right) when a job title is detected but no known action bar is found. Subtle, non-intrusive, dismissable.

**Already-saved indicator**: On inject, check if the company + title is already saved. If yes, show the current pipeline stage instead of "Send to Coop" (existing behavior from the LinkedIn implementation — extend to all platforms).

---

## Bug fix (immediate, before consolidation)

content.js line 1530:
```js
// BUG: field name typo — extractJobDescriptionForPanel returns { jobDescription, jobMeta }
const jobDescription = descData?.description || null;

// FIX:
const jobDescription = descData?.jobDescription || null;
```

This one-line fix restores JD capture for every "Send to Coop" save from LinkedIn. Ship independently before the full consolidation.

---

## Scope and sequencing

### Phase 1: Bug fix + scoring fallback (immediate)
- Fix `description` → `jobDescription` typo in content.js (1 line)
- Scoring-layer JD fallback already shipped (fetch URL / Serper search in scoring.js)

### Phase 2: Unified save function
- Write `saveOpportunityEntry()` with canonical entry shape
- Wire "Send to Coop" (content.js), "Save to AI queue" (sidepanel.js), and "Save Job Posting" (sidepanel.js) to all call it
- Remove `buildQueueEntry()` and the inline builder in `saveConfirmBtn`
- Remove the save panel form (notes/stars/stage)

### Phase 3: Expand on-page injection
- Add ATS platform selectors for button injection (Greenhouse, Lever, Workday, Ashby)
- Add floating pill fallback for generic career pages
- Already-saved status check on all platforms

### Phase 4: Side panel button rename
- Rename "Save to AI queue" → "Send to Coop"
- Rename "Save + research now" → "Send to Coop + Research"
- Remove "+ Save Job Posting" button and associated save panel

---

## Files touched

| File | Changes |
|------|---------|
| content.js | Fix JD field name bug. Extend `injectCoopButton()` to non-LinkedIn job pages. Refactor entry building to call shared save function. |
| sidepanel.js | Replace `buildQueueEntry()`, `saveConfirmBtn` handler, and `queueSaveEntry()` with calls to unified save function. Rename buttons. Remove save panel HTML/CSS/JS. |
| sidepanel.html | Remove save panel markup. Rename button labels. |
| scoring.js | No changes (JD fallback already shipped). |
| background.js | Add `SAVE_OPPORTUNITY` message handler if save function lives in background (alternative: shared module). |

---

## What this does NOT change

- **Research pipeline** — unchanged. "Research" button still independent.
- **Scoring logic** — unchanged. `scoreOpportunity` still works the same.
- **Data model** — unchanged. Same `savedCompanies` array, same entry shape.
- **Chat/Coop** — unchanged. Auto-bind behavior stays the same.
- **Kanban/grid views** — unchanged. Cards still read the same fields.
- **Company-only saves** — unchanged. "Save Company" stays as-is for non-job pages.
