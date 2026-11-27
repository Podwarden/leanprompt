---
provider: openrouter
checked: 2026-11-26
source: https://openrouter.ai/docs/features/prompt-caching
cache:
  mode: automatic
  min_tokens: 1024
  ttl_seconds: 300
---

# OpenRouter (a router, not a cache)

Status: documented. Marker behaviour through OpenRouter measured in E1 (0 tokens cached on 29 turns of sessions that send no `cache_control`, on an Anthropic model; the Claude Code sessions that set 3 breakpoints matched kvsig at 100% and 97%). The DESIGN addition of 2026-11-22 records the same test as 0% cached without marks vs 92% with them.

OpenRouter holds no cache of its own. The frontmatter `cache:` block is a conservative floor for planning (the lowest automatic-cache minimum and the shortest lifetime among the providers it routes to, chosen on purpose; it is not a default); the real values are those of the routed provider in `providers/<name>.md`. Anthropic models need markers whatever the route.

## Pinning and routing

- Default load balancing: "Providers close to the best share most of the traffic, and each request picks one at random, weighted by those shares" (provider routing docs, https://openrouter.ai/docs/features/provider-routing). The docs say follow-up requests in a conversation stay with the same provider while its prompt cache is warm.
- Pin with `provider.order` (a list of provider slugs tried in order) and `provider.only` (allow list). `allow_fallbacks` defaults to `true`; set it to `false` to stop backup providers taking a request. Without `order`, a disabled fallback means the top-ranked provider serves the request.
- Sticky routing (prompt-caching docs): expires after 60 minutes of inactivity, each success resets the timer. It applies only when the provider's cache read price is below its regular prompt price, and it is skipped when `provider.order` is set. Without `session_id` requests are grouped by hashing the first system or developer message and the first non-system message. `session_id` (body or `x-session-id` header, max 256 characters) starts stickiness on any success; without it stickiness starts only after a cache hit.

## Marker pass-through (docs, checked 2026-11-26)

- A `cache_control` marker on a text block becomes `prompt_cache_breakpoint` when routed to a supporting OpenAI model.
- A `prompt_cache_breakpoint` becomes a default 5-minute `cache_control` on Anthropic or Google.
- TTLs are not translated: a `cache_control` TTL is dropped for OpenAI, a `prompt_cache_breakpoint` TTL is dropped for Anthropic or Google.
- Gemini: multiple breakpoints are accepted, only the last is used.
- Qwen via Alibaba: explicit only, `cache_control: {"type": "ephemeral"}`, 5-minute TTL; snapshot endpoints do not support it.

## Usage accounting

- `prompt_tokens_details.cached_tokens` (read) and `cache_write_tokens` (written), plus `cache_discount`. The same data is on the Activity page and in `/api/v1/generation`.
- A cancelled stream usually gets no cache discount because the provider's final usage never arrives.

## Per-provider notes as OpenRouter states them

Re-read on the prompt-caching page on 2026-11-26; every cell below is stated there unless marked otherwise.

| Provider | Caching | Read price | Note |
|---|---|---|---|
| OpenAI | automatic, minimum 1,024 tokens | 0.25x or 0.50x | writes free before GPT-5.6 |
| Anthropic | markers, 5 min or 1 hour | 0.1x | 4 breakpoints; per-model minimums in `providers/anthropic.md` |
| Gemini | implicit, 2.5 series and newer | 0.25x | implicit TTL about 3-5 minutes; minimums 1,024 (2.5 Flash) and 4,096 (2.5 Pro) as OpenRouter states them, which differs from Google's own page (2,048 for both); `providers/gemini.md` follows Google's page |
| DeepSeek, Grok, Moonshot | automatic | 0.1x, 0.25x, 0.25x | writes free except DeepSeek (input price) |
| Groq | automatic, Kimi K2 models only | 0.5x | |
| Z.AI | automatic | about 0.2x | pass `session_id` to keep sessions on one cache (OpenRouter derives a session affinity key from it); cached input storage listed as limited-time free |

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules. What a routed request supports depends on the upstream provider; the model page lists its supported parameters.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | Not listed on the parameters page | https://openrouter.ai/docs/api/reference/parameters |
| Output limit | `max_tokens`; "For reasoning models, this limit covers reasoning tokens and visible output together on most providers" | same page |
| Structured outputs | `response_format` with `json_schema` on models with the `structured_outputs` capability | same page |
| Predicted outputs | `prediction` not listed on the parameters page | same page |
| Batch API | `POST /api/v1/batches`, "Typically 50% of the sync per-token price" (each model page has its batch price); within 24 hours on most providers, Google Vertex up to 96 hours; up to 200 MB per batch, inline JSON; one model and one endpoint per batch; text and embeddings only; only models with a batch variant | https://openrouter.ai/docs/guides/features/batch-api |
| Stream cancellation | "Streaming requests can be cancelled by aborting the connection. For supported providers, this immediately stops model processing and billing." "For non-streaming requests or unsupported providers, the model will continue processing and you will be billed for the complete response." Supported include OpenAI, Azure, Anthropic, DeepInfra, DeepSeek, Together, Fireworks, xAI; not supported include AWS Bedrock, Groq, Google, Google AI Studio, Mistral, Alibaba | https://openrouter.ai/docs/api/reference/streaming |
| Usage fields | `usage.completion_tokens`, `finish_reason` (OpenAI-shaped responses) | parameters and API reference pages |

## Not stated in the docs

- Cache TTL on the OpenRouter side: not applicable; only the 60-minute sticky-routing timer is stated (checked 2026-11-26).
- The provider routing page was read to character 100,000 of 132,066; the rest was not read.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
