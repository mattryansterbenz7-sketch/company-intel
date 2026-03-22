chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

importScripts('config.js');
const ANTHROPIC_KEY = CONFIG.ANTHROPIC_KEY;
const APOLLO_KEY = CONFIG.APOLLO_KEY;
const SERPER_KEY = CONFIG.SERPER_KEY;

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — persisted to storage, survives SW restarts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'QUICK_LOOKUP') {
    quickLookup(message.company, message.domain).then(sendResponse);
    return true;
  }
  if (message.type === 'RESEARCH_COMPANY') {
    researchCompany(message.company, message.domain, message.prefs).then(sendResponse);
    return true;
  }
  if (message.type === 'ANALYZE_JOB') {
    analyzeJob(message.company, message.jobTitle, message.jobDescription, message.prefs).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_LEADER_PHOTOS') {
    const { leaders, company } = message;
    Promise.all(leaders.map(l => fetchLeaderPhoto(l.name, `"${company}"`))).then(photos => {
      sendResponse(photos);
    });
    return true;
  }
});

async function quickLookup(company, domain) {
  try {
    const apolloData = await fetchApolloData(domain, company);
    return {
      employees: apolloData.estimated_num_employees ? String(apolloData.estimated_num_employees) : null,
      funding: apolloData.total_funding_printed || null,
      industry: apolloData.industry || null,
      founded: apolloData.founded_year ? String(apolloData.founded_year) : null,
      companyWebsite: apolloData.website_url || null,
      companyLinkedin: apolloData.linkedin_url || null
    };
  } catch (e) {
    return {};
  }
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

async function researchCompany(company, domain, prefs) {
  const cacheKey = company.toLowerCase();
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const domainQualifier = domain ? ` ${domain}` : '';
    const q = `"${company}"`;
    const qd = `"${company}"${domainQualifier}`;
    const [apolloData, reviewResults, leaderResults, jobResults, productResults, websiteResults, linkedinCompanyResults] = await Promise.all([
      fetchApolloData(domain, company),
      fetchSerperResults(q + ' company culture reviews employee glassdoor blind repvue reddit', 5),
      fetchSerperResults('site:linkedin.com/in ' + q + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', 5),
      fetchSerperResults('site:linkedin.com/jobs OR site:greenhouse.io OR site:lever.co ' + q + ' jobs hiring', 3),
      fetchSerperResults(qd + ' what does it do product overview how it works category', 3),
      fetchSerperResults(qd + ' official website', 2),
      fetchSerperResults('site:linkedin.com/company ' + q, 2)
    ]);

    let finalApolloData = apolloData;
    if (!apolloData.estimated_num_employees && !apolloData.website_url) {
      const foundDomain = extractDomainFromResults(websiteResults.concat(productResults).concat(reviewResults), company);
      if (foundDomain) finalApolloData = await fetchApolloData(foundDomain, company);
    }

    // LinkedIn company page fallback when Apollo has no firmographic data
    const linkedinFirmo = (!finalApolloData.estimated_num_employees && !finalApolloData.total_funding_printed)
      ? parseLinkedInCompanySnippet(linkedinCompanyResults)
      : null;

    const aiSummary = await fetchClaudeSummary(company, finalApolloData, reviewResults, leaderResults, productResults, domain);

    const result = {
      ...aiSummary,
      // Priority: Apollo → LinkedIn snippet → Claude
      employees: finalApolloData.estimated_num_employees ? String(finalApolloData.estimated_num_employees) : (linkedinFirmo?.employees || aiSummary.employees || null),
      funding: finalApolloData.total_funding_printed || aiSummary.funding || null,
      industry: finalApolloData.industry || linkedinFirmo?.industry || aiSummary.industry || null,
      founded: finalApolloData.founded_year ? String(finalApolloData.founded_year) : (linkedinFirmo?.founded || aiSummary.founded || null),
      companyWebsite: finalApolloData.website_url || null,
      companyLinkedin: finalApolloData.linkedin_url || null,
      jobListings: jobResults.map(r => ({ title: r.title, url: r.link, snippet: r.snippet }))
    };
    await setCached(cacheKey, result);
    return result;
  } catch (err) {
    return { error: 'Something went wrong: ' + err.message };
  }
}

async function analyzeJob(company, jobTitle, jobDescription, prefs) {
  if (!prefs) return null;
  const hasJobPrefs = prefs.jobMatchEnabled || prefs.jobMatchBackground || prefs.roles ||
    prefs.avoid || prefs.workArrangement?.length > 0 || prefs.salaryFloor || prefs.salaryStrong;
  if (!hasJobPrefs) return null;

  const locationContext = [
    prefs.workArrangement?.includes('Remote') && prefs.remoteGeo ? `Remote (${prefs.remoteGeo})` : null,
    prefs.workArrangement?.includes('Hybrid') && prefs.hybridLocation ? `Hybrid near ${prefs.hybridLocation}` : null,
    prefs.workArrangement?.includes('On-site') && prefs.onsiteLocation ? `On-site in ${prefs.onsiteLocation}` : null,
    prefs.workArrangement?.length && !prefs.remoteGeo && !prefs.hybridLocation && !prefs.onsiteLocation ? prefs.workArrangement.join(', ') : null
  ].filter(Boolean).join('; ');

  const salaryFloor = prefs.salaryFloor || prefs.minSalary || null;
  const salaryStrong = prefs.salaryStrong || null;

  const prompt = `Analyze this job posting for a job seeker. Return ONLY a JSON object, no markdown.

Company: ${company}
Job Title: ${jobTitle}
${jobDescription
  ? `Job Description:\n${jobDescription}`
  : `(Full description unavailable — analyze from job title and company context only.)`}

User Profile:
- Background & experience: ${prefs.jobMatchBackground || 'not specified'}
- Target roles: ${prefs.roles || 'not specified'}
- Things to avoid: ${prefs.avoid || 'not specified'}
- Work arrangement preference: ${locationContext || 'not specified'}
- Salary floor (walk away below): ${salaryFloor || 'not set'}
- Salary strong offer (exciting above): ${salaryStrong || 'not set'}

Salary rules: Only mention salary if explicitly stated in the job description. If missing, say nothing about compensation anywhere.

{
  "jobMatch": {
    "jobSummary": "<2-3 sentences on core responsibilities and what success looks like>",
    "score": <1-10 based on measurable fit: work arrangement, salary if listed, required skills vs background>,
    "verdict": "<one direct sentence — should they apply>",
    "strongFits": ["<concise bullet, 8-12 words max>"],
    "redFlags": ["<concise bullet, 8-12 words max>"]
  },
  "jobSnapshot": {
    "salary": "<pay range as listed or null>",
    "workArrangement": "<Remote/Hybrid/On-site or null>",
    "location": "<city/state if hybrid or on-site, null if remote>",
    "employmentType": "<Full-time/Part-time/Contract or null>"
  }
}`;

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
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

async function fetchApolloData(domain, companyName) {
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
  const data = await res.json();
  return data.organization || {};
}

async function fetchLeaderPhoto(name, company) {
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
      body: JSON.stringify({ q: name + ' ' + company, num: 1 })
    });
    const data = await res.json();
    return data.images?.[0]?.thumbnailUrl || null;
  } catch {
    return null;
  }
}

async function fetchSerperResults(query, num = 5) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': SERPER_KEY
    },
    body: JSON.stringify({ q: query, num })
  });
  const data = await res.json();
  return data.organic || [];
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
  "reviews": [{"snippet": "<direct quote from review results only>", "source": "<site name>", "url": "<exact URL>"}],
  "leaders": [{"name": "<full name>", "title": "<role at this company>", "newsUrl": "<URL or null>"}]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1600,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
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