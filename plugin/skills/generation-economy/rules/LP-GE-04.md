---
id: LP-GE-04
title: Stream long outputs; timeouts that match generation time
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: both
severity: high
evidence:
  - doc: https://openrouter.ai/docs/api/reference/streaming
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/api/errors
    checked: 2026-11-26
  - doc: https://github.com/openai/openai-python/blob/main/README.md
    checked: 2026-11-26
  - doc: runtimes/http-clients.md
    checked: 2026-11-26
  - doc: https://vercel.com/docs/functions/configuring-functions/duration
    checked: 2026-11-26
---
## Rule
Stream any call whose output can be long, and set timeouts from the expected generation time (a time to first token, then a gap between tokens) instead of a short total timeout that gives up on, and then repeats, a request the server is still generating.

## Why
A client timeout stops the client from waiting; it does not stop the server from generating. OpenRouter documents this for its routes: "For non-streaming requests or unsupported providers, the model will continue processing and you will be billed for the complete response" ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)). For direct calls the providers' pages read here do not say either way, so treat the abandoned answer as still running and billed.

A retry after that timeout pays for the prompt again (prefill) while the abandoned answer is still being generated and billed (generation), and if the timeout is shorter than the generation time, the retry times out the same way. Client libraries make this easy to hit: the OpenAI Python SDK retries a timed-out request twice by default ([providers/openai.md](../../leanprompt/facts/providers/openai.md)), so one short timeout can pay for three generations and deliver none.

A call that sets no timeout of its own gets the HTTP client's default, and the defaults differ by runtime, from a wait shorter than many generations to no limit at all. Look up your client's default in [runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md) (Node's built-in `fetch`, Python `httpx` and `requests`, Go `net/http`), not from memory. A non-streaming completion usually sends nothing, headers included, until the whole answer is ready, so a default wait for headers or for the first byte applies to the whole generation, and when it fires the client gives up while the server goes on generating. Not yet measured here.

A default that is too short for the generation behaves like a short explicit timeout, and the failure is often filed as retryable and sent again (LP-GE-05). A missing timeout repeats nothing, but a stalled call ties up the worker and hides the failure.

A serverless function has a time limit of its own, above every HTTP timeout: the platform ends the function when it runs past it (Vercel's `maxDuration`, for example; [runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md), "Platform time limits"). An agent turn that makes several model calls inside one function must finish within that limit as a whole. When it does not, the function is ended: the tokens already generated are billed, the answer is lost, and code after the calls (writing the usage record, saving the turn) never runs. Streaming the answer to the browser does not lift the limit. Not yet measured here.

Streaming fixes the measurement problem: the first token arrives early, so the client can tell "slow but working" from "dead" with an idle timeout instead of a total one. It also allows stopping early on purpose; on OpenRouter, aborting a stream stops processing and billing on the providers it lists as supported (OpenAI, Anthropic, DeepInfra and others; not Google) ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)). Anthropic advises streaming or the batch API for long requests, and its SDK checks that a non-streaming request is not expected to exceed its timeout ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)). Whether a client disconnect stops generation on a direct Gemini, DeepInfra, vLLM or SGLang call is not stated on the pages read; through OpenRouter, Google does not stop on abort ([providers/gemini.md](../../leanprompt/facts/providers/gemini.md), [providers/deepinfra.md](../../leanprompt/facts/providers/deepinfra.md), [providers/vllm.md](../../leanprompt/facts/providers/vllm.md), [providers/sglang.md](../../leanprompt/facts/providers/sglang.md)).

## Detect in code
Python:
```
rg -n 'timeout\s*=|httpx\.Timeout\(|max_retries\s*=|tenacity|backoff\.on_exception|@retry' -g '*.py'
rg -n 'stream\s*=\s*True|\.stream\(' -g '*.py'
```
Shapes: `OpenAI(timeout=SHORT)` or `requests.post(..., timeout=SHORT)` on calls with large output limits; a retry decorator around a non-streaming call that retries on `Timeout`; SDK retries left on and an app-level retry loop around them.

TS/JS:
```
rg -n 'timeout:|AbortSignal\.timeout\(|maxRetries|p-retry|stream:\s*true' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `AbortSignal.timeout(SHORT)` on a `fetch` to a completions endpoint; `new OpenAI({ timeout: SHORT })` with default retries.

Go:
```
rg -n 'http\.Client\{[^}]*Timeout|context\.WithTimeout\(|WithRequestTimeout|WithMaxRetries' -g '*.go'
```
Shapes: `http.Client{Timeout: short}` shared by LLM calls; `context.WithTimeout(ctx, short)` around a non-streaming `Chat.Completions.New`.

No timeout set at all (the runtime default applies):
```
rg -n 'requests\.(post|request)\(|httpx\.(post|request|Client|AsyncClient)\(' -g '*.py'
rg -n 'fetch\(|signal:|dispatcher:|setGlobalDispatcher|headersTimeout|bodyTimeout' -g '*.{ts,tsx,js,mjs}'
rg -n 'http\.DefaultClient|http\.(Post|Get)\(|&?http\.Client\{\s*\}' -g '*.go'
```
Shape: a non-streaming completion call with a large output limit and no timeout of its own, neither in its arguments nor on its client (a `fetch` with no `signal` or `dispatcher`, `requests.post(...)` or `httpx.post(...)` with no `timeout=`, `http.Post` or `&http.Client{}` with no `Timeout`). Look up the client's default timeouts in [runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md) and compare them with the longest generation the call can produce; then check what the app does when the default fires (a generic error that a retry path or a person sends again is LP-GE-05).

A serverless route that runs a whole agent turn (a loop of model and tool calls) in one function:
```
rg -n 'maxDuration|export const runtime|"functions"' -g '*.{ts,tsx,js,mjs,json}'
```
Shape: a route with `maxDuration` (or the platform's default) shorter than the longest turn the loop allows (its step limit times the time per call), with the usage record written only after the loop ends.

Not a finding: a short timeout on a call whose output limit is small enough to finish within it.

## Fix
```python
# before: a short total timeout, retried, on a long non-streaming answer
client = OpenAI(timeout=SHORT_TIMEOUT_S)
resp = client.chat.completions.create(model=MODEL, messages=msgs, max_completion_tokens=LONG_LIMIT)

# after: stream; time out on silence, not on total length; one retry layer
client = OpenAI(timeout=httpx.Timeout(connect=CONNECT_S, read=IDLE_S, write=WRITE_S, pool=POOL_S), max_retries=0)
stream = client.chat.completions.create(
    model=MODEL, messages=msgs, max_completion_tokens=LONG_LIMIT,
    stream=True, stream_options={"include_usage": True},
)
parts, usage = [], None
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        parts.append(chunk.choices[0].delta.content)
    if chunk.usage:
        usage = chunk.usage
text = "".join(parts)
```

For a raw `fetch` in Node, the same change: stream, and abort only when no chunk arrives for a while.

```ts
// before: non-streaming, no timeout of its own, so undici's default header wait applies
const res = await fetch(`${BASE}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: MODEL, messages, max_tokens: LONG_LIMIT }) });

// after: stream; an idle timer that restarts on every chunk
const ctrl = new AbortController();
let idle = setTimeout(() => ctrl.abort(), IDLE_MS);
const res = await fetch(`${BASE}/chat/completions`, {
  method: "POST", headers, signal: ctrl.signal,
  body: JSON.stringify({ model: MODEL, messages, max_tokens: LONG_LIMIT, stream: true, stream_options: { include_usage: true } }),
});
for await (const chunk of res.body!) {
  clearTimeout(idle);
  idle = setTimeout(() => ctrl.abort(), IDLE_MS);
  parser.feed(chunk);                // collect deltas and the final usage chunk
}
clearTimeout(idle);
```

For a serverless agent turn, bound the turn, not only each call: cap the loop's steps so the longest turn fits the function's limit with room to spare, record usage after each call rather than once at the end, and move turns that can run longer to a background job or a platform with a longer limit.

A Node call that must stay non-streaming passes a `dispatcher` (an undici `Agent` with `headersTimeout` and `bodyTimeout` set above the longest generation time) instead of relying on the default ([runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md)).

With httpx, `read` is the longest wait between two received chunks, so it acts as an idle timeout on a stream. If a call must stay non-streaming, set its total timeout above the output limit divided by the slowest decode rate you observe, and keep one retry layer (the SDK's or the app's, not both).

## Don't break meaning
Streaming does not change the answer, but the code that assembles it must: collect every delta, including tool-call argument deltas, read the final usage chunk (`stream_options.include_usage` on OpenAI), and treat a stream that ends with an error event as failed, not as a short answer. On OpenRouter a cancelled stream usually gets no cache discount because the final usage never arrives ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)), so do not cancel streams to save money unless the answer is no longer needed.

## Verify
(a) Provider usage: compare the provider's request count and `output_tokens` / `completion_tokens` (billing page, OpenRouter's `/api/v1/generation`) with the calls the app saw complete. Timed-out calls appear on the provider side with full output although the app received nothing; after the fix the two counts match and `finish_reason` is `stop` on the calls that completed. For a call with no timeout of its own, write down the default that applies ([runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md)) next to the longest generation time seen; a generation longer than the default shows as an app-side timeout while the provider or server logs a completed request.

(b) leanprompt usage record: before, records with `finish: "error"` followed by a record with `flags.retry_of` pointing at them and equal `params`; after, none for timeouts. The stream's final usage gives `output_tokens` for each record.

## Waste signal
Measured: output tokens of a call repeated after a timeout count as generation waste (a retry of an identical call). Static: severity high for a total timeout shorter than the expected generation time on a non-streaming call with a large output limit, or for stacked retry layers around one; the same when no timeout is set and the client's default ([runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md)) is shorter than that generation time. Medium for a long-output call that does not stream, and for one with no timeout at all where the runtime has none (a hung worker, not a repeated generation). Medium for a serverless agent turn whose longest run can pass the function's time limit; when the code shows the limit but not how long turns take in practice, record it with `status: "frequency-unknown"`.
<!-- leanprompt:generated v0.1.0-dev.13: written by leanprompt install; leanprompt update replaces local edits -->
