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
  if (message.type === 'GET_SELECTION') {
    sendResponse({ selection: window.getSelection()?.toString()?.trim() || '' });
    return true;
  }
  if (message.type === 'TOGGLE_SIDEBAR') {
    toggleFloatingSidebar();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'OPEN_FLOATING_CHAT') {
    // Floating chat removed — chat lives inline in sidebar only
    sendResponse({ ok: true });
    return true;
  }

  return true;
});



function extractMyLinkedInProfile() {
  const parts = [];

  // Name + headline from the top card
  const name = document.querySelector('h1')?.textContent?.trim();
  const headline = document.querySelector('.text-body-medium.break-words')?.textContent?.trim();
  if (name) parts.push(`Name: ${name}`);
  if (headline) parts.push(`Headline: ${headline}\n`);

  // Extract a named section by its anchor id
  function sectionText(anchorId) {
    const anchor = document.getElementById(anchorId);
    if (!anchor) return null;
    // The anchor sits inside the section heading; walk up to the section container
    let el = anchor;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement;
      if (!el) break;
      const text = el.innerText?.trim();
      // Section containers typically have the heading + items — look for substantial content
      if (text && text.length > 80) return text;
    }
    return null;
  }

  const about = sectionText('about');
  if (about) parts.push(`About:\n${about.replace(/^About\s*\n/, '')}\n`);

  const experience = sectionText('experience');
  if (experience) parts.push(`Experience:\n${experience.replace(/^Experience\s*\n/, '')}\n`);

  const education = sectionText('education');
  if (education) parts.push(`Education:\n${education.replace(/^Education\s*\n/, '')}\n`);

  const skills = sectionText('skills');
  if (skills) parts.push(`Skills:\n${skills.replace(/^Skills\s*\n/, '')}`);

  const result = parts.join('\n').trim();
  // Truncate to keep it usable as prompt context (~4000 chars)
  return result.slice(0, 4000) || null;
}

async function detectCompanyAndJob() {
  const url = window.location.href;
  let result;

  if (url.includes('linkedin.com')) {
    result = await detectLinkedIn();
  } else if (url.includes('greenhouse.io') || url.includes('boards.greenhouse.io')) {
    result = detectGreenhouse();
  } else if (url.includes('lever.co')) {
    result = detectLever();
  } else if (url.includes('myworkdayjobs.com') || url.includes('workday.com')) {
    result = detectWorkday();
  } else if (url.includes('workatastartup.com')) {
    result = detectWorkAtAStartup();
  } else if (url.includes('ashbyhq.com') || url.includes('jobs.ashbyhq.com')) {
    result = detectAshby();
  } else if (url.includes('ats.rippling.com')) {
    result = detectRippling();
  } else if (url.includes('workable.com')) {
    result = detectWorkable();
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

  // Detect Easy Apply — check after meta extraction when DOM is more fully rendered
  if (result && /linkedin/i.test(result.source)) {
    const easyApplyBtn = document.querySelector(
      'button[aria-label*="Easy Apply"],' +
      'button.jobs-apply-button[aria-label*="Easy Apply"],' +
      '.jobs-apply-button--top-card button,' +
      '.jobs-s-apply button[aria-label*="Easy Apply"],' +
      'button[data-control-name="jobdetails_topcard_inapply"]'
    );
    // Also check by button text content as a fallback
    if (easyApplyBtn) {
      result.easyApply = true;
    } else {
      const allBtns = document.querySelectorAll('button');
      result.easyApply = [...allBtns].some(b => /easy\s*apply/i.test(b.textContent));
    }
  }

  // Strip trailing punctuation from company name (prevents cache key mismatches like "Warmly," vs "Warmly")
  if (result?.company) {
    result.company = result.company.replace(/[,;:!?.]+$/, '').trim();
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

  const jobMeta = extractLinkedInJobMeta();

  // Always scan the job description body for an explicit company-stated salary.
  // This overrides anything scraped from LinkedIn's chip/insight widgets, which
  // show market estimates (e.g. "$270K–$315K/yr") instead of the stated salary.
  const descEl = document.querySelector('#job-details, .jobs-description__content, .jobs-description');
  if (descEl) {
    const text = descEl.innerText || '';
    // Highest priority: explicit "the [estimated/base/annual] [cash] salary for this role is $X"
    const disclosure = text.match(/(?:the\s+)?(?:estimated|base|annual)\s+(?:cash\s+)?(?:base\s+)?salary[^$\n]{0,60}\$([\d,]+(?:\.\d+)?(?:K)?)\b/i)
      || text.match(/\$[\d,]+(?:\.\d+)?(?:K)?\s*(?:per year|\/yr|annually|USD|a year)\b/i);
    if (disclosure) {
      jobMeta.salary = disclosure[0].trim();
    }
  }

  return {
    jobDescription: extractJobDescription(),
    jobMeta
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
  const path = window.location.pathname;
  const isJobPage = /\/jobs\//.test(path);
  const isCompanyPage = /\/company\/[^/]+/.test(path) && !isJobPage;
  const isProfilePage = /\/in\/[^/]+/.test(path);

  // Only detect on company pages, job pages, and profile pages
  // Skip feed, messaging, notifications, search, mynetwork
  if (!isJobPage && !isCompanyPage && !isProfilePage) {
    return { company: null, source: 'linkedin', domain: null };
  }

  if (isJobPage) {
    const titleResult = await waitForJobTitle();
    if (titleResult) {
      const companyLinkedinUrl = extractLinkedInCompanyUrlFromJobPage();
      const linkedinFirmo = extractLinkedInCompanyFirmo();
      return { ...titleResult, source: 'linkedin', domain: null, companyLinkedinUrl, linkedinFirmo };
    }
    // Title never matched — fall through (company-only /jobs/ page or unusual layout)
  }

  // LinkedIn company pages: URL slug is authoritative — avoid sidebar link pollution
  if (isCompanyPage) {
    return detectLinkedInCompanyPage();
  }

  // Profile pages: extract current employer from the profile top card
  if (isProfilePage) {
    const profileCompany = await detectLinkedInProfileCompany();
    return { ...profileCompany, source: 'linkedin', domain: null };
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

function classifyFirmoText(text, result) {
  if (/\d+.*employees?/i.test(text)) {
    result.employees = text.replace(/\s*employees?/i, '').trim();
    return;
  }
  if (/followers?/i.test(text)) {
    result.followers = text.replace(/\s*followers?/i, '').trim();
    return;
  }
  if (/,/.test(text) && text.length < 50 && !/\d{2,}/.test(text)) {
    if (!result.location) result.location = text;
    return;
  }
  if (text.length > 2 && text.length < 60 && !result.industry) {
    result.industry = text;
  }
}

function extractLinkedInCompanyFirmo() {
  const result = { employees: null, industry: null, location: null, tagline: null, followers: null };

  // Strategy 1: Find subtitle container with structured child elements
  const subtitleSelectors = [
    '.org-top-card-summary-info-list',
    '.org-top-card-summary__info-list',
    'div[class*="org-top-card-summary"] .text-body-small',
    'section[class*="org-top-card"] .text-body-small',
  ];
  for (const sel of subtitleSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const items = el.querySelectorAll('div, span, li');
    for (const item of items) {
      const text = item.textContent?.trim();
      if (!text || text.length > 80) continue;
      classifyFirmoText(text, result);
    }
    if (result.employees || result.industry) break;
  }

  // Strategy 2: Parse single subtitle string (fallback)
  if (!result.employees && !result.industry) {
    const subtitleEl = document.querySelector(
      '.org-top-card-summary__tagline, div[class*="org-top-card"] .text-body-small'
    );
    const fullText = subtitleEl?.textContent?.trim();
    if (fullText) {
      fullText.split('·').map(p => p.trim()).forEach(p => classifyFirmoText(p, result));
    }
  }

  // Tagline
  for (const sel of ['.org-top-card-summary__tagline', 'p[class*="org-top-card"][class*="tagline"]']) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 3 && text.length < 200) { result.tagline = text; break; }
  }

  return (result.employees || result.industry || result.location) ? result : null;
}

async function detectLinkedInProfileCompany() {
  // On LinkedIn profile pages, extract the current employer from the top card.
  // The top card shows "Title @ Company" or has a company link next to the headline.
  // We must NOT scan the whole page for /company/ links — that picks up past employers,
  // sidebar suggestions, ads, etc.

  // Wait briefly for React to render the profile top card
  await new Promise(r => setTimeout(r, 800));

  // Strategy 1: Look for the company link/button in the profile top card area
  // LinkedIn profiles have an experience overlay link near the headline
  const topCardSelectors = [
    // Current employer link in the top card (most reliable)
    '.pv-text-details__right-panel a[href*="/company/"]',
    '.pv-top-card--experience-list-item a[href*="/company/"]',
    // The inline company text next to headline
    'button[aria-label*="Current company"]',
    '.text-body-medium a[href*="/company/"]',
  ];
  for (const sel of topCardSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 1 && text.length < 80 && text.toLowerCase() !== 'linkedin') {
        return { company: text, jobTitle: null };
      }
    }
  }

  // Strategy 2: Parse the headline "Title @ Company" or "Title at Company"
  const headlineEl = document.querySelector('.text-body-medium');
  if (headlineEl) {
    const headline = headlineEl.textContent.trim();
    const atMatch = headline.match(/(?:@|at)\s+(.+?)$/i);
    if (atMatch) {
      const company = atMatch[1].trim();
      if (company.length > 1 && company.length < 80) {
        return { company, jobTitle: null };
      }
    }
  }

  // Strategy 3: First experience item company name (most recent role)
  const expCompanyEl = document.querySelector(
    '#experience ~ .pvs-list__outer-container .hoverable-link-text span[aria-hidden="true"],' +
    '.experience-section .pv-entity__secondary-title,' +
    'section[id*="experience"] .hoverable-link-text'
  );
  if (expCompanyEl) {
    const text = expCompanyEl.textContent.trim();
    if (text && text.length > 1 && text.length < 80) {
      return { company: text, jobTitle: null };
    }
  }

  // Strategy 4: The company badge/logo link shown next to the person's name
  const badgeLink = document.querySelector('.pv-top-card--photo-resize a[href*="/company/"]');
  if (badgeLink) {
    const img = badgeLink.querySelector('img[alt]');
    if (img?.alt && img.alt.length > 1 && img.alt.length < 80) {
      return { company: img.alt.trim(), jobTitle: null };
    }
  }

  return { company: null, jobTitle: null };
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
      const linkedinFirmo = extractLinkedInCompanyFirmo();
      return { company: text, jobTitle: null, source: 'linkedin', domain: null, linkedinFirmo };
    }
  }

  // React hasn't rendered yet — wait briefly and try again
  await new Promise(r => setTimeout(r, 1200));
  for (const sel of companySelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 1 && text.length < 80 && text.toLowerCase() !== 'linkedin') {
      const linkedinFirmo = extractLinkedInCompanyFirmo();
      return { company: text, jobTitle: null, source: 'linkedin', domain: null, linkedinFirmo };
    }
  }

  // Authoritative fallback: URL slug (e.g. /company/sybill/ → "Sybill")
  const urlResult = extractLinkedInCompanyFromUrl();
  const linkedinFirmo = extractLinkedInCompanyFirmo();
  return { ...(urlResult || { company: null }), jobTitle: null, source: 'linkedin', domain: null, linkedinFirmo };
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

function extractLinkedInCompanyUrlFromJobPage() {
  // LinkedIn job pages always have a link to the company's LinkedIn page in the job detail panel
  const jobId = new URLSearchParams(window.location.search).get('currentJobId');
  const scope = jobId
    ? (document.querySelector(`[data-job-id="${jobId}"], [data-occludable-job-id="${jobId}"]`) || document)
    : document;
  const sources = scope !== document ? [scope, document] : [document];
  for (const root of sources) {
    for (const link of root.querySelectorAll('a[href*="/company/"]')) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/company\/([^/?#]+)/);
      if (m && m[1] && m[1] !== 'unavailable') {
        const slug = href.split('?')[0].replace(/\/$/, '');
        return slug.startsWith('http') ? slug : 'https://www.linkedin.com' + slug;
      }
    }
  }
  return null;
}

function detectGreenhouse() {
  let company = null;
  let jobTitle = null;

  // 1. Explicit company name element
  const companyEl = document.querySelector('.company-name, #header .company-name, .greenhouse-header');
  if (companyEl) company = companyEl.textContent.trim();

  // 2. URL path: /octopusdeploy/jobs/... or boards.greenhouse.io/octopusdeploy
  if (!company) {
    const pathMatch = window.location.pathname.match(/^\/([a-z0-9_-]+)\/(?:jobs|embed)/i)
      || window.location.pathname.match(/^\/([a-z0-9_-]+)\/?$/i);
    if (pathMatch && pathMatch[1] !== 'jobs') {
      company = pathMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // 3. Look for "About [Company]" heading on the page
  if (!company) {
    for (const h of document.querySelectorAll('h2, h3, strong')) {
      const m = h.textContent?.trim().match(/^About\s+(.+?)[:.]?$/i);
      if (m && m[1].length > 1 && m[1].length < 60) { company = m[1]; break; }
    }
  }

  // 4. og:title: "Strategic Account Executive at Octopus Deploy"
  if (!company) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const atMatch = ogTitle?.match(/\bat\s+(.+?)$/i);
    if (atMatch) company = atMatch[1].trim();
  }

  if (!company) company = extractDomain();

  // Job title
  const jobEl = document.querySelector('#app_body h1, .app-title, h1');
  if (jobEl) jobTitle = jobEl.textContent.trim();
  // Strip "at Company" from job title if present
  if (jobTitle && company && jobTitle.toLowerCase().includes(' at ')) {
    jobTitle = jobTitle.replace(new RegExp('\\s+at\\s+' + company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), '').trim();
  }

  return { company, jobTitle: jobTitle || null, source: 'greenhouse', domain: null };
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

function detectWorkday() {
  const domain = window.location.hostname;

  // Company: og:site_name is most reliable ("DataRobot Careers" → strip "Careers")
  let company = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
  if (company) company = company.replace(/\s*(careers|jobs|hiring)\s*$/i, '').trim();

  // Page title: "Account Executive | Rocket Software Careers" → last segment, strip "Careers"
  if (!company) {
    const segs = document.title.replace(/^\(\d+\)\s*/, '').split(/\s*[|·—–]\s*/);
    if (segs.length > 1) company = segs[segs.length - 1].replace(/\s*(careers|jobs|hiring)\s*$/i, '').trim();
  }

  // Workday logo / branding: look for company logo alt text or aria-label
  if (!company) {
    const logo = document.querySelector('[data-automation-id="logo"] img, [data-automation-id="companyLogo"] img, .css-1oqqr0l img, header img[alt]');
    const alt = logo?.getAttribute('alt')?.trim();
    if (alt && alt.length > 1 && alt.length < 60 && !/workday/i.test(alt)) {
      company = alt.replace(/\s*(careers|jobs|hiring|logo)\s*$/i, '').trim();
    }
  }

  // URL path: "/rocket_careers/job/..." → "Rocket" (capitalize, strip _careers suffix)
  if (!company) {
    const pathMatch = window.location.pathname.match(/^\/([a-z][a-z0-9_]+?)(?:_careers|_jobs)?\//i);
    if (pathMatch && pathMatch[1].length > 1 && !/^(job|jobs|en|us)$/i.test(pathMatch[1])) {
      company = pathMatch[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // First mention of company in job description body (e.g., "Rocket Software is seeking...")
  if (!company) {
    const descEl = document.querySelector('[data-automation-id="jobPostingDescription"]');
    if (descEl) {
      // Look for "CompanyName is seeking/looking/hiring" pattern in first 500 chars
      const descText = descEl.textContent?.slice(0, 500) || '';
      const nameMatch = descText.match(/^([A-Z][A-Za-z\s&.]+?)\s+(?:is\s+(?:seeking|looking|hiring|a\s)|seeks\s|has\s)/);
      if (nameMatch && nameMatch[1].length > 2 && nameMatch[1].length < 50) {
        company = nameMatch[1].trim();
      }
    }
  }

  // Workday subdomain: "rocket.wd5.myworkdayjobs.com" → "Rocket"
  if (!company) {
    const subMatch = domain.match(/^([a-z][a-z0-9]+)\.wd\d+\.myworkdayjobs\.com$/i);
    if (subMatch) {
      company = subMatch[1].charAt(0).toUpperCase() + subMatch[1].slice(1);
    }
  }
  if (!company) company = extractDomain();

  // Job title: Workday uses data-automation-id attributes
  let jobTitle = document.querySelector('[data-automation-id="jobPostingTitle"]')?.textContent?.trim()
    || document.querySelector('[data-automation-id="heading"]')?.textContent?.trim();
  if (!jobTitle) {
    // Page title first segment: "Account Executive | DataRobot Careers"
    const segs = document.title.replace(/^\(\d+\)\s*/, '').split(/\s*[|·—–]\s*/);
    const first = segs[0]?.trim();
    if (first && first.length > 1 && first.length < 100 && !/jobs|careers|hiring/i.test(first)) {
      jobTitle = first;
    }
  }
  if (!jobTitle) {
    // URL path: /job/Boston.../Account-Executive_R-102609 → "Account Executive"
    const urlSeg = window.location.pathname.split('/job/').pop()?.split('/').pop();
    if (urlSeg) {
      const fromUrl = urlSeg.replace(/_[A-Z]\d+$/, '').replace(/-/g, ' ');
      if (fromUrl.length > 2 && fromUrl.length < 80) jobTitle = fromUrl;
    }
  }

  return { company, jobTitle: jobTitle || null, source: 'workday', domain };
}

function detectWorkAtAStartup() {
  const domain = window.location.hostname.replace('www.', '');

  // Job page: title is "Account Executive (US) at kapa.ai (S23)"
  // Extract company from "at [company]" pattern in title or page heading
  let company = null;
  let jobTitle = null;

  // Strip site suffix from title: "... | Y Combinator's Work at a Startup" or " - Y Combinator..."
  const rawTitle = document.title
    .replace(/\s*[|·—–]\s*Y\s*Combinator.*$/i, '')
    .replace(/\s*[|·—–]\s*Work\s+at\s+a\s+Startup.*$/i, '')
    .trim();

  // Title patterns:
  // "Account Executive (US) at kapa.ai (S23)"
  // "Head of Sales - Vector at Vector (W23)"
  const titleMatch = rawTitle.match(/^(.+?)\s+at\s+([^|]+?)(?:\s*\([SW]\d+\))?\s*$/i);
  if (titleMatch) {
    jobTitle = titleMatch[1].trim();
    company = titleMatch[2].replace(/\s*\([SW]\d+\)\s*$/i, '').trim();
    // Clean job title: "Head of Sales - Vector" → "Head of Sales" (strip company name from title)
    if (company && jobTitle.endsWith('- ' + company)) {
      jobTitle = jobTitle.slice(0, -(company.length + 2)).trim();
    }
  }

  // Fallback: breadcrumb "Companies / kapa.ai (S23) / Jobs"
  if (!company) {
    const breadcrumbs = document.querySelectorAll('a[href*="/companies/"]');
    for (const bc of breadcrumbs) {
      const text = bc.textContent?.trim();
      if (text && text.length > 1 && text.length < 60) {
        company = text.replace(/\s*\([SW]\d+\)\s*$/i, '').trim();
        break;
      }
    }
  }

  // Fallback: h1 heading
  if (!jobTitle) {
    const h1 = document.querySelector('h1');
    if (h1) {
      const h1Text = h1.textContent?.trim();
      const m = h1Text?.match(/^(.+?)\s+at\s+(.+?)(?:\s*\([SW]\d+\))?$/i);
      if (m) {
        jobTitle = m[1].trim();
        if (!company) company = m[2].replace(/\s*\([SW]\d+\)\s*$/i, '').trim();
      } else {
        jobTitle = h1Text;
      }
    }
  }

  if (!company) company = 'Unknown Company';

  return { company, jobTitle: jobTitle || null, source: 'workatastartup', domain };
}

function detectAshby() {
  let company = null;
  let jobTitle = null;

  // 1. Company logo alt text (most reliable on Ashby pages)
  const logoImg = document.querySelector('img[alt]');
  if (logoImg?.alt && logoImg.alt.length > 1 && logoImg.alt.length < 50 && !/ashby/i.test(logoImg.alt)) {
    company = logoImg.alt.trim();
  }

  // 2. Page title: "Account Manager, Upper Mid-Market | Absorb"
  if (!company) {
    const segs = document.title.split(/\s*[|·—–]\s*/);
    if (segs.length > 1) {
      const last = segs[segs.length - 1].trim();
      if (last.length > 1 && last.length < 50 && !/ashby/i.test(last)) company = last;
    }
  }

  // 3. og:site_name or og:title
  if (!company) {
    const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
    if (ogSite && !/ashby/i.test(ogSite)) company = ogSite;
  }
  if (!company) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const atMatch = ogTitle?.match(/\bat\s+(.+?)$/i);
    if (atMatch && !/ashby/i.test(atMatch[1])) company = atMatch[1].trim();
  }

  // 4. URL path: jobs.ashbyhq.com/meshy/... → "Meshy"
  if (!company) {
    const pathSlug = window.location.pathname.split('/').filter(Boolean)[0];
    if (pathSlug && pathSlug.length > 1 && pathSlug.length < 40 && !/^[0-9a-f-]{20,}$/.test(pathSlug)) {
      company = pathSlug.charAt(0).toUpperCase() + pathSlug.slice(1);
    }
  }

  // 5. Subdomain fallback: absorb.jobs.ashbyhq.com → "Absorb"
  if (!company) {
    const host = window.location.hostname;
    const parts = host.split('.');
    if (parts.length > 2 && parts[0] !== 'jobs' && parts[0] !== 'www') {
      company = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
  }

  // 6. Page content: "About Meshy" or "MESHY LLC"
  if (!company || company === 'Unknown Company') {
    for (const el of document.querySelectorAll('h1, h2, h3, strong')) {
      const t = el.textContent?.trim();
      const aboutMatch = t?.match(/^About\s+(.+?)$/i);
      if (aboutMatch && aboutMatch[1].length > 1) { company = aboutMatch[1]; break; }
      // Company name as standalone heading (e.g., "MESHY LLC")
      if (t && t.length > 1 && t.length < 40 && /^[A-Z]/.test(t) && !/account|manager|executive|engineer|designer|apply|overview|application/i.test(t)) {
        company = t.replace(/\s*(LLC|Inc\.?|Corp\.?|Ltd\.?)$/i, '').trim();
        break;
      }
    }
  }

  if (!company) company = 'Unknown Company';

  // Job title from h1
  const h1 = document.querySelector('h1');
  if (h1) jobTitle = h1.textContent.trim();

  return { company, jobTitle: jobTitle || null, source: 'ashby', domain: null };
}

function detectRippling() {
  // URL: ats.rippling.com/{company-slug}/jobs/{id}
  const pathMatch = window.location.pathname.match(/^\/([^/]+)\/jobs\//);
  let company = null;
  if (pathMatch && pathMatch[1]) {
    company = pathMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Page title: "Enterprise Account Executive - Consensus" or og:title
  if (!company) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
    if (ogTitle) {
      const parts = ogTitle.split(/\s*[-–—|]\s*/);
      if (parts.length > 1) company = parts[parts.length - 1].trim();
    }
  }
  if (!company) {
    const parts = document.title.split(/\s*[-–—|]\s*/);
    if (parts.length > 1) company = parts[parts.length - 1].replace(/\s*(careers|jobs|hiring)\s*$/i, '').trim();
  }

  // Job title from h1 or breadcrumb
  let jobTitle = document.querySelector('h1')?.textContent?.trim();
  if (!jobTitle) {
    const breadcrumb = document.querySelector('nav a:last-child, .breadcrumb :last-child');
    jobTitle = breadcrumb?.textContent?.trim();
  }

  if (!company) company = 'Unknown Company';
  return { company, jobTitle: jobTitle || null, source: 'rippling', domain: null };
}

function detectWorkable() {
  // URL: jobs.workable.com/{company-slug}/{job-id} or apply.workable.com/...
  const hostname = window.location.hostname;
  let company = null;

  // Workable subdomain: {company}.workable.com
  const subMatch = hostname.match(/^([a-z][a-z0-9-]+)\.workable\.com$/i);
  if (subMatch && subMatch[1] !== 'jobs' && subMatch[1] !== 'apply' && subMatch[1] !== 'www') {
    company = subMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // URL path: jobs.workable.com/{company-slug}/{job-id}
  if (!company) {
    const pathMatch = window.location.pathname.match(/^\/([a-z][a-z0-9-]+)\//i);
    if (pathMatch && pathMatch[1].length > 2 && !/^(j|jobs|apply|careers)$/i.test(pathMatch[1])) {
      company = pathMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // og:site_name or og:title
  if (!company) {
    const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
    if (siteName && siteName.length > 1 && !/workable/i.test(siteName)) {
      company = siteName.replace(/\s*(careers|jobs|hiring)\s*$/i, '').trim();
    }
  }
  if (!company) {
    const parts = document.title.split(/\s*[-–—|]\s*/);
    if (parts.length > 1) company = parts[parts.length - 1].replace(/\s*(careers|jobs|hiring)\s*$/i, '').trim();
  }

  // Job title from h1 or data attributes
  let jobTitle = document.querySelector('h1')?.textContent?.trim();
  if (!jobTitle) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
    if (ogTitle) {
      const parts = ogTitle.split(/\s*[-–—|]\s*/);
      jobTitle = parts[0]?.trim();
    }
  }

  // First sentence extraction for company name
  if (!company) {
    const descEl = document.querySelector('[data-ui="job-description"], .job-description, article');
    if (descEl) {
      const text = descEl.textContent?.slice(0, 500) || '';
      const nameMatch = text.match(/^([A-Z][A-Za-z\s&.]+?)\s+(?:is\s+(?:seeking|looking|hiring|a\s)|seeks\s)/);
      if (nameMatch && nameMatch[1].length > 2 && nameMatch[1].length < 50) company = nameMatch[1].trim();
    }
  }

  if (!company) company = extractDomain();
  return { company, jobTitle: jobTitle || null, source: 'workable', domain: null };
}

function detectGeneric() {
  const domain = window.location.hostname.replace('www.', '');

  // Known ATS domains — never use these as the company name
  const ATS_DOMAINS = ['ashbyhq.com', 'greenhouse.io', 'lever.co', 'workday.com', 'myworkdayjobs.com', 'rippling.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com', 'breezy.hr', 'recruitee.com', 'bamboohr.com', 'jazz.co', 'applytojob.com', 'workable.com'];
  const isATS = ATS_DOMAINS.some(d => domain.includes(d));

  // 1. og:site_name is the most authoritative signal (skip if it's the ATS name)
  const siteName = document.querySelector('meta[property="og:site_name"]');
  const siteNameVal = siteName?.getAttribute('content')?.trim();
  if (siteNameVal && (!isATS || !ATS_DOMAINS.some(d => siteNameVal.toLowerCase().includes(d.split('.')[0])))) {
    return { company: siteNameVal, source: 'generic', domain };
  }

  // 2. Split page title on separators — brand name is almost always the LAST segment
  //    e.g. "The fastest way to ship ChatGPT apps | Fractal" → "Fractal"
  const rawTitle = document.title.replace(/^\(\d+\)\s*/, '').trim();
  const segments = rawTitle.split(/\s*[|·—–]\s*/).map(s => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (last.length > 1 && last.length < 50 && !/jobs|careers|hiring/i.test(last) && !/[.!?]/.test(last)) {
      return { company: last, source: 'generic', domain };
    }
  }
  // First segment if it's short enough to be a brand name (not a tagline)
  if (segments.length > 0) {
    const first = segments[0];
    // Skip if it looks like a sentence (contains period, !, ?) — those are taglines not names
    if (first.length > 1 && first.length < 35 && !/jobs|careers|hiring/i.test(first) && !/[.!?]/.test(first)) {
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
  const result = { workArrangement: null, salary: null, employmentType: null, location: null, perks: [] };
  const PERK_RE   = /stipend|allowance|reimbursement|subsidy|benefit/i;
  const SALARY_RE = /\$\d+[Kk]|\$\d{1,3},\d{3}|\$\d{4,}/; // $50K, $50,000, $50000+

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
    if (/\$[\d,K]+/.test(t) && t.length < 60) {
      if (PERK_RE.test(t)) result.perks.push(t);
      // Don't extract salary from insight chips — LinkedIn shows market estimates
      // (e.g. "$70K/yr - $80K/yr") that aren't from the posting. Salary is only
      // extracted from the job description body in the dedicated scan below.
      else if (/\$[\d,K]+/.test(t)) {
        console.log('[Salary] Skipped insight chip (may be LinkedIn estimate):', t);
      }
    }
  }

  // Dedicated salary scan — only scans the job description BODY (not insight chips)
  // Look for explicit salary ranges or annual salary mentions
  if (!result.salary) {
    const descEl = scope.querySelector('#job-details, .jobs-description__content, [class*="jobs-description"]');
    const scanScope = descEl || scope;
    for (const el of scanScope.querySelectorAll('p, div, span, li')) {
      if (el.children.length > 0) continue;
      const t = el.textContent?.trim();
      if (!t || !/\$[\d,]/.test(t) || t.length > 100) continue;
      if (PERK_RE.test(t)) { result.perks.push(t); continue; }
      if (/\$[\d,]+(?:K)?\s*[-–—]\s*\$[\d,]+/.test(t) ||
          /\$[\d,]+(?:K)?(?:\s*(?:per year|\/yr|annually|USD|a year))/i.test(t)) {
        result.salary = t;
        console.log('[Salary] Extracted from job description body:', t);
        break;
      }
    }
  }
  if (result.salary) console.log('[Salary] Final result:', result.salary);
  else console.log('[Salary] No salary found in posting');

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
  // No broad fallback — the specific LinkedIn selectors above are sufficient.
  // Scanning all spans for country names causes false matches (e.g., "Australia" from unrelated page elements).

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
    '[class*="job-details-module"]',
    '[data-automation-id="jobPostingDescription"]',
    '[data-automation-id="job-posting-description"]',
    '[class*="jobPostingDescription"]'
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

function extractJobDescriptionFull() {
  // Same as extractJobDescription but returns full text without truncation
  const candidates = [];
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
  const scope = panel || document;
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
  const jobDetailsEl = document.querySelector('#job-details');
  if (jobDetailsEl) {
    const text = jobDetailsEl.innerText?.trim();
    if (text && text.length > 150) candidates.push(text);
  }
  if (panel) {
    const clone = panel.cloneNode(true);
    clone.querySelectorAll('[class*="premium"], [class*="promoted"], [class*="upsell"], .artdeco-card, [class*="job-alert"], [class*="similar-jobs"]').forEach(n => n.remove());
    const text = clone.textContent?.replace(/\s+/g, ' ').trim();
    if (text && text.length > 150) candidates.push(text);
  }
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => a.length > b.length ? a : b);
  }
  return null;
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
    return best.slice(0, 8000);
  }

  // Non-LinkedIn platforms (Greenhouse, Lever, Workday, generic job boards)
  const genericSelectors = [
    '[data-automation-id="jobPostingDescription"]',
    '[data-automation-id="job-posting-description"]',
    '[class*="jobPostingDescription"]',
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
    if (text && text.length > 150) return text.slice(0, 8000);
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

// ── Floating Hover-Reveal Sidebar (Superhuman Go style) ─────────────────────

if (typeof _ciSidebarToggle === 'undefined') var _ciSidebarToggle = null;
function toggleFloatingSidebar() { if (_ciSidebarToggle) _ciSidebarToggle(); }

// ── "Send to Coop" Button — injected on LinkedIn job pages ───────────────────

let _scoopInjected = false;
let _scoopObserver = null;

function injectCoopButton() {
  if (_scoopInjected) return;
  if (!/linkedin\.com\/jobs\//.test(window.location.href)) return;

  // Find the button container (where Apply, Save, LoopCV buttons live)
  const containers = [
    '.jobs-apply-button--top-card',              // New layout
    '.jobs-s-apply',                              // Older layout
    '.job-details-jobs-unified-top-card__container .mt2', // Unified card
    '.jobs-unified-top-card__content--two-pane .mt2',
  ];
  let actionBar = null;
  for (const sel of containers) {
    actionBar = document.querySelector(sel);
    if (actionBar) break;
  }
  // Fallback: find the parent of the Apply button
  if (!actionBar) {
    const applyBtn = document.querySelector(
      'button[aria-label*="Apply"], button.jobs-apply-button, .jobs-apply-button--top-card button'
    );
    if (applyBtn) actionBar = applyBtn.parentElement;
  }
  if (!actionBar) return;

  // Don't inject twice
  if (document.getElementById('coop-scoop-btn')) { _scoopInjected = true; return; }

  const btn = document.createElement('button');
  btn.id = 'coop-scoop-btn';
  btn.type = 'button';

  // Coop mini avatar (18px) — simplified inline SVG
  const coopFace = typeof COOP !== 'undefined' ? COOP.avatar(18) : '';

  btn.innerHTML = `${coopFace}<span style="margin-left:4px">Send to Coop</span>`;
  btn.title = 'Save to CompanyIntel + score with Coop';

  // Style to match LinkedIn's pill buttons
  Object.assign(btn.style, {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: '0', padding: '0 16px', height: '36px',
    border: '1px solid #FF7A59', borderRadius: '24px',
    background: '#fff', color: '#FF7A59',
    fontSize: '14px', fontWeight: '600', fontFamily: 'inherit',
    cursor: 'pointer', transition: 'all 0.15s',
    marginLeft: '8px', verticalAlign: 'middle', lineHeight: '1',
    whiteSpace: 'nowrap', flexShrink: '0',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#FF7A59'; btn.style.color = '#fff';
  });
  btn.addEventListener('mouseleave', () => {
    if (!btn.classList.contains('scooped')) {
      btn.style.background = '#fff'; btn.style.color = '#FF7A59';
    }
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = `${coopFace}<span style="margin-left:4px">Sending...</span>`;

    try {
      // Detect company + job from page
      const detected = await detectCompanyAndJob();
      const company = detected?.company || 'Unknown';
      const jobTitle = detected?.jobTitle || null;

      // Extract job description
      const descData = await extractJobDescriptionForPanel();
      const jobDescription = descData?.description || null;

      // Extract LinkedIn firmographics if available
      const firmo = detected?.linkedinFirmo || null;
      const jobMeta = detected?.jobMeta || null;

      // Check if already saved
      const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
      const existing = savedCompanies || [];
      const dup = existing.find(c => {
        const nameMatch = c.company && company && c.company.toLowerCase().replace(/[^a-z0-9]/g,'') === company.toLowerCase().replace(/[^a-z0-9]/g,'');
        const titleMatch = !jobTitle || !c.jobTitle || c.jobTitle.toLowerCase().includes(jobTitle.toLowerCase().slice(0, 20));
        return nameMatch && titleMatch && c.isOpportunity;
      });

      if (dup) {
        btn.innerHTML = `${coopFace}<span style="margin-left:4px">Sent to Coop ✓</span>`;
        btn.classList.add('scooped');
        btn.style.background = '#f0f0f0'; btn.style.color = '#999'; btn.style.borderColor = '#ddd';
        return;
      }

      // Build entry
      const companyLinkedin = /linkedin\.com\/company\//i.test(window.location.href) ? window.location.href : (detected?.companyLinkedinUrl || null);
      const snap = jobMeta || null;
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        type: 'company',
        company,
        savedAt: Date.now(),
        notes: '',
        rating: null,
        tags: ['Job Posted', 'Sent to Coop'],
        url: null,
        employees: firmo?.employees || null,
        industry: firmo?.industry || null,
        companyWebsite: null,
        companyLinkedin,
        linkedinFirmo: firmo || null,
        status: 'co_watchlist',
        isOpportunity: true,
        jobStage: 'needs_review',
        jobTitle,
        jobUrl: window.location.href,
        jobDescription,
        jobSnapshot: snap,
        baseSalaryRange: snap?.baseSalaryRange || (snap?.salaryType === 'base' ? snap?.salary : null) || null,
        oteTotalComp: snap?.oteTotalComp || (snap?.salaryType === 'ote' ? snap?.salary : null) || null,
        equity: snap?.equity || null,
        easyApply: detected?.easyApply || false,
      };

      // Save
      await new Promise(r => chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, r));

      // Queue for scoring
      chrome.runtime.sendMessage({ type: 'QUEUE_QUICK_FIT', entryId: entry.id });

      // Success state
      btn.innerHTML = `${coopFace}<span style="margin-left:4px">Sent to Coop ✓</span>`;
      btn.classList.add('scooped');
      btn.style.background = '#FF7A59'; btn.style.color = '#fff'; btn.style.borderColor = '#FF7A59';

      // Subtle bounce
      btn.style.transform = 'scale(1.05)';
      setTimeout(() => { btn.style.transform = 'scale(1)'; }, 200);

    } catch (err) {
      console.error('[Coop] Save error:', err);
      btn.innerHTML = `${coopFace}<span style="margin-left:4px">Error</span>`;
      btn.disabled = false;
    }
  });

  actionBar.appendChild(btn);
  _scoopInjected = true;

  // Check if already saved on inject
  checkCoopStatus(btn, coopFace);
}

async function checkCoopStatus(btn, coopFace) {
  try {
    const detected = await detectCompanyAndJob();
    const company = detected?.company;
    const jobTitle = detected?.jobTitle;
    if (!company) return;
    const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
    const dup = (savedCompanies || []).find(c => {
      if (!c.company) return false;
      const nameMatch = c.company.toLowerCase().replace(/[^a-z0-9]/g,'') === company.toLowerCase().replace(/[^a-z0-9]/g,'');
      return nameMatch && c.isOpportunity;
    });
    if (dup) {
      btn.innerHTML = `${coopFace}<span style="margin-left:4px">Sent to Coop ✓</span>`;
      btn.classList.add('scooped');
      btn.style.background = '#f0f0f0'; btn.style.color = '#999'; btn.style.borderColor = '#ddd';
      btn.disabled = true;
    }
  } catch {}
}

// Watch for LinkedIn SPA navigation and job panel changes
function watchForCoopInjection() {
  // Initial attempt
  setTimeout(injectCoopButton, 1500);

  // Re-inject on SPA navigation (LinkedIn is a SPA)
  let lastUrl = window.location.href;
  _scoopObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      _scoopInjected = false;
      const old = document.getElementById('coop-scoop-btn');
      if (old) old.remove();
      if (/linkedin\.com\/jobs\//.test(lastUrl)) {
        setTimeout(injectCoopButton, 1500);
      }
    }
    // Also re-try if button container appeared but our button isn't there yet
    if (!_scoopInjected && /linkedin\.com\/jobs\//.test(window.location.href)) {
      injectCoopButton();
    }
  });
  _scoopObserver.observe(document.body, { childList: true, subtree: true });
}

// Boot scoop injection on LinkedIn
if (/linkedin\.com/.test(window.location.hostname)) {
  watchForCoopInjection();
}

(function initFloatingSidebar() {
  // Don't inject on extension pages
  if (window.location.protocol === 'chrome-extension:') return;
  // Remove the old floating widget if present — this sidebar replaces it
  const oldWidget = document.getElementById('ci-widget-host');
  if (oldWidget) oldWidget.remove();

  let state = 1; // 1=idle, 2=strip, 3=icons, 4=open
  let retractTimer = null;
  let isLocked = false; // true when panel is clicked open

  const container = document.createElement('div');
  container.id = 'ci-sidebar-host';
  container.innerHTML = `
    <style>
      #ci-sidebar-host {
        position: fixed; top: 0; right: 0; height: 100vh; z-index: 2147483646;
        pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      /* Compact trigger button — vertically draggable, width driven by JS proximity */
      .ci-sb-trigger {
        position: absolute; right: 0;
        pointer-events: auto; cursor: pointer;
        transition: width 0.15s ease-out, opacity 0.2s ease-out, background 0.2s ease, box-shadow 0.2s ease;
        opacity: 0; width: 0; height: 48px; overflow: hidden;
        display: flex; align-items: center; gap: 8px; padding: 0 12px 0 6px;
        background: #fff; border-radius: 24px 0 0 24px;
        box-shadow: -2px 2px 12px rgba(0,0,0,0.1);
      }
      .ci-sb-trigger:hover {
        background: #fff;
        box-shadow: -4px 2px 20px rgba(0,0,0,0.15);
      }
      .ci-sb-trigger-icon {
        opacity: 0; transition: opacity 0.15s ease;
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; font-weight: 600; color: #2d3e50; white-space: nowrap; line-height: 1;
      }
      .ci-sb-trigger-icon svg { flex-shrink: 0; border-radius: 50%; }
      .ci-sb-trigger.ci-sb-dragging { transition: none !important; cursor: grabbing; }

      /* State 4: full panel */
      .ci-sb-panel {
        position: absolute; top: 0; right: 0; width: 0; height: 100%;
        transition: width 0.3s ease;
        overflow: hidden; pointer-events: auto;
        box-shadow: -8px 0 30px rgba(0,0,0,0.2);
      }
      #ci-sidebar-host.ci-sb-s4 .ci-sb-panel { width: var(--ci-panel-width, 380px); }
      #ci-sidebar-host.ci-sb-s4 .ci-sb-trigger { opacity: 0; width: 0; pointer-events: none; }

      .ci-sb-panel iframe {
        width: 100%; height: 100%; border: none; background: #1a2c3a;
      }

      .ci-sb-close {
        position: absolute; top: 8px; left: -24px; z-index: 30;
        background: none; color: #99acc2; border: none;
        width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
        font-size: 16px; line-height: 1; display: none; align-items: center; justify-content: center;
        transition: color 0.15s; padding: 0;
      }
      #ci-sidebar-host.ci-sb-s4 .ci-sb-close { display: flex; pointer-events: auto; }
      .ci-sb-close:hover { color: #2d3e50; }

      /* Resize handle on left edge of panel */
      .ci-sb-resize {
        position: absolute; top: 0; left: -4px; width: 12px; height: 100%;
        cursor: col-resize; z-index: 20; opacity: 0; pointer-events: none;
        transition: opacity 0.15s;
      }
      .ci-sb-resize::after {
        content: ''; position: absolute; top: 50%; left: 4px; transform: translateY(-50%);
        width: 4px; height: 48px; border-radius: 2px; background: #4a6580;
      }
      #ci-sidebar-host.ci-sb-s4 .ci-sb-resize { pointer-events: auto; }
      #ci-sidebar-host.ci-sb-s4 .ci-sb-resize:hover { opacity: 1; }
      .ci-sb-resize.ci-sb-resizing { opacity: 1; }

      /* Backdrop for click-outside-to-close */
      .ci-sb-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: -1; display: none;
      }
      #ci-sidebar-host.ci-sb-s4 .ci-sb-backdrop { display: block; }
    </style>

    <div class="ci-sb-backdrop" id="ci-sb-backdrop"></div>
    <div class="ci-sb-trigger" id="ci-sb-strip">
      <span class="ci-sb-trigger-icon">${typeof COOP !== 'undefined' ? COOP.avatar(32) : '<svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%"><circle cx="50" cy="50" r="50" fill="#E8E5E0"/><clipPath id="ct"><circle cx="50" cy="50" r="48"/></clipPath><g clip-path="url(#ct)"><ellipse cx="50" cy="96" rx="42" ry="23" fill="#3D5468"/><rect x="43" y="73" width="14" height="12" rx="3" fill="#E5BF9A"/><path d="M28 45Q28 30 38 24Q50 20 62 24Q72 30 72 45Q72 56 65 64Q59 70 50 72Q41 70 35 64Q28 56 28 45Z" fill="#F0CDA0"/><path d="M27 42Q27 20 50 14Q73 20 73 42L71 36Q69 20 50 17Q31 20 29 36Z" fill="#7A5C3A"/><ellipse cx="41" cy="44" rx="4.5" ry="4.5" fill="white"/><circle cx="41.5" cy="44.5" r="2.5" fill="#4A8DB8"/><ellipse cx="59" cy="44" rx="4.5" ry="4.5" fill="white"/><circle cx="59.5" cy="44.5" r="2.5" fill="#4A8DB8"/><path d="M40 58Q45 65 50 66Q55 65 60 58" fill="white" stroke="#8B6B4A" stroke-width="0.8"/></g></svg>'}<span style="margin-left:2px">Chat with Coop</span></span>
    </div>
    <div class="ci-sb-panel" id="ci-sb-panel">
      <div class="ci-sb-resize" id="ci-sb-resize"></div>
      <button class="ci-sb-close" id="ci-sb-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `;
  document.body.appendChild(container);

  const strip = container.querySelector('#ci-sb-strip');
  const panel = container.querySelector('#ci-sb-panel');
  const closeBtn = container.querySelector('#ci-sb-close');
  const backdrop = container.querySelector('#ci-sb-backdrop');
  let iframeLoaded = false;

  // Set initial vertical position from localStorage or center
  const savedY = localStorage.getItem('ci_sidebar_y');
  strip.style.top = savedY ? savedY + 'px' : '50%';
  if (!savedY) strip.style.transform = 'translateY(-50%)';

  function setState(s) {
    if (s === state) return;
    state = s;
    container.className = s >= 2 ? `ci-sb-s${s}` : '';
  }

  // Vertical drag to reposition
  let isDragging = false, dragStartY, dragStartTop;
  strip.addEventListener('mousedown', e => {
    isDragging = false;
    dragStartY = e.clientY;
    dragStartTop = strip.getBoundingClientRect().top;
    const onMove = ev => {
      const dy = Math.abs(ev.clientY - dragStartY);
      if (dy > 4) isDragging = true;
      if (isDragging) {
        strip.classList.add('ci-sb-dragging');
        const newTop = Math.max(20, Math.min(window.innerHeight - 70, dragStartTop + (ev.clientY - dragStartY)));
        strip.style.top = newTop + 'px';
        strip.style.transform = 'none';
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      strip.classList.remove('ci-sb-dragging');
      if (isDragging) {
        localStorage.setItem('ci_sidebar_y', parseInt(strip.style.top));
        isDragging = false;
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function pushPage(width) {
    document.documentElement.style.transition = 'margin-right 0.3s ease';
    document.documentElement.style.marginRight = width + 'px';
    document.documentElement.style.overflow = 'auto';
  }

  function unpushPage() {
    document.documentElement.style.marginRight = '';
    setTimeout(() => { document.documentElement.style.transition = ''; }, 300);
  }

  function openPanel() {
    isLocked = true;
    clearTimeout(retractTimer);
    // Hide trigger
    strip.style.width = '0px';
    strip.style.opacity = '0';
    // Apply saved width
    const savedWidth = Math.min(500, parseInt(localStorage.getItem('ci_sidebar_width')) || 400);
    container.style.setProperty('--ci-panel-width', savedWidth + 'px');
    pushPage(savedWidth);
    setState(4);
    // Lazy-load iframe on first open
    if (!iframeLoaded) {
      const iframe = document.createElement('iframe');
      iframe.src = chrome.runtime.getURL('sidepanel.html');
      iframe.allow = 'clipboard-read; clipboard-write';
      panel.appendChild(iframe);
      iframeLoaded = true;
    }
  }

  function closePanel() {
    isLocked = false;
    strip.style.width = '0px';
    strip.style.opacity = '0';
    const icon = strip.querySelector('.ci-sb-trigger-icon');
    if (icon) icon.style.opacity = '0';
    // Clear inline width/transition from resize drag so CSS class removal takes effect
    panel.style.width = '';
    panel.style.transition = '';
    document.documentElement.style.transition = '';
    document.documentElement.style.marginRight = '';
    unpushPage();
    setState(1);
  }

  // Register global toggle for extension icon click
  _ciSidebarToggle = () => {
    if (state === 4) closePanel();
    else openPanel();
  };

  // Mouse proximity detection
  const MAX_DIST = 480;  // start revealing at this distance from edge
  const MAX_WIDTH = 170;  // fully revealed trigger width (Coop avatar + label)
  const MIN_WIDTH = 0;

  document.addEventListener('mousemove', e => {
    if (isLocked) return;
    if (isDragging) return;
    const distFromRight = window.innerWidth - e.clientX;

    clearTimeout(retractTimer);

    if (distFromRight <= MAX_DIST) {
      // Two-phase reveal:
      // Phase 1 (far → 70% threshold): gradually reveal to 1/3 max width, then plateau
      // Phase 2 (past 70% threshold): pop out to full width
      const rawProgress = (MAX_DIST - distFromRight) / MAX_DIST; // 0 at MAX_DIST, 1 at edge
      const SNAP_THRESHOLD = 0.85; // at 85% of the way, snap to full
      const PLATEAU_WIDTH = MAX_WIDTH * 0.33; // 1/3 max width during phase 1

      let w, op;
      if (rawProgress < SNAP_THRESHOLD) {
        // Phase 1: ease into plateau
        const phase1 = rawProgress / SNAP_THRESHOLD; // 0→1 within phase 1
        w = phase1 * PLATEAU_WIDTH;
        op = Math.min(0.7, phase1 * 0.9);
      } else {
        // Phase 2: snap to full
        w = MAX_WIDTH;
        op = 1;
      }

      strip.style.width = w + 'px';
      strip.style.opacity = op;
      const shadowProgress = w / MAX_WIDTH;
      strip.style.boxShadow = `-${Math.round(shadowProgress * 3)}px 0 ${Math.round(shadowProgress * 12)}px rgba(0,0,0,${(shadowProgress * 0.18).toFixed(2)})`;
      const icon = strip.querySelector('.ci-sb-trigger-icon');
      if (icon) icon.style.opacity = rawProgress >= SNAP_THRESHOLD ? 1 : 0;
      if (state !== 3 && state !== 4) setState(3);
    } else if (state > 1 && state < 4) {
      retractTimer = setTimeout(() => {
        if (!isLocked && state < 4) {
          strip.style.width = '0px';
          strip.style.opacity = '0';
          const icon = strip.querySelector('.ci-sb-trigger-icon');
          if (icon) icon.style.opacity = '0';
          setState(1);
        }
      }, 400);
    }
  });

  // Click strip to open
  strip.addEventListener('click', () => { if (!isDragging) openPanel(); });

  // Close button
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    closePanel();
  });

  // Resize panel by dragging left edge
  const resizeHandle = container.querySelector('#ci-sb-resize');
  let panelWidth = parseInt(localStorage.getItem('ci_sidebar_width')) || 400;

  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    resizeHandle.classList.add('ci-sb-resizing');
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    // Block iframe from stealing mouse events during drag
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:15;cursor:col-resize;';
    panel.appendChild(overlay);

    const onMove = ev => {
      const newWidth = Math.max(300, Math.min(800, startWidth + (startX - ev.clientX)));
      panel.style.width = newWidth + 'px';
      panel.style.transition = 'none';
      document.documentElement.style.transition = 'none';
      document.documentElement.style.marginRight = newWidth + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      overlay.remove();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      resizeHandle.classList.remove('ci-sb-resizing');
      panel.style.transition = '';
      panelWidth = panel.offsetWidth;
      localStorage.setItem('ci_sidebar_width', panelWidth);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Click outside to close
  backdrop.addEventListener('click', closePanel);

  // Prevent hover flicker — keep strip visible when mouse is over it
  strip.addEventListener('mouseenter', () => {
    clearTimeout(retractTimer);
    if (!isLocked && state < 4) {
      // Fully reveal when hovering directly on the trigger
      strip.style.width = MAX_WIDTH + 'px';
      strip.style.opacity = '1';
      strip.style.boxShadow = '-3px 0 12px rgba(0,0,0,0.18)';
      const icon = strip.querySelector('.ci-sb-trigger-icon');
      if (icon) icon.style.opacity = '1';
    }
  });

  strip.addEventListener('mouseleave', () => {
    if (!isLocked && state < 4) {
      retractTimer = setTimeout(() => {
        strip.style.width = '0px';
        strip.style.opacity = '0';
        const icon = strip.querySelector('.ci-sb-trigger-icon');
        if (icon) icon.style.opacity = '0';
        setState(1);
      }, 400);
    }
  });
})();
