---
runtime: llm-sdks
checked: 2026-11-27
source: https://code.claude.com/docs/en/agent-sdk/agent-loop
---

# LLM SDKs: the Claude Agent SDK, the Codex SDK and the AI SDK

Status: documented, not yet measured here. Used by the generation-economy rules on cut-off answers, retries and timeouts, and by LP-GE-11. Each row gives a fact, what the page says, and the page it was read from on the `checked:` date (2026-11-27). Quoted phrases are verbatim from the page. The Claude docs addresses `platform.claude.com/docs/en/agent-sdk/...` redirect (HTTP 307) to `code.claude.com/docs/en/agent-sdk/...`, so the `code.claude.com` URLs are the ones listed.

## Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`)

| Fact | Value | Source |
|---|---|---|
| What it is | A library that "runs the Claude Code binary"; both SDKs bundle a native Claude Code binary | https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/agent-sdk/agent-loop |
| How a run ends on a turn limit | A `ResultMessage` with subtype `error_max_turns` ("Hit the `maxTurns` limit before finishing"); the `result` field is not available. Without the extra final text-only turn "the run ends with a `ResultMessage` of subtype `error_max_turns` and no final response" | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| Turn counting | "Count each turn with tool calls, plus one for the final text-only response" | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| Result subtypes | `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, `error_max_structured_output_retries` | https://code.claude.com/docs/en/agent-sdk/agent-loop, https://code.claude.com/docs/en/agent-sdk/python |
| Error results still carry usage and cost | "All result subtypes carry `total_cost_usd`, `usage`, `num_turns`, and `session_id`". After a session crash the cost fields "may be zeroed" | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| A single-shot call raises after an error result | A single-shot `query()` "yields the final result message, then raises an error that includes the failure text, such as `Reached maximum number of turns`" | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| `maxTurns` / `max_turns` | TypeScript `maxTurns`, default `undefined`: "Maximum agentic turns". Python `max_turns`, default `None`. The agent-loop page gives the default as "No limit" | https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/python, https://code.claude.com/docs/en/agent-sdk/agent-loop |
| `maxBudgetUsd` / `max_budget_usd` | Documented, default none: "Stop the query when the client-side cost estimate reaches this USD value. The estimate can pass this value, so leave headroom." Ends with subtype `error_max_budget_usd`. Counts only the call's own spend, not totals restored from a resumed session | https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/agent-loop |
| `model` and `fallbackModel` | `model`: "Claude model alias or full model name" (TypeScript default "Default from CLI"). `fallbackModel` / `fallback_model`: "Model to use if the primary model fails", accepts a comma-separated list | https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/python |
| Result fields (TypeScript) | `usage: NonNullableUsage`, `total_cost_usd: number`, `num_turns: number`, `modelUsage: { [modelName: string]: ModelUsage }`. Python: `usage`, `total_cost_usd`, `num_turns`, `model_usage`, all but `num_turns` optional (check for `None`) | https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/python |
| What `usage` covers | "main agent loop only. Excludes subagent and auxiliary model calls, and is per-turn in streaming-input sessions. Prefer `modelUsage` for token/cost accounting." | https://code.claude.com/docs/en/agent-sdk/typescript |
| What `modelUsage` covers | Per-model totals for "every model call made through the query pipeline", including subagents and compaction; excludes helper calls such as the permission classifier and token-counting requests. `total_cost_usd` includes subagents; `usage` does not | https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| Cache fields in `usage` | The usage object has `cache_creation_input_tokens` ("charged at a higher rate than standard input tokens") and `cache_read_input_tokens` ("charged at a reduced rate"), and the page says to "Track these separately from `input_tokens`". The page does not state in words that `input_tokens` excludes them; read together with the Anthropic usage shape it is Anthropic-shaped | https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| Output tokens | Per-step `output_tokens` on assistant messages "is a placeholder"; read output tokens from the result message's `usage` or `modelUsage` | https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| Cost is an estimate, in money | `total_cost_usd` and `costUSD` "are client-side estimates, not authoritative billing data", computed locally from a bundled price table; "Don't bill end users or trigger financial decisions from these fields" | https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| Subscription login and cost | Not stated for the cost fields. The overview says third parties may not "offer claude.ai login or rate limits" for products built on the SDK unless previously approved, and says to use API key authentication. The cost-tracking page says that on a Claude subscription "within your plan's included usage" the 1-hour cache TTL applies without setting a variable | https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| Prompt caching | Automatic: "You do not need to configure caching yourself". Default TTL for own turns with an API key is 5 minutes; `ENABLE_PROMPT_CACHING_1H` requests 1 hour at a higher write price | https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| Session resume | `resume` option: "Session ID to resume". "A resumed call's results report the session's whole spend, not just that call's own" (totals restored in Claude Code v2.1.277 and later) | https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-sdk/cost-tracking |
| `stop_reason` on the result | `string \| null`; common values `end_turn`, `max_tokens` ("hit the output token limit"), `refusal` | https://code.claude.com/docs/en/agent-sdk/agent-loop |

## OpenAI Codex SDK (`@openai/codex-sdk`)

| Fact | Value | Source |
|---|---|---|
| `run()` | "`run()` buffers events until the turn finishes"; the turn exposes `turn.finalResponse` and `turn.items` | https://github.com/openai/codex/blob/main/sdk/typescript/README.md |
| `runStreamed()` | "returns an async generator of structured events"; iterate its `events` with `for await`; a `turn.completed` event carries `usage` | https://github.com/openai/codex/blob/main/sdk/typescript/README.md |
| Usage fields | `Usage` type: `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, all `number`, described as "during the turn". `TurnCompletedEvent` is `{ type: "turn.completed"; usage: Usage }` | https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts |
| Usage on a `run()` result | The README shows usage only as `event.usage` in a `turn.completed` case of `runStreamed()`; it does not describe usage on the buffered `run()` result | https://github.com/openai/codex/blob/main/sdk/typescript/README.md |
| Resume a thread | "Threads are persisted in `~/.codex/sessions`"; "reconstruct it with `resumeThread()` and keep going". Docs: "Call `run()` again to continue on the same thread, or resume a past thread by providing a thread ID" | https://github.com/openai/codex/blob/main/sdk/typescript/README.md, https://learn.chatgpt.com/docs/codex-sdk |
| Model option | Set at thread creation through the `model` field passed to `startThread` | https://learn.chatgpt.com/docs/codex-sdk |
| Cancel a turn | `TurnOptions` has `signal?: AbortSignal` ("AbortSignal to cancel the turn"), `outputSchema?: unknown` and `cyberAccessProgram?`; there is no `timeout` field | https://github.com/openai/codex/blob/main/sdk/typescript/src/turnOptions.ts |
| Docs address | `https://developers.openai.com/codex/sdk` redirects (HTTP 308) to `https://learn.chatgpt.com/docs/codex-sdk` | https://learn.chatgpt.com/docs/codex-sdk |

## Vercel AI SDK (`ai` on npm)

| Fact | Value | Source |
|---|---|---|
| Major version described | The reference page states no major version number. Its `timeout` object, `inputTokenDetails` and the `interrupted` finish reason were present on the page read | https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text |
| `finishReason` values | `'stop' \| 'length' \| 'content-filter' \| 'tool-calls' \| 'error' \| 'interrupted' \| 'other'` | https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text |
| `maxRetries` default | "Maximum number of retries. Set to 0 to disable retries. Default: `2`." | https://ai-sdk.dev/docs/ai-sdk-core/settings, https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text |
| `abortSignal` | "An optional abort signal that can be used to cancel the call"; may be forwarded from a UI or made with `AbortSignal.timeout`. No default | https://ai-sdk.dev/docs/ai-sdk-core/settings |
| `timeout` | "An optional timeout in milliseconds. The call will be aborted if it takes longer than the specified duration." Also an object: `totalMs` ("the total timeout for the entire call including all steps"), `stepMs`, streaming-only `firstChunkMs` and `chunkMs`, `toolMs`, and per-tool `{toolName}Ms`. No default value is stated, so no default timeout is documented | https://ai-sdk.dev/docs/ai-sdk-core/settings, https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text |
| Usage fields | `inputTokens` ("The total number of input (prompt) tokens used."), `outputTokens`, `totalTokens`, and `inputTokenDetails` with `noCacheTokens`, `cacheReadTokens`, `cacheWriteTokens`. A `cachedInputTokens` field does not appear on this page; `inputTokenDetails.cacheReadTokens` is the equivalent. `inputTokens` is described as the total, so it includes cached tokens | https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text |
| Cut-off structured output | `NoObjectGeneratedError` exposes `text`, `response`, `usage`, `cause` and `finishReason`; the `finishReason` is documented as "For example 'length' if model generated maximum number of tokens, this could result in a JSON parsing error". So a length stop surfaces as this error carrying `finishReason: 'length'`, and the partial `text` | https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-no-object-generated-error |

## Not stated on the pages read

- The Claude Agent SDK pages do not say in words that `usage.input_tokens` excludes cache reads and writes; they say to track the cache fields "separately from `input_tokens`".
- The Claude Agent SDK pages do not say whether a subscription login reports `total_cost_usd` as plan quota or as money. They only call it a client-side estimate.
- The Claude Agent SDK pages read set no default for `maxTurns` or `maxBudgetUsd` (no limit) and state no default wall-clock timeout for a run.
- The Codex SDK README and docs do not state a default timeout, any timeout option (only an `AbortSignal`), or how `cached_input_tokens` relates to `input_tokens` (included or separate).
- The Codex SDK README does not show the shape of a `run()` result's usage, and the `model` option is not in the README (it is in the docs page).
- The AI SDK reference page states no major version, no default timeout, and does not say how `generateObject` or `Output.object` behave beyond the `NoObjectGeneratedError` page (which says a length stop "could result in a JSON parsing error"). `generateObject` and `Output.object` reference pages were not read.
- The AI SDK pages read do not say which `finishReason` a provider reports for a cut-off answer beyond the `'length'` value being listed.
