// knowledge.js — Coop knowledge document manager.
// Extracts granular sections from compiled profile/preferences docs,
// compiles a learnings document from memory entries, and maintains
// a manifest of all available knowledge documents for tool access.
//
// Runs alongside profile-compiler.js: it watches for compiled doc
// changes and re-extracts sections. Zero API cost — pure text transforms.

import { buildLearningsDocument } from './memory.js';

// ── Section header allowlists ────────────────────────────────────────────────
// Only these headers are recognized when parsing Full-tier markdown.
// Prevents user-authored content containing "## " from creating phantom sections.

const PROFILE_HEADERS = {
  'story':                     { id: 'profile:story',       title: 'Story',                    category: 'profile' },
  'experience':                { id: 'profile:experience',  title: 'Experience',               category: 'profile' },
  'skills & intangibles':      { id: 'profile:skills',      title: 'Skills & Intangibles',     category: 'profile' },
  'skills':                    { id: 'profile:skills',      title: 'Skills',                   category: 'profile' },
  'operating principles':      { id: 'profile:principles',  title: 'Operating Principles',     category: 'profile' },
  'voice & communication style': { id: 'profile:voice',     title: 'Voice & Communication',    category: 'profile' },
  'voice':                     { id: 'profile:voice',       title: 'Voice',                    category: 'profile' },
  'faq / polished responses':  { id: 'profile:faq',         title: 'FAQ / Polished Responses', category: 'profile' },
  'resume':                    { id: 'profile:resume',      title: 'Resume',                   category: 'profile' },
  'education (from resume)':   { id: 'profile:education',   title: 'Education',                category: 'profile' },
  'education':                 { id: 'profile:education',   title: 'Education',                category: 'profile' },
  'links':                     { id: 'profile:links',       title: 'Links',                    category: 'profile' },
};

const PREFS_HEADERS = {
  'role icp':                  { id: 'prefs:roleICP',       title: 'Role ICP',                 category: 'preferences' },
  'company icp':               { id: 'prefs:companyICP',    title: 'Company ICP',              category: 'preferences' },
  'green flags (attracted to)': { id: 'prefs:greenFlags',   title: 'Green Flags',              category: 'preferences' },
  'green flags':               { id: 'prefs:greenFlags',    title: 'Green Flags',              category: 'preferences' },
  'red flags (dealbreakers)':  { id: 'prefs:redFlags',      title: 'Red Flags',                category: 'preferences' },
  'red flags':                 { id: 'prefs:redFlags',      title: 'Red Flags',                category: 'preferences' },
  'compensation':              { id: 'prefs:compensation',  title: 'Compensation',             category: 'preferences' },
  'location & work arrangement': { id: 'prefs:location',    title: 'Location & Work Arrangement', category: 'preferences' },
  'location':                  { id: 'prefs:location',      title: 'Location',                 category: 'preferences' },
  'interview learnings':       { id: 'prefs:learnings',     title: 'Interview Learnings',      category: 'preferences' },
  'recent learnings':          { id: 'prefs:learnings',     title: 'Recent Learnings',         category: 'preferences' },
};

// ── Section extraction ───────────────────────────────────────────────────────

/**
 * Parse a Full-tier markdown document into individual sections.
 * Only recognizes headers from the allowlist for the given docType.
 * Returns a map of { sectionId: { title, content, category } }.
 */
function extractSections(fullMarkdown, docType) {
  if (!fullMarkdown) return {};
  const headerMap = docType === 'profile' ? PROFILE_HEADERS : PREFS_HEADERS;
  const sections = {};

  // Split on ## headers (keeping the header text)
  const parts = fullMarkdown.split(/^## (.+)$/m);
  // parts = [preamble, header1, body1, header2, body2, ...]

  for (let i = 1; i < parts.length; i += 2) {
    const rawHeader = (parts[i] || '').trim();
    const body = (parts[i + 1] || '').trim();
    const key = rawHeader.toLowerCase();

    const mapping = headerMap[key];
    if (!mapping) continue; // Skip unrecognized headers

    // If duplicate ID (e.g. 'skills' and 'skills & intangibles' both map to profile:skills),
    // append content to existing section
    if (sections[mapping.id]) {
      sections[mapping.id].content += '\n\n' + body;
    } else {
      sections[mapping.id] = {
        title: mapping.title,
        content: body,
        category: mapping.category,
      };
    }
  }

  return sections;
}

// ── Storage & manifest ───────────────────────────────────────────────────────

/**
 * Read compiled Full-tier docs + memory, extract sections, build manifest,
 * and store everything in chrome.storage.local under `coopKnowledge`.
 */
async function storeKnowledgeDocs() {
  const data = await new Promise(r =>
    chrome.storage.local.get(['coopProfileFull', 'coopPrefsFull', 'coopMemory'], r)
  );

  const profileSections = extractSections(data.coopProfileFull, 'profile');
  const prefsSections = extractSections(data.coopPrefsFull, 'preferences');

  // Build learnings from memory
  const memEntries = data.coopMemory?.entries || [];
  const learnings = buildLearningsDocument(memEntries);

  // Merge all sections
  const allSections = { ...profileSections, ...prefsSections };

  // Add metadata to each section
  const now = Date.now();
  const sections = {};
  for (const [id, sec] of Object.entries(allSections)) {
    sections[id] = {
      ...sec,
      charCount: sec.content.length,
      tokenEstimate: Math.round(sec.content.length / 4),
      extractedAt: now,
    };
  }

  // Build manifest (lightweight index of what's available)
  const manifest = Object.entries(sections).map(([id, sec]) => ({
    id,
    title: sec.title,
    category: sec.category,
    charCount: sec.charCount,
    tokenEstimate: sec.tokenEstimate,
  }));

  // Add learnings to manifest if non-empty
  if (learnings.content) {
    manifest.push({
      id: 'learnings:compiled',
      title: 'What Coop Has Learned',
      category: 'learnings',
      charCount: learnings.content.length,
      tokenEstimate: Math.round(learnings.content.length / 4),
    });
  }

  const knowledge = { sections, learnings, manifest, version: 1, compiledAt: now };

  chrome.storage.local.set({ coopKnowledge: knowledge }, () => {
    if (chrome.runtime.lastError) {
      console.error('[Knowledge] Save failed:', chrome.runtime.lastError.message);
    } else {
      const totalChars = manifest.reduce((sum, m) => sum + m.charCount, 0);
      const totalTokens = manifest.reduce((sum, m) => sum + m.tokenEstimate, 0);
      console.log(`[Knowledge] Compiled ${manifest.length} docs — ${totalChars.toLocaleString()} chars, ~${totalTokens.toLocaleString()} tokens`);
    }
  });

  return knowledge;
}

// ── Public getters ───────────────────────────────────────────────────────────

/**
 * Get a single knowledge document by section ID.
 * Returns { title, content, category, charCount, tokenEstimate } or null.
 */
export async function getKnowledgeDoc(sectionId) {
  const { coopKnowledge } = await new Promise(r =>
    chrome.storage.local.get(['coopKnowledge'], r)
  );
  if (!coopKnowledge) return null;

  // Handle learnings specially
  if (sectionId === 'learnings:compiled' || sectionId === 'learnings') {
    if (!coopKnowledge.learnings?.content) return null;
    return {
      title: 'What Coop Has Learned',
      content: coopKnowledge.learnings.content,
      category: 'learnings',
      charCount: coopKnowledge.learnings.content.length,
      tokenEstimate: Math.round(coopKnowledge.learnings.content.length / 4),
      entryCount: coopKnowledge.learnings.entryCount || 0,
    };
  }

  return coopKnowledge.sections?.[sectionId] || null;
}

/**
 * Get the knowledge manifest (lightweight index of available docs).
 * Returns [{ id, title, category, charCount, tokenEstimate }].
 */
export async function getKnowledgeManifest() {
  const { coopKnowledge } = await new Promise(r =>
    chrome.storage.local.get(['coopKnowledge'], r)
  );
  return coopKnowledge?.manifest || [];
}

/**
 * Build a compact manifest string listing all available knowledge sections
 * with token estimates. Designed for system prompt embedding (~150 tokens)
 * so the model knows what's available via get_profile_section without
 * loading all content upfront.
 */
export async function buildProfileManifestString() {
  const manifest = await getKnowledgeManifest();
  if (!manifest.length) return '';
  const lines = manifest.map(m => `- ${m.title} [${m.id}] (~${m.tokenEstimate} tok)`);
  return `Available profile/preferences sections (use get_profile_section to load):\n${lines.join('\n')}`;
}

// ── Initialization ───────────────────────────────────────────────────────────

let _knowledgeTimer = null;

function scheduleRecompile() {
  clearTimeout(_knowledgeTimer);
  _knowledgeTimer = setTimeout(() => storeKnowledgeDocs(), 2000); // 2s debounce
}

/**
 * Initialize the knowledge manager. Sets up storage listeners for
 * compiled profile docs and memory changes. Call once at boot after
 * initProfileCompiler().
 */
export function initKnowledge() {
  // Initial compilation (profile-compiler runs first, so docs should exist)
  // Slight delay to ensure profile-compiler has finished its first pass
  setTimeout(() => storeKnowledgeDocs(), 3000);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Re-extract when compiled Full docs change
    if (changes.coopProfileFull || changes.coopPrefsFull) {
      // Don't re-trigger on our own output
      if (!changes.coopKnowledge) {
        scheduleRecompile();
      }
    }

    // Recompile learnings when memory changes
    if (changes.coopMemory && !changes.coopKnowledge) {
      scheduleRecompile();
    }
  });
}
