---
name: Email htmlBody XSS risk
description: Gmail htmlBody/body must be run through sanitizeEmailHtml before innerHTML insertion
type: feedback
---

When rendering email content from `entry.cachedEmails[].messages[].htmlBody` (or `.body`), ALWAYS wrap via `sanitizeEmailHtml()` before injecting via innerHTML.

**Why:** gmail.js `extractHtmlBody` returns raw decoded base64 HTML from third-party senders. Without sanitization, inline `<script>`, `onclick`, iframes, etc. execute in the extension context. `chat.js` renderEmailThreads gets this right; easy to miss in new surfaces.

**How to apply:** any code path that reads `msg.htmlBody || msg.body` and assembles a string for innerHTML must call `sanitizeEmailHtml()` (defined in chat.js, in-scope on any page that loads chat.js). `escapeHtml()` is wrong for HTML-bearing fields — it renders as text. Use sanitize for HTML, escape only for text/attributes.
