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
  if (message.type === 'OPEN_FLOATING_CHAT') {
    // Enrich context with page JD if sidepanel didn't have it
    const ctx = message.context || {};
    if (!ctx.jobDescription) {
      // Extract JD directly from the page
      const jd = extractJobDescriptionFromPage();
      if (jd) ctx.jobDescription = jd;
    }
    openFloatingChatWidget(ctx);
    sendResponse({ ok: true });
    return true;
  }

  return true;
});

// ── Floating Chat Widget (injected into page from sidepanel) ────────────────

// Quick synchronous JD extraction from the current page
function extractJobDescriptionFromPage() {
  // Greenhouse
  let el = document.querySelector('#content .posting-page, #content, .job__description, .job-post-content');
  // Lever
  if (!el) el = document.querySelector('.posting-page .content, .section-wrapper');
  // Workday
  if (!el) el = document.querySelector('[data-automation-id="jobPostingDescription"]');
  // Work at a Startup
  if (!el) el = document.querySelector('.prose, .job-description, [class*="description"]');
  // LinkedIn
  if (!el) el = document.querySelector('#job-details, .jobs-description__content');
  // Generic fallback: main content area
  if (!el) el = document.querySelector('main, article, [role="main"]');
  if (!el) return null;
  const text = el.innerText?.trim();
  return text && text.length > 100 ? text.slice(0, 8000) : null;
}

function openFloatingChatWidget(context) {
  // If already open, bring to front
  let widget = document.getElementById('ci-sp-float-chat');
  if (widget) {
    widget.style.display = 'flex';
    widget.querySelector('.ci-fc-input')?.focus();
    // Update context
    widget._ciContext = context;
    return;
  }

  let history = [];

  // Create widget
  widget = document.createElement('div');
  widget.id = 'ci-sp-float-chat';
  widget._ciContext = context;
  widget.innerHTML = `
    <style>
      #ci-sp-float-chat { position: fixed; bottom: 24px; right: 24px; width: 420px; height: 520px; background: #fff; border-radius: 14px; box-shadow: 0 12px 48px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08); display: flex; flex-direction: column; z-index: 2147483647; border: 1px solid #dfe3eb; overflow: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; resize: both; min-width: 300px; min-height: 250px; overflow: hidden; }
      .ci-fc-header { height: 48px; padding: 0 10px 0 14px; background: #2D3E50; display: flex; align-items: center; justify-content: space-between; cursor: grab; flex-shrink: 0; border-radius: 14px 14px 0 0; user-select: none; }
      .ci-fc-header:active { cursor: grabbing; }
      .ci-fc-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; color: #fff; font-size: 14px; font-weight: 700; }
      .ci-fc-header-left span:first-child { color: #FF7A59; }
      .ci-fc-company { color: #7da8c4; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ci-fc-btns { display: flex; gap: 1px; }
      .ci-fc-btn { background: none; border: none; color: #7da8c4; font-size: 15px; cursor: pointer; padding: 5px 7px; border-radius: 6px; line-height: 1; transition: all 0.1s; }
      .ci-fc-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
      .ci-fc-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
      .ci-fc-messages { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
      .ci-fc-empty { color: #94a3b8; font-size: 13px; padding: 32px 20px; text-align: center; line-height: 1.6; }
      .ci-fc-msg { display: flex; flex-direction: column; }
      .ci-fc-msg-user { align-items: flex-end; }
      .ci-fc-msg-assistant { align-items: flex-start; }
      .ci-fc-msg-user .ci-fc-bubble { background: #f0f4f8; color: #33475b; padding: 8px 12px; border-radius: 10px 10px 3px 10px; font-size: 13px; line-height: 1.5; max-width: 85%; }
      .ci-fc-msg-assistant .ci-fc-bubble { font-size: 13px; line-height: 1.6; color: #2d3e50; padding: 2px 0; max-width: 100%; }
      .ci-fc-msg-assistant .ci-fc-bubble strong { font-weight: 600; }
      .ci-fc-thinking { color: #94a3b8 !important; font-style: italic; }
      .ci-fc-input-row { padding: 10px 14px; border-top: 1px solid #f0f3f8; display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
      .ci-fc-input { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; color: #33475b; font-size: 14px; padding: 10px 12px; resize: none; font-family: inherit; min-height: 42px; line-height: 1.5; outline: none; }
      .ci-fc-input:focus { border-color: #FF7A59; }
      .ci-fc-input::placeholder { color: #94a3b8; }
      .ci-fc-send { background: #FF7A59; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0; font-family: inherit; }
      .ci-fc-send:hover { background: #e8623f; }
      .ci-fc-send:disabled { background: #ccc; cursor: default; }
      .ci-fc-actions { padding: 6px 14px 10px; border-top: 1px solid #f0f3f8; display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
      .ci-fc-action { font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 1px solid #dfe3eb; background: #f8fafc; color: #516f90; cursor: pointer; font-family: inherit; transition: all 0.1s; }
      .ci-fc-action:hover { border-color: #FF7A59; color: #FF7A59; }
      .ci-fc-action:active { transform: scale(0.95); }
    </style>
    <div class="ci-fc-header" id="ci-fc-header">
      <div class="ci-fc-header-left">
        <span>&#10038;</span> Ask AI <span class="ci-fc-company">— ${context.company || ''}</span>
      </div>
      <div class="ci-fc-btns">
        <button class="ci-fc-btn" id="ci-fc-min" title="Minimize">&minus;</button>
        <button class="ci-fc-btn" id="ci-fc-close" title="Close">&#10005;</button>
      </div>
    </div>
    <div class="ci-fc-body">
      <div class="ci-fc-messages" id="ci-fc-messages">
        <div class="ci-fc-empty">Ask about this role, company, or get help with your application.</div>
      </div>
      <div class="ci-fc-input-row">
        <textarea class="ci-fc-input" id="ci-fc-input" placeholder="Ask anything about this opportunity..." rows="2"></textarea>
        <button class="ci-fc-send" id="ci-fc-send">Send</button>
      </div>
      <div class="ci-fc-actions">
        <button class="ci-fc-action" data-prompt="Help me answer application questions for this role">Help me apply</button>
        <button class="ci-fc-action" data-prompt="What should I know before interviewing here?">Prep me</button>
        <button class="ci-fc-action" data-action="clear" style="margin-left:auto;color:#94a3b8">Clear</button>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  const msgsEl = widget.querySelector('#ci-fc-messages');
  const inputEl = widget.querySelector('#ci-fc-input');
  const sendBtn = widget.querySelector('#ci-fc-send');
  const headerEl = widget.querySelector('#ci-fc-header');

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

  function render(thinking) {
    if (history.length === 0) {
      msgsEl.innerHTML = '<div class="ci-fc-empty">Ask about this role, company, or get help with your application.</div>';
    } else {
      msgsEl.innerHTML = history.map(m =>
        `<div class="ci-fc-msg ci-fc-msg-${m.role}"><div class="ci-fc-bubble">${esc(m.content)}</div></div>`
      ).join('') + (thinking ? '<div class="ci-fc-msg ci-fc-msg-assistant"><div class="ci-fc-bubble ci-fc-thinking">Thinking...</div></div>' : '');
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    history.push({ role: 'user', content: text });
    render(true);
    sendBtn.disabled = true;

    const ctx = { ...widget._ciContext };
    // Check if application mode
    if (text.toLowerCase().includes('application') || text.toLowerCase().includes('apply')) {
      ctx._applicationMode = true;
    }
    const msgs = history.map(m => ({ role: m.role, content: m.content }));

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 60000);
        chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', messages: msgs, context: ctx }, r => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(r);
        });
      });
    } catch (e) {
      result = { error: e.message === 'timeout' ? 'Request timed out.' : e.message };
    }

    sendBtn.disabled = false;
    history.push({ role: 'assistant', content: result?.reply || result?.error || 'Something went wrong.' });
    render();
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  // Quick actions
  widget.querySelector('.ci-fc-actions').addEventListener('click', e => {
    const btn = e.target.closest('[data-prompt]');
    if (btn) { inputEl.value = btn.dataset.prompt; send(); return; }
    if (e.target.closest('[data-action="clear"]')) { history = []; render(); }
  });

  // Close / minimize
  widget.querySelector('#ci-fc-close').addEventListener('click', () => { widget.style.display = 'none'; });
  widget.querySelector('#ci-fc-min').addEventListener('click', () => {
    const body = widget.querySelector('.ci-fc-body');
    const isMin = body.style.display === 'none';
    body.style.display = isMin ? 'flex' : 'none';
    widget.style.height = isMin ? '520px' : '48px';
    widget.style.resize = isMin ? 'both' : 'none';
  });

  // Drag to reposition
  let dragging = false, sx, sy, sr, sb;
  headerEl.addEventListener('mousedown', e => {
    if (e.target.closest('.ci-fc-btn')) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    const r = widget.getBoundingClientRect();
    sr = window.innerWidth - r.right; sb = window.innerHeight - r.bottom;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    widget.style.right = (sr - (e.clientX - sx)) + 'px';
    widget.style.bottom = (sb - (e.clientY - sy)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });

  // Pre-populate with selected text
  const sel = window.getSelection()?.toString()?.trim();
  if (sel && sel.length > 3) {
    inputEl.value = sel;
    inputEl.placeholder = 'Ask about this text...';
  }

  inputEl.focus();
}

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
  const isJobPage = /\/jobs\//.test(window.location.pathname);
  const isCompanyPage = /\/company\/[^/]+/.test(window.location.pathname) && !isJobPage;

  if (isJobPage) {
    const titleResult = await waitForJobTitle();
    if (titleResult) {
      const companyLinkedinUrl = extractLinkedInCompanyUrlFromJobPage();
      return { ...titleResult, source: 'linkedin', domain: null, companyLinkedinUrl };
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
  if (!company) {
    // Page title: "Account Executive | DataRobot Careers" — take last segment, strip "Careers"
    const segs = document.title.replace(/^\(\d+\)\s*/, '').split(/\s*[|·—–]\s*/);
    if (segs.length > 1) company = segs[segs.length - 1].replace(/\s*(careers|jobs|hiring)\s*$/i, '').trim();
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
