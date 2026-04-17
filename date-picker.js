/**
 * date-picker.js — Coop.ai custom date picker
 * Replaces every <input type="date"> with a styled calendar popover.
 * No dependencies. ISO YYYY-MM-DD value contract unchanged.
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const TODAY_ISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  function toISO(year, month, day) {
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function parseISO(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return { year: y, month: m - 1, day: d };
  }

  function formatDisplay(iso) {
    const p = parseISO(iso);
    if (!p) return 'No date';
    const d = new Date(p.year, p.month, p.day);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function firstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
  }

  // ── State ─────────────────────────────────────────────────────────────────

  let activePopover = null; // { el, input, trigger, focusedDate }

  function closeActive(select) {
    if (!activePopover) return;
    const { el, trigger, onClose } = activePopover;
    // Animate close
    el.style.transition = `opacity var(--motion-xs) var(--ease-in), transform var(--motion-xs) var(--ease-in)`;
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 130);
    if (onClose) onClose(select);
    trigger.focus();
    activePopover = null;
  }

  // ── Popover positioning ───────────────────────────────────────────────────

  function positionPopover(popover, trigger) {
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = 288;
    const ph = 320; // approx height

    let top = rect.bottom + 6;
    let left = rect.left;

    // Flip up if clipped below
    if (top + ph > vh - 8) {
      top = rect.top - ph - 6;
    }

    // Align right edge if clipped right
    if (left + pw > vw - 8) {
      left = rect.right - pw;
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  // ── Grid builder ──────────────────────────────────────────────────────────

  function buildGrid(container, year, month, selectedISO, focusedISO, onSelect) {
    container.innerHTML = '';
    const todayISO = TODAY_ISO();
    const first = firstDayOfMonth(year, month);
    const total = daysInMonth(year, month);

    // Days from prev month
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear  = month === 0 ? year - 1 : year;
    const prevTotal = daysInMonth(prevYear, prevMonth);

    const cells = [];

    // Leading outside days
    for (let i = first - 1; i >= 0; i--) {
      cells.push({ year: prevYear, month: prevMonth, day: prevTotal - i, outside: true });
    }
    // Current month days
    for (let d = 1; d <= total; d++) {
      cells.push({ year, month, day: d, outside: false });
    }
    // Trailing outside days
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear  = month === 11 ? year + 1 : year;
    let trail = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ year: nextYear, month: nextMonth, day: trail++, outside: true });
    }

    cells.forEach((c, idx) => {
      const iso = toISO(c.year, c.month, c.day);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'coop-date-day';
      btn.textContent = c.day;
      btn.dataset.iso = iso;
      btn.setAttribute('tabindex', iso === focusedISO ? '0' : '-1');
      btn.setAttribute('aria-label', new Date(c.year, c.month, c.day).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));

      if (c.outside) btn.classList.add('outside');
      if (iso === todayISO) btn.classList.add('today');
      if (iso === selectedISO) btn.classList.add('selected');

      btn.addEventListener('click', () => {
        if (c.outside) {
          // Jump to that month and select
          onSelect(iso, c.year, c.month);
        } else {
          onSelect(iso, null, null);
        }
      });

      container.appendChild(btn);
    });
  }

  // ── Open popover ──────────────────────────────────────────────────────────

  function openPopover(input, trigger) {
    if (activePopover) closeActive(false);

    const selectedISO = input.value || null;
    const todayISO = TODAY_ISO();
    const todayP = parseISO(todayISO);

    let viewYear  = selectedISO ? parseISO(selectedISO).year  : todayP.year;
    let viewMonth = selectedISO ? parseISO(selectedISO).month : todayP.month;
    let focusedISO = selectedISO || todayISO;

    // ── Build DOM ──
    const popover = document.createElement('div');
    popover.className = 'coop-date-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Date picker');
    popover.setAttribute('aria-modal', 'true');

    // Header
    const header = document.createElement('div');
    header.className = 'coop-date-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'coop-date-nav';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 2.5L4.5 7L8.5 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const title = document.createElement('span');
    title.className = 'coop-date-title';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'coop-date-nav';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 2.5L9.5 7L5.5 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    header.appendChild(prevBtn);
    header.appendChild(title);
    header.appendChild(nextBtn);

    // DOW row
    const dowRow = document.createElement('div');
    dowRow.className = 'coop-date-dow';
    ['S','M','T','W','T','F','S'].forEach(d => {
      const s = document.createElement('span');
      s.textContent = d;
      dowRow.appendChild(s);
    });

    // Grid
    const grid = document.createElement('div');
    grid.className = 'coop-date-grid';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'coop-date-footer';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.textContent = 'Today';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'clear';
    clearBtn.textContent = 'Clear';

    footer.appendChild(todayBtn);
    footer.appendChild(clearBtn);

    popover.appendChild(header);
    popover.appendChild(dowRow);
    popover.appendChild(grid);
    popover.appendChild(footer);

    document.body.appendChild(popover);

    // ── Render function ──
    function render(animateGrid) {
      title.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
      if (animateGrid) {
        grid.style.opacity = '0';
        setTimeout(() => {
          buildGrid(grid, viewYear, viewMonth, selectedISO, focusedISO, handleSelect);
          grid.style.transition = `opacity var(--motion-xs) var(--ease-out)`;
          grid.style.opacity = '1';
          focusDay();
        }, 60);
      } else {
        buildGrid(grid, viewYear, viewMonth, selectedISO, focusedISO, handleSelect);
        grid.style.opacity = '1';
      }
    }

    function focusDay() {
      const target = grid.querySelector(`[data-iso="${focusedISO}"]`) ||
                     grid.querySelector('[tabindex="0"]') ||
                     grid.querySelector('.coop-date-day');
      if (target) target.focus();
    }

    function handleSelect(iso, jumpYear, jumpMonth) {
      // Update hidden input
      input.value = iso;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      updateTriggerText(trigger, iso);
      closeActive(true);
    }

    // ── Nav ──
    function navigate(dYear, dMonth) {
      viewMonth += dMonth;
      viewYear  += dYear;
      if (viewMonth > 11) { viewMonth -= 12; viewYear++; }
      if (viewMonth < 0)  { viewMonth += 12; viewYear--; }
      // Keep focused date visible
      const focusDays = daysInMonth(viewYear, viewMonth);
      const fp = parseISO(focusedISO);
      if (fp) {
        const clampedDay = Math.min(fp.day, focusDays);
        focusedISO = toISO(viewYear, viewMonth, clampedDay);
      } else {
        focusedISO = toISO(viewYear, viewMonth, 1);
      }
      render(true);
    }

    prevBtn.addEventListener('click', () => navigate(0, -1));
    nextBtn.addEventListener('click', () => navigate(0, 1));

    todayBtn.addEventListener('click', () => {
      const tp = parseISO(todayISO);
      viewYear  = tp.year;
      viewMonth = tp.month;
      focusedISO = todayISO;
      render(true);
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      updateTriggerText(trigger, '');
      closeActive(false);
    });

    // ── Keyboard navigation ──
    popover.addEventListener('keydown', (e) => {
      const fp = parseISO(focusedISO);
      if (!fp) return;

      let { year: fy, month: fm, day: fd } = fp;
      let handled = true;

      switch (e.key) {
        case 'ArrowLeft':
          fd--; break;
        case 'ArrowRight':
          fd++; break;
        case 'ArrowUp':
          fd -= 7; break;
        case 'ArrowDown':
          fd += 7; break;
        case 'PageUp':
          if (e.shiftKey) { fy--; } else { fm--; }
          break;
        case 'PageDown':
          if (e.shiftKey) { fy++; } else { fm++; }
          break;
        case 'Home':
          fd = 1; break;
        case 'End':
          fd = daysInMonth(fy, fm); break;
        case 'Enter':
        case ' ':
          if (document.activeElement && document.activeElement.dataset.iso) {
            const iso = document.activeElement.dataset.iso;
            const p = parseISO(iso);
            handleSelect(iso, null, null);
          }
          return;
        case 'Escape':
          closeActive(false);
          return;
        case 't':
        case 'T': {
          const tp = parseISO(todayISO);
          viewYear  = tp.year;
          viewMonth = tp.month;
          focusedISO = todayISO;
          render(true);
          return;
        }
        default:
          handled = false;
      }

      if (!handled) return;
      e.preventDefault();

      // Normalize date overflow
      let newDate = new Date(fy, fm, fd);
      fy = newDate.getFullYear();
      fm = newDate.getMonth();
      fd = newDate.getDate();
      focusedISO = toISO(fy, fm, fd);

      // Navigate to new month if needed
      if (fy !== viewYear || fm !== viewMonth) {
        viewYear  = fy;
        viewMonth = fm;
        render(false);
        // After re-render, focus the right day
        setTimeout(() => {
          const t = grid.querySelector(`[data-iso="${focusedISO}"]`);
          if (t) { t.setAttribute('tabindex','0'); t.focus(); }
        }, 10);
      } else {
        // Update tabindex + focus within current grid
        grid.querySelectorAll('.coop-date-day').forEach(b => b.setAttribute('tabindex','-1'));
        const t = grid.querySelector(`[data-iso="${focusedISO}"]`);
        if (t) { t.setAttribute('tabindex','0'); t.focus(); }
      }
    });

    // ── Outside click ──
    const outsideHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== trigger) {
        closeActive(false);
        document.removeEventListener('mousedown', outsideHandler, true);
      }
    };
    document.addEventListener('mousedown', outsideHandler, true);

    // ── Position + animate in ──
    positionPopover(popover, trigger);
    popover.style.opacity = '0';
    popover.style.transform = 'translateY(-4px)';
    popover.style.transition = `opacity var(--motion-sm) var(--ease-out), transform var(--motion-sm) var(--ease-out)`;

    render(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        popover.style.opacity = '1';
        popover.style.transform = 'translateY(0)';
        // Move focus to selected/today day
        setTimeout(focusDay, 50);
      });
    });

    activePopover = { el: popover, input, trigger, onClose: null };
  }

  // ── Trigger text ──────────────────────────────────────────────────────────

  function updateTriggerText(trigger, iso) {
    trigger.textContent = formatDisplay(iso);
    trigger.classList.toggle('has-value', !!iso);
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function initDatePicker(input) {
    if (input.dataset.coopDateInit) return;
    input.dataset.coopDateInit = '1';

    // Save current value before hiding
    const currentValue = input.value;

    // Hide native input (keep in DOM for value/form/storage compat)
    input.type = 'hidden';

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'coop-date-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');

    // Carry over any classes from the original input for styling context
    if (input.className) {
      const classes = input.className.split(' ').filter(c => c && c !== 'has-value');
      classes.forEach(c => trigger.classList.add(c));
    }

    updateTriggerText(trigger, currentValue);
    input.parentNode.insertBefore(trigger, input.nextSibling);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover(input, trigger);
    });
    // The original input often had a mousedown stopPropagation to prevent
    // parent drag/swipe handlers from stealing the interaction. Hidden
    // inputs can't receive mousedown, so carry that guard to the trigger.
    trigger.addEventListener('mousedown', (e) => e.stopPropagation());

    // Listen for 'change' on the (hidden) input so external programmatic
    // value changes refresh the trigger display.
    input.addEventListener('change', () => {
      updateTriggerText(trigger, input.value);
    });
  }

  function initAll() {
    const inputs = document.querySelectorAll('input[type="date"]:not([data-coop-date-init])');
    inputs.forEach(initDatePicker);
    // Also catch hidden ones that were already converted (they are now type=hidden)
    // MutationObserver handles future ones
    console.log('[DatePicker] Initialized', inputs.length, 'inputs');
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  // Handle dynamically-inserted inputs (Kanban cards, dialogs)
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('input[type="date"]')) {
          initDatePicker(node);
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('input[type="date"]:not([data-coop-date-init])').forEach(initDatePicker);
        }
      });
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Public API for manual init (e.g., after innerHTML replacement)
  window.CoopDatePicker = { init: initDatePicker };

})();
