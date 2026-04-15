---
name: Cost display patterns
description: How cost tracking UI works across saved.html (pill) and pipeline.js (full chart) -- data shape, provider coverage, sparkline approach
type: reference
---

Cost pill in saved.html header uses `#cost-pill` (`.stat-pill` base class). `updateCostPill()` in saved.js replaces its innerHTML with a sparkline + formatted amount. Click handler on the outer element survives innerHTML replacement.

Data shape (from api.js `trackApiCall`):
- `usage.costToday` -- top-level aggregate
- `usage[provider].costToday` -- per-provider
- `usage[provider].dailyHistory[]` -- array of `{ date, requests, inputTokens, outputTokens, estimatedCost }`
- Only anthropic/openai entries have `estimatedCost` (token-based pricing); apollo/serper/granola are request-count only

Pipeline.js has a full 30-day chart using `COST_PROVIDERS = ['anthropic', 'openai', 'serper', 'apollo', 'granola']` but only anthropic/openai contribute cost values.

Header background is `--ci-bg-header: #151B26` (dark navy). Cost color classes: `.cost-low` = teal (#36B37E), `.cost-mid` = amber (#F5A623), `.cost-high` = red (#E8384F). All have good contrast on dark.
