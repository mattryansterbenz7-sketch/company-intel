// coop.js — Coop agent identity & avatar for Coop.ai

const COOP = {
  name: 'Coop',
  tagline: 'Your co-operator',

  // Inline monogram SVG — always safe fallback, used for <32px and as
  // graceful fallback when the illustrated portrait PNG is absent.
  _monogramSVG(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:50%;">
      <circle cx="50" cy="50" r="50" fill="#151B26"/>
      <text x="50" y="50" text-anchor="middle" dominant-baseline="central"
            font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="56" font-weight="700" fill="#F5F4F2"
            letter-spacing="-0.02em">C</text>
      <rect x="44" y="72" width="12" height="3" rx="1.5" fill="#FC636B"/>
    </svg>`;
  },

  avatar(size = 36) {
    // Monogram for small sizes — illustration detail collapses below 48px.
    if (size < 48) return this._monogramSVG(size);

    // Illustrated portrait for ≥48px. Falls back to the monogram if the PNG
    // asset isn't on disk yet (icons/ may not be populated until Matt drops
    // in the AI-generated portrait per #237 Phase A).
    const src = size >= 96 ? 'icons/coop-portrait-512.png'
              : size >= 64 ? 'icons/coop-portrait-256.png'
              : 'icons/coop-portrait-128.png';
    const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL(src)
      : src;
    // Fallback: if the PNG is absent (assets not yet dropped in), re-render
    // the element with the monogram SVG as a data URL. encodeURIComponent
    // handles every quote/special char in the SVG cleanly.
    const fallbackDataUrl = ('data:image/svg+xml;utf8,' + encodeURIComponent(this._monogramSVG(size))).replace(/'/g, '%27');
    return `<img src="${url}" width="${size}" height="${size}" alt="Coop"
      class="coop-portrait"
      style="flex-shrink:0;border-radius:50%;object-fit:cover;background:#1F3542;"
      onerror="this.onerror=null;this.src='${fallbackDataUrl}';this.style.background='transparent';">`;
  },

  badge(size = 24) { return this.avatar(size); },

  headerHTML(modelLabel) {
    return `${this.avatar(22)} <span style="font-weight:800;color:#FF7A59;">Coop</span>`;
  },

  emptyStateHTML(context = 'company') {
    // No italic greeting, no "Hey, I'm Coop" — DESIGN.md compliance.
    // Sentence-case question, 15px/600, no sub-copy.
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 16px 16px;text-align:center;">
      <div style="font-size:15px;font-weight:600;color:var(--ci-text-primary,#0A0B0D);letter-spacing:-0.01em;">What should we figure out?</div>
    </div>`;
  },

  // The canonical portrait carries the thinking energy — no separate pose asset.
  // "Thinking..." state is conveyed by surrounding UI affordance (pulsing dot, label).
  thinkingAvatar(size = 36) { return this.avatar(size); },

  thinkingHTML() {
    // Non-italic, non-bouncing-dots indicator. Streaming will replace this once wired up.
    // Uses a pulsing streaming-caret as the only motion signal — DESIGN.md: narrative > spinners.
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
      <span style="font-size:13px;color:var(--ci-text-tertiary,#8A8E94);">Coop</span><span class="streaming-caret" style="display:inline-block;width:2px;height:14px;background:var(--ci-text-primary,#0A0B0D);border-radius:1px;margin-left:2px;animation:streamingCaretBlink 1.1s ease-in-out infinite;"></span>
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
