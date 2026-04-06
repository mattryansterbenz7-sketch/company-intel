// ═══════════════════════════════════════════════════════════════════════════
// CompanyIntel — Sound System
// Subtle, premium audio feedback using Web Audio API synthesis
// No external files — all sounds are generated procedurally
// ═══════════════════════════════════════════════════════════════════════════

const CISounds = (() => {
  let _ctx = null;
  let _muted = false;

  // Lazy-init AudioContext (must happen after user gesture)
  function ctx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  // Load mute preference
  chrome.storage?.local?.get?.(['coopConfig'], d => {
    _muted = d?.coopConfig?.soundsMuted === true;
  });
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === 'local' && changes.coopConfig) {
      _muted = changes.coopConfig.newValue?.soundsMuted === true;
    }
  });

  // ── Utilities ──

  function play(fn) {
    if (_muted) return;
    try { fn(ctx()); } catch (e) { /* audio not available */ }
  }

  function osc(ac, type, freq, start, duration, gainVal = 0.12) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + duration);
    o.connect(g).connect(ac.destination);
    o.start(start);
    o.stop(start + duration);
  }

  // ── Sounds ──

  return {
    get muted() { return _muted; },
    set muted(v) {
      _muted = !!v;
      chrome.storage?.local?.get?.(['coopConfig'], d => {
        const cfg = d?.coopConfig || {};
        cfg.soundsMuted = _muted;
        chrome.storage.local.set({ coopConfig: cfg });
      });
    },

    // Soft ascending double-tap — message sent
    send() {
      play(ac => {
        const t = ac.currentTime;
        osc(ac, 'sine', 880, t, 0.08, 0.06);
        osc(ac, 'sine', 1100, t + 0.06, 0.1, 0.08);
      });
    },

    // Warm descending chime — response received
    receive() {
      play(ac => {
        const t = ac.currentTime;
        osc(ac, 'sine', 740, t, 0.12, 0.07);
        osc(ac, 'sine', 587, t + 0.08, 0.15, 0.06);
        // Soft harmonic overtone
        osc(ac, 'sine', 1175, t, 0.1, 0.02);
      });
    },

    // Quick bright click — snip captured
    snip() {
      play(ac => {
        const t = ac.currentTime;
        osc(ac, 'sine', 1200, t, 0.04, 0.1);
        osc(ac, 'triangle', 2400, t, 0.03, 0.04);
      });
    },

    // Gentle rising tone — screen share started
    shareStart() {
      play(ac => {
        const t = ac.currentTime;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(440, t);
        o.frequency.linearRampToValueAtTime(660, t + 0.15);
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.connect(g).connect(ac.destination);
        o.start(t); o.stop(t + 0.2);
      });
    },

    // Gentle falling tone — screen share stopped
    shareStop() {
      play(ac => {
        const t = ac.currentTime;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(660, t);
        o.frequency.linearRampToValueAtTime(440, t + 0.15);
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.connect(g).connect(ac.destination);
        o.start(t); o.stop(t + 0.2);
      });
    },

    // Soft low double-bump — error
    error() {
      play(ac => {
        const t = ac.currentTime;
        osc(ac, 'sine', 280, t, 0.1, 0.08);
        osc(ac, 'sine', 220, t + 0.12, 0.15, 0.06);
      });
    },

    // Subtle pop — general UI action (save, toggle, etc.)
    pop() {
      play(ac => {
        const t = ac.currentTime;
        osc(ac, 'sine', 1000, t, 0.06, 0.05);
      });
    },
  };
})();
