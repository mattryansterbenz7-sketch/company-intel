// bg-state.js — Shared mutable state, API keys, config, caches, constants, boot-time init.
// All mutable primitives live on the `state` object so ES module importers
// get a live reference (ES modules export values, not live bindings for primitives).

// ── Mutable state ──────────────────────────────────────────────────────────
export const state = {
  // API keys (overwritten by storage on boot + live-updated on change)
  ANTHROPIC_KEY: '',
  APOLLO_KEY: '',
  SERPER_KEY: '',
  OPENAI_KEY: '',
  GEMINI_KEY: '',
  GRANOLA_KEY: '',
  GOOGLE_CSE_KEY: '',
  GOOGLE_CSE_CX: '',

  // Provider exhaustion flags
  _apolloExhausted: false,
  _serperExhausted: false,

  // Pipeline config
  pipelineConfig: null, // set below after DEFAULT_PIPELINE_CONFIG

  // Coop config (personality, flags, automations)
  coopConfig: {},

  // Coop personality dials — loaded from chrome.storage.local.coop.personalityDials
  // Shape: { tone: 0.5, brevity: 0.5, formality: 0.5, anchorOverrides: { 'tone.0_6_to_0_8': '...' } }
  // Loaded at boot; undefined until storage is read. Composed into API system prompts defensively.
  personalityDials: undefined,

  // Cached user name
  cachedUserName: '',

  // Photo cache
  photoCache: {},
  photoPending: {},

  // Scoring queue
  _scoringQueue: [],
  _scoringInProgress: false,

  // Screenshot port
  _pendingScreenshot: null,

  // Insight extraction debounce
  _insightExtractionTimer: null,
  _pendingInsightArgs: null,

  // Granola index in-flight guard
  _granolaIndexInFlight: null,

  // Debug log ring buffer
  _debugLog: [],
};

// ── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_PIPELINE_CONFIG = {
  enrichmentOrder: [{ id: 'apollo', enabled: true }, { id: 'webResearch', enabled: true }],
  searchFallbackOrder: [
    { id: 'serper', enabled: true }, { id: 'google_cse', enabled: true },
    { id: 'openai', enabled: true }, { id: 'claude', enabled: true }
  ],
  aiModels: {
    companyIntelligence: 'claude-haiku-4-5-20251001',
    firmographicExtraction: 'claude-haiku-4-5-20251001',
    jobMatchScoring: 'claude-haiku-4-5-20251001',
    nextStepExtraction: 'claude-haiku-4-5-20251001',
    emailTaskExtraction: 'claude-haiku-4-5-20251001',
    chat: 'claude-haiku-4-5-20251001',
    coopAutofill: 'claude-haiku-4-5-20251001',
    coopMemorySynthesis: 'claude-sonnet-4-6',
  },
  searchCounts: { reviewScout: 3, reviewDrill: 2, leaders: 5, jobs: 5, product: 3 },
  photos: {
    sourceOrder: ['linkedin_thumbnail', 'serper_images'],
    maxPerCompany: 3,
    fetchScope: 'leaders_only',
    cacheTTLDays: 30
  },
  scoring: {
    scoutEnabled: true,
    scoutResultCount: 3,
    scoutCacheDays: 0, // 0 = indefinite — user force-refreshes via Research button
    autoResearch: false,
  },
  chatFallback: {
    enabled: true,             // allow fallback at all
    allowExpensive: false,     // if false, only cheap models (haiku, gpt-4.1-mini)
    showIndicator: true,       // show clear indicator when fallback used
  },
};

// Initialize pipelineConfig with defaults
state.pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG };

export const CACHE_TTL = Infinity; // Cache indefinitely — user force-refreshes via Research button

export const QUEUE_AUTO_PROCESS = true;
export const SCORE_THRESHOLDS = { green: 7, amber: 4 };
export const DISMISS_STAGE = 'rejected';
export const DISMISS_TAG = "Didn't apply";
export const QUEUE_STAGE = 'needs_review';

// ── Boot-time storage initialization ───────────────────────────────────────

// Load API keys from storage (with config.js fallback applied by caller)
export function initKeysFromConfig(cfg) {
  state.ANTHROPIC_KEY = cfg.ANTHROPIC_KEY || '';
  state.APOLLO_KEY = cfg.APOLLO_KEY || '';
  state.SERPER_KEY = cfg.SERPER_KEY || '';
  state.OPENAI_KEY = cfg.OPENAI_KEY || '';
}

export function initKeysFromStorage() {
  chrome.storage.local.get(['integrations'], ({ integrations }) => {
    if (!integrations) { console.log('[Keys] No integrations in storage, using config.js'); return; }
    console.log('[Keys] Loading from storage:', Object.keys(integrations).filter(k => !!integrations[k]).join(', '));
    console.log('[Keys] OpenAI key present:', !!integrations.openai_key, '| length:', (integrations.openai_key || '').length);
    const cleanKey = k => (k || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (integrations.anthropic_key)  state.ANTHROPIC_KEY = cleanKey(integrations.anthropic_key);
    if (integrations.openai_key)     state.OPENAI_KEY = cleanKey(integrations.openai_key);
    if (integrations.gemini_key)     state.GEMINI_KEY = cleanKey(integrations.gemini_key);
    if (integrations.apollo_key)     state.APOLLO_KEY = cleanKey(integrations.apollo_key);
    if (integrations.serper_key)     state.SERPER_KEY = cleanKey(integrations.serper_key);
    if (integrations.granola_key)    state.GRANOLA_KEY = cleanKey(integrations.granola_key);
    if (integrations.google_cse_key) state.GOOGLE_CSE_KEY = cleanKey(integrations.google_cse_key);
    if (integrations.google_cse_cx)  state.GOOGLE_CSE_CX = cleanKey(integrations.google_cse_cx);
  });
}

export function initCoopConfig() {
  chrome.storage.local.get(['coopConfig'], d => {
    if (d.coopConfig) state.coopConfig = d.coopConfig;
  });
}

export function initCachedUserName() {
  chrome.storage.sync.get(['prefs'], d => {
    const p = d.prefs || {};
    state.cachedUserName = p.name || p.fullName || '';
  });
}

/**
 * Load personalityDials from chrome.storage.local into state.
 * Stored as chrome.storage.local.coop.personalityDials
 * Shape: { tone: 0.5, brevity: 0.5, formality: 0.5, anchorOverrides: {} }
 */
export function initPersonalityDials() {
  chrome.storage.local.get(['coop'], d => {
    if (d.coop?.personalityDials) {
      state.personalityDials = d.coop.personalityDials;
    }
  });
}

export function initPipelineConfig() {
  chrome.storage.local.get(['pipelineConfig'], d => {
    if (d.pipelineConfig) {
      state.pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...d.pipelineConfig };
      if (d.pipelineConfig.aiModels) state.pipelineConfig.aiModels = { ...DEFAULT_PIPELINE_CONFIG.aiModels, ...d.pipelineConfig.aiModels };
      if (d.pipelineConfig.photos) state.pipelineConfig.photos = { ...DEFAULT_PIPELINE_CONFIG.photos, ...d.pipelineConfig.photos };
      if (d.pipelineConfig.scoring) state.pipelineConfig.scoring = { ...DEFAULT_PIPELINE_CONFIG.scoring, ...d.pipelineConfig.scoring };
      if (d.pipelineConfig.chatFallback) state.pipelineConfig.chatFallback = { ...DEFAULT_PIPELINE_CONFIG.chatFallback, ...d.pipelineConfig.chatFallback };
    }
    // One-time migration: reset AI models that still have old defaults
    const oldDefaults = {
      jobMatchScoring: 'claude-haiku-4-5-20251001',
      chat: 'gpt-4.1-mini',
    };
    let modelsMigrated = false;
    for (const [key, oldVal] of Object.entries(oldDefaults)) {
      if (state.pipelineConfig.aiModels?.[key] === oldVal) {
        state.pipelineConfig.aiModels[key] = DEFAULT_PIPELINE_CONFIG.aiModels[key];
        modelsMigrated = true;
      }
    }
    if (modelsMigrated) {
      chrome.storage.local.set({ pipelineConfig: state.pipelineConfig });
      console.log('[Pipeline] Migrated AI model defaults to new values');
    }
    console.log('[Pipeline] Config loaded:', JSON.stringify(state.pipelineConfig));
  });
}

// Photo cache — promise so callers can await readiness
export const _photoCacheReady = new Promise(resolve => {
  chrome.storage.local.get(['photoCache'], d => {
    if (d.photoCache) {
      state.photoCache = d.photoCache;
      console.log(`[PhotoCache] Loaded ${Object.keys(state.photoCache).length} entries from storage`);
    } else {
      console.log('[PhotoCache] No cache found in storage — starting fresh');
    }
    resolve();
  });
});
