---
provider: anthropic
checked: 2026-11-26
source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
cache:
  mode: breakpoints
  min_tokens: 4096
  max_breakpoints: 4
  ttl_seconds: 300
---

# Anthropic (Claude API)

Status: documented. Cache reuse without markers measured in E1 (0 tokens cached on 29 turns of sessions that send no `cache_control`).

Frontmatter `min_tokens: 4096` is the conservative default: the largest per-model minimum below. Use the per-model value when the model is known.

## Cache lifetime and markers

| Fact | Value | Basis |
|---|---|---|
| Default lifetime | 5 minutes, refreshed at no extra cost on each use | docs, checked 2026-11-26 |
| Longer lifetime | 1 hour, `"ttl": "1h"` in `cache_control` | docs |
| Breakpoints per request | 4 explicit; automatic caching (top-level `cache_control`) uses one of the 4 | docs |
| Lookback per breakpoint | 20 blocks, counting the breakpoint | docs |
| Cache write | 1.25x base input (5 minutes), 2x (1 hour) | docs |
| Cache read | 0.1x base input by default; 0.05x on Opus 5.5 and Sonnet 5.5; 0.025x on Fable 5.2, Mythos 5.2, Fable 5.1, Mythos 5.1 | docs |
| Usage fields | `cache_creation_input_tokens`, `cache_read_input_tokens`, `input_tokens` | docs |
| Total input | `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`; `input_tokens` counts only the tokens after the last breakpoint, so a meter that reads `input_tokens` alone undercounts once marks are set | docs (prompt caching, "Understanding the token breakdown"), checked 2026-11-26 |
| Without markers | nothing cached on the sessions measured | E1 |

## Minimum cacheable prompt, by model (docs)

Shorter prompts are processed without caching and return no error.

| Minimum tokens | Models |
|---|---|
| 512 | Fable 5.2, Mythos 5.2, Fable 5.1, Mythos 5.1, Opus 5.5, Opus 5, Sonnet 5.5, Fable 5, Mythos 5, Haiku 5.5 |
| 1,024 | Opus 4.8, Sonnet 5, Sonnet 4.6, Sonnet 4.5, Opus 4.1, Opus 4, Sonnet 4 |
| 2,048 | Mythos Preview, Opus 4.7 |
| 4,096 | Opus 4.6, Opus 4.5, Haiku 4.5 |

## What invalidates a cached prefix (docs)

- Tools render first. Changing a tool definition (names, descriptions, parameters) invalidates tools, system and messages. Appending a tool after a cached tool block is not safe on this provider (E3: cached 0 with no breakpoint in front of the change). A `cache_control` mark on the last original tool should keep the tool block, because marks are written at a block boundary; this is untested here (E3 had no breakpoint in front of the change) and the docs do not describe this case (checked 2026-11-26).
- Toggling web search or citations, or the speed setting, invalidates system and messages.
- Thinking parameters invalidate message blocks. The thinking mode and `budget_tokens` are rendered into the prompt. See `models/anthropic-thinking.md`.
- `output_config.effort` can invalidate message blocks, and on some models tool and system caches. Setting it explicitly to the model default does not.
- `tool_choice` and adding or removing images invalidate message blocks only.
- Batch API: requests can run concurrently, so a cache written by one line may not be visible to the others. OpenRouter's docs suggest 1-hour breakpoints on a shared prefix.

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | No `n` parameter in the Messages API body parameters; one request returns one message | https://platform.claude.com/docs/en/api/messages/create |
| Output limit | `max_tokens` (required); "our models may stop before reaching this maximum". Thinking tokens count toward it (`models/anthropic-thinking.md`) | same page |
| Truncation signal | `stop_reason: "max_tokens"` ("Raise `max_tokens` or continue the response"; a truncated tool call needs a retry with a higher `max_tokens`); `model_context_window_exceeded` ("Treat the response as truncated") | https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons |
| Usage field | `usage.output_tokens` | Messages API reference |
| Message Batches | Costs reduced by 50 percent; most batches finish in less than 1 hour; batches expire if not done within 24 hours (expired requests are not billed); up to 100,000 requests or 256 MB; results kept 29 days. Prompt caching works in batches on a best-effort basis; the page suggests the 1-hour cache lifetime for shared context | https://platform.claude.com/docs/en/build-with-claude/batch-processing |
| Service tiers | Legacy. Priority Tier needs an existing commitment (no longer sold); `service_tier` accepts `auto` and `standard_only`. No cheaper interactive tier is listed | https://platform.claude.com/docs/en/api/service-tiers |
| Predicted outputs | No prediction parameter in the Messages API body parameters | https://platform.claude.com/docs/en/api/messages/create |
| Structured outputs | `output_config.format: {type: "json_schema", schema}` (SDK helper `messages.parse`), and `strict: true` on tools. Constrained decoding: "No retries needed for schema violations". Unsupported schema features return 400. The first use of a schema compiles a grammar (cached 24 hours from last use). Changing `output_config.format` invalidates the prompt cache for that conversation | https://platform.claude.com/docs/en/build-with-claude/structured-outputs (first 100,000 of 112,853 characters read) |
| Long requests | Use streaming or the batch API for long requests, "especially those over 10 minutes"; avoid a large `max_tokens` without streaming. The SDK checks that a non-streaming request is not expected to exceed a 10-minute timeout | https://platform.claude.com/docs/en/api/errors |
| SDK retries | 2 retries by default (3 attempts); follows `x-should-retry` when present, else retries connection errors, timeouts, 408, 409, 429 and 5xx; waits `retry-after` or backs off from 0.5 to 8 seconds. The SDK does not retry an error inside a stream | same page |
| Errors | 400 `invalid_request_error`, 401 `authentication_error`, 413 `request_too_large`; 504 `timeout_error` (for long requests the page points to streaming); 529 `overloaded_error` (temporary); 429 also covers a monthly spend cap, which has no `retry-after` and keeps failing, so limit retries after a 429; 500: retry only if `x-should-retry` is not `false` | same page |
| Client disconnect | Whether closing the connection stops generation and billing on a direct call: not stated on the pages above. Through OpenRouter, Anthropic is listed among providers whose streams stop on abort (`providers/openrouter.md`) | not stated (checked 2026-11-26) |

## Prompt size facts (docs, checked 2026-11-26)

Used by the `prompt-diet` rules.

| Fact | Value | Source |
|---|---|---|
| Tool definitions are input | Tool use requests are priced on "the total number of input tokens sent to the model (including in the `tools` parameter)"; the extra tokens come from the `tools` parameter (names, descriptions, schemas), `tool_use` blocks and `tool_result` blocks. With any tool present the API also adds a tool use system prompt, whose size per model and `tool_choice` is listed on the page | https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview |
| Thinking blocks in a tool-use turn | "Required: within a tool-use turn, pass thinking blocks back", complete and unmodified. Across turns: "You don't need to prune old thinking yourself"; the API filters them and bills input only for the blocks shown to the model. Which earlier blocks are kept is per model | https://platform.claude.com/docs/en/build-with-claude/thinking |
| Changing an earlier message | On models with preserved thinking, a change to `system`, `tools` or an earlier message makes every thinking block after the change fail a prefix check, and the request can get a 400 error. A dropped thinking block changes the cached prefix from its position onward | same page |
| Tool result clearing | Context editing (beta, header `context-management-2025-06-27`) has a `clear_tool_uses_20250919` strategy that clears old tool results past a token trigger, keeping the most recent ones. It "invalidates cached prompt prefixes when content is cleared"; `clear_at_least` skips a clearing that would remove too little to be worth the cache write | https://platform.claude.com/docs/en/build-with-claude/context-editing |

## Not stated in the docs

- Whether a cache entry can be evicted before its lifetime ends: not stated in the docs (checked 2026-11-26). Only the first 100,000 characters of the page were read; the rest was not.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
