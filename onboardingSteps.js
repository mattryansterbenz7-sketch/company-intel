// ── Coop onboarding step manifest ──────────────────────────────────────────
// Static, dev-authored. No ES modules — loaded via <script> tag. See PRD G1.
// Phase 1: only `open_page`, `inline_explain`, `dismiss_step`, `complete_step`
// are legal `call` values. Any mutating action ships in Phase 2.

(function () {
  const ONBOARDING_STEPS = [
    {
      id: 'first-run-api-key',
      version: '0.1.0',
      category: 'setup',
      required: true,
      triggerCondition: (state) => !state.hasAnyApiKey,
      prompt:
        "Hey — I'm Coop, your advisor inside this thing. I can't research anything until you drop at least one API key into the integrations page. Want me to take you there?",
      actions: [
        { label: 'Open integrations', call: 'open_page', args: ['integrations.html'] },
        { label: "I'll do it later", call: 'dismiss_step' }
      ]
    },
    {
      id: 'first-run-preferences',
      version: '0.1.0',
      category: 'setup',
      required: false,
      triggerCondition: (state) => state.hasAnyApiKey && !state.hasResumeText,
      prompt:
        "I work a lot better when I know who you are. Drop your resume and target roles into the preferences page and every score and chat reply I give you afterward will actually be grounded in your situation.",
      actions: [
        { label: 'Open preferences', call: 'open_page', args: ['preferences.html'] },
        { label: 'Skip for now', call: 'dismiss_step' }
      ]
    },
    {
      id: 'feature-operating-principles',
      version: '0.4.0',
      category: 'feature',
      required: false,
      triggerCondition: (state) =>
        !state.completedSteps.includes('feature-operating-principles') &&
        !state.dismissedSteps.includes('feature-operating-principles'),
      prompt:
        "Heads up — there's now a single textarea in your preferences called Operating Principles that controls how I interpret every piece of your data. It replaces a pile of hardcoded behavior I used to carry around. You should at least know it's there.",
      actions: [
        { label: 'Open it', call: 'open_page', args: ['preferences.html#operating-principles'] },
        { label: 'Just summarize', call: 'inline_explain', args: ['operating-principles'] },
        { label: 'Got it', call: 'dismiss_step' }
      ]
    },
    {
      id: 'feature-apply-queue',
      version: '0.4.0',
      category: 'feature',
      required: false,
      triggerCondition: (state) =>
        !state.completedSteps.includes('feature-apply-queue') &&
        !state.dismissedSteps.includes('feature-apply-queue'),
      prompt:
        "When you save an opportunity it lands in the Apply Queue stage on the saved page. That's where I score it against your preferences before you invest time. Worth knowing so you stop wondering where new saves go.",
      actions: [
        { label: 'Explain more', call: 'inline_explain', args: ['apply-queue'] },
        { label: 'Open saved', call: 'open_page', args: ['saved.html'] },
        { label: 'Got it', call: 'dismiss_step' }
      ]
    },
    {
      id: 'feature-manual-coop-bind',
      version: '0.4.1',
      category: 'feature',
      required: false,
      triggerCondition: (state) =>
        !state.completedSteps.includes('feature-manual-coop-bind') &&
        !state.dismissedSteps.includes('feature-manual-coop-bind'),
      prompt:
        "See the paperclip button at the top of this chat? That manually binds me to a saved company or opportunity so I pull in its emails, meetings, and notes as context. Useful when auto-detection misses or you want to talk about something other than the tab you're on.",
      actions: [
        { label: 'How it works', call: 'inline_explain', args: ['manual-bind'] },
        { label: 'Got it', call: 'dismiss_step' }
      ]
    },
    {
      id: 'feature-coop-memory',
      version: '0.4.2',
      category: 'feature',
      required: false,
      triggerCondition: (state) =>
        !state.completedSteps.includes('feature-coop-memory') &&
        !state.dismissedSteps.includes('feature-coop-memory'),
      prompt:
        "Worth knowing: I passively extract insights about you from our chats and save them to your Story Time profile. Preferences, constraints, priorities you mention once in passing show up in future conversations so you don't have to repeat yourself.",
      actions: [
        { label: 'How it works', call: 'inline_explain', args: ['coop-memory'] },
        { label: 'Open preferences', call: 'open_page', args: ['preferences.html'] },
        { label: 'Got it', call: 'dismiss_step' }
      ]
    }
  ];

  const INLINE_EXPLANATIONS = {
    'operating-principles':
      "Operating Principles is a single plaintext block in your preferences that I read at the start of every chat, scoring, and synthesis task. Whatever you write there becomes the rules I follow — tone, what you care about, what to avoid, how to weigh tradeoffs. The seed value is reasonable but not personalized. Edit it when you notice me behaving in a way you don't like, and the change takes effect on the next message.",
    'apply-queue':
      "The Apply Queue is the first stage every saved opportunity lands in. I run a scoring pass against your preferences — salary, role fit, work arrangement, dealbreakers — and surface the verdict on the saved page. You review the queue, then either advance strong matches into your pipeline or drop the weak ones. It exists so you stop spending time writing applications for roles that were never going to work.",
    'coop-memory':
      "After each chat turn I quietly look at what you said and pull out anything that reads like a durable preference, constraint, or priority — things like salary expectations, deal-breakers, stages of life, career goals. Those get appended to your Story Time profile in preferences. Next conversation, I already know. You can edit or delete anything I extract from the preferences page.",
    'manual-bind':
      "The paperclip button in the chat header opens a picker for your saved companies and opportunities. Pick one and I bind to it — meaning every subsequent message pulls that entry's full context: notes, tags, cached emails, meeting transcripts, scoring history. Useful when you want to talk about an opportunity that isn't the tab you're currently on, or when auto-detection from the page missed."
  };

  window.ONBOARDING_STEPS = ONBOARDING_STEPS;
  window.INLINE_EXPLANATIONS = INLINE_EXPLANATIONS;
})();
