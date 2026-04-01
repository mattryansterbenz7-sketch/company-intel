// Floating sidebar is the primary UI — icon click toggles it
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) return;
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' }, () => void chrome.runtime.lastError);
});

// Load API keys: storage-based (user-configurable) with config.js fallback
try { importScripts('config.js'); } catch(e) { /* no config.js — keys must be set via Integrations page */ }
const _cfg = (typeof CONFIG !== 'undefined') ? CONFIG : {};

let ANTHROPIC_KEY = _cfg.ANTHROPIC_KEY || '';
let APOLLO_KEY = _cfg.APOLLO_KEY || '';
let SERPER_KEY = _cfg.SERPER_KEY || '';
let OPENAI_KEY = _cfg.OPENAI_KEY || '';
let GRANOLA_KEY = '';

// Override with storage-based keys on boot
chrome.storage.local.get(['integrations'], ({ integrations }) => {
  if (!integrations) { console.log('[Keys] No integrations in storage, using config.js'); return; }
  console.log('[Keys] Loading from storage:', Object.keys(integrations).filter(k => !!integrations[k]).join(', '));
  console.log('[Keys] OpenAI key present:', !!integrations.openai_key, '| length:', (integrations.openai_key || '').length);
  if (integrations.anthropic_key) ANTHROPIC_KEY = integrations.anthropic_key;
  if (integrations.openai_key)    OPENAI_KEY = integrations.openai_key;
  if (integrations.apollo_key)    APOLLO_KEY = integrations.apollo_key;
  if (integrations.serper_key)    SERPER_KEY = integrations.serper_key;
  if (integrations.granola_key)   GRANOLA_KEY = integrations.granola_key;
  if (GRANOLA_KEY) setTimeout(() => buildGranolaIndex(), 5000);
});

// Live-update keys when user saves them from Integrations page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.integrations) {
    const v = changes.integrations.newValue || {};
    if (v.anthropic_key) ANTHROPIC_KEY = v.anthropic_key;
    if (v.apollo_key)    APOLLO_KEY = v.apollo_key;
    if (v.serper_key)    SERPER_KEY = v.serper_key;
    if (v.openai_key)    OPENAI_KEY = v.openai_key;
    if (v.granola_key)   GRANOLA_KEY = v.granola_key;
    _apolloExhausted = false;
    _serperExhausted = false;
  }
});

// Periodic Granola index refresh (every 6 hours, using setInterval — no alarms permission needed)
setInterval(() => { if (GRANOLA_KEY) buildGranolaIndex(); }, 6 * 60 * 60 * 1000);

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

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — persisted to storage, survives SW restarts

// ── AI Scoring Queue Config ─────────────────────────────────────────────────
const QUICK_FIT_MODEL = 'claude-haiku-4-5-20251001';
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
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
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
    oaiMessages.push({ role: m.role, content: m.content });
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
    { id: 'claude-sonnet-4-5-20250514', type: 'claude' },
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
          return { reply, usedModel: candidate.id };
        }
        lastError = data?.error?.message || `OpenAI error ${res.status}`;
        console.warn(`[${tag}] ${candidate.id} failed (${res.status}): ${lastError}, trying next...`);
      } else {
        const res = await claudeApiCall({ model: candidate.id, max_tokens, system, messages });
        const data = await res.json();
        if (res.ok) {
          const reply = data.content?.[0]?.text || 'No response.';
          if (candidate.id !== model) console.warn(`[${tag}] Fell back from ${model} to ${candidate.id}`);
          return { reply, usedModel: candidate.id };
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

const photoCache = {}; // in-memory, per service worker lifetime
let _apolloExhausted = false;
let _serperExhausted = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    Promise.all(leaders.map(l => fetchLeaderPhoto(l.name, `"${company}"`))).then(photos => {
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
  if (message.type === 'GMAIL_REVOKE') {
    gmailRevoke().then(sendResponse);
    return true;
  }
  if (message.type === 'CHAT_MESSAGE') {
    handleChatMessage(message).then(sendResponse);
    return true;
  }
  if (message.type === 'CALENDAR_FETCH_EVENTS') {
    fetchCalendarEvents(message.domain, message.companyName, message.knownContactEmails).then(sendResponse);
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
    extractNextSteps(message.notes, message.calendarEvents, message.transcripts).then(sendResponse);
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
  if (message.type === 'GET_KEY_STATUS') {
    sendResponse({
      anthropic: !!ANTHROPIC_KEY,
      apollo: !!APOLLO_KEY,
      serper: !!SERPER_KEY,
      openai: !!OPENAI_KEY,
      granola: !!GRANOLA_KEY,
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
      model: 'claude-haiku-4-5-20251001',
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

// ── Quick Fit Scoring ────────────────────────────────────────────────────────

async function processQuickFitScore(entryId) {
  // Load entry from storage
  const { savedCompanies } = await new Promise(resolve =>
    chrome.storage.local.get(['savedCompanies'], resolve)
  );
  const entries = savedCompanies || [];
  const entry = entries.find(e => e.id === entryId);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  // Load user profile data
  const localData = await new Promise(resolve =>
    chrome.storage.local.get(['profileGreenLights', 'profileRedLights', 'profileSkills'], resolve)
  );
  const syncData = await new Promise(resolve =>
    chrome.storage.sync.get(['prefs'], resolve)
  );
  const prefs = syncData.prefs || {};
  const greenLights = localData.profileGreenLights || 'Not specified';
  const redLights = localData.profileRedLights || 'Not specified';
  const skills = localData.profileSkills || 'Not specified';

  const jobDesc = (entry.jobDescription || '').slice(0, 3000);

  const prompt = `You are a job fit screener. Based on the candidate's preferences and the job posting, give a quick fit score from 1-10 and a one-sentence reason.

[Candidate Preferences]
Green lights: ${greenLights}
Red lights: ${redLights}
Background: ${skills}
Compensation: Base floor $${prefs.salaryFloor || 'Not specified'}, OTE floor $${prefs.oteFloor || 'Not specified'}
Location: ${prefs.userLocation || 'Not specified'}, prefers ${prefs.workArrangement || 'Not specified'}

[Job Posting]
Company: ${entry.company || 'Unknown'}
Title: ${entry.jobTitle || 'Unknown'}
Compensation: ${entry.salary || 'Not specified'}
Arrangement: ${entry.workArrangement || 'Not specified'}
Description (first 3000 chars): ${jobDesc}

Quick Take: Include 2-4 of the most decisive signals as quickTake bullets (green for strong fits, red for dealbreakers). Lead with the single most important signal. Keep each to 8-15 words max.

Hard DQ: Set hardDQ.flagged to true ONLY when there is a genuine dealbreaker that makes this role dead on arrival:
- Work arrangement is On-site/Hybrid when candidate requires Remote
- Base salary maximum is below candidate's salary floor
- Role function is fundamentally different from candidate's target roles (e.g., engineering role for a sales person)
- Location requires relocation with no remote option
If none of these apply, set hardDQ.flagged to false with empty reasons array.

IMPORTANT: The "reason" field should explain WHY you gave this score — do NOT repeat the job title or company name. Focus on fit signals (e.g., "Strong alignment on GTM leadership + remote, but comp range is below floor").

Respond in JSON only: {"score": number 1-10, "reason": "one sentence explaining the score", "quickTake": [{"type": "green/red", "text": "short signal"}], "hardDQ": {"flagged": boolean, "reasons": ["reason"]}}`;

  const { reply, error } = await chatWithFallback({
    model: QUICK_FIT_MODEL,
    system: 'You are a precise job-fit scoring assistant. Respond with valid JSON only.',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
    tag: 'QuickFit'
  });

  if (error) throw new Error(error);

  // Parse response
  let score = null;
  let reason = 'Could not parse response';
  let quickTake = [];
  let hardDQ = { flagged: false, reasons: [] };
  try {
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      score = Number(parsed.score);
      reason = parsed.reason || 'No reason provided';
      quickTake = parsed.quickTake || [];
      hardDQ = parsed.hardDQ || { flagged: false, reasons: [] };
    }
  } catch (parseErr) {
    console.warn('[QuickFit] Failed to parse response:', reply);
    throw new Error('Failed to parse scoring response');
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
    await new Promise(resolve =>
      chrome.storage.local.set({ savedCompanies: freshEntries }, resolve)
    );
  }

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
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: `From these search results about "${company}", extract: industry, employee count, funding, founded year. Return JSON only: {"industry":"...","employees":"...","funding":"...","founded":"..."}\n\n${snippets.slice(0, 2000)}` }] })
        });
        const d = await res.json();
        if (!res.ok) { console.log('[Enrich] Haiku API error:', res.status, d); }
        else {
          let t = (d.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
          // Strip trailing text after JSON (Haiku sometimes appends notes)
          const lastBrace = t.lastIndexOf('}');
          if (lastBrace > 0) t = t.slice(0, lastBrace + 1);
          console.log('[Enrich] Haiku raw response:', t);
          aiEstimate = JSON.parse(t);
          console.log('[Enrich] Haiku parsed:', aiEstimate);
        }
      } catch(e) { console.log('[Enrich] Haiku parse error:', e.message); }
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
const ENRICHMENT_PROVIDERS = [enrichFromApollo, enrichFromWebResearch];

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
  for (const provider of ENRICHMENT_PROVIDERS) {
    const result = await provider(company, derivedDomain);
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
  return new Promise(resolve =>
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const entry = (researchCache || {})[key];
      resolve(entry && Date.now() - entry.ts < CACHE_TTL ? entry.data : null);
    })
  );
}

async function setCached(key, data) {
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

    // Now run Serper searches with the best domain info available
    // When Serper is exhausted, skip jobs & product searches to reduce expensive fallback calls
    let reviewResults, leaderResults, jobResults, productResults;
    if (_serperExhausted) {
      console.warn('[Research] Serper exhausted — running only 2 of 4 searches (reviews + leadership); skipping jobs & product to limit expensive fallback usage');
      [reviewResults, leaderResults] = await Promise.all([
        fetchSearchResults(`${qd} (site:glassdoor.com/Reviews OR site:glassdoor.com/Overview OR site:repvue.com OR site:blind.app OR reddit.com "${company}" reviews culture)`, 8),
        fetchSearchResults('site:linkedin.com/in ' + qd + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', 5),
      ]);
      jobResults = [];
      productResults = [];
    } else {
      [reviewResults, leaderResults, jobResults, productResults] = await Promise.all([
        fetchSearchResults(`${qd} (site:glassdoor.com/Reviews OR site:glassdoor.com/Overview OR site:repvue.com OR site:blind.app OR reddit.com "${company}" reviews culture)`, 8),
        fetchSearchResults('site:linkedin.com/in ' + qd + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', 5),
        fetchSearchResults(qd + ' jobs hiring (site:linkedin.com OR site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com OR site:wellfound.com)', 5),
        fetchSearchResults(qd + ' what does it do product overview how it works category', 3),
      ]);
    }

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
  if (rc.matchFeedback) richSection += `\nPrevious assessment feedback: ${rc.matchFeedback}\n`;

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
3. Red flags must be genuine concerns a reasonable person would want to know — not stylistic differences or things the user said they're okay with. If the user hasn't flagged something as a dealbreaker, don't treat it as one.
4. Travel: if the posting explicitly mentions travel requirements, compare against max travel preference and flag only if it clearly exceeds it.
5. Bridge the language gap: the user describes themselves in personal terms; job postings use corporate language. Map them — e.g. "I love autonomy and building from scratch" → look for early-stage, greenfield, founder-led signals. "Manage and grow existing accounts" → retention focus, not new business ownership.
6. Read between the lines on culture, scope, and autonomy — but only from what the posting actually implies, not from what it omits.
7. Use loved/hated role examples as calibration for concrete signals you find in the posting.
8. Salary: extract the BASE salary or base salary range if stated anywhere in the posting (including legal/compliance disclosure sections at the bottom). If multiple figures are given (e.g., base + OTE/commission), extract the base salary only and set salaryType to "base". If only total/OTE compensation is mentioned, extract that and set salaryType to "ote". If no number is mentioned anywhere, use null for both.
9. Do NOT flag missing salary information as a red flag. Most job postings don't include salary — it's normal and expected, not a negative signal.
10. Compensation evaluation — compare disclosed pay against the candidate's thresholds:
  - If BASE salary is disclosed and is below the candidate's BASE floor → MAJOR red flag with specific numbers (e.g., "Base $80K is below your $150K base floor"). Drop score by 2+ points.
  - If only OTE/total comp is disclosed and is below the candidate's OTE floor → red flag (e.g., "OTE $160K is below your $200K OTE floor"). Drop score by 1-2 points.
  - If OTE is disclosed but no base is separated, do NOT compare OTE against the BASE floor — they are different numbers. A $200K OTE does not mean $200K base.
  - Clearly label extracted compensation as "Base" or "OTE" in the jobSnapshot fields. Never leave ambiguous.
11. OTE (On-Target Earnings) ranges without explicit base salary separation are COMPLETELY NORMAL for sales roles — do NOT flag this as a red flag. "Wide OTE range" is not a red flag. "Base not separated from OTE" is not a red flag. Only flag compensation as a red flag if the OTE or base is clearly below the candidate's salary floor.
12. Do NOT flag missing travel information as a red flag. Most job postings don't mention travel requirements — this is normal and not a negative signal. Only flag travel as a red flag if travel is explicitly required AND it exceeds the user's max travel preference.
13. For workArrangement in jobSnapshot: if the LinkedIn posting explicitly says "Remote" in its chips/tags, set workArrangement to "Remote" even if the job description mentions a specific geography or territory (e.g., "Southeast region"). Territory assignments do NOT mean on-site — they define sales coverage area, not work location.

Quick Take: Include 2-4 of the most decisive signals as quickTake bullets (green for strong fits, red for dealbreakers). Lead with the single most important signal. Keep each to 8-15 words max.

Hard DQ: Set hardDQ.flagged to true ONLY when there is a genuine dealbreaker that makes this role dead on arrival:
- Work arrangement is On-site/Hybrid when candidate requires Remote
- Base salary maximum is below candidate's salary floor
- Role function is fundamentally different from candidate's target roles (e.g., engineering role for a sales person)
- Location requires relocation with no remote option
If none of these apply, set hardDQ.flagged to false with empty reasons array.

{
  "jobMatch": {
    "jobSummary": "<2-3 sentences on core responsibilities and what success looks like in this role>",
    "score": <1-10 fit score: work arrangement, skills vs background, role type vs targets, loved/hated role signals>,
    "verdict": "<one direct, honest sentence — should they apply and why>",
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
    const res = await claudeApiCall({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1100,
        messages: [{ role: 'user', content: prompt }]
    });
    const data = await res.json();
    // Fallback through all models on rate limit
    if (res.status === 429 || (data.error && /rate.limit/i.test(data.error.message || ''))) {
      console.warn('[AnalyzeJob] Claude rate limited, trying fallback chain...');
      const result = await chatWithFallback({
        model: 'gpt-4.1-mini',
        system: 'You are a JSON-only analyst. Respond with valid JSON only.',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1100,
        tag: 'AnalyzeJob'
      });
      if (!result.error) {
        return JSON.parse(result.reply.replace(/```json|```/g, '').trim());
      }
    }
    const clean = data.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
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
      if (res.status === 429 || res.status === 402) return { ok: false, status: res.status, reason: 'Key valid — credits exhausted' };
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
  const cacheKey = `${name}|${company}`;
  if (photoCache[cacheKey] !== undefined) return photoCache[cacheKey];
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
      body: JSON.stringify({ q: name + ' ' + company, num: 1 })
    });
    const data = await res.json();
    const photoUrl = data.images?.[0]?.thumbnailUrl || null;
    photoCache[cacheKey] = photoUrl;
    return photoUrl;
  } catch {
    photoCache[cacheKey] = null;
    return null;
  }
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
    openai: OPENAI_KEY ? 'available' : 'no key',
    claude: ANTHROPIC_KEY ? 'available' : 'no key',
  });

  // 1. Serper (free credits)
  if (SERPER_KEY && !_serperExhausted) {
    console.log('[Search] Trying Serper...');
    const results = await fetchSerperResults(query, num);
    if (results.length > 0) { console.log('[Search] Serper returned', results.length, 'results'); return results; }
    console.log('[Search] Serper returned 0 results');
  }
  // 2. OpenAI Web Search (separate rate limits from Claude)
  if (OPENAI_KEY) {
    console.warn('[Search] Using expensive fallback: OpenAI web search (Serper exhausted)');
    const results = await fetchOpenAIWebSearch(query, num);
    if (results.length > 0) { console.log('[Search] OpenAI returned', results.length, 'results'); results._usedExpensiveFallback = true; return results; }
    console.log('[Search] OpenAI returned 0 results');
  }
  // 3. Claude Web Search (last resort)
  if (ANTHROPIC_KEY) {
    console.warn('[Search] Using expensive fallback: Claude web search (Serper exhausted)');
    const results = await fetchClaudeWebSearch(query, num);
    if (results.length > 0) { console.log('[Search] Claude returned', results.length, 'results'); results._usedExpensiveFallback = true; return results; }
    console.log('[Search] Claude returned 0 results');
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

Respond with a JSON object only, no markdown:
{
  "intelligence": {
    "oneLiner": "<one sentence, plain English — what does this company do and for whom>",
    "eli5": "<2-3 sentences explaining what they do like you're explaining to a smart friend>",
    "whosBuyingIt": "<who are the typical buyers — role, company size, pain point>",
    "category": "<type of company, e.g. 'B2B SaaS, payments infrastructure'>",
    "howItWorks": "<2-3 sentences on core product mechanics and what makes it defensible>"
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

  let res = await claudeApiCall({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
  });

  let data = await res.json();
  // On Claude rate limit, fall back through all available models
  if (res.status === 429 || (data.error && /rate.limit/i.test(data.error.message || ''))) {
    console.warn('[Research] Claude rate limited, trying fallback chain...');
    const result = await chatWithFallback({
      model: 'gpt-4.1-mini',
      system: 'You are a JSON-only research assistant. Respond with valid JSON only, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      tag: 'Research'
    });
    if (result.error) throw new Error('AI is busy — too many requests. Try again in a moment.');
    const fbClean = result.reply.replace(/```json|```/g, '').trim();
    try { return JSON.parse(fbClean); } catch { return JSON.parse(fbClean.slice(0, fbClean.lastIndexOf('}') + 1)); }
  }
  // Surface API-level errors with friendly messages
  if (data.error) {
    const msg = data.error.message || data.error.type || '';
    if (/rate.limit/i.test(msg)) throw new Error('AI is busy — too many requests. Try again in a moment.');
    throw new Error('AI analysis temporarily unavailable. Try refreshing.');
  }
  if (!res.ok) throw new Error('AI analysis temporarily unavailable. Try refreshing.');
  const raw = data.content?.[0]?.text;
  if (!raw) throw new Error('Empty response from Claude');
  const clean = raw.replace(/```json|```/g, '').trim();
  // If JSON is truncated (common with low max_tokens), attempt partial recovery
  try {
    return JSON.parse(clean);
  } catch (e) {
    // Try to find the largest valid JSON object in the response
    const lastBrace = clean.lastIndexOf('}');
    if (lastBrace > 0) {
      return JSON.parse(clean.slice(0, lastBrace + 1));
    }
    throw e;
  }
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
        if (isBootstrap && companyName) {
          parts.push(`"${companyName}"`);
          // Also search shorter name (strip common suffixes like "AI", "Inc", etc.)
          // so casual emails without full brand name are still found
          const shortName = companyName.replace(/\s+(AI|Inc\.?|LLC|Corp\.?|Ltd\.?|Co\.?|Technologies|Tech|Labs?|Group|Solutions?|Services?|Systems?|Software|Platform|Studios?|Ventures?)$/i, '').trim();
          if (shortName && shortName !== companyName) parts.push(`"${shortName}"`);
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

        // Get user's own email for contact deduplication
        let userEmail = null;
        try {
          const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
          const profile = await profileRes.json();
          userEmail = profile.emailAddress?.toLowerCase() || null;
          if (userEmail) chrome.storage.local.set({ gmailUserEmail: userEmail });
        } catch(e) {}
        resolve({ emails: allEmails, userEmail });
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

async function handleChatMessage({ messages, context, chatModel }) {
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
    `You are a sharp, concise strategic advisor embedded in CompanyIntel — a personal job search intelligence tool. You have deep, full context about this ${context.type === 'job' ? 'job opportunity' : 'company'} including meeting transcripts, emails, notes, and company research. Use ALL available context to give specific, grounded answers. If something isn't in your context, say so — never fabricate.\n\nResponse style: Keep answers short and direct. Use short paragraphs, not walls of text. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless the user asks for a structured breakdown. Write like a smart colleague in Slack, not a formal report.\n\nFormatting capabilities: Your responses are rendered as rich HTML. You can use full markdown: **bold**, *italic*, [links](url), bullet lists, numbered lists, \`inline code\`, fenced code blocks, and images via ![alt](url). Links will be clickable and open in new tabs. Images will render inline. Use these when they add value — don't force formatting where plain text works.`,
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
    const insights = storyTime.learnedInsights.slice(-20);
    systemParts.push(`\n[AI-Learned Insights]\n${insights.map(i => `- ${i.insight}`).join('\n')}`);
  }

  try {
    const systemText = systemParts.join('\n');
    console.log('[Chat] System prompt length:', systemText.length, 'chars');
    const model = chatModel || 'gpt-4.1-mini';
    console.log('[Chat] Using model:', model);
    const result = await chatWithFallback({ model, system: systemText, messages, max_tokens: 2048, tag: 'Chat' });
    if (result.error) return result;
    // Passive learning: extract insights in background (non-blocking)
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    extractInsightsFromChat(lastUserMsg, result.reply, `chat:${context.company || 'unknown'}`);
    return { reply: result.reply, model: result.usedModel };
  } catch (err) {
    console.error('[Chat] Error:', err);
    return { error: err.message };
  }
}

// ── Global Chat (Pipeline Advisor) ───────────────────────────────────────────

async function handleGlobalChatMessage({ messages, pipeline, enrichments, chatModel }) {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r)); // for learnedInsights

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const systemParts = [
    `You are the user's strategic career advisor with full visibility across their job search pipeline. You know their background, values, and preferences. You can see every company and opportunity they're tracking.\n\nHelp them prioritize opportunities, draft follow-up messages, compare options, and make strategic decisions. When they mention a specific company or person, use the pipeline context to inform your response.\n\nIf they ask you to draft a message, email, or follow-up — pull from what you know about that company's stage, contacts, notes, and context to write something specific and actionable.\n\nBe direct, opinionated, and honest. Push back when something doesn't align with what you know about them. Don't be sycophantic.\n\nResponse style: Keep answers short and direct. Use short paragraphs. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless asked. Write like a smart colleague in Slack, not a formal report.\n\nFormatting capabilities: Your responses are rendered as rich HTML. You can use full markdown: **bold**, *italic*, [links](url), bullet lists, numbered lists, \`inline code\`, fenced code blocks, and images via ![alt](url). Links will be clickable. Images will render inline. Use these when they add value.`,
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
    systemParts.push(`\n[AI-Learned Insights]\n${storyTime.learnedInsights.slice(-20).map(i => `- ${i.insight}`).join('\n')}`);
  }

  // Pipeline summary
  if (pipeline) {
    const companyCount = pipeline.split('\n').length;
    systemParts.push(`\n=== YOUR PIPELINE (${companyCount} entries) ===\n${pipeline}`);
  }

  // Company-specific enrichment (only for mentioned companies)
  if (enrichments) systemParts.push(enrichments);

  try {
    const systemText = systemParts.join('\n');
    const model = chatModel || 'gpt-4.1-mini';
    console.log('[GlobalChat] Using model:', model, '| prompt length:', systemText.length);
    const result = await chatWithFallback({ model, system: systemText, messages, max_tokens: 2048, tag: 'GlobalChat' });
    if (result.error) return result;
    // Passive learning: extract insights in background (non-blocking)
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    extractInsightsFromChat(lastUserMsg, result.reply, 'global-chat');
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
    const existing = (st.learnedInsights || []).slice(-20).map(i => i.insight).join('\n');

    const res = await claudeApiCall({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: `You just had a conversation with the user. Based on the conversation below, extract any NEW insights about the user that would help you advise them better in future conversations. Look for:

1. **Facts & preferences**: values, dealbreakers, career goals, interests, relationship dynamics
2. **Strategic preferences**: how they want to position themselves, what narrative they want to lead with, how they want to handle specific topics (comp, gaps, why they're leaving, etc.)
3. **Communication instructions**: things the user explicitly says to remember — "always do X," "never mention Y," "when asked about Z, say this," "lead with A not B"
4. **Negotiation & interview strategy**: how they want to approach salary discussions, what leverage points they want to emphasize, what questions they want to ask
5. **Talking points & framing**: specific phrases, framings, or angles the user liked and wants to reuse across applications
6. **Situational rules**: "if the role is X, emphasize Y" or "for startups, mention Z but not for enterprise"

Capture the STRATEGIC and TACTICAL insights, not just factual observations. If the user corrects you or says "don't do that" or "say it more like this," that's a high-value insight.

Return ONLY a JSON array of insight strings. If there are no new insights, return an empty array [].

Conversation:
User: ${userMessage}
Assistant: ${assistantResponse}

Existing insights (don't repeat these):
${existing}` }]
    });
    const data = await res.json();
    if (!res.ok) { console.warn('[Insights] Skipped — API busy (', res.status, ')'); return; }

    const text = (data.content?.[0]?.text || '').trim();
    let insights;
    try {
      // Extract JSON array from response (handle markdown code fences)
      const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
      insights = JSON.parse(jsonStr);
    } catch (e) { return; }

    if (!Array.isArray(insights) || insights.length === 0) return;

    const now = new Date().toISOString().slice(0, 10);
    const newInsights = insights
      .filter(i => typeof i === 'string' && i.trim().length > 5)
      .map(i => ({ source, date: now, insight: i.trim() }));

    if (newInsights.length === 0) return;

    st.learnedInsights = [...(st.learnedInsights || []), ...newInsights].slice(-100); // keep last 100
    chrome.storage.local.set({ storyTime: st });
    console.log(`[Insights] Extracted ${newInsights.length} new insight(s) from ${source}`);
  } catch (err) {
    console.error('[Insights] Error:', err.message);
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
        model: 'claude-sonnet-4-6',
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
- Target 500-1500 words depending on available information`;

  try {
    const result = await chatWithFallback({
      model: 'claude-sonnet-4-5-20250514',
      system: 'You are a role intelligence analyst. Write structured, factual briefs in markdown.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      tag: 'RoleBrief'
    });
    if (result.error) return { error: result.error };
    return { content: result.reply };
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

Be specific. Reference real details. Don't hedge or restate the obvious. If transcripts/emails are available, weight them heavily — live interaction signals beat job description text every time.`;


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
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: contextParts.join('\n\n') }]
      })
    });
    const data = await res.json();
    return { analysis: data.content?.[0]?.text || null };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Next Step Extraction ─────────────────────────────────────────────────────

async function extractNextSteps(notes, calendarEvents, transcripts) {
  const today = new Date().toISOString().slice(0, 10);
  const futureEvents = (calendarEvents || []).filter(e => (e.start || '') > today);

  const contextParts = [];
  if (futureEvents.length) {
    contextParts.push(`Upcoming calendar events:\n${futureEvents.map(e => `- ${e.start}: ${e.title}`).join('\n')}`);
  }
  if (transcripts) contextParts.push(`Meeting transcripts:\n${transcripts.slice(0, 3000)}`);
  if (notes) contextParts.push(`Meeting notes:\n${notes.slice(0, 1500)}`);

  if (!contextParts.length) return { nextStep: null, nextStepDate: null };

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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        system: `Today is ${today}. Extract the single most immediate next action and its date from the context. Return ONLY JSON: {"nextStep":"brief action or null","nextStepDate":"YYYY-MM-DD or null"}. Dates like "Thursday" should be resolved to absolute dates relative to today.`,
        messages: [{ role: 'user', content: contextParts.join('\n\n') }]
      })
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
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
      if (companyDomain) {
        const domainLower = companyDomain.toLowerCase();
        const allEmails = [...(note.attendeeEmails || []), ...(note.inviteeEmails || [])];
        const hasDomainMatch = allEmails.some(e => e.endsWith('@' + domainLower) && e !== userEmail);
        if (hasDomainMatch) {
          matched.set(note.id, { note, reason: 'email-domain', priority: 1 });
          continue;
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
      if (note.attendeeNames?.length && contactLower.length) {
        const nameMatch = contactLower.some(cn => {
          const words = cn.split(' ').filter(Boolean);
          if (words.length < 2) return false;
          return note.attendeeNames.some(an => {
            const anl = an.toLowerCase();
            return words.every(w => w.length > 1 && anl.includes(w));
          });
        });
        if (nameMatch && !matched.has(note.id)) {
          matched.set(note.id, { note, reason: 'attendee-name', priority: 3 });
          continue;
        }
      }

      // Priority 4: Title + company/contact name match (weakest)
      const title = (note.title || '').toLowerCase();
      const calTitle = (note.calendarTitle || '').toLowerCase();
      const searchText = title + ' ' + calTitle;

      const titleMatchesCompany = searchText.includes(lowerCompany) || (shortName.length > 3 && searchText.includes(shortName));

      const titleMatchesContact = contactLower.some(cn => {
        const words = cn.split(' ').filter(Boolean);
        if (words.length >= 2) return words.every(w => w.length > 1 && searchText.includes(w));
        // Single-word name: only if >= 5 chars and not the user's name
        return cn.length >= 5 && searchText.includes(cn) && (!userEmail || !userEmail.includes(cn));
      });

      if ((titleMatchesCompany || titleMatchesContact) && !matched.has(note.id)) {
        matched.set(note.id, { note, reason: titleMatchesCompany ? 'title-company' : 'title-contact', priority: 4 });
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

      if (transcriptText) transcripts.push(transcriptText);
      else if (summary) transcripts.push(summary);
    }

    meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const notes = meetings.map(m => m.summary).filter(Boolean).join('\n\n---\n\n') || null;
    const transcript = transcripts.join('\n\n---\n\n') || null;

    console.log('[Granola] Returning', meetings.length, 'meetings with', transcripts.length, 'transcripts');
    return { notes, transcript, meetings };
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