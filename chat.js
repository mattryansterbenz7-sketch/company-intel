// chat.js — shared AI chat panel, initialized by company.js and opportunity.js

// Context override map — keyed by chatKey, set before initChatPanels() is called
const _chatContextOverrides = {};
function setChatContext(key, context) {
  _chatContextOverrides[key] = context;
}

// ── Chat history persistence ──────────────────────────────────────────────────
// Storage key: chatHistory_${entryId}
// Shape: { sessions: [{ id, startedAt, messages: [{role, content, _usage, _model}] }] }
// Max 10 sessions per entry; read-only in display — new API calls always start fresh.

const MAX_SESSIONS = 10;

function loadChatHistory(entryId, callback) {
  const key = `chatHistory_${entryId}`;
  chrome.storage.local.get([key], data => {
    const stored = data[key];
    callback(stored && Array.isArray(stored.sessions) ? stored.sessions : []);
  });
}

function saveChatSession(entryId, session) {
  if (!entryId || !session || !session.messages || session.messages.length === 0) return;
  const key = `chatHistory_${entryId}`;
  chrome.storage.local.get([key], data => {
    const stored = data[key] || { sessions: [] };
    const sessions = stored.sessions || [];
    // Replace existing session with same id, or append
    const idx = sessions.findIndex(s => s.id === session.id);
    const compact = {
      id: session.id,
      startedAt: session.startedAt,
      messages: session.messages.map(m => {
        const msg = { role: m.role, content: typeof m.content === 'string' ? m.content : (m.content[0]?.text || '') };
        if (m._usage) msg._usage = m._usage;
        if (m._model) msg._model = m._model;
        return msg;
      })
    };
    if (idx >= 0) {
      sessions[idx] = compact;
    } else {
      sessions.push(compact);
    }
    // Keep only last MAX_SESSIONS
    while (sessions.length > MAX_SESSIONS) sessions.shift();
    chrome.storage.local.set({ [key]: { sessions } });
  });
}

function deleteChatHistory(entryId, callback) {
  const key = `chatHistory_${entryId}`;
  chrome.storage.local.remove([key], () => { if (callback) callback(); });
}

function formatSessionDate(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today, ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday, ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function initChatPanels(entry) {
  document.querySelectorAll('[data-chat-panel]').forEach(container => {
    if (container.dataset.chatInit) return;
    container.dataset.chatInit = '1';
    buildChatPanel(container, entry);
  });
}

function buildChatPanel(container, entry) {
  const chatKey = container.dataset.chatKey || entry.id;
  // History is session-only — starts fresh each time this panel is built.
  // This keeps each company's chat isolated and avoids stale context from prior sessions.
  let history = [];

  // Current session object — persisted to storage after each assistant reply
  const currentSession = {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    startedAt: new Date().toISOString(),
    messages: history  // live reference — mutated by push
  };
  let _saveTimer = null;
  function scheduleSave() {
    if (!entry.id) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      currentSession.messages = history;
      saveChatSession(entry.id, currentSession);
    }, 2000);
  }

  // Model switcher — default GPT-4.1 mini, click to cycle
  const CHAT_MODELS = [
    { id: 'gpt-4.1-nano',              label: 'GPT-4.1 Nano',     icon: '◆' },
    { id: 'gemini-2.0-flash-lite',     label: 'Flash-Lite',       icon: '✦' },
    { id: 'gpt-4.1-mini',              label: 'GPT-4.1 Mini',     icon: '◆' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',        icon: '⚡' },
    { id: 'gemini-2.0-flash',          label: 'Gemini Flash',     icon: '✦' },
    { id: 'gpt-4.1',                   label: 'GPT-4.1',          icon: '◆' },
    { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6',       icon: '✦' },
  ];
  let chatModelIdx = 0;

  const panelId = chatKey.replace(/[^a-z0-9]/gi, '_');
  const placeholder = container.dataset.chatPlaceholder || 'Ask Coop anything...';
  const minimal = container.dataset.chatMinimal === '1';
  container.innerHTML = `
    <div class="chat-prev-sessions" id="chat-prev-${panelId}" style="display:none"></div>
    <div class="chat-messages" id="chat-msgs-${panelId}"></div>
    <div class="chat-email-status" id="chat-email-status-${panelId}" style="display:none"></div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="chat-input-${panelId}" placeholder="${placeholder}" rows="1"></textarea>
      <button class="chat-model-btn" id="chat-model-${panelId}" title="Click to switch model" style="background:none;border:1px solid #DDD9D4;color:#8B8680;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;">...</button>
      <button class="chat-send-btn" id="chat-send-${panelId}">Send</button>
    </div>
    ${minimal ? `<div class="chat-actions"><button class="chat-action-btn chat-clear-btn" data-action="clear">Clear chat</button></div>` : `
    <div class="chat-actions">
      <button class="chat-action-btn" data-action="emails">Load emails</button>
      <button class="chat-action-btn" data-action="granola">Load meeting notes</button>
      <button class="chat-action-btn chat-clear-btn" data-action="clear">Clear chat</button>
    </div>`}
  `;

  const msgsEl        = container.querySelector(`#chat-msgs-${panelId}`);
  const prevSessionsEl = container.querySelector(`#chat-prev-${panelId}`);
  const inputEl       = container.querySelector(`#chat-input-${panelId}`);
  const sendBtn       = container.querySelector(`#chat-send-${panelId}`);
  const statusEl      = container.querySelector(`#chat-email-status-${panelId}`);
  const modelBtn      = container.querySelector(`#chat-model-${panelId}`);
  const actionsEl     = container.querySelector('.chat-actions');

  // Render "Previous sessions" collapsible above current chat
  function renderPrevSessions(sessions) {
    if (!prevSessionsEl) return;
    // Filter out any session that is the current one (shouldn't be in storage yet, but guard)
    const past = sessions.filter(s => s.id !== currentSession.id && s.messages && s.messages.length > 0);
    if (past.length === 0) {
      prevSessionsEl.style.display = 'none';
      return;
    }
    prevSessionsEl.style.display = 'block';

    const sessionsHTML = past.slice().reverse().map((sess, idx) => {
      const dateLabel = formatSessionDate(sess.startedAt);
      const msgCount = sess.messages.length;
      const userCount = sess.messages.filter(m => m.role === 'user').length;
      const sessionId = `prev-sess-${panelId}-${idx}`;
      const msgsHTML = sess.messages.map(m => {
        const text = typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '');
        const bubble = m.role === 'assistant'
          ? (typeof renderMarkdown === 'function' ? renderMarkdown(text) : escapeHtml(text))
          : escapeHtml(text);
        const usageBadge = (m.role === 'assistant' && m._usage) ? (() => {
          const inp = m._usage.input || 0, out = m._usage.output || 0;
          const total = inp + (m._usage.cacheCreation || 0) + (m._usage.cacheRead || 0) + out;
          const modelShort = (m._model || '').replace('claude-', '').replace('-20251001', '').replace('gpt-', 'GPT-');
          return `<div class="chat-usage">${modelShort ? modelShort + ' · ' : ''}${total.toLocaleString()} tok</div>`;
        })() : '';
        return `<div class="chat-msg chat-msg-${m.role} chat-msg-readonly">
          <div class="chat-msg-bubble">${bubble}</div>${usageBadge}
        </div>`;
      }).join('');
      return `<div class="prev-session-item" id="${sessionId}">
        <button class="prev-session-hdr" data-session="${sessionId}" type="button">
          <span class="prev-session-date">${escapeHtml(dateLabel)}</span>
          <span class="prev-session-count">${userCount} message${userCount !== 1 ? 's' : ''}</span>
          <span class="prev-session-chevron">▶</span>
        </button>
        <div class="prev-session-msgs" id="${sessionId}-msgs" style="display:none">${msgsHTML}</div>
      </div>`;
    }).join('');

    prevSessionsEl.innerHTML = `
      <div class="prev-sessions-header">
        <button class="prev-sessions-toggle" id="prev-toggle-${panelId}" type="button">
          <span class="prev-sessions-label">Previous sessions (${past.length})</span>
          <span class="prev-sessions-chevron" id="prev-chev-${panelId}">▶</span>
        </button>
        <button class="prev-sessions-clear" id="prev-clear-${panelId}" type="button" title="Delete all saved history for this entry">Clear history</button>
      </div>
      <div class="prev-sessions-body" id="prev-body-${panelId}" style="display:none">
        ${sessionsHTML}
      </div>
    `;

    // Toggle entire prev-sessions section
    const toggleBtn = prevSessionsEl.querySelector(`#prev-toggle-${panelId}`);
    const bodyEl    = prevSessionsEl.querySelector(`#prev-body-${panelId}`);
    const chevEl    = prevSessionsEl.querySelector(`#prev-chev-${panelId}`);
    if (toggleBtn && bodyEl) {
      toggleBtn.addEventListener('click', () => {
        const open = bodyEl.style.display !== 'none';
        bodyEl.style.display = open ? 'none' : 'block';
        if (chevEl) chevEl.textContent = open ? '▶' : '▼';
      });
    }

    // Toggle individual session items
    prevSessionsEl.querySelectorAll('.prev-session-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const sid = hdr.dataset.session;
        const msgsContainer = document.getElementById(`${sid}-msgs`);
        const chev = hdr.querySelector('.prev-session-chevron');
        if (!msgsContainer) return;
        const isOpen = msgsContainer.style.display !== 'none';
        msgsContainer.style.display = isOpen ? 'none' : 'block';
        if (chev) chev.textContent = isOpen ? '▶' : '▼';
      });
    });

    // Clear history button
    const clearBtn = prevSessionsEl.querySelector(`#prev-clear-${panelId}`);
    if (clearBtn && entry.id) {
      clearBtn.addEventListener('click', () => {
        deleteChatHistory(entry.id, () => {
          prevSessionsEl.style.display = 'none';
        });
      });
    }
  }

  // Load and render previous sessions on init
  if (entry.id) {
    loadChatHistory(entry.id, sessions => {
      renderPrevSessions(sessions);
    });
  }
  function updateChatModelBtn() {
    if (modelBtn) modelBtn.textContent = CHAT_MODELS[chatModelIdx].icon + ' ' + CHAT_MODELS[chatModelIdx].label;
  }
  // Load default model from Pipeline settings, then update button
  chrome.storage.local.get(['pipelineConfig'], data => {
    const configModel = data.pipelineConfig?.aiModels?.chat;
    if (configModel) {
      const idx = CHAT_MODELS.findIndex(m => m.id === configModel);
      if (idx >= 0) chatModelIdx = idx;
    }
    updateChatModelBtn();
  });
  if (modelBtn) {
    modelBtn.addEventListener('click', () => {
      chatModelIdx = (chatModelIdx + 1) % CHAT_MODELS.length;
      updateChatModelBtn();
    });
  }

  // Auto-include cached emails so context is always rich without manual "Load emails"
  let emailContext = (entry.cachedEmails?.length)
    ? entry.cachedEmails.slice(0, 15).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet }))
    : null;
  // Pre-load context: check override map first, then fall back to cached meeting data on the entry
  let granolaContext = _chatContextOverrides[chatKey]
    || entry.cachedMeetingTranscript
    || entry.cachedMeetingNotes
    || null;
  // Structured meetings (populated by "Load meeting notes" button or auto-fetch)
  let meetingsContext = (entry.cachedMeetings?.length) ? entry.cachedMeetings : null;

  function renderHistory(showThinking) {
    const emptyHTML = typeof COOP !== 'undefined'
      ? `<div class="chat-empty">${COOP.emptyStateHTML('company')}</div>`
      : `<div class="chat-empty">Ask anything about ${entry.company}${entry.jobTitle ? ' — ' + entry.jobTitle : ''}.</div>`;
    const thinkingHTML = showThinking
      ? (typeof COOP !== 'undefined' ? `<div class="chat-msg chat-msg-assistant">${COOP.thinkingHTML()}</div>` : '<div class="chat-msg chat-msg-assistant"><div class="chat-msg-bubble chat-thinking"><span class="chat-thinking-dots"><span>.</span><span>.</span><span>.</span></span> Thinking</div></div>')
      : '';
    msgsEl.innerHTML = history.length === 0
      ? emptyHTML
      : history.map((m, idx) => {
          const text = m.content[0]?.text || m.content;
          const bubble = m.role === 'assistant'
            ? (typeof renderMarkdown === 'function' ? renderMarkdown(text) : escapeHtml(text))
            : escapeHtml(text);
          const isLastAssistant = m.role === 'assistant' && idx === history.length - 1;
          const followup = isLastAssistant
            ? `<div class="chat-followups"><button class="chat-followup-btn" data-followup="Say more">Say more</button><button class="chat-followup-btn" data-followup="What are the key takeaways?">Key takeaways</button></div>`
            : '';
          const saveBtn = m.role === 'assistant' ? `<button class="chat-save-answer" data-idx="${idx}" title="Save as reusable answer pattern" style="background:none;border:none;font-size:13px;cursor:pointer;opacity:0.4;padding:2px;">💾</button>` : '';
          const copyBtn = m.role === 'assistant' ? `<button class="chat-copy-answer" data-idx="${idx}" title="Copy to clipboard" style="background:none;border:none;font-size:13px;cursor:pointer;opacity:0.4;padding:2px;">📋</button>` : '';
          const prefix = m.role === 'assistant' && typeof COOP !== 'undefined' ? COOP.messagePrefixHTML() : '';
          const usageBadge = (m.role === 'assistant' && m._usage) ? (() => {
            const inp = m._usage.input || 0, out = m._usage.output || 0;
            const cacheW = m._usage.cacheCreation || 0, cacheR = m._usage.cacheRead || 0;
            const totalIn = inp + cacheW + cacheR, total = totalIn + out;
            const modelShort = (m._model || '').replace('claude-', '').replace('-20251001', '').replace('gpt-', 'GPT-');
            const isGpt = (m._model || '').startsWith('gpt');
            const isMini = (m._model || '').includes('mini') || (m._model || '').includes('nano');
            const isHaiku = (m._model || '').includes('haiku');
            const inRate = isGpt ? (isMini ? 0.0004 : 0.01) : (isHaiku ? 0.001 : 0.003);
            const outRate = isGpt ? (isMini ? 0.0016 : 0.03) : (isHaiku ? 0.005 : 0.015);
            const cost = (inp / 1000) * inRate + (cacheW / 1000) * inRate * 1.25 + (cacheR / 1000) * inRate * 0.10 + (out / 1000) * outRate;
            const costStr = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`;
            const cacheHint = (cacheW || cacheR) ? ` · <span style="color:#8a8e94;">cache +${cacheW.toLocaleString()}w/${cacheR.toLocaleString()}r</span>` : '';
            return `<div class="chat-usage">${modelShort} · ${total.toLocaleString()} tok${cacheHint} · ${costStr}</div>`;
          })() : '';
          const toolBadge = (m.role === 'assistant' && m._toolCalls?.length) ? (() => {
            const labels = { get_company_context: 'company context', get_communications: 'emails + meetings', get_profile_section: 'profile', get_pipeline_overview: 'pipeline', search_memory: 'memory' };
            const unique = [...new Set(m._toolCalls.map(t => labels[t.name] || t.name))];
            return `<div class="chat-usage" style="color:#7C6EF0;">↳ Coop pulled: ${unique.join(', ')}</div>`;
          })() : '';
          return `<div class="chat-msg chat-msg-${m.role}">${prefix}<div class="chat-msg-bubble">${bubble}</div>${copyBtn}${saveBtn}${toolBadge}${usageBadge}${followup}</div>`;
        }).join('') + thinkingHTML;
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Bind follow-up chip clicks
    msgsEl.querySelectorAll('.chat-followup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.dataset.followup;
        inputEl.focus();
        send();
      });
    });

    // Copy answer buttons
    msgsEl.querySelectorAll('.chat-copy-answer').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        let text = (typeof history[idx]?.content === 'string' ? history[idx].content : history[idx]?.content?.[0]?.text) || '';

        // Extract only the answer portion, stripping preamble and closing commentary
        // Remove common opening phrases (case-insensitive)
        text = text.replace(/^(?:here['\s]*s(?:\s+my)?|i['\s]*d\s+(?:suggest|say|emphasize|highlight|point\s+out)|i\s+think|i\s+would|the\s+answer|my\s+answer|this\s+would\s+be)[:\s]*/i, '').trim();

        // Remove common closing questions/offers (after the answer)
        text = text.replace(/\n\n(?:does\s+that|what(?:\s+do\s+)?you|feel\s+free|let\s+me|you\s+could|happy\s+to|does\s+this|would\s+that|any\s+other)[\w\s.,?;!-]*/i, '').trim();

        // Strip outer quotation marks if present
        const clean = text.replace(/^["']|["']$/g, '').trim();

        navigator.clipboard.writeText(clean).then(() => {
          btn.textContent = '✓';
          btn.style.color = '#00BDA5';
          setTimeout(() => { btn.textContent = '📋'; btn.style.color = ''; }, 1500);
        });
      });
    });

    // Save answer buttons
    msgsEl.querySelectorAll('.chat-save-answer').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const m = history[idx];
        const answer = (typeof m?.content === 'string' ? m.content : m?.content?.[0]?.text) || '';
        let question = '';
        for (let i = idx - 1; i >= 0; i--) {
          if (history[i]?.role === 'user') {
            const c = history[i].content;
            question = typeof c === 'string' ? c : c?.[0]?.text || '';
            break;
          }
        }
        chrome.storage.local.get(['storyTime'], ({ storyTime }) => {
          const st = storyTime || {};
          st.answerPatterns = st.answerPatterns || [];
          if (st.answerPatterns.length >= 50) st.answerPatterns.shift();
          st.answerPatterns.push({
            question: question.slice(0, 200),
            text: answer.slice(0, 500),
            company: entry.company || '',
            date: new Date().toISOString().slice(0, 10),
            source: 'manual-save'
          });
          chrome.storage.local.set({ storyTime: st }, () => {
            btn.textContent = '✓';
            btn.style.opacity = '1';
            btn.style.color = '#15803d';
            btn.disabled = true;
            setTimeout(() => { btn.textContent = '💾'; btn.style.opacity = '0.4'; btn.style.color = ''; btn.disabled = false; }, 2000);
          });
        });
      });
    });
  }

  function saveHistory() {
    scheduleSave();
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = '';
    history.push({ role: 'user', content: [{ type: 'text', text }] });
    renderHistory(true);

    sendBtn.disabled = true;
    sendBtn.textContent = '…';

    // Always read the freshest override at send time — handles Granola arriving after panel was built
    const effectiveGranola = _chatContextOverrides[chatKey] || granolaContext;
    const effectiveMeetings = meetingsContext || entry.cachedMeetings || [];
    const context = buildContext(entry, emailContext, effectiveGranola, effectiveMeetings);

    console.log('[Chat Send] Context summary:', {
      company: context.company,
      meetingsCount: context.meetings?.length || 0,
      granolaNote: context.granolaNote ? context.granolaNote.slice(0, 80) + '...' : null,
      emailsCount: context.emails?.length || 0,
    });

    const apiMessages = history.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content[0]?.text || ''
    }));

    let result;
    try {
      result = await Promise.race([
        new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', messages: apiMessages, context, chatModel: CHAT_MODELS[chatModelIdx].id }, r => {
            if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
            else resolve(r);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000))
      ]);
    } catch (e) {
      result = { error: e.message === 'timeout' ? 'Request timed out. Try again.' : e.message };
    }

    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';

    if (result?.reply) {
      const msgEntry = { role: 'assistant', content: [{ type: 'text', text: result.reply }] };
      if (result.usage) msgEntry._usage = result.usage;
      if (result.model) msgEntry._model = result.model;
      if (result.toolCalls) msgEntry._toolCalls = result.toolCalls;
      history.push(msgEntry);
    } else {
      const errMsg = result?.error || 'Sorry, something went wrong. Try again.';
      history.push({ role: 'assistant', content: [{ type: 'text', text: errMsg }] });
    }

    saveHistory();
    renderHistory();
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Action buttons
  container.querySelector('.chat-actions').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'clear') {
      history = [];
      currentSession.messages = history;
      renderHistory();
      return;
    }

    if (action === 'emails') {
      const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
      // Extract LinkedIn slug as fallback keyword
      const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
      const companyName = entry.company || '';

      btn.disabled = true;
      btn.textContent = 'Loading…';
      const result = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS', domain, companyName, linkedinSlug }, resolve)
      );
      btn.disabled = false;
      btn.textContent = 'Load emails';

      if (result?.error === 'not_connected') {
        showStatus('Gmail not connected. Connect it in Integrations.', 'err');
        return;
      }
      if (!result?.emails?.length) {
        showStatus('No emails found with this domain.', 'info');
        return;
      }
      emailContext = result.emails;
      showStatus(`${result.emails.length} email${result.emails.length === 1 ? '' : 's'} loaded into context.`, 'ok');
      return;
    }

    if (action === 'granola') {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      const contactNames = (entry.knownContacts || []).map(c => c.name).filter(Boolean);
      const result = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company, contactNames }, resolve)
      );
      btn.disabled = false;
      btn.textContent = 'Load meeting notes';

      console.log('[Chat Granola] Raw result:', JSON.stringify({
        hasNotes: !!result?.notes,
        notesLen: result?.notes?.length || 0,
        hasTranscript: !!result?.transcript,
        transcriptLen: result?.transcript?.length || 0,
        meetingsCount: result?.meetings?.length || 0,
        error: result?.error || null
      }));

      if (result?.error === 'token_expired') {
        showStatus('Granola session expired — please reconnect in Integrations.', 'err');
        return;
      }
      if (result?.error === 'not_connected') {
        showStatus('Granola not connected. Connect it in Integrations.', 'err');
        return;
      }
      if (!result?.notes && !result?.transcript && !result?.meetings?.length) {
        showStatus('No Granola notes found for this company.', 'info');
        return;
      }
      granolaContext = result.transcript || result.notes;
      // Also capture structured meetings so they're available in context
      if (result.meetings?.length) {
        meetingsContext = result.meetings;
        console.log('[Chat Granola] Stored', meetingsContext.length, 'structured meetings');
      }
      const count = result.meetings?.length || (result.transcript ? 'transcripts' : 'notes');
      showStatus(`Meeting ${typeof count === 'number' ? count + ' meeting(s)' : count} loaded into context.`, 'ok');
    }

    // Chat journeys for opportunities
    if (action === 'journey-coverletter') {
      const journeyPrompt = `Help me write a custom cover letter for this ${entry.jobTitle || 'role'} application. Make it compelling and personalized.`;
      inputEl.value = journeyPrompt;
      inputEl.focus();
      send();
      return;
    }
  });

  // Add journey buttons for opportunities (not meetings chat)
  if (entry.isOpportunity && actionsEl && !chatKey.includes('-meetings')) {
    const journeyHtml = `<button class="chat-action-btn" data-action="journey-coverletter" style="background-color:rgba(255, 122, 89, 0.08);color:#FF7A59;font-weight:600;">✎ Cover letter</button>`;
    actionsEl.insertAdjacentHTML('afterbegin', journeyHtml);
  }

  function showStatus(msg, type) {
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.className = `chat-email-status chat-status-${type}`;
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  }

  renderHistory();

  // Listen for INSIGHTS_CAPTURED broadcasts and annotate the last assistant message
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'INSIGHTS_CAPTURED' && msg.insights?.length) {
      const allMsgs = msgsEl.querySelectorAll('.chat-msg-assistant');
      const lastMsg = allMsgs[allMsgs.length - 1];
      if (lastMsg && !lastMsg.querySelector('.insight-annotation')) {
        lastMsg.insertAdjacentHTML('beforeend', `<div class="insight-annotation">
          <span class="insight-check">✓</span>
          <span class="insight-text">Learned: ${msg.insights.map(t => t.length > 60 ? t.slice(0, 57) + '...' : t).join('; ')}</span>
        </div>`);
      }
    }
  });

  // Auto-fetch emails in background if not cached
  if (!emailContext) {
    const domain = (entry.companyWebsite || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const linkedinSlug = (entry.companyLinkedin || '').replace(/\/$/, '').split('/').pop();
    if (domain || entry.company) {
      chrome.runtime.sendMessage(
        { type: 'GMAIL_FETCH_EMAILS', domain, companyName: entry.company, linkedinSlug },
        result => {
          void chrome.runtime.lastError;
          if (result?.emails?.length) {
            emailContext = result.emails;
            console.log('[Chat Auto] Loaded', emailContext.length, 'emails');
          }
        }
      );
    }
  }

  // Auto-fetch fresh meeting notes in background — skip if entry already has cached notes
  if (!granolaContext && !meetingsContext && !entry.cachedMeetingTranscript && !entry.cachedMeetingNotes) {
    const contactNames = (entry.knownContacts || []).map(c => c.name).filter(Boolean);
    chrome.runtime.sendMessage(
      { type: 'GRANOLA_SEARCH', companyName: entry.company, contactNames },
      result => {
        void chrome.runtime.lastError;
        if (result?.error === 'token_expired') {
          showStatus('Granola session expired — reconnect in Integrations.', 'err');
          return;
        }
        if (result?.error === 'not_connected') return; // silently skip if never connected
        const notes = result?.transcript || result?.notes;
        if (notes) {
          granolaContext = notes;
          showStatus('Meeting notes loaded into context.', 'ok');
        }
        if (result?.meetings?.length) {
          meetingsContext = result.meetings;
          console.log('[Chat Auto] Loaded', meetingsContext.length, 'structured meetings');
        }
      }
    );
  }
}

function buildContext(entry, emails, granolaNote, meetings) {
  const now = new Date();
  return {
    todayDate: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    todayTimestamp: now.getTime(),
    type: entry.type || 'company',
    company: entry.company,
    jobTitle: entry.jobTitle || null,
    status: entry.status || null,
    notes: entry.notes || null,
    notesFeed: entry.notesFeed || [],
    tags: entry.tags || [],
    intelligence: entry.intelligence || null,
    jobMatch: entry.jobMatch || null,
    matchFeedback: entry.matchFeedback || null,
    roleBrief: entry.roleBrief?.content || null,
    jobDescription: entry.jobDescription || null,
    reviews: entry.reviews || [],
    leaders: entry.leaders || [],
    employees: entry.employees || null,
    funding: entry.funding || null,
    knownContacts: entry.knownContacts || [],
    // Full emails with snippets
    emails: emails || (entry.cachedEmails || []).slice(0, 20).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet })),
    // Structured per-meeting data with full transcripts — prefer passed-in meetings over entry cache
    meetings: meetings || entry.cachedMeetings || [],
    // Joined transcript fallback (used if no structured meetings)
    granolaNote: granolaNote || null,
    // Uploaded context documents
    contextDocuments: entry.contextDocuments || [],
    // Manually logged meetings (separate from Granola cachedMeetings)
    manualMeetings: entry.manualMeetings || [],
  };
}

// ── Activity helpers (used by company.js + opportunity.js) ────────────────────

function stripHtmlTags(text) {
  if (!text) return '';
  if (!/<[a-z]/i.test(text)) return text; // not HTML, skip
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripQuotedContent(body) {
  if (!body) return '';
  body = stripHtmlTags(body);
  // Truncate at first inline "On [date]... wrote:" quote starter (handles mid-paragraph quoting)
  body = body.replace(/\s+On [A-Z][a-z]{2},?\s[\s\S]{5,120}?wrote:\s*>[\s\S]*/m, '');
  body = body.replace(/\s+On [A-Z][a-z]{2},?\s[\s\S]{5,120}?wrote:[\s\S]*/m, '');
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .{5,100} wrote:/.test(line)) break;
    if (/^On .{5,50}$/.test(line) && i + 1 < lines.length && /wrote:/.test(lines[i + 1])) break;
    if (/^-{3,}\s*(Original Message|Forwarded message)\s*-{3,}/i.test(line)) break;
    if (/^From:\s+\S/.test(line) && i > 0 && lines[i - 1].trim() === '') break;
    if (/^>/.test(line.trim())) continue;
    out.push(line);
  }
  while (out.length && /^[\s\-_=*]+$/.test(out[out.length - 1])) out.pop();
  return out.join('\n').trim();
}

function renderEmailThreads(emails, onDelete) {
  // Group by threadId, preserving newest-first order
  const threads = new Map();
  emails.forEach(e => {
    if (!threads.has(e.threadId)) threads.set(e.threadId, []);
    threads.get(e.threadId).push(e);
  });

  return [...threads.entries()].map(([tid, msgs]) => {
    const latest = msgs[0];
    const subject = latest.subject || '(no subject)';
    const d = new Date(latest.date);
    const dateStr = isNaN(d) ? (latest.date || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const participants = [...new Set(msgs.map(m => m.from.replace(/<.*>/, '').trim()).filter(Boolean))].slice(0, 2).join(', ');

    const msgsHTML = msgs.map((m, idx) => {
      const md = new Date(m.date);
      const mDate = isNaN(md) ? (m.date || '') : md.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const fromName = (m.from || '').replace(/<.*>/, '').trim() || m.from || '';
      const bodyText = stripQuotedContent(m.body || m.snippet || '');
      const preview = bodyText.replace(/\n/g, ' ').slice(0, 80) + (bodyText.length > 80 ? '…' : '');
      const msgId = `tmsg-${tid}-${idx}`;
      // Latest message (idx=0) starts expanded
      return `<div class="thread-msg ${idx === 0 ? 'open' : ''}" id="${msgId}">
        <div class="thread-msg-hdr" data-msg="${msgId}">
          <span class="thread-msg-from">${escapeHtml(fromName)}</span>
          <span class="thread-msg-date">${mDate}</span>
        </div>
        <div class="thread-msg-preview">${escapeHtml(preview)}</div>
        <div class="thread-msg-body">${escapeHtml(bodyText).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>').replace(/$/, '</p>')}</div>
      </div>`;
    }).join('');

    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${tid}`;
    const deleteBtn = onDelete ? `<button class="email-delete-btn" data-thread="${tid}" title="Delete from this company's email inbox" style="flex-shrink:0;background:none;border:none;color:var(--ci-text-tertiary,#c4c0bc);cursor:pointer;font-size:13px;padding:4px 8px;opacity:0.6;transition:opacity 0.2s;">×</button>` : '';
    return `<div class="thread-item">
      <div class="thread-header" data-thread="${tid}">
        <div style="flex:1;min-width:0">
          <div class="thread-subject">${escapeHtml(subject)}</div>
          <div class="thread-meta">${escapeHtml(participants)} · ${dateStr}</div>
        </div>
        ${msgs.length > 1 ? `<span class="thread-count">${msgs.length}</span>` : ''}
        <span class="thread-chevron">▼</span>
        ${deleteBtn}
      </div>
      <div class="thread-messages" id="thread-msgs-${tid}">
        ${msgsHTML}
        <a class="thread-gmail-link" href="${gmailUrl}" target="_blank">Open in Gmail →</a>
      </div>
    </div>`;
  }).join('');
}

function bindThreadToggles(container) {
  const root = container || document;

  // Thread-level expand/collapse
  root.querySelectorAll('.thread-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const tid = hdr.dataset.thread;
      const msgsEl = document.getElementById('thread-msgs-' + tid);
      if (!msgsEl) return;
      const isOpen = msgsEl.classList.toggle('open');
      hdr.classList.toggle('open', isOpen);
    });
  });

  // Individual message expand/collapse (click header row)
  root.querySelectorAll('.thread-msg-hdr').forEach(hdr => {
    hdr.addEventListener('click', e => {
      e.stopPropagation();
      const msgEl = document.getElementById(hdr.dataset.msg);
      if (msgEl) msgEl.classList.toggle('open');
    });
  });

  // Delete button hover effects
  root.querySelectorAll('.email-delete-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '0.6';
    });
  });

  // Auto-expand first thread
  const first = root.querySelector('.thread-header');
  if (first) first.click();
}

// escapeHtml — provided by ui-utils.js
