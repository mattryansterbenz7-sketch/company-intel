// coop.js — Coop agent identity & avatar for Coop.ai

const COOP = {
  name: 'Coop',
  tagline: 'Your co-operator',

  avatar(size = 36) {
    const id = 'c' + size + Math.random().toString(36).slice(2, 6);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:50%;">
      <circle cx="50" cy="50" r="50" fill="#E8E5E0"/>
      <clipPath id="${id}"><circle cx="50" cy="50" r="48"/></clipPath>
      <g clip-path="url(#${id})">
        <!-- Shirt: dark slate button-up -->
        <ellipse cx="50" cy="96" rx="42" ry="23" fill="#3D5468"/>
        <path d="M38 85 L50 91 L62 85" fill="none" stroke="#2D4050" stroke-width="1"/>
        <line x1="50" y1="91" x2="50" y2="100" stroke="#2D4050" stroke-width="0.6" opacity="0.4"/>
        <!-- Neck -->
        <rect x="43" y="73" width="14" height="12" rx="3" fill="#E5BF9A"/>
        <!-- Head: clean angular jaw -->
        <path d="M28 45 Q28 30 38 24 Q50 20 62 24 Q72 30 72 45 Q72 56 65 64 Q59 70 50 72 Q41 70 35 64 Q28 56 28 45Z" fill="#F0CDA0"/>
        <!-- Ears -->
        <ellipse cx="28" cy="46" rx="3" ry="4.5" fill="#E5B888"/>
        <ellipse cx="72" cy="46" rx="3" ry="4.5" fill="#E5B888"/>
        <!-- Hair: full coverage, short sides, styled top -->
        <!-- Main hair mass covering top and sides of head -->
        <path d="M27 42 Q27 20 50 14 Q73 20 73 42 L71 36 Q69 20 50 17 Q31 20 29 36Z" fill="#7A5C3A"/>
        <!-- Side coverage: visible short hair on sides -->
        <path d="M27 42 Q27 28 35 22 L33 24 Q29 30 28 40Z" fill="#6B4E30"/>
        <path d="M73 42 Q73 28 65 22 L67 24 Q71 30 72 40Z" fill="#6B4E30"/>
        <!-- Top volume: styled, natural -->
        <path d="M31 34 Q31 18 50 14 Q69 18 69 34 Q68 22 50 17 Q32 22 31 34Z" fill="#8B6B4A"/>
        <!-- Hair texture on top -->
        <path d="M36 26 Q38 18 44 15 Q46 20 44 26Z" fill="#96784E" opacity="0.7"/>
        <path d="M44 22 Q48 14 54 14 Q56 18 52 22Z" fill="#96784E" opacity="0.6"/>
        <path d="M52 24 Q56 16 62 18 Q60 22 56 24Z" fill="#8B6B4A" opacity="0.5"/>
        <!-- Eyes: blue, proportional, natural -->
        <ellipse cx="41" cy="44" rx="4.5" ry="4.5" fill="white"/>
        <circle cx="41.5" cy="44.5" r="2.5" fill="#4A8DB8"/>
        <circle cx="41" cy="44" r="1" fill="#2B6A8E"/>
        <circle cx="42.5" cy="43" r="0.8" fill="white" opacity="0.8"/>
        <ellipse cx="59" cy="44" rx="4.5" ry="4.5" fill="white"/>
        <circle cx="59.5" cy="44.5" r="2.5" fill="#4A8DB8"/>
        <circle cx="59" cy="44" r="1" fill="#2B6A8E"/>
        <circle cx="60.5" cy="43" r="0.8" fill="white" opacity="0.8"/>
        <!-- Eyebrows: clean, natural -->
        <path d="M35 38 Q41 36 47 37.5" fill="none" stroke="#7A6040" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M53 37.5 Q59 36 65 38" fill="none" stroke="#7A6040" stroke-width="1.2" stroke-linecap="round"/>
        <!-- Nose: subtle -->
        <path d="M49.5 48 Q50 53 52.5 52" fill="none" stroke="#D9A07A" stroke-width="0.7" stroke-linecap="round"/>
        <!-- Smile: open, natural, showing teeth -->
        <path d="M40 58 Q45 65 50 66 Q55 65 60 58" fill="white" stroke="#8B6B4A" stroke-width="0.8"/>
        <path d="M40 58 Q50 61 60 58" fill="none" stroke="#8B6B4A" stroke-width="0.6"/>
        <!-- Subtle laugh lines -->
        <path d="M37 55 Q36 58 37.5 61" fill="none" stroke="#D9A07A" stroke-width="0.4" opacity="0.3"/>
        <path d="M63 55 Q64 58 62.5 61" fill="none" stroke="#D9A07A" stroke-width="0.4" opacity="0.3"/>
      </g>
    </svg>`;
  },

  badge(size = 24) { return this.avatar(size); },

  headerHTML(modelLabel) {
    return `${this.avatar(22)} <span style="font-weight:800;color:#FF7A59;">Coop</span>`;
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
