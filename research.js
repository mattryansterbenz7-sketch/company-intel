// research.js — Enrichment pipeline, research cache, company research orchestration.

import { state, DEFAULT_PIPELINE_CONFIG, CACHE_TTL } from './bg-state.js';
import { aiCall, getApiUsage } from './api.js';
import { fetchSearchResults, extractDomainFromResults, parseLinkedInCompanySnippet, fetchApolloData, fetchClaudeSummary } from './search.js';

// ── Review result filter ──────────────────────────────────────────────────────
// Discards results that are about review platforms themselves (e.g. "RepVue alternatives",
// "best Glassdoor alternatives") rather than reviews of the target company.
const JUNK_REVIEW_PATTERNS = [
  /\balternatives?\b/i,
  /\bvs\.?\s/i,
  /\bcompare\b/i,
  /\bbest\s+(?:sites?|tools?|platforms?|apps?)\b/i,
  /\breviews?\s+of\s+glassdoor\b/i,
  /\breviews?\s+of\s+indeed\b/i,
  /\breviews?\s+of\s+repvue\b/i,
  /\breviews?\s+of\s+comparably\b/i,
  /\btop\s+\d+\s+(?:sites?|tools?|platforms?)\b/i,
];

function filterReviewResults(results, company) {
  const companyLower = company.toLowerCase();
  // Build a set of significant words from the company name for matching
  const companyWords = companyLower
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Common English words that shouldn't be used for substring matching
  const COMMON_WORDS = new Set(['the','and','for','that','this','with','from','have','are','was','will','can','all','one','new','get','but','not','been','out','into','your','our','more','also','just','over','how','its','may','use','well','way','any','set','run','let','own','now','key','top','part','open','go','back','take','long','made','turn','good','work','best','much','most','last','look','help','line','end','close','play','move','live','real','lead','free','note','rise','side','find','high','plan','grow','gain','edge','push','pull','mark','shift','point','scale','share','drive','build','clear','level','prime','spark','reach','track','launch','target','impact','signal','bridge','insight','upside','notion','harbor','forge','lever','relay','flow','ramp','sail','beam','hive','bolt','pulse','drift','grove','arc','dash','stride','ripple','ample','rally','sift','crisp','loop','blend','gist','glow','mesh','snap','link','flux','apex','meld','tilt','warp','pivot','craft','nexus','slate','scout','vault','layer','amplify','cascade','elevate','integrate']);

  return results.filter(r => {
    const title = (r.title || '').toLowerCase();
    const snippet = (r.snippet || '').toLowerCase();
    const url = (r.link || '').toLowerCase();
    const combined = `${title} ${snippet}`;

    // Drop anything matching a known junk pattern in title or URL
    if (JUNK_REVIEW_PATTERNS.some(pat => pat.test(title) || pat.test(url))) return false;

    // For review-platform URLs, check that the company name appears in the URL slug
    // (e.g. glassdoor.com/Reviews/Upside-Reviews). Platform URLs always encode the company name.
    const isReviewSite = /glassdoor\.com|indeed\.com|comparably\.com|repvue\.com/.test(url);
    if (isReviewSite) {
      const slug = url.replace(/[^a-z0-9]/g, ' ');
      const nameInSlug = companyWords.some(w => slug.includes(w));
      if (nameInSlug) return true;
      // URL doesn't contain company name — likely a wrong company's page
      return false;
    }

    // For non-review-site results (Reddit, Blind, etc.): use word-boundary matching
    // to avoid common English word false positives
    const hasCommonWord = companyWords.length > 0 && companyWords.every(w => COMMON_WORDS.has(w));
    if (hasCommonWord) {
      // All company name words are common English — require the full company name as a phrase
      const mentionsCompany = combined.includes(companyLower);
      if (!mentionsCompany) return false;
    } else {
      const mentionsCompany = companyWords.length === 0
        || companyWords.some(w => combined.includes(w));
      if (!mentionsCompany) return false;
    }

    return true;
  });
}

// ── Enrichment Pipeline (provider-agnostic with fallback) ────────────────────

// Standardized enrichment result shape — all providers return this
function emptyEnrichment() {
  return { source: null, company: null, description: null, industry: null, employees: null, funding: null, foundedYear: null, companyWebsite: null, companyLinkedin: null, leaders: [], raw: null };
}

// Provider: Apollo
export async function enrichFromApollo(company, domain) {
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
      fundingStage: data.latest_funding_stage || null,
      foundedYear: data.founded_year || null,
      companyWebsite: data.website_url || null,
      companyLinkedin: (data.linkedin_url && !data.linkedin_url.includes('/company/unavailable')) ? data.linkedin_url : null,
      revenue: data.annual_revenue_printed || null,
      companyType: data.ownership_type || null,
      techStack: (data.technologies || []).slice(0, 15),
      twitterUrl: data.twitter_url || null,
      leaders: [],
      raw: data,
    };
  } catch (e) {
    console.log('[Enrich] Apollo failed:', e.message);
    return null;
  }
}

// Provider: Serper + Claude (web research synthesis)
export async function enrichFromWebResearch(company, domain, linkedinUrl) {
  console.log('[Enrich] Trying Web Research for:', company, domain, linkedinUrl);
  try {
    const q = `"${company}"`;
    // When no domain, add "company" or "software" to disambiguate generic names
    const qd = domain ? `"${company}" ${domain}` : `"${company}" company software`;
    const searches = [
      fetchSearchResults(qd + ' what does it do product overview', 3),
      fetchSearchResults(domain ? `"${company}" ${domain} official website` : `"${company}" company official website`, 2),
    ];
    // If we already have a LinkedIn URL, search for it directly for better firmographic extraction
    if (linkedinUrl) {
      searches.push(fetchSearchResults(linkedinUrl + ' company overview employees', 2));
    } else {
      searches.push(fetchSearchResults('site:linkedin.com/company ' + q, 2));
    }
    // Also search for firmographics directly if we have a domain
    if (domain) {
      searches.push(fetchSearchResults(`"${company}" ${domain} employees funding founded revenue`, 2));
    }
    const [productResults, websiteResults, linkedinResults, firmoResults] = await Promise.all(searches);
    console.log('[Enrich] Serper results:', {
      product: productResults.length,
      website: websiteResults.length,
      linkedin: linkedinResults.length,
    });

    // Extract domain from search results for website field
    const discoveredDomain = extractDomainFromResults([...websiteResults, ...productResults], company);

    const linkedinFirmo = parseLinkedInCompanySnippet(linkedinResults);
    console.log('[Enrich] LinkedIn firmo:', linkedinFirmo);

    // Extract knowledge graph data from any Serper response (free structured data)
    const kg = productResults._knowledgeGraph || websiteResults._knowledgeGraph || linkedinResults._knowledgeGraph || (firmoResults || [])._knowledgeGraph;
    let kgFirmo = {};
    if (kg?.attributes) {
      const attrs = kg.attributes;
      const empAttr = attrs['Number of employees'] || attrs.Employees || attrs['Employee count'] || '';
      const foundedAttr = attrs.Founded || attrs['Year founded'] || '';
      const revenueAttr = attrs.Revenue || attrs['Annual revenue'] || '';
      const hqAttr = attrs.Headquarters || attrs.HQ || '';
      kgFirmo = {
        employees: empAttr ? String(empAttr).replace(/[^\d,\-–~+]/g, '').trim() || empAttr : null,
        founded: foundedAttr ? String(foundedAttr).match(/\d{4}/)?.[0] || null : null,
        revenue: revenueAttr || null,
        headquarters: hqAttr || null,
        description: kg.description || null,
      };
      console.log('[Enrich] Knowledge graph firmo:', kgFirmo);
    }

    const snippets = [...productResults, ...websiteResults, ...(firmoResults || [])].map(r => `${r.title}: ${r.snippet}`).join('\n');
    console.log('[Enrich] Snippets for Haiku:', snippets.length, 'chars');

    // Lightweight Claude call just for firmographics from web snippets
    let aiEstimate = {};
    if (snippets.length > 50) {
      try {
        const aiResult = await aiCall('firmographicExtraction', {
          system: 'You are a JSON-only data extractor. Respond with valid JSON only.',
          messages: [{ role: 'user', content: `From these search results about "${company}", extract: industry, employee count, funding, founded year. Return JSON only: {"industry":"...","employees":"...","funding":"...","founded":"..."}\n\n${snippets.slice(0, 2000)}` }],
          max_tokens: 300
        }, 'enrich');
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
      description: kgFirmo.description || null,
      industry: clean(linkedinFirmo?.industry) || clean(aiEstimate.industry) || null,
      employees: clean(linkedinFirmo?.employees) || clean(kgFirmo.employees) || clean(aiEstimate.employees) || null,
      funding: clean(linkedinFirmo?.funding) || clean(aiEstimate.funding) || null,
      fundingStage: null,
      foundedYear: (linkedinFirmo?.founded ? parseInt(linkedinFirmo.founded) : null) || (kgFirmo.founded ? parseInt(kgFirmo.founded) : null) || (aiEstimate.founded ? parseInt(aiEstimate.founded) : null) || null,
      revenue: clean(kgFirmo.revenue) || null,
      companyWebsite: discoveredDomain ? `https://${discoveredDomain}` : null,
      companyLinkedin: null,
      techStack: [],
      leaders: [],
      raw: { linkedinFirmo, aiEstimate, kgFirmo },
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

export async function runEnrichmentPipeline(company, domain, companyLinkedin) {
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
  if (state._apolloExhausted && state._serperExhausted) {
    console.warn('[Enrich] All API credits exhausted — skipping pipeline');
    return { ...emptyEnrichment(), source: null, _creditsExhausted: true };
  }
  console.log('[Enrich] Pipeline starting for:', company, '| domain:', derivedDomain || '(none)', '| linkedin:', linkedinSlug || '(none)');
  const enrichOrder = (state.pipelineConfig.enrichmentOrder || DEFAULT_PIPELINE_CONFIG.enrichmentOrder).filter(p => p.enabled);
  for (const provider of enrichOrder) {
    const fn = ENRICHMENT_REGISTRY[provider.id];
    if (!fn) continue;
    const result = await fn(company, derivedDomain, companyLinkedin);
    if (hasEnrichmentData(result)) {
      console.log('[Enrich] Pipeline success from:', result.source);
      return result;
    }
    if (result) console.log('[Enrich] Provider returned empty data, trying next');
  }
  console.log('[Enrich] All providers failed for:', company);
  return emptyEnrichment();
}

// ── Quick Lookup ──────────────────────────────────────────────────────────

export async function quickLookup(company, domain, companyLinkedin, linkedinFirmo) {
  const enrichment = await runEnrichmentPipeline(company, domain, companyLinkedin);
  const result = {
    employees: enrichment.employees,
    funding: enrichment.funding,
    industry: enrichment.industry,
    founded: enrichment.foundedYear ? String(enrichment.foundedYear) : null,
    revenue: enrichment.revenue || null,
    companyType: enrichment.companyType || null,
    techStack: enrichment.techStack || [],
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

// ── Research Cache ────────────────────────────────────────────────────────

export async function getCached(key) {
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

export async function setCached(key, data, usage) {
  key = key.replace(/[,;:!?.]+$/, '').trim(); // normalize
  return new Promise(resolve =>
    chrome.storage.local.get(['researchCache'], ({ researchCache }) => {
      const entry = { data, ts: Date.now() };
      if (usage) entry._usage = usage;
      const updated = { ...(researchCache || {}), [key]: entry };
      // Prune entries older than TTL to keep storage lean
      for (const k of Object.keys(updated)) {
        if (Date.now() - updated[k].ts > CACHE_TTL) delete updated[k];
      }
      chrome.storage.local.set({ researchCache: updated }, resolve);
    })
  );
}

// ── Full Company Research ─────────────────────────────────────────────────

export async function researchCompany(company, domain, prefs, companyLinkedin, linkedinFirmo) {
  const cacheKey = company.toLowerCase();
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // Capture cost before research
  const usageBefore = await getApiUsage();
  const costBefore = usageBefore.costToday || 0;

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
    const scoutPromise = fetchSearchResults(
      `${qd} (site:glassdoor.com OR site:indeed.com OR site:comparably.com OR site:repvue.com OR site:blind.app OR site:reddit.com) reviews employees`,
      state.pipelineConfig.searchCounts?.reviewScout || 3
    );

    if (state._serperExhausted) {
      console.warn('[Research] Serper exhausted — running scout + leadership only; skipping jobs & product');
      leaderResults = await fetchSearchResults('site:linkedin.com/in ' + qd + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', state.pipelineConfig.searchCounts?.leaders || 5);
      jobResults = [];
      productResults = [];
    } else {
      [, leaderResults, jobResults, productResults] = await Promise.all([
        scoutPromise, // scout runs in parallel
        fetchSearchResults('site:linkedin.com/in ' + qd + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', state.pipelineConfig.searchCounts?.leaders || 5),
        fetchSearchResults(qd + ' jobs hiring (site:linkedin.com OR site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com OR site:wellfound.com)', state.pipelineConfig.searchCounts?.jobs || 5),
        fetchSearchResults(qd + ' what does it do product overview how it works category', state.pipelineConfig.searchCounts?.product || 3),
      ]);
    }

    // Step 2: Analyze scout results for known review sources
    const rawScoutResults = await scoutPromise;
    const scoutResults = filterReviewResults(rawScoutResults, company);
    console.log('[Research] Review scout after filter:', scoutResults.length, '/', rawScoutResults.length, 'kept');
    const scoutUrls = scoutResults.map(r => (r.link || '').toLowerCase());
    const hasRepVue = scoutUrls.some(u => u.includes('repvue.com'));
    const hasGlassdoor = scoutUrls.some(u => u.includes('glassdoor.com'));
    console.log('[Research] Review scout:', { hits: scoutResults.length, hasRepVue, hasGlassdoor });

    // Step 3: Targeted drill queries for high-signal sources
    // Pull user role keywords for targeted queries
    const { prefs: _drillPrefs } = await new Promise(r => chrome.storage.sync.get(['prefs'], r));
    const roleKeywords = (_drillPrefs?.roles || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2).slice(0, 3).join(' OR ') || 'sales OR GTM OR revenue OR leadership';

    const drillPromises = [];
    if (hasRepVue) drillPromises.push(fetchSearchResults(`site:repvue.com ${qd} sales quota culture`, state.pipelineConfig.searchCounts?.reviewDrill || 2));
    if (hasGlassdoor) drillPromises.push(fetchSearchResults(`site:glassdoor.com/Reviews ${qd} ${roleKeywords}`, state.pipelineConfig.searchCounts?.reviewDrill || 2));
    const drillResults = drillPromises.length ? await Promise.all(drillPromises) : [];

    // Step 4: Combine, filter, and deduplicate by URL
    const seenUrls = new Set();
    const reviewResults = [];
    for (const r of [...scoutResults, ...filterReviewResults(drillResults.flat(), company)]) {
      const url = (r.link || '').toLowerCase();
      if (url && !seenUrls.has(url)) { seenUrls.add(url); reviewResults.push(r); }
    }
    console.log('[Research] Reviews:', reviewResults.length, 'total (scout:', scoutResults.length, '+ drills:', drillResults.flat().length, ')');

    // Use Apollo raw data for Claude synthesis if available, otherwise pass empty
    const apolloRaw = enrichment.raw?.estimated_num_employees ? enrichment.raw : {};
    // Collect knowledge graph + news from any Serper response for Claude
    const kg = productResults._knowledgeGraph || reviewResults._knowledgeGraph || leaderResults._knowledgeGraph || jobResults._knowledgeGraph;
    const news = productResults._news || reviewResults._news || leaderResults._news || [];
    const aiSummary = await fetchClaudeSummary(company, apolloRaw, reviewResults, leaderResults, productResults, domain, { knowledgeGraph: kg, news });

    const claudeFirmo = aiSummary.firmographics || {};
    const src = enrichment.source || 'Unknown';
    const result = {
      ...aiSummary,
      employees: enrichment.employees || claudeFirmo.employees || null,
      funding: enrichment.funding || claudeFirmo.funding || null,
      industry: enrichment.industry || claudeFirmo.industry || null,
      founded: enrichment.foundedYear ? String(enrichment.foundedYear) : (claudeFirmo.founded || null),
      revenue: enrichment.revenue || claudeFirmo.revenue || null,
      companyType: enrichment.companyType || claudeFirmo.companyType || null,
      techStack: (enrichment.techStack?.length ? enrichment.techStack : claudeFirmo.techStack) || [],
      recentNews: aiSummary.recentNews || [],
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
        revenue: enrichment.revenue ? src : claudeFirmo.revenue ? 'Claude estimate' : null,
        techStack: enrichment.techStack?.length ? src : claudeFirmo.techStack?.length ? 'Claude estimate' : null,
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
    // Track research metadata: APIs used and actual cost
    const usageAfter = await getApiUsage();
    const costAfter = usageAfter.costToday || 0;
    const researchCost = Math.max(0, costAfter - costBefore); // Ensure non-negative

    const researchMeta = {
      apisUsed: [],
      cost: researchCost,
      costFormatted: researchCost > 0 ? `$${researchCost.toFixed(4)}` : '$0.0001',
    };
    if (enrichment.source === 'Apollo') researchMeta.apisUsed.push('Apollo');
    if (reviewResults.length || leaderResults.length || jobResults.length || productResults.length) researchMeta.apisUsed.push('Serper');
    if (aiSummary) researchMeta.apisUsed.push('Claude');

    await setCached(cacheKey, result, researchMeta);
    return result;
  } catch (err) {
    return { error: 'Something went wrong: ' + err.message };
  }
}

// ── Lightweight Company Scout (1 Serper credit, cached) ─────────────────────

export async function scoutCompany(companyName) {
  const scoringConfig = state.pipelineConfig.scoring || DEFAULT_PIPELINE_CONFIG.scoring;
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
  // Run 2 parallel Serper searches: product overview + culture/reviews
  const numResults = scoringConfig.scoutResultCount || 3;
  console.log('[Scout] Fetching for:', companyName, `(${numResults} results per query)`);
  const [overviewResults, rawReviewResults] = await Promise.all([
    fetchSearchResults(`"${companyName}" what does it do product overview`, numResults),
    fetchSearchResults(
      `"${companyName}" (site:glassdoor.com OR site:indeed.com OR site:comparably.com OR site:repvue.com OR site:blind.app OR site:reddit.com) reviews employees`,
      numResults
    ),
  ]);
  const reviewResults = filterReviewResults(rawReviewResults, companyName);
  if (!overviewResults.length && !reviewResults.length) return null;
  const overviewSnippets = overviewResults.slice(0, numResults).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
  const reviewSnippets = reviewResults.slice(0, numResults).map(r => `[${r.displayLink || 'review'}] ${r.snippet || ''}`).join('\n');
  const snippets = [
    overviewSnippets && `## Company Overview\n${overviewSnippets}`,
    reviewSnippets  && `## Employee Reviews & Culture (Glassdoor / Reddit / RepVue)\n${reviewSnippets}`,
  ].filter(Boolean).join('\n\n');
  // Save to scout cache
  const updated = { ...(scoutCache || {}), [cacheKey]: { summary: snippets, ts: Date.now() } };
  chrome.storage.local.set({ scoutCache: updated });
  console.log('[Scout] Cached for:', companyName);
  return snippets;
}
