// calendar.js — Google Calendar event fetching.

// ── Fetch calendar events related to a company ───────────────────────────

export async function fetchCalendarEvents(domain, companyName, knownContactEmails) {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, async token => {
      void chrome.runtime.lastError;
      if (!token) { resolve({ events: [], error: 'not_connected' }); return; }
      try {
        // Verify token has Calendar scope before calling the API
        const tokenInfo = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`).then(r => r.json()).catch(() => ({}));
        const grantedScopes = tokenInfo.scope || '';
        if (!grantedScopes.includes('calendar')) {
          resolve({ events: [], error: 'needs_reauth', detail: 'Calendar scope not in token — disconnect and reconnect Gmail in Setup.' });
          return;
        }

        const now = new Date();
        const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        const oneMonthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          timeMin: sixMonthsAgo.toISOString(),
          timeMax: oneMonthAhead.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        });
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.status === 401) {
          chrome.identity.removeCachedAuthToken({ token }, () => {});
          resolve({ events: [], error: 'token_expired' }); return;
        }
        if (res.status === 403) {
          const errBody = await res.json().catch(() => ({}));
          const errMsg = errBody?.error?.message || errBody?.error || 'forbidden';
          resolve({ events: [], error: 'needs_reauth', detail: errMsg }); return;
        }
        const data = await res.json();
        const baseDomain = domain ? domain.split('.')[0].toLowerCase() : '';
        const contactEmailSet = new Set((knownContactEmails || []).map(e => e.toLowerCase()));
        const companyLower = (companyName || '').toLowerCase();

        const isCompanyRelated = (event) => {
          const attendees = event.attendees || [];
          const hasCompanyAttendee = attendees.some(a => {
            const email = (a.email || '').toLowerCase();
            const d = (email.split('@')[1] || '');
            return d === domain || (baseDomain && d.split('.')[0] === baseDomain) || contactEmailSet.has(email);
          });
          const inTitle = companyLower && (event.summary || '').toLowerCase().includes(companyLower);
          return hasCompanyAttendee || inTitle;
        };

        const events = (data.items || [])
          .filter(isCompanyRelated)
          .map(e => ({
            id: e.id,
            title: e.summary || '(no title)',
            start: e.start?.dateTime || e.start?.date || '',
            end: e.end?.dateTime || e.end?.date || '',
            attendees: (e.attendees || []).map(a => ({
              email: (a.email || '').toLowerCase(),
              name: a.displayName || '',
              self: !!a.self,
            })),
            description: e.description || '',
            meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.[0]?.uri || null,
          }));

        resolve({ events });
      } catch (err) {
        resolve({ events: [], error: err.message });
      }
    });
  });
}
