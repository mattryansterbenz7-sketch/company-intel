// chat.js — shared AI chat panel, initialized by company.js and opportunity.js

function initChatPanels(entry) {
  document.querySelectorAll('[data-chat-panel]').forEach(container => {
    if (container.dataset.chatInit) return;
    container.dataset.chatInit = '1';
    buildChatPanel(container, entry);
  });
}

function buildChatPanel(container, entry) {
  const storageKey = `ci_chat_${entry.id}`;
  let history = [];
  try { history = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch(e) {}

  container.innerHTML = `
    <div class="chat-messages" id="chat-msgs-${entry.id}"></div>
    <div class="chat-email-status" id="chat-email-status-${entry.id}" style="display:none"></div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="chat-input-${entry.id}" placeholder="Ask anything about this company or role…" rows="1"></textarea>
      <button class="chat-send-btn" id="chat-send-${entry.id}">Send</button>
    </div>
    <div class="chat-actions">
      <button class="chat-action-btn" data-action="emails">Load emails</button>
      <button class="chat-action-btn" data-action="granola">Load meeting notes</button>
      <button class="chat-action-btn chat-clear-btn" data-action="clear">Clear chat</button>
    </div>
  `;

  const msgsEl    = container.querySelector(`#chat-msgs-${entry.id}`);
  const inputEl   = container.querySelector(`#chat-input-${entry.id}`);
  const sendBtn   = container.querySelector(`#chat-send-${entry.id}`);
  const statusEl  = container.querySelector(`#chat-email-status-${entry.id}`);

  let emailContext  = null;
  let granolaContext = null;

  function renderHistory() {
    msgsEl.innerHTML = history.length === 0
      ? `<div class="chat-empty">Ask anything about ${entry.company}${entry.jobTitle ? ' — ' + entry.jobTitle : ''}.</div>`
      : history.map(m => `
          <div class="chat-msg chat-msg-${m.role}">
            <div class="chat-msg-bubble">${escapeHtml(m.content[0]?.text || m.content)}</div>
          </div>`).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
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

    const context = buildContext(entry, emailContext, granolaContext);

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
      if (!result?.notes) {
        showStatus('No Granola notes found for this company.', 'info');
        return;
      }
      granolaContext = result.notes;
      showStatus('Meeting notes loaded into context.', 'ok');
    }
  });

  function showStatus(msg, type) {
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.className = `chat-email-status chat-status-${type}`;
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  }

  renderHistory();
}

function buildContext(entry, emails, granolaNote) {
  return {
    type: entry.type || 'company',
    company: entry.company,
    jobTitle: entry.jobTitle || null,
    status: entry.status || null,
    notes: entry.notes || null,
    tags: entry.tags || [],
    intelligence: entry.intelligence || null,
    jobMatch: entry.jobMatch || null,
    reviews: entry.reviews || [],
    leaders: entry.leaders || [],
    employees: entry.employees || null,
    funding: entry.funding || null,
    emails: emails || [],
    granolaNote: granolaNote || null,
  };
}

// ── Activity helpers (used by company.js + opportunity.js) ────────────────────

function stripQuotedContent(body) {
  if (!body) return '';
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Stop at common quote headers: "On [date], ... wrote:"
    if (/^On .{5,100} wrote:/.test(line)) break;
    if (/^On .{5,50}$/.test(line) && i + 1 < lines.length && /wrote:/.test(lines[i + 1])) break;
    // Stop at forwarded message headers
    if (/^-{3,}\s*(Original Message|Forwarded message)\s*-{3,}/i.test(line)) break;
    if (/^From:\s+\S/.test(line) && i > 0 && lines[i - 1].trim() === '') break;
    // Skip lines that are purely quoting (start with >)
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  // Trim trailing blank lines and separator lines
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
