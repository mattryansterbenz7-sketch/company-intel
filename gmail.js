// gmail.js — Gmail OAuth, email fetching, rejection detection, contact extraction.

import { parseEmailContact } from './utils.js';

// ── Gmail OAuth ───────────────────────────────────────────────────────────

export async function gmailAuth() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      void chrome.runtime.lastError;
      if (!token) {
        resolve({ error: 'Auth failed or cancelled' });
        return;
      }
      chrome.storage.local.set({ gmailConnected: true });
      resolve({ success: true });
    });
  });
}

export async function gmailRevoke() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, async token => {
      void chrome.runtime.lastError;
      // Revoke server-side first so next auth forces a fresh consent screen
      if (token) {
        try { await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`); } catch(e) {}
      }
      // Clear ALL cached tokens (not just this one) so new scopes are requested on reconnect
      chrome.identity.clearAllCachedAuthTokens(() => {
        chrome.storage.local.remove('gmailConnected');
        resolve({ success: true });
      });
    });
  });
}

// ── Email body helpers ────────────────────────────────────────────────────

function decodeBase64Utf8(data) {
  try {
    const bytes = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return decodeURIComponent(bytes.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  } catch(e) {
    try { return atob(data.replace(/-/g, '+').replace(/_/g, '/')); } catch(e2) { return ''; }
  }
}

function extractEmailBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    const t = decodeBase64Utf8(payload.body.data);
    if (t) return t;
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const t = decodeBase64Utf8(part.body.data);
      if (t) return t;
    }
  }
  for (const part of payload.parts || []) {
    const nested = extractEmailBody(part);
    if (nested) return nested;
  }
  return '';
}

// ── Rejection email detection (regex-only, zero cost) ─────────────────────

export function detectRejectionEmailBg(emails, entry) {
  if (!emails?.length) return null;
  const REJECTION_PHRASES = [
    /we(?:'ve| have) decided to (?:move|go) forward with (?:other|another|different) candidate/i,
    /(?:unfortunately|regretfully),?\s*we (?:will not|won't|are unable to|cannot) (?:be )?(?:move|moving|proceed|proceeding) forward/i,
    /(?:unfortunately|regretfully),?\s*(?:we|the team|I) (?:have|has) decided (?:not )?to (?:not )?(?:move|proceed|continue)/i,
    /(?:the )?position has been filled/i,
    /after careful (?:consideration|review|deliberation).*?(?:not|won't|unable).*?(?:move|moving|proceed|offer)/i,
    /we(?:'re| are) not (?:able to )?(?:move|moving|proceed) forward with your (?:application|candidacy)/i,
    /(?:we|I) (?:regret|am sorry|are sorry) to inform you/i,
    /your (?:application|candidacy) (?:was|has been) (?:not selected|unsuccessful|rejected)/i,
    /we(?:'ve| have) (?:chosen|selected|decided on) (?:a |an )?(?:other|another|different) candidate/i,
    /(?:not|won't) be (?:extending|making) (?:you )?an offer/i,
    /decided to (?:pursue|explore) other (?:candidates|directions|options)/i,
    /will not be (?:advancing|continuing) (?:your|with your)/i,
  ];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if ((entry.tags || []).includes('Application Rejected')) return null;
  for (const email of emails) {
    const emailDate = email.date ? new Date(email.date).getTime() : 0;
    if (emailDate && emailDate < cutoff) continue;
    const text = [email.subject || '', email.snippet || '', (email.body || '').slice(0, 800)].join(' ');
    for (const pattern of REJECTION_PHRASES) {
      if (pattern.test(text)) {
        return { subject: email.subject, from: email.from, date: email.date, snippet: email.snippet };
      }
    }
  }
  return null;
}

// ── Fetch Gmail emails ────────────────────────────────────────────────────

export async function fetchGmailEmails(domain, companyName, linkedinSlug, knownContactEmails) {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, async token => {
      void chrome.runtime.lastError;
      if (!token) { resolve({ emails: [], error: 'not_connected' }); return; }

      // GUARD: Never search without a domain — unfiltered company name searches
      // return dozens of irrelevant emails and pollute the association
      if (!domain) {
        console.log('[Gmail] Skipping fetch — no domain available for', companyName);
        resolve({ emails: [] });
        return;
      }

      try {
        const parts = [];
        const baseDomain = domain.split('.')[0].toLowerCase();

        // Primary: domain-based search (most precise)
        parts.push(`from:@${domain} OR to:@${domain}`);

        // Sibling domains: any known contact email sharing the same base name
        // e.g. productgenius.io when primary domain is productgenius.ai
        const siblingDomains = new Set();
        (knownContactEmails || []).forEach(email => {
          const d = (email.split('@')[1] || '').toLowerCase();
          if (d && d !== domain && baseDomain && d.split('.')[0] === baseDomain) siblingDomains.add(d);
        });
        siblingDomains.forEach(d => parts.push(`from:@${d} OR to:@${d}`));

        // Bootstrap: when few contacts known, also search by company name to discover
        // threads that may reveal additional team members / alternate domains
        // ONLY add company name search when we ALSO have domain-based search (not standalone)
        const isBootstrap = (knownContactEmails || []).filter(e => {
          const d = (e.split('@')[1] || '').toLowerCase();
          return d === domain || d.split('.')[0] === baseDomain;
        }).length < 3;
        if (isBootstrap && companyName && companyName.length > 3) {
          // Search for company name — keep LinkedIn excluded (too noisy),
          // but allow noreply/notifications through so ATS platforms (Greenhouse,
          // Lever, Reachdesk, etc.) can be matched via subject/body in post-filter.
          parts.push(`"${companyName}" -from:linkedin.com`);
        }
        const query = parts.join(' OR ');
        const fetchMessages = async (q) => {
          const res = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=100`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.status === 401) throw Object.assign(new Error('token_expired'), { code: 401 });
          const data = await res.json();
          return data.messages || [];
        };
        const fetchEmail = async (msgId) => {
          const r = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!r.ok) return null;
          const d = await r.json();
          const h = d.payload?.headers || [];
          const get = n => h.find(x => x.name === n)?.value || '';
          const body = extractEmailBody(d.payload);
          return { id: msgId, from: get('From'), to: get('To'), cc: get('Cc'), subject: get('Subject'), date: get('Date'), snippet: d.snippet || '', body, threadId: d.threadId };
        };

        let msgList = await fetchMessages(query);
        let allEmails = (await Promise.all(msgList.slice(0, 100).map(m => fetchEmail(m.id)))).filter(Boolean);

        // Second pass: scan results for sibling domains not yet in the query
        // (e.g. ben@productgenius.io found via bootstrap reveals .io for ryan@productgenius.io)
        if (baseDomain) {
          const seenIds = new Set(allEmails.map(e => e.id));
          const newSiblings = new Set();
          allEmails.forEach(e => {
            [e.from, e.to, e.cc].forEach(field => {
              if (!field) return;
              field.split(/,\s*/).forEach(addr => {
                const m = addr.match(/<([^>]+)>/) || [null, addr.trim()];
                const emailAddr = (m[1] || '').toLowerCase();
                const d = (emailAddr.split('@')[1] || '');
                if (d && d !== domain && d.split('.')[0] === baseDomain && !siblingDomains.has(d)) {
                  newSiblings.add(d);
                }
              });
            });
          });
          if (newSiblings.size > 0) {
            const secondQuery = [...newSiblings].map(d => `from:@${d} OR to:@${d}`).join(' OR ');
            const secondMsgs = await fetchMessages(secondQuery);
            const newMsgs = secondMsgs.filter(m => !seenIds.has(m.id)).slice(0, 100);
            const secondEmails = (await Promise.all(newMsgs.map(m => fetchEmail(m.id)))).filter(Boolean);
            allEmails = allEmails.concat(secondEmails);
          }
        }

        // Filter out bulk/notification senders that aren't real company correspondence —
        // UNLESS the subject or body explicitly mentions this specific company.
        // This lets legitimate ATS/recruiter-platform emails (Greenhouse, Lever, Reachdesk,
        // etc.) attach to the right company without polluting every other pipeline entry.
        const BULK_SENDERS = /noreply|no-reply|notifications?@|mailer-daemon|postmaster|digest@|newsletter|updates?@|marketing@|news@|hello@linkedin|member@linkedin|invitations@linkedin|jobs-listings@linkedin|messages-noreply@linkedin/i;
        const companyLower = (companyName || '').toLowerCase().trim();
        // Normalized variants for matching (strip "Inc", punctuation, etc.)
        const companyVariants = new Set();
        if (companyLower) {
          companyVariants.add(companyLower);
          const cleaned = companyLower.replace(/\b(inc|llc|ltd|co|corp|corporation|company|the)\b/g, '').replace(/[.,']/g, '').trim();
          if (cleaned && cleaned.length > 2) companyVariants.add(cleaned);
        }
        if (baseDomain && baseDomain.length > 2) companyVariants.add(baseDomain);

        const companyInSubject = (e) => {
          if (!companyVariants.size) return false;
          const hay = (e.subject || '').toLowerCase();
          for (const v of companyVariants) {
            const re = new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
            if (re.test(hay)) return true;
          }
          return false;
        };

        allEmails = allEmails.filter(e => {
          const fromAddr = (e.from || '').toLowerCase();
          const isBulk = BULK_SENDERS.test(fromAddr);
          if (isBulk) {
            // Keep bulk/ATS emails only when the company name appears in the subject line.
            // Body matches are too noisy (e.g. "flex league" in a tennis club email
            // triggering a false association with a company named "Flex").
            return companyInSubject(e);
          }
          // LinkedIn notification senders: keep only when subject mentions company
          if (fromAddr.includes('linkedin.com') && companyName) {
            const subjectLower = (e.subject || '').toLowerCase();
            if (!subjectLower.includes(companyLower)) return false;
          }
          return true;
        });

        // Get user's own email for contact deduplication
        let userEmail = null;
        try {
          const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
          const profile = await profileRes.json();
          userEmail = profile.emailAddress?.toLowerCase() || null;
          if (userEmail) chrome.storage.local.set({ gmailUserEmail: userEmail });
        } catch(e) {}

        // Extract contacts from email headers — but NEVER promote bulk/ATS senders
        // (noreply@greenhouse, notifications@lever, etc.) to "known contacts". They
        // aren't real humans and would leak across opportunities on future searches.
        const isBulkAddr = (addr) => {
          const a = (addr || '').toLowerCase();
          if (!a) return true;
          if (BULK_SENDERS.test(a)) return true;
          // Common ATS/notification domains — the email is valid evidence of the
          // opportunity but must not become a reusable contact for sibling lookups
          if (/@(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|jobvite\.com|myworkday\.com|reachdesk\.com|mailchimp|sendgrid|hubspot|salesforce\.com|marketo)/.test(a)) return true;
          return false;
        };
        // Classify each sender by which part of the Gmail query likely matched it:
        // primary domain, sibling domain, or company-name bootstrap search.
        const classifyEmailContact = (emailAddr) => {
          const senderDomain = (emailAddr.split('@')[1] || '').toLowerCase();
          if (senderDomain === domain) {
            return { type: 'email-domain', detail: `Gmail sender/recipient on @${domain}` };
          }
          if (senderDomain && baseDomain && senderDomain.split('.')[0] === baseDomain) {
            return { type: 'email-sibling-domain', detail: `Gmail sender on sibling domain @${senderDomain} (base name matches @${domain})` };
          }
          return { type: 'email-sender', detail: `Gmail thread matched by company name "${companyName}"` };
        };
        const extractedContacts = [];
        const seenEmails = new Set();
        for (const thread of allEmails) {
          const fromParts = parseEmailContact(thread.from);
          if (fromParts && !isBulkAddr(fromParts.email) && !seenEmails.has(fromParts.email.toLowerCase())) {
            seenEmails.add(fromParts.email.toLowerCase());
            extractedContacts.push({ ...fromParts, source: 'email', matchedVia: classifyEmailContact(fromParts.email.toLowerCase()) });
          }
          if (thread.messages) {
            for (const msg of thread.messages) {
              const msgFrom = parseEmailContact(msg.from);
              if (msgFrom && !isBulkAddr(msgFrom.email) && !seenEmails.has(msgFrom.email.toLowerCase())) {
                seenEmails.add(msgFrom.email.toLowerCase());
                extractedContacts.push({ ...msgFrom, source: 'email', matchedVia: classifyEmailContact(msgFrom.email.toLowerCase()) });
              }
            }
          }
        }

        resolve({ emails: allEmails, userEmail, extractedContacts });
      } catch (err) {
        if (err.code === 401) {
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          chrome.storage.local.remove('gmailConnected');
          resolve({ emails: [], error: 'token_expired' });
        } else {
          resolve({ emails: [], error: err.message });
        }
      }
    });
  });
}
