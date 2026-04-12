// coop.js — Coop agent identity & avatar for Coop.ai

const COOP = {
  name: 'Coop',
  tagline: 'Your co-operator',

  avatar(size = 36) {
    const id = 'c' + size + Math.random().toString(36).slice(2, 6);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:50%;">
      <circle cx="50" cy="50" r="50" fill="#3B5068"/>
      <clipPath id="${id}"><circle cx="50" cy="50" r="48"/></clipPath>
      <g clip-path="url(#${id})">
        <!-- Shoulders & suit jacket -->
        <ellipse cx="50" cy="100" rx="48" ry="28" fill="#3D4F5F"/>
        <ellipse cx="50" cy="100" rx="46" ry="26" fill="#435766"/>
        <!-- Shoulder seams -->
        <path d="M18 96 Q28 84 38 80" fill="none" stroke="#364854" stroke-width="0.5"/>
        <path d="M82 96 Q72 84 62 80" fill="none" stroke="#364854" stroke-width="0.5"/>
        <!-- Lapels — wider, more defined -->
        <path d="M26 100 L40 77 L50 88 L60 77 L74 100" fill="#364854"/>
        <path d="M40 77 L50 88" stroke="#2C3E4E" stroke-width="0.8" fill="none"/>
        <path d="M60 77 L50 88" stroke="#2C3E4E" stroke-width="0.8" fill="none"/>
        <!-- Lapel fold shadow -->
        <path d="M40 77 L38 80 L50 90 L50 88Z" fill="#3A4E5E" opacity="0.5"/>
        <path d="M60 77 L62 80 L50 90 L50 88Z" fill="#3A4E5E" opacity="0.5"/>
        <!-- Dress shirt -->
        <path d="M40 77 L50 94 L60 77" fill="#F0EAE0"/>
        <path d="M43 80 L50 90 L57 80" fill="#E8E2D8" opacity="0.4"/>
        <!-- Collar points -->
        <path d="M40 77 L43 75 L44 78Z" fill="#F0EAE0"/>
        <path d="M60 77 L57 75 L56 78Z" fill="#F0EAE0"/>
        <!-- Bow tie — bigger, more shaped -->
        <path d="M41 78 Q44 73 50 76 Q44 79 41 78Z" fill="#3D4F5F"/>
        <path d="M59 78 Q56 73 50 76 Q56 79 59 78Z" fill="#3D4F5F"/>
        <path d="M41 78 Q44 74 50 76" fill="none" stroke="#2C3E4E" stroke-width="0.4"/>
        <path d="M59 78 Q56 74 50 76" fill="none" stroke="#2C3E4E" stroke-width="0.4"/>
        <!-- Bow tie folds -->
        <path d="M43 76 Q44 75 45 76" fill="none" stroke="#2C3E4E" stroke-width="0.3"/>
        <path d="M55 76 Q56 75 57 76" fill="none" stroke="#2C3E4E" stroke-width="0.3"/>
        <ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/>
        <ellipse cx="50" cy="76.5" rx="1.2" ry="1" fill="#2C3E4E"/>
        <!-- Neck — wider, masculine -->
        <rect x="42" y="70" width="16" height="9" rx="2" fill="#E8C4A0"/>
        <path d="M43 70 L43 75" stroke="#D4A878" stroke-width="0.3" opacity="0.4"/>
        <path d="M57 70 L57 75" stroke="#D4A878" stroke-width="0.3" opacity="0.4"/>
        <!-- Head — square jaw, strong chin -->
        <path d="M28 43 Q28 27 39 21 Q50 16 61 21 Q72 27 72 43 Q72 53 68 58 L63 64 L56 68 L50 70 L44 68 L37 64 Q32 58 28 53 Q28 48 28 43Z" fill="#EDBB92"/>
        <!-- Jaw shadow — angular, defined -->
        <path d="M37 64 L44 68 L50 70 L56 68 L63 64" fill="none" stroke="#B8865E" stroke-width="1" opacity="0.5"/>
        <path d="M68 58 L63 64" fill="none" stroke="#C8966E" stroke-width="0.6" opacity="0.4"/>
        <path d="M32 58 L37 64" fill="none" stroke="#C8966E" stroke-width="0.6" opacity="0.4"/>
        <!-- Cheekbone highlights — high, angular -->
        <ellipse cx="35" cy="49" rx="4.5" ry="2" fill="#F2C9A2" opacity="0.6"/>
        <ellipse cx="65" cy="49" rx="4.5" ry="2" fill="#F2C9A2" opacity="0.6"/>
        <!-- Cheek hollow below cheekbone -->
        <path d="M34 52 Q37 54 39 56" fill="none" stroke="#D4A070" stroke-width="0.4" opacity="0.25"/>
        <path d="M66 52 Q63 54 61 56" fill="none" stroke="#D4A070" stroke-width="0.4" opacity="0.25"/>
        <!-- Ears -->
        <ellipse cx="28" cy="44" rx="3" ry="4.5" fill="#DFB088"/>
        <path d="M27 42 Q26 44 27 46" fill="none" stroke="#C8966E" stroke-width="0.4"/>
        <ellipse cx="72" cy="44" rx="3" ry="4.5" fill="#DFB088"/>
        <path d="M73 42 Q74 44 73 46" fill="none" stroke="#C8966E" stroke-width="0.4"/>
        <!-- Hair: near-black, slicked back, detailed strands -->
        <path d="M27 40 Q27 15 50 10 Q73 15 73 40 L71 32 Q69 16 50 13 Q31 16 29 32Z" fill="#2D1F16"/>
        <!-- Side taper — tight -->
        <path d="M27 40 Q27 25 36 18 L34 21 Q29 27 28 38Z" fill="#1E1410"/>
        <path d="M73 40 Q73 25 64 18 L66 21 Q71 27 72 38Z" fill="#1E1410"/>
        <!-- Top volume mass -->
        <path d="M29 31 Q30 13 50 10 Q70 13 71 31 Q69 17 50 13 Q31 17 29 31Z" fill="#3D2A1E"/>
        <!-- Hair part — defined line -->
        <path d="M37 19 Q44 11 56 11 Q64 13 68 19" fill="none" stroke="#1E1410" stroke-width="1.2" opacity="0.7"/>
        <!-- Hair wave/strands -->
        <path d="M33 23 Q38 13 50 11 Q58 11 63 15" fill="#3D2A1E" opacity="0.8"/>
        <path d="M35 26 Q40 16 50 12 Q55 12 58 14" fill="#4A3728" opacity="0.5"/>
        <path d="M38 20 Q42 14 48 12" fill="none" stroke="#4A3728" stroke-width="0.6" opacity="0.5"/>
        <path d="M42 18 Q48 12 56 12" fill="none" stroke="#4A3728" stroke-width="0.5" opacity="0.4"/>
        <path d="M55 14 Q60 14 65 18" fill="none" stroke="#2D1F16" stroke-width="0.5" opacity="0.4"/>
        <!-- Sideburn hint -->
        <path d="M30 38 L30 44" stroke="#2D1F16" stroke-width="1.2" opacity="0.4" stroke-linecap="round"/>
        <path d="M70 38 L70 44" stroke="#2D1F16" stroke-width="1.2" opacity="0.4" stroke-linecap="round"/>
        <!-- Forehead lines -->
        <path d="M39 30 Q45 29 51 30" fill="none" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
        <path d="M40 33 Q46 32 52 33" fill="none" stroke="#D4A070" stroke-width="0.25" opacity="0.25"/>
        <!-- Eyes — detailed, green/hazel -->
        <ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/>
        <ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/>
        <!-- Iris with depth -->
        <circle cx="41.5" cy="44.2" r="3" fill="#5B8C3E"/>
        <circle cx="41.5" cy="44.2" r="2.2" fill="#4A7A30"/>
        <circle cx="41.2" cy="43.8" r="1.2" fill="#3A6B28"/>
        <circle cx="42.2" cy="43" r="0.8" fill="white" opacity="0.7"/>
        <circle cx="59.5" cy="44.2" r="3" fill="#5B8C3E"/>
        <circle cx="59.5" cy="44.2" r="2.2" fill="#4A7A30"/>
        <circle cx="59.2" cy="43.8" r="1.2" fill="#3A6B28"/>
        <circle cx="60.2" cy="43" r="0.8" fill="white" opacity="0.7"/>
        <!-- Upper eyelids -->
        <path d="M36 42 Q41 39.5 46 42" fill="#EDBB92" opacity="0.5"/>
        <path d="M54 42 Q59 39.5 64 42" fill="#EDBB92" opacity="0.5"/>
        <!-- Lower lid line -->
        <path d="M37 46.5 Q41 48 45 46.5" fill="none" stroke="#C8966E" stroke-width="0.5" opacity="0.5"/>
        <path d="M55 46.5 Q59 48 63 46.5" fill="none" stroke="#C8966E" stroke-width="0.5" opacity="0.5"/>
        <!-- Crow's feet -->
        <path d="M34 43 L32.5 41.5" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
        <path d="M34 44.5 L32.5 45" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
        <path d="M66 43 L67.5 41.5" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
        <path d="M66 44.5 L67.5 45" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
        <!-- Eyebrows — bold, sharp -->
        <path d="M35 36.5 Q38 34 41 34 Q44 34 47 36" fill="#2D1F16" opacity="0.9"/>
        <path d="M53 36 Q56 34 59 34 Q62 34 65 36.5" fill="#2D1F16" opacity="0.9"/>
        <!-- Brow bone shadow -->
        <path d="M36 38 Q41 36.5 46 38" fill="none" stroke="#C8966E" stroke-width="0.3" opacity="0.3"/>
        <path d="M54 38 Q59 36.5 64 38" fill="none" stroke="#C8966E" stroke-width="0.3" opacity="0.3"/>
        <!-- Nose — wider bridge, strong, masculine -->
        <path d="M50 38 L49 50" fill="none" stroke="#C8966E" stroke-width="0.7" opacity="0.5"/>
        <path d="M46.5 53 Q48 55.5 50 56 Q52 55.5 53.5 53" fill="none" stroke="#B8865E" stroke-width="0.9" stroke-linecap="round"/>
        <path d="M46.5 53 Q47.5 51.5 49 53" fill="none" stroke="#B8865E" stroke-width="0.5" opacity="0.6"/>
        <path d="M51 53 Q52.5 51.5 53.5 53" fill="none" stroke="#B8865E" stroke-width="0.5" opacity="0.6"/>
        <!-- Nasolabial folds — deeper, following squarer jaw -->
        <path d="M37 52 Q38 56 39 59" fill="none" stroke="#C8966E" stroke-width="0.5" opacity="0.5"/>
        <path d="M63 52 Q62 56 61 59" fill="none" stroke="#C8966E" stroke-width="0.5" opacity="0.5"/>
        <!-- Mouth — confident closed smile, wider -->
        <path d="M41 59 Q46 56.5 50 56.5 Q54 56.5 59 59" fill="#D4947A" opacity="0.25"/>
        <path d="M41 59 Q46 62 50 62.5 Q54 62 59 59" fill="#D4947A" opacity="0.35"/>
        <path d="M41 59 Q46 62 50 62.5 Q54 62 59 59" fill="none" stroke="#9B7055" stroke-width="0.8" stroke-linecap="round"/>
        <path d="M41 59 Q50 57 59 59" fill="none" stroke="#9B7055" stroke-width="0.6"/>
        <!-- Smirk — right side lifts -->
        <path d="M59 58.5 Q61 57 62 57.5" fill="none" stroke="#9B7055" stroke-width="0.6" stroke-linecap="round"/>
        <!-- Chin — strong, square, with cleft hint -->
        <path d="M44 66 L44 68 L50 70 L56 68 L56 66" fill="none" stroke="#C8966E" stroke-width="0.4" opacity="0.35"/>
        <path d="M49 68 L49 69.5" fill="none" stroke="#C8966E" stroke-width="0.4" opacity="0.25"/>
        <path d="M51 68 L51 69.5" fill="none" stroke="#C8966E" stroke-width="0.4" opacity="0.25"/>
        <!-- Stubble — five o'clock shadow -->
        <circle cx="43" cy="64" r="0.3" fill="#B89878" opacity="0.2"/>
        <circle cx="46" cy="65" r="0.3" fill="#B89878" opacity="0.2"/>
        <circle cx="50" cy="66" r="0.3" fill="#B89878" opacity="0.2"/>
        <circle cx="54" cy="65" r="0.3" fill="#B89878" opacity="0.2"/>
        <circle cx="57" cy="64" r="0.3" fill="#B89878" opacity="0.2"/>
        <circle cx="44" cy="62" r="0.25" fill="#B89878" opacity="0.15"/>
        <circle cx="56" cy="62" r="0.25" fill="#B89878" opacity="0.15"/>
        <circle cx="40" cy="62" r="0.25" fill="#B89878" opacity="0.15"/>
        <circle cx="60" cy="62" r="0.25" fill="#B89878" opacity="0.15"/>
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

  thinkingAvatar(size = 36) {
    const id = 'ct' + size + Math.random().toString(36).slice(2, 6);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:50%;">
      <circle cx="50" cy="50" r="50" fill="#3B5068"/>
      <clipPath id="${id}"><circle cx="50" cy="50" r="48"/></clipPath>
      <g clip-path="url(#${id})">
        <!-- Suit jacket -->
        <ellipse cx="50" cy="100" rx="48" ry="28" fill="#3D4F5F"/>
        <ellipse cx="50" cy="100" rx="46" ry="26" fill="#435766"/>
        <path d="M26 100 L40 77 L50 88 L60 77 L74 100" fill="#364854"/>
        <path d="M40 77 L50 88" stroke="#2C3E4E" stroke-width="0.8" fill="none"/>
        <path d="M60 77 L50 88" stroke="#2C3E4E" stroke-width="0.8" fill="none"/>
        <!-- Shirt + collar -->
        <path d="M40 77 L50 94 L60 77" fill="#F0EAE0"/>
        <path d="M40 77 L43 75 L44 78Z" fill="#F0EAE0"/>
        <path d="M60 77 L57 75 L56 78Z" fill="#F0EAE0"/>
        <!-- Bow tie -->
        <path d="M41 78 Q44 73 50 76 Q44 79 41 78Z" fill="#3D4F5F"/>
        <path d="M59 78 Q56 73 50 76 Q56 79 59 78Z" fill="#3D4F5F"/>
        <ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/>
        <ellipse cx="50" cy="76.5" rx="1.2" ry="1" fill="#2C3E4E"/>
        <!-- Neck — wider -->
        <rect x="42" y="70" width="16" height="9" rx="2" fill="#E8C4A0"/>
        <!-- Head — square jaw -->
        <path d="M28 43 Q28 27 39 21 Q50 16 61 21 Q72 27 72 43 Q72 53 68 58 L63 64 L56 68 L50 70 L44 68 L37 64 Q32 58 28 53 Q28 48 28 43Z" fill="#EDBB92"/>
        <path d="M37 64 L44 68 L50 70 L56 68 L63 64" fill="none" stroke="#B8865E" stroke-width="0.8" opacity="0.45"/>
        <!-- Ears -->
        <ellipse cx="28" cy="44" rx="3" ry="4.5" fill="#DFB088"/>
        <ellipse cx="72" cy="44" rx="3" ry="4.5" fill="#DFB088"/>
        <!-- Hair -->
        <path d="M27 40 Q27 15 50 10 Q73 15 73 40 L71 32 Q69 16 50 13 Q31 16 29 32Z" fill="#2D1F16"/>
        <path d="M27 40 Q27 25 36 18 L34 21 Q29 27 28 38Z" fill="#1E1410"/>
        <path d="M73 40 Q73 25 64 18 L66 21 Q71 27 72 38Z" fill="#1E1410"/>
        <path d="M29 31 Q30 13 50 10 Q70 13 71 31 Q69 17 50 13 Q31 17 29 31Z" fill="#3D2A1E"/>
        <path d="M33 23 Q38 13 50 11 Q58 11 63 15" fill="#3D2A1E" opacity="0.8"/>
        <!-- Eyes — green/hazel, looking up-left (thinking) -->
        <ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/>
        <ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/>
        <circle cx="40" cy="42.5" r="3" fill="#5B8C3E"/>
        <circle cx="40" cy="42.5" r="2.2" fill="#4A7A30"/>
        <circle cx="40.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/>
        <circle cx="58" cy="42.5" r="3" fill="#5B8C3E"/>
        <circle cx="58" cy="42.5" r="2.2" fill="#4A7A30"/>
        <circle cx="58.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/>
        <!-- Upper eyelids (slightly more closed) -->
        <path d="M36 42.5 Q41 40 46 42.5" fill="#EDBB92" opacity="0.5"/>
        <path d="M54 42.5 Q59 40 64 42.5" fill="#EDBB92" opacity="0.5"/>
        <!-- Eyebrows — right raised (thinking) -->
        <path d="M35 37 Q38 35 41 35 Q44 35 47 37" fill="#2D1F16" opacity="0.9"/>
        <path d="M53 35.5 Q56 33 59 33 Q62 33 65 35.5" fill="#2D1F16" opacity="0.9"/>
        <!-- Nose -->
        <path d="M47 53 Q48 55 50 55.5 Q52 55 53 53" fill="none" stroke="#C8966E" stroke-width="0.7" stroke-linecap="round"/>
        <!-- Mouth — thoughtful closed -->
        <path d="M43 60 Q47 62 50 62 Q53 62 57 60" fill="none" stroke="#9B7055" stroke-width="1" stroke-linecap="round"/>
        <!-- Arm from shoulder to chin -->
        <path d="M65 84 Q72 76 69 68 Q67 63 62 62" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/>
        <path d="M65 84 Q68 80 69 76" fill="none" stroke="#364854" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/>
        <!-- Hand on chin -->
        <path d="M48 66 Q50 62 56 61 Q62 62 63 66 Q62 69 58 70 Q52 71 49 68Z" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/>
      </g>
    </svg>`;
  },

  thinkingHTML() {
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      ${this.thinkingAvatar(22)}
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

// Legacy global assignment for non-module contexts (content scripts, HTML pages)
if (typeof window !== 'undefined') window.COOP = COOP;
if (typeof globalThis !== 'undefined') globalThis.COOP = COOP;
