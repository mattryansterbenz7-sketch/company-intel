---
name: Contacts tab does not exist on opportunity.html
description: chat.js contact-chip navigation assumes .hub-tab[data-tab=contacts], which lives only on company.html
type: feedback
---

Contact-chip click handlers that do `document.querySelector('.hub-tab[data-tab="contacts"]')` silently no-op on `opportunity.html`.

**Why:** `company.html` uses `.hub-tab` + a `contacts` panel. `opportunity.html` uses `.activity-tab` and only has `emails` + `meetings` — no contacts tab. So a feature shared via chat.js that targets `.hub-tab[data-tab="contacts"]` ends in a silent dead-end on the opportunity page.

**How to apply:** whenever chat.js (the shared renderer for company.js + opportunity.js) wires navigation, either (a) check the selector resolves before binding and hide the chip on opportunity, or (b) fall back to a no-op that still feels intentional. Don't ship chips that look clickable but quietly do nothing.
