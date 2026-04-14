// granola.js — Granola REST API, note indexing, and meeting search.

import { state } from './bg-state.js';
import { trackApiCall } from './api.js';

// ── Granola REST API ──────────────────────────────────────────────────────

export async function granolaFetch(path) {
  if (!state.GRANOLA_KEY) return null;
  const res = await fetch('https://public-api.granola.ai' + path, {
    headers: { 'Authorization': 'Bearer ' + state.GRANOLA_KEY }
  });
  trackApiCall('granola', res.clone(), undefined, 'search'); // non-blocking, no await needed
  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise(r => setTimeout(r, 2000));
    const retry = await fetch('https://public-api.granola.ai' + path, {
      headers: { 'Authorization': 'Bearer ' + state.GRANOLA_KEY }
    });
    trackApiCall('granola', retry.clone(), undefined, 'search');
    if (!retry.ok) return null;
    return retry.json();
  }
  if (!res.ok) {
    console.warn('[Granola] API error:', res.status, path);
    return null;
  }
  return res.json();
}

// ── Granola Note Index ────────────────────────────────────────────────────

export async function buildGranolaIndex() {
  if (!state.GRANOLA_KEY) return { success: false, error: 'not_connected' };
  if (state._granolaIndexInFlight) {
    console.log('[Granola] Index build already in flight, reusing existing run');
    return state._granolaIndexInFlight;
  }
  console.log('[Granola] Building note index...');

  const runPromise = (async () => {
  try {
    const index = { lastFullSync: Date.now(), lastIncrementalSync: Date.now(), notes: {} };
    let cursor = null;
    let totalNotes = 0;
    let pageNum = 0;
    const MAX_PAGES = 50; // safety: 50 pages * 30 = 1500 notes ceiling
    const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10); // 6 months

    // Paginate through all notes
    do {
      pageNum++;
      if (pageNum > MAX_PAGES) {
        console.warn('[Granola] Hit MAX_PAGES safety limit at page', pageNum, '— aborting pagination. Last cursor:', cursor);
        break;
      }
      const prevCursor = cursor;
      const url = '/v1/notes?page_size=30&created_after=' + since + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      console.log('[Granola] Fetching page', pageNum, 'cursor:', cursor);
      const page = await granolaFetch(url);
      if (!page?.notes?.length) break;

      // Fetch detail for each note (metadata only, no transcript)
      for (const note of page.notes) {
        await new Promise(r => setTimeout(r, 200)); // rate limit: 5/sec
        const detail = await granolaFetch('/v1/notes/' + note.id);
        if (!detail) continue;

        index.notes[note.id] = {
          id: note.id,
          title: detail.title || note.title || '',
          createdAt: detail.created_at || note.created_at || '',
          attendeeEmails: (detail.attendees || []).map(a => (a.email || '').toLowerCase()).filter(Boolean),
          attendeeNames: (detail.attendees || []).map(a => a.name || '').filter(Boolean),
          inviteeEmails: (detail.calendar_event?.invitees || []).map(i => (i.email || '').toLowerCase()).filter(Boolean),
          folderNames: (detail.folder_membership || []).map(f => f.name || '').filter(Boolean),
          calendarTitle: detail.calendar_event?.event_title || '',
          hasSummary: !!(detail.summary_text || detail.summary_markdown),
          hasTranscript: true, // assume true, actual fetch happens on match
        };
        totalNotes++;
      }

      const hasMore = page.has_more ?? page.hasMore ?? false;
      const nextCursor = page.next_cursor ?? page.nextCursor ?? page.cursor ?? null;
      if (!hasMore || !nextCursor || nextCursor === prevCursor) {
        if (nextCursor && nextCursor === prevCursor) {
          console.warn('[Granola] Cursor did not advance — aborting to avoid infinite loop. Cursor:', nextCursor);
        }
        cursor = null;
      } else {
        cursor = nextCursor;
      }
    } while (cursor);

    // Save to storage
    await new Promise(r => chrome.storage.local.set({ granolaIndex: index }, r));
    console.log('[Granola] Index built:', totalNotes, 'notes indexed across', pageNum, 'pages');
    return { success: true, noteCount: totalNotes };
  } catch (err) {
    console.warn('[Granola] Index build failed:', err.message);
    return { success: false, error: err.message };
  }
  })();
  state._granolaIndexInFlight = runPromise;

  // Always clear the in-flight slot when this run settles, regardless of who awaits it.
  // Guard against clobbering a newer run that may have replaced ours.
  runPromise.finally(() => {
    if (state._granolaIndexInFlight === runPromise) state._granolaIndexInFlight = null;
  });

  return runPromise;
}

export async function getGranolaIndex() {
  return new Promise(r => chrome.storage.local.get(['granolaIndex'], d => r(d.granolaIndex || null)));
}

export async function searchGranolaNotes(companyName, companyDomain, contactNames = []) {
  if (!state.GRANOLA_KEY) return { notes: null, error: 'not_connected' };

  try {
    console.log('[Granola] Searching for:', companyName, '| domain:', companyDomain, '| contacts:', contactNames);

    // Get the local index
    let index = await getGranolaIndex();

    // If no index exists, build one (first time)
    if (!index || !Object.keys(index.notes || {}).length) {
      console.log('[Granola] No index found, building...');
      await buildGranolaIndex();
      index = await getGranolaIndex();
      if (!index) return { notes: null, transcript: null, meetings: [] };
    }

    const allNotes = Object.values(index.notes);
    if (!allNotes.length) return { notes: null, transcript: null, meetings: [] };

    const lowerCompany = companyName.toLowerCase();
    const shortName = companyName.replace(/\s+(AI|Inc\.?|LLC|Corp\.?|Ltd\.?)$/i, '').trim().toLowerCase();
    const contactLower = contactNames.map(n => n.toLowerCase());

    // Get user's own email to exclude from attendee matching
    const { gmailUserEmail } = await new Promise(r => chrome.storage.local.get(['gmailUserEmail'], r));
    const userEmail = (gmailUserEmail || '').toLowerCase();

    const matched = new Map(); // noteId -> { note, reason, priority }

    for (const note of allNotes) {
      // Priority 1: Attendee email domain match
      // Require EITHER: company name in title, OR majority of non-user attendees are from this domain
      // A single CC'd person from the domain is not sufficient
      if (companyDomain) {
        const domainLower = companyDomain.toLowerCase();
        const allEmails = [...(note.attendeeEmails || []), ...(note.inviteeEmails || [])];
        const nonUserEmails = allEmails.filter(e => e !== userEmail && e.length > 3);
        const domainMatches = nonUserEmails.filter(e => e.endsWith('@' + domainLower));

        if (domainMatches.length > 0) {
          const title = ((note.title || '') + ' ' + (note.calendarTitle || '')).toLowerCase();
          const titleHasCompany = title.includes(lowerCompany) || (shortName.length > 3 && title.includes(shortName));

          // Strong match: company name in title + at least one domain email
          // OR: majority of external attendees are from this domain (it's a meeting WITH this company)
          const majorityFromDomain = nonUserEmails.length > 0 && (domainMatches.length / nonUserEmails.length) >= 0.5;

          if (titleHasCompany || majorityFromDomain) {
            matched.set(note.id, { note, reason: 'email-domain', priority: 1 });
            continue;
          }
        }
      }

      // Priority 2: Folder name match
      if (note.folderNames?.length) {
        const folderMatch = note.folderNames.some(f => {
          const fl = f.toLowerCase();
          return fl === lowerCompany || fl === shortName || fl.includes(lowerCompany) || (shortName.length > 3 && fl.includes(shortName));
        });
        if (folderMatch && !matched.has(note.id)) {
          matched.set(note.id, { note, reason: 'folder', priority: 2 });
          continue;
        }
      }

      // Priority 3: Attendee full name matches a Known Contact
      // Require FULL name match (first + last, both words >= 2 chars) to avoid false positives
      if (note.attendeeNames?.length && contactLower.length) {
        const nameMatch = contactLower.some(cn => {
          const words = cn.split(' ').filter(Boolean);
          if (words.length < 2) return false; // require first + last name minimum
          return note.attendeeNames.some(an => {
            const anl = an.toLowerCase();
            // Both first and last name must appear, and last name must be >= 3 chars
            return words.every(w => w.length >= 2 && anl.includes(w)) && words.some(w => w.length >= 3);
          });
        });
        if (nameMatch && !matched.has(note.id)) {
          matched.set(note.id, { note, reason: 'attendee-name', priority: 3 });
          continue;
        }
      }

      // Priority 4: Title matches company name (strong) or company name + contact name (weaker)
      const title = (note.title || '').toLowerCase();
      const calTitle = (note.calendarTitle || '').toLowerCase();
      const searchText = title + ' ' + calTitle;

      const titleMatchesCompany = searchText.includes(lowerCompany) || (shortName.length > 3 && searchText.includes(shortName));

      // Contact name in title is ONLY valid if the company name is also somewhere in the meeting
      // (title, calendar title, or attendee emails). Contact name alone is too weak.
      if (titleMatchesCompany && !matched.has(note.id)) {
        matched.set(note.id, { note, reason: 'title-company', priority: 4 });
      }
    }

    // Sort by priority, then by date
    const sortedMatches = [...matched.values()]
      .sort((a, b) => a.priority - b.priority || (b.note.createdAt || '').localeCompare(a.note.createdAt || ''))
      .slice(0, 10); // cap at 10

    console.log('[Granola] Matched', sortedMatches.length, 'notes for', companyName,
      sortedMatches.map(m => `${m.note.title?.slice(0,40)} (${m.reason})`));

    if (!sortedMatches.length) return { notes: null, transcript: null, meetings: [] };

    // Fetch full content with transcripts for matched notes
    const meetings = [];
    const transcripts = [];
    const granolaContacts = [];
    for (const { note, reason } of sortedMatches) {
      const full = await granolaFetch('/v1/notes/' + note.id + '?include=transcript');
      if (!full) continue;

      const transcriptText = (full.transcript || []).map(t =>
        (t.speaker?.source || 'Speaker') + ': ' + t.text
      ).join('\n');

      const summaryMd = full.summary_markdown || '';
      const summaryText = full.summary_text || '';
      const summary = summaryMd || summaryText;
      const attendees = (full.attendees || []).map(a => a.name || a.email).filter(Boolean);
      const calEvent = full.calendar_event || {};

      meetings.push({
        id: note.id,
        title: note.title || 'Meeting',
        date: (note.createdAt || '').slice(0, 10) || null,
        time: (note.createdAt || '').slice(11, 16) || null,
        transcript: transcriptText || summary,
        summary,
        summaryMarkdown: summaryMd,
        attendees,
        calendarTitle: calEvent.event_title || null,
      });

      // Extract attendee contacts. The `reason` captures WHY this meeting was
      // associated with the company (email-domain, folder, attendee-name, title-company),
      // which in turn is why each of its attendees is being pulled in as a contact.
      if (full.attendees?.length) {
        const meetingTitle = note.title || note.calendarTitle || 'Untitled meeting';
        const folderNames = (note.folderNames || []).join(', ');
        const matchedViaMap = {
          'email-domain':   { type: 'granola-email-domain',   detail: `Meeting "${meetingTitle}" — attendee email on ${companyDomain || 'company domain'}` },
          'folder':         { type: 'granola-folder',         detail: `Meeting "${meetingTitle}" — in Granola folder "${folderNames}"` },
          'attendee-name':  { type: 'granola-attendee-name',  detail: `Meeting "${meetingTitle}" — attendee name matched a known contact` },
          'title-company':  { type: 'granola-title',          detail: `Meeting "${meetingTitle}" — company name in meeting title` },
        };
        const matchedVia = matchedViaMap[reason] || { type: 'granola-meeting', detail: `Meeting "${meetingTitle}"` };
        for (const att of full.attendees) {
          if (att.email && att.name) {
            granolaContacts.push({ name: att.name, email: att.email.toLowerCase(), source: 'meeting', matchedVia });
          }
        }
      }

      if (transcriptText) transcripts.push(transcriptText);
      else if (summary) transcripts.push(summary);
    }

    meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const notes = meetings.map(m => m.summary).filter(Boolean).join('\n\n---\n\n') || null;
    const transcript = transcripts.join('\n\n---\n\n') || null;

    console.log('[Granola] Returning', meetings.length, 'meetings with', transcripts.length, 'transcripts');
    return { notes, transcript, meetings, extractedContacts: granolaContacts };
  } catch (err) {
    console.error('[Granola] Error:', err.message);
    return { notes: null, error: err.message };
  }
}
