---
family: anthropic-thinking
checked: 2026-11-26
source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
---

# Anthropic thinking and effort

Status: documented, not yet measured here. Cache facts are in `providers/anthropic.md`.

## Modes (docs, checked 2026-11-26)

- Manual extended thinking (`thinking: {type: "enabled", budget_tokens: N}`) is deprecated. Claude 4.7 and later reject it with a 400 error. Models documented as extended-thinking-only (`type: "adaptive"` returns 400): Opus 4.5, Sonnet 4.5, Haiku 4.5, Opus 4.1, Sonnet 4, Opus 4.
- Adaptive thinking (`thinking: {type: "adaptive"}`) with `output_config: {effort: ...}` is the replacement. The model decides whether and how much to think per request; at lower effort it may skip thinking on easy inputs.
- Effort defaults: `medium` on Opus 5.5 and Haiku 5.5, `high` on other models that support effort (including Sonnet 4.6). Setting effort explicitly to the model default does not invalidate the cache.

## Budget rules (manual mode)

- `budget_tokens` minimum 1,024 and less than `max_tokens`, except with interleaved thinking in manual mode where it can exceed `max_tokens`.
- The budget is a target, not a cap; `max_tokens` is the hard ceiling. Thinking tokens count toward `max_tokens` and are billed as output tokens; `usage.output_tokens_details.thinking_tokens` reports them.
- For budgets above 32k the docs advise the batch API.
- Manual thinking cannot be combined with `max_tokens: 0` cache pre-warming.

## Cache interaction

- The thinking mode and `budget_tokens` are rendered into the prompt. Changing `budget_tokens` between requests invalidates message-level breakpoints; the docs' example re-created 1,370 tokens on the request after a 4,000 to 8,000 change. Switching modes does the same. Pick a budget and hold it for the life of a cached conversation.
- Thinking blocks across turns: Opus 4.5 and Claude 4.6 and later keep prior turns' thinking blocks in context and bill them as input; Sonnet 4.5, Haiku 4.5 and earlier strip them. Dropped thinking blocks invalidate message blocks from that position.
- `tool_choice` changes invalidate message blocks only.

## Interleaved thinking

- Opus 4.5, Sonnet 4.5, Haiku 4.5, Opus 4.1, Sonnet 4, Opus 4: add the `interleaved-thinking-2025-05-14` beta header. Sonnet 4.6: header still works but is deprecated. Opus 4.6: manual mode has no interleaving; use adaptive. Adaptive thinking interleaves with no header.
- Manual mode needs the final assistant turn to start with a thinking block; adaptive drops that requirement.

## Not stated in the docs

- Temperature restrictions with thinking, and tool-calling or JSON-output quirks: not stated on the page read (checked 2026-11-26).
- Only the Extended thinking page was read; the Thinking, Effort and Steering pages it links to were not.
