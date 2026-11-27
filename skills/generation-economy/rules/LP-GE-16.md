---
id: LP-GE-16
title: Fall back to another model only on errors it can fix
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, deepseek, groq, xai, together, vercel-ai-gateway, any]
saves: none
severity: medium
evidence:
  - doc: https://platform.claude.com/docs/en/api/errors
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/error-codes
    checked: 2026-11-26
---
## Rule
Switch to a fallback model or provider only for errors the switch can fix (the primary is overloaded, rate-limited, down, or does not serve the model); stop and report errors it cannot fix (a bad key, exhausted credit or quota, a malformed request, a request too large for every model).

## Why
A fallback chain that catches every error hides the cause and makes the user wait for each link in turn:

- **Authentication and permission (401, 403):** the key is wrong or missing. Another model on the same provider fails the same way; another provider may "succeed" with a key the user did not mean to use, or fail after a long wait. The user is told "all models failed" instead of "your key is invalid".
- **Quota and credit (a 429 for a spend cap or no credit, 402 on some providers):** it keeps failing until access resumes ([providers/openai.md](../../../providers/openai.md), [providers/anthropic.md](../../../providers/anthropic.md), [providers/deepseek.md](../../../providers/deepseek.md)).
- **Invalid request (400, 413, 422):** the same body fails on the next model too, or is accepted by a model with different limits and gives a different answer.
- **A timeout or a cut-off answer:** the first attempt may have been billed in full before the fallback re-runs the whole task on another model.

LP-GE-05 covers retrying the same request; this rule covers changing the model on failure. It is a correctness rule: the wrong fallback mostly costs time and hides errors, so it has no token share, and the audit records a match as a note that names this rule. When the fallback re-runs work the first attempt was billed for (after a timeout, a truncation or a parse failure), those tokens are lost: that is an LP-GE-05 finding as well.

## Detect in code
Python:
```
rg -n 'fallback|FALLBACK|for model in (models|MODELS|candidates)|except Exception' -g '*.py'
rg -n 'litellm.*fallbacks|Router\(|AuthenticationError|PermissionDeniedError|RateLimitError' -g '*.py'
```
TS/JS:
```
rg -n "fallback|fallbackModel|for \(const model of|catch \(|\.status === 4|insufficient_quota" -g '*.{ts,tsx,js,mjs}'
```
Go:
```
rg -n 'fallback|for _, model := range|if err != nil \{' -g '*.go'
```
Shapes: `for model in [primary, *fallbacks]: try: return call(model) except Exception: continue`; a `fallbackModel` option used on every error; `catch { return runWith(otherProvider) }` with no status check; a router config with fallbacks and no list of the errors that trigger them; a CLI that retries the whole command with a different provider after a login error.

Not a finding: a fallback on 429 rate limits that clear, 5xx, 529 overload, connection errors, or "model not found" on the primary, with the error logged.

## Fix
```python
FIXABLE = {408, 409, 429, 500, 502, 503, 504, 529}   # from the provider tables; quota 429s excluded below

def call_with_fallback(body, models):
    last = None
    for model in models:
        try:
            return client.chat.completions.create(**{**body, "model": model})
        except APIStatusError as e:
            if e.status_code not in FIXABLE or is_quota_error(e):
                raise                       # a bad key, no credit, a bad request: say so, do not switch
            last = e
    raise last
```

Report the first non-fixable error to the user in its own words ("invalid API key for provider X"), not as "all models failed".

## Don't break meaning
A fallback model can answer differently. Keep the fallback for the errors it fixes, and say in the result which model answered when it was not the primary.

## Verify
(a) Provider: call with an invalid key. Before, the app tries every fallback and reports a generic failure after their combined timeouts; after, it stops on the first 401 with that message. Then simulate a 503 on the primary: the fallback still runs, and its reply carries a `finish_reason` or `stop_reason` and `output_tokens`.

(b) leanprompt usage record: no record follows one whose `finish` is an error with status 400, 401, 403 or a quota 429 on another model within the same task.

## Waste signal
No token share: a fallback on a non-retryable error costs time and hides the cause, so it never enters the score. The audit records a match as a note with `"rule": "LP-GE-16"` and a severity. High: the fallback sends the user's data to another provider the user did not choose, or uses another key without saying so. Medium: a fallback on every error, including authentication, quota and invalid requests. Low: a fallback that also runs on 400s but logs the original error. When the fallback re-runs a task whose first attempt was billed (after a timeout, a truncation or a parse failure), record that as an LP-GE-05 finding and link the note to it with `finding`.
