// ═══════════════════════════════════════════════════════════════════════════
// Coop.ai — Scoring Queue (Triage UI)
// ═══════════════════════════════════════════════════════════════════════════

const QUEUE_STAGE_FALLBACK = 'needs_review';
const _rawMode = new URLSearchParams(location.search).get('mode');
const MODE = _rawMode === 'apply' ? 'apply' : _rawMode === 'dq' ? 'dq' : 'score';
const SINGLE_ID = new URLSearchParams(location.search).get('id'); // single-entry DQ mode
const DEV_MOCK = new URLSearchParams(location.search).get('mock') === '1'; // ?mock=1 → skip API, use fixture data
let _cachedUserFirstName = '';
chrome.storage.sync.get(['prefs'], d => { const n = d.prefs?.name || d.prefs?.fullName || ''; _cachedUserFirstName = n.split(/\s/)[0]; });
chrome.storage.onChanged.addListener((c, a) => { if (a === 'sync' && c.prefs) { const n = c.prefs.newValue?.name || c.prefs.newValue?.fullName || ''; _cachedUserFirstName = n.split(/\s/)[0]; } });

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
  if (titleEl) titleEl.innerHTML = `<svg width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;flex-shrink:0;"><circle cx="50" cy="50" r="50" fill="#3B5068"/><clipPath id="cq2"><circle cx="50" cy="50" r="48"/></clipPath><g clip-path="url(#cq2)"><ellipse cx="50" cy="100" rx="48" ry="28" fill="#435766"/><path d="M26 100L40 77L50 88L60 77L74 100" fill="#364854"/><path d="M40 77L50 94L60 77" fill="#F0EAE0"/><path d="M41 78Q44 73 50 76Q44 79 41 78Z" fill="#3D4F5F"/><path d="M59 78Q56 73 50 76Q56 79 59 78Z" fill="#3D4F5F"/><ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/><rect x="43" y="71" width="14" height="8" rx="2" fill="#E8C4A0"/><path d="M29 43Q29 27 39 21Q50 17 61 21Q71 27 71 43Q71 54 66 61Q61 67 55 70L50 72L45 70Q39 67 34 61Q29 54 29 43Z" fill="#EDBB92"/><ellipse cx="29" cy="44" rx="3" ry="4.5" fill="#DFB088"/><ellipse cx="71" cy="44" rx="3" ry="4.5" fill="#DFB088"/><path d="M27 40Q27 15 50 10Q73 15 73 40L71 32Q69 16 50 13Q31 16 29 32Z" fill="#2D1F16"/><path d="M29 31Q30 13 50 10Q70 13 71 31Q69 17 50 13Q31 17 29 31Z" fill="#3D2A1E"/><ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="41.5" cy="44.2" r="3" fill="#5B8C3E"/><circle cx="41.5" cy="44.2" r="2.2" fill="#4A7A30"/><circle cx="42.2" cy="43" r="0.8" fill="white" opacity="0.7"/><ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/><circle cx="59.5" cy="44.2" r="3" fill="#5B8C3E"/><circle cx="59.5" cy="44.2" r="2.2" fill="#4A7A30"/><circle cx="60.2" cy="43" r="0.8" fill="white" opacity="0.7"/><path d="M35 36.5Q38 34 41 34Q44 34 47 36" fill="#2D1F16" opacity="0.8"/><path d="M53 36Q56 34 59 34Q62 34 65 36.5" fill="#2D1F16" opacity="0.8"/><path d="M47 53Q48 55 50 55.5Q52 55 53 53" fill="none" stroke="#C8966E" stroke-width="0.7" stroke-linecap="round"/><path d="M42 60Q50 58 58 60" fill="none" stroke="#9B7055" stroke-width="0.6"/><path d="M42 60Q46 63 50 63.5Q54 63 58 60" fill="none" stroke="#9B7055" stroke-width="0.8" stroke-linecap="round"/><path d="M58 59.5Q60 58 61 58.5" fill="none" stroke="#9B7055" stroke-width="0.6" stroke-linecap="round"/></g></svg><span>${CFG.title}</span>`;
  document.title = 'Coop.ai — ' + CFG.title;
  if (DEV_MOCK) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#FFF3CD;color:#856404;text-align:center;padding:4px 8px;font-size:12px;font-weight:600;border-bottom:1px solid #FFEEBA;';
    banner.textContent = '🔧 Mock Mode — Rescore uses fixture data (no API calls)';
    document.body.prepend(banner);
  }
});

// escHtml, scoreToVerdict — provided by ui-utils.js

// Back button
document.getElementById('back-btn').addEventListener('click', e => {
  e.preventDefault();
  coopNavigate(chrome.runtime.getURL('saved.html'));
});

// Mock mode button — opens same queue with ?mock=1
const mockBtn = document.getElementById('btn-mock-mode');
if (mockBtn) {
  if (DEV_MOCK) {
    mockBtn.textContent = '⚠ Mock Active — Exit';
    mockBtn.style.background = '#FFC107';
    mockBtn.style.color = '#333';
    mockBtn.style.borderColor = '#D4A017';
    mockBtn.title = 'Mock mode is ON — scores use fixture data. Click to exit.';
    mockBtn.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.delete('mock');
      location.href = url.toString();
    });
  } else {
    mockBtn.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('mock', '1');
      location.href = url.toString();
    });
  }
}

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
    // Single-entry mode: opened from a kanban card click
    if (SINGLE_ID) {
      const entry = companies.find(c => c.id === SINGLE_ID);
      queue = entry ? [entry] : [];
    }

    currentIdx = 0;
    updateCount();
    renderCurrent();
  });
}

function updateCount() {
  if (SINGLE_ID) {
    document.getElementById('queue-count').textContent = '';
    return;
  }
  const remaining = Math.max(0, queue.length - currentIdx);
  document.getElementById('queue-count').textContent = `${remaining} remaining`;
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
            if (!e.jobMatch) chrome.runtime.sendMessage({ type: 'QUEUE_SCORE', entryId: e.id });
          });
          setTimeout(loadQueue, 1000);
        });
      });
    });
    return;
  }

  try {
  const c = queue[currentIdx];
  const jm = c.jobMatch || {};
  const score = jm.score ?? '?';
  const tier = score >= 7 ? 'green' : score >= 5 ? 'amber' : 'red';
  const rb = jm.roleBrief || {};
  const summary = jm.jobSummary || rb.roleSummary || jm.verdict || '';
  // Normalize flags to {text, source, evidence, configuredEntry} regardless of legacy string shape
  const _normFlag = f => typeof f === 'string' ? { text: f, source: null, evidence: null, configuredEntry: null } : { text: f?.text || '', source: f?.source || null, evidence: f?.evidence || null, configuredEntry: f?.configuredEntry || null };
  const strongFits = (jm.strongFits || []).map(_normFlag).filter(f => f.text);
  const redFlags = (jm.redFlags || []).map(_normFlag).filter(f => f.text);
  const keySignals = jm.keySignals || c.keySignals || [];
  const breakdown = jm.scoreBreakdown || {};
  const qualMatch = rb.qualificationMatch || '';
  const qualScore = rb.qualificationScore || 0;

  // Meta
  const salary = c.jobSnapshot?.salary || c.jobSnapshot?.oteTotalComp || '';
  const arrangement = c.jobSnapshot?.workArrangement || '';
  const location = c.jobSnapshot?.location || c.location || '';
  const meta = [arrangement].filter(Boolean);

  // Quick facts sidebar
  const isKnown = v => v && !/^\s*(not specified|unknown|n\/a|none|—|–|-)\s*$/i.test(String(v));
  const factVal = (v) => `<span class="qc-fact-val">${escHtml(String(v))}</span>`;
  const fact = (label, v) => isKnown(v) ? `<div class="qc-fact-row"><span class="qc-fact-label">${label}</span>${factVal(v)}</div>` : '';
  const _normSal = s => s ? s.replace(/\/yr/gi, '').replace(/\/year/gi, '').replace(/\s+/g, ' ').trim() : s;
  const baseSalary = _normSal(c.jobSnapshot?.salary || c.baseSalaryRange || '');
  const totalComp = _normSal(c.jobSnapshot?.oteTotalComp || c.oteTotalComp || '');
  // Pull employees/funding from all possible locations the research pipeline may have stored them
  const employees = c.employees || c.headcount || c.intelligence?.employees || c.firmographics?.employees || '';
  const funding = c.funding || c.totalFunding || c.intelligence?.funding || c.firmographics?.totalFunding || '';
  const reviewCount = (c.reviews || []).length;
  const reviewAvg = reviewCount ? (() => { const scored = (c.reviews || []).filter(r => r.rating); return scored.length ? (scored.reduce((s, r) => s + parseFloat(r.rating), 0) / scored.length).toFixed(1) + '★' : null; })() : null;
  const factsHtml = `
    <div class="qc-facts">
      <div class="qc-facts-grid">
        ${fact('Location', location)}
        ${fact('Base', baseSalary)}
        ${fact('Total Comp', totalComp)}
        ${fact('Industry', c.industry)}
        ${fact('Funding', funding)}
        ${fact('Employees', employees)}
        ${fact('Arrangement', arrangement)}
      </div>
      <div class="qc-facts-correct">
        <button class="qc-facts-correct-toggle" id="qc-correct-toggle">✎ Correct job data</button>
      </div>
    </div>`;

  // Favicon
  const favDomain = c.companyWebsite ? c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  const favHtml = favDomain ? `<img class="qc-company-favicon" src="https://www.google.com/s2/favicons?domain=${favDomain}&sz=32" onerror="this.style.display='none'">` : '';

  // Score timestamp with hours/minutes
  const isMockScore = jm.lastScoringUsage?.model === 'dev-mock';
  function formatScoredAt(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'Scored just now';
    if (mins < 60) return `Scored ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Scored ${hrs}h ${mins % 60}m ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Scored yesterday';
    if (days < 7) return `Scored ${days}d ago`;
    return `Scored ${new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  const scoredAt = isMockScore
    ? 'Mock score' + (jm.lastUpdatedAt ? ` · Last real: ${formatScoredAt(jm.lastUpdatedAt)}` : ' · Never scored live')
    : formatScoredAt(jm.lastUpdatedAt);

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
  const flagDetailId = (text) => 'fd-' + btoa(encodeURIComponent(text)).replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const flagInfoBtn = (f) => {
    const id = flagDetailId(f.text);
    return `<button class="qc-flag-info-btn" data-detail="${id}" title="Where did this come from?">ⓘ</button>`;
  };
  const flagDetailPanel = (f) => {
    const id = flagDetailId(f.text);
    const rows = [];
    if (f.configuredEntry) rows.push(`<div class="qc-detail-row"><span class="qc-detail-label">Configured rule</span><span class="qc-detail-val">${escHtml(f.configuredEntry)}</span></div>`);
    if (f.source) rows.push(`<div class="qc-detail-row"><span class="qc-detail-label">Source</span><span class="qc-detail-val">${escHtml(sourceLabel(f.source))}</span></div>`);
    if (f.evidence) rows.push(`<div class="qc-detail-row"><span class="qc-detail-label">Evidence</span><span class="qc-detail-val qc-detail-quote">"${escHtml(f.evidence)}"</span></div>`);
    if (!rows.length) {
      rows.push(`<div class="qc-detail-row"><span class="qc-detail-val" style="color:var(--ci-text-tertiary)">No trace data — this flag was saved before red flag sources were tracked. Re-score to get an explainable flag, or if this keeps appearing, dismiss it.</span></div>`);
    }
    rows.push(`<div class="qc-detail-row"><a class="qc-detail-link" href="${chrome.runtime.getURL('preferences.html')}#red-flags" target="_blank">Adjust in Preferences →</a></div>`);
    return `<div class="qc-flag-detail" id="${id}" style="display:none">${rows.join('')}</div>`;
  };
  const greenHtml = strongFits.map(f => {
    const isDismissed = dismissedFlags.includes(f.text);
    return `<div class="qc-flag${isDismissed ? ' dismissed' : ''}" data-flag="${escHtml(f.text)}"><div class="qc-flag-row"><span class="qc-flag-dot" style="color:#36B37E">●</span> <span${isDismissed ? ' style="text-decoration:line-through"' : ''}>${escHtml(f.text)}</span>${flagInfoBtn(f)}${configIcon(flagConfigLink(f.text))}<button class="qc-flag-dismiss" data-flag="${escHtml(f.text)}" data-type="green" title="${isDismissed ? 'Restore' : 'Dismiss'}">${isDismissed ? '↩' : '×'}</button></div>${flagDetailPanel(f)}</div>`;
  }).join('');
  const redHtml = redFlags.map(f => {
    const isDismissed = dismissedFlags.includes(f.text);
    return `<div class="qc-flag${isDismissed ? ' dismissed' : ''}" data-flag="${escHtml(f.text)}"><div class="qc-flag-row"><span class="qc-flag-dot" style="color:#E8384F">●</span> <span${isDismissed ? ' style="text-decoration:line-through"' : ''}>${escHtml(f.text)}</span>${flagInfoBtn(f)}${configIcon(flagConfigLink(f.text))}<button class="qc-flag-dismiss" data-flag="${escHtml(f.text)}" data-type="red" title="${isDismissed ? 'Restore' : 'Dismiss'}">${isDismissed ? '↩' : '×'}</button></div>${flagDetailPanel(f)}</div>`;
  }).join('');

  // Format detection: new schema has roleFit + cultureFit, old has preferenceFit + dealbreakers
  const isNewFormat = breakdown.roleFit !== undefined && breakdown.cultureFit !== undefined;
  const flagsFired = jm.flagsFired || {};
  const neutralFlags = jm.neutralFlags || {};
  const dimRationale = jm.dimensionRationale || {};
  const compAssess = jm.compAssessment || {};
  const qualifications = jm.qualifications || [];

  // Coop's take — new field or fall back to old summary
  const coopTakeText = jm.coopTake || summary;
  const coopTakeHtml = coopTakeText ? `
    <div class="queue-coop-take">
      <span class="queue-coop-label">Coop's take</span>
      <span class="queue-coop-text">${escHtml(coopTakeText)}</span>
    </div>` : '';

  // Verdict pill
  const _verdict = scoreToVerdict(score);
  const verdictPillHtml = `<span class="queue-verdict-pill ${_verdict.cls}">${_verdict.label}</span>`;

  // 5-dim breakdown
  const DIM_DEFS = [
    { key: 'qualificationFit', label: _cachedUserFirstName ? `${_cachedUserFirstName}'s Qualifications` : 'Qualifications', dot: 'qual' },
    { key: 'roleFit',          label: 'Role fit',      dot: 'role' },
    { key: 'cultureFit',       label: 'Culture fit',   dot: 'culture' },
    { key: 'companyFit',       label: 'Company fit',   dot: 'company' },
    { key: 'compFit',          label: 'Comp fit',      dot: 'comp' },
  ];
  const DIM_LABELS = { qualificationFit: _cachedUserFirstName ? `${_cachedUserFirstName}'s Qualifications` : 'Qualifications', roleFit: 'Role fit', cultureFit: 'Culture fit', companyFit: 'Company fit', compFit: 'Comp fit' };
  // Map old format keys to new display slots
  const displayBreakdown = isNewFormat ? breakdown : {
    qualificationFit: breakdown.qualificationFit,
    roleFit:          breakdown.preferenceFit,
    cultureFit:       breakdown.dealbreakers,
    companyFit:       undefined,
    compFit:          breakdown.compFit,
  };
  const dimTier = v => v >= 7 ? 'high' : v >= 5 ? 'mid' : 'low';
  const prefsUrl = chrome.runtime.getURL('preferences.html');

  // Helper: build flag card HTML
  function buildFlagCard(adj, color, dimKey) {
    const sign = color === 'green' ? '+' : color === 'red' ? '−' : '·';
    const flagText = adj.text || adj.label || '';
    const delta = adj.delta ?? 0;
    const impactStr = delta > 0 ? `+${delta.toFixed(1)}` : delta < 0 ? `${delta.toFixed(1)}` : '';
    const impactCls = delta > 0 ? 'pos' : delta < 0 ? 'neg' : '';
    const settingsHref = adj.id ? `${prefsUrl}?dim=${dimKey}&flagId=${adj.id}` : `${prefsUrl}?dim=${dimKey}`;
    return `
      <div class="queue-flag-card ${color}" data-flag-id="${adj.id || ''}">
        <div class="queue-flag-card-row">
          <span class="queue-flag-sign">${sign}</span>
          <span class="queue-flag-text">${escHtml(flagText)}</span>
          ${adj.sev ? `<span class="queue-flag-sev-pill">s${adj.sev}</span>` : ''}
          ${impactStr ? `<span class="queue-flag-impact ${impactCls}">${impactStr}</span>` : ''}
          <a class="queue-flag-settings-link" href="${settingsHref}" target="_blank" title="${escHtml(DIM_LABELS[dimKey] || dimKey)} settings">↗</a>
          <button class="queue-flag-dismiss-btn" data-flag-text="${escHtml(flagText)}" data-flag-type="${color}" title="Dismiss">✕</button>
        </div>
        ${adj.evidence ? `<div class="queue-flag-evidence">${escHtml(adj.evidence)}</div>` : ''}
      </div>`;
  }

  // Helper: render flag list with collapse when >3
  function buildFlagList(flags, color, dimKey) {
    if (!flags.length) return '<div style="font-size:11px;color:var(--ci-text-tertiary);font-style:italic;">None fired</div>';
    const LIMIT = 3;
    const visible = flags.slice(0, LIMIT).map(a => buildFlagCard(a, color, dimKey)).join('');
    if (flags.length <= LIMIT) return visible;
    const hidden = flags.slice(LIMIT).map(a => buildFlagCard(a, color, dimKey)).join('');
    return `${visible}<div class="queue-flags-overflow" style="display:none;">${hidden}</div><button class="queue-flags-more-btn" data-expanded="0">+${flags.length - LIMIT} more</button>`;
  }


  // Helper: build qualification card
  function buildQualCard(q) {
    const statusIcons = { met: '✓', partial: '~', unmet: '✕', unknown: '?' };
    const cls = q.status || 'unknown';
    const sources = q.sources || [];
    const evidenceText = q.evidence ? escHtml(q.evidence) : '';
    return `
      <div class="queue-qual-card ${cls}">
        <span class="queue-qual-icon ${cls}">${statusIcons[cls] || '?'}</span>
        <span class="queue-qual-title">${escHtml(q.requirement)}</span>
        ${evidenceText ? `<span class="queue-qual-evidence">${evidenceText}</span>` : ''}
        ${sources.length ? `<span class="queue-qual-sources">${sources.map(s => `<span class="queue-qual-source-tag">${escHtml(s)}</span>`).join('')}</span>` : ''}
        ${(cls === 'partial' || cls === 'unmet') ? `<button class="queue-qual-correct-btn" data-qual-id="${q.id}" data-qual-req="${escHtml(q.requirement)}">Add to experience ↗</button>` : ''}
      </div>`;
  }

  // Build score overview bars + detail panels (toggle view)
  const weights = jm.scoringWeightsSnapshot || {};
  const dimBars = [];
  const dimToggles = [];
  const dimPanels = [];
  const DIM_SHORT = { qualificationFit: 'Qual', roleFit: 'Role', cultureFit: 'Culture', companyFit: 'Company', compFit: 'Comp' };

  DIM_DEFS.forEach(dim => {
    const val = displayBreakdown[dim.key];
    if (val == null) return;
    const tier = dimTier(val);
    const fired = isNewFormat ? (flagsFired[dim.key] || {}) : {};
    const allGreens = fired.green || [];
    const allReds   = fired.red   || [];

    const w = weights[dim.key] || 0;
    const hasFlags = allGreens.length || allReds.length;
    const isQual = dim.key === 'qualificationFit';
    const isComp = dim.key === 'compFit';
    const hasContent = isNewFormat && (hasFlags || isQual || isComp);

    // Overview bar row (always visible, click selects matching toggle)
    dimBars.push(`
      <div class="queue-dim-bar-row" data-dim="${dim.key}">
        <span class="queue-dim-dot ${dim.dot}"></span>
        <span class="queue-dim-name">${dim.label}</span>
        <div class="queue-bar-track"><div class="queue-bar-fill ${tier}" style="width:${val * 10}%"></div></div>
        <span class="queue-dim-score ${tier}">${val}</span>
      </div>`);

    // Toggle button
    dimToggles.push(`<button class="queue-dim-toggle-btn${isQual ? ' active' : ''}" data-dim="${dim.key}">
      <span class="queue-dim-dot ${dim.dot}"></span>${DIM_SHORT[dim.key] || dim.label}<span class="queue-dim-toggle-score ${tier}">${val}</span>
    </button>`);

    // Build detail panel content
    let panelContent = '';
    if (isNewFormat && hasContent) {
      const contribution = (val * w / 100).toFixed(2);

      if (isQual) {
        const _compRx = /\b(salary|salaries|comp(ensation)?|pay\b|ote\b|base\s*pay|incentive|bonus|equity|stock|commission)/i;
        const skillQuals = qualifications.filter(q => !_compRx.test(q.requirement) && !q.dismissed);
        const metQuals = skillQuals.filter(q => q.status === 'met');
        const otherQuals = skillQuals.filter(q => q.status !== 'met' && q.status !== 'unknown');
        const metCount = metQuals.length, partialCount = otherQuals.filter(q => q.status === 'partial').length, unmetCount = otherQuals.filter(q => q.status === 'unmet').length;
        const totalQ = metCount + partialCount + unmetCount;
        const qualLine = q => {
          const icon = q.status === 'met' ? '✓' : q.status === 'partial' ? '~' : '✕';
          const cls = q.status;
          const hasEvidence = q.evidence && q.evidence.trim();
          return `<div class="queue-qual-line ${cls}${hasEvidence ? ' expandable' : ''}"><span class="queue-qual-line-icon ${cls}">${icon}</span><span class="queue-qual-line-text">${escHtml(q.requirement)}</span>${q.importance === 'preferred' ? '<span class="queue-qual-line-src">nice to have</span>' : ''}${(q.sources||[]).length ? `<span class="queue-qual-line-src">${q.sources[0]}</span>` : ''}${hasEvidence ? `<div class="queue-qual-line-evidence">${escHtml(q.evidence)}</div>` : ''}</div>`;
        };
        const QLIMIT = 6;
        const allQuals = [...metQuals, ...otherQuals];
        const visible = allQuals.slice(0, QLIMIT).map(qualLine).join('');
        const overflow = allQuals.length > QLIMIT
          ? `<div class="queue-flags-overflow" style="display:none;">${allQuals.slice(QLIMIT).map(qualLine).join('')}</div><button class="queue-flags-more-btn" data-expanded="0">+${allQuals.length - QLIMIT} more</button>`
          : '';
        panelContent = `<div class="queue-math-row"><span>${totalQ ? `${metCount} met · ${partialCount} partial · ${unmetCount} unmet` : 'No requirements identified'} → ${val}/10</span><span class="queue-math-right">${val}×${w}% = ${contribution}</span></div>${allQuals.length ? `<div class="queue-qual-list">${visible}${overflow}</div>` : ''}`;
      } else if (isComp) {
        const verdictCls = v => v?.includes('above') ? 'above' : v === 'at_floor' ? 'at' : v === 'below_floor' ? 'below' : 'unknown';
        const verdictLabel = { above_strong: 'Above target', above_floor: 'Above floor', at_floor: 'At floor', below_floor: 'Below floor' };
        const allAdj = allGreens.concat(allReds);
        const mathParts = ['5.0'];
        allAdj.forEach(a => { const d = a.delta ?? 0; mathParts.push(`${d > 0 ? '+' : ''}${d.toFixed(1)}`); });
        const mathStr = mathParts.length > 1 ? `${mathParts.join(' ')} = ${val}` : `${val}`;
        const baseDisplay = compAssess.baseAmount ? '$' + compAssess.baseAmount.toLocaleString() : (baseSalary || null);
        const oteDisplay = compAssess.oteAmount ? '$' + compAssess.oteAmount.toLocaleString() : (totalComp || null);
        const showBase = baseDisplay && compAssess.baseVsFloor !== 'unknown';
        const showOte = oteDisplay && compAssess.oteVsFloor !== 'unknown';
        const compParts = [];
        if (showBase) compParts.push(`Base: ${baseDisplay} <span class="queue-comp-inline-verdict ${verdictCls(compAssess.baseVsFloor)}">${verdictLabel[compAssess.baseVsFloor] || ''}</span>`);
        if (showOte) compParts.push(`OTE: ${oteDisplay} <span class="queue-comp-inline-verdict ${verdictCls(compAssess.oteVsFloor)}">${verdictLabel[compAssess.oteVsFloor] || ''}</span>`);
        panelContent = `<div class="queue-math-row"><span>${mathStr}</span><span class="queue-math-right">${val}×${w}% = ${contribution}</span></div>${compParts.length ? `<div class="queue-comp-inline">${compParts.join('<span class="queue-comp-sep">·</span>')}</div>` : ''}${hasFlags ? `<div class="queue-flag-cols horizontal">${allGreens.length ? `<div>${buildFlagList(allGreens, 'green', dim.key)}</div>` : ''}${allReds.length ? `<div>${buildFlagList(allReds, 'red', dim.key)}</div>` : ''}</div>` : ''}`;
      } else {
        const allAdj = allGreens.concat(allReds);
        const mathParts = ['5.0'];
        allAdj.forEach(a => { const d = a.delta ?? 0; mathParts.push(`${d > 0 ? '+' : ''}${d.toFixed(1)}`); });
        const rawScore = allAdj.reduce((s, a) => s + a.delta, 5.0);
        const mathStr = `${mathParts.join(' ')} = ${rawScore.toFixed(1)} → ${val}`;
        panelContent = `${dimRationale[dim.key] ? `<div class="queue-drawer-rationale">${escHtml(dimRationale[dim.key])}</div>` : ''}<div class="queue-math-row"><span>${mathStr}</span><span class="queue-math-right">${val}×${w}% = ${contribution}</span></div><div class="queue-flag-cols horizontal">${allGreens.length ? `<div>${buildFlagList(allGreens, 'green', dim.key)}</div>` : ''}${allReds.length ? `<div>${buildFlagList(allReds, 'red', dim.key)}</div>` : ''}</div>`;
      }
    } else if (isNewFormat && !hasContent) {
      const note = dimRationale[dim.key] ? escHtml(dimRationale[dim.key]) : 'No flags configured for this dimension';
      panelContent = `<div class="queue-dim-detail-note">${note}</div>`;
    }

    dimPanels.push(`<div class="queue-dim-detail${isQual ? ' active' : ''}" data-dim="${dim.key}">${panelContent}</div>`);
  });

  // Total formula row
  const totalFormulaHtml = jm.scoreRationale ? `<div class="queue-total-formula">${escHtml(jm.scoreRationale)}</div>` : '';

  const barsHtml = dimBars.length ? `
    <div class="qc-breakdown-label">Score breakdown</div>
    <div class="qc-breakdown">${dimBars.join('')}</div>
    <div class="queue-dim-toggle has-active">${dimToggles.join('')}</div>
    <div class="queue-dim-details">${dimPanels.join('')}</div>${totalFormulaHtml}` : '';

  // Remove old separate qualification and rationale sections — they're now inside the drawer
  const rationaleHtml = '';
  const qualHtml = '';

  // Hard DQ badge
  const dqHtml = jm.hardDQ?.flagged ? `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(232,56,79,0.08);border:1px solid rgba(232,56,79,0.2);border-radius:6px;font-size:12px;font-weight:700;color:#E8384F;">⚠ Hard Disqualification: ${escHtml((jm.hardDQ.reasons || []).join(', '))}</div>` : '';

  // Links
  const linkStyle = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;text-decoration:none;padding:3px 10px;border-radius:14px;transition:all 0.12s;';
  const links = [];
  if (c.jobUrl) links.push(`<a href="${escHtml(c.jobUrl)}" target="_blank" style="${linkStyle}color:#FC636B;background:rgba(252,99,107,0.08);border:1px solid rgba(252,99,107,0.2);">📋 Job Posting</a>`);
  if (c.companyWebsite) {
    const domain = c.companyWebsite.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    links.push(`<a href="${escHtml(c.companyWebsite)}" target="_blank" style="${linkStyle}color:#5C5854;background:rgba(92,88,84,0.06);border:1px solid rgba(92,88,84,0.12);">↗ ${escHtml(domain)}</a>`);
  }
  if (c.companyLinkedin) links.push(`<a href="${escHtml(c.companyLinkedin)}" target="_blank" style="${linkStyle}color:#0a66c2;background:rgba(10,102,194,0.06);border:1px solid rgba(10,102,194,0.15);">in LinkedIn</a>`);
  const linksHtml = links.length ? `<div class="qc-links">${links.join('')}</div>` : '';

  // Apply-mode CTA: prominent "Open Application" button (does NOT auto-advance)
  const ctaHtml = (CFG.showCta) ? `<div style="padding:0 24px 12px;">${c.jobUrl ? `<a href="${escHtml(c.jobUrl)}" target="_blank" id="qc-apply-cta" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 20px;background:var(--ci-accent-primary);color:#fff;text-decoration:none;border-radius:var(--ci-radius-md);font-size:14px;font-weight:700;box-shadow:0 2px 8px rgba(252,99,107,0.25);transition:all 0.15s;">📋 Open Application ↗</a>` : `<div style="padding:12px;background:var(--ci-bg-inset);border-radius:var(--ci-radius-sm);font-size:12px;color:var(--ci-text-tertiary);text-align:center;">No application link saved for this opportunity</div>`}</div>` : '';

  main.innerHTML = `
    <div class="queue-card-shell">
      <button class="queue-side-nav prev" id="btn-prev" ${currentIdx === 0 ? 'disabled' : ''} title="Previous (↑)" aria-label="Previous card">‹</button>
      <button class="queue-side-nav next" id="btn-next" ${currentIdx >= queue.length - 1 ? 'disabled' : ''} title="Next (↓)" aria-label="Next card">›</button>
    <div class="queue-card" id="queue-card">
      <div class="qc-header">
        <div class="qc-score-wrap">
          <div class="qc-score ${tier}">
            <div class="qc-score-num">${score}</div>
            <div class="qc-score-den">/10</div>
          </div>
          <span class="qc-score-label">Coop's Score</span>
        </div>
        <div class="qc-info">
          <a class="qc-company" href="${chrome.runtime.getURL('company.html')}?id=${c.id}" target="_blank" style="text-decoration:none;color:inherit;">${favHtml} ${escHtml(c.company)}</a>
          <div class="qc-title">${c.jobUrl ? `<a href="${escHtml(c.jobUrl)}" target="_blank" style="color:inherit;text-decoration:underline;text-decoration-color:rgba(0,0,0,0.15);">${escHtml(c.jobTitle || '')}</a>` : escHtml(c.jobTitle || '')}</div>
          <div class="qc-meta">
            ${meta.map(m => `<span class="qc-meta-chip">${escHtml(m)}</span>`).join('')}
          </div>
          ${scoredAt ? `<div class="qc-scored-at">${scoredAt}</div>` : ''}
          ${(() => {
            const blurb = c.intelligence?.eli5 || c.oneLiner || c.intelligence?.overview || '';
            const customers = c.intelligence?.customers || c.intelligence?.targetCustomers || '';
            const product = c.intelligence?.product || '';
            const parts = [blurb, customers && !blurb.toLowerCase().includes('sell') ? customers : '', product && !blurb ? product : ''].filter(Boolean);
            const text = parts[0] ? parts[0].slice(0, 220) : '';
            return text ? `<div class="qc-company-blurb">${escHtml(text)}</div>` : '';
          })()}
        </div>
        ${factsHtml}
      </div>
      ${linksHtml}
      ${ctaHtml}
      <div class="qc-body">
        ${dqHtml}
        ${verdictPillHtml}
        ${coopTakeHtml}
        ${barsHtml}
        ${rationaleHtml}
        ${qualHtml}
        ${(!isNewFormat && (strongFits.length || redFlags.length)) ? `
          <div class="qc-flags">
            ${strongFits.length ? `<div class="qc-flag-col"><div class="qc-flag-heading green">Green Flags</div>${greenHtml}</div>` : ''}
            ${redFlags.length ? `<div class="qc-flag-col"><div class="qc-flag-heading red">Red Flags</div>${redHtml}</div>` : ''}
          </div>` : ''}
      </div>
      ${rb.roleSummary ? `<details class="qc-role-brief">
        <summary style="font-size:12px;font-weight:600;color:var(--ci-text-secondary);cursor:pointer;padding:8px 0 4px;list-style:none;display:flex;align-items:center;gap:4px;">
          <span style="font-size:10px;transition:transform 0.15s;">▸</span> Role Brief
        </summary>
        <div style="font-size:12px;line-height:1.6;color:var(--ci-text-primary);padding:0 0 12px;">
          <div style="margin-bottom:8px;">${escHtml(rb.roleSummary)}</div>
          ${rb.whyInteresting ? `<div style="margin-bottom:6px;"><span style="font-weight:600;color:#059669;">Why interesting:</span> ${escHtml(rb.whyInteresting)}</div>` : ''}
          ${rb.concerns ? `<div style="margin-bottom:6px;"><span style="font-weight:600;color:#dc2626;">Concerns:</span> ${escHtml(rb.concerns)}</div>` : ''}
          ${rb.compRange ? `<div><span style="font-weight:600;color:var(--ci-text-secondary);">Comp:</span> ${escHtml(rb.compRange)}</div>` : ''}
        </div>
      </details>` : ''}
      <div class="qc-more" id="qc-more" data-id="${c.id}">View full details →</div>
      <div class="queue-nav">
        <span class="queue-nav-pos">${currentIdx + 1} / ${queue.length}</span>
        <button class="queue-rescore-btn" id="btn-rescore" title="Refresh data & rescore">↻ Rescore</button>
      </div>
      <div class="queue-actions">
        <button class="queue-action-btn pass" id="btn-pass">${CFG.passLabel} <span class="kbd">←</span></button>
        <button class="queue-action-btn interested" id="btn-interested">${CFG.interestedLabel} <span class="kbd">→</span></button>
      </div>
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
    btn.disabled = true;

    // Show Coop thinking overlay immediately
    const shell = card?.closest('.queue-card-shell');
    if (shell) {
      shell.style.position = 'relative';
      const overlay = document.createElement('div');
      overlay.className = 'coop-thinking-overlay';
      overlay.id = 'coop-thinking';
      overlay.innerHTML = `
        <div class="coop-thinking-face-wrap">
          <div class="coop-thinking-orbit"></div>
          <svg class="coop-thinking-face" width="192" height="192" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" fill="#3B5068"/>
            <clipPath id="ct"><circle cx="50" cy="50" r="48"/></clipPath>
            <g clip-path="url(#ct)">
              <!-- Suit jacket -->
              <ellipse cx="50" cy="100" rx="48" ry="28" fill="#3D4F5F"/>
              <ellipse cx="50" cy="100" rx="46" ry="26" fill="#435766"/>
              <path d="M18 96 Q28 84 38 80" fill="none" stroke="#364854" stroke-width="0.5"/>
              <path d="M82 96 Q72 84 62 80" fill="none" stroke="#364854" stroke-width="0.5"/>
              <path d="M26 100 L40 77 L50 88 L60 77 L74 100" fill="#364854"/>
              <path d="M40 77 L50 88" stroke="#2C3E4E" stroke-width="0.8" fill="none"/>
              <path d="M60 77 L50 88" stroke="#2C3E4E" stroke-width="0.8" fill="none"/>
              <path d="M40 77 L38 80 L50 90 L50 88Z" fill="#3A4E5E" opacity="0.5"/>
              <path d="M60 77 L62 80 L50 90 L50 88Z" fill="#3A4E5E" opacity="0.5"/>
              <!-- Shirt + collar -->
              <path d="M40 77 L50 94 L60 77" fill="#F0EAE0"/>
              <path d="M43 80 L50 90 L57 80" fill="#E8E2D8" opacity="0.4"/>
              <path d="M40 77 L43 75 L44 78Z" fill="#F0EAE0"/>
              <path d="M60 77 L57 75 L56 78Z" fill="#F0EAE0"/>
              <!-- Bow tie -->
              <path d="M41 78 Q44 73 50 76 Q44 79 41 78Z" fill="#3D4F5F"/>
              <path d="M59 78 Q56 73 50 76 Q56 79 59 78Z" fill="#3D4F5F"/>
              <path d="M43 76 Q44 75 45 76" fill="none" stroke="#2C3E4E" stroke-width="0.3"/>
              <path d="M55 76 Q56 75 57 76" fill="none" stroke="#2C3E4E" stroke-width="0.3"/>
              <ellipse cx="50" cy="76.5" rx="2" ry="1.8" fill="#364854"/>
              <ellipse cx="50" cy="76.5" rx="1.2" ry="1" fill="#2C3E4E"/>
              <!-- Neck -->
              <rect x="43" y="71" width="14" height="8" rx="2" fill="#E8C4A0"/>
              <path d="M44 71 L44 75" stroke="#D4A878" stroke-width="0.3" opacity="0.4"/>
              <path d="M56 71 L56 75" stroke="#D4A878" stroke-width="0.3" opacity="0.4"/>
              <!-- Head -->
              <path d="M29 43 Q29 27 39 21 Q50 17 61 21 Q71 27 71 43 Q71 54 66 61 Q61 67 55 70 L50 72 L45 70 Q39 67 34 61 Q29 54 29 43Z" fill="#EDBB92"/>
              <path d="M34 61 Q39 67 45 70 L50 72 L55 70 Q61 67 66 61" fill="none" stroke="#D4A070" stroke-width="0.6" opacity="0.4"/>
              <ellipse cx="35" cy="50" rx="4" ry="2.5" fill="#F2C9A2" opacity="0.5"/>
              <ellipse cx="65" cy="50" rx="4" ry="2.5" fill="#F2C9A2" opacity="0.5"/>
              <!-- Ears -->
              <ellipse cx="29" cy="44" rx="3" ry="4.5" fill="#DFB088"/>
              <path d="M28 42 Q27 44 28 46" fill="none" stroke="#C8966E" stroke-width="0.4"/>
              <ellipse cx="71" cy="44" rx="3" ry="4.5" fill="#DFB088"/>
              <path d="M72 42 Q73 44 72 46" fill="none" stroke="#C8966E" stroke-width="0.4"/>
              <!-- Hair -->
              <path d="M27 40 Q27 15 50 10 Q73 15 73 40 L71 32 Q69 16 50 13 Q31 16 29 32Z" fill="#2D1F16"/>
              <path d="M27 40 Q27 25 36 18 L34 21 Q29 27 28 38Z" fill="#1E1410"/>
              <path d="M73 40 Q73 25 64 18 L66 21 Q71 27 72 38Z" fill="#1E1410"/>
              <path d="M29 31 Q30 13 50 10 Q70 13 71 31 Q69 17 50 13 Q31 17 29 31Z" fill="#3D2A1E"/>
              <path d="M37 19 Q44 11 56 11 Q64 13 68 19" fill="none" stroke="#1E1410" stroke-width="1" opacity="0.6"/>
              <path d="M33 23 Q38 13 50 11 Q58 11 63 15" fill="#3D2A1E" opacity="0.7"/>
              <path d="M35 26 Q40 16 50 12 Q55 12 58 14" fill="#4A3728" opacity="0.4"/>
              <path d="M30 38 L30 44" stroke="#2D1F16" stroke-width="1" opacity="0.3" stroke-linecap="round"/>
              <path d="M70 38 L70 44" stroke="#2D1F16" stroke-width="1" opacity="0.3" stroke-linecap="round"/>
              <!-- Forehead lines -->
              <path d="M39 30 Q45 29 51 30" fill="none" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
              <!-- Eyes — green/hazel, looking up-left (thinking) -->
              <ellipse cx="41" cy="44" rx="5" ry="4.5" fill="white"/>
              <ellipse cx="59" cy="44" rx="5" ry="4.5" fill="white"/>
              <circle cx="40" cy="42.5" r="3" fill="#5B8C3E"/>
              <circle cx="40" cy="42.5" r="2.2" fill="#4A7A30"/>
              <circle cx="40" cy="42.5" r="1.2" fill="#3A6B28"/>
              <circle cx="40.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/>
              <circle cx="58" cy="42.5" r="3" fill="#5B8C3E"/>
              <circle cx="58" cy="42.5" r="2.2" fill="#4A7A30"/>
              <circle cx="58" cy="42.5" r="1.2" fill="#3A6B28"/>
              <circle cx="58.5" cy="41.8" r="0.8" fill="white" opacity="0.7"/>
              <!-- Upper eyelids -->
              <path d="M36 42.5 Q41 40 46 42.5" fill="#EDBB92" opacity="0.5"/>
              <path d="M54 42.5 Q59 40 64 42.5" fill="#EDBB92" opacity="0.5"/>
              <!-- Lower lid line -->
              <path d="M37 46.5 Q41 48 45 46.5" fill="none" stroke="#C8966E" stroke-width="0.4" opacity="0.4"/>
              <path d="M55 46.5 Q59 48 63 46.5" fill="none" stroke="#C8966E" stroke-width="0.4" opacity="0.4"/>
              <!-- Crow's feet -->
              <path d="M34 43 L32.5 41.5" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
              <path d="M66 43 L67.5 41.5" stroke="#D4A070" stroke-width="0.3" opacity="0.3"/>
              <!-- Eyebrows — right raised (thinking) -->
              <path d="M35 37 Q38 35 41 35 Q44 35 47 37" fill="#2D1F16" opacity="0.8"/>
              <path d="M53 35.5 Q56 33 59 33 Q62 33 65 35.5" fill="#2D1F16" opacity="0.8"/>
              <!-- Brow bone shadow -->
              <path d="M36 38 Q41 36.5 46 38" fill="none" stroke="#C8966E" stroke-width="0.3" opacity="0.3"/>
              <path d="M54 38 Q59 36.5 64 38" fill="none" stroke="#C8966E" stroke-width="0.3" opacity="0.3"/>
              <!-- Nose -->
              <path d="M50 39 L49 50" fill="none" stroke="#D4A070" stroke-width="0.5" opacity="0.4"/>
              <path d="M47 53 Q48 55 50 55.5 Q52 55 53 53" fill="none" stroke="#C8966E" stroke-width="0.7" stroke-linecap="round"/>
              <!-- Nasolabial folds -->
              <path d="M38 52 Q39 56 40 59" fill="none" stroke="#D4A070" stroke-width="0.4" opacity="0.35"/>
              <path d="M62 52 Q61 56 60 59" fill="none" stroke="#D4A070" stroke-width="0.4" opacity="0.35"/>
              <!-- Mouth — thoughtful closed -->
              <path d="M43 60 Q47 62 50 62 Q53 62 57 60" fill="none" stroke="#9B7055" stroke-width="1" stroke-linecap="round"/>
              <!-- Chin -->
              <path d="M46 67 Q50 69 54 67" fill="none" stroke="#D4A070" stroke-width="0.4" opacity="0.3"/>
              <!-- Stubble -->
              <circle cx="44" cy="65" r="0.3" fill="#B89878" opacity="0.2"/>
              <circle cx="50" cy="66.5" r="0.3" fill="#B89878" opacity="0.2"/>
              <circle cx="56" cy="65" r="0.3" fill="#B89878" opacity="0.2"/>
              <!-- Arm from shoulder to chin -->
              <path d="M65 84 Q72 76 69 68 Q67 63 62 62" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/>
              <path d="M65 84 Q68 80 69 76" fill="none" stroke="#364854" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/>
              <!-- Hand on chin -->
              <path d="M48 66 Q50 62 56 61 Q62 62 63 66 Q62 69 58 70 Q52 71 49 68Z" fill="#E8C4A0" stroke="#D4A070" stroke-width="0.5"/>
            </g>
          </svg>
        </div>
        <div class="coop-thinking-dots"><span></span><span></span><span></span></div>
        <div class="coop-thinking-label">Coop is thinking...</div>
        <div class="coop-thinking-sub">Preparing to score...</div>
        <div class="coop-thinking-bar"><div class="coop-thinking-bar-fill"></div></div>`;
      shell.appendChild(overlay);
    }

    // If LinkedIn job URL, rescrape first (free — just DOM read), then score
    const canRescrape = c.jobUrl && /linkedin\.com\/jobs\/view\//i.test(c.jobUrl);
    const startScoring = () => {
      btn.innerHTML = DEV_MOCK ? '<span class="rescore-spinner"></span> Mock scoring...' : '<span class="rescore-spinner"></span> Scoring...';
      // Update overlay sub-label for scoring phase
      const thinkSub = document.querySelector('.coop-thinking-sub');
      if (thinkSub) thinkSub.textContent = 'Analyzing job fit & scoring';
    const startTime = Date.now();
    chrome.runtime.sendMessage({ type: DEV_MOCK ? 'DEV_MOCK_SCORE' : 'SCORE_OPPORTUNITY', entryId: c.id }, (response) => {
      void chrome.runtime.lastError;
      if (response?.error) {
        clearInterval(pollInterval);
        document.getElementById('coop-thinking')?.remove();
        btn.innerHTML = '⚠ Rescore failed';
        btn.disabled = false;
        console.error('[Queue] Rescore error:', response.error);
        setTimeout(() => { btn.innerHTML = '↻ Rescore'; }, 3000);
      }
    });
    // Poll for score update
    const pollInterval = setInterval(() => {
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const updated = (savedCompanies || []).find(x => x.id === c.id);
        if (updated?.jobMatch?.lastUpdatedAt > startTime) {
          clearInterval(pollInterval);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const u = updated.jobMatch?.lastScoringUsage;
          const costStr = u ? ` · ${(u.input + u.output).toLocaleString()} tokens · ~$${u.cost?.toFixed(4) || '?'}` : '';
          const modelStr = u?.model ? ` · ${u.model.replace(/^claude-/, '').replace(/^gpt-/, '')}` : '';
          btn.innerHTML = `✓ ${elapsed}s${modelStr}${costStr}`;
          btn.title = u ? `Model: ${u.model || '?'}\nInput: ${u.input} tokens\nOutput: ${u.output} tokens\nCost: ~$${u.cost?.toFixed(4) || '?'}` : '';
          document.getElementById('coop-thinking')?.remove();
          queue[currentIdx] = updated;
          setTimeout(() => renderCurrent(), 3000);
        }
      });
    }, 1500);
      // Timeout after 30s
      setTimeout(() => { clearInterval(pollInterval); btn.innerHTML = '↻ Rescore'; btn.disabled = false; document.getElementById('coop-thinking')?.remove(); }, 30000);
    };

    // Refresh data before scoring when a job URL exists
    if (canRescrape) {
      // LinkedIn: open background tab for full DOM scrape (auth-walled SPA)
      btn.innerHTML = '<span class="rescore-spinner"></span> Refreshing data...';
      const s1 = document.querySelector('.coop-thinking-sub');
      if (s1) s1.textContent = 'Refreshing LinkedIn job data...';
      chrome.runtime.sendMessage({ type: 'RESCRAPE_LINKEDIN_JOB', entryId: c.id }, resp => {
        void chrome.runtime.lastError;
        if (resp?.error) console.warn('[Queue] Rescrape failed, scoring with existing data:', resp.error);
        startScoring();
      });
    } else if (c.jobUrl) {
      // Non-LinkedIn: re-fetch JD from URL (direct fetch, free)
      btn.innerHTML = '<span class="rescore-spinner"></span> Refreshing data...';
      const s2 = document.querySelector('.coop-thinking-sub');
      if (s2) s2.textContent = 'Refreshing job posting data...';
      chrome.runtime.sendMessage({ type: 'REFRESH_JOB_DATA', entryId: c.id }, resp => {
        void chrome.runtime.lastError;
        startScoring();
      });
    } else {
      startScoring();
    }
  });
  document.getElementById('qc-apply-cta')?.addEventListener('click', (e) => {
    if (!c.jobUrl) return;
    e.preventDefault();
    (async () => {
      try {
        // Send a direct message to the (already-loaded) side panel so it binds
        // immediately without relying on the startup IIFE or storage polling.
        // Falls back to storage for fresh panel loads where the listener isn't up yet.
        try { chrome.runtime.sendMessage({ type: 'QUEUE_OPEN_APPLICATION', entryId: c.id }); } catch (_) {}
        // Write to BOTH session and local — the freshly-opened side panel reads
        // session first then falls back to local. Belt-and-suspenders since the
        // session read path has historically been fragile across Chrome versions.
        const payload = { pendingSidePanelBind: { entryId: c.id, ts: Date.now() } };
        try { await chrome.storage.session.set(payload); } catch (_) {}
        try { await chrome.storage.local.set(payload); } catch (_) {}
        const tab = await chrome.tabs.create({ url: c.jobUrl, active: true });
        try {
          await chrome.sidePanel.open({ tabId: tab.id });
        } catch (err) {
          try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (_) {}
        }
      } catch (err) {
        window.open(c.jobUrl, '_blank');
      }
    })();
  });

  document.getElementById('qc-more').addEventListener('click', () => {
    coopNavigate(chrome.runtime.getURL('company.html') + '?id=' + c.id);
  });

  // Dimension toggle — switch which detail panel is visible
  document.querySelectorAll('.queue-dim-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dimKey = btn.dataset.dim;
      const wasActive = btn.classList.contains('active');
      document.querySelectorAll('.queue-dim-toggle-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.queue-dim-detail').forEach(p => p.classList.remove('active'));
      const toggleStrip = document.querySelector('.queue-dim-toggle');
      if (!wasActive) {
        btn.classList.add('active');
        const panel = document.querySelector(`.queue-dim-detail[data-dim="${dimKey}"]`);
        if (panel) panel.classList.add('active');
        if (toggleStrip) toggleStrip.classList.add('has-active');
      } else {
        if (toggleStrip) toggleStrip.classList.remove('has-active');
      }
    });
  });

  // Clicking a bar row also selects that dimension's toggle
  document.querySelectorAll('.qc-breakdown .queue-dim-bar-row').forEach(row => {
    row.addEventListener('click', () => {
      const dimKey = row.dataset.dim;
      const btn = document.querySelector(`.queue-dim-toggle-btn[data-dim="${dimKey}"]`);
      if (btn) btn.click();
    });
  });

  // Qualification expand/collapse for evidence
  document.querySelectorAll('.queue-qual-line.expandable').forEach(line => {
    line.addEventListener('click', e => {
      if (e.target.closest('.queue-qual-correct-btn, .queue-qual-line-src')) return;
      line.classList.toggle('expanded');
    });
  });

  // Qualification correction buttons
  document.querySelectorAll('.queue-qual-correct-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const reqText = btn.dataset.qualReq || '';
      // Deep-link to Experience section with the qualification as a suggested tag to add
      const expUrl = `${prefsUrl}?section=experience&addTag=${encodeURIComponent(reqText)}`;
      window.open(expUrl, '_blank');
    });
  });

  // Drawer flag dismiss buttons
  document.querySelectorAll('.queue-flag-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const flagText = btn.dataset.flagText;
      const flagType = btn.dataset.flagType;
      if (!flagText) return;
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const companies = savedCompanies || [];
        const idx = companies.findIndex(x => x.id === c.id);
        if (idx === -1) return;
        const jm = companies[idx].jobMatch || {};
        jm.dismissedFlags = [...(jm.dismissedFlags || []), flagText];
        jm.dismissedFlagsWithReasons = [...(jm.dismissedFlagsWithReasons || []), { flag: flagText, type: flagType, date: new Date().toISOString().slice(0, 10) }];
        companies[idx].jobMatch = jm;
        _suppressStorageReload = true;
        chrome.storage.local.set({ savedCompanies: companies });
        queue[currentIdx].jobMatch = jm;
        const card = btn.closest('.queue-flag-card');
        if (card) { card.style.opacity = '0.3'; card.style.textDecoration = 'line-through'; }
      });
    });
  });

  // "+N more" flag expanders
  document.querySelectorAll('.queue-flags-more-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const overflow = btn.previousElementSibling;
      if (!overflow) return;
      const expanded = btn.dataset.expanded === '1';
      overflow.style.display = expanded ? 'none' : 'block';
      btn.dataset.expanded = expanded ? '0' : '1';
      const count = overflow.querySelectorAll('.queue-flag-card, .queue-qual-line').length;
      btn.textContent = expanded ? `+${count} more` : 'Show fewer';
    });
  });

  // Inline facts editing
  document.getElementById('qc-correct-toggle')?.addEventListener('click', () => {
    const grid = document.querySelector('.qc-facts-grid');
    const toggle = document.getElementById('qc-correct-toggle');
    if (!grid) return;
    const isEditing = grid.dataset.editing === '1';
    if (isEditing) {
      // Cancel — re-render to restore
      renderCurrent();
      return;
    }
    grid.dataset.editing = '1';
    toggle.textContent = '✕ Cancel';
    // Replace each fact value with an input
    const FIELDS = [
      { key: 'location',    label: 'Location',    val: location,    input: 'text' },
      { key: 'salary',      label: 'Base',        val: baseSalary,  input: 'text' },
      { key: 'totalcomp',   label: 'Total Comp',  val: totalComp,   input: 'text' },
      { key: 'industry',    label: 'Industry',    val: c.industry || '', input: 'text' },
      { key: 'funding',     label: 'Funding',     val: funding, input: 'text' },
      { key: 'employees',   label: 'Employees',   val: employees, input: 'text' },
      { key: 'arrangement', label: 'Arrangement', val: arrangement, input: 'select' },
    ];
    grid.innerHTML = FIELDS.map(f => {
      if (f.input === 'skip') return `<div class="qc-fact-row"><span class="qc-fact-label">${f.label}</span><span class="qc-fact-val unknown">auto</span></div>`;
      if (f.input === 'select') return `<div class="qc-fact-row"><span class="qc-fact-label">${f.label}</span><select class="qc-fact-input" data-key="${f.key}" style="font-size:11px;border:1px solid var(--ci-border);border-radius:4px;padding:2px 4px;width:100%;background:var(--ci-bg-card);"><option value="">—</option><option value="Remote"${f.val==='Remote'?' selected':''}>Remote</option><option value="Hybrid"${f.val==='Hybrid'?' selected':''}>Hybrid</option><option value="On-site"${f.val==='On-site'?' selected':''}>On-site</option></select></div>`;
      return `<div class="qc-fact-row"><span class="qc-fact-label">${f.label}</span><input class="qc-fact-input" data-key="${f.key}" type="text" value="${escHtml(f.val)}" placeholder="–" style="font-size:11px;border:1px solid var(--ci-border);border-radius:4px;padding:2px 6px;width:100%;background:var(--ci-bg-card);color:var(--ci-text-primary);"></div>`;
    }).join('');
    // Add save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save & Rescore';
    saveBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px;font-size:12px;font-weight:700;background:var(--ci-accent-primary);color:#fff;border:none;border-radius:6px;cursor:pointer;';
    grid.after(saveBtn);
    saveBtn.addEventListener('click', () => {
      const vals = {};
      grid.querySelectorAll('.qc-fact-input').forEach(el => { vals[el.dataset.key] = el.value.trim(); });
      chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
        const companies = savedCompanies || [];
        const idx = companies.findIndex(x => x.id === c.id);
        if (idx === -1) return;
        companies[idx].jobSnapshot = companies[idx].jobSnapshot || {};
        if (vals.location)    companies[idx].jobSnapshot.location      = vals.location;
        if (vals.salary)      companies[idx].jobSnapshot.salary        = vals.salary;
        if (vals.totalcomp)   companies[idx].jobSnapshot.oteTotalComp  = vals.totalcomp;
        if (vals.industry)    companies[idx].industry                  = vals.industry;
        if (vals.funding)     companies[idx].funding                   = vals.funding;
        if (vals.employees)   companies[idx].employees                 = vals.employees;
        if (vals.arrangement) companies[idx].jobSnapshot.workArrangement = vals.arrangement;
        const corrections = Object.entries(vals).filter(([,v]) => v).map(([k, v]) => ({ text: `${k} corrected to: ${v}`, date: new Date().toISOString().slice(0, 10) }));
        if (corrections.length) {
          companies[idx]._userCorrections = (companies[idx]._userCorrections || []).concat(corrections);
        }
        chrome.storage.local.set({ savedCompanies: companies }, () => {
          document.getElementById('btn-rescore')?.click();
        });
      });
    });
  });

  // Flag info toggle
  document.querySelectorAll('.qc-flag-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const detailId = btn.dataset.detail;
      const panel = document.getElementById(detailId);
      if (!panel) return;
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : 'block';
      btn.classList.toggle('active', !isOpen);
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
          _suppressStorageReload = true;
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
            row.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px;opacity:1;text-decoration:none;padding:10px 12px;background:#fff;border:1px solid #E0E4E8;border-radius:8px;';
            row.innerHTML = `<div style="font-size:11px;font-weight:600;color:#6B6F76;">Tell Coop why this is wrong — he'll learn from it</div>
              <textarea placeholder="e.g., This role is actually remote — the listing is mislabeled. Comp is disclosed at $104K-$163K in the posting." style="width:100%;font-size:12px;padding:8px 10px;border:1px solid #E0E4E8;border-radius:6px;font-family:inherit;background:#F6F8F9;color:#1E1F21;outline:none;resize:vertical;min-height:50px;line-height:1.5;"></textarea>
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="reason-cancel" style="font-size:11px;padding:5px 12px;border:1px solid #E0E4E8;border-radius:6px;background:#fff;color:#6B6F76;cursor:pointer;font-family:inherit;font-weight:600;">Skip</button>
                <button class="reason-save" style="font-size:11px;padding:5px 14px;border:none;border-radius:6px;background:#FC636B;color:#fff;cursor:pointer;font-family:inherit;font-weight:600;">Save Feedback</button>
              </div>`;
            flagEl.appendChild(row);
            const textarea = row.querySelector('textarea');
            textarea.focus();
            const saveFn = (reason) => {
              jm.dismissedFlags = [...dismissed, flagText];
              jm.dismissedFlagsWithReasons = [...withReasons, { flag: flagText, reason: reason || null, type: flagType, date: new Date().toISOString().slice(0, 10) }];
              companies[idx].jobMatch = jm;
              _suppressStorageReload = true;
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
  } catch(e) {
    console.error('[Queue] renderCurrent error:', e);
    main.innerHTML = `<div class="queue-empty"><div class="queue-empty-icon">⚠</div><div class="queue-empty-title">Could not render this card</div><div class="queue-empty-sub">${e.message || 'Unknown error'}</div></div>`;
    updateCount();
  }
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
    if (SINGLE_ID) { window.close(); return; }
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
  if (msg.type === 'SCORE_COMPLETE') {
    loadQueue(); // refresh
  }
});

// Auto-refresh when savedCompanies changes (e.g. new save from sidepanel)
let _suppressStorageReload = false;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.savedCompanies) {
    if (_suppressStorageReload) { _suppressStorageReload = false; return; }
    loadQueue();
  }
});

// Init
loadQueue();
