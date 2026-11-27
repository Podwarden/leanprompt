---
provider: deepseek
checked: 2026-11-27
source: https://api-docs.deepseek.com/guides/kv_cache
cache:
  mode: automatic
  min_tokens: 0
  ttl_seconds: 3600
---

# DeepSeek

Status: documented, not yet measured here. Every fact below comes from DeepSeek's official docs, checked against the raw page text (server-rendered HTML and the site's `.md` page source) on 2026-11-27. Pages read: the context caching guide, pricing, error codes, the home page (Your First API Call), thinking mode, the chat completion reference, rate limit, the 2026-11-13 news page, the updates page, token usage and the site's sitemap.xml. No page failed. No API request was sent.

The frontmatter `cache:` block says `min_tokens: 0` because the caching guide states no minimum prompt size. It has no `step_tokens` because the guide names "fixed token intervals" for long inputs but gives no number. `ttl_seconds: 3600` is a planning floor chosen here, not a stated default: the guide says only that unused caches are cleared "usually within a few hours to a few days" and that building a cache "takes seconds". One hour is below "a few hours", so it is conservative.

## Context caching (disk-based, automatic)

| Fact | Value | Source |
|---|---|---|
| Mode | "enabled by default for all users", no code changes; the cache is on disk | https://api-docs.deepseek.com/guides/kv_cache |
| Models | The guide does not name models. The pricing page lists cache-hit prices for both current models (`deepseek-flash`, `deepseek-v4-pro`) | https://api-docs.deepseek.com/guides/kv_cache, https://api-docs.deepseek.com/quick_start/pricing |
| Minimum size | Not stated | https://api-docs.deepseek.com/guides/kv_cache |
| Unit size | Not stated as a number. Prefixes are stored at request boundaries (end of the user input and end of the model output), when a common prefix is seen across requests, and "at fixed token intervals" for long inputs or outputs | https://api-docs.deepseek.com/guides/kv_cache |
| Prefix matching | A hit needs a full match of a stored "cache prefix unit"; partial overlap of a unit does not count. Only the input prefix is cached, so output is still random (temperature etc.) | https://api-docs.deepseek.com/guides/kv_cache |
| Reliability | "best-effort", no guaranteed hit rate | https://api-docs.deepseek.com/guides/kv_cache |
| Lifetime | Unused caches are cleared automatically, "usually within a few hours to a few days". No exact duration is stated | https://api-docs.deepseek.com/guides/kv_cache |
| First requests | In the long-text example the first two requests with the same report miss; the third hits, after the shared prefix is stored. Cache construction "takes seconds" | https://api-docs.deepseek.com/guides/kv_cache |
| Usage fields (guide) | `usage.prompt_cache_hit_tokens` and `usage.prompt_cache_miss_tokens` | https://api-docs.deepseek.com/guides/kv_cache |
| Usage fields (API reference) | `prompt_tokens` equals hit plus miss tokens. The schema puts `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` at the top level of `usage` (both required), and `prompt_tokens_details.cached_tokens` ("Same as prompt_cache_hit_tokens") inside `prompt_tokens_details`. Either place gives the hit count | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Cached input price | Per 1M tokens, `deepseek-flash`: hit $0.003 off-peak, $0.006 peak; miss $0.15 off-peak, $0.30 peak. `deepseek-v4-pro`: hit $0.022 off-peak, $0.044 peak; miss $0.66 off-peak, $1.32 peak. A hit costs 2% (flash) or 3.3% (pro) of a miss, calculated here from those prices | https://api-docs.deepseek.com/quick_start/pricing |
| Peak hours | 01:00 to 04:00 and 06:00 to 10:00 UTC, Monday to Friday, excluding Chinese public holidays; all other hours are off-peak (half price) | https://api-docs.deepseek.com/quick_start/pricing |
| Per-user cache isolation | The `user_id` field (top level in Chat Completions, `metadata.user_id` in the Anthropic format) is used for "KVCache isolation for privacy" among other purposes | https://api-docs.deepseek.com/quick_start/rate_limit/ |
| Caching inside a batch | No batch API is documented on any page read (see below) | not stated |

## Models and renames (read 2026-11-27)

| Fact | Value | Source |
|---|---|---|
| Current model ids | `deepseek-flash` (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro` (DeepSeek-V4-Pro-0813). Both: 1M context, max output "MAXIMUM: 384K", thinking and non-thinking modes (thinking is the default) | https://api-docs.deepseek.com/quick_start/pricing |
| `deepseek-chat`, `deepseek-reasoner` | Not on the pricing page or the home page. Updates page, 2026-04-24 entry: they "will be discontinued in three months (2026-07-24)", mapped until then to the non-thinking and thinking modes of `deepseek-v4-flash`. The page read does not say what a request to these names returns after 2026-07-24 | https://api-docs.deepseek.com/updates/ |
| `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` | Models retired 2026-09-10; the names are still accepted and are served by DeepSeek-V4.1-Flash-1017 at the Flash price. The updates page calls the routing "temporary" | https://api-docs.deepseek.com/quick_start/pricing, https://api-docs.deepseek.com/updates/ |
| New flash name | `deepseek-flash` from 2026-09-10; on 2026-10-17 it moved to the 1017 version, "pricing and calling unchanged" | https://api-docs.deepseek.com/updates/ |
| Model history | `deepseek-chat` and `deepseek-reasoner` had been V3.2 (2025-12-01), V3.2-Exp (2025-09-29), V3.1-Terminus (2025-09-22), V3.1 (2025-08-21). On 2024-09-05 DeepSeek V2 Chat and DeepSeek Coder V2 were merged into DeepSeek V2.5, reachable through either `deepseek-coder` or `deepseek-chat` | https://api-docs.deepseek.com/updates/ |
| Base URLs | OpenAI format `https://api.deepseek.com`; Anthropic format `https://api.deepseek.com/anthropic` | https://api-docs.deepseek.com/quick_start/pricing |
| Features | JSON output, tool calls, Responses API, Anthropic API, chat prefix completion (Beta) on both models; FIM (Beta) in non-thinking mode only; vision on `deepseek-flash` only | https://api-docs.deepseek.com/quick_start/pricing |

## Generation features (docs, checked 2026-11-27)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| Output limit | `max_tokens`, "between 1 and 384K (393216)". Default: 8K in non-thinking mode, 64K in thinking mode, 128K when `reasoning_effort` is `max`. Input and output together are bounded by the context length | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Reasoning tokens vs the limit | Not stated on the thinking mode page or in the `max_tokens` text. The `max_tokens` defaults for thinking mode (64K, 128K) are far above the non-thinking default, which suggests reasoning shares the budget, but the pages do not say so. Usage reports `completion_tokens_details.reasoning_tokens` | https://api-docs.deepseek.com/guides/thinking_mode/, https://api-docs.deepseek.com/api/create-chat-completion/ |
| `finish_reason` | `stop`, `length` (`max_tokens` reached), `content_filter`, `tool_calls`, `insufficient_system_resource` (inference system lacked resources and interrupted the request), `aborted` (generation interrupted) | https://api-docs.deepseek.com/api/create-chat-completion/ |
| `n` (several samples) | Not mentioned on the chat completion reference | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Usage fields | `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details`, `completion_tokens_details.reasoning_tokens`, `safety_tokens` (only when `safety_check` is `high`, already inside `completion_tokens`), `server_tool_use` (omitted when all counts are zero) | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Streaming usage | `stream_options.include_usage`; the last chunk before `[DONE]` always carries full usage; `stream_options` without `stream: true` returns 400 | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Structured output | `response_format` `text` or `json_object`; the prompt must also ask for JSON. Invalid JSON is replaced with spaces, so content can look empty with `finish_reason: stop`; with `length` it may be cut off. No `json_schema` type is listed | https://api-docs.deepseek.com/api/create-chat-completion/ |
| `stop` | Up to 16 sequences, each non-empty and at most 512 bytes | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Service tiers | `service_tier` not mentioned on the reference | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Batch API | None found on the pages read (home page links, pricing, updates) or in the English page list of https://api-docs.deepseek.com/sitemap.xml. Not stated either way, so do not assume a batch discount | https://api-docs.deepseek.com/ |
| Rate limits | Concurrency, not request or token rates: 2,500 concurrent requests for `deepseek-flash`, 500 for `deepseek-v4-pro`, per account across all keys. A request counts from send until the response completes. Over the limit: HTTP 429. Higher concurrency through a capacity expansion request, at no extra cost | https://api-docs.deepseek.com/quick_start/rate_limit/ |
| Rate limit headers | Not stated | https://api-docs.deepseek.com/quick_start/rate_limit/ |
| Keep-alive and timeout | Non-streaming: the server sends empty lines while waiting; streaming: `: keep-alive` SSE comments. If inference has not started within 10 minutes the server closes the connection | https://api-docs.deepseek.com/quick_start/rate_limit/ |
| Client disconnect | Not stated on the pages read | not stated |

## Thinking mode (docs, checked 2026-11-27)

| Fact | Value | Source |
|---|---|---|
| Default | Thinking is enabled by default, effort `high`. Both current models | https://api-docs.deepseek.com/guides/thinking_mode/ |
| Switch | `thinking: {"type": "enabled" or "disabled"}` (through `extra_body` in the OpenAI SDK); it takes precedence over `reasoning_effort`. If `thinking` is omitted, the mode follows `reasoning_effort`; if both are omitted, thinking is on | https://api-docs.deepseek.com/api/create-chat-completion/ |
| Effort values | `reasoning_effort`: `none` (disables thinking), `low`, `high`, `max`. `minimal` maps to `low`; `medium` and `xhigh` map to `high` (the thinking page also says max and ultra map to max) | https://api-docs.deepseek.com/api/create-chat-completion/, https://api-docs.deepseek.com/guides/thinking_mode/ |
| `reasoning_content` | The chain of thought, returned beside `content` | https://api-docs.deepseek.com/guides/thinking_mode/ |
| Sending it back | Without `tools` in the request, earlier `reasoning_content` is not put into context; passing it is allowed and ignored. With `tools` in the request, `reasoning_content` from all earlier turns must be passed back, even for turns with no tool call, or the API returns 400 | https://api-docs.deepseek.com/guides/thinking_mode/ |
| Ignored sampling parameters | `temperature`, `presence_penalty`, `frequency_penalty`: no error, no effect. `top_p` has model-specific limits (flash: effective only in thinking mode, 0.95 to 1.0) | https://api-docs.deepseek.com/guides/thinking_mode/ |

## Errors (docs, checked 2026-11-27)

The page gives causes and fixes, not an explicit retry table. "Retry" below is stated only where the page says to retry.

| Code | Meaning | Retry as the page says | Source |
|---|---|---|---|
| 400 | Invalid format | fix the request | https://api-docs.deepseek.com/quick_start/error_codes |
| 401 | Wrong API key | fix the key | same page |
| 402 | Insufficient balance | top up, not a retry | same page |
| 408 | Request timeout (slow file upload, e.g. OCR, speech to text) | "check your network, retry" | same page |
| 413 | File too large | reduce the file | same page |
| 422 | Invalid parameters | fix the parameters | same page |
| 429 | Rate limit reached (too frequent, concurrency or QPS) | pace requests; no `Retry-After` stated | same page |
| 500 | Server error | "retry after a brief wait" | same page |
| 503 | Server overloaded | "retry after a brief wait" | same page |
| 504 | Gateway timeout (OCR, document uploads) | retry later or send a smaller file | same page |

## Not stated in the docs read

- The minimum prompt size and unit size for caching, and the cache lifetime in seconds (checked 2026-11-27).
- Whether reasoning tokens count against `max_tokens`.
- Any rate limit response headers, and any `Retry-After` behaviour.
- A batch API or flex tier.
- What `deepseek-chat` and `deepseek-reasoner` return after 2026-07-24.
