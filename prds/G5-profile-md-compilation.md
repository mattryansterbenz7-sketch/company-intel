# G5 — Profile .md Compilation + G2 Completion + Legacy Removal

**Status:** Draft, pending approval
**Author:** Matt + Claude (2026-04-13 session)
**Depends on:** G2 (shipped), system audit (2026-04-13)
**Blocks:** Tiered scoring PRD (separate)

---

## Problem

Three connected problems surfaced in the 2026-04-13 system audit:

1. **User profile data is stored across 15+ keys in 3 different formats** (HTML from contenteditable, plain text, JSON arrays) with legacy/structured duplication. What gets injected into prompts depends on which keys are populated and which fallback fires. The user has no visibility into what Coop actually sees.

2. **G2 tool-use is now the default chat path, but two modes still use the legacy path** (Career OS editor, application helper). The legacy path stuffs 4,000-11,000 tokens into every message. As long as it exists, it's a maintenance liability and a source of accidental cost if the G2 path errors.

3. **Three features generate data that's never read by any prompt** (storyTime.learnedInsights, coopIdealRoleAssessment, profileFaqPairs). Tokens are spent producing data that goes nowhere.

---

## Vision

The user edits their profile in a nice UI. On save, the system compiles everything into clean markdown documents — Coop's single source of truth. These .md docs are what go into prompts, what tools return, and what the user can inspect. One format, one place, no duplication, no fallback chains, no waste.

---

## Design

### Compiled Documents

On any profile save, the system produces three markdown documents stored as strings in `chrome.storage.local`:

**`coopProfile`** — Who the user is
```markdown
# Matt Sterbenz

## Story
[compiled from profileStory]

## Experience
[compiled from profileExperience + profileExperienceEntries, merged and deduped]

## Skills & Intangibles
[compiled from profileSkills + profileSkillTags, merged]

## Operating Principles
[compiled from profilePrinciples]

## Voice & Communication Style
[compiled from profileVoice + voiceProfile.antiPhrases]

## FAQ / Polished Responses
[compiled from profileFaqPairs (structured) OR profileFAQ (text), preferring structured]

## Resume
[compiled from profileResume.content or prefs.resumeText, single source]
```

**`coopPreferences`** — What the user wants
```markdown
# Job Search Preferences

## Role ICP
[compiled from profileRoleICP — structured fields formatted as markdown]

## Company ICP
[compiled from profileCompanyICP — structured fields formatted as markdown]

## Green Flags (Attracted To)
[compiled from profileAttractedTo — each with category, severity, keywords]

## Red Flags (Dealbreakers)
[compiled from profileDealbreakers — each with category, severity, keywords]

## Compensation
- Base floor: $X | Base strong: $X
- OTE floor: $X | OTE strong: $X

## Location & Work Arrangement
- Location: City, State
- Arrangement: [remote, hybrid, on-site]
- Max travel: X%

## Interview Learnings
[compiled from profileInterviewLearnings — last 20, with date and source]
```

**`coopMemory`** — What Coop has learned (unchanged structure, already works)

### Tiered Versions

Each document is compiled at three detail levels:

| Tier | Profile tokens | Preferences tokens | When used |
|------|---------------|-------------------|-----------|
| **Summary** | ~200 | ~150 | Trivial exchanges, model switches, greetings |
| **Standard** | ~800 | ~500 | General chat, most questions |
| **Full** | ~2000 | ~1200 | Scoring, application help, cover letters, deep career questions |

Storage keys:
```
coopProfileSummary, coopProfileStandard, coopProfileFull
coopPrefsSummary, coopPrefsStandard, coopPrefsFull
```

The summary tier is a one-paragraph distillation. The standard tier has section headings with key points. The full tier is everything.

### Compilation Trigger

Compilation runs:
- On any profile section save in preferences.js
- On preference changes (salary, work arrangement, ICP)
- On memory changes (coopMemory entries added/removed)
- NOT on every chat message (compiled at write time, read at chat time)

Compilation is a local text transform, not an AI call. It reads storage keys, formats as markdown, truncates to tier budgets, and writes the compiled strings. Zero API cost.

### Tool Updates

G2 tools updated to return compiled .md instead of assembling from raw storage:

| Tool | Current | After |
|------|---------|-------|
| `get_profile_section(section)` | Reads raw storage keys, assembles text | Returns slice of `coopProfileStandard` or `coopProfileFull` |
| `get_profile_section('preferences')` | Reads prefs + ICP keys | Returns `coopPrefsStandard` or `coopPrefsFull` |
| `search_memory(query)` | Searches coopMemory entries | Unchanged (memory is already structured) |

The tool can request a specific tier: `get_profile_section('story', 'full')` vs `get_profile_section('story', 'standard')`.

### Slim System Prompt Update

The G2 slim system prompt (`_buildSlimCoopSystemPrompt`) is updated to always include `coopProfileSummary` inline — the ~200 token version. This ensures Coop always knows the basics (name, role, key skills) without a tool call, even for simple messages.

This also solves the G2.1 cache issue — the summary padding pushes the base prompt comfortably above Haiku's 2048-token cache minimum.

### "View What Coop Sees" Button

New button in preferences UI (Coop tab): "View Coop's Profile"

Opens a read-only modal showing the compiled `coopProfileStandard` + `coopPrefsStandard` as rendered markdown. The user sees exactly what Coop sees. If something is wrong or missing, they know where to fix it.

Optional: show token count per section so cost-conscious users can optimize.

---

## Phase 2: Port Career OS Editor + Application Mode to G2

### Career OS Editor Mode

Currently uses a specialized system prompt with `career-os-update` code fences for structured profile edits.

Port to G2 by adding a new tool:

```
update_profile(target, action, data)
```

Targets: `attractedTo`, `dealbreakers`, `skillTags`, `roleICP`, `companyICP`, `learnings`

This replaces the code-fence approach. Coop calls the tool, the handler validates and writes to storage, then re-compiles the .md docs. The chat response confirms the change.

### Application Helper Mode

Currently uses a specialized system prompt that instructs Coop to write short, copy-paste answers for application form fields.

Port to G2 by:
1. Adding the application-mode instructions to the slim system prompt when `context._applicationMode` is detected
2. Coop automatically calls `get_profile_section('full')` + `get_company_context()` for the bound company to have everything it needs for drafting

No new tools needed — just routing + the existing tool-use loop.

### Legacy Path Removal

Once both modes are ported:
1. Delete the entire legacy block in `handleCoopMessage()` (lines ~270-830 of coop-chat.js)
2. Delete `buildCoopProfileContext()` from coop-context.js (no longer called)
3. Delete `buildCoopPipelineSummary()` from coop-context.js (replaced by `get_pipeline_overview` tool)
4. Remove imports of these functions from coop-chat.js
5. Clean up any dead helper functions (detectContextIntent, buildCrossCompany*, etc.)

Estimated removal: ~600 lines.

---

## Phase 3: Clean Up Dead Data

With .md compilation as the single source of truth:

| Dead Feature | Action |
|---|---|
| `storyTime.learnedInsights[]` | Stop writing. Route all insights to `coopMemory`. Delete legacy routing in saved.js. |
| `coopIdealRoleAssessment` | Remove generate button. Data overlaps with `coopPreferences` Role ICP section which IS used. |
| `profileFaqPairs[]` (structured) | Compiler reads these instead of `profileFAQ` text. Text version becomes dead, not structured. |
| Legacy sync prefs (`prefs.roles`, `prefs.avoid`, `prefs.jobMatchBackground`, `prefs.resumeText`) | One-time migration to structured equivalents. Remove from scoring prompt. |
| Dual storage (`prefs.linkedinUrl` / `profileLinks.linkedin`) | Consolidate to `profileLinks`. Remove sync copy. |

---

## What Changes for the User

**Before:**
- 15+ storage keys, 3 formats, fallback chains, no visibility
- "What does Coop know about me?" — unknown
- Dead features silently consuming tokens
- Legacy path as accidental cost bomb

**After:**
- 3 compiled .md documents (profile, preferences, memory)
- "View Coop's Profile" button — see exactly what Coop sees
- Every chat message uses minimal context via G2 tools
- No legacy path, no dead features, no waste
- Compilation is free (local text transform, no AI call)

---

## Implementation Order

1. **Build compiler** — reads all storage keys, produces 6 strings (3 docs x 2 tiers, summary computed from standard). Store in chrome.storage.local. Wire to save events.
2. **Update G2 tools** — return compiled .md slices instead of raw assembly.
3. **Embed summary in slim prompt** — solve G2.1 cache issue simultaneously.
4. **Add "View Coop's Profile"** — transparency feature.
5. **Port Career OS editor** — new `update_profile` tool.
6. **Port application mode** — routing + auto-tool-call.
7. **Delete legacy path** — ~600 lines removed.
8. **Clean up dead data** — migrations + deletions.

Steps 1-4 can ship as one unit. Steps 5-8 as a second unit.

---

## Cost Impact

| Scenario | Before (legacy) | After (G2 + .md) |
|---|---|---|
| "switch to sonnet" | 4,000-11,000 input tokens | ~1,400 tokens (slim prompt only) |
| "tell me about my experience at Rep.ai" | 4,000-11,000 tokens (everything) | ~2,200 tokens (slim + standard profile section) |
| "draft a cover letter for this role" | 4,000-11,000 tokens | ~3,500 tokens (slim + full profile + full prefs + company context) |
| Application helper | 4,000-11,000 tokens every message | ~2,500 tokens (slim + full profile + company) |
| Career OS editor | 4,000-11,000 tokens every message | ~1,800 tokens (slim + standard profile) |

Estimated daily cost reduction (25 messages/day): **$1.50-2.50 → $0.05-0.20** (same as G2 PRD projection, now actually realized for all modes).
