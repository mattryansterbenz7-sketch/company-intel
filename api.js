// api.js — API call wrappers, fallback chain, cost tracking, model routing.

import { state, DEFAULT_PIPELINE_CONFIG } from './bg-state.js';

// ── Cost model ─────────────────────────────────────────────────────────────
export const MODEL_COST_PER_MTok = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
  'claude-opus-4-6':           { input: 15.00, output: 75.00 },
  'gpt-4.1-mini':              { input: 0.40, output: 1.60 },
  'gpt-4.1':                   { input: 2.00, output: 8.00 },
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

export async function trackApiCall(provider, response, model, opTag) {
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

    if (provider === 'anthropic' || provider === 'openai') {
      try {
        const data = await response.json();
        const inputTokens  = data.usage?.input_tokens || data.usage?.prompt_tokens || 0;
        const outputTokens = data.usage?.output_tokens || data.usage?.completion_tokens || 0;
        const cacheCreation = data.usage?.cache_creation_input_tokens || 0;
        const cacheRead     = data.usage?.cache_read_input_tokens || 0;
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
        usage.callLog.push({ ts: Date.now(), provider, model: model || provider, input: totalIn, output: outputTokens, cost: callCost, ...(opTag ? { op: opTag } : {}) });
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
export async function claudeApiCall(body, maxRetries = 3, opTag) {
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
    trackApiCall('anthropic', res.clone(), body.model, opTag);
    if (res.status === 429 && attempt < maxRetries) {
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[Claude] Rate limited (429), retrying in ${delay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

// ── OpenAI API call with retry ─────────────────────────────────────────────
export async function openAiChatCall({ model, system, messages, max_tokens, opTag }, maxRetries = 3) {
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
    trackApiCall('openai', res.clone(), model, opTag);
    if (res.status === 429 && attempt < maxRetries) {
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[OpenAI] Rate limited (429), retrying in ${delay/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

// ── Unified chat with automatic fallback ───────────────────────────────────
export async function chatWithFallback({ model, system, messages, max_tokens, tag, opTag }) {
  const isSplit = system && typeof system === 'object' && typeof system.base === 'string';
  const claudeSystem = isSplit
    ? [
        { type: 'text', text: system.base, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: system.tail, cache_control: { type: 'ephemeral' } },
      ]
    : system;
  const openAiSystem = isSplit ? (system.base + '\n' + system.tail) : system;

  const fbConfig = state.pipelineConfig?.chatFallback || { enabled: true, allowExpensive: false, showIndicator: true };
  const CHEAP_MODELS = new Set(['gpt-4.1-mini', 'claude-haiku-4-5-20251001']);
  const fullChain = [
    { id: 'gpt-4.1-mini', type: 'openai' },
    { id: 'claude-haiku-4-5-20251001', type: 'claude' },
    { id: 'claude-sonnet-4-6', type: 'claude' },
    { id: 'gpt-4.1', type: 'openai' },
  ];
  const ordered = [{ id: model, type: model.startsWith('gpt-') ? 'openai' : 'claude' }];
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

    try {
      if (candidate.type === 'openai') {
        const res = await openAiChatCall({ model: candidate.id, system: openAiSystem, messages, max_tokens, opTag });
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
      } else {
        const res = await claudeApiCall({ model: candidate.id, max_tokens, system: claudeSystem, messages }, 3, opTag);
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
export async function aiCall(taskId, { system, messages, max_tokens }, opTag) {
  const model = getModelForTask(taskId);

  if (model.startsWith('gpt-')) {
    if (!state.OPENAI_KEY) {
      console.warn(`[AI] OpenAI key missing for task ${taskId}, falling back to Claude`);
      const fallback = model.includes('mini') ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
      const res = await claudeApiCall({ model: fallback, system, messages, max_tokens }, 3, opTag);
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model: fallback };
    }
    const res = await openAiChatCall({ model, system, messages, max_tokens, opTag });
    const data = await res.json();
    return { ok: res.ok, status: res.status, text: data.choices?.[0]?.message?.content || '', raw: data, provider: 'openai', model };
  }

  if (!state.ANTHROPIC_KEY) {
    console.warn(`[AI] Anthropic key missing for task ${taskId}, falling back to OpenAI`);
    if (state.OPENAI_KEY) {
      const fallback = model.includes('sonnet') ? 'gpt-4.1' : 'gpt-4.1-mini';
      const res = await openAiChatCall({ model: fallback, system, messages, max_tokens, opTag });
      const data = await res.json();
      return { ok: res.ok, status: res.status, text: data.choices?.[0]?.message?.content || '', raw: data, provider: 'openai', model: fallback };
    }
    return { ok: false, status: 0, text: '', raw: {}, provider: 'none', model, error: 'No AI keys configured' };
  }

  const res = await claudeApiCall({ model, system, messages, max_tokens }, 3, opTag);
  const data = await res.json();
  return { ok: res.ok, status: res.status, text: data.content?.[0]?.text || '', raw: data, provider: 'anthropic', model };
}
