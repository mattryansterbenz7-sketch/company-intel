// coop-context.js — Coop profile context, pipeline summary, intent detection,
// cross-company aggregation (meetings, emails, contacts).

import { getUserName, truncateToTokenBudget } from './utils.js';
import { buildCoopMemoryBlock } from './memory.js';

// ── Profile Context Builder ───────────────────────────────────────────────

export async function buildCoopProfileContext() {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const profileKeys = ['profileLinks', 'profileStory', 'profileExperience', 'profilePrinciples',
    'profileMotivators', 'profileVoice', 'profileFAQ', 'profileGreenLights', 'profileRedLights',
    'profileResume', 'profileSkills', 'storyTime', 'coopMemory',
    'profileAttractedTo', 'profileDealbreakers', 'profileSkillTags',
    'profileRoleICP', 'profileCompanyICP', 'profileInterviewLearnings'];
  const profileData = await new Promise(r => chrome.storage.local.get(profileKeys, r));
  const parts = [];

  // Personal Info
  const links = profileData.profileLinks || {};
  const linkParts = [];
  if (links.linkedin || prefs.linkedinUrl) linkParts.push(`LinkedIn: ${links.linkedin || prefs.linkedinUrl}`);
  if (links.github)  linkParts.push(`GitHub: ${links.github}`);
  if (links.website) linkParts.push(`Website: ${links.website}`);
  if (links.email)   linkParts.push(`Email: ${links.email}`);
  if (links.phone)   linkParts.push(`Phone: ${links.phone}`);
  if (linkParts.length) parts.push(`\n[Personal Info]\n${linkParts.join('\n')}`);

  // Story
  const story = profileData.profileStory || (profileData.storyTime?.profileSummary || profileData.storyTime?.rawInput || '');
  if (story) parts.push(`\n[Your Story]\n${story.slice(0, 8000)}`);

  // Career OS text buckets
  if (profileData.profileExperience) parts.push(`\n[Experience & Accomplishments]\n${profileData.profileExperience.slice(0, 4000)}`);
  if (profileData.profilePrinciples) parts.push(`\n[Operating Principles]\n${profileData.profilePrinciples.slice(0, 2000)}`);
  if (profileData.profileMotivators) parts.push(`\n[What Drives You]\n${profileData.profileMotivators.slice(0, 2000)}`);
  if (profileData.profileVoice)      parts.push(`\n[Voice & Style]\n${profileData.profileVoice.slice(0, 2000)}`);
  if (profileData.profileFAQ)        parts.push(`\n[FAQ / Polished Responses]\n${profileData.profileFAQ.slice(0, 3000)}`);

  // Resume
  const resume = profileData.profileResume?.content || prefs.resumeText;
  if (resume) parts.push(`\n[Resume]\n${resume.slice(0, 3000)}`);

  // Structured: Attracted To / Dealbreakers (with legacy fallback)
  const attractedTo = profileData.profileAttractedTo || [];
  const dealbreakers = profileData.profileDealbreakers || [];
  if (attractedTo.length) {
    parts.push(`\n[Attracted To (structured)]\n${attractedTo.map(e => {
      const neutral = e.unknownNeutral !== false ? ' [neutral-if-absent]' : '';
      return `- [${e.category}${neutral}] ${e.text}${e.keywords?.length ? ` {keywords: ${e.keywords.join(', ')}}` : ''}`;
    }).join('\n')}`);
  } else {
    const greenLights = profileData.profileGreenLights || [prefs.roles, prefs.roleLoved, prefs.interests].filter(Boolean).join('\n');
    if (greenLights) parts.push(`\n[Green Lights]\n${greenLights.slice(0, 2000)}`);
  }
  if (dealbreakers.length) {
    parts.push(`\n[Red Flags (structured)]\n${dealbreakers.map(e => {
      const neutral = e.unknownNeutral !== false ? ' [neutral-if-absent]' : '';
      return `- [${e.category}/${e.severity}${neutral}] ${e.text}${e.keywords?.length ? ` {keywords: ${e.keywords.join(', ')}}` : ''}`;
    }).join('\n')}\nFor flags marked [neutral-if-absent]: only factor in when you have evidence. If unconfirmed, zero impact, do not mention.`);
  } else {
    const redLights = profileData.profileRedLights || [prefs.avoid, prefs.roleHated].filter(Boolean).join('\n');
    if (redLights) parts.push(`\n[Red Lights]\n${redLights.slice(0, 2000)}`);
  }

  // Role ICP
  const roleICP = profileData.profileRoleICP || {};
  const _aj = v => Array.isArray(v) ? v.join(', ') : (v || '');
  if (roleICP.text || _aj(roleICP.targetFunction)) {
    const attrs = [_aj(roleICP.targetFunction), roleICP.seniority, roleICP.scope, roleICP.sellingMotion, roleICP.teamSizePreference].filter(Boolean);
    parts.push(`\n[Role ICP]\n${roleICP.text || ''}${attrs.length ? '\nAttributes: ' + attrs.join(' | ') : ''}`);
  }

  // Company ICP
  const companyICP = profileData.profileCompanyICP || {};
  if (companyICP.text || _aj(companyICP.stage)) {
    const attrs = [_aj(companyICP.stage), _aj(companyICP.sizeRange), _aj(companyICP.industryPreferences), _aj(companyICP.cultureMarkers)].filter(Boolean);
    parts.push(`\n[Company ICP]\n${companyICP.text || ''}${attrs.length ? '\nAttributes: ' + attrs.join(' | ') : ''}`);
  }

  // Skills + tags
  const skills = profileData.profileSkills || prefs.jobMatchBackground;
  const skillTags = profileData.profileSkillTags || [];
  if (skills || skillTags.length) {
    let skillSection = skills || '';
    if (skillTags.length) skillSection += `\nSkill tags: ${skillTags.join(', ')}`;
    parts.push(`\n[Skills & Intangibles]\n${skillSection}`);
  }

  // Interview learnings
  const learnings = profileData.profileInterviewLearnings || [];
  if (learnings.length) {
    parts.push(`\n[Interview Learnings]\n${learnings.slice(-10).map(l =>
      `- ${l.text}${l.source ? ` (${l.source})` : ''}${l.date ? ` [${l.date}]` : ''}`
    ).join('\n')}`);
  }

  // Location & logistics
  const locParts = [];
  if (prefs.userLocation) locParts.push(`Location: ${prefs.userLocation}`);
  const wa = (prefs.workArrangement || []).join(', ');
  if (wa) locParts.push(`Work arrangement: ${wa}`);
  if (prefs.maxTravel) locParts.push(`Max travel: ${prefs.maxTravel}`);
  if (locParts.length) parts.push(`\n[Location]\n${locParts.join('\n')}`);

  // Compensation
  const compParts = [];
  if (prefs.salaryFloor)  compParts.push(`Base salary floor: $${prefs.salaryFloor}`);
  if (prefs.salaryStrong) compParts.push(`Base salary strong: $${prefs.salaryStrong}`);
  if (prefs.oteFloor)     compParts.push(`OTE floor: $${prefs.oteFloor}`);
  if (prefs.oteStrong)    compParts.push(`OTE strong: $${prefs.oteStrong}`);
  if (compParts.length) parts.push(`\n[Compensation]\n${compParts.join('\n')}`);

  // Coop's structured persistent memory (typed entries — Claude Code style)
  const memBlockA = buildCoopMemoryBlock(profileData.coopMemory);
  if (memBlockA) parts.push(memBlockA);
  if (profileData.storyTime?.answerPatterns?.length) {
    parts.push(`\n=== ANSWER PATTERNS (approaches that worked well) ===\n${profileData.storyTime.answerPatterns.slice(-10).map(p => `[${p.date}] ${p.context || ''}\n${p.text}`).join('\n\n')}\n\nUse these as templates — adapt specifics to the current company.`);
  }

  return parts.join('\n');
}

// ── Pipeline Summary ──────────────────────────────────────────────────────

export async function buildCoopPipelineSummary() {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entries = savedCompanies || [];
  if (!entries.length) return { summary: '', entries };
  const lines = entries.map(e => {
    const parts = [e.company];
    if (e.jobStage) parts.push(`Stage: ${e.jobStage}`);
    else if (e.status) parts.push(`Status: ${e.status}`);
    if (e.jobTitle) parts.push(`Role: ${e.jobTitle}`);
    if (e.jobMatch?.score) parts.push(`Score: ${e.jobMatch.score}/10`);
    if (e.rating) parts.push(`Excitement: ${e.rating}/5`);
    if (e.knownContacts?.length) parts.push(`Contacts: ${e.knownContacts.slice(0,3).map(c=>c.name).join(', ')}`);
    if (e.notes) parts.push(`Notes: ${e.notes.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,80)}`);
    if (e.tags?.length) parts.push(`Tags: ${e.tags.join(', ')}`);
    return `- ${parts.join(' | ')}`;
  }).join('\n');
  return { summary: `\n=== YOUR FULL PIPELINE (${entries.length} entries) ===\n${lines}`, entries };
}

// ── Content-Aware Context: Intent Detection + Cross-Company Aggregation ──

export function detectContextIntent(message, entries) {
  const lower = message.toLowerCase();
  const modules = new Set();
  const mentionedCompanies = [];

  // Detect mentioned companies by name
  for (const e of entries) {
    if (e.company && e.company.length > 2 && lower.includes(e.company.toLowerCase())) {
      mentionedCompanies.push(e.id);
    }
  }

  const INTENT_MAP = [
    { patterns: [/\b(?:meeting|conversation|call|interview|spoke|talked|discussed|met with|best conversation|worst conversation)\b/i], module: 'meetings' },
    { patterns: [/\b(?:email|emails|messaged|correspondence|thread|inbox|sent|replied|follow.?up)\b/i], module: 'emails' },
    { patterns: [/\b(?:contact|contacts|people|who do i know|connections|network|who have i)\b/i], module: 'contacts' },
    { patterns: [/\b(?:compare|rank|prioritize|all (?:my |the )?(?:companies|opportunities|roles))\b/i], module: 'pipeline_full' },
    { patterns: [/\b(?:strategy|next steps|game plan|what should i|where should i focus)\b/i], module: 'meetings,pipeline_full' },
    { patterns: [/\b(?:draft|write|compose)\b/i], module: 'emails,contacts' },
    { patterns: [/\b(?:best|worst|recent|latest|strongest|weakest)\b.*\b(?:conversation|meeting|email|interaction|interview|call)\b/i], module: 'meetings,emails' },
  ];

  for (const { patterns, module } of INTENT_MAP) {
    if (patterns.some(p => p.test(lower))) {
      module.split(',').forEach(m => modules.add(m.trim()));
    }
  }

  const needsCrossCompany = modules.has('meetings') || modules.has('emails') || modules.has('contacts');
  return { modules, mentionedCompanies, needsCrossCompany };
}

export function buildCrossCompanyMeetings(entries, opts = {}) {
  const { totalBudget = 8000, mentionedCompanies = [] } = opts;
  const filtered = mentionedCompanies.length
    ? entries.filter(e => mentionedCompanies.includes(e.id))
    : entries;

  const allMeetings = [];
  for (const e of filtered) {
    const meetings = e.cachedMeetings || [];
    for (const m of meetings) {
      allMeetings.push({
        company: e.company,
        title: m.title || 'Untitled',
        date: m.date || '',
        time: m.time || '',
        summary: m.summaryMarkdown || '',
        transcript: (m.transcript || '').slice(0, 800),
        _ts: m.date ? new Date(m.date + 'T12:00:00').getTime() : 0,
      });
    }
    // Also include manual meetings
    if (e.manualMeetings?.length) {
      for (const m of e.manualMeetings) {
        allMeetings.push({
          company: e.company,
          title: m.title || 'Manual meeting',
          date: m.date || '',
          time: m.time || '',
          summary: '',
          transcript: (m.transcript || m.notes || '').slice(0, 800),
          _ts: m.date ? new Date(m.date + 'T12:00:00').getTime() : 0,
        });
      }
    }
  }

  if (!allMeetings.length) return '';
  allMeetings.sort((a, b) => b._ts - a._ts);

  let text = `\n=== MEETINGS ACROSS PIPELINE (${allMeetings.length} meetings) ===\n`;
  for (const m of allMeetings) {
    const entry = `--- ${m.company}: ${m.title} | ${m.date}${m.time ? ' ' + m.time : ''} ---\n`;
    const body = m.summary ? `Summary: ${m.summary}\n` : '';
    const trans = m.transcript ? `Transcript: ${m.transcript}\n` : '';
    text += entry + body + trans + '\n';
    if (text.length > totalBudget) break;
  }
  return truncateToTokenBudget(text, totalBudget);
}

export function buildCrossCompanyEmails(entries, opts = {}) {
  const { totalBudget = 4000, mentionedCompanies = [] } = opts;
  const filtered = mentionedCompanies.length
    ? entries.filter(e => mentionedCompanies.includes(e.id))
    : entries;

  const allEmails = [];
  for (const e of filtered) {
    for (const em of (e.cachedEmails || []).slice(0, 15)) {
      allEmails.push({
        company: e.company,
        from: (em.from || '').replace(/<[^>]+>/, '').trim(),
        subject: em.subject || '',
        date: em.date || '',
        snippet: (em.snippet || '').slice(0, 150),
        _ts: em.date ? new Date(em.date).getTime() : 0,
      });
    }
  }

  if (!allEmails.length) return '';
  allEmails.sort((a, b) => b._ts - a._ts);

  let text = `\n=== EMAILS ACROSS PIPELINE (${allEmails.length} emails) ===\n`;
  for (const em of allEmails.slice(0, 50)) {
    text += `[${em.date}] ${em.company} — "${em.subject}" from ${em.from}\n  ${em.snippet}\n`;
    if (text.length > totalBudget) break;
  }
  return truncateToTokenBudget(text, totalBudget);
}

export function buildCrossCompanyContacts(entries, opts = {}) {
  const { totalBudget = 3000, mentionedCompanies = [] } = opts;
  const filtered = mentionedCompanies.length
    ? entries.filter(e => mentionedCompanies.includes(e.id))
    : entries;

  const lines = [];
  for (const e of filtered) {
    if (!e.knownContacts?.length) continue;
    const contacts = e.knownContacts.slice(0, 5).map(c => {
      const parts = [c.name];
      if (c.title) parts.push(c.title);
      if (c.email) parts.push(`<${c.email}>`);
      return parts.join(' | ');
    }).join('; ');
    lines.push(`${e.company}: ${contacts}`);
  }

  if (!lines.length) return '';
  const text = `\n=== CONTACTS ACROSS PIPELINE ===\n${lines.join('\n')}`;
  return truncateToTokenBudget(text, totalBudget);
}
