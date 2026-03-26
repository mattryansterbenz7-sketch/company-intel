chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

importScripts('config.js');
const ANTHROPIC_KEY = CONFIG.ANTHROPIC_KEY;
const APOLLO_KEY = CONFIG.APOLLO_KEY;
const SERPER_KEY = CONFIG.SERPER_KEY;

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — persisted to storage, survives SW restarts
const photoCache = {}; // in-memory, per service worker lifetime

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
  if (message.type === 'DEEP_FIT_ANALYSIS') {
    deepFitAnalysis(message).then(sendResponse);
    return true;
  }
  if (message.type === 'EXTRACT_NEXT_STEPS') {
    extractNextSteps(message.notes, message.calendarEvents, message.transcripts).then(sendResponse);
    return true;
  }
  if (message.type === 'GRANOLA_SEARCH') {
    searchGranolaNotes(message.companyName, message.contactNames || [], message.calendarDates || [], message.attendeeHandles || []).then(sendResponse);
    return true;
  }
  if (message.type === 'CONSOLIDATE_PROFILE') {
    consolidateProfile(message.rawInput, message.insights).then(sendResponse);
    return true;
  }
  if (message.type === 'GLOBAL_CHAT_MESSAGE') {
    handleGlobalChatMessage(message).then(sendResponse);
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
      fetchSerperResults(`${q} (site:glassdoor.com OR site:repvue.com OR site:blind.app OR site:reddit.com) reviews employees culture`, 8),
      fetchSerperResults('site:linkedin.com/in ' + q + ' (founder OR "co-founder" OR CEO OR CTO OR CMO OR president)', 5),
      fetchSerperResults(q + ' jobs hiring (site:linkedin.com OR site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com OR site:wellfound.com)', 5),
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
  if (rc.reviews?.length) richSection += `\nEmployee Reviews:\n${rc.reviews.slice(0, 4).map(r => `- "${r.snippet}" (${r.source || ''})`).join('\n')}\n`;
  if (rc.emails?.length) richSection += `\nRecent Email Context (${rc.emails.length} emails):\n${rc.emails.slice(0, 5).map(e => `- [${e.date}] "${e.subject}" from ${e.from}`).join('\n')}\n`;
  if (rc.meetings?.length) richSection += `\nMeeting Context (${rc.meetings.length} meetings):\n${rc.meetings.slice(0, 3).map(m => `- ${m.title || 'Meeting'} (${m.date || ''}) — ${(m.transcript || '').slice(0, 500)}`).join('\n')}\n`;
  if (rc.transcript) richSection += `\nMeeting Transcript (summary):\n${rc.transcript.slice(0, 1500)}\n`;
  if (rc.storyTime) richSection += `\nUser Story Time Profile:\n${rc.storyTime.slice(0, 1500)}\n`;
  if (rc.notes) richSection += `\nUser Notes on This Company:\n${rc.notes}\n`;
  if (rc.knownComp) richSection += `\n${rc.knownComp}\n`;
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
- Salary floor (walk away below): ${salaryFloor || 'not set'}
- Salary strong offer (exciting above): ${salaryStrong || 'not set'}
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
10. If a salary IS disclosed in the posting, compare it against the candidate's salary floor. If the disclosed base salary (or the top of the range) is below the candidate's floor, this is a MAJOR red flag — include it in redFlags with the specific numbers (e.g., "Base salary $70-80K is well below your $150K floor"). This should also significantly lower the score (at least -2 points). Salary below floor is one of the strongest disqualifying signals.
11. OTE (On-Target Earnings) ranges without explicit base salary separation are COMPLETELY NORMAL for sales roles — do NOT flag this as a red flag. "Wide OTE range" is not a red flag. "Base not separated from OTE" is not a red flag. Only flag compensation as a red flag if the OTE or base is clearly below the candidate's salary floor.

{
  "jobMatch": {
    "jobSummary": "<2-3 sentences on core responsibilities and what success looks like in this role>",
    "score": <1-10 fit score: work arrangement, skills vs background, role type vs targets, loved/hated role signals>,
    "verdict": "<one direct, honest sentence — should they apply and why>",
    "strongFits": ["<concrete signal explicitly stated or strongly evidenced in the posting, 8-14 words>"],
    "redFlags": ["<concrete signal explicitly stated or strongly evidenced in the posting, 8-14 words>"]
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
        max_tokens: 1100,
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
      max_tokens: 2000,
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

async function handleChatMessage({ messages, context }) {
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
    `You are a sharp, concise strategic advisor embedded in CompanyIntel — a personal job search intelligence tool. You have deep, full context about this ${context.type === 'job' ? 'job opportunity' : 'company'} including meeting transcripts, emails, notes, and company research. Use ALL available context to give specific, grounded answers. If something isn't in your context, say so — never fabricate.\n\nResponse style: Keep answers short and direct. Use short paragraphs, not walls of text. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless the user asks for a structured breakdown. Write like a smart colleague in Slack, not a formal report.`,
    `\n=== TODAY ===\n${todayStr}`
  ];

  if (context._applicationMode) {
    systemParts.push(`\n=== APPLICATION MODE ===\nThe user is currently filling out a job application. Help them answer application questions concisely and compellingly, drawing on their background, the job description, and what you know about the company. Keep answers specific to this role — not generic. Mirror the language and values from the job posting. Be confident but authentic.`);
  }

  // ── Company overview ──────────────────────────────────────────────────────
  const overview = [`\n=== COMPANY / OPPORTUNITY ===`];
  if (context.company)    overview.push(`Company: ${context.company}`);
  if (context.jobTitle)   overview.push(`Role: ${context.jobTitle}`);
  if (context.status)     overview.push(`Pipeline stage: ${context.status}`);
  if (context.employees)  overview.push(`Size: ${context.employees}`);
  if (context.funding)    overview.push(`Funding: ${context.funding}`);
  if (context.tags?.length) overview.push(`Tags: ${context.tags.join(', ')}`);
  if (context.notes)      overview.push(`User notes: ${context.notes}`);
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
      const body = (m.transcript || '').slice(0, 4000);
      return `${header}\n${body}`;
    }).join('\n\n');
    systemParts.push(`\n=== MEETING TRANSCRIPTS (${context.meetings.length} meetings) ===\n${mtgLines}`);
  } else if (context.granolaNote) {
    // Fallback: joined transcript blob
    systemParts.push(`\n=== MEETING NOTES / TRANSCRIPTS ===\n${context.granolaNote.slice(0, 12000)}`);
  }

  // ── User background & prefs ───────────────────────────────────────────────
  const userParts = [];
  if (prefs.jobMatchBackground) userParts.push(`Background: ${prefs.jobMatchBackground}`);
  if (prefs.roles)               userParts.push(`Target roles: ${prefs.roles}`);
  if (prefs.avoid)               userParts.push(`Avoid: ${prefs.avoid}`);
  if (prefs.roleLoved)           userParts.push(`Loves: ${prefs.roleLoved}`);
  if (prefs.roleHated)           userParts.push(`Hates: ${prefs.roleHated}`);
  if (userParts.length)          systemParts.push(`\n=== ABOUT THE USER ===\n${userParts.join('\n')}`);

  // ── Story Time (persistent personal context) ───────────────────────────────
  const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));
  if (storyTime) {
    const storyText = storyTime.profileSummary || storyTime.rawInput;
    if (storyText) {
      systemParts.push(`\n=== YOUR STORY (from Story Time) ===\n${storyText.slice(0, 4000)}`);
    }
    const insights = (storyTime.learnedInsights || []).slice(-20);
    if (insights.length) {
      systemParts.push(`\n=== AI-LEARNED INSIGHTS ===\n${insights.map(i => `- ${i.insight}`).join('\n')}`);
    }
  }

  try {
    const systemText = systemParts.join('\n');
    console.log('[Chat] System prompt length:', systemText.length, 'chars');
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
        max_tokens: 2048,
        system: systemText,
        messages
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[Chat] API error:', res.status, data);
      return { error: data?.error?.message || `API error ${res.status}` };
    }
    const reply = data.content?.[0]?.text || 'No response.';
    // Passive learning: extract insights in background (non-blocking)
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    extractInsightsFromChat(lastUserMsg, reply, `chat:${context.company || 'unknown'}`);
    return { reply };
  } catch (err) {
    console.error('[Chat] Error:', err);
    return { error: err.message };
  }
}

// ── Global Chat (Pipeline Advisor) ───────────────────────────────────────────

async function handleGlobalChatMessage({ messages, pipeline, enrichments }) {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const systemParts = [
    `You are the user's strategic career advisor with full visibility across their job search pipeline. You know their background, values, and preferences. You can see every company and opportunity they're tracking.\n\nHelp them prioritize opportunities, draft follow-up messages, compare options, and make strategic decisions. When they mention a specific company or person, use the pipeline context to inform your response.\n\nIf they ask you to draft a message, email, or follow-up — pull from what you know about that company's stage, contacts, notes, and context to write something specific and actionable.\n\nBe direct, opinionated, and honest. Push back when something doesn't align with what you know about them. Don't be sycophantic.\n\nResponse style: Keep answers short and direct. Use short paragraphs. Bold key terms sparingly. Use bullet lists only when listing 3+ items. No headers or horizontal rules unless asked. Write like a smart colleague in Slack, not a formal report.`,
    `\n=== TODAY ===\n${todayStr}`
  ];

  // Story Time
  if (storyTime) {
    const storyText = storyTime.profileSummary || storyTime.rawInput;
    if (storyText) systemParts.push(`\n=== YOUR STORY ===\n${storyText.slice(0, 4000)}`);
    const insights = (storyTime.learnedInsights || []).slice(-20);
    if (insights.length) systemParts.push(`\n=== AI-LEARNED INSIGHTS ===\n${insights.map(i => `- ${i.insight}`).join('\n')}`);
  }

  // User prefs
  const userParts = [];
  if (prefs.jobMatchBackground) userParts.push(`Background: ${prefs.jobMatchBackground}`);
  if (prefs.roles)               userParts.push(`Target roles: ${prefs.roles}`);
  if (prefs.avoid)               userParts.push(`Avoid: ${prefs.avoid}`);
  if (prefs.roleLoved)           userParts.push(`Loves: ${prefs.roleLoved}`);
  if (prefs.roleHated)           userParts.push(`Hates: ${prefs.roleHated}`);
  if (prefs.salaryFloor)         userParts.push(`Salary floor: $${prefs.salaryFloor}`);
  if (prefs.userLocation)        userParts.push(`Location: ${prefs.userLocation}`);
  const wa = (prefs.workArrangement || []).join(', ');
  if (wa) userParts.push(`Work arrangement: ${wa}`);
  if (userParts.length) systemParts.push(`\n=== ABOUT THE USER ===\n${userParts.join('\n')}`);

  // Pipeline summary
  if (pipeline) {
    const companyCount = pipeline.split('\n').length;
    systemParts.push(`\n=== YOUR PIPELINE (${companyCount} entries) ===\n${pipeline}`);
  }

  // Company-specific enrichment (only for mentioned companies)
  if (enrichments) systemParts.push(enrichments);

  try {
    const systemText = systemParts.join('\n');
    console.log('[GlobalChat] System prompt length:', systemText.length, 'chars');
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
        max_tokens: 2048,
        system: systemText,
        messages
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[GlobalChat] API error:', res.status, data);
      return { error: data?.error?.message || `API error ${res.status}` };
    }
    const reply = data.content?.[0]?.text || 'No response.';
    // Passive learning: extract insights in background (non-blocking)
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    extractInsightsFromChat(lastUserMsg, reply, 'global-chat');
    return { reply };
  } catch (err) {
    console.error('[GlobalChat] Error:', err);
    return { error: err.message };
  }
}

// ── Story Time: Passive Learning (insight extraction after every chat) ───────

async function extractInsightsFromChat(userMessage, assistantResponse, source) {
  try {
    const { storyTime } = await new Promise(r => chrome.storage.local.get(['storyTime'], r));
    const st = storyTime || {};
    const existing = (st.learnedInsights || []).slice(-20).map(i => i.insight).join('\n');

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
        max_tokens: 512,
        messages: [{ role: 'user', content: `You just had a conversation with the user. Based on the conversation below, extract any NEW personal insights about the user — things like values, preferences, communication style, concerns, patterns, career goals, or relationship dynamics that would help you advise them better in the future.

Return ONLY a JSON array of insight strings. If there are no new insights, return an empty array [].

Conversation:
User: ${userMessage}
Assistant: ${assistantResponse}

Existing insights (don't repeat these):
${existing}` }]
      })
    });
    const data = await res.json();
    if (!res.ok) { console.error('[Insights] API error:', res.status); return; }

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
  const prompt = `Consolidate the following personal narrative and learned observations into a clear, structured personal profile summary. Preserve the user's voice and specifics. Organize into sections like: Background & Experience, Values & Preferences, Working Style, Career Goals, Dealbreakers, Relationship Patterns. Only include sections where you have real information. Keep it under 1500 words.

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
        max_tokens: 2048,
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

// ── Deep Fit Analysis ────────────────────────────────────────────────────────

async function deepFitAnalysis({ company, jobTitle, jobSummary, jobSnapshot, jobDescription, jobMatch, notes, transcripts, emails, prefs }) {
  const contextParts = [`Company: ${company}`, `Role: ${jobTitle || 'Unknown'}`];

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

async function searchGranolaNotes(companyName, contactNames = [], calendarDates = [], attendeeHandles = []) {
  const { granolaToken } = await new Promise(r => chrome.storage.local.get(['granolaToken'], r));
  if (!granolaToken) return { notes: null, error: 'not_connected' };

  const granolaPost = async (body) => {
    const controller = new AbortController();
    const res = await fetch('https://mcp.granola.ai/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${granolaToken}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (res.status === 401) throw Object.assign(new Error('Granola token expired'), { code: 401 });
    if (!res.ok) return null;

    // Read SSE stream — skip progress notifications, return the final result event
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const text = line.slice(5).trim();
            if (!text) continue;
            try {
              const parsed = JSON.parse(text);
              // Skip progress notifications — wait for the final result
              if (parsed.method === 'notifications/progress') continue;
              controller.abort();
              return parsed;
            } catch(e) { continue; }
          }
          // Keep only the last incomplete line in the buffer
          buffer = lines[lines.length - 1];
        }
      } catch(e) { /* AbortError is expected */ }
      return null;
    }

    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch(e) { return null; }
  };

  try {
    // MCP handshake: initialize → notifications/initialized → tools/list
    await granolaPost({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CompanyIntel', version: '1.0' } } });
    await granolaPost({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const toolsRes = await granolaPost({ jsonrpc: '2.0', method: 'tools/list', id: 2 });
    const availableTools = (toolsRes?.result?.tools || []).map(t => t.name);
    console.log('[Granola MCP] Available tools:', availableTools.join(', '));

    const seen = new Set();
    const allNotes = [];
    let reqId = 3;

    const addNote = text => {
      if (text && !seen.has(text)) { seen.add(text); allNotes.push(text); }
    };

    const callTool = async (name, args) => {
      if (!availableTools.includes(name)) return null;
      const data = await granolaPost({ jsonrpc: '2.0', method: 'tools/call', id: reqId++, params: { name, arguments: args } });
      return data?.result?.content?.[0]?.text || null;
    };

    // Resolve the actual tool name for getting full meeting data (varies by Granola version)
    const transcriptToolName = ['get_meeting_transcript', 'get_meetings', 'get_meeting', 'get_transcript']
      .find(n => availableTools.includes(n)) || null;
    console.log('[Granola] Transcript tool resolved to:', transcriptToolName);

    // Resolve query tool name
    const queryToolName = ['query_granola_meetings', 'search_meetings', 'search']
      .find(n => availableTools.includes(n)) || 'query_granola_meetings';
    // Resolve list tool name
    const listToolName = ['list_meetings', 'list_granola_meetings']
      .find(n => availableTools.includes(n)) || 'list_meetings';

    // Strategy 1: natural language summary query
    addNote(await callTool(queryToolName, { query: `meetings with ${companyName}` }));

    // Strategy 2: if nothing found, try contact names
    if (!allNotes.length) {
      for (const name of contactNames.slice(0, 3)) {
        if (name) addNote(await callTool(queryToolName, { query: `meetings with ${name}` }));
      }
    }

    // Strategy 3: fetch full transcripts for relevant meetings
    const transcripts = [];
    const meetings = [];
    const meetingsList = await callTool(listToolName, { time_range: 'last_90_days' });
    if (meetingsList) {
      const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      const lowerCompany = companyName.toLowerCase();
      const shortName = companyName.replace(/\s+(AI|Inc\.?|LLC|Corp\.?|Ltd\.?)$/i, '').trim().toLowerCase();
      const contactLower = contactNames.map(n => n.toLowerCase());

      // Parse metadata (title, date, time) for every line or XML element that has a UUID
      const meetingMeta = {};
      const lines = meetingsList.split('\n');

      // Helper: parse various date formats → {date: "YYYY-MM-DD", time: "HH:MM" | null}
      const months3 = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const fullMonths = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
      const toIso = (yr, mo, day) => `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const parseTime = (hr, mn, ap) => {
        let h = parseInt(hr); const m2 = mn || '00'; const a = (ap||'').toUpperCase();
        if (a === 'PM' && h < 12) h += 12;
        if (a === 'AM' && h === 12) h = 0;
        return `${String(h).padStart(2,'0')}:${m2}`;
      };
      const parseFriendlyDate = str => {
        if (!str) return { date: null, time: null };
        // 1. ISO: 2026-03-23 or 2026-03-23T10:30
        const iso = str.match(/(\d{4}-\d{2}-\d{2})/);
        if (iso) {
          const t = str.match(/T(\d{2}:\d{2})/);
          return { date: iso[1], time: t ? t[1] : null };
        }
        // 2. Unix timestamp (ms or s)
        const tsOnly = str.match(/^\s*(\d{10,13})\s*$/);
        if (tsOnly) {
          const ts = parseInt(tsOnly[1]);
          const d = new Date(ts > 1e12 ? ts : ts * 1000);
          if (!isNaN(d)) return { date: d.toISOString().slice(0,10), time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` };
        }
        // 3. "Mar 23 2026 10 30 AM" or "Mar 23 2026 10:30 AM" (3-letter month)
        const m3 = str.match(/(\w{3,})\s+(\d{1,2})(?:,)?\s+(\d{4})(?:\s+(\d{1,2})[\s:](\d{2})\s*(AM|PM)?)?/i);
        if (m3) {
          const mk = m3[1].toLowerCase();
          const mo = months3[mk.slice(0,3)] ?? fullMonths[mk] ?? -1;
          if (mo >= 0) {
            const date = toIso(m3[3], mo, parseInt(m3[2]));
            const time = m3[4] ? parseTime(m3[4], m3[5], m3[6]) : null;
            return { date, time };
          }
        }
        // 4. "23 Mar 2026" (day first)
        const m4 = str.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/i);
        if (m4) {
          const mo = months3[m4[2].toLowerCase()];
          if (mo !== undefined) return { date: toIso(m4[3], mo, parseInt(m4[1])), time: null };
        }
        return { date: null, time: null };
      };

      for (const line of lines) {
        // Try XML attribute format: <meeting id="uuid" title="..." date="...">
        const xmlId = (line.match(/\bid="([^"]+)"/) || [])[1];
        const xmlTitle = (line.match(/\btitle="([^"]*)"/) || [])[1];
        const xmlDate = (line.match(/\bdate="([^"]*)"/) || [])[1];

        let id, title, date, time;

        if (xmlId && xmlId.length > 4) {
          // XML format — use attribute values directly
          id = xmlId;
          title = xmlTitle || null;
          const parsed = parseFriendlyDate(xmlDate);
          date = parsed.date;
          time = parsed.time;
        } else {
          // Fallback: UUID anywhere in line
          const uuids = line.match(uuidRe);
          if (!uuids) continue;
          id = uuids[0];
          const isoDate = parseFriendlyDate(line);
          date = isoDate.date;
          time = isoDate.time;
          // Extract title by stripping UUID, dates, and XML/punctuation cruft
          title = line
            .replace(uuidRe, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\d{4}-\d{2}-\d{2}[T\s]?\d{0,2}:?\d{0,2}:?\d{0,2}[^\s]*/g, '')
            .replace(/[-–|:,\[\]()<>]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .slice(0, 150) || null;
        }

        if (id) meetingMeta[id] = { title, date, time };
      }

      // Find meeting IDs relevant to this company.
      console.log('[Granola] Parsed', Object.keys(meetingMeta).length, 'meetings from list. Looking for:', lowerCompany, '| contacts:', contactLower);
      const relevantIds = [];
      for (const [id, meta] of Object.entries(meetingMeta)) {
        const title = (meta.title || '').toLowerCase();
        if (!title) continue;

        const matchesCompany = title.includes(lowerCompany) || (shortName.length > 3 && title.includes(shortName));

        // Full contact name match only — require at least 2 words or 6+ chars to avoid common first names
        const matchesContact = contactLower.some(n => {
          if (!n || n.length < 3) return false;
          const words = n.split(' ').filter(Boolean);
          if (words.length >= 2) {
            // Full name: both first and last appear → strong match
            const fullMatch = words.every(w => w.length > 1 && title.includes(w));
            if (fullMatch) return true;
            // First-name-only match is acceptable for verified company contacts
            // (these names are scoped to this specific company, so false positives are rare)
            return words[0].length >= 3 && title.includes(words[0]);
          }
          return n.length >= 4 && title.includes(n);
        });

        if (matchesCompany || matchesContact) relevantIds.push(id);
      }

      console.log('[Granola] Matched', relevantIds.length, 'meetings by title. Titles checked:', Object.values(meetingMeta).map(m => m.title).slice(0, 10));

      // Fallback: if query_granola_meetings found results but title matching didn't,
      // extract UUIDs from the query result text and fetch those transcripts
      if (relevantIds.length === 0 && allNotes.length > 0) {
        const queryUuids = [];
        for (const note of allNotes) {
          const found = note.match(uuidRe);
          if (found) queryUuids.push(...found);
        }
        if (queryUuids.length) {
          console.log('[Granola] Fallback: extracted', queryUuids.length, 'UUIDs from query results');
          relevantIds.push(...queryUuids);
        }
      }

      // Fetch transcripts in parallel (max 5 meetings) — capture structured per-meeting data
      const uniqueIds = [...new Set(relevantIds)].slice(0, 5);
      await Promise.all(uniqueIds.map(async id => {
        const t = transcriptToolName ? await callTool(transcriptToolName, { meeting_id: id }) : null;
        if (!t) return;
        transcripts.push(t);
        const meta = meetingMeta[id] || {};
        // Use first non-XML, non-empty transcript line as title fallback
        const firstLine = t.split('\n')
          .map(l => l.trim())
          .find(l => l && l.length > 3 && !l.startsWith('<')) || '';
        const title = (meta.title && meta.title.length > 4 && !meta.title.startsWith('<'))
          ? meta.title
          : firstLine.replace(/^#+\s*/, '').slice(0, 150);
        // If meta.date is missing, try extracting it from the transcript's XML opening tag
        let meetingDate = meta.date;
        let meetingTime = meta.time;
        if (!meetingDate) {
          const xmlDateAttr = (t.match(/\bdate="([^"]+)"/) || [])[1];
          if (xmlDateAttr) {
            const parsed = parseFriendlyDate(xmlDateAttr);
            meetingDate = parsed.date;
            meetingTime = parsed.time || meetingTime;
          }
        }
        meetings.push({ id, title: title || 'Meeting', date: meetingDate, time: meetingTime, transcript: t });
      }));

      // Sort newest first
      meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }

    const notes = allNotes.length ? allNotes.join('\n\n---\n\n') : null;
    const transcript = transcripts.length ? transcripts.join('\n\n---\n\n') : null;
    return { notes, transcript, meetings };
  } catch (err) {
    if (err.code === 401) {
      // Token expired — clear stale token so Preferences reflects real state
      chrome.storage.local.remove('granolaToken');
      return { notes: null, error: 'token_expired' };
    }
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