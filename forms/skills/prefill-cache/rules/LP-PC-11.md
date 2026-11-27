---
id: LP-PC-11
title: Keep pauses inside the cache lifetime
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang]
saves: prefill
severity: low
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
  - doc: https://openrouter.ai/docs/features/prompt-caching
    checked: 2026-11-26
---
## Rule
Schedule work that shares a prefix so the gaps between its requests stay inside the provider's cache lifetime; where they cannot, pick a longer lifetime only when the break-even rule favours it, or expect a cold prefix.

## Why
A cached prefix expires after a period without use. The lifetimes differ by provider and option, and some are refreshed on each read; they are in the provider tables ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md), [providers/openai.md](../../leanprompt/facts/providers/openai.md), [providers/gemini.md](../../leanprompt/facts/providers/gemini.md), [providers/deepinfra.md](../../leanprompt/facts/providers/deepinfra.md)). Self-hosted engines have no lifetime but evict under memory pressure ([providers/vllm.md](../../leanprompt/facts/providers/vllm.md), [providers/sglang.md](../../leanprompt/facts/providers/sglang.md)). On OpenRouter, sticky routing to the provider that holds the cache has its own inactivity timer ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)). Documented, not yet measured here.

The shapes: a batch job that processes documents round-robin, so each document's long prefix comes back only after every other document has been seen; an agent waiting for a human approval; a rate limiter that spaces calls further apart than the lifetime; a cron job that runs the same long prompt at an interval just over it.

Longer lifetimes cost more to write where they exist, and Gemini's explicit cache objects bill storage for as long as they live, so a longer lifetime is a cost decision, not a default (LP-PC-01, break-even rule).

## Detect in code
Python:
```
rg -n 'time\.sleep\(|asyncio\.sleep\(|RateLimiter|requests_per_minute|input\(|wait_for_approval' -g '*.py'
```
Shapes: `for item in items: for doc in docs: ask(doc, item)` (round-robin over documents with long shared prefixes); a sleep or rate limit between calls that share a prefix; a loop that waits on a human between turns.

TS/JS:
```
rg -n 'setTimeout\(|setInterval\(|minTime|p-limit|Bottleneck|cron' -g '*.{ts,tsx,js,mjs}'
```
Shapes: a `Bottleneck({ minTime })` limiter on a pipeline that re-sends one long prefix; a scheduled job whose interval is close to the lifetime.

Go:
```
rg -n 'time\.Sleep\(|time\.NewTicker\(|rate\.NewLimiter\(|cron\.' -g '*.go'
```
Shapes: a ticker-driven loop that re-sends a long shared prompt; a limiter shared by many prefixes so each prefix's turn comes rarely.

## Fix
Group requests by prefix in time.

```python
# before: each document's prefix is reused only after all other documents have been seen
for q in questions:
    for doc in docs:
        answer(doc, q)

# after: all questions for one document while its prefix is warm
for doc in docs:
    for q in questions:
        answer(doc, q)
```

For a gap that cannot be avoided (a human in the loop), compare the cost of a rewrite at the default lifetime with a longer lifetime, using the break-even rule in LP-PC-01 and the multipliers in the provider table. Send a keep-warm request only when the next use is certain and its cost is below a rewrite, and never add it to the conversation history.

## Don't break meaning
Regrouping changes the order in which work runs, not the prompts, so answers do not change; but if a later item depends on an earlier result, keep that dependency order. A keep-warm request must not reach the user or the stored history.

## Verify
(a) Send the same prefix twice, once with a gap shorter than the lifetime and once with a longer gap. The first pair reports `cached_tokens` or `cache_read_input_tokens` on the second request; the second pair reports a cold prefix (no read, or a new cache write). That is expected, not a bug.

(b) kvsig: the two requests have equal `nodes` across the gap. Equal ids with a miss after a gap longer than the lifetime is a cold prefix; equal ids with a miss inside the lifetime point to another rule (LP-PC-01 marks, LP-PC-12 split).

## Waste signal
Measured: not counted against the app. The score caps "reusable" by the provider's cache lifetime, so a prefix last seen longer ago than the lifetime leaves E and S unchanged; the audit reports how many requests had a cold prefix. Static: severity low, with the break-even advice (mark, don't mark, longer lifetime, restructure).
<!-- leanprompt:generated v0.1.0-dev.13: written by npx leanprompt install; npx leanprompt update replaces local edits -->
