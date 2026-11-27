---
provider: vercel-ai-gateway
checked: 2026-11-26
source: https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching
cache:
  mode: automatic
  min_tokens: 1024
  ttl_seconds: 300
---

# Vercel AI Gateway (a gateway, not a cache)

Status: documented, not yet measured here. Facts from Vercel's caching page (page last updated 2026-09-11, read 2026-11-26).

AI Gateway holds no prompt cache of its own: the routed provider caches. The frontmatter `cache:` block is a conservative floor for planning (the lowest automatic-cache minimum and the shortest lifetime among the providers it routes to, chosen on purpose; it is not a default); the real values are those of the routed provider in `providers/<name>.md`. AI Gateway is the default provider for a plain string model id in the Vercel AI SDK (`model: "anthropic/claude-sonnet-5"`), so an app on the AI SDK may route through it without naming it.

## Caching

| Fact | Value | Source |
|---|---|---|
| Without the option | "When `caching` is not set, AI Gateway passes your request through without modification. Providers with implicit caching still cache automatically. For Anthropic, you'll need to set `caching: 'auto'` or manually add cache markers to your messages." | https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching |
| The option | `caching: 'auto'`, set as `providerOptions.gateway.caching` (AI SDK, and as an extra body field on the OpenAI- and Anthropic-compatible endpoints) or at the top level of a Responses API request | same page |
| Implicit (no change needed) | OpenAI, Google, DeepSeek | same page, "Provider behavior" |
| Explicit (the option adds marks) | Anthropic (direct, Vertex and Bedrock), MiniMax and Alibaba. "Automatic caching works with Anthropic (direct, Vertex, and Bedrock), MiniMax, and Alibaba." | same page |
| Where the marks go | Two: on the last message, and on the message before the last user message (falling back to the system message). A third with `cache_anchor_items: N` on the Responses API, after the first N input items, only with top-level `caching: 'auto'` | same page, "How it works", "Cache anchor" |
| Lifetime | Anthropic entries expire after five minutes by default; `cache_ttl: '1h'` on the Responses API asks for one hour. `cache_ttl` is ignored when caching is set only through `providerOptions.gateway.caching` | same page, "Cache lifetime" |
| Cost tradeoff | The page says the break-even is a single read; for strictly one-shot traffic it advises manual marks or no caching over `caching: 'auto'` | same page, "Cost tradeoff" |
| Session affinity | Send the same `x-session-affinity` header with related requests to keep a conversation on the provider that holds its cache; it "doesn't guarantee a cache hit" | same page, "Improve cache hits with session affinity" |
| Usage fields | AI SDK: `usage.inputTokenDetails.cacheReadTokens`; Chat Completions: `usage.prompt_tokens_details.cached_tokens`; Messages: `usage.cache_read_input_tokens`; Responses: `usage.input_tokens_details.cached_tokens`. "A zero count can mean a cache miss, an ineligible prompt, or unavailable provider usage details." | same page, "Examples" |
| Restricting to implicit caching | `has: ['implicit-caching']` in model filtering limits routing to models that cache automatically | same page |

## What this means for an audit

- An app that marks only for Anthropic (`providerOptions.anthropic.cacheControl`) and routes some traffic to another explicit-cache provider (Alibaba, MiniMax) gets no cache on that traffic: the gateway passes the request through unchanged. `caching: 'auto'` covers it. Whether the gateway translates provider-keyed Anthropic marks for another provider is not stated on the page (read 2026-11-26).
- On Anthropic, the gateway's two marks come on top of any the app sets; Anthropic allows at most four per request ([anthropic.md](anthropic.md)).

## Not stated in the docs

- Whether `providerOptions.anthropic` cache marks are forwarded to, or translated for, non-Anthropic explicit-cache providers (checked 2026-11-26).
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
