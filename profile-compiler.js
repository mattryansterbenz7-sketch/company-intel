// profile-compiler.js — Compiles user profile + preferences into clean markdown documents.
// These compiled docs are Coop's single source of truth: what goes into prompts, what tools
// return, and what the user can inspect. One format, one place, no duplication.
//
// Three documents at three tiers:
//   coopProfileSummary / coopProfileStandard / coopProfileFull
//   coopPrefsSummary   / coopPrefsStandard   / coopPrefsFull
//
// Compilation is a local text transform — zero API cost. Runs on profile/pref save events.

import { state } from './bg-state.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text || '';
  return text.slice(0, maxChars).replace(/\s\S*$/, '') + '…';
}

function joinArr(v) {
  return Array.isArray(v) ? v.join(', ') : (v || '');
}

// ── Profile Document Compiler ───────────────────────────────────────────────

function compileProfileFull(d, prefs) {
  const name = prefs.name || prefs.fullName || '';
  const sections = [];

  sections.push(`# ${name || 'User Profile'}`);

  // Story
  const story = d.profileStory || d.storyTime?.profileSummary || d.storyTime?.rawInput || '';
  if (story) {
    sections.push(`## Story\n${stripHtml(story)}`);
  }

  // Experience
  const exp = stripHtml(d.profileExperience || '');
  const entries = d.profileExperienceEntries || [];
  if (exp || entries.length) {
    let text = exp;
    if (entries.length) {
      if (text) text += '\n\n';
      text += entries.map(e => {
        const parts = [`**${e.company || 'Unknown'}**`];
        if (e.titles) parts[0] += ` — ${e.titles}`;
        if (e.dateRange) parts.push(`(${e.dateRange})`);
        if (e.summary) parts.push(`\n  ${e.summary}`);
        const tags = (e.tags || []).join(', ');
        if (tags) parts.push(`\n  Skills: ${tags}`);
        return `- ${parts.join(' ')}`;
      }).join('\n');
    }
    sections.push(`## Experience\n${text}`);
  }

  // Skills
  const skills = stripHtml(d.profileSkills || '');
  const skillTags = d.profileSkillTags || [];
  if (skills || skillTags.length) {
    let text = skills;
    if (skillTags.length) {
      if (text) text += '\n\n';
      text += `Tags: ${skillTags.join(', ')}`;
    }
    sections.push(`## Skills & Intangibles\n${text}`);
  }

  // Principles
  const principles = stripHtml(d.profilePrinciples || '');
  if (principles) {
    sections.push(`## Operating Principles\n${principles}`);
  }

  // Voice
  const voice = stripHtml(d.profileVoice || '');
  const antiPhrases = d.voiceProfile?.antiPhrases || [];
  if (voice || antiPhrases.length) {
    let text = voice;
    if (antiPhrases.length) {
      if (text) text += '\n\n';
      text += `Avoid these phrases: ${antiPhrases.join(', ')}`;
    }
    sections.push(`## Voice & Communication Style\n${text}`);
  }

  // FAQ
  const faqPairs = d.profileFaqPairs || [];
  const faqText = stripHtml(d.profileFAQ || '');
  if (faqPairs.length) {
    const text = faqPairs.map(p => `**Q: ${stripHtml(p.q)}**\nA: ${stripHtml(p.a)}`).join('\n\n');
    sections.push(`## FAQ / Polished Responses\n${text}`);
  } else if (faqText) {
    sections.push(`## FAQ / Polished Responses\n${faqText}`);
  }

  // Resume
  const resume = d.profileResume?.content || prefs.resumeText || '';
  if (resume) {
    sections.push(`## Resume\n${truncate(resume, 6000)}`);
    // Extract education section separately so truncation doesn't clip it
    if (resume.length > 5500) {
      const eduMatch = resume.match(/\b(EDUCATION|Education|ACADEMIC|Academic|DEGREES?|Degrees?|CERTIFICATIONS?\s*(?:&|AND)\s*EDUCATION)\b[\s\S]{0,1500}/i);
      if (eduMatch && resume.indexOf(eduMatch[0]) >= 5000) {
        sections.push(`## Education (from resume)\n${eduMatch[0].trim()}`);
      }
    }
  }

  // Links
  const links = d.profileLinks || {};
  const linkLines = [];
  if (links.linkedin || prefs.linkedinUrl) linkLines.push(`- LinkedIn: ${links.linkedin || prefs.linkedinUrl}`);
  if (links.github) linkLines.push(`- GitHub: ${links.github}`);
  if (links.website) linkLines.push(`- Website: ${links.website}`);
  if (links.email) linkLines.push(`- Email: ${links.email}`);
  if (links.phone) linkLines.push(`- Phone: ${links.phone}`);
  if (linkLines.length) {
    sections.push(`## Links\n${linkLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

function compileProfileStandard(d, prefs) {
  const name = prefs.name || prefs.fullName || '';
  const sections = [];

  sections.push(`# ${name || 'User Profile'}`);

  // Story — abbreviated
  const story = d.profileStory || d.storyTime?.profileSummary || d.storyTime?.rawInput || '';
  if (story) {
    sections.push(`## Story\n${truncate(stripHtml(story), 1500)}`);
  }

  // Experience — key points only
  const exp = stripHtml(d.profileExperience || '');
  const entries = d.profileExperienceEntries || [];
  if (exp || entries.length) {
    let text = '';
    if (entries.length) {
      text = entries.slice(0, 5).map(e => {
        const line = `- **${e.company || 'Unknown'}**${e.titles ? ` — ${e.titles}` : ''}`;
        const tags = (e.tags || []).slice(0, 5).join(', ');
        return tags ? `${line} (${tags})` : line;
      }).join('\n');
    } else {
      text = truncate(exp, 1200);
    }
    sections.push(`## Experience\n${text}`);
  }

  // Skills — tags only
  const skillTags = d.profileSkillTags || [];
  if (skillTags.length) {
    sections.push(`## Skills\n${skillTags.join(', ')}`);
  }

  // Principles — abbreviated
  const principles = stripHtml(d.profilePrinciples || '');
  if (principles) {
    sections.push(`## Operating Principles\n${truncate(principles, 500)}`);
  }

  // Voice — abbreviated
  const voice = stripHtml(d.profileVoice || '');
  if (voice) {
    sections.push(`## Voice\n${truncate(voice, 300)}`);
  }

  return sections.join('\n\n');
}

function compileProfileSummary(d, prefs) {
  const name = prefs.name || prefs.fullName || '';
  const parts = [name];

  // Role from ICP or experience
  const roleICP = d.profileRoleICP || {};
  if (roleICP.seniority || joinArr(roleICP.targetFunction)) {
    parts.push(`${roleICP.seniority || ''} ${joinArr(roleICP.targetFunction)}`.trim());
  }

  // Key skills
  const skillTags = (d.profileSkillTags || []).slice(0, 5);
  if (skillTags.length) {
    parts.push(`Skills: ${skillTags.join(', ')}`);
  }

  // Location
  if (prefs.userLocation) {
    parts.push(prefs.userLocation);
  }

  // Work arrangement
  const wa = (prefs.workArrangement || []).join('/');
  if (wa) parts.push(wa);

  return parts.filter(Boolean).join(' | ');
}

// ── Preferences Document Compiler ───────────────────────────────────────────

function compilePrefsFull(d, prefs) {
  const sections = [];

  sections.push('# Job Search Preferences');

  // Role ICP
  const roleICP = d.profileRoleICP || {};
  if (roleICP.text || joinArr(roleICP.targetFunction)) {
    let text = roleICP.text || '';
    const attrs = [
      roleICP.seniority ? `Seniority: ${roleICP.seniority}` : '',
      joinArr(roleICP.targetFunction) ? `Function: ${joinArr(roleICP.targetFunction)}` : '',
      roleICP.scope ? `Scope: ${roleICP.scope}` : '',
      roleICP.sellingMotion ? `Motion: ${roleICP.sellingMotion}` : '',
      roleICP.teamSizePreference ? `Team: ${roleICP.teamSizePreference}` : '',
    ].filter(Boolean);
    if (attrs.length) {
      if (text) text += '\n\n';
      text += attrs.map(a => `- ${a}`).join('\n');
    }
    sections.push(`## Role ICP\n${text}`);
  }

  // Company ICP
  const companyICP = d.profileCompanyICP || {};
  if (companyICP.text || joinArr(companyICP.stage)) {
    let text = companyICP.text || '';
    const attrs = [
      joinArr(companyICP.stage) ? `Stage: ${joinArr(companyICP.stage)}` : '',
      joinArr(companyICP.sizeRange) ? `Size: ${joinArr(companyICP.sizeRange)}` : '',
      joinArr(companyICP.industryPreferences) ? `Industry: ${joinArr(companyICP.industryPreferences)}` : '',
      joinArr(companyICP.cultureMarkers) ? `Culture: ${joinArr(companyICP.cultureMarkers)}` : '',
    ].filter(Boolean);
    if (attrs.length) {
      if (text) text += '\n\n';
      text += attrs.map(a => `- ${a}`).join('\n');
    }
    sections.push(`## Company ICP\n${text}`);
  }

  // Green Flags
  const attractedTo = d.profileAttractedTo || [];
  if (attractedTo.length) {
    const text = attractedTo.map(e => {
      const neutral = e.unknownNeutral !== false ? ' *(neutral if absent)*' : '';
      const kw = e.keywords?.length ? ` — keywords: ${e.keywords.join(', ')}` : '';
      return `- **[${e.category}]** ${e.text}${neutral}${kw}`;
    }).join('\n');
    sections.push(`## Green Flags (Attracted To)\n${text}`);
  }

  // Red Flags
  const dealbreakers = d.profileDealbreakers || [];
  if (dealbreakers.length) {
    const text = dealbreakers.map(e => {
      const neutral = e.unknownNeutral !== false ? ' *(neutral if absent)*' : '';
      const kw = e.keywords?.length ? ` — keywords: ${e.keywords.join(', ')}` : '';
      return `- **[${e.category} / severity ${e.severity}]** ${e.text}${neutral}${kw}`;
    }).join('\n');
    sections.push(`## Red Flags (Dealbreakers)\n${text}\n\n*For flags marked "neutral if absent": only factor in when evidence exists. If unconfirmed, zero impact.*`);
  }

  // Compensation
  const compLines = [];
  if (prefs.salaryFloor || prefs.salaryStrong) {
    compLines.push(`- Base: floor $${prefs.salaryFloor || '?'} | strong $${prefs.salaryStrong || '?'}`);
  }
  if (prefs.oteFloor || prefs.oteStrong) {
    compLines.push(`- OTE: floor $${prefs.oteFloor || '?'} | strong $${prefs.oteStrong || '?'}`);
  }
  if (compLines.length) {
    sections.push(`## Compensation\n${compLines.join('\n')}`);
  }

  // Location & Work Arrangement
  const locLines = [];
  if (prefs.userLocation) locLines.push(`- Location: ${prefs.userLocation}`);
  const wa = (prefs.workArrangement || []).join(', ');
  if (wa) locLines.push(`- Arrangement: ${wa}`);
  if (prefs.maxTravel) locLines.push(`- Max travel: ${prefs.maxTravel}`);
  if (locLines.length) {
    sections.push(`## Location & Work Arrangement\n${locLines.join('\n')}`);
  }

  // Interview Learnings
  const learnings = d.profileInterviewLearnings || [];
  if (learnings.length) {
    const text = learnings.slice(-20).map(l => {
      const meta = [l.source, l.date].filter(Boolean).join(', ');
      return `- ${l.text}${meta ? ` *(${meta})*` : ''}`;
    }).join('\n');
    sections.push(`## Interview Learnings\n${text}`);
  }

  return sections.join('\n\n');
}

function compilePrefsStandard(d, prefs) {
  const sections = [];

  sections.push('# Job Search Preferences');

  // Role ICP — compact
  const roleICP = d.profileRoleICP || {};
  if (roleICP.text || joinArr(roleICP.targetFunction)) {
    const parts = [roleICP.text, roleICP.seniority, joinArr(roleICP.targetFunction), roleICP.scope].filter(Boolean);
    sections.push(`## Role ICP\n${parts.join(' | ')}`);
  }

  // Company ICP — compact
  const companyICP = d.profileCompanyICP || {};
  if (companyICP.text || joinArr(companyICP.stage)) {
    const parts = [companyICP.text, joinArr(companyICP.stage), joinArr(companyICP.sizeRange), joinArr(companyICP.industryPreferences)].filter(Boolean);
    sections.push(`## Company ICP\n${parts.join(' | ')}`);
  }

  // Flags — text only, no keywords
  const attractedTo = d.profileAttractedTo || [];
  if (attractedTo.length) {
    sections.push(`## Green Flags\n${attractedTo.map(e => `- [${e.category}] ${e.text}`).join('\n')}`);
  }
  const dealbreakers = d.profileDealbreakers || [];
  if (dealbreakers.length) {
    sections.push(`## Red Flags\n${dealbreakers.map(e => `- [${e.category}/${e.severity}] ${e.text}`).join('\n')}`);
  }

  // Comp — one line
  const comp = [
    prefs.salaryFloor ? `Base: $${prefs.salaryFloor}-${prefs.salaryStrong || '?'}` : '',
    prefs.oteFloor ? `OTE: $${prefs.oteFloor}-${prefs.oteStrong || '?'}` : '',
  ].filter(Boolean).join(' | ');
  if (comp) sections.push(`## Compensation\n${comp}`);

  // Location — one line
  const loc = [prefs.userLocation, (prefs.workArrangement || []).join('/'), prefs.maxTravel ? `${prefs.maxTravel} travel` : ''].filter(Boolean).join(' | ');
  if (loc) sections.push(`## Location\n${loc}`);

  // Learnings — last 5 only
  const learnings = (d.profileInterviewLearnings || []).slice(-5);
  if (learnings.length) {
    sections.push(`## Recent Learnings\n${learnings.map(l => `- ${l.text}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function compilePrefsSummary(d, prefs) {
  const parts = [];

  const roleICP = d.profileRoleICP || {};
  if (roleICP.text) parts.push(`Looking for: ${truncate(roleICP.text, 80)}`);

  const comp = [
    prefs.salaryFloor ? `Base $${prefs.salaryFloor}+` : '',
    prefs.oteFloor ? `OTE $${prefs.oteFloor}+` : '',
  ].filter(Boolean).join(', ');
  if (comp) parts.push(comp);

  const loc = [prefs.userLocation, (prefs.workArrangement || []).join('/')].filter(Boolean).join(', ');
  if (loc) parts.push(loc);

  const greens = (d.profileAttractedTo || []).length;
  const reds = (d.profileDealbreakers || []).length;
  if (greens || reds) parts.push(`${greens} green flags, ${reds} red flags`);

  return parts.join(' | ');
}

// ── Main Compile Function ───────────────────────────────────────────────────

const PROFILE_STORAGE_KEYS = [
  'profileStory', 'profileExperience', 'profileExperienceEntries',
  'profilePrinciples', 'profileMotivators', 'profileVoice', 'profileFAQ',
  'profileFaqPairs', 'profileSkills', 'profileSkillTags', 'profileResume',
  'profileLinks', 'profileAttractedTo', 'profileDealbreakers',
  'profileRoleICP', 'profileCompanyICP', 'profileInterviewLearnings',
  'storyTime', 'voiceProfile',
];

export async function compileProfile() {
  const prefs = await new Promise(r => chrome.storage.sync.get(['prefs'], d => r(d.prefs || {})));
  const d = await new Promise(r => chrome.storage.local.get(PROFILE_STORAGE_KEYS, r));

  const compiled = {
    coopProfileFull:     compileProfileFull(d, prefs),
    coopProfileStandard: compileProfileStandard(d, prefs),
    coopProfileSummary:  compileProfileSummary(d, prefs),
    coopPrefsFull:       compilePrefsFull(d, prefs),
    coopPrefsStandard:   compilePrefsStandard(d, prefs),
    coopPrefsSummary:    compilePrefsSummary(d, prefs),
    coopProfileCompiledAt: Date.now(),
  };

  chrome.storage.local.set(compiled, () => {
    if (chrome.runtime.lastError) {
      console.error('[ProfileCompiler] Save failed:', chrome.runtime.lastError.message);
    } else {
      console.log('[ProfileCompiler] Compiled 6 docs —',
        `profile: ${compiled.coopProfileSummary.length}/${compiled.coopProfileStandard.length}/${compiled.coopProfileFull.length} chars,`,
        `prefs: ${compiled.coopPrefsSummary.length}/${compiled.coopPrefsStandard.length}/${compiled.coopPrefsFull.length} chars`);
    }
  });

  return compiled;
}

// ── Watch for changes and recompile ─────────────────────────────────────────

let _compileTimer = null;

function scheduleRecompile() {
  clearTimeout(_compileTimer);
  _compileTimer = setTimeout(() => compileProfile(), 2000); // 2s debounce
}

export function initProfileCompiler() {
  // Compile on boot
  compileProfile();

  // Watch for profile/pref changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      const relevant = PROFILE_STORAGE_KEYS.some(k => changes[k]);
      // Don't re-trigger on our own compiled output
      const isOwnOutput = changes.coopProfileFull || changes.coopProfileStandard || changes.coopProfileSummary
        || changes.coopPrefsFull || changes.coopPrefsStandard || changes.coopPrefsSummary;
      if (relevant && !isOwnOutput) {
        scheduleRecompile();
      }
    }
    if (area === 'sync' && changes.prefs) {
      scheduleRecompile();
    }
  });
}
