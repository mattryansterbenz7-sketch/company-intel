/* ═══════════════════════════════════════════════════════════════════════════
   ResearchPipeline — #241 narrative motion component
   Vanilla JS class. Shared between sidepanel.js and company.js.

   Sub-item progress approach: APPROACH B (fallback).
   The four parallel Serper searches in research.js run via background.js
   messaging which doesn't currently support per-search callbacks back to the
   caller. Wiring Approach A (per-item RESEARCH_PROGRESS messages) would
   require background.js message-routing changes beyond this component's scope.
   Instead, all four sub-items reveal together when completeStage(1, …) fires.
   A comment in sidepanel.js marks the hook point for a future Approach A
   upgrade if per-item progress emission is added to research.js.

   Stage 3 streaming: NOT wired (Approach B for synthesis too).
   claudeApiCall() in api.js doesn't expose a streaming callback to callers
   outside the background service worker — adding it would require refactoring
   the IPC layer. Stage 3 fills in its text slot when completeStage(2, …) is
   called with the synthesis text. The cursor blinks while stage 3 is active
   (indeterminate state) and hides on completion. Filed as a follow-up if
   streaming support is added to the research pipeline later.

   API:
     constructor(mountEl, { company, domain, logoInitial })
     advance(stageIdx)                      pending → active
     completeStage(stageIdx, timingMs)      active → done, show timing
     skipStage(stageIdx, reason)            → skipped, show hint
     completeSubItem(stageIdx, subKey, count)   sub-bullet resolves
     skipSubItem(stageIdx, subKey, reason)       sub-bullet skipped
     streamSynthesis(text)                  append streaming chars (noop if no stream)
     fillField(slotName, value)             skeleton → real value in result card
     fail(stageIdx, message)               → failed, red ✗
     finish()                              all done, start 2s collapse timer
     stop()                                tear down (tab closed, etc.)
   ═══════════════════════════════════════════════════════════════════════════ */

class ResearchPipeline {
  constructor(mountEl, { company = '', domain = '', logoInitial = '' } = {}) {
    this._mount   = mountEl;
    this._company = company;
    this._domain  = domain;
    this._logo    = logoInitial || (company ? company.charAt(0).toUpperCase() : 'C');

    this._startedAt    = performance.now();
    this._timerInterval = null;
    this._collapseTimer = null;
    this._stopped      = false;

    // Per-stage start times for timing calculation
    this._stageStartMs = [null, null, null];

    this._render();
    this._startTimer();
  }

  /* ── Internal helpers ──────────────────────────────────────────────────── */

  _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _render() {
    const safeCompany = this._esc(this._company || 'company');
    const safeDomain  = this._esc(this._domain || '');
    const safeLogo    = this._esc(this._logo);

    this._mount.innerHTML = `
<div class="pipeline-card" id="rp-pipeline-card">
  <div class="pipeline-head">
    <!-- Coop brand mark — intentionally hardcoded "C" (not the company's logoInitial). -->
    <div class="pipeline-brand">C</div>
    <div class="pipeline-title">Researching <span class="company">${safeCompany}</span></div>
    <div class="pipeline-timer" id="rp-timer">0.0s</div>
  </div>

  <div class="stage-list">
    <!-- Stage 0: Apollo firmographics -->
    <div class="stage active" id="rp-stage-0">
      <div class="stage-dot-col">
        <div class="stage-dot" id="rp-dot-0"></div>
        <div class="stage-connector"></div>
      </div>
      <div class="stage-body">
        <div class="stage-title-row">
          <span class="stage-title">Firmographics · Apollo</span>
          <span class="stage-timing" id="rp-timing-0"></span>
        </div>
      </div>
    </div>

    <!-- Stage 1: Serper web research -->
    <div class="stage pending" id="rp-stage-1">
      <div class="stage-dot-col">
        <div class="stage-dot" id="rp-dot-1"></div>
        <div class="stage-connector"></div>
      </div>
      <div class="stage-body">
        <div class="stage-title-row">
          <span class="stage-title">Leaders · reviews · jobs · product (Serper)</span>
          <span class="stage-timing" id="rp-timing-1"></span>
        </div>
        <div class="stage-sub" id="rp-sub-1">
          <div class="stage-sub-item" id="rp-sub-1-reviews">
            <span class="stage-sub-dot" id="rp-subdot-reviews"></span>
            <span id="rp-sublabel-reviews">Reviews</span>
            <span class="amt" id="rp-subamt-reviews"></span>
          </div>
          <div class="stage-sub-item" id="rp-sub-1-leaders">
            <span class="stage-sub-dot" id="rp-subdot-leaders"></span>
            <span id="rp-sublabel-leaders">Leaders</span>
            <span class="amt" id="rp-subamt-leaders"></span>
          </div>
          <div class="stage-sub-item" id="rp-sub-1-jobs">
            <span class="stage-sub-dot" id="rp-subdot-jobs"></span>
            <span id="rp-sublabel-jobs">Job listings</span>
            <span class="amt" id="rp-subamt-jobs"></span>
          </div>
          <div class="stage-sub-item" id="rp-sub-1-product">
            <span class="stage-sub-dot" id="rp-subdot-product"></span>
            <span id="rp-sublabel-product">Product overview</span>
            <span class="amt" id="rp-subamt-product"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Stage 2: Claude synthesis -->
    <div class="stage pending" id="rp-stage-2">
      <div class="stage-dot-col">
        <div class="stage-dot" id="rp-dot-2"></div>
      </div>
      <div class="stage-body">
        <div class="stage-title-row">
          <span class="stage-title">Synthesis · Claude</span>
          <span class="stage-timing" id="rp-timing-2"></span>
        </div>
        <div class="stage-stream" id="rp-stream-2">
          <span id="rp-stream-text-2"></span><span class="stage-stream-cursor" id="rp-cursor-2"></span>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="result-card" id="rp-result-card">
  <div class="result-head">
    <div class="result-logo" id="rp-result-logo">${safeLogo}</div>
    <div>
      <div class="result-name">${safeCompany}</div>
      <div class="result-url">${safeDomain}</div>
    </div>
  </div>

  <!-- Firmographics: filled by stage 0 (Apollo) -->
  <div class="result-stats">
    <div class="result-stat">
      <div class="result-stat-label">Employees</div>
      <div class="result-stat-value">
        <span class="value-slot" id="rp-slot-employees">
          <span class="skel sm"></span>
          <span class="filled"></span>
        </span>
      </div>
    </div>
    <div class="result-stat">
      <div class="result-stat-label">Funding</div>
      <div class="result-stat-value">
        <span class="value-slot" id="rp-slot-funding">
          <span class="skel sm"></span>
          <span class="filled"></span>
        </span>
      </div>
    </div>
    <div class="result-stat">
      <div class="result-stat-label">Industry</div>
      <div class="result-stat-value">
        <span class="value-slot" id="rp-slot-industry">
          <span class="skel sm"></span>
          <span class="filled"></span>
        </span>
      </div>
    </div>
  </div>

  <!-- Reviews: filled by stage 1 sub-item "reviews" -->
  <div class="result-section" id="rp-section-reviews">
    <div class="result-section-title">Reviews</div>
    <div class="result-row">
      <span class="label">Glassdoor</span>
      <span class="value">
        <span class="value-slot" id="rp-slot-reviews">
          <span class="skel md"></span>
          <span class="filled"></span>
        </span>
      </span>
    </div>
  </div>

  <!-- Leadership: filled by stage 1 sub-item "leaders" -->
  <div class="result-section" id="rp-section-leaders">
    <div class="result-section-title">Leadership</div>
    <div class="result-row">
      <span class="value-slot" id="rp-slot-leaders">
        <span class="skel lg"></span>
        <span class="filled"></span>
      </span>
    </div>
  </div>

  <!-- Intelligence summary: filled by stage 2 (Claude synthesis) -->
  <div class="result-section" id="rp-section-intelligence">
    <div class="result-section-title">Intelligence</div>
    <div class="result-summary" id="rp-result-summary">
      <span class="value-slot summary-slot" id="rp-slot-intelligence">
        <span class="skel line"></span>
        <span class="skel line"></span>
        <span class="skel line"></span>
        <span class="filled"></span>
      </span>
    </div>
  </div>
</div>`;

    // Cache frequently-accessed elements
    this._pipelineCard = document.getElementById('rp-pipeline-card');
    this._timerEl      = document.getElementById('rp-timer');
  }

  _startTimer() {
    const update = () => {
      if (this._stopped || !this._timerEl?.isConnected) {
        clearInterval(this._timerInterval);
        return;
      }
      const s = (performance.now() - this._startedAt) / 1000;
      this._timerEl.textContent = s.toFixed(1) + 's';
    };
    update();
    this._timerInterval = setInterval(update, 100);
  }

  _stageEl(idx) { return document.getElementById(`rp-stage-${idx}`); }
  _dotEl(idx)   { return document.getElementById(`rp-dot-${idx}`); }
  _timingEl(idx) { return document.getElementById(`rp-timing-${idx}`); }

  _setStageClass(idx, cls) {
    const el = this._stageEl(idx);
    if (!el) return;
    el.classList.remove('pending', 'active', 'done', 'skipped', 'failed');
    el.classList.add(cls);
  }

  _setDotContent(idx, content) {
    const el = this._dotEl(idx);
    if (!el) return;
    el.textContent = content;
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  /**
   * advance(stageIdx) — move stage to "active".
   * Records the stage start time for timing calculation.
   */
  advance(stageIdx) {
    if (this._stopped) return;
    this._setStageClass(stageIdx, 'active');
    this._setDotContent(stageIdx, '');
    this._stageStartMs[stageIdx] = performance.now();
  }

  /**
   * completeStage(stageIdx, timingMs) — mark stage done with elapsed time.
   * timingMs: real elapsed from performance.now() at stage start.
   * If omitted, falls back to wall-clock from advance() call.
   */
  completeStage(stageIdx, timingMs) {
    if (this._stopped) return;
    this._setStageClass(stageIdx, 'done');
    this._setDotContent(stageIdx, '✓');

    const ms = timingMs != null
      ? timingMs
      : (this._stageStartMs[stageIdx] != null
          ? performance.now() - this._stageStartMs[stageIdx]
          : null);

    const timingEl = this._timingEl(stageIdx);
    if (timingEl && ms != null) {
      timingEl.textContent = (ms / 1000).toFixed(1) + 's';
    }

    // Stage 1 completion: reveal all sub-items together (Approach B).
    // Hook point for Approach A: when RESEARCH_PROGRESS per-item messages are
    // emitted from research.js, call completeSubItem/skipSubItem individually
    // and remove this bulk-reveal block.
    if (stageIdx === 1) {
      ['reviews', 'leaders', 'jobs', 'product'].forEach(key => {
        const subEl = document.getElementById(`rp-sub-1-${key}`);
        if (subEl && !subEl.classList.contains('visible')) {
          // Only auto-reveal if not already set individually
          subEl.classList.add('visible');
        }
      });
    }
  }

  /**
   * skipStage(stageIdx, reason) — stage was skipped (e.g. Apollo exhausted).
   */
  skipStage(stageIdx, reason) {
    if (this._stopped) return;
    this._setStageClass(stageIdx, 'skipped');

    // Dash icon is rendered via CSS .stage.skipped .stage-dot::after
    // We set the text content here for the dot
    const dotEl = this._dotEl(stageIdx);
    if (dotEl) dotEl.textContent = '—';

    const timingEl = this._timingEl(stageIdx);
    if (timingEl) timingEl.textContent = 'skipped';

    // Add hint below stage body
    if (reason) {
      const stageEl = this._stageEl(stageIdx);
      const bodyEl  = stageEl?.querySelector('.stage-body');
      if (bodyEl) {
        const hint = document.createElement('div');
        hint.className = 'pipeline-hint warn';
        hint.textContent = reason;
        bodyEl.appendChild(hint);
      }
    }
  }

  /**
   * completeSubItem(stageIdx, subKey, count) — reveal a sub-item with its count.
   * subKey: 'reviews' | 'leaders' | 'jobs' | 'product'
   * count: number of results
   */
  completeSubItem(stageIdx, subKey, count) {
    if (this._stopped) return;
    const subEl = document.getElementById(`rp-sub-${stageIdx}-${subKey}`);
    const amtEl = document.getElementById(`rp-subamt-${subKey}`);
    if (!subEl) return;
    if (amtEl) amtEl.textContent = count + ' result' + (count !== 1 ? 's' : '');
    subEl.classList.add('visible');
  }

  /**
   * skipSubItem(stageIdx, subKey, reason) — sub-item was skipped.
   */
  skipSubItem(stageIdx, subKey, reason) {
    if (this._stopped) return;
    const subEl  = document.getElementById(`rp-sub-${stageIdx}-${subKey}`);
    const dotEl  = document.getElementById(`rp-subdot-${subKey}`);
    const amtEl  = document.getElementById(`rp-subamt-${subKey}`);
    const lblEl  = document.getElementById(`rp-sublabel-${subKey}`);
    if (!subEl) return;
    if (dotEl) dotEl.classList.add('skipped');
    if (amtEl) amtEl.textContent = reason ? `skipped (${reason})` : 'skipped';
    if (amtEl) amtEl.style.color = 'var(--ci-text-tertiary)';
    if (lblEl) lblEl.style.color = 'var(--ci-text-tertiary)';
    subEl.classList.add('visible', 'skipped-item');
  }

  /**
   * streamSynthesis(text) — append streaming chars to stage 3 stream area.
   * Simultaneously updates the intelligence summary slot.
   * NOTE: Currently a passthrough for future streaming support.
   * Stage 3 fills on completion via fillField('intelligence', …) for now.
   */
  streamSynthesis(text) {
    if (this._stopped) return;
    const streamEl = document.getElementById('rp-stream-text-2');
    if (streamEl) {
      streamEl.textContent += text;
      // Auto-scroll stage-stream if overflow
      const streamContainer = document.getElementById('rp-stream-2');
      if (streamContainer) {
        streamContainer.scrollTop = streamContainer.scrollHeight;
      }
    }
    // Mirror to intelligence summary slot as it streams
    const slot = document.getElementById('rp-slot-intelligence');
    if (slot) {
      const filled = slot.querySelector('.filled');
      if (filled) {
        filled.textContent += text;
        if (!slot.classList.contains('on')) {
          slot.classList.add('on');
        }
      }
    }
  }

  /**
   * fillField(slotName, value) — transition skeleton → real value.
   * slotName: 'employees' | 'funding' | 'industry' | 'reviews' |
   *           'leaders' | 'intelligence' | 'linkedin'
   * value: string to display (or array of leaders for 'leaders')
   */
  fillField(slotName, value) {
    if (this._stopped) return;
    if (value == null || value === '' ||
        (Array.isArray(value) && !value.length)) return;

    if (slotName === 'leaders') {
      this._fillLeaders(value);
      return;
    }

    const slot = document.getElementById(`rp-slot-${slotName}`);
    if (!slot) return;

    const filled = slot.querySelector('.filled');
    if (!filled) return;

    filled.textContent = String(value);
    slot.classList.add('on');
  }

  _fillLeaders(leaders) {
    const slot = document.getElementById('rp-slot-leaders');
    if (!slot) return;

    // Build a simple text representation of the first 2-3 leaders
    const filled = slot.querySelector('.filled');
    if (!filled) return;

    const items = Array.isArray(leaders) ? leaders.slice(0, 3) : [];
    if (!items.length) return;

    filled.innerHTML = items.map(l => {
      const name  = this._esc(l.name || '');
      const title = this._esc(l.title || '');
      return `<span style="display:block;font-size:12px;color:var(--ci-text-primary);font-weight:500;">${name}<span style="font-weight:400;color:var(--ci-text-tertiary);"> · ${title}</span></span>`;
    }).join('');

    slot.classList.add('on');
  }

  /**
   * fail(stageIdx, message) — hard failure state for a stage.
   */
  fail(stageIdx, message) {
    if (this._stopped) return;
    this._setStageClass(stageIdx, 'failed');

    const dotEl = this._dotEl(stageIdx);
    if (dotEl) dotEl.textContent = '✕';

    const timingEl = this._timingEl(stageIdx);
    if (timingEl) timingEl.textContent = 'failed';

    if (message) {
      const stageEl = this._stageEl(stageIdx);
      const bodyEl  = stageEl?.querySelector('.stage-body');
      if (bodyEl) {
        const hint = document.createElement('div');
        hint.className = 'pipeline-hint err';
        hint.textContent = message;
        bodyEl.appendChild(hint);
      }
    }
  }

  /**
   * finish() — all stages done. Start 2s collapse timer.
   */
  finish() {
    if (this._stopped) return;

    // Freeze the timer
    clearInterval(this._timerInterval);

    // Mark all remaining pending/active stages as done
    [0, 1, 2].forEach(i => {
      const el = this._stageEl(i);
      if (!el) return;
      if (el.classList.contains('pending') || el.classList.contains('active')) {
        this._setStageClass(i, 'done');
        this._setDotContent(i, '✓');
      }
    });

    // 2s delay then collapse pipeline card to single hint bar
    this._collapseTimer = setTimeout(() => {
      if (!this._stopped) this._collapse();
    }, 2000);
  }

  _collapse() {
    const card = this._pipelineCard;
    if (!card || !card.isConnected) return;

    const totalMs  = performance.now() - this._startedAt;
    const totalSec = (totalMs / 1000).toFixed(1);

    // Build collapsed hint bar
    const bar = document.createElement('div');
    bar.className = 'pipeline-hint-bar';
    bar.innerHTML = `Researched in ${totalSec}s · <button class="refresh-link" id="rp-refresh-btn">refresh</button>`;

    // Animate collapse: shrink max-height + fade out
    card.style.overflow    = 'hidden';
    card.style.maxHeight   = card.scrollHeight + 'px';
    card.style.transition  = `max-height var(--motion-md) var(--ease-out), opacity var(--motion-md) var(--ease-out)`;

    requestAnimationFrame(() => {
      card.style.maxHeight = '0';
      card.style.opacity   = '0';
      card.style.padding   = '0 14px';
    });

    card.addEventListener('transitionend', () => {
      if (!card.isConnected) return;
      // Replace the pipeline card with the collapsed bar
      card.replaceWith(bar);
      // Wire refresh button
      document.getElementById('rp-refresh-btn')?.addEventListener('click', () => {
        this._onRefreshClick();
      });
    }, { once: true });
  }

  _onRefreshClick() {
    // Re-expand: remove the hint bar and show the pipeline card again,
    // then dispatch a custom event so the host page can re-trigger research.
    const bar = document.querySelector('.pipeline-hint-bar');
    if (bar) bar.remove();

    // Dispatch event so sidepanel.js / company.js can listen and re-trigger
    document.dispatchEvent(new CustomEvent('research-pipeline-refresh', {
      detail: { company: this._company, domain: this._domain }
    }));
  }

  /**
   * stop() — tear down timers (tab closed, navigation, etc.)
   */
  stop() {
    this._stopped = true;
    clearInterval(this._timerInterval);
    clearTimeout(this._collapseTimer);
  }
}

// Export for use as a global in extension pages (no module bundler)
window.ResearchPipeline = ResearchPipeline;
