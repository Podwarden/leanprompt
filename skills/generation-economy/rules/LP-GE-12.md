---
id: LP-GE-12
title: Read the finish reason before using an answer
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, deepseek, groq, xai, together, azure-openai, alibaba-model-studio, vercel-ai-gateway, vllm, lm-warden, sglang, any]
saves: none
severity: high
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
    checked: 2026-11-26
  - doc: https://github.com/openai/openai-python/blob/main/helpers.md
    checked: 2026-11-26
  - doc: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
    checked: 2026-11-27
  - doc: https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-no-object-generated-error
    checked: 2026-11-27
---
## Rule
Before the app uses, stores or shows an answer, read why the model stopped (`finish_reason`, `stop_reason`, `finishReason`, a Responses `status`), and treat a cut-off answer as unfinished: never save, commit, publish or parse it as complete.

## Why
A reply that stopped at the output limit is a successful call with a partial answer. Nothing fails: the text is there, it just ends early. An app that reads only the text accepts half a translation, a commit body cut mid-sentence or a summary missing its last section, and the user never learns it was cut. On reasoning models the limit can be spent on thinking, leaving an empty or one-line answer.

The signal differs by provider and SDK, and a check written for one misses the others:

- **OpenAI Chat Completions:** `choices[0].finish_reason == "length"`; **Responses:** `status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"` ([providers/openai.md](../../../providers/openai.md), [models/openai-reasoning.md](../../../models/openai-reasoning.md)).
- **Anthropic:** `stop_reason: "max_tokens"`, and `model_context_window_exceeded` when the context ran out ([providers/anthropic.md](../../../providers/anthropic.md)).
- **Gemini:** `finishReason: "MAX_TOKENS"` ([providers/gemini.md](../../../providers/gemini.md)).
- **OpenAI-compatible hosts** use `finish_reason: "length"`; some add their own values (DeepSeek lists `insufficient_system_resource`, [providers/deepseek.md](../../../providers/deepseek.md)).
- **SDK helpers that raise.** The OpenAI Python SDK's `chat.completions.parse()` raises `LengthFinishReasonError` on a length stop ([providers/openai.md](../../../providers/openai.md)); the Vercel AI SDK returns `finishReason: 'length'` from `generateText` and `streamText`, and its structured-output paths raise `NoObjectGeneratedError` carrying `finishReason` and the partial `text` ([runtimes/llm-sdks.md](../../../runtimes/llm-sdks.md)). A generic `except` or `catch` that swallows these, or falls back to the raw text, accepts the cut-off answer.

This is a correctness rule. Accepting a partial answer wastes no tokens of its own (the call was billed once), so it has no token share and the audit records a match as a note that names this rule. When the cut-off answer is then resent unchanged, the resend wastes tokens: that is an LP-GE-05 finding as well. When the limit is too small for the task, the budget itself is LP-GE-03.

## Detect in code
Find every place an answer's text is read, and check whether the same function (or its caller, before the text is used) reads the stop signal.

Python:
```
rg -n 'choices\[0\]\.message\.content|\.output_text|\.content\[0\]\.text|response\.text\b' -g '*.py'
rg -n 'finish_reason|stop_reason|finishReason|incomplete_details|status == .incomplete' -g '*.py'
rg -n 'LengthFinishReasonError|completions\.parse\(|except Exception' -g '*.py'
```
Shapes: `return resp.choices[0].message.content` with no `finish_reason` in the function; `if finish_reason:` or `Boolean(choice.finish_reason)` taken to mean the answer is done (every stop sets it, `length` included); the half-fix, the finish reason read only inside `if not text:` (an empty cut-off is caught, a partial one is not); `except LengthFinishReasonError: return raw_text`; `except Exception:` around `parse()` that returns a default or the partial text; a stream loop that joins `delta.content` and never reads the final chunk's `finish_reason`; `if not text: retry` as the only check (an empty answer is caught, a half answer is not).

TS/JS:
```
rg -n 'choices\[0\]\.message\.content|\.text\b|output_text|content\[0\]\.text' -g '*.{ts,tsx,js,mjs}'
rg -n "finishReason|finish_reason|stop_reason|NoObjectGeneratedError|'length'" -g '*.{ts,tsx,js,mjs}'
```
Shapes: `if (chunk.choices[0].finish_reason) done = true` in a stream loop, with no check of which reason; `const { text } = await generateText(...)` with `finishReason` never destructured or checked; `for await (const part of result.textStream)` with no look at `await result.finishReason`; `catch (e) { if (NoObjectGeneratedError.isInstance(e)) return JSON.parse(e.text) }`; `msg.content[0].text` on Anthropic with no `stop_reason` check.

Go:
```
rg -n 'Choices\[0\]\.Message\.Content|\.Content\[0\]\.Text|FinishReason|StopReason' -g '*.go'
```
Shapes: `resp.Choices[0].Message.Content` returned with no `FinishReason` comparison; a streaming accumulator that ignores the final `FinishReason`.

Also look at what happens after the answer: a cut-off reply written to a response cache (or a translation memory, or a generated file the next run skips) is served as complete on every later request, so the cut-off outlives the call. A fixed constant output budget that a reasoning model shares with its thinking makes cut-offs common (the budget is LP-GE-03); an error hint that tells users to raise a budget that is a code constant points at a setting that does not exist (LP-GE-17). When one call path of the app already checks the finish reason correctly, use it as the template for the others.

**Gateways and proxies** (see the gateway checklist in `llm-call-audit`): a converter between protocols must map every documented stop reason (`max_tokens` to `length`, `tool_use` to `tool_calls`, and back) and must not turn a documented one it does not know (`refusal`, `model_context_window_exceeded`, `pause_turn`) into an error. Shapes: a `switch` on the upstream stop reason whose `default` returns an error or a 5xx; a stream converter that drops the final stop chunk. Record these with `"scope": "proxied"`.

Not a finding: code that reads the signal and acts on it (raises, marks the result as partial, continues the answer, or retries once with a larger limit, LP-GE-05).

## Fix
```python
# before
text = client.chat.completions.create(**body).choices[0].message.content
save(text)

# after
resp = client.chat.completions.create(**body)
choice = resp.choices[0]
if choice.finish_reason == "length":
    raise Truncated(resp)          # or mark the result partial; or one retry with a larger limit (LP-GE-05)
save(choice.message.content)
```

```ts
// Vercel AI SDK
const { text, finishReason } = await generateText({ model, prompt, maxOutputTokens });
if (finishReason === "length") throw new Truncated(text);
```

For a structured helper, handle the truncation exception on its own (`except LengthFinishReasonError`, `NoObjectGeneratedError` with `finishReason === "length"`) and never fall back to parsing the partial text as if it were whole.

## Don't break meaning
The fix changes what the app does with a partial answer, not what it asks. Do not drop the partial text silently either: raise, mark it as partial where the user sees it, or continue it. A continued answer must be joined exactly where it stopped. Do not treat a content-filter or refusal stop as a length stop.

## Verify
(a) Provider usage: send one request with a deliberately small output limit (`max_tokens: 16`). The provider returns `finish_reason: "length"` / `stop_reason: "max_tokens"` / `MAX_TOKENS`; after the fix the app raises, marks the result partial or retries with a larger limit, and stores nothing as complete.

(b) leanprompt usage record: records with `finish: "length"`; for each, the app's own output (the saved file, the message shown, the commit) is marked partial or absent.

## Waste signal
No token share: accepting a cut-off answer is billed once, so it never enters the score. The audit records a match as a note with `"rule": "LP-GE-12"` and a severity. High: a cut-off answer saved, committed, published, cached or sent on to another call as complete, on a path that runs without a person reading it (a batch job, a translation, an agent step), or written to a cache that serves it again. Medium: a cut-off answer shown to a person who can see it ends early. Low: a log line or a debug path. When the same code also resends the cut-off answer unchanged, record that resend as an LP-GE-05 finding and link the note to it with `finding`.
