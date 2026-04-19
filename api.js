// api.js — API call wrappers, fallback chain, cost tracking, model routing.

import { state, DEFAULT_PIPELINE_CONFIG } from './bg-state.js';

// ── Voice profile prompt composition (#266) ───────────────────────────────────
//
// Reads personality dials from state.personalityDials and composes a
// "# Voice profile" block that prepends every Coop chat system prompt.
//
// Default anchor fragments for 3 dials × 5 ranges each.
// Keys are "{dial}.{range}" e.g. "tone.0_0_to_0_2"
const _DIAL_ANCHORS = {
  tone: {
    '0_0_to_0_2': 'Lead with the conclusion. No preamble, no softeners.',
    '0_2_to_0_4': 'Lead with the conclusion. Minimal acknowledgment before the point.',
    '0_4_to_0_6': 'Balance directness with acknowledgment.',
    '0_6_to_0_8': 'Lead with acknowledgment or context. Frame recommendations as suggestions when possible.',
    '0_8_to_1_0': 'Always start with acknowledgment. Avoid anything that reads as blunt or corrective.',
  },
  brevity: {
    '0_0_to_0_2': 'Answer in the fewest words possible. 1 sentence when you can.',
    '0_2_to_0_4': 'Keep responses tight — 1 to 3 sentences unless the user explicitly asks for detail.',
    '0_4_to_0_6': 'Match response length to question complexity.',
    '0_6_to_0_8': 'Provide context and reasoning alongside answers.',
    '0_8_to_1_0': 'Be thorough — unpack reasoning, alternatives, and edge cases even when not asked.',
  },
  formality: {
    '0_0_to_0_2': 'Use contractions, incomplete sentences when natural, informal vocabulary.',
    '0_2_to_0_4': 'Casual but complete. Contractions fine; slang OK.',
    '0_4_to_0_6': 'Neutral register.',
    '0_6_to_0_8': 'Proper grammar, complete sentences, professional vocabulary. No slang.',
    '0_8_to_1_0': 'Formal business register. No contractions. Complete, measured sentences.',
  },
};

/**
 * Map a dial value 0.0–1.0 to the anchor range key.
 * Ranges: [0,0.2) [0.2,0.4) [0.4,0.6) [0.6,0.8) [0.8,1.0]
 */
function _dialRangeKey(v) {
  const val = Math.max(0, Math.min(1, v));
  if (val < 0.2) return '0_0_to_0_2';
  if (val < 0.4) return '0_2_to_0_4';
  if (val < 0.6) return '0_4_to_0_6';
  if (val < 0.8) return '0_6_to_0_8';
  return '0_8_to_1_0';
}

/**
 * Compose a "Voice profile" system-prompt block from the three personality dials.
 * Returns empty string if dials are missing or malformed (safe fallback).
 *
 * @param {{ tone?: number, brevity?: number, formality?: number, anchorOverrides?: Object }} dials
 * @returns {string}
 */
export function composeVoiceProfilePrompt(dials) {
  try {
    if (!dials || typeof dials !== 'object') return '';
    const overrides = dials.anchorOverrides || {};

    const toneKey = _dialRangeKey(dials.tone ?? 0.5);
    const brevityKey = _dialRangeKey(dials.brevity ?? 0.5);
    const formalityKey = _dialRangeKey(dials.formality ?? 0.5);

    const toneText     = overrides[`tone.${toneKey}`]     || _DIAL_ANCHORS.tone[toneKey];
    const brevityText  = overrides[`brevity.${brevityKey}`] || _DIAL_ANCHORS.brevity[brevityKey];
    const formalText   = overrides[`formality.${formalityKey}`] || _DIAL_ANCHORS.formality[formalityKey];

    if (!toneText || !brevityText || !formalText) return '';

    return `# Voice profile\ntone: ${toneText}\nlength: ${brevityText}\nregister: ${formalText}\n`;
  } catch (err) {
    console.error('[composeVoiceProfilePrompt] error:', err);
    return '';
  }
}

// ── Rate-limit state (for degraded-mode banner in coop-settings) ──────────────
let _lastRateLimitedModel = null;

/**
 * Returns the model name that last hit a 429, or null if no rate limit has
 * occurred this session or the most recent call to that model succeeded.
 */
export function getLastRateLimitedModel() {
  return _lastRateLimitedModel;
}

// ── Cost model ─────────────────────────────────────────────────────────────
export const MODEL_COST_PER_MTok = {
  'claude-haiku-4-5-20251001':  { input: 1.00, output: 5.00 },
  'claude-sonnet-4-6':          { input: 3.00, output: 15.00 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00 },
  'gpt-4.1-nano':               { input: 0.10, output: 0.40 },
  'gpt-4.1-mini':               { input: 0.40, output: 1.60 },
  'gpt-4.1':                    { input: 2.00, output: 8.00 },
  'gemini-2.0-flash':           { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite':      { input: 0.05, output: 0.20 },
};

export function estimateCallCost(model, inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0) {
  const rates = MODEL_COST_PER_MTok[model] || { input: 1.00, output: 5.00 };
  const baseIn  = inputTokens * rates.input;
  const writeIn = cacheCreationTokens * rates.input * 1.25;
  const readIn  = cacheReadTokens * rates.input * 0.10;
  const out     = outputTokens * rates.output;
  return (baseIn + writeIn + readIn + out) / 1_000_000;
}

// ── Usage tracking ─────────────────────────────────────────────────────────
export function initProviderUsage() {
  return {
    totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0,
    requestsToday: 0, tokensToday: { input: 0, output: 0 },
    lastRequestAt: null, lastRateLimit: {},
    dailyHistory: [], errors: { count429: 0, count401: 0, countOther: 0 }
  };
}

export async function getApiUsage() {
  return new Promise(r => chrome.storage.local.get(['apiUsage'], d => r(d.apiUsage || { lastDayReset: '' })));
}

export async function saveApiUsage(usage) {
  return new Promise(r => chrome.storage.local.set({ apiUsage: usage }, r));
}

export async function trackApiCall(provider, response, model, opTag, context) {
  try {
    const usage = await getApiUsage();
    const today = new Date().toISOString().slice(0, 10);

    if (usage.lastDayReset !== today) {
      usage.costToday = 0;
      for (const key of Object.keys(usage)) {
        if (key === 'lastDayReset' || key === 'costToday') continue;
        const p = usage[key];
        if (p?.requestsToday !== undefined) {
          p.requestsToday = 0;
          p.costToday = 0;
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

    if (!response.ok) {
      if (response.status === 429) pd.errors.count429++;
      else if (response.status === 401 || response.status === 403) pd.errors.count401++;
      else pd.errors.countOther++;
    }

    let dayEntry = pd.dailyHistory.find(d => d.date === today);
    if (!dayEntry) {
      dayEntry = { date: today, requests: 0, inputTokens: 0, outputTokens: 0 };
      pd.dailyHistory.push(dayEntry);
    }
    dayEntry.requests++;
    pd.dailyHistory = pd.dailyHistory.slice(-30);

    if (provider === 'anthropic' || provider === 'openai' || provider === 'gemini') {
      try {
        const data = await response.json();
        let inputTokens, outputTokens, cacheCreation = 0, cacheRead = 0;
        if (provider === 'gemini') {
          // Gemini uses usageMetadata
          inputTokens  = data.usageMetadata?.promptTokenCount || 0;
          outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
        } else {
          inputTokens  = data.usage?.input_tokens || data.usage?.prompt_tokens || 0;
          outputTokens = data.usage?.output_tokens || data.usage?.completion_tokens || 0;
          cacheCreation = data.usage?.cache_creation_input_tokens || 0;
          cacheRead     = data.usage?.cache_read_input_tokens || 0;
        }
        const totalIn = inputTokens + cacheCreation + cacheRead;
        pd.totalInputTokens += totalIn;
        pd.totalOutputTokens += outputTokens;
        pd.tokensToday.input += totalIn;
        pd.tokensToday.output += outputTokens;
        dayEntry.inputTokens += totalIn;
        dayEntry.outputTokens += outputTokens;
        const callCost = estimateCallCost(model || '', inputTokens, outputTokens, cacheCreation, cacheRead);
        dayEntry.estimatedCost = (dayEntry.estimatedCost || 0) + callCost;
        if (typeof usage.costToday !== 'number') usage.costToday = 0;
        usage.costToday += callCost;
        if (typeof pd.costToday !== 'number') pd.costToday = 0;
        pd.costToday += callCost;
        const cacheNote = (cacheCreation || cacheRead)
          ? ` (cache: write=${cacheCreation} read=${cacheRead})`
          : '';
        console.log(`[Cost] ${model || provider} — in:${inputTokens} out:${outputTokens}${cacheNote} → $${callCost.toFixed(4)} (today: $${usage.costToday.toFixed(4)})`);
        if (!usage.callLog) usage.callLog = [];
        usage.callLog.push({ ts: Date.now(), provider, model: model || provider, input: totalIn, output: outputTokens, cost: callCost, ...(opTag ? { op: opTag } : {}), ...(context ? { context } : {}) });
        usage.callLog = usage.callLog.filter(c => c.ts > Date.now() - 86400000).slice(-500);
      } catch (costErr) {
        console.error('[Cost] Failed to track cost:', costErr.message);
      }
    }

    if (provider === 'anthropic') {
      pd.lastRateLimit = {
        tokensRemaining: parseInt(response.headers.get('anthropic-ratelimit-tokens-remaining')) || null,
        tokensLimit: parseInt(response.headers.get('anthropic-ratelimit-tokens-limit')) || null,
        requestsRemaining: parseInt(response.headers.get('anthropic-ratelimit-requests-remaining')) || null,
        requestsLimit: parseInt(response.headers.get('anthropic-ratelimit-requests-limit')) || null,
      };
    }

    await saveApiUsage(usage);
  } catch (outerErr) { console.error('[Cost] trackApiCall outer error:', outerErr.message); }
}

// ── Model routing ──────────────────────────────────────────────────────────
export function getModelForTask(taskId) {
  const models = state.pipelineConfig?.aiModels || {};
  const defaults = {
    companyIntelligence: 'claude-haiku-4-5-20251001',
    firmographicExtraction: 'claude-haiku-4-5-20251001',
    nextStepExtraction: 'claude-haiku-4-5-20251001',
    emailTaskExtraction: 'claude-haiku-4-5-20251001',
    quickFitScoring: 'claude-haiku-4-5-20251001',
    profileInterpret: 'claude-haiku-4-5-20251001',
    chat: 'claude-haiku-4-5-20251001',
    coopAutofill: 'claude-haiku-4-5-20251001',
    coopMemorySynthesis: 'claude-sonnet-4-6',
    jobMatchScoring: 'claude-haiku-4-5-20251001',
    roleBrief: 'claude-haiku-4-5-20251001',
    profileConsolidate: 'claude-haiku-4-5-20251001',
  };
  const fitModel = models.quickFitScoring;
  if (fitModel && ['jobMatchScoring', 'roleBrief', 'profileConsolidate'].includes(taskId) && !models[taskId]) {
    return fitModel;
  }
  return models[taskId] || defaults[taskId] || 'claude-haiku-4-5-20251001';
}

// ── Claude API call with retry ─────────────────────────────────────────────
export async function claudeApiCall(body, maxRetries = 3, opTag, context) {
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
        'x-api-key': state.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body)
    });
    trackApiCall('anthropic', res.clone(), body.model, opTag, context);
    if (res.status === 429 && attempt < maxRetries) {
      _lastRateLimitedModel = body.model;
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[Claude] Rate limited (429), retrying in ${delay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (res.ok) _lastRateLimitedModel = null;
    return res;
  }
}

// ── OpenAI API call with retry ─────────────────────────────────────────────
export async function openAiChatCall({ model, system, messages, max_tokens, opTag, context }, maxRetries = 3) {
  const oaiMessages = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      const oaiContent = m.content.map(block => {
        if (block.type === 'image' && block.source?.type === 'base64') {
          return { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
        }
        return block;
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
        'Authorization': `Bearer ${state.OPENAI_KEY}`
      },
      body: JSON.stringify({ model, messages: oaiMessages, max_tokens })
    });
    trackApiCall('openai', res.clone(), model, opTag, context);
    if (res.status === 429 && attempt < maxRetries) {
      _lastRateLimitedModel = model;
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[OpenAI] Rate limited (429), retrying in ${delay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (res.ok) _lastRateLimitedModel = null;
    return res;
  }
}

// ── Gemini API call with retry ─────────────────────────────────────────────
export async function geminiApiCall({ model, messages, system, max_tokens, tools, opTag, context }, maxRetries = 3) {
  // Convert Claude-style messages → Gemini contents format
  // Gemini uses 'user' and 'model' (not 'assistant')
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: Array.isArray(m.content)
      ? m.content.flatMap(block => {
          if (block.type === 'text') return [{ text: block.text }];
          if (block.type === 'tool_result') return [{ text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) }];
          if (block.type === 'tool_use') return [{ text: `[tool_use: ${block.name}(${JSON.stringify(block.input)})]` }];
          return [];
        })
      : [{ text: m.content || '' }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens || 8192 },
  };

  // System instruction (optional)
  if (system) {
    const sysText = typeof system === 'string' ? system
      : Array.isArray(system) ? system.map(b => b.text || '').join('\n')
      : (typeof system === 'object' && system.base) ? (system.base + '\n' + (system.tail || ''))
      : '';
    if (sysText) body.systemInstruction = { parts: [{ text: sysText }] };
  }

  // Tools (function declarations)
  if (tools && tools.length) {
    body.tools = [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema || t.parameters || { type: 'object', properties: {}, required: [] },
      })),
    }];
  }

  const apiKey = state.GEMINI_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    trackApiCall('gemini', res.clone(), model, opTag, context);
    if (res.status === 429 && attempt < maxRetries) {
      _lastRateLimitedModel = model;
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[Gemini] Rate limited (429), retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (res.ok) _lastRateLimitedModel = null;
    return res;
  }
}

// ── Unified chat with automatic fallback ───────────────────────────────────
export async function chatWithFallback({ model, system, messages, max_tokens, tag, opTag, context }) {
  const isSplit = system && typeof system === 'object' && typeof system.base === 'string';
  const claudeSystem = isSplit
    ? [
        { type: 'text', text: system.base, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: system.tail, cache_control: { type: 'ephemeral' } },
      ]
    : system;
  const openAiSystem = isSplit ? (system.base + '\n' + system.tail) : system;

  const fbConfig = state.pipelineConfig?.chatFallback || { enabled: true, allowExpensive: false, showIndicator: true };
  const CHEAP_MODELS = new Set(['gpt-4.1-nano', 'gemini-2.0-flash-lite', 'gpt-4.1-mini', 'claude-haiku-4-5-20251001', 'gemini-2.0-flash']);
  const fullChain = [
    { id: 'gpt-4.1-nano',              type: 'openai' },
    { id: 'gemini-2.0-flash-lite',     type: 'gemini' },
    { id: 'gpt-4.1-mini',              type: 'openai' },
    { id: 'claude-haiku-4-5-20251001', type: 'claude' },
    { id: 'gemini-2.0-flash',          type: 'gemini' },
    { id: 'claude-sonnet-4-6',         type: 'claude' },
    { id: 'gpt-4.1',                   type: 'openai' },
  ];
  const modelType = model.startsWith('gpt-') ? 'openai' : model.startsWith('gemini-') ? 'gemini' : 'claude';
  const ordered = [{ id: model, type: modelType }];
  if (fbConfig.enabled) {
    for (const fb of fullChain) {
      if (fb.id === model) continue;
      // Skip expensive models unless explicitly allowed
      if (!fbConfig.allowExpensive && !CHEAP_MODELS.has(fb.id)) continue;
      ordered.push(fb);
    }
  }

  let lastError = null;
  for (const candidate of ordered) {
    if (candidate.type === 'openai' && !state.OPENAI_KEY) continue;
    if (candidate.type === 'claude' && !state.ANTHROPIC_KEY) continue;
    if (candidate.type === 'gemini' && !state.GEMINI_KEY) continue;

    try {
      if (candidate.type === 'openai') {
        const res = await openAiChatCall({ model: candidate.id, system: openAiSystem, messages, max_tokens, opTag, context });
        const data = await res.json();
        if (res.ok) {
          const reply = data.choices?.[0]?.message?.content || 'No response.';
          const didFallback = candidate.id !== model;
          if (didFallback) console.warn(`[${tag}] Fell back from ${model} to ${candidate.id}`);
          const usage = {
            input: data.usage?.prompt_tokens || 0,
            output: data.usage?.completion_tokens || 0,
            cacheCreation: 0,
            cacheRead: 0,
          };
          return { reply, usedModel: candidate.id, usage, fellBack: didFallback, originalModel: didFallback ? model : undefined };
        }
        lastError = data?.error?.message || `OpenAI error ${res.status}`;
        console.warn(`[${tag}] ${candidate.id} failed (${res.status}): ${lastError}, trying next...`);
      } else if (candidate.type === 'gemini') {
        const res = await geminiApiCall({ model: candidate.id, messages, system: isSplit ? (system.base + '\n' + system.tail) : system, max_tokens, opTag, context });
        const data = await res.json();
        if (res.ok) {
          // Extract text from Gemini response — may be a functionCall or text part
          const candidate0 = data.candidates?.[0];
          const parts = candidate0?.content?.parts || [];
          const textPart = parts.find(p => typeof p.text === 'string');
          const reply = textPart?.text || 'No response.';
          const toolCallPart = parts.find(p => p.functionCall);
          const toolCalls = toolCallPart ? [{ name: toolCallPart.functionCall.name, input: toolCallPart.functionCall.args }] : undefined;
          const didFallback = candidate.id !== model;
          if (didFallback) console.warn(`[${tag}] Fell back from ${model} to ${candidate.id}`);
          const usage = {
            input: data.usageMetadata?.promptTokenCount || 0,
            output: data.usageMetadata?.candidatesTokenCount || 0,
            cacheCreation: 0,
            cacheRead: 0,
          };
          return { reply, usedModel: candidate.id, usage, fellBack: didFallback, originalModel: didFallback ? model : undefined, ...(toolCalls ? { toolCalls } : {}) };
        }
        lastError = data?.error?.message || `Gemini error ${res.status}`;
        console.warn(`[${tag}] ${candidate.id} failed (${res.status}): ${lastError}, trying next...`);
      } else {
        const res = await claudeApiCall({ model: candidate.id, max_tokens, system: claudeSystem, messages }, 3, opTag, context);
        const data = await res.json();
        if (res.ok) {
          const reply = data.content?.[0]?.text || 'No response.';
          const didFallback = candidate.id !== model;
          if (didFallback) console.warn(`[${tag}] Fell back from ${model} to ${candidate.id}`);
          const usage = {
            input: data.usage?.input_tokens || 0,
            output: data.usage?.output_tokens || 0,
            cacheCreation: data.usage?.cache_creation_input_tokens || 0,
            cacheRead: data.usage?.cache_read_input_tokens || 0,
          };
          return { reply, usedModel: candidate.id, usage, fellBack: didFallback, originalModel: didFallback ? model : undefined };
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

// ── Generic AI call router ─────────────────────────────────────────────────
export async function aiCall(taskId, { system, messages, max_tokens }, opTag, context) {
  const model = getModelForTask(taskId);

  if (model.startsWith('gemini-')) {
    if (!state.GEMINI_KEY) {
      console.warn(`[AI] Gemini key missing for task ${taskId}, falling back to Claude`);
      const fallback = model.includes('lite') ? 'claude-haiku-4-5-20251001' : 'claude-haiku-4-5-20251001';
      const res = await claudeApiCall({ model: fallback, system, messages, max_tokens }, 3, opTag, context);
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model: fallback };
    }
    const res = await geminiApiCall({ model, messages, system, max_tokens, opTag, context });
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find(p => typeof p.text === 'string');
    return { ok: res.ok, status: res.status, text: textPart?.text || '', raw: data, provider: 'gemini', model };
  }

  if (model.startsWith('gpt-')) {
    if (!state.OPENAI_KEY) {
      console.warn(`[AI] OpenAI key missing for task ${taskId}, falling back to Claude`);
      const fallback = model.includes('mini') ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
      const res = await claudeApiCall({ model: fallback, system, messages, max_tokens }, 3, opTag, context);
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model: fallback };
    }
    const res = await openAiChatCall({ model, system, messages, max_tokens, opTag, context });
    const data = await res.json();
    return { ok: res.ok, status: res.status, text: data.choices?.[0]?.message?.content || '', raw: data, provider: 'openai', model };
  }

  if (!state.ANTHROPIC_KEY) {
    console.warn(`[AI] Anthropic key missing for task ${taskId}, falling back to OpenAI`);
    if (state.OPENAI_KEY) {
      const fallback = model.includes('sonnet') ? 'gpt-4.1' : 'gpt-4.1-mini';
      const res = await openAiChatCall({ model: fallback, system, messages, max_tokens, opTag, context });
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.choices?.[0]?.message?.content || '', raw: data, provider: 'openai', model: fallback };
    }
    return { ok: false, status: 0, text: '', raw: {}, provider: 'none', model, error: 'No AI keys configured' };
  }

  const res = await claudeApiCall({ model, system, messages, max_tokens }, 3, opTag, context);
  const data = await res.json();
  return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model };
}
