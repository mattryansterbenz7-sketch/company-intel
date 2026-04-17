// Re-injection guard: content.js can be injected twice (once via manifest match,
// once via chrome.scripting.executeScript from background/sidepanel). Without this
// guard, the `let` declarations below throw "Identifier already declared" SyntaxErrors.
//
// After an extension reload, the OLD content script persists with an invalid
// chrome.runtime. Chrome injects a NEW script, but it must supersede the old one.
// We use a per-instance ID on window so old observers detect they've been replaced.
var __ciInstanceId = Math.random().toString(36).slice(2);
var __ciPrevInstanceId = window.__companyIntelInstanceId;

// Skip if already loaded AND the existing instance's extension context is still valid
if (window.__companyIntelContentLoaded) {
  try {
    chrome.runtime.getURL('');
    // Extension context is valid — this is a true double-injection, skip.
  } catch {
    // Extension was reloaded — old script is stale. Fall through to take over.
    window.__companyIntelContentLoaded = false;
  }
}

// Set our instance ID. If we're skipping (valid double-injection), restore the previous ID.
window.__companyIntelInstanceId = window.__companyIntelContentLoaded ? __ciPrevInstanceId : __ciInstanceId;

if (window.__companyIntelContentLoaded) {
  // Already loaded with valid context — skip entire file body
} else {
  window.__companyIntelContentLoaded = true;

// Returns false if the extension context was invalidated OR a newer instance has taken over
function _extValid() {
  if (window.__companyIntelInstanceId !== __ciInstanceId) return false;
  try { chrome.runtime.getURL(''); return true; } catch { return false; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!_extValid()) return;
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
  if (message.type === '_SIDEPANEL_OPENED') {
    // Side panel is open — hide floating trigger, it's redundant
    const strip = document.getElementById('ci-sb-strip');
    if (strip) strip.style.display = 'none';
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === '_SIDEPANEL_CLOSED') {
    // Side panel closed — show floating trigger again
    const strip = document.getElementById('ci-sb-strip');
    if (strip) { strip.style.display = ''; strip.style.width = '0px'; strip.style.opacity = '0'; }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'EXTRACT_LINKEDIN_JOB') {
    if (!/linkedin\.com\/jobs\/view\//i.test(window.location.href)) {
      sendResponse({ error: 'Not a LinkedIn job page' });
      return true;
    }
    extractLinkedInJobPosting()
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ error: err.message }));
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
      // Build a canonical job URL so sidepanel.js doesn't save the ambient search
      // page URL (which has whatever currentJobId is highlighted, not necessarily
      // the job being saved).
      const jobId = new URLSearchParams(window.location.search).get('currentJobId');
      const canonicalJobUrl = jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null;
      return { ...titleResult, source: 'linkedin', domain: null, companyLinkedinUrl, linkedinFirmo, canonicalJobUrl };
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
    const cleanedText = text.replace(/\s*employees?/i, '').trim();

    // Parse employee count to detect inflated ranges
    // Standard LinkedIn employee ranges: "51-200", "1001-5000", etc.
    // Inflated/incorrect ranges: "500-8,000+", "10,000+" (from JSON-LD structured data)
    // Only update if we don't have employees yet, or if the new value is more reasonable
    if (!result.employees) {
      result.employees = cleanedText;
    } else {
      // If we already have an employee count, check if the new one is more reasonable
      // Prefer smaller, more specific ranges over large/inflated ones
      const existingNum = parseInt(result.employees.split('-')[0]) || 0;
      const newNum = parseInt(cleanedText.split('-')[0]) || 0;
      // Only replace if new value is smaller (more specific) or much closer to standard LinkedIn ranges
      if (newNum > 0 && newNum < existingNum && newNum < 10000) {
        result.employees = cleanedText;
      }
    }
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
  // LinkedIn's org-top-card contains data in structured divs/spans, typically separated by bullet points
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

    // For employees, get the direct text from items to prefer human-readable text
    for (const item of items) {
      const text = item.textContent?.trim();
      if (!text || text.length > 80) continue;

      // Prioritize employee data found here — this is the main firmographics section
      if (/\d+.*employees?/i.test(text)) {
        const cleanedText = text.replace(/\s*employees?/i, '').trim();
        // Only set employees once from this structured section (prefer the first/most specific one)
        if (!result.employees) {
          result.employees = cleanedText;
        }
        continue;
      }

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

  // Try specific insight selectors first — LinkedIn changes these frequently
  const candidateTexts = [];
  scope.querySelectorAll(
    '.job-details-jobs-unified-top-card__job-insight, ' +
    '.jobs-unified-top-card__job-insight, ' +
    'li[class*="job-insight"], ' +
    '[class*="workplace-type"], ' +
    '[class*="preference-pill"], ' +
    '[class*="job-detail-preference"], ' +
    '[class*="job-details-fit-level"], ' +
    '.tvm__text, ' +
    '[class*="top-card"] li, ' +
    '[class*="top-card"] span[class*="pill"], ' +
    '[class*="top-card"] span[class*="tag"], ' +
    '[class*="description__job-criteria-item"]'
  ).forEach(el => {
    const t = el.textContent?.trim();
    if (t && t.length > 0 && t.length < 120) candidateTexts.push(t);
  });

  // Also scan aria-labels and title attributes on buttons/spans in the top card
  scope.querySelectorAll('[aria-label], [title]').forEach(el => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    if (t && t.length > 1 && t.length < 80) candidateTexts.push(t);
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
      // Extract salary from insight chips — LinkedIn shows compensation ranges
      // that may be from the posting or LinkedIn estimates. Either way, it's useful signal.
      else if (!result.salary) {
        result.salary = t.trim();
        console.log('[Salary] Extracted from chip:', t);
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

// ── Floating Coop FAB — bottom-right trigger to open side panel ──────────────

(function _initCoopFab() {
  if (window.location.protocol === 'chrome-extension:') return;
  if (document.getElementById('coop-fab-host')) return;

  const host = document.createElement('div');
  host.id = 'coop-fab-host';
  host.style.cssText = 'position:fixed;z-index:2147483646;bottom:0;right:0;width:0;height:0;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    #fab {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #3B5068;
      box-shadow: 0 4px 18px rgba(59,80,104,0.55), 0 1px 4px rgba(0,0,0,0.22);
      cursor: pointer;
      pointer-events: all;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      padding: 0;
      overflow: hidden;
      opacity: 0;
      transform: scale(0.72) translateY(8px);
      transition: opacity 0.32s cubic-bezier(0.34,1.56,0.64,1),
                  transform 0.32s cubic-bezier(0.34,1.56,0.64,1),
                  box-shadow 0.18s ease;
    }
    #fab.ready {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    #fab:hover {
      box-shadow: 0 6px 26px rgba(59,80,104,0.7), 0 2px 6px rgba(0,0,0,0.26);
      transform: scale(1.07) translateY(0);
    }
    #fab:active {
      transform: scale(0.94) translateY(0);
      box-shadow: 0 2px 10px rgba(59,80,104,0.45);
    }
    #fab.hidden {
      opacity: 0 !important;
      transform: scale(0.72) translateY(8px) !important;
      pointer-events: none !important;
      transition: opacity 0.2s ease, transform 0.2s ease !important;
    }
  `;
  shadow.appendChild(style);

  const fab = document.createElement('button');
  fab.id = 'fab';
  fab.title = 'Open Coop';
  fab.setAttribute('aria-label', 'Open Coop side panel');

  // Inline Coop avatar SVG (simplified from coop.js for content script context)
  fab.innerHTML = `<svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;flex-shrink:0;">
    <circle cx="50" cy="50" r="50" fill="#3B5068"/>
    <clipPath id="cfab"><circle cx="50" cy="50" r="48"/></clipPath>
    <g clip-path="url(#cfab)">
      <ellipse cx="50" cy="100" rx="48" ry="28" fill="#3D4F5F"/>
      <ellipse cx="50" cy="100" rx="46" ry="26" fill="#435766"/>
      <path d="M26 100 L40 77 L50 88 L60 77 L74 100" fill="#364854"/>
      <path d="M40 77 L50 94 L60 77" fill="#F0EAE0"/>
      <path d="M40 77 L43 75 L44 78Z" fill="#F0EAE0"/>
      <path d="M60 77 L57 75 L56 78Z" fill="#F0EAE0"/>
      <path d="M41 78 Q44 73 50 76 Q44 79 41 78Z" fill="#3D4F5F"/>
      <path d="M59 78 Q56 73 50 76 Q56 79 59 78Z" fill="#3D4F5F"/>
      <ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/>
      <rect x="42" y="70" width="16" height="9" rx="2" fill="#E8C4A0"/>
      <path d="M28 43 Q28 27 39 21 Q50 16 61 21 Q72 27 72 43 Q72 53 68 58 L63 64 L56 68 L50 70 L44 68 L37 64 Q32 58 28 53 Q28 48 28 43Z" fill="#EDBB92"/>
      <path d="M27 40 Q27 15 50 10 Q73 15 73 40 L71 32 Q69 16 50 13 Q31 16 29 32Z" fill="#2D1F16"/>
      <ellipse cx="38" cy="43" rx="5" ry="5.5" fill="white"/>
      <ellipse cx="62" cy="43" rx="5" ry="5.5" fill="white"/>
      <ellipse cx="39" cy="44" rx="3" ry="3.5" fill="#2D1F16"/>
      <ellipse cx="63" cy="44" rx="3" ry="3.5" fill="#2D1F16"/>
      <ellipse cx="40" cy="43" rx="1.2" ry="1.2" fill="white"/>
      <ellipse cx="64" cy="43" rx="1.2" ry="1.2" fill="white"/>
      <path d="M43 57 Q50 62 57 57" fill="none" stroke="#B8865E" stroke-width="1.5" stroke-linecap="round"/>
    </g>
  </svg>`;

  shadow.appendChild(fab);

  // Pop-in animation — small delay so paint completes before transition fires
  requestAnimationFrame(() => requestAnimationFrame(() => fab.classList.add('ready')));

  fab.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    } catch (_) {}
  });

  // Hide when side panel opens; show when it closes
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === '_SIDEPANEL_OPENED') fab.classList.add('hidden');
    if (msg.type === '_SIDEPANEL_CLOSED') fab.classList.remove('hidden');
  });
})();

// ── "Send to Coop" Button — injected on any detected job page ──────────────

let _scoopInjected = false;
let _scoopObserver = null;
let _scoopIsFloating = false;

function _findActionBar() {
  const url = window.location.href;

  // ── LinkedIn ──
  if (/linkedin\.com\/jobs\//.test(url)) {
    const liContainers = [
      '.jobs-apply-button--top-card',
      '.jobs-s-apply',
      '.job-details-jobs-unified-top-card__container .mt2',
      '.jobs-unified-top-card__content--two-pane .mt2',
      '.jobs-details-top-card__action-container',
      '.job-details-jobs-unified-top-card__primary-description-container + div',
    ];
    for (const sel of liContainers) {
      const el = document.querySelector(sel);
      if (el) return { container: el, mode: 'inline' };
    }
    // Fallback: find the Apply/Save button and walk up to the flex row that holds all action buttons
    const applyEl = document.querySelector(
      'button[aria-label*="Apply"], a[aria-label*="Apply"], button.jobs-apply-button, .jobs-apply-button--top-card button, a.jobs-apply-button'
    );
    const anchorEl = applyEl || document.querySelector('button[aria-label*="Save"], button[aria-label*="Saved"]');
    if (anchorEl) {
      // Walk up to find the flex container with multiple children (the button row)
      let el = anchorEl.parentElement;
      for (let i = 0; i < 4 && el; i++) {
        const cs = window.getComputedStyle(el);
        if ((cs.display === 'flex' || cs.display === 'inline-flex') && el.children.length >= 2) {
          return { container: el, mode: 'inline' };
        }
        el = el.parentElement;
      }
      // Last resort: use direct parent
      if (anchorEl.parentElement) return { container: anchorEl.parentElement, mode: 'inline' };
    }
    return null;
  }

  // ── Greenhouse ──
  if (/greenhouse\.io/.test(url)) {
    const gh = document.querySelector('#app_body h1, .app-title, h1');
    if (gh?.parentElement) return { container: gh.parentElement, mode: 'inline' };
    return null;
  }

  // ── Lever ──
  if (/lever\.co/.test(url)) {
    const lv = document.querySelector('.posting-headline') || document.querySelector('.posting-apply');
    if (lv) return { container: lv, mode: 'inline' };
    return null;
  }

  // ── Workday ──
  if (/myworkdayjobs\.com|workday\.com/.test(url)) {
    const wd = document.querySelector('[data-automation-id="jobPostingTitle"]')
      || document.querySelector('[data-automation-id="heading"]');
    if (wd?.parentElement) return { container: wd.parentElement, mode: 'inline' };
    return null;
  }

  // ── Ashby ──
  if (/ashbyhq\.com/.test(url)) {
    const ash = document.querySelector('h1');
    if (ash?.parentElement) return { container: ash.parentElement, mode: 'inline' };
    return null;
  }

  // ── Rippling ──
  if (/ats\.rippling\.com/.test(url)) {
    const rip = document.querySelector('h1');
    if (rip?.parentElement) return { container: rip.parentElement, mode: 'inline' };
    return null;
  }

  // ── Workable ──
  if (/workable\.com/.test(url)) {
    const wk = document.querySelector('h1');
    if (wk?.parentElement) return { container: wk.parentElement, mode: 'inline' };
    return null;
  }

  // ── Work at a Startup (YC) ──
  if (/workatastartup\.com/.test(url)) {
    const yc = document.querySelector('h1');
    if (yc?.parentElement) return { container: yc.parentElement, mode: 'inline' };
    return null;
  }

  // ── Generic: floating pill (only used when job detected) ──
  return { container: document.body, mode: 'floating' };
}

// ─── J1: LinkedIn job posting data capture ────────────────────────────────────

function stripHtmlTags(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h\d|tr|td|th|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveRelativeDate(text) {
  if (!text) return null;
  const now = new Date();
  const t = text.toLowerCase().trim();
  const numMatch = t.match(/(\d+)\s*(hour|day|week|month)/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    const unit = numMatch[2];
    let ms = 0;
    if (unit === 'hour')  ms = n * 3600000;
    else if (unit === 'day')   ms = n * 86400000;
    else if (unit === 'week')  ms = n * 7 * 86400000;
    else if (unit === 'month') ms = n * 30 * 86400000;
    return new Date(now - ms).toISOString().slice(0, 10);
  }
  if (/today|just now/i.test(t)) return now.toISOString().slice(0, 10);
  if (/yesterday/i.test(t)) return new Date(now - 86400000).toISOString().slice(0, 10);
  return null;
}

function formatEmploymentType(ldType) {
  const map = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACTOR: 'Contract', INTERN: 'Internship', TEMPORARY: 'Temporary' };
  return map[String(ldType).toUpperCase()] || ldType;
}

function extractLinkedInJobJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const raw = JSON.parse(script.textContent || '');
      const entries = Array.isArray(raw) ? raw : [raw];
      const ld = entries.find(d => d?.['@type'] === 'JobPosting');
      if (!ld) continue;

      const result = {};
      if (ld.title) result.jobTitle = ld.title;
      if (ld.description) result.jobDescription = stripHtmlTags(ld.description);
      if (ld.datePosted) result.postedDate = String(ld.datePosted).slice(0, 10);
      if (ld.employmentType) result.employmentType = formatEmploymentType(ld.employmentType);
      if (ld.jobLocationType === 'TELECOMMUTE') result.workArrangement = 'Remote';
      if (ld.occupationalCategory) result.jobFunction = ld.occupationalCategory;
      if (Array.isArray(ld.skills) && ld.skills.length) result.jobSkillsLd = ld.skills.slice(0, 20);

      // Job location
      const loc = Array.isArray(ld.jobLocation) ? ld.jobLocation[0] : ld.jobLocation;
      if (loc?.address) {
        const addr = loc.address;
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
        if (parts.length) result.hqLocation = parts.join(', ');
      }

      // Hiring org
      const org = ld.hiringOrganization;
      if (org?.name) result.company = org.name;
      if (org?.sameAs) result.companyLinkedin = org.sameAs;

      // Salary
      const sal = ld.baseSalary;
      if (sal?.value?.minValue && sal?.value?.maxValue) {
        const v = sal.value;
        const unit = (v.unitText || '').toUpperCase();
        const unitLabel = unit === 'YEAR' ? '/yr' : unit === 'MONTH' ? '/mo' : unit === 'HOUR' ? '/hr' : '';
        result.disclosedSalary = `$${Number(v.minValue).toLocaleString()}–$${Number(v.maxValue).toLocaleString()}${unitLabel}`;
      }

      return result;
    } catch {}
  }
  return null;
}

function extractLinkedInJobPageFirmo() {
  const result = { employees: null, industry: null, hqLocation: null, founded: null, companyWebsite: null, companyLinkedin: null };

  // Find the "About the company" section on LinkedIn job pages
  let section = null;
  const sectionSelectors = [
    '.jobs-company__box',
    '[class*="jobs-company"]',
    'section[aria-label*="company" i]',
    'section[aria-label*="Company" i]',
  ];
  for (const sel of sectionSelectors) {
    const el = document.querySelector(sel);
    if (el) { section = el; break; }
  }
  // Fallback: find by heading text
  if (!section) {
    for (const h of document.querySelectorAll('h2, h3, h4, span')) {
      if (/about\s+(the\s+)?company/i.test(h.textContent?.trim())) {
        section = h.closest('[class*="artdeco-card"], [class*="jobs-company"], section') || h.parentElement?.parentElement;
        break;
      }
    }
  }

  if (section) {
    // Text fragments from list items and labeled spans
    section.querySelectorAll('li, dd, span[class*="t-14"], span[class*="t-16"], span[class*="text-body"]').forEach(el => {
      const text = el.textContent?.trim();
      if (!text || text.length > 100) return;

      // Delegate to existing classifier for employees/industry/location
      classifyFirmoText(text, result);

      // Founded year — "Founded 2018" or standalone "2018" in a "Founded" labeled context
      if (!result.founded) {
        const yearMatch = text.match(/(?:founded\s+)?(\d{4})/i);
        if (yearMatch && /founded/i.test(text)) result.founded = yearMatch[1];
        else if (/^\d{4}$/.test(text)) result.founded = text;
      }

      // HQ location — "City, ST" or "City, Country" pattern not caught by classifyFirmoText
      if (!result.hqLocation && /^[A-Z][a-zA-Z\s\-'\.]+,\s*[A-Z]/.test(text) && text.length < 50 && !/employees/i.test(text)) {
        result.hqLocation = text;
      }
    });

    // Also scan broader text nodes for founded
    if (!result.founded) {
      section.querySelectorAll('span, p, div').forEach(el => {
        if (result.founded) return;
        const text = el.textContent?.trim();
        const m = text?.match(/founded\s+in\s+(\d{4})|founded\s+(\d{4})/i);
        if (m) result.founded = m[1] || m[2];
      });
    }

    // Links — external website and company LinkedIn URL
    for (const a of section.querySelectorAll('a[href]')) {
      const href = a.href;
      if (href.includes('linkedin.com/company/') && !result.companyLinkedin) {
        result.companyLinkedin = href.split('?')[0];
      } else if (/^https?:\/\//.test(href) && !href.includes('linkedin.com') && !href.startsWith('chrome-extension') && !result.companyWebsite) {
        result.companyWebsite = href.split('?')[0];
      }
    }
  }

  // Broader fallback: company LinkedIn link from anywhere on page
  if (!result.companyLinkedin) {
    for (const a of document.querySelectorAll('a[href*="linkedin.com/company/"]')) {
      const href = a.href.split('?')[0];
      if (/\/company\/[^/]+\/?$/.test(href)) { result.companyLinkedin = href; break; }
    }
  }

  return (result.employees || result.industry || result.hqLocation || result.founded || result.companyWebsite || result.companyLinkedin)
    ? result : null;
}

function extractLinkedInJobSignals() {
  const result = {
    seniorityLevel: null, jobFunction: null, jobSkills: [],
    applicantCount: null, postedDate: null, isReposted: false,
    linkedinSalaryEstimate: null, externalApplyUrl: null,
  };

  // Scope to job details panel
  const panelSelectors = [
    '#job-details', '.jobs-search__job-details--wrapper', '.scaffold-layout__detail',
    '[class*="jobs-search__job-details"]', '.jobs-unified-top-card',
    '.job-details-jobs-unified-top-card__container',
  ];
  let panel = null;
  for (const sel of panelSelectors) {
    const el = document.querySelector(sel);
    if (el) { panel = el; break; }
  }
  const scope = panel || document;

  // Seniority + job function from structured criteria list (most reliable)
  scope.querySelectorAll('[class*="description__job-criteria-item"]').forEach(item => {
    const label = item.querySelector('[class*="subheader"], [class*="criteria-subheader"]')?.textContent?.trim()
      || item.querySelector('h3, span:first-child')?.textContent?.trim();
    const value = item.querySelector('[class*="criteria-text"], ul, li')?.textContent?.trim()
      || item.querySelectorAll('span')[1]?.textContent?.trim();
    if (!label || !value) return;
    if (/seniority/i.test(label) && !result.seniorityLevel) result.seniorityLevel = value;
    if (/job\s*function/i.test(label) && !result.jobFunction) result.jobFunction = value;
  });

  // Seniority fallback: insight chips
  if (!result.seniorityLevel) {
    scope.querySelectorAll('[class*="job-insight"], .tvm__text, [class*="fit-level"]').forEach(el => {
      if (result.seniorityLevel) return;
      const t = el.textContent?.trim();
      if (t && /\b(associate|entry[\s-]level|mid[\s-]senior|senior|director|executive|internship)\b/i.test(t) && t.length < 50) {
        result.seniorityLevel = t;
      }
    });
  }

  // Skills chips — "How you match" section or job details
  const skillsEl = document.querySelector('[class*="how-you-match"], [class*="match-qualifications"], [class*="job-details-skill"], [class*="skill-match"]');
  if (skillsEl) {
    skillsEl.querySelectorAll('[class*="skill"], [class*="pill"], span.t-14, span.t-16, li').forEach(chip => {
      const t = chip.textContent?.trim();
      if (t && t.length > 1 && t.length < 50 && result.jobSkills.length < 20 && !result.jobSkills.includes(t)) {
        result.jobSkills.push(t);
      }
    });
  }

  // Applicant count, posted date, repost — scan short text nodes
  scope.querySelectorAll('span, li').forEach(el => {
    if (el.querySelector('span, li')) return; // non-leaf
    const t = el.textContent?.trim();
    if (!t || t.length > 80) return;
    if (!result.applicantCount && /(?:over\s+)?\d+[\d,]*\s*applicants?/i.test(t)) result.applicantCount = t;
    if (!result.postedDate && /\d+\s*(?:hour|day|week|month)s?\s*ago|just\s*now|today|yesterday/i.test(t)) {
      result.postedDate = resolveRelativeDate(t);
    }
    if (!result.isReposted && /\breposted\b/i.test(t) && t.length < 30) result.isReposted = true;
  });

  // LinkedIn salary estimate — shows as "LinkedIn estimated" label
  scope.querySelectorAll('[class*="compensation"], [class*="salary"], [class*="job-insight"]').forEach(el => {
    if (result.linkedinSalaryEstimate) return;
    const t = el.textContent?.trim();
    if (t && /\$\d+[Kk]/.test(t) && /linkedin\s*estimated?|estimated?\s*by\s*linkedin/i.test(t) && t.length < 100) {
      result.linkedinSalaryEstimate = t;
    }
  });

  // External apply URL — "Apply on company website" links
  for (const a of document.querySelectorAll('a[href]')) {
    if (result.externalApplyUrl) break;
    const label = (a.textContent?.trim() || '') + ' ' + (a.getAttribute('aria-label') || '');
    if (/apply\s+on|apply\s+at\s+company|apply\s+now/i.test(label) && !a.href.includes('linkedin.com')) {
      result.externalApplyUrl = a.href;
    }
  }

  return result;
}

function extractLinkedInRecruiter() {
  // Find "Meet the hiring team" card — shown on most LinkedIn job postings
  let hiringSection = null;
  for (const el of document.querySelectorAll('h2, h3, h4, span, div')) {
    const t = el.textContent?.trim();
    if (/meet\s+the\s+hiring\s+team/i.test(t) && t.length < 50) {
      hiringSection = el.closest('[class*="hiring"], [class*="people-you-can-reach"], [class*="artdeco-card"], section')
        || el.parentElement?.parentElement;
      break;
    }
  }
  // Fallback: "People you can reach out to" container
  if (!hiringSection) {
    for (const el of document.querySelectorAll('h2, h3, h4')) {
      if (/people you can reach out to/i.test(el.textContent?.trim())) {
        hiringSection = el.closest('[class*="artdeco-card"], section') || el.parentElement?.parentElement;
        break;
      }
    }
  }
  if (!hiringSection) return null;

  const recruiters = [];
  hiringSection.querySelectorAll('a[href*="linkedin.com/in/"]').forEach(a => {
    const href = a.href.split('?')[0];
    if (!href.includes('/in/')) return;
    if (recruiters.some(r => r.linkedin === href)) return; // dedup

    // Extract name + title from text nodes inside the link
    const spans = [...a.querySelectorAll('span, div')].filter(el => !el.querySelector('span, div'));
    let name = null;
    let title = null;
    for (const span of spans) {
      const t = span.textContent?.trim();
      if (!t || t.length < 2 || t.length > 100) continue;
      if (/job\s*poster|^[123](?:st|nd|rd)\s*·|^connect$/i.test(t)) continue;
      if (!name) { name = t; continue; }
      if (!title && !/^\d+$/.test(t)) { title = t; break; }
    }
    // Fallback: full link text
    if (!name) name = a.textContent?.trim().split('\n')[0]?.trim();

    if (name && name.length > 1) {
      recruiters.push({
        name:     name.slice(0, 80),
        title:    title?.slice(0, 100) || null,
        linkedin: href,
        role:     'recruiter',
        source:   'job_posting',
        addedAt:  Date.now(),
      });
    }
  });

  return recruiters.length ? recruiters : null;
}

function extractLinkedInConnections() {
  // LinkedIn shows "X connections work here" when logged-in user has connections at the company
  for (const el of document.querySelectorAll('a, span, div')) {
    const t = el.textContent?.trim();
    if (!t || t.length > 80) continue;
    const m = t.match(/(\d+)\s+connection[s]?\s+(?:work\s+here|at\s+(?:this\s+)?company)/i);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    const link = el.closest('a') || el.querySelector('a');
    return {
      linkedinConnectionsCount: count,
      linkedinConnectionsUrl:   link?.href?.split('?')[0] || null,
    };
  }
  return null;
}

async function extractLinkedInJobPosting() {
  // Step 1: Expand JD and pull existing meta (salary chips, work arrangement)
  const descData = await extractJobDescriptionForPanel();

  // Step 2: JSON-LD — machine-readable, most stable
  const ld = extractLinkedInJobJsonLd();

  // Step 3: About box firmographics (job-page selectors, fixes broken extractLinkedInCompanyFirmo)
  const firmo = extractLinkedInJobPageFirmo();

  // Step 4: Job signals (seniority, skills, applicant count, posted date, etc.)
  const signals = extractLinkedInJobSignals();

  // Step 5: Hiring team (Phase 2)
  const hiringTeam = extractLinkedInRecruiter();

  // Step 6: LinkedIn connections at company (Phase 2)
  const connections = extractLinkedInConnections();

  // Compose — JSON-LD fills first, DOM fills gaps
  return {
    jobDescription:   descData?.jobDescription || ld?.jobDescription || null,
    jobMeta:          descData?.jobMeta || null,

    // Firmographics from About box
    employees:        firmo?.employees || null,
    industry:         firmo?.industry || null,
    hqLocation:       firmo?.hqLocation || ld?.hqLocation || null,
    founded:          firmo?.founded || null,
    companyWebsite:   firmo?.companyWebsite || null,
    companyLinkedin:  firmo?.companyLinkedin || ld?.companyLinkedin || null,

    // Job signals
    seniorityLevel:         signals.seniorityLevel || null,
    jobFunction:            signals.jobFunction || ld?.jobFunction || null,
    jobSkills:              signals.jobSkills.length ? signals.jobSkills : (ld?.jobSkillsLd || []),
    applicantCount:         signals.applicantCount || null,
    postedDate:             signals.postedDate || ld?.postedDate || null,
    isReposted:             signals.isReposted || false,
    linkedinSalaryEstimate: signals.linkedinSalaryEstimate || null,
    externalApplyUrl:       signals.externalApplyUrl || null,

    // From JSON-LD
    employmentType:  ld?.employmentType || null,
    disclosedSalary: ld?.disclosedSalary || null,

    // Phase 2: hiring team + connections
    hiringTeam:                hiringTeam || [],
    linkedinConnectionsCount:  connections?.linkedinConnectionsCount || null,
    linkedinConnectionsUrl:    connections?.linkedinConnectionsUrl || null,
  };
}

async function injectCoopButton() {
  if (_scoopInjected) return;
  if (!_extValid()) return;

  // Don't inject on extension pages
  if (window.location.protocol === 'chrome-extension:') return;

  const result = _findActionBar();
  if (!result) return;
  const { container: actionBar, mode } = result;

  // For floating mode (generic pages), only inject if we detect a job title
  if (mode === 'floating') {
    const detected = await detectCompanyAndJob();
    if (!detected?.jobTitle) return;
  }

  // Don't inject twice
  if (document.getElementById('coop-scoop-btn')) { _scoopInjected = true; return; }

  const btn = document.createElement('button');
  btn.id = 'coop-scoop-btn';
  btn.type = 'button';

  // Coop mini avatar (18px) — simplified inline SVG
  const coopFace = typeof COOP !== 'undefined' ? COOP.avatar(18) : '';

  btn.innerHTML = `${coopFace}<span style="margin-left:4px">Send to Coop</span>`;
  btn.title = 'Save to Coop.ai + score with Coop';

  // Style — inline pill or floating pill depending on mode
  _scoopIsFloating = mode === 'floating';
  const baseStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: '0', padding: '0 24px', height: '40px',
    border: '1px solid #FF7A59', borderRadius: '24px',
    background: '#fff', color: '#FF7A59',
    fontSize: '15px', fontWeight: '600', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    cursor: 'pointer', transition: 'all 0.15s',
    lineHeight: '1', whiteSpace: 'nowrap', flexShrink: '0',
  };
  if (mode === 'floating') {
    Object.assign(baseStyle, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
      boxShadow: '0 2px 12px rgba(0,0,0,0.15)', marginLeft: '0',
    });
  } else {
    baseStyle.marginLeft = '8px';
    baseStyle.verticalAlign = 'middle';
  }
  Object.assign(btn.style, baseStyle);

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

      let jobDescription = null;
      let jobMeta = null;
      let linkedinJobData = null;

      const isLinkedInJob = /linkedin\.com\/jobs\/view\//i.test(window.location.href);
      if (isLinkedInJob) {
        // Unified LinkedIn extractor: JSON-LD + About box + job signals
        linkedinJobData = await extractLinkedInJobPosting();
        jobDescription = linkedinJobData.jobDescription;
        jobMeta = linkedinJobData.jobMeta
          ? { ...linkedinJobData.jobMeta, easyApply: detected?.easyApply || false }
          : (detected?.easyApply ? { easyApply: true } : null);
      } else {
        const descData = await extractJobDescriptionForPanel();
        jobDescription = descData?.jobDescription || null;
        jobMeta = detected?.jobMeta
          ? { ...detected.jobMeta, easyApply: detected?.easyApply || false }
          : (detected?.easyApply ? { easyApply: true } : null);
      }

      // Unified save via background handler
      const resp = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'SAVE_OPPORTUNITY',
          company,
          jobTitle,
          jobUrl: detected?.canonicalJobUrl || window.location.href,
          jobDescription,
          jobMeta,
          linkedinFirmo: detected?.linkedinFirmo || null,
          linkedinJobData: isLinkedInJob ? linkedinJobData : null,
          source: detected?.source || 'other_ats',
        }, resolve);
      });

      if (resp?.error) throw new Error(resp.error);

      if (resp?.isDuplicate) {
        btn.innerHTML = `${coopFace}<span style="margin-left:4px">${resp.stageLabel} ✓</span>`;
        btn.classList.add('scooped');
        btn.style.background = '#f0f0f0'; btn.style.color = '#999'; btn.style.borderColor = '#ddd';
        btn.style.cursor = 'pointer';
        btn.disabled = false;
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_QUEUE' }, () => void chrome.runtime.lastError);
        });
        return;
      }

      // Success state — clickable to open queue
      btn.innerHTML = `${coopFace}<span style="margin-left:4px">Sent to Coop ✓</span>`;
      btn.classList.add('scooped');
      btn.style.background = '#FF7A59'; btn.style.color = '#fff'; btn.style.borderColor = '#FF7A59';
      btn.style.cursor = 'pointer';
      btn.disabled = false;
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_QUEUE' }, () => void chrome.runtime.lastError);
      });

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

function _coopStageLabel(stageKey, stages) {
  if (!stageKey) return 'Sent to Coop';
  const s = (stages || []).find(x => x.key === stageKey);
  if (s && s.label) return s.label;
  // Humanize fallback
  return stageKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function checkCoopStatus(btn, coopFace) {
  try {
    const detected = await detectCompanyAndJob();
    const company = detected?.company;
    if (!company) return;
    const { savedCompanies, opportunityStages, customStages } = await new Promise(r => chrome.storage.local.get(['savedCompanies', 'opportunityStages', 'customStages'], r));
    const stages = opportunityStages || customStages || [];
    const dup = (savedCompanies || []).find(c => {
      if (!c.company) return false;
      const nameMatch = c.company.toLowerCase().replace(/[^a-z0-9]/g,'') === company.toLowerCase().replace(/[^a-z0-9]/g,'');
      return nameMatch && c.isOpportunity;
    });
    if (dup) {
      const label = _coopStageLabel(dup.jobStage, stages);
      btn.innerHTML = `${coopFace}<span style="margin-left:4px">${label} ✓</span>`;
      btn.classList.add('scooped');
      btn.style.background = '#f0f0f0'; btn.style.color = '#999'; btn.style.borderColor = '#ddd';
      btn.disabled = true;
    }
  } catch {}
}

// Watch for SPA navigation and job panel changes — works on all supported sites
function watchForCoopInjection() {
  // Initial attempt (delay to let ATS pages render)
  setTimeout(injectCoopButton, 1500);

  // Re-inject on SPA navigation
  let lastUrl = window.location.href;
  let _scoopRetryTimer = null;
  let _scoopRetryCount = 0;
  const MAX_RETRIES = 10; // Stop retrying after 10 failed attempts (~5s)
  _scoopObserver = new MutationObserver(() => {
    if (!_extValid()) { _scoopObserver.disconnect(); return; }
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      _scoopInjected = false;
      _scoopIsFloating = false;
      _scoopRetryCount = 0; // Reset on navigation
      const old = document.getElementById('coop-scoop-btn');
      if (old) old.remove();
      clearTimeout(_scoopRetryTimer);
      setTimeout(injectCoopButton, 1500);
    }
    // Throttled re-try if button container appeared but our button isn't there yet
    if (!_scoopInjected && !_scoopRetryTimer && _scoopRetryCount < MAX_RETRIES) {
      _scoopRetryTimer = setTimeout(() => {
        _scoopRetryTimer = null;
        _scoopRetryCount++;
        injectCoopButton();
      }, 500);
    }
  });
  _scoopObserver.observe(document.body, { childList: true, subtree: true });
}

// Boot scoop injection on any supported job site
const _coopInjectHosts = /linkedin\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|ashbyhq\.com|ats\.rippling\.com|workable\.com|workatastartup\.com/;
if (_coopInjectHosts.test(window.location.hostname)) {
  watchForCoopInjection();
} else if (window.location.protocol !== 'chrome-extension:') {
  // Generic pages: single attempt after load — floating pill if a job is detected
  setTimeout(injectCoopButton, 2500);
}

// Clean up old floating widget if present
(function() {
  const oldWidget = document.getElementById('ci-widget-host');
  if (oldWidget) oldWidget.remove();
})();

} // end re-injection guard (window.__companyIntelContentLoaded)
