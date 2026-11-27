---
provider: alibaba-model-studio
checked: 2026-11-26
source: https://www.alibabacloud.com/help/en/model-studio/context-cache
cache:
  mode: automatic
  min_tokens: 1024
  ttl_seconds: 300
---

# Alibaba Model Studio (DashScope)

Status: documented, not yet measured here. Facts from Alibaba Cloud's context cache page (page last updated 2026-11-24, read 2026-11-26). Model lists differ by region and deployment scope; the rows below are for the Singapore and China (Beijing) regions as the page lists them.

The frontmatter `cache:` block uses the 1,024-token minimum both modes share and the explicit cache's five-minute lifetime, the only one stated (the implicit cache's lifetime is "indeterminate"). Missing explicit marks on an explicit-only model count against the app, as for Anthropic.

## Two cache modes

| Fact | Explicit cache | Implicit cache | Source |
|---|---|---|---|
| How it starts | The app marks content with `"cache_control": {"type": "ephemeral"}` on a content block (for example the system message's content array) | Automatic: "This automatic mode requires no extra configuration and cannot be disabled." | https://www.alibabacloud.com/help/en/model-studio/context-cache |
| Minimum | 1,024 tokens | 1,024 tokens (512 for Zhipu-deployed GLM models) | same page |
| Lifetime | "5 minutes (resets on hit)" | "Indeterminate. The system periodically clears old, unused cache data." | same page |
| Write price | Typically 125% of the input price | 100% of the input price (no premium) | same page |
| Hit price | Typically 10% of the input price | Typically 20% of the input price | same page |
| Exceptions | qwen4-max, qwen3.8-max, qwen3.8-max-0902, qwen3.8-2.4t-a95b and qwen3.8-flash have their own cache prices (the page says to check the console) | same | same page |
| Together | The two modes are mutually exclusive on a request | | same page |

## Which Qwen models support which mode (Singapore and Beijing)

| Model | Explicit | Implicit | Source |
|---|---|---|---|
| qwen3.6-plus | yes | no (not in the implicit lists) | https://www.alibabacloud.com/help/en/model-studio/context-cache |
| qwen3.7-plus, qwen-plus | yes | yes | same page |
| qwen3.5-plus | yes | no | same page |
| qwen-flash, qwen3.7-flash, qwen3.8-flash | yes | yes | same page |
| qwen3.6-flash, qwen3.5-flash | yes | no | same page |
| qwen-max | no | yes | same page |
| qwen4-max, qwen3.8-max, qwen3.7-max | yes | yes | same page |
| qwen3-coder-flash | yes | yes | same page |

A model listed for explicit cache only caches nothing unless the request carries marks. An app that sets marks only through another provider's keys (for example `providerOptions.anthropic` in the AI SDK) sends none to it; see [vercel-ai-gateway.md](vercel-ai-gateway.md) for the gateway's own option.

## Usage fields

| API | Hits | Writes | Source |
|---|---|---|---|
| OpenAI-compatible | `usage.prompt_tokens_details.cached_tokens` | `usage.prompt_tokens_details.cache_creation_input_tokens` | https://www.alibabacloud.com/help/en/model-studio/context-cache |
| DashScope | the same fields under `prompt_tokens_details`; in the Singapore region implicit hits appear in `usage.cached_tokens` | same | same page |
| Anthropic-compatible | `usage.cache_read_input_tokens` | `usage.cache_creation_input_tokens` | same page |

## Not stated on the page read

- The Responses API's session cache: the page says only that the "Responses API has separate Session cache settings" (checked 2026-11-26).
- Prices per model: on the Model Studio pricing pages, not read for this table.
<!-- leanprompt:generated v0.1.0-dev.14: written by leanprompt install; leanprompt update replaces local edits -->
