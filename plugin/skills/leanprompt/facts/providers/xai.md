---
provider: xai
checked: 2026-11-27
source: https://docs.x.ai/developers/advanced-api-usage/prompt-caching/how-it-works.md
cache:
  mode: automatic
  min_tokens: 0
  ttl_seconds: 0
---

# xAI (Grok)

Status: documented, not measured here. Facts from xAI's official docs (docs.x.ai), each checked against the raw page text (the `.md` source of each page) on 2026-11-27. Quoted phrases are the page's own words.

The frontmatter `cache:` block says `min_tokens: 0` and `ttl_seconds: 0` because the docs state neither a minimum prompt size nor a lifetime. Zero here means "not stated", not "no minimum". The docs say entries "can be evicted at any time due to server load or restarts", so an auditor should assume no guaranteed lifetime. The best-practices page says caching "is available on all `grok` language models".

## Caching

| Fact | Value | Source |
|---|---|---|
| Mode | Automatic in effect: "The full prompt is processed and cached" on the first request, with no switch to turn it on. The page does not use the word automatic. Matching is on the prefix of the `messages` array from the start | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/how-it-works.md |
| Models | "Prompt caching is available on all `grok` language models." Cached prices per model are on the pricing page | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices.md |
| Minimum | Not stated on the caching pages read (how-it-works, maximizing-cache-hits, best-practices) | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits.md |
| Lifetime | No duration stated. "Cache entries can be evicted at any time due to server load or restarts." "Prompt caching is not 100% guaranteed" (how-it-works page) | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices.md |
| Routing | Body field `prompt_cache_key` "routes requests with the same key to the same server"; entries are stored per server. The HTTP header `x-grok-conv-id` "functions identically". If both are set, `prompt_cache_key` wins. gRPC: pass `x-grok-conv-id` as metadata. Setting it is advised "to maximize retention" | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits.md |
| What breaks the cache | A change to an earlier message breaks the cache from that message onward (edit, remove, reorder, or swapping system and user). Only append. On reasoning models, dropping an earlier turn's reasoning limits the match to that turn; on Responses, send back reasoning items with `include: ["reasoning.encrypted_content"]` or use `previous_response_id`. Tool-definition order is not addressed on the page | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/multi-turn.md |
| Usage fields | Chat Completions `usage.prompt_tokens_details.cached_tokens`; Responses `usage.input_tokens_details.cached_tokens` | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing.md |
| Billing | Cached prompt tokens at "the cached prompt token price"; rates "vary by model". Cached tokens still count toward the tokens-per-minute limit | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing.md, https://docs.x.ai/developers/rate-limits.md |
| Chat Completions key | `prompt_cache_key`: "A stable cache key for best-effort sticky routing / prompt-cache hits", "Plumbed to `x-grok-conv-id`" | https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md |
| Responses key | `prompt_cache_key` "Plumbed to x-grok-conv-id for Open Responses compatibility, used for routing." The response object also carries `prompt_cache_key` ("The cache key used for the prompt for routing to the correct engine") | https://docs.x.ai/developers/rest-api-reference/inference/responses.md |

## Models and prices (read 2026-11-27, USD per 1M tokens)

At or above 200k prompt tokens the higher rate applies to all tokens of the request.

| Model | Context | Input (under / over 200k) | Cached input | Output | Source |
|---|---|---|---|---|---|
| `grok-4.7`, `grok-4.6` | 500k | $2.00 / $4.00 | $0.50 / $1.00 | $6.00 / $12.00 | https://docs.x.ai/developers/pricing.md |
| `grok-4.5` | 500k | $2.00 / $4.00 | $0.30 / $0.60 | $6.00 / $12.00 | https://docs.x.ai/developers/pricing.md |
| `grok-4.3` | 1M | $1.25 / $2.50 | $0.20 / $0.40 | $2.50 / $5.00 | https://docs.x.ai/developers/pricing.md |
| `grok-4.20-0309-reasoning`, `-non-reasoning`, `grok-4.20-multi-agent-0309` | 1M | $1.25 / $2.50 | $0.20 / $0.40 | $2.50 / $5.00 | https://docs.x.ai/developers/pricing.md |

Max output tokens per model are not listed on the models page (https://docs.x.ai/developers/models.md).

## Generation features (docs, checked 2026-11-27)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `n` | Chat Completions: several choices per input; "Keep n as 1 to minimize costs"; generated tokens are billed across all choices. No `n` seen for Responses | https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md |
| Output limit | Chat Completions `max_completion_tokens` (default 128,000 when unset); `max_tokens` is deprecated. Responses `max_output_tokens` (default 128,000). Both "only apply to visible output tokens (i.e. does not apply to tokens used for reasoning or function calls)", so reasoning does NOT count against the cap, unlike OpenAI | https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md, https://docs.x.ai/developers/rest-api-reference/inference/responses.md |
| Truncation signal | Chat Completions `finish_reason`: `stop`, `length` ("the maximum token limit was reached"), `end_turn`; `null` on non-final stream chunks. Responses `status`: `completed`, `in_progress`, `incomplete` (`incomplete_details` has no description on the page) | same pages |
| Reasoning tokens | `completion_tokens_details.reasoning_tokens`; billed "as part of your total consumption", at the full completion price | https://docs.x.ai/developers/model-capabilities/text/reasoning.md, https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing.md |
| `reasoning_effort` | Values `none`, `low`, `medium`, `high`, `xhigh`. Defaults: `high` on grok-4.7, grok-4.6, grok-4.5; `low` on grok-4.3. Only grok-4.3 accepts `none`; on the others a request with `none` "returns a `400` error". `xhigh` on grok-4.6 and later; on grok-4.5 it is treated as `high`. The reasoning page's summary table lists grok-4.3 as `none`, `low`, `medium` only, while the retirement page says grok-4.3 has "4 reasoning effort levels (none, low, medium, and high)". On grok-4.20-multi-agent it sets the number of agents ("4 or 16"), not depth. Responses takes `reasoning.effort`; a top-level `reasoning_effort` is read "only if the reasoning field is unset" | https://docs.x.ai/developers/model-capabilities/text/reasoning.md, https://docs.x.ai/developers/rest-api-reference/inference/responses.md |
| Parameters reasoning models reject | "`presence_penalty` and `frequency_penalty` are not supported by current Grok models, and `stop` is not supported by reasoning models. On the Chat Completions API, a request that sets one of them returns a `400` error. The Responses API accepts all three but ignores them." `logit_bias` is marked unsupported. `logprobs` and `top_logprobs` "will be silently ignored" on grok-4.20 and newer | https://docs.x.ai/developers/model-capabilities/text/reasoning.md, https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md, https://docs.x.ai/developers/models.md |
| Batch API | 20% off standard rates for grok-4.7, 4.6, 4.5, 4.3 and the three grok-4.20 models, covering input, output, cached and reasoning tokens; batch requests do not count toward rate limits. Most batches finish within 24 hours, best effort. Endpoints `/v1/chat/completions` and `/v1/responses` (plus image and video). File up to 200 MB and 50,000 requests; 25 MB per request. The batch page does not mention caching | https://docs.x.ai/developers/pricing.md, https://docs.x.ai/developers/advanced-api-usage/batch-api.md |
| Errors | 400, 401, 403, 404, 405, 415, 422, 429 (rate limit), plus 202 for a deferred completion not yet ready. The page does NOT say which are retryable and documents no response headers | https://docs.x.ai/developers/debugging.md |
| Rate limits | Per model and tier: requests per second and tokens per minute (prompt, completion, reasoning and cached tokens all count). Exceeding returns 429; advice is exponential backoff (example: up to 5 retries, wait 2^attempt seconds). No rate-limit headers documented. Tiers 0 to 4 and Enterprise by cumulative spend ($0, $50, $250, $1,000, $5,000) since 2026-01-01 | https://docs.x.ai/developers/rate-limits.md |
| Stored responses | Responses API stores new responses for 30 days; `store` default not stated | https://docs.x.ai/developers/rest-api-reference/inference/responses.md |

## Retired model ids (read 2026-11-27)

Retired 2026-05-15 at 12:00 PM PT. The old ids still resolve and are redirected, billed at grok-4.3 prices ($1.25 input, $2.50 output per 1M). An app that kept an old id therefore silently runs grok-4.3 (or grok-build-0.1 for the old code model), at the effort below.

| Old id | Redirected to | Source |
|---|---|---|
| `grok-4-1-fast-reasoning`, `grok-4-fast-reasoning`, `grok-4-0709` | grok-4.3 at low effort | https://docs.x.ai/developers/migration/may-15-retirement.md |
| `grok-4-1-fast-non-reasoning`, `grok-4-fast-non-reasoning`, `grok-3` | grok-4.3 at none effort | https://docs.x.ai/developers/migration/may-15-retirement.md |
| `grok-code-fast-1` | `grok-build-0.1` | https://docs.x.ai/developers/migration/may-15-retirement.md |

## Not stated on the pages read

- Caching: minimum prompt size, any lifetime, and cache write cost (checked 2026-11-27).
- Which error codes are retryable, and any `Retry-After` or rate-limit headers.
- Max output tokens per model; whether `n` exists on Responses.
- Not read: troubleshooting-reasoning, cost-tracking, and the legacy API page.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
