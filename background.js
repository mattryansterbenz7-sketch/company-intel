// ── ES Module imports ──────────────────────────────────────────────────────
import { state, DEFAULT_PIPELINE_CONFIG, QUEUE_AUTO_PROCESS, initKeysFromConfig, initKeysFromStorage, initCoopConfig, initCachedUserName, initPipelineConfig } from './bg-state.js';
import { dlog } from './utils.js';
import { claudeApiCall, getApiUsage } from './api.js';
import { fetchLeaderPhoto, testApiKey } from './search.js';
import { gmailAuth, gmailRevoke, fetchGmailEmails, detectRejectionEmailBg } from './gmail.js';
import { fetchCalendarEvents } from './calendar.js';
import { buildGranolaIndex, searchGranolaNotes } from './granola.js';
import { researchCompany, quickLookup } from './research.js';
import { interpretProfileSection, scoreOpportunity, processQueue, computeStructuralMatches, handleDevMockScore } from './scoring.js';
import { consolidateProfile } from './memory.js';
import { syncEntryFields, generateRoleBrief, extractNextSteps, extractEmailTasks, backfillMissingWebsites, migrateJobsToCompanies, handleSaveOpportunity } from './sync.js';
import { handleCoopMessage, handleChatMessage, handleGlobalChatMessage, handleCoopAssistRewrite } from './coop-chat.js';
import { handleQuickEnrichFirmo } from './search.js';

// Floating sidebar is the primary UI — icon click toggles it
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── First-install auto-open side panel (Coop onboarding Phase 1) ─────────
// On fresh install, open the side panel in the current window so the user
// lands directly in the Coop chat where the onboarding flow kicks in.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install') return;
  try {
    chrome.windows.getCurrent({}, win => {
      void chrome.runtime.lastError;
      if (!win || typeof win.id !== 'number') return;
      try {
        chrome.sidePanel.open({ windowId: win.id }, () => { void chrome.runtime.lastError; });
      } catch (e) {
        console.warn('[onboarding] sidePanel.open failed', e);
      }
    });
  } catch (e) {
    console.warn('[onboarding] onInstalled handler failed', e);
  }
});

// ── Screenshot port: receives large screenshot data from sidepanel ──
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'coop-screenshot') {
    port.onMessage.addListener(msg => {
      if (msg.screenshot) {
        state._pendingScreenshot = msg.screenshot;
        dlog(`[Screenshot] Received via port (${Math.round(msg.screenshot.length / 1024)}KB) — stored in memory`);
      }
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) return;
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' }, () => void chrome.runtime.lastError);
});

// Load API keys: config.js fallback → storage override
// coop.js not needed in service worker (COOP object only used in UI pages)
// config.js loaded async — storage keys override anyway
import('./config.js').then(m => initKeysFromConfig(m.CONFIG || {})).catch(() => {});
initKeysFromStorage();
// Trigger Granola index build after keys load
chrome.storage.local.get(['integrations'], ({ integrations }) => {
  if (integrations?.granola_key) setTimeout(() => buildGranolaIndex(), 5000);
});

// ── One-time migration: strip trailing punctuation from company names ────────
chrome.storage.local.get(['savedCompanies', 'researchCache', 'photoCache', '_migratedPunctuation2'], data => {
  if (data._migratedPunctuation2) return; // already ran
  const strip = s => s.replace(/[,;:!?.]+$/, '').trim();
  let dirty = false;

  // Clean savedCompanies
  const companies = data.savedCompanies || [];
  for (const c of companies) {
    if (c.company && c.company !== strip(c.company)) {
      c.company = strip(c.company);
      dirty = true;
    }
  }
  if (dirty) chrome.storage.local.set({ savedCompanies: companies });

  // Clean researchCache keys
  const cache = data.researchCache || {};
  const cleaned = {};
  let cacheDirty = false;
  for (const [k, v] of Object.entries(cache)) {
    const cleanK = strip(k);
    if (cleanK !== k) cacheDirty = true;
    if (!cleaned[cleanK] || (v.ts > cleaned[cleanK].ts)) {
      cleaned[cleanK] = v;
    }
  }
  if (cacheDirty) chrome.storage.local.set({ researchCache: cleaned });

  // Clean state.photoCache keys — company name is embedded in the key after |
  const pc = data.photoCache || {};
  const cleanedPhotos = {};
  let photoDirty = false;
  for (const [k, v] of Object.entries(pc)) {
    // Key format: "Name|\"Company,\"" → strip punctuation before closing quote
    const cleanK = k.replace(/[,;:!?.]+(?="?\s*$)/, '');
    if (cleanK !== k) photoDirty = true;
    if (!cleanedPhotos[cleanK]) cleanedPhotos[cleanK] = v;
  }
  if (photoDirty) {
    Object.assign(state.photoCache, cleanedPhotos);
    chrome.storage.local.set({ photoCache: cleanedPhotos });
  }

  // Clean duplicate/concatenated job titles
  for (const c of companies) {
    if (c.jobTitle) {
      const words = c.jobTitle.split(/\s+/);
      const half = Math.floor(words.length / 2);
      if (half >= 2) {
        const firstHalf = words.slice(0, half).join(' ').toLowerCase();
        const rest = c.jobTitle.toLowerCase();
        if (rest.indexOf(firstHalf) === 0 && rest.indexOf(firstHalf, 1) > 0) {
          c.jobTitle = c.jobTitle.slice(rest.indexOf(firstHalf, 1)).trim();
          dirty = true;
        }
      }
    }
  }
  if (dirty) chrome.storage.local.set({ savedCompanies: companies });

  chrome.storage.local.set({ _migratedPunctuation2: true });
  if (dirty || cacheDirty) console.log('[Migration] Cleaned company names and job titles');
});

// Live-update keys when user saves them from Integrations page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.integrations) {
    const v = changes.integrations.newValue || {};
    const ck = k => (k || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (v.anthropic_key) state.ANTHROPIC_KEY = ck(v.anthropic_key);
    if (v.apollo_key)    state.APOLLO_KEY = ck(v.apollo_key);
    if (v.serper_key)    state.SERPER_KEY = ck(v.serper_key);
    if (v.openai_key)    state.OPENAI_KEY = ck(v.openai_key);
    if (v.granola_key)   state.GRANOLA_KEY = ck(v.granola_key);
    if (v.google_cse_key) state.GOOGLE_CSE_KEY = ck(v.google_cse_key);
    if (v.google_cse_cx)  state.GOOGLE_CSE_CX = ck(v.google_cse_cx);
    state._apolloExhausted = false;
    state._serperExhausted = false;
  }
});

// Periodic Granola index refresh (every 6 hours, using setInterval — no alarms permission needed)
setInterval(() => { if (state.GRANOLA_KEY) buildGranolaIndex(); }, 6 * 60 * 60 * 1000);

// Boot-time init
initCoopConfig();
initCachedUserName();

initPipelineConfig();

// Live-update pipeline config
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pipelineConfig) {
    state.pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...changes.pipelineConfig.newValue };
  }
  if (area === 'local' && changes.coopConfig) {
    state.coopConfig = changes.coopConfig.newValue || {};
  }
  if (area === 'sync' && changes.prefs) {
    const p = changes.prefs.newValue || {};
    state.cachedUserName = p.name || p.fullName || '';
  }
});

// ── One-time scan for data contamination ────────────────────────────────────
chrome.storage.local.get(['savedCompanies', '_dataConflictScanDone'], data => {
  if (data._dataConflictScanDone) return;
  const entries = data.savedCompanies || [];
  let changed = false;
  for (const e of entries) {
    if (e.dataConflict) continue; // already flagged
    const desc = e.intelligence?.eli5 || e.intelligence?.oneLiner || '';
    if (!desc || !e.company) continue;
    const companyWords = e.company.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    if (!companyWords.length) continue;
    const descLower = desc.toLowerCase();
    const mentionsCompany = companyWords.some(w => descLower.includes(w));
    if (!mentionsCompany) {
      e.dataConflict = true;
      changed = true;
      console.warn('[DataIntegrity] Flagged potential contamination:', e.company, '| desc:', desc.slice(0, 60));
    }
  }
  if (changed) chrome.storage.local.set({ savedCompanies: entries });
  chrome.storage.local.set({ _dataConflictScanDone: true });
});

// ── Message router ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_DEBUG_LOG') {
    sendResponse({ log: state._debugLog.join('\n') });
    return false;
  }
  if (message.type === 'COOP_ASSIST_REWRITE') {
    handleCoopAssistRewrite(message).then(sendResponse).catch(e => sendResponse({ error: e.message || String(e) }));
    return true;
  }
  if (message.type === 'OPEN_QUEUE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('queue.html') });
    return false;
  }
  if (message.type === 'OPEN_SIDE_PANEL') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (e) {
        console.warn('[SidePanel] Failed to open:', e.message);
      }
    })();
    return false;
  }
  if (message.type === 'CLOSE_SIDE_PANEL') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          // Try tabId first (Chrome 120+), fall back to windowId
          try { await chrome.sidePanel.close({ tabId: tab.id }); }
          catch { await chrome.sidePanel.close({ windowId: tab.windowId }); }
        }
      } catch (e) {
        console.warn('[Close] sidePanel.close failed:', e.message);
        // Fallback: disable the side panel for this tab
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
            await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
            // Re-enable after a tick so it can be opened again
            setTimeout(() => chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true }), 100);
          }
        } catch {}
      }
    })();
    return false;
  }
  if (message.type === 'QUICK_LOOKUP') {
    quickLookup(message.company, message.domain, message.companyLinkedin, message.linkedinFirmo).then(sendResponse);
    return true;
  }
  if (message.type === 'RESEARCH_COMPANY') {
    researchCompany(message.company, message.domain, message.prefs, message.companyLinkedin, message.linkedinFirmo).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_LEADER_PHOTOS') {
    const { leaders, company } = message;
    const photoConfig = state.pipelineConfig.photos || DEFAULT_PIPELINE_CONFIG.photos;
    const maxPhotos = photoConfig.maxPerCompany ?? 3;
    const sourceOrder = photoConfig.sourceOrder || ['linkedin_thumbnail', 'serper_images'];
    const capped = leaders.slice(0, maxPhotos);
    Promise.all(capped.map(l => {
      // Try sources in configured order
      if (sourceOrder.includes('linkedin_thumbnail') && (l.photoUrl || l.thumbnailUrl)) {
        return Promise.resolve(l.photoUrl || l.thumbnailUrl);
      }
      if (sourceOrder.includes('serper_images')) {
        return fetchLeaderPhoto(l.name, `"${company}"`);
      }
      return Promise.resolve(null);
    })).then(photos => {
      while (photos.length < leaders.length) photos.push(null);
      sendResponse(photos);
    });
    return true;
  }
  if (message.type === 'GMAIL_AUTH') {
    gmailAuth().then(sendResponse);
    return true;
  }
  if (message.type === 'GMAIL_FETCH_EMAILS') {
    fetchGmailEmails(message.domain, message.companyName, message.linkedinSlug, message.knownContactEmails).then(sendResponse);
    return true;
  }
  if (message.type === 'CLOSE_SIDEPANEL') {
    // Close the sidepanel via Chrome API
    chrome.sidePanel?.setOptions?.({ enabled: false }).then(() => {
      // Re-enable for future use
      setTimeout(() => chrome.sidePanel?.setOptions?.({ enabled: true }), 100);
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'SCAN_REJECTIONS') {
    // Scan all active entries for rejection emails
    chrome.storage.local.get(['savedCompanies'], ({ savedCompanies }) => {
      const entries = savedCompanies || [];
      const activeStages = ['applied', 'co_applied', 'interviewing', 'phone_screen', 'interview', 'final_round', 'want_to_apply'];
      let updated = 0;
      entries.forEach(entry => {
        if (!activeStages.includes(entry.jobStage || entry.status || '')) return;
        if ((entry.tags || []).includes('Application Rejected')) return;
        if (!entry.cachedEmails?.length) return;
        const rejection = detectRejectionEmailBg(entry.cachedEmails, entry);
        if (rejection) {
          console.log(`[Rejection] Auto-detected for ${entry.company}: "${rejection.subject}"`);
          entry.jobStage = 'rejected';
          entry.status = 'closed';
          const tags = entry.tags || [];
          if (!tags.includes('Application Rejected')) tags.push('Application Rejected');
          entry.tags = tags;
          entry.rejectedAt = Date.now();
          entry.rejectionEmail = { subject: rejection.subject, from: rejection.from, date: rejection.date, snippet: rejection.snippet };
          if (!entry.stageTimestamps) entry.stageTimestamps = {};
          entry.stageTimestamps.rejected = Date.now();
          updated++;
        }
      });
      if (updated > 0) {
        chrome.storage.local.set({ savedCompanies: entries });
      }
      sendResponse({ updated });
    });
    return true;
  }
  if (message.type === 'GMAIL_REVOKE') {
    gmailRevoke().then(sendResponse);
    return true;
  }
  if (message.type === 'CHAT_MESSAGE') {
    handleChatMessage(message)
      .then(sendResponse)
      .catch(e => {
        console.error('[CHAT_MESSAGE] handler error:', e);
        sendResponse({ error: e?.message || 'Chat handler failed', reply: '' });
      });
    return true;
  }
  if (message.type === 'QUICK_ENRICH_FIRMO') {
    handleQuickEnrichFirmo(message).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'FETCH_URL') {
    (async () => {
      try {
        const res = await fetch(message.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) { sendResponse({ error: `HTTP ${res.status}` }); return; }
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ').trim();
        sendResponse({ text: text.slice(0, 6000) });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
  if (message.type === 'COOP_CHAT') {
    handleCoopMessage({
      messages: message.messages,
      globalChat: message.globalChat !== false,
      chatModel: message.chatModel,
      careerOSChat: message.careerOSChat
    }).then(sendResponse);
    return true;
  }
  if (message.type === 'CALENDAR_FETCH_EVENTS') {
    fetchCalendarEvents(message.domain, message.companyName, message.knownContactEmails).then(sendResponse);
    return true;
  }
  if (message.type === 'UPDATE_PIPELINE_SETTING') {
    const { key, value } = message;
    // Re-read from storage first to avoid overwriting other settings
    chrome.storage.local.get(['pipelineConfig'], d => {
      const saved = d.pipelineConfig || {};
      if (key === 'chatModel') {
        if (!saved.aiModels) saved.aiModels = {};
        saved.aiModels.chat = value;
        state.pipelineConfig.aiModels.chat = value;
      } else if (key === 'scoringModel') {
        if (!saved.aiModels) saved.aiModels = {};
        saved.aiModels.jobMatchScoring = value;
        state.pipelineConfig.aiModels.jobMatchScoring = value;
      } else if (key === 'researchModel') {
        if (!saved.aiModels) saved.aiModels = {};
        saved.aiModels.companyIntelligence = value;
        state.pipelineConfig.aiModels.companyIntelligence = value;
      }
      chrome.storage.local.set({ pipelineConfig: saved });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === 'SYNC_ENTRY_FIELDS') {
    syncEntryFields(message.entryId).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'GENERATE_ROLE_BRIEF') {
    generateRoleBrief(message).then(sendResponse);
    return true;
  }
  // DEEP_FIT_ANALYSIS removed — unified into scoreOpportunity (scoring.js)
  if (message.type === 'EXTRACT_NEXT_STEPS') {
    extractNextSteps(message.notes, message.calendarEvents, message.transcripts, message.emailContext).then(sendResponse);
    return true;
  }
  if (message.type === 'EXTRACT_EMAIL_TASKS') {
    extractEmailTasks(message.entry, message.emails, message.existingTaskTexts).then(sendResponse);
    return true;
  }
  if (message.type === 'GRANOLA_SEARCH') {
    searchGranolaNotes(message.companyName, message.companyDomain || null, message.contactNames || []).then(sendResponse);
    return true;
  }
  if (message.type === 'GRANOLA_BUILD_INDEX') {
    buildGranolaIndex().then(sendResponse);
    return true;
  }
  if (message.type === 'CONSOLIDATE_PROFILE') {
    consolidateProfile(message.rawInput, message.insights).then(sendResponse);
    return true;
  }
  if (message.type === 'EXTRACT_IMAGE_TEXT') {
    (async () => {
      try {
        const res = await claudeApiCall({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: message.mediaType, data: message.imageBase64 } },
              { type: 'text', text: 'Extract all text from this image. Return the text exactly as it appears, preserving formatting. If this is a job description, preserve section headings and bullet points.' }
            ]
          }]
        });
        const data = await res.json();
        if (data?.content?.[0]?.text) {
          sendResponse({ text: data.content[0].text });
        } else {
          sendResponse({ error: 'No text extracted', text: '' });
        }
      } catch (e) {
        sendResponse({ error: e.message, text: '' });
      }
    })();
    return true;
  }
  if (message.type === 'GLOBAL_CHAT_MESSAGE') {
    handleGlobalChatMessage(message).then(sendResponse);
    return true;
  }
  if (message.type === 'COOP_MESSAGE') {
    handleCoopMessage(message).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_KEY_STATUS') {
    sendResponse({
      anthropic: !!state.ANTHROPIC_KEY,
      apollo: !!state.APOLLO_KEY,
      serper: !!state.SERPER_KEY,
      openai: !!state.OPENAI_KEY,
      granola: !!state.GRANOLA_KEY,
      google_cse: !!(state.GOOGLE_CSE_KEY && state.GOOGLE_CSE_CX),
      apolloExhausted: state._apolloExhausted,
      serperExhausted: state._serperExhausted,
    });
    return true;
  }
  if (message.type === 'TEST_API_KEY') {
    testApiKey(message.provider, message.key).then(sendResponse);
    return true;
  }

  // ── Dev Mock Scoring (no API call) ──────────────────────────────────────────
  if (message.type === 'DEV_MOCK_SCORE') {
    handleDevMockScore(message.entryId).then(sendResponse).catch(err => {
      console.error('[DevMock] Error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  }

  // ── Unified Save Opportunity Handler ────────────────────────────────────────
  if (message.type === 'SAVE_OPPORTUNITY') {
    handleSaveOpportunity(message).then(sendResponse).catch(err => {
      console.error('[SaveOpp] Error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  }

  // ── Re-scrape LinkedIn job data into existing entry ─────────────────────────
  if (message.type === 'RESCRAPE_LINKEDIN_JOB') {
    rescrapeLinkedInJob(message).then(sendResponse).catch(err => {
      console.error('[Rescrape] Error:', err);
      sendResponse({ error: err.message });
    });
    return true;
  }

  // ── Quick Fit Scoring Handlers ──────────────────────────────────────────────
  if (message.type === 'SCORE_OPPORTUNITY') {
    scoreOpportunity(message.entryId).then(sendResponse).catch(err => {
      console.error('[QuickFit] SCORE_OPPORTUNITY error:', err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (message.type === 'QUEUE_SCORE') {
    state._scoringQueue.push(message.entryId);
    if (QUEUE_AUTO_PROCESS) processQueue();
    sendResponse({ queued: true });
    return true;
  }
  if (message.type === 'COMPUTE_STRUCTURAL_MATCHES') {
    const matches = computeStructuralMatches(message.entry, message.prefs);
    sendResponse(matches);
    return true;
  }
  if (message.type === 'INTERPRET_PROFILE_SECTION') {
    interpretProfileSection(message.section, message.content).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_API_USAGE') {
    getApiUsage().then(sendResponse);
    return true;
  }
  if (message.type === 'RESET_API_USAGE') {
    chrome.storage.local.remove('apiUsage', () => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'SET_CREDIT_ALLOCATION') {
    chrome.storage.local.get(['apiCreditAllocations'], d => {
      const alloc = d.apiCreditAllocations || {};
      alloc[message.provider] = message.credits;
      chrome.storage.local.set({ apiCreditAllocations: alloc }, () => sendResponse({ success: true }));
    });
    return true;
  }
  if (message.type === 'GET_PIPELINE_CONFIG') {
    sendResponse(state.pipelineConfig);
    return true;
  }
  if (message.type === 'SET_PIPELINE_CONFIG') {
    state.pipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...message.config };
    chrome.storage.local.set({ pipelineConfig: state.pipelineConfig }, () => sendResponse({ success: true }));
    return true;
  }
});

// Run backfill on service worker startup
migrateJobsToCompanies();
backfillMissingWebsites();

// ── Re-scrape LinkedIn job page into existing entry ───────────────────────────
async function rescrapeLinkedInJob({ entryId }) {
  const { savedCompanies } = await new Promise(r => chrome.storage.local.get(['savedCompanies'], r));
  const entry = (savedCompanies || []).find(e => e.id === entryId);
  if (!entry) throw new Error('Entry not found');
  const jobUrl = entry.jobUrl;
  if (!jobUrl || !/linkedin\.com\/jobs\/view\//i.test(jobUrl)) {
    throw new Error('No LinkedIn job URL on this entry');
  }

  // Open a background tab (not stealing focus)
  const tab = await new Promise(r => chrome.tabs.create({ url: jobUrl, active: false }, r));
  console.log('[Rescrape] Opened background tab', tab.id, 'for', entry.company);

  try {
    // Wait for tab to finish loading
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tab load timeout after 30s')), 30000);
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Give LinkedIn's SPA extra time to render the job details panel
    await new Promise(r => setTimeout(r, 3500));

    // Ask content script to extract all LinkedIn job data
    const linkedinJobData = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Content script extraction timeout')), 20000);
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_LINKEDIN_JOB' }, result => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (result?.error) return reject(new Error(result.error));
        resolve(result);
      });
    });

    console.log('[Rescrape] Got data for', entry.company, '— employees:', linkedinJobData.employees, '| skills:', linkedinJobData.jobSkills?.length);

    // Feed into existing duplicate-update path — updates all new fields + re-queues scoring
    await handleSaveOpportunity({
      company:        entry.company,
      jobTitle:       entry.jobTitle,
      jobUrl,
      jobDescription: linkedinJobData.jobDescription || entry.jobDescription,
      jobMeta:        linkedinJobData.jobMeta || null,
      linkedinFirmo:  null,
      linkedinJobData,
      source:         'linkedin_page',
      triggerResearch: false,
    });

    return { ok: true };
  } finally {
    // Always close the background tab
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}