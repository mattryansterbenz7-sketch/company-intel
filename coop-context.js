// coop-context.js — Pipeline summary, intent detection,
// cross-company aggregation (meetings, emails, contacts).
// Profile context is now handled by compiled .md docs (profile-compiler.js).

import { truncateToTokenBudget } from './utils.js';

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
