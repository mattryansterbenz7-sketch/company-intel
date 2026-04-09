// ═══════════════════════════════════════════════════════════════════════════
// Coop Assist — ambient writing assistant (Phase 1 MVP)
// Watches focused text fields, runs local heuristics against the user's voice
// profile, surfaces suggestions via a floating pill. Zero LLM calls in v1.
// See PRD Section L for full vision.
// ═══════════════════════════════════════════════════════════════════════════
(() => {
  if (window.__coopAssistLoaded) return;
  window.__coopAssistLoaded = true;
  console.log('[CoopAssist] loaded on', location.hostname);

  // ── Config (loaded async, sensible defaults until ready) ─────────────────
  const DEFAULT_BLOCKLIST = [
    /\.bank\./i, /banking/i, /chase\.com/i, /wellsfargo/i, /capitalone/i,
    /healthcare\.gov|mychart|patient-portal/i, /\.gov\b/i, /irs\.gov/i, /paypal\.com/i,
    /stripe\.com\/dashboard/i, /login\.microsoftonline\.com/i,
    /\/login\b|\/signin\b|accounts\.google\.com/i,
    /\b(password|auth|oauth|authorize)\b/i,
  ];
  let cfg = {
    enabled: true,
    paused: false,
    pauseUntil: 0,
  };
  let voiceProfile = {
    antiPhrases: [
      'i hope this email finds you well',
      'i hope this finds you well',
      'i wanted to reach out',
      'i wanted to touch base',
      'just wanted to follow up',
      'circle back',
      'per my last email',
      'as per',
      'kindly',
      'utilize',
      'leverage', // unless tech context — soft flag
      'in conclusion',
      'furthermore',
      'moreover',
      'to whom it may concern',
      'dear sir or madam',
    ],
    preferredSignoffs: [],
    avoidExclamations: true, // 0–1 ok, 2+ flags
    maxExclamations: 1,
  };

  // ── Config loader ────────────────────────────────────────────────────────
  try {
    chrome.storage?.local?.get?.(['coopAssistantConfig', 'voiceProfile'], d => {
      if (d?.coopAssistantConfig) {
        cfg = { ...cfg, ...d.coopAssistantConfig };
        // One-time cleanup: pause feature was removed
        if (cfg.paused || cfg.pauseUntil) {
          delete cfg.paused; delete cfg.pauseUntil;
          try { chrome.storage.local.set({ coopAssistantConfig: cfg }); } catch(e) {}
        }
      }
      if (d?.voiceProfile) voiceProfile = { ...voiceProfile, ...d.voiceProfile };
    });
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'local') return;
      if (changes.coopAssistantConfig?.newValue) cfg = { ...cfg, ...changes.coopAssistantConfig.newValue };
      if (changes.voiceProfile?.newValue) voiceProfile = { ...voiceProfile, ...changes.voiceProfile.newValue };
    });
  } catch(e) { /* not in extension context */ }

  // ── Page-level gating ────────────────────────────────────────────────────
  function isBlockedDomain() {
    const host = location.hostname || '';
    const url = location.href || '';
    return DEFAULT_BLOCKLIST.some(rx => rx.test(host) || rx.test(url));
  }
  function isActive() {
    if (!cfg.enabled || isBlockedDomain()) return false;
    return true;
  }

  // ── Field eligibility ────────────────────────────────────────────────────
  function isWritingField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (['text','email','search'].indexOf(t) === -1) return false;
      if (t === 'search') return false;
      // skip search-y inputs
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'searchbox' || role === 'search') return false;
      const name = ((el.name || '') + ' ' + (el.placeholder || '') + ' ' + (el.id || '')).toLowerCase();
      if (/search|query|find/.test(name)) return false;
      return true;
    }
    if (el.isContentEditable) return true;
    return false;
  }
  function getText(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value || '';
    return el.innerText || '';
  }
  // Preserves quoted replies / signatures inside Gmail-style contenteditables.
  // If the user has an active selection inside `el`, just replace that range.
  // Otherwise find a "protected" descendant (quote/signature block) and only
  // replace the prose before it. Plain contenteditables fall back to innerText.
  const PROTECTED_CE_RX = /(^|\s)(gmail_quote|gmail_signature|quote|signature)(\s|$)/i;
  function findProtectedChild(el) {
    const kids = el.children || [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (PROTECTED_CE_RX.test(c.className || '')) return c;
    }
    return null;
  }
  function setContentEditableText(el, value) {
    try {
      el.focus();
      const sel = window.getSelection();
      // Case 1: user has a live selection inside this element — replace only it.
      if (sel && !sel.isCollapsed && sel.rangeCount && el.contains(sel.anchorNode)) {
        const ok = document.execCommand && document.execCommand('insertText', false, value);
        if (ok) {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          return;
        }
      }
      // Case 2: contenteditable has a protected child (quoted reply / signature).
      // Replace only the prose nodes before that child, leave the rest intact.
      const protectedEl = findProtectedChild(el);
      if (protectedEl) {
        const range = document.createRange();
        range.setStart(el, 0);
        range.setEndBefore(protectedEl);
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand && document.execCommand('insertText', false, value);
        if (ok) {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          return;
        }
        // Fallback: manual DOM surgery that preserves the protected subtree.
        const frag = document.createDocumentFragment();
        const lines = String(value).split('\n');
        lines.forEach((line, i) => {
          if (i > 0) frag.appendChild(document.createElement('br'));
          frag.appendChild(document.createTextNode(line));
        });
        // Remove all nodes before protectedEl
        while (el.firstChild && el.firstChild !== protectedEl) el.removeChild(el.firstChild);
        el.insertBefore(frag, protectedEl);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        return;
      }
      // Case 3: plain contenteditable — select all + insertText (preserves host framework hooks).
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand && document.execCommand('insertText', false, value);
      if (ok) {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        return;
      }
      // Last-resort fallback (no HTML present anyway, so innerText is safe here).
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch(e) {
      try {
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } catch(_) {}
    }
  }
  function setText(el, text) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      setContentEditableText(el, text);
    }
  }
  // Replace just one substring in the live field text
  function replaceInField(el, original, suggestion) {
    const cur = getText(el);
    const idx = cur.indexOf(original);
    if (idx === -1) return false;
    const next = cur.slice(0, idx) + suggestion + cur.slice(idx + original.length);
    setText(el, next);
    return true;
  }

  // ── Heuristic checks ─────────────────────────────────────────────────────
  // Each returns array of { id, severity, category, message, anchor, replacement }
  function checkAntiPhrases(text) {
    const out = [];
    const lower = text.toLowerCase();
    voiceProfile.antiPhrases.forEach(p => {
      const idx = lower.indexOf(p);
      if (idx === -1) return;
      const original = text.substr(idx, p.length);
      out.push({
        id: 'anti:' + p,
        severity: 'medium',
        category: 'voice',
        message: `"${original}" — not your voice. Try opening with something specific.`,
        anchor: original,
        replacement: null, // no auto-replace for openers
      });
    });
    return out;
  }
  function checkExclamations(text) {
    if (!voiceProfile.avoidExclamations) return [];
    const count = (text.match(/!/g) || []).length;
    if (count <= voiceProfile.maxExclamations) return [];
    return [{
      id: 'excl',
      severity: 'low',
      category: 'voice',
      message: `${count} exclamation points. Your voice runs cool — try removing all but one.`,
      anchor: null,
      replacement: text.replace(/!+/g, (m, off, str) => {
        // keep the first !, replace rest with .
        const before = str.slice(0, off);
        const firstAlready = before.includes('!');
        return firstAlready ? '.' : '!';
      }),
    }];
  }
  function checkSignoff(text) {
    if (text.length < 80) return [];
    const tail = text.slice(-120).toLowerCase();
    const generic = ['best regards', 'sincerely', 'kind regards', 'warm regards', 'best wishes'];
    const hit = generic.find(g => tail.includes(g));
    if (!hit) return [];
    return [{
      id: 'signoff',
      severity: 'low',
      category: 'voice',
      message: cfg.preferredSignoffs.length ? `Sign-off "${hit}" — try your preferred sign-off instead.` : `Sign-off "${hit}" — consider something more personal.`,
      anchor: hit,
      replacement: null,
    }];
  }
  function checkLLMSlop(text) {
    const out = [];
    const slopPatterns = [
      { rx: /\bdelve into\b/i, msg: '"delve into" — classic LLM tell.' },
      { rx: /\btapestry\b/i,    msg: '"tapestry" — classic LLM tell.' },
      { rx: /\bin today's fast-paced\b/i, msg: '"in today\'s fast-paced..." — LLM filler.' },
      { rx: /\bunlock(?:ing)? the (?:power|potential) of\b/i, msg: '"unlock the potential of..." — LLM filler.' },
      { rx: /\bgame[- ]chang(?:er|ing)\b/i, msg: '"game-changer" — corporate cliché.' },
    ];
    slopPatterns.forEach(p => {
      const m = text.match(p.rx);
      if (m) out.push({
        id: 'slop:' + m[0],
        severity: 'medium',
        category: 'voice',
        message: p.msg,
        anchor: m[0],
        replacement: null,
      });
    });
    return out;
  }
  function checkDoubleSpace(text) {
    if (!/  +/.test(text)) return [];
    return [{
      id: 'doublespace',
      severity: 'low',
      category: 'cleanup',
      message: 'Double space between words.',
      anchor: null,
      replacement: text.replace(/  +/g, ' '),
    }];
  }
  function runAllChecks(text) {
    if (!text || text.length < 20) return [];
    return [
      ...checkAntiPhrases(text),
      ...checkLLMSlop(text),
      ...checkExclamations(text),
      ...checkSignoff(text),
      ...checkDoubleSpace(text),
    ];
  }

  // ── UI: floating pill + suggestion panel ─────────────────────────────────
  let pillEl = null;
  let panelEl = null;
  // Per-field dismissal state keyed by element. Each entry tracks the text
  // hash at the time of dismissal — if the text hasn't changed, dismissed
  // suggestions stay hidden across focus loss/return. If it changes, the
  // old dismissals may no longer apply and we start a fresh set.
  const dismissedByField = new WeakMap();
  let dismissedIds = new Set();
  function hashText(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }
  function getDismissedSet(field, text) {
    const hash = hashText(text || '');
    const existing = dismissedByField.get(field);
    if (existing && existing.textHash === hash) return existing.ids;
    const fresh = new Set();
    dismissedByField.set(field, { textHash: hash, ids: fresh });
    return fresh;
  }
  function updateDismissedHash(field, text) {
    const entry = dismissedByField.get(field);
    if (!entry) return;
    entry.textHash = hashText(text || '');
  }
  let activeField = null;
  let lastSuggestions = [];
  let debounceTimer = null;

  function ensurePill() {
    if (pillEl) return pillEl;
    pillEl = document.createElement('div');
    pillEl.id = 'coop-assist-pill';
    pillEl.style.cssText = [
      'position:fixed','z-index:2147483646','display:none',
      'background:linear-gradient(135deg,#ffffff 0%,#fff7ed 100%)',
      'border:1px solid #fdba74','border-radius:999px',
      'padding:6px 12px 6px 10px','font-size:12px','font-weight:700',
      'color:#9a3412','cursor:pointer','user-select:none',
      'box-shadow:0 6px 20px rgba(255,122,89,0.22),0 2px 6px rgba(0,0,0,0.08)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'display:flex','align-items:center','gap:6px',
      'transition:transform 0.18s cubic-bezier(.2,1.4,.4,1), opacity 0.18s ease',
      'opacity:0','transform:scale(0.85) translateY(4px)',
    ].join(';');
    pillEl.innerHTML = `<span style="font-size:13px;line-height:1;">✨</span><span class="coop-pill-label">Coop</span>`;
    pillEl.addEventListener('mousedown', e => e.preventDefault()); // don't blur field
    pillEl.addEventListener('click', e => {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(pillEl);
    return pillEl;
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'coop-assist-panel';
    panelEl.style.cssText = [
      'position:fixed','z-index:2147483647','display:none',
      'background:#ffffff','border:1px solid #ECE7E1',
      'border-radius:14px','width:340px','max-width:calc(100vw - 32px)','max-height:calc(100vh - 32px)','display:flex','flex-direction:column',
      'box-shadow:0 20px 60px rgba(0,0,0,0.18),0 4px 14px rgba(0,0,0,0.06)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'overflow:hidden','transition:opacity 0.18s ease, transform 0.18s cubic-bezier(.2,1.4,.4,1)',
      'opacity:0','transform:scale(0.95) translateY(6px)',
    ].join(';');
    panelEl.addEventListener('mousedown', e => e.preventDefault());
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function positionPillFor(field) {
    if (!pillEl) return;
    const r = field.getBoundingClientRect();
    const pillW = pillEl.offsetWidth || 100;
    const pillH = pillEl.offsetHeight || 30;
    let left = Math.min(window.innerWidth - pillW - 12, r.right - pillW - 4);
    if (left < 8) left = 8;
    // Prefer just below the field's bottom-right; flip above if no room
    let top = r.bottom + 8;
    if (top + pillH > window.innerHeight - 8) top = r.top - pillH - 8;
    if (top < 8) top = 8;
    pillEl.style.left = left + 'px';
    pillEl.style.top  = top + 'px';
  }
  function positionPanelFor(field) {
    if (!panelEl) return;
    const r = field.getBoundingClientRect();
    const panelW = Math.min(340, window.innerWidth - 24);
    panelEl.style.width = panelW + 'px';
    const maxH = window.innerHeight - 24;
    panelEl.style.maxHeight = maxH + 'px';
    const ph = Math.min(panelEl.offsetHeight || 420, maxH);
    const gap = 12;
    let left, top;
    if (r.right + gap + panelW <= window.innerWidth - 8) {
      left = r.right + gap;
    } else if (r.left - gap - panelW >= 8) {
      left = r.left - gap - panelW;
    } else {
      left = Math.min(window.innerWidth - panelW - 12, Math.max(12, r.right - panelW));
    }
    // Vertical: center around the field's top, then clamp into viewport
    top = Math.max(12, Math.min(r.top - 20, window.innerHeight - ph - 12));
    panelEl.style.left = left + 'px';
    panelEl.style.top  = top + 'px';
  }

  function showPill(count) {
    ensurePill();
    const lbl = pillEl.querySelector('.coop-pill-label');
    if (count > 0) {
      lbl.innerHTML = `Coop <span style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:4px;background:#dc2626;color:#fff;border-radius:9px;font-size:10px;font-weight:800;">${count}</span>`;
      pillEl.style.background = 'linear-gradient(135deg,#fff5f5 0%,#fee2e2 100%)';
      pillEl.style.borderColor = '#fca5a5';
      pillEl.style.color = '#991b1b';
      pillEl.style.boxShadow = '0 6px 22px rgba(220,38,38,0.25),0 2px 6px rgba(0,0,0,0.08)';
    } else {
      lbl.textContent = 'Coop';
      pillEl.style.background = 'linear-gradient(135deg,#ffffff 0%,#fff7ed 100%)';
      pillEl.style.borderColor = '#fdba74';
      pillEl.style.color = '#9a3412';
      pillEl.style.boxShadow = '0 6px 20px rgba(255,122,89,0.22),0 2px 6px rgba(0,0,0,0.08)';
    }
    pillEl.title = count > 0
      ? `${count} suggestion${count === 1 ? '' : 's'} — click to review`
      : 'Click to rewrite in your voice, tighten, or fix typos';
    pillEl.style.display = 'flex';
    requestAnimationFrame(() => {
      pillEl.style.opacity = '1';
      pillEl.style.transform = 'scale(1) translateY(0)';
    });
  }
  function hidePill() {
    if (!pillEl) return;
    pillEl.style.opacity = '0';
    pillEl.style.transform = 'scale(0.85) translateY(4px)';
    setTimeout(() => { if (pillEl) pillEl.style.display = 'none'; }, 180);
    hidePanel();
  }
  function hidePanel() {
    if (!panelEl) return;
    panelEl.style.opacity = '0';
    panelEl.style.transform = 'scale(0.95) translateY(6px)';
    setTimeout(() => { if (panelEl) panelEl.style.display = 'none'; }, 180);
  }
  function togglePanel() {
    if (!panelEl || panelEl.style.display === 'none') openPanel();
    else hidePanel();
  }

  function severityColor(s) {
    if (s === 'high')   return { bg: '#fef2f2', border: '#fca5a5', dot: '#dc2626' };
    if (s === 'medium') return { bg: '#fff7ed', border: '#fdba74', dot: '#ea580c' };
    return { bg: '#f5f3f0', border: '#e5e0d8', dot: '#a09a94' };
  }

  // ── Suggestion recompute (local heuristics only) ─────────────────────────
  // LLM-backed spell/grammar proofread was removed — it fired a Claude Haiku
  // call on every typing-pause and burned real money on long drafts. Local
  // voice / cliché / exclamation heuristics still run instantly and are free.
  // Rewrite modes (In my voice / Tighten / Punchier / Warmer) are untouched
  // and remain LLM-backed, since those are explicit user actions.
  function recomputeSuggestions(field) {
    if (!field) return;
    const text = getText(field);
    dismissedIds = getDismissedSet(field, text);
    lastSuggestions = runAllChecks(text).filter(s => !dismissedIds.has(s.id));
    showPill(lastSuggestions.length);
    positionPillFor(field);
    if (panelEl && panelEl.style.display !== 'none') openPanel();
  }

  // ── Phase 2: rewrite via background LLM ──────────────────────────────────
  let rewriteState = { loading: false, result: null, error: null, mode: null };
  function requestRewrite(mode) {
    if (!activeField) return;
    const text = getText(activeField);
    if (!text || text.trim().length < 10) return;
    rewriteState = { loading: true, result: null, error: null, mode };
    openPanel();
    try {
      chrome.runtime.sendMessage({
        type: 'COOP_ASSIST_REWRITE',
        text,
        mode,
        pageContext: (document.title || '') + ' — ' + location.hostname,
      }, (resp) => {
        if (chrome.runtime.lastError) {
          rewriteState = { loading: false, result: null, error: chrome.runtime.lastError.message, mode };
        } else if (resp && resp.error) {
          rewriteState = { loading: false, result: null, error: resp.error, mode };
        } else if (resp && resp.rewrite) {
          rewriteState = { loading: false, result: resp.rewrite, error: null, mode };
        } else {
          rewriteState = { loading: false, result: null, error: 'No response', mode };
        }
        openPanel();
      });
    } catch (e) {
      rewriteState = { loading: false, result: null, error: e.message, mode };
      openPanel();
    }
  }
  function applyRewrite() {
    if (!activeField || !rewriteState.result) return;
    setText(activeField, rewriteState.result);
    rewriteState = { loading: false, result: null, error: null, mode: null };
    setTimeout(() => analyze(activeField), 200);
  }
  function discardRewrite() {
    rewriteState = { loading: false, result: null, error: null, mode: null };
    openPanel();
  }

  function openPanel() {
    if (!activeField) return;
    ensurePanel();
    positionPanelFor(activeField);

    // Rewrite preview state takes over panel
    if (rewriteState.loading || rewriteState.result || rewriteState.error) {
      const modeLabel = ({ voice: 'In your voice', tighten: 'Tighter', punchy: 'Punchier', warm: 'Warmer' })[rewriteState.mode] || 'Rewrite';
      let body;
      if (rewriteState.loading) {
        body = `<div style="padding:24px;text-align:center;font-size:12px;color:#7c98b6;">
          <div style="display:inline-block;width:18px;height:18px;border:2px solid #fdba74;border-top-color:transparent;border-radius:50%;animation:coopspin 0.8s linear infinite;"></div>
          <div style="margin-top:10px;">Coop is rewriting…</div>
        </div>
        <style>@keyframes coopspin{to{transform:rotate(360deg)}}</style>`;
      } else if (rewriteState.error) {
        body = `<div style="padding:16px;font-size:12px;color:#dc2626;">Error: ${escHtml(rewriteState.error)}</div>
          <div style="padding:0 14px 14px;"><button class="coop-rw-back" style="font-size:11px;padding:5px 11px;background:transparent;border:1px solid #ECE7E1;border-radius:6px;cursor:pointer;">Back</button></div>`;
      } else {
        body = `<div style="padding:14px;">
          <div style="font-size:11px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">${modeLabel}</div>
          <div style="font-size:13px;line-height:1.55;color:#33475b;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px 12px;white-space:pre-wrap;max-height:240px;overflow-y:auto;">${escHtml(rewriteState.result)}</div>
          <div style="display:flex;gap:6px;margin-top:10px;">
            <button class="coop-rw-apply" style="font-size:11px;font-weight:700;padding:6px 14px;background:#FF7A59;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;">Apply</button>
            <button class="coop-rw-back" style="font-size:11px;font-weight:600;padding:6px 12px;background:transparent;color:#7c98b6;border:1px solid #ECE7E1;border-radius:6px;cursor:pointer;font-family:inherit;">Discard</button>
          </div>
        </div>`;
      }
      panelEl.innerHTML = `
        <div style="padding:12px 14px;background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%);border-bottom:1px solid #fdba74;display:flex;align-items:center;gap:8px;">
          <span style="font-size:14px;">✨</span>
          <span style="font-size:12px;font-weight:800;color:#9a3412;flex:1;">Coop Rewrite</span>
          <button id="coop-close-btn" style="font-size:14px;background:none;border:none;color:#9a3412;cursor:pointer;padding:0 4px;line-height:1;">×</button>
        </div>
        ${body}`;
      panelEl.style.display = 'flex';
      requestAnimationFrame(() => {
        if (activeField) positionPanelFor(activeField);
        panelEl.style.opacity = '1';
        panelEl.style.transform = 'scale(1) translateY(0)';
      });
      panelEl.querySelector('#coop-close-btn').addEventListener('click', () => { discardRewrite(); hidePanel(); });
      panelEl.querySelector('.coop-rw-apply')?.addEventListener('click', applyRewrite);
      panelEl.querySelector('.coop-rw-back')?.addEventListener('click', discardRewrite);
      return;
    }

    // ── Default panel: Grammarly-style unified diff card ─────────────────
    const curText = getText(activeField);
    // deltaSugg is always empty now (LLM proofread removed); kept for the
    // dead-path safety net in the accept-all handler below.
    const deltaSugg = lastSuggestions.filter(s => s.delta);
    const otherSugg = lastSuggestions.filter(s => !s.delta);
    const hasIssues = lastSuggestions.length > 0;

    // Build inline diff HTML: walk the text, wrap each issue's "original" with
    // strikethrough, followed by bold suggestion. Uses the live text so multiple
    // fixes in one line render correctly.
    function buildDiffHtml() {
      if (!deltaSugg.length) return escHtml(curText);
      // Find each issue's position in curText (first occurrence — we apply in order)
      const marks = [];
      const used = new Set();
      deltaSugg.forEach((s, i) => {
        const orig = s.delta.original;
        let from = 0;
        while (true) {
          const idx = curText.indexOf(orig, from);
          if (idx === -1) break;
          const key = idx + ':' + orig.length;
          if (!used.has(key)) {
            marks.push({ start: idx, end: idx + orig.length, original: orig, suggestion: s.delta.suggestion });
            used.add(key);
            break;
          }
          from = idx + 1;
        }
      });
      marks.sort((a, b) => a.start - b.start);
      // Remove overlaps (keep earlier)
      const clean = [];
      let lastEnd = -1;
      for (const m of marks) {
        if (m.start >= lastEnd) { clean.push(m); lastEnd = m.end; }
      }
      let out = '';
      let cursor = 0;
      for (const m of clean) {
        out += escHtml(curText.slice(cursor, m.start));
        out += `<span style="text-decoration:line-through;color:#a09a94;">${escHtml(m.original)}</span>`;
        if (m.suggestion && m.suggestion !== m.original) {
          out += ` <span style="font-weight:700;color:#15803d;background:#dcfce7;padding:1px 4px;border-radius:3px;">${escHtml(m.suggestion)}</span>`;
        }
        cursor = m.end;
      }
      out += escHtml(curText.slice(cursor));
      return out;
    }

    // Local heuristic items (voice/cliché flags) — surfaced as a small list below the diff
    const voiceNotes = otherSugg.length ? `
      <div style="padding:10px 14px;border-top:1px solid #f0eeeb;background:#fffaf6;">
        <div style="font-size:10px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Voice notes</div>
        ${otherSugg.map(s => `<div style="font-size:12px;color:#33475b;line-height:1.5;margin-bottom:4px;">• ${escHtml(s.message)}</div>`).join('')}
      </div>` : '';

    const headerTitle = hasIssues
      ? (deltaSugg.length ? `Fix ${deltaSugg.length} ${deltaSugg.length === 1 ? 'issue' : 'issues'}` : `${otherSugg.length} voice note${otherSugg.length === 1 ? '' : 's'}`)
      : 'Looks good';

    const diffBody = hasIssues && deltaSugg.length
      ? `<div style="padding:14px 16px;font-size:14px;line-height:1.6;color:#33475b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-height:260px;overflow-y:auto;">${buildDiffHtml()}</div>`
      : (hasIssues
        ? `<div style="padding:14px 16px;font-size:13px;color:#33475b;line-height:1.6;">${escHtml(curText) || '<em style="color:#a09a94;">(empty)</em>'}</div>`
        : `<div style="padding:18px 16px;font-size:13px;color:#7c98b6;line-height:1.5;text-align:center;">✓ No issues found.<br><span style="font-size:11px;">Use a tab below to rephrase.</span></div>`);

    const acceptBtn = deltaSugg.length
      ? `<button id="coop-accept-all" style="font-size:12px;font-weight:700;padding:7px 16px;background:#FF7A59;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;">Accept all</button>`
      : '';
    const dismissBtn = deltaSugg.length
      ? `<button id="coop-dismiss-all" style="font-size:12px;font-weight:600;padding:7px 12px;background:transparent;color:#7c98b6;border:1px solid #ECE7E1;border-radius:6px;cursor:pointer;font-family:inherit;">Dismiss</button>`
      : '';

    const tabs = `
      <div style="display:flex;border-top:1px solid #ECE7E1;background:#fafaf8;">
        <button class="coop-tab" data-mode="improve" style="flex:1;font-size:11px;font-weight:700;padding:10px 4px;background:transparent;border:none;border-top:2px solid #FF7A59;color:#9a3412;cursor:pointer;font-family:inherit;">Improve</button>
        <button class="coop-tab coop-rw" data-mode="voice"   style="flex:1;font-size:11px;font-weight:600;padding:10px 4px;background:transparent;border:none;border-top:2px solid transparent;color:#7c98b6;cursor:pointer;font-family:inherit;">In my voice</button>
        <button class="coop-tab coop-rw" data-mode="tighten" style="flex:1;font-size:11px;font-weight:600;padding:10px 4px;background:transparent;border:none;border-top:2px solid transparent;color:#7c98b6;cursor:pointer;font-family:inherit;">Tighten</button>
        <button class="coop-tab coop-rw" data-mode="punchy"  style="flex:1;font-size:11px;font-weight:600;padding:10px 4px;background:transparent;border:none;border-top:2px solid transparent;color:#7c98b6;cursor:pointer;font-family:inherit;">Punchier</button>
        <button class="coop-tab coop-rw" data-mode="warm"    style="flex:1;font-size:11px;font-weight:600;padding:10px 4px;background:transparent;border:none;border-top:2px solid transparent;color:#7c98b6;cursor:pointer;font-family:inherit;">Warmer</button>
      </div>`;

    panelEl.innerHTML = `
      <div style="padding:12px 14px;background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%);border-bottom:1px solid #fdba74;display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <span style="font-size:14px;">✨</span>
        <span style="font-size:12px;font-weight:800;color:#9a3412;flex:1;">${escHtml(headerTitle)}</span>
        <button id="coop-close-btn" style="font-size:14px;background:none;border:none;color:#9a3412;cursor:pointer;padding:0 4px;line-height:1;">×</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;">
        ${diffBody}
        ${voiceNotes}
      </div>
      ${(acceptBtn || dismissBtn) ? `<div style="padding:10px 14px;border-top:1px solid #ECE7E1;background:#fff;display:flex;gap:8px;flex-shrink:0;">${acceptBtn}${dismissBtn}</div>` : ''}
      ${tabs}
    `;
    panelEl.style.display = 'flex';
    requestAnimationFrame(() => {
      if (activeField) positionPanelFor(activeField);
      panelEl.style.opacity = '1';
      panelEl.style.transform = 'scale(1) translateY(0)';
    });

    panelEl.querySelector('#coop-close-btn').addEventListener('click', hidePanel);
    panelEl.querySelector('#coop-accept-all')?.addEventListener('click', () => {
      if (!activeField) return;
      // Dead path: delta-style suggestions only came from LLM proofread, which
      // was removed. Kept as a no-op safety net in case deltaSugg is ever
      // repopulated by a future feature.
      for (const s of deltaSugg) {
        replaceInField(activeField, s.delta.original, s.delta.suggestion);
        dismissedIds.add(s.id);
      }
      lastSuggestions = lastSuggestions.filter(x => !x.delta);
      setTimeout(() => analyze(activeField), 80);
    });
    panelEl.querySelector('#coop-dismiss-all')?.addEventListener('click', () => {
      deltaSugg.forEach(s => dismissedIds.add(s.id));
      lastSuggestions = lastSuggestions.filter(x => !x.delta);
      openPanel();
      showPill(lastSuggestions.length);
    });
    panelEl.querySelectorAll('.coop-rw').forEach(btn => {
      btn.addEventListener('click', () => requestRewrite(btn.dataset.mode));
    });
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  // ── Analyzer ─────────────────────────────────────────────────────────────
  function analyze(field) {
    if (!isActive() || !field) return;
    recomputeSuggestions(field);
  }

  function scheduleAnalyze(field) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => analyze(field), 900);
  }

  // ── Field watchers ───────────────────────────────────────────────────────
  function attachField(field) {
    activeField = field;
    // Rebind dismissedIds to whatever set this field currently has (for its
    // current text). recomputeSuggestions refreshes this on each tick.
    dismissedIds = getDismissedSet(field, getText(field));
    // Disable native spellcheck while Coop is watching — prevents double
    // underlines fighting with Coop's suggestions.
    try { field.spellcheck = false; field.setAttribute('spellcheck', 'false'); } catch(e) {}
    // Show pill immediately on focus (Grammarly-style — no waiting)
    showPill(lastSuggestions.length || 0);
    positionPillFor(field);
    if (field.__coopAttached) return;
    field.__coopAttached = true;
    field.addEventListener('input', () => scheduleAnalyze(field));
    field.addEventListener('blur', () => {
      // Don't hide immediately — let user click pill
      setTimeout(() => {
        if (document.activeElement !== field && !pillEl?.contains(document.activeElement) && !panelEl?.contains(document.activeElement)) {
          hidePill();
        }
      }, 200);
    });
    // Initial check
    setTimeout(() => analyze(field), 250);
  }

  document.addEventListener('focusin', e => {
    if (!isActive()) return;
    const el = e.target;
    if (isWritingField(el)) attachField(el);
  }, true);

  // Keep pill positioned on scroll/resize
  window.addEventListener('scroll', () => {
    if (activeField && pillEl && pillEl.style.display !== 'none') {
      positionPillFor(activeField);
      if (panelEl && panelEl.style.display !== 'none') positionPanelFor(activeField);
    }
  }, true);
  window.addEventListener('resize', () => {
    if (activeField && pillEl && pillEl.style.display !== 'none') {
      positionPillFor(activeField);
      if (panelEl && panelEl.style.display !== 'none') positionPanelFor(activeField);
    }
  });
})();
