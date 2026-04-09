// ── Coop onboarding runtime ────────────────────────────────────────────────
// Matching + persistence layer for the step manifest in onboardingSteps.js.
// Phase 1 per PRD G1: read-only surfacing only. No API calls, no mutations
// beyond onboardingState bookkeeping.

(function () {
  const STORAGE_KEY = 'onboardingState';

  function defaultState() {
    return {
      version: '0.0.0',
      completedSteps: [],
      dismissedSteps: [],
      lastInteraction: 0,
      pendingStep: null
    };
  }

  function loadState() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([STORAGE_KEY], data => {
          void chrome.runtime.lastError;
          const s = data[STORAGE_KEY] || defaultState();
          // Defensive: ensure arrays exist (old installs might have partial state)
          s.completedSteps = Array.isArray(s.completedSteps) ? s.completedSteps : [];
          s.dismissedSteps = Array.isArray(s.dismissedSteps) ? s.dismissedSteps : [];
          resolve(s);
        });
      } catch (e) {
        resolve(defaultState());
      }
    });
  }

  function saveState(state) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  function loadPrefs() {
    return new Promise(resolve => {
      try {
        chrome.storage.sync.get(['prefs'], data => {
          void chrome.runtime.lastError;
          if (data && data.prefs) return resolve(data.prefs);
          chrome.storage.local.get(['prefs'], d2 => {
            void chrome.runtime.lastError;
            resolve((d2 && d2.prefs) || {});
          });
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function loadKeyFlags() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(
          ['anthropic_key', 'openai_key', 'apollo_key', 'serper_key', 'savedCompanies'],
          data => {
            void chrome.runtime.lastError;
            const hasAnyApiKey = !!(
              data.anthropic_key ||
              data.openai_key ||
              data.apollo_key ||
              data.serper_key
            );
            resolve({
              hasAnyApiKey,
              savedCompaniesCount: Array.isArray(data.savedCompanies) ? data.savedCompanies.length : 0
            });
          }
        );
      } catch (e) {
        resolve({ hasAnyApiKey: false, savedCompaniesCount: 0 });
      }
    });
  }

  async function buildStateSnapshot() {
    const [state, prefs, keyFlags] = await Promise.all([loadState(), loadPrefs(), loadKeyFlags()]);
    const resumeText = (prefs && (prefs.resume || prefs.resumeText || prefs.experience)) || '';
    let installedVersion = '0.0.0';
    try {
      installedVersion = chrome.runtime.getManifest().version || '0.0.0';
    } catch (e) {}
    return {
      hasAnyApiKey: keyFlags.hasAnyApiKey,
      installedVersion,
      completedSteps: state.completedSteps,
      dismissedSteps: state.dismissedSteps,
      savedCompaniesCount: keyFlags.savedCompaniesCount,
      hasResumeText: !!(resumeText && String(resumeText).trim().length > 0),
      prefs,
      pendingStep: state.pendingStep,
      onboardingVersion: state.version
    };
  }

  // Coarse semver compare — handles x.y.z strings only.
  function cmpVersion(a, b) {
    const pa = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  async function handleVersionBump(snapshot) {
    // If installedVersion > stored onboardingVersion, queue feature steps in that range.
    // We don't *render* a queue — getNextStep already walks the manifest and picks the
    // first unmet match. All this function does is update the stored version after a
    // successful drain, and leave a marker on the snapshot so future logic can know.
    if (cmpVersion(snapshot.installedVersion, snapshot.onboardingVersion) <= 0) return;
    const steps = Array.isArray(window.ONBOARDING_STEPS) ? window.ONBOARDING_STEPS : [];
    const pending = steps.filter(
      s =>
        s.category === 'feature' &&
        cmpVersion(s.version, snapshot.onboardingVersion) > 0 &&
        cmpVersion(s.version, snapshot.installedVersion) <= 0 &&
        !snapshot.completedSteps.includes(s.id) &&
        !snapshot.dismissedSteps.includes(s.id)
    );
    if (pending.length === 0) {
      // Nothing to walk — advance stored version immediately.
      const state = await loadState();
      state.version = snapshot.installedVersion;
      await saveState(state);
    }
    // If there IS pending work, leave version unchanged — it advances after the
    // last feature step in the window is completed or dismissed (handled in markComplete/markDismissed).
  }

  async function getNextStep() {
    const snapshot = await buildStateSnapshot();
    await handleVersionBump(snapshot);

    const steps = Array.isArray(window.ONBOARDING_STEPS) ? window.ONBOARDING_STEPS : [];
    if (steps.length === 0) return null;

    // pendingStep resumes first regardless of manifest order
    // BUT re-check triggerCondition — if the user has since satisfied the condition
    // (e.g. added an API key after "I'll do it later"), clear it and don't resume.
    if (snapshot.pendingStep && snapshot.pendingStep.id) {
      const resume = steps.find(s => s.id === snapshot.pendingStep.id);
      if (
        resume &&
        !snapshot.completedSteps.includes(resume.id) &&
        !snapshot.dismissedSteps.includes(resume.id)
      ) {
        const conditionStillMet = typeof resume.triggerCondition !== 'function' ||
          resume.triggerCondition(snapshot);
        if (conditionStillMet) {
          return resume;
        } else {
          // Condition no longer applies — auto-clear the pending step
          await clearPendingStep();
        }
      }
    }

    for (const step of steps) {
      if (snapshot.completedSteps.includes(step.id)) continue;
      if (snapshot.dismissedSteps.includes(step.id)) continue;
      try {
        if (typeof step.triggerCondition === 'function' && step.triggerCondition(snapshot)) {
          return step;
        }
      } catch (e) {
        console.warn('[onboarding] triggerCondition threw for', step.id, e);
      }
    }
    return null;
  }

  async function markComplete(stepId) {
    if (!stepId) return;
    const state = await loadState();
    if (!state.completedSteps.includes(stepId)) state.completedSteps.push(stepId);
    state.lastInteraction = Date.now();
    if (state.pendingStep && state.pendingStep.id === stepId) state.pendingStep = null;
    await maybeAdvanceVersion(state);
    await saveState(state);
  }

  async function markDismissed(stepId) {
    if (!stepId) return;
    const state = await loadState();
    if (!state.dismissedSteps.includes(stepId)) state.dismissedSteps.push(stepId);
    state.lastInteraction = Date.now();
    if (state.pendingStep && state.pendingStep.id === stepId) state.pendingStep = null;
    await maybeAdvanceVersion(state);
    await saveState(state);
  }

  async function maybeAdvanceVersion(state) {
    // If every feature step with version <= installedVersion is either completed
    // or dismissed, advance onboardingState.version to installedVersion.
    let installedVersion = '0.0.0';
    try {
      installedVersion = chrome.runtime.getManifest().version || '0.0.0';
    } catch (e) {}
    if (cmpVersion(installedVersion, state.version) <= 0) return;
    const steps = Array.isArray(window.ONBOARDING_STEPS) ? window.ONBOARDING_STEPS : [];
    const remaining = steps.filter(
      s =>
        s.category === 'feature' &&
        cmpVersion(s.version, installedVersion) <= 0 &&
        !state.completedSteps.includes(s.id) &&
        !state.dismissedSteps.includes(s.id)
    );
    if (remaining.length === 0) state.version = installedVersion;
  }

  async function setPendingStep(stepId, extra) {
    const state = await loadState();
    state.pendingStep = Object.assign({ id: stepId }, extra || {});
    await saveState(state);
  }

  async function clearPendingStep() {
    const state = await loadState();
    state.pendingStep = null;
    await saveState(state);
  }

  function dispatchAction(call, args, context) {
    const ctx = context || {};
    const currentStepId = ctx.currentStepId || null;

    switch (call) {
      case 'open_page': {
        const url = (args && args[0]) || '';
        if (!url) return { ok: false, error: 'no url' };
        try {
          const resolved = chrome.runtime.getURL(url);
          chrome.tabs.create({ url: resolved });
        } catch (e) {
          console.warn('[onboarding] open_page failed', e);
        }
        // open_page is non-terminal: keep the step pending so the user can return.
        if (currentStepId) setPendingStep(currentStepId, { reason: 'open_page', url });
        return { ok: true, kind: 'open_page' };
      }
      case 'inline_explain': {
        const topicId = (args && args[0]) || '';
        const map = window.INLINE_EXPLANATIONS || {};
        const text = map[topicId] || '';
        return { ok: true, kind: 'inline_explain', text, topicId };
      }
      case 'dismiss_step': {
        const id = (args && args[0]) || currentStepId;
        if (id) markDismissed(id);
        return { ok: true, kind: 'dismiss_step', id };
      }
      case 'complete_step': {
        const id = (args && args[0]) || currentStepId;
        if (id) markComplete(id);
        return { ok: true, kind: 'complete_step', id };
      }
      default:
        console.warn('[onboarding] Phase 1 dispatcher received unsupported call:', call);
        return { ok: false, error: 'unsupported call in phase 1', call };
    }
  }

  window.coopOnboarding = {
    getNextStep,
    markComplete,
    markDismissed,
    setPendingStep,
    clearPendingStep,
    buildStateSnapshot,
    dispatchAction
  };
})();
