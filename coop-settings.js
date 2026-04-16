// coop-settings.js — Coop configuration page
// Sections: AI Models, Personality, Memory, Behavior, Usage & Costs
//
// Extracted from pipeline.js (AI Models, Chat Fallback, Usage & Costs)
// and preferences.js (Personality, Memory, Behavior).

// ═══════════════════════════════════════════════════════════════════════════
// Utility functions (duplicated from preferences.js — small helpers)
// ═══════════════════════════════════════════════════════════════════════════

function showSaveStatus() {
  const el = document.getElementById('save-status');
  const textEl = document.getElementById('save-status-text');
  if (!el) return;
  clearTimeout(el._timer);
  clearTimeout(el._doneTimer);
  // Show spinner
  el.classList.add('show', 'saving');
  if (textEl) textEl.textContent = 'Saving…';
  // After brief spin, show checkmark
  el._doneTimer = setTimeout(() => {
    el.classList.remove('saving');
    if (textEl) textEl.textContent = 'Saved';
  }, 400);
  // Hide after delay
  el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}

function saveBucket(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    void chrome.runtime.lastError;
    showSaveStatus();
  });
}

// Lightweight toast — replaces window.alert() which is unavailable in Chrome
// extension pages. Inject on first use, auto-dismiss after 3.5s.
function prefsToast(msg, { kind = 'info' } = {}) {
  let host = document.getElementById('prefs-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'prefs-toast';
    host.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2b3a;color:#fff;padding:10px 18px;border-radius:8px;font:13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,0.25);z-index:10000;opacity:0;transition:opacity 180ms ease;pointer-events:none;max-width:420px;';
    document.body.appendChild(host);
  }
  host.textContent = msg;
  host.style.background = kind === 'error' ? '#b91c1c' : '#1c2b3a';
  host.style.opacity = '1';
  clearTimeout(host._t);
  host._t = setTimeout(() => { host.style.opacity = '0'; }, 3500);
}

// ── Coop thinking animation ───────────────────────────────────────────────────
let _coopThinkingCount = 0;
function setCoopThinking(active, label = 'Working on it') {
  const svg     = document.querySelector('.coop-bar svg');
  const roleEl  = document.querySelector('.coop-bar-role');
  if (!svg || !roleEl) return;
  _coopThinkingCount = Math.max(0, _coopThinkingCount + (active ? 1 : -1));
  if (_coopThinkingCount > 0) {
    svg.classList.add('coop-thinking');
    roleEl.innerHTML = `${label}<span class="coop-thinking-dots"><span></span><span></span><span></span></span>`;
  } else {
    svg.classList.remove('coop-thinking');
    roleEl.textContent = 'Your co-operator';
  }
}

// ── Coop model config (loaded once at startup) ───────────────────────────────
let _coopModels = {};
chrome.storage.local.get(['pipelineConfig'], d => {
  if (d.pipelineConfig?.aiModels) _coopModels = d.pipelineConfig.aiModels;
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 1: AI Models (from pipeline.js)
// ═══════════════════════════════════════════════════════════════════════════

const AI_MODEL_OPTIONS = [
  { value: 'gpt-4.1-nano',              label: 'GPT-4.1 Nano',       provider: 'openai' },
  { value: 'gemini-2.0-flash-lite',     label: 'Gemini Flash-Lite',  provider: 'gemini' },
  { value: 'gpt-4.1-mini',              label: 'GPT-4.1 Mini',       provider: 'openai' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',   provider: 'anthropic' },
  { value: 'gemini-2.0-flash',          label: 'Gemini Flash',       provider: 'gemini' },
  { value: 'gpt-4.1',                   label: 'GPT-4.1',            provider: 'openai' },
  { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',  provider: 'anthropic' },
];

function modelProviderBadge(value) {
  const opt = AI_MODEL_OPTIONS.find(o => o.value === value);
  if (!opt) return '';
  if (opt.provider === 'anthropic') return '<span class="model-badge model-badge--anthropic" title="Anthropic Claude">&#10038;</span>';
  if (opt.provider === 'gemini') return '<span class="model-badge model-badge--gemini" title="Google Gemini">&#9830;</span>';
  return '<span class="model-badge model-badge--openai" title="OpenAI GPT">&#9670;</span>';
}

const AI_MODEL_DEFAULTS = {
  companyIntelligence: 'claude-haiku-4-5-20251001',
  firmographicExtraction: 'claude-haiku-4-5-20251001',
  quickFitScoring: 'claude-haiku-4-5-20251001',
  nextStepExtraction: 'claude-haiku-4-5-20251001',
  chat: 'claude-sonnet-4-6',
};

const AI_MODEL_TASKS = [
  { key: 'companyIntelligence', label: 'Company Intelligence', desc: 'Research synthesis' },
  { key: 'firmographicExtraction', label: 'Firmographic Extraction', desc: 'Web data parsing' },
  { key: 'quickFitScoring', label: 'Fit Scoring', desc: 'Score, flags, and analysis (unified scorer)' },
  { key: 'nextStepExtraction', label: 'Next Step Extraction', desc: 'Action item detection' },
  { key: 'chat', label: 'Chat', desc: 'Conversational assistant' },
  { key: 'coopAutofill', label: "Coop's autofills", desc: 'ICP, flags, skills, experience tagging, FAQ' },
  { key: 'coopMemorySynthesis', label: "Coop's memory synthesis", desc: 'Context Window narrative regeneration' },
];

// ── Pipeline config persistence ──────────────────────────────────────────────

let currentConfig = null;

function savePipelineConfig(config) {
  currentConfig = config;
  chrome.runtime.sendMessage({ type: 'SET_PIPELINE_CONFIG', config }, (resp) => {
    void chrome.runtime.lastError;
    const toast = document.getElementById('pipeline-save-toast');
    if (toast) {
      toast.style.opacity = '1';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    }
  });
}

// ── AI Models rendering ──────────────────────────────────────────────────────

// configuredProviders: Set of provider strings with valid API keys (e.g. 'openai', 'anthropic', 'gemini')
function buildModelDropdown(taskKey, models, configuredProviders) {
  const current = models[taskKey] || AI_MODEL_DEFAULTS[taskKey] || AI_MODEL_OPTIONS[0].value;
  return AI_MODEL_OPTIONS.map(o => {
    const disabled = configuredProviders && !configuredProviders.has(o.provider);
    return `<option value="${o.value}" ${o.value === current ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${o.label}${disabled ? ' (no key)' : ''}</option>`;
  }).join('');
}

function renderAIModels(config, configuredProviders) {
  const models = config.aiModels || {};
  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">AI Models</div>';
  html += '<div class="pipeline-sub-desc">Choose which model handles each task.</div>';
  html += '<div class="pipeline-counts-grid">';
  AI_MODEL_TASKS.forEach(task => {
    const currentVal = models[task.key] || AI_MODEL_DEFAULTS[task.key] || AI_MODEL_OPTIONS[0].value;
    html += `<div class="pipeline-count-row">
      <div><div class="pipeline-count-label" style="font-weight:600">${task.label}</div><div style="font-size:10px;color:#7c98b6">${task.desc}</div></div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="model-badge-slot" data-for="${task.key}">${modelProviderBadge(currentVal)}</span>
        <select class="pipeline-model-select" data-model-key="${task.key}">${buildModelDropdown(task.key, models, configuredProviders)}</select>
      </div>
    </div>`;
  });
  html += '</div></div>';
  return html;
}

// ── Chat Model Fallback rendering ────────────────────────────────────────────

function renderChatFallbackSection(config) {
  const fb = config.chatFallback || { enabled: true, allowExpensive: false, showIndicator: true };

  let html = '<div class="pipeline-subsection"><div class="pipeline-sub-title">Chat Model Fallback</div>';
  html += '<div class="pipeline-sub-desc">When the primary chat model fails (rate limit, outage), Coop can try other models. Control which models are allowed.</div>';

  // Fallback enabled toggle
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Enable fallback</div>
      <div style="font-size:10px;color:#7c98b6">If disabled, Coop will show an error instead of trying another model.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-enabled" ${fb.enabled ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Allow expensive models toggle
  html += `<div class="pipeline-count-row" style="margin-bottom:8px">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Allow expensive fallback models</div>
      <div style="font-size:10px;color:#7c98b6">When OFF, fallback is limited to cheap models (Haiku, GPT-4.1 Mini). When ON, Sonnet and GPT-4.1 are also available as fallbacks — these cost 3-5x more per message.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-allow-expensive" ${fb.allowExpensive ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Show fallback indicator toggle
  html += `<div class="pipeline-count-row">
    <div>
      <div class="pipeline-count-label" style="font-weight:600">Show fallback indicator in chat</div>
      <div style="font-size:10px;color:#7c98b6">Display a notice when Coop used a different model than your selected one.</div>
    </div>
    <label class="pipeline-toggle">
      <input type="checkbox" id="fb-show-indicator" ${fb.showIndicator ? 'checked' : ''}>
      <span class="pipeline-toggle-track"></span>
    </label>
  </div>`;

  // Current fallback order display
  const cheapModels = ['Haiku ($1/$5 per MTok)', 'GPT-4.1 Mini ($0.40/$1.60 per MTok)'];
  const expensiveModels = ['Sonnet ($3/$15 per MTok)', 'GPT-4.1 ($2/$8 per MTok)'];
  html += `<div style="margin-top:10px;padding:10px 12px;background:var(--ci-bg-secondary, #f5f0eb);border-radius:8px;font-size:11px;color:#7c98b6">
    <div style="font-weight:600;margin-bottom:4px;color:var(--ci-text-primary, #2d2a26)">Current fallback order:</div>
    <div>Your selected model → ${cheapModels.join(' → ')}${fb.allowExpensive ? ' → ' + expensiveModels.join(' → ') : ''}</div>
    ${!fb.enabled ? '<div style="color:var(--ci-accent-red, #c44040);margin-top:4px;font-weight:600">Fallback disabled — errors will surface directly.</div>' : ''}
  </div>`;

  html += '</div>';
  return html;
}

// ── Load AI Models section + bind listeners ──────────────────────────────────

async function loadAIModelsSection() {
  const config = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_PIPELINE_CONFIG' }, r));
  if (!config) return;
  currentConfig = config;

  const body = document.getElementById('ai-models-section');
  if (!body) return;

  // Check which providers have API keys configured
  const integrations = await new Promise(r => chrome.storage.local.get('integrations', d => r(d.integrations || {})));
  const configuredProviders = new Set();
  if (integrations.anthropic_key) configuredProviders.add('anthropic');
  if (integrations.openai_key) configuredProviders.add('openai');
  if (integrations.gemini_key) configuredProviders.add('gemini');

  body.innerHTML =
    renderAIModels(config, configuredProviders) +
    renderChatFallbackSection(config);

  // ── All model dropdowns ──
  body.querySelectorAll('[data-model-key]').forEach(select => {
    select.addEventListener('change', () => {
      if (!config.aiModels) config.aiModels = {};
      config.aiModels[select.dataset.modelKey] = select.value;
      savePipelineConfig(config);
      // Sync all dropdowns with the same key
      body.querySelectorAll(`[data-model-key="${select.dataset.modelKey}"]`).forEach(s => {
        if (s !== select) s.value = select.value;
      });
      // Update provider badge
      const badge = body.querySelector(`.model-badge-slot[data-for="${select.dataset.modelKey}"]`);
      if (badge) badge.innerHTML = modelProviderBadge(select.value);
    });
  });

  // ── Chat Fallback controls ──
  const fbEnabled = document.getElementById('fb-enabled');
  if (fbEnabled) {
    fbEnabled.addEventListener('change', () => {
      if (!config.chatFallback) config.chatFallback = {};
      config.chatFallback.enabled = fbEnabled.checked;
      savePipelineConfig(config);
    });
  }
  const fbExpensive = document.getElementById('fb-allow-expensive');
  if (fbExpensive) {
    fbExpensive.addEventListener('change', () => {
      if (!config.chatFallback) config.chatFallback = {};
      config.chatFallback.allowExpensive = fbExpensive.checked;
      savePipelineConfig(config);
    });
  }
  const fbIndicator = document.getElementById('fb-show-indicator');
  if (fbIndicator) {
    fbIndicator.addEventListener('change', () => {
      if (!config.chatFallback) config.chatFallback = {};
      config.chatFallback.showIndicator = fbIndicator.checked;
      savePipelineConfig(config);
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Personality (from preferences.js)
// ═══════════════════════════════════════════════════════════════════════════

const COOP_PRESETS = {
  'sharp-colleague': {
    label: 'Sharp Colleague',
    subtitle: 'Direct, opinionated, Slack-style',
    tone: `confident, direct, and always in his corner. You speak like a sharp colleague, not a corporate chatbot. Keep it real, keep it useful.`,
    style: `Keep answers short and direct. Use short paragraphs. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless asked. Write like a smart colleague in Slack, not a formal report.`,
  },
  'strategic-advisor': {
    label: 'Strategic Advisor',
    subtitle: 'Measured, analytical, long-term thinking',
    tone: `thoughtful and analytical — a seasoned advisor who pushes on long-term implications. You ask the questions others miss and challenge assumptions when the stakes matter.`,
    style: `Structure responses around trade-offs and second-order effects. Use frameworks when they add clarity. Be willing to say "slow down" when a decision deserves more thought. Medium-length responses are fine when depth is warranted.`,
  },
  'hype-man': {
    label: 'Hype Man',
    subtitle: 'Encouraging, confidence-building',
    tone: `encouraging and energizing — the colleague who genuinely believes in your strengths and makes sure you see them too. You highlight wins, reframe setbacks, and keep momentum high.`,
    style: `Lead with strengths and positive framing. Be specific about what makes the user strong for each opportunity. Keep energy high without being fake. Short, punchy responses that build confidence.`,
  },
  'formal-analyst': {
    label: 'Formal Analyst',
    subtitle: 'Structured, data-driven, report-style',
    tone: `precise and structured — a senior analyst delivering clear, evidence-based assessments. You organize information systematically and let data drive conclusions.`,
    style: `Use headers and structured sections freely. Prefer numbered lists and tables when comparing options. Cite specific data points from context. Longer, more thorough responses are expected. Professional tone throughout.`,
  },
};

const DEFAULT_OPERATING_PRINCIPLES = `- Treat my floors and dealbreakers as preferences with weight, not as refusal triggers. Flag concerns once, then help me with what I asked.
- When I ask you to draft something (cover letter, email, application answer, intro, follow-up), draft it. Save fit critique for when I explicitly ask "should I apply?" or "is this a fit?".
- When evaluating, be honest and specific. When producing, produce.
- A score below my floor is a concern, not a hard pass. Tell me once, not every turn.
- Hard DQ is reserved only for things I have explicitly marked as hard DQ in my dealbreakers list — nothing else.
- Use the data I've given you (Green Lights, Red Lights, Dealbreakers, ICP, floors) as the source of truth for what I want. Don't editorialize on top of it.`;

const DEFAULT_VOICE_PROFILE = {
  antiPhrases: [
    'i hope this email finds you well',
    'i hope this finds you well',
    'i wanted to reach out',
    'i wanted to touch base',
    'just wanted to follow up',
    'circle back',
    'per my last email',
    'as per',
    'kindly',
    'utilize',
    'leverage',
    'in conclusion',
    'furthermore',
    'moreover',
    'to whom it may concern',
    'dear sir or madam',
  ],
  preferredSignoffs: [],
  avoidExclamations: true,
  maxExclamations: 1,
  tone: 'conversational',       // conversational | professional | direct
  defaultLength: 'standard',    // brief (1-2 sentences) | standard (2-5) | detailed (5-8)
};

const DEFAULT_COOP_CONFIG = {
  preset: 'sharp-colleague',
  operatingPrinciples: '',  // empty = use DEFAULT_OPERATING_PRINCIPLES at runtime
  customInstructions: '',
  toneOverride: null,   // null = use preset default, string = custom override
  styleOverride: null,
  automations: {
    insightExtraction: true,
    autoFetchUrls: true,
    applicationModeDetection: true,
    contextualSuggestions: true,
    rescoreOnProfileChange: false,
    rescoreOnPrefChange: false,
    rescoreOnNewData: false,
  },
};

function initCoopSettings() {
  chrome.storage.local.get(['coopConfig'], ({ coopConfig }) => {
    const cfg = { ...DEFAULT_COOP_CONFIG, ...coopConfig, automations: { ...DEFAULT_COOP_CONFIG.automations, ...(coopConfig?.automations || {}) } };

    // ── Prompt preview fields ──
    const toneEl = document.getElementById('coop-prompt-tone');
    const styleEl = document.getElementById('coop-prompt-style');
    const resetBtn = document.getElementById('coop-prompt-reset');

    function updatePromptPreview() {
      const preset = COOP_PRESETS[cfg.preset] || COOP_PRESETS['sharp-colleague'];
      const currentTone = cfg.toneOverride ?? preset.tone;
      const currentStyle = cfg.styleOverride ?? preset.style;
      if (toneEl) toneEl.value = currentTone;
      if (styleEl) styleEl.value = currentStyle;
      // Show reset button if user has customized
      const isCustomized = cfg.toneOverride !== null || cfg.styleOverride !== null;
      if (resetBtn) resetBtn.classList.toggle('visible', isCustomized);
    }

    // ── Preset buttons ──
    const presetBtns = document.querySelectorAll('.coop-preset-btn');
    presetBtns.forEach(btn => {
      if (btn.dataset.preset === cfg.preset) btn.classList.add('active');
      else btn.classList.remove('active');

      btn.addEventListener('click', () => {
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cfg.preset = btn.dataset.preset;
        cfg.toneOverride = null;  // reset overrides when switching preset
        cfg.styleOverride = null;
        chrome.storage.local.set({ coopConfig: cfg });
        updatePromptPreview();
        showSaveStatus();
      });
    });

    // Populate prompt preview on load
    updatePromptPreview();

    // Save tone/style edits as overrides
    if (toneEl) {
      toneEl.addEventListener('blur', () => {
        const preset = COOP_PRESETS[cfg.preset] || COOP_PRESETS['sharp-colleague'];
        const val = toneEl.value.trim();
        cfg.toneOverride = (val === preset.tone) ? null : val;
        chrome.storage.local.set({ coopConfig: cfg });
        if (resetBtn) resetBtn.classList.toggle('visible', cfg.toneOverride !== null || cfg.styleOverride !== null);
        showSaveStatus();
      });
    }
    if (styleEl) {
      styleEl.addEventListener('blur', () => {
        const preset = COOP_PRESETS[cfg.preset] || COOP_PRESETS['sharp-colleague'];
        const val = styleEl.value.trim();
        cfg.styleOverride = (val === preset.style) ? null : val;
        chrome.storage.local.set({ coopConfig: cfg });
        if (resetBtn) resetBtn.classList.toggle('visible', cfg.toneOverride !== null || cfg.styleOverride !== null);
        showSaveStatus();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        cfg.toneOverride = null;
        cfg.styleOverride = null;
        chrome.storage.local.set({ coopConfig: cfg });
        updatePromptPreview();
        showSaveStatus();
      });
    }

    // ── Operating Principles (single source of truth for interpretation) ──
    const principlesEl = document.getElementById('coop-operating-principles');
    const principlesResetBtn = document.getElementById('coop-principles-reset');
    if (principlesEl) {
      principlesEl.value = (cfg.operatingPrinciples && cfg.operatingPrinciples.trim()) || DEFAULT_OPERATING_PRINCIPLES;
      principlesEl.addEventListener('blur', () => {
        const val = principlesEl.value.trim();
        // Store empty string only if user matches the default exactly — otherwise persist their edits
        cfg.operatingPrinciples = (val === DEFAULT_OPERATING_PRINCIPLES.trim()) ? '' : val;
        chrome.storage.local.set({ coopConfig: cfg });
        showSaveStatus();
      });
    }
    if (principlesResetBtn) {
      principlesResetBtn.addEventListener('click', () => {
        if (principlesEl) principlesEl.value = DEFAULT_OPERATING_PRINCIPLES;
        cfg.operatingPrinciples = '';
        chrome.storage.local.set({ coopConfig: cfg });
        showSaveStatus();
      });
    }

    // ── Custom instructions ──
    const instrEl = document.getElementById('coop-custom-instructions');
    if (instrEl) {
      instrEl.value = cfg.customInstructions || '';
      instrEl.addEventListener('blur', () => {
        cfg.customInstructions = instrEl.value.trim();
        chrome.storage.local.set({ coopConfig: cfg });
        showSaveStatus();
      });
    }

    // ── Voice profile (coop-assist.js ambient writing assistant) ──
    initVoiceProfileEditor();

    // ── Automation toggles ──
    const toggleMap = {
      'coop-auto-insights': 'insightExtraction',
      'coop-auto-urls': 'autoFetchUrls',
      'coop-auto-appmode': 'applicationModeDetection',
      'coop-auto-suggestions': 'contextualSuggestions',
    };
    for (const [elId, key] of Object.entries(toggleMap)) {
      const el = document.getElementById(elId);
      if (!el) continue;
      el.checked = cfg.automations[key] !== false;
      el.addEventListener('change', () => {
        cfg.automations[key] = el.checked;
        chrome.storage.local.set({ coopConfig: cfg });
        showSaveStatus();
      });
    }

    // ── G2 tool-use flag (experimental) ──
    const toolUseEl = document.getElementById('coop-tool-use');
    if (toolUseEl) {
      toolUseEl.checked = cfg.useToolUse === true;
      toolUseEl.addEventListener('change', () => {
        cfg.useToolUse = toolUseEl.checked;
        chrome.storage.local.set({ coopConfig: cfg });
        showSaveStatus();
      });
    }

    // ── Sound toggle ──
    const soundEl = document.getElementById('coop-sounds');
    if (soundEl) {
      soundEl.checked = cfg.soundsMuted !== true;
      soundEl.addEventListener('change', () => {
        cfg.soundsMuted = !soundEl.checked;
        chrome.storage.local.set({ coopConfig: cfg });
        showSaveStatus();
      });
    }

    // ── Coop Assist (writing helper) ──
    chrome.storage.local.get(['coopAssistantConfig'], r => {
      const ac = r.coopAssistantConfig || { enabled: true, blocklist: [], pausedUntil: 0 };
      const enEl = document.getElementById('coop-assist-enabled');
      const pauseBtn = document.getElementById('coop-assist-pause-btn');
      const blockEl = document.getElementById('coop-assist-blocklist');
      if (enEl) {
        enEl.checked = ac.enabled !== false;
        enEl.addEventListener('change', () => {
          ac.enabled = enEl.checked;
          chrome.storage.local.set({ coopAssistantConfig: ac });
          showSaveStatus();
        });
      }
      if (pauseBtn) {
        const refreshLabel = () => {
          const remaining = (ac.pausedUntil || 0) - Date.now();
          pauseBtn.textContent = remaining > 0 ? `Paused (${Math.ceil(remaining/60000)}m)` : 'Pause 1h';
        };
        refreshLabel();
        pauseBtn.addEventListener('click', () => {
          ac.pausedUntil = Date.now() + 60 * 60 * 1000;
          chrome.storage.local.set({ coopAssistantConfig: ac });
          refreshLabel();
          showSaveStatus();
        });
      }
      if (blockEl) {
        blockEl.value = (ac.blocklist || []).join('\n');
        blockEl.addEventListener('blur', () => {
          ac.blocklist = blockEl.value.split('\n').map(s => s.trim()).filter(Boolean);
          chrome.storage.local.set({ coopAssistantConfig: ac });
          showSaveStatus();
        });
      }
    });

  });
}

// ── Voice Profile Editor ─────────────────────────────────────────────────────

function initVoiceProfileEditor() {
  const antiEl = document.getElementById('coop-voice-anti-phrases');
  const maxEl = document.getElementById('coop-voice-max-exclamations');
  const signoffEl = document.getElementById('coop-voice-signoffs');
  const toneEl = document.getElementById('coop-voice-tone');
  const lengthEl = document.getElementById('coop-voice-length');
  const resetBtn = document.getElementById('coop-voice-reset');
  if (!antiEl || !maxEl || !signoffEl) return;

  const linesToArr = (s) => String(s || '').split('\n').map(l => l.trim()).filter(Boolean);
  const arrToLines = (a) => (Array.isArray(a) ? a : []).join('\n');

  function hydrate(vp) {
    const merged = { ...DEFAULT_VOICE_PROFILE, ...(vp || {}) };
    antiEl.value = arrToLines(merged.antiPhrases);
    signoffEl.value = arrToLines(merged.preferredSignoffs);
    const n = Number.isFinite(merged.maxExclamations) ? merged.maxExclamations : DEFAULT_VOICE_PROFILE.maxExclamations;
    maxEl.value = String(n);
    if (toneEl) toneEl.value = merged.tone || 'conversational';
    if (lengthEl) lengthEl.value = merged.defaultLength || 'standard';
  }

  function readStored(cb) {
    chrome.storage.local.get(['voiceProfile'], ({ voiceProfile }) => cb(voiceProfile || {}));
  }

  function save() {
    readStored((current) => {
      const raw = parseInt(maxEl.value, 10);
      const maxEx = Number.isFinite(raw) ? Math.max(0, Math.min(5, raw)) : DEFAULT_VOICE_PROFILE.maxExclamations;
      const merged = {
        ...DEFAULT_VOICE_PROFILE,
        ...current,
        antiPhrases: linesToArr(antiEl.value),
        preferredSignoffs: linesToArr(signoffEl.value),
        maxExclamations: maxEx,
        avoidExclamations: true,
        tone: toneEl?.value || 'conversational',
        defaultLength: lengthEl?.value || 'standard',
      };
      chrome.storage.local.set({ voiceProfile: merged }, () => {
        if (typeof showSaveStatus === 'function') showSaveStatus();
      });
    });
  }

  readStored(hydrate);

  antiEl.addEventListener('blur', save);
  signoffEl.addEventListener('blur', save);
  maxEl.addEventListener('blur', save);
  maxEl.addEventListener('change', save);
  if (toneEl) toneEl.addEventListener('change', save);
  if (lengthEl) lengthEl.addEventListener('change', save);

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      hydrate(DEFAULT_VOICE_PROFILE);
      chrome.storage.local.set({ voiceProfile: { ...DEFAULT_VOICE_PROFILE } }, () => {
        if (typeof showSaveStatus === 'function') showSaveStatus();
      });
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Memory (from preferences.js)
// ═══════════════════════════════════════════════════════════════════════════

// ── Compiled Profile Viewer ──────────────────────────────────────────────────

function initCompiledProfileViewer() {
  const contentEl = document.getElementById('compiled-profile-content');
  const metaEl = document.getElementById('compiled-profile-meta');
  if (!contentEl) return;

  let activeTier = 'standard';
  let activeDoc = 'profile';

  const STORAGE_MAP = {
    'profile-standard': 'coopProfileStandard',
    'profile-full': 'coopProfileFull',
    'preferences-standard': 'coopPrefsStandard',
    'preferences-full': 'coopPrefsFull',
  };

  function loadCompiledDoc() {
    const key = STORAGE_MAP[`${activeDoc}-${activeTier}`];
    chrome.storage.local.get([key, 'coopProfileCompiledAt'], d => {
      const text = d[key];
      if (text) {
        contentEl.textContent = text;
      } else {
        contentEl.innerHTML = `<span style="color:var(--ci-text-tertiary);">Not compiled yet. Fill in your profile sections above and the compiler will generate this automatically.</span>`;
      }
      if (d.coopProfileCompiledAt) {
        const ago = Math.floor((Date.now() - new Date(d.coopProfileCompiledAt).getTime()) / 60000);
        metaEl.textContent = ago < 1 ? 'Compiled just now' : ago < 60 ? `Compiled ${ago}m ago` : `Compiled ${Math.floor(ago / 60)}h ago`;
        metaEl.textContent += ` · ${(text || '').length} chars · ~${Math.round((text || '').length / 4)} tokens`;
      } else {
        metaEl.textContent = '';
      }
    });
  }

  // Tier toggle
  document.querySelectorAll('.compiled-tier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.compiled-tier-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTier = btn.dataset.tier;
      loadCompiledDoc();
    });
  });

  // Doc toggle
  document.querySelectorAll('.compiled-doc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.compiled-doc-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDoc = btn.dataset.doc;
      loadCompiledDoc();
    });
  });

  loadCompiledDoc();
}

// ── Coop's Context Window (Claude project-memory style narrative) ────────────

function initCoopContextWindow() {
  const contentEl = document.getElementById('coop-context-window-content');
  const metaEl = document.getElementById('coop-context-meta');
  const regenBtn = document.getElementById('coop-context-regenerate');
  if (!contentEl || !regenBtn) return;

  function renderSavedContext(onLoaded) {
    chrome.storage.local.get(['coopContextWindow'], d => {
      if (chrome.runtime.lastError) {
        console.warn('[CoopContextWindow] load error:', chrome.runtime.lastError);
        onLoaded?.(null);
        return;
      }
      const ctx = d.coopContextWindow;
      if (!ctx?.markdown) {
        console.log('[CoopContextWindow] no saved context found');
        onLoaded?.(null);
        return;
      }
      contentEl.innerHTML = renderMarkdown(ctx.markdown);
      if (metaEl && ctx.generatedAt) {
        const days = Math.floor((Date.now() - new Date(ctx.generatedAt).getTime()) / 86400000);
        const when = days === 0 ? 'Last updated today' : days === 1 ? 'Last updated 1 day ago' : `Last updated ${days} days ago`;
        const tokens = ctx.sourceTokens ? ` · ${ctx.sourceTokens.toLocaleString()} tokens` : '';
        metaEl.textContent = when + tokens;
      }
      onLoaded?.(ctx);
    });
  }
  renderSavedContext(ctx => {
    // Auto-refresh once per day — only fires while user is on this page
    const age = ctx?.generatedAt ? Date.now() - new Date(ctx.generatedAt).getTime() : Infinity;
    if (age > 24 * 60 * 60 * 1000) {
      console.log('[CoopContextWindow] Auto-refreshing stale context (age:', Math.round(age / 3600000), 'h)');
      setTimeout(() => runRegen(false), 1500);
    }
  });

  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.split('\n');
    const out = [];
    let inList = false;
    for (let raw of lines) {
      if (/^#{1,3}\s+/.test(raw)) {
        if (inList) { out.push('</ul>'); inList = false; }
        const level = raw.match(/^#+/)[0].length;
        out.push(`<h${level}>${escapeHtml(raw.replace(/^#+\s+/, ''))}</h${level}>`);
      } else if (/^[-*]\s+/.test(raw)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${escapeHtml(raw.replace(/^[-*]\s+/, ''))}</li>`);
      } else if (raw.trim() === '') {
        if (inList) { out.push('</ul>'); inList = false; }
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<p>${escapeHtml(raw)}</p>`);
      }
    }
    if (inList) out.push('</ul>');
    return out.join('\n')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  }

  const editBtn = document.getElementById('coop-context-edit');
  const regenChatBtn = document.getElementById('coop-context-regen-chat');

  // ── Edit affordance ──
  editBtn?.addEventListener('click', () => {
    chrome.storage.local.get(['coopContextWindow'], d => {
      const ctx = d.coopContextWindow || { markdown: '' };
      const ta = document.createElement('textarea');
      ta.className = 'ctx-edit-area';
      ta.value = ctx.markdown || '';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'icp-autofill-btn icp-autofill-btn--primary';
      saveBtn.style.marginTop = '10px';
      saveBtn.textContent = 'Save edits';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'icp-autofill-btn';
      cancelBtn.style.cssText = 'margin-top:10px;margin-left:8px;';
      cancelBtn.textContent = 'Cancel';
      const wrap = document.createElement('div');
      wrap.appendChild(ta);
      const btnRow = document.createElement('div');
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      wrap.appendChild(btnRow);
      const prevHTML = contentEl.innerHTML;
      contentEl.innerHTML = '';
      contentEl.appendChild(wrap);
      cancelBtn.addEventListener('click', () => { contentEl.innerHTML = prevHTML; });
      saveBtn.addEventListener('click', () => {
        const md = ta.value;
        const generatedAt = ctx.generatedAt || new Date().toISOString();
        chrome.storage.local.set({
          coopContextWindow: { ...ctx, markdown: md, generatedAt, editedAt: new Date().toISOString() }
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('[CoopContextWindow] save edits failed:', chrome.runtime.lastError);
            prefsToast('Save failed: ' + chrome.runtime.lastError.message, { kind: 'error' });
            return;
          }
          renderSavedContext();
          if (metaEl) metaEl.textContent = (metaEl.textContent || 'Generated') + ' · edited just now';
        });
      });
    });
  });

  // ── Regen-from-chat: visible when there's chat history ──
  // Event-driven: listen for a custom event fired when chat history changes,
  // instead of polling every 1.5s (was 40 DOM checks/min even when backgrounded).
  function refreshRegenFromChatVisibility() {
    if (!regenChatBtn) return;
    const hist = window.__coopChatHistory || [];
    regenChatBtn.style.display = hist.length >= 2 ? '' : 'none';
  }
  refreshRegenFromChatVisibility();
  window.addEventListener('coop-chat-history-changed', refreshRegenFromChatVisibility);

  async function runRegen(includeChat) {
    regenBtn.disabled = true;
    if (regenChatBtn) regenChatBtn.disabled = true;
    const origText = regenBtn.textContent;
    regenBtn.textContent = 'Updating memory...';
    contentEl.innerHTML = '<span style="color:var(--ci-text-tertiary);font-size:13px;">Coop is reading everything you\'ve given him and writing a fresh narrative...</span>';
    if (metaEl) metaEl.textContent = '';
    setCoopThinking(true, 'Writing memory');
    try {
      await doRegen(includeChat);
    } finally {
      setCoopThinking(false);
      regenBtn.disabled = false;
      if (regenChatBtn) regenChatBtn.disabled = false;
      regenBtn.textContent = origText;
    }
  }

  regenBtn.addEventListener('click', () => runRegen(false));
  regenChatBtn?.addEventListener('click', () => runRegen(true));

  async function doRegen(includeChat) {
    const _noop = () => {};
    _noop();

    try {
      // Gather all source data
      const localKeys = [
        'profileResume', 'profileStory', 'profileExperience', 'profileExperienceEntries',
        'profilePrinciples', 'profileMotivators', 'profileSkills', 'profileFAQ',
        'profileGreenLights', 'profileRedLights', 'profileLinks',
        'coopMemory', 'storyTime'
      ];
      const localData = await new Promise(r => chrome.storage.local.get(localKeys, r));
      const syncData = await new Promise(r => chrome.storage.sync.get(['prefs'], r));

      const sourceParts = [];
      if (localData.profileStory) sourceParts.push(`## STORY\n${localData.profileStory.slice(0, 3000)}`);
      if (localData.profileExperience) sourceParts.push(`## EXPERIENCE\n${localData.profileExperience.slice(0, 5000)}`);
      if (localData.profileExperienceEntries?.length) {
        const tagSummary = {};
        localData.profileExperienceEntries.forEach(e => {
          (e.tags || []).forEach(t => {
            if (!tagSummary[t]) tagSummary[t] = [];
            if (e.company) tagSummary[t].push(e.company);
          });
        });
        const tagLines = Object.keys(tagSummary).sort().map(t => `- ${t}: ${tagSummary[t].join(', ')}`);
        if (tagLines.length) sourceParts.push(`## EXPERIENCE TAG ROLLUP\n${tagLines.join('\n')}`);
      }
      if (localData.profileSkills) sourceParts.push(`## SKILLS\n${localData.profileSkills.slice(0, 2000)}`);
      if (localData.profilePrinciples) sourceParts.push(`## PRINCIPLES\n${localData.profilePrinciples.slice(0, 2000)}`);
      if (localData.profileMotivators) sourceParts.push(`## MOTIVATORS\n${localData.profileMotivators.slice(0, 2000)}`);
      if (localData.profileGreenLights) sourceParts.push(`## GREEN LIGHTS\n${localData.profileGreenLights.slice(0, 2000)}`);
      if (localData.profileRedLights) sourceParts.push(`## RED LIGHTS / DEALBREAKERS\n${localData.profileRedLights.slice(0, 2000)}`);
      if (syncData.prefs) {
        const p = syncData.prefs;
        const prefsLines = [];
        if (p.roles) prefsLines.push(`Target roles: ${Array.isArray(p.roles) ? p.roles.join(', ') : p.roles}`);
        if (p.salaryFloor) prefsLines.push(`Salary floor: ${p.salaryFloor}`);
        if (p.oteFloor) prefsLines.push(`OTE floor: ${p.oteFloor}`);
        if (p.workArrangement) prefsLines.push(`Work arrangement: ${p.workArrangement}`);
        if (prefsLines.length) sourceParts.push(`## PREFERENCES\n${prefsLines.join('\n')}`);
      }
      if (localData.coopMemory?.entries?.length) {
        const memLines = localData.coopMemory.entries.slice(0, 30).map(e => `- [${e.type || 'note'}] ${e.text || e.body || ''}`.slice(0, 300));
        sourceParts.push(`## TYPED MEMORY ENTRIES\n${memLines.join('\n')}`);
      }
      if (!sourceParts.length) {
        contentEl.innerHTML = '<span style="color:var(--ci-accent-red);font-size:13px;">No profile data found. Fill in your Story, Experience, or other sections first.</span>';
        return;
      }

      // Optionally include recent chat with Coop as additional context
      if (includeChat && Array.isArray(window.__coopChatHistory) && window.__coopChatHistory.length) {
        const recent = window.__coopChatHistory.slice(-20);
        const lines = recent.map(m => `${m.role === 'user' ? 'User' : 'Coop'}: ${(m.content || '').slice(0, 600)}`);
        sourceParts.push(`## RECENT CONVERSATION WITH USER\nUse these exchanges to update your understanding — pay attention to corrections, new facts, or shifts in direction.\n${lines.join('\n')}`);
      }

      const sourceContent = sourceParts.join('\n\n');

      const prompt = `You are Coop, an AI career advisor. Write a "context window" document — a narrative summary of everything you currently know about this user. This document is what you, Coop, will read at the start of every future conversation to remember who they are and what they're trying to do. It should be written in YOUR voice, in third person (e.g. "They are...", "They're looking for..."), structured as a living memory document like Claude's project memory feature. If you know the user's name from the data, use it.

Structure the document with these markdown headings (use ## for each):

## Purpose & context
2-3 paragraphs. Who they are, what they're doing right now, why this matters.

## Current state
What they're actively working on, what stage of the search they're in, what's in flight.

## Background & experience
A factual rollup of their work history. Use the experience tag rollup as ground truth — it is dimension-grouped (Industry, Stage, Role, Motion, Skills, Tools, Deal) so you can correctly interpret each tag. Do NOT hallucinate or contradict it. Be specific about companies, roles, and what each company actually does. Call out concentrations of expertise (e.g. "Most of their career has been in martech / salestech, primarily at Series A–B companies, running outbound and land-and-expand motions").

## Strengths & superpowers
What they're uniquely good at, based on accomplishments and patterns across roles.

## What they want next
Target role, comp, motion, vertical, company stage, geography. Be specific.

## Red flags & disqualifiers
Things to flag immediately if they come up in any opportunity.

## Voice & working style
How to communicate with them — based on their style preferences and how they've corrected me in the past.

## Open questions
Things I'm unsure about that I should ask them when relevant — DO NOT make up facts to fill gaps. Be honest about what's unclear.

Rules:
- Write in clean markdown. Use ## for section headings, **bold** for emphasis, - for bullets.
- Be specific. Use real company names, real numbers, real tags. Never generic.
- If the experience tag rollup says martech, say martech. Do not contradict the data.
- If something is missing or contradictory, surface it in "Open questions" rather than fabricating.
- Length: aim for 600-1000 words total. Dense, scannable, no filler.

Source data:
${sourceContent}`;

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'COOP_CHAT',
          messages: [{ role: 'user', content: prompt }],
          globalChat: true,
          careerOSChat: true,
          chatModel: _coopModels.coopMemorySynthesis || 'claude-haiku-4-5-20251001'
        }, r => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (r?.error) reject(new Error(r.error));
          else resolve(r);
        });
      });

      const md = result.reply || '';
      if (!md.trim()) throw new Error('Empty response from Coop');

      const generatedAt = new Date().toISOString();
      const tokens = result.usage ? (result.usage.input || 0) + (result.usage.output || 0) : null;

      await new Promise((resolve, reject) => {
        chrome.storage.local.set({
          coopContextWindow: { markdown: md, generatedAt, sourceTokens: tokens }
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('[CoopContextWindow] save failed:', chrome.runtime.lastError);
            reject(new Error('Save failed: ' + chrome.runtime.lastError.message));
          } else {
            console.log('[CoopContextWindow] saved', md.length, 'chars');
            resolve();
          }
        });
      });

      contentEl.innerHTML = renderMarkdown(md);
      if (metaEl) metaEl.textContent = 'Generated just now' + (tokens ? ` · ${tokens.toLocaleString()} tokens` : '');
    } catch (e) {
      console.error('[CoopContextWindow] Error:', e);
      contentEl.innerHTML = `<span style="color:var(--ci-accent-red);font-size:13px;">Error: ${e.message}</span>`;
    }
  }
}

// ── Coop's Memory Viewer (Claude Code-style typed entries) ───────────────────

const COOP_MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
const COOP_MEMORY_TYPE_LABELS = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
};
const COOP_MEMORY_TYPE_DESCRIPTIONS = {
  user: 'Who you are — role, goals, expertise, working style',
  feedback: 'Corrections and validated approaches Coop has learned from you',
  project: 'In-flight opportunities, deadlines, and strategic decisions',
  reference: 'Pointers to where info lives (links, dashboards, tools)',
};
let _memoryTypeFilter = 'all';

// One-time migration from legacy storyTime.learnedInsights → coopMemory entries
function migrateLegacyMemoryIfNeeded(callback) {
  chrome.storage.local.get(['coopMemory', 'storyTime'], data => {
    if (data.coopMemory?._migrated) { callback?.(data.coopMemory); return; }
    const mem = data.coopMemory && Array.isArray(data.coopMemory.entries)
      ? data.coopMemory
      : { entries: [] };
    const insights = (data.storyTime?.learnedInsights || []).filter(Boolean);
    insights.forEach(item => {
      const i = typeof item === 'string' ? { insight: item, category: 'general' } : item;
      const cat = i.category || 'general';
      let type = 'user';
      if (cat === 'style_instruction' || cat === 'answer_pattern') type = 'feedback';
      else if (cat === 'green_light' || cat === 'red_light' || cat === 'strategic_preference') type = 'user';
      else if (cat === 'experience_update') type = 'user';
      else if (cat === 'scoring_feedback') type = 'feedback';
      else if (i.source && /^chat:/.test(i.source)) type = 'project';
      const text = i.insight || '';
      if (!text) return;
      const name = (text.split(/[.!?\n]/)[0] || 'Insight').slice(0, 60);
      mem.entries.push({
        id: 'mem_' + Math.random().toString(36).slice(2, 10),
        type,
        name,
        description: text.length > 60 ? text.slice(0, 140) : '',
        body: text,
        createdAt: i.date ? new Date(i.date).toISOString() : new Date().toISOString(),
        updatedAt: i.date ? new Date(i.date).toISOString() : new Date().toISOString(),
        source: i.source || 'legacy',
      });
    });
    mem._migrated = true;
    mem.updatedAt = new Date().toISOString();
    chrome.storage.local.set({ coopMemory: mem }, () => callback?.(mem));
  });
}

// ── Knowledge Documents Viewer ──────────────────────────────────────────────

function initKnowledgeDocsViewer() {
  const listEl = document.getElementById('knowledge-docs-list');
  const metaEl = document.getElementById('knowledge-docs-meta');
  if (!listEl) return;

  function render() {
    chrome.storage.local.get(['coopKnowledge'], d => {
      const knowledge = d.coopKnowledge;
      if (!knowledge?.manifest?.length) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--ci-text-tertiary);padding:8px 0;">No knowledge documents compiled yet. Fill in your profile and preferences to generate them.</div>';
        metaEl.textContent = '';
        return;
      }

      // Category colors
      const catColors = {
        profile: { bg: 'rgba(124,110,240,0.12)', border: '#7C6EF0', text: '#7C6EF0' },
        preferences: { bg: 'rgba(91,141,239,0.12)', border: '#5B8DEF', text: '#5B8DEF' },
        learnings: { bg: 'rgba(54,179,126,0.12)', border: '#36B37E', text: '#36B37E' },
      };

      let totalChars = 0;
      let totalTokens = 0;

      const rows = knowledge.manifest.map(doc => {
        totalChars += doc.charCount || 0;
        totalTokens += doc.tokenEstimate || 0;
        const cat = catColors[doc.category] || catColors.profile;
        const section = knowledge.sections?.[doc.id] || knowledge.learnings;
        const preview = (section?.content || '').slice(0, 200).replace(/\n/g, ' ').trim();
        const previewId = 'kd_' + doc.id.replace(/[^a-zA-Z0-9]/g, '_');

        return `<div style="border:1px solid var(--ci-border);border-radius:6px;padding:8px 10px;background:var(--ci-bg-page);cursor:pointer;"
          onclick="(function(el){var d=document.getElementById('${previewId}');d.style.display=d.style.display==='none'?'block':'none';el.querySelector('.kd-chevron').textContent=d.style.display==='none'?'▸':'▾';})(this)">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${cat.border};flex-shrink:0;"></span>
            <span style="font-size:12px;font-weight:600;color:var(--ci-text-primary);flex:1;">${escapeHtml(doc.title)}</span>
            <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${cat.bg};color:${cat.text};font-weight:500;">${escapeHtml(doc.category)}</span>
            <span style="font-size:9px;color:var(--ci-text-tertiary);">${(doc.charCount || 0).toLocaleString()} chars · ~${doc.tokenEstimate || 0} tok</span>
            <span class="kd-chevron" style="font-size:8px;color:var(--ci-text-tertiary);">▸</span>
          </div>
          <div id="${previewId}" style="display:none;margin-top:6px;padding:6px 8px;font-size:10px;line-height:1.5;color:var(--ci-text-tertiary);background:var(--ci-bg-inset);border-radius:4px;max-height:120px;overflow-y:auto;white-space:pre-wrap;font-family:var(--ci-font-mono,monospace);">${escapeHtml(preview)}${(section?.content || '').length > 200 ? '…' : ''}</div>
        </div>`;
      });

      listEl.innerHTML = rows.join('');

      const ago = knowledge.compiledAt
        ? Math.floor((Date.now() - knowledge.compiledAt) / 60000)
        : null;
      const agoStr = ago === null ? '' : ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
      metaEl.textContent = `${knowledge.manifest.length} documents · ${totalChars.toLocaleString()} chars · ~${totalTokens.toLocaleString()} tokens${agoStr ? ' · Compiled ' + agoStr : ''}`;
    });
  }

  render();

  // Re-render when knowledge docs change
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.coopKnowledge) render();
  });
}

function initCoopMemory() {
  migrateLegacyMemoryIfNeeded(() => renderCoopMemory());
}

function renderCoopMemory() {
  const listEl = document.getElementById('coop-memory-list');
  const filtersEl = document.getElementById('coop-memory-filters');
  const patternsEl = document.getElementById('coop-memory-patterns');
  if (!listEl) return;

  chrome.storage.local.get(['coopMemory'], data => {
    const mem = data.coopMemory && Array.isArray(data.coopMemory.entries) ? data.coopMemory : { entries: [] };
    const entries = mem.entries.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    // Counts per type
    const counts = { all: entries.length };
    COOP_MEMORY_TYPES.forEach(t => counts[t] = 0);
    entries.forEach(e => { if (counts[e.type] != null) counts[e.type]++; });

    // Type filter chips
    filtersEl.innerHTML =
      `<button class="memory-filter-btn ${_memoryTypeFilter === 'all' ? 'active' : ''}" data-filter="all">All (${counts.all})</button>` +
      COOP_MEMORY_TYPES.map(t =>
        `<button class="memory-filter-btn ${_memoryTypeFilter === t ? 'active' : ''}" data-filter="${t}">${COOP_MEMORY_TYPE_LABELS[t]} (${counts[t]})</button>`
      ).join('') +
      `<button class="memory-filter-btn" id="coop-memory-add" style="margin-left:auto;">+ Add</button>`;

    filtersEl.querySelectorAll('.memory-filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => { _memoryTypeFilter = btn.dataset.filter; renderCoopMemory(); });
    });
    document.getElementById('coop-memory-add')?.addEventListener('click', () => openMemoryEditor(null));

    const filtered = _memoryTypeFilter === 'all' ? entries : entries.filter(e => e.type === _memoryTypeFilter);

    if (!filtered.length) {
      listEl.innerHTML = `<div style="text-align:center;color:#7c98b6;padding:24px;font-size:13px;">No memory entries yet. Chat with Coop and he'll start building memory — or click <strong>+ Add</strong> to write one yourself.</div>`;
      patternsEl.innerHTML = '';
      return;
    }

    // Group by type for display
    const groups = {};
    filtered.forEach(e => { (groups[e.type] = groups[e.type] || []).push(e); });

    // Render body in Claude-Code project-memory style:
    // - **bold** spans become <strong>
    // - "Why: ..." and "How to apply: ..." lines get pulled into stylized blocks
    const renderMemoryBody = (raw) => {
      if (!raw) return '';
      const lines = raw.split('\n');
      const out = [];
      for (const ln of lines) {
        const whyMatch = ln.match(/^\s*\*?\*?(Why)\*?\*?\s*[:：]\s*(.+)$/i);
        const howMatch = ln.match(/^\s*\*?\*?(How to apply)\*?\*?\s*[:：]\s*(.+)$/i);
        if (whyMatch) {
          out.push(`<span class="why-line"><strong>Why:</strong> ${escHtml(whyMatch[2])}</span>`);
        } else if (howMatch) {
          out.push(`<span class="how-line"><strong>How to apply:</strong> ${escHtml(howMatch[2])}</span>`);
        } else {
          // Inline **bold** support
          const safe = escHtml(ln).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          out.push(safe);
        }
      }
      return out.join('<br>');
    };

    const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    listEl.innerHTML = COOP_MEMORY_TYPES.filter(t => groups[t]).map(t => `
      <div class="memory-section">
        <div class="memory-section-title">
          <span class="memory-type-chip ${t}">${COOP_MEMORY_TYPE_LABELS[t]}</span>
          <span style="font-weight:400;color:#7c98b6;font-size:11px;margin-left:8px;">${COOP_MEMORY_TYPE_DESCRIPTIONS[t]}</span>
        </div>
        ${groups[t].map(e => `
          <div class="memory-entry ${t}" data-id="${e.id}">
            <div class="memory-frontmatter">
              <div><span class="fm-key">name:</span> <span class="fm-val">${escHtml(e.name || 'untitled')}</span></div>
              ${e.description ? `<div><span class="fm-key">description:</span> <span class="fm-val">${escHtml(e.description)}</span></div>` : ''}
              <div><span class="fm-key">type:</span> <span class="fm-val">${t}</span></div>
              <div><span class="fm-key">updated:</span> <span class="fm-val">${fmtDate(e.updatedAt)}</span>${e.source ? ` <span class="fm-key">· source:</span> <span class="fm-val">${escHtml(e.source)}</span>` : ''}</div>
            </div>
            <div class="memory-body">${renderMemoryBody(e.body || '')}</div>
            <div class="memory-actions">
              <button class="memory-edit" data-id="${e.id}" title="Edit">✎</button>
              <button class="memory-delete" data-id="${e.id}" title="Delete">×</button>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');

    listEl.querySelectorAll('.memory-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const e = entries.find(x => x.id === btn.dataset.id);
        if (e) openMemoryEditor(e);
      });
    });
    listEl.querySelectorAll('.memory-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        chrome.storage.local.get(['coopMemory'], d => {
          const m = d.coopMemory || { entries: [] };
          m.entries = (m.entries || []).filter(x => x.id !== id);
          m.updatedAt = new Date().toISOString();
          chrome.storage.local.set({ coopMemory: m }, () => {
            showSaveStatus();
            renderCoopMemory();
          });
        });
      });
    });

    patternsEl.innerHTML = '';
  });
}

function openMemoryEditor(entry) {
  const isNew = !entry;
  const e = entry || { id: 'mem_' + Math.random().toString(36).slice(2, 10), type: 'user', name: '', description: '', body: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'manual' };

  // Remove any existing modal
  document.getElementById('memory-editor-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'memory-editor-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:90%;max-height:85vh;overflow:auto;font-family:inherit;">
      <h3 style="margin:0 0 16px;font-size:16px;font-weight:700;">${isNew ? 'New memory entry' : 'Edit memory entry'}</h3>
      <label style="display:block;font-size:11px;font-weight:600;color:#6B6F76;margin-bottom:4px;">Type</label>
      <select id="me-type" style="width:100%;padding:8px;border:1px solid #E0E4E8;border-radius:6px;margin-bottom:12px;font-family:inherit;">
        ${COOP_MEMORY_TYPES.map(t => `<option value="${t}" ${e.type === t ? 'selected' : ''}>${COOP_MEMORY_TYPE_LABELS[t]} — ${COOP_MEMORY_TYPE_DESCRIPTIONS[t]}</option>`).join('')}
      </select>
      <label style="display:block;font-size:11px;font-weight:600;color:#6B6F76;margin-bottom:4px;">Name</label>
      <input id="me-name" value="${escHtml(e.name)}" style="width:100%;padding:8px;border:1px solid #E0E4E8;border-radius:6px;margin-bottom:12px;font-family:inherit;font-size:13px;">
      <label style="display:block;font-size:11px;font-weight:600;color:#6B6F76;margin-bottom:4px;">Description (one line, ≤150 chars)</label>
      <input id="me-desc" value="${escHtml(e.description)}" style="width:100%;padding:8px;border:1px solid #E0E4E8;border-radius:6px;margin-bottom:12px;font-family:inherit;font-size:13px;">
      <label style="display:block;font-size:11px;font-weight:600;color:#6B6F76;margin-bottom:4px;">Body</label>
      <textarea id="me-body" style="width:100%;padding:10px;border:1px solid #E0E4E8;border-radius:6px;font-family:inherit;font-size:13px;min-height:140px;resize:vertical;">${escHtml(e.body)}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button id="me-cancel" style="padding:8px 16px;border:1px solid #E0E4E8;border-radius:6px;background:#fff;cursor:pointer;font-family:inherit;font-weight:600;font-size:12px;">Cancel</button>
        <button id="me-save" style="padding:8px 16px;border:none;border-radius:6px;background:#FC636B;color:#fff;cursor:pointer;font-family:inherit;font-weight:600;font-size:12px;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#me-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', ev => { if (ev.target === modal) modal.remove(); });
  modal.querySelector('#me-save').addEventListener('click', () => {
    const type = modal.querySelector('#me-type').value;
    const name = modal.querySelector('#me-name').value.trim();
    const description = modal.querySelector('#me-desc').value.trim();
    const body = modal.querySelector('#me-body').value.trim();
    if (!name || !body) { prefsToast('Name and Body are required', { kind: 'error' }); return; }
    chrome.storage.local.get(['coopMemory'], d => {
      const m = d.coopMemory && Array.isArray(d.coopMemory.entries) ? d.coopMemory : { entries: [] };
      const idx = m.entries.findIndex(x => x.id === e.id);
      const updated = { ...e, type, name, description, body, updatedAt: new Date().toISOString() };
      if (idx === -1) m.entries.push(updated);
      else m.entries[idx] = updated;
      m.updatedAt = new Date().toISOString();
      chrome.storage.local.set({ coopMemory: m }, () => {
        showSaveStatus();
        modal.remove();
        renderCoopMemory();
      });
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// Section 4: Behavior (from preferences.js)
// ═══════════════════════════════════════════════════════════════════════════

// ── Coop Quick Prompts ───────────────────────────────────────────────────────

const DEFAULT_QUICK_PROMPTS = [
  { id: 'cover-letter', label: 'Cover letter', prompt: 'Help me write a custom cover letter for this role. Use what you know about me and the company to make it specific and compelling.' },
  { id: 'interview-prep', label: 'Interview prep', prompt: 'Prep me for an interview here — what should I know about the company, what questions will they likely ask, and how should I position myself?' },
  { id: 'why-this-role', label: 'Why this role', prompt: 'Help me articulate why I\'m genuinely interested in this role in a way that\'s specific and authentic, not generic.' },
  { id: 'draft-followup', label: 'Draft follow-up', prompt: 'Draft a follow-up message I can send after my last touch with this company. Make it brief and natural.' },
];

function initCoopQuickPrompts() {
  const listEl = document.getElementById('qp-list');
  const addBtn = document.getElementById('qp-add-btn');
  if (!listEl || !addBtn) return;

  let prompts = [];

  function save() {
    chrome.storage.local.set({ coopQuickPrompts: prompts }, () => { void chrome.runtime.lastError; showSaveStatus(); });
  }

  function renderList() {
    listEl.innerHTML = '';
    if (prompts.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--ci-text-tertiary);padding:4px 0;">No quick prompts yet. Add one below.</div>';
      return;
    }
    prompts.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'qp-row';
      row.dataset.idx = idx;
      row.innerHTML = `
        <div class="qp-row-header">
          <div class="qp-row-dot"></div>
          <span class="qp-row-label">${p.label}</span>
          <span class="qp-row-toggle">▾</span>
          <button class="qp-row-del" title="Delete" data-idx="${idx}">✕</button>
        </div>
        <div class="qp-row-body">
          <div>
            <div class="qp-field-label">Label (shown on button)</div>
            <input class="qp-label-input" type="text" value="${p.label.replace(/"/g, '&quot;')}" placeholder="e.g., Cover letter">
          </div>
          <div>
            <div class="qp-field-label">Prompt (sent to Coop)</div>
            <textarea class="qp-prompt-textarea" placeholder="e.g., Help me write a cover letter...">${p.prompt.replace(/</g, '&lt;')}</textarea>
          </div>
          <div class="qp-row-actions">
            <button class="qp-cancel-btn">Cancel</button>
            <button class="qp-save-btn">Save</button>
          </div>
        </div>`;

      row.querySelector('.qp-row-header').addEventListener('click', e => {
        if (e.target.closest('.qp-row-del')) return;
        row.classList.toggle('expanded');
        if (row.classList.contains('expanded')) row.querySelector('.qp-label-input').focus();
      });

      row.querySelector('.qp-row-del').addEventListener('click', e => {
        e.stopPropagation();
        prompts.splice(idx, 1);
        save();
        renderList();
      });

      row.querySelector('.qp-cancel-btn').addEventListener('click', () => row.classList.remove('expanded'));

      row.querySelector('.qp-save-btn').addEventListener('click', () => {
        const label = row.querySelector('.qp-label-input').value.trim();
        const prompt = row.querySelector('.qp-prompt-textarea').value.trim();
        if (!label || !prompt) return;
        prompts[idx] = { ...prompts[idx], label, prompt };
        save();
        renderList();
      });

      listEl.appendChild(row);
    });
  }

  function addNewRow() {
    const newPrompt = { id: 'custom-' + Date.now(), label: 'New prompt', prompt: '' };
    prompts.push(newPrompt);
    renderList();
    // Auto-expand the new row
    const rows = listEl.querySelectorAll('.qp-row');
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      lastRow.classList.add('expanded');
      lastRow.querySelector('.qp-label-input').select();
    }
  }

  addBtn.addEventListener('click', addNewRow);

  chrome.storage.local.get(['coopQuickPrompts'], ({ coopQuickPrompts }) => {
    prompts = Array.isArray(coopQuickPrompts) ? coopQuickPrompts : [...DEFAULT_QUICK_PROMPTS];
    renderList();
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// Section 5: Usage & Costs (from pipeline.js)
// ═══════════════════════════════════════════════════════════════════════════

// ── API Usage Dashboard ─────────────────────────────────────────────────────

let _usagePeriod = 'week'; // day | week | month | custom
let _usageCustomStart = null;
let _usageCustomEnd = null;

const USAGE_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', keyCheck: 'anthropic_key', type: 'ai', billing: 'https://console.anthropic.com/settings/billing' },
  { id: 'openai', name: 'OpenAI', keyCheck: 'openai_key', type: 'ai', billing: 'https://platform.openai.com/settings/organization/billing/overview' },
  { id: 'gemini', name: 'Gemini', keyCheck: 'gemini_key', type: 'ai', billing: 'https://aistudio.google.com/app/apikey' },
  { id: 'serper', name: 'Serper', keyCheck: 'serper_key', type: 'credit', billing: 'https://serper.dev/dashboard' },
  { id: 'apollo', name: 'Apollo', keyCheck: 'apollo_key', type: 'credit', billing: 'https://app.apollo.io/#/settings/credits/current' },
  { id: 'granola', name: 'Granola', keyCheck: 'granola_key', type: 'data', billing: null },
];

function getUsageDateRange() {
  const now = new Date();
  if (_usagePeriod === 'custom' && _usageCustomStart && _usageCustomEnd) {
    return { start: _usageCustomStart, end: _usageCustomEnd };
  }
  if (_usagePeriod === 'day') {
    return { start: now.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (_usagePeriod === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: s.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  // week (default)
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return { start: mon.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

function sumHistoryInRange(history, start, end) {
  return (history || []).filter(d => d.date >= start && d.date <= end).reduce((acc, d) => {
    acc.requests += d.requests || 0;
    acc.inputTokens += d.inputTokens || 0;
    acc.outputTokens += d.outputTokens || 0;
    return acc;
  }, { requests: 0, inputTokens: 0, outputTokens: 0 });
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

function renderSparkline(history, range) {
  const days = (history || []).filter(d => d.date >= range.start && d.date <= range.end);
  if (days.length < 2) return '';
  const max = Math.max(...days.map(d => d.requests), 1);
  const w = 50, h = 18;
  const points = days.map((d, i) => {
    const x = (i / Math.max(days.length - 1, 1)) * w;
    const y = h - (d.requests / max) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return `<svg class="usage-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="#7c98b6" stroke-width="1.2"/></svg>`;
}

function estimateCost(provider, sum) {
  if (provider === 'anthropic') {
    const costIn = sum.inputTokens * 0.25 / 1000000; // ~Haiku rate
    const costOut = sum.outputTokens * 1.25 / 1000000;
    const total = costIn + costOut;
    return total < 0.01 ? '<$0.01' : '$' + total.toFixed(2);
  }
  if (provider === 'openai') {
    const costIn = sum.inputTokens * 0.15 / 1000000; // ~GPT-4.1 mini rate
    const costOut = sum.outputTokens * 0.6 / 1000000;
    const total = costIn + costOut;
    return total < 0.01 ? '<$0.01' : '$' + total.toFixed(2);
  }
  if (provider === 'serper') {
    return sum.requests + ' credits';
  }
  return '';
}

function loadUsageDashboard() {
  chrome.runtime.sendMessage({ type: 'GET_API_USAGE' }, usage => {
    void chrome.runtime.lastError;
    chrome.storage.local.get(['apiCreditAllocations', 'integrations'], data => {
      const alloc = data.apiCreditAllocations || {};
      const integrations = data.integrations || {};
      renderUsageDashboard(usage || {}, alloc, integrations);
    });
  });
}

function renderUsageDashboard(usage, alloc, integrations) {
  const container = document.getElementById('usage-container');
  if (!container) return;

  const range = getUsageDateRange();
  const periodLabel = _usagePeriod === 'day' ? 'Today' : _usagePeriod === 'week' ? 'This week' : _usagePeriod === 'month' ? 'This month' : `${range.start} – ${range.end}`;

  let html = `<div class="usage-section">
    <div class="usage-header">
      <span class="usage-title">API Usage</span>
      <div class="usage-controls">
        <button class="usage-period-btn${_usagePeriod === 'day' ? ' active' : ''}" data-period="day">Day</button>
        <button class="usage-period-btn${_usagePeriod === 'week' ? ' active' : ''}" data-period="week">Week</button>
        <button class="usage-period-btn${_usagePeriod === 'month' ? ' active' : ''}" data-period="month">Month</button>
        <input type="date" class="usage-date-input" id="usage-start" value="${range.start}">
        <span style="color:#7c98b6;font-size:11px">–</span>
        <input type="date" class="usage-date-input" id="usage-end" value="${range.end}">
        <button class="usage-reset-btn" id="usage-reset-btn">Reset</button>
      </div>
    </div>
    <div class="usage-table">`;

  let totalRequests = 0, totalInputTokens = 0, totalOutputTokens = 0, totalEstCost = 0;

  for (const prov of USAGE_PROVIDERS) {
    const pd = usage[prov.id] || { totalRequests: 0, dailyHistory: [], errors: { count429: 0, count401: 0, countOther: 0 }, tokensToday: { input: 0, output: 0 } };
    const configured = !!integrations[prov.keyCheck];
    const dimmed = !configured ? ' dimmed' : '';
    const sum = sumHistoryInRange(pd.dailyHistory, range.start, range.end);
    totalRequests += sum.requests;
    totalInputTokens += sum.inputTokens;
    totalOutputTokens += sum.outputTokens;

    // Status
    let dotColor = 'gray', statusText = 'No key', statusClass = 'gray';
    if (!configured) { /* keep gray */ }
    else if (pd.errors?.count401 > 0) { dotColor = 'red'; statusText = 'Auth error'; statusClass = 'red'; }
    else if (pd.errors?.count429 > 0) { dotColor = 'yellow'; statusText = `${pd.errors.count429} retries`; statusClass = 'yellow'; }
    else if (pd.totalRequests > 0) { dotColor = 'green'; statusText = 'Healthy'; statusClass = 'green'; }
    else if (configured) { dotColor = 'green'; statusText = 'Ready'; statusClass = 'green'; }

    // Details
    let details = '';
    if (prov.type === 'ai' && configured) {
      if (sum.inputTokens || sum.outputTokens) {
        details += `${fmtTokens(sum.inputTokens)} in · ${fmtTokens(sum.outputTokens)} out`;
        const cost = estimateCost(prov.id, sum);
        if (cost) details += ` · <span class="usage-cost">~${cost}</span>`;
      }
      if (pd.lastRateLimit?.tokensRemaining != null) {
        details += `<br>Rate: ${fmtTokens(pd.lastRateLimit.tokensRemaining)}/${fmtTokens(pd.lastRateLimit.tokensLimit || 0)} tokens/min`;
      }
    } else if (prov.type === 'credit' && configured) {
      const creditAlloc = alloc[prov.id];
      if (creditAlloc > 0) {
        const pct = Math.min((pd.totalRequests || 0) / creditAlloc * 100, 100);
        const barColor = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';
        details += `<div class="usage-progress"><div class="usage-progress-bar ${barColor}" style="width:${pct}%"></div></div>`;
        details += `${pd.totalRequests || 0} / <span class="usage-alloc-link" data-provider="${prov.id}">${creditAlloc.toLocaleString()}</span> credits`;
      } else {
        details += `<span class="usage-alloc-link" data-provider="${prov.id}">Set credit limit</span>`;
      }
    } else if (prov.type === 'data' && pd.totalRequests > 0) {
      details += 'Meeting notes & transcripts';
    }
    if (!configured) details = '<span style="font-style:italic">No key configured</span>';

    const billingLink = prov.billing ? `<a href="${prov.billing}" target="_blank" class="usage-billing-link" title="View billing">↗</a>` : '';
    const sparkline = renderSparkline(pd.dailyHistory, range);

    html += `<div class="usage-row${dimmed}">
      <div class="usage-provider">${prov.name} ${billingLink}</div>
      <div class="usage-counts">
        <div class="usage-count-primary">${sum.requests} req ${sparkline}</div>
        <div class="usage-count-secondary">${(pd.totalRequests || 0).toLocaleString()} all time</div>
      </div>
      <div class="usage-status"><span class="usage-dot ${dotColor}"></span><span class="usage-status-text ${statusClass}">${statusText}</span></div>
      <div class="usage-details">${details}</div>
    </div>`;
  }

  // Totals bar
  html += `</div>
    <div class="usage-total-bar">
      <div class="usage-total-item"><span class="usage-total-label">Total requests (${periodLabel})</span><span class="usage-total-value">${totalRequests.toLocaleString()}</span></div>
      <div class="usage-total-item"><span class="usage-total-label">Tokens in</span><span class="usage-total-value">${fmtTokens(totalInputTokens)}</span></div>
      <div class="usage-total-item"><span class="usage-total-label">Tokens out</span><span class="usage-total-value">${fmtTokens(totalOutputTokens)}</span></div>
    </div>
  </div>`;

  container.innerHTML = html;

  // Period buttons
  container.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      _usagePeriod = btn.dataset.period;
      _usageCustomStart = null;
      _usageCustomEnd = null;
      loadUsageDashboard();
    });
  });

  // Date inputs
  const startInput = document.getElementById('usage-start');
  const endInput = document.getElementById('usage-end');
  if (startInput && endInput) {
    const onDateChange = () => {
      _usagePeriod = 'custom';
      _usageCustomStart = startInput.value;
      _usageCustomEnd = endInput.value;
      loadUsageDashboard();
    };
    startInput.addEventListener('change', onDateChange);
    endInput.addEventListener('change', onDateChange);
  }

  // Reset
  document.getElementById('usage-reset-btn')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_API_USAGE' }, () => loadUsageDashboard());
  });

  // Credit allocation inline edit
  container.querySelectorAll('.usage-alloc-link').forEach(link => {
    link.addEventListener('click', () => {
      const prov = link.dataset.provider;
      const current = alloc[prov] || '';
      const input = document.createElement('input');
      input.className = 'usage-alloc-input';
      input.type = 'number';
      input.min = '0';
      input.value = current;
      input.placeholder = 'e.g. 2500';
      link.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        const val = parseInt(input.value) || 0;
        alloc[prov] = val;
        chrome.runtime.sendMessage({ type: 'SET_CREDIT_ALLOCATION', provider: prov, credits: val }, () => loadUsageDashboard());
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); input.blur(); } });
    });
  });
}

// ── Cost Dashboard ──────────────────────────────────────────────────────────

const COST_OP_LABELS = {
  chat:     'Coop Chat',
  insight:  'Memory Extraction',
  scoring:  'Job Scoring',
  research: 'Company Research',
  search:   'Web Search',
  enrich:   'Data Enrichment',
  profile:  'Profile Processing',
  extract:  'Task Extraction',
  rewrite:  'Writing Assistant',
  scout:    'Company Scout'
};

const COST_OP_COLORS = {
  chat:     '#4573D2',
  insight:  '#7C6EF0',
  scoring:  '#FC636B',
  research: '#F5A623',
  search:   '#3B82F6',
  enrich:   '#36B37E',
  profile:  '#E8384F',
  extract:  '#10B981',
  rewrite:  '#8B5CF6',
  scout:    '#D97706'
};

const COST_PROVIDER_NAMES = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
  serper:    'Serper',
  apollo:    'Apollo',
  granola:   'Granola'
};

const COST_PROVIDER_COLORS = {
  anthropic: '#D97706',
  openai:    '#10A37F',
  serper:    '#3B82F6',
  apollo:    '#6366F1',
  granola:   '#8B5CF6'
};

const COST_PROVIDERS = ['anthropic', 'openai', 'serper', 'apollo', 'granola'];

function costFmt(c) {
  if (c == null || c === 0) return '$0.00';
  return c < 0.01 ? '$' + c.toFixed(4) : '$' + c.toFixed(2);
}

function costFmtLong(c) {
  if (c == null || c === 0) return '$0.000';
  return '$' + c.toFixed(4);
}

function costFmtTokens(t) {
  if (!t) return '0';
  return t > 999 ? (t / 1000).toFixed(1) + 'k' : String(t);
}

function costColorClass(cost) {
  if (cost < 0.25) return 'cost-green';
  if (cost <= 1.00) return 'cost-yellow';
  return 'cost-red';
}

function costBarColor(cost) {
  if (cost < 0.25) return 'var(--ci-accent-teal)';
  if (cost <= 1.00) return 'var(--ci-accent-amber)';
  return 'var(--ci-accent-red)';
}

function costEscapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function costTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadAndRenderCosts() {
  chrome.storage.local.get('apiUsage', d => {
    const usage = d.apiUsage || {};
    renderCostDashboard(usage);
    const note = document.getElementById('cost-refresh-note');
    if (note) note.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
  });
}

function renderCostDashboard(usage) {
  const today = costTodayStr();
  const log = (usage.callLog || []).filter(c => {
    const d = new Date(c.ts).toISOString().slice(0, 10);
    return d === today;
  });

  // Show the date on "today" section headers so the numbers have context
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  document.querySelectorAll('.cost-section-header').forEach(el => {
    if (el.textContent.includes('Operation')) el.textContent = `Breakdown by Operation \u2014 ${todayLabel}`;
    else if (el.textContent.includes('Provider')) el.textContent = `Breakdown by Provider \u2014 ${todayLabel}`;
  });

  renderCostSummary(usage, log);
  renderCostOpBreakdown(log);
  renderCostProviders(usage, log);
  renderCostLog(usage.callLog || []);
  renderCostChart(usage);
}

function renderCostSummary(usage, todayLog) {
  const totalCost = usage.costToday || 0;
  const totalCalls = todayLog.length;

  const sumTotal = document.getElementById('cost-sum-total');
  if (sumTotal) {
    sumTotal.textContent = costFmt(totalCost);
    sumTotal.className = 'cost-summary-card-value ' + costColorClass(totalCost);
  }

  const resetDate = usage.lastDayReset || costTodayStr();
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const totalLabelEl = document.getElementById('cost-sum-total-label');
  if (totalLabelEl) totalLabelEl.textContent = `Today \u2014 ${todayLabel}`;
  const detailEl = document.getElementById('cost-sum-total-detail');
  if (detailEl) detailEl.textContent = totalCalls + ' API calls';

  const callsEl = document.getElementById('cost-sum-calls');
  if (callsEl) callsEl.textContent = totalCalls;
  const providerCounts = {};
  todayLog.forEach(c => { const p = c.provider || 'unknown'; providerCounts[p] = (providerCounts[p] || 0) + 1; });
  const topProvider = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0];
  const callsDetail = document.getElementById('cost-sum-calls-detail');
  if (callsDetail) callsDetail.textContent = topProvider ? `Most active: ${topProvider[0]} (${topProvider[1]})` : '';

  const opCosts = {};
  todayLog.forEach(c => { const op = c.op || 'unknown'; opCosts[op] = (opCosts[op] || 0) + (c.cost || 0); });
  const topOp = Object.entries(opCosts).sort((a, b) => b[1] - a[1])[0];
  const sumExpensive = document.getElementById('cost-sum-expensive');
  const sumExpensiveDetail = document.getElementById('cost-sum-expensive-detail');
  if (sumExpensive) {
    if (topOp && topOp[1] > 0) {
      sumExpensive.textContent = COST_OP_LABELS[topOp[0]] || topOp[0];
      if (sumExpensiveDetail) sumExpensiveDetail.textContent = costFmt(topOp[1]) + ' total';
    } else {
      sumExpensive.textContent = '--';
      if (sumExpensiveDetail) sumExpensiveDetail.textContent = 'No calls today';
    }
  }

  const chatEntries = todayLog.filter(c => c.op === 'chat');
  const avgChat = chatEntries.length > 0
    ? chatEntries.reduce((s, c) => s + (c.cost || 0), 0) / chatEntries.length
    : 0;
  const avgEl = document.getElementById('cost-sum-avg-chat');
  if (avgEl) avgEl.textContent = costFmtLong(avgChat);
  const avgDetail = document.getElementById('cost-sum-avg-chat-detail');
  if (avgDetail) avgDetail.textContent = chatEntries.length + ' chat calls today';
}

function renderCostOpBreakdown(todayLog) {
  const container = document.getElementById('cost-op-rows');
  if (!container) return;

  const ops = {};
  todayLog.forEach(c => { const op = c.op || 'unknown'; if (!ops[op]) ops[op] = { count: 0, cost: 0 }; ops[op].count++; ops[op].cost += (c.cost || 0); });
  const totalCost = todayLog.reduce((s, c) => s + (c.cost || 0), 0);
  const sorted = Object.entries(ops).sort((a, b) => b[1].cost - a[1].cost);

  if (sorted.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ci-text-tertiary);font-size:13px;">No API calls today</div>';
    return;
  }

  container.innerHTML = sorted.map(([op, data]) => {
    const label = COST_OP_LABELS[op] || op;
    const color = COST_OP_COLORS[op] || 'var(--ci-text-tertiary)';
    const pct = totalCost > 0 ? (data.cost / totalCost * 100) : 0;
    const avg = data.count > 0 ? data.cost / data.count : 0;
    return `<div class="cost-op-row">
      <div class="cost-op-name"><span class="cost-op-badge" style="background:${color}"></span>${costEscapeHtml(label)}</div>
      <div class="cost-op-mono">${data.count}</div>
      <div class="cost-op-mono">${costFmt(data.cost)}</div>
      <div class="cost-op-mono">${costFmtLong(avg)}</div>
      <div><div class="cost-op-bar-wrap"><div class="cost-op-bar-fill" style="width:${Math.max(pct, 1)}%;background:${color}"></div></div></div>
    </div>`;
  }).join('');
}

function renderCostProviders(usage, todayLog) {
  const container = document.getElementById('cost-provider-grid');
  if (!container) return;

  const modelsByProvider = {};
  const contextsByProvider = {};
  todayLog.forEach(c => {
    const p = c.provider || 'unknown';
    const m = c.model || 'unknown';
    if (!modelsByProvider[p]) modelsByProvider[p] = {};
    if (!modelsByProvider[p][m]) modelsByProvider[p][m] = { count: 0, cost: 0 };
    modelsByProvider[p][m].count++;
    modelsByProvider[p][m].cost += (c.cost || 0);

    // Group by op+context
    const ctxKey = c.context ? c.context : (c.op ? `(${COST_OP_LABELS[c.op] || c.op})` : '(unknown)');
    if (!contextsByProvider[p]) contextsByProvider[p] = {};
    if (!contextsByProvider[p][ctxKey]) contextsByProvider[p][ctxKey] = { count: 0, cost: 0, tokens: 0, op: c.op };
    contextsByProvider[p][ctxKey].count++;
    contextsByProvider[p][ctxKey].cost += (c.cost || 0);
    contextsByProvider[p][ctxKey].tokens += (c.input || 0) + (c.output || 0);
  });

  container.innerHTML = COST_PROVIDERS.map(key => {
    const pd = usage[key] || {};
    const name = COST_PROVIDER_NAMES[key] || key;
    const color = COST_PROVIDER_COLORS[key] || '#999';
    const cost = pd.costToday || 0;
    const requests = pd.requestsToday || 0;
    const tokensIn = pd.tokensToday?.input || 0;
    const tokensOut = pd.tokensToday?.output || 0;
    const errors = pd.errors || {};

    let modelsHtml = '';
    const models = modelsByProvider[key];
    if (models && Object.keys(models).length > 0) {
      const sorted = Object.entries(models).sort((a, b) => b[1].cost - a[1].cost);
      modelsHtml = `<div class="cost-provider-models">
        <div class="cost-provider-models-title">Models</div>
        ${sorted.map(([m, d]) => `<div class="cost-model-row">
          <span class="cost-model-name">${costEscapeHtml(m)}</span>
          <span class="cost-model-cost">${d.count} calls / ${costFmt(d.cost)}</span>
        </div>`).join('')}
      </div>`;
    }

    // Context drill-down: group by company/context, sorted by cost
    let detailsHtml = '';
    const ctxMap = contextsByProvider[key];
    if (ctxMap && Object.keys(ctxMap).length > 0) {
      const ctxSorted = Object.entries(ctxMap).sort((a, b) => b[1].cost - a[1].cost);
      const cardId = `ctx-detail-${key}`;
      detailsHtml = `
        <div class="cost-provider-details-toggle" data-target="${cardId}">Details &#9656;</div>
        <div class="cost-provider-details" id="${cardId}" style="display:none">
          <div class="cost-ctx-header">
            <span>Context</span><span>Calls</span><span>Tokens</span><span>Cost</span>
          </div>
          ${ctxSorted.map(([ctx, d]) => {
            const opColor = COST_OP_COLORS[d.op] || 'var(--ci-text-tertiary)';
            return `<div class="cost-ctx-row">
              <span class="cost-ctx-name" title="${costEscapeHtml(ctx)}">${costEscapeHtml(ctx)}</span>
              <span class="cost-ctx-val">${d.count}</span>
              <span class="cost-ctx-val">${costFmtTokens(d.tokens)}</span>
              <span class="cost-ctx-val" style="color:${opColor}">${costFmt(d.cost)}</span>
            </div>`;
          }).join('')}
        </div>`;
    }

    let errorHtml = '';
    if ((errors.count429 || 0) > 0) errorHtml += `<div class="cost-provider-error">Rate limited: ${errors.count429} x 429 errors</div>`;
    if ((errors.count401 || 0) > 0) errorHtml += `<div class="cost-provider-error">Auth error: ${errors.count401} x 401 errors</div>`;
    if ((errors.countOther || 0) > 0) errorHtml += `<div class="cost-provider-error">Other errors: ${errors.countOther}</div>`;

    const totalReqs = pd.totalRequests || 0;
    return `<div class="cost-provider-card">
      <div class="cost-provider-name"><span class="cost-provider-dot" style="background:${color}"></span>${costEscapeHtml(name)}</div>
      <div class="cost-provider-stat"><span class="cost-provider-stat-label">Calls today</span><span class="cost-provider-stat-value">${requests}</span></div>
      <div class="cost-provider-stat"><span class="cost-provider-stat-label">Tokens in / out</span><span class="cost-provider-stat-value">${costFmtTokens(tokensIn)} / ${costFmtTokens(tokensOut)}</span></div>
      <div class="cost-provider-stat"><span class="cost-provider-stat-label">Cost today</span><span class="cost-provider-stat-value">${costFmt(cost)}</span></div>
      <div class="cost-provider-stat" style="color:var(--ci-text-tertiary);font-size:12px;"><span class="cost-provider-stat-label">All time</span><span class="cost-provider-stat-value">${totalReqs.toLocaleString()} calls</span></div>
      ${modelsHtml}
      ${detailsHtml}
      ${errorHtml}
    </div>`;
  }).join('');

  // Wire up toggle clicks
  container.querySelectorAll('.cost-provider-details-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const isOpen = target.style.display !== 'none';
      target.style.display = isOpen ? 'none' : 'block';
      btn.innerHTML = isOpen ? 'Details &#9656;' : 'Details &#9662;';
    });
  });
}

function renderCostLog(callLog) {
  const container = document.getElementById('cost-log-rows');
  if (!container) return;
  const recent = callLog.slice(-50).reverse();

  if (recent.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ci-text-tertiary);font-size:13px;">No recent activity</div>';
    return;
  }

  container.innerHTML = recent.map(entry => {
    const time = new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = new Date(entry.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const op = entry.op || 'unknown';
    const label = COST_OP_LABELS[op] || op;
    const color = COST_OP_COLORS[op] || '#999';
    const ctxHtml = entry.context
      ? `<div style="font-size:10px;color:var(--ci-text-tertiary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${costEscapeHtml(entry.context)}">${costEscapeHtml(entry.context)}</div>`
      : '';
    return `<div class="cost-log-row">
      <div class="cost-log-time">${date} ${time}</div>
      <div><span class="cost-log-op-tag" style="background:${color}15;color:${color}">${costEscapeHtml(label)}</span>${ctxHtml}</div>
      <div class="cost-log-provider">${costEscapeHtml(entry.provider || '--')}</div>
      <div class="cost-log-model" title="${costEscapeHtml(entry.model || '--')}">${costEscapeHtml(entry.model || '--')}</div>
      <div class="cost-log-tokens">${costFmtTokens(entry.input || 0)} / ${costFmtTokens(entry.output || 0)}</div>
      <div class="cost-log-cost">${costFmt(entry.cost || 0)}</div>
    </div>`;
  }).join('');
}

function renderCostChart(usage) {
  const container = document.getElementById('cost-chart-container');
  if (!container) return;

  const dayMap = {};
  COST_PROVIDERS.forEach(key => {
    const pd = usage[key] || {};
    (pd.dailyHistory || []).forEach(entry => {
      if (!entry.date) return;
      dayMap[entry.date] = (dayMap[entry.date] || 0) + (entry.estimatedCost || 0);
    });
  });

  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    days.push({ date: ds, cost: dayMap[ds] || 0 });
  }

  const todayKey = costTodayStr();
  const todayEntry = days.find(d => d.date === todayKey);
  if (todayEntry && (usage.costToday || 0) > todayEntry.cost) {
    todayEntry.cost = usage.costToday || 0;
  }

  const maxCost = Math.max(...days.map(d => d.cost), 0.01);

  if (maxCost <= 0) {
    container.innerHTML = '<div style="text-align:center;padding:48px 24px;color:var(--ci-text-secondary);font-size:14px;">No cost history yet</div>';
    return;
  }

  const ySteps = 4;
  const yLabels = [];
  for (let i = ySteps; i >= 0; i--) yLabels.push(costFmt(maxCost * i / ySteps));

  const barsHtml = days.map(d => {
    const pct = d.cost > 0 ? Math.max((d.cost / maxCost) * 100, 2) : 0;
    const color = costBarColor(d.cost);
    const dayLabel = d.date.slice(5);
    const isToday = d.date === todayKey;
    return `<div class="cost-chart-bar-wrap">
      <div class="cost-chart-bar" style="height:${pct}%;background:${color};${isToday ? 'outline:2px solid var(--ci-accent-primary);outline-offset:1px;' : ''}">
        <div class="cost-chart-bar-tooltip">${d.date}: ${costFmt(d.cost)}</div>
      </div>
      <div class="cost-chart-label" style="${isToday ? 'font-weight:700;color:var(--ci-text-primary);' : ''}">${dayLabel}</div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="cost-chart-wrapper">
    <div class="cost-chart-y-axis">${yLabels.map(l => `<div class="cost-chart-y-label">${l}</div>`).join('')}</div>
    <div class="cost-chart-bars" style="flex:1;">${barsHtml}</div>
  </div>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// Tab switching
// ═══════════════════════════════════════════════════════════════════════════

function initTabs() {
  const tabs = document.querySelectorAll('.page-tab');
  const panels = document.querySelectorAll('.tab-panel');
  let costLoaded = false;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));

      if (target === 'usage' && !costLoaded) {
        costLoaded = true;
        loadAndRenderCosts();
      }
    });
  });

  // Auto-select tab if URL hash matches
  if (location.hash) {
    const target = location.hash.slice(1);
    const tab = document.querySelector(`[data-tab="${target}"]`);
    if (tab) tab.click();
  }

  // Settings sidebar nav — scroll-to-section + active tracking
  const navItems = document.querySelectorAll('.settings-nav-item');
  if (navItems.length) {
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const el = document.getElementById(item.dataset.section);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    const sections = [...navItems].map(n => ({ nav: n, el: document.getElementById(n.dataset.section) })).filter(s => s.el);
    window.addEventListener('scroll', () => {
      let current = sections[0];
      for (const s of sections) {
        if (s.el.getBoundingClientRect().top <= 100) current = s;
      }
      navItems.forEach(n => n.classList.remove('active'));
      if (current) current.nav.classList.add('active');
    }, { passive: true });
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Section 1: AI Models + Chat Fallback
  loadAIModelsSection();

  // Section 2: Personality (presets, tone/style, operating principles, custom instructions)
  // Section 4: Behavior (automations, Coop Assist, tool-use, sounds)
  // Both are initialized inside initCoopSettings() — it handles personality + behavior toggles
  initCoopSettings();

  // Section 3: Memory
  initCompiledProfileViewer();
  initCoopContextWindow();
  initKnowledgeDocsViewer();
  initCoopMemory();

  // Section 4: Behavior — quick prompts
  initCoopQuickPrompts();

  // Section 5: Usage & Costs
  loadUsageDashboard();

  // Tab switching
  initTabs();

  // Refresh dashboards every 30s — but only when tab is visible
  setInterval(() => {
    if (document.hidden) return;
    loadUsageDashboard();
    // Only refresh cost dashboard if the usage tab is active
    if (document.getElementById('tab-usage')?.classList.contains('active')) {
      loadAndRenderCosts();
    }
  }, 30000);
});
