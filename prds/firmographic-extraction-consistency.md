# PRD: Firmographic Field Consistency

## Problem

Coop knows employee count and funding from intelligence synthesis (e.g. "1,000+ employees globally across Americas, EMEA, APAC") but the structured fields `entry.employees` and `entry.funding` are `null` or the string `"Not specified"`. This causes:

1. Queue card shows "Not specified" for Employees even though the answer is in the intel text
2. Company detail sidebar shows "Not specified" for the same fields
3. `"Not specified"` is a truthy string so our hide-if-empty logic doesn't suppress it

## Root Causes

### RC-1: String sentinel instead of null
The research pipeline writes `"Not specified"` as a string value when a field can't be populated from Apollo. This is treated as a real value by all display code.

### RC-2: No extraction from intelligence text
When Apollo fails, the pipeline runs a Serper + Claude synthesis that produces rich intelligence text. That text often contains employee count and funding data. There is no step that extracts structured fields from the synthesized text and backfills `entry.employees` / `entry.funding`.

### RC-3: Post-score opportunity missed
`processQuickFitScore` already has the job description and company context. It could extract/confirm firmographic data as a side effect of scoring, but currently doesn't.

## Fix Plan

### Fix 1 — Null sentinel (background.js)
- Wherever `employees`, `funding`, `industry`, `headcount`, `totalFunding` are set from web research: replace `"Not specified"`, `"Unknown"`, `""` with `null` before writing to the entry.
- Add a normalizer: `const nullIfEmpty = v => (!v || /not specified|unknown|n\/a/i.test(String(v))) ? null : v`
- Apply on all write paths in the research pipeline.

### Fix 2 — Extract from intelligence text (background.js)
After Claude synthesizes the intelligence object during `RESEARCH_COMPANY`, run a lightweight extraction pass over the resulting text to backfill missing structured fields:

```js
function extractFirmographicsFromText(text, entry) {
  if (!entry.employees) {
    const m = text.match(/(\d[\d,]+\+?)\s*employees/i) || text.match(/team of\s*(\d[\d,]+\+?)/i);
    if (m) entry.employees = m[1].trim();
  }
  if (!entry.funding) {
    const m = text.match(/raised\s+\$?([\d.]+[MBK]?(?:\s*billion|\s*million)?)/i)
              || text.match(/\$?([\d.]+[MBK])\s+(?:in\s+)?(?:Series\s+[A-Z]|seed|funding)/i);
    if (m) entry.funding = m[0].trim();
  }
}
```

Run this after `setCached()` and before returning from `RESEARCH_COMPANY`, then save the updated entry.

### Fix 3 — Post-score backfill (background.js)
In `processQuickFitScore`, after scoring completes:
- If `entry.employees` is null and the job description or `companyContext` (scout result) contains employee data, extract and write it to the entry.
- Same for `entry.funding`.
- This happens as a non-blocking side effect — does not delay rescore or re-render.

### Fix 4 — Display: hide null and sentinel strings (queue.js, company.js)
- `fact()` helper: treat `null`, `undefined`, `""`, and `/not specified|unknown/i` as empty → hide the row entirely.
- Company detail sidebar: apply same guard wherever `employees`, `funding`, `industry` are rendered.

## Acceptance Criteria

- [ ] Queue card never shows "Not specified" — field is hidden if unknown
- [ ] After researching Amagi, `entry.employees` is populated from the intelligence text
- [ ] After rescoring any job, if intel text mentions employee count, it backfills the entry
- [ ] Company detail sidebar matches queue card — no disparate data between views
- [ ] No sentinel strings stored in `savedCompanies` going forward
