# G1 — Self-serve Coop onboarding

**Status:** Proposed
**Date:** 2026-04-08
**Owner:** Matt
**Pairs with:** F1 (operating principles), B1 (qualification visibility)

## Problem / why now

CompanyIntel has shipped features faster than it has surfaced them. F1 added an Operating Principles textarea buried inside `preferences.html` that controls every conversation Coop has — and a user who never opens that page will never know it exists. B1/B2 changed how qualification scores are computed and capped, but there is no in-product surface that explains why a number moved. Apply Queue, Active Review, the manual `__coopBind` flow, the 3-model Coop split (chat / interpretation / synthesis), and Coop's passive memory extraction are all live and undocumented anywhere the user actually looks.

The compounding problem is first-run. The extension is useless until at least one API key is configured via `integrations.html`, and there is no signpost that points there. New installs land on a side panel that quietly fails every research call because the user has not been told what to do. Even for the only current user (Matt), the cost of "I shipped a thing last week and forgot it exists" is real — features die in the backlog because nothing reminds anyone they're there.

The fix is not a docs page (we have one — `docs.html` — and nobody reads it). The fix is Coop himself walking the user through setup and through each new feature as it ships, in the chat surface the user is already in, with the ability to take the action for them when it's safe to do so. Onboarding becomes a conversation, not a tour.

## Goals

- First-run users land in a guided conversation that gets them to a working state (API key, preferences seed, first research) without leaving the chat surface.
- Every shipped feature carries an onboarding step that Coop can introduce on next launch after the update.
- Coop can take configuration actions on the user's behalf via a structured dispatcher, with chat-based confirmation for anything destructive or expensive.
- State persists across sessions and across extension reloads — interrupted flows resume where they left off.
- Adding a new onboarding step is a one-file edit in the dev workflow, not a UI redesign.

## Non-goals

- A separate tour overlay, spotlight, or coachmark system. Onboarding lives inside the existing Coop chat panel.
- Persistent chat history (still session-only per CLAUDE.md). Onboarding *progress* persists; chat transcript does not.
- Replacing `docs.html`. Docs stays as the deep reference; onboarding is the active prompt.
- Telemetry or analytics on step completion. Local-only, no reporting.
- Multi-user / role-based onboarding. Single-user tool.

## User experience — narrative walkthroughs

### A. First-run setup

User installs the extension, opens the side panel for the first time. No API keys, no saved companies, nothing.

Coop opens automatically with a single message:

> Hey — I'm Coop. I'm the AI advisor inside this thing. Before I can help you research companies, you need to drop in at least one API key. Want me to take you to the integrations page?
>
> [Yes, open it] [I'll do it later]

User clicks "Yes, open it". The dispatcher fires `open_page("integrations.html")`. The integrations tab opens. Coop's next message (waiting for the user when they return):

> Welcome back. I see you set up Anthropic — that's enough to start. Want to test it on a real company? Pick any tab with a company website open and I'll research it for you.

User says "do bolt.com". Coop fires `run_research` (with no confirmation — it's $0.01ish and the user explicitly asked) and walks them through the result when it lands. After the result is shown, Coop transitions:

> One more thing before I get out of your way. I work way better if I know who you are and what you're looking for. Want to spend two minutes filling out your preferences, or paste in your resume and I'll do it?
>
> [Paste resume] [Open preferences page] [Skip for now]

Each path is one dispatcher call. "Skip for now" marks the step as `dismissed` and Coop will surface it again on the next session.

### B. New feature appears after an update

Matt pulls a build that ships the F1 Operating Principles textarea. Next time he opens the side panel, Coop's first message is unprompted:

> Quick heads-up — I learned a new trick since we last talked. There's now a single textarea in your preferences called "Operating Principles" that controls how I interpret all your data. It replaces a bunch of hardcoded behavior I used to have. The default seed is reasonable, but you should know it's there. Want me to open it so you can read it, or should I just summarize what it does?
>
> [Open it] [Just summarize] [Got it, dismiss]

If the user picks "Open it", dispatcher fires `open_page("preferences.html#operating-principles")`. If they pick "Just summarize", Coop replies inline with a 4-line explanation. Either way, the step is marked complete and won't fire again.

### C. Drift correction

Matt has been using the tool for two weeks. He's added five dealbreakers but never edited his Operating Principles, and his salary floor is set to $80K which is well below what he's actually been pursuing in conversation. Coop notices during a normal chat about an opportunity:

> Side note, not the thing you asked: I just told you that $140K base felt low for this role, but your salary floor is set to $80K. Want me to bump it? I'd suggest $130K based on what you've been saying lately.
>
> [Set to $130K] [Set to a different number] [Leave it alone]

The drift detector ran in the background after the user message landed. It compared the model's stated reasoning against the user's stored prefs and flagged the gap. Confirmation is required because `set_pref("salaryFloor", ...)` is mutating user data — a destructive action by the dispatcher's rules.

## Step manifest design

A new file `onboardingSteps.js` exports a static array. Each step is a plain object:

```js
const ONBOARDING_STEPS = [
  {
    id: 'first-run-api-key',
    version: '0.1.0',
    category: 'setup',          // setup | feature | drift | tip
    triggerCondition: (state) => !state.hasAnyApiKey,
    prompt: "Hey — I'm Coop. Before I can help, you need at least one API key...",
    actions: [
      { label: 'Open integrations', call: 'open_page', args: ['integrations.html'] },
      { label: "I'll do it later", call: 'dismiss_step' }
    ],
    required: true
  },
  {
    id: 'feature-operating-principles',
    version: '0.4.0',
    category: 'feature',
    triggerCondition: (state) => state.installedVersion >= '0.4.0' && !state.completedSteps.includes('feature-operating-principles'),
    prompt: "Quick heads-up — I learned a new trick. Operating Principles textarea now controls...",
    actions: [
      { label: 'Open it', call: 'open_page', args: ['preferences.html#operating-principles'] },
      { label: 'Just summarize', call: 'inline_explain', args: ['operating-principles'] },
      { label: 'Got it', call: 'dismiss_step' }
    ],
    required: false
  },
  // ...
];
```

### Fields

- `id` — stable string. Never reused. Used as the key in `completedSteps` / `dismissedSteps`.
- `version` — the build version where this step shipped. Lets us walk the user through everything that landed since they were last active.
- `category` — `setup` (must complete to use the tool), `feature` (introduces a new shipped capability), `drift` (config-drift correction), `tip` (optional power-user nudge).
- `triggerCondition(state)` — pure function returning bool. State includes `hasAnyApiKey`, `installedVersion`, `completedSteps`, `savedCompaniesCount`, prefs snapshot, etc. No side effects.
- `prompt` — the exact text Coop sends as the opening line of the step. Markdown allowed (chat panel already renders it).
- `actions[]` — array of `{label, call, args}` that become buttons inline in the Coop chat message. Each `call` maps to a dispatcher action (next section).
- `required` — if true, blocks subsequent steps until completed or explicitly dismissed.

### Dev workflow when shipping a new feature

The convention: every PR that introduces a user-visible feature appends one entry to `ONBOARDING_STEPS` in the same commit. The id is namespaced by version (`feature-{slug}`). The `triggerCondition` is the standard "version installed and not yet completed". The `prompt` is one paragraph in Coop's voice.

Reviewer checklist: if the diff touches a UI surface or adds a setting, the PR should include the step. If it doesn't, the reviewer pushes back.

## Action dispatcher design

A new client-side module `coopActions.js` is loaded by `sidepanel.js`, `saved.js`, and `company.js` (anywhere the Coop chat panel renders). It exposes a single function:

```js
coopActions.dispatch(call, args, { confirm, chatReply })
```

Coop emits action requests two ways:

1. **Button click in the chat UI** — the user clicks one of the inline buttons rendered from the step's `actions[]`. The dispatcher fires immediately.
2. **Tool-use JSON in a model response** — Coop's system prompt teaches him to emit a fenced block:
   ```json
   {"coopAction": {"call": "set_pref", "args": ["salaryFloor", 130000]}}
   ```
   The chat panel parses these out before rendering, executes them via the dispatcher, and shows a small "Coop did: set salary floor to $130K" status line in place of the JSON.

Confirmation for destructive/expensive actions does **not** use `confirm()` (Matt's rule — confirm() is broken in extension pages). Instead, the dispatcher posts a follow-up Coop message with two inline buttons:

> I'm about to set your salary floor to $130,000. Does that look right?
>
> [Yes, do it] [Cancel]

Only after the user clicks "Yes" does the action execute.

### Initial action surface

| call | args | confirms? | notes |
|------|------|-----------|-------|
| `set_pref` | `(key, value)` | yes | writes to `prefs` in chrome.storage.sync |
| `open_page` | `(url)` | no | navigates / opens tab |
| `save_operating_principles` | `(text)` | yes | writes `coopConfig.operatingPrinciples` |
| `add_dealbreaker` | `(text, severity)` | yes | appends to dealbreakers list |
| `add_attraction` | `(text)` | yes | appends to attractions list |
| `set_model` | `(task, modelId)` | no | task is `chat` / `interp` / `synth` |
| `run_research` | `(entryId)` | yes | costs API calls; show estimated cost in confirmation |
| `advance_stage` | `(entryId, stage)` | yes | mutates pipeline state |
| `inline_explain` | `(topicId)` | no | Coop sends a canned explanation message inline |
| `dismiss_step` | `(stepId?)` | no | marks current or named step dismissed |
| `complete_step` | `(stepId?)` | no | marks current or named step complete |

All non-confirming actions are read-only or trivially reversible. Anything that mutates user data, pipeline state, or burns API budget requires the chat-button confirmation flow.

## Persistence model

A new key in `chrome.storage.local`:

```js
onboardingState = {
  version: '0.4.2',           // last installed version Coop walked the user through
  completedSteps: ['first-run-api-key', 'first-run-resume', 'feature-apply-queue'],
  dismissedSteps: ['tip-keyboard-shortcuts'],
  lastInteraction: 1712534400000,
  pendingStep: {              // mid-flow resume target
    id: 'feature-operating-principles',
    awaitingConfirmation: true,
    pendingAction: { call: 'save_operating_principles', args: ['...'] }
  }
}
```

On every Coop chat panel mount, the panel reads `onboardingState`, walks `ONBOARDING_STEPS` in order, and finds the first step where `triggerCondition(state) === true` and the id is not in `completedSteps` or `dismissedSteps`. If `pendingStep` is set, that resumes first regardless of order. The matched step's `prompt` is injected as Coop's opening message before the user has typed anything.

On version bump (`installedVersion > onboardingState.version`), all `feature` category steps between the two versions queue up in order — the user gets a "since you last used this, three things shipped" walkthrough rather than three independent surprise messages.

## Surfacing / entry points

- **First-run auto-open side panel** — `chrome.runtime.onInstalled` triggers `chrome.sidePanel.open()` so the user lands directly in the chat the first time.
- **Bell icon on saved.js** — small bell in the header that pulses when there's an unstarted onboarding step waiting (not just first-run — also covers post-update feature steps and drift notices). Click jumps to the chat surface with that step pre-loaded.
- **Inline CTA from Coop chat** — during normal conversations, Coop can suggest "by the way, want me to walk you through X" which is just an inline `complete_step`/`pendingStep` rendezvous.
- **"What's new" link from docs.html** — manual entry point that opens the side panel and replays the most recent feature step on demand, even if it was previously dismissed.

## Phased rollout

### Phase 1 — static manifest + chat walkthrough only

Ship `onboardingSteps.js`, the matching logic, and the persistence layer. Inline buttons render in the chat panel but the only action calls allowed are `open_page`, `inline_explain`, `dismiss_step`, `complete_step`. No mutations, no API spend. The user is still doing all the real work — Coop is just pointing.

This phase validates the surfacing and persistence end-to-end with zero risk.

### Phase 2 — action dispatcher + confirmations

Add the full `coopActions.dispatch` module. Wire up `set_pref`, `save_operating_principles`, `add_dealbreaker`, `add_attraction`, `set_model`, `run_research`, `advance_stage`. Build the chat-button confirmation flow. Teach Coop's system prompt the tool-use JSON convention so model responses can emit actions, not just step buttons.

This phase makes onboarding actually self-serve — Coop can do the thing instead of pointing at it.

### Phase 3 — drift detection

Add a passive detector that runs after each Coop chat turn. It compares stated reasoning against stored prefs and flags gaps via injected `category: 'drift'` steps. Initial detectors:

- Salary numbers mentioned in chat vs `prefs.salaryFloor`
- Work arrangement mentioned vs `prefs.workArrangement`
- Repeated complaints about a behavior that operating principles could fix

Drift steps are non-blocking and fully dismissible.

## Verification checklist

### Phase 1

- [ ] Fresh install with no API key opens the side panel and the first message Coop sends is the `first-run-api-key` step prompt with two inline buttons
- [ ] Clicking "Open integrations" navigates to `integrations.html` and the step stays `pendingStep` until the user returns and an API key is detected
- [ ] After completing first-run, simulating a version bump (manually edit `onboardingState.version`) and reopening the side panel triggers the feature step for whichever versions were skipped, in order
- [ ] Dismissing a non-required step writes its id to `dismissedSteps` and it never appears again
- [ ] Reloading the extension mid-flow resumes at `pendingStep` rather than starting over

### Phase 2

- [ ] Coop can emit a tool-use JSON block and the chat panel parses, executes, and replaces it with a status line — the raw JSON never renders to the user
- [ ] `set_pref('salaryFloor', 130000)` triggers a chat-button confirmation, not a `confirm()` dialog
- [ ] Cancelling a confirmation leaves prefs untouched and Coop acknowledges the cancellation in his next message
- [ ] `run_research` confirmation message includes a cost estimate
- [ ] No call to `confirm()` exists anywhere in `coopActions.js` (case-sensitive search)

### Phase 3

- [ ] Manually setting salary floor to $80K then having a Coop chat where Coop reasons about $140K bases triggers a drift step on the next chat turn
- [ ] Drift steps can be dismissed and do not re-fire within the same session
- [ ] Drift detectors do not fire any API calls of their own — they piggyback on the existing chat response

## Out of scope

- A coachmark / spotlight overlay system. Lives in chat.
- Persistent chat transcripts. Onboarding state persists; chat does not.
- Onboarding analytics (completion rates, time-to-first-research, etc.). Personal tool, no reporting.
- Multiple onboarding profiles ("guided" vs "expert" mode). One flow, dismissible.
- AI-authored onboarding steps (Coop generating his own steps from a feature changelog). Steps are static dev-authored content.
- Localization. English only.
- Onboarding for the integrations page itself beyond the initial "open this page" pointer. The integrations page owns its own UX.
- Re-running completed required steps. Once `first-run-api-key` is in `completedSteps`, it stays there even if the user later deletes all keys — drift detection handles that case in Phase 3.
- Cross-device sync of onboarding state. Local only. Reinstalling on a new machine starts onboarding fresh, which is correct.

## Follow-ups (not in this PRD)

- Once Phase 2 lands, audit `background.js` and `saved.js` for hardcoded "feature exists" hints (toasts, tooltips, badges) and migrate them into onboarding steps so there's one surface for "the user should know about this."
- Consider a lightweight "step authoring" helper command that scaffolds a new step entry from the diff of a PR, to lower the friction on the dev workflow convention.
