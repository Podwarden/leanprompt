---
id: LP-GE-15
title: Give each timeout one meaning, and set one
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, deepseek, groq, xai, together, vllm, lm-warden, sglang, any]
saves: none
severity: medium
evidence:
  - doc: https://github.com/openai/openai-python/blob/main/README.md
    checked: 2026-11-26
  - doc: https://ai-sdk.dev/docs/ai-sdk-core/settings
    checked: 2026-11-27
  - doc: runtimes/http-clients.md
    checked: 2026-11-26
---
## Rule
Decide whether each timeout bounds one model call or a whole run (an agent turn, a CLI command, a batch), name and document it as that, and set one on every LLM call instead of relying on an SDK default of minutes.

## Why
A timeout that means one thing in the docs and another in the code fails in ways nobody expects:

- **A per-call value used as a deadline for the whole run.** A setting documented as the timeout of one request becomes one wall-clock deadline for a command that makes 1 to 40 calls. Small inputs pass; large ones are cut off part way, after several calls were billed, and the user is told the provider timed out.
- **A run deadline used per call.** A 30-minute job limit passed as each call's timeout lets one hung call use the whole budget.
- **No timeout at all.** The OpenAI SDKs wait 10 minutes by default and retry a timed-out request ([providers/openai.md](../../leanprompt/facts/providers/openai.md)); the Vercel AI SDK states no default timeout ([runtimes/llm-sdks.md](../../leanprompt/facts/runtimes/llm-sdks.md)); Go's `http.DefaultClient` and Python `requests` have none ([runtimes/http-clients.md](../../leanprompt/facts/runtimes/http-clients.md)). An interactive caller (a chat, a voice reply, a git hook) then hangs for many minutes on a stuck request.
- **A timeout far longer than the caller waits.** A 600-second read timeout with two retries on a short spoken answer blocks the user for up to half an hour.

This is a correctness rule: the wrong meaning costs time and failed runs, not tokens of its own, so it has no token share and the audit records a match as a note that names this rule. When a timeout cuts off calls the server is still generating and the app sends them again, those tokens are lost: that is LP-GE-04 (a timeout shorter than the generation time), recorded as a finding as well.

## Detect in code
Python:
```
rg -n 'timeout\s*=|Timeout\(|asyncio\.wait_for|asyncio\.timeout|signal\.alarm|deadline' -g '*.py'
rg -n 'OpenAI\(|Anthropic\(|AsyncOpenAI\(|httpx\.Client\(|requests\.(post|get)\(' -g '*.py'
```
TS/JS:
```
rg -n 'timeout|AbortSignal\.timeout|setTimeout\(|AbortController|maxDuration' -g '*.{ts,tsx,js,mjs}'
```
Go:
```
rg -n 'context\.WithTimeout|context\.WithDeadline|http\.Client\{|Timeout:' -g '*.go'
```
Follow each timeout setting to the client the call really uses: a value passed to a constructor whose result nothing reads, or to a client other than the one the call site builds, does nothing. Shapes: a deadline checked only when a stream chunk arrives (`if time.time() - start > timeout: break` inside `for chunk in stream`) with no request timeout, so a stream that stops sending hangs forever; a per-request timeout multiplied by SDK default retries the code never mentions (the OpenAI SDKs retry a timed-out request, [providers/openai.md](../../leanprompt/facts/providers/openai.md); LangChain wrappers add their own retries, [runtimes/langchain.md](../../leanprompt/facts/runtimes/langchain.md)); one `AbortSignal.timeout(config.timeout)` created before a loop of calls and passed to every call; `asyncio.wait_for(run_agent(), timeout=settings.request_timeout)`; `context.WithTimeout` at the top of a handler whose children make several model calls, with a value named or documented as per request; an SDK client created with no `timeout` on an interactive path; a long `timeout` with SDK retries on a path where a person waits. Compare the code with the README, the CLI help and the config schema: the bug is often that the docs and the code disagree.

## Fix
```ts
// before: "timeout: per request, default 10 s" (README), used as one deadline for the whole command
const signal = AbortSignal.timeout(config.timeout);
for (const step of steps) await generateText({ model, prompt: step, abortSignal: signal });

// after: a per-call timeout, as documented, and a separate, named run deadline
const runDeadline = AbortSignal.timeout(config.runTimeout);         // documented as the whole command
for (const step of steps) {
  await generateText({ model, prompt: step, abortSignal: AbortSignal.any([runDeadline, AbortSignal.timeout(config.timeout)]) });
}
```

Or keep one value and change its documentation and name to say it bounds the whole run, and scale its default with the number of calls a run can make. Size a per-call timeout from the generation time (LP-GE-04), and for an interactive caller keep the total wait (timeout times attempts) within what a person will wait.

## Don't break meaning
The fix changes when the app gives up, not what it asks. Do not shorten a timeout below the generation time of the longest legitimate answer (LP-GE-04). Keep the user's own setting winning.

## Verify
(a) Provider: run the largest input the app supports with the default settings. Before, the run fails part way with a timeout after several calls were billed (their `output_tokens` in the provider's usage); after, each call is bounded on its own and the run finishes, or stops at the documented run deadline with that message.

(b) leanprompt usage record: records of one run carry their timestamps and `finish`; the time between the first and last record of a run, each call's duration, and the records whose `finish` is an error show which limit applied.

## Waste signal
No token share: a timeout's meaning costs time and failed runs, so it never enters the score. The audit records a match as a note with `"rule": "LP-GE-15"` and a severity. High: a per-call value used as a whole-run deadline on a path where runs make many calls (the larger the input, the more certain the failure). Medium: no timeout on an interactive path whose SDK default is minutes, or a total wait (timeout times attempts) far longer than the caller waits. Low: a value whose documentation and code disagree with no failure shown. When the timeout also makes the app resend calls the server was still generating, record that as an LP-GE-04 finding and link the note to it with `finding`.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
