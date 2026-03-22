# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Extension (Manifest V3) called **Company Intel** that auto-detects the company name from the active tab and researches it using Apollo.io, Google Custom Search, and Claude AI. Results appear in Chrome's side panel.

## Loading the extension

There is no build step. Load it directly in Chrome:

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

After any code change, click the reload icon on the extension card in `chrome://extensions`.

## Configuration

API keys live in `config.js`, which is imported as a plain script by the service worker (`importScripts('config.js')`). Fill in the four values:

```js
const CONFIG = {
  ANTHROPIC_KEY: '...',
  APOLLO_KEY: '...',
  GOOGLE_KEY: '...',
  GOOGLE_CX: '...'   // Custom Search Engine ID
};
```

The `.env` file is not used by the extension itself — it exists only as a reference for the key values.

## Architecture

Message flow across the three extension contexts:

```
sidepanel.js (side panel UI)
  → chrome.tabs.sendMessage({ type: 'GET_COMPANY' })
      → content.js detects company from DOM, returns { company, jobTitle, source }
  → chrome.runtime.sendMessage({ type: 'RESEARCH_COMPANY', company })
      → background.js (service worker) calls Apollo + Google in parallel,
         then Claude with the combined data, returns structured JSON
  → sidepanel.js renders the result
```

**`content.js`** — runs on every page. Has platform-specific detectors for LinkedIn, Greenhouse, and Lever, plus a generic fallback using `og:site_name`, page title, or domain extraction.

**`background.js`** — service worker. Orchestrates three external API calls:
- Apollo.io `/organizations/enrich?domain=` for company firmographics
- Google Custom Search for Glassdoor/Repvue reviews
- Anthropic Messages API (`claude-sonnet-4-20250514`) with a prompt tuned for a senior GTM operator evaluating companies; expects a raw JSON response (no markdown fencing)

**`sidepanel.html` / `sidepanel.js`** — the UI. On open, queries the active tab's content script for the detected company, then on "Research" click fires the background worker and renders the returned JSON.

## Claude prompt behavior

The prompt in `background.js:fetchClaudeSummary` is persona-driven: it scores companies 1–10 for fit as a senior GTM operator who values autonomy, early stage, and technical product. The response schema is fixed JSON with fields: `fitScore`, `fitSummary`, `stage`, `employees`, `industry`, `founded`, `summary`, `reviews[]`.
