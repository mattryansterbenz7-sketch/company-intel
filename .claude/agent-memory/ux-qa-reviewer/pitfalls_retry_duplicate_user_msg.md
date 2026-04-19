---
name: Retry button duplicates user message
description: Inline-error retry flow in chat.js re-pushes the same user turn when it should reuse the existing one
type: project
---

Chat retry implementation pattern (chat.js #251): when the model call errors, the error turn is stored as `_isError` + `_retryPrompt` assistant entry. Clicking Retry removes the error turn but then calls `send()`, which reads `inputEl.value` and **pushes a new user message** into history.

Net effect: the history ends up with two identical user messages (the original and the retry re-push). The API call then sees both turns and the UI shows the user's question twice.

**Why:** Fix requires either (a) splicing the last user message off before calling send(), or (b) a dedicated retry path that re-calls the API without modifying history.

**How to apply:** Whenever reviewing a retry/resubmit flow in chat.js or similar, trace whether the retry reuses the existing last-user turn or pushes a fresh one. The comment "We don't remove the user message — the retry re-sends from the current history" was misleading; the code doesn't match the comment.
