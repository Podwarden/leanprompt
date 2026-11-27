---
provider: openai
checked: 2026-11-26
source: https://developers.openai.com/api/docs/guides/prompt-caching
cache:
  mode: automatic
  min_tokens: 1024
  step_tokens: 128
  ttl_seconds: 300
---

# OpenAI

Status: documented, and the 1,024 minimum and 128-token steps measured in E2 (95% and 96% token agreement between kvsig prefix ids and reported `cached_tokens`).

`ttl_seconds: 300` is the shortest documented lifetime (the 5-minute lower bound of the `in_memory` range for earlier models), chosen on purpose as the conservative cap. It is not the default. Defaults: earlier models, organizations without Zero Data Retention (ZDR) default to `24h` retention and ZDR organizations to `in_memory`; GPT-5.6 and later default to a 30-minute minimum lifetime (1,800 seconds).

## Automatic caching

| Fact | Value | Basis |
|---|---|---|
| Minimum | 1,024 visible input tokens (hidden system tokens do not count). The docs state this for GPT-5.6 and later; for earlier models they say the minimum "varies by request settings" (tools, images, output schemas, reasoning effort, verbosity). OpenRouter's docs also say 1,024. | docs; measured E2 |
| Granularity | Reported `cached_tokens` are 1,024 plus multiples of 128 | E2; docs say rounded down to a multiple of 128 for earlier models |
| Implicit breakpoints | GPT-5.6 and later: end of the latest eligible message. GPT-5.5 and 5.5 Pro: every 2,048 tokens. Other earlier models: regular, model-dependent intervals | docs |
| Lifetime, earlier models (`prompt_cache_retention`) | `in_memory`: typically around 5 to 10 minutes of inactivity, up to one hour. `24h`: typically around 30 minutes, retained up to 24 hours. Default: organizations without ZDR default to `24h`; organizations with ZDR default to `in_memory`. The frontmatter uses 300 s, the shortest figure (lower bound of the `in_memory` range), not the default | docs |
| Lifetime, GPT-5.6 and later | `prompt_cache_options.ttl` of `"30m"` (default, minimum 30 minutes; omitting the setting keeps it) or `"12h"` (minimum 12 hours) | docs |
| Routing key | `prompt_cache_key`. Before GPT-5.6, use a stable key per related group; the docs suggest about 15 requests per minute per key and prefix group. From GPT-5.6 routing is automatic and the key is optional (separate cache accounting). Keys influence routing; they do not guarantee a hit | docs |
| Render order (system vs tools) | Observed 2026-11-21 in the replay test (internal report, not public): when only the tool list changed, the system-prompt part stayed cached, consistent with system rendered before tools. Not stated in OpenAI's docs (checked 2026-11-26) | observed 2026-11-21 (internal report) |
| What must match | The entire rendered prefix up to a breakpoint, including relevant request settings | docs |
| Usage fields | `usage.input_tokens_details.cached_tokens` (Responses); `prompt_tokens_details.cached_tokens` (Chat Completions, as seen through OpenRouter) | docs; OpenRouter docs |
| Total input | Cached tokens are part of the input count, not added to it. Chat Completions: `prompt_tokens` is the "Number of tokens in the prompt" and `prompt_tokens_details.cached_tokens` the "Cached tokens present in the prompt"; `prompt_tokens_details.cache_write_tokens` is "The unadjusted number of prompt tokens written to cache". Responses: the caching guide's example gives ordinary input as `input_tokens - cached_tokens - cache_write_tokens` and says "Do not add `cache_write_tokens` again after counting its two components". So a meter adds nothing to `prompt_tokens`; it prices the cached and written parts at their own rates (read 2026-11-26) | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create, https://developers.openai.com/api/docs/guides/prompt-caching |

## Explicit breakpoints (GPT-5.6 and later only)

- Set `prompt_cache_options.mode` to `"explicit"` and add `prompt_cache_breakpoint: {"mode": "explicit"}` to a content block of an input message. Up to four cache writes per request. Top-level `instructions` cannot carry a breakpoint.
- Writes cost 1.25x input with the 30-minute TTL and 2.5x with the 12-hour TTL; before GPT-5.6 writes are free; reads are 0.25x or 0.50x input depending on the model. (OpenRouter's per-provider notes, checked 2026-11-26; the OpenAI page read for this table does not state prices.)

## Tool limits observed here

- `tool_choice: "none"` drops the tool definitions from the rendered prompt (observed 2026-11-21 via OpenRouter: `prompt_tokens` halved). A change of `tool_choice` between turns therefore changes the prefix.
- At most 128 tools per request; a request with 232 tools was rejected (observed 2026-11-21 via OpenRouter).

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules. Prices are relative; the price card is on OpenAI's pricing page.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | Chat Completions: "How many chat completion choices to generate for each input message"; "Newer models reject an explicit `n`, even `n=1`"; generated tokens are billed across all choices. Responses API: no `n` in the body parameters | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create, https://developers.openai.com/api/reference/resources/responses/methods/create |
| Output limit | Chat Completions `max_completion_tokens` (`max_tokens` is deprecated); Responses `max_output_tokens`. Both include reasoning tokens | same pages |
| Truncation signal | Chat Completions `finish_reason: "length"`; Responses `status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"` | same pages |
| Usage fields | `usage.completion_tokens` (Chat Completions), `usage.output_tokens` (Responses); with streaming, `stream_options.include_usage` adds a final usage chunk | same pages |
| Batch API | 50% discount compared to synchronous APIs; completion window `24h` only; up to 50,000 requests and 200 MB per input file; `/v1/responses` and `/v1/chat/completions` among the endpoints. The page does not mention prompt caching inside a batch | https://developers.openai.com/api/docs/guides/batch |
| Flex processing | `service_tier: "flex"`: slower, occasionally unavailable, "Tokens are priced at Batch API rates". Unavailable on GPT-6.2 Astra and GPT-6.2 Sol and not added to future models. Out of capacity returns `429 Resource Unavailable`, not charged | https://developers.openai.com/api/docs/guides/flex-processing |
| Service tiers | `service_tier`: `auto`, `default`, `flex`, `scale`, `priority`, `fast` | Chat Completions reference |
| Predicted outputs | Chat Completions `prediction: {type: "content", content: ...}`, on `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`. Rejected prediction tokens are billed as completion tokens (`rejected_prediction_tokens` in `usage`). Not supported with `n` > 1, `logprobs`, tools, `audio`, `max_completion_tokens`, and presence or frequency penalties above 0. The page does not mention the Responses API or reasoning models | https://developers.openai.com/api/docs/guides/predicted-outputs |
| Structured outputs | Responses `text.format: {type: "json_schema", strict: true, schema}`; Chat Completions `response_format` with `json_schema`. "Only Structured Outputs ensure schema adherence" (JSON mode only ensures valid JSON). Refusals come back in a `refusal` field. The first request with a new schema has extra latency | https://developers.openai.com/api/docs/guides/structured-outputs (first 100,000 of 152,792 characters read) |
| Truncation as an exception | Python SDK structured helpers (`client.chat.completions.parse()`, `.stream()`): "If the completion completes with `finish_reason` set to `length` or `content_filter`, the `LengthFinishReasonError` / `ContentFilterFinishReasonError` errors will be raised." Both are `OpenAIError` subclasses, not HTTP status errors, so a filter written for status codes does not see them | https://github.com/openai/openai-python/blob/main/helpers.md, https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py |
| SDK timeout and retries | Python SDK: default timeout 10 minutes; connection errors, 408, 409, 429 and 5xx retried 2 times with short exponential backoff; timed-out requests are retried twice by default | https://github.com/openai/openai-python/blob/main/README.md |
| SDK timeout and retries, Node | Node SDK (`openai` on npm): "Certain errors will be automatically retried 2 times by default, with a short exponential backoff": connection errors, 408, 409, 429 and 500 and above. `maxRetries` on the client or per request (default 2, `0` disables). Default timeout 10 minutes, set with `timeout` in milliseconds; a timeout throws `APIConnectionTimeoutError`, and "requests which time out will be retried twice by default" (read 2026-11-26). So one call with the defaults can be sent three times, and an app-level retry around it multiplies that | https://github.com/openai/openai-node/blob/master/README.md |
| Errors | 401 invalid authentication and 403 unsupported region: fix, not retry. 500: retry after a brief wait. 429 rate limit and 503 overloaded: retry, following `Retry-After`. 429 for exhausted credit, spend or usage limits: do not retry | https://developers.openai.com/api/docs/guides/error-codes |
| Client disconnect | Whether closing the connection stops generation and billing on a direct OpenAI call: not stated on the pages above. Through OpenRouter, OpenAI is listed among providers whose streams stop on abort (`providers/openrouter.md`) | not stated (checked 2026-11-26) |

## GPT-5.4 family (model pages, read 2026-11-26)

| Model | Reasoning effort | Default effort | Context, max output | Price per 1M tokens (input, cached input, output) | Source |
|---|---|---|---|---|---|
| `gpt-5.4` | `none`, `low`, `medium`, `high`, `xhigh` | `none` ("Reasoning.effort supports: none (default), low, medium, high and xhigh") | 1,050,000 context, 128,000 output | $2.50, $0.25, $15 | https://developers.openai.com/api/docs/models/gpt-5.4 |
| `gpt-5.4-mini` | `none`, `low`, `medium`, `high`, `xhigh` | `none` | 400,000 context, 128,000 output | $0.75, $0.075, $4.50 | https://developers.openai.com/api/docs/models/gpt-5.4-mini |

A request that sends no effort to these models does no reasoning; an app that hard-codes an effort above `none` opts into reasoning tokens on every call, billed as output. For the same models on Azure, see [azure-openai.md](azure-openai.md).

## Prompt size facts (docs, checked 2026-11-26)

Used by the `prompt-diet` rules.

| Fact | Value | Source |
|---|---|---|
| Function definitions are input | "callable function definitions count against the model's context limit and are billed as input tokens"; the guide advises keeping the number of functions available at the start of a turn small, and deferring rarely used ones with tool search | https://developers.openai.com/api/docs/guides/function-calling |
| A subset of tools per call, cache kept | `tool_choice: {"type": "allowed_tools", "mode": "auto", "tools": [...]}` limits which of the supplied tools the model may call "but not modify the list of tools you pass in, so you can maximize savings from prompt caching" | same page |
| Tool definitions are in the cached prefix | The cacheable prefix "can include OpenAI-provided instructions, developer messages, tool definitions"; changing tool names, descriptions, schemas or order breaks reuse. The page advises `allowed_tools`, or `tool_choice: "none"`, instead of removing tool definitions. Observed here (above): `"none"` dropped the definitions from `prompt_tokens` through OpenRouter, so prefer `allowed_tools` and verify | https://developers.openai.com/api/docs/guides/prompt-caching |

## Not stated in the docs

- Cached-token price multiplier for the current model list: the caching guide says reads cost "0.1× the ordinary input rate on most of these models" (0.05x on GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Sol and GPT-6.1 Terra) and writes 1.25x for the 30-minute lifetime, 2.5x for 12 hours (read 2026-11-26). The GPT-5.4 model pages list cached input at a tenth of input (above). Other models: read the model's own page.
