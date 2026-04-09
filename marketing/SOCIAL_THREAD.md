# Social — Coop.ai launch posts

## LinkedIn (long-form, narrative)

I got tired of running my job search out of seven tabs, a Google Sheet, and a ChatGPT window where I re-pasted my resume every conversation. So I built one thing that does all of it.

It's a Chrome extension. I land on a company page — LinkedIn, Greenhouse, Lever, anywhere — and it detects the company. One click pulls firmographics, leadership, reviews, and hiring signals from a few APIs and synthesizes them into a profile. Save it, and it becomes a record in a kanban pipeline. Save a job posting and it gets scored against my background, my preferred roles, and my floors.

The piece that actually matters: there's an AI advisor in there called Coop, and Coop is loaded with everything. My profile, the company data, the job description, my Gmail threads with anyone at that company, my Granola meeting transcripts. When I ask "what should I lead with in this application," Coop already knows the relationship history. I'm asking the question instead of spending twenty minutes rebuilding context.

A few things I wanted to get right:

- All data is local. No backend, no account, no server. API keys are mine, stored in the browser.
- No API call fires without me clicking a button. Detection is free; enrichment is not.
- Coop's interpretation of my data — how aggressively to flag concerns, when to draft vs critique, how to read my floors — lives in a single editable textarea in settings. Code carries mechanics. Settings carry opinions. If I want him sharper or softer, I rewrite the textarea, no code change.
- Companies and opportunities share one record. No parallel stores, no sync bugs.
- Coop is also ambient now. A content script runs everywhere I write — Gmail, LinkedIn, applications, Slack — with a privacy blocklist for anything sensitive. It flags the phrases that aren't in my voice ("circle back," "hope this finds you well," "leverage") and rewrites the whole field in my voice on click. I built a Grammarly that only cares about one thing — whether I actually sound like me.

It's not productized. It's not on the Chrome Web Store. It's a personal tool I use every day in my own search. If you want a walkthrough, DM me — happy to show it.

---

## X / Twitter thread (6–8 tweets, punchy)

**1.** I got tired of running my job search out of 7 tabs, a Google Sheet, and a ChatGPT window where I re-pasted my resume every time. So I built one thing that replaces the whole stack. Chrome extension. Local. Mine.

**2.** Land on any company page. Sidepanel detects the company. One click pulls firmographics, leadership, reviews, and hiring signals from Apollo + web search, Claude synthesizes it. Cached 24h. No API call ever fires without me clicking.

**3.** Save it and it's a record in a kanban pipeline. Save a job and it gets scored 1–10 against my background, preferred roles, and floors. The breakdown tells me strong fits and red flags.

**4.** The thing that actually changed my life: an AI advisor called Coop. He's loaded with my profile, the company data, the job, my Gmail threads with anyone there, and my Granola meeting transcripts. I ask the question. I don't rebuild context.

**5.** All data is local. `chrome.storage.local`. No backend. No account. My API keys, my browser. Multi-provider chat fallback so when one model rate-limits, the next one answers.

**6.** Best architectural decision: Coop's opinions live in a textarea in settings, not in code. How to read my floors, when to draft vs critique, how hard to push back — all editable, no deploy. Code carries mechanics. Settings carry opinions.

**7.** New piece I just shipped: Coop is ambient now. Content script on every page (with a privacy blocklist), watches the field I'm focused on, flags the phrases that aren't in my voice, rewrites the whole thing in my voice on click. I built a Grammarly that only cares about one thing — whether I actually sound like me.

**8.** Not productized. Not shipping. Just a personal edge for my own search. DM if you want a walkthrough.
