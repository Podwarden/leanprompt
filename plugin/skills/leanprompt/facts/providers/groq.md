---
provider: groq
checked: 2026-11-27
source: https://console.groq.com/docs/prompt-caching
cache:
  mode: automatic
  min_tokens: 1024
  ttl_seconds: 7200
---

# Groq

Status: documented, not yet measured here. Every fact below comes from Groq's official docs, checked on 2026-11-27 against the raw page text (the markdown copy each docs page serves at its URL plus `.md`, for example https://console.groq.com/docs/prompt-caching.md). Pages read: prompt caching, reasoning, errors, rate limits, models, deprecations, flex processing, batch, the API reference for chat completions, and the OpenAI compatibility page. No page failed. No API request was sent.

Caching exists only for three models: `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and `openai/gpt-oss-safeguard-20b`. Other models (for example `qwen/qwen3.8-27b`) are not listed, so treat them as not caching. The frontmatter describes the cacheable models. The minimum prompt length "varies by model, from 128 to 1024 tokens" and the page gives no per-model numbers, so `min_tokens: 1024` is the top of the range, chosen so a prompt above it is surely eligible. `ttl_seconds: 7200` is the page's "expires after 2 hours without use"; the same page elsewhere says "a few hours", so the exact window is unclear.

## Prompt caching (docs, https://console.groq.com/docs/prompt-caching)

| Fact | Value | Source |
|---|---|---|
| Mode | Automatic; no code changes, no extra fees. Cannot be disabled; no manual clearing or refresh | https://console.groq.com/docs/prompt-caching |
| Models | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `openai/gpt-oss-safeguard-20b` | same page |
| Minimum | 128 to 1024 tokens depending on the model; per-model values not stated | same page |
| Unit | Not stated | same page |
| Matching | Exact prefix. Put static content (system prompt, tool definitions, few-shot examples) first and variable content last. Changes to cached sections, including `tool_choice` and image use, invalidate the cache | same page |
| Lifetime | Held in volatile memory only; expires after 2 hours without use (the page also says "a few hours") | same page |
| Reliability | Hits are not guaranteed | same page |
| Price | Cached input tokens get a 50% discount, only on successful hits. Batch requests already get 50%; the two do not stack | same page |
| Rate limits | Cached tokens do not count toward rate limits, but they are subtracted after processing, so large parallel requests can still hit limits | same page, https://console.groq.com/docs/rate-limits |
| Usage fields | `usage.prompt_tokens` (total input) and `usage.prompt_tokens_details.cached_tokens` (served from cache). Hit rate is `cached_tokens` / `prompt_tokens` | same page |
| Privacy | Prompts and responses are not written to persistent storage or shared between organizations | same page |

## Generation features (docs, checked 2026-11-27)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| Output limit | `max_completion_tokens`; `max_tokens` is deprecated. Input and output together are bounded by the context length | https://console.groq.com/docs/api-reference#chat-create |
| Default output limit | The reasoning page says the `max_completion_tokens` default is 1024 and may be too low for complex reasoning. The API reference excerpt read does not state a default | https://console.groq.com/docs/reasoning |
| Reasoning tokens vs the limit | The reasoning page does not state whether reasoning tokens count toward `max_completion_tokens` or billing | https://console.groq.com/docs/reasoning |
| Max completion tokens per model | `openai/gpt-oss-120b` and `openai/gpt-oss-20b` 65,536 (context 131,072); `openai/gpt-oss-safeguard-20b` 65,536; `qwen/qwen3.8-27b` 16,384; `llama-3.3-70b-versatile` 32,768; `llama-3.1-8b-instant` 131,072 (but see deprecations below) | https://console.groq.com/docs/models |
| `finish_reason` | Values are not listed: the API reference example shows only `"stop"`. `length` is not documented on the pages read | https://console.groq.com/docs/api-reference#chat-create |
| `n` | Only `n=1`; other values return 400 | https://console.groq.com/docs/api-reference#chat-create, https://console.groq.com/docs/openai |
| Usage fields | The example response shows `queue_time`, `prompt_tokens`, `prompt_time`, `completion_tokens`, `completion_time`, `total_tokens`, `total_time`; none of the timing fields is defined in text. The response schema names `usage_breakdown`, "Detailed usage breakdown by model when multiple models are used in the request for compound AI systems" | https://console.groq.com/docs/api-reference#chat-create |
| Unsupported parameters | `logprobs`, `top_logprobs`, `logit_bias`, `messages[].name` "will result in a 400 error" (OpenAI page). The API reference says "This is not yet supported by any of our models" for `logprobs`, `logit_bias`, `frequency_penalty` and `presence_penalty`, and "This parameter is not currently supported" for `metadata` and `store`, without saying whether they error | https://console.groq.com/docs/openai, https://console.groq.com/docs/api-reference#chat-create |
| `temperature` | A value of 0 is converted to `1e-8` | https://console.groq.com/docs/openai |
| Structured outputs | `response_format` `json_schema` (supported models only, preferred) or `json_object` | https://console.groq.com/docs/api-reference#chat-create |
| Service tiers | Request `service_tier`: `auto`, `on_demand` (default), `flex`, `performance`, `null` | https://console.groq.com/docs/api-reference#chat-create |
| Flex processing | `service_tier: "flex"`; priced like on-demand; paid customers only; limits 10x on-demand; when capacity is missing, requests fail fast with 498 `capacity_exceeded`; advice: jittered backoff and retries | https://console.groq.com/docs/flex-processing |
| Batch API | 50% below synchronous pricing, and "All batch tokens are billed at the 50% batch rate regardless of cache status" (no stacking with caching). Completion window `24h` to `7d`. Files API: 50,000 lines and 200 MB per `.jsonl`. Endpoints `/v1/chat/completions`, `/v1/audio/transcriptions`, `/v1/audio/translations`, POST only. Chat models: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `meta-llama/llama-guard-4-12b`. Batch rate limits are separate. Data kept up to 30 days | https://console.groq.com/docs/batch |
| Prices (per 1M tokens) | `openai/gpt-oss-120b` $0.15 input, $0.60 output; `openai/gpt-oss-20b` and `openai/gpt-oss-safeguard-20b` $0.075 input, $0.30 output; `qwen/qwen3.8-27b` $0.80 input, $4.00 output | https://console.groq.com/docs/models |
| Client disconnect | Not stated on the pages read (a 499 "Request Cancelled" code appears in the errors page, no billing rule) | https://console.groq.com/docs/errors |

## Reasoning controls (docs, checked 2026-11-27)

| Fact | Value | Source |
|---|---|---|
| Reasoning models listed | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `openai/gpt-oss-safeguard-20b`, `qwen/qwen3.8-27b`, `minimaxai/minimax-m2.7`, `meta-models/muse-spark-open` | https://console.groq.com/docs/reasoning |
| `reasoning_effort`, gpt-oss 20b and 120b | `low`, `medium`, `high`. The API reference says "'medium' is the default value"; the reasoning page does not state the gpt-oss default (its general parameter table lists `default` as the default) | https://console.groq.com/docs/reasoning, https://console.groq.com/docs/api-reference#chat-create |
| `reasoning_effort`, `qwen/qwen3.8-27b` | Reasoning page: `none`, `default`, `low`, `medium`, `high`; `none` disables reasoning; at `default` reasoning tokens are not returned. API reference: qwen3 models "support `none` to disable reasoning and `default` or null to use the model default"; qwen/qwen3.8-27b "additionally supports `low`, `medium`, and `high`. Its default is `none`; `high` selects the model's native `xhigh` mode." The pages agree on the values but the reference names the default `none`, so check on a live call | same pages |
| `reasoning_effort`, `meta-models/muse-spark-open` | `low`, `medium`, `high`, `xhigh`; `none` not supported (always reasons); default `xhigh` | https://console.groq.com/docs/reasoning |
| `reasoning_effort`, safeguard and minimax | Options not listed on the reasoning page | https://console.groq.com/docs/reasoning |
| `reasoning_format` | `parsed` (reasoning in `message.reasoning`), `raw` (inside `<think>` tags in content), `hidden` (final answer only). Table default `raw`; with JSON mode or tool use, `raw` returns 400 (use `parsed` or `hidden`). Not supported for `openai/gpt-oss-20b` and `openai/gpt-oss-120b` (the page does not say for safeguard) | https://console.groq.com/docs/reasoning |
| `include_reasoning` | `true` (reasoning in `message.reasoning`) "is the default behavior"; `false` drops reasoning; mutually exclusive with `reasoning_format`. Described for all reasoning models and again in the gpt-oss section | https://console.groq.com/docs/reasoning |
| Unsupported values | "Values outside a model's supported set are rejected with a 400" (`reasoning_effort`) | https://console.groq.com/docs/api-reference#chat-create |

## Errors and rate limits (docs, checked 2026-11-27)

| Fact | Value | Source |
|---|---|---|
| 400, 401, 403, 404, 413 | Fix the request, credentials, permissions or size; no retry guidance | https://console.groq.com/docs/errors |
| 422 | Semantic error or model hallucination; "verify the data ... or retry your request" | same page |
| 424 | Failed dependency (for example remote MCP authentication); no retry guidance | same page |
| 429 | Too many requests: "Implement request throttling and respect rate limits"; `retry-after` header (seconds) is set only on a 429 | https://console.groq.com/docs/errors, https://console.groq.com/docs/rate-limits |
| 498 | Flex tier capacity exceeded, request not processed; "try again later" | https://console.groq.com/docs/errors |
| 499 | Request cancelled by the caller; no retry guidance | same page |
| 500, 502, 503 | Retry later (503: wait before retrying). Server errors are not charged | same page |
| Limit types | RPM, RPD, TPM, TPD, ASH, ASD, ITPM, OTPM, per organization; whichever is hit first | https://console.groq.com/docs/rate-limits |
| Headers | `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests` (daily requests); `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens` (per-minute tokens); always sent. `retry-after` only on 429 | same page |
| Numeric limits | The page gives base Developer plan limits per model and says "there may be exceptions"; exact limits are on the account Limits page. Example: `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` 30 RPM, 1K RPD, 8K TPM, 200K TPD; `openai/gpt-oss-safeguard-20b` 3 RPM, 1K RPD, 2K TPM, 200K TPD. The models page shows different Developer plan figures (for example 250K TPM and 1K RPM for `openai/gpt-oss-120b`), so the two pages disagree | same page, https://console.groq.com/docs/models |

## Models and discontinuations (docs, checked 2026-11-27)

- `https://console.groq.com/docs/models` lists as production: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` (the last two marked Enterprise, contact sales). Preview chat models: `qwen/qwen3.8-27b`, `openai/gpt-oss-safeguard-20b`, `meta-models/muse-spark-open` and `minimaxai/minimax-m2.7` (the last two marked Enterprise, contact sales). Preview models "may be discontinued at short notice".
- Conflict between pages: the deprecations page (https://console.groq.com/docs/deprecations) gives shutdown 08/16/26 for `llama-3.1-8b-instant` (replacement `openai/gpt-oss-20b`) and `llama-3.3-70b-versatile` (replacement `openai/gpt-oss-120b` or `qwen/qwen3.6-27b`), a date already past on 2026-11-27, yet the models page still lists them as Enterprise production. An app on these ids should check with Groq.
- Other 2026 shutdowns on the deprecations page: `qwen/qwen3-32b` and `meta-llama/llama-4-scout-17b-16e-instruct` 07/17/26 (replacements `openai/gpt-oss-120b` for qwen3-32b, and `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` for llama-4-scout); `qwen/qwen3.6-27b` 09/14/26 (replacement `qwen/qwen3.8-27b`); `groq/compound` and `groq/compound-mini` 09/21/26 (no replacement listed); `moonshotai/kimi-k2-instruct-0905` 04/15/26; `meta-llama/llama-4-maverick-17b-128e-instruct` 03/09/26; `meta-llama/llama-guard-4-12b` 03/05/26 (replacement `openai/gpt-oss-safeguard-20b`, yet the batch page still lists llama-guard-4-12b).
- `deepseek-r1-distill-llama-70b` was shut down 10/02/25.

## Not stated in the docs read

- The default `reasoning_effort` for gpt-oss on the reasoning page (the API reference says `medium`).
- Whether reasoning tokens count against `max_completion_tokens`.
- The full list of `finish_reason` values, including `length`.
- Per-model cache minimums, the cache unit size, and whether cached tokens appear in streaming usage.
- Exact per-account rate limits (the page gives base Developer plan figures only, and the models page disagrees with them).
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
