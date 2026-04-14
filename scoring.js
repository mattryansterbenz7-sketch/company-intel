// scoring.js — Job match scoring, profile interpretation, structural matching.

import { state, DEFAULT_PIPELINE_CONFIG, SCORE_THRESHOLDS, QUEUE_AUTO_PROCESS } from './bg-state.js';
import { chatWithFallback, aiCall, getModelForTask } from './api.js';
import { simpleHash } from './utils.js';
import { coopInterp } from './utils.js';
import { scoutCompany } from './research.js';
import { fetchSearchResults } from './search.js';

// ── Profile Section Interpretation ───────────────────────────────────────────

export const SECTION_PROMPTS = {
  profileStory: `Read this person's career story and extract 5-8 specific, detailed bullet points. Include: company names, role types, specific metrics or results mentioned, key career transitions and WHY they happened, what environments they thrive in, what they're building or pursuing now, and any strong opinions or values stated. Be specific — use their actual words and details, not generic summaries.\n\nContent: {content}\n\nRespond in JSON only: {"bullets": ["bullet 1", "bullet 2", ...]}`,
  profileExperience: `Read this person's experience and extract the key proof points. For each role or project, summarize: what they did, their specific results, and what it demonstrates about them. Be concise.\n\nContent: {content}\n\nRespond in JSON only: {"entries": [{"role": "role name", "summary": "what they did and achieved"}]}`,
  profilePrinciples: `Read this person's operating principles and distill them into a concise profile of how they work. What kind of environment do they need? What kind of leadership? What's non-negotiable?\n\nContent: {content}\n\nRespond in JSON only: {"summary": "2-3 sentence distillation"}`,
  profileMotivators: `Read this person's motivators and extract: their core drivers, what energizes them, and what drains them. Be specific about the personality traits and motivational patterns.\n\nContent: {content}\n\nRespond in JSON only: {"drivers": ["driver 1", "driver 2"], "energizers": ["thing 1"], "drains": ["thing 1"]}`,
  profileVoice: `Read this description of how someone communicates and summarize their communication style in 1-2 sentences. Note tone, formality level, and any distinctive patterns.\n\nContent: {content}\n\nRespond in JSON only: {"style": "1-2 sentence summary"}`,
  profileFAQ: `Read these polished responses and list the questions they cover with a brief note on the approach/angle for each.\n\nContent: {content}\n\nRespond in JSON only: {"responses": [{"question": "what question this answers", "approach": "brief note on angle"}]}`,
  profileGreenLights: `Read this list of things that make job opportunities attractive to this person. Group them into categories and note any that might be ambiguous or could be interpreted multiple ways. Be specific about what each signal means for job matching.\n\nContent: {content}\n\nRespond in JSON only: {"signals": [{"signal": "the item", "interpretation": "what this means for job matching"}]}`,
  profileRedLights: `Read this list of dealbreakers. Group them into categories and note any that might be ambiguous. Be specific about what would trigger each red flag in a real job posting.\n\nContent: {content}\n\nRespond in JSON only: {"signals": [{"signal": "the item", "interpretation": "what would trigger this in a job posting"}]}`,
  profileSkills: `Read this person's skills and intangibles. Organize them into categories (technical skills, soft skills, domain expertise, certifications/tools) and note what level of depth or seniority each suggests.\n\nContent: {content}\n\nRespond in JSON only: {"categories": [{"name": "category name", "skills": ["skill 1", "skill 2"]}]}`,
};

export async function interpretProfileSection(section, content) {
  if (!content || !content.trim()) return { error: 'No content to interpret' };
  const promptTemplate = SECTION_PROMPTS[section];
  if (!promptTemplate) return { error: `Unknown section: ${section}` };

  const prompt = promptTemplate.replace('{content}', content.slice(0, 3000));
  try {
    const result = await chatWithFallback({
      model: getModelForTask('profileInterpret'),
      system: 'You are a concise profile analyst. Respond in valid JSON only, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      tag: 'ProfileInterpret',
      opTag: 'profile',
    });
    if (result.error) return { error: result.error };
    const clean = result.reply.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      // Try to fix common JSON issues: unescaped newlines, trailing commas
      try {
        const fixed = clean
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
          .replace(/,\s*([}\]])/g, '$1'); // trailing commas
        parsed = JSON.parse(fixed);
      } catch (e2) {
        // Last resort: wrap the entire response as a simple summary
        console.warn('[ProfileInterpret] JSON parse failed, using raw text');
        parsed = { summary: clean };
      }
    }
    // Store interpretation
    const storageKey = section + 'Interpretation';
    chrome.storage.local.set({ [storageKey]: { data: parsed, generatedAt: Date.now(), sourceHash: simpleHash(content) } });
    return { interpretation: parsed };
  } catch (err) {
    console.error('[ProfileInterpret] Error:', err.message);
    return { error: err.message };
  }
}

// ── Quick Fit Scoring ────────────────────────────────────────────────────────
// Deterministic 5-dimension scoring: AI evaluates evidence, code computes scores.
// Dimensions match preferences.js ICP_DIMENSIONS and queue.js DIM_DEFS:
//   qualificationFit, roleFit, cultureFit, companyFit, compFit
// Output shape matches what queue.js reads: entry.jobMatch.scoreBreakdown

// ── JD Fallback — fetch from URL or search when entry has no jobDescription ──

function stripHtmlToText(html) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

async function fetchJobDescriptionFallback(url, company, title) {
  // 1. Try direct fetch of the job URL (works for Greenhouse, Lever, Workday, Ashby, etc.)
  if (url) {
    try {
      const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const html = await resp.text();
        const text = stripHtmlToText(html);
        if (text.length > 300) {
          console.log('[QuickFit] JD fetched from URL:', url.slice(0, 60), `(${text.length} chars)`);
          return text.slice(0, 8000);
        }
      }
    } catch (e) {
      console.log('[QuickFit] Direct JD fetch failed (expected for LinkedIn):', e.message);
    }
  }

  // 2. Serper search for the job posting text
  if (company && title) {
    try {
      const query = `"${company}" "${title}" job description responsibilities qualifications`;
      const results = await fetchSearchResults(query, 5);
      if (results.length) {
        const snippets = results.map(r => `${r.title}\n${r.snippet || ''}`).join('\n\n');
        if (snippets.length > 150) {
          console.log('[QuickFit] JD from Serper search:', `(${snippets.length} chars)`);
          return snippets.slice(0, 8000);
        }
      }
    } catch (e) {
      console.log('[QuickFit] Serper JD search failed:', e.message);
    }
  }

  return null;
}

// ── Scoring Constants ────────────────────────────────────────────────────────

const SCORING_DIMS = ['roleFit', 'cultureFit', 'companyFit', 'compFit'];
const SEV_MUL = 0.5; // severity multiplier: sev 2 → ±1.0, sev 3 → ±1.5, sev 5 → ±2.5
const BASELINE = 5.0;
// Canonical bracket tier keys — shared between scoring.js and preferences.js
const COMP_BRACKET_TIERS = [
  { key: 'well_above',     label: 'Well above',     type: 'green', defaultSev: 5, thresholdFn: (f, s) => s * 1.15 },
  { key: 'meets_target',   label: 'Meets target',   type: 'green', defaultSev: 4, thresholdFn: (f, s) => s },
  { key: 'above_floor',    label: 'Above floor',    type: 'green', defaultSev: 2, thresholdFn: (f, s) => (f + s) / 2 },
  { key: 'meets_floor',    label: 'Meets floor',    type: 'green', defaultSev: 1, thresholdFn: (f, s) => f },
  { key: 'slightly_below', label: 'Slightly below', type: 'red',   defaultSev: 2, thresholdFn: (f, s) => f * 0.9 },
  { key: 'below_floor',    label: 'Below floor',    type: 'red',   defaultSev: 3, thresholdFn: (f, s) => f * 0.8 },
  { key: 'well_below',     label: 'Well below',     type: 'red',   defaultSev: 5, thresholdFn: () => 0 },
];

// compBracket — graduated comp scoring from ICP salary prefs
// customSevs: optional { well_above: n, ... } overrides from compBracketSeverities storage
// customThresholds: optional { well_above: n, ... } dollar-amount overrides from compBracketThresholds storage
function compBracket(amount, floor, strong, customSevs, customThresholds) {
  if (!amount || !floor) return null;
  // Strip formatting like "$100,000" or "100K" — store values may be raw user input
  const _parseSal = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return n > 0 ? (n < 1000 ? n * 1000 : n) : 0; };
  floor = _parseSal(floor);
  strong = _parseSal(strong) || floor * 1.3;
  if (!floor) return null;

  const sev = (tier) => {
    const override = customSevs?.[tier.key];
    return (typeof override === 'number' && override >= 1 && override <= 5) ? override : tier.defaultSev;
  };
  // Use custom threshold if stored, otherwise fall back to computed default
  const thresh = (key, computed) => { const ov = customThresholds?.[key]; return (ov && ov > 0) ? ov : computed; };

  if (amount >= thresh('well_above',    strong * 1.15))      { const t = COMP_BRACKET_TIERS[0]; return { type: t.type, sev: sev(t), label: 'Well above target' }; }
  if (amount >= thresh('meets_target',  strong))              { const t = COMP_BRACKET_TIERS[1]; return { type: t.type, sev: sev(t), label: 'Meets target' }; }
  if (amount >= thresh('above_floor',   (floor + strong) / 2)){ const t = COMP_BRACKET_TIERS[2]; return { type: t.type, sev: sev(t), label: 'Above floor' }; }
  if (amount >= thresh('meets_floor',   floor))               { const t = COMP_BRACKET_TIERS[3]; return { type: t.type, sev: sev(t), label: 'Meets floor' }; }
  if (amount >= thresh('slightly_below', floor * 0.9))        { const t = COMP_BRACKET_TIERS[4]; return { type: t.type, sev: sev(t), label: 'Slightly below floor' }; }
  if (amount >= thresh('below_floor',   floor * 0.8))         { const t = COMP_BRACKET_TIERS[5]; return { type: t.type, sev: sev(t), label: 'Below floor' }; }
  const t = COMP_BRACKET_TIERS[6]; return { type: t.type, sev: sev(t), label: 'Well below floor' };
}

// Map legacy category field to dimension — mirrors preferences.js CATEGORY_TO_DIMENSION
const CATEGORY_TO_DIMENSION = {
  role: 'roleFit', culture: 'cultureFit', company: 'companyFit', comp: 'compFit',
  team: 'cultureFit', industry: 'companyFit', product: 'companyFit', other: 'roleFit',
};

export async function scoreOpportunity(entryId) {
  // Load entry from storage
  const { savedCompanies } = await new Promise(resolve =>
    chrome.storage.local.get(['savedCompanies'], resolve)
  );
  const entries = savedCompanies || [];
  const entry = entries.find(e => e.id === entryId);
  if (!entry) throw new Error(`Entry ${entryId} not found`);

  // If no JD stored, try to fetch from URL or search for it
  if (!entry.jobDescription && (entry.jobUrl || entry.jobTitle)) {
    const fetchedJD = await fetchJobDescriptionFallback(
      entry.jobUrl, entry.company, entry.jobTitle
    );
    if (fetchedJD) {
      entry.jobDescription = fetchedJD;
      // Persist back so future rescores don't re-fetch
      const freshData = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
      const freshEntries = freshData.savedCompanies || [];
      const idx = freshEntries.findIndex(e => e.id === entryId);
      if (idx !== -1 && !freshEntries[idx].jobDescription) {
        freshEntries[idx].jobDescription = fetchedJD;
        await new Promise(r => chrome.storage.local.set({ savedCompanies: freshEntries }, r));
        console.log('[QuickFit] Backfilled JD for', entry.company, `(${fetchedJD.length} chars)`);
      }
    } else {
      console.warn('[QuickFit] No JD available for', entry.company, '— scoring with metadata only');
    }
  }

  // Company context: always run scout for reviews/culture signals the JD doesn't contain.
  // Cost is ~$0.002 (2 Serper queries), cached 7 days. Skip only if full research intel exists.
  let companyContext = null;
  if (entry.intelligence) {
    console.log('[QuickFit] Full research intel exists — skipping scout');
  } else {
    console.log('[QuickFit] Running scoutCompany for', entry.company, '(reviews + overview)');
    companyContext = await scoutCompany(entry.company || 'Unknown');
  }

  // Load compiled profile .md (single source of truth) + structured scoring data
  const localData = await new Promise(resolve =>
    chrome.storage.local.get([
      'profileAttractedTo', 'profileDealbreakers', 'scoringWeights',
      'coopProfileFull', 'coopPrefsFull', 'compBracketSeverities', 'compBracketThresholds'
    ], resolve)
  );
  const weights = localData.scoringWeights || {
    qualificationFit: 20, roleFit: 20, cultureFit: 25, companyFit: 20, compFit: 15
  };
  const attractedTo = localData.profileAttractedTo || [];
  const dealbreakers = localData.profileDealbreakers || [];

  // Load sync prefs for ICP salary fields (salaryFloor, salaryStrong, oteFloor, oteStrong)
  const syncData = await new Promise(resolve =>
    chrome.storage.sync.get(['prefs'], resolve)
  );

  // Compiled .md docs — same source of truth Coop uses in chat
  const compiledProfile = [localData.coopProfileFull, localData.coopPrefsFull].filter(Boolean).join('\n\n');

  // Build job context — page-scraped data first, Serper scout only if thin
  const firmoLines = [];
  const firmo = entry.linkedinFirmo || {};
  if (entry.employees || firmo.employees) firmoLines.push(`Employees: ${entry.employees || firmo.employees}`);
  if (entry.industry || firmo.industry) firmoLines.push(`Industry: ${entry.industry || firmo.industry}`);
  if (entry.hqLocation) firmoLines.push(`HQ: ${entry.hqLocation}`);
  if (entry.funding) firmoLines.push(`Funding: ${entry.funding}`);
  if (entry.founded) firmoLines.push(`Founded: ${entry.founded}`);
  const firmoBlock = firmoLines.length ? `Company Firmographics:\n${firmoLines.join('\n')}` : null;

  // J1: Skills block — structured skill tags from job posting
  const skillsBlock = entry.jobSkills?.length
    ? `Required Skills: ${entry.jobSkills.join(', ')}`
    : null;

  // J1: Posting context (seniority, job function, applicant count, dates)
  const postingSignals = [];
  if (entry.seniorityLevel) postingSignals.push(`Seniority: ${entry.seniorityLevel}`);
  if (entry.jobFunction) postingSignals.push(`Job Function: ${entry.jobFunction}`);
  if (entry.applicantCount) postingSignals.push(`Applicants: ${entry.applicantCount}`);
  if (entry.isReposted) postingSignals.push('Reposted: Yes');
  if (entry.postedDate) postingSignals.push(`Posted: ${entry.postedDate}`);
  const postingBlock = postingSignals.length ? `Posting Details:\n${postingSignals.join('\n')}` : null;

  // Fetch reviews if none exist (one-time, not re-triggered on rescore)
  if (!entry.reviews?.length && entry.company && !state._serperExhausted) {
    try {
      console.log('[QuickFit] No reviews found — fetching for', entry.company);
      const reviewHits = await fetchSearchResults(
        `"${entry.company}" reviews culture glassdoor repvue reddit`, 5
      );
      if (reviewHits.length) {
        const reviews = reviewHits.map(r => {
          const url = (r.link || '').toLowerCase();
          let source = 'Web';
          if (url.includes('glassdoor.com')) source = 'Glassdoor';
          else if (url.includes('repvue.com')) source = 'RepVue';
          else if (url.includes('reddit.com')) source = 'Reddit';
          else if (url.includes('blind')) source = 'Blind';
          else if (url.includes('indeed.com')) source = 'Indeed';
          const ratingMatch = (r.snippet || '').match(/(\d\.\d)\s*(?:★|star|out of|\/\s*5)/i);
          return { snippet: r.snippet || r.title || '', source, rating: ratingMatch ? ratingMatch[1] : null, url: r.link || null };
        }).filter(r => r.snippet);
        if (reviews.length) {
          entry.reviews = reviews;
          // Persist to storage so they don't get re-fetched
          const { savedCompanies } = await new Promise(resolve => chrome.storage.local.get(['savedCompanies'], resolve));
          const idx = (savedCompanies || []).findIndex(c => c.id === entry.id);
          if (idx !== -1) {
            savedCompanies[idx].reviews = reviews;
            await new Promise(resolve => chrome.storage.local.set({ savedCompanies }, resolve));
          }
          console.log('[QuickFit] Saved', reviews.length, 'reviews for', entry.company);
        }
      }
    } catch (e) {
      console.warn('[QuickFit] Review fetch failed (non-fatal):', e.message);
    }
  }

  // Employee reviews — from full research or auto-fetched above
  // Pull out numeric ratings explicitly so they're not buried in snippet text
  const _reviewRatings = (entry.reviews || [])
    .map(r => ({ source: r.source || 'Web', rating: parseFloat(r.rating) }))
    .filter(r => !isNaN(r.rating));
  const _ratingLine = _reviewRatings.length
    ? `Employee Ratings: ${_reviewRatings.map(r => `${r.rating}/5 (${r.source})`).join(', ')}`
    : null;
  const reviewsBlock = entry.reviews?.length
    ? [
        _ratingLine,
        `Employee Reviews (Glassdoor / RepVue / Reddit):\n${entry.reviews.slice(0, 6).map(r =>
          `- ${r.rating ? r.rating + '★ ' : ''}${r.snippet || r.title || ''}${r.source ? ` (${r.source})` : ''}`
        ).join('\n')}`
      ].filter(Boolean).join('\n')
    : null;

  const jobParts = [
    entry.company ? `Company: ${entry.company}` : null,
    entry.jobTitle ? `Title: ${entry.jobTitle}` : null,
    entry.jobDescription ? `Job Description:\n${entry.jobDescription.slice(0, 4000)}` : null,
    entry.jobSnapshot ? `Job Details:\n${Object.entries(entry.jobSnapshot).filter(([,v]) => v != null && v !== '').map(([k,v]) => `- ${k}: ${v}`).join('\n')}` : null,
    firmoBlock,
    skillsBlock,
    postingBlock,
    companyContext ? `Company Intel (web search):\n${companyContext}` : null,
    entry.intelligence ? `Company Intelligence:\n${typeof entry.intelligence === 'string' ? entry.intelligence : (entry.intelligence.eli5 || entry.intelligence.oneLiner || entry.intelligence.summary || Object.entries(entry.intelligence).filter(([k,v]) => v && typeof v === 'string').map(([k,v]) => `- ${k}: ${v}`).join('\n'))}` : null,
    reviewsBlock,
  ].filter(Boolean).join('\n\n');

  // ── Interaction context: emails, meetings, transcripts, notes ──────────────
  const interactionParts = [];
  const hasEmails   = (entry.cachedEmails?.length || 0) > 0;
  const hasMeetings = !!(entry.cachedMeetingTranscript || entry.cachedMeetingNotes || entry.cachedMeetings?.length);
  const hasNotes    = !!entry.notes;
  const hasContacts = (entry.knownContacts?.length || 0) > 0;
  const hasInteractionContext = hasEmails || hasMeetings || hasNotes;

  if (hasEmails) {
    interactionParts.push(`## Emails (${entry.cachedEmails.length})\n${entry.cachedEmails.slice(0, 15).map(e =>
      `### ${e.subject || '(no subject)'}\nFrom: ${(e.from || '').replace(/<[^>]+>/, '').trim()} | Date: ${e.date || 'unknown'}${e.snippet ? '\n' + e.snippet.slice(0, 200) : ''}`
    ).join('\n\n')}`);
  }
  if (entry.cachedMeetings?.length) {
    interactionParts.push(`## Meetings (${entry.cachedMeetings.length})\n${entry.cachedMeetings.map(m =>
      `### ${m.title || 'Meeting'}\nDate: ${m.date || 'unknown'}${(m.attendees || []).length ? ' | Attendees: ' + m.attendees.slice(0, 6).map(a => typeof a === 'string' ? a : (a.name || a.email || '')).join(', ') : ''}\n${(m.summaryMarkdown || m.transcript || m.summary || '').slice(0, 3000)}`
    ).join('\n\n')}`);
  }
  if (entry.cachedMeetingTranscript) {
    interactionParts.push(`## Meeting Notes\n${entry.cachedMeetingTranscript.slice(0, 4000)}`);
  }
  if (hasNotes) {
    interactionParts.push(`## User Notes\n${entry.notes.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)}`);
  }
  if (hasContacts) {
    interactionParts.push(`## Known Contacts\n${entry.knownContacts.map(c =>
      `- **${c.name || 'Unknown'}**${c.title ? ' — ' + c.title : ''}${c.email ? ' <' + c.email + '>' : ''}`
    ).join('\n')}`);
  }
  const interactionBlock = interactionParts.length
    ? `\n\n# Interaction Context\n${interactionParts.join('\n\n')}`
    : '';

  // Build flags reference for AI — each configured flag with ID, dimension, severity
  // Migrate flags that only have category (no dimension) — mirrors preferences.js migration
  const migrateFlag = f => f.dimension ? f : { ...f, dimension: CATEGORY_TO_DIMENSION[f.category] || 'roleFit' };
  const allFlags = [
    ...attractedTo.map(f => ({ ...migrateFlag(f), _type: 'green' })),
    ...dealbreakers.map(f => ({ ...migrateFlag(f), _type: 'red' }))
  ];
  const flagsRef = allFlags.length ? allFlags.map(f =>
    `- ID: ${f.id} | ${f._type === 'green' ? 'GREEN' : 'RED'} | Dim: ${f.dimension || 'roleFit'} | Sev: ${f.severity || 2} | "${f.text}"${f.keywords?.length ? ` [keywords: ${f.keywords.join(', ')}]` : ''}`
  ).join('\n') : '(No flags configured)';

  const prompt = `Evaluate this job opportunity against the candidate's configured scoring criteria.
${coopInterp.principlesBlock()}

=== CANDIDATE PROFILE ===
${compiledProfile || 'No profile configured'}

=== JOB OPPORTUNITY ===
${jobParts}${interactionBlock}

=== CONFIGURED FLAGS (evaluate each one) ===
${flagsRef}

YOUR TASK:
1. FIRED FLAGS: For each configured flag above, decide if it fires based on DIRECT EVIDENCE in the job posting, company data, or interaction context. A green flag fires when its positive signal is present. A red flag fires when its negative signal is triggered. CRITICAL: If you cannot find direct evidence that a flag is triggered, DO NOT include it in firedFlags. "No evidence" or "no direct evidence" means the flag did NOT fire — omit it entirely. Return ONLY flags with real, affirmative evidence.
2. QUALIFICATIONS: Extract EVERY requirement, skill, and qualification mentioned in the JOB DESCRIPTION ONLY — never from the candidate profile or preferences. Include items from "Requirements", "What We're Looking For", "Nice to Have", "Key Responsibilities" that imply skills, etc. For each, assess against the candidate: met, partial, unmet, or unknown. For "importance": use ONLY "required", "preferred", or "bonus" — never "nice to have", "optional", or any other value. For "sources": list where the candidate evidence comes from — use values like "resume", "experience", "skills", "not in profile", "inferred" — never put job description categories here.
3. COMP ASSESSMENT: Extract any disclosed base salary and OTE/total comp from job posting AND conversation context. Compare against the candidate's floor and strong numbers. Undisclosed = unknown (neutral).
4. QUALIFICATION SCORE: Score qualificationFit 1-10 (8+ = core skills align, 5-6 = adjacent/transferable, 3-4 = significant gaps).
5. DIMENSION RATIONALE: Write 1 sentence each for roleFit, cultureFit, companyFit, compFit. If interaction context exists, weight it heavily — live signals beat posting text. For cultureFit: you MUST reference any Glassdoor/employee ratings in the context (ratings ≥4.0 = culture positive; 3.0–3.9 = neutral/mixed; <3.0 = culture risk). If no ratings exist, note that.
6. COOP TAKE: 1-2 sentence honest bottom line on this opportunity.
7. QUICK TAKE: 2-4 bullets of the most decisive signals (green or red).
8. ROLE BRIEF: Summarize the role, why it could be interesting, key concerns, and comp in structured fields.
${hasInteractionContext ? '9. CONVERSATION INSIGHTS: 2-4 sentence analysis of what emails/meetings/notes reveal about fit, culture, momentum. Reference specific details. Weight interaction signals heavily — they beat posting text.\n' : ''}
EVIDENCE RULES:
- Flag evidence MUST come from the job posting, company data, or interaction context — NEVER from the candidate's profile/resume.
- Missing information is NOT evidence of a red flag. Undisclosed comp = neutral.
- If your assessment of a flag is "no evidence", "no direct evidence", "no mentions", or "not enough information" — that flag DID NOT FIRE. Do not include it in firedFlags.
- Evidence must CONFIRM the flag applies. If your evidence starts with "not", "no", or explicitly states the company/role does NOT have the flagged characteristic, you are arguing against the flag — that means it DID NOT fire. Omit it.
- Only flag hardDQ when a flag with severity 5 is clearly triggered by direct evidence.
- Unmet green flags are NOT red flags — they just mean the positive signal wasn't found.
${hasInteractionContext ? '- When conversations contradict the posting, note BOTH and flag the discrepancy.\n- At least one fired flag should reference interaction signals when available.\n' : ''}
Return ONLY valid JSON (no markdown fences):
{
  "firedFlags": [
    {"id": "<exact flag ID from configured list>", "evidence": "<verbatim quote from JD, company data, or conversation>"}
  ],
  "qualificationFit": <1-10>,
  "qualifications": [
    {"id": "q0", "requirement": "<extracted from JD only — never from candidate profile>", "status": "met|partial|unmet|unknown", "evidence": "<brief assessment vs candidate — why they meet or don't meet this>", "importance": "required|preferred|bonus — ONLY these three values", "sources": ["resume|experience|skills|not in profile|inferred — where the evidence comes from"]}
  ],
  "compAssessment": {
    "baseDisclosed": true|false,
    "baseAmount": <number|null — if a range is given (e.g. '$90k-$140k'), use the midpoint>,
    "oteDisclosed": true|false,
    "oteAmount": <number|null — if a range is given, use the midpoint>,
    "baseVsFloor": "above_strong|above_floor|at_floor|below_floor|unknown",
    "oteVsFloor": "above_strong|above_floor|at_floor|below_floor|unknown"
  },
  "dimensionRationale": {
    "roleFit": "<1 sentence>",
    "cultureFit": "<1 sentence>",
    "companyFit": "<1 sentence>",
    "compFit": "<1 sentence>"
  },
  "coopTake": "<1-2 sentences>",
  "keySignals": [{"type": "green|red", "text": "8-15 word signal"}],
  "roleBrief": {
    "roleSummary": "<1-2 sentence summary of the role — scope, function, team>",
    "whyInteresting": "<why this could be a good fit for this candidate>",
    "concerns": "<key concerns or risks with this opportunity>",
    "compSummary": "<compensation summary from posting and/or conversations, or 'Not disclosed'>",
    "qualificationMatch": "<X of Y requirements met>"
  },
  "jobSnapshot": {
    "salary": "<base salary range as written in the posting, e.g. '$125,000' or '$133,500 - $200,500' — null if not mentioned>",
    "salaryType": "<'base' if base pay, 'ote' if OTE/total comp only, null if no salary>",
    "baseSalaryRange": "<base salary range ONLY if explicitly stated as base, e.g. '$130,000 - $160,000' — null if not separated from OTE>",
    "oteTotalComp": "<OTE or total comp if stated, e.g. '$200,000 - $250,000 OTE' — null if not mentioned>",
    "equity": "<equity/stock info if mentioned — null if not>",
    "workArrangement": "<Remote/Hybrid/On-site or null>",
    "location": "<city/state if hybrid or on-site, null if remote>",
    "employmentType": "<Full-time/Part-time/Contract or null>"
  },
  "hardDQ": {"flagged": false, "reasons": []}${hasInteractionContext ? ',\n  "interactionSummary": "<2-4 sentence analysis of what emails/meetings reveal — cite specifics>"' : ''}
}`;

  const result = await chatWithFallback({
    model: getModelForTask('quickFitScoring'),
    system: `You are a JSON-only job fit analyst. Respond with valid JSON only, no markdown fences.`,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    tag: 'QuickFit',
    opTag: 'scoring',
  });

  if (result.error) throw new Error(result.error);

  let parsed;
  try {
    const cleanJson = result.reply.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleanJson);
  } catch (e) {
    throw new Error('Failed to parse scoring response: ' + e.message);
  }

  // ── Deterministic scoring — AI evaluates evidence, code computes scores ────

  // Post-process: strip flags where evidence says "no evidence" or contradicts the flag
  const NO_EVIDENCE_RX = /\bno (direct |clear )?(evidence|mentions?|indication|signs?)\b|\bnot enough information\b|\bno .{0,20} found\b/i;
  // Catch evidence that argues against the flag (e.g. "not generic AI services; they are defined solutions...")
  const CONTRADICTORY_RX = /^not\b|^no\b|^doesn't\b|^does not\b|^this is not\b|^they are not\b/i;
  const cleanedFlags = (parsed.firedFlags || []).filter(ff => {
    if (ff.evidence && NO_EVIDENCE_RX.test(ff.evidence)) {
      console.warn('[QuickFit] Stripping flag with "no evidence":', ff.id, ff.evidence?.slice(0, 80));
      return false;
    }
    if (ff.evidence && CONTRADICTORY_RX.test(ff.evidence.trim())) {
      console.warn('[QuickFit] Stripping flag with contradictory evidence:', ff.id, ff.evidence?.slice(0, 80));
      return false;
    }
    return true;
  });

  // Build flag lookup by ID
  const flagMap = {};
  allFlags.forEach(f => { flagMap[f.id] = f; });

  // Group fired flags by dimension, compute deltas from configured severity
  const dimFlags = {};
  SCORING_DIMS.forEach(d => { dimFlags[d] = { green: [], red: [] }; });
  const firedFlagIds = new Set();

  cleanedFlags.forEach(ff => {
    const flag = flagMap[ff.id];
    if (!flag) return; // AI returned unknown ID — skip silently
    firedFlagIds.add(ff.id);
    const dim = flag.dimension || 'roleFit';
    if (!dimFlags[dim]) dimFlags[dim] = { green: [], red: [] };
    const sev = flag.severity || 2;
    const delta = flag._type === 'green' ? sev * SEV_MUL : -(sev * SEV_MUL);
    dimFlags[dim][flag._type].push({
      id: flag.id, text: flag.text, sev, delta,
      evidence: ff.evidence || null, type: flag._type
    });
  });

  // ── Comp bracket dedup: only the highest-severity green and red fire ──
  // When multiple manual comp flags fire (e.g. 5 salary thresholds all met),
  // keep only the single highest-delta flag per color to prevent score stacking.
  if (dimFlags.compFit) {
    ['green', 'red'].forEach(type => {
      const arr = dimFlags.compFit[type];
      if (arr.length > 1) {
        const best = arr.reduce((a, b) => Math.abs(b.delta) > Math.abs(a.delta) ? b : a);
        dimFlags.compFit[type] = [best];
      }
    });
  }

  // Add structural comp adjustments from ICP salary prefs (graduated brackets)
  const compAssess = parsed.compAssessment || {};
  const prefs = syncData.prefs || {};

  const bracketSevs   = localData.compBracketSeverities  || {};
  const bracketThreshs = localData.compBracketThresholds  || {};

  // Auto-generate base salary bracket
  const baseBracket = compBracket(compAssess.baseAmount, prefs.salaryFloor, prefs.salaryStrong, bracketSevs.base, bracketThreshs.base);
  if (baseBracket) {
    const delta = baseBracket.sev * SEV_MUL * (baseBracket.type === 'red' ? -1 : 1);
    dimFlags.compFit[baseBracket.type].push({
      type: baseBracket.type, label: `Base: ${baseBracket.label}`, delta, sev: baseBracket.sev,
      evidence: `Detected base $${(compAssess.baseAmount/1000).toFixed(0)}k vs floor $${(parseFloat(prefs.salaryFloor)/1000).toFixed(0)}k`
    });
  }

  // Auto-generate OTE bracket
  const oteBracket = compBracket(compAssess.oteAmount, prefs.oteFloor, prefs.oteStrong, bracketSevs.ote, bracketThreshs.ote);
  if (oteBracket) {
    const delta = oteBracket.sev * SEV_MUL * (oteBracket.type === 'red' ? -1 : 1);
    dimFlags.compFit[oteBracket.type].push({
      type: oteBracket.type, label: `OTE: ${oteBracket.label}`, delta, sev: oteBracket.sev,
      evidence: `Detected OTE $${(compAssess.oteAmount/1000).toFixed(0)}k vs floor $${(parseFloat(prefs.oteFloor)/1000).toFixed(0)}k`
    });
  }

  // Fallback: when no salary floor is configured, use AI's vsFloor assessment to score comp
  // This ensures comp score reflects disclosed comp even without explicit prefs set
  const _vsFloorFallback = { above_strong: { type: 'green', sev: 3 }, above_floor: { type: 'green', sev: 2 }, below_floor: { type: 'red', sev: 3 } };
  const _vsFloorLabel = { above_strong: 'Above target', above_floor: 'Above floor', below_floor: 'Below floor' };
  if (!baseBracket && compAssess.baseVsFloor && compAssess.baseVsFloor !== 'unknown' && compAssess.baseVsFloor !== 'at_floor') {
    const fb = _vsFloorFallback[compAssess.baseVsFloor];
    if (fb) {
      const delta = fb.sev * SEV_MUL * (fb.type === 'red' ? -1 : 1);
      const label = _vsFloorLabel[compAssess.baseVsFloor];
      dimFlags.compFit[fb.type].push({
        type: fb.type, label: `Base: ${label}`, delta, sev: fb.sev,
        evidence: compAssess.baseAmount ? `$${(compAssess.baseAmount/1000).toFixed(0)}k base — ${label.toLowerCase()} vs candidate target` : `AI assessed base as ${label.toLowerCase()}`
      });
    }
  }
  if (!oteBracket && compAssess.oteVsFloor && compAssess.oteVsFloor !== 'unknown' && compAssess.oteVsFloor !== 'at_floor') {
    const fb = _vsFloorFallback[compAssess.oteVsFloor];
    if (fb) {
      const delta = fb.sev * SEV_MUL * (fb.type === 'red' ? -1 : 1);
      const label = _vsFloorLabel[compAssess.oteVsFloor];
      dimFlags.compFit[fb.type].push({
        type: fb.type, label: `OTE: ${label}`, delta, sev: fb.sev,
        evidence: compAssess.oteAmount ? `$${(compAssess.oteAmount/1000).toFixed(0)}k OTE — ${label.toLowerCase()} vs candidate target` : `AI assessed OTE as ${label.toLowerCase()}`
      });
    }
  }

  // Per-dimension scores: baseline 5.0 ± flag deltas, clamped [1, 10]
  function computeDimScore(dim) {
    let s = BASELINE;
    (dimFlags[dim]?.green || []).forEach(f => { s += Math.abs(f.delta); });
    (dimFlags[dim]?.red || []).forEach(f => { s -= Math.abs(f.delta); });
    return Math.round(Math.max(1, Math.min(10, s)));
  }

  // Compute qualScore deterministically from qualification counts
  // met = full credit, partial = half credit, unmet/unknown = no credit
  const _compRxQ = /\b(salary|salaries|comp(ensation)?|pay\b|ote\b|base\s*pay|incentive|bonus|equity|stock|commission)/i;
  const _skillQuals = (parsed.qualifications || []).filter(q => !_compRxQ.test(q.requirement));
  const _qMet = _skillQuals.filter(q => q.status === 'met').length;
  const _qPartial = _skillQuals.filter(q => q.status === 'partial').length;
  const _qTotal = _skillQuals.length;
  const qualScore = _qTotal > 0
    ? Math.max(1, Math.min(10, parseFloat(((_qMet + _qPartial * 0.5) / _qTotal * 10).toFixed(1))))
    : Math.max(1, Math.min(10, Math.round(parsed.qualificationFit || 5)));
  const scoreBreakdown = {
    qualificationFit: qualScore,
    roleFit: computeDimScore('roleFit'),
    cultureFit: computeDimScore('cultureFit'),
    companyFit: computeDimScore('companyFit'),
    compFit: computeDimScore('compFit')
  };

  // Weighted average → overall score
  const rawOverall = (
    scoreBreakdown.qualificationFit * weights.qualificationFit +
    scoreBreakdown.roleFit * weights.roleFit +
    scoreBreakdown.cultureFit * weights.cultureFit +
    scoreBreakdown.companyFit * weights.companyFit +
    scoreBreakdown.compFit * weights.compFit
  ) / 100;
  let overall = Math.round(Math.max(1, Math.min(10, rawOverall)));

  // Hard DQ validation — only honor if a severity-5 dealbreaker actually fired
  const hardDQ = parsed.hardDQ || { flagged: false, reasons: [] };
  if (hardDQ.flagged) {
    const hardDealbreakers = dealbreakers.filter(d => (d.severity || 2) >= 5);
    const isLegitimate = hardDQ.reasons?.some(reason => {
      const reasonLower = reason.toLowerCase();
      return hardDealbreakers.some(d =>
        reasonLower.includes(d.text.toLowerCase()) ||
        (d.keywords || []).some(k => reasonLower.includes(k.toLowerCase()))
      );
    });
    if (!isLegitimate) {
      console.warn('[QuickFit] Hard DQ suppressed — no matching severity-5 dealbreaker');
      hardDQ.flagged = false;
      hardDQ._suppressed = true;
    }
  }
  if (hardDQ.flagged && overall > 4) overall = 4;

  // Excitement modifier — nudge toward user's explicit rating
  if (entry.rating && overall) {
    const excitement = entry.rating;
    if (excitement >= 4 && overall < 8) {
      overall = Math.min(10, overall + (excitement - 3) * 0.3);
    } else if (excitement <= 2 && overall > 4) {
      overall = Math.max(1, overall - (3 - excitement) * 0.3);
    }
    overall = Math.round(overall * 10) / 10;
  }

  // Score rationale (shown in queue total formula row)
  const scoreRationale = `qual ${scoreBreakdown.qualificationFit}×${weights.qualificationFit}% + role ${scoreBreakdown.roleFit}×${weights.roleFit}% + culture ${scoreBreakdown.cultureFit}×${weights.cultureFit}% + company ${scoreBreakdown.companyFit}×${weights.companyFit}% + comp ${scoreBreakdown.compFit}×${weights.compFit}% = ${rawOverall.toFixed(2)} → ${Number(overall).toFixed(1)}/10`;

  // Neutral flags — configured but not fired, marked unknownNeutral
  const neutralFlags = {};
  const migratedAttractedTo = attractedTo.map(migrateFlag);
  const migratedDealbreakers = dealbreakers.map(migrateFlag);
  SCORING_DIMS.forEach(dim => {
    neutralFlags[dim] = {
      green: migratedAttractedTo.filter(f => (f.dimension || 'roleFit') === dim && !firedFlagIds.has(f.id) && f.unknownNeutral),
      red: migratedDealbreakers.filter(f => (f.dimension || 'roleFit') === dim && !firedFlagIds.has(f.id) && f.unknownNeutral)
    };
  });

  // Build unified jobMatch — the shape queue.js, company.js, sidepanel.js all read
  const existingJobMatch = entry.jobMatch || {};
  const roleBrief = parsed.roleBrief || {};
  // Normalize compSummary → compRange for queue.js compatibility
  if (roleBrief.compSummary && !roleBrief.compRange) roleBrief.compRange = roleBrief.compSummary;
  roleBrief.qualificationScore = qualScore; // code-computed, not AI-picked
  const jobMatch = {
    ...existingJobMatch,
    score: overall,
    scoreBreakdown,
    flagsFired: dimFlags,
    neutralFlags,
    qualifications: parsed.qualifications || [],
    compAssessment: compAssess,
    dimensionRationale: parsed.dimensionRationale || {},
    coopTake: parsed.coopTake || '',
    keySignals: parsed.keySignals || [],
    roleBrief,
    interactionSummary: parsed.interactionSummary || null,
    scoreRationale,
    hardDQ,
    scoringWeightsSnapshot: { ...weights },
    lastUpdatedAt: Date.now(),
    lastScoringUsage: {
      model: result.usedModel || 'unknown',
      input: result.usage?.input_tokens || 0,
      output: result.usage?.output_tokens || 0,
      cost: result.usage?.cost || 0
    }
  };
  // Clean up legacy deep fit fields — unified scoring replaces them
  delete jobMatch.deepFitAnalysis;
  delete jobMatch.strongFits;
  delete jobMatch.redFlags;

  // Extract jobSnapshot from AI response (structured posting metadata)
  const jobSnapshot = parsed.jobSnapshot || null;

  // Persist to storage
  const updateData = await new Promise(resolve =>
    chrome.storage.local.get(['savedCompanies'], resolve)
  );
  const updateEntries = updateData.savedCompanies || [];
  const updateIdx = updateEntries.findIndex(e => e.id === entryId);
  if (updateIdx !== -1) {
    updateEntries[updateIdx].jobMatch = jobMatch;
    if (jobSnapshot) {
      updateEntries[updateIdx].jobSnapshot = jobSnapshot;
      // Auto-extract comp fields to top-level entry (if not already set)
      const s = jobSnapshot;
      if (!updateEntries[updateIdx].baseSalaryRange && (s.baseSalaryRange || (s.salaryType === 'base' && s.salary))) {
        updateEntries[updateIdx].baseSalaryRange = s.baseSalaryRange || s.salary;
        updateEntries[updateIdx].compSource = updateEntries[updateIdx].compSource || 'Job posting';
        updateEntries[updateIdx].compAutoExtracted = true;
      }
      if (!updateEntries[updateIdx].oteTotalComp && (s.oteTotalComp || (s.salaryType === 'ote' && s.salary))) {
        updateEntries[updateIdx].oteTotalComp = s.oteTotalComp || s.salary;
      }
      if (!updateEntries[updateIdx].equity && s.equity) updateEntries[updateIdx].equity = s.equity;
    }
    // Backward-compat surface fields (Kanban cards, sidepanel score pills)
    updateEntries[updateIdx].fitScore = overall;
    updateEntries[updateIdx].fitReason = parsed.coopTake || '';
    updateEntries[updateIdx].keySignals = parsed.keySignals || [];
    updateEntries[updateIdx].scoredAt = Date.now();
    updateEntries[updateIdx].scoringModel = result.usedModel || 'unknown';
    if (hardDQ.flagged) updateEntries[updateIdx].hardDQ = hardDQ;
    await new Promise(resolve =>
      chrome.storage.local.set({ savedCompanies: updateEntries }, resolve)
    );
  }

  // Broadcast — field aliases for saved.js listener (expects companyId, score, scoredAt)
  chrome.runtime.sendMessage({
    type: 'SCORE_COMPLETE',
    entryId,
    companyId: entryId,
    score: overall,
    fitScore: overall,
    fitReason: parsed.coopTake || '',
    keySignals: parsed.keySignals || [],
    hardDQ,
    jobSnapshot,
    scoredAt: Date.now(),
  }).catch(() => {});

  return { fitScore: overall, fitReason: parsed.coopTake || '', keySignals: parsed.keySignals || [], hardDQ, jobSnapshot };
}

export async function processQueue() {
  if (state._scoringInProgress || state._scoringQueue.length === 0) return;
  state._scoringInProgress = true;

  while (state._scoringQueue.length > 0) {
    const entryId = state._scoringQueue.shift();
    try {
      // Skip scoring for closed/rejected entries — no API calls on dead opportunities
      const checkData = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
      const checkEntry = (checkData.savedCompanies || []).find(e => e.id === entryId);
      if (checkEntry?.jobStage === 'rejected') {
        console.log('[QuickFit] Skipping rejected entry:', checkEntry.company);
        continue;
      }
      await scoreOpportunity(entryId);
    } catch (err) {
      console.error('[QuickFit] Error scoring', entryId, err.message);
      // Retry once after 5 seconds
      await new Promise(r => setTimeout(r, 5000));
      try {
        await scoreOpportunity(entryId);
      } catch (retryErr) {
        console.error('[QuickFit] Retry failed for', entryId);
        // Mark as failed
        const failData = await new Promise(resolve =>
          chrome.storage.local.get(['savedCompanies'], resolve)
        );
        const failEntries = failData.savedCompanies || [];
        const failIdx = failEntries.findIndex(e => e.id === entryId);
        if (failIdx !== -1) {
          failEntries[failIdx].fitScore = null;
          failEntries[failIdx].fitReason = 'Scoring failed — tap to retry';
          failEntries[failIdx].scoredAt = Date.now();
          await new Promise(resolve =>
            chrome.storage.local.set({ savedCompanies: failEntries }, resolve)
          );
        }
        // Broadcast failure so UI can update
        chrome.runtime.sendMessage({
          type: 'SCORE_COMPLETE',
          entryId,
          companyId: entryId,
          score: null,
          fitScore: null,
          fitReason: 'Scoring failed — tap to retry',
          scoredAt: Date.now(),
        }).catch(() => {});
      }
    }
  }

  state._scoringInProgress = false;
}

// ── Structural Matching (no API calls) ──────────────────────────────────────

export function computeStructuralMatches(entry, prefs) {
  const result = { compMatch: null, arrangementMatch: null, locationMatch: null };

  // Compensation match: check if job salary is within user's floor
  if (prefs.salaryFloor && entry.salary) {
    const floor = parseInt(String(prefs.salaryFloor).replace(/[^0-9]/g, '')) || 0;
    const salaryStr = String(entry.salary || entry.baseSalaryRange || '');
    const nums = salaryStr.match(/\d[\d,]*/g)?.map(n => parseInt(n.replace(/,/g, ''))) || [];
    const max = Math.max(...nums, 0);
    if (max > 0 && floor > 0) {
      result.compMatch = max >= floor ? 'above_floor' : 'below_floor';
    }
  }

  // Work arrangement match
  if (prefs.workArrangement?.length && entry.workArrangement) {
    const prefArr = prefs.workArrangement.map(w => w.toLowerCase());
    const jobArr = entry.workArrangement.toLowerCase();
    result.arrangementMatch = prefArr.some(p => jobArr.includes(p)) ? 'match' : 'mismatch';
  }

  return result;
}


// ── Dev Mock Scoring (no API call) ───────────────────────────────────────────
export async function handleDevMockScore(entryId) {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entries = savedCompanies || [];
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return { error: 'Entry not found' };

  const localData = await new Promise(r => chrome.storage.local.get([
    'profileAttractedTo', 'profileDealbreakers', 'scoringWeights'
  ], r));
  const attractedTo = localData.profileAttractedTo || [];
  const dealbreakers = localData.profileDealbreakers || [];
  const weights = localData.scoringWeights || { qualificationFit: 20, roleFit: 20, cultureFit: 25, companyFit: 20, compFit: 15 };

  const fireRandom = (arr, pct) => arr.filter(() => Math.random() < pct);
  const firedGreens = fireRandom(attractedTo, 0.4);
  const firedReds = fireRandom(dealbreakers, 0.2);

  const DIMS_MOCK = ['roleFit', 'cultureFit', 'companyFit', 'compFit'];
  const BASELINE_M = 5.0;
  const SEV_MUL = 0.5;

  const mockEvidenceTemplates = [
    kws => `JD states: "${kws.length ? kws[0] : 'relevant qualifier'}" mentioned in role requirements`,
    kws => `Job posting: "You will ${kws.length ? kws[0] : 'work in this capacity'}..." — aligns with this criterion`,
    kws => `From posting: role description references ${kws.length ? '"' + kws.join('", "') + '"' : 'matching signals'}`,
    kws => `Glassdoor reviews mention ${kws.length ? kws[0] : 'this characteristic'} as part of the culture`,
    kws => `Company careers page highlights ${kws.length ? '"' + kws[0] + '"' : 'matching values'} in their team description`,
  ];
  function mockEvidence(f) {
    const kws = f.keywords || [];
    const tmpl = mockEvidenceTemplates[Math.floor(Math.random() * mockEvidenceTemplates.length)];
    return `[Mock] ${tmpl(kws)}`;
  }

  function mockCalcDim(dim, greens, reds) {
    let s = BASELINE_M;
    const adj = [];
    greens.forEach(f => {
      if ((f.dimension || 'roleFit') !== dim) return;
      const d = (f.severity || 2) * SEV_MUL;
      s += d;
      adj.push({ type: 'green', id: f.id, text: f.text, sev: f.severity || 2, delta: +d, evidence: mockEvidence(f) });
    });
    reds.forEach(f => {
      if ((f.dimension || 'roleFit') !== dim) return;
      const d = (f.severity || 2) * SEV_MUL;
      s -= d;
      adj.push({ type: 'red', id: f.id, text: f.text, sev: f.severity || 2, delta: -d, evidence: mockEvidence(f) });
    });
    return { raw: s, score: Math.round(Math.max(1, Math.min(10, s))), adjustments: adj };
  }

  const roleDim = mockCalcDim('roleFit', firedGreens, firedReds);
  const cultureDim = mockCalcDim('cultureFit', firedGreens, firedReds);
  const companyDim = mockCalcDim('companyFit', firedGreens, firedReds);
  const compFlagDim = mockCalcDim('compFit', firedGreens, firedReds);

  const compOptions = ['above_strong', 'above_floor', 'at_floor', 'below_floor', 'unknown'];
  const mockCompAssess = {
    baseDisclosed: Math.random() > 0.3,
    baseAmount: 170000,
    oteDisclosed: Math.random() > 0.5,
    oteAmount: 280000,
    baseVsFloor: compOptions[Math.floor(Math.random() * compOptions.length)],
    oteVsFloor: compOptions[Math.floor(Math.random() * compOptions.length)]
  };
  const baseMap = { 'above_strong': 2.5, 'above_floor': 1.5, 'at_floor': 0, 'below_floor': -2.5, 'unknown': 0 };
  const oteMap = { 'above_strong': 2.0, 'above_floor': 1.0, 'at_floor': 0, 'below_floor': -2.0, 'unknown': 0 };
  const compAdj = [];
  const bD = baseMap[mockCompAssess.baseVsFloor] ?? 0;
  const oD = oteMap[mockCompAssess.oteVsFloor] ?? 0;
  if (bD) compAdj.push({ type: bD > 0 ? 'green' : 'red', label: 'Base salary vs target', delta: bD });
  if (oD) compAdj.push({ type: oD > 0 ? 'green' : 'red', label: 'OTE vs target', delta: oD });
  compAdj.push(...compFlagDim.adjustments);
  const compRaw = BASELINE_M + bD + oD + (compFlagDim.raw - BASELINE_M);
  const compScore = Math.round(Math.max(1, Math.min(10, compRaw)));

  const qualScore = Math.floor(Math.random() * 4) + 5;
  const breakdown = {
    qualificationFit: qualScore,
    roleFit: roleDim.score,
    cultureFit: cultureDim.score,
    companyFit: companyDim.score,
    compFit: compScore
  };
  const rawOverall = (qualScore * weights.qualificationFit + roleDim.score * weights.roleFit +
    cultureDim.score * weights.cultureFit + companyDim.score * weights.companyFit +
    compScore * weights.compFit) / 100;
  const overall = Math.round(rawOverall);

  const flagsFired = {
    roleFit: { green: roleDim.adjustments.filter(a => a.type === 'green'), red: roleDim.adjustments.filter(a => a.type === 'red') },
    cultureFit: { green: cultureDim.adjustments.filter(a => a.type === 'green'), red: cultureDim.adjustments.filter(a => a.type === 'red') },
    companyFit: { green: companyDim.adjustments.filter(a => a.type === 'green'), red: companyDim.adjustments.filter(a => a.type === 'red') },
    compFit: { green: compAdj.filter(a => a.type === 'green'), red: compAdj.filter(a => a.type === 'red') }
  };

  const firedIds = new Set([...firedGreens.map(f => f.id), ...firedReds.map(f => f.id)]);
  const neutralFlags = {};
  DIMS_MOCK.forEach(dim => {
    neutralFlags[dim] = {
      green: attractedTo.filter(f => (f.dimension || 'roleFit') === dim && !firedIds.has(f.id) && f.unknownNeutral),
      red: dealbreakers.filter(f => (f.dimension || 'roleFit') === dim && !firedIds.has(f.id) && f.unknownNeutral)
    };
  });

  const mockQuals = [
    { id: 'q0', requirement: '5+ years SaaS sales experience', status: 'met', evidence: '[Mock] 8 years enterprise SaaS', importance: 'required', sources: ['resume'] },
    { id: 'q1', requirement: 'Enterprise account management', status: 'met', evidence: '[Mock] Led Fortune 500 accounts', importance: 'required', sources: ['resume'] },
    { id: 'q2', requirement: 'CRM expertise (Salesforce)', status: 'partial', evidence: '[Mock] HubSpot experience, not Salesforce', importance: 'preferred', sources: ['resume'] },
    { id: 'q3', requirement: 'Industry vertical knowledge', status: 'unknown', evidence: null, importance: 'preferred', sources: [] }
  ];

  const existing = entries[idx].jobMatch || {};
  entries[idx].jobMatch = {
    ...existing,
    score: overall,
    scoreBreakdown: breakdown,
    flagsFired,
    neutralFlags,
    qualifications: mockQuals,
    keySignals: [{ type: 'green', text: '[Mock] Strong culture alignment signals' }, { type: 'red', text: '[Mock] Unclear growth trajectory' }],
    coopTake: '[Mock] Solid role fit with some comp uncertainty. Good enough to explore.',
    scoreRationale: `qual ${qualScore}×${weights.qualificationFit}% + role ${roleDim.score}×${weights.roleFit}% + culture ${cultureDim.score}×${weights.cultureFit}% + company ${companyDim.score}×${weights.companyFit}% + comp ${compScore}×${weights.compFit}% = ${rawOverall.toFixed(2)} → ${Number(overall).toFixed(1)}/10`,
    compAssessment: mockCompAssess,
    dimensionRationale: {
      roleFit: '[Mock] Role aligns well with GTM leadership background',
      cultureFit: '[Mock] Fast-paced startup culture matches preferences',
      companyFit: '[Mock] Series B stage fits target company profile',
      compFit: '[Mock] Comp appears competitive but OTE structure unclear'
    },
    roleBrief: {
      roleSummary: '[Mock] VP Sales owning enterprise revenue, 10-person team, $20M ARR target.',
      whyInteresting: '[Mock] High ownership, direct CEO report, equity upside at Series B.',
      concerns: '[Mock] Unclear if comp is truly competitive at this stage.',
      compSummary: mockCompAssess.baseDisclosed ? '$170K base' : 'Not disclosed',
      qualificationMatch: '3 of 4 requirements met',
      qualificationScore: qualScore
    },
    hardDQ: { flagged: false, reasons: [] },
    lastUpdatedAt: existing.lastUpdatedAt || null,
    mockScoredAt: Date.now(),
    lastScoringUsage: { model: 'dev-mock', input: 0, output: 0, cost: 0 }
  };
  entries[idx].fitScore = overall;
  entries[idx].fitReason = entries[idx].jobMatch.coopTake;
  entries[idx].keySignals = entries[idx].jobMatch.keySignals;

  await new Promise(r => chrome.storage.local.set({ savedCompanies: entries }, r));
  console.log('[DevMock] Wrote mock score for', entries[idx].company, '— score:', overall);
  return { ok: true };
}
