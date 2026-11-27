---
runtime: langchain
checked: 2026-11-27
source: https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/langchain-core/src/utils/async_caller.ts
---

# LangChain defaults that affect token use

Status: documented in source, not yet measured here. Read on 2026-11-27. LangChain.js: `main` at commit `f8879c4b43152a82ca5282306b19df1b84b3dd65`, plus tag `0.1.0` for the early-era rows. langchaingo: tag `v0.1.15` (commit `466381ea570c848f5aa0a5406a6bfdb31333c43b`). Every row links to the file at that commit or tag. Package version numbers at the commit were not read. A `0.2` tag for core was not found, so no 0.2-era row is given.

## LangChain.js

| Fact | Value | Source |
|---|---|---|
| `AsyncCaller` default `maxRetries` | 6 ("Retries are limited by the `maxRetries` parameter, which defaults to 6"); `maxConcurrency` defaults to `Infinity`. A per-call `maxRetries` option overrides it | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/langchain-core/src/utils/async_caller.ts |
| Retry backoff | Random jitter on; the shared retry helper defaults to factor 2, `minTimeout` 1000 ms, no `maxTimeout`. Each retry resends the whole prompt | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/langchain-core/src/utils/p-retry/index.js |
| `STATUS_NO_RETRY` (main) | 400, 401, 402, 403, 404, 405, 406, 407, 409, 413. Such an error is thrown at once. 408 is not in this list on main, so it is retried | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/langchain-core/src/utils/async_caller.ts |
| Other non-retried cases (main) | A deliberate cancel or `AbortError`, code `ECONNABORTED`, and an error already marked not retryable. A 429 is classified: `insufficient_quota` or a quota-exhausted message stops; a `Retry-After` of 60 s or less waits; longer or missing is treated as capacity | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/langchain-core/src/utils/async_caller.ts |
| `STATUS_NO_RETRY` (tag `0.1.0`) | 400, 401, 402, 403, 404, 405, 406, 407, 408, 409 (413 absent, 408 present). Default `maxRetries` 6. Also not retried: cancel, `TimeoutError`, `AbortError`, `ECONNABORTED` | https://github.com/langchain-ai/langchainjs/blob/0.1.0/langchain-core/src/utils/async_caller.ts |
| `ChatOpenAI` timeout | `timeout?: number` with no default set: `this.timeout = fields?.timeout`. The OpenAI client then uses its own default, which was not read here | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/providers/langchain-openai/src/chat_models/base.ts |
| `ChatOpenAI` `maxRetries` | The inner OpenAI client is built with `maxRetries: 0`, so retries come from `AsyncCaller` (6 by default), not from the OpenAI SDK | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/providers/langchain-openai/src/chat_models/base.ts |
| `ChatOpenAI` `maxTokens` | `maxTokens?: number`, no default: `this.maxTokens = fields?.maxCompletionTokens ?? fields?.maxTokens`, so no cap is sent unless set | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/providers/langchain-openai/src/chat_models/base.ts |
| `ChatOpenAI` `streamUsage` | Defaults to `true` | https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/providers/langchain-openai/src/chat_models/base.ts |
| `ChatOpenAI` early era (tag `0.1.0`) | `timeout` unset, inner client `maxRetries: 0`, `maxTokens` optional (a value of `-1` is sent as unset) | https://github.com/langchain-ai/langchainjs/blob/0.1.0/libs/langchain-openai/src/chat_models.ts |

## langchaingo (tag v0.1.15)

| Fact | Value | Source |
|---|---|---|
| Default HTTP client, Anthropic | `httputil.DefaultClient` (`llms/anthropic/anthropicllm.go` line 63) | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/anthropic/anthropicllm.go |
| Default HTTP client, OpenAI | `httputil.DefaultClient` (`llms/openai/llm.go` line 28). The option comment says the default is `http.DefaultClient`, which disagrees with the code | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/openai/llm.go |
| Does it set a timeout | No. `DefaultClient` is `&http.Client{Transport: DefaultTransport}` (adds a User-Agent), with no `Timeout` field, so the request has no time limit unless the caller's context has a deadline | https://github.com/tmc/langchaingo/blob/v0.1.15/httputil/transport.go |
| Anthropic default `max_tokens` | 2048 when the payload's `MaxTokens` is 0 (`setMessageDefaults`, `messages.go` lines 242 to 243). The feedback figure is confirmed | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/anthropic/internal/anthropicclient/messages.go |
| OpenAI default max tokens | `opts.MaxTokens` is sent as `max_completion_tokens` (or `max_tokens` with the legacy option); the field is omitted when 0, so no default cap | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/openai/openaillm.go |
| `GenerationInfo["TotalTokens"]`, OpenAI | Set from the API's `usage.total_tokens` (`result.Usage.TotalTokens`), next to `PromptTokens` and `CompletionTokens`. Whether the total includes cached or reasoning tokens is the API's definition, not stated in this source | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/openai/openaillm.go |
| `GenerationInfo` keys, Anthropic | `InputTokens`, `OutputTokens`, `CacheCreationInputTokens`, `CacheReadInputTokens`. There is no `TotalTokens` key, so a sum must be computed by the caller | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/anthropic/anthropicllm.go |
| OpenAI cached tokens | `GenerationInfo["PromptCachedTokens"]` from `PromptTokensDetails.CachedTokens` | https://github.com/tmc/langchaingo/blob/v0.1.15/llms/openai/openaillm.go |
