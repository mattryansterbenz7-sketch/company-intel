// opp-shell.js — Shared header + Next Steps strip renderers
// Loaded by company.html and opportunity.html after ui-utils.js.
// Exports two pure HTML functions attached to window:
//   renderOppShellHeader(entry, options) → HTML string
//   renderNextStepsStrip(entry, options) → HTML string
//
// Depends on globals from ui-utils.js:
//   escapeHtml, defaultActionStatus, stageTypeVisual
//
// Follow-up note: scoreToVerdict() in ui-utils.js uses different thresholds
// (high ≥8, mid ≥6.5, possible ≥5, mixed ≥3) than the memory-rule spectrum
// (green ≥7.5, amber ≥6.0, orange ≥4.5, red <4.5). This file implements
// the memory-correct spectrum inline rather than modifying scoreToVerdict,
// to avoid regressions on other surfaces (saved.js, etc.).

// ── Score color + verdict ─────────────────────────────────────────────────

/** Return CSS class suffix for the score number per memory rule. */
function _oshScoreClass(score) {
  if (!score || isNaN(score)) return '';
  if (score >= 7.5) return 'osh-score-green';
  if (score >= 6.0) return 'osh-score-amber';
  if (score >= 4.5) return 'osh-score-orange';
  return 'osh-score-red';
}

/** Sentence-case verdict label per memory rule. */
function _oshVerdict(score) {
  if (!score || isNaN(score)) return '';
  if (score >= 7.5) return 'Strong fit';
  if (score >= 6.0) return 'Okay fit';
  return 'Weak fit';
}

// ── Stage pill CSS class ──────────────────────────────────────────────────

/**
 * Map stageType + actionStatus → one of the 5 semantic pill classes.
 * Logic per the Opus bridge decisions:
 *   outreach         → amber (pending-their-action)
 *   active + my-court → coral (my-court-active)
 *   active + their   → amber (active-their-court)
 *   queue/paused     → dormant (gray)
 *   closed_lost      → lost
 *   closed-won (accepted / key.includes('won')) → won (teal)
 */
function _oshStagePillClass(stageType, stageKey, actionStatus) {
  // Closed-won: accepted stage OR key contains 'won'
  if (stageKey === 'accepted' || (stageKey || '').includes('won')) return 'osh-stage-won';
  // Closed-lost
  if (stageType === 'closed_lost') return 'osh-stage-lost';
  // Dormant
  if (stageType === 'queue' || stageType === 'paused') return 'osh-stage-dormant';
  // Outreach — awaiting response
  if (stageType === 'outreach') return 'osh-stage-outreach';
  // Active — split by court
  if (stageType === 'active') {
    const myCourtDefault = defaultActionStatus(stageKey || '') === 'my_court';
    const isMyCourt = actionStatus === 'my_court' || (!actionStatus && myCourtDefault);
    return isMyCourt ? 'osh-stage-active-my-court' : 'osh-stage-active-their-court';
  }
  // Unknown — fall back to outreach-amber
  return 'osh-stage-outreach';
}

// ── Action chip CSS class ─────────────────────────────────────────────────

function _oshActionChipClass(actionStatus) {
  if (actionStatus === 'my_court')    return 'osh-my-court';
  if (actionStatus === 'their_court') return 'osh-their-court';
  return '';
}

function _oshActionChipLabel(actionStatus) {
  if (actionStatus === 'my_court')    return 'My court';
  if (actionStatus === 'their_court') return 'Their court';
  return 'No action set';
}

// ── Blurb extraction ──────────────────────────────────────────────────────

/**
 * Extract a 1–2 sentence blurb from the entry.
 * Priority: entry.intelligence.businessOverview → entry.intelligence.oneLiner
 *           → entry.oneLiner → entry.intelligence (string) → null
 */
function _oshBlurb(entry) {
  const intel = entry.intelligence;
  if (intel && typeof intel === 'object') {
    const overview = intel.businessOverview || intel.oneLiner || intel.description || '';
    if (overview) {
      // Take first 1–2 sentences (max ~220 chars for blurb slot)
      const sentences = overview.match(/[^.!?]+[.!?]+/g) || [];
      const blurb = sentences.slice(0, 2).join(' ').trim() || overview.slice(0, 220).trim();
      return blurb || null;
    }
    // Try other intel keys
    const summary = intel.productOverview || intel.summary || '';
    if (summary) return summary.slice(0, 220).trim();
  }
  if (entry.oneLiner) return entry.oneLiner;
  if (typeof intel === 'string' && intel.length > 10) return intel.slice(0, 220).trim();
  return null;
}

// ── Firmographic chip builder ─────────────────────────────────────────────

function _buildChip(svgContent, label, extraClass) {
  return `<span class="osh-data-chip${extraClass ? ' ' + extraClass : ''}">${svgContent}<span class="osh-dc-val">${escapeHtml(label)}</span></span>`;
}

/** Check whether a funding date is within the past 12 months. */
function _isFundingRecent(entry) {
  const announced = entry.fundingDate || entry.lastFundingDate || null;
  if (!announced) return false;
  const ts = new Date(announced).getTime();
  if (isNaN(ts)) return false;
  return (Date.now() - ts) < 365 * 24 * 60 * 60 * 1000;
}

function _humanizeEmployees(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already has "employees" in it — return as-is
  if (/employee/i.test(s)) return s;
  // Add "employees" suffix
  return s + ' employees';
}

function _buildFirmographicChips(entry) {
  const chips = [];

  // SVG icons — 13×13, stroke currentColor
  const iconBuilding = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>`;
  const iconPeople   = `<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6"/><circle cx="17" cy="7" r="2.5"/><path d="M22 20c0-3-2.5-5-5-5"/></svg>`;
  const iconTrend    = `<svg viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;
  const iconPin      = `<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

  // Industry chip
  if (entry.industry) {
    chips.push(_buildChip(iconBuilding, entry.industry, ''));
  }

  // Employees chip
  const emp = _humanizeEmployees(entry.employees);
  if (emp) {
    chips.push(_buildChip(iconPeople, emp, ''));
  }

  // Funding chip
  if (entry.funding || entry.fundingStage) {
    let label = '';
    if (entry.fundingStage && entry.funding) {
      label = `${entry.fundingStage} · ${entry.funding}`;
    } else if (entry.fundingStage) {
      label = entry.fundingStage;
    } else {
      label = entry.funding;
    }
    const isRecent = _isFundingRecent(entry);
    chips.push(_buildChip(iconTrend, label, isRecent ? 'osh-funding-recent' : ''));
  }

  // Location chip
  if (entry.location) {
    chips.push(_buildChip(iconPin, entry.location, ''));
  }

  return chips.join('');
}

// ── Action buttons (website, LinkedIn) ───────────────────────────────────

function _buildActions(entry) {
  const btnParts = [];

  const iconGlobe = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>`;
  const iconLI    = `<svg viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`;

  if (entry.companyWebsite) {
    const url = escapeHtml(entry.companyWebsite);
    btnParts.push(`<a class="osh-ghost-btn" href="${url}" target="_blank" rel="noopener" title="Open website">${iconGlobe}</a>`);
  }

  if (entry.companyLinkedin) {
    const url = escapeHtml(entry.companyLinkedin);
    btnParts.push(`<a class="osh-ghost-btn" href="${url}" target="_blank" rel="noopener" title="Open LinkedIn">${iconLI}</a>`);
  }

  return btnParts.join('');
}

// ── Main renderer: renderOppShellHeader ──────────────────────────────────

/**
 * Render the full opp/company shell header HTML.
 *
 * @param {Object} entry           — saved company/opportunity entry
 * @param {Object} [options]
 * @param {Array}  [options.stages] — stages array for stageType lookup
 * @returns {string} HTML string
 */
function renderOppShellHeader(entry, options = {}) {
  const stages = options.stages || [];

  // ── Logo / favicon ────────────────────────────────────────────────────
  const faviconDomain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const logoHtml = faviconDomain
    ? `<img class="osh-logo" src="https://www.google.com/s2/favicons?domain=${escapeHtml(faviconDomain)}&sz=64" alt="" onerror="this.style.display='none';this.nextElementSibling?.style.removeProperty('display')">`
      + `<span class="osh-logo-placeholder" style="display:none">${escapeHtml((entry.company || '?')[0])}</span>`
    : `<span class="osh-logo-placeholder">${escapeHtml((entry.company || '?')[0])}</span>`;

  // ── Company name ──────────────────────────────────────────────────────
  const nameHtml = `<span class="osh-company-name">${escapeHtml(entry.company || '')}</span>`;

  // ── Role link pill (opportunity only) ────────────────────────────────
  let roleLinkHtml = '';
  if (entry.isOpportunity && entry.jobTitle) {
    const jobUrl = entry.jobUrl ? escapeHtml(entry.jobUrl) : '';
    const externalSvg = `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    if (jobUrl) {
      roleLinkHtml = `<a class="osh-role-link" href="${jobUrl}" target="_blank" rel="noopener" title="Open job posting">${escapeHtml(entry.jobTitle)}${externalSvg}</a>`;
    } else {
      roleLinkHtml = `<span class="osh-role-link" style="cursor:default">${escapeHtml(entry.jobTitle)}</span>`;
    }
  }

  // ── Status cluster ────────────────────────────────────────────────────
  // Stage pill
  const currentStageKey = entry.isOpportunity ? (entry.jobStage || 'needs_review') : (entry.status || 'co_watchlist');
  const currentStageObj = stages.find(s => s.key === currentStageKey) || {};
  const stageType = currentStageObj.stageType || (entry.isOpportunity ? 'queue' : 'active');
  const stageLabel = currentStageObj.label || currentStageKey;
  const derivedActionStatus = (typeof defaultActionStatus === 'function')
    ? defaultActionStatus(currentStageKey)
    : null;
  const actionStatus = entry.actionStatus || derivedActionStatus || null;
  const pillClass = _oshStagePillClass(stageType, currentStageKey, actionStatus);
  const stagePillHtml = `<span class="osh-stage-pill ${pillClass}"><span class="osh-stage-dot"></span>${escapeHtml(stageLabel)}</span>`;

  // Action chip (opportunity only) — uses derived default if entry.actionStatus is unset
  let actionChipHtml = '';
  if (entry.isOpportunity && actionStatus) {
    const chipClass = _oshActionChipClass(actionStatus);
    const chipLabel = _oshActionChipLabel(actionStatus);
    actionChipHtml = `<span class="osh-action-chip${chipClass ? ' ' + chipClass : ''}"><span class="osh-action-dot"></span>${escapeHtml(chipLabel)}</span>`;
  }

  // Score chip (opportunity with a score only)
  let scoreChipHtml = '';
  if (entry.isOpportunity && entry.fitScore != null) {
    const score = parseFloat(entry.fitScore);
    if (!isNaN(score)) {
      const scoreClass = _oshScoreClass(score);
      const verdict = _oshVerdict(score);
      const displayScore = score % 1 === 0 ? score.toFixed(0) : score.toFixed(1);
      scoreChipHtml = `<span class="osh-score-chip"><span class="osh-score-num ${scoreClass}">${escapeHtml(displayScore)}</span><span class="osh-score-label">${escapeHtml(verdict)}</span></span>`;
    }
  }

  const statusClusterHtml = `<div class="osh-status-cluster">${stagePillHtml}${actionChipHtml}${scoreChipHtml}</div>`;

  // Row 1
  const row1Html = `<div class="osh-row-identity">${logoHtml}${nameHtml}${roleLinkHtml}${statusClusterHtml}</div>`;

  // ── Row 2: Blurb ──────────────────────────────────────────────────────
  let row2Html = '';
  const blurb = _oshBlurb(entry);
  if (blurb) {
    // Check if there is fuller intelligence to show on expand
    const intel = entry.intelligence;
    let expandContent = '';
    if (intel && typeof intel === 'object') {
      const full = intel.businessOverview || intel.summary || '';
      if (full && full.length > blurb.length + 20) {
        expandContent = escapeHtml(full);
      }
    } else if (typeof intel === 'string' && intel.length > blurb.length + 20) {
      expandContent = escapeHtml(intel);
    }

    const expandBtn = expandContent
      ? `<button class="osh-blurb-more-btn" data-target="osh-blurb-exp">Show more ↓</button>`
      : '';
    const expandDiv = expandContent
      ? `<div class="osh-blurb-expanded" id="osh-blurb-exp">${expandContent}</div>`
      : '';

    row2Html = `<div class="osh-row-blurb"><span class="osh-blurb-text">${escapeHtml(blurb)}</span>${expandBtn}</div>${expandDiv}`;
  }

  // ── Row 3: Data chips + actions ───────────────────────────────────────
  const chipsHtml = _buildFirmographicChips(entry);
  const actionsHtml = _buildActions(entry);
  const row3Html = (chipsHtml || actionsHtml)
    ? `<div class="osh-row-data">${chipsHtml}<div class="osh-header-actions">${actionsHtml}</div></div>`
    : '';

  return `<div class="opp-shell-header">${row1Html}${row2Html}${row3Html}</div>`;
}

// ── Next Steps strip: renderNextStepsStrip ────────────────────────────────

/**
 * Detect the most recent past interaction for "Last" slot.
 * Returns { label, timestamp } or null.
 */
function _oshLastActivity(entry) {
  const candidates = [];
  const BULK_RE = /noreply|no-reply|notifications?@|mailer-daemon|newsletter|digest@|linkedin\.com|updates?@|marketing@/i;

  // Emails
  (entry.cachedEmails || []).forEach(thread => {
    const fromRaw = thread.from || (thread.messages?.[0]?.from) || '';
    if (BULK_RE.test(fromRaw)) return;
    let ts = 0;
    if (thread.messages?.length) {
      const lastMsg = thread.messages[thread.messages.length - 1];
      ts = new Date(lastMsg.date).getTime();
    }
    if (!ts || isNaN(ts)) ts = thread.date ? new Date(thread.date).getTime() : 0;
    if (!ts || isNaN(ts)) ts = thread.internalDate ? parseInt(thread.internalDate) : 0;
    if (!ts || isNaN(ts)) return;
    const subject = thread.subject || 'Email';
    candidates.push({ timestamp: ts, label: 'Email: ' + subject.slice(0, 50) });
  });

  // Meetings (past)
  const now = Date.now();
  (entry.cachedMeetings || []).forEach(m => {
    const ts = m.createdAt ? new Date(m.createdAt).getTime() : (m.date ? new Date(m.date).getTime() : 0);
    if (!ts || isNaN(ts) || ts > now) return;
    candidates.push({ timestamp: ts, label: 'Call: ' + (m.title || 'Meeting').slice(0, 50) });
  });

  // Activity log
  (entry.activityLog || []).forEach(log => {
    const ts = log.date ? new Date(log.date).getTime() : 0;
    if (!ts || isNaN(ts)) return;
    candidates.push({ timestamp: ts, label: log.note ? log.note.slice(0, 50) : 'Activity' });
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  const best = candidates[0];
  return { label: best.label, timestamp: best.timestamp };
}

/** Format a timestamp as a short relative or calendar string. */
function _oshFormatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Format an upcoming date as "Thu 2pm" style. */
function _oshFormatUpcoming(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayName = days[d.getDay()];
  const hours = d.getHours();
  const mins = d.getMinutes();
  if (hours === 0 && mins === 0) {
    // Date-only — just show day + date
    return `${dayName} ${d.getMonth() + 1}/${d.getDate()}`;
  }
  const period = hours >= 12 ? 'pm' : 'am';
  const h = hours % 12 || 12;
  return mins === 0 ? `${dayName} ${h}${period}` : `${dayName} ${h}:${String(mins).padStart(2,'0')}${period}`;
}

/**
 * Detect the Next item from cachedCalendarEvents or entry.nextStep.
 * Returns { label, dateStr, contact } or null.
 */
function _oshNextItem(entry) {
  const now = Date.now();

  // 1. Upcoming calendar event (within 14 days)
  const twoWeeks = now + 14 * 24 * 60 * 60 * 1000;
  const events = (entry.cachedCalendarEvents || [])
    .filter(e => { const t = new Date(e.start).getTime(); return t > now && t <= twoWeeks; })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (events.length) {
    const evt = events[0];
    const attendees = evt.attendees || evt.attendeeNames || '';
    // Pick first non-self attendee name
    const contact = typeof attendees === 'string'
      ? attendees.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 1)[0] || ''
      : '';
    return {
      label: evt.summary || evt.title || 'Meeting',
      dateStr: evt.start,
      contact,
    };
  }

  // 2. Explicit nextStep with a date
  if (entry.nextStep && entry.nextStepDate) {
    return {
      label: entry.nextStep,
      dateStr: entry.nextStepDate,
      contact: '',
    };
  }

  // 3. nextStep without a date (still surface it)
  if (entry.nextStep) {
    return {
      label: entry.nextStep,
      dateStr: null,
      contact: '',
    };
  }

  return null;
}

/**
 * Detect whether the pipeline is "closed" for Next Steps purposes.
 * Closed = stageType is closed_lost OR the stage is accepted/won.
 */
function _oshIsPipelineClosed(entry, stages) {
  const stageKey = entry.isOpportunity ? (entry.jobStage || '') : (entry.status || '');
  if (stageKey === 'accepted' || stageKey.includes('won')) return true;
  const stageObj = stages.find(s => s.key === stageKey);
  return stageObj?.stageType === 'closed_lost';
}

/**
 * Render the full-width Next Steps strip.
 * Three states:
 *   1. Default — Last + Next populated
 *   2. No-next-defined — Last populated, no upcoming Next
 *   3. Pipeline-closed — terminal positive or negative stage
 *
 * Only rendered for opportunity entries (isOpportunity: true).
 * Company-only entries return empty string.
 *
 * @param {Object} entry           — saved entry
 * @param {Object} [options]
 * @param {Array}  [options.stages] — stages array for closed detection
 * @returns {string} HTML string
 */
function renderNextStepsStrip(entry, options = {}) {
  // Only for opportunities
  if (!entry.isOpportunity) return '';

  const stages = options.stages || [];

  // ── State 3: Pipeline closed ──────────────────────────────────────────
  if (_oshIsPipelineClosed(entry, stages)) {
    const stageKey = entry.isOpportunity ? (entry.jobStage || '') : (entry.status || '');
    const stageObj = stages.find(s => s.key === stageKey) || {};
    const isWon = stageKey === 'accepted' || stageKey.includes('won');
    const msg = isWon
      ? 'Offer accepted — pipeline complete.'
      : `Pipeline closed (${escapeHtml(stageObj.label || stageKey)}).`;
    return `<div class="osh-next-steps"><div class="osh-ns-closed-state">${msg}</div></div>`;
  }

  const lastItem = _oshLastActivity(entry);
  const nextItem = _oshNextItem(entry);

  // ── State 2: No upcoming next step ────────────────────────────────────
  if (!nextItem) {
    const lastSection = lastItem
      ? `<div class="osh-ns-cell">
           <span class="osh-ns-label">Last</span>
           <div class="osh-ns-row">
             <span class="osh-ns-what">${escapeHtml(lastItem.label)}</span>
             <span class="osh-ns-when">${escapeHtml(_oshFormatRelative(lastItem.timestamp))}</span>
           </div>
         </div>`
      : `<div class="osh-ns-cell"><span class="osh-ns-label">Last</span><span class="osh-ns-empty">No interactions yet</span></div>`;

    return `<div class="osh-next-steps">
      ${lastSection}
      <div class="osh-ns-no-next-cta">
        <div class="osh-ns-cell">
          <span class="osh-ns-label osh-ns-next-label" style="color:var(--ci-accent-primary)">Next</span>
          <span class="osh-ns-empty">No next step defined</span>
        </div>
        <div class="osh-ns-cta-wrap">
          <button class="osh-prep-btn" data-action="osh-prep-coop">
            <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Prep with Coop
          </button>
        </div>
      </div>
    </div>`;
  }

  // ── State 1: Default — both Last and Next populated ───────────────────
  const lastSection = lastItem
    ? `<div class="osh-ns-cell">
         <span class="osh-ns-label">Last</span>
         <div class="osh-ns-row">
           <span class="osh-ns-what">${escapeHtml(lastItem.label)}</span>
           <span class="osh-ns-when">${escapeHtml(_oshFormatRelative(lastItem.timestamp))}</span>
         </div>
       </div>`
    : `<div class="osh-ns-cell"><span class="osh-ns-label">Last</span><span class="osh-ns-empty">No interactions yet</span></div>`;

  const nextDateStr = nextItem.dateStr ? _oshFormatUpcoming(nextItem.dateStr) : '';
  const nextWhen = nextDateStr ? `<span class="osh-ns-when">${escapeHtml(nextDateStr)}</span>` : '';
  const nextContact = nextItem.contact ? ` with ${escapeHtml(nextItem.contact)}` : '';
  const nextWhat = `${escapeHtml(nextItem.label)}${nextContact}`;

  const nextSection = `<div class="osh-ns-cell osh-ns-next">
    <span class="osh-ns-label">Next</span>
    <div class="osh-ns-row">
      <span class="osh-ns-what">${nextWhat}</span>
      ${nextWhen}
    </div>
  </div>`;

  // "Prep with Coop" prompt text — use next item context if available
  const prepContact = nextItem.contact || '';
  const prepAction  = nextItem.label  || 'next step';

  const ctaSection = `<div class="osh-ns-cta-wrap">
    <button class="osh-prep-btn"
      data-action="osh-prep-coop"
      data-prep-contact="${escapeHtml(prepContact)}"
      data-prep-action="${escapeHtml(prepAction)}">
      <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Prep with Coop
    </button>
  </div>`;

  return `<div class="osh-next-steps">${lastSection}${nextSection}${ctaSection}</div>`;
}

// ── Bind shared header events ─────────────────────────────────────────────

/**
 * Bind events on the shell header after it's injected into the DOM.
 * Call this after inserting renderOppShellHeader() HTML.
 *
 * Handles:
 *   - "Show more ↓" blurb toggle
 *   - "Prep with Coop" CTA (opens floating chat with seeded prompt)
 *
 * @param {HTMLElement} container — element containing the shell HTML
 */
function bindOppShellEvents(container) {
  // Blurb expand toggle
  container.querySelectorAll('.osh-blurb-more-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const expDiv = document.getElementById(targetId);
      if (!expDiv) return;
      const isOpen = expDiv.classList.toggle('osh-blurb-open');
      btn.textContent = isOpen ? 'Show less ↑' : 'Show more ↓';
    });
  });

  // Prep with Coop CTA
  container.querySelectorAll('[data-action="osh-prep-coop"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prepContact = btn.dataset.prepContact || '';
      const prepAction  = btn.dataset.prepAction  || 'next step';
      const prompt = prepContact
        ? `Prep me for ${prepAction} with ${prepContact}`
        : `Help me prep for my next step: ${prepAction}`;

      // Open the floating chat and seed the input
      const floatEl    = document.getElementById('ci-float-chat');
      const floatTrig  = document.getElementById('fch-trigger');
      if (floatEl && floatEl.classList.contains('fch-hidden') && floatTrig) {
        floatTrig.click();
      }
      // Seed input
      const chatInput = document.querySelector('[data-chat-panel] .chat-input-box, .fch-body .chat-input-box, #ci-float-chat .chat-input-box');
      if (chatInput) {
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event('input'));
        setTimeout(() => chatInput.focus(), 150);
      }
    });
  });
}

// ── Attach to window for cross-file access ────────────────────────────────
window.renderOppShellHeader  = renderOppShellHeader;
window.renderNextStepsStrip  = renderNextStepsStrip;
window.bindOppShellEvents    = bindOppShellEvents;
