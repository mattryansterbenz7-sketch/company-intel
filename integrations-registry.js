// integrations-registry.js
// Single source of truth for integration tiers, groups, and metadata.
// Loaded as a plain <script> before integrations.js.
//
// Tier values: 'required' | 'recommended' | 'deprecated'
// Group values map to gate logic in checkIntegrationGate().

const INTEGRATION_REGISTRY = [
  // ── Required: AI ──
  {
    id: 'anthropic',
    tier: 'required',
    group: 'ai',
    name: 'Anthropic (Claude)',
    logoText: 'A',
    logoClass: 'anthropic',
    description: 'Coop uses Claude for research synthesis, opportunity scoring, chat, and passive memory extraction. This is the one key Coop can\'t run without.',
    storageKey: 'anthropic_key',
    placeholder: 'sk-ant-api03-...',
    docsUrl: 'https://console.anthropic.com/',
    costHint: 'Usage-based · typically <$5/mo for personal use',
  },
  {
    id: 'openai',
    tier: 'required',
    group: 'ai',
    name: 'OpenAI',
    logoText: 'AI',
    logoClass: 'openai',
    description: 'GPT-4.1 mini is the default chat model and the first fallback when Claude rate-limits. Skipping this works but chat can fail during spikes.',
    storageKey: 'openai_key',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    costHint: 'Usage-based · typically <$2/mo for personal use',
  },

  // ── Required: Web Search ──
  {
    id: 'serper',
    tier: 'required',
    group: 'web_search',
    name: 'Serper',
    logoText: 'S',
    logoClass: 'serper',
    description: 'Runs the four parallel Google searches (reviews, leadership, job listings, product overview) that feed Claude\'s company synthesis. Without this, research falls back to a thinner model-only summary.',
    storageKey: 'serper_key',
    placeholder: 'Your Serper API key',
    docsUrl: 'https://serper.dev/',
    costHint: '2,500 free searches · then $0.30/1k',
  },

  // ── Required: Email ──
  {
    id: 'gmail',
    tier: 'required',
    group: 'email',
    name: 'Gmail',
    logoText: 'M',
    logoClass: 'gmail',
    description: 'Pulls email threads by company domain so conversations surface on the company page and in Coop\'s chat context. Nothing leaves your browser.',
    oauth: true,
    costHint: 'OAuth via Chrome · no key required',
    scopes: ['Read email metadata', 'Read email contents', 'Read-only · never send'],
  },

  // ── Required: Calendar ──
  {
    id: 'gcal',
    tier: 'required',
    group: 'calendar',
    name: 'Google Calendar',
    logoText: 'C',
    logoClass: 'calendar',
    description: 'Matches calendar events to saved companies by attendee domain — interview prep surfaces the right meetings automatically.',
    oauth: true,
    oauthSharedWith: 'gmail',
    costHint: 'OAuth via Chrome · no key required',
    scopes: ['Read calendar events', 'Read attendee emails', 'Read-only · never modify'],
  },

  // ── Recommended: Meetings ──
  {
    id: 'granola',
    tier: 'recommended',
    group: 'meetings',
    name: 'Granola',
    logoText: 'G',
    logoClass: 'granola',
    description: 'Surfaces Granola meeting notes and transcripts on the matching company\'s page. Coop indexes on a schedule and rate-limits requests so it stays inside free-tier limits.',
    storageKey: 'granola_key',
    placeholder: 'gran-...',
    docsUrl: 'https://granola.ai/settings',
    costHint: 'Included with your Granola plan',
  },

  // ── Deprecated: Research ──
  {
    id: 'apollo',
    tier: 'deprecated',
    group: 'research',
    name: 'Apollo.io',
    logoText: 'A',
    logoClass: 'apollo',
    description: 'Previously used for firmographic enrichment (employees, funding, industry). Coop\'s free Apollo credits exhausted early in the project; the research pipeline now hits Serper → Claude directly and produces comparable output.',
    storageKey: 'apollo_key',
    placeholder: 'Paste an Apollo key if you want to try it',
    docsUrl: 'https://app.apollo.io/',
    costHint: 'Paid plans start at $59/mo',
    deprecationNote: 'Coop\'s enrichment chain already handles firmographics via Serper + Claude. Setting a key here will let Apollo run first, but most data will match what you\'d get without it.',
  },
];

// ── Required groups and their gate semantics ──
// Each entry is { group, label } — gate is satisfied when at least one member in that group has a value.
const REQUIRED_GROUPS = [
  { group: 'ai',         label: 'AI model · choose Anthropic or OpenAI (or both)' },
  { group: 'web_search', label: 'Web search · needed for research synthesis' },
  { group: 'email',      label: 'Email · Gmail OAuth' },
  { group: 'calendar',   label: 'Calendar · Google Calendar OAuth' },
];

/**
 * Determines which required groups are satisfied given the current set of configured keys/connections.
 *
 * @param {Object} configuredKeys  Flat map of { providerId: boolean } indicating what's connected.
 *   Use provider `id` values as keys, not storage keys.
 *   e.g. { anthropic: true, serper: true, gmail: true, gcal: false, granola: false }
 *
 * @returns {{ satisfied: boolean, missingGroups: string[], recommendedMissing: string[] }}
 */
function checkIntegrationGate(configuredKeys) {
  const keys = configuredKeys || {};

  // For each required group, check if at least one member is configured.
  const missingGroups = [];
  for (const { group } of REQUIRED_GROUPS) {
    const members = INTEGRATION_REGISTRY.filter(p => p.tier === 'required' && p.group === group);
    const anySatisfied = members.some(p => !!keys[p.id]);
    if (!anySatisfied) missingGroups.push(group);
  }

  // Recommended items that are not configured.
  const recommendedMissing = INTEGRATION_REGISTRY
    .filter(p => p.tier === 'recommended' && !keys[p.id])
    .map(p => p.id);

  return {
    satisfied: missingGroups.length === 0,
    missingGroups,
    recommendedMissing,
  };
}
