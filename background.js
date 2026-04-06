// Floating sidebar is the primary UI — icon click toggles it
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── Debug log ring buffer — last 50 entries, accessible via message ──
const _debugLog = [];
function dlog(msg) {
  const entry = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
  _debugLog.push(entry);
  if (_debugLog.length > 50) _debugLog.shift();
  console.log(msg);
}

// ── Screenshot port: receives large screenshot data from sidepanel ──
let _pendingScreenshot = null;
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'coop-screenshot') {
    port.onMessage.addListener(msg => {
      if (msg.screenshot) {
        _pendingScreenshot = msg.screenshot;
        dlog(`[Screenshot] Received via port (${Math.round(msg.screenshot.length / 1024)}KB) — stored in memory`);
      }
    });
  }
});

// ── Contact extraction helper ───────────────────────────────────────────────
function parseEmailContact(fromStr) {
  if (!fromStr) return null;
  // "Carina Clingman <carina@company.com>" or just "email@company.com"
  const match = fromStr.match(/^(.+?)\s*<([^>]+)>/);
  if (match) {
    const name = match[1].replace(/"/g, '').trim();
    const email = match[2].trim().toLowerCase();
    if (name && email && !email.includes('noreply') && !email.includes('no-reply')) {
      return { name, email };
    }
  }
  // Plain email
  const plain = fromStr.trim().toLowerCase();
  if (plain.includes('@') && !plain.includes('noreply')) {
    const name = plain.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { name, email: plain };
  }
  return null;
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) return;
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' }, () => void chrome.runtime.lastError);
});

// Load API keys: storage-based (user-configurable) with config.js fallback
try { importScripts('coop.js'); } catch(e) {}
try { importScripts('config.js'); } catch(e) { /* no config.js — keys must be set via Integrations page */ }
const _cfg = (typeof CONFIG !== 'undefined') ? CONFIG : {};

let ANTHROPIC_KEY = _cfg.ANTHROPIC_KEY || '';
let APOLLO_KEY = _cfg.APOLLO_KEY || '';
let SERPER_KEY = _cfg.SERPER_KEY || '';
let OPENAI_KEY = _cfg.OPENAI_KEY || '';
let GRANOLA_KEY = '';
let GOOGLE_CSE_KEY = '';
let GOOGLE_CSE_CX = '';

// Override with storage-based keys on boot
chrome.storage.local.get(['integrations'], ({ integrations }) => {
  if (!integrations) { console.log('[Keys] No integrations in storage, using config.js'); return; }
  console.log('[Keys] Loading from storage:', Object.keys(integrations).filter(k => !!integrations[k]).join(', '));
  console.log('[Keys] OpenAI key present:', !!integrations.openai_key, '| length:', (integrations.openai_key || '').length);
  const cleanKey = k => (k || '').replace(/[^\x20-\x7E]/g, '').trim();
  if (integrations.anthropic_key) ANTHROPIC_KEY = cleanKey(integrations.anthropic_key);
  if (integrations.openai_key)    OPENAI_KEY = cleanKey(integrations.openai_key);
  if (integrations.apollo_key)    APOLLO_KEY = cleanKey(integrations.apollo_key);
  if (integrations.serper_key)    SERPER_KEY = cleanKey(integrations.serper_key);
  if (integrations.granola_key)   GRANOLA_KEY = cleanKey(integrations.granola_key);
  if (integrations.google_cse_key) GOOGLE_CSE_KEY = cleanKey(integrations.google_cse_key);
  if (integrations.google_cse_cx)  GOOGLE_CSE_CX = cleanKey(integrations.google_cse_cx);
  if (GRANOLA_KEY) setTimeout(() => buildGranolaIndex(), 5000);
});

// ── One-time migration: strip trailing punctuation from company names ────────
chrome.storage.local.get(['savedCompanies', 'researchCache', 'photoCache', '_migratedPunctuation2'], data => {
  if (data._migratedPunctuation2) return; // already ran
  const strip = s => s.replace(/[,;:!?.]+$/, '').trim();
  let dirty = false;

  // Clean savedCompanies
  const companies = data.savedCompanies || [];
  for (const c of companies) {
    if (c.company && c.company !== strip(c.company)) {
      c.company = strip(c.company);
      dirty = true;
    }
  }
  if (dirty) chrome.storage.local.set({ savedCompanies: companies });

  // Clean researchCache keys
  const cache = data.researchCache || {};
  const cleaned = {};
  let cacheDirty = false;
  for (const [k, v] of Object.entries(cache)) {
    const cleanK = strip(k);
    if (cleanK !== k) cacheDirty = true;
    if (!cleaned[cleanK] || (v.ts > cleaned[cleanK].ts)) {
      cleaned[cleanK] = v;
    }
  }
  if (cacheDirty) chrome.storage.local.set({ researchCache: cleaned });

  // Clean photoCache keys — company name is embedded in the key after |
  const pc = data.photoCache || {};
  const cleanedPhotos = {};
  let photoDirty = false;
  for (const [k, v] of Object.entries(pc)) {
    // Key format: "Name|\"Company,\"" → strip punctuation before closing quote
    const cleanK = k.replace(/[,;:!?.]+(?="?\s*$)/, '');
    if (cleanK !== k) photoDirty = true;
    if (!cleanedPhotos[cleanK]) cleanedPhotos[cleanK] = v;
  }
  if (photoDirty) {
    Object.assign(photoCache, cleanedPhotos);
    chrome.storage.local.set({ photoCache: cleanedPhotos });
  }

  // Clean duplicate/concatenated job titles
  for (const c of companies) {
    if (c.jobTitle) {
      const words = c.jobTitle.split(/\s+/);
      const half = Math.floor(words.length / 2);
      if (half >= 2) {
        const firstHalf = words.slice(0, half).join(' ').toLowerCase();
        const rest = c.jobTitle.toLowerCase();
        if (rest.indexOf(firstHalf) === 0 && rest.indexOf(firstHalf, 1) > 0) {
          c.jobTitle = c.jobTitle.slice(rest.indexOf(firstHalf, 1)).trim();
          dirty = true;
        }
      }
    }
  }
  if (dirty) chrome.storage.local.set({ savedCompanies: companies });

  chrome.storage.local.set({ _migratedPunctuation2: true });
  if (dirty || cacheDirty) console.log('[Migration] Cleaned company names and job titles');
});

// Live-update keys when user saves them from Integrations page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.integrations) {
    const v = changes.integrations.newValue || {};
    const ck = k => (k || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (v.anthropic_key) ANTHROPIC_KEY = ck(v.anthropic_key);
    if (v.apollo_key)    APOLLO_KEY = ck(v.apollo_key);
    if (v.serper_key)    SERPER_KEY = ck(v.serper_key);
    if (v.openai_key)    OPENAI_KEY = ck(v.openai_key);
    if (v.granola_key)   GRANOLA_KEY = ck(v.granola_key);
    if (v.google_cse_key) GOOGLE_CSE_KEY = ck(v.google_cse_key);
    if (v.google_cse_cx)  GOOGLE_CSE_CX = ck(v.google_cse_cx);
    _apolloExhausted = false;
    _serperExhausted = false;
  }

  // Auto-rescore active opportunities when Career OS profile changes
  const profileKeys = ['profileRoleICP', 'profileCompanyICP', 'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags'];
  const changedProfileKeys = profileKeys.filter(k => changes[k]);
  if (area === 'local' && changedProfileKeys.length && coopConfig.automations?.autoRescore !== false) {
    const rescoreStages = coopConfig.rescoreStages || ['needs_review', 'want_to_apply'];
    console.log('[AutoRescore] Profile changed:', changedProfileKeys, '— rescoring stages:', rescoreStages);
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const active = (savedCompanies || []).filter(c =>
        c.isOpportunity && rescoreStages.includes(c.jobStage || 'needs_review')
      );
      if (!active.length) return;
      console.log(`[AutoRescore] Rescoring ${active.length} active opportunities`);
      // Process in batches of 2 with 2s delay to avoid rate limits
      let i = 0;
      const processBatch = () => {
        const batch = active.slice(i, i + 2);
        if (!batch.length) return;
        batch.forEach(entry => {
          chrome.runtime.sendMessage({ type: 'QUICK_FIT_SCORE', entryId: entry.id }, () => void chrome.runtime.lastError);
        });
        i += 2;
        if (i < active.length) setTimeout(processBatch, 2000);
      };
      processBatch();
    });
  }
});

// Periodic Granola index refresh (every 6 hours, using setInterval — no alarms permission needed)
setInterval(() => { if (GRANOLA_KEY) buildGranolaIndex(); }, 6 * 60 * 60 * 1000);

// ── Pipeline Configuration ──────────────────────────────────────────────────
const DEFAULT_PIPELINE_CONFIG = {
  enrichmentOrder: [{ id: 'apollo', enabled: true }, { id: 'webResearch', enabled: true }],
  searchFallbackOrder: [
    { id: 'serper', enabled: true }, { id: 'google_cse', enabled: true },
    { id: 'openai', enabled: true }, { id: 'claude', enabled: true }
  ],
  aiModels: {
    companyIntelligence: 'claude-haiku-4-5-20251001',
    firmographicExtraction: 'claude-haiku-4-5-20251001',
    jobMatchScoring: 'claude-haiku-4-5-20251001',
    deepFitAnalysis: 'claude-haiku-4-5-20251001',
    nextStepExtraction: 'claude-haiku-4-5-20251001',
    chat: 'claude-haiku-4-5-20251001',
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
    scoutCacheDays: 7,
    autoResearch: false,
  }
};
let pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG };

// ── Coop personality presets (tone + style only — UI labels live in preferences.js) ──
const COOP_PRESETS_BG = {
  'sharp-colleague': {
    tone: `confident, direct, and always in his corner. You speak like a sharp colleague, not a corporate chatbot. Keep it real, keep it useful.`,
    style: `Keep answers short and direct. Use short paragraphs. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless asked. Write like a smart colleague in Slack, not a formal report.`,
  },
  'strategic-advisor': {
    tone: `thoughtful and analytical — a seasoned advisor who pushes on long-term implications. You ask the questions others miss and challenge assumptions when the stakes matter.`,
    style: `Structure responses around trade-offs and second-order effects. Use frameworks when they add clarity. Be willing to say "slow down" when a decision deserves more thought. Medium-length responses are fine when depth is warranted.`,
  },
  'hype-man': {
    tone: `encouraging and energizing — the colleague who genuinely believes in your strengths and makes sure you see them too. You highlight wins, reframe setbacks, and keep momentum high.`,
    style: `Lead with strengths and positive framing. Be specific about what makes the user strong for each opportunity. Keep energy high without being fake. Short, punchy responses that build confidence.`,
  },
  'formal-analyst': {
    tone: `precise and structured — a senior analyst delivering clear, evidence-based assessments. You organize information systematically and let data drive conclusions.`,
    style: `Use headers and structured sections freely. Prefer numbered lists and tables when comparing options. Cite specific data points from context. Longer, more thorough responses are expected. Professional tone throughout.`,
  },
};

let coopConfig = {};
chrome.storage.local.get(['coopConfig'], d => {
  if (d.coopConfig) coopConfig = d.coopConfig;
});

function buildIdentityPrompt(cfg, { globalChat, contextType }) {
  const preset = COOP_PRESETS_BG[cfg.preset] || COOP_PRESETS_BG['sharp-colleague'];
  const tone = cfg.toneOverride || preset.tone;
  const style = cfg.styleOverride || preset.style;
  const customInstructions = cfg.customInstructions ? `\n\n=== CUSTOM INSTRUCTIONS FROM USER ===\n${cfg.customInstructions}` : '';

  const capabilitiesGlobal = `You have full visibility across Matt's job search pipeline. You know his background, values, and preferences. You can see every company and opportunity he's tracking. When screen sharing is active, you can see screenshots of his browser — use them to help with whatever is on screen.\n\nHelp him prioritize opportunities, draft follow-up messages, compare options, and make strategic decisions. When he mentions a specific company or person, use the pipeline context to inform your response.\n\nBe direct, opinionated, and honest. Push back when something doesn't align with what you know about him. Don't be sycophantic.`;

  const capabilitiesCompany = `You have deep, full context about this ${contextType || 'company'} including meeting transcripts, emails, notes, and company research. You ALSO have visibility across the full pipeline — you can compare this opportunity to others and give strategic advice. When screen sharing is active, you can see screenshots of his browser — use them to help with whatever is on screen.\n\nUse ALL available context to give specific, grounded answers. If something isn't in your context, say so — never fabricate.`;

  const capabilities = globalChat ? capabilitiesGlobal : capabilitiesCompany;

  return `Your name is Coop. You are Matt's co-operator inside CompanyIntel — his AI agent for job search strategy, company research, and application prep. You're ${tone}\n\n${capabilities}\n\nResponse style: ${style}\n\nFormatting capabilities: Your responses are rendered as rich HTML. You can use full markdown: **bold**, *italic*, [links](url), bullet lists, numbered lists, \`inline code\`, fenced code blocks, and images via ![alt](url). Links will be clickable. Images will render inline.${customInstructions}`;
}

// Load pipeline config
chrome.storage.local.get(['pipelineConfig'], d => {
  if (d.pipelineConfig) {
    pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...d.pipelineConfig };
    if (d.pipelineConfig.aiModels) pipelineConfig.aiModels = { ...DEFAULT_PIPELINE_CONFIG.aiModels, ...d.pipelineConfig.aiModels };
    if (d.pipelineConfig.photos) pipelineConfig.photos = { ...DEFAULT_PIPELINE_CONFIG.photos, ...d.pipelineConfig.photos };
    if (d.pipelineConfig.scoring) pipelineConfig.scoring = { ...DEFAULT_PIPELINE_CONFIG.scoring, ...d.pipelineConfig.scoring };
  }
  // One-time migration: reset AI models that still have old defaults
  const oldDefaults = {
    deepFitAnalysis: 'claude-haiku-4-5-20251001',
    jobMatchScoring: 'claude-haiku-4-5-20251001',
    chat: 'gpt-4.1-mini',
  };
  let modelsMigrated = false;
  for (const [key, oldVal] of Object.entries(oldDefaults)) {
    if (pipelineConfig.aiModels?.[key] === oldVal) {
      pipelineConfig.aiModels[key] = DEFAULT_PIPELINE_CONFIG.aiModels[key];
      modelsMigrated = true;
    }
  }
  if (modelsMigrated) {
    chrome.storage.local.set({ pipelineConfig });
    console.log('[Pipeline] Migrated AI model defaults to new values');
  }
  console.log('[Pipeline] Config loaded:', JSON.stringify(pipelineConfig));
});

// Live-update pipeline config
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pipelineConfig) {
    pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...changes.pipelineConfig.newValue };
  }
  if (area === 'local' && changes.coopConfig) {
    coopConfig = changes.coopConfig.newValue || {};
  }
  // Auto-rescore active opportunities when salary/work prefs change
  if (area === 'sync' && changes.prefs && coopConfig.automations?.autoRescore !== false) {
    const oldPrefs = changes.prefs.oldValue || {};
    const newPrefs = changes.prefs.newValue || {};
    const salaryChanged = oldPrefs.salaryFloor !== newPrefs.salaryFloor || oldPrefs.salaryStrong !== newPrefs.salaryStrong ||
      oldPrefs.oteFloor !== newPrefs.oteFloor || oldPrefs.oteStrong !== newPrefs.oteStrong;
    const workChanged = JSON.stringify(oldPrefs.workArrangement) !== JSON.stringify(newPrefs.workArrangement);
    if (salaryChanged || workChanged) {
      const rescoreStages = coopConfig.rescoreStages || ['needs_review', 'want_to_apply'];
      console.log('[AutoRescore] Salary/work prefs changed — rescoring stages:', rescoreStages);
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const active = (savedCompanies || []).filter(c =>
          c.isOpportunity && rescoreStages.includes(c.jobStage || 'needs_review')
        );
        let i = 0;
        const processBatch = () => {
          const batch = active.slice(i, i + 2);
          if (!batch.length) return;
          batch.forEach(entry => {
            chrome.runtime.sendMessage({ type: 'QUICK_FIT_SCORE', entryId: entry.id }, () => void chrome.runtime.lastError);
          });
          i += 2;
          if (i < active.length) setTimeout(processBatch, 2000);
        };
        processBatch();
      });
    }
  }
});

// ── Company name matching helper ────────────────────────────────────────────
function companiesMatchLoose(a, b) {
  if (!a || !b) return false;
  const norm = s => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an|\.com)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check first significant word
  const fa = na.match(/[a-z]{3,}/)?.[0], fb = nb.match(/[a-z]{3,}/)?.[0];
  return fa && fb && (fa === fb || fa.includes(fb) || fb.includes(fa));
}

// ── One-time scan for data contamination ────────────────────────────────────
chrome.storage.local.get(['savedCompanies', '_dataConflictScanDone'], data => {
  if (data._dataConflictScanDone) return;
  const entries = data.savedCompanies || [];
  let changed = false;
  for (const e of entries) {
    if (e.dataConflict) continue; // already flagged
    const desc = e.intelligence?.eli5 || e.intelligence?.oneLiner || '';
    if (!desc || !e.company) continue;
    const companyWords = e.company.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    if (!companyWords.length) continue;
    const descLower = desc.toLowerCase();
    const mentionsCompany = companyWords.some(w => descLower.includes(w));
    if (!mentionsCompany) {
      e.dataConflict = true;
      changed = true;
      console.warn('[DataIntegrity] Flagged potential contamination:', e.company, '| desc:', desc.slice(0, 60));
    }
  }
  if (changed) chrome.storage.local.set({ savedCompanies: entries });
  chrome.storage.local.set({ _dataConflictScanDone: true });
});

// ── API Usage Tracking ──────────────────────────────────────────────────────

function initProviderUsage() {
  return {
    totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0,
    requestsToday: 0, tokensToday: { input: 0, output: 0 },
    lastRequestAt: null, lastRateLimit: {},
    dailyHistory: [], errors: { count429: 0, count401: 0, countOther: 0 }
  };
}

async function getApiUsage() {
  return new Promise(r => chrome.storage.local.get(['apiUsage'], d => r(d.apiUsage || { lastDayReset: '' })));
}

async function saveApiUsage(usage) {
  return new Promise(r => chrome.storage.local.set({ apiUsage: usage }, r));
}

async function trackApiCall(provider, response) {
  // Non-blocking — fire and forget
  try {
    const usage = await getApiUsage();
    const today = new Date().toISOString().slice(0, 10);

    // Reset daily counters if new day
    if (usage.lastDayReset !== today) {
      for (const key of Object.keys(usage)) {
        if (key === 'lastDayReset') continue;
        const p = usage[key];
        if (p?.requestsToday !== undefined) {
          p.requestsToday = 0;
          if (p.tokensToday) p.tokensToday = { input: 0, output: 0 };
        }
      }
      usage.lastDayReset = today;
    }

    if (!usage[provider]) usage[provider] = initProviderUsage();
    const pd = usage[provider];

    pd.totalRequests++;
    pd.requestsToday++;
    pd.lastRequestAt = Date.now();

    // Track errors
    if (!response.ok) {
      if (response.status === 429) pd.errors.count429++;
      else if (response.status === 401 || response.status === 403) pd.errors.count401++;
      else pd.errors.countOther++;
    }

    // Daily history
    let dayEntry = pd.dailyHistory.find(d => d.date === today);
    if (!dayEntry) {
      dayEntry = { date: today, requests: 0, inputTokens: 0, outputTokens: 0 };
      pd.dailyHistory.push(dayEntry);
    }
    dayEntry.requests++;
    pd.dailyHistory = pd.dailyHistory.slice(-30);

    // Token tracking for AI providers — read from cloned response
    if (provider === 'anthropic' || provider === 'openai') {
      try {
        const data = await response.clone().json();
        const inputTokens = data.usage?.input_tokens || data.usage?.prompt_tokens || 0;
        const outputTokens = data.usage?.output_tokens || data.usage?.completion_tokens || 0;
        pd.totalInputTokens += inputTokens;
        pd.totalOutputTokens += outputTokens;
        pd.tokensToday.input += inputTokens;
        pd.tokensToday.output += outputTokens;
        dayEntry.inputTokens += inputTokens;
        dayEntry.outputTokens += outputTokens;
      } catch {}
    }

    // Anthropic rate limit headers
    if (provider === 'anthropic') {
      pd.lastRateLimit = {
        tokensRemaining: parseInt(response.headers.get('anthropic-ratelimit-tokens-remaining')) || null,
        tokensLimit: parseInt(response.headers.get('anthropic-ratelimit-tokens-limit')) || null,
        requestsRemaining: parseInt(response.headers.get('anthropic-ratelimit-requests-remaining')) || null,
        requestsLimit: parseInt(response.headers.get('anthropic-ratelimit-requests-limit')) || null,
      };
    }

    await saveApiUsage(usage);
  } catch {}
}

const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days — company data doesn't change daily

// ── Multi-Provider AI Router ────────────────────────────────────────────────

function getModelForTask(taskId) {
  const models = pipelineConfig?.aiModels || {};
  const defaults = {
    companyIntelligence: 'claude-haiku-4-5-20251001',
    firmographicExtraction: 'claude-haiku-4-5-20251001',
    nextStepExtraction: 'claude-haiku-4-5-20251001',
    quickFitScoring: 'claude-haiku-4-5-20251001',
    profileInterpret: 'claude-haiku-4-5-20251001',
    chat: 'claude-haiku-4-5-20251001',
    // These tasks inherit from the user-facing "Fit Scoring" setting (quickFitScoring)
    jobMatchScoring: 'claude-haiku-4-5-20251001',
    deepFitAnalysis: 'claude-haiku-4-5-20251001',
    roleBrief: 'claude-haiku-4-5-20251001',
    profileConsolidate: 'claude-haiku-4-5-20251001',
  };
  // For scoring tasks not directly in the UI, inherit from the "Fit Scoring" (quickFitScoring) setting
  const fitModel = models.quickFitScoring;
  if (fitModel && ['jobMatchScoring', 'deepFitAnalysis', 'roleBrief', 'profileConsolidate'].includes(taskId) && !models[taskId]) {
    return fitModel;
  }
  return models[taskId] || defaults[taskId] || 'claude-haiku-4-5-20251001';
}

async function aiCall(taskId, { system, messages, max_tokens }) {
  const model = getModelForTask(taskId);

  if (model.startsWith('gpt-')) {
    if (!OPENAI_KEY) {
      console.warn(`[AI] OpenAI key missing for task ${taskId}, falling back to Claude`);
      const fallback = model.includes('mini') ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
      const res = await claudeApiCall({ model: fallback, system, messages, max_tokens });
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model: fallback };
    }
    const res = await openAiChatCall({ model, system, messages, max_tokens });
    const data = await res.json();
    return { ok: res.ok, status: res.status, text: data.choices?.[0]?.message?.content || '', raw: data, provider: 'openai', model };
  }

  if (!ANTHROPIC_KEY) {
    console.warn(`[AI] Anthropic key missing for task ${taskId}, falling back to OpenAI`);
    if (OPENAI_KEY) {
      const fallback = model.includes('sonnet') ? 'gpt-4.1' : 'gpt-4.1-mini';
      const res = await openAiChatCall({ model: fallback, system, messages, max_tokens });
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.choices?.[0]?.message?.content || '', raw: data, provider: 'openai', model: fallback };
    }
    return { ok: false, status: 0, text: '', raw: {}, provider: 'none', model, error: 'No AI keys configured' };
  }

  const res = await claudeApiCall({ model, system, messages, max_tokens });
  const data = await res.json();
  return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model };
}

// ── AI Scoring Queue Config ─────────────────────────────────────────────────
// Quick fit model reads from pipeline config — no hardcoded override
const QUEUE_AUTO_PROCESS = true;
const SCORE_THRESHOLDS = { green: 7, amber: 4 }; // 7+ green, 4-6 amber, below 4 red
const DISMISS_STAGE = 'rejected';
const DISMISS_TAG = "Didn't apply";
const QUEUE_STAGE = 'needs_review'; // first pipeline stage = AI scoring queue

// ── Background Scoring Queue ────────────────────────────────────────────────
let _scoringQueue = []; // array of entry IDs waiting to be scored
let _scoringInProgress = false;

// Retry wrapper for Claude API calls with exponential backoff on 429
async function claudeApiCall(body, maxRetries = 3) {
  // Enable prompt caching: convert system string to cacheable format
  if (typeof body.system === 'string' && body.system.length > 500) {
    body = {
      ...body,
      system: [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }]
    };
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify(body)
    });
    trackApiCall('anthropic', res); // non-blocking, no await needed
    if (res.status === 429 && attempt < maxRetries) {
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      console.warn(`[Claude] Rate limited (429), retrying in ${delay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}
// OpenAI chat API call (mirrors claudeApiCall pattern)
async function openAiChatCall({ model, system, messages, max_tokens }, maxRetries = 3) {
  const oaiMessages = [{ role: 'system', content: system }];
  for (const m of messages) {
    // Convert Claude multimodal format to OpenAI format
    if (Array.isArray(m.content)) {
      const oaiContent = m.content.map(block => {
        if (block.type === 'image' && block.source?.type === 'base64') {
          return { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
        }
        return block; // text blocks are the same format
      });
      oaiMessages.push({ role: m.role, content: oaiContent });
    } else {
      oaiMessages.push({ role: m.role, content: m.content });
    }
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({ model, messages: oaiMessages, max_tokens })
    });
    trackApiCall('openai', res); // non-blocking, no await needed
    if (res.status === 429 && attempt < maxRetries) {
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[OpenAI] Rate limited (429), retrying in ${delay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

// Unified chat call with automatic fallback across providers.
// Tries the requested model first; on any error (rate limit, quota, etc.) falls back
// through the chain: GPT-4.1-mini → Haiku → Sonnet → GPT-4.1.
// Returns { reply, usedModel } or { error }.
async function chatWithFallback({ model, system, messages, max_tokens, tag }) {
  const fallbackChain = [
    { id: 'gpt-4.1-mini', type: 'openai' },
    { id: 'claude-haiku-4-5-20251001', type: 'claude' },
    { id: 'claude-sonnet-4-6', type: 'claude' },
    { id: 'gpt-4.1', type: 'openai' },
  ];
  // Put the requested model first, then the rest in order
  const ordered = [{ id: model, type: model.startsWith('gpt-') ? 'openai' : 'claude' }];
  for (const fb of fallbackChain) {
    if (fb.id !== model) ordered.push(fb);
  }

  let lastError = null;
  for (const candidate of ordered) {
    // Skip if we don't have the key for this provider
    if (candidate.type === 'openai' && !OPENAI_KEY) continue;
    if (candidate.type === 'claude' && !ANTHROPIC_KEY) continue;

    try {
      if (candidate.type === 'openai') {
        const res = await openAiChatCall({ model: candidate.id, system, messages, max_tokens });
        const data = await res.json();
        if (res.ok) {
          const reply = data.choices?.[0]?.message?.content || 'No response.';
          if (candidate.id !== model) console.warn(`[${tag}] Fell back from ${model} to ${candidate.id}`);
          const usage = { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 };
          return { reply, usedModel: candidate.id, usage };
        }
        lastError = data?.error?.message || `OpenAI error ${res.status}`;
        console.warn(`[${tag}] ${candidate.id} failed (${res.status}): ${lastError}, trying next...`);
      } else {
        const res = await claudeApiCall({ model: candidate.id, max_tokens, system, messages });
        const data = await res.json();
        if (res.ok) {
          const reply = data.content?.[0]?.text || 'No response.';
          if (candidate.id !== model) console.warn(`[${tag}] Fell back from ${model} to ${candidate.id}`);
          const usage = { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 };
          return { reply, usedModel: candidate.id, usage };
        }
        lastError = data?.error?.message || `Claude error ${res.status}`;
        console.warn(`[${tag}] ${candidate.id} failed (${res.status}): ${lastError}, trying next...`);
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`[${tag}] ${candidate.id} threw: ${err.message}, trying next...`);
    }
  }
  return { error: `All models failed. Last error: ${lastError}` };
}

let photoCache = {}; // loaded from storage, persisted on write
const photoPending = {}; // dedup in-flight photo fetches
// Load photo cache from storage on boot — promise so callers can await it
const _photoCacheReady = new Promise(resolve => {
  chrome.storage.local.get(['photoCache'], d => {
    if (d.photoCache) {
      photoCache = d.photoCache;
      console.log(`[PhotoCache] Loaded ${Object.keys(photoCache).length} entries from storage`);
    } else {
      console.log('[PhotoCache] No cache found in storage — starting fresh');
    }
    resolve();
  });
});
let _apolloExhausted = false;
let _serperExhausted = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DEBUG_LOG') {
    sendResponse({ log: _debugLog.join('\n') });
    return false;
  }
  if (message.type === 'OPEN_QUEUE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('queue.html') });
    return false;
  }
  if (message.type === 'OPEN_SIDE_PANEL') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (e) {
        console.warn('[SidePanel] Failed to open:', e.message);
      }
    })();
    return false;
  }
  if (message.type === 'CLOSE_SIDE_PANEL') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          // Try tabId first (Chrome 120+), fall back to windowId
          try { await chrome.sidePanel.close({ tabId: tab.id }); }
          catch { await chrome.sidePanel.close({ windowId: tab.windowId }); }
        }
      } catch (e) {
        console.warn('[Close] sidePanel.close failed:', e.message);
        // Fallback: disable the side panel for this tab
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
            await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
            // Re-enable after a tick so it can be opened again
            setTimeout(() => chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true }), 100);
          }
        } catch {}
      }
    })();
    return false;
  }
  if (message.type === 'QUICK_LOOKUP') {
    quickLookup(message.company, message.domain, message.companyLinkedin, message.linkedinFirmo).then(sendResponse);
    return true;
  }
  if (message.type === 'RESEARCH_COMPANY') {
    researchCompany(message.company, message.domain, message.prefs, message.companyLinkedin, message.linkedinFirmo).then(sendResponse);
    return true;
  }
  if (message.type === 'ANALYZE_JOB') {
    analyzeJob(message.company, message.jobTitle, message.jobDescription, message.prefs, message.richContext).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_LEADER_PHOTOS') {
    const { leaders, company } = message;
    const photoConfig = pipelineConfig.photos || DEFAULT_PIPELINE_CONFIG.photos;
    const maxPhotos = photoConfig.maxPerCompany ?? 3;
    const sourceOrder = photoConfig.sourceOrder || ['linkedin_thumbnail', 'serper_images'];
    const capped = leaders.slice(0, maxPhotos);
    Promise.all(capped.map(l => {
      // Try sources in configured order
      if (sourceOrder.includes('linkedin_thumbnail') && (l.photoUrl || l.thumbnailUrl)) {
        return Promise.resolve(l.photoUrl || l.thumbnailUrl);
      }
      if (sourceOrder.includes('serper_images')) {
        return fetchLeaderPhoto(l.name, `"${company}"`);
      }
      return Promise.resolve(null);
    })).then(photos => {
      while (photos.length < leaders.length) photos.push(null);
      sendResponse(photos);
    });
    return true;
  }
  if (message.type === 'GMAIL_AUTH') {
    gmailAuth().then(sendResponse);
    return true;
  }
  if (message.type === 'GMAIL_FETCH_EMAILS') {
    fetchGmailEmails(message.domain, message.companyName, message.linkedinSlug, message.knownContactEmails).then(sendResponse);
    return true;
  }
  if (message.type === 'CLOSE_SIDEPANEL') {
    // Close the sidepanel via Chrome API
    chrome.sidePanel?.setOptions?.({ enabled: false }).then(() => {
      // Re-enable for future use
      setTimeout(() => chrome.sidePanel?.setOptions?.({ enabled: true }), 100);
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'SCAN_REJECTIONS') {
    // Scan all active entries for rejection emails
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const entries = savedCompanies || [];
      const activeStages = ['applied', 'co_applied', 'interviewing', 'phone_screen', 'interview', 'final_round', 'want_to_apply'];
      let updated = 0;
      entries.forEach(entry => {
        if (!activeStages.includes(entry.jobStage || entry.status || '')) return;
        if ((entry.tags || []).includes('Application Rejected')) return;
        if (!entry.cachedEmails?.length) return;
        const rejection = detectRejectionEmailBg(entry.cachedEmails, entry);
        if (rejection) {
          console.log(`[Rejection] Auto-detected for ${entry.company}: "${rejection.subject}"`);
          entry.jobStage = 'rejected';
          entry.status = 'closed';
          const tags = entry.tags || [];
          if (!tags.includes('Application Rejected')) tags.push('Application Rejected');
          entry.tags = tags;
          entry.rejectedAt = Date.now();
          entry.rejectionEmail = { subject: rejection.subject, from: rejection.from, date: rejection.date, snippet: rejection.snippet };
          if (!entry.stageTimestamps) entry.stageTimestamps = {};
          entry.stageTimestamps.rejected = Date.now();
          updated++;
        }
      });
      if (updated > 0) {
        chrome.storage.local.set({ savedCompanies: entries });
      }
      sendResponse({ updated });
    });
    return true;
  }
  if (message.type === 'GMAIL_REVOKE') {
    gmailRevoke().then(sendResponse);
    return true;
  }
  if (message.type === 'CHAT_MESSAGE') {
    handleChatMessage(message).then(sendResponse);
    return true;
  }
  if (message.type === 'QUICK_ENRICH_FIRMO') {
    (async () => {
      try {
        const { company, domain, missing } = message;
        const query = `"${company}" ${domain || ''} employees funding founded`;
        const results = await fetchSearchResults(query, 3);
        if (!results.length) { sendResponse({}); return; }

        const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');

        // Pass 1: Free regex extraction — no AI needed for clean patterns
        const extracted = {};
        if (missing.includes('employees') && !extracted.employees) {
          // "51-200 employees" or "45 employees" or "~150 employees"
          const empMatch = allText.match(/(\d[\d,]*\s*[-–]\s*\d[\d,]*)\s*employees/i)
            || allText.match(/(~?\d[\d,]+)\s*employees/i)
            || allText.match(/employees[:\s]+(\d[\d,]*\s*[-–]\s*\d[\d,]*)/i);
          if (empMatch) extracted.employees = empMatch[1].trim();
        }
        if (missing.includes('funding') && !extracted.funding) {
          // "Series B" or "$30M funding" or "raised $12M"
          const fundMatch = allText.match(/(Series\s+[A-F][\w]*(?:\s*[-–,]\s*\$[\d.]+[BMK])?)/i)
            || allText.match(/raised\s+(\$[\d.]+[BMK]\w*)/i)
            || allText.match(/(\$[\d.]+[BMK]\w*)\s*(?:funding|raised|round)/i);
          if (fundMatch) extracted.funding = fundMatch[1].trim();
        }
        if (missing.includes('industry') && !extracted.industry) {
          // "Industry: SaaS" or "Software Development · 51-200"
          const indMatch = allText.match(/(?:industry|sector)[:\s]+([^·|•\n]{3,40})/i)
            || allText.match(/([A-Z][\w\s&\/]+?)\s*·\s*\d/);
          if (indMatch) extracted.industry = indMatch[1].trim();
        }
        if (missing.includes('linkedin') && !extracted.linkedin) {
          // Extract LinkedIn company URL from search results
          const allUrls = results.map(r => r.link || '').join(' ');
          const liMatch = allUrls.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-z0-9_-]+/i);
          if (liMatch) extracted.linkedin = liMatch[0];
        }

        // Check if regex got everything we needed
        const stillMissing = missing.filter(f => !extracted[f]);
        console.log('[QuickEnrich] Regex extracted:', extracted, '| still missing:', stillMissing);

        if (stillMissing.length === 0) {
          // Regex got it all — no AI cost
          sendResponse(extracted);
          return;
        }

        // Pass 2: AI fallback only for fields regex couldn't get
        const snippets = results.map(r => `${r.title}: ${r.snippet}`).join('\n');
        const { reply } = await chatWithFallback({
          model: 'gpt-4.1-mini',
          system: 'Extract company firmographics from search snippets. Return JSON only.',
          messages: [{ role: 'user', content: `From these search results about "${company}", extract ONLY these fields: ${stillMissing.join(', ')}. Return JSON: {"employees":"e.g. 51-200 or ~150","funding":"e.g. Series B, $30M","industry":"e.g. B2B SaaS","linkedin":"e.g. https://linkedin.com/company/warmly-ai"}. Only include fields you can confidently extract.\n\n${snippets.slice(0, 2000)}` }],
          max_tokens: 200,
          tag: 'QuickEnrich'
        });

        if (reply) {
          const match = reply.match(/\{[\s\S]*\}/);
          if (match) {
            const aiData = JSON.parse(match[0]);
            // Merge: regex results take priority, AI fills gaps
            sendResponse({
              employees: extracted.employees || aiData.employees || null,
              funding: extracted.funding || aiData.funding || null,
              industry: extracted.industry || aiData.industry || null,
              linkedin: extracted.linkedin || aiData.linkedin || null,
            });
            return;
          }
        }
        // Return whatever regex found even if AI failed
        sendResponse(extracted);
      } catch (e) {
        console.warn('[QuickEnrich] Error:', e.message);
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  if (message.type === 'FETCH_URL') {
    (async () => {
      try {
        const res = await fetch(message.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) { sendResponse({ error: `HTTP ${res.status}` }); return; }
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ').trim();
        sendResponse({ text: text.slice(0, 6000) });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  if (message.type === 'COOP_CHAT') {
    handleCoopMessage({
      messages: message.messages,
      globalChat: message.globalChat !== false,
      chatModel: message.chatModel,
      careerOSChat: message.careerOSChat
    }).then(sendResponse);
    return true;
  }
  if (message.type === 'CALENDAR_FETCH_EVENTS') {
    fetchCalendarEvents(message.domain, message.companyName, message.knownContactEmails).then(sendResponse);
    return true;
  }
  if (message.type === 'UPDATE_PIPELINE_SETTING') {
    const { key, value } = message;
    // Re-read from storage first to avoid overwriting other settings
    chrome.storage.local.get(['pipelineConfig'], d => {
      const saved = d.pipelineConfig || {};
      if (key === 'chatModel') {
        if (!saved.aiModels) saved.aiModels = {};
        saved.aiModels.chat = value;
        pipelineConfig.aiModels.chat = value;
      } else if (key === 'scoringModel') {
        if (!saved.aiModels) saved.aiModels = {};
        saved.aiModels.jobMatchScoring = value;
        pipelineConfig.aiModels.jobMatchScoring = value;
      } else if (key === 'researchModel') {
        if (!saved.aiModels) saved.aiModels = {};
        saved.aiModels.companyIntelligence = value;
        pipelineConfig.aiModels.companyIntelligence = value;
      }
      chrome.storage.local.set({ pipelineConfig: saved });
      sendResponse({ ok: true });
    });
    return true;
  }
  // GET_PIPELINE_CONFIG handled in the pipeline-specific listener below
  if (message.type === 'SYNC_ENTRY_FIELDS') {
    syncEntryFields(message.entryId).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'GENERATE_ROLE_BRIEF') {
    generateRoleBrief(message).then(sendResponse);
    return true;
  }
  if (message.type === 'DEEP_FIT_ANALYSIS') {
    deepFitAnalysis(message).then(sendResponse);
    return true;
  }
  if (message.type === 'EXTRACT_NEXT_STEPS') {
    extractNextSteps(message.notes, message.calendarEvents, message.transcripts, message.emailContext).then(sendResponse);
    return true;
  }
  if (message.type === 'GRANOLA_SEARCH') {
    searchGranolaNotes(message.companyName, message.companyDomain || null, message.contactNames || []).then(sendResponse);
    return true;
  }
  if (message.type === 'GRANOLA_BUILD_INDEX') {
    buildGranolaIndex().then(sendResponse);
    return true;
  }
  if (message.type === 'CONSOLIDATE_PROFILE') {
    consolidateProfile(message.rawInput, message.insights).then(sendResponse);
    return true;
  }
  if (message.type === 'EXTRACT_IMAGE_TEXT') {
    (async () => {
      try {
        const res = await claudeApiCall({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: message.mediaType, data: message.imageBase64 } },
              { type: 'text', text: 'Extract all text from this image. Return the text exactly as it appears, preserving formatting. If this is a job description, preserve section headings and bullet points.' }
            ]
          }]
        });
        const data = await res.json();
        if (data?.content?.[0]?.text) {
          sendResponse({ text: data.content[0].text });
        } else {
          sendResponse({ error: 'No text extracted', text: '' });
        }
      } catch (e) {
        sendResponse({ error: e.message, text: '' });
      }
    })();
    return true;
  }
  if (message.type === 'GLOBAL_CHAT_MESSAGE') {
    handleGlobalChatMessage(message).then(sendResponse);
    return true;
  }
  if (message.type === 'COOP_MESSAGE') {
    handleCoopMessage(message).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_KEY_STATUS') {
    sendResponse({
      anthropic: !!ANTHROPIC_KEY,
      apollo: !!APOLLO_KEY,
      serper: !!SERPER_KEY,
      openai: !!OPENAI_KEY,
      granola: !!GRANOLA_KEY,
      google_cse: !!(GOOGLE_CSE_KEY && GOOGLE_CSE_CX),
      apolloExhausted: _apolloExhausted,
      serperExhausted: _serperExhausted,
    });
    return true;
  }
  if (message.type === 'TEST_API_KEY') {
    testApiKey(message.provider, message.key).then(sendResponse);
    return true;
  }

  // ── Quick Fit Scoring Handlers ──────────────────────────────────────────────
  if (message.type === 'QUICK_FIT_SCORE') {
    processQuickFitScore(message.entryId).then(sendResponse).catch(err => {
      console.error('[QuickFit] QUICK_FIT_SCORE error:', err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (message.type === 'QUEUE_QUICK_FIT') {
    _scoringQueue.push(message.entryId);
    if (QUEUE_AUTO_PROCESS) processQueue();
    sendResponse({ queued: true });
    return true;
  }
  if (message.type === 'COMPUTE_STRUCTURAL_MATCHES') {
    const matches = computeStructuralMatches(message.entry, message.prefs);
    sendResponse(matches);
    return true;
  }
  if (message.type === 'INTERPRET_PROFILE_SECTION') {
    interpretProfileSection(message.section, message.content).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_API_USAGE') {
    getApiUsage().then(sendResponse);
    return true;
  }
  if (message.type === 'RESET_API_USAGE') {
    chrome.storage.local.remove('apiUsage', () => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'SET_CREDIT_ALLOCATION') {
    chrome.storage.local.get(['apiCreditAllocations'], d => {
      const alloc = d.apiCreditAllocations || {};
      alloc[message.provider] = message.credits;
      chrome.storage.local.set({ apiCreditAllocations: alloc }, () => sendResponse({ success: true }));
    });
    return true;
  }
  if (message.type === 'GET_PIPELINE_CONFIG') {
    sendResponse(pipelineConfig);
    return true;
  }
  if (message.type === 'SET_PIPELINE_CONFIG') {
    pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...message.config };
    chrome.storage.local.set({ pipelineConfig }, () => sendResponse({ success: true }));
    return true;
  }
});

// ── Profile Section Interpretation ───────────────────────────────────────────

const SECTION_PROMPTS = {
  profileStory: `Read this person's career story and extract 5-8 specific, detailed bullet points. Include: company names, role types, specific metrics or results mentioned, key career transitions and WHY they happened, what environments they thrive in, what they're building or pursuing now, and any strong opinions or values stated. Be specific — use their actual words and details, not generic summaries.\n\nContent: {content}\n\nRespond in JSON only: {"bullets": ["bullet 1", "bullet 2", ...]}`,
  profileExperience: `Read this person's experience and extract the key proof points. For each role or project, summarize: what they did, their specific results, and what it demonstrates about them. Be concise.\n\nContent: {content}\n\nRespond in JSON only: {"entries": [{"role": "role name", "summary": "what they did and achieved"}]}`,
  profilePrinciples: `Read this person's operating principles and distill them into a concise profile of how they work. What kind of environment do they need? What kind of leadership? What's non-negotiable?\n\nContent: {content}\n\nRespond in JSON only: {"summary": "2-3 sentence distillation"}`,
  profileMotivators: `Read this person's motivators and extract: their core drivers, what energizes them, and what drains them. Be specific about the personality traits and motivational patterns.\n\nContent: {content}\n\nRespond in JSON only: {"drivers": ["driver 1", "driver 2"], "energizers": ["thing 1"], "drains": ["thing 1"]}`,
  profileVoice: `Read this description of how someone communicates and summarize their communication style in 1-2 sentences. Note tone, formality level, and any distinctive patterns.\n\nContent: {content}\n\nRespond in JSON only: {"style": "1-2 sentence summary"}`,
  profileFAQ: `Read these polished responses and list the questions they cover with a brief note on the approach/angle for each.\n\nContent: {content}\n\nRespond in JSON only: {"responses": [{"question": "what question this answers", "approach": "brief note on angle"}]}`,
  profileGreenLights: `Read this list of things that make job opportunities attractive to this person. Group them into categories and note any that might be ambiguous or could be interpreted multiple ways. Be specific about what each signal means for job matching.\n\nContent: {content}\n\nRespond in JSON only: {"signals": [{"signal": "the item", "interpretation": "what this means for job matching"}]}`,
  profileRedLights: `Read this list of dealbreakers. Group them into categories and note any that might be ambiguous. Be specific about what would trigger each red flag in a real job posting.\n\nContent: {content}\n\nRespond in JSON only: {"signals": [{"signal": "the item", "interpretation": "what would trigger this in a job posting"}]}`,
  profileSkills: `Read this person's skills and intangibles. Organize them into categories (technical skills, soft skills, domain expertise, certifications/tools) and note what level of depth or seniority each suggests.\n\nContent: {content}\n\nRespond in JSON only: {"categories": [{"name": "category name", "skills": ["skill 1", "skill 2"]}]}`,
};

async function interpretProfileSection(section, content) {
  if (!content || !content.trim()) return { error: 'No content to interpret' };
  const promptTemplate = SECTION_PROMPTS[section];
  if (!promptTemplate) return { error: `Unknown section: ${section}` };

  const prompt = promptTemplate.replace('{content}', content.slice(0, 3000));
  try {
    const result = await chatWithFallback({
      model: getModelForTask('profileInterpret'),
      system: 'You are a concise profile analyst. Respond in valid JSON only, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      tag: 'ProfileInterpret'
    });
    if (result.error) return { error: result.error };
    const clean = result.reply.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      // Try to fix common JSON issues: unescaped newlines, trailing commas
      try {
        const fixed = clean
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
          .replace(/,\s*([}\]])/g, '$1'); // trailing commas
        parsed = JSON.parse(fixed);
      } catch (e2) {
        // Last resort: wrap the entire response as a simple summary
        console.warn('[ProfileInterpret] JSON parse failed, using raw text');
        parsed = { summary: clean };
      }
    }
    // Store interpretation
    const storageKey = section + 'Interpretation';
    chrome.storage.local.set({ [storageKey]: { data: parsed, generatedAt: Date.now(), sourceHash: simpleHash(content) } });
    return { interpretation: parsed };
  } catch (err) {
    console.error('[ProfileInterpret] Error:', err.message);
    return { error: err.message };
  }
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h;
}

// ── Lightweight Company Scout (1 Serper credit, cached) ─────────────────────

async function scoutCompany(companyName) {
  const scoringConfig = pipelineConfig.scoring || DEFAULT_PIPELINE_CONFIG.scoring;
  if (!scoringConfig.scoutEnabled) {
    console.log('[Scout] Disabled in pipeline config');
    return null;
  }
  const cacheKey = companyName.toLowerCase().replace(/[,;:!?.]+$/, '').trim();
  // Check research cache first — if full research exists, use that
  const fullCached = await getCached(cacheKey);
  if (fullCached?.intelligence) {
    console.log('[Scout] Full research cache hit for:', companyName);
    return fullCached.intelligence;
  }
  // Check scout cache
  const cacheDays = scoringConfig.scoutCacheDays ?? 7;
  const { scoutCache } = await new Promise(r => chrome.storage.local.get(['scoutCache'], r));
  const cached = (scoutCache || {})[cacheKey];
  if (cached && (cacheDays === 0 || Date.now() - cached.ts < cacheDays * 86400000)) {
    console.log('[Scout] Cache hit for:', companyName);
    return cached.summary;
  }
  // Run 1 Serper search
  const numResults = scoringConfig.scoutResultCount || 3;
  console.log('[Scout] Fetching for:', companyName, `(${numResults} results)`);
  const results = await fetchSearchResults(`"${companyName}" what does it do product overview culture`, numResults);
  if (!results.length) return null;
  const snippets = results.slice(0, numResults).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
  // Save to scout cache
  const updated = { ...(scoutCache || {}), [cacheKey]: { summary: snippets, ts: Date.now() } };
  chrome.storage.local.set({ scoutCache: updated });
  console.log('[Scout] Cached for:', companyName);
  return snippets;
}

// ── Quick Fit Scoring ────────────────────────────────────────────────────────

async function processQuickFitScore(entryId) {
  // Load entry from storage
  const { savedCompanies } = await new Promise(resolve =>
    chrome.storage.local.get(['savedCompanies'], resolve)
  );
  const entries = savedCompanies || [];
  const entry = entries.find(e => e.id === entryId);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  // Lightweight company scout — 1 Serper search, cached for 7 days
  const companyContext = await scoutCompany(entry.company || 'Unknown');

  // Load user profile data (structured + legacy fallback)
  const localData = await new Promise(resolve =>
    chrome.storage.local.get([
      'profileGreenLights', 'profileRedLights', 'profileSkills',
      'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags',
      'profileRoleICP', 'profileCompanyICP',
      'profileResume', 'profileExperience'
    ], resolve)
  );
  const syncData = await new Promise(resolve =>
    chrome.storage.sync.get(['prefs'], resolve)
  );
  const prefs = syncData.prefs || {};

  // Structured data with legacy fallback
  const attractedTo = localData.profileAttractedTo || [];
  const dealbreakers = localData.profileDealbreakers || [];
  const skillTags = localData.profileSkillTags || [];
  const roleICP = localData.profileRoleICP || {};
  const companyICP = localData.profileCompanyICP || {};
  const greenLights = attractedTo.length ? attractedTo.map(e => e.text).join('\n') : (localData.profileGreenLights || 'Not specified');
  const redLights = dealbreakers.length ? dealbreakers.map(e => e.text).join('\n') : (localData.profileRedLights || 'Not specified');
  const skills = localData.profileSkills || 'Not specified';

  const jobDesc = (entry.jobDescription || '').slice(0, 3000);
  const jobDescLower = jobDesc.toLowerCase();

  // ── Deterministic keyword pre-scan ──
  const keywordHits = { attracted: [], dealbreaker: [], hardDQ: [] };
  for (const a of attractedTo) {
    for (const kw of (a.keywords || [])) {
      if (kw && jobDescLower.includes(kw.toLowerCase())) {
        const numSev = typeof a.severity === 'number' ? a.severity : 2;
        keywordHits.attracted.push({ keyword: kw, entry: a.text, severity: numSev });
      }
    }
  }
  for (const d of dealbreakers) {
    for (const kw of (d.keywords || [])) {
      if (kw && jobDescLower.includes(kw.toLowerCase())) {
        const numSev = typeof d.severity === 'number' ? d.severity : (d.severity === 'hard' ? 4 : 2);
        const hit = { keyword: kw, entry: d.text, severity: numSev };
        keywordHits.dealbreaker.push(hit);
        if (numSev >= 4) keywordHits.hardDQ.push(hit);
      }
    }
  }
  if (keywordHits.attracted.length || keywordHits.dealbreaker.length) {
    console.log('[QuickFit] Keyword pre-scan hits:', keywordHits);
  }

  // ── Deterministic comp threshold check ──
  const compDealbreakers = dealbreakers.filter(d => d.category === 'comp' && d.compThreshold);
  for (const cd of compDealbreakers) {
    const salaryField = cd.compType === 'ote'
      ? (entry.oteTotalComp || entry.jobSnapshot?.oteTotalComp || entry.jobSnapshot?.salary || '')
      : (entry.baseSalaryRange || entry.jobSnapshot?.baseSalaryRange || entry.jobSnapshot?.salary || '');
    const nums = String(salaryField).match(/[\d,]+/g)?.map(s => parseInt(s.replace(/,/g, ''))) || [];
    const maxPosted = nums.length ? Math.max(...nums.filter(n => n > 10000)) : null;
    if (maxPosted && maxPosted < cd.compThreshold) {
      const sev = typeof cd.severity === 'number' ? cd.severity : 3;
      keywordHits.dealbreaker.push({ keyword: `${cd.compType} < $${cd.compThreshold.toLocaleString()}`, entry: cd.text, severity: sev });
      if (sev >= 4) keywordHits.hardDQ.push({ keyword: `${cd.compType} max $${maxPosted.toLocaleString()} < floor $${cd.compThreshold.toLocaleString()}`, entry: cd.text, severity: sev });
      console.log(`[QuickFit] Comp threshold hit: posted ${cd.compType} $${maxPosted} < floor $${cd.compThreshold}`);
    } else if (!maxPosted && cd.compUnknownNeutral) {
      // No salary posted + unknown=neutral → skip, don't penalize
      console.log(`[QuickFit] Comp not disclosed, treating as neutral per user setting`);
    }
  }

  // ── Deterministic work arrangement check ──
  const userWorkPref = (Array.isArray(prefs.workArrangement) ? prefs.workArrangement : [prefs.workArrangement]).map(s => (s || '').toLowerCase()).filter(Boolean);
  const jobArrangement = (entry.jobSnapshot?.workArrangement || entry.workArrangement || '').toLowerCase();
  if (userWorkPref.length && jobArrangement) {
    const prefersRemoteOnly = userWorkPref.length === 1 && userWorkPref[0] === 'remote';
    const isHybrid = jobArrangement.includes('hybrid');
    const isOnsite = jobArrangement.includes('on-site') || jobArrangement.includes('onsite') || jobArrangement.includes('in-office');
    if (prefersRemoteOnly && (isHybrid || isOnsite)) {
      const label = isOnsite ? 'On-site' : 'Hybrid';
      keywordHits.dealbreaker.push({ keyword: `${label} role`, entry: `${label} conflicts with Remote-only preference`, severity: isOnsite ? 5 : 4 });
      keywordHits.hardDQ.push({ keyword: `${label} role vs Remote preference`, entry: `${label} conflicts with Remote-only preference`, severity: isOnsite ? 5 : 4 });
      console.log(`[QuickFit] Work arrangement mismatch: job is ${label}, user prefers Remote only`);
    }
  }

  // ── Build structured candidate preferences for prompt ──
  let candidateSection = '[Candidate Preferences]\n';
  if (attractedTo.length) {
    candidateSection += 'Attracted To (structured, importance 1-5 where 5=dream factor, strongest positive signal):\n' + attractedTo.map(e => {
      const sev = typeof e.severity === 'number' ? e.severity : 2;
      return `- [${e.category}/importance:${sev}] ${e.text}${e.keywords?.length ? ` (keywords: ${e.keywords.join(', ')})` : ''}`;
    }).join('\n') + '\n';
  } else {
    candidateSection += `Green lights: ${greenLights}\n`;
  }
  if (dealbreakers.length) {
    const sevLabel = n => typeof n === 'number' ? ['minor','preference','notable','dealbreaker','hard-stop'][n-1] || 'preference' : (n || 'preference');
    candidateSection += 'Dealbreakers (structured, severity 1-5 where 5=absolute dealbreaker):\n' + dealbreakers.map(e =>
      `- [${e.category}/severity:${typeof e.severity === 'number' ? e.severity : (e.severity === 'hard' ? 4 : 2)}] ${e.text}${e.keywords?.length ? ` (keywords: ${e.keywords.join(', ')})` : ''}`
    ).join('\n') + '\n';
  } else {
    candidateSection += `Red lights: ${redLights}\n`;
  }
  candidateSection += `Background: ${skills}`;
  const resumeText = localData.profileResume?.content || prefs.resumeText || '';
  const experienceText = localData.profileExperience || '';
  if (resumeText) candidateSection += `\nResume/Experience:\n${resumeText.slice(0, 2000)}`;
  if (experienceText && experienceText !== resumeText) candidateSection += `\nExperience Details:\n${experienceText.slice(0, 1500)}`;
  if (skillTags.length) candidateSection += `\nSkill tags: ${skillTags.join(', ')}`;
  if (roleICP.targetFunction || roleICP.seniority) {
    candidateSection += `\nRole ICP: ${[roleICP.targetFunction, roleICP.seniority, roleICP.scope, roleICP.sellingMotion].filter(Boolean).join(' | ')}`;
    if (roleICP.text) candidateSection += ` — ${roleICP.text.slice(0, 300)}`;
  }
  if (companyICP.stage || companyICP.sizeRange) {
    candidateSection += `\nCompany ICP: ${[companyICP.stage, companyICP.sizeRange, (companyICP.industryPreferences || []).join('/')].filter(Boolean).join(' | ')}`;
    if (companyICP.text) candidateSection += ` — ${companyICP.text.slice(0, 300)}`;
  }
  candidateSection += `\nCompensation thresholds (IMPORTANT — use these exact numbers, do not confuse floor with strong):`;
  candidateSection += `\n  Base salary WALK AWAY (reject below): $${prefs.salaryFloor || 'Not specified'}`;
  candidateSection += `\n  Base salary STRONG OFFER (excited above): $${prefs.salaryStrong || 'Not specified'}`;
  candidateSection += `\n  OTE WALK AWAY (reject below): $${prefs.oteFloor || 'Not specified'}`;
  candidateSection += `\n  OTE STRONG OFFER (excited above): $${prefs.oteStrong || 'Not specified'}`;
  candidateSection += `\nLocation: ${prefs.userLocation || 'Not specified'}, prefers ${prefs.workArrangement || 'Not specified'}`;

  // Include previously dismissed flags as calibration
  const existingDismissed = entry.jobMatch?.dismissedFlags || [];
  if (existingDismissed.length) {
    candidateSection += `\n\n[USER FEEDBACK — Dismissed Red Flags (do NOT repeat these)]\n${existingDismissed.map(f => `- "${f}"`).join('\n')}`;
  }

  // Add deterministic keyword hits to prompt
  let keywordContext = '';
  if (keywordHits.attracted.length) {
    keywordContext += `\n\n[KEYWORD MATCHES — Attracted To (green flags)]\n${keywordHits.attracted.map(h => `- "${h.keyword}" found (importance:${h.severity}) → ${h.entry}`).join('\n')}`;
    const highImportance = keywordHits.attracted.filter(h => h.severity >= 4);
    if (highImportance.length) {
      keywordContext += `\n\nNOTE: High-importance green flag keywords matched (importance 4-5) — these should significantly BOOST the score.`;
    }
  }
  if (keywordHits.dealbreaker.length) {
    keywordContext += `\n\n[KEYWORD MATCHES — Dealbreakers]\n${keywordHits.dealbreaker.map(h => `- "${h.keyword}" found (${h.severity}) → ${h.entry}`).join('\n')}`;
  }
  if (keywordHits.hardDQ.length) {
    keywordContext += `\n\nIMPORTANT: Hard dealbreaker keywords detected — these MUST be reflected in scoring.`;
  }

  const prompt = `You are a job fit screener and role analyst. Based on the candidate's preferences, the job posting, and what's known about the company, produce a unified fit score AND role brief.

${candidateSection}${keywordContext}

[Job Posting]
Company: ${entry.company || 'Unknown'}
Title: ${entry.jobTitle || 'Unknown'}
Compensation: ${entry.baseSalaryRange || entry.oteTotalComp || entry.jobSnapshot?.salary || entry.salary || 'Not specified'}
Work Arrangement: ${entry.jobSnapshot?.workArrangement || entry.workArrangement || 'Not specified'}
Location: ${entry.jobSnapshot?.location || 'Not specified'}
Description (first 3000 chars): ${jobDesc}
${companyContext ? `\n[Company Context from Web]\n${companyContext}` : ''}

SCORING RULES:
- quickTake: 2-4 most decisive signals (green for fits, red for dealbreakers). 8-15 words each. Lead with the most important.
- strongFits: Only genuinely strong alignment backed by real evidence. Empty array is fine.
- redFlags: Only real evidence of concern — comp below floor, on-site when remote needed, poor reviews, role misalignment. Do NOT flag missing information (missing salary, missing travel info, missing equity). Compensation not disclosed is NEVER a red flag — it is simply unknown and not a factor. Empty array is fine.
- CRITICAL: Only flag concerns the candidate has EXPLICITLY stated in their preferences, dealbreakers, or profile. Do NOT infer or extrapolate dealbreakers they haven't expressed. If the candidate hasn't said they dislike a role type (e.g. client success, account management), do not flag it as a mismatch. Stick to what they've actually written.
- "No equity mentioned" is NEVER a red flag. Only flag equity concerns if the candidate has explicitly listed equity as a dealbreaker.
- The "Work Arrangement" field above is authoritative. If it says "Remote", the job IS remote. If it says "Not specified", scan the job description for work arrangement clues (remote, hybrid, on-site mentions) and use what you find. Similarly, if Compensation says "Not specified", scan the description for salary/compensation ranges — companies often include these in the posting body or legal compliance sections.
- hardDQ: true ONLY for absolute verified dealbreakers (on-site or hybrid vs remote-only preference, base max below salary floor, fundamentally wrong role type that directly contradicts an explicit dealbreaker). If user prefers Remote and job is Hybrid or On-site, this IS a hard DQ — Hybrid requires in-office days which a remote-only candidate cannot do. When in doubt on other factors, do NOT flag.
- reason: explain WHY you gave this score. Do NOT repeat job title or company name.
- Green flag importance matters: high-importance (4-5) green flags that match should significantly boost the score. A role matching multiple importance-5 green flags should score higher even if minor red flags exist. Green flags counterbalance red flags — weigh both sides.

QUALIFICATION MATCH — CANDIDATE vs JOB REQUIREMENTS ONLY:
This section assesses ONLY whether the candidate is qualified for the role. NOT whether the role matches their preferences — that's handled separately by preferenceFit and dealbreakers.
- Extract ALL qualifications/requirements listed in the posting (no cap — if there are 15, list all 15). Also add any implicit requirements that the JOB DEMANDS based on role level and company context (e.g. a VP Sales at Salesforce implies enterprise sales leadership at scale even if not written). Do NOT skip soft skills like communication, problem-solving, or independence — these matter to hiring managers.
- Include both explicit requirements AND implicit ones: seniority level, team size to manage, revenue scope, industry expertise, company scale experience, technical skills.
- For each, determine importance: "required" (must-have or clearly implied by the role level), "preferred" (nice-to-have), or "bonus" (optional).
- Match each against the candidate's ACTUAL experience — resume, skills, accomplishments, and career trajectory. Status: "met" (clear evidence), "partial" (related but gap exists — explain the gap), "unmet" (no evidence), "unknown" (can't determine).
- For "met" and "partial", cite specific evidence from the candidate's background in under 15 words. For "partial", also note the gap (e.g., "Managed 5-person team; role needs 50+").
- qualificationMatch: 2-3 sentences HONEST assessment. Would a hiring manager at this company seriously consider this candidate? What's the biggest gap? What's the strongest match?
- qualificationScore: 1-10 (1-2=severely underqualified, 3-4=significant gaps, 5-6=meets most but stretch on some, 7-8=strong match, 9-10=exceeds all/overqualified). This measures how desirable of a candidate the user would be FROM THE EMPLOYER'S PERSPECTIVE — not whether the user would like the job. This score MUST factor into the overall score at the top. A dream role where you'd never get hired should not score 8/10 overall.

REALISTIC GAP ANALYSIS — THIS IS CRITICAL:
The score MUST account for the gap between the candidate's actual level and what the role demands. Do not inflate scores based on keyword overlap alone. Evaluate these dimensions honestly:
- SENIORITY GAP: If the role requires VP/C-suite at a Fortune 500 and the candidate has been a director/head at a startup, that's a 3-4 point gap. Managing 5 people vs managing 500 is not "partial match" — it's a different job.
- COMPANY SCALE: A Head of Revenue at a 50-person startup is NOT comparable to the same title at a 10,000-person enterprise. If the role is at a large/public company and the candidate's experience is primarily at startups (or vice versa), acknowledge the gap.
- SCOPE: Owning $1M ARR vs $100M ARR. Managing one product line vs a full portfolio. Regional coverage vs global. These are real gaps, not minor differences.
- YEARS: If the role asks for 10+ years and the candidate has 5, that's a real gap even if skills overlap.
- The score should reflect REALISTIC likelihood of getting hired, not just preference alignment. A role you'd love but would never get past the screening call should score 3-4, not 8-9.
- If the candidate would be a stretch hire (could do the job with a ramp but would face skepticism from hiring managers), say so explicitly in qualificationMatch.

SCORE BREAKDOWN:
- Break the overall score into 5 components, each 1-10:
  - qualificationFit: HONEST match of experience, seniority, scale, and skills against requirements. A "partial" match on 3 required qualifications = 4-5, not 7-8.
  - preferenceFit: How many of the candidate's green flags / attracted-to items are present?
  - dealbreakers: Impact of red flags and dealbreakers (10=no issues, 1=fatal)
  - compFit: Compensation alignment (10=exceeds strong offer, 5=meets floor, 1=below floor, 5=unknown)
  - roleFit: Overall role type, seniority, company stage alignment — is this a REALISTIC next step or a 2-3 level jump?

ROLE BRIEF:
- roleSummary: 2-3 sentences on what this role actually is, what you'd own, and what success looks like. Write it for the candidate, not a recruiter.
- whyInteresting: 1-2 sentences on why this specific role at this specific company could be compelling for THIS candidate given their background. Be honest — if it's not interesting, say so.
- concerns: 1-2 sentences on legitimate open questions or risks worth investigating before applying. Not missing data — real strategic concerns.
- compSummary: one line summarizing known comp (base, OTE, equity) or "Not disclosed" if truly nothing.

COMPANY VERIFICATION:
- detectedCompany: The actual company name this job is for, as stated in the job description. Extract from the posting text, not from the Company field above (which may be wrong).
- detectedTitle: The actual clean job title from the posting, without trailing numbers or artifacts.

Respond in JSON only:
{"score": number 1-10, "reason": "one sentence", "quickTake": [{"type": "green/red", "text": "signal"}], "strongFits": [], "redFlags": [], "hardDQ": {"flagged": boolean, "reasons": []}, "qualifications": [{"requirement": "string", "status": "met/partial/unmet/unknown", "evidence": "string or null", "importance": "required/preferred/bonus"}], "scoreBreakdown": {"qualificationFit": number, "preferenceFit": number, "dealbreakers": number, "compFit": number, "roleFit": number}, "roleBrief": {"roleSummary": "", "whyInteresting": "", "concerns": "", "compSummary": "", "qualificationMatch": "", "qualificationScore": number 1-10}, "detectedCompany": "string", "detectedTitle": "string"}`;

  const quickFitModel = getModelForTask('quickFitScoring');
  const { reply, error } = await chatWithFallback({
    model: quickFitModel,
    system: 'You are a precise job-fit scoring and role analysis assistant. Respond with valid JSON only.',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2200,
    tag: 'QuickFit'
  });

  if (error) throw new Error(error);

  // Parse response
  let score = null;
  let reason = 'Could not parse response';
  let quickTake = [];
  let strongFits = [];
  let redFlags = [];
  let hardDQ = { flagged: false, reasons: [] };
  let roleBrief = null;
  let qualifications = [];
  let scoreBreakdown = null;
  let detectedCompany = null;
  let detectedTitle = null;
  try {
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      score = Number(parsed.score);
      reason = parsed.reason || 'No reason provided';
      quickTake = parsed.quickTake || [];
      strongFits = parsed.strongFits || [];
      redFlags = parsed.redFlags || [];
      hardDQ = parsed.hardDQ || { flagged: false, reasons: [] };
      roleBrief = parsed.roleBrief || null;
      // Structured qualification line items
      if (parsed.qualifications) {
        qualifications = parsed.qualifications.map((q, i) => ({
          id: `q${i}`,
          requirement: q.requirement || '',
          status: q.status || 'unknown',
          evidence: q.evidence || null,
          importance: q.importance || 'required',
          dismissed: false
        }));
      }
      // Score breakdown components
      if (parsed.scoreBreakdown) {
        scoreBreakdown = {
          qualificationFit: parsed.scoreBreakdown.qualificationFit || 5,
          preferenceFit: parsed.scoreBreakdown.preferenceFit || 5,
          dealbreakers: parsed.scoreBreakdown.dealbreakers || 5,
          compFit: parsed.scoreBreakdown.compFit || 5,
          roleFit: parsed.scoreBreakdown.roleFit || 5
        };
      }
      // Company/title verification
      if (parsed.detectedCompany) detectedCompany = parsed.detectedCompany;
      if (parsed.detectedTitle) detectedTitle = parsed.detectedTitle;
    }
  } catch (parseErr) {
    console.warn('[QuickFit] Failed to parse response:', reply);
    throw new Error('Failed to parse scoring response');
  }

  // Consistency check: Hard DQ + high score is contradictory — cap score
  if (hardDQ.flagged && score > 4) {
    console.log(`[QuickFit] Score ${score} with Hard DQ — capping at 4`);
    score = 4;
    reason = (hardDQ.reasons?.[0] || reason);
  }

  // Post-AI boost: high-importance green flag keyword matches should floor score
  const highGreenHits = keywordHits.attracted.filter(h => h.severity >= 4);
  if (highGreenHits.length >= 2 && score < 6 && !hardDQ.flagged) {
    console.log(`[QuickFit] Green flag boost: ${highGreenHits.length} high-importance matches — flooring score from ${score} to 6`);
    score = Math.max(score, 6);
    strongFits = [...strongFits, ...highGreenHits.map(h => `Matches "${h.keyword}" (importance ${h.severity})`)];
  }

  // Post-AI override: hard dealbreaker keyword matches force flagging
  if (keywordHits.hardDQ.length && !hardDQ.flagged) {
    console.log(`[QuickFit] Hard DQ keyword override: ${keywordHits.hardDQ.map(h => h.keyword).join(', ')}`);
    hardDQ.flagged = true;
    hardDQ.reasons = [...(hardDQ.reasons || []), ...keywordHits.hardDQ.map(h => `Keyword "${h.keyword}" matched: ${h.entry}`)];
    if (score > 2) score = 2;
    redFlags = [...redFlags, ...keywordHits.hardDQ.map(h => `Hard dealbreaker keyword "${h.keyword}" detected`)];
  }

  // Save result to the entry
  const freshData = await new Promise(resolve =>
    chrome.storage.local.get(['savedCompanies'], resolve)
  );
  const freshEntries = freshData.savedCompanies || [];
  const idx = freshEntries.findIndex(e => e.id === entryId);
  if (idx !== -1) {
    freshEntries[idx].quickFitScore = score;
    freshEntries[idx].quickFitReason = reason;
    freshEntries[idx].quickTake = quickTake;
    freshEntries[idx].hardDQ = hardDQ;
    freshEntries[idx].quickFitScoredAt = Date.now();
    // Auto-correct company name if AI detected a mismatch
    if (detectedCompany && detectedCompany !== freshEntries[idx].company) {
      const currentName = (freshEntries[idx].company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const aiName = detectedCompany.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!aiName.includes(currentName) && !currentName.includes(aiName)) {
        console.log(`[QuickFit] Company name mismatch: entry="${freshEntries[idx].company}" → AI detected="${detectedCompany}" — auto-correcting`);
        freshEntries[idx].company = detectedCompany;
      }
    }
    // Auto-correct job title if AI detected a cleaner version
    if (detectedTitle && freshEntries[idx].jobTitle) {
      const currentTitle = freshEntries[idx].jobTitle.trim();
      const aiTitle = detectedTitle.trim();
      // Only correct if AI title is shorter (cleaned) or current has artifacts (trailing numbers, "Undefined" prefix)
      if (aiTitle !== currentTitle && (currentTitle.match(/\s\d+$/) || currentTitle.startsWith('Undefined') || aiTitle.length < currentTitle.length)) {
        console.log(`[QuickFit] Title cleanup: "${currentTitle}" → "${aiTitle}"`);
        freshEntries[idx].jobTitle = aiTitle;
      }
    }
    // Write flags to jobMatch so the detail page shows them
    const existing = freshEntries[idx].jobMatch || {};
    freshEntries[idx].jobMatch = {
      ...existing,
      score: score ?? existing.score,
      verdict: reason ?? existing.verdict,
      strongFits: strongFits.length ? strongFits : existing.strongFits || [],
      redFlags: redFlags.length ? redFlags : existing.redFlags || [],
      roleBrief: roleBrief || existing.roleBrief || null,
      qualifications: qualifications.length ? qualifications : existing.qualifications || [],
      scoreBreakdown: scoreBreakdown || existing.scoreBreakdown || null,
      dismissedFlags: existing.dismissedFlags || [],
      dismissedFlagsWithReasons: existing.dismissedFlagsWithReasons || [],
      lastUpdatedBy: 'quick_fit',
      lastUpdatedAt: Date.now()
    };
    await new Promise(resolve =>
      chrome.storage.local.set({ savedCompanies: freshEntries }, resolve)
    );
  }

  // Auto-sync fields after scoring
  syncEntryFields(entryId).catch(e => console.warn('[SyncFields] Post-score sync failed:', e));

  // Broadcast completion to all extension views
  chrome.runtime.sendMessage({
    type: 'QUICK_FIT_COMPLETE',
    entryId,
    quickFitScore: score,
    quickFitReason: reason,
    quickTake,
    hardDQ
  }).catch(() => {}); // ignore if no listeners

  return { quickFitScore: score, quickFitReason: reason, quickTake, hardDQ };
}

async function processQueue() {
  if (_scoringInProgress || _scoringQueue.length === 0) return;
  _scoringInProgress = true;

  while (_scoringQueue.length > 0) {
    const entryId = _scoringQueue.shift();
    try {
      await processQuickFitScore(entryId);
    } catch (err) {
      console.error('[QuickFit] Error scoring', entryId, err.message);
      // Retry once after 5 seconds
      await new Promise(r => setTimeout(r, 5000));
      try {
        await processQuickFitScore(entryId);
      } catch (retryErr) {
        console.error('[QuickFit] Retry failed for', entryId);
        // Mark as failed
        const failData = await new Promise(resolve =>
          chrome.storage.local.get(['savedCompanies'], resolve)
        );
        const failEntries = failData.savedCompanies || [];
        const failIdx = failEntries.findIndex(e => e.id === entryId);
        if (failIdx !== -1) {
          failEntries[failIdx].quickFitScore = null;
          failEntries[failIdx].quickFitReason = 'Scoring failed — tap to retry';
          failEntries[failIdx].quickFitScoredAt = Date.now();
          await new Promise(resolve =>
            chrome.storage.local.set({ savedCompanies: failEntries }, resolve)
          );
        }
        // Broadcast failure so UI can update
        chrome.runtime.sendMessage({
          type: 'QUICK_FIT_COMPLETE',
          entryId,
          quickFitScore: null,
          quickFitReason: 'Scoring failed — tap to retry'
        }).catch(() => {});
      }
    }
  }

  _scoringInProgress = false;
}

// ── Structural Matching (no API calls) ──────────────────────────────────────

function computeStructuralMatches(entry, prefs) {
  const result = { compMatch: null, arrangementMatch: null, locationMatch: null };

  // Compensation match: check if job salary is within user's floor
  if (prefs.salaryFloor && entry.salary) {
    const salaryStr = String(entry.salary).replace(/[^0-9.kKmM]/g, '');
    let salaryNum = parseFloat(salaryStr);
    if (/[kK]/.test(entry.salary)) salaryNum *= 1000;
    if (/[mM]/.test(entry.salary)) salaryNum *= 1000000;
    if (!isNaN(salaryNum) && salaryNum > 0) {
      result.compMatch = salaryNum >= Number(prefs.salaryFloor);
    }
  }

  // Work arrangement match
  if (prefs.workArrangement && entry.workArrangement) {
    const userPref = prefs.workArrangement.toLowerCase();
    const jobArr = entry.workArrangement.toLowerCase();
    if (userPref === 'remote') {
      result.arrangementMatch = jobArr.includes('remote');
    } else if (userPref === 'hybrid') {
      result.arrangementMatch = jobArr.includes('hybrid') || jobArr.includes('remote');
    } else if (userPref === 'onsite' || userPref === 'on-site') {
      result.arrangementMatch = true; // onsite is compatible with everything
    } else {
      result.arrangementMatch = jobArr.includes(userPref);
    }
  }

  // Location match
  if (prefs.userLocation && entry.location) {
    const userLoc = prefs.userLocation.toLowerCase().trim();
    const jobLoc = entry.location.toLowerCase().trim();
    result.locationMatch = jobLoc.includes(userLoc) || userLoc.includes(jobLoc) ||
      jobLoc.includes('remote') || jobLoc.includes('anywhere');
  }

  return result;
}

// ── Enrichment Pipeline (provider-agnostic with fallback) ────────────────────

// Standardized enrichment result shape — all providers return this
function emptyEnrichment() {
  return { source: null, company: null, description: null, industry: null, employees: null, funding: null, foundedYear: null, companyWebsite: null, companyLinkedin: null, leaders: [], raw: null };
}

// Provider: Apollo
async function enrichFromApollo(company, domain) {
  console.log('[Enrich] Trying Apollo for:', company);
  try {
    const data = await fetchApolloData(domain, company);
    if (!data || (!data.estimated_num_employees && !data.website_url && !data.industry)) {
      console.log('[Enrich] Apollo returned empty for:', company);
      return null; // signal fallback
    }
    console.log('[Enrich] Apollo succeeded for:', company);
    return {
      source: 'Apollo',
      company,
      description: data.short_description || null,
      industry: data.industry || null,
      employees: data.estimated_num_employees ? String(data.estimated_num_employees) : null,
      funding: data.total_funding_printed || null,
      foundedYear: data.founded_year || null,
      companyWebsite: data.website_url || null,
      companyLinkedin: (data.linkedin_url && !data.linkedin_url.includes('/company/unavailable')) ? data.linkedin_url : null,
      leaders: [],
      raw: data,
    };
  } catch (e) {
    console.log('[Enrich] Apollo failed:', e.message);
    return null;
  }
}

// Provider: Serper + Claude (web research synthesis)
async function enrichFromWebResearch(company, domain) {
  console.log('[Enrich] Trying Web Research for:', company);
  try {
    const q = `"${company}"`;
    // When no domain, add "company" or "software" to disambiguate generic names
    const qd = domain ? `"${company}" ${domain}` : `"${company}" company software`;
    const [productResults, websiteResults, linkedinResults] = await Promise.all([
      fetchSearchResults(qd + ' what does it do product overview', 3),
      fetchSearchResults(domain ? `"${company}" ${domain} official website` : `"${company}" company official website`, 2),
      fetchSearchResults('site:linkedin.com/company ' + q, 2),
    ]);
    console.log('[Enrich] Serper results:', {
      product: productResults.length,
      website: websiteResults.length,
      linkedin: linkedinResults.length,
    });

    // Extract domain from search results for website field
    const discoveredDomain = extractDomainFromResults([...websiteResults, ...productResults], company);

    const linkedinFirmo = parseLinkedInCompanySnippet(linkedinResults);
    console.log('[Enrich] LinkedIn firmo:', linkedinFirmo);

    const snippets = [...productResults, ...websiteResults].map(r => `${r.title}: ${r.snippet}`).join('\n');
    console.log('[Enrich] Snippets for Haiku:', snippets.length, 'chars');

    // Lightweight Claude call just for firmographics from web snippets
    let aiEstimate = {};
    if (snippets.length > 50) {
      try {
        const aiResult = await aiCall('firmographicExtraction', {
          system: 'You are a JSON-only data extractor. Respond with valid JSON only.',
          messages: [{ role: 'user', content: `From these search results about "${company}", extract: industry, employee count, funding, founded year. Return JSON only: {"industry":"...","employees":"...","funding":"...","founded":"..."}\n\n${snippets.slice(0, 2000)}` }],
          max_tokens: 300
        });
        if (aiResult.ok && aiResult.text) {
          let t = aiResult.text.replace(/```json|```/g, '').trim();
          const lastBrace = t.lastIndexOf('}');
          if (lastBrace > 0) t = t.slice(0, lastBrace + 1);
          console.log('[Enrich] AI raw response:', t);
          aiEstimate = JSON.parse(t);
          console.log('[Enrich] AI parsed:', aiEstimate);
        } else { console.log('[Enrich] AI error:', aiResult.status); }
      } catch(e) { console.log('[Enrich] AI parse error:', e.message); }
    } else {
      console.log('[Enrich] Skipping Haiku — snippets too short:', snippets.length);
    }

    // Sanitize AI estimates — strip "Not found" / "Unknown" / "N/A" values
    const clean = v => (v && !/not found|unknown|unavailable|n\/a|none/i.test(v)) ? v : null;

    const result = {
      source: 'Web research',
      company,
      description: null,
      industry: clean(linkedinFirmo?.industry) || clean(aiEstimate.industry) || null,
      employees: clean(linkedinFirmo?.employees) || clean(aiEstimate.employees) || null,
      funding: clean(linkedinFirmo?.funding) || clean(aiEstimate.funding) || null,
      foundedYear: (linkedinFirmo?.founded ? parseInt(linkedinFirmo.founded) : null) || (aiEstimate.founded ? parseInt(aiEstimate.founded) : null) || null,
      companyWebsite: discoveredDomain ? `https://${discoveredDomain}` : null,
      companyLinkedin: null,
      leaders: [],
      raw: { linkedinFirmo, aiEstimate },
    };
    console.log('[Enrich] Web Research final:', { employees: result.employees, industry: result.industry, funding: result.funding, website: result.companyWebsite });
    return result;
  } catch (e) {
    console.log('[Enrich] Web Research failed:', e.message);
    return null;
  }
}

// Pipeline: try providers in order, return first with actual data
const ENRICHMENT_REGISTRY = { apollo: enrichFromApollo, webResearch: enrichFromWebResearch };

function hasEnrichmentData(result) {
  return result && (result.employees || result.industry || result.funding || result.foundedYear || result.companyWebsite);
}

async function runEnrichmentPipeline(company, domain, companyLinkedin) {
  // Derive domain from LinkedIn URL slug if no domain given
  let derivedDomain = domain;
  let linkedinSlug = null;
  if (companyLinkedin) {
    linkedinSlug = companyLinkedin.replace(/\/$/, '').split('/').pop();
    if (!derivedDomain && linkedinSlug) {
      // Try common TLD patterns: prophecy-io → prophecy.io, kapa-ai → kapa.ai
      const withDots = linkedinSlug.replace(/-/g, '.');
      if (/\.(io|ai|com|co|dev|app|tech|so|org|net|xyz)$/.test(withDots)) {
        derivedDomain = withDots;
        console.log('[Enrich] Derived domain from LinkedIn slug (dot pattern):', derivedDomain);
      } else {
        // Use slug + .com as a single guess (conserve API credits)
        derivedDomain = `${linkedinSlug}.com`;
        console.log('[Enrich] Guessing domain from slug:', derivedDomain);
      }
    }
  }
  if (_apolloExhausted && _serperExhausted) {
    console.warn('[Enrich] All API credits exhausted — skipping pipeline');
    return { ...emptyEnrichment(), source: null, _creditsExhausted: true };
  }
  console.log('[Enrich] Pipeline starting for:', company, '| domain:', derivedDomain || '(none)', '| linkedin:', linkedinSlug || '(none)');
  const enrichOrder = (pipelineConfig.enrichmentOrder || DEFAULT_PIPELINE_CONFIG.enrichmentOrder).filter(p => p.enabled);
  for (const provider of enrichOrder) {
    const fn = ENRICHMENT_REGISTRY[provider.id];
    if (!fn) continue;
    const result = await fn(company, derivedDomain);
    if (hasEnrichmentData(result)) {
      console.log('[Enrich] Pipeline success from:', result.source);
      return result;
    }
    if (result) console.log('[Enrich] Provider returned empty data, trying next');
  }
  console.log('[Enrich] All providers failed for:', company);
  return emptyEnrichment();
}

async function quickLookup(company, domain, companyLinkedin, linkedinFirmo) {
  const enrichment = await runEnrichmentPipeline(company, domain, companyLinkedin);
  const result = {
    employees: enrichment.employees,
    funding: enrichment.funding,
    industry: enrichment.industry,
    founded: enrichment.foundedYear ? String(enrichment.foundedYear) : null,
    companyWebsite: enrichment.companyWebsite,
    companyLinkedin: enrichment.companyLinkedin,
    enrichmentSource: enrichment.source,
  };
  // Backfill from LinkedIn firmographics (free DOM scraping — never overwrites)
  if (linkedinFirmo) {
    if (!result.employees && linkedinFirmo.employees) { result.employees = linkedinFirmo.employees; result.employeesSource = 'LinkedIn (page)'; }
    if (!result.industry && linkedinFirmo.industry) { result.industry = linkedinFirmo.industry; result.industrySource = 'LinkedIn (page)'; }
  }
  return result;
}

async function getCached(key) {
  key = key.replace(/[,;:!?.]+$/, '').trim(); // normalize
  return new Promise(resolve =>
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const entry = (researchCache || {})[key];
      if (entry && Date.now() - entry.ts < CACHE_TTL) {
        resolve({ ...entry.data, _cachedAt: entry.ts });
      } else {
        resolve(null);
      }
    })
  );
}

async function setCached(key, data) {
  key = key.replace(/[,;:!?.]+$/, '').trim(); // normalize
  return new Promise(resolve =>
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const updated = { ...(researchCache || {}), [key]: { data, ts: Date.now() } };
      // Prune entries older than TTL to keep storage lean
      for (const k of Object.keys(updated)) {
        if (Date.now() - updated[k].ts > CACHE_TTL) delete updated[k];
      }
      chrome.storage.local.set({ researchCache: updated }, resolve);
    })
  );
}

async function researchCompany(company, domain, prefs, companyLinkedin, linkedinFirmo) {
  const cacheKey = company.toLowerCase();
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const q = `"${company}"`;

    // Run enrichment pipeline first to discover the domain
    const enrichment = await runEnrichmentPipeline(company, domain, companyLinkedin);
    if (enrichment._creditsExhausted) {
      return { error: 'API credits exhausted — Apollo and Serper limits reached. Research data unavailable until credits renew.', _creditsExhausted: true };
    }
    const effectiveDomain = enrichment.companyWebsite?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || domain || '';
    const qd = effectiveDomain ? `"${company}" ${effectiveDomain}` : `"${company}" company`;

    // Scout-then-drill review search + parallel leader/job/product searches
    // Step 1: Scout query runs in parallel with other searches
    let leaderResults, jobResults, productResults;
    const scoutPromise = fetchSearchResults(`"${company}" reviews sales culture glassdoor repvue reddit`, pipelineConfig.searchCounts?.reviewScout || 3);

    if (_serperExhausted) {
      console.warn('[Research] Serper exhausted — running scout + leadership only; skipping jobs & product');
      leaderResults = await fetchSearchResults('site:linkedin.com/in ' + qd + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', pipelineConfig.searchCounts?.leaders || 5);
      jobResults = [];
      productResults = [];
    } else {
      [, leaderResults, jobResults, productResults] = await Promise.all([
        scoutPromise, // scout runs in parallel
        fetchSearchResults('site:linkedin.com/in ' + qd + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', pipelineConfig.searchCounts?.leaders || 5),
        fetchSearchResults(qd + ' jobs hiring (site:linkedin.com OR site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com OR site:wellfound.com)', pipelineConfig.searchCounts?.jobs || 5),
        fetchSearchResults(qd + ' what does it do product overview how it works category', pipelineConfig.searchCounts?.product || 3),
      ]);
    }

    // Step 2: Analyze scout results for known review sources
    const scoutResults = await scoutPromise;
    const scoutUrls = scoutResults.map(r => (r.link || '').toLowerCase());
    const hasRepVue = scoutUrls.some(u => u.includes('repvue.com'));
    const hasGlassdoor = scoutUrls.some(u => u.includes('glassdoor.com'));
    console.log('[Research] Review scout:', { hits: scoutResults.length, hasRepVue, hasGlassdoor });

    // Step 3: Targeted drill queries for high-signal sources
    // Pull user role keywords for targeted queries
    const { prefs: _drillPrefs } = await new Promise(r => chrome.storage.sync.get(['prefs'], r));
    const roleKeywords = (_drillPrefs?.roles || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2).slice(0, 3).join(' OR ') || 'sales OR GTM OR revenue OR leadership';

    const drillPromises = [];
    if (hasRepVue) drillPromises.push(fetchSearchResults(`site:repvue.com "${company}" sales quota culture`, pipelineConfig.searchCounts?.reviewDrill || 2));
    if (hasGlassdoor) drillPromises.push(fetchSearchResults(`site:glassdoor.com/Reviews "${company}" ${roleKeywords}`, pipelineConfig.searchCounts?.reviewDrill || 2));
    const drillResults = drillPromises.length ? await Promise.all(drillPromises) : [];

    // Step 4: Combine and deduplicate by URL
    const seenUrls = new Set();
    const reviewResults = [];
    for (const r of [...scoutResults, ...drillResults.flat()]) {
      const url = (r.link || '').toLowerCase();
      if (url && !seenUrls.has(url)) { seenUrls.add(url); reviewResults.push(r); }
    }
    console.log('[Research] Reviews:', reviewResults.length, 'total (scout:', scoutResults.length, '+ drills:', drillResults.flat().length, ')');

    // Use Apollo raw data for Claude synthesis if available, otherwise pass empty
    const apolloRaw = enrichment.raw?.estimated_num_employees ? enrichment.raw : {};
    const aiSummary = await fetchClaudeSummary(company, apolloRaw, reviewResults, leaderResults, productResults, domain);

    const claudeFirmo = aiSummary.firmographics || {};
    const src = enrichment.source || 'Unknown';
    const result = {
      ...aiSummary,
      employees: enrichment.employees || claudeFirmo.employees || null,
      funding: enrichment.funding || claudeFirmo.funding || null,
      industry: enrichment.industry || claudeFirmo.industry || null,
      founded: enrichment.foundedYear ? String(enrichment.foundedYear) : (claudeFirmo.founded || null),
      companyWebsite: enrichment.companyWebsite || null,
      companyLinkedin: enrichment.companyLinkedin || null,
      jobListings: jobResults.map(r => ({ title: r.title, url: r.link, snippet: r.snippet })),
      enrichmentSource: src,
      _usedExpensiveFallback: !!(reviewResults._usedExpensiveFallback || leaderResults._usedExpensiveFallback || jobResults._usedExpensiveFallback || productResults._usedExpensiveFallback),
      // Per-field source attribution
      dataSources: {
        employees: enrichment.employees ? src : claudeFirmo.employees ? 'Claude estimate' : null,
        funding: enrichment.funding ? src : claudeFirmo.funding ? 'Claude estimate' : null,
        industry: enrichment.industry ? src : claudeFirmo.industry ? 'Claude estimate' : null,
        founded: enrichment.foundedYear ? src : claudeFirmo.founded ? 'Claude estimate' : null,
        intelligence: 'Claude synthesis',
        leaders: leaderResults.length ? 'LinkedIn via search' : null,
        reviews: reviewResults.length ? 'Web search' : null,
        jobListings: jobResults.length ? 'Web search' : null,
        jobMatch: 'Claude Haiku',
      },
    };
    // Propagate data conflict flag from AI validation
    if (aiSummary._dataConflict) {
      result.dataConflict = true;
      delete result._dataConflict;
    }
    // Backfill from LinkedIn firmographics (free DOM scraping — never overwrites)
    if (linkedinFirmo) {
      if (!result.employees && linkedinFirmo.employees) { result.employees = linkedinFirmo.employees; result.employeesSource = 'LinkedIn (page)'; }
      if (!result.industry && linkedinFirmo.industry) { result.industry = linkedinFirmo.industry; result.industrySource = 'LinkedIn (page)'; }
    }
    await setCached(cacheKey, result);
    return result;
  } catch (err) {
    return { error: 'Something went wrong: ' + err.message };
  }
}

async function analyzeJob(company, jobTitle, jobDescription, prefs, richContext) {
  if (!prefs) return null;
  const hasJobPrefs = prefs.jobMatchEnabled || prefs.jobMatchBackground || prefs.roles ||
    prefs.avoid || prefs.workArrangement?.length > 0 || prefs.salaryFloor || prefs.salaryStrong ||
    prefs.resumeText;
  if (!hasJobPrefs) return null;

  const locationContext = prefs.workArrangement?.length ? prefs.workArrangement.join(', ') : null;

  const salaryFloor = prefs.salaryFloor || prefs.minSalary || null;
  const salaryStrong = prefs.salaryStrong || null;

  // Build rich context section from available data
  const rc = richContext || {};
  let richSection = '';
  if (rc.intelligence) richSection += `\nCompany Intelligence: ${rc.intelligence}\n`;
  if (rc.reviews?.length) richSection += `\nEmployee Reviews:\n${rc.reviews.slice(0, 4).map(r => `- ${r.rating ? r.rating + '★ ' : ''}"${r.snippet}" (${r.source || ''})`).join('\n')}\n`;
  if (rc.emails?.length) richSection += `\nRecent Email Context (${rc.emails.length} emails):\n${rc.emails.slice(0, 5).map(e => `- [${e.date}] "${e.subject}" from ${e.from}`).join('\n')}\n`;
  if (rc.meetings?.length) richSection += `\nMeeting Context (${rc.meetings.length} meetings):\n${rc.meetings.slice(0, 3).map(m => `- ${m.title || 'Meeting'} (${m.date || ''}) — ${(m.transcript || '').slice(0, 500)}`).join('\n')}\n`;
  if (rc.transcript) richSection += `\nMeeting Transcript (summary):\n${rc.transcript.slice(0, 1500)}\n`;
  if (rc.storyTime) richSection += `\nUser Story Time Profile:\n${rc.storyTime.slice(0, 3000)}\n`;
  // For high-stakes scoring, also include raw Story Time if available and different from summary
  if (rc.storyTimeRaw && rc.storyTimeRaw !== rc.storyTime) {
    richSection += `\nDetailed Background (raw):\n${rc.storyTimeRaw.slice(0, 4000)}\n`;
  }
  if (rc.notes) richSection += `\nUser Notes on This Company:\n${rc.notes}\n`;
  if (rc.knownComp) richSection += `\n${rc.knownComp}\n`;
  if (rc.contextDocuments?.length) {
    richSection += `\nUploaded Documents:\n${rc.contextDocuments.map(d =>
      `--- ${d.filename} ---\n${d.extractedText.slice(0, 1500)}`
    ).join('\n\n')}\n`;
  }
  if (rc.candidateProfile) richSection += `\nCandidate Career OS Profile:${rc.candidateProfile}\n`;
  if (rc.matchFeedback) richSection += `\nPrevious assessment feedback: ${rc.matchFeedback}\n`;
  if (rc.dismissedFlags?.length) {
    const withReasons = rc.dismissedFlagsWithReasons || [];
    const lines = rc.dismissedFlags.map(f => {
      const r = withReasons.find(x => x.flag === f);
      return r?.reason ? `- "${f}" — USER SAYS: ${r.reason}` : `- "${f}"`;
    });
    richSection += `\nUser dismissed these flags as wrong/overblown (do NOT repeat them, and learn from the reasons given):\n${lines.join('\n')}\n`;
  }

  const prompt = `Analyze this job posting for a job seeker. Return ONLY a JSON object, no markdown.

Company: ${company}
Job Title: ${jobTitle}
${jobDescription
  ? `Job Description:\n${jobDescription}`
  : `(Full description unavailable — analyze from job title and company context only.)`}
${richSection}
${prefs.resumeText ? `Candidate Resume / LinkedIn Profile:\n${prefs.resumeText}\n` : ''}
User Profile:
- Additional background notes: ${prefs.jobMatchBackground || 'none'}
- Target roles: ${prefs.roles || 'not specified'}
- Things to avoid: ${prefs.avoid || 'not specified'}
- Actual location: ${prefs.userLocation || 'not specified'}
- Work arrangement preference: ${locationContext || 'not specified'}
- Max travel willing to do: ${prefs.maxTravel || 'not specified'}
- BASE salary floor (walk away if base pay is below): ${salaryFloor || 'not set'}
- BASE salary strong offer (exciting above): ${salaryStrong || 'not set'}
- OTE floor (walk away if total comp/OTE is below): ${prefs.oteFloor || 'not set'}
- OTE strong offer (exciting above): ${prefs.oteStrong || 'not set'}
${prefs.roleLoved ? `- A role they loved: ${prefs.roleLoved}` : ''}
${prefs.roleHated ? `- A role that was a bad fit: ${prefs.roleHated}` : ''}

Analysis rules:
1. Work arrangement and location are DEALBREAKERS. If the user prefers Remote and the job is On-site or Hybrid-only, this is a MAJOR mismatch — drop the score by at least 3 points and add it as a red flag (e.g., "On-site role conflicts with Remote preference"). If the user prefers Hybrid and the job is On-site, drop by 2 points. A matching work arrangement is a strong fit worth noting.
2. Only flag things explicitly stated or directly evidenced in the posting. Do NOT flag the absence of information — if equity isn't mentioned, that is not a red flag. If reporting structure isn't mentioned, do not speculate. No "Unclear:" prefixes — if you can't support it with evidence from the posting, leave it out.
3. CRITICAL: Red flags must be backed by something the candidate EXPLICITLY stated in their preferences, dealbreakers, or profile. Do NOT infer dealbreakers they never expressed. If the candidate hasn't said they dislike a role type, don't flag it. "No equity mentioned" is NEVER a red flag. Don't extrapolate — stick to what they actually wrote.
4. Travel: if the posting explicitly mentions travel requirements, compare against max travel preference and flag only if it clearly exceeds it.
5. Bridge the language gap: the user describes themselves in personal terms; job postings use corporate language. Map them — e.g. "I love autonomy and building from scratch" → look for early-stage, greenfield, founder-led signals. "Manage and grow existing accounts" → retention focus, not new business ownership.
6. Read between the lines on culture, scope, and autonomy — but only from what the posting actually implies, not from what it omits.
7. Use loved/hated role examples as calibration for concrete signals you find in the posting.
8. Salary: extract the BASE salary or base salary range if stated anywhere in the posting (including legal/compliance disclosure sections at the bottom). If multiple figures are given (e.g., base + OTE/commission), extract the base salary only and set salaryType to "base". If only total/OTE compensation is mentioned, extract that and set salaryType to "ote". If no number is mentioned anywhere, use null for both.
9. Do NOT flag missing salary information as a red flag or mention it in redFlags at all. Compensation not disclosed is NEVER a negative signal — it is simply unknown and not a factor. Do not speculate that undisclosed comp is "likely below" any threshold.
10. Compensation evaluation — compare disclosed pay against the candidate's thresholds:
  - If BASE salary is disclosed and is below the candidate's BASE floor → MAJOR red flag with specific numbers (e.g., "Base $80K is below your $150K base floor"). Drop score by 2+ points.
  - If only OTE/total comp is disclosed and is below the candidate's OTE floor → red flag (e.g., "OTE $160K is below your $200K OTE floor"). Drop score by 1-2 points.
  - If OTE is disclosed but no base is separated, do NOT compare OTE against the BASE floor — they are different numbers. A $200K OTE does not mean $200K base.
  - Clearly label extracted compensation as "Base" or "OTE" in the jobSnapshot fields. Never leave ambiguous.
11. OTE (On-Target Earnings) ranges without explicit base salary separation are COMPLETELY NORMAL for sales roles — do NOT flag this as a red flag. "Wide OTE range" is not a red flag. "Base not separated from OTE" is not a red flag. Only flag compensation as a red flag if the OTE or base is clearly below the candidate's salary floor.
12. Do NOT flag missing travel information as a red flag. Most job postings don't mention travel requirements — this is normal and not a negative signal. Only flag travel as a red flag if travel is explicitly required AND it exceeds the user's max travel preference.
13. For workArrangement in jobSnapshot: if the LinkedIn posting explicitly says "Remote" in its chips/tags, set workArrangement to "Remote" even if the job description mentions a specific geography or territory (e.g., "Southeast region"). Territory assignments do NOT mean on-site — they define sales coverage area, not work location.

Quick Take: Include 2-4 of the most decisive signals as quickTake bullets (green for strong fits, red for dealbreakers). Lead with the single most important signal. Keep each to 8-15 words max.

Hard DQ: Set hardDQ.flagged to true ONLY when there is an absolute, verified dealbreaker:
- Work Arrangement field says On-site or Hybrid AND candidate requires Remote
- Base salary MAXIMUM is below candidate's salary floor
- Role function is fundamentally different from candidate's target roles
If none clearly apply, set hardDQ.flagged to false. When in doubt, do NOT flag.

{
  "jobMatch": {
    "jobSummary": "<2-3 sentences on core responsibilities and what success looks like in this role>",
    "score": <1-10 REALISTIC fit score. This is a WEIGHTED BLEND of: qualificationScore (how desirable a candidate from the employer's view), preference fit (green/red flags), compensation alignment, and role fit. The qualificationScore should heavily influence this number — a role where the candidate is underqualified (qualificationScore 3-4) should cap the overall score around 4-5 even if preferences match perfectly. Be honest about whether they'd realistically get hired.>,
    "verdict": "<one direct, honest sentence — should they apply and why. If they're underqualified, say so clearly.>",
    "strongFits": ["<concrete signal explicitly stated or strongly evidenced in the posting, 8-14 words>"],
    "redFlags": ["<concrete signal explicitly stated or strongly evidenced in the posting, 8-14 words>"],
    "quickTake": [{"type": "green or red", "text": "8-15 word bullet summarizing a key signal"}],
    "hardDQ": {"flagged": true/false, "reasons": ["short reason string"]}
  },
  "jobSnapshot": {
    "salary": "<base salary range as written in the posting, e.g. '$125,000' or '$133,500 - $200,500' — null only if truly not mentioned>",
    "salaryType": "<'base' if this is base pay, 'ote' if this is OTE/total comp only, null if no salary>",
    "baseSalaryRange": "<base salary range ONLY if explicitly stated as base/salary, e.g. '$130,000 - $160,000' — null if not separated from OTE>",
    "oteTotalComp": "<OTE or total compensation if stated, e.g. '$200,000 - $250,000 OTE' — null if not mentioned>",
    "equity": "<equity/stock info if mentioned, e.g. '0.05% - 0.10%' or '$50K RSUs over 4 years' — null if not mentioned>",
    "workArrangement": "<Remote/Hybrid/On-site or null>",
    "location": "<city/state if hybrid or on-site, null if remote>",
    "employmentType": "<Full-time/Part-time/Contract or null>"
  }
}`;

  try {
    const aiResult = await aiCall('jobMatchScoring', {
      system: 'You are a JSON-only analyst. Respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1100
    });
    if (!aiResult.ok) {
      // Fallback through all models
      const fallback = await chatWithFallback({
        model: getModelForTask('jobMatchScoring'), system: 'You are a JSON-only analyst. Respond with valid JSON only.',
        messages: [{ role: 'user', content: prompt }], max_tokens: 1100, tag: 'AnalyzeJob'
      });
      if (!fallback.error) return JSON.parse(fallback.reply.replace(/```json|```/g, '').trim());
      return null;
    }
    const result = JSON.parse(aiResult.text.replace(/```json|```/g, '').trim());
    // Log when Hard DQ contradicts score — but don't force-cap, the DQ might be wrong
    if (result?.jobMatch?.hardDQ?.flagged && result.jobMatch.score > 4) {
      console.warn(`[AnalyzeJob] Hard DQ flagged but score is ${result.jobMatch.score} — AI may have misidentified the DQ`);
    }
    return result;
  } catch (err) {
    return null;
  }
}

function extractDomainFromResults(results, companyName) {
  const blocked = [
    'linkedin.com', 'glassdoor.com', 'repvue.com', 'blind.com', 'crunchbase.com',
    'google.com', 'youtube.com', 'twitter.com', 'facebook.com', 'wikipedia.org',
    'g2.com', 'capterra.com', 'gartner.com', 'trustpilot.com', 'trustradius.com',
    'techcrunch.com', 'forbes.com', 'inc.com', 'businesswire.com', 'prnewswire.com',
    'zoominfo.com', 'bloomberg.com', 'reuters.com', 'wsj.com', 'getapp.com',
    'clutch.co', 'cision.com', 'businessinsider.com', 'venturebeat.com', 'yahoo.com',
    'indeed.com', 'builtin.com', 'comparably.com', 'pitchbook.com', 'cb-insights.com'
  ];
  const slug = companyName ? companyName.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const candidates = [];
  for (const r of results) {
    try {
      const host = new URL(r.link).hostname.replace('www.', '');
      if (blocked.some(b => host.includes(b))) continue;
      // Prefer domains that contain the company name slug
      if (slug && host.replace(/[^a-z0-9]/g, '').includes(slug)) return host;
      candidates.push(host);
    } catch {}
  }
  return candidates[0] || null;
}

function parseLinkedInCompanySnippet(results) {
  // LinkedIn company page snippets look like:
  // "Fractal | 523 followers on LinkedIn. Ship ChatGPT apps in minutes. | Software Development · 11-50 employees · Founded 2022"
  const out = { employees: null, founded: null, industry: null };
  for (const r of results) {
    const text = `${r.title || ''} ${r.snippet || ''}`;

    if (!out.employees) {
      const m = text.match(/(\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?)\s*employees/i);
      if (m) out.employees = m[1].trim();
    }
    if (!out.founded) {
      const m = text.match(/[Ff]ounded[:\s]+(\d{4})/);
      if (m) out.founded = m[1];
    }
    if (!out.industry) {
      // Industry appears before the · employees pattern in LinkedIn snippets
      const m = text.match(/\|\s*([^|·\n]{3,40}?)\s*·\s*\d[\d,]*\s*(?:[-–]\s*\d[\d,]*)?\s*employees/i);
      if (m) out.industry = m[1].trim();
    }

    if (out.employees && out.founded && out.industry) break;
  }
  return (out.employees || out.founded || out.industry) ? out : null;
}

async function testApiKey(provider, key) {
  // If sentinel, use the active in-memory key
  if (key === '__USE_ACTIVE_KEY__') {
    const keys = { anthropic: ANTHROPIC_KEY, openai: OPENAI_KEY, serper: SERPER_KEY, apollo: APOLLO_KEY, granola: GRANOLA_KEY };
    key = keys[provider] || '';
    if (!key) return { ok: false, reason: 'No key configured' };
  }
  // Strip invisible Unicode characters that break HTTP headers
  key = key.replace(/[^\x20-\x7E]/g, '').trim();
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 401) return { ok: false, status: res.status, reason: 'Invalid API key' };
      if (res.status === 429) return { ok: false, status: res.status, reason: 'Key valid — rate limited' };
      if (res.status === 402 || res.status === 403) return { ok: false, status: res.status, reason: 'Key valid — billing/permission issue' };
      return { ok: false, status: res.status };
    }
    if (provider === 'apollo') {
      const res = await fetch('https://api.apollo.io/api/v1/organizations/enrich?name=google', {
        headers: { 'Content-Type': 'application/json', 'x-api-key': key }
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'Invalid API key' };
      if (res.status === 422 || res.status === 429 || res.status === 402) return { ok: false, status: res.status, reason: 'Key valid — credits exhausted' };
      return { ok: false, status: res.status };
    }
    if (provider === 'serper') {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q: 'test', num: 1 })
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'Invalid API key' };
      if (res.status === 400 || res.status === 429 || res.status === 402) return { ok: false, status: res.status, reason: 'Key valid — credits exhausted' };
      return { ok: false, status: res.status };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 401) return { ok: false, status: res.status, reason: 'Invalid API key' };
      if (res.status === 429) return { ok: false, status: res.status, reason: 'Key valid — rate limited' };
      if (res.status === 402) return { ok: false, status: res.status, reason: 'Key valid — billing issue' };
      return { ok: false, status: res.status };
    }
    if (provider === 'granola') {
      const res = await fetch('https://public-api.granola.ai/v1/notes?page_size=1', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      return { ok: res.ok, status: res.status };
    }
    return { ok: false, error: 'Unknown provider' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchApolloData(domain, companyName) {
  if (_apolloExhausted) { console.log('[Apollo] Skipped — credits exhausted'); return {}; }
  const param = domain
    ? 'domain=' + encodeURIComponent(domain)
    : 'name=' + encodeURIComponent(companyName);
  const res = await fetch('https://api.apollo.io/api/v1/organizations/enrich?' + param, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'x-api-key': APOLLO_KEY
    }
  });
  trackApiCall('apollo', res); // non-blocking, no await needed
  if (res.status === 429 || res.status === 402 || res.status === 403) {
    console.warn('[Apollo] Credits exhausted (HTTP', res.status, ')');
    _apolloExhausted = true;
    return {};
  }
  const data = await res.json();
  return data.organization || {};
}

async function fetchLeaderPhoto(name, company) {
  await _photoCacheReady; // ensure cache is loaded before checking
  const cacheKey = `${name}|${company}`;
  if (photoCache[cacheKey] !== undefined) {
    console.log(`[PhotoCache] HIT: ${cacheKey}`);
    return photoCache[cacheKey];
  }
  // Dedup: if a fetch for the same key is already in-flight, reuse its promise
  if (photoPending[cacheKey]) {
    console.log(`[PhotoCache] IN-FLIGHT dedup: ${cacheKey}`);
    return photoPending[cacheKey];
  }
  if (!SERPER_KEY || _serperExhausted) { photoCache[cacheKey] = null; return null; }
  console.log(`[PhotoCache] MISS: ${cacheKey} — fetching from Serper`);

  photoPending[cacheKey] = (async () => {
    try {
      const res = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
        body: JSON.stringify({ q: name + ' ' + company, num: 1 })
      });
      const data = await res.json();
      const photoUrl = data.images?.[0]?.thumbnailUrl || null;
      photoCache[cacheKey] = photoUrl;
      chrome.storage.local.set({ photoCache }); // persist
      console.log(`[PhotoCache] Saved ${Object.keys(photoCache).length} entries to storage`);
      return photoUrl;
    } catch {
      photoCache[cacheKey] = null;
      chrome.storage.local.set({ photoCache }); // persist
      return null;
    } finally {
      delete photoPending[cacheKey];
    }
  })();

  return photoPending[cacheKey];
}

async function fetchSerperResults(query, num = 5) {
  if (_serperExhausted) { console.log('[Serper] Skipped — credits exhausted'); return []; }
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': SERPER_KEY
    },
    body: JSON.stringify({ q: query, num })
  });
  trackApiCall('serper', res); // non-blocking, no await needed
  if (res.status === 429 || res.status === 402 || res.status === 403) {
    console.warn('[Serper] Credits exhausted (HTTP', res.status, ')');
    _serperExhausted = true;
    return [];
  }
  const data = await res.json();
  return data.organic || [];
}

// Google Custom Search — free 100 queries/day
async function fetchGoogleCSEResults(query, num = 5) {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) return [];
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(GOOGLE_CSE_CX)}&q=${encodeURIComponent(query)}&num=${Math.min(num, 10)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[GoogleCSE] Error:', res.status);
      return [];
    }
    const data = await res.json();
    // Normalize to same format as Serper (title, link, snippet)
    return (data.items || []).map(item => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
    }));
  } catch (err) {
    console.warn('[GoogleCSE] Fetch error:', err.message);
    return [];
  }
}

// Claude Web Search — uses Anthropic's built-in web_search tool
async function fetchClaudeWebSearch(query, num = 5) {
  if (!ANTHROPIC_KEY) { console.log('[ClaudeSearch] No API key'); return []; }
  try {
    console.log('[ClaudeSearch] Searching:', query);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: num }],
        messages: [{ role: 'user', content: `Search the web for: ${query}\n\nReturn the most relevant results.` }]
      })
    });
    if (!res.ok) { console.warn('[ClaudeSearch] API error:', res.status); return []; }
    const data = await res.json();
    // Parse search results from the response content blocks
    const results = [];
    for (const block of (data.content || [])) {
      if (block.type === 'web_search_tool_result') {
        for (const sr of (block.content || [])) {
          if (sr.type === 'web_search_result') {
            results.push({ title: sr.title || '', link: sr.url || '', snippet: sr.page_content || sr.snippet || '' });
          }
        }
      }
    }
    console.log('[ClaudeSearch] Got', results.length, 'results for:', query);
    return results.slice(0, num);
  } catch (e) {
    console.warn('[ClaudeSearch] Error:', e.message);
    return [];
  }
}

// OpenAI Web Search — uses web_search_preview tool
async function fetchOpenAIWebSearch(query, num = 5) {
  if (!OPENAI_KEY) { console.log('[OpenAISearch] No API key'); return []; }
  try {
    console.log('[OpenAISearch] Searching:', query, '| key length:', OPENAI_KEY.length);
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        tools: [{ type: 'web_search_preview' }],
        input: `Search the web for: ${query}\n\nReturn the most relevant results with titles, URLs, and snippets.`
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[OpenAISearch] API error:', res.status, errBody.slice(0, 300));
      return [];
    }
    const data = await res.json();
    console.log('[OpenAISearch] Response output types:', (data.output || []).map(o => o.type).join(', '));
    // Parse results from the response output
    const results = [];
    let fullText = '';
    for (const item of (data.output || [])) {
      if (item.type === 'web_search_call') continue;
      if (item.type === 'message' && item.content) {
        for (const c of item.content) {
          if (c.type === 'output_text') {
            fullText = c.text || '';
            for (const ann of (c.annotations || [])) {
              if (ann.type === 'url_citation') {
                // Extract surrounding text as snippet
                const snippetStart = Math.max(0, (ann.start_index || 0) - 100);
                const snippetEnd = Math.min(fullText.length, (ann.end_index || 0) + 100);
                const snippet = fullText.slice(snippetStart, snippetEnd).replace(/\n/g, ' ').trim();
                results.push({ title: ann.title || '', link: ann.url || '', snippet });
              }
            }
          }
        }
      }
    }
    console.log('[OpenAISearch] Got', results.length, 'results for:', query);
    return results.slice(0, num);
  } catch (e) {
    console.warn('[OpenAISearch] Error:', e.message);
    return [];
  }
}

// Unified search — tries providers in priority order with automatic fallback
async function fetchSearchResults(query, num = 5) {
  console.log('[Search] Provider status:', {
    serper: SERPER_KEY ? (_serperExhausted ? 'exhausted' : 'available') : 'no key',
    googleCSE: (GOOGLE_CSE_KEY && GOOGLE_CSE_CX) ? 'available' : 'no key',
    openai: OPENAI_KEY ? 'available' : 'no key',
    claude: ANTHROPIC_KEY ? 'available' : 'no key',
  });

  const searchChain = (pipelineConfig.searchFallbackOrder || DEFAULT_PIPELINE_CONFIG.searchFallbackOrder)
    .filter(p => p.enabled);

  const SEARCH_REGISTRY = {
    serper: () => SERPER_KEY && !_serperExhausted ? fetchSerperResults(query, num) : Promise.resolve([]),
    google_cse: () => GOOGLE_CSE_KEY && GOOGLE_CSE_CX ? fetchGoogleCSEResults(query, num) : Promise.resolve([]),
    openai: () => OPENAI_KEY ? fetchOpenAIWebSearch(query, num) : Promise.resolve([]),
    claude: () => ANTHROPIC_KEY ? fetchClaudeWebSearch(query, num) : Promise.resolve([]),
  };

  for (const provider of searchChain) {
    const fn = SEARCH_REGISTRY[provider.id];
    if (!fn) continue;
    console.log(`[Search] Trying ${provider.id}...`);
    const results = await fn();
    if (results.length > 0) {
      console.log(`[Search] ${provider.id} returned`, results.length, 'results');
      if (provider.id !== 'serper' && provider.id !== 'google_cse') results._usedExpensiveFallback = true;
      return results;
    }
    console.log(`[Search] ${provider.id} returned 0 results`);
  }
  console.log('[Search] All providers exhausted for:', query);
  return [];
}

async function fetchClaudeSummary(company, apolloData, searchResults, leaderResults, productResults, domain) {
  const searchSnippets = searchResults.map(r => `${r.title} (${r.link}): ${r.snippet}`).join('\n');
  const leaderSnippets = leaderResults.map(r => `${r.title} (${r.link}): ${r.snippet}`).join('\n');
  const productSnippets = productResults.map(r => `${r.title} (${r.link}): ${r.snippet}`).join('\n');

  const prompt = `You are a research assistant helping people quickly understand and evaluate companies. Use the data provided below.

Company: ${company}${domain ? `\nSource website: ${domain}` : ''}

Apollo Data:
- Employees: ${apolloData.estimated_num_employees || null}
- Industry: ${apolloData.industry || null}
- Founded: ${apolloData.founded_year || null}
- Funding Stage: ${apolloData.latest_funding_stage || null}
- Total Funding: ${apolloData.total_funding_printed || null}

Product/Company Search Results:
${productSnippets || 'None'}

Review Search Results:
${searchSnippets || 'None'}

Leadership Search Results:
${leaderSnippets || 'None'}

CRITICAL: Search results may contain information about MULTIPLE companies with similar names. Before writing your response, identify which company matches the domain "${domain || company}" and ONLY use information about THAT specific company. If the search results describe two different products/businesses, pick the one that matches the domain. ALL fields in "intelligence" must describe the SAME company — if oneLiner says "staffing", then whosBuyingIt and howItWorks must also be about staffing, NOT about a different product.

Respond with a JSON object only, no markdown:
{
  "intelligence": {
    "oneLiner": "<one sentence, plain English — what does this company do and for whom>",
    "eli5": "<2-3 sentences explaining what they do like you're explaining to a smart friend>",
    "whosBuyingIt": "<who are the typical buyers — role, company size, pain point — MUST be consistent with oneLiner>",
    "category": "<type of company, e.g. 'B2B SaaS, payments infrastructure'>",
    "howItWorks": "<2-3 sentences on core product mechanics and what makes it defensible — MUST describe the same product as oneLiner>"
  },
  "firmographics": {
    "employees": "<headcount or range extracted from search results, e.g. '50-200' or '~500' — null if truly unknown>",
    "founded": "<year founded from any source — null if truly unknown>",
    "funding": "<total funding or stage from any source, e.g. 'Series B, $24M' — null if truly unknown>",
    "industry": "<industry/category from context — null if truly unknown>"
  },
  "reviews": [{"snippet": "<key insight about culture, employee experience, or company reputation. If Glassdoor rating or 'would recommend' percentage is visible in the snippet, include it (e.g. '4.4★ rating, 82% would recommend. Employees praise...'). Extract actual review content, not job listing titles.>", "source": "<site name, e.g. Glassdoor, Blind, RepVue, Reddit>", "rating": "<star rating if found, e.g. '4.4' — null if not in snippet>", "url": "<exact URL>"}],
  "leaders": [{"name": "<full name>", "title": "<role at this company>", "newsUrl": "<URL or null>"}]
}`;

  const aiResult = await aiCall('companyIntelligence', {
    system: 'You are a JSON-only research assistant. Respond with valid JSON only, no markdown fences.',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000
  });

  if (!aiResult.ok) {
    // Try fallback chain if primary model failed
    const fallback = await chatWithFallback({
      model: 'gpt-4.1-mini',
      system: 'You are a JSON-only research assistant. Respond with valid JSON only, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      tag: 'Research'
    });
    if (fallback.error) throw new Error('AI is busy — too many requests. Try again in a moment.');
    const fbClean = fallback.reply.replace(/```json|```/g, '').trim();
    let fbResult;
    try { fbResult = JSON.parse(fbClean); } catch { fbResult = JSON.parse(fbClean.slice(0, fbClean.lastIndexOf('}') + 1)); }
    const fbAiRef = fbResult.intelligence?.eli5 || fbResult.intelligence?.oneLiner || '';
    if (fbAiRef && company) {
      const fbWords = company.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
      if (!fbWords.some(w => fbAiRef.toLowerCase().includes(w))) fbResult._dataConflict = true;
    }
    return fbResult;
  }
  const raw = aiResult.text;
  if (!raw) throw new Error('Empty response from AI');
  const clean = raw.replace(/```json|```/g, '').trim();
  // If JSON is truncated (common with low max_tokens), attempt partial recovery
  let parsedResult;
  try {
    parsedResult = JSON.parse(clean);
  } catch (e) {
    // Try to find the largest valid JSON object in the response
    const lastBrace = clean.lastIndexOf('}');
    if (lastBrace > 0) {
      parsedResult = JSON.parse(clean.slice(0, lastBrace + 1));
    } else {
      throw e;
    }
  }
  // Validate the AI didn't describe a different company
  const aiCompanyRef = parsedResult.intelligence?.eli5 || parsedResult.intelligence?.oneLiner || '';
  if (aiCompanyRef && company) {
    const companyWords = company.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    const descLower = aiCompanyRef.toLowerCase();
    const mentionsCompany = companyWords.some(w => descLower.includes(w));
    if (!mentionsCompany) {
      console.warn('[Research] AI description may not match company:', company, '| desc:', aiCompanyRef.slice(0, 80));
      parsedResult._dataConflict = true;
    }
  }
  return parsedResult;
}

// ── Gmail ───────────────────────────────────────────────────────────────────

async function gmailAuth() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      void chrome.runtime.lastError;
      if (!token) {
        resolve({ error: 'Auth failed or cancelled' });
        return;
      }
      chrome.storage.local.set({ gmailConnected: true });
      resolve({ success: true });
    });
  });
}

async function gmailRevoke() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, async token => {
      void chrome.runtime.lastError;
      // Revoke server-side first so next auth forces a fresh consent screen
      if (token) {
        try { await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`); } catch(e) {}
      }
      // Clear ALL cached tokens (not just this one) so new scopes are requested on reconnect
      chrome.identity.clearAllCachedAuthTokens(() => {
        chrome.storage.local.remove('gmailConnected');
        resolve({ success: true });
      });
    });
  });
}

function decodeBase64Utf8(data) {
  try {
    const bytes = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return decodeURIComponent(bytes.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  } catch(e) {
    try { return atob(data.replace(/-/g, '+').replace(/_/g, '/')); } catch(e2) { return ''; }
  }
}

function extractEmailBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    const t = decodeBase64Utf8(payload.body.data);
    if (t) return t;
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const t = decodeBase64Utf8(part.body.data);
      if (t) return t;
    }
  }
  for (const part of payload.parts || []) {
    const nested = extractEmailBody(part);
    if (nested) return nested;
  }
  return '';
}

// ── Rejection email detection (regex-only, zero cost) ────────────────────────
function detectRejectionEmailBg(emails, entry) {
  if (!emails?.length) return null;
  const REJECTION_PHRASES = [
    /we(?:'ve| have) decided to (?:move|go) forward with (?:other|another|different) candidate/i,
    /(?:unfortunately|regretfully),?\s*we (?:will not|won't|are unable to|cannot) (?:be )?(?:move|moving|proceed|proceeding) forward/i,
    /(?:unfortunately|regretfully),?\s*(?:we|the team|I) (?:have|has) decided (?:not )?to (?:not )?(?:move|proceed|continue)/i,
    /(?:the )?position has been filled/i,
    /after careful (?:consideration|review|deliberation).*?(?:not|won't|unable).*?(?:move|moving|proceed|offer)/i,
    /we(?:'re| are) not (?:able to )?(?:move|moving|proceed) forward with your (?:application|candidacy)/i,
    /(?:we|I) (?:regret|am sorry|are sorry) to inform you/i,
    /your (?:application|candidacy) (?:was|has been) (?:not selected|unsuccessful|rejected)/i,
    /we(?:'ve| have) (?:chosen|selected|decided on) (?:a |an )?(?:other|another|different) candidate/i,
    /(?:not|won't) be (?:extending|making) (?:you )?an offer/i,
    /decided to (?:pursue|explore) other (?:candidates|directions|options)/i,
    /will not be (?:advancing|continuing) (?:your|with your)/i,
  ];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if ((entry.tags || []).includes('Application Rejected')) return null;
  for (const email of emails) {
    const emailDate = email.date ? new Date(email.date).getTime() : 0;
    if (emailDate && emailDate < cutoff) continue;
    const text = [email.subject || '', email.snippet || '', (email.body || '').slice(0, 800)].join(' ');
    for (const pattern of REJECTION_PHRASES) {
      if (pattern.test(text)) {
        return { subject: email.subject, from: email.from, date: email.date, snippet: email.snippet };
      }
    }
  }
  return null;
}

async function fetchGmailEmails(domain, companyName, linkedinSlug, knownContactEmails) {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, async token => {
      void chrome.runtime.lastError;
      if (!token) { resolve({ emails: [], error: 'not_connected' }); return; }
      try {
        const parts = [];
        const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';

        // Primary: domain-based search (most precise)
        if (domain) parts.push(`from:@${domain} OR to:@${domain}`);

        // Sibling domains: any known contact email sharing the same base name
        // e.g. productgenius.io when primary domain is productgenius.ai
        const siblingDomains = new Set();
        (knownContactEmails || []).forEach(email => {
          const d = (email.split('@')[1] || '').toLowerCase();
          if (d && d !== domain && baseDomain && d.split('.')[0] === baseDomain) siblingDomains.add(d);
        });
        siblingDomains.forEach(d => parts.push(`from:@${d} OR to:@${d}`));

        // Bootstrap: when few contacts known, also search by company name to discover
        // threads that may reveal additional team members / alternate domains
        const isBootstrap = (knownContactEmails || []).filter(e => {
          const d = (e.split('@')[1] || '').toLowerCase();
          return d === domain || d.split('.')[0] === baseDomain;
        }).length < 3;
        if (isBootstrap && companyName && companyName.length > 3) {
          // Search for company name but exclude bulk senders
          parts.push(`"${companyName}" -from:linkedin.com -from:noreply -from:notifications`);
        }
        const query = parts.join(' OR ');
        const fetchMessages = async (q) => {
          const res = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=100`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.status === 401) throw Object.assign(new Error('token_expired'), { code: 401 });
          const data = await res.json();
          return data.messages || [];
        };
        const fetchEmail = async (msgId) => {
          const r = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!r.ok) return null;
          const d = await r.json();
          const h = d.payload?.headers || [];
          const get = n => h.find(x => x.name === n)?.value || '';
          const body = extractEmailBody(d.payload);
          return { id: msgId, from: get('From'), to: get('To'), cc: get('Cc'), subject: get('Subject'), date: get('Date'), snippet: d.snippet || '', body, threadId: d.threadId };
        };

        let msgList = await fetchMessages(query);
        let allEmails = (await Promise.all(msgList.slice(0, 100).map(m => fetchEmail(m.id)))).filter(Boolean);

        // Second pass: scan results for sibling domains not yet in the query
        // (e.g. ben@productgenius.io found via bootstrap reveals .io for ryan@productgenius.io)
        if (baseDomain) {
          const seenIds = new Set(allEmails.map(e => e.id));
          const newSiblings = new Set();
          allEmails.forEach(e => {
            [e.from, e.to, e.cc].forEach(field => {
              if (!field) return;
              field.split(/,\s*/).forEach(addr => {
                const m = addr.match(/<([^>]+)>/) || [null, addr.trim()];
                const emailAddr = (m[1] || '').toLowerCase();
                const d = (emailAddr.split('@')[1] || '');
                if (d && d !== domain && d.split('.')[0] === baseDomain && !siblingDomains.has(d)) {
                  newSiblings.add(d);
                }
              });
            });
          });
          if (newSiblings.size > 0) {
            const secondQuery = [...newSiblings].map(d => `from:@${d} OR to:@${d}`).join(' OR ');
            const secondMsgs = await fetchMessages(secondQuery);
            const newMsgs = secondMsgs.filter(m => !seenIds.has(m.id)).slice(0, 100);
            const secondEmails = (await Promise.all(newMsgs.map(m => fetchEmail(m.id)))).filter(Boolean);
            allEmails = allEmails.concat(secondEmails);
          }
        }

        // Filter out bulk/notification senders that aren't real company correspondence
        const BULK_SENDERS = /noreply|no-reply|notifications?@|mailer-daemon|postmaster|digest@|newsletter|updates?@|marketing@|news@|hello@linkedin|member@linkedin|invitations@linkedin|jobs-listings@linkedin|messages-noreply@linkedin/i;
        allEmails = allEmails.filter(e => {
          const fromAddr = (e.from || '').toLowerCase();
          // Skip known bulk senders
          if (BULK_SENDERS.test(fromAddr)) return false;
          // Skip LinkedIn notification emails (from: "LinkedIn <xxx@linkedin.com>") unless subject contains exact company name
          if (fromAddr.includes('linkedin.com') && companyName) {
            const subjectLower = (e.subject || '').toLowerCase();
            const companyLower = companyName.toLowerCase();
            if (!subjectLower.includes(companyLower)) return false;
          }
          return true;
        });

        // Get user's own email for contact deduplication
        let userEmail = null;
        try {
          const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
          const profile = await profileRes.json();
          userEmail = profile.emailAddress?.toLowerCase() || null;
          if (userEmail) chrome.storage.local.set({ gmailUserEmail: userEmail });
        } catch(e) {}

        // Extract contacts from email headers
        const extractedContacts = [];
        const seenEmails = new Set();
        for (const thread of allEmails) {
          // Parse From field
          const fromParts = parseEmailContact(thread.from);
          if (fromParts && !seenEmails.has(fromParts.email.toLowerCase())) {
            seenEmails.add(fromParts.email.toLowerCase());
            extractedContacts.push({ ...fromParts, source: 'email' });
          }
          // Parse individual messages if available
          if (thread.messages) {
            for (const msg of thread.messages) {
              const msgFrom = parseEmailContact(msg.from);
              if (msgFrom && !seenEmails.has(msgFrom.email.toLowerCase())) {
                seenEmails.add(msgFrom.email.toLowerCase());
                extractedContacts.push({ ...msgFrom, source: 'email' });
              }
            }
          }
        }

        resolve({ emails: allEmails, userEmail, extractedContacts });
      } catch (err) {
        if (err.code === 401) {
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          chrome.storage.local.remove('gmailConnected');
          resolve({ emails: [], error: 'token_expired' });
        } else {
          resolve({ emails: [], error: err.message });
        }
      }
    });
  });
}

// ── Chat ────────────────────────────────────────────────────────────────────

// ── Unified Coop Chat Handler ─────────────────────────────────────────────

async function buildCoopProfileContext() {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const profileKeys = ['profileLinks', 'profileStory', 'profileExperience', 'profilePrinciples',
    'profileMotivators', 'profileVoice', 'profileFAQ', 'profileGreenLights', 'profileRedLights',
    'profileResume', 'profileSkills', 'storyTime',
    'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags',
    'profileRoleICP', 'profileCompanyICP', 'profileInterviewLearnings'];
  const profileData = await new Promise(r => chrome.storage.local.get(profileKeys, r));
  const parts = [];

  // Personal Info
  const links = profileData.profileLinks || {};
  const linkParts = [];
  if (links.linkedin || prefs.linkedinUrl) linkParts.push(`LinkedIn: ${links.linkedin || prefs.linkedinUrl}`);
  if (links.github)  linkParts.push(`GitHub: ${links.github}`);
  if (links.website) linkParts.push(`Website: ${links.website}`);
  if (links.email)   linkParts.push(`Email: ${links.email}`);
  if (links.phone)   linkParts.push(`Phone: ${links.phone}`);
  if (linkParts.length) parts.push(`\n[Personal Info]\n${linkParts.join('\n')}`);

  // Story
  const story = profileData.profileStory || (profileData.storyTime?.profileSummary || profileData.storyTime?.rawInput || '');
  if (story) parts.push(`\n[Your Story]\n${story.slice(0, 8000)}`);

  // Career OS text buckets
  if (profileData.profileExperience) parts.push(`\n[Experience & Accomplishments]\n${profileData.profileExperience.slice(0, 4000)}`);
  if (profileData.profilePrinciples) parts.push(`\n[Operating Principles]\n${profileData.profilePrinciples.slice(0, 2000)}`);
  if (profileData.profileMotivators) parts.push(`\n[What Drives You]\n${profileData.profileMotivators.slice(0, 2000)}`);
  if (profileData.profileVoice)      parts.push(`\n[Voice & Style]\n${profileData.profileVoice.slice(0, 2000)}`);
  if (profileData.profileFAQ)        parts.push(`\n[FAQ / Polished Responses]\n${profileData.profileFAQ.slice(0, 3000)}`);

  // Resume
  const resume = profileData.profileResume?.content || prefs.resumeText;
  if (resume) parts.push(`\n[Resume]\n${resume.slice(0, 3000)}`);

  // Structured: Attracted To / Dealbreakers (with legacy fallback)
  const attractedTo = profileData.profileAttractedTo || [];
  const dealbreakers = profileData.profileDealbreakers || [];
  if (attractedTo.length) {
    parts.push(`\n[Attracted To (structured)]\n${attractedTo.map(e =>
      `- [${e.category}] ${e.text}${e.keywords?.length ? ` {keywords: ${e.keywords.join(', ')}}` : ''}`
    ).join('\n')}`);
  } else {
    const greenLights = profileData.profileGreenLights || [prefs.roles, prefs.roleLoved, prefs.interests].filter(Boolean).join('\n');
    if (greenLights) parts.push(`\n[Green Lights]\n${greenLights.slice(0, 2000)}`);
  }
  if (dealbreakers.length) {
    parts.push(`\n[Dealbreakers (structured)]\n${dealbreakers.map(e =>
      `- [${e.category}/${e.severity}] ${e.text}${e.keywords?.length ? ` {keywords: ${e.keywords.join(', ')}}` : ''}`
    ).join('\n')}`);
  } else {
    const redLights = profileData.profileRedLights || [prefs.avoid, prefs.roleHated].filter(Boolean).join('\n');
    if (redLights) parts.push(`\n[Red Lights]\n${redLights.slice(0, 2000)}`);
  }

  // Role ICP
  const roleICP = profileData.profileRoleICP || {};
  if (roleICP.text || roleICP.targetFunction) {
    const attrs = [roleICP.targetFunction, roleICP.seniority, roleICP.scope, roleICP.sellingMotion, roleICP.teamSizePreference].filter(Boolean);
    parts.push(`\n[Role ICP]\n${roleICP.text || ''}${attrs.length ? '\nAttributes: ' + attrs.join(' | ') : ''}`);
  }

  // Company ICP
  const companyICP = profileData.profileCompanyICP || {};
  if (companyICP.text || companyICP.stage) {
    const attrs = [companyICP.stage, companyICP.sizeRange, (companyICP.industryPreferences || []).join(', '), (companyICP.cultureMarkers || []).join(', ')].filter(Boolean);
    parts.push(`\n[Company ICP]\n${companyICP.text || ''}${attrs.length ? '\nAttributes: ' + attrs.join(' | ') : ''}`);
  }

  // Skills + tags
  const skills = profileData.profileSkills || prefs.jobMatchBackground;
  const skillTags = profileData.profileSkillTags || [];
  if (skills || skillTags.length) {
    let skillSection = skills || '';
    if (skillTags.length) skillSection += `\nSkill tags: ${skillTags.join(', ')}`;
    parts.push(`\n[Skills & Intangibles]\n${skillSection}`);
  }

  // Interview learnings
  const learnings = profileData.profileInterviewLearnings || [];
  if (learnings.length) {
    parts.push(`\n[Interview Learnings]\n${learnings.slice(-10).map(l =>
      `- ${l.text}${l.source ? ` (${l.source})` : ''}${l.date ? ` [${l.date}]` : ''}`
    ).join('\n')}`);
  }

  // Location & logistics
  const locParts = [];
  if (prefs.userLocation) locParts.push(`Location: ${prefs.userLocation}`);
  const wa = (prefs.workArrangement || []).join(', ');
  if (wa) locParts.push(`Work arrangement: ${wa}`);
  if (prefs.maxTravel) locParts.push(`Max travel: ${prefs.maxTravel}`);
  if (locParts.length) parts.push(`\n[Location]\n${locParts.join('\n')}`);

  // Compensation
  const compParts = [];
  if (prefs.salaryFloor)  compParts.push(`Base salary floor (walk away below): $${prefs.salaryFloor}`);
  if (prefs.salaryStrong) compParts.push(`Base salary strong offer (exciting above): $${prefs.salaryStrong}`);
  if (prefs.oteFloor)     compParts.push(`OTE floor (walk away below): $${prefs.oteFloor}`);
  if (prefs.oteStrong)    compParts.push(`OTE strong offer (exciting above): $${prefs.oteStrong}`);
  if (compParts.length) parts.push(`\n[Compensation]\n${compParts.join('\n')}`);

  // AI-learned insights
  const storyTime = profileData.storyTime;
  if (storyTime?.learnedInsights?.length) {
    const normalized = storyTime.learnedInsights.map(i => typeof i === 'string' ? { insight: i, category: 'general', priority: 'normal' } : i);
    const highPriority = normalized.filter(i => i.priority === 'high');
    const styleInstructions = normalized.filter(i => i.category === 'style_instruction');
    const normalInsights = normalized.filter(i => i.priority !== 'high' && i.category !== 'style_instruction');
    if (styleInstructions.length) parts.push(`\n=== STYLE INSTRUCTIONS (from past corrections) ===\n${styleInstructions.map(i => `- ${i.insight}`).join('\n')}`);
    const injected = [...highPriority, ...normalInsights.slice(-15)];
    if (injected.length) parts.push(`\n[AI-Learned Insights]\n${injected.map(i => `- ${i.insight}`).join('\n')}`);
    if (storyTime?.answerPatterns?.length) {
      parts.push(`\n=== ANSWER PATTERNS (approaches that worked well) ===\n${storyTime.answerPatterns.slice(-10).map(p => `[${p.date}] ${p.context || ''}\n${p.text}`).join('\n\n')}\n\nUse these as templates — adapt specifics to the current company.`);
    }
  }

  return parts.join('\n');
}

async function buildCoopPipelineSummary() {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entries = savedCompanies || [];
  if (!entries.length) return { summary: '', entries };
  const lines = entries.map(e => {
    const parts = [e.company];
    if (e.jobStage) parts.push(`Stage: ${e.jobStage}`);
    else if (e.status) parts.push(`Status: ${e.status}`);
    if (e.jobTitle) parts.push(`Role: ${e.jobTitle}`);
    if (e.jobMatch?.score) parts.push(`Score: ${e.jobMatch.score}/10`);
    if (e.rating) parts.push(`Excitement: ${e.rating}/5`);
    if (e.knownContacts?.length) parts.push(`Contacts: ${e.knownContacts.slice(0,3).map(c=>c.name).join(', ')}`);
    if (e.notes) parts.push(`Notes: ${e.notes.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,80)}`);
    if (e.tags?.length) parts.push(`Tags: ${e.tags.join(', ')}`);
    return `- ${parts.join(' | ')}`;
  }).join('\n');
  return { summary: `\n=== YOUR FULL PIPELINE (${entries.length} entries) ===\n${lines}`, entries };
}

// ── Content-Aware Context: Intent Detection + Cross-Company Aggregation ─────

function truncateToTokenBudget(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastPara = truncated.lastIndexOf('\n\n');
  if (lastPara > maxChars * 0.7) return truncated.slice(0, lastPara) + '\n\n[...truncated]';
  const lastNl = truncated.lastIndexOf('\n');
  if (lastNl > maxChars * 0.8) return truncated.slice(0, lastNl) + '\n[...truncated]';
  return truncated + '\n[...truncated]';
}

function detectContextIntent(message, entries) {
  const lower = message.toLowerCase();
  const modules = new Set();
  const mentionedCompanies = [];

  // Detect mentioned companies by name
  for (const e of entries) {
    if (e.company && e.company.length > 2 && lower.includes(e.company.toLowerCase())) {
      mentionedCompanies.push(e.id);
    }
  }

  const INTENT_MAP = [
    { patterns: [/\b(?:meeting|conversation|call|interview|spoke|talked|discussed|met with|best conversation|worst conversation)\b/i], module: 'meetings' },
    { patterns: [/\b(?:email|emails|messaged|correspondence|thread|inbox|sent|replied|follow.?up)\b/i], module: 'emails' },
    { patterns: [/\b(?:contact|contacts|people|who do i know|connections|network|who have i)\b/i], module: 'contacts' },
    { patterns: [/\b(?:compare|rank|prioritize|all (?:my |the )?(?:companies|opportunities|roles))\b/i], module: 'pipeline_full' },
    { patterns: [/\b(?:strategy|next steps|game plan|what should i|where should i focus)\b/i], module: 'meetings,pipeline_full' },
    { patterns: [/\b(?:draft|write|compose)\b/i], module: 'emails,contacts' },
    { patterns: [/\b(?:best|worst|recent|latest|strongest|weakest)\b.*\b(?:conversation|meeting|email|interaction|interview|call)\b/i], module: 'meetings,emails' },
  ];

  for (const { patterns, module } of INTENT_MAP) {
    if (patterns.some(p => p.test(lower))) {
      module.split(',').forEach(m => modules.add(m.trim()));
    }
  }

  const needsCrossCompany = modules.has('meetings') || modules.has('emails') || modules.has('contacts');
  return { modules, mentionedCompanies, needsCrossCompany };
}

function buildCrossCompanyMeetings(entries, opts = {}) {
  const { totalBudget = 8000, mentionedCompanies = [] } = opts;
  const filtered = mentionedCompanies.length
    ? entries.filter(e => mentionedCompanies.includes(e.id))
    : entries;

  const allMeetings = [];
  for (const e of filtered) {
    const meetings = e.cachedMeetings || [];
    for (const m of meetings) {
      allMeetings.push({
        company: e.company,
        title: m.title || 'Untitled',
        date: m.date || '',
        time: m.time || '',
        summary: m.summaryMarkdown || '',
        transcript: (m.transcript || '').slice(0, 800),
        _ts: m.date ? new Date(m.date + 'T12:00:00').getTime() : 0,
      });
    }
    // Also include manual meetings
    if (e.manualMeetings?.length) {
      for (const m of e.manualMeetings) {
        allMeetings.push({
          company: e.company,
          title: m.title || 'Manual meeting',
          date: m.date || '',
          time: m.time || '',
          summary: '',
          transcript: (m.transcript || m.notes || '').slice(0, 800),
          _ts: m.date ? new Date(m.date + 'T12:00:00').getTime() : 0,
        });
      }
    }
  }

  if (!allMeetings.length) return '';
  allMeetings.sort((a, b) => b._ts - a._ts);

  let text = `\n=== MEETINGS ACROSS PIPELINE (${allMeetings.length} meetings) ===\n`;
  for (const m of allMeetings) {
    const entry = `--- ${m.company}: ${m.title} | ${m.date}${m.time ? ' ' + m.time : ''} ---\n`;
    const body = m.summary ? `Summary: ${m.summary}\n` : '';
    const trans = m.transcript ? `Transcript: ${m.transcript}\n` : '';
    text += entry + body + trans + '\n';
    if (text.length > totalBudget) break;
  }
  return truncateToTokenBudget(text, totalBudget);
}

function buildCrossCompanyEmails(entries, opts = {}) {
  const { totalBudget = 4000, mentionedCompanies = [] } = opts;
  const filtered = mentionedCompanies.length
    ? entries.filter(e => mentionedCompanies.includes(e.id))
    : entries;

  const allEmails = [];
  for (const e of filtered) {
    for (const em of (e.cachedEmails || []).slice(0, 15)) {
      allEmails.push({
        company: e.company,
        from: (em.from || '').replace(/<[^>]+>/, '').trim(),
        subject: em.subject || '',
        date: em.date || '',
        snippet: (em.snippet || '').slice(0, 150),
        _ts: em.date ? new Date(em.date).getTime() : 0,
      });
    }
  }

  if (!allEmails.length) return '';
  allEmails.sort((a, b) => b._ts - a._ts);

  let text = `\n=== EMAILS ACROSS PIPELINE (${allEmails.length} emails) ===\n`;
  for (const em of allEmails.slice(0, 50)) {
    text += `[${em.date}] ${em.company} — "${em.subject}" from ${em.from}\n  ${em.snippet}\n`;
    if (text.length > totalBudget) break;
  }
  return truncateToTokenBudget(text, totalBudget);
}

function buildCrossCompanyContacts(entries, opts = {}) {
  const { totalBudget = 3000, mentionedCompanies = [] } = opts;
  const filtered = mentionedCompanies.length
    ? entries.filter(e => mentionedCompanies.includes(e.id))
    : entries;

  const lines = [];
  for (const e of filtered) {
    if (!e.knownContacts?.length) continue;
    const contacts = e.knownContacts.slice(0, 5).map(c => {
      const parts = [c.name];
      if (c.title) parts.push(c.title);
      if (c.email) parts.push(`<${c.email}>`);
      return parts.join(' | ');
    }).join('; ');
    lines.push(`${e.company}: ${contacts}`);
  }

  if (!lines.length) return '';
  const text = `\n=== CONTACTS ACROSS PIPELINE ===\n${lines.join('\n')}`;
  return truncateToTokenBudget(text, totalBudget);
}

async function handleCoopMessage({ messages, context, globalChat, pipeline, enrichments, chatModel, careerOSChat }) {
  context = context || {};
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const daysAgo = dateStr => {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return null;
    return Math.round((today - d) / 86400000);
  };
  const relTime = dateStr => {
    const n = daysAgo(dateStr);
    if (n === null) return '';
    if (n === 0) return ' (today)';
    if (n === 1) return ' (yesterday)';
    if (n < 7)  return ` (${n} days ago)`;
    if (n < 30) return ` (${Math.round(n/7)} weeks ago)`;
    return ` (${Math.round(n/30)} months ago)`;
  };

  // Layer 1: Coop identity (driven by coopConfig presets + custom instructions)
  const identityPrompt = buildIdentityPrompt(coopConfig, {
    globalChat,
    contextType: context.type === 'job' ? 'job opportunity' : 'company',
  });

  const systemParts = [identityPrompt, `\n=== TODAY ===\n${todayStr}`,
    `\nCRITICAL RULE: You have the user's FULL Career OS profile loaded in your context — their story, experience, accomplishments, skills, resume, preferences, and everything they've told you. ALWAYS use this data first. When helping with applications, DRAFT an answer from what you already know, then ask only for specific missing details. NEVER ask the user to provide information that's already in your context. If they ask you to write something about their background, write it immediately using what you have.`];

  // Layer 2: Application helper mode (if active, and not disabled by user)
  if (context._applicationMode && coopConfig.automations?.applicationModeDetection !== false) {
    systemParts.push(`\n=== APPLICATION HELPER MODE ===\nSITUATION: The user is filling out a job application form. They need short, authentic answers for application text box fields — not cover letters, not essays, not LinkedIn posts.\n\nVOICE & TONE:\n- Write as the user in first person. Conversational, confident, specific.\n- Sound like a smart person talking, not an AI writing.\n- No dramatic framing, no buzzword stacking, no filler.\n- NEVER wrap the answer in quotation marks.\n\nLENGTH: 2-5 sentences unless the user specifies otherwise.\n\nOUTPUT FORMAT:\n- Give ONE clean answer the user can copy-paste directly.\n- No preamble, no alternatives unless asked, no commentary after.\n- NEVER wrap in quotation marks.\n\nWhen the user first enters this mode, respond: "Paste the application question and I'll write your answer."`);
  }

  // Layer 2b: Career OS editor mode
  if (careerOSChat) {
    systemParts.push(`\n=== CAREER OS EDITOR MODE ===
You are on the Career OS preferences page. The user can ask you to view, add, or update their structured profile.

You have full visibility into their structured profile fields:
- Attracted To: structured entries with text, category, severity, and keyword triggers
- Dealbreakers: structured entries with text, category, severity (hard/soft), and keyword triggers
- Skill Tags: array of searchable skill labels
- Role ICP: target function, seniority, scope, selling motion, team size preference
- Company ICP: stage, size range, industry preferences, culture markers
- Interview Learnings: text + source company + date

When the user asks to ADD or UPDATE profile data, respond with your explanation AND a code fence containing the structured update:

\`\`\`career-os-update
{"action":"add","target":"dealbreakers","data":{"text":"Companies that glorify grit culture","category":"culture","severity":"hard","keywords":["grit","hustle","grind"]}}
\`\`\`

Valid targets: attractedTo, dealbreakers, skillTags, roleICP, companyICP, learnings
Valid actions: add

For skillTags, data is a string array: {"action":"add","target":"skillTags","data":["Salesforce","HubSpot"]}
For ICP updates, data is a partial object to merge: {"action":"add","target":"roleICP","data":{"seniority":"VP","targetFunction":"GTM"}}

When asked "what are my dealbreakers?" or similar, read back the structured data clearly.
Always suggest relevant keywords when adding entries — keywords enable deterministic matching during job scoring.

You can also change system settings when asked. Use a \`\`\`settings-update code fence:

\`\`\`settings-update
{"action":"update","setting":"chatModel","value":"claude-haiku-4-5-20251001","label":"Claude Haiku"}
\`\`\`

Valid settings:
- chatModel: the default model for Coop chat (e.g. "gpt-4.1-mini", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250514")
- scoringModel: model used for job scoring
- researchModel: model used for company research

When the user asks to switch models, change defaults, or adjust settings, respond with the settings-update block AND a brief confirmation of what will change and the cost impact.`);
  }

  // Layer 3: Profile context (always — same for company + global)
  const profileContext = await buildCoopProfileContext();
  if (profileContext) {
    systemParts.push(profileContext);
  } else {
    console.warn('[Coop Chat] WARNING: Profile context is empty — user data may not be loaded');
  }

  // Layer 4: Pipeline summary (ALWAYS — this is the key unification)
  let pipelineEntries = [];
  if (pipeline) {
    systemParts.push(pipeline);
  } else {
    const pipelineResult = await buildCoopPipelineSummary();
    if (pipelineResult.summary) systemParts.push(pipelineResult.summary);
    pipelineEntries = pipelineResult.entries || [];
  }

  // Intent detection for cross-company context (global/careerOS chats only)
  const lastUserMsg_intent = messages[messages.length - 1]?.content || '';
  const contextIntent = (globalChat || careerOSChat) && pipelineEntries.length
    ? detectContextIntent(lastUserMsg_intent, pipelineEntries)
    : { modules: new Set(), mentionedCompanies: [], needsCrossCompany: false };

  // Layer 5: Deep company context (when on a company page)
  if (!globalChat && context.company) {
    const overview = [`\n=== CURRENT COMPANY / OPPORTUNITY ===`];
    if (context.company)   overview.push(`Company: ${context.company}`);
    if (context.jobTitle)  overview.push(`Role: ${context.jobTitle}`);
    if (context.status)    overview.push(`Pipeline stage: ${context.status}`);
    if (context.employees) overview.push(`Size: ${context.employees}`);
    if (context.funding)   overview.push(`Funding: ${context.funding}`);
    if (context.tags?.length) overview.push(`Tags: ${context.tags.join(', ')}`);
    if (context.notesFeed?.length) {
      const noteLines = context.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => {
        const d = new Date(n.createdAt);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const text = (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return `[${dateStr}] ${text}`;
      }).join('\n');
      overview.push(`User notes:\n${noteLines}`);
    } else if (context.notes) {
      overview.push(`User notes: ${(context.notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    }
    systemParts.push(overview.join('\n'));

    if (context.intelligence?.eli5 || context.intelligence?.whosBuyingIt || context.intelligence?.howItWorks) {
      const intel = [`\n=== COMPANY INTELLIGENCE ===`];
      if (context.intelligence.eli5)         intel.push(`What they do: ${context.intelligence.eli5}`);
      if (context.intelligence.whosBuyingIt) intel.push(`Who buys it: ${context.intelligence.whosBuyingIt}`);
      if (context.intelligence.howItWorks)   intel.push(`How it works: ${context.intelligence.howItWorks}`);
      systemParts.push(intel.join('\n'));
    }
    if (context.leaders?.length) systemParts.push(`\n=== LEADERSHIP ===\n${context.leaders.map(l => `- ${l.name} — ${l.title || 'unknown'}`).join('\n')}`);
    if (context.knownContacts?.length) {
      systemParts.push(`\n=== KNOWN CONTACTS AT ${(context.company || '').toUpperCase()} ===\n${context.knownContacts.map(c => `- ${[c.name, c.title, c.email ? `<${c.email}>` : ''].filter(Boolean).join(' | ')}`).join('\n')}`);
    }
    if (context.roleBrief) systemParts.push(`\n=== ROLE BRIEF (AI-synthesized understanding) ===\n${context.roleBrief.slice(0, 4000)}`);
    if (context.jobDescription || context.jobMatch) {
      const job = [`\n=== JOB DETAILS ===`];
      if (context.jobDescription) job.push(`Full job description:\n${context.jobDescription.slice(0, 5000)}`);
      if (context.jobMatch?.verdict)           job.push(`Match verdict: ${context.jobMatch.verdict}`);
      if (context.jobMatch?.score)             job.push(`Match score: ${context.jobMatch.score}/10`);
      if (context.jobMatch?.strongFits?.length) job.push(`Strong fits: ${context.jobMatch.strongFits.join('; ')}`);
      if (context.jobMatch?.redFlags?.length)   job.push(`Red flags: ${context.jobMatch.redFlags.join('; ')}`);
      if (context.matchFeedback) {
        const fb = context.matchFeedback;
        job.push(`User feedback on match: ${fb.type === 'up' ? '👍 Agreed' : '👎 Disagreed'}${fb.note ? ` — "${fb.note}"` : ''}`);
      }
      systemParts.push(job.join('\n'));
    }
    if (context.reviews?.length) systemParts.push(`\n=== EMPLOYEE REVIEWS ===\n${context.reviews.slice(0, 4).map(r => `- "${r.snippet}" (${r.source || ''})`).join('\n')}`);
    if (context.emails?.length) {
      const emailLines = context.emails.slice(0, 20).map(e => {
        const lines = [`[${e.date || ''}] "${e.subject}" — ${e.from}`];
        if (e.snippet) lines.push(`  ${e.snippet.slice(0, 200)}`);
        return lines.join('\n');
      }).join('\n');
      systemParts.push(`\n=== EMAIL HISTORY (${context.emails.length} emails) ===\n${emailLines}`);
    }
    if (context.meetings?.length) {
      const mtgLines = context.meetings.map(m => {
        const rel = relTime(m.date);
        const header = `--- Meeting: ${m.title || 'Untitled'} | ${m.date || 'unknown date'}${rel}${m.time ? ' at ' + m.time : ''} ---`;
        let body = '';
        if (m.summaryMarkdown) body += `-- Granola AI Summary --\n${m.summaryMarkdown}\n\n`;
        // Replace microphone/speaker labels with names
        let transcript = (m.transcript || '');
        const attendeeNames = (m.attendeeNames || m.attendees || '').toString();
        if (attendeeNames) {
          const others = attendeeNames.split(/[,;]/).map(n => n.trim()).filter(n => n && !n.toLowerCase().includes('matt'));
          const otherName = others.length === 1 ? others[0].split(' ')[0] : others.length > 1 ? others.map(n => n.split(' ')[0]).join('/') : 'Other';
          transcript = transcript.replace(/\bmicrophone:/g, 'Matt:').replace(/\bspeaker:/g, otherName + ':');
        } else {
          transcript = transcript.replace(/\bmicrophone:/g, 'Matt:').replace(/\bspeaker:/g, 'Other:');
        }
        body += transcript.slice(0, 4000);
        return `${header}\n${body}`;
      }).join('\n\n');
      systemParts.push(`\n=== MEETING TRANSCRIPTS (${context.meetings.length} meetings) ===\n${mtgLines}`);
    } else if (context.granolaNote) {
      systemParts.push(`\n=== MEETING NOTES / TRANSCRIPTS ===\n${context.granolaNote.slice(0, 12000)}`);
    }
    if (context.manualMeetings?.length) {
      const manualLines = context.manualMeetings.map(m => {
        const rel = relTime(m.date);
        return `--- Meeting (manual): ${m.title || 'Untitled'} | ${m.date || 'unknown'}${rel} ---\n${(m.transcript || m.notes || '(no notes)').slice(0, 4000)}`;
      }).join('\n\n');
      systemParts.push(`\n=== MANUALLY LOGGED MEETINGS (${context.manualMeetings.length}) ===\n${manualLines}`);
    }
    if (context.contextDocuments?.length) {
      let used = 0;
      const docParts = [];
      for (const doc of context.contextDocuments) {
        const tokens = doc.tokenEstimate || Math.ceil(doc.extractedText.length / 4);
        if (used + tokens > 4000) { docParts.push(`\n## Uploaded: ${doc.filename} (truncated)\n${doc.extractedText.slice(0, (4000 - used) * 4)}`); break; }
        docParts.push(`\n## Uploaded: ${doc.filename}\n${doc.extractedText}`);
        used += tokens;
      }
      systemParts.push(`\n=== UPLOADED DOCUMENTS ===\n${docParts.join('\n')}`);
    }
  }

  // Layer 5b: Content-aware cross-company context (global/careerOS chats)
  if (contextIntent.needsCrossCompany && pipelineEntries.length) {
    console.log(`[Coop] Intent detected modules: ${[...contextIntent.modules].join(', ')} | mentioned: ${contextIntent.mentionedCompanies.length} companies`);
    if (contextIntent.modules.has('meetings')) {
      const mtgCtx = buildCrossCompanyMeetings(pipelineEntries, { mentionedCompanies: contextIntent.mentionedCompanies });
      if (mtgCtx) systemParts.push(mtgCtx);
    }
    if (contextIntent.modules.has('emails')) {
      const emailCtx = buildCrossCompanyEmails(pipelineEntries, { mentionedCompanies: contextIntent.mentionedCompanies });
      if (emailCtx) systemParts.push(emailCtx);
    }
    if (contextIntent.modules.has('contacts')) {
      const contactCtx = buildCrossCompanyContacts(pipelineEntries, { mentionedCompanies: contextIntent.mentionedCompanies });
      if (contactCtx) systemParts.push(contactCtx);
    }
  }

  // Layer 6: Entry update proposals (company context only)
  if (!globalChat && !careerOSChat && context.company) {
    systemParts.push(`\n=== ENTRY UPDATE PROPOSALS ===
When the user asks you to update, change, or fix data about this company/opportunity, respond with your explanation AND a code fence containing the update:

\`\`\`entry-update
{"field":"status","value":"interviewing","label":"Move to Interviewing"}
\`\`\`

You can propose multiple updates in one response — use a separate code fence for each.

Valid fields and example values:
- status: "watching", "applied", "interviewing", "offer", "rejected", "passed", "closed"
- jobTitle: any string (the role title)
- jobStage: "interested", "applied", "phone-screen", "interview", "final-round", "offer", "rejected"
- rating: 1-5 (integer)
- tags: ["tag1", "tag2"] (replaces all tags)
- addTags: ["new-tag"] (appends without removing existing)
- removeTags: ["old-tag"] (removes specific tags)
- notes: "text to append" (appends to existing notes, does NOT replace)
- companyWebsite: URL string
- companyLinkedin: URL string

Always include a "label" field with a short human-readable description of the change.
Only propose changes when the user explicitly asks. Don't proactively suggest updates unless something is clearly wrong or missing.`);
  }

  // Layer 7: Task creation (always available)
  systemParts.push(`\n=== TASK CREATION ===
When the user asks you to create a task, reminder, or to-do, respond with your confirmation AND a code fence:

\`\`\`create-task
{"text":"Follow up with Sarah about the interview","company":"Amagi","dueDate":"2026-04-05","priority":"normal","label":"Task: Follow up with Sarah"}
\`\`\`

Fields:
- text (required): what needs to be done
- company (optional): company name if task is related to one
- dueDate (optional): YYYY-MM-DD format. If the user says "tomorrow", calculate the date. If not specified, use today.
- priority (optional): "low", "normal" (default), or "high"
- label (required): short human-readable description for the proposal card

You can create multiple tasks in one response with separate code fences.
When the user says things like "remind me to", "don't forget to", "I need to", "add a task", "todo" — create a task.`);

  // Layer 8: On-demand enrichments for mentioned companies (global chat)
  if (enrichments) systemParts.push(enrichments);

  // Send to AI
  const lastUserMsg = messages[messages.length - 1]?.content || '';
  const hasTrigger = /remember this|remember that|don't forget|from now on|always\s+(?:lead|start|use|mention|include)|never\s+(?:say|mention|use|include)|update my profile|add this to/i.test(lastUserMsg);

  // ── Smart context routing: use only the tokens needed ──────────────────────
  const lowerMsg = lastUserMsg.toLowerCase().trim();
  const userMsgCount = messages.filter(m => m.role === 'user').length;
  const isFirstMessage = userMsgCount === 1;
  const fullSystemText = systemParts.join('\n');
  const fullSize = fullSystemText.length;

  // Tier 1: Simple data entry — Nano + minimal context (~500 chars)
  const SIMPLE_CAREER_OS = [
    /^(?:add|create|new)\s+(?:a\s+)?(?:dealbreaker|attracted|skill|tag|learning)/i,
    /^(?:add|remove)\s+tag/i,
    /^(?:switch|change|use|set)\s+(?:to\s+)?(?:model|haiku|sonnet|opus|gpt|nano|mini)/i,
    /^(?:add|append)\s+(?:a\s+)?note/i,
  ];
  const SIMPLE_ENTRY_UPDATE = [
    /^(?:set|change|update|move)\s+(?:status|stage|rating)\s/i,
    /^(?:add|remove)\s+tag/i,
    /^(?:mark|move)\s+(?:as|to)\s+(?:watching|applied|interviewing|offer|rejected|passed|closed)/i,
    /^(?:rate|rating)\s+\d/i,
  ];
  const isSimpleCareerOS = careerOSChat && SIMPLE_CAREER_OS.some(p => p.test(lowerMsg));
  const isSimpleEntry = !globalChat && !careerOSChat && context.company && SIMPLE_ENTRY_UPDATE.some(p => p.test(lowerMsg));

  // ── Screenshot: read from in-memory variable (sent via port) or context fallback ────
  let hasImages = false;
  const screenshotFlag = context._hasScreenshot || context.hasScreenshot;
  // Use port data if available, otherwise fall back to inline context data
  const screenshotData = _pendingScreenshot || context._screenshotData || null;
  dlog(`[Screenshot] Flag check: ${screenshotFlag}, port: ${_pendingScreenshot ? Math.round(_pendingScreenshot.length/1024)+'KB' : 'null'}, context: ${context._screenshotData ? Math.round(context._screenshotData.length/1024)+'KB' : 'null'}`);
  if (screenshotFlag && screenshotData) {
    const screenshot = screenshotData;
    _pendingScreenshot = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const textContent = typeof messages[i].content === 'string' ? messages[i].content : String(messages[i].content);
        messages[i] = {
          role: 'user',
          content: [
            { type: 'text', text: textContent },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } }
          ]
        };
        hasImages = true;
        dlog(`[Screenshot] ✅ Injected ${Math.round(screenshot.length / 1024)}KB into message #${i}`);
        break;
      }
    }
  } else if (screenshotFlag && !screenshotData) {
    dlog(`[Screenshot] ❌ Flag set but no screenshot data — port and context fallback both empty`);
  }
  if (hasImages) {
    const visionModels = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'];
    if (!visionModels.some(v => (chatModel || '').includes(v.split('-')[0]))) {
      chatModel = ANTHROPIC_KEY ? 'claude-haiku-4-5-20251001' : 'gpt-4.1-mini';
    }
    console.log(`[Coop] Using vision model: ${chatModel}`);
  }

  // ── Screen sharing context: vision + page text (must be before tier routing) ──
  if (hasImages) {
    systemParts.push(`\n=== SCREEN SHARING (VISION ACTIVE) ===\nMatt is sharing his screen with you. A screenshot of his current browser tab is attached to his latest message as an image. You CAN see it — describe what you see, answer questions about it, and use the visual context to help him. This is a real screenshot, not a placeholder.`);
  }
  if (context.visiblePageContent) {
    systemParts.push(`\n=== PAGE TEXT FROM USER'S ACTIVE TAB (extracted automatically — you CAN see this) ===\nURL: ${context.currentTabUrl || 'unknown'}\nIMPORTANT: The text below was automatically extracted from the page the user is currently viewing. When the user asks about what's on their screen, refer to this text AND the screenshot (if attached).\n\n${context.visiblePageContent.slice(0, 4000)}`);
  } else if (context.currentTabUrl && (context._hasScreenshot || context.hasScreenshot)) {
    systemParts.push(`\n=== CURRENT TAB ===\nURL: ${context.currentTabUrl}\nTab sharing is active. Use the screenshot to see what's on the page.`);
  }

  if ((isSimpleCareerOS || isSimpleEntry) && !hasImages) {
    const slimParts = [systemParts[0]];
    // Always include profile — prompt caching makes this nearly free
    const profileLayer = systemParts.find(p => p.includes('[Your Story]') || p.includes('[Personal Info]') || p.includes('[Experience'));
    if (profileLayer) slimParts.push(profileLayer);
    if (isSimpleCareerOS) {
      const layer = systemParts.find(p => p.includes('CAREER OS EDITOR MODE'));
      if (layer) slimParts.push(layer);
    }
    if (isSimpleEntry) {
      const layer = systemParts.find(p => p.includes('ENTRY UPDATE PROPOSALS'));
      if (layer) slimParts.push(layer);
      slimParts.push(`Company: ${context.company}${context.jobTitle ? ' | Role: ' + context.jobTitle : ''}${context.status ? ' | Status: ' + context.status : ''}`);
    }
    const slimSystem = slimParts.join('\n');
    const slimModel = OPENAI_KEY ? 'gpt-4.1-nano' : 'claude-haiku-4-5-20251001';
    console.log(`[Coop] ROUTED → Tier 1 (slim) | ${slimModel} | ${slimSystem.length} chars (${Math.round((1 - slimSystem.length/fullSize) * 100)}% saved)`);
    try {
      const result = await chatWithFallback({ model: slimModel, system: slimSystem, messages, max_tokens: 1024, tag: 'Chat-Slim' });
      if (!result.error) return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'slim' };
    } catch (e) { console.warn('[Coop] Tier 1 failed, escalating:', e.message); }
  }

  // Tier 2: Medium context — follow-up messages OR simple company questions
  // On follow-ups, the full profile/pipeline is already in conversation history from msg 1.
  // Only resend identity + company context + proposal instructions. Skip profile & pipeline layers.
  const NEEDS_FULL_CONTEXT = [
    /compare|rank|prioritize|pipeline|all (?:my |the )?(?:companies|opportunities|roles)/i,
    /interview prep|help me prepare|mock interview/i,
    /draft|write|compose|email|message|cover letter|follow.?up/i,
    /what (?:do you|should|would you) (?:think|recommend|suggest)/i,
    /strategy|strategic|game plan|next steps for my search/i,
    /my (?:story|background|experience|resume|profile|preferences|dealbreakers)/i,
    /remember|from now on|always|never/i,
    /apply|application|help me answer|brag|accomplish|achievement|award|recognition|qualification/i,
    /do you know|tell me about|what do you know/i,
    /salesbricks|rep\.ai|navless|tourial|captivate/i,
    /\b(?:best|worst|recent|strongest)\b.*\b(?:conversation|meeting|email|call|interview)\b/i,
    /\b(?:all|across|every)\b.*\b(?:meeting|email|conversation|contact)\b/i,
    /who (?:have i|did i|am i) (?:talk|speak|met|email|contact)/i,
  ];
  const needsFullContext = NEEDS_FULL_CONTEXT.some(p => p.test(lowerMsg)) || contextIntent.needsCrossCompany;
  const isFollowUp = !isFirstMessage && !needsFullContext && !hasImages;

  // Tier 2.5: Vision-optimized — screenshot messages that don't need full context
  if (hasImages && !needsFullContext) {
    const visionParts = [systemParts[0]]; // identity
    visionParts.push(`\n=== TODAY ===\n${todayStr}`);
    const profileLayer = systemParts.find(p => p.includes('[Your Story]') || p.includes('[Personal Info]') || p.includes('[Experience'));
    if (profileLayer) visionParts.push(profileLayer);
    if (!globalChat && context.company) {
      const companyOverview = systemParts.find(p => p.includes('CURRENT COMPANY / OPPORTUNITY'));
      if (companyOverview) visionParts.push(companyOverview);
      const intelSection = systemParts.find(p => p.includes('COMPANY INTELLIGENCE'));
      if (intelSection) visionParts.push(intelSection);
      const jobSection = systemParts.find(p => p.includes('JOB DETAILS'));
      if (jobSection) visionParts.push(jobSection);
      const entryLayer = systemParts.find(p => p.includes('ENTRY UPDATE PROPOSALS'));
      if (entryLayer) visionParts.push(entryLayer);
    }
    // Include vision and page text context
    const visionSection = systemParts.find(p => p.includes('SCREEN SHARING') || p.includes('PAGE TEXT FROM'));
    if (visionSection) visionParts.push(visionSection);
    const pageTextSection = systemParts.find(p => p.includes('PAGE TEXT FROM') && p !== visionSection);
    if (pageTextSection) visionParts.push(pageTextSection);
    const tabSection = systemParts.find(p => p.includes('CURRENT TAB'));
    if (tabSection) visionParts.push(tabSection);
    const visionSystem = visionParts.join('\n');
    const visionModel = chatModel || (ANTHROPIC_KEY ? 'claude-haiku-4-5-20251001' : 'gpt-4.1-mini');
    console.log(`[Coop] ROUTED → Tier 2.5 (vision) | ${visionModel} | ${visionSystem.length} chars (${Math.round((1 - visionSystem.length/fullSize) * 100)}% saved vs full)`);
    try {
      const result = await chatWithFallback({ model: visionModel, system: visionSystem, messages, max_tokens: 2048, tag: 'Chat-Vision' });
      if (!result.error) {
        const source = globalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
        if (hasTrigger) await _doExtractInsightsFromChat(lastUserMsg, result.reply, source);
        else extractInsightsFromChat(lastUserMsg, result.reply, source);
        return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'vision' };
      }
    } catch (e) { console.warn('[Coop] Vision tier failed, escalating to full:', e.message); }
  }

  if (isFollowUp) {
    // Build medium context: identity + today + profile + company context + proposals
    const mediumParts = [systemParts[0]]; // Layer 1: identity
    mediumParts.push(`\n=== TODAY ===\n${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
    // ALWAYS include profile context — Coop must know who the user is on every message
    const profileLayer = systemParts.find(p => p.includes('[Your Story]') || p.includes('[Personal Info]') || p.includes('[Experience'));
    if (profileLayer) mediumParts.push(profileLayer);
    // Include Career OS editor or entry update instructions if applicable
    if (careerOSChat) {
      const layer = systemParts.find(p => p.includes('CAREER OS EDITOR MODE'));
      if (layer) mediumParts.push(layer);
    }
    if (!globalChat && context.company) {
      // Include company overview + intel + job details (skip emails, meetings, transcripts)
      const companyOverview = systemParts.find(p => p.includes('CURRENT COMPANY / OPPORTUNITY'));
      if (companyOverview) mediumParts.push(companyOverview);
      const intelSection = systemParts.find(p => p.includes('COMPANY INTELLIGENCE'));
      if (intelSection) mediumParts.push(intelSection);
      const jobSection = systemParts.find(p => p.includes('JOB DETAILS'));
      if (jobSection) mediumParts.push(jobSection);
      const entryLayer = systemParts.find(p => p.includes('ENTRY UPDATE PROPOSALS'));
      if (entryLayer) mediumParts.push(entryLayer);
    }
    const mediumSystem = mediumParts.join('\n');
    const mediumModel = chatModel || pipelineConfig.aiModels?.chat || 'gpt-4.1-mini';
    console.log(`[Coop] ROUTED → Tier 2 (medium, follow-up #${userMsgCount}) | ${mediumModel} | ${mediumSystem.length} chars (${Math.round((1 - mediumSystem.length/fullSize) * 100)}% saved)`);
    try {
      const result = await chatWithFallback({ model: mediumModel, system: mediumSystem, messages, max_tokens: 2048, tag: 'Chat-Medium' });
      if (!result.error) {
        const source = globalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
        if (hasTrigger) await _doExtractInsightsFromChat(lastUserMsg, result.reply, source);
        else extractInsightsFromChat(lastUserMsg, result.reply, source);
        return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'medium' };
      }
    } catch (e) { console.warn('[Coop] Tier 2 failed, escalating to full:', e.message); }
  }

  // Tier 3: Full pipeline — first messages, strategy, comparisons, drafting

  // Auto-fetch URLs in the user's message
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  const urls = coopConfig.automations?.autoFetchUrls !== false ? (lastUserMsg.match(urlPattern) || []).slice(0, 3) : [];
  if (urls.length) {
    const fetched = [];
    for (const url of urls) {
      try {
        console.log('[Coop] Fetching URL:', url);
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const html = await res.text();
          // Extract text content from HTML
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 6000);
          if (text.length > 50) {
            fetched.push(`\n=== WEB PAGE: ${url} ===\n${text}`);
          }
        }
      } catch (e) {
        console.warn('[Coop] Failed to fetch URL:', url, e.message);
      }
    }
    if (fetched.length) {
      systemParts.push(fetched.join('\n'));
      systemParts.push('\nThe user shared URL(s) above. Use the fetched page content to inform your response. Summarize what you find relevant.');
    }
  }

  // (Screenshot + vision context already handled above, before tier routing)

  try {
    const systemText = systemParts.join('\n');
    let model = chatModel || getModelForTask('chat');
    console.log(`[Coop] ROUTED → Tier 3 (full) | ${model} | ${systemText.length} chars | global: ${!!globalChat} | company: ${context.company || '(none)'}`);
    const result = await chatWithFallback({ model, system: systemText, messages, max_tokens: 2048, tag: globalChat ? 'GlobalChat' : 'Chat' });
    if (result.error) return result;
    const source = globalChat ? 'global-chat' : `chat:${context.company || 'unknown'}`;
    if (hasTrigger) {
      await _doExtractInsightsFromChat(lastUserMsg, result.reply, source);
    } else {
      extractInsightsFromChat(lastUserMsg, result.reply, source);
    }
    return { reply: result.reply, model: result.usedModel, usage: result.usage, routed: 'full' };
  } catch (err) {
    console.error('[Coop] Error:', err);
    return { error: err.message };
  }
}

// ── Legacy handler — redirects to unified Coop handler ────────────────────
async function handleChatMessage({ messages, context, chatModel }) {
  return handleCoopMessage({ messages, context, globalChat: false, chatModel });
}

// Original handleChatMessage preserved below for reference — DELETE after confirming redirect works
async function _oldHandleChatMessage({ messages, context, chatModel }) {
  chrome.storage.sync.get(['prefs'], async ({ prefs }) => {});
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));

  const today = new Date(context.todayTimestamp || Date.now());
  const todayStr = context.todayDate || today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Helper: how many days ago was a date string
  const daysAgo = dateStr => {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return null;
    return Math.round((today - d) / 86400000);
  };
  const relTime = dateStr => {
    const n = daysAgo(dateStr);
    if (n === null) return '';
    if (n === 0) return ' (today)';
    if (n === 1) return ' (yesterday)';
    if (n < 7)  return ` (${n} days ago)`;
    if (n < 30) return ` (${Math.round(n/7)} weeks ago)`;
    return ` (${Math.round(n/30)} months ago)`;
  };

  const systemParts = [
    `Your name is Coop. You are Matt's co-operator inside CompanyIntel — his AI agent for job search strategy, company research, and application prep. You're confident, direct, and always in his corner. You speak like a sharp colleague, not a corporate chatbot. Keep it real, keep it useful.

About you: You are part of CompanyIntel, a Chrome extension built by Matt Sterbenz as a personal CRM for managing his GTM job search. CompanyIntel auto-detects companies from any website, enriches them with multi-source research, scores job postings against Matt's preferences, manages a pipeline with Kanban workflow, and provides AI-powered chat (that's you). All data stays local in the browser. You were designed to replace the painful stack of manual research, spreadsheet tracking, and context-less AI sessions that job searching normally requires.

You have deep, full context about this ${context.type === 'job' ? 'job opportunity' : 'company'} including meeting transcripts, emails, notes, and company research. When tab sharing is active, you receive the extracted TEXT content from the page Matt is viewing (look for the "PAGE TEXT FROM USER'S ACTIVE TAB" section in your context). This is real text from his browser — use it to help with application questions, emails, or anything on the page. You cannot see images, videos, or visual layout — only extracted text. Use ALL available context to give specific, grounded answers. If something isn't in your context, say so — never fabricate.

Response style: Keep answers short and direct. Use short paragraphs, not walls of text. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless the user asks for a structured breakdown. Write like a smart colleague in Slack, not a formal report.

Formatting capabilities: Your responses are rendered as rich HTML. You can use full markdown: **bold**, *italic*, [links](url), bullet lists, numbered lists, \`inline code\`, fenced code blocks, and images via ![alt](url). Links will be clickable and open in new tabs. Images will render inline. Use these when they add value — don't force formatting where plain text works.`,
    `\n=== TODAY ===\n${todayStr}`
  ];

  if (context._applicationMode) {
    systemParts.push(`\n=== APPLICATION HELPER MODE ===
SITUATION: The user is filling out a job application form. They need short, authentic answers for application text box fields — not cover letters, not essays, not LinkedIn posts.

VOICE & TONE:
- Write as the user in first person. Conversational, confident, specific.
- Sound like a smart person talking, not an AI writing.
- No dramatic framing, no buzzword stacking, no filler.
- Think "how you'd explain it to a friend who works in the industry."
- NEVER wrap the answer in quotation marks.

LENGTH: 2-5 sentences unless the user specifies otherwise. Shorter is almost always better. If a question needs a longer answer, cap at one short paragraph.

CONTEXT TO SYNTHESIZE: You have the user's Story Time profile, their work experience and preferences, the full job description, the company's product/market/space from web research, the match analysis with green and red flags, and any email or meeting history. Use ALL of this to understand why this company is a fit for this specific person. Reference specifics — the company's actual product, their market position, the user's real experience. Generic answers are unacceptable.

OUTPUT FORMAT:
- Give ONE clean answer the user can copy-paste directly into the application field.
- No preamble like "Here's an answer you can adapt."
- No alternatives unless asked.
- No commentary after the answer — just the answer.
- NEVER wrap the answer in quotation marks.
- If you want to offer to adjust, put it in one short line after a blank line.

When the user first enters this mode, respond: "Paste the application question and I'll write your answer."`);
  }

  // ── Company overview ──────────────────────────────────────────────────────
  const overview = [`\n=== COMPANY / OPPORTUNITY ===`];
  if (context.company)    overview.push(`Company: ${context.company}`);
  if (context.jobTitle)   overview.push(`Role: ${context.jobTitle}`);
  if (context.status)     overview.push(`Pipeline stage: ${context.status}`);
  if (context.employees)  overview.push(`Size: ${context.employees}`);
  if (context.funding)    overview.push(`Funding: ${context.funding}`);
  if (context.tags?.length) overview.push(`Tags: ${context.tags.join(', ')}`);
  if (context.notesFeed?.length) {
    const noteLines = context.notesFeed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => {
      const d = new Date(n.createdAt);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const text = (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return `[${dateStr}] ${text}`;
    }).join('\n');
    overview.push(`User notes:\n${noteLines}`);
  } else if (context.notes) {
    const text = (context.notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    overview.push(`User notes: ${text}`);
  }
  systemParts.push(overview.join('\n'));

  // ── Company intelligence ──────────────────────────────────────────────────
  if (context.intelligence?.eli5 || context.intelligence?.whosBuyingIt || context.intelligence?.howItWorks) {
    const intel = [`\n=== COMPANY INTELLIGENCE ===`];
    if (context.intelligence.eli5)          intel.push(`What they do: ${context.intelligence.eli5}`);
    if (context.intelligence.whosBuyingIt)  intel.push(`Who buys it: ${context.intelligence.whosBuyingIt}`);
    if (context.intelligence.howItWorks)    intel.push(`How it works: ${context.intelligence.howItWorks}`);
    systemParts.push(intel.join('\n'));
  }

  // ── Leadership ───────────────────────────────────────────────────────────
  if (context.leaders?.length) {
    systemParts.push(`\n=== LEADERSHIP ===\n${context.leaders.map(l => `- ${l.name} — ${l.title || 'unknown'}`).join('\n')}`);
  }

  // ── Known contacts ───────────────────────────────────────────────────────
  if (context.knownContacts?.length) {
    const contacts = context.knownContacts.map(c => {
      const parts = [c.name];
      if (c.title)  parts.push(c.title);
      if (c.email)  parts.push(`<${c.email}>`);
      return `- ${parts.join(' | ')}`;
    }).join('\n');
    systemParts.push(`\n=== KNOWN CONTACTS AT ${(context.company || '').toUpperCase()} ===\n${contacts}`);
  }

  // ── Role Brief (AI-synthesized) ─────────────────────────────────────────
  if (context.roleBrief) {
    systemParts.push(`\n=== ROLE BRIEF (AI-synthesized understanding) ===\n${context.roleBrief.slice(0, 4000)}`);
  }

  // ── Job opportunity ───────────────────────────────────────────────────────
  if (context.jobDescription || context.jobMatch) {
    const job = [`\n=== JOB DETAILS ===`];
    if (context.jobDescription) job.push(`Full job description:\n${context.jobDescription.slice(0, 5000)}`);
    if (context.jobMatch?.verdict)     job.push(`Match verdict: ${context.jobMatch.verdict}`);
    if (context.jobMatch?.score)       job.push(`Match score: ${context.jobMatch.score}/10`);
    if (context.jobMatch?.strongFits?.length) job.push(`Strong fits: ${context.jobMatch.strongFits.join('; ')}`);
    if (context.jobMatch?.redFlags?.length)   job.push(`Red flags: ${context.jobMatch.redFlags.join('; ')}`);
    if (context.matchFeedback) {
      const fb = context.matchFeedback;
      job.push(`User feedback on match: ${fb.type === 'up' ? '👍 Agreed' : '👎 Disagreed'}${fb.note ? ` — "${fb.note}"` : ''}`);
    }
    systemParts.push(job.join('\n'));
  }

  // ── Employee reviews ─────────────────────────────────────────────────────
  if (context.reviews?.length) {
    systemParts.push(`\n=== EMPLOYEE REVIEWS ===\n${context.reviews.slice(0, 4).map(r => `- "${r.snippet}" (${r.source || ''})`).join('\n')}`);
  }

  // ── Emails ───────────────────────────────────────────────────────────────
  if (context.emails?.length) {
    const emailLines = context.emails.slice(0, 20).map(e => {
      const lines = [`[${e.date || ''}] "${e.subject}" — ${e.from}`];
      if (e.snippet) lines.push(`  ${e.snippet.slice(0, 200)}`);
      return lines.join('\n');
    }).join('\n');
    systemParts.push(`\n=== EMAIL HISTORY (${context.emails.length} emails) ===\n${emailLines}`);
  }

  // ── Meeting transcripts ───────────────────────────────────────────────────
  console.log('[Chat Prompt] Meeting data:', {
    structuredMeetings: context.meetings?.length || 0,
    granolaNote: context.granolaNote ? `${context.granolaNote.length} chars` : 'null',
    meetingTitles: (context.meetings || []).map(m => m.title).slice(0, 5),
  });
  // Prefer structured per-meeting data (with individual dates + transcripts)
  if (context.meetings?.length) {
    const mtgLines = context.meetings.map(m => {
      const rel = relTime(m.date);
      const header = `--- Meeting: ${m.title || 'Untitled'} | ${m.date || 'unknown date'}${rel}${m.time ? ' at ' + m.time : ''} ---`;
      let body = '';
      if (m.summaryMarkdown) body += `-- Granola AI Summary --\n${m.summaryMarkdown}\n\n`;
      body += (m.transcript || '').slice(0, 4000);
      return `${header}\n${body}`;
    }).join('\n\n');
    systemParts.push(`\n=== MEETING TRANSCRIPTS (${context.meetings.length} meetings) ===\n${mtgLines}`);
  } else if (context.granolaNote) {
    // Fallback: joined transcript blob
    systemParts.push(`\n=== MEETING NOTES / TRANSCRIPTS ===\n${context.granolaNote.slice(0, 12000)}`);
  }

  // ── Manually logged meetings ───────────────────────────────────────────
  if (context.manualMeetings?.length) {
    const manualLines = context.manualMeetings.map(m => {
      const rel = relTime(m.date);
      const header = `--- Meeting (manual): ${m.title || 'Untitled'} | ${m.date || 'unknown'}${rel}${m.time ? ' at ' + m.time : ''} ---`;
      const body = m.transcript || m.notes || '(no notes)';
      return `${header}\n${body.slice(0, 4000)}`;
    }).join('\n\n');
    systemParts.push(`\n=== MANUALLY LOGGED MEETINGS (${context.manualMeetings.length}) ===\n${manualLines}`);
  }

  // ── Uploaded documents ──────────────────────────────────────────────────
  if (context.contextDocuments?.length) {
    const budget = 4000; // token budget
    let used = 0;
    const docParts = [];
    for (const doc of context.contextDocuments) {
      const tokens = doc.tokenEstimate || Math.ceil(doc.extractedText.length / 4);
      if (used + tokens > budget) {
        docParts.push(`\n## Uploaded: ${doc.filename} (truncated)\n${doc.extractedText.slice(0, (budget - used) * 4)}`);
        break;
      }
      docParts.push(`\n## Uploaded: ${doc.filename}\n${doc.extractedText}`);
      used += tokens;
    }
    systemParts.push(`\n=== UPLOADED DOCUMENTS ===\n${docParts.join('\n')}`);
  }

  // ── User profile (Career OS buckets + legacy prefs) ──────────────────────
  const profileKeys = ['profileLinks', 'profileStory', 'profileExperience', 'profilePrinciples',
    'profileMotivators', 'profileVoice', 'profileFAQ', 'profileGreenLights', 'profileRedLights',
    'profileResume', 'profileSkills', 'storyTime'];
  const profileData = await new Promise(r => chrome.storage.local.get(profileKeys, r));

  // Personal Info
  const links = profileData.profileLinks || {};
  const linkParts = [];
  if (links.linkedin) linkParts.push(`LinkedIn: ${links.linkedin}`);
  if (links.github)   linkParts.push(`GitHub: ${links.github}`);
  if (links.website)  linkParts.push(`Website: ${links.website}`);
  if (links.email)    linkParts.push(`Email: ${links.email}`);
  if (links.phone)    linkParts.push(`Phone: ${links.phone}`);
  if (linkParts.length) systemParts.push(`\n[Personal Info]\n${linkParts.join('\n')}`);
  // Fallback to legacy linkedinUrl
  else if (prefs.linkedinUrl) systemParts.push(`\n[Personal Info]\nLinkedIn: ${prefs.linkedinUrl}`);

  // Career OS text buckets
  const story = profileData.profileStory || (profileData.storyTime?.profileSummary || profileData.storyTime?.rawInput || '');
  if (story) systemParts.push(`\n[Your Story]\n${story.slice(0, 8000)}`);

  if (profileData.profileExperience) systemParts.push(`\n[Experience & Accomplishments]\n${profileData.profileExperience.slice(0, 4000)}`);
  if (profileData.profilePrinciples) systemParts.push(`\n[Operating Principles]\n${profileData.profilePrinciples.slice(0, 2000)}`);
  if (profileData.profileMotivators) systemParts.push(`\n[What Drives You]\n${profileData.profileMotivators.slice(0, 2000)}`);
  if (profileData.profileVoice)      systemParts.push(`\n[Voice & Style]\n${profileData.profileVoice.slice(0, 2000)}`);
  if (profileData.profileFAQ)        systemParts.push(`\n[FAQ / Polished Responses]\n${profileData.profileFAQ.slice(0, 3000)}`);

  // Resume
  const resume = profileData.profileResume?.content || prefs.resumeText;
  if (resume) systemParts.push(`\n[Resume]\n${resume.slice(0, 3000)}`);

  // Green & Red Lights (or fallback to legacy prefs)
  const greenLights = profileData.profileGreenLights || [prefs.roles, prefs.roleLoved, prefs.interests].filter(Boolean).join('\n');
  if (greenLights) systemParts.push(`\n[Green Lights]\n${greenLights.slice(0, 2000)}`);

  const redLights = profileData.profileRedLights || [prefs.avoid, prefs.roleHated].filter(Boolean).join('\n');
  if (redLights) systemParts.push(`\n[Red Lights]\n${redLights.slice(0, 2000)}`);

  // Skills & Intangibles
  const skills = profileData.profileSkills || prefs.jobMatchBackground;
  if (skills) systemParts.push(`\n[Skills & Intangibles]\n${skills}`);

  // Location & logistics
  const locParts = [];
  if (prefs.userLocation)        locParts.push(`Location: ${prefs.userLocation}`);
  const wa = (prefs.workArrangement || []).join(', ');
  if (wa)                        locParts.push(`Work arrangement: ${wa}`);
  if (prefs.maxTravel)           locParts.push(`Max travel: ${prefs.maxTravel}`);
  if (locParts.length) systemParts.push(`\n[Location]\n${locParts.join('\n')}`);

  // Compensation
  const compParts = [];
  if (prefs.salaryFloor)  compParts.push(`Base salary floor (walk away below): $${prefs.salaryFloor}`);
  if (prefs.salaryStrong) compParts.push(`Base salary strong offer (exciting above): $${prefs.salaryStrong}`);
  if (prefs.oteFloor)     compParts.push(`OTE floor (walk away below): $${prefs.oteFloor}`);
  if (prefs.oteStrong)    compParts.push(`OTE strong offer (exciting above): $${prefs.oteStrong}`);
  if (compParts.length) systemParts.push(`\n[Compensation]\n${compParts.join('\n')}`);

  // AI-learned insights (from passive learning)
  const storyTime = profileData.storyTime;
  if (storyTime?.learnedInsights?.length) {
    const allInsights = storyTime.learnedInsights;
    // Backward compat: handle old string-format insights
    const normalized = allInsights.map(i => typeof i === 'string' ? { insight: i, category: 'general', priority: 'normal' } : i);
    const highPriority = normalized.filter(i => i.priority === 'high');
    const styleInstructions = normalized.filter(i => i.category === 'style_instruction');
    const normalInsights = normalized.filter(i => i.priority !== 'high' && i.category !== 'style_instruction');
    const recentNormal = normalInsights.slice(-15);

    // Style instructions get their own section
    if (styleInstructions.length) {
      systemParts.push(`\n=== STYLE INSTRUCTIONS (from past corrections) ===\n${styleInstructions.map(i => `- ${i.insight}`).join('\n')}`);
    }

    // High-priority insights always included + recent normal
    const injectedInsights = [...highPriority, ...recentNormal];
    if (injectedInsights.length) {
      systemParts.push(`\n[AI-Learned Insights]\n${injectedInsights.map(i => `- ${i.insight}`).join('\n')}`);
    }

    // Answer patterns for application helper mode
    if (context._applicationMode && storyTime?.answerPatterns?.length) {
      const patterns = storyTime.answerPatterns.slice(-10);
      systemParts.push(`\n=== ANSWER PATTERNS (approaches that worked well) ===\n${patterns.map(p => `[${p.date}] ${p.context || ''}\n${p.text}`).join('\n\n')}\n\nUse these as templates — adapt specifics to the current company.`);
    }
  }

  // ── Visible page content (tab sharing) ─────────────────────────────────────
  if (context.visiblePageContent) {
    systemParts.push(`\n=== PAGE TEXT FROM USER'S ACTIVE TAB (extracted automatically — you CAN see this) ===\nURL: ${context.currentTabUrl || 'unknown'}\nIMPORTANT: The text below was automatically extracted from the page the user is currently viewing. You DO have access to this content. When the user asks about what's on their screen, refer to this text. If it's empty or minimal, tell them the page didn't have much extractable text (e.g. video pages, image-heavy pages).\n\n${context.visiblePageContent.slice(0, 4000)}`);
  } else if (context.currentTabUrl) {
    systemParts.push(`\n=== CURRENT TAB (no page text extracted) ===\nURL: ${context.currentTabUrl}\nNote: Tab sharing is active but no text was extracted from this page. You cannot see the page content. If the user asks what's on screen, explain that you can see the URL but the page didn't yield extractable text.`);
  }

  // Check for trigger phrases that should make extraction blocking
  const lastUserMsg = messages[messages.length - 1]?.content || '';
  const hasTrigger = /remember this|remember that|don't forget|from now on|always\s+(?:lead|start|use|mention|include)|never\s+(?:say|mention|use|include)|update my profile|add this to/i.test(lastUserMsg);

  try {
    const systemText = systemParts.join('\n');
    console.log('[Chat] System prompt length:', systemText.length, 'chars');
    const model = chatModel || getModelForTask('chat');
    console.log('[Chat] Using model:', model);
    const result = await chatWithFallback({ model, system: systemText, messages, max_tokens: 2048, tag: 'Chat' });
    if (result.error) return result;
    // Passive learning: extract insights — blocking for trigger phrases, debounced otherwise
    if (hasTrigger) {
      await _doExtractInsightsFromChat(lastUserMsg, result.reply, `chat:${context.company || 'unknown'}`);
    } else {
      extractInsightsFromChat(lastUserMsg, result.reply, `chat:${context.company || 'unknown'}`);
    }
    return { reply: result.reply, model: result.usedModel };
  } catch (err) {
    console.error('[Chat] Error:', err);
    return { error: err.message };
  }
}

// ── Global Chat (Pipeline Advisor) ───────────────────────────────────────────

async function handleGlobalChatMessage({ messages, pipeline, enrichments, chatModel }) {
  return handleCoopMessage({ messages, context: {}, globalChat: true, pipeline, enrichments, chatModel });
}

// Original handleGlobalChatMessage preserved below for reference — DELETE after confirming redirect works
async function _oldHandleGlobalChatMessage({ messages, pipeline, enrichments, chatModel }) {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r)); // for learnedInsights

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const systemParts = [
    `Your name is Coop. You are Matt's co-operator inside CompanyIntel — his AI agent for job search strategy, company research, and application prep. You're confident, direct, and always in his corner. You speak like a sharp colleague, not a corporate chatbot. Keep it real, keep it useful.\n\nYou have full visibility across Matt's job search pipeline. You know his background, values, and preferences. You can see every company and opportunity he's tracking.\n\nHelp him prioritize opportunities, draft follow-up messages, compare options, and make strategic decisions. When he mentions a specific company or person, use the pipeline context to inform your response.\n\nIf he asks you to draft a message, email, or follow-up — pull from what you know about that company's stage, contacts, notes, and context to write something specific and actionable.\n\nBe direct, opinionated, and honest. Push back when something doesn't align with what you know about him. Don't be sycophantic.\n\nResponse style: Keep answers short and direct. Use short paragraphs. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless asked. Write like a smart colleague in Slack, not a formal report.\n\nFormatting capabilities: Your responses are rendered as rich HTML. You can use full markdown: **bold**, *italic*, [links](url), bullet lists, numbered lists, \`inline code\`, fenced code blocks, and images via ![alt](url). Links will be clickable. Images will render inline. Use these when they add value.`,
    `\n=== TODAY ===\n${todayStr}`
  ];

  // ── User profile (Career OS buckets + legacy prefs) ──────────────────────
  const gcProfileKeys = ['profileLinks', 'profileStory', 'profileExperience', 'profilePrinciples',
    'profileMotivators', 'profileVoice', 'profileFAQ', 'profileGreenLights', 'profileRedLights',
    'profileResume', 'profileSkills'];
  const gcProfile = await new Promise(r => chrome.storage.local.get(gcProfileKeys, r));

  const gcLinks = gcProfile.profileLinks || {};
  const gcLinkParts = [];
  if (gcLinks.linkedin || prefs.linkedinUrl) gcLinkParts.push(`LinkedIn: ${gcLinks.linkedin || prefs.linkedinUrl}`);
  if (gcLinks.website)  gcLinkParts.push(`Website: ${gcLinks.website}`);
  if (gcLinks.email)    gcLinkParts.push(`Email: ${gcLinks.email}`);
  if (gcLinkParts.length) systemParts.push(`\n[Personal Info]\n${gcLinkParts.join('\n')}`);

  const gcStory = gcProfile.profileStory || (storyTime?.profileSummary || storyTime?.rawInput || '');
  if (gcStory) systemParts.push(`\n[Your Story]\n${gcStory.slice(0, 8000)}`);
  if (gcProfile.profileExperience) systemParts.push(`\n[Experience & Accomplishments]\n${gcProfile.profileExperience.slice(0, 4000)}`);
  if (gcProfile.profilePrinciples) systemParts.push(`\n[Operating Principles]\n${gcProfile.profilePrinciples.slice(0, 2000)}`);
  if (gcProfile.profileMotivators) systemParts.push(`\n[What Drives You]\n${gcProfile.profileMotivators.slice(0, 2000)}`);
  if (gcProfile.profileVoice)      systemParts.push(`\n[Voice & Style]\n${gcProfile.profileVoice.slice(0, 2000)}`);
  if (gcProfile.profileFAQ)        systemParts.push(`\n[FAQ / Polished Responses]\n${gcProfile.profileFAQ.slice(0, 3000)}`);

  const gcResume = gcProfile.profileResume?.content || prefs.resumeText;
  if (gcResume) systemParts.push(`\n[Resume]\n${gcResume.slice(0, 3000)}`);

  const gcGreen = gcProfile.profileGreenLights || [prefs.roles, prefs.roleLoved, prefs.interests].filter(Boolean).join('\n');
  if (gcGreen) systemParts.push(`\n[Green Lights]\n${gcGreen.slice(0, 2000)}`);
  const gcRed = gcProfile.profileRedLights || [prefs.avoid, prefs.roleHated].filter(Boolean).join('\n');
  if (gcRed) systemParts.push(`\n[Red Lights]\n${gcRed.slice(0, 2000)}`);

  const gcSkills = gcProfile.profileSkills || prefs.jobMatchBackground;
  if (gcSkills) systemParts.push(`\n[Skills & Intangibles]\n${gcSkills}`);

  const gcLocParts = [];
  if (prefs.userLocation) gcLocParts.push(`Location: ${prefs.userLocation}`);
  const gcWa = (prefs.workArrangement || []).join(', ');
  if (gcWa) gcLocParts.push(`Work arrangement: ${gcWa}`);
  if (prefs.maxTravel) gcLocParts.push(`Max travel: ${prefs.maxTravel}`);
  if (gcLocParts.length) systemParts.push(`\n[Location]\n${gcLocParts.join('\n')}`);

  const gcCompParts = [];
  if (prefs.salaryFloor)  gcCompParts.push(`Base salary floor: $${prefs.salaryFloor}`);
  if (prefs.salaryStrong) gcCompParts.push(`Base salary strong offer: $${prefs.salaryStrong}`);
  if (prefs.oteFloor)     gcCompParts.push(`OTE floor: $${prefs.oteFloor}`);
  if (prefs.oteStrong)    gcCompParts.push(`OTE strong offer: $${prefs.oteStrong}`);
  if (gcCompParts.length) systemParts.push(`\n[Compensation]\n${gcCompParts.join('\n')}`);

  if (storyTime?.learnedInsights?.length) {
    const allInsights = storyTime.learnedInsights;
    // Backward compat: handle old string-format insights
    const normalized = allInsights.map(i => typeof i === 'string' ? { insight: i, category: 'general', priority: 'normal' } : i);
    const highPriority = normalized.filter(i => i.priority === 'high');
    const styleInstructions = normalized.filter(i => i.category === 'style_instruction');
    const normalInsights = normalized.filter(i => i.priority !== 'high' && i.category !== 'style_instruction');
    const recentNormal = normalInsights.slice(-15);

    // Style instructions get their own section
    if (styleInstructions.length) {
      systemParts.push(`\n=== STYLE INSTRUCTIONS (from past corrections) ===\n${styleInstructions.map(i => `- ${i.insight}`).join('\n')}`);
    }

    // High-priority insights always included + recent normal
    const injectedInsights = [...highPriority, ...recentNormal];
    if (injectedInsights.length) {
      systemParts.push(`\n[AI-Learned Insights]\n${injectedInsights.map(i => `- ${i.insight}`).join('\n')}`);
    }

    // Answer patterns for global chat (pipeline advisor may help with applications too)
    if (storyTime?.answerPatterns?.length) {
      const patterns = storyTime.answerPatterns.slice(-10);
      systemParts.push(`\n=== ANSWER PATTERNS (approaches that worked well) ===\n${patterns.map(p => `[${p.date}] ${p.context || ''}\n${p.text}`).join('\n\n')}\n\nUse these as templates — adapt specifics to the current company.`);
    }
  }

  // Pipeline summary
  if (pipeline) {
    const companyCount = pipeline.split('\n').length;
    systemParts.push(`\n=== YOUR PIPELINE (${companyCount} entries) ===\n${pipeline}`);
  }

  // Company-specific enrichment (only for mentioned companies)
  if (enrichments) systemParts.push(enrichments);

  // Check for trigger phrases that should make extraction blocking
  const lastUserMsg = messages[messages.length - 1]?.content || '';
  const hasTrigger = /remember this|remember that|don't forget|from now on|always\s+(?:lead|start|use|mention|include)|never\s+(?:say|mention|use|include)|update my profile|add this to/i.test(lastUserMsg);

  try {
    const systemText = systemParts.join('\n');
    const model = chatModel || getModelForTask('chat');
    console.log('[GlobalChat] Using model:', model, '| prompt length:', systemText.length);
    const result = await chatWithFallback({ model, system: systemText, messages, max_tokens: 2048, tag: 'GlobalChat' });
    if (result.error) return result;
    // Passive learning: extract insights — blocking for trigger phrases, debounced otherwise
    if (hasTrigger) {
      await _doExtractInsightsFromChat(lastUserMsg, result.reply, 'global-chat');
    } else {
      extractInsightsFromChat(lastUserMsg, result.reply, 'global-chat');
    }
    return { reply: result.reply, model: result.usedModel };
  } catch (err) {
    console.error('[GlobalChat] Error:', err);
    return { error: err.message };
  }
}

// ── Story Time: Passive Learning (insight extraction after every chat) ───────

let _insightExtractionTimer = null;
let _pendingInsightArgs = null;   // { userMessage, assistantResponse, source }

function extractInsightsFromChat(userMessage, assistantResponse, source) {
  if (coopConfig.automations?.insightExtraction === false) return;
  // Debounce: accumulate latest message pair, fire after 60s of chat inactivity
  _pendingInsightArgs = { userMessage, assistantResponse, source };
  if (_insightExtractionTimer) clearTimeout(_insightExtractionTimer);
  _insightExtractionTimer = setTimeout(() => {
    const args = _pendingInsightArgs;
    _pendingInsightArgs = null;
    _insightExtractionTimer = null;
    if (args) _doExtractInsightsFromChat(args.userMessage, args.assistantResponse, args.source);
  }, 60_000);
}

async function _doExtractInsightsFromChat(userMessage, assistantResponse, source) {
  try {
    const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));
    const st = storyTime || {};
    const existing = (st.learnedInsights || []).slice(-20).map(i => typeof i === 'string' ? i : i.insight).join('\n');

    const res = await claudeApiCall({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: `You observed a conversation between the user and their AI career advisor. Extract structured learnings.

Return ONLY a JSON object:
{
  "insights": [
    {
      "text": "the insight in plain language",
      "category": "experience_update | green_light | red_light | answer_pattern | strategic_preference | style_instruction | general",
      "priority": "high | normal",
      "target_field": "profileGreenLights | profileRedLights | rawInput | null",
      "context": "what triggered this"
    }
  ]
}

Rules:
- Only extract NEW insights not in the existing list
- "high" priority: user explicitly said to remember, gave a direct instruction, or corrected the AI
- target_field: set when the insight maps to a preference field
- answer_pattern: include the refined answer text
- style_instruction: capture exact instruction ("shorter answers", "no bullets")
- If no insights, return {"insights": []}

Conversation:
User: ${userMessage}
Assistant: ${assistantResponse}

Existing insights (don't repeat):
${existing}` }]
    });
    const data = await res.json();
    if (!res.ok) { console.warn('[Insights] Skipped — API busy (', res.status, ')'); return; }

    const text = (data.content?.[0]?.text || '').trim();
    let insights;
    try {
      // Extract JSON from response (handle markdown code fences)
      const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonStr);
      insights = parsed.insights || (Array.isArray(parsed) ? parsed.map(s => typeof s === 'string' ? { text: s, category: 'general', priority: 'normal' } : s) : []);
    } catch (e) { return; }

    if (!insights.length) return;

    await routeInsights(insights, source);
    console.log(`[Insights] Extracted ${insights.length} new insight(s) from ${source}`);
  } catch (err) {
    console.error('[Insights] Error:', err.message);
  }
}

async function routeInsights(insights, source) {
  if (!insights?.length) return;

  const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));
  const st = storyTime || {};
  st.learnedInsights = st.learnedInsights || [];

  let profileChanged = false;
  const profileUpdates = {};

  for (const insight of insights) {
    // Add to learned insights array (always)
    st.learnedInsights.push({
      source,
      date: new Date().toISOString().slice(0, 10),
      insight: insight.text,
      category: insight.category || 'general',
      priority: insight.priority || 'normal',
      context: insight.context || null,
    });

    // Route to specific profile fields (structured entries preferred, legacy fallback)
    if (insight.target_field === 'profileGreenLights' && insight.category === 'green_light') {
      profileUpdates.profileAttractedTo = true;
      profileChanged = true;
    }
    if (insight.target_field === 'profileRedLights' && insight.category === 'red_light') {
      profileUpdates.profileDealbreakers = true;
      profileChanged = true;
    }
    if (insight.target_field === 'rawInput' && insight.category === 'experience_update') {
      st.rawInput = (st.rawInput || '') + '\n\n[Learned ' + new Date().toISOString().slice(0, 10) + '] ' + insight.text;
    }
    if (insight.category === 'answer_pattern') {
      st.answerPatterns = st.answerPatterns || [];
      if (st.answerPatterns.length < 50) {
        st.answerPatterns.push({ text: insight.text, context: insight.context, date: new Date().toISOString().slice(0, 10), source });
      }
    }
  }

  // Keep last 100 insights
  st.learnedInsights = st.learnedInsights.slice(-100);

  // Save storyTime
  chrome.storage.local.set({ storyTime: st });

  // Write to structured entries (preferred) with legacy text fallback
  if (profileChanged) {
    chrome.storage.local.get(['profileAttractedTo', 'profileDealbreakers', 'profileGreenLights', 'profileRedLights'], data => {
      const updates = {};
      for (const insight of insights) {
        if (insight.target_field === 'profileGreenLights' && insight.category === 'green_light') {
          // Write structured entry
          const arr = data.profileAttractedTo || [];
          arr.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: insight.text,
            category: 'other',
            keywords: [],
            source: source,
            createdAt: Date.now()
          });
          updates.profileAttractedTo = arr;
          // Also append to legacy text for backward compat
          updates.profileGreenLights = (data.profileGreenLights || '') + '\n' + insight.text;
        }
        if (insight.target_field === 'profileRedLights' && insight.category === 'red_light') {
          // Write structured entry
          const arr = data.profileDealbreakers || [];
          arr.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            text: insight.text,
            category: 'other',
            severity: 'soft',
            keywords: [],
            source: source,
            createdAt: Date.now()
          });
          updates.profileDealbreakers = arr;
          // Also append to legacy text for backward compat
          updates.profileRedLights = (data.profileRedLights || '') + '\n' + insight.text;
        }
      }
      if (Object.keys(updates).length) chrome.storage.local.set(updates);
    });
  }

  // Broadcast captured insights for UI confirmation
  const capturedTexts = insights.filter(i => i.priority === 'high' || i.category !== 'general').map(i => i.text);
  if (capturedTexts.length) {
    chrome.runtime.sendMessage({ type: 'INSIGHTS_CAPTURED', insights: capturedTexts }).catch(() => {});
  }
}

// ── Story Time: Profile Consolidation ────────────────────────────────────────

async function consolidateProfile(rawInput, insights) {
  const prompt = `You are compressing a personal career profile for use as AI context. Extract EVERY specific fact, number, metric, skill, preference, criterion, and lesson — express each in the most concise form possible.

Rules:
- NEVER drop a specific fact, number, company name, metric, or stated preference
- Strip storytelling and conversational padding. Keep substance, lose wrapper
- Convert paragraphs into dense, scannable notes. Short phrases, not sentences
- Preserve the user's exact words for values and preferences
- Group into sections: Career Identity, Experience (subsection per role), Skills & Capabilities, Green Lights, Red Lights, Values & Working Style, Career Goals, Projects
- Within Experience, preserve: company, title, metrics (ARR, ACV, team size, %), accomplishments, lessons
- Target 2500-3500 words ceiling. Do NOT cut real content to hit a shorter number
- If learned insights are included, weave into relevant sections

Goal: someone reading this knows EVERYTHING the original said, without conversational padding.

=== USER'S OWN WORDS ===
${rawInput || '(none provided)'}

=== AI-LEARNED OBSERVATIONS ===
${insights || '(none yet)'}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: getModelForTask('profileConsolidate'),
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error?.message || `API error ${res.status}` };
    return { profileSummary: data.content?.[0]?.text || '' };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Role Brief Generation ────────────────────────────────────────────────────

// ── Unified field sync — called after any data ingestion ─────────────────────
async function syncEntryFields(entryId) {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entries = savedCompanies || [];
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  const e = entries[idx];
  const updates = {};

  console.log('[SyncFields] Running for', e.company, '| roleBrief type:', typeof e.roleBrief, '| roleBrief keys:', e.roleBrief ? Object.keys(e.roleBrief) : 'null', '| jobTitle:', e.jobTitle || '(empty)');

  // Sources to scan
  const brief = String(typeof e.roleBrief === 'object' ? (e.roleBrief?.content || e.roleBrief?.brief || '') : (e.roleBrief || ''));
  console.log('[SyncFields] Brief text length:', brief.length, '| first 200 chars:', brief.slice(0, 200));
  const intel = e.intelligence || {};
  const jd = e.jobDescription || '';
  const snapshot = e.jobSnapshot || {};
  const allText = [brief, intel.eli5, intel.howItWorks, intel.whosBuyingIt, jd].filter(Boolean).join(' ');

  // Job title — from brief, job description, or snapshot
  if (!e.jobTitle || e.jobTitle === 'New Opportunity') {
    const m = brief.match(/\*{0,2}Title:\*{0,2}\s*(.+?)(?:\n|\(|;|$)/i)
      || brief.match(/Title[:\s]+([A-Z][^(\n;]{2,60})/i)
      || brief.match(/^#+ .*?—\s*(.+?)(?:\s+Role Brief|\n|$)/im);
    if (m) {
      const title = m[1].trim().replace(/\*+/g, '').replace(/Role Brief$/i, '').trim();
      if (title.length > 2 && title.length < 80) updates.jobTitle = title;
    }
  }

  // Employees
  if (!e.employees) {
    const m = allText.match(/(\d[\d,]*\s*[-–]\s*\d[\d,]*)\s*employees/i)
      || allText.match(/(~?\d[\d,]+)\s*employees/i);
    if (m) updates.employees = m[1].trim();
  }

  // Funding
  if (!e.funding) {
    const m = allText.match(/(Series\s+[A-F][\w]*(?:\s*[-–,]\s*\$[\d.]+[BMK])?)/i)
      || allText.match(/raised\s+(\$[\d.]+[BMK]\w*)/i);
    if (m) updates.funding = m[1].trim();
  }

  // Salary from brief or snapshot
  if (!e.baseSalaryRange) {
    const m = brief.match(/base[:\s]*\$?([\d,]+[Kk]?\s*[-–]\s*\$?[\d,]+[Kk]?)/i)
      || brief.match(/salary[:\s]*\$?([\d,]+[Kk]?\s*[-–]\s*\$?[\d,]+[Kk]?)/i);
    if (m) updates.baseSalaryRange = m[1].trim();
    else if (snapshot.salary && snapshot.salaryType === 'base') updates.baseSalaryRange = snapshot.salary;
  }
  if (!e.oteTotalComp) {
    const m = brief.match(/OTE[:\s]*\$?([\d,]+[Kk]?\s*[-–]\s*\$?[\d,]+[Kk]?)/i);
    if (m) updates.oteTotalComp = m[1].trim();
    else if (snapshot.salary && snapshot.salaryType === 'ote') updates.oteTotalComp = snapshot.salary;
  }

  // Work arrangement from snapshot
  if (!e.workArrangement && snapshot.workArrangement) updates.workArrangement = snapshot.workArrangement;

  // Company LinkedIn from any URL in known data
  if (!e.companyLinkedin) {
    const m = allText.match(/linkedin\.com\/company\/[a-z0-9_-]+/i);
    if (m) updates.companyLinkedin = 'https://www.' + m[0];
  }

  // Founded
  if (!e.founded) {
    const m = allText.match(/founded\s*(?:in\s*)?(\d{4})/i) || allText.match(/(\d{4})\s*[-–]\s*present/i);
    if (m) updates.founded = m[1];
  }

  // Equity from brief
  if (!e.equity) {
    const m = brief.match(/equity[:\s]*([\d.]+%?\s*[-–]\s*[\d.]+%?)/i) || brief.match(/([\d.]+%\s*[-–]\s*[\d.]+%)\s*equity/i);
    if (m) updates.equity = m[1].trim();
  }

  // Company website from any URL in data
  if (!e.companyWebsite) {
    const m = allText.match(/https?:\/\/(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/i);
    if (m && !m[1].includes('linkedin.com') && !m[1].includes('glassdoor') && !m[1].includes('google')) {
      updates.companyWebsite = 'https://' + m[1];
    }
  }

  // Industry from intelligence
  if (!e.industry && intel.category) updates.industry = intel.category;

  // Intelligence fields to top level
  if (intel.oneLiner && !e.oneLiner) updates.oneLiner = intel.oneLiner;
  if (intel.category && !e.category) updates.category = intel.category;

  if (Object.keys(updates).length) {
    console.log('[SyncFields] Auto-filling for', e.company, ':', Object.keys(updates).join(', '));
    Object.assign(entries[idx], updates);
    await new Promise(r => chrome.storage.local.set({ savedCompanies: entries }, r));
  }
}

async function generateRoleBrief({ company, jobTitle, jobDescription, jobSnapshot, emails, meetings, meetingTranscript, notes, knownContacts }) {
  const contextParts = [];

  if (jobDescription) contextParts.push(`=== ORIGINAL JOB POSTING ===\n${jobDescription.slice(0, 5000)}`);
  if (jobSnapshot) {
    const snap = typeof jobSnapshot === 'string' ? jobSnapshot : JSON.stringify(jobSnapshot);
    contextParts.push(`=== JOB SNAPSHOT ===\n${snap}`);
  }
  if (meetings?.length) {
    contextParts.push(`=== MEETING TRANSCRIPTS (${meetings.length} meetings) ===\n${meetings.map(m =>
      `--- ${m.title || 'Meeting'} | ${m.date || ''} ---\n${(m.summaryMarkdown || m.transcript || m.summary || '').slice(0, 3000)}`
    ).join('\n\n')}`);
  }
  if (meetingTranscript) contextParts.push(`=== MEETING NOTES ===\n${meetingTranscript.slice(0, 4000)}`);
  if (emails?.length) {
    contextParts.push(`=== EMAIL THREADS (${emails.length}) ===\n${emails.slice(0, 15).map(e =>
      `[${e.date || ''}] "${e.subject}" — ${e.from}${e.snippet ? '\n  ' + e.snippet.slice(0, 200) : ''}`
    ).join('\n')}`);
  }
  if (notes) contextParts.push(`=== USER NOTES ===\n${notes.slice(0, 2000)}`);
  if (knownContacts?.length) {
    contextParts.push(`=== KNOWN CONTACTS ===\n${knownContacts.map(c =>
      `${c.name || ''}${c.title ? ' — ' + c.title : ''}${c.email ? ' <' + c.email + '>' : ''}`
    ).join('\n')}`);
  }

  if (!contextParts.length) return { error: 'No data available to generate brief' };

  const prompt = `You are synthesizing everything known about a specific job role into a structured brief. You have access to the original job posting (if one exists), meeting transcripts where this role was discussed, email threads with the company, and the user's personal notes.

Company: ${company}
Role: ${jobTitle || 'Unknown'}

${contextParts.join('\n\n')}

Create a living document that represents the CURRENT understanding of this role — not just what the job posting says, but what has been learned through real conversations.

Structure with these sections (only include sections where you have real information):

## Role Overview
What the role actually is — title, function, scope. Start with the posting if available, then layer on conversation learnings.

## Compensation & Equity
Everything known about comp — base, OTE, commission structure, equity, benefits. Note the source and flag discrepancies.

## Team & Reporting
Who you'd work with, report to, team size, org structure.

## What They're Actually Looking For
Real requirements and priorities — which may differ from posted requirements. What did the hiring manager emphasize?

## Culture & Working Style
Remote/hybrid/in-office reality, async vs sync, pace, decision-making style.

## Open Questions
Things not yet answered or needing clarification.

## Timeline & Process
Hiring process, timeline, next steps, urgency.

Rules:
- Be factual and specific. Cite sources when it matters (e.g., "Per the Feb 24 call...")
- When conversations contradict the posting, note BOTH and flag the discrepancy
- Keep it dense and scannable — short paragraphs, bullets for 3+ items
- If a section has no information, omit it entirely
- Use markdown formatting (## headers, **bold**, bullet lists)
- Target 500-1500 words depending on available information

IMPORTANT: You MUST start your response with a structured data block FIRST, before the brief:
<role_brief_fields>
{"jobTitle": "extracted title or null", "baseSalaryRange": "base salary range or null", "oteTotalComp": "OTE/total comp or null", "equity": "equity info or null"}
</role_brief_fields>
Only include fields where you have clear data — use null for anything not mentioned.

Then write the full role brief below.`;

  try {
    const result = await chatWithFallback({
      model: getModelForTask('roleBrief'),
      system: 'You are a role intelligence analyst. Write structured, factual briefs in markdown.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
      tag: 'RoleBrief'
    });
    if (result.error) return { error: result.error };
    let briefFields = null;
    console.log('[RoleBrief] Raw response start:', (result.reply || '').slice(0, 400));
    const fieldsMatch = result.reply.match(/<role_brief_fields>([\s\S]*?)<\/role_brief_fields>/);
    if (fieldsMatch) {
      try {
        briefFields = JSON.parse(fieldsMatch[1].trim());
        console.log('[RoleBrief] Parsed briefFields:', JSON.stringify(briefFields));
      } catch (e) {
        console.warn('[RoleBrief] briefFields JSON parse failed:', e.message);
      }
      result.reply = result.reply.replace(/<role_brief_fields>[\s\S]*?<\/role_brief_fields>/, '').trim();
    } else {
      console.warn('[RoleBrief] No <role_brief_fields> block found in response');
    }
    return { content: result.reply, briefFields };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Deep Fit Analysis ────────────────────────────────────────────────────────

async function deepFitAnalysis({ company, jobTitle, jobSummary, jobSnapshot, jobDescription, jobMatch, notes, transcripts, emails, prefs, roleBrief }) {
  const contextParts = [`Company: ${company}`, `Role: ${jobTitle || 'Unknown'}`];

  if (roleBrief) contextParts.push(`Role Brief (synthesized from conversations + posting):\n${roleBrief.slice(0, 3000)}`);
  if (jobSummary) contextParts.push(`Job summary: ${jobSummary}`);
  // Full description is richer than the snapshot — prefer it, fall back to snapshot
  if (jobDescription) {
    contextParts.push(`Full job description:\n${jobDescription.slice(0, 4000)}`);
  } else if (jobSnapshot) {
    const snap = typeof jobSnapshot === 'string' ? jobSnapshot : JSON.stringify(jobSnapshot);
    contextParts.push(`Job posting details:\n${snap.slice(0, 2000)}`);
  }
  if (jobMatch?.strongFits?.length) contextParts.push(`Initial green flags: ${jobMatch.strongFits.join('; ')}`);
  if (jobMatch?.redFlags?.length)   contextParts.push(`Initial red flags: ${jobMatch.redFlags.join('; ')}`);
  if (notes) contextParts.push(`My notes: ${notes.slice(0, 800)}`);
  if (transcripts) contextParts.push(`Meeting transcripts:\n${transcripts.slice(0, 3000)}`);
  if (emails?.length) {
    contextParts.push(`Email activity:\n${emails.map(e => `- "${e.subject}" from ${e.from}: ${e.snippet || ''}`).join('\n')}`);
  }
  if (prefs?.resumeText)        contextParts.push(`Resume / LinkedIn profile:\n${prefs.resumeText.slice(0, 3000)}`);
  if (prefs?.jobMatchBackground) contextParts.push(`My background: ${prefs.jobMatchBackground}`);
  if (prefs?.roles)              contextParts.push(`Target roles: ${prefs.roles}`);
  if (prefs?.avoid)              contextParts.push(`Things I want to avoid: ${prefs.avoid}`);
  if (prefs?.roleLoved)          contextParts.push(`Roles / experiences I loved: ${prefs.roleLoved}`);
  if (prefs?.roleHated)          contextParts.push(`Roles / experiences I disliked: ${prefs.roleHated}`);
  if (prefs?.salaryFloor)        contextParts.push(`Salary floor (walk away below): ${prefs.salaryFloor}`);
  if (prefs?.salaryStrong)       contextParts.push(`Salary that feels like a strong offer: ${prefs.salaryStrong}`);
  if (prefs?.workArrangement?.length) contextParts.push(`Work arrangement preference: ${prefs.workArrangement.join(', ')}`);

  const system = `You are a sharp, direct career advisor embedded in a job search tool. Analyze this opportunity against everything known: the job posting, the candidate's preferences and background, and — most importantly — any real interaction signals from meeting transcripts and emails.

Write a focused 2-4 sentence narrative that covers:
1. How well the role and company align with what the candidate is looking for (reference specifics from the posting and their stated preferences)
2. What the actual conversations or emails reveal about fit, culture, and momentum — things the posting alone can't tell you
3. A clear, honest recommendation (pursue / proceed with caution / pass) with the single most important reason

Be specific. Reference real details. Don't hedge or restate the obvious. If transcripts/emails are available, weight them heavily — live interaction signals beat job description text every time.

IMPORTANT: You MUST start your response with the structured assessment block FIRST, before your narrative:

<fit_update>
{"score": <1-10 updated fit score reflecting ALL context — meetings, emails, notes, not just the posting>, "verdict": "<updated one-sentence verdict>", "strongFits": ["<concrete green flag grounded in specific evidence, 8-14 words>"], "redFlags": ["<concrete red flag grounded in specific evidence, 8-14 words>"]}
</fit_update>

Then write your 2-4 sentence narrative analysis.

Rules for the structured block:
- Score reflects EVERYTHING known — posting, meetings, emails, notes.
- Flags must cite real evidence. "Recruiter followed up personally" not "Company seems interested."
- If meetings/emails exist, at least one flag should reference interaction signals.
- 2-5 flags per category. Quality over quantity.
- If insufficient evidence for red flags, include fewer rather than fabricating weak ones.`;


  try {
    const result = await aiCall('deepFitAnalysis', {
      system,
      messages: [{ role: 'user', content: contextParts.join('\n\n') }],
      max_tokens: 1200
    });
    if (!result.ok) {
      console.error('[DeepFit] AI call failed:', result.status, result.error);
      return { error: result.error || 'AI call failed' };
    }
    const text = result.text || '';
    console.log('[DeepFit] Raw response:', text.slice(0, 500));
    const fitMatch = text.match(/<fit_update>([\s\S]*?)<\/fit_update>/);
    let fitUpdate = null;
    let cleanAnalysis = text;
    if (fitMatch) {
      try {
        fitUpdate = JSON.parse(fitMatch[1].trim());
        console.log('[DeepFit] Parsed fitUpdate:', JSON.stringify(fitUpdate));
      } catch (e) {
        console.warn('[DeepFit] fitUpdate JSON parse failed:', e.message, '| raw:', fitMatch[1].slice(0, 200));
      }
      cleanAnalysis = text.replace(/<fit_update>[\s\S]*?<\/fit_update>/, '').trim();
    } else {
      console.warn('[DeepFit] No <fit_update> block found in response');
    }
    return { analysis: cleanAnalysis, fitUpdate };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Next Step Extraction ─────────────────────────────────────────────────────

async function extractNextSteps(notes, calendarEvents, transcripts, emailContext) {
  const today = new Date().toISOString().slice(0, 10);
  const futureEvents = (calendarEvents || []).filter(e => (e.start || '') > today);

  const contextParts = [];
  if (futureEvents.length) {
    contextParts.push(`Upcoming calendar events:\n${futureEvents.map(e => `- ${e.start}: ${e.title}`).join('\n')}`);
  }
  if (transcripts) contextParts.push(`Meeting transcripts:\n${transcripts.slice(0, 3000)}`);
  if (notes) contextParts.push(`Meeting notes:\n${notes.slice(0, 1500)}`);
  if (emailContext) contextParts.push(`Recent emails:\n${emailContext}`);

  if (!contextParts.length) return { nextStep: null, nextStepDate: null };

  try {
    const result = await aiCall('nextStepExtraction', {
      system: `Today is ${today}. Extract the single most immediate next action and its date from the context. Return ONLY JSON: {"nextStep":"brief action or null","nextStepDate":"YYYY-MM-DD or null"}. Dates like "Thursday" should be resolved to absolute dates relative to today.`,
      messages: [{ role: 'user', content: contextParts.join('\n\n') }],
      max_tokens: 120
    });
    const text = result.text || '{}';
    const match = text.match(/\{[\s\S]*?\}/);
    const json = match ? JSON.parse(match[0]) : {};
    return {
      nextStep: (json.nextStep && json.nextStep !== 'null') ? json.nextStep : null,
      nextStepDate: (json.nextStepDate && json.nextStepDate !== 'null') ? json.nextStepDate : null
    };
  } catch (e) {
    return { nextStep: null, nextStepDate: null };
  }
}

// ── Google Calendar ──────────────────────────────────────────────────────────

async function fetchCalendarEvents(domain, companyName, knownContactEmails) {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, async token => {
      void chrome.runtime.lastError;
      if (!token) { resolve({ events: [], error: 'not_connected' }); return; }
      try {
        // Verify token has Calendar scope before calling the API
        const tokenInfo = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`).then(r => r.json()).catch(() => ({}));
        const grantedScopes = tokenInfo.scope || '';
        if (!grantedScopes.includes('calendar')) {
          resolve({ events: [], error: 'needs_reauth', detail: 'Calendar scope not in token — disconnect and reconnect Gmail in Setup.' });
          return;
        }

        const now = new Date();
        const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        const oneMonthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          timeMin: sixMonthsAgo.toISOString(),
          timeMax: oneMonthAhead.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        });
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.status === 401) {
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          resolve({ events: [], error: 'token_expired' }); return;
        }
        if (res.status === 403) {
          const errBody = await res.json().catch(() => ({}));
          const errMsg = errBody?.error?.message || errBody?.error || 'forbidden';
          resolve({ events: [], error: 'needs_reauth', detail: errMsg }); return;
        }
        const data = await res.json();
        const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';
        const contactEmailSet = new Set((knownContactEmails || []).map(e => e.toLowerCase()));
        const companyLower = (companyName || '').toLowerCase();

        const isCompanyRelated = (event) => {
          const attendees = event.attendees || [];
          const hasCompanyAttendee = attendees.some(a => {
            const email = (a.email || '').toLowerCase();
            const d = (email.split('@')[1] || '');
            return d === domain || (baseDomain && d.split('.')[0] === baseDomain) || contactEmailSet.has(email);
          });
          const inTitle = companyLower && (event.summary || '').toLowerCase().includes(companyLower);
          return hasCompanyAttendee || inTitle;
        };

        const events = (data.items || [])
          .filter(isCompanyRelated)
          .map(e => ({
            id: e.id,
            title: e.summary || '(no title)',
            start: e.start?.dateTime || e.start?.date || '',
            end: e.end?.dateTime || e.end?.date || '',
            attendees: (e.attendees || []).map(a => ({
              email: (a.email || '').toLowerCase(),
              name: a.displayName || '',
              self: !!a.self,
            })),
            description: e.description || '',
            meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri || null,
          }));

        resolve({ events });
      } catch (err) {
        resolve({ events: [], error: err.message });
      }
    });
  });
}

// ── Granola MCP ─────────────────────────────────────────────────────────────


// ── Granola REST API (Personal API key) ─────────────────────────────────────

async function granolaFetch(path) {
  if (!GRANOLA_KEY) return null;
  const res = await fetch('https://public-api.granola.ai' + path, {
    headers: { 'Authorization': 'Bearer ' + GRANOLA_KEY }
  });
  trackApiCall('granola', res); // non-blocking, no await needed
  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise(r => setTimeout(r, 2000));
    const retry = await fetch('https://public-api.granola.ai' + path, {
      headers: { 'Authorization': 'Bearer ' + GRANOLA_KEY }
    });
    if (!retry.ok) return null;
    return retry.json();
  }
  if (!res.ok) {
    console.warn('[Granola] API error:', res.status, path);
    return null;
  }
  return res.json();
}

// ── Granola Note Index ─────────────────────────────────────────────────────

async function buildGranolaIndex() {
  if (!GRANOLA_KEY) return { success: false, error: 'not_connected' };
  console.log('[Granola] Building note index...');

  try {
    const index = { lastFullSync: Date.now(), lastIncrementalSync: Date.now(), notes: {} };
    let cursor = null;
    let totalNotes = 0;
    const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10); // 6 months

    // Paginate through all notes
    do {
      const url = '/v1/notes?page_size=30&created_after=' + since + (cursor ? '&cursor=' + cursor : '');
      const page = await granolaFetch(url);
      if (!page?.notes?.length) break;

      // Fetch detail for each note (metadata only, no transcript)
      for (const note of page.notes) {
        await new Promise(r => setTimeout(r, 200)); // rate limit: 5/sec
        const detail = await granolaFetch('/v1/notes/' + note.id);
        if (!detail) continue;

        index.notes[note.id] = {
          id: note.id,
          title: detail.title || note.title || '',
          createdAt: detail.created_at || note.created_at || '',
          attendeeEmails: (detail.attendees || []).map(a => (a.email || '').toLowerCase()).filter(Boolean),
          attendeeNames: (detail.attendees || []).map(a => a.name || '').filter(Boolean),
          inviteeEmails: (detail.calendar_event?.invitees || []).map(i => (i.email || '').toLowerCase()).filter(Boolean),
          folderNames: (detail.folder_membership || []).map(f => f.name || '').filter(Boolean),
          calendarTitle: detail.calendar_event?.event_title || '',
          hasSummary: !!(detail.summary_text || detail.summary_markdown),
          hasTranscript: true, // assume true, actual fetch happens on match
        };
        totalNotes++;
      }

      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);

    // Save to storage
    await new Promise(r => chrome.storage.local.set({ granolaIndex: index }, r));
    console.log('[Granola] Index built:', totalNotes, 'notes indexed');
    return { success: true, noteCount: totalNotes };
  } catch (err) {
    console.warn('[Granola] Index build failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function getGranolaIndex() {
  return new Promise(r => chrome.storage.local.get(['granolaIndex'], d => r(d.granolaIndex || null)));
}

async function searchGranolaNotes(companyName, companyDomain, contactNames = []) {
  if (!GRANOLA_KEY) return { notes: null, error: 'not_connected' };

  try {
    console.log('[Granola] Searching for:', companyName, '| domain:', companyDomain, '| contacts:', contactNames);

    // Get the local index
    let index = await getGranolaIndex();

    // If no index exists, build one (first time)
    if (!index || !Object.keys(index.notes || {}).length) {
      console.log('[Granola] No index found, building...');
      await buildGranolaIndex();
      index = await getGranolaIndex();
      if (!index) return { notes: null, transcript: null, meetings: [] };
    }

    const allNotes = Object.values(index.notes);
    if (!allNotes.length) return { notes: null, transcript: null, meetings: [] };

    const lowerCompany = companyName.toLowerCase();
    const shortName = companyName.replace(/\s+(AI|Inc\.?|LLC|Corp\.?|Ltd\.?)$/i, '').trim().toLowerCase();
    const contactLower = contactNames.map(n => n.toLowerCase());

    // Get user's own email to exclude from attendee matching
    const { gmailUserEmail } = await new Promise(r => chrome.storage.local.get(['gmailUserEmail'], r));
    const userEmail = (gmailUserEmail || '').toLowerCase();

    const matched = new Map(); // noteId -> { note, reason, priority }

    for (const note of allNotes) {
      // Priority 1: Attendee email domain match
      // Require EITHER: company name in title, OR majority of non-user attendees are from this domain
      // A single CC'd person from the domain is not sufficient
      if (companyDomain) {
        const domainLower = companyDomain.toLowerCase();
        const allEmails = [...(note.attendeeEmails || []), ...(note.inviteeEmails || [])];
        const nonUserEmails = allEmails.filter(e => e !== userEmail && e.length > 3);
        const domainMatches = nonUserEmails.filter(e => e.endsWith('@' + domainLower));

        if (domainMatches.length > 0) {
          const title = ((note.title || '') + ' ' + (note.calendarTitle || '')).toLowerCase();
          const titleHasCompany = title.includes(lowerCompany) || (shortName.length > 3 && title.includes(shortName));

          // Strong match: company name in title + at least one domain email
          // OR: majority of external attendees are from this domain (it's a meeting WITH this company)
          const majorityFromDomain = nonUserEmails.length > 0 && (domainMatches.length / nonUserEmails.length) >= 0.5;

          if (titleHasCompany || majorityFromDomain) {
            matched.set(note.id, { note, reason: 'email-domain', priority: 1 });
            continue;
          }
        }
      }

      // Priority 2: Folder name match
      if (note.folderNames?.length) {
        const folderMatch = note.folderNames.some(f => {
          const fl = f.toLowerCase();
          return fl === lowerCompany || fl === shortName || fl.includes(lowerCompany) || (shortName.length > 3 && fl.includes(shortName));
        });
        if (folderMatch && !matched.has(note.id)) {
          matched.set(note.id, { note, reason: 'folder', priority: 2 });
          continue;
        }
      }

      // Priority 3: Attendee full name matches a Known Contact
      // Require FULL name match (first + last, both words >= 2 chars) to avoid false positives
      if (note.attendeeNames?.length && contactLower.length) {
        const nameMatch = contactLower.some(cn => {
          const words = cn.split(' ').filter(Boolean);
          if (words.length < 2) return false; // require first + last name minimum
          return note.attendeeNames.some(an => {
            const anl = an.toLowerCase();
            // Both first and last name must appear, and last name must be >= 3 chars
            return words.every(w => w.length >= 2 && anl.includes(w)) && words.some(w => w.length >= 3);
          });
        });
        if (nameMatch && !matched.has(note.id)) {
          matched.set(note.id, { note, reason: 'attendee-name', priority: 3 });
          continue;
        }
      }

      // Priority 4: Title matches company name (strong) or company name + contact name (weaker)
      const title = (note.title || '').toLowerCase();
      const calTitle = (note.calendarTitle || '').toLowerCase();
      const searchText = title + ' ' + calTitle;

      const titleMatchesCompany = searchText.includes(lowerCompany) || (shortName.length > 3 && searchText.includes(shortName));

      // Contact name in title is ONLY valid if the company name is also somewhere in the meeting
      // (title, calendar title, or attendee emails). Contact name alone is too weak.
      if (titleMatchesCompany && !matched.has(note.id)) {
        matched.set(note.id, { note, reason: 'title-company', priority: 4 });
      }
    }

    // Sort by priority, then by date
    const sortedMatches = [...matched.values()]
      .sort((a, b) => a.priority - b.priority || (b.note.createdAt || '').localeCompare(a.note.createdAt || ''))
      .slice(0, 10); // cap at 10

    console.log('[Granola] Matched', sortedMatches.length, 'notes for', companyName,
      sortedMatches.map(m => `${m.note.title?.slice(0,40)} (${m.reason})`));

    if (!sortedMatches.length) return { notes: null, transcript: null, meetings: [] };

    // Fetch full content with transcripts for matched notes
    const meetings = [];
    const transcripts = [];
    const granolaContacts = [];
    for (const { note } of sortedMatches) {
      const full = await granolaFetch('/v1/notes/' + note.id + '?include=transcript');
      if (!full) continue;

      const transcriptText = (full.transcript || []).map(t =>
        (t.speaker?.source || 'Speaker') + ': ' + t.text
      ).join('\n');

      const summaryMd = full.summary_markdown || '';
      const summaryText = full.summary_text || '';
      const summary = summaryMd || summaryText;
      const attendees = (full.attendees || []).map(a => a.name || a.email).filter(Boolean);
      const calEvent = full.calendar_event || {};

      meetings.push({
        id: note.id,
        title: note.title || 'Meeting',
        date: (note.createdAt || '').slice(0, 10) || null,
        time: (note.createdAt || '').slice(11, 16) || null,
        transcript: transcriptText || summary,
        summary,
        summaryMarkdown: summaryMd,
        attendees,
        calendarTitle: calEvent.event_title || null,
      });

      // Extract attendee contacts
      if (full.attendees?.length) {
        for (const att of full.attendees) {
          if (att.email && att.name) {
            granolaContacts.push({ name: att.name, email: att.email.toLowerCase(), source: 'meeting' });
          }
        }
      }

      if (transcriptText) transcripts.push(transcriptText);
      else if (summary) transcripts.push(summary);
    }

    meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const notes = meetings.map(m => m.summary).filter(Boolean).join('\n\n---\n\n') || null;
    const transcript = transcripts.join('\n\n---\n\n') || null;

    console.log('[Granola] Returning', meetings.length, 'meetings with', transcripts.length, 'transcripts');
    return { notes, transcript, meetings, extractedContacts: granolaContacts };
  } catch (err) {
    console.error('[Granola] Error:', err.message);
    return { notes: null, error: err.message };
  }
}

// ── Backfill missing website/linkedin for saved companies ──────────────────

async function backfillMissingWebsites() {
  const { savedCompanies } = await new Promise(resolve =>
    chrome.storage.local.get(['savedCompanies'], resolve)
  );
  const entries = savedCompanies || [];
  const needsFill = entries.filter(
    e => (e.type || 'company') === 'company' && !e.companyWebsite && !e.websiteLookupFailed
  );
  if (!needsFill.length) return;

  let changed = false;
  for (const entry of needsFill) {
    try {
      // Step 1: Serper search for official website
      const results = await fetchSearchResults(`"${entry.company}" official website`, 3);
      const domain = extractDomainFromResults(results, entry.company);

      if (domain) {
        entry.companyWebsite = 'https://' + domain;
        changed = true;
      } else {
        // Step 2: Apollo fallback
        try {
          const apolloData = await fetchApolloData(null, entry.company);
          if (apolloData.website_url) {
            entry.companyWebsite = apolloData.website_url;
            changed = true;
          }
          if (apolloData.linkedin_url && !entry.companyLinkedin) {
            entry.companyLinkedin = apolloData.linkedin_url;
            changed = true;
          }
          if (!apolloData.website_url) {
            entry.websiteLookupFailed = true;
            changed = true;
          }
        } catch {
          entry.websiteLookupFailed = true;
          changed = true;
        }
      }
    } catch {
      entry.websiteLookupFailed = true;
      changed = true;
    }
  }

  if (changed) {
    // Merge backfilled entries back into the full list
    const updatedMap = Object.fromEntries(needsFill.map(e => [e.id, e]));
    const updated = entries.map(e => updatedMap[e.id] || e);
    chrome.storage.local.set({ savedCompanies: updated }, () => void chrome.runtime.lastError);
  }
}

// ── Migrate type:'job' records into their company records (run once) ──────────

async function migrateJobsToCompanies() {
  const data = await new Promise(r => chrome.storage.local.get(['savedCompanies', 'jobMigrationV1Done'], r));
  if (data.jobMigrationV1Done) return;

  const entries = data.savedCompanies || [];
  const jobs = entries.filter(e => e.type === 'job');
  if (!jobs.length) { chrome.storage.local.set({ jobMigrationV1Done: true }); return; }

  let updated = [...entries];
  const idsToRemove = new Set();

  for (const job of jobs) {
    let coIdx = job.linkedCompanyId ? updated.findIndex(c => c.id === job.linkedCompanyId) : -1;
    if (coIdx === -1) {
      coIdx = updated.findIndex(c =>
        (c.type || 'company') === 'company' &&
        c.company.toLowerCase().trim() === job.company.toLowerCase().trim()
      );
    }

    if (coIdx !== -1) {
      const co = { ...updated[coIdx] };
      co.isOpportunity = true;
      co.jobStage = job.status || 'needs_review';
      if (job.jobTitle && job.jobTitle !== 'New Opportunity') co.jobTitle = co.jobTitle || job.jobTitle;
      co.jobMatch    = co.jobMatch    || job.jobMatch    || null;
      co.jobSnapshot = co.jobSnapshot || job.jobSnapshot || null;
      co.jobDescription = co.jobDescription || job.jobDescription || null;
      co.jobUrl      = co.jobUrl      || job.url         || null;
      if (!co.companyWebsite  && job.companyWebsite)  co.companyWebsite  = job.companyWebsite;
      if (!co.companyLinkedin && job.companyLinkedin) co.companyLinkedin = job.companyLinkedin;
      if (!co.intelligence    && job.intelligence)    co.intelligence    = job.intelligence;
      if (!(co.leaders  || []).length && (job.leaders  || []).length) co.leaders  = job.leaders;
      if (!(co.reviews  || []).length && (job.reviews  || []).length) co.reviews  = job.reviews;
      if (!(co.jobListings || []).length && (job.jobListings || []).length) co.jobListings = job.jobListings;
      co.mergedJobIds = [...(co.mergedJobIds || []), job.id];
      updated[coIdx] = co;
      idsToRemove.add(job.id);
    } else {
      // No linked company — convert the job record itself to a company record
      const idx = updated.findIndex(e => e.id === job.id);
      updated[idx] = {
        ...job,
        type: 'company',
        isOpportunity: true,
        jobStage: job.status || 'needs_review',
        jobUrl: job.url || null,
        status: 'co_watchlist',
      };
    }
  }

  updated = updated.filter(e => !idsToRemove.has(e.id));
  chrome.storage.local.set({ savedCompanies: updated, jobMigrationV1Done: true });
}

// Run backfill on service worker startup
migrateJobsToCompanies();
backfillMissingWebsites();