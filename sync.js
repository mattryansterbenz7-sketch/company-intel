// sync.js — Field sync, role briefs, next steps, email tasks, backfill, migration.

import { state, QUEUE_AUTO_PROCESS } from './bg-state.js';
import { chatWithFallback, aiCall, getModelForTask } from './api.js';
import { fetchSearchResults, extractDomainFromResults, fetchApolloData } from './search.js';
import { coopInterp, companiesMatch, titlesAreSimilar } from './utils.js';
import { processQueue } from './scoring.js';
import { researchCompany } from './research.js';

// ── Unified field sync — called after any data ingestion ─────────────────────

export async function syncEntryFields(entryId) {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entries = savedCompanies || [];
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  const e = entries[idx];
  const updates = {};

  console.log('[SyncFields] Running for', e.company, '| roleBrief type:', typeof e.roleBrief, '| roleBrief keys:', e.roleBrief ? Object.keys(e.roleBrief) : 'null', '| jobTitle:', e.jobTitle || '(empty)');

  // Treat sentinel strings as missing
  const isMissing = v => !v || /^\s*(not specified|unknown|n\/a|none|—|–|-)\s*$/i.test(String(v));

  // Sources to scan
  const brief = String(typeof e.roleBrief === 'object' ? (e.roleBrief?.content || e.roleBrief?.brief || '') : (e.roleBrief || ''));
  console.log('[SyncFields] Brief text length:', brief.length, '| first 200 chars:', brief.slice(0, 200));
  const intel = e.intelligence || {};
  const jd = e.jobDescription || '';
  const snapshot = e.jobSnapshot || {};
  // Include all intelligence fields as text so employee/funding mentions get picked up
  const intelText = Object.values(intel).filter(v => typeof v === 'string').join(' ');
  const allText = [brief, intelText, jd].filter(Boolean).join(' ');

  // Job title — from brief, job description, or snapshot
  if (!e.jobTitle || e.jobTitle === 'New Opportunity') {
    const m = brief.match(/\*{0,2}Title:\*{0,2}\s*(.+?)(?:\n|\(|;|$)/i)
      || brief.match(/Title[:\s]+([A-Z][^(\n;]{2,60})/i)
      || brief.match(/^#+ .*?—\s*(.+?)(?:\s+Role Brief|\n|$)/im);
    if (m) {
      const title = m[1].trim().replace(/\*+/g, '').replace(/Role Brief$/i, '').trim();
      if (title.length > 2 && title.length < 80) updates.jobTitle = title;
    }
  }

  // Employees
  if (isMissing(e.employees)) {
    const m = allText.match(/(\d[\d,]*\+?\s*[-–]\s*\d[\d,]*\+?)\s*employees/i)
      || allText.match(/([\d,]+\+)\s*employees/i)
      || allText.match(/(~?\d[\d,]+)\s*employees/i)
      || allText.match(/(\d[\d,]*\+?)\s*people\s*(globally|worldwide|across)/i);
    if (m) updates.employees = m[1].trim();
  }

  // Funding
  if (isMissing(e.funding)) {
    const m = allText.match(/(Series\s+[A-F][\w]*(?:\s*[-–,]\s*\$[\d.]+[BMK])?)/i)
      || allText.match(/raised\s+(\$[\d.]+[BMK]\w*)/i)
      || allText.match(/(\$[\d.]+[BMK]\w*)\s+(?:in\s+)?(?:funding|raised)/i);
    if (m) updates.funding = m[1].trim();
  }

  // Salary from brief or snapshot
  if (!e.baseSalaryRange) {
    const m = brief.match(/base[:\s]*\$?([\d,]+[Kk]?\s*[-–]\s*\$?[\d,]+[Kk]?)/i)
      || brief.match(/salary[:\s]*\$?([\d,]+[Kk]?\s*[-–]\s*\$?[\d,]+[Kk]?)/i);
    if (m) updates.baseSalaryRange = m[1].trim();
    else if (snapshot.salary && snapshot.salaryType === 'base') updates.baseSalaryRange = snapshot.salary;
  }
  if (!e.oteTotalComp) {
    const m = brief.match(/OTE[:\s]*\$?([\d,]+[Kk]?\s*[-–]\s*\$?[\d,]+[Kk]?)/i);
    if (m) updates.oteTotalComp = m[1].trim();
    else if (snapshot.salary && snapshot.salaryType === 'ote') updates.oteTotalComp = snapshot.salary;
  }

  // Work arrangement from snapshot
  if (!e.workArrangement && snapshot.workArrangement) updates.workArrangement = snapshot.workArrangement;

  // Company LinkedIn from any URL in known data
  if (!e.companyLinkedin) {
    const m = allText.match(/linkedin\.com\/company\/[a-z0-9_-]+/i);
    if (m) updates.companyLinkedin = 'https://www.' + m[0];
  }

  // Founded
  if (!e.founded) {
    const m = allText.match(/founded\s*(?:in\s*)?(\d{4})/i) || allText.match(/(\d{4})\s*[-–]\s*present/i);
    if (m) updates.founded = m[1];
  }

  // Equity from brief
  if (!e.equity) {
    const m = brief.match(/equity[:\s]*([\d.]+%?\s*[-–]\s*[\d.]+%?)/i) || brief.match(/([\d.]+%\s*[-–]\s*[\d.]+%)\s*equity/i);
    if (m) updates.equity = m[1].trim();
  }

  // Company website from any URL in data
  if (!e.companyWebsite) {
    const m = allText.match(/https?:\/\/(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/i);
    if (m && !m[1].includes('linkedin.com') && !m[1].includes('glassdoor') && !m[1].includes('google')) {
      updates.companyWebsite = 'https://' + m[1];
    }
  }

  // Industry from intelligence
  if (!e.industry && intel.category) updates.industry = intel.category;

  // Intelligence fields to top level
  if (intel.oneLiner && !e.oneLiner) updates.oneLiner = intel.oneLiner;
  if (intel.category && !e.category) updates.category = intel.category;

  if (Object.keys(updates).length) {
    console.log('[SyncFields] Auto-filling for', e.company, ':', Object.keys(updates).join(', '));
    Object.assign(entries[idx], updates);
    await new Promise(r => chrome.storage.local.set({ savedCompanies: entries }, r));
  }
}

// ── Role Brief Generation ────────────────────────────────────────────────────

export async function generateRoleBrief({ company, jobTitle, jobDescription, jobSnapshot, emails, meetings, meetingTranscript, notes, knownContacts }) {
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
- Target 500-1500 words depending on available information

IMPORTANT: You MUST start your response with a structured data block FIRST, before the brief:
<role_brief_fields>
{"jobTitle": "extracted title or null", "baseSalaryRange": "base salary range or null", "oteTotalComp": "OTE/total comp or null", "equity": "equity info or null"}
</role_brief_fields>
Only include fields where you have clear data — use null for anything not mentioned.

Then write the full role brief below.`;

  try {
    const result = await chatWithFallback({
      model: getModelForTask('roleBrief'),
      system: 'You are a role intelligence analyst. Write structured, factual briefs in markdown.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
      tag: 'RoleBrief'
    });
    if (result.error) return { error: result.error };
    let briefFields = null;
    console.log('[RoleBrief] Raw response start:', (result.reply || '').slice(0, 400));
    const fieldsMatch = result.reply.match(/<role_brief_fields>([\s\S]*?)<\/role_brief_fields>/);
    if (fieldsMatch) {
      try {
        briefFields = JSON.parse(fieldsMatch[1].trim());
        console.log('[RoleBrief] Parsed briefFields:', JSON.stringify(briefFields));
      } catch (e) {
        console.warn('[RoleBrief] briefFields JSON parse failed:', e.message);
      }
      result.reply = result.reply.replace(/<role_brief_fields>[\s\S]*?<\/role_brief_fields>/, '').trim();
    } else {
      console.warn('[RoleBrief] No <role_brief_fields> block found in response');
    }
    return { content: result.reply, briefFields };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Deep Fit Analysis — REMOVED ──────────────────────────────────────────────
// deepFitAnalysis() has been unified into scoreOpportunity() in scoring.js.
// Scoring now includes emails, meetings, transcripts, and notes in a single call,
// producing conversationInsights (replaces the deep fit narrative) alongside the
// deterministic score. See scoring.js scoreOpportunity() for the unified path.

// ── Next Step Extraction ─────────────────────────────────────────────────────

export async function extractNextSteps(notes, calendarEvents, transcripts, emailContext) {
  const today = new Date().toISOString().slice(0, 10);
  const futureEvents = (calendarEvents || []).filter(e => (e.start || '') > today);

  const contextParts = [];
  if (futureEvents.length) {
    contextParts.push(`Upcoming calendar events:\n${futureEvents.map(e => `- ${e.start}: ${e.title}`).join('\n')}`);
  }
  if (transcripts) contextParts.push(`Meeting transcripts:\n${transcripts.slice(0, 3000)}`);
  if (notes) contextParts.push(`Meeting notes:\n${notes.slice(0, 1500)}`);
  if (emailContext) contextParts.push(`Recent emails:\n${emailContext}`);

  if (!contextParts.length) return { nextStep: null, nextStepDate: null, nextStepSource: null, nextStepEvidence: null };

  try {
    const result = await aiCall('nextStepExtraction', {
      system: `Today is ${today}. You are extracting the next job-search action for a specific company opportunity. Extract the single most immediate next action and its date from the context. Return ONLY JSON:
{"nextStep":"brief action or null","nextStepDate":"YYYY-MM-DD or null","source":"calendar | transcript | notes | email | null","evidence":"short quote or phrase from the source that justifies this next step"}
IMPORTANT: Only extract actions directly related to this job opportunity (interviews, follow-ups, applications, recruiter calls, decision deadlines). Ignore personal events like birthdays, holidays, or anything unrelated to this job search. If no relevant next step exists, return null for all fields.
Dates like "Thursday" should be resolved to absolute dates relative to today. The "source" field MUST be the input bucket the answer came from.`,
      messages: [{ role: 'user', content: contextParts.join('\n\n') }],
      max_tokens: 220
    });
    const text = result.text || '{}';
    const match = text.match(/\{[\s\S]*?\}/);
    const json = match ? JSON.parse(match[0]) : {};
    return {
      nextStep: (json.nextStep && json.nextStep !== 'null') ? json.nextStep : null,
      nextStepDate: (json.nextStepDate && json.nextStepDate !== 'null') ? json.nextStepDate : null,
      nextStepSource: (json.source && json.source !== 'null') ? json.source : null,
      nextStepEvidence: (json.evidence && json.evidence !== 'null') ? json.evidence : null,
    };
  } catch (e) {
    return { nextStep: null, nextStepDate: null, nextStepSource: null, nextStepEvidence: null };
  }
}

// ── Email Task Extraction ───────────────────────────────────────────────────

export async function extractEmailTasks(entry, emails, existingTaskTexts) {
  if (!Array.isArray(emails) || !emails.length) return { tasks: [] };
  const today = new Date().toISOString().slice(0, 10);

  const emailBlocks = emails.slice(0, 20).map((e, i) => {
    const body = (e.body || e.snippet || '').slice(0, 2000);
    return `[email ${i + 1}] id=${e.id}
From: ${e.from || ''}
To: ${e.to || ''}
Date: ${e.date || ''}
Subject: ${e.subject || ''}
Body: ${body}`;
  }).join('\n\n');

  const existingBlock = (existingTaskTexts && existingTaskTexts.length)
    ? `\n\nOpen tasks already on this opportunity (do NOT recreate these):\n${existingTaskTexts.map(t => `- ${t}`).join('\n')}`
    : '';

  const system = `Today is ${today}. You read emails on a job-search opportunity and extract DISCRETE actionable TODOs for the user. Be conservative — return an empty array if nothing concrete is implied. Only extract tasks the user themselves needs to do (not the other party).

Return ONLY JSON in this exact shape:
{"tasks":[{"text":"short imperative action","dueDate":"YYYY-MM-DD or null","priority":"low|normal","sourceEmailId":"<id from the [email N] header>","rationale":"one phrase from the email that justifies this"}]}

Rules:
- "priority" must be "low" or "normal" — never "high".
- "dueDate" only if the email explicitly states or strongly implies one; otherwise null. Resolve relative dates like "Thursday" against today.
- "text" is one short imperative ("Send Sunita your availability"), not a sentence.
- Skip anything already covered by the open tasks list.
- Return {"tasks":[]} if no clear action is implied.`;

  const userMsg = `Opportunity: ${entry?.company || ''}${entry?.jobTitle ? ' — ' + entry.jobTitle : ''}
Stage: ${entry?.jobStage || entry?.status || 'unknown'}
Action status: ${entry?.actionStatus || 'unknown'}${existingBlock}

Emails to extract from:

${emailBlocks}`;

  try {
    const result = await aiCall('emailTaskExtraction', {
      system,
      messages: [{ role: 'user', content: userMsg }],
      max_tokens: 800
    });
    const text = result.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const json = match ? JSON.parse(match[0]) : {};
    const tasks = Array.isArray(json.tasks) ? json.tasks : [];
    const cleaned = tasks
      .filter(t => t && typeof t.text === 'string' && t.text.trim())
      .map(t => ({
        text: t.text.trim(),
        dueDate: (t.dueDate && t.dueDate !== 'null') ? t.dueDate : null,
        priority: t.priority === 'low' ? 'low' : 'normal',
        sourceEmailId: t.sourceEmailId || null,
        rationale: t.rationale || null
      }));
    return { tasks: cleaned };
  } catch (e) {
    console.log('[extractEmailTasks] error', e);
    return { tasks: [] };
  }
}

// ── Backfill missing website/linkedin for saved companies ──────────────────

export async function backfillMissingWebsites() {
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

export async function migrateJobsToCompanies() {
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

// ── Unified Save Opportunity Handler ─────────────────────────────────────────
export async function handleSaveOpportunity(message) {
  const { company, jobTitle, jobUrl, jobDescription, jobMeta, linkedinFirmo, linkedinJobData, source, triggerResearch } = message;
  if (!company) return { error: 'Missing company name' };

  const { savedCompanies, opportunityStages, customStages } = await new Promise(r =>
    chrome.storage.local.get(['savedCompanies', 'opportunityStages', 'customStages'], r));
  const existing = savedCompanies || [];

  // ── Duplicate check ──
  const dupIdx = existing.findIndex(c =>
    companiesMatch(c.company, company) &&
    c.isOpportunity &&
    titlesAreSimilar(c.jobTitle, jobTitle)
  );

  if (dupIdx !== -1) {
    const prev = { ...existing[dupIdx] };
    if (jobDescription && (!prev.jobDescription || jobDescription.length > prev.jobDescription.length)) {
      prev.jobDescription = jobDescription;
    }
    if (jobUrl && jobUrl !== prev.jobUrl) prev.jobUrl = jobUrl;
    if (linkedinFirmo) {
      if (!prev.linkedinFirmo) prev.linkedinFirmo = linkedinFirmo;
      if (!prev.employees && linkedinFirmo.employees) prev.employees = linkedinFirmo.employees;
      if (!prev.industry && linkedinFirmo.industry) prev.industry = linkedinFirmo.industry;
    }
    if (linkedinJobData) {
      // Overwrite firmographics from job page (more reliable than company-page selectors)
      if (linkedinJobData.employees && !prev.employees) prev.employees = linkedinJobData.employees;
      if (linkedinJobData.industry && !prev.industry) prev.industry = linkedinJobData.industry;
      if (linkedinJobData.hqLocation && !prev.hqLocation) prev.hqLocation = linkedinJobData.hqLocation;
      if (linkedinJobData.founded && !prev.founded) prev.founded = linkedinJobData.founded;
      if (linkedinJobData.companyWebsite && !prev.companyWebsite) prev.companyWebsite = linkedinJobData.companyWebsite;
      if (linkedinJobData.companyLinkedin && !prev.companyLinkedin) prev.companyLinkedin = linkedinJobData.companyLinkedin;
      // Job signals
      if (linkedinJobData.seniorityLevel && !prev.seniorityLevel) prev.seniorityLevel = linkedinJobData.seniorityLevel;
      if (linkedinJobData.jobFunction && !prev.jobFunction) prev.jobFunction = linkedinJobData.jobFunction;
      if (linkedinJobData.jobSkills?.length && !prev.jobSkills?.length) prev.jobSkills = linkedinJobData.jobSkills;
      if (linkedinJobData.applicantCount && !prev.applicantCount) prev.applicantCount = linkedinJobData.applicantCount;
      if (linkedinJobData.postedDate && !prev.postedDate) prev.postedDate = linkedinJobData.postedDate;
      if (linkedinJobData.isReposted) prev.isReposted = true;
      if (linkedinJobData.linkedinSalaryEstimate && !prev.linkedinSalaryEstimate) prev.linkedinSalaryEstimate = linkedinJobData.linkedinSalaryEstimate;
      if (linkedinJobData.externalApplyUrl && !prev.externalApplyUrl) prev.externalApplyUrl = linkedinJobData.externalApplyUrl;
      // Hiring team → leaders[] (dedup by linkedin URL)
      if (linkedinJobData.hiringTeam?.length) {
        const current = prev.leaders || [];
        const existingUrls = new Set(current.map(l => l.linkedin).filter(Boolean));
        const incoming = linkedinJobData.hiringTeam.filter(r => !existingUrls.has(r.linkedin));
        if (incoming.length) prev.leaders = [...current, ...incoming];
      }
      // LinkedIn connections
      if (linkedinJobData.linkedinConnectionsCount > 0) {
        prev.linkedinConnectionsCount = linkedinJobData.linkedinConnectionsCount;
        if (linkedinJobData.linkedinConnectionsUrl) prev.linkedinConnectionsUrl = linkedinJobData.linkedinConnectionsUrl;
      }
    }
    if (jobMeta) {
      prev.jobSnapshot = { ...(prev.jobSnapshot || {}), ...jobMeta };
      if (!prev.baseSalaryRange && (jobMeta.baseSalaryRange || (jobMeta.salaryType === 'base' && jobMeta.salary))) {
        prev.baseSalaryRange = jobMeta.baseSalaryRange || jobMeta.salary;
        prev.compSource = prev.compSource || 'Job posting';
        prev.compAutoExtracted = true;
      }
      if (!prev.oteTotalComp && (jobMeta.oteTotalComp || (jobMeta.salaryType === 'ote' && jobMeta.salary))) {
        prev.oteTotalComp = jobMeta.oteTotalComp || jobMeta.salary;
        prev.compSource = prev.compSource || 'Job posting';
        prev.compAutoExtracted = true;
      }
      if (!prev.equity && jobMeta.equity) prev.equity = jobMeta.equity;
    }

    existing[dupIdx] = prev;
    await new Promise(r => chrome.storage.local.set({ savedCompanies: existing }, r));

    state._scoringQueue.push(prev.id);
    if (QUEUE_AUTO_PROCESS) processQueue();

    const stages = opportunityStages || customStages || [];
    const stageLabel = (stages.find(s => s.key === prev.jobStage) || {}).label
      || (prev.jobStage || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { entry: prev, isDuplicate: true, stageLabel };
  }

  // ── Build canonical entry ──
  const snap = jobMeta || null;
  const tags = ['Job Posted'];
  if (jobMeta?.easyApply) tags.push('linkedin easy apply');
  if (source === 'linkedin_page' || source === 'other_ats') tags.push('Sent to Coop');

  const entry = {
    id:               Date.now().toString(36) + Math.random().toString(36).substr(2),
    type:             'company',
    company,
    savedAt:          Date.now(),
    notes:            '',
    rating:           null,
    tags,
    url:              null,
    oneLiner:         null,
    category:         null,
    employees:        linkedinJobData?.employees || linkedinFirmo?.employees || null,
    funding:          null,
    founded:          linkedinJobData?.founded || null,
    companyWebsite:   linkedinJobData?.companyWebsite || null,
    companyLinkedin:  linkedinJobData?.companyLinkedin || null,
    intelligence:     null,
    reviews:          null,
    leaders:          null,
    status:           'co_watchlist',
    isOpportunity:    !!jobTitle,
    jobStage:         jobTitle ? 'needs_review' : null,
    jobTitle:         jobTitle || null,
    jobUrl:           jobUrl || null,
    jobDescription:   jobDescription || null,
    jobSnapshot:      snap,
    jobMatch:         null,
    baseSalaryRange:  snap?.baseSalaryRange || (snap?.salaryType === 'base' ? snap?.salary : null) || null,
    oteTotalComp:     snap?.oteTotalComp || (snap?.salaryType === 'ote' ? snap?.salary : null) || null,
    equity:           snap?.equity || null,
    compSource:       snap?.salary || snap?.baseSalaryRange || snap?.oteTotalComp ? 'Job posting' : null,
    compAutoExtracted: !!(snap?.salary || snap?.baseSalaryRange || snap?.oteTotalComp),
    industry:         linkedinJobData?.industry || linkedinFirmo?.industry || null,
    hqLocation:       linkedinJobData?.hqLocation || null,
    linkedinFirmo:    linkedinFirmo || null,
    easyApply:        jobMeta?.easyApply || false,
    // J1: LinkedIn job posting signals
    seniorityLevel:         linkedinJobData?.seniorityLevel || null,
    jobFunction:            linkedinJobData?.jobFunction || null,
    jobSkills:              linkedinJobData?.jobSkills?.length ? linkedinJobData.jobSkills : [],
    applicantCount:         linkedinJobData?.applicantCount || null,
    postedDate:             linkedinJobData?.postedDate || null,
    isReposted:             linkedinJobData?.isReposted || false,
    linkedinSalaryEstimate: linkedinJobData?.linkedinSalaryEstimate || null,
    externalApplyUrl:       linkedinJobData?.externalApplyUrl || null,
    // Phase 2: hiring team (→ leaders[]) + connections
    leaders:                linkedinJobData?.hiringTeam?.length ? linkedinJobData.hiringTeam : null,
    linkedinConnectionsCount: linkedinJobData?.linkedinConnectionsCount || null,
    linkedinConnectionsUrl:   linkedinJobData?.linkedinConnectionsUrl || null,
  };

  await new Promise(r => chrome.storage.local.set({ savedCompanies: [entry, ...existing] }, r));

  if (entry.isOpportunity) {
    state._scoringQueue.push(entry.id);
    if (QUEUE_AUTO_PROCESS) processQueue();
  }

  if (triggerResearch && company) {
    researchCompany(company).catch(err => console.error('[SaveOpp] Research error:', err));
  }

  return { entry, isDuplicate: false };
}
