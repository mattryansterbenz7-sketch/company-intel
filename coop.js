// coop.js — Coop agent identity & avatar for CompanyIntel

const COOP = {
  name: 'Coop',
  tagline: 'Your co-operator',

  avatar(size = 36) {
    const id = 'c' + size + Math.random().toString(36).slice(2, 6);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:50%;">
      <circle cx="50" cy="50" r="50" fill="#E8E5E0"/>
      <clipPath id="${id}"><circle cx="50" cy="50" r="48"/></clipPath>
      <g clip-path="url(#${id})">
        <!-- Shirt: dark blue-gray button-up -->
        <ellipse cx="50" cy="96" rx="42" ry="23" fill="#3D5468"/>
        <path d="M36 84 L50 91 L64 84" fill="none" stroke="#2D4050" stroke-width="1.2"/>
        <line x1="50" y1="91" x2="50" y2="100" stroke="#2D4050" stroke-width="0.8" opacity="0.5"/>
        <!-- Neck -->
        <rect x="43" y="72" width="14" height="13" rx="3" fill="#E8C49A"/>
        <!-- Head: slightly angular jaw -->
        <path d="M26 46 Q26 28 38 22 Q50 18 62 22 Q74 28 74 46 Q74 58 66 66 Q60 72 50 74 Q40 72 34 66 Q26 58 26 46Z" fill="#F5D0A9"/>
        <!-- Ears -->
        <ellipse cx="26" cy="48" rx="3.5" ry="5" fill="#E8B888"/>
        <ellipse cx="74" cy="48" rx="3.5" ry="5" fill="#E8B888"/>
        <!-- Hair: lighter brown, swept up high, voluminous top -->
        <path d="M26 44 Q26 20 50 14 Q74 20 74 44 L72 34 Q70 20 50 17 Q30 20 28 34Z" fill="#8B6B4A"/>
        <path d="M30 30 Q28 18 40 14 Q44 20 40 28Z" fill="#9D7D5A"/>
        <path d="M38 26 Q36 14 48 12 Q52 18 48 24Z" fill="#9D7D5A"/>
        <path d="M46 24 Q44 12 54 11 Q58 16 54 22Z" fill="#8B6B4A"/>
        <!-- Left eye: bright blue -->
        <ellipse cx="40" cy="44" rx="5" ry="5.5" fill="white"/>
        <circle cx="41" cy="44.5" r="2.8" fill="#4A90C4"/>
        <circle cx="40" cy="44" r="1.2" fill="#2E6B9E"/>
        <circle cx="42" cy="43" r="1" fill="white"/>
        <!-- Right eye: bright blue, matching -->
        <ellipse cx="60" cy="44" rx="5" ry="5.5" fill="white"/>
        <circle cx="61" cy="44.5" r="2.8" fill="#4A90C4"/>
        <circle cx="60" cy="44" r="1.2" fill="#2E6B9E"/>
        <circle cx="62" cy="43" r="1" fill="white"/>
        <!-- Eyebrows: natural, slightly raised -->
        <path d="M34 37 Q40 34 46 36.5" fill="none" stroke="#7D6044" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M54 36.5 Q60 34.5 66 37" fill="none" stroke="#7D6044" stroke-width="1.3" stroke-linecap="round"/>
        <!-- Nose -->
        <path d="M49 48 Q50 54 53 53" fill="none" stroke="#DFA87C" stroke-width="0.8" stroke-linecap="round"/>
        <!-- Big open smile showing teeth -->
        <path d="M39 59 Q44 67 50 68 Q56 67 61 59" fill="white" stroke="#5D4037" stroke-width="1" stroke-linecap="round"/>
        <path d="M39 59 Q50 62 61 59" fill="none" stroke="#5D4037" stroke-width="0.8"/>
        <!-- Smile lines -->
        <path d="M36 56 Q35 60 37 63" fill="none" stroke="#E0A87C" stroke-width="0.5" stroke-linecap="round" opacity="0.4"/>
        <path d="M64 56 Q65 60 63 63" fill="none" stroke="#E0A87C" stroke-width="0.5" stroke-linecap="round" opacity="0.4"/>
        <!-- Cheek highlights -->
        <circle cx="33" cy="54" r="4" fill="#E8A090" opacity="0.12"/>
        <circle cx="67" cy="54" r="4" fill="#E8A090" opacity="0.12"/>
      </g>
    </svg>`;
  },

  badge(size = 24) { return this.avatar(size); },

  headerHTML(modelLabel) {
    return `${this.avatar(28)} <span style="font-weight:800;color:#FF7A59;">Coop</span>`;
  },

  emptyStateHTML(context = 'company') {
    const prompts = {
      company: 'Ask about this company, role, or get help applying.',
      global: 'Ask me anything about your pipeline, prep for interviews, or strategize your search.',
      meeting: 'Ask about this meeting — attendees, takeaways, or follow-ups.',
    };
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px 16px;text-align:center;">
      ${this.avatar(56)}
      <div style="font-size:15px;font-weight:700;color:#2D2D2D;">Hey, I'm Coop</div>
      <div style="font-size:13px;color:#8B8680;line-height:1.5;max-width:260px;">${prompts[context] || prompts.company}</div>
    </div>`;
  },

  thinkingHTML() {
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      ${this.avatar(22)}
      <span style="color:#8B8680;font-size:13px;font-style:italic;">Coop is thinking...</span>
    </div>`;
  },

  messagePrefixHTML() {
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
      ${this.avatar(20)}
      <span style="font-size:11px;font-weight:700;color:#FF7A59;">Coop</span>
    </div>`;
  }
};

if (typeof window !== 'undefined') window.COOP = COOP;
if (typeof globalThis !== 'undefined') globalThis.COOP = COOP;
