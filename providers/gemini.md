---
provider: gemini
checked: 2026-11-26
source: https://aistudio.google.com/docs/caching
cache:
  mode: automatic
  min_tokens: 4096
  ttl_seconds: 180
---

# Google Gemini

Status: documented, not yet measured here.

`min_tokens: 4096` is the conservative default (the largest implicit-caching minimum listed). `ttl_seconds: 180` is the shortest figure (lower bound of "about 3-5 minutes, varies") from OpenRouter's description of implicit caching, chosen on purpose as the conservative cap; it is not a default stated by Google, whose caching page does not state an implicit TTL (see below).

## Implicit caching (docs, checked 2026-11-26)

| Model | Minimum input tokens |
|---|---|
| Gemini 4 Carbon, Argon, Neon, Hydrogen | 4,096 |
| Gemini 3.8 Flash, 3.6 Flash, 3.1 Pro Preview | 4,096 |
| Gemini 2.5 Flash, 2.5 Pro | 2,048 |

- Hit field: `usage.total_cached_tokens` in the page's SDK examples.
- Multi-turn and agent loops on Gemini 4: "Gemini caches the full previous request only if the new request adds at least 2,050 tokens". Model output, thought and function results count toward that total. For smaller additions, the last 2,050 tokens of the previous request are re-processed at the standard input rate.
- Pricing: the page says savings are passed on automatically and gives no rate. OpenRouter's notes give 0.25x for reads and no write or storage charge on implicit caching, 2.5 series and newer.
- Explicit caching is unsupported in the Interactions API and for Gemini 4 models; on supported Gemini 3 and 2.5 models it is available through `generateContent`.

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `candidateCount` (several samples per request) | "Number of generated responses to return. If unset, this will default to 1"; not for Gemini 1.0 models. No upper limit stated | https://aistudio.google.com/api-reference/generate-content (first 100,000 of 103,138 characters read) |
| Output limit | `maxOutputTokens`; default varies by model (`Model.output_token_limit`) | same page |
| Thinking controls | `thinkingConfig.thinkingBudget` ("The number of thoughts tokens that the model should generate") and `thinkingLevel` (an error on earlier models) | same page |
| Truncation signal | `finishReason: "MAX_TOKENS"` | same page |
| Usage fields | `usageMetadata.candidatesTokenCount` (all candidates), `thoughtsTokenCount` | same page |
| Batch API | "priced at 50% of the standard interactive API cost"; target turnaround 24 hours; inline requests under 20 MB, input file up to 2 GB; "Context caching is supported for batch requests" | https://aistudio.google.com/docs/batch-api |
| Service tiers | The response carries `usageMetadata.serviceTier` (`standard`, `flex`, `priority`). How to request a tier and its price: not on the page read | generateContent reference; not stated (checked 2026-11-26) |
| Predicted outputs | No predicted-output parameter on the generateContent reference read | not stated (checked 2026-11-26) |
| Structured output | `response_format` with a JSON `schema` and `mime_type: application/json` (Interactions API examples); `responseMimeType` / `responseJsonSchema` on generateContent. Output is syntactically valid JSON, but "always validate values in your application"; some constraints (`minLength`, `maxLength`, ...) are stripped, not enforced; a too complex schema returns 400 | https://aistudio.google.com/docs/structured-output |
| Client disconnect | Not stated on the pages above. OpenRouter lists Google and Google AI Studio among providers that keep generating (and billing) after a stream is aborted (`providers/openrouter.md`) | OpenRouter streaming docs |

## Prompt size facts (docs, checked 2026-11-26)

Used by the `prompt-diet` rules.

| Fact | Value | Source |
|---|---|---|
| Function declarations are input | "Every function declaration you send is billed as input tokens on every request"; past a few dozen tools the page suggests retrieving tools instead of sending all of them. It also describes an `allowed_tools` list in `tool_choice`; whether that keeps the implicit cache is not stated | https://aistudio.google.com/docs/function-calling (first 100,000 of 135,989 characters read) |

## Not stated in the docs

- Implicit-caching TTL: not stated in the docs (checked 2026-11-26). The 3-5 minute figure comes from OpenRouter's notes.
- Explicit-caching minimum token count: not stated in the docs (checked 2026-11-26).
- Step or granularity of implicit reuse other than the 2,050-token rule above: not stated in the docs (checked 2026-11-26).
- Through OpenRouter only the last `cache_control` breakpoint is used on Gemini (OpenRouter docs); see `providers/openrouter.md`.
- kvsig cannot identify Gemini's native request dialect, so these requests are reported as unmeasured by the CLI.
