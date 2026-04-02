// coop.js — Coop agent identity & avatar for CompanyIntel

const COOP = {
  name: 'Coop',
  tagline: 'Your co-operator',

  avatar(size = 36) {
    const id = 'c' + size + Math.random().toString(36).slice(2, 6);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:50%;">
      <circle cx="50" cy="50" r="50" fill="#F0EEEB"/>
      <clipPath id="${id}"><circle cx="50" cy="50" r="48"/></clipPath>
      <g clip-path="url(#${id})">
        <ellipse cx="50" cy="95" rx="42" ry="22" fill="#516F90"/>
        <path d="M34 84 L50 90 L66 84" fill="none" stroke="#3d5468" stroke-width="1" opacity="0.5"/>
        <rect x="42" y="72" width="16" height="14" rx="3" fill="#E8C49A"/>
        <ellipse cx="50" cy="48" rx="24" ry="28" fill="#F5D0A9"/>
        <ellipse cx="26.5" cy="50" rx="3.5" ry="5.5" fill="#E8B888"/>
        <ellipse cx="73.5" cy="50" rx="3.5" ry="5.5" fill="#E8B888"/>
        <path d="M26 42 Q26 22 50 18 Q74 22 74 42 L72 36 Q70 24 50 21 Q30 24 28 36Z" fill="#6B4E37"/>
        <path d="M30 34 Q28 24 36 20 Q40 24 38 32Z" fill="#7D5E48"/>
        <path d="M37 30 Q36 20 44 17 Q47 22 44 28Z" fill="#7D5E48"/>
        <ellipse cx="40" cy="46" rx="5" ry="5.5" fill="white"/>
        <circle cx="41.5" cy="46.5" r="2.8" fill="#3E2723"/>
        <circle cx="42.5" cy="44.5" r="1" fill="white"/>
        <ellipse cx="60" cy="46" rx="5" ry="4" fill="white"/>
        <circle cx="61.5" cy="46" r="2.5" fill="#3E2723"/>
        <circle cx="62.5" cy="44.5" r="0.8" fill="white"/>
        <path d="M34 39 Q40 36 46 38.5" fill="none" stroke="#5D4037" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M54 39 Q60 37 66 39.5" fill="none" stroke="#5D4037" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M49 50 Q50 56 53 55" fill="none" stroke="#E0A87C" stroke-width="0.8" stroke-linecap="round"/>
        <path d="M42 61 Q50 66 58 60" fill="none" stroke="#5D4037" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="34" cy="56" r="4" fill="#E8A090" opacity="0.15"/>
        <circle cx="66" cy="55" r="3.5" fill="#E8A090" opacity="0.12"/>
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
