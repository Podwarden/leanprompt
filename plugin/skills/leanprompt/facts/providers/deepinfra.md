---
provider: deepinfra
checked: 2026-11-26
source: https://docs.deepinfra.com/chat/prompt-caching.md
cache:
  mode: automatic
  min_tokens: 0
  step_tokens: 64
  ttl_seconds: 300
---

# DeepInfra

Status: documented, and the 64-token step measured in E2 (DeepSeek-class model; 96% or 95% token agreement with kvsig ids; reported cached tokens in multiples of 64). E3: after one deferred tool was appended to the tool list, DeepInfra cached 10,176 of 21,149 tokens.

## Facts

| Fact | Value | Basis |
|---|---|---|
| Mode | automatic, no parameters; keep the prefix identical and stable content first | docs |
| Render order (system vs tools) | Observed 2026-11-21 in the replay test (E3 source): when only the tool list changed, the system-prompt part stayed cached, consistent with system rendered before tools. After one deferred tool was appended, 10,176 of 21,149 tokens were still cached (E3). DeepInfra's docs do not state the order (checked 2026-11-26) | observed (E3) |
| Models | "supported models, check the model page"; the docs do not list them | docs |
| Step | 64 tokens | E2 (not stated in the docs, checked 2026-11-26) |
| Minimum | none observed in E2 (`min_tokens: 0`); not stated in the docs (checked 2026-11-26) | E2 |
| `prompt_cache_key` | optional string, shares a cache across requests with slightly different prompts; pass through `extra_body` in the Python SDK | docs |
| Usage field | `usage.prompt_tokens_details.cached_tokens` | docs |
| Price | cached input "billed at a reduced rate"; no multiplier stated | docs |

## Lifetime

- Default entries "expire after a period of inactivity"; no duration is stated in the docs (checked 2026-11-26). `ttl_seconds: 300` in the frontmatter is the shortest documented retention option, used as a conservative planning floor. It is not a stated default.
- Optional retention (https://docs.deepinfra.com/chat/prompt-cache-retention.md): `prompt_cache_options.mode: "explicit"`, `ttl` of `"5m"` or `"1h"`, `prompt_cache_breakpoint: {"mode": "explicit"}` on a content part, and a required `prompt_cache_key`. Writes cost 1.25x (5 minutes) or 2.0x (1 hour); reads are at the model's cache-read rate (0.2x for Nemotron-3-Ultra). Documented for `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B` and `moonshotai/Kimi-K2.7-Code` only. Default values are not stated; granularity 8,192 tokens is stated for Nemotron-3-Ultra only. Not measured here.

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | OpenAI-compatible chat completions: `n` from 1 to 4, default 1 ("number of sequences to return") | https://docs.deepinfra.com/api-reference/chat-completions/openai-chat-completions.md |
| Output limit | `max_tokens` | same page |
| Service tiers | `service_tier`: `default`, `priority`, `flex` (`auto` treated as `priority`, `standard_only` as `default`). Prices: not on that page | same page |
| Predicted outputs | `prediction` not listed | same page |
| Batch API | "billed at 20% less than the corresponding real-time price"; within 24 hours; `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings` (`/v1/responses` rejected); 50,000 requests and 200 MB per file; one model per file; does not count against real-time rate limits | https://docs.deepinfra.com/batch/introduction.md |
| Structured outputs | `response_format` `json_object` (valid JSON, shape not controlled) or `json_schema` with `strict` ("The model is constrained to produce only values that match your schema"); on "many of our models". The page warns that a `max_tokens` or `length` stop can leave the JSON incomplete | https://docs.deepinfra.com/chat/structured-outputs.md |
| Client disconnect | Not stated in DeepInfra's docs read. OpenRouter lists DeepInfra among providers whose streams stop on abort (`providers/openrouter.md`) | OpenRouter streaming docs |
<!-- leanprompt:generated v0.1.0-dev.14: written by leanprompt install; leanprompt update replaces local edits -->
