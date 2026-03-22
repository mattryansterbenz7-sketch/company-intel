chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_COMPANY') {
    detectCompanyAndJob()
      .then(sendResponse)
      .catch(() => sendResponse({}));
    return true;
  }
  if (message.type === 'GET_JOB_DESCRIPTION') {
    extractJobDescriptionForPanel()
      .then(sendResponse)
      .catch(() => sendResponse({}));
    return true;
  }
  return true;
});

async function detectCompanyAndJob() {
  const url = window.location.href;
  let result;

  if (url.includes('linkedin.com')) {
    result = await detectLinkedIn();
  } else if (url.includes('greenhouse.io') || url.includes('boards.greenhouse.io')) {
    result = detectGreenhouse();
  } else if (url.includes('lever.co')) {
    result = detectLever();
  } else {
    result = detectGeneric();
  }

  // Quick meta extraction — try for up to 2s without blocking research
  if (result && result.jobTitle) {
    for (let i = 0; i < 10; i++) {
      const meta = extractLinkedInJobMeta();
      if (meta.workArrangement || meta.salary || meta.employmentType) {
        result.jobMeta = meta;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    if (!result.jobMeta) result.jobMeta = extractLinkedInJobMeta();
  }

  // Return immediately — description extracted separately via GET_JOB_DESCRIPTION
  return result;
}

async function extractJobDescriptionForPanel() {
  await waitForJobDescriptionPanel();

  // Click "see more" to expand the full description
  let moreBtn = document.querySelector(
    '.jobs-description__footer-button, ' +
    '.jobs-description__footer button, ' +
    'button[aria-label*="more"], ' +
    '[class*="show-more-less"] button'
  );
  if (!moreBtn) {
    for (const el of document.querySelectorAll(
      '.jobs-description button[aria-expanded="false"], ' +
      '#job-details button[aria-expanded="false"]'
    )) { moreBtn = el; break; }
  }
  if (!moreBtn) {
    for (const el of document.querySelectorAll('button, a, span[role="button"]')) {
      const t = el.textContent?.trim().toLowerCase();
      if (t === 'see more' || t === '...see more') { moreBtn = el; break; }
    }
  }
  if (moreBtn) moreBtn.click();
  await new Promise(r => setTimeout(r, 800));

  return {
    jobDescription: extractJobDescription(),
    jobMeta: extractLinkedInJobMeta() // re-extract with fully loaded panel
  };
}

function parseLinkedInTitle(raw) {
  const clean = raw.replace(/^\(\d+\)\s*/, '').trim();
  // "Job Title at Company | LinkedIn"
  const atMatch = clean.match(/^(.+?)\s+at\s+(.+?)\s*[|·]/);
  if (atMatch) return { jobTitle: atMatch[1].trim(), company: atMatch[2].trim() };
  // "Job Title | Company | LinkedIn" (used on some LinkedIn views)
  const pipeMatch = clean.match(/^(.+?)\s*\|\s*(.+?)\s*\|\s*LinkedIn/i);
  if (pipeMatch) return { jobTitle: pipeMatch[1].trim(), company: pipeMatch[2].trim() };
  return null;
}

function tryJobIdFromDom() {
  const jobId = new URLSearchParams(window.location.search).get('currentJobId');
  if (!jobId) return null;
  const jobLink = document.querySelector(`a[href*="/jobs/view/${jobId}"]`);
  const title = jobLink?.textContent?.trim();
  if (!title || title.length < 3 || title.length > 120) return null;
  const companyEl = document.querySelector(
    '.job-details-jobs-unified-top-card__company-name a, ' +
    '.job-details-jobs-unified-top-card__company-name, ' +
    '.jobs-unified-top-card__company-name a, ' +
    '.jobs-unified-top-card__company-name'
  );
  const company = companyEl?.textContent?.trim();
  if (company && company.toLowerCase() !== 'linkedin') {
    return { jobTitle: title, company };
  }
  return null;
}

function waitForJobTitle() {
  return new Promise((resolve) => {
    // Check both signals immediately
    const immediate = parseLinkedInTitle(document.title) || tryJobIdFromDom();
    if (immediate) return resolve(immediate);

    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      titleObserver.disconnect();
      domObserver.disconnect();
      clearTimeout(timeout);
      resolve(result);
    };

    // Watch <title> for when LinkedIn updates the tab heading
    const titleEl = document.querySelector('title');
    const titleObserver = new MutationObserver(() => {
      const result = parseLinkedInTitle(document.title);
      if (result) done(result);
    });
    if (titleEl) titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });

    // Watch DOM for when the job detail panel and job list render
    const domObserver = new MutationObserver(() => {
      const result = parseLinkedInTitle(document.title) || tryJobIdFromDom();
      if (result) done(result);
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

    // 4s safety timeout
    const timeout = setTimeout(() => done(null), 4000);
  });
}

async function detectLinkedIn() {
  const isJobPage = /\/jobs\//.test(window.location.pathname);
  const isCompanyPage = /\/company\/[^/]+/.test(window.location.pathname) && !isJobPage;

  if (isJobPage) {
    const titleResult = await waitForJobTitle();
    if (titleResult) {
      return { ...titleResult, source: 'linkedin', domain: null };
    }
    // Title never matched — fall through (company-only /jobs/ page or unusual layout)
  }

  // LinkedIn company pages: URL slug is authoritative — avoid sidebar link pollution
  if (isCompanyPage) {
    return detectLinkedInCompanyPage();
  }

  // Non-job pages or title timed out: DOM selectors
  const jsonLd = extractJsonLd();
  if (jsonLd) return { ...jsonLd, source: 'linkedin', domain: null };

  const domResult = await waitForLinkedInContent();
  if (domResult && domResult.company && domResult.company.toLowerCase() !== 'linkedin') {
    return { ...domResult, source: 'linkedin', domain: null };
  }

  const urlResult = extractLinkedInCompanyFromUrl();
  if (urlResult) return { ...urlResult, source: 'linkedin', domain: null };

  return { company: null, source: 'linkedin', domain: null };
}

async function detectLinkedInCompanyPage() {
  // Try the company name h1 — LinkedIn renders it in the org-top-card section
  const companySelectors = [
    '.org-top-card-summary__title',
    'h1[class*="org-top-card"]',
    '.org-top-card h1',
    'section[class*="org-top-card"] h1'
  ];
  for (const sel of companySelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 1 && text.length < 80 && text.toLowerCase() !== 'linkedin') {
      return { company: text, jobTitle: null, source: 'linkedin', domain: null };
    }
  }

  // React hasn't rendered yet — wait briefly and try again
  await new Promise(r => setTimeout(r, 1200));
  for (const sel of companySelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 1 && text.length < 80 && text.toLowerCase() !== 'linkedin') {
      return { company: text, jobTitle: null, source: 'linkedin', domain: null };
    }
  }

  // Authoritative fallback: URL slug (e.g. /company/sybill/ → "Sybill")
  const urlResult = extractLinkedInCompanyFromUrl();
  return { ...(urlResult || { company: null }), jobTitle: null, source: 'linkedin', domain: null };
}

function extractJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (entry['@type'] === 'JobPosting' && entry.hiringOrganization?.name) {
          return {
            company: entry.hiringOrganization.name,
            jobTitle: entry.title || null
          };
        }
      }
    } catch (e) {
      // malformed JSON-LD, skip
    }
  }
  return null;
}

function waitForLinkedInContent() {
  return new Promise((resolve) => {
    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '[data-tracking-control-name="public_jobs_topcard-org-name"]',
      '.job-card-container__company-name',
      'a[data-tracking-control-name*="company"]',
      '.artdeco-entity-lockup__subtitle span',
      '.jobs-details-top-card__company-url'
    ];

    const titleSelectors = [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title',
      '.topcard__title',
      'h1.t-24',
      'h1'
    ];

    function tryPageTitle() {
      const t = document.title;
      const atMatch = t.match(/^(.+?)\s+at\s+(.+?)\s*[|·]/);
      if (atMatch) return { jobTitle: atMatch[1].trim(), company: atMatch[2].trim() };
      return null;
    }

    function tryCurrentJobCard() {
      // Use currentJobId from URL to find the selected job card in the list
      const jobId = new URLSearchParams(window.location.search).get('currentJobId');
      if (!jobId) return null;
      const card = document.querySelector(
        `[data-job-id="${jobId}"], [data-occludable-job-id="${jobId}"], [data-entity-urn*="${jobId}"]`
      );
      if (card) {
        const el = card.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle, [class*="company-name"]');
        const text = el?.textContent?.trim();
        if (text && text.length > 1) return { company: text, jobTitle: null };
      }
      return null;
    }

    function companyTextFromLink(link) {
      // Text content first, fall back to img alt (LinkedIn company logos are <a><img alt="Name"></a>)
      const text = link.textContent.trim();
      if (text && text.length > 1 && text.length < 80 && text.toLowerCase() !== 'linkedin') return text;
      const img = link.querySelector('img[alt]');
      if (img) {
        const alt = img.alt.trim();
        if (alt && alt.length > 1 && alt.length < 80 && alt.toLowerCase() !== 'linkedin') return alt;
      }
      return null;
    }

    function tryCompanyLinks() {
      // Company names in LinkedIn job postings are always linked to /company/ pages
      // Prefer links in the job detail panel (right side), not the list (left side)
      const jobId = new URLSearchParams(window.location.search).get('currentJobId');
      const scope = jobId
        ? (document.querySelector(`[data-job-id="${jobId}"], [data-occludable-job-id="${jobId}"]`) || document)
        : document;
      const links = scope.querySelectorAll('a[href*="/company/"]');
      for (const link of links) {
        const name = companyTextFromLink(link);
        if (name) return { company: name, jobTitle: null };
      }
      // Fall back to searching whole document
      if (scope !== document) return tryCompanyLinks.fromDoc();
      return null;
    }
    tryCompanyLinks.fromDoc = () => {
      const links = document.querySelectorAll('a[href*="/company/"]');
      for (const link of links) {
        const name = companyTextFromLink(link);
        if (name) return { company: name, jobTitle: null };
      }
      return null;
    };

    function trySelectors() {
      for (const sel of companySelectors) {
        const el = document.querySelector(sel);
        const text = el?.textContent?.trim();
        if (text && text.length > 1 && text.toLowerCase() !== 'linkedin') {
          let jobTitle = null;
          for (const tSel of titleSelectors) {
            const tEl = document.querySelector(tSel);
            const t = tEl?.textContent?.trim();
            // Keep title short enough to be a real title, not a container with lots of child text
            if (t && t.length > 1 && t.length < 120) { jobTitle = t; break; }
          }
          return { company: text, jobTitle };
        }
      }
      return tryCurrentJobCard() || tryPageTitle() || tryCompanyLinks();
    }

    const immediate = trySelectors();
    if (immediate) return resolve(immediate);

    let resolved = false;

    // Watch both head (title changes) and body (content changes)
    const observer = new MutationObserver(() => {
      const result = trySelectors();
      if (result) {
        resolved = true;
        observer.disconnect();
        clearInterval(poll);
        resolve(result);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Poll title directly every 300ms as a safety net
    const poll = setInterval(() => {
      const result = tryPageTitle();
      if (result) {
        resolved = true;
        observer.disconnect();
        clearInterval(poll);
        resolve(result);
      }
    }, 300);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        clearInterval(poll);
        resolve(trySelectors());
      }
    }, 2500);
  });
}

function extractLinkedInCompanyFromUrl() {
  // Matches: /company/some-company-name/
  const match = window.location.pathname.match(/\/company\/([^/]+)/);
  if (match) {
    const company = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { company, jobTitle: null };
  }
  return null;
}

function detectGreenhouse() {
  const company = document.querySelector('.company-name, #header .company-name, .greenhouse-header');
  const job = document.querySelector('#app_body h1, .app-title');
  return {
    company: company ? company.textContent.trim() : extractDomain(),
    jobTitle: job ? job.textContent.trim() : null,
    source: 'greenhouse',
    domain: null
  };
}

function detectLever() {
  const company = document.querySelector('.main-header-logo img');
  const job = document.querySelector('.posting-headline h2');
  return {
    company: company ? company.alt : extractDomain(),
    jobTitle: job ? job.textContent.trim() : null,
    source: 'lever',
    domain: null
  };
}

function detectGeneric() {
  const domain = window.location.hostname.replace('www.', '');

  // 1. og:site_name is the most authoritative signal
  const siteName = document.querySelector('meta[property="og:site_name"]');
  if (siteName?.getAttribute('content')?.trim()) {
    return { company: siteName.getAttribute('content').trim(), source: 'generic', domain };
  }

  // 2. Split page title on separators — brand name is almost always the LAST segment
  //    e.g. "The fastest way to ship ChatGPT apps | Fractal" → "Fractal"
  const rawTitle = document.title.replace(/^\(\d+\)\s*/, '').trim();
  const segments = rawTitle.split(/\s*[|·—–]\s*/).map(s => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (last.length > 1 && last.length < 50 && !/jobs|careers|hiring/i.test(last)) {
      return { company: last, source: 'generic', domain };
    }
  }
  // First segment if it's short enough to be a brand name (not a tagline)
  if (segments.length > 0) {
    const first = segments[0];
    if (first.length > 1 && first.length < 35 && !/jobs|careers|hiring/i.test(first)) {
      return { company: first, source: 'generic', domain };
    }
  }

  // 3. Smart domain extraction
  return { company: extractDomain(), source: 'generic', domain };
}

function extractLinkedInJobTitle() {
  // 1. Page title — works on direct job pages: "Account Executive at Runpod | LinkedIn"
  const cleanTitle = document.title.replace(/^\(\d+\)\s*/, '');
  const titleMatch = cleanTitle.match(/^(.+?)\s+at\s+.+?\s*[|·]/);
  if (titleMatch) return titleMatch[1].trim();

  // 2. Find the job title via the /jobs/view/{id} link — most reliable on search feed
  const jobId = new URLSearchParams(window.location.search).get('currentJobId');
  if (jobId) {
    // The job title is always the link text of the a[href*="/jobs/view/{id}"] anchor
    const jobLink = document.querySelector(`a[href*="/jobs/view/${jobId}"]`);
    if (jobLink) {
      const text = jobLink.textContent.trim();
      if (text && text.length > 1 && text.length < 120) return text;
    }
    // Fallback: find the selected card and look inside it
    const card = document.querySelector(
      `[data-job-id="${jobId}"], [data-occludable-job-id="${jobId}"], [data-entity-urn*="${jobId}"]`
    );
    if (card) {
      const el = card.querySelector('.job-card-list__title--link, .job-card-list__title, a[href*="/jobs/view/"]');
      const text = el?.textContent?.trim();
      if (text && text.length > 1 && text.length < 120) return text;
    }
  }

  // 3. CSS selectors for the detail panel (try both h1 and h2 and generic containers)
  const detailSelectors = [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title h2',
    '.job-details-jobs-unified-top-card__job-title a',
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title h2',
    'h2.t-24', 'h1.t-24',
    '.topcard__title',
    '[class*="job-details-top-card"] h1',
    '[class*="job-details-top-card"] h2'
  ];
  for (const sel of detailSelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 1 && text.length < 120) return text;
  }

  // 4. h1 only — strict length cap to avoid LinkedIn section headers
  // No h2: too risky (LinkedIn uses h2 for "Use AI to assess", "This job alert is on", etc.)
  for (const el of document.querySelectorAll('h1')) {
    const text = el.textContent.trim();
    // Job titles are short; long h1s are nav/branding elements
    if (text && text.length > 3 && text.length < 80 &&
        !/^\d/.test(text) &&
        !/(linkedin|sign in|join now|easy apply|hiring pro)/i.test(text)) {
      return text;
    }
  }

  return null;
}

function extractLinkedInJobMeta() {
  const result = { workArrangement: null, salary: null, employmentType: null, location: null };

  // Find the job detail panel to scope the search
  const panelSelectors = [
    '#job-details',
    '.jobs-search__job-details--wrapper',
    '.scaffold-layout__detail',
    '[class*="jobs-search__job-details"]',
    '.job-details-jobs-unified-top-card__container',
    '.jobs-unified-top-card'
  ];
  let panel = null;
  for (const sel of panelSelectors) {
    const el = document.querySelector(sel);
    if (el) { panel = el; break; }
  }
  const scope = panel || document;

  // Try specific insight selectors first
  const candidateTexts = [];
  scope.querySelectorAll(
    '.job-details-jobs-unified-top-card__job-insight, ' +
    '.jobs-unified-top-card__job-insight, ' +
    'li[class*="job-insight"], ' +
    '[class*="workplace-type"], ' +
    '[class*="preference-pill"], ' +
    '[class*="job-detail-preference"]'
  ).forEach(el => {
    const t = el.textContent?.trim();
    if (t && t.length > 0 && t.length < 120) candidateTexts.push(t);
  });

  // Broad fallback: scan all leaf-node spans and buttons for short text fragments
  // This catches LinkedIn's filter chip UI regardless of class names
  if (candidateTexts.length === 0) {
    scope.querySelectorAll('span, button, li').forEach(el => {
      if (el.querySelector('span, button, li')) return; // skip non-leaf nodes
      const t = el.textContent?.trim();
      if (t && t.length > 1 && t.length < 70) candidateTexts.push(t);
    });
  }

  for (const t of candidateTexts) {
    if (!result.workArrangement) {
      if (/\bremote\b/i.test(t)) result.workArrangement = 'Remote';
      else if (/\bhybrid\b/i.test(t)) result.workArrangement = 'Hybrid';
      else if (/\bon.?site\b/i.test(t)) result.workArrangement = 'On-site';
    }
    if (!result.employmentType) {
      if (/\bfull.?time\b/i.test(t)) result.employmentType = 'Full-time';
      else if (/\bpart.?time\b/i.test(t)) result.employmentType = 'Part-time';
      else if (/\bcontract\b/i.test(t)) result.employmentType = 'Contract';
      else if (/\binternship\b/i.test(t)) result.employmentType = 'Internship';
    }
    if (!result.salary && /\$[\d,K]+/.test(t) && t.length < 60) result.salary = t;
  }

  // Location — specific selectors then broad fallback
  const locationSelectors = [
    '.job-details-jobs-unified-top-card__primary-description-without-tagline .tvm__text',
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
    '.topcard__flavor--bullet'
  ];
  for (const sel of locationSelectors) {
    const el = document.querySelector(sel);
    const t = el?.textContent?.trim();
    if (t && t.length > 2 && t.length < 80 && !/\d+ applicant/i.test(t) && !/ago/i.test(t)) {
      result.location = t; break;
    }
  }
  if (!result.location && scope) {
    for (const el of scope.querySelectorAll('span, li')) {
      if (el.querySelector('span, li')) continue;
      const t = el.textContent?.trim();
      if (!t || t.length > 80) continue;
      if (/united states|united kingdom|canada|australia/i.test(t) ||
          /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(t)) {
        result.location = t; break;
      }
    }
  }

  return result;
}

function waitForJobDescriptionPanel() {
  const descSelectors = [
    '#job-details',
    '.jobs-description-content__text',
    '.jobs-description__content',
    '.jobs-description',
    '.jobs-search__job-details--wrapper',
    '.scaffold-layout__detail',
    '[class*="jobs-search__job-details"]',
    '[class*="job-details-module"]'
  ];

  function isReady() {
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText?.trim().length > 80) return true;
    }
    return false;
  }

  // Always wait a minimum 600ms settle time — prevents immediately reading stale content
  // when LinkedIn swaps jobs in-place (old panel content still present when we check)
  return new Promise((resolve) => {
    setTimeout(() => {
      if (isReady()) { resolve(); return; }
      const observer = new MutationObserver(() => {
        if (isReady()) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timeout = setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
    }, 600);
  });
}

function extractJobDescription() {
  const candidates = [];

  // Find the scoped detail panel — on search-results pages the description lives inside
  // one of these containers, not in the full document. Scoping prevents grabbing sidebar cards.
  const panelSelectors = [
    '#job-details',
    '.jobs-search__job-details--wrapper',
    '.scaffold-layout__detail',
    '[class*="jobs-search__job-details"]',
    '[class*="job-details-module"]',
    '.jobs-description__content',
    '.jobs-description'
  ];
  let panel = null;
  for (const sel of panelSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText?.trim().length > 80) { panel = el; break; }
  }

  // Search within the panel (or document if no panel found)
  const scope = panel || document;

  // LinkedIn description content selectors — scoped
  const linkedinSelectors = [
    '.jobs-description-content__text--truncated',
    '.jobs-description-content__text',
    '.jobs-description__content .jobs-box__html-content',
    '.jobs-description__content',
    '.jobs-description',
  ];
  for (const sel of linkedinSelectors) {
    const el = scope.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 150) candidates.push(text);
  }

  // "About the job" heading — walk UP from the heading until we find a container with real content
  for (const el of scope.querySelectorAll('h2, h3')) {
    if (/about the (job|role)/i.test(el.textContent.trim())) {
      let container = el.parentElement;
      while (container && container !== scope && container !== document.body) {
        const text = container.innerText?.trim();
        if (text && text.length > 300) { candidates.push(text); break; }
        container = container.parentElement;
      }
    }
  }

  // #job-details direct text — always try this regardless of panel scoping
  const jobDetailsEl = document.querySelector('#job-details');
  if (jobDetailsEl) {
    const text = jobDetailsEl.innerText?.trim();
    if (text && text.length > 150) candidates.push(text);
  }

  // Panel itself with premium/promo nodes stripped — catches any remaining structure
  // Note: use textContent not innerText — innerText returns empty on detached clones
  if (panel) {
    const clone = panel.cloneNode(true);
    clone.querySelectorAll('[class*="premium"], [class*="promoted"], [class*="upsell"], .artdeco-card, [class*="job-alert"], [class*="similar-jobs"]').forEach(n => n.remove());
    const text = clone.textContent?.replace(/\s+/g, ' ').trim();
    if (text && text.length > 150) candidates.push(text);
  }

  // Use the longest candidate — most likely to be the full, expanded description
  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => a.length > b.length ? a : b);
    return best.slice(0, 4000);
  }

  // Non-LinkedIn platforms (Greenhouse, Lever, generic job boards)
  const genericSelectors = [
    '#app_body .job-description',
    '.job-description',
    '#content .section-wrapper',
    '.posting-description',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
    'article'
  ];
  for (const sel of genericSelectors) {
    const el = document.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 150) return text.slice(0, 4000);
  }
  return null;
}

function extractDomain() {
  const raw = window.location.hostname
    .replace('www.', '')
    .replace(/\.(com|io|ai|co|net|org|dev|app|co\.uk).*/, '');
  // Strip common vanity prefixes: usefractal → fractal, getdropbox → dropbox
  const stripped = raw.replace(/^(use|get|try|go|my|join|app|the|hey|meet|say|hello)/i, '');
  const name = stripped.length > 1 ? stripped : raw;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
