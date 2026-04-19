// coop-settings-apply-mode.js — Apply Mode: Answer Library (Phase A)
// Phase A: UI + storage + CRUD only. NO matching logic — that is Phase B.
//
// Storage key: chrome.storage.local → applyMode.answerLibrary
// Shape: { pairings: [ { id, bucket, question, answer, useVerbatim, createdAt, updatedAt } ] }

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const AM_BUCKETS = [
  { id: 'comp',  label: 'Compensation',          desc: 'Base, OTE, equity, bonus expectations' },
  { id: 'spon',  label: 'Sponsorship & Location', desc: 'Work authorization, visa, relocation, remote' },
  { id: 'avail', label: 'Availability',           desc: 'Start date, notice period, timeline' },
  { id: 'exp',   label: 'Experience',             desc: 'Years in role, specific skills, proof points' },
  { id: 'mot',   label: 'Motivation',             desc: 'Career story, drivers, what you\'re after' },
  { id: 'why',   label: 'Why this opportunity',   desc: 'Why this role, this company, this moment' },
  { id: 'other', label: 'Other',                  desc: 'Catch-all for novel questions' },
];

const STORAGE_KEY = 'applyMode';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let _pairings = [];           // master list
let _searchQuery = '';        // current search substring
let _expandedBuckets = {};    // { [bucketId]: boolean }
let _editingId = null;        // pairing id currently in edit mode (or null)
let _deletingId = null;       // pairing id showing inline delete-confirm (or null)
let _composingBucket = null;  // bucket id where the compose form is open (or null)

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────────────

function amLoad(cb) {
  chrome.storage.local.get([STORAGE_KEY], d => {
    const store = d[STORAGE_KEY] || {};
    _pairings = Array.isArray(store.answerLibrary?.pairings) ? store.answerLibrary.pairings : [];
    cb();
  });
}

function amSave() {
  chrome.storage.local.set({ [STORAGE_KEY]: { answerLibrary: { pairings: _pairings } } }, () => {
    void chrome.runtime.lastError;
    // Reuse the existing page-level save-status indicator if available
    if (typeof showSaveStatus === 'function') showSaveStatus();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UUID generation (no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function amUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

function amAdd(bucket, question, answer, useVerbatim) {
  const now = new Date().toISOString();
  const p = { id: amUuid(), bucket, question: question.trim(), answer: answer.trim(), useVerbatim: !!useVerbatim, createdAt: now, updatedAt: now };
  _pairings.push(p);
  amSave();
  return p;
}

function amUpdate(id, fields) {
  const idx = _pairings.findIndex(p => p.id === id);
  if (idx === -1) return;
  _pairings[idx] = { ..._pairings[idx], ...fields, updatedAt: new Date().toISOString() };
  amSave();
}

function amDelete(id) {
  _pairings = _pairings.filter(p => p.id !== id);
  amSave();
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / filter
// ─────────────────────────────────────────────────────────────────────────────

function amMatchesPairing(p, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  const bucket = AM_BUCKETS.find(b => b.id === p.bucket);
  return p.question.toLowerCase().includes(lower)
    || p.answer.toLowerCase().includes(lower)
    || (bucket && bucket.label.toLowerCase().includes(lower));
}

function amFilteredForBucket(bucketId) {
  return _pairings.filter(p => p.bucket === bucketId && amMatchesPairing(p, _searchQuery));
}

// ─────────────────────────────────────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

// SVG icons (inline, outline style matching the codebase)
const ICON_CARET = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_EDIT  = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 14l3-1 8-8-2-2-8 8-1 3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const ICON_DEL   = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M5 5V3h6v2M6 8v4M10 8v4M4 5l1 8h6l1-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PLUS  = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function buildBucketSelectOptions(selectedId) {
  return AM_BUCKETS.map(b =>
    `<option value="${b.id}" ${b.id === selectedId ? 'selected' : ''}>${esc(b.label)}</option>`
  ).join('');
}

function buildToggleSwitch(checked, id) {
  return `
    <label class="toggle-switch" style="flex-shrink:0;">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
      <span class="toggle-track"></span>
    </label>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: single pairing card (view or edit mode)
// ─────────────────────────────────────────────────────────────────────────────

function renderPairingCard(p) {
  const isEditing = _editingId === p.id;
  const isDeleting = _deletingId === p.id;
  const verbatimBadge = p.useVerbatim
    ? `<span class="am-pair-verbatim-badge">Use literally</span>`
    : '';
  const updatedStr = relativeTime(p.updatedAt);

  // Determine state class — deleting takes precedence over editing
  const stateClass = isDeleting ? ' deleting' : isEditing ? ' editing' : '';

  return `
  <div class="am-pair-card${stateClass}" data-pair-id="${esc(p.id)}">
    <!-- View mode -->
    <div class="am-pair-view">
      <div class="am-pair-actions">
        <button class="am-pair-action-btn" data-action="edit" title="Edit">${ICON_EDIT}</button>
        <button class="am-pair-action-btn danger" data-action="delete-start" title="Delete">${ICON_DEL}</button>
      </div>
      <div class="am-pair-q-label">Question</div>
      <div class="am-pair-q">${esc(p.question)}</div>
      <div class="am-pair-a-label">Your answer</div>
      <div class="am-pair-a">${esc(p.answer)}</div>
      <div class="am-pair-meta">
        ${verbatimBadge}
        ${updatedStr ? `<span class="am-pair-updated">Updated ${updatedStr}</span>` : ''}
      </div>
    </div>
    <!-- Delete-confirm inline prompt (replaces view body when .deleting) -->
    <div class="am-pair-delete-confirm">
      <span class="am-pair-delete-confirm-label">Delete this pairing?</span>
      <div class="am-pair-delete-confirm-btns">
        <button class="am-pair-delete-cancel-btn" data-action="delete-cancel">Cancel</button>
        <button class="am-pair-delete-btn" data-action="delete-confirm-yes">Delete pairing</button>
      </div>
    </div>
    <!-- Edit mode -->
    <div class="am-pair-edit">
      <div class="am-edit-field">
        <label class="am-edit-label" for="am-eq-${esc(p.id)}">Question</label>
        <input class="am-edit-input" id="am-eq-${esc(p.id)}" type="text" value="${esc(p.question)}" placeholder="What question does this answer?">
      </div>
      <div class="am-edit-field">
        <label class="am-edit-label" for="am-ea-${esc(p.id)}">Your answer</label>
        <textarea class="am-edit-input" id="am-ea-${esc(p.id)}" placeholder="Your standard answer…">${esc(p.answer)}</textarea>
      </div>
      <div class="am-edit-field am-edit-row">
        <div>
          <label class="am-edit-label" for="am-eb-${esc(p.id)}">Bucket</label>
          <select class="am-bucket-select" id="am-eb-${esc(p.id)}">${buildBucketSelectOptions(p.bucket)}</select>
        </div>
        <div>
          <label class="am-edit-label">&nbsp;</label>
          <div class="am-verbatim-row" style="margin-top:6px;">
            ${buildToggleSwitch(p.useVerbatim, `am-ev-${p.id}`)}
            <span class="am-verbatim-label"><strong>Use literally</strong> — paste verbatim</span>
          </div>
        </div>
      </div>
      <div class="am-edit-foot">
        <button class="am-edit-delete" data-action="delete-from-edit">Delete pairing</button>
        <button class="am-edit-cancel" data-action="cancel-edit">Cancel</button>
        <button class="am-edit-done" data-action="save-edit">Done</button>
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: inline compose form (new pairing)
// ─────────────────────────────────────────────────────────────────────────────

function renderComposeCard(bucketId) {
  const composeId = 'am-compose';
  return `
  <div class="am-compose-card" id="${composeId}" data-compose-bucket="${esc(bucketId)}">
    <div class="am-compose-title">New pairing</div>
    <div class="am-edit-field">
      <label class="am-edit-label" for="am-cq">Question</label>
      <input class="am-edit-input" id="am-cq" type="text" placeholder="What question does this answer?" autofocus>
    </div>
    <div class="am-edit-field">
      <label class="am-edit-label" for="am-ca">Your answer</label>
      <textarea class="am-edit-input" id="am-ca" placeholder="Your standard answer…"></textarea>
    </div>
    <div class="am-edit-field am-edit-row">
      <div>
        <label class="am-edit-label" for="am-cb">Bucket</label>
        <select class="am-bucket-select" id="am-cb">${buildBucketSelectOptions(bucketId)}</select>
      </div>
      <div>
        <label class="am-edit-label">&nbsp;</label>
        <div class="am-verbatim-row" style="margin-top:6px;">
          ${buildToggleSwitch(false, 'am-cv')}
          <span class="am-verbatim-label"><strong>Use literally</strong> — paste verbatim</span>
        </div>
      </div>
    </div>
    <div class="am-edit-foot">
      <button class="am-edit-cancel" data-action="cancel-compose">Cancel</button>
      <button class="am-edit-done" data-action="save-compose">Add pairing</button>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render: full library list
// ─────────────────────────────────────────────────────────────────────────────

function renderLibList() {
  const list = document.getElementById('am-lib-list');
  if (!list) return;

  // Determine which buckets are visible given the search query
  const anySearch = _searchQuery.length > 0;
  const visibleBuckets = anySearch
    ? AM_BUCKETS.filter(b => amFilteredForBucket(b.id).length > 0
        || b.label.toLowerCase().includes(_searchQuery.toLowerCase()))
    : AM_BUCKETS;

  if (anySearch && visibleBuckets.length === 0) {
    list.innerHTML = `<div class="am-no-results">No pairings match &ldquo;${esc(_searchQuery)}&rdquo;</div>`;
    return;
  }

  let html = '';
  for (const bucket of AM_BUCKETS) {
    const visible = anySearch
      ? (amFilteredForBucket(bucket.id).length > 0 || bucket.label.toLowerCase().includes(_searchQuery.toLowerCase()))
      : true;

    const filtered = amFilteredForBucket(bucket.id);
    const totalInBucket = _pairings.filter(p => p.bucket === bucket.id).length;
    const isExpanded = !!_expandedBuckets[bucket.id];

    // Most recent question preview (from all pairings, not just filtered)
    const recent = _pairings
      .filter(p => p.bucket === bucket.id)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      [0];
    const preview = recent
      ? `"${esc(recent.question)}"`
      : `No pairings yet`;
    const previewClass = recent ? '' : ' empty';

    const countStr = totalInBucket === 1 ? `<span class="n">1</span> answer` : `<span class="n">${totalInBucket}</span> answers`;

    let expandedHtml = '';
    if (isExpanded) {
      // Pairings
      let cardsHtml = '';
      if (filtered.length === 0 && !anySearch) {
        // Empty state
        cardsHtml = `
          <div class="am-empty-state">
            No answers in this bucket yet.
            <div><button class="am-empty-cta" data-action="add-pairing" data-bucket="${esc(bucket.id)}">+ Add your first pairing</button></div>
          </div>`;
      } else {
        cardsHtml = filtered.map(p => renderPairingCard(p)).join('');
      }

      // Compose form (if open for this bucket)
      const composeHtml = _composingBucket === bucket.id ? renderComposeCard(bucket.id) : '';

      expandedHtml = `
        <div class="am-expanded">
          <div class="am-expanded-head">
            <span class="am-expanded-label">${totalInBucket} pairing${totalInBucket !== 1 ? 's' : ''} in ${esc(bucket.label)}</span>
            <button class="am-add-btn" data-action="add-pairing" data-bucket="${esc(bucket.id)}">${ICON_PLUS} Add pairing</button>
          </div>
          ${composeHtml}
          ${cardsHtml}
        </div>`;
    }

    const rowStyle = visible ? '' : ' style="display:none"';
    html += `
      <div class="am-bucket-row b-${esc(bucket.id)}${isExpanded ? ' expanded' : ''}" data-bucket="${esc(bucket.id)}"${rowStyle}>
        <div class="am-bucket-row-header">
          <div class="am-row-name">${esc(bucket.label)}</div>
          <div class="am-row-preview${previewClass}">${preview}</div>
          <div class="am-row-count">${countStr}</div>
          <div class="am-row-caret">${ICON_CARET}</div>
        </div>
        ${expandedHtml}
      </div>`;
  }

  list.innerHTML = html;
  updateCounter();
  bindLibEvents();
}

// ─────────────────────────────────────────────────────────────────────────────
// Counter
// ─────────────────────────────────────────────────────────────────────────────

function updateCounter() {
  const el = document.getElementById('am-lib-counter');
  if (el) el.textContent = `7 buckets · ${_pairings.length} answer${_pairings.length !== 1 ? 's' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event delegation on the library list
// ─────────────────────────────────────────────────────────────────────────────

function bindLibEvents() {
  const list = document.getElementById('am-lib-list');
  if (!list) return;

  list.onclick = e => {
    // ── Row header click → expand/collapse ──
    const header = e.target.closest('.am-bucket-row-header');
    if (header && !e.target.closest('button')) {
      const row = header.closest('.am-bucket-row');
      const bucketId = row.dataset.bucket;
      _expandedBuckets[bucketId] = !_expandedBuckets[bucketId];
      if (!_expandedBuckets[bucketId]) _composingBucket = null; // close compose on collapse
      renderLibList();
      return;
    }

    // ── Action buttons ──
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const pairCard = btn.closest('.am-pair-card');
    const pairId = pairCard?.dataset.pairId;
    const bucketRow = btn.closest('.am-bucket-row');
    const bucketId = btn.dataset.bucket || bucketRow?.dataset.bucket;

    switch (action) {

      case 'edit': {
        _editingId = pairId;
        _deletingId = null;
        _composingBucket = null;
        renderLibList();
        // Focus question field
        const qInput = document.getElementById(`am-eq-${pairId}`);
        if (qInput) qInput.focus();
        break;
      }

      case 'cancel-edit': {
        _editingId = null;
        _deletingId = null;
        renderLibList();
        break;
      }

      case 'save-edit': {
        if (!pairId) break;
        const qEl = document.getElementById(`am-eq-${pairId}`);
        const aEl = document.getElementById(`am-ea-${pairId}`);
        const bEl = document.getElementById(`am-eb-${pairId}`);
        const vEl = document.getElementById(`am-ev-${pairId}`);
        const q = qEl?.value.trim();
        const a = aEl?.value.trim();
        if (!q || !a) {
          if (typeof prefsToast === 'function') prefsToast('Question and answer are required.', { kind: 'error' });
          return;
        }
        amUpdate(pairId, {
          question: q,
          answer: a,
          bucket: bEl?.value || _pairings.find(p => p.id === pairId)?.bucket,
          useVerbatim: !!vEl?.checked,
        });
        _editingId = null;
        renderLibList();
        break;
      }

      // View-mode trash icon — show inline confirm instead of immediate delete
      case 'delete-start': {
        if (!pairId) break;
        _deletingId = pairId;
        _editingId = null;
        renderLibList();
        break;
      }

      // Cancel from inline delete prompt — return to view mode
      case 'delete-cancel': {
        _deletingId = null;
        renderLibList();
        break;
      }

      // Confirm button in inline delete prompt — actually delete
      case 'delete-confirm-yes': {
        if (!pairId) break;
        amDelete(pairId);
        _deletingId = null;
        _editingId = null;
        renderLibList();
        break;
      }

      // Delete button inside edit mode — go directly to confirm prompt
      case 'delete-from-edit': {
        if (!pairId) break;
        _deletingId = pairId;
        _editingId = null;
        renderLibList();
        break;
      }

      case 'add-pairing': {
        _composingBucket = bucketId;
        _editingId = null;
        _expandedBuckets[bucketId] = true;
        renderLibList();
        const qEl = document.getElementById('am-cq');
        if (qEl) qEl.focus();
        break;
      }

      case 'cancel-compose': {
        _composingBucket = null;
        renderLibList();
        break;
      }

      case 'save-compose': {
        const qEl = document.getElementById('am-cq');
        const aEl = document.getElementById('am-ca');
        const bEl = document.getElementById('am-cb');
        const vEl = document.getElementById('am-cv');
        const q = qEl?.value.trim();
        const a = aEl?.value.trim();
        if (!q || !a) {
          if (typeof prefsToast === 'function') prefsToast('Question and answer are required.', { kind: 'error' });
          return;
        }
        const targetBucket = bEl?.value || _composingBucket || 'other';
        amAdd(targetBucket, q, a, vEl?.checked);
        // If bucket changed via dropdown, expand that bucket
        _expandedBuckets[targetBucket] = true;
        _composingBucket = null;
        renderLibList();
        break;
      }
    }
  };

  // ── Keyboard affordances ──
  // Per-card keydown on edit cards (edit-pairing and compose-pairing).
  // Strategy: query each rendered edit/compose card, attach a keydown listener.
  // We re-bind after every renderLibList(), so no stale handlers.

  // Helper: save the currently-editing pair (same path as clicking "Done")
  function saveEditKb(pairId) {
    const qEl = document.getElementById(`am-eq-${pairId}`);
    const aEl = document.getElementById(`am-ea-${pairId}`);
    const bEl = document.getElementById(`am-eb-${pairId}`);
    const vEl = document.getElementById(`am-ev-${pairId}`);
    const q = qEl?.value.trim();
    const a = aEl?.value.trim();
    if (!q || !a) {
      if (typeof prefsToast === 'function') prefsToast('Question and answer are required.', { kind: 'error' });
      return;
    }
    amUpdate(pairId, {
      question: q,
      answer: a,
      bucket: bEl?.value || _pairings.find(p => p.id === pairId)?.bucket,
      useVerbatim: !!vEl?.checked,
    });
    _editingId = null;
    renderLibList();
  }

  // Helper: save the compose form (same path as clicking "Add pairing")
  function saveComposeKb() {
    const qEl = document.getElementById('am-cq');
    const aEl = document.getElementById('am-ca');
    const bEl = document.getElementById('am-cb');
    const vEl = document.getElementById('am-cv');
    const q = qEl?.value.trim();
    const a = aEl?.value.trim();
    if (!q || !a) {
      if (typeof prefsToast === 'function') prefsToast('Question and answer are required.', { kind: 'error' });
      return;
    }
    const targetBucket = bEl?.value || _composingBucket || 'other';
    amAdd(targetBucket, q, a, vEl?.checked);
    _expandedBuckets[targetBucket] = true;
    _composingBucket = null;
    renderLibList();
  }

  // Attach keyboard listeners to each open edit card
  list.querySelectorAll('.am-pair-card.editing').forEach(card => {
    const pairId = card.dataset.pairId;
    card.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        _editingId = null;
        _deletingId = null;
        renderLibList();
        return;
      }
      // Enter in question input → move focus to answer textarea
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const qInput = document.getElementById(`am-eq-${pairId}`);
        if (e.target === qInput) {
          e.preventDefault();
          const aInput = document.getElementById(`am-ea-${pairId}`);
          if (aInput) aInput.focus();
          return;
        }
      }
      // Cmd/Ctrl+Enter in answer textarea → save
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const aInput = document.getElementById(`am-ea-${pairId}`);
        if (e.target === aInput) {
          e.preventDefault();
          saveEditKb(pairId);
        }
      }
    });
  });

  // Attach keyboard listeners to the compose card (if open)
  const composeCard = list.querySelector('.am-compose-card');
  if (composeCard) {
    composeCard.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        _composingBucket = null;
        renderLibList();
        return;
      }
      // Enter in question input → move focus to answer textarea
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const qInput = document.getElementById('am-cq');
        if (e.target === qInput) {
          e.preventDefault();
          const aInput = document.getElementById('am-ca');
          if (aInput) aInput.focus();
          return;
        }
      }
      // Cmd/Ctrl+Enter in answer textarea → save
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const aInput = document.getElementById('am-ca');
        if (e.target === aInput) {
          e.preventDefault();
          saveComposeKb();
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search wiring
// ─────────────────────────────────────────────────────────────────────────────

function bindSearch() {
  const input = document.getElementById('am-search');
  if (!input) return;
  input.addEventListener('input', () => {
    _searchQuery = input.value;
    // When searching, expand all buckets so results are visible
    if (_searchQuery) {
      AM_BUCKETS.forEach(b => { _expandedBuckets[b.id] = true; });
    }
    renderLibList();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Mode sub-nav wiring (for future sub-sections; currently single item)
// ─────────────────────────────────────────────────────────────────────────────

function bindAmNav() {
  const items = document.querySelectorAll('.am-nav-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.toggle('active', i === item));
      const section = item.dataset.amSection;
      document.querySelectorAll('#tab-apply-mode [id^="am-"]').forEach(s => {
        // Show/hide top-level sections
        if (s.parentElement.classList.contains('am-main')) {
          s.style.display = s.id === `am-${section}` ? '' : 'none';
        }
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialise when the Apply Mode tab is first activated
// ─────────────────────────────────────────────────────────────────────────────

let _amInitialised = false;

function initApplyMode() {
  if (_amInitialised) return;
  _amInitialised = true;

  bindAmNav();
  bindSearch();

  amLoad(() => {
    renderLibList();
  });
}

// Hook into the tab system: listen for Apply Mode tab clicks
document.addEventListener('DOMContentLoaded', () => {
  // Wire Apply Mode tab click — tab may already be active on hash load
  const applyTab = document.querySelector('[data-tab="apply-mode"]');
  if (applyTab) {
    applyTab.addEventListener('click', initApplyMode);
  }

  // Also init immediately if the hash targets apply-mode
  if (location.hash === '#apply-mode') {
    // initTabs() in coop-settings.js handles the click; we just need to init
    setTimeout(initApplyMode, 0);
  }
});
