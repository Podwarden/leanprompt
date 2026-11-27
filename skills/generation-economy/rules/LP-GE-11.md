---
id: LP-GE-11
title: Meter every billed token, cached and unfinished ones too
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, azure-openai, alibaba-model-studio, vercel-ai-gateway, any]
saves: none
severity: medium
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
    checked: 2026-11-26
  - doc: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching
    checked: 2026-11-26
  - doc: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning
    checked: 2026-11-26
  - doc: https://www.alibabacloud.com/help/en/model-studio/context-cache
    checked: 2026-11-26
---
## Rule
When the app meters its own LLM spend from the provider's usage fields (a budget, a spend cap, a cost log, a per-user quota), count every billed token: cache reads and cache writes at their own prices, and the calls that did not finish (errors after generation started, cut-off answers, aborted streams).

## Why
A meter that reads the wrong fields does not waste tokens; it reports the wrong bill. A cap that undercounts lets real spend run past its limit, and one that overcounts blocks users early. This is a correctness rule: it carries a severity and no token share, and the audit records a match as a note that names this rule (the score never reads it).

How the usage fields add up differs by provider, and a formula written for one is wrong for another:

- **Anthropic:** `input_tokens` counts only the tokens after the last cache mark. The whole input is `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`, each at its own price: writes cost more than base input, reads a fraction of it ([providers/anthropic.md](../../../providers/anthropic.md), "Total input"). A meter that reads `input_tokens` alone undercounts, and adding cache marks (LP-PC-01) makes it undercount more, because more of the input moves into the cache fields.
- **OpenAI (and Azure OpenAI):** the reverse. Chat Completions `prompt_tokens` already includes `prompt_tokens_details.cached_tokens` ("Cached tokens present in the prompt"); on the Responses API `input_tokens` includes `input_tokens_details.cached_tokens` and, on models that charge for writes, `cache_write_tokens`. A meter that adds `cached_tokens` on top of `prompt_tokens` counts them twice; one that prices all of `prompt_tokens` at the full rate ignores the cached discount ([providers/openai.md](../../../providers/openai.md), [providers/azure-openai.md](../../../providers/azure-openai.md)).
- **Alibaba Model Studio:** OpenAI-compatible fields, with cache writes reported separately in `prompt_tokens_details.cache_creation_input_tokens` and hits in `prompt_tokens_details.cached_tokens`, billed at different shares of the input price for explicit and implicit caching ([providers/alibaba-model-studio.md](../../../providers/alibaba-model-studio.md)).
- **Routers and gateways** return the routed provider's fields, or their own normalised ones ([providers/openrouter.md](../../../providers/openrouter.md), [providers/vercel-ai-gateway.md](../../../providers/vercel-ai-gateway.md)); read which.

**Unfinished calls are billed too.** A reply cut off at the output limit is billed in full (on reasoning models it can be billed for reasoning with no visible answer: Azure's reasoning guide says "You pay for input and reasoning tokens but receive no answer"). A stream the client aborts, a call that times out on the client, or one that fails after the provider began generating may be billed for what was generated, depending on the provider ([providers/openrouter.md](../../../providers/openrouter.md) lists which upstream providers stop billing on abort). A meter that records usage only on a successful, complete reply misses all of these.

## Detect in code
Look for a module that turns usage into money or a budget: names like `cost`, `budget`, `spend`, `quota`, `usage`, `meter`, `limit`, `credits`, a per-model price table, a daily cap.

Python:
```
rg -n 'input_tokens|prompt_tokens|cached_tokens|cache_read_input_tokens|cache_creation_input_tokens' -g '*.py'
rg -n 'PRICE|price_per|cost\s*[+*]=|budget|spend|quota' -g '*.py'
```
Shapes: `cost = usage.input_tokens * IN_PRICE + usage.output_tokens * OUT_PRICE` on Anthropic with no cache field; `usage.prompt_tokens + usage.prompt_tokens_details.cached_tokens` on OpenAI (double count); a price table with no cached-input or cache-write rate; a usage record written after `json.loads(answer)` succeeds, so a cut-off or failed reply is never metered.

TS/JS:
```
rg -n 'inputTokens|input_tokens|promptTokens|prompt_tokens|cachedInputTokens|cacheReadTokens|cache_read_input_tokens' -g '*.{ts,tsx,js,mjs}'
rg -n 'budget|spend|quota|costUsd|pricePer|MAX_DAILY' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `usage.input_tokens * price` in a budget check; the Vercel AI SDK's `usage.inputTokens` used without `usage.inputTokenDetails.cacheReadTokens` and `cacheWriteTokens` when a cache-read price applies; `onFinish` the only place usage is recorded (an `onError` or an abort never records); a cap module that sums `outputTokens` only.

Go:
```
rg -n 'InputTokens|PromptTokens|CachedTokens|CacheReadInputTokens|CacheCreationInputTokens' -g '*.go'
```
Shapes: `cost := float64(resp.Usage.InputTokens) * inPrice` on Anthropic; usage added to a counter only in the `err == nil` branch.

## Fix
```ts
// before: Anthropic usage, cache fields ignored, failures never metered
const r = await client.messages.create(req);
spend += r.usage.input_tokens * IN + r.usage.output_tokens * OUT;

// after: every input field at its own price, recorded on every reply that carries usage
function cost(u: Anthropic.Usage): number {
  return (
    u.input_tokens * IN +
    (u.cache_creation_input_tokens ?? 0) * CACHE_WRITE +
    (u.cache_read_input_tokens ?? 0) * CACHE_READ +
    u.output_tokens * OUT
  );
}
const r = await client.messages.create(req);
spend += cost(r.usage); // also on stop_reason "max_tokens": the cut-off answer was billed
```

On OpenAI-style usage, price `prompt_tokens - cached_tokens - cache_write_tokens` at the input rate, `cached_tokens` at the cached rate and `cache_write_tokens` at the write rate, and never add `cached_tokens` on top. For a stream, read the final usage chunk (`stream_options.include_usage`) and record what arrived before an abort or an error, or estimate it and mark it as an estimate. Keep the prices in one dated table with their source, as `leanprompt.yaml` `prices:` does.

## Don't break meaning
The fix changes no prompt and no answer. It can change what users see: a cap that undercounted will now stop them sooner, and one that overcounted later. Say so in the change, and check that the cap's limit still means what its owner intended.

## Verify
(a) Provider usage: send two identical requests a minute apart with a cached prefix. On the second, the provider reports cached tokens (`cache_read_input_tokens` on Anthropic, `cached_tokens` on OpenAI); the meter's cost for it equals the provider's own figure for that request (its console, or the price table applied to every usage field by hand), not the uncached price and not double. Then send one request with a deliberately small output limit: it stops with `finish_reason: "length"` / `stop_reason: "max_tokens"`, and the meter still records its `output_tokens`.

(b) leanprompt usage record: with the logger in place, the meter's daily total and the sum over `.leanprompt/usage.jsonl` of `prompt_tokens`, `cached_tokens` and `output_tokens`, priced the same way, agree; records with `finish: "length"` appear in both.

## Waste signal
No token share: a meter that undercounts wastes no tokens, so it never enters the score. The audit records a match as a note with `"rule": "LP-GE-11"` and a severity. High: a spend cap or per-user budget that enforces a limit and undercounts (Anthropic `input_tokens` alone with cache marks set; failures never metered on a path that retries). Medium: a cost log or dashboard that misreports without enforcing anything, or a cap that overcounts (cached tokens added twice). Low: cached reads priced at the full input rate in a report only.
