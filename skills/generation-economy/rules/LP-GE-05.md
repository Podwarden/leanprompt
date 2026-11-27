---
id: LP-GE-05
title: Retry only retryable errors; never retry a truncation unchanged
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: both
severity: high
evidence:
  - doc: https://platform.claude.com/docs/en/api/errors
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/error-codes
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
    checked: 2026-11-26
  - doc: https://github.com/openai/openai-python/blob/main/helpers.md
    checked: 2026-11-26
---
## Rule
Retry a failed call only when the error says a retry can succeed (rate limits, overload, transient server errors), with backoff and a limit; never resend a cut-off answer with the same output limit.

## Why
A retry pays for the whole prompt again and for whatever is generated again. That is worth it for a transient failure and pure waste for one that will repeat.

- **Retryable:** rate limits that clear, overload (OpenAI 503, Anthropic 529) and transient server errors. Both providers say to follow `Retry-After` (and on Anthropic `x-should-retry`) and to back off ([providers/openai.md](../../../providers/openai.md), [providers/anthropic.md](../../../providers/anthropic.md)).
- **Not retryable:** invalid requests (400), authentication (401, 403), a request too large (413), and a 429 caused by exhausted credit or a spend cap, which keeps failing until access resumes ([providers/openai.md](../../../providers/openai.md), [providers/anthropic.md](../../../providers/anthropic.md)).
- **A truncation is not an error.** The call succeeded and stopped at the output limit: `finish_reason: "length"`, `stop_reason: "max_tokens"`, `finishReason: "MAX_TOKENS"` ([providers/gemini.md](../../../providers/gemini.md)). Sent again unchanged, it usually stops at the same limit, and the tokens of both attempts are billed. A reasoning model that spent the whole limit thinking does the same on every attempt. Anthropic's advice for this stop reason is to raise `max_tokens` or continue the response.
- **A truncation can arrive as an exception.** Some SDK helpers turn a cut-off answer into an error: the OpenAI Python SDK's `chat.completions.parse()` raises `LengthFinishReasonError` on `finish_reason: "length"` and `ContentFilterFinishReasonError` on a content filter stop ([providers/openai.md](../../../providers/openai.md)). A retry filter around such a helper then decides whether a truncation is resent. A filter that lists the exceptions not to retry (an exclusion list) and does not name these retries every truncation unchanged.
- **Two cases that are not this finding.** A model that cannot turn its reasoning off (it reasons even with thinking disabled) can spend the whole limit before answering, so a second attempt is reasonable: raise the limit on that attempt instead of removing the retry. A reply that stopped normally (`stop`, `end_turn`) with an empty answer is a model glitch, not a truncation; one retry of it is fine.

Retry layers multiply: the OpenAI and Anthropic SDKs each retry by default ([providers/openai.md](../../../providers/openai.md), [providers/anthropic.md](../../../providers/anthropic.md)), so an app-level retry loop around them multiplies the attempts.

## Detect in code
Python:
```
rg -n '@retry|tenacity|backoff\.on_exception|except Exception|while True|for attempt in range\(' -g '*.py'
rg -n 'finish_reason|stop_reason|finishReason|incomplete' -g '*.py'
rg -n 'LengthFinishReasonError|ContentFilterFinishReasonError|retry_if_not_exception_type|retry_if_exception_type|completions\.parse\(' -g '*.py'
```
Shapes: a retry decision matched on a status code in the error text (`"status code: 429" in str(err)`, `strings.Contains(err.Error(), "429")`): SDKs word errors differently, so the match misses on one provider and hits wrong ones on another; read the status from the error's typed field. A retry list that includes 400, 401, 403 or 404, which fail the same way every time. `@retry(stop=stop_after_attempt(K))` with no exception filter; `@retry(retry=retry_if_not_exception_type((AuthenticationError, BadRequestError)))` around `chat.completions.parse()`, an exclusion list that does not name `LengthFinishReasonError` (or `ContentFilterFinishReasonError`), so a cut-off structured answer is resent unchanged; `except Exception: continue` inside a loop around the call; `if resp.choices[0].finish_reason == "length": return call(same_args)`; code that ignores the finish reason and retries when parsing fails on a truncated answer; a client error raised for an empty answer or empty thinking (often a truncation inside the thinking) that a generic error classifier files as retryable.

TS/JS:
```
rg -n 'p-retry|retry\(|catch \(e\)|maxRetries|finish_reason|stop_reason' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `pRetry(() => call(body), { retries: K })` with no `shouldRetry`; `catch { return call(body) }`.

Go:
```
rg -n 'for attempt := |backoff\.|retry\.|FinishReason|StopReason' -g '*.go'
```
Shapes: a retry loop that treats every `err != nil` as retryable; a loop that resends when `FinishReason == "length"` with the same params.

## Fix
```python
RETRYABLE = {408, 409, 429, 500, 503, 504, 529}   # from the tables; check `x-should-retry` where sent

def call_with_policy(body):
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = client.chat.completions.create(**body)
        except APIStatusError as e:
            if e.status_code not in RETRYABLE or is_quota_error(e):   # spend cap, no credit: stop
                raise
            sleep(retry_after(e) or backoff(attempt))
            continue
        if resp.choices[0].finish_reason == "length":
            if body["max_completion_tokens"] >= HARD_CEILING:
                raise Truncated(resp)                 # fix the budget (LP-GE-03), do not loop
            body = {**body, "max_completion_tokens": min(body["max_completion_tokens"] * GROWTH, HARD_CEILING)}
            continue                                  # changed, so it may finish this time
        return resp
    raise GaveUp()

client = OpenAI(max_retries=0)   # one retry layer: this one
```

On Anthropic, the stop-reason page gives continuing the response as the alternative to a larger limit; follow that page for how. For a reasoning model that never got to the answer, lower the effort or raise the limit; resending the same request does neither. For a model whose reasoning cannot be turned off, keep the second attempt and give it the larger limit, as in the loop above.

Around a structured helper that raises on truncation, handle the truncation before the generic retry:

```python
from openai import LengthFinishReasonError

try:
    parsed = client.chat.completions.parse(**body)
except LengthFinishReasonError:
    body = {**body, "max_completion_tokens": min(body["max_completion_tokens"] * GROWTH, HARD_CEILING)}
    parsed = client.chat.completions.parse(**body)     # once, with a larger limit; then give up
```

An exclusion-list filter (`retry_if_not_exception_type(...)`) gets `LengthFinishReasonError` and `ContentFilterFinishReasonError` added to its list, so the generic retry never resends them unchanged.

## Don't break meaning
A retry policy changes which calls get a second chance, not what they say. Raising the limit on a retry must not change anything else in the request (same prompt, same settings). A continued answer must be joined exactly where it stopped, with no text added between the parts. Do not turn a refusal, a content filter stop or a schema error into a retry.

## Verify
(a) Provider usage: the retried calls' `finish_reason` / `stop_reason` and status codes. Before, retries follow 400s, quota 429s or `length` stops with unchanged limits; after, retries follow only retryable codes, and each retry after a `length` stop has a larger limit. Total `output_tokens` per completed task falls.

(b) leanprompt usage record: a record with `flags.retry_of` whose original has `finish: "length"` and an equal `params` hash is a truncation retried unchanged; after the fix there are none. Records with `finish: "error"` followed by retries should match retryable errors only.

## Waste signal
Measured: output tokens spent on calls retried after a truncation count as generation waste; so do repeated identical calls after a failure. Static: severity high for a retry on `length` with unchanged parameters or a retry on every exception, including a retry filter around a structured helper that does not exclude its truncation exception (`LengthFinishReasonError`). A truncation filed under a generic "retryable" or "failed, try again" status counts as the same finding when the re-run sends the same parameters: high when a job, a queue or a loop re-runs it, medium when only a person re-runs it on demand. Medium for stacked retry layers or a missing backoff. Not a finding: one retry with a larger limit for a model whose reasoning cannot be turned off, or one retry of an empty answer after a normal stop. When the code shows the retry but not how often answers are cut off, record the finding with `status: "frequency-unknown"`, not `needs-facts`.
