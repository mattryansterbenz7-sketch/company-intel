// company-picker.js — Reusable company/opportunity picker modal (issue #36)
//
// API:
//   openCompanyPicker({
//     contactName:      string,           // Name of the person being associated
//     preselectCompany: string | null,    // Company name to pre-select (from profile detection)
//     onSelect(entry):  function,         // Called with the chosen savedCompanies entry
//     onCancel():       function | null,  // Called when user cancels (optional)
//   })
//
// Keyboard: ↑ ↓ navigate rows, Enter commits, Esc closes.
// Uses savedCompanies[] from chrome.storage.local — no new data sources.
// isSameCompany() logic mirrors the inline version in sidepanel.js.

(function() {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _isSameCompany(a, b) {
    if (!a || !b) return false;
    const norm = s => (s || '').toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co|ai|the|a|an)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    return false;
  }

  function _getInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  }

  // Stable palette — cycle through 5 colors based on first char
  const _BG_COLORS = ['#FC636B', '#4573D2', '#36B37E', '#7C6EF0', '#F5A623'];
  function _avatarColor(name) {
    if (!name) return _BG_COLORS[0];
    return _BG_COLORS[(name.charCodeAt(0) || 0) % _BG_COLORS.length];
  }

  function _escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Build + inject styles (once) ─────────────────────────────────────────

  let _stylesInjected = false;
  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
/* ── Company Picker Modal (issue #36) ─────────────────────────────── */
.cp-backdrop {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(30,31,33,0.50);
  display: flex; align-items: center; justify-content: center;
  animation: cp-backdrop-in var(--motion-xs,120ms) var(--ease-out,cubic-bezier(0.16,1,0.3,1));
}
@keyframes cp-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

.cp-modal {
  background: var(--ci-bg-overlay, #FFFFFF);
  border-radius: var(--ci-radius-lg, 14px);
  box-shadow: 0 24px 60px rgba(30,31,33,0.28);
  width: 480px; max-width: calc(100vw - 32px);
  overflow: hidden;
  animation: cp-modal-in var(--motion-sm,200ms) var(--ease-out,cubic-bezier(0.16,1,0.3,1));
  display: flex; flex-direction: column;
}
@keyframes cp-modal-in {
  from { opacity: 0; transform: scale(0.95) translateY(4px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}

.cp-head { padding: 18px 22px 12px; }
.cp-title { font-size: 17px; font-weight: 700; color: var(--ci-text-primary,#0A0B0D); letter-spacing: -0.01em; }
.cp-sub   { font-size: 13px; color: var(--ci-text-secondary,#6F7782); margin-top: 4px; line-height: 1.4; }

.cp-search { padding: 0 22px 12px; }
.cp-search input {
  width: 100%; padding: 9px 12px;
  background: var(--ci-bg-inset,#F9FAFB);
  border: 1px solid var(--ci-border-default,#E0E4E8);
  border-radius: var(--ci-radius-sm,8px); font-size: 13px;
  font-family: inherit; color: var(--ci-text-primary,#0A0B0D); outline: none;
}
.cp-search input:focus { border-color: var(--ci-accent-primary,#FC636B); }

.cp-list {
  max-height: 280px; overflow-y: auto;
  padding: 0 12px;
}
.cp-group-label {
  font-size: 11px; font-weight: 600;
  color: var(--ci-text-tertiary,#8A8E94);
  padding: 8px 10px 6px;
}
.cp-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--motion-xs,120ms) var(--ease-out,cubic-bezier(0.16,1,0.3,1));
}
.cp-row:hover { background: var(--ci-bg-inset,#F5F7F9); }
.cp-row.cp-selected {
  background: rgba(252,99,107,0.08);
  border-color: rgba(252,99,107,0.40);
}
.cp-row.cp-kbd-focus {
  background: var(--ci-bg-inset,#F0F2F5);
  outline: 2px solid var(--ci-accent-primary,#FC636B);
  outline-offset: -1px;
}
.cp-favicon {
  width: 28px; height: 28px; border-radius: 6px;
  color: #fff; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cp-row-name {
  font-size: 13px; font-weight: 600;
  color: var(--ci-text-primary,#0A0B0D);
}
.cp-row-role {
  font-size: 12px; font-weight: 400;
  color: var(--ci-text-tertiary,#8A8E94);
}
.cp-row-meta {
  font-size: 11px; color: var(--ci-text-tertiary,#8A8E94); margin-top: 1px;
}

.cp-stub {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 10px 12px;
  font-size: 13px; color: var(--ci-text-secondary,#6F7782);
  cursor: pointer;
  border-top: 1px solid var(--ci-border-subtle,#EAECEF);
  margin-top: 6px;
  border-radius: 0 0 0 0;
  transition: background var(--motion-xs,120ms) var(--ease-out,cubic-bezier(0.16,1,0.3,1));
}
.cp-stub:hover { background: var(--ci-bg-inset,#F5F7F9); }

.cp-foot {
  padding: 14px 22px;
  border-top: 1px solid var(--ci-border-subtle,#EAECEF);
  display: flex; justify-content: space-between; align-items: center;
  flex-shrink: 0;
}
.cp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 8px 16px; font-size: 13px; font-weight: 600;
  border-radius: 8px; cursor: pointer; border: none;
  font-family: inherit;
  transition: background var(--motion-xs,120ms) var(--ease-out,cubic-bezier(0.16,1,0.3,1));
}
.cp-btn-cancel {
  background: var(--ci-bg-raised,#FFFFFF);
  color: var(--ci-text-primary,#0A0B0D);
  border: 1px solid var(--ci-border-default,#E0E4E8);
}
.cp-btn-cancel:hover { border-color: var(--ci-border-strong,#C4CAD1); }
.cp-btn-confirm {
  background: var(--ci-accent-primary,#FC636B);
  color: #fff;
}
.cp-btn-confirm:hover { background: var(--ci-accent-primary-hover,#E04E56); }
.cp-btn-confirm:disabled {
  opacity: 0.45; cursor: default;
}
.cp-empty {
  padding: 24px 10px; text-align: center;
  font-size: 13px; color: var(--ci-text-tertiary,#8A8E94);
}
`;
    document.head.appendChild(style);
  }

  // ── Main open function ───────────────────────────────────────────────────

  window.openCompanyPicker = function({ contactName = 'Contact', preselectCompany = null, onSelect, onCancel }) {
    _injectStyles();

    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const all = (savedCompanies || []);
      const opps = all.filter(e => e.isOpportunity);
      const cos  = all.filter(e => !e.isOpportunity);

      // Sort opps by most-recent activity
      opps.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      cos.sort( (a, b) => (b.savedAt || 0) - (a.savedAt || 0));

      // Find pre-selected entry
      let preselectedId = null;
      if (preselectCompany) {
        const match = all.find(e => _isSameCompany(e.company, preselectCompany));
        if (match) preselectedId = match.id;
      }

      let selectedId = preselectedId;
      let kbdFocusId = preselectedId; // keyboard navigation cursor
      let filterText = '';

      // ── DOM build ──────────────────────────────────────────────────────

      const backdrop = document.createElement('div');
      backdrop.className = 'cp-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-label', `Associate ${contactName} with a company`);

      backdrop.innerHTML = `
        <div class="cp-modal" id="cp-modal">
          <div class="cp-head">
            <div class="cp-title">Associate ${_escapeHtml(contactName)} with&hellip;</div>
            <div class="cp-sub">Contacts live on companies. Pick which one.</div>
          </div>
          <div class="cp-search">
            <input id="cp-search-input" placeholder="Search companies or opportunities&hellip;" autocomplete="off" />
          </div>
          <div class="cp-list" id="cp-list"></div>
          <div class="cp-stub" id="cp-stub">+ Save ${_escapeHtml(contactName)} without associating to anyone</div>
          <div class="cp-foot">
            <button class="cp-btn cp-btn-cancel" id="cp-cancel-btn">Cancel</button>
            <button class="cp-btn cp-btn-confirm" id="cp-confirm-btn" disabled>Associate with&hellip;</button>
          </div>
        </div>`;

      document.body.appendChild(backdrop);

      const searchInput = backdrop.querySelector('#cp-search-input');
      const listEl      = backdrop.querySelector('#cp-list');
      const stubEl      = backdrop.querySelector('#cp-stub');
      const cancelBtn   = backdrop.querySelector('#cp-cancel-btn');
      const confirmBtn  = backdrop.querySelector('#cp-confirm-btn');

      // ── Render list ───────────────────────────────────────────────────

      function getFilteredEntries() {
        const q = filterText.toLowerCase();
        const filterFn = e => !q || (e.company || '').toLowerCase().includes(q) || (e.jobTitle || '').toLowerCase().includes(q);
        return {
          filteredOpps: opps.filter(filterFn),
          filteredCos:  cos.filter(filterFn),
        };
      }

      function getSelectedEntry() {
        return selectedId ? all.find(e => e.id === selectedId) : null;
      }

      function updateConfirmBtn() {
        const sel = getSelectedEntry();
        if (sel) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Associate with ${sel.company}`;
        } else {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Associate with\u2026';
        }
      }

      function rowHtml(entry) {
        const initials  = _getInitials(entry.company);
        const bgColor   = _avatarColor(entry.company);
        const isSelected = entry.id === selectedId;
        const isKbd      = entry.id === kbdFocusId;
        const cls = ['cp-row', isSelected ? 'cp-selected' : '', isKbd ? 'cp-kbd-focus' : ''].filter(Boolean).join(' ');
        const nameHtml = entry.isOpportunity && entry.jobTitle
          ? `${_escapeHtml(entry.company)} <span class="cp-row-role">· ${_escapeHtml(entry.jobTitle)}</span>`
          : _escapeHtml(entry.company);
        const contactCount = (entry.knownContacts || []).length;
        let meta = '';
        if (entry.isOpportunity) {
          const stage = entry.jobStage || entry.status || '';
          const stageLabel = stage.replace(/_/g, ' ');
          meta = [stageLabel, `${contactCount} contact${contactCount !== 1 ? 's' : ''}`].filter(Boolean).join(' · ');
          if (isSelected && preselectCompany && _isSameCompany(entry.company, preselectCompany)) {
            meta += ' · matches current company';
          }
        } else {
          meta = `${contactCount} contact${contactCount !== 1 ? 's' : ''}`;
        }
        return `<div class="${cls}" data-id="${_escapeHtml(entry.id)}" data-company="${_escapeHtml(entry.company)}" role="option" aria-selected="${isSelected}">
          <div class="cp-favicon" style="background:${bgColor}">${_escapeHtml(initials)}</div>
          <div>
            <div class="cp-row-name">${nameHtml}</div>
            <div class="cp-row-meta">${_escapeHtml(meta)}</div>
          </div>
        </div>`;
      }

      function renderList() {
        const { filteredOpps, filteredCos } = getFilteredEntries();
        let html = '';
        if (filteredOpps.length) {
          html += `<div class="cp-group-label">Opportunities</div>`;
          html += filteredOpps.map(rowHtml).join('');
        }
        if (filteredCos.length) {
          html += `<div class="cp-group-label">Companies</div>`;
          html += filteredCos.map(rowHtml).join('');
        }
        if (!filteredOpps.length && !filteredCos.length) {
          html = `<div class="cp-empty">No results match "${_escapeHtml(filterText)}"</div>`;
        }
        listEl.innerHTML = html;
        updateConfirmBtn();
      }

      renderList();

      // Auto-scroll pre-selected row into view
      if (preselectedId) {
        requestAnimationFrame(() => {
          const el = listEl.querySelector(`[data-id="${preselectedId}"]`);
          if (el) el.scrollIntoView({ block: 'nearest' });
        });
      }

      // ── Focus search ─────────────────────────────────────────────────
      requestAnimationFrame(() => searchInput.focus());

      // ── Events ──────────────────────────────────────────────────────

      searchInput.addEventListener('input', () => {
        filterText = searchInput.value.trim();
        // Reset selection if it would disappear from filtered view
        if (selectedId && filterText) {
          const { filteredOpps, filteredCos } = getFilteredEntries();
          const visible = [...filteredOpps, ...filteredCos];
          if (!visible.find(e => e.id === selectedId)) {
            // keep selection — user can still confirm even if row is filtered
          }
        }
        renderList();
      });

      // Row click — select
      listEl.addEventListener('click', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        const id = row.dataset.id;
        selectedId = id;
        kbdFocusId = id;
        renderList();
      });

      // Confirm
      function commitSelection() {
        const sel = getSelectedEntry();
        if (!sel) return;
        close();
        onSelect(sel);
      }

      confirmBtn.addEventListener('click', commitSelection);

      // Cancel
      function close() {
        backdrop.style.animation = `cp-backdrop-in var(--motion-xs,120ms) var(--ease-in,cubic-bezier(0.7,0,0.84,0)) reverse`;
        setTimeout(() => backdrop.remove(), 130);
      }

      cancelBtn.addEventListener('click', () => {
        close();
        onCancel?.();
      });

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          close();
          onCancel?.();
        }
      });

      // Stub — "save without associating" coming-soon toast
      stubEl.addEventListener('click', () => {
        // Stub: show coming-soon toast and close
        close();
        // Dispatch to whatever showToast is available on the page
        if (typeof showToast === 'function') {
          showToast('Unaffiliated contacts store is coming soon');
        } else {
          // Fallback: create a transient notification
          const t = document.createElement('div');
          t.textContent = 'Unaffiliated contacts coming soon';
          Object.assign(t.style, {
            position: 'fixed', bottom: '16px', left: '16px', right: '16px',
            background: 'var(--ci-bg-inset,#EBEDF0)', color: 'var(--ci-text-primary,#0A0B0D)',
            padding: '10px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
            border: '1px solid var(--ci-border-default,#E0E4E8)', zIndex: 9999,
            transition: 'opacity 0.3s', opacity: '0',
          });
          document.body.appendChild(t);
          requestAnimationFrame(() => { t.style.opacity = '1'; });
          setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, 3000);
        }
      });

      // ── Keyboard navigation ──────────────────────────────────────────

      backdrop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          close();
          onCancel?.();
          return;
        }
        if (e.key === 'Enter') {
          if (selectedId) {
            commitSelection();
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const { filteredOpps, filteredCos } = getFilteredEntries();
          const flat = [...filteredOpps, ...filteredCos];
          if (!flat.length) return;
          const curIdx = flat.findIndex(e => e.id === kbdFocusId);
          let nextIdx;
          if (e.key === 'ArrowDown') {
            nextIdx = curIdx < 0 ? 0 : Math.min(curIdx + 1, flat.length - 1);
          } else {
            nextIdx = curIdx <= 0 ? 0 : curIdx - 1;
          }
          kbdFocusId = flat[nextIdx].id;
          selectedId = kbdFocusId;
          renderList();
          requestAnimationFrame(() => {
            const el = listEl.querySelector(`[data-id="${kbdFocusId}"]`);
            if (el) el.scrollIntoView({ block: 'nearest' });
          });
          return;
        }
      });
    });
  };

})();
