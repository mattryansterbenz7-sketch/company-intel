// ═══════════════════════════════════════════════════════════════════════════
// CompanyIntel — Scoring Queue (Triage UI)
// ═══════════════════════════════════════════════════════════════════════════

const QUEUE_STAGE_FALLBACK = 'needs_review';
const _rawMode = new URLSearchParams(location.search).get('mode');
const MODE = _rawMode === 'apply' ? 'apply' : _rawMode === 'dq' ? 'dq' : 'score';
const QUEUE_CONFIG = {
  score: { title: "Coop's Scoring Queue", emptyTitle: 'Queue is clear', emptySub: 'New opportunities will appear here when saved', showCta: false, passLabel: 'Pass', interestedLabel: 'Interested' },
  apply: { title: 'Apply Queue', emptyTitle: 'All caught up', emptySub: 'Nothing left to apply to right now', showCta: true, passLabel: 'Skip', interestedLabel: 'Applied' },
  dq:    { title: 'Active Review', emptyTitle: 'All caught up', emptySub: 'No active opportunities to review', showCta: false, passLabel: 'DQ', interestedLabel: 'Still Active' },
};
const CFG = QUEUE_CONFIG[MODE];
let queue = [];
let currentIdx = 0;
let currentQueueStage = QUEUE_STAGE_FALLBACK; // resolved on load
let allStages = []; // populated on load, used for Move-to dropdown

// Update header title for current mode
document.addEventListener('DOMContentLoaded', () => {
  const titleEl = document.querySelector('.header-title');
  if (titleEl) titleEl.innerHTML = `<svg width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;flex-shrink:0;"><circle cx="50" cy="50" r="50" fill="#E8E5E0"/><clipPath id="cq2"><circle cx="50" cy="50" r="48"/></clipPath><g clip-path="url(#cq2)"><ellipse cx="50" cy="96" rx="42" ry="23" fill="#3D5468"/><rect x="43" y="73" width="14" height="12" rx="3" fill="#E5BF9A"/><path d="M28 45Q28 30 38 24Q50 20 62 24Q72 30 72 45Q72 56 65 64Q59 70 50 72Q41 70 35 64Q28 56 28 45Z" fill="#F0CDA0"/><path d="M27 42Q27 20 50 14Q73 20 73 42L71 36Q69 20 50 17Q31 20 29 36Z" fill="#7A5C3A"/><ellipse cx="41" cy="44" rx="4.5" ry="4.5" fill="white"/><circle cx="41.5" cy="44.5" r="2.5" fill="#4A8DB8"/><ellipse cx="59" cy="44" rx="4.5" ry="4.5" fill="white"/><circle cx="59.5" cy="44.5" r="2.5" fill="#4A8DB8"/><path d="M40 58Q45 65 50 66Q55 65 60 58" fill="white" stroke="#8B6B4A" stroke-width="0.8"/></g></svg><span>${CFG.title}</span>`;
  document.title = 'CompanyIntel — ' + CFG.title;
});

function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// Back button
document.getElementById('back-btn').addEventListener('click', e => {
  e.preventDefault();
  window.open(chrome.runtime.getURL('saved.html'), '_blank');
  window.close();
});

// Load queue entries
function loadQueue() {
  chrome.storage.local.get(['savedCompanies', 'pipelineConfig', 'opportunityStages', 'customStages'], data => {
    const companies = data.savedCompanies || [];
    // Determine queue stage: explicit config > first stage in pipeline > fallback
    const stages = data.opportunityStages || data.customStages || [];
    allStages = stages;
    const firstStageKey = stages.length > 0 ? stages[0].key : null;
    let queueStage;
    if (MODE === 'apply') {
      const match = stages.find(s => s.key === 'want_to_apply' || /want.to.apply/i.test(s.label || ''));
      queueStage = match ? match.key : 'want_to_apply';
    } else {
      queueStage = data.pipelineConfig?.scoring?.queueStage || firstStageKey || QUEUE_STAGE_FALLBACK;
    }
    currentQueueStage = queueStage;

    if (MODE === 'dq') {
      // DQ mode: show opportunities in Applied+ stages (not scoring queue, want_to_apply, or terminal)
      const terminalKeys = new Set(['rejected', 'closed_lost', 'offer', 'accepted', 'want_to_apply', queueStage]);
      // Find the applied stage index to determine "applied+"
      const stageKeys = stages.map(s => s.key);
      const appliedIdx = stageKeys.indexOf('applied');
      const activeKeys = new Set(
        appliedIdx !== -1
          ? stageKeys.filter((k, i) => i >= appliedIdx && !terminalKeys.has(k))
          : stageKeys.filter(k => !terminalKeys.has(k))
      );
      queue = companies.filter(c => c.isOpportunity && activeKeys.has(c.jobStage || ''));
      // Sort: most recently updated first (stalest shown last)
      queue.sort((a, b) => {
        const ta = Math.max(...Object.values(a.stageTimestamps || {}), a.savedAt || 0);
        const tb = Math.max(...Object.values(b.stageTimestamps || {}), b.savedAt || 0);
        return ta - tb; // oldest first
      });
    } else {
      queue = companies.filter(c => c.isOpportunity && (c.jobStage || QUEUE_STAGE_FALLBACK) === queueStage);
      // Sort: scored first, then by score desc
      queue.sort((a, b) => {
        const sa = a.jobMatch?.score ?? -1;
        const sb = b.jobMatch?.score ?? -1;
        if (sa === -1 && sb !== -1) return 1;
        if (sb === -1 && sa !== -1) return -1;
        return sb - sa;
      });
    }
    currentIdx = 0;
    updateCount();
    renderCurrent();
  });
}

function updateCount() {
  document.getElementById('queue-count').textContent = `${queue.length} remaining`;
}

function renderCurrent() {
  const main = document.getElementById('queue-main');
  if (!queue.length || currentIdx >= queue.length) {
    main.innerHTML = `
      <div class="queue-empty">
        <div class="queue-empty-icon">✓</div>
        <div class="queue-empty-title">${CFG.emptyTitle}</div>
        <div class="queue-empty-sub">${CFG.emptySub}</div>
        <button id="queue-reset-recent" style="${(MODE === 'apply' || MODE === 'dq') ? 'display:none;' : ''}" style="margin-top:16px;padding:8px 16px;font-size:12px;font-weight:600;border:1px solid #d8d5d0;border-radius:8px;background:none;color:#FF7A59;cursor:pointer;font-family:inherit;">Re-queue recent opportunities</button>
      </div>`;
    document.getElementById('queue-reset-recent')?.addEventListener('click', function() {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Resetting...';
      chrome.storage.local.get(['savedCompanies', 'opportunityStages', 'customStages'], function(data) {
        var c = data.savedCompanies || [];
        var stages = data.opportunityStages || data.customStages || [];
        var qStage = stages.length > 0 ? stages[0].key : 'needs_review';
        var recent = c.filter(function(e) { return e.isOpportunity; }).sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); }).slice(0, 15);
        var count = 0;
        recent.forEach(function(e) {
          if (e.jobStage !== qStage) {
            e.jobStage = qStage;
            e.jobMatch = null;
            count++;
          }
        });
        chrome.storage.local.set({ savedCompanies: c }, function() {
          btn.textContent = 'Reset ' + count + ' to queue';
          // Trigger scoring for reset entries
          recent.forEach(function(e) {
            if (!e.jobMatch) chrome.runtime.sendMessage({ type: 'QUEUE_QUICK_FIT', entryId: e.id });
          });
          setTimeout(loadQueue, 1000);
        });
      });
    });
    return;
  }

  const c = queue[currentIdx];
  const jm = c.jobMatch || {};
  const score = jm.score ?? '?';
  const tier = score >= 7 ? 'green' : score >= 5 ? 'amber' : 'red';
  const rb = jm.roleBrief || {};
  const summary = jm.jobSummary || rb.roleSummary || jm.verdict || '';
  // Normalize flags to {text, source, evidence} regardless of legacy string shape
  const _normFlag = f => typeof f === 'string' ? { text: f, source: null, evidence: null } : { text: f?.text || '', source: f?.source || null, evidence: f?.evidence || null };
  const strongFits = (jm.strongFits || []).map(_normFlag).filter(f => f.text);
  const redFlags = (jm.redFlags || []).map(_normFlag).filter(f => f.text);
  const quickTake = jm.quickTake || c.quickTake || [];
  const breakdown = jm.scoreBreakdown || {};
  const qualMatch = rb.qualificationMatch || '';
  const qualScore = rb.qualificationScore || 0;

  // Meta
  const salary = c.jobSnapshot?.salary || c.jobSnapshot?.oteTotalComp || '';
  const arrangement = c.jobSnapshot?.workArrangement || '';
  const meta = [salary, arrangement].filter(Boolean);

  // Favicon
  const favDomain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const favHtml = favDomain ? `<img class="qc-company-favicon" src="https://www.google.com/s2/favicons?domain=${favDomain}&sz=32" onerror="this.style.display='none'">` : '';

  // Score timestamp with hours/minutes
  const scoredAt = jm.lastUpdatedAt ? (() => {
    const mins = Math.floor((Date.now() - jm.lastUpdatedAt) / 60000);
    if (mins < 1) return 'Scored just now';
    if (mins < 60) return `Scored ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Scored ${hrs}h ${mins % 60}m ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Scored yesterday';
    if (days < 7) return `Scored ${days}d ago`;
    return `Scored ${new Date(jm.lastUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  })() : '';

  // Flags HTML — with dismiss buttons + config links
  const dismissedFlags = jm.dismissedFlags || [];
  function flagConfigLink(flagText) {
    const lower = flagText.toLowerCase();
    if (/salary|comp|ote|base pay|floor/.test(lower)) return 'icp';
    if (/remote|on.?site|hybrid|arrangement|location/.test(lower)) return 'icp';
    if (/culture|leadership|toxic|environment/.test(lower)) return 'flags';
    return 'flags';
  }
  const configIcon = (tab) => `<a href="${chrome.runtime.getURL('preferences.html')}#${tab}" target="_blank" class="qc-flag-config" title="Edit this in Career OS">⚙</a>`;
  const sourceLabel = (s) => {
    if (!s) return 'No source linked';
    const map = {
      job_posting: 'From job posting',
      company_data: 'From company research',
      preferences: 'From your preferences',
      candidate_profile: 'From your profile',
      dealbreaker_keyword: 'From your dealbreaker keywords',
    };
    return map[s] || `Source: ${s}`;
  };
  const sourceIcon = (s) => {
    const map = { job_posting: '📄', company_data: '🏢', preferences: '⚙', candidate_profile: '👤', dealbreaker_keyword: '⛔' };
    return map[s] || 'ⓘ';
  };
  const flagBubble = (f) => {
    const tip = (sourceLabel(f.source) + (f.evidence ? ` — "${f.evidence}"` : ' — no evidence quoted')).replace(/"/g, '&quot;');
    return `<span class="qc-flag-source" title="${tip}" style="opacity:0.55;font-size:10px;margin-left:4px;cursor:help;">${sourceIcon(f.source)}</span>`;
  };
  const greenHtml = strongFits.map(f => {
    const isDismissed = dismissedFlags.includes(f.text);
    return `<div class="qc-flag${isDismissed ? ' dismissed' : ''}" data-flag="${escHtml(f.text)}"><span class="qc-flag-dot" style="color:#36B37E">●</span> <span${isDismissed ? ' style="text-decoration:line-through"' : ''}>${escHtml(f.text)}</span>${flagBubble(f)}${configIcon(flagConfigLink(f.text))}<button class="qc-flag-dismiss" data-flag="${escHtml(f.text)}" data-type="green" title="${isDismissed ? 'Restore' : 'Dismiss'}">${isDismissed ? '↩' : '×'}</button></div>`;
  }).join('');
  const redHtml = redFlags.map(f => {
    const isDismissed = dismissedFlags.includes(f.text);
    return `<div class="qc-flag${isDismissed ? ' dismissed' : ''}" data-flag="${escHtml(f.text)}"><span class="qc-flag-dot" style="color:#E8384F">●</span> <span${isDismissed ? ' style="text-decoration:line-through"' : ''}>${escHtml(f.text)}</span>${flagBubble(f)}${configIcon(flagConfigLink(f.text))}<button class="qc-flag-dismiss" data-flag="${escHtml(f.text)}" data-type="red" title="${isDismissed ? 'Restore' : 'Dismiss'}">${isDismissed ? '↩' : '×'}</button></div>`;
  }).join('');

  // Breakdown bars
  const barColor = v => v >= 7 ? '#36B37E' : v >= 5 ? '#F5A623' : '#E8384F';
  const BAR_TIPS = {
    Qualification: 'Employer perspective: would this company seriously consider hiring you? Based ONLY on whether you meet their stated qualifications — your preferences are NOT factored in here.',
    Preferences: 'Candidate perspective: how well does this role align with the role types, scope, seniority, selling motion, and team size you said you want?',
    Dealbreakers: 'How well the role avoids your hard dealbreakers (work arrangement, role types you don\'t want, explicit dislikes). 10 = no dealbreakers triggered.',
    Compensation: 'Match against your salary floor / OTE floor / strong-comp targets. 10 = posted comp meets or exceeds your strong target.',
    'Role Fit': 'Day-to-day overlap between the role\'s actual responsibilities and the kind of work you said you do best.',
  };
  const bars = [
    { label: 'Qualification', val: breakdown.qualificationFit },
    { label: 'Preferences', val: breakdown.preferenceFit },
    { label: 'Dealbreakers', val: breakdown.dealbreakers },
    { label: 'Compensation', val: breakdown.compFit },
    { label: 'Role Fit', val: breakdown.roleFit },
  ].filter(b => b.val != null);
  const barsHtml = bars.length ? `
    <div class="qc-section-label">Score Breakdown</div>
    <div class="qc-breakdown">
      ${bars.map(b => `
        <div class="qc-bar-row" title="${(BAR_TIPS[b.label] || '').replace(/"/g, '&quot;')}" style="cursor:help;">
          <div class="qc-bar-label">${b.label} <span style="opacity:0.4;font-size:10px;">ⓘ</span></div>
          <div class="qc-bar-track"><div class="qc-bar-fill" style="width:${b.val * 10}%;background:${barColor(b.val)}"></div></div>
          <div class="qc-bar-val" style="color:${barColor(b.val)}">${b.val}</div>
        </div>
      `).join('')}
    </div>` : '';

  // Qualification
  const qualTier = qualScore >= 7 ? 'high' : qualScore >= 5 ? 'mid' : 'low';
  const qualHtml = qualMatch ? `
    <div class="qc-qual">
      <div class="qc-section-label">Qualification Match</div>
      <div class="qc-qual-text">${escHtml(qualMatch)}</div>
      <div class="qc-qual-score ${qualTier}">${qualScore}/10</div>
    </div>` : '';

  // Hard DQ badge
  const dqHtml = jm.hardDQ?.flagged ? `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(232,56,79,0.08);border:1px solid rgba(232,56,79,0.2);border-radius:6px;font-size:12px;font-weight:700;color:#E8384F;">⚠ Hard Disqualification: ${escHtml((jm.hardDQ.reasons || []).join(', '))}</div>` : '';

  // Links
  const linkStyle = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;text-decoration:none;padding:3px 10px;border-radius:14px;transition:all 0.12s;';
  const links = [];
  if (c.jobUrl) links.push(`<a href="${escHtml(c.jobUrl)}" target="_blank" style="${linkStyle}color:#F06A52;background:rgba(240,106,82,0.08);border:1px solid rgba(240,106,82,0.2);">📋 Job Posting</a>`);
  if (c.companyWebsite) {
    const domain = c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    links.push(`<a href="${escHtml(c.companyWebsite)}" target="_blank" style="${linkStyle}color:#5C5854;background:rgba(92,88,84,0.06);border:1px solid rgba(92,88,84,0.12);">↗ ${escHtml(domain)}</a>`);
  }
  if (c.companyLinkedin) links.push(`<a href="${escHtml(c.companyLinkedin)}" target="_blank" style="${linkStyle}color:#0a66c2;background:rgba(10,102,194,0.06);border:1px solid rgba(10,102,194,0.15);">in LinkedIn</a>`);
  const linksHtml = links.length ? `<div class="qc-links">${links.join('')}</div>` : '';

  // Apply-mode CTA: prominent "Open Application" button (does NOT auto-advance)
  const ctaHtml = (CFG.showCta) ? `<div style="padding:0 24px 12px;">${c.jobUrl ? `<a href="${escHtml(c.jobUrl)}" target="_blank" id="qc-apply-cta" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 20px;background:var(--ci-accent-primary);color:#fff;text-decoration:none;border-radius:var(--ci-radius-md);font-size:14px;font-weight:700;box-shadow:0 2px 8px rgba(240,106,82,0.25);transition:all 0.15s;">📋 Open Application ↗</a>` : `<div style="padding:12px;background:var(--ci-bg-inset);border-radius:var(--ci-radius-sm);font-size:12px;color:var(--ci-text-tertiary);text-align:center;">No application link saved for this opportunity</div>`}</div>` : '';

  main.innerHTML = `
    <div class="queue-card" id="queue-card">
      <div class="qc-header">
        <div class="qc-score ${tier}">
          <div class="qc-score-num">${score}</div>
          <div class="qc-score-den">/10</div>
        </div>
        <div class="qc-info">
          <a class="qc-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank" style="text-decoration:none;color:inherit;">${favHtml} ${escHtml(c.company)}</a>
          <div class="qc-title">${c.jobUrl ? `<a href="${escHtml(c.jobUrl)}" target="_blank" style="color:inherit;text-decoration:underline;text-decoration-color:rgba(0,0,0,0.15);">${escHtml(c.jobTitle || '')}</a>` : escHtml(c.jobTitle || '')}</div>
          <div class="qc-meta">
            ${meta.map(m => `<span class="qc-meta-chip">${escHtml(m)}</span>`).join('')}
          </div>
          ${scoredAt ? `<div class="qc-scored-at">${scoredAt}</div>` : ''}
        </div>
      </div>
      ${linksHtml}
      ${ctaHtml}
      <div class="qc-body">
        ${dqHtml}
        ${summary ? `<div class="qc-summary">${escHtml(summary)}</div>` : ''}
        ${(strongFits.length || redFlags.length) ? `
          <div class="qc-flags">
            ${strongFits.length ? `<div class="qc-flag-col"><div class="qc-flag-heading green">Green Flags</div>${greenHtml}</div>` : ''}
            ${redFlags.length ? `<div class="qc-flag-col"><div class="qc-flag-heading red">Red Flags</div>${redHtml}</div>` : ''}
          </div>` : ''}
        ${qualHtml}
        ${barsHtml}
      </div>
      <div class="qc-corrections" id="qc-corrections">
        <button class="qc-correct-toggle" id="qc-correct-toggle">✎ Correct job data</button>
        <div class="qc-correct-form" id="qc-correct-form" style="display:none;">
          <div class="qc-correct-row">
            <label>Work arrangement</label>
            <select id="qc-correct-arrangement"><option value="">— as scored —</option><option value="Remote">Remote</option><option value="Hybrid">Hybrid</option><option value="On-site">On-site</option></select>
          </div>
          <div class="qc-correct-row">
            <label>Compensation</label>
            <input type="text" id="qc-correct-comp" placeholder="e.g. $104K - $163K base">
          </div>
          <div class="qc-correct-row">
            <label>Other correction</label>
            <input type="text" id="qc-correct-note" placeholder="e.g. Title is actually Senior AE, not AE">
          </div>
          <button class="qc-correct-save" id="qc-correct-save">Save & Rescore</button>
        </div>
      </div>
      <div class="qc-more" id="qc-more" data-id="${c.id}">View full details →</div>
      <div class="queue-nav">
        <button class="queue-nav-btn" id="btn-prev" ${currentIdx === 0 ? 'disabled' : ''} title="Previous (↑)">‹</button>
        <span class="queue-nav-pos">${currentIdx + 1} / ${queue.length}</span>
        <button class="queue-nav-btn" id="btn-next" ${currentIdx >= queue.length - 1 ? 'disabled' : ''} title="Next (↓)">›</button>
        <button class="queue-rescore-btn" id="btn-rescore" title="Re-score with latest preferences">↻ Rescore</button>
      </div>
      <div class="queue-actions">
        <button class="queue-action-btn pass" id="btn-pass">${CFG.passLabel} <span class="kbd">←</span></button>
        <button class="queue-action-btn interested" id="btn-interested">${CFG.interestedLabel} <span class="kbd">→</span></button>
      </div>
    </div>`;

  // Bind actions
  document.getElementById('btn-pass').addEventListener('click', () => triageAction('pass'));
  document.getElementById('btn-interested').addEventListener('click', () => triageAction('interested'));
  document.getElementById('btn-prev')?.addEventListener('click', () => { if (currentIdx > 0) { currentIdx--; renderCurrent(); } });
  document.getElementById('btn-next')?.addEventListener('click', () => { if (currentIdx < queue.length - 1) { currentIdx++; renderCurrent(); } });
  document.getElementById('btn-rescore')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-rescore');
    const card = document.getElementById('queue-card');
    btn.innerHTML = '<span class="rescore-spinner"></span> Rescoring...';
    btn.disabled = true;
    // Add loading overlay to card
    if (card) card.style.opacity = '0.6';
    const startTime = Date.now();
    chrome.runtime.sendMessage({ type: 'QUICK_FIT_SCORE', entryId: c.id }, () => {
      void chrome.runtime.lastError;
    });
    // Poll for score update
    const pollInterval = setInterval(() => {
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const updated = (savedCompanies || []).find(x => x.id === c.id);
        if (updated?.jobMatch?.lastUpdatedAt > startTime) {
          clearInterval(pollInterval);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          btn.innerHTML = `✓ Rescored in ${elapsed}s`;
          if (card) card.style.opacity = '1';
          setTimeout(() => loadQueue(), 500);
        }
      });
    }, 1500);
    // Timeout after 30s
    setTimeout(() => { clearInterval(pollInterval); btn.innerHTML = '↻ Rescore'; btn.disabled = false; if (card) card.style.opacity = '1'; }, 30000);
  });
  document.getElementById('qc-more').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('company.html') + '?id=' + c.id, '_blank');
  });

  // Job data corrections
  document.getElementById('qc-correct-toggle')?.addEventListener('click', () => {
    const form = document.getElementById('qc-correct-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('qc-correct-save')?.addEventListener('click', () => {
    const arrangement = document.getElementById('qc-correct-arrangement')?.value;
    const comp = document.getElementById('qc-correct-comp')?.value.trim();
    const note = document.getElementById('qc-correct-note')?.value.trim();
    if (!arrangement && !comp && !note) return;
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const companies = savedCompanies || [];
      const idx = companies.findIndex(x => x.id === c.id);
      if (idx === -1) return;
      if (arrangement) {
        companies[idx].jobSnapshot = companies[idx].jobSnapshot || {};
        companies[idx].jobSnapshot.workArrangement = arrangement;
      }
      if (comp) {
        companies[idx].jobSnapshot = companies[idx].jobSnapshot || {};
        companies[idx].jobSnapshot.salary = comp;
      }
      // Store corrections for scoring context
      companies[idx]._userCorrections = companies[idx]._userCorrections || [];
      const corrections = [arrangement ? `Work arrangement is actually ${arrangement}` : '', comp ? `Compensation is ${comp}` : '', note].filter(Boolean);
      companies[idx]._userCorrections.push(...corrections.map(c => ({ text: c, date: new Date().toISOString().slice(0, 10) })));
      chrome.storage.local.set({ savedCompanies: companies }, () => {
        // Auto-rescore with corrected data
        document.getElementById('btn-rescore')?.click();
      });
    });
  });

  // Flag dismiss + feedback
  document.querySelectorAll('.qc-flag-dismiss').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const flagText = btn.dataset.flag;
      const flagType = btn.dataset.type;
      const flagEl = btn.closest('.qc-flag');
      const isDismissed = flagEl?.classList.contains('dismissed');

      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const companies = savedCompanies || [];
        const idx = companies.findIndex(x => x.id === c.id);
        if (idx === -1) return;
        const jm = companies[idx].jobMatch || {};
        const dismissed = jm.dismissedFlags || [];
        const withReasons = jm.dismissedFlagsWithReasons || [];

        if (isDismissed) {
          jm.dismissedFlags = dismissed.filter(f => f !== flagText);
          jm.dismissedFlagsWithReasons = withReasons.filter(f => f.flag !== flagText);
          companies[idx].jobMatch = jm;
          chrome.storage.local.set({ savedCompanies: companies });
          // Update local queue data
          queue[currentIdx].jobMatch = jm;
          renderCurrent();
        } else {
          // Show inline reason input
          if (flagEl && !flagEl.querySelector('.qc-reason-row')) {
            const textSpan = flagEl.querySelector('span:nth-child(2)');
            if (textSpan) textSpan.style.textDecoration = 'line-through';
            flagEl.style.opacity = '0.4';
            btn.textContent = '↩';
            const row = document.createElement('div');
            row.className = 'qc-reason-row';
            row.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px;opacity:1;text-decoration:none;padding:10px 12px;background:#fff;border:1px solid #E2DFD9;border-radius:8px;';
            row.innerHTML = `<div style="font-size:11px;font-weight:600;color:#6B6F76;">Tell Coop why this is wrong — he'll learn from it</div>
              <textarea placeholder="e.g., This role is actually remote — the listing is mislabeled. Comp is disclosed at $104K-$163K in the posting." style="width:100%;font-size:12px;padding:8px 10px;border:1px solid #E2DFD9;border-radius:6px;font-family:inherit;background:#FAF9F8;color:#1E1F21;outline:none;resize:vertical;min-height:50px;line-height:1.5;"></textarea>
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="reason-cancel" style="font-size:11px;padding:5px 12px;border:1px solid #E2DFD9;border-radius:6px;background:#fff;color:#6B6F76;cursor:pointer;font-family:inherit;font-weight:600;">Skip</button>
                <button class="reason-save" style="font-size:11px;padding:5px 14px;border:none;border-radius:6px;background:#F06A52;color:#fff;cursor:pointer;font-family:inherit;font-weight:600;">Save Feedback</button>
              </div>`;
            flagEl.appendChild(row);
            const textarea = row.querySelector('textarea');
            textarea.focus();
            const saveFn = (reason) => {
              jm.dismissedFlags = [...dismissed, flagText];
              jm.dismissedFlagsWithReasons = [...withReasons, { flag: flagText, reason: reason || null, type: flagType, date: new Date().toISOString().slice(0, 10) }];
              companies[idx].jobMatch = jm;
              chrome.storage.local.set({ savedCompanies: companies });
              queue[currentIdx].jobMatch = jm;
              if (reason) {
                chrome.storage.local.get(['storyTime'], d => {
                  const st = d.storyTime || {};
                  st.learnedInsights = st.learnedInsights || [];
                  st.learnedInsights.push({ source: c.company, date: new Date().toISOString().slice(0, 10), insight: `Dismissed ${flagType} flag "${flagText}" — reason: ${reason}`, category: 'scoring_feedback', priority: 'high' });
                  st.learnedInsights = st.learnedInsights.slice(-100);
                  chrome.storage.local.set({ storyTime: st });
                });
              }
              row.innerHTML = `<span style="font-size:11px;color:#9CA0A6;">✓ ${reason ? 'Feedback saved — Coop will remember this' : 'Dismissed'}</span>`;
              setTimeout(() => renderCurrent(), 1500);
            };
            row.querySelector('.reason-save').addEventListener('click', () => saveFn(textarea.value.trim()));
            row.querySelector('.reason-cancel').addEventListener('click', () => saveFn(''));
            textarea.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveFn(textarea.value.trim()); } });
          }
        }
      });
    });
  });
}

function triageAction(action, fromDrag) {
  if (!queue.length || currentIdx >= queue.length) return;
  const entry = queue[currentIdx];
  const card = document.getElementById('queue-card');

  // Animate out (skip if already animated by drag gesture)
  if (!fromDrag) card?.classList.add(action === 'pass' ? 'swipe-left' : 'swipe-right');

  // Sound
  if (typeof CISounds !== 'undefined') {
    if (action === 'pass') CISounds.error();
    else CISounds.send();
  }

  // Update entry stage — advance dynamically based on configured pipeline
  chrome.storage.local.get(['savedCompanies', 'opportunityStages', 'customStages'], ({ savedCompanies, opportunityStages, customStages }) => {
    const companies = savedCompanies || [];
    const idx = companies.findIndex(c => c.id === entry.id);
    if (idx === -1) return;
    const stages = opportunityStages || customStages || [];
    const stageKeys = stages.map(s => s.key);
    const currentStage = companies[idx].jobStage;
    let newStage;
    if (action === 'pass') {
      newStage = 'rejected';
    } else if (MODE === 'apply') {
      // Apply queue: always land on `applied` if it exists in pipeline, else next stage
      const appliedIdx = stageKeys.indexOf('applied');
      if (appliedIdx !== -1) {
        newStage = 'applied';
      } else {
        let curIdxInStages = stageKeys.indexOf(currentStage);
        if (curIdxInStages === -1) curIdxInStages = stageKeys.indexOf(currentQueueStage);
        newStage = stageKeys[curIdxInStages + 1] || stageKeys[curIdxInStages] || currentStage;
      }
    } else {
      // Always advance one position from wherever the entry currently sits.
      // If the entry's stage is unknown to the pipeline (legacy/renamed), treat
      // it as if it were at the queue stage and advance from there. This ensures
      // a swipe-right ALWAYS moves the entry forward by one stage, regardless
      // of whether it was already past the queue.
      let curIdxInStages = stageKeys.indexOf(currentStage);
      if (curIdxInStages === -1) {
        const queueIdx = stageKeys.indexOf(currentQueueStage);
        curIdxInStages = queueIdx === -1 ? 0 : queueIdx;
      }
      newStage = stageKeys[curIdxInStages + 1] || stageKeys[curIdxInStages] || currentStage;
    }
    companies[idx].jobStage = newStage;
    companies[idx].stageTimestamps = companies[idx].stageTimestamps || {};
    companies[idx].stageTimestamps[newStage] = Date.now();
    if (action !== 'pass') {
      companies[idx].actionStatus = 'my_court';
    }
    chrome.storage.local.set({ savedCompanies: companies });
  });

  // Next card after animation
  setTimeout(() => {
    queue.splice(currentIdx, 1);
    if (currentIdx >= queue.length) currentIdx = 0;
    updateCount();
    renderCurrent();
  }, 300);
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); triageAction('pass'); }
  if (e.key === 'ArrowRight') { e.preventDefault(); triageAction('interested'); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (e.key === 'ArrowDown' && currentIdx < queue.length - 1) { currentIdx++; renderCurrent(); }
    if (e.key === 'ArrowUp' && currentIdx > 0) { currentIdx--; renderCurrent(); }
  }
});

// ── Drag/swipe gesture on card ──────────────────────────────────────────────
function initCardSwipe() {
  const card = document.getElementById('queue-card');
  if (!card) return;

  let startX = 0, startY = 0, currentX = 0, dragging = false, scrolling = false, mouseDown = false;
  const THRESHOLD = 120; // px to trigger action

  // Create drag overlay labels
  let overlay = card.querySelector('.swipe-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'swipe-overlay';
    overlay.innerHTML = `<span class="swipe-label pass">${MODE === 'apply' ? 'SKIP' : MODE === 'dq' ? 'DQ' : 'PASS'}</span><span class="swipe-label interested">${MODE === 'apply' ? 'APPLIED' : MODE === 'dq' ? 'ACTIVE' : 'INTERESTED'}</span>`;
    card.style.position = 'relative';
    card.appendChild(overlay);
  }

  function resetState() {
    dragging = false;
    mouseDown = false;
    scrolling = false;
    currentX = 0;
    card.style.transition = 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)';
    card.style.transform = '';
    const pl = overlay.querySelector('.swipe-label.pass');
    const il = overlay.querySelector('.swipe-label.interested');
    if (pl) pl.style.opacity = 0;
    if (il) il.style.opacity = 0;
  }

  function onStart(e) {
    if (e.target.closest('button, a, input, textarea, .queue-action-btn')) return;
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = 0;
    dragging = false;
    scrolling = false;
    mouseDown = true;
    card.style.transition = 'none';
  }

  function onMove(e) {
    if (!mouseDown || scrolling) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    // If vertical movement is dominant on first significant move, it's a scroll
    if (!dragging && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      scrolling = true;
      return;
    }

    if (!dragging && Math.abs(dx) > 10) {
      dragging = true;
    }

    if (!dragging) return;
    e.preventDefault();
    currentX = dx;

    const progress = Math.min(Math.abs(currentX) / THRESHOLD, 1);
    const rotation = (currentX / window.innerWidth) * 12;
    card.style.transform = `translateX(${currentX}px) rotate(${rotation}deg)`;

    // Show overlay labels
    const passLabel = overlay.querySelector('.swipe-label.pass');
    const intLabel = overlay.querySelector('.swipe-label.interested');
    if (currentX < 0) {
      passLabel.style.opacity = progress;
      intLabel.style.opacity = 0;
    } else {
      intLabel.style.opacity = progress;
      passLabel.style.opacity = 0;
    }
  }

  function onEnd() {
    if (!mouseDown) return;
    mouseDown = false;
    if (!dragging) { resetState(); return; }
    dragging = false;

    const passLabel = overlay.querySelector('.swipe-label.pass');
    if (Math.abs(currentX) >= THRESHOLD) {
      // Trigger action
      card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      const direction = currentX < 0 ? 'pass' : 'interested';
      card.style.transform = `translateX(${currentX < 0 ? '-120%' : '120%'}) rotate(${currentX < 0 ? '-12' : '12'}deg)`;
      card.style.opacity = '0';
      setTimeout(() => triageAction(direction, true), 150);
    } else {
      resetState();
    }
  }

  // Mouse events
  card.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);

  // Touch events
  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove', onMove, { passive: false });
  card.addEventListener('touchend', onEnd);
}

// Re-init swipe after each card render
const _origRenderCurrent = renderCurrent;
renderCurrent = function() {
  _origRenderCurrent();
  setTimeout(initCardSwipe, 50);
};

// Listen for real-time score updates
chrome.runtime.onMessage?.addListener((msg) => {
  if (msg.type === 'SCORE_UPDATED' || msg.type === 'QUICK_FIT_DONE' || msg.type === 'QUICK_FIT_COMPLETE') {
    loadQueue(); // refresh
  }
});

// Auto-refresh when savedCompanies changes (e.g. new save from sidepanel)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.savedCompanies) {
    loadQueue();
  }
});

// Init
loadQueue();
