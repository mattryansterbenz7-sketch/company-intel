// chat.js — shared AI chat panel, initialized by company.js and opportunity.js

// Context override map — keyed by chatKey, set before initChatPanels() is called
const _chatContextOverrides = {};
function setChatContext(key, context) {
  _chatContextOverrides[key] = context;
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

  const panelId = chatKey.replace(/[^a-z0-9]/gi, '_');
  const placeholder = container.dataset.chatPlaceholder || 'Ask anything about this company or role…';
  const minimal = container.dataset.chatMinimal === '1';
  container.innerHTML = `
    <div class="chat-messages" id="chat-msgs-${panelId}"></div>
    <div class="chat-email-status" id="chat-email-status-${panelId}" style="display:none"></div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="chat-input-${panelId}" placeholder="${placeholder}" rows="1"></textarea>
      <button class="chat-send-btn" id="chat-send-${panelId}">Send</button>
    </div>
    ${minimal ? `<div class="chat-actions"><button class="chat-action-btn chat-clear-btn" data-action="clear">Clear chat</button></div>` : `
    <div class="chat-actions">
      <button class="chat-action-btn" data-action="emails">Load emails</button>
      <button class="chat-action-btn" data-action="granola">Load meeting notes</button>
      <button class="chat-action-btn chat-clear-btn" data-action="clear">Clear chat</button>
    </div>`}
  `;

  const msgsEl    = container.querySelector(`#chat-msgs-${panelId}`);
  const inputEl   = container.querySelector(`#chat-input-${panelId}`);
  const sendBtn   = container.querySelector(`#chat-send-${panelId}`);
  const statusEl  = container.querySelector(`#chat-email-status-${panelId}`);

  // Auto-include cached emails so context is always rich without manual "Load emails"
  let emailContext = (entry.cachedEmails?.length)
    ? entry.cachedEmails.slice(0, 15).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet }))
    : null;
  // Pre-load context: check override map first, then fall back to cached meeting data on the entry
  let granolaContext = _chatContextOverrides[chatKey]
    || entry.cachedMeetingTranscript
    || entry.cachedMeetingNotes
    || null;

  function renderHistory() {
    msgsEl.innerHTML = history.length === 0
      ? `<div class="chat-empty">Ask anything about ${entry.company}${entry.jobTitle ? ' — ' + entry.jobTitle : ''}.</div>`
      : history.map((m, idx) => {
          const text = m.content[0]?.text || m.content;
          const bubble = m.role === 'assistant'
            ? (typeof renderMarkdown === 'function' ? renderMarkdown(text) : escapeHtml(text))
            : escapeHtml(text);
          const isLastAssistant = m.role === 'assistant' && idx === history.length - 1;
          const followup = isLastAssistant
            ? `<div class="chat-followups"><button class="chat-followup-btn" data-followup="Say more">Say more</button><button class="chat-followup-btn" data-followup="What are the key takeaways?">Key takeaways</button></div>`
            : '';
          return `<div class="chat-msg chat-msg-${m.role}"><div class="chat-msg-bubble">${bubble}</div>${followup}</div>`;
        }).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Bind follow-up chip clicks
    msgsEl.querySelectorAll('.chat-followup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.dataset.followup;
        inputEl.focus();
        send();
      });
    });
  }

  function saveHistory() {
    localStorage.setItem(storageKey, JSON.stringify(history.slice(-40)));
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = '';
    history.push({ role: 'user', content: [{ type: 'text', text }] });
    renderHistory();

    sendBtn.disabled = true;
    sendBtn.textContent = '…';

    // Always read the freshest override at send time — handles Granola arriving after panel was built
    const effectiveGranola = _chatContextOverrides[chatKey] || granolaContext;
    const context = buildContext(entry, emailContext, effectiveGranola);

    const apiMessages = history.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content[0]?.text || ''
    }));

    const result = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', messages: apiMessages, context }, resolve)
    );

    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';

    if (result?.reply) {
      history.push({ role: 'assistant', content: [{ type: 'text', text: result.reply }] });
    } else {
      history.push({ role: 'assistant', content: [{ type: 'text', text: 'Sorry, something went wrong. Try again.' }] });
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
      if (confirm('Clear chat history for this entry?')) {
        history = [];
        saveHistory();
        renderHistory();
      }
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
        showStatus('Gmail not connected. Connect it in Preferences.', 'err');
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
      const result = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: 'GRANOLA_SEARCH', companyName: entry.company }, resolve)
      );
      btn.disabled = false;
      btn.textContent = 'Load meeting notes';

      if (result?.error === 'not_connected') {
        showStatus('Granola not connected. Connect it in Preferences.', 'err');
        return;
      }
      if (!result?.notes && !result?.transcript) {
        showStatus('No Granola notes found for this company.', 'info');
        return;
      }
      granolaContext = result.transcript || result.notes;
      showStatus(`Meeting ${result.transcript ? 'transcripts' : 'notes'} loaded into context.`, 'ok');
    }
  });

  function showStatus(msg, type) {
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.className = `chat-email-status chat-status-${type}`;
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  }

  renderHistory();

  // Auto-fetch fresh meeting notes in background — skip if entry already has cached notes
  if (!granolaContext && !entry.cachedMeetingTranscript && !entry.cachedMeetingNotes) {
    const contactNames = (entry.knownContacts || []).map(c => c.name).filter(Boolean);
    chrome.runtime.sendMessage(
      { type: 'GRANOLA_SEARCH', companyName: entry.company, contactNames },
      result => {
        void chrome.runtime.lastError;
        const notes = result?.transcript || result?.notes;
        if (notes) {
          granolaContext = notes;
          showStatus('Meeting notes loaded into context.', 'ok');
        }
      }
    );
  }
}

function buildContext(entry, emails, granolaNote) {
  const now = new Date();
  return {
    todayDate: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    todayTimestamp: now.getTime(),
    type: entry.type || 'company',
    company: entry.company,
    jobTitle: entry.jobTitle || null,
    status: entry.status || null,
    notes: entry.notes || null,
    tags: entry.tags || [],
    intelligence: entry.intelligence || null,
    jobMatch: entry.jobMatch || null,
    jobDescription: entry.jobDescription || null,
    reviews: entry.reviews || [],
    leaders: entry.leaders || [],
    employees: entry.employees || null,
    funding: entry.funding || null,
    knownContacts: entry.knownContacts || [],
    // Full emails with snippets
    emails: emails || (entry.cachedEmails || []).slice(0, 20).map(e => ({ subject: e.subject, from: e.from, date: e.date, snippet: e.snippet })),
    // Structured per-meeting data with full transcripts
    meetings: (entry.cachedMeetings || []),
    // Joined transcript fallback (used if no structured meetings)
    granolaNote: granolaNote || null,
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

function renderEmailThreads(emails) {
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
        <div class="thread-msg-body">${escapeHtml(bodyText)}</div>
      </div>`;
    }).join('');

    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${tid}`;
    return `<div class="thread-item">
      <div class="thread-header" data-thread="${tid}">
        <div style="flex:1;min-width:0">
          <div class="thread-subject">${escapeHtml(subject)}</div>
          <div class="thread-meta">${escapeHtml(participants)} · ${dateStr}</div>
        </div>
        ${msgs.length > 1 ? `<span class="thread-count">${msgs.length}</span>` : ''}
        <span class="thread-chevron">▼</span>
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
      const chevron = hdr.querySelector('.thread-chevron');
      if (!msgsEl) return;
      const isOpen = msgsEl.classList.toggle('open');
      if (chevron) chevron.textContent = isOpen ? '▲' : '▼';
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

  // Auto-expand first thread
  const first = root.querySelector('.thread-header');
  if (first) first.click();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}
