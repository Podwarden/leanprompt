---
provider: azure-openai
checked: 2026-11-26
source: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching
cache:
  mode: automatic
  min_tokens: 1024
  step_tokens: 128
  ttl_seconds: 300
---

# Azure OpenAI (in Microsoft Foundry)

Status: documented, not yet measured here. Facts from Microsoft Learn: the prompt caching page (updated 2026-11-06) and the reasoning models page (updated 2026-11-25), both read 2026-11-26. Azure OpenAI uses the same request structures as the OpenAI APIs, with `model` set to the deployment name; where Azure's docs differ from OpenAI's ([openai.md](openai.md)), the difference is stated below.

`step_tokens: 128` and `ttl_seconds: 300` are for GPT-5.5 and earlier models (128-token increments after the first 1,024 tokens; in-memory caches typically cleared within 5 to 10 minutes of inactivity), the conservative choice.

## Prompt caching

| Fact | Value | Source |
|---|---|---|
| Minimum | At least 1,024 tokens, and the first 1,024 must be identical | https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching |
| Granularity | GPT-5.5 and earlier: hits after the first 1,024 tokens in 128-token increments. GPT-5.6 and later: no such rounding | same page |
| Usage fields | `prompt_tokens_details.cached_tokens` (Chat Completions); GPT-5.6 and later on Standard pay-as-you-go also report writes in `cache_write_tokens` | same page |
| Cache writes | "Models before the GPT-5.6 family don't charge extra to write to the cache." GPT-5.6 and later can charge for writes; 12-hour write charges apply to usage from 2026-11-01 | same page |
| Cache reads | Billed at a discount on input pricing for Standard deployment types; on provisioned deployments, cached tokens do not consume PTU capacity for models before GPT-6 | same page |
| Lifetime, before GPT-5.6 (`prompt_cache_retention`) | `in_memory`: typically cleared within 5 to 10 minutes of inactivity, always within one hour of last use; GPT-4o or newer. `24h` (extended): up to 24 hours, on a named list that includes `gpt-5.5`, `gpt-5.4`, `gpt-5.2`, `gpt-5.1`, `gpt-5` and `gpt-4.1` (`gpt-5.4-mini` is not on it). Default for `gpt-5.4` and older: `in_memory`; `gpt-5.5`: extended by default | same page |
| Lifetime, GPT-5.6 and later | `prompt_cache_options.ttl`: `30m` (default) or `12h` on supported Responses and Decisions API deployments; a minimum, not a maximum | same page |
| Explicit breakpoints | `prompt_cache_options` and `prompt_cache_breakpoint` on GPT-5.6 and later, Standard pay-as-you-go; on provisioned (PTU-M) only GPT-6 and newer. "Models before the GPT-5.6 family don't support `prompt_cache_options` or `prompt_cache_breakpoint`. Requests that include these parameters return a `400` error." | same page |
| Breakpoint limits | Up to four new cache writes per request; in `implicit` mode the latest-message breakpoint takes one slot; reads consider up to the latest 50 breakpoints | same page |
| Routing key | `prompt_cache_key` on models before GPT-5.6; above about 15 requests per minute for one prefix and key, some requests may miss | same page |
| Turning it off | GPT-5.6 and later: `prompt_cache_options.mode: "explicit"` with no breakpoints. Earlier models: cannot be disabled | same page |

## Reasoning models

| Fact | Value | Source |
|---|---|---|
| Output limit | Responses API `max_output_tokens`; Chat Completions `max_completion_tokens` (reasoning models work only with it, not `max_tokens`). "Both limits cover reasoning tokens, visible output tokens, and formatting tokens." | https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning |
| Reasoning tokens | "Reasoning tokens are billed as output tokens" | same page |
| Cut-off reply | `status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"`; "This condition can occur before the model produces any visible output. You pay for input and reasoning tokens but receive no answer." | same page |
| Effort values | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, by model; "Defaults vary by model as well". `none` is accepted by `gpt-5.6`, `gpt-5.5`, `gpt-5.4`, `gpt-5.2`, `gpt-5.1` and the `gpt-5.1-codex` models; `minimal` only by the original GPT-5 models | same page |
| Effort defaults stated | `gpt-5.1` defaults to `none`; `gpt-5-pro` supports and defaults to `high`. The page does not state the default for `gpt-5.4` or `gpt-5.4-mini`; OpenAI's model pages give `none` for both ([openai.md](openai.md)) | same page |
| Output ceiling | `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`, `gpt-5`: 128,000 output tokens | same page, "API and feature support" |
| Unsupported parameters | Reasoning models other than GPT-6 Astra reject `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `logprobs`, `top_logprobs`, `logit_bias` and `max_tokens` | same page |
| Recommended headroom | Reserve at least 25,000 tokens for reasoning and output while learning a workload, then tune | same page |

## Not stated in the docs read

- The default reasoning effort of `gpt-5.4` and `gpt-5.4-mini` deployments on Azure (checked 2026-11-26): the reasoning page says defaults vary by model and does not list them.
- Cached-input prices: on the Azure OpenAI pricing page, not read for this table.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
