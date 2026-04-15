# PRD S3 — Scoring Quality & Cost Visibility Pass

## Context

After shipping PRDs 1-4 (deterministic scoring engine, queue card UI, preferences deep-links, Coop's Score rename), live testing exposed three categories of issues:

1. **Evidence direction is backwards** — LLM cites candidate background as evidence for flags instead of citing what the job/company offers. Green flags represent what the candidate *wants*; evidence must show that the *job/company* provides it.

2. **Cost tracking is broken** — the dashboard "Today: $0.0000" pill never updates because `trackApiCall` receives a response whose body is consumed by the caller before `clone().json()` runs. Silent `catch {}` swallowed the error.

3. **Flag drawer UI is too long** — when many flags fire (13 green flags on Multiplier), the drawer becomes an unscrollable wall. Needs compaction.

---

## Issue 1: Evidence Direction

### Problem
The scoring prompt's loosened rules allowed the LLM to cite "Candidate background shows Ability to close large deals..." as evidence for a green flag. This is circular — the flag represents what the candidate wants, and the evidence should show what the JOB offers that matches.

### Root Cause
Prompt rule said "Evidence should cite the source" without specifying direction. GPT-4.1 Mini interpreted this as citing candidate evidence.

### Fix (DONE)
Updated prompt rules in `background.js` to explicitly state:
- Evidence must come from job posting or company context, NEVER from candidate background
- Wrong example vs right example included in prompt
- Each evidence string should quote/paraphrase the JD or company context

### Verification
Rescore one opportunity. Evidence should read like: "JD: 'Own full-cycle enterprise sales...'" not "Candidate has experience..."

---

## Issue 2: Cost Tracking

### Problem
`costToday` in `apiUsage` is always `undefined`. Dashboard pill shows $0.0000.

### Root Cause
Race condition: `openAiChatCall` and `claudeApiCall` pass the raw response to `trackApiCall` (fire-and-forget, no await). The caller (`chatWithFallback`) then calls `res.json()` which consumes the body. When `trackApiCall` later tries `response.clone().json()`, the body is already consumed → throws → caught by `catch {}` silently.

### Fix (DONE)
1. Callers now pass `res.clone()` to `trackApiCall` so it gets its own copy
2. `trackApiCall` now calls `response.json()` directly (no re-clone needed)
3. Silent `catch {}` replaced with `catch (costErr) { console.error(...) }`
4. `costToday` initialization hardened: `typeof usage.costToday !== 'number'` instead of `!usage.costToday`
5. Day reset now explicitly zeros `costToday`

### Verification
Rescore one opportunity. Check:
- Service worker console shows `[Cost] gpt-4.1-mini — in:XXXX out:XXXX → $0.00XX (today: $0.00XX)`
- Dashboard pill updates from $0.0000

---

## Issue 3: Flag Drawer Compaction

### Problem
When many green flags fire (13 on Multiplier), the Role Fit drawer becomes a massive scroll. Each flag card takes ~80px height with title + meta row + evidence quote. 13 flags = ~1040px just for green flags.

### Solution
Compact the flag cards when there are many:
- **Collapsed by default** when >4 flags in a column — show first 3, then "+N more" expander
- **Evidence on hover/click** instead of always visible — show flag title inline, evidence in a tooltip or expandable row
- **Tighter card padding** — reduce from current spacing

### Files
- `queue.js` — flag card rendering logic
- `queue.html` — flag card CSS

### Implementation

In `buildFlagCard()` and the drawer rendering:
1. When a dimension has >4 green or >4 red flags, only render first 3 with a "+N more" button
2. Evidence starts hidden, revealed on click/hover
3. Reduce flag card vertical padding

---

## Issue 4: Structured Experience Not Reaching Scorer (DONE earlier this session)

`profileExperienceEntries` (tagged skills per role) were never fetched or serialized into the scoring prompt. Fixed by adding to the storage fetch and serializing as "Structured experience (treat tagged skills as confirmed proficiency)" in the candidate section.

---

## Verification Checklist

After all fixes, one rescore should show:
- [ ] Cost pill updates with real dollar amount
- [ ] `[Cost]` log in service worker console
- [ ] Evidence cites JD/company, not candidate background
- [ ] Flag drawer is compact when many flags fire
- [ ] Structured experience appears in scoring prompt (already shipped)
