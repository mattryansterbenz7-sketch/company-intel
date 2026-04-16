// search.js — Search providers, Apollo enrichment, photo fetching, API key testing, Claude summary.

import { state, DEFAULT_PIPELINE_CONFIG, _photoCacheReady } from './bg-state.js';
import { trackApiCall, aiCall, chatWithFallback } from './api.js';

// ── Apollo enrichment ──────────────────────────────────────────────────────
export async function fetchApolloData(domain, companyName) {
  if (state._apolloExhausted) { console.log('[Apollo] Skipped — credits exhausted'); return {}; }
  const param = domain
    ? 'domain=' + encodeURIComponent(domain)
    : 'name=' + encodeURIComponent(companyName);
  const res = await fetch('https://api.apollo.io/api/v1/organizations/enrich?' + param, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'x-api-key': state.APOLLO_KEY
    }
  });
  trackApiCall('apollo', res.clone(), undefined, 'enrich');
  if (res.status === 429 || res.status === 402 || res.status === 403) {
    console.warn('[Apollo] Credits exhausted (HTTP', res.status, ')');
    state._apolloExhausted = true;
    return {};
  }
  const data = await res.json();
  return data.organization || {};
}

// ── Leader photo fetch (Serper images) ─────────────────────────────────────
export async function fetchLeaderPhoto(name, company) {
  await _photoCacheReady;
  const cacheKey = `${name}|${company}`;
  if (state.photoCache[cacheKey] !== undefined) {
    console.log(`[PhotoCache] HIT: ${cacheKey}`);
    return state.photoCache[cacheKey];
  }
  if (state.photoPending[cacheKey]) {
    console.log(`[PhotoCache] IN-FLIGHT dedup: ${cacheKey}`);
    return state.photoPending[cacheKey];
  }
  if (!state.SERPER_KEY || state._serperExhausted) { state.photoCache[cacheKey] = null; return null; }
  console.log(`[PhotoCache] MISS: ${cacheKey} — fetching from Serper`);

  state.photoPending[cacheKey] = (async () => {
    try {
      const res = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': state.SERPER_KEY },
        body: JSON.stringify({ q: name + ' ' + company, num: 1 })
      });
      trackApiCall('serper', res.clone(), undefined, 'search');
      if (res.status === 429 || res.status === 402 || res.status === 403) {
        console.warn('[Serper] Credits exhausted (HTTP', res.status, ') — photo fetch');
        state._serperExhausted = true;
        state.photoCache[cacheKey] = null;
        chrome.storage.local.set({ photoCache: state.photoCache });
        return null;
      }
      const data = await res.json();
      const photoUrl = data.images?.[0]?.thumbnailUrl || null;
      state.photoCache[cacheKey] = photoUrl;
      chrome.storage.local.set({ photoCache: state.photoCache });
      console.log(`[PhotoCache] Saved ${Object.keys(state.photoCache).length} entries to storage`);
      return photoUrl;
    } catch {
      state.photoCache[cacheKey] = null;
      chrome.storage.local.set({ photoCache: state.photoCache });
      return null;
    } finally {
      delete state.photoPending[cacheKey];
    }
  })();

  return state.photoPending[cacheKey];
}

// ── Serper web search ──────────────────────────────────────────────────────
export async function fetchSerperResults(query, num = 5) {
  if (state._serperExhausted) { console.log('[Serper] Skipped — credits exhausted'); return []; }
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': state.SERPER_KEY
    },
    body: JSON.stringify({ q: query, num })
  });
  trackApiCall('serper', res.clone(), undefined, 'search');
  if (res.status === 429 || res.status === 402 || res.status === 403) {
    console.warn('[Serper] Credits exhausted (HTTP', res.status, ')');
    state._serperExhausted = true;
    return [];
  }
  const data = await res.json();
  const results = data.organic || [];
  // Attach rich Serper fields that callers can optionally use
  if (data.knowledgeGraph) results._knowledgeGraph = data.knowledgeGraph;
  if (data.news) results._news = data.news;
  if (data.answerBox) results._answerBox = data.answerBox;
  if (data.relatedSearches) results._relatedSearches = data.relatedSearches;
  return results;
}

// ── Google Custom Search ───────────────────────────────────────────────────
export async function fetchGoogleCSEResults(query, num = 5) {
  if (!state.GOOGLE_CSE_KEY || !state.GOOGLE_CSE_CX) return [];
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(state.GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(state.GOOGLE_CSE_CX)}&q=${encodeURIComponent(query)}&num=${Math.min(num, 10)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[GoogleCSE] Error:', res.status);
      return [];
    }
    const data = await res.json();
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

// ── Claude Web Search ──────────────────────────────────────────────────────
export async function fetchClaudeWebSearch(query, num = 5) {
  if (!state.ANTHROPIC_KEY) { console.log('[ClaudeSearch] No API key'); return []; }
  try {
    console.log('[ClaudeSearch] Searching:', query);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': state.ANTHROPIC_KEY,
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
    trackApiCall('anthropic', res.clone(), 'claude-haiku-4-5-20251001', 'search');
    if (!res.ok) { console.warn('[ClaudeSearch] API error:', res.status); return []; }
    const data = await res.json();
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

// ── OpenAI Web Search ──────────────────────────────────────────────────────
export async function fetchOpenAIWebSearch(query, num = 5) {
  if (!state.OPENAI_KEY) { console.log('[OpenAISearch] No API key'); return []; }
  try {
    console.log('[OpenAISearch] Searching:', query, '| key length:', state.OPENAI_KEY.length);
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        tools: [{ type: 'web_search_preview' }],
        input: `Search the web for: ${query}\n\nReturn the most relevant results with titles, URLs, and snippets.`
      })
    });
    trackApiCall('openai', res.clone(), 'gpt-4.1-mini', 'search');
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[OpenAISearch] API error:', res.status, errBody.slice(0, 300));
      return [];
    }
    const data = await res.json();
    console.log('[OpenAISearch] Response output types:', (data.output || []).map(o => o.type).join(', '));
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

// ── Unified search with fallback chain ─────────────────────────────────────
export async function fetchSearchResults(query, num = 5) {
  console.log('[Search] Provider status:', {
    serper: state.SERPER_KEY ? (state._serperExhausted ? 'exhausted' : 'available') : 'no key',
    googleCSE: (state.GOOGLE_CSE_KEY && state.GOOGLE_CSE_CX) ? 'available' : 'no key',
    openai: state.OPENAI_KEY ? 'available' : 'no key',
    claude: state.ANTHROPIC_KEY ? 'available' : 'no key',
  });

  const searchChain = (state.pipelineConfig.searchFallbackOrder || DEFAULT_PIPELINE_CONFIG.searchFallbackOrder)
    .filter(p => p.enabled);

  const SEARCH_REGISTRY = {
    serper: () => state.SERPER_KEY && !state._serperExhausted ? fetchSerperResults(query, num) : Promise.resolve([]),
    google_cse: () => state.GOOGLE_CSE_KEY && state.GOOGLE_CSE_CX ? fetchGoogleCSEResults(query, num) : Promise.resolve([]),
    openai: () => state.OPENAI_KEY ? fetchOpenAIWebSearch(query, num) : Promise.resolve([]),
    claude: () => state.ANTHROPIC_KEY ? fetchClaudeWebSearch(query, num) : Promise.resolve([]),
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

// ── Claude research summary ────────────────────────────────────────────────
export async function fetchClaudeSummary(company, apolloData, searchResults, leaderResults, productResults, domain, extras = {}) {
  const searchSnippets = searchResults.map(r => `${r.title} (${r.link}): ${r.snippet}`).join('\n');
  const leaderSnippets = leaderResults.map(r => `${r.title} (${r.link}): ${r.snippet}`).join('\n');
  const productSnippets = productResults.map(r => `${r.title} (${r.link}): ${r.snippet}`).join('\n');

  // Build knowledge graph section if available
  const kg = extras.knowledgeGraph;
  let kgSection = '';
  if (kg) {
    const attrs = kg.attributes || {};
    const attrLines = Object.entries(attrs).map(([k, v]) => `  ${k}: ${v}`).join('\n');
    kgSection = `\nGoogle Knowledge Graph:
- Title: ${kg.title || 'N/A'}
- Type: ${kg.type || 'N/A'}
- Description: ${kg.description || 'N/A'}
${attrLines ? `- Attributes:\n${attrLines}` : ''}`;
  }

  // Build news section if available
  const newsItems = extras.news || [];
  const newsSection = newsItems.length ? `\nRecent News:\n${newsItems.slice(0, 5).map(n => `- ${n.title} (${n.date || 'recent'}): ${n.snippet || ''}`).join('\n')}` : '';

  const prompt = `You are a research assistant helping people quickly understand and evaluate companies. Use the data provided below.

Company: ${company}${domain ? `\nSource website: ${domain}` : ''}

Apollo Data:
- Employees: ${apolloData.estimated_num_employees || null}
- Industry: ${apolloData.industry || null}
- Founded: ${apolloData.founded_year || null}
- Funding Stage: ${apolloData.latest_funding_stage || null}
- Total Funding: ${apolloData.total_funding_printed || null}
- Annual Revenue: ${apolloData.annual_revenue_printed || null}
- Company Type: ${apolloData.ownership_type || null}
- Tech Stack: ${(apolloData.technologies || []).slice(0, 15).join(', ') || null}${kgSection}${newsSection}

Product/Company Search Results:
${productSnippets || 'None'}

Review Search Results:
${searchSnippets || 'None'}

Leadership Search Results:
${leaderSnippets || 'None'}

CRITICAL: Search results may contain information about MULTIPLE companies with similar names. Before writing your response, identify which company matches the domain "${domain || company}" and ONLY use information about THAT specific company. If the search results describe two different products/businesses, pick the one that matches the domain. ALL fields in "intelligence" must describe the SAME company — if oneLiner says "staffing", then whosBuyingIt and howItWorks must also be about staffing, NOT about a different product.

REVIEW VALIDATION: For the "reviews" array, ONLY include results that are clearly about the company "${company}" — not generic uses of the word. A Reddit post saying "the upside of remote work" is NOT a review of a company called "Upside". Each review must be an employee/candidate experience or reputation signal specifically about this company. If a search result is ambiguous or uses the company name as a common English word, exclude it.

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
    "industry": "<industry/category from context — null if truly unknown>",
    "revenue": "<annual revenue if found from any source, e.g. '$10M-$50M' — null if truly unknown>",
    "companyType": "<private, public, acquired, or null if unknown>",
    "techStack": ["<up to 10 key technologies used by the company from any source — empty array if unknown>"]
  },
  "recentNews": [{"headline": "<news headline>", "date": "<date if available>", "significance": "<one-line summary of why it matters — funding, acquisition, product launch, layoff, etc.>"}],
  "reviews": [{"snippet": "<key insight about culture, employee experience, or company reputation. If Glassdoor rating or 'would recommend' percentage is visible in the snippet, include it (e.g. '4.4★ rating, 82% would recommend. Employees praise...'). Extract actual review content, not job listing titles.>", "source": "<site name, e.g. Glassdoor, Blind, RepVue, Reddit>", "rating": "<star rating if found, e.g. '4.4' — null if not in snippet>", "url": "<exact URL>"}],
  "leaders": [{"name": "<full name>", "title": "<role at this company>", "newsUrl": "<URL or null>"}]
}`;

  const aiResult = await aiCall('companyIntelligence', {
    system: 'You are a JSON-only research assistant. Respond with valid JSON only, no markdown fences.',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000
  }, 'research', company);

  if (!aiResult.ok) {
    const fallback = await chatWithFallback({
      model: 'gpt-4.1-mini',
      system: 'You are a JSON-only research assistant. Respond with valid JSON only, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      tag: 'Research',
      opTag: 'research',
      context: company,
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
  let parsedResult;
  try {
    parsedResult = JSON.parse(clean);
  } catch (e) {
    const lastBrace = clean.lastIndexOf('}');
    if (lastBrace > 0) {
      parsedResult = JSON.parse(clean.slice(0, lastBrace + 1));
    } else {
      throw e;
    }
  }
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

// ── Domain extraction from search results ──────────────────────────────────
export function extractDomainFromResults(results, companyName) {
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
      if (slug && host.replace(/[^a-z0-9]/g, '').includes(slug)) return host;
      candidates.push(host);
    } catch {}
  }
  return candidates[0] || null;
}

// ── LinkedIn company snippet parser ────────────────────────────────────────
export function parseLinkedInCompanySnippet(results) {
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
      const m = text.match(/\|\s*([^|·\n]{3,40}?)\s*·\s*\d[\d,]*\s*(?:[-–]\s*\d[\d,]*)?\s*employees/i);
      if (m) out.industry = m[1].trim();
    }
    if (out.employees && out.founded && out.industry) break;
  }
  return (out.employees || out.founded || out.industry) ? out : null;
}

// ── API key testing ────────────────────────────────────────────────────────
export async function testApiKey(provider, key) {
  if (key === '__USE_ACTIVE_KEY__') {
    const keys = { anthropic: state.ANTHROPIC_KEY, openai: state.OPENAI_KEY, serper: state.SERPER_KEY, apollo: state.APOLLO_KEY, granola: state.GRANOLA_KEY, gemini: state.GEMINI_KEY };
    key = keys[provider] || '';
    if (!key) return { ok: false, reason: 'No key configured' };
  }
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
    if (provider === 'gemini') {
      // Test with a minimal generateContent call using Flash-Lite
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 5 } })
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 400) return { ok: false, status: res.status, reason: 'Invalid API key' };
      if (res.status === 403) return { ok: false, status: res.status, reason: 'Invalid API key or project not enabled' };
      if (res.status === 429) return { ok: false, status: res.status, reason: 'Key valid — rate limited' };
      return { ok: false, status: res.status };
    }
    return { ok: false, error: 'Unknown provider' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Quick Firmographic Enrichment ────────────────────────────────────────────
export async function handleQuickEnrichFirmo(message) {
  const { company, domain, missing } = message;
  const query = `"${company}" ${domain || ''} employees funding founded`;
  const results = await fetchSearchResults(query, 3);
  if (!results.length) return {};

  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');

  // Pass 1: Free regex extraction — no AI needed for clean patterns
  const extracted = {};
  if (missing.includes('employees') && !extracted.employees) {
    const empMatch = allText.match(/(\d[\d,]*\s*[-–]\s*\d[\d,]*)\s*employees/i)
      || allText.match(/(~?\d[\d,]+)\s*employees/i)
      || allText.match(/employees[:\s]+(\d[\d,]*\s*[-–]\s*\d[\d,]*)/i);
    if (empMatch) extracted.employees = empMatch[1].trim();
  }
  if (missing.includes('funding') && !extracted.funding) {
    const fundMatch = allText.match(/(Series\s+[A-F][\w]*(?:\s*[-–,]\s*\$[\d.]+[BMK])?)/i)
      || allText.match(/raised\s+(\$[\d.]+[BMK]\w*)/i)
      || allText.match(/(\$[\d.]+[BMK]\w*)\s*(?:funding|raised|round)/i);
    if (fundMatch) extracted.funding = fundMatch[1].trim();
  }
  if (missing.includes('industry') && !extracted.industry) {
    const indMatch = allText.match(/(?:industry|sector)[:\s]+([^·|•\n]{3,40})/i)
      || allText.match(/([A-Z][\w\s&\/]+?)\s*·\s*\d/);
    if (indMatch) extracted.industry = indMatch[1].trim();
  }
  if (missing.includes('linkedin') && !extracted.linkedin) {
    const allUrls = results.map(r => r.link || '').join(' ');
    const liMatch = allUrls.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-z0-9_-]+/i);
    if (liMatch) extracted.linkedin = liMatch[0];
  }

  const stillMissing = missing.filter(f => !extracted[f]);
  console.log('[QuickEnrich] Regex extracted:', extracted, '| still missing:', stillMissing);

  if (stillMissing.length === 0) return extracted;

  // Pass 2: AI fallback only for fields regex couldn't get
  const snippets = results.map(r => `${r.title}: ${r.snippet}`).join('\n');
  const { reply } = await chatWithFallback({
    model: 'gpt-4.1-mini',
    system: 'Extract company firmographics from search snippets. Return JSON only.',
    messages: [{ role: 'user', content: `From these search results about "${company}", extract ONLY these fields: ${stillMissing.join(', ')}. Return JSON: {"employees":"e.g. 51-200 or ~150","funding":"e.g. Series B, $30M","industry":"e.g. B2B SaaS","linkedin":"e.g. https://linkedin.com/company/warmly-ai"}. Only include fields you can confidently extract.\n\n${snippets.slice(0, 2000)}` }],
    max_tokens: 200,
    tag: 'QuickEnrich',
    opTag: 'enrich',
    context: company,
  });

  if (reply) {
    const match = reply.match(/\{[\s\S]*\}/);
    if (match) {
      const aiData = JSON.parse(match[0]);
      const nullIfSentinel = v => (!v || /not specified|unknown|n\/a/i.test(String(v))) ? null : v;
      return {
        employees: nullIfSentinel(extracted.employees || aiData.employees),
        funding: nullIfSentinel(extracted.funding || aiData.funding),
        industry: nullIfSentinel(extracted.industry || aiData.industry),
        linkedin: nullIfSentinel(extracted.linkedin || aiData.linkedin),
      };
    }
  }
  return extracted;
}
