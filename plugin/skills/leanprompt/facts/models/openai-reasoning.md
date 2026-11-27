---
family: openai-reasoning
checked: 2026-11-26
source: https://developers.openai.com/api/docs/guides/reasoning
---

# OpenAI reasoning models

Status: documented. The gpt-oss template facts are observed, not documented by OpenAI on that page. Not yet measured here except where an observation date is given.

## Reasoning effort (docs, checked 2026-11-26)

- Values are model-dependent and can include `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The page warns that defaults are "model-dependent rather than universal".
- Defaults stated: `medium` for GPT-5.5, GPT-5.6 (both modes), GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna. GPT-6.1 Sol does not support `none` or `minimal`. GPT-6 Astra rejects `none` with HTTP 400 and no default is stated; GPT-6.2 Astra and GPT-6.2 Sol reject `none` with no default stated.
- Reasoning tokens occupy context and are billed as output tokens. The page recommends reserving at least 25,000 tokens for reasoning and output when starting out. Hitting `max_output_tokens` can end the response as `incomplete` before any visible output.
- Summaries are opt-in through `summary`; `auto` is "equivalent to `detailed` for most reasoning models today".

## History and caching

- With function calling, pass back the reasoning items returned with the calls along with the tool outputs. With `previous_response_id` prior reasoning carries forward; with history managed by hand keep all output items in their original order. Stateless mode (`store` false or ZDR) returns `encrypted_content` to pass back.
- On newer models, editing history before a reasoning item can cause it to be dropped.
- Cache facts are in `providers/openai.md`.

## Tools (observed, via OpenRouter, 2026-11-21)

- `tool_choice: "none"` drops the tools from the prompt (`prompt_tokens` halved).
- 128 tools per request at most; a request with 232 was rejected.

## `openai/gpt-oss-20b` chat template (self-hosted)

Observed 2026-09-04 in the model's chat_template.jinja: default reasoning level "medium"; levels low, medium, high; no membership test, so an unknown value is written into the system prompt as `Reasoning: <value>` instead of raising. A typo changes the prompt prefix and the model's behaviour without an error.

## Not stated in the docs

- JSON-output quirks for these models: not stated on the page read (checked 2026-11-26).
<!-- leanprompt:generated v0.1.0-dev.13: written by leanprompt install; leanprompt update replaces local edits -->
