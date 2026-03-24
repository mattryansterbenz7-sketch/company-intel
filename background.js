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
  if (message.type === 'GRANOLA_SEARCH') {
    searchGranolaNotes(message.companyName).then(sendResponse);
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
      companyLinkedin: (apolloData.linkedin_url && !apolloData.linkedin_url.includes('/company/unavailable')) ? apolloData.linkedin_url : null
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

    const claudeFirmo = aiSummary.firmographics || {};
    const result = {
      ...aiSummary,
      // Priority: Apollo → LinkedIn snippet → Claude estimate
      employees: finalApolloData.estimated_num_employees ? String(finalApolloData.estimated_num_employees) : (linkedinFirmo?.employees || claudeFirmo.employees || null),
      funding: finalApolloData.total_funding_printed || linkedinFirmo?.funding || claudeFirmo.funding || null,
      industry: finalApolloData.industry || linkedinFirmo?.industry || claudeFirmo.industry || null,
      founded: finalApolloData.founded_year ? String(finalApolloData.founded_year) : (linkedinFirmo?.founded || claudeFirmo.founded || null),
      companyWebsite: finalApolloData.website_url || null,
      companyLinkedin: (finalApolloData.linkedin_url && !finalApolloData.linkedin_url.includes('/company/unavailable')) ? finalApolloData.linkedin_url : null,
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
    prefs.avoid || prefs.workArrangement?.length > 0 || prefs.salaryFloor || prefs.salaryStrong ||
    prefs.resumeText;
  if (!hasJobPrefs) return null;

  const locationContext = prefs.workArrangement?.length ? prefs.workArrangement.join(', ') : null;

  const salaryFloor = prefs.salaryFloor || prefs.minSalary || null;
  const salaryStrong = prefs.salaryStrong || null;

  const prompt = `Analyze this job posting for a job seeker. Return ONLY a JSON object, no markdown.

Company: ${company}
Job Title: ${jobTitle}
${jobDescription
  ? `Job Description:\n${jobDescription}`
  : `(Full description unavailable — analyze from job title and company context only.)`}

${prefs.resumeText ? `Candidate Resume / LinkedIn Profile:\n${prefs.resumeText}\n` : ''}
User Profile:
- Additional background notes: ${prefs.jobMatchBackground || 'none'}
- Target roles: ${prefs.roles || 'not specified'}
- Things to avoid: ${prefs.avoid || 'not specified'}
- Actual location: ${prefs.userLocation || 'not specified'}
- Work arrangement preference: ${locationContext || 'not specified'}
- Max travel willing to do: ${prefs.maxTravel || 'not specified'}
- Salary floor (walk away below): ${salaryFloor || 'not set'}
- Salary strong offer (exciting above): ${salaryStrong || 'not set'}
${prefs.roleLoved ? `- A role they loved: ${prefs.roleLoved}` : ''}
${prefs.roleHated ? `- A role that was a bad fit: ${prefs.roleHated}` : ''}

Analysis rules:
1. Work arrangement and location are QUALIFIERS, not flags — they are already evaluated separately. Do NOT put remote/hybrid/on-site or location eligibility in strongFits or redFlags under any circumstances.
2. Only flag things explicitly stated or directly evidenced in the posting. Do NOT flag the absence of information — if equity isn't mentioned, that is not a red flag. If reporting structure isn't mentioned, do not speculate. No "Unclear:" prefixes — if you can't support it with evidence from the posting, leave it out.
3. Red flags must be genuine concerns a reasonable person would want to know — not stylistic differences or things the user said they're okay with. If the user hasn't flagged something as a dealbreaker, don't treat it as one.
4. Travel: if the posting explicitly mentions travel requirements, compare against max travel preference and flag only if it clearly exceeds it.
5. Bridge the language gap: the user describes themselves in personal terms; job postings use corporate language. Map them — e.g. "I love autonomy and building from scratch" → look for early-stage, greenfield, founder-led signals. "Manage and grow existing accounts" → retention focus, not new business ownership.
6. Read between the lines on culture, scope, and autonomy — but only from what the posting actually implies, not from what it omits.
7. Use loved/hated role examples as calibration for concrete signals you find in the posting.
8. Salary: extract any pay range or compensation figure mentioned anywhere in the posting — including legal/compensation disclosure sections at the bottom. If no number is mentioned anywhere, use null.

{
  "jobMatch": {
    "jobSummary": "<2-3 sentences on core responsibilities and what success looks like in this role>",
    "score": <1-10 fit score: work arrangement, skills vs background, role type vs targets, loved/hated role signals>,
    "verdict": "<one direct, honest sentence — should they apply and why>",
    "strongFits": ["<concrete signal explicitly stated or strongly evidenced in the posting, 8-14 words>"],
    "redFlags": ["<concrete signal explicitly stated or strongly evidenced in the posting, 8-14 words>"]
  },
  "jobSnapshot": {
    "salary": "<exact pay range as written in the posting, e.g. '$133,500 - $200,500' — null only if truly not mentioned anywhere>",
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
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
  "firmographics": {
    "employees": "<headcount or range extracted from search results, e.g. '50-200' or '~500' — null if truly unknown>",
    "founded": "<year founded from any source — null if truly unknown>",
    "funding": "<total funding or stage from any source, e.g. 'Series B, $24M' — null if truly unknown>",
    "industry": "<industry/category from context — null if truly unknown>"
  },
  "reviews": [{"snippet": "<key insight or sentiment about culture/employee experience from search results — use the snippet text as-is, even if not a verbatim quote>", "source": "<site name, e.g. Glassdoor, Blind, RepVue, Reddit>", "url": "<exact URL>"}],
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  // Surface API-level errors (rate limits, overload, invalid key, etc.)
  if (data.error) throw new Error(`Claude API error: ${data.error.message || data.error.type}`);
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
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
    chrome.identity.getAuthToken({ interactive: false }, token => {
      void chrome.runtime.lastError;
      if (!token) {
        chrome.storage.local.remove('gmailConnected');
        resolve({ success: true });
        return;
      }
      chrome.identity.removeCachedAuthToken({ token }, () => {
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
        chrome.storage.local.remove('gmailConnected');
        resolve({ success: true });
      });
    });
  });
}

function extractEmailBody(payload) {
  if (!payload) return '';
  // Direct plain text body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    try { return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch(e) {}
  }
  // Search parts for text/plain
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      try { return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch(e) {}
    }
  }
  // Recurse into nested multipart
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
        // Gmail suffix match: from:@domain.com matches any address at that domain
        if (domain) parts.push(`from:@${domain} OR to:@${domain}`);
        if (companyName) parts.push(`"${companyName}"`);
        if (linkedinSlug && linkedinSlug !== domain) parts.push(`"${linkedinSlug}"`);
        // Explicitly include known contact emails to catch threads that don't mention the company name
        (knownContactEmails || []).forEach(email => {
          if (!domain || !email.endsWith('@' + domain)) {
            parts.push(`from:${email} OR to:${email}`);
          }
        });
        const query = parts.join(' OR ');
        const searchRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (searchRes.status === 401) {
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          chrome.storage.local.remove('gmailConnected');
          resolve({ emails: [], error: 'token_expired' });
          return;
        }
        const searchData = await searchRes.json();
        const messages = (searchData.messages || []).slice(0, 50);
        const emails = await Promise.all(messages.map(async msg => {
          const r = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!r.ok) return null;
          const d = await r.json();
          const h = d.payload?.headers || [];
          const get = n => h.find(x => x.name === n)?.value || '';
          const body = extractEmailBody(d.payload);
          return { id: msg.id, from: get('From'), to: get('To'), subject: get('Subject'), date: get('Date'), snippet: d.snippet || '', body, threadId: d.threadId };
        }));
        resolve({ emails: emails.filter(Boolean) });
      } catch (err) {
        resolve({ emails: [], error: err.message });
      }
    });
  });
}

// ── Chat ────────────────────────────────────────────────────────────────────

async function handleChatMessage({ messages, context }) {
  chrome.storage.sync.get(['prefs'], async ({ prefs }) => {});
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));

  const systemParts = [
    `You are a sharp, concise assistant embedded in CompanyIntel — a job search tool. You have full context about this ${context.type === 'job' ? 'job opportunity' : 'company'}. Answer questions directly and specifically using the data below. If information isn't available in the context, say so.`
  ];

  if (context.company)                systemParts.push(`\nCompany: ${context.company}`);
  if (context.jobTitle)               systemParts.push(`Job Title: ${context.jobTitle}`);
  if (context.status)                 systemParts.push(`Stage: ${context.status}`);
  if (context.notes)                  systemParts.push(`\nNotes: ${context.notes}`);
  if (context.tags?.length)           systemParts.push(`Tags: ${context.tags.join(', ')}`);
  if (context.intelligence?.eli5)     systemParts.push(`\nWhat they do: ${context.intelligence.eli5}`);
  if (context.intelligence?.whosBuyingIt) systemParts.push(`Who buys it: ${context.intelligence.whosBuyingIt}`);
  if (context.intelligence?.howItWorks)   systemParts.push(`How it works: ${context.intelligence.howItWorks}`);
  if (context.jobMatch?.verdict)      systemParts.push(`\nJob match verdict: ${context.jobMatch.verdict}`);
  if (context.jobMatch?.score)        systemParts.push(`Match score: ${context.jobMatch.score}/10`);
  if (context.jobMatch?.strongFits?.length) systemParts.push(`Strong fits: ${context.jobMatch.strongFits.join('; ')}`);
  if (context.jobMatch?.redFlags?.length)   systemParts.push(`Red flags: ${context.jobMatch.redFlags.join('; ')}`);
  if (context.reviews?.length)        systemParts.push(`\nEmployee reviews:\n${context.reviews.slice(0,3).map(r => `- "${r.snippet}" (${r.source || ''})`).join('\n')}`);
  if (context.leaders?.length)        systemParts.push(`\nLeadership: ${context.leaders.map(l => `${l.name} — ${l.title || 'unknown title'}`).join(', ')}`);

  if (context.emails?.length) {
    systemParts.push(`\nEmail activity (${context.emails.length} emails with this company):`);
    context.emails.slice(0, 10).forEach(e => systemParts.push(`  ${e.date}: "${e.subject}" — From: ${e.from}`));
  }

  if (context.granolaNote) {
    systemParts.push(`\nMeeting notes (from Granola):\n${context.granolaNote}`);
  }

  if (prefs.jobMatchBackground) systemParts.push(`\nUser background: ${prefs.jobMatchBackground}`);
  if (prefs.roles)               systemParts.push(`Target roles: ${prefs.roles}`);
  if (prefs.avoid)               systemParts.push(`Things to avoid: ${prefs.avoid}`);
  if (prefs.roleLoved)           systemParts.push(`Enjoys: ${prefs.roleLoved}`);
  if (prefs.roleHated)           systemParts.push(`Avoids: ${prefs.roleHated}`);

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
        max_tokens: 1024,
        system: systemParts.join('\n'),
        messages
      })
    });
    const data = await res.json();
    return { reply: data.content?.[0]?.text || 'No response.' };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Granola MCP ─────────────────────────────────────────────────────────────

async function searchGranolaNotes(companyName) {
  const { granolaToken } = await new Promise(r => chrome.storage.local.get(['granolaToken'], r));
  if (!granolaToken) return { notes: null, error: 'not_connected' };

  try {
    // MCP initialize
    await fetch('https://mcp.granola.ai/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${granolaToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CompanyIntel', version: '1.0' } } })
    });
    // Search for notes by company name
    const res = await fetch('https://mcp.granola.ai/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${granolaToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 2, params: { name: 'search_notes', arguments: { query: companyName } } })
    });
    if (!res.ok) return { notes: null, error: 'mcp_error' };
    const data = await res.json();
    const notes = data.result?.content?.[0]?.text || null;
    return { notes };
  } catch (err) {
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
      const results = await fetchSerperResults(`"${entry.company}" official website`, 3);
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