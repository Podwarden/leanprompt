---
id: LP-GE-17
title: Send the output cap the owner set, on every path
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, deepseek, groq, xai, together, azure-openai, vllm, lm-warden, sglang, any]
saves: none
severity: medium
evidence:
  - doc: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
    checked: 2026-11-26
  - doc: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning
    checked: 2026-11-26
---
## Rule
When the app lets an owner, an admin page or a config file set an output limit (`max_tokens`, `max_output_tokens`, a "response length" setting), make sure every request path sends it, in the parameter that model accepts, and tell the owner when a path cannot.

## Why
An owner who sets "max tokens: 800" believes answers stop there. When one path drops the setting, the cap does nothing and nobody can tell from the settings page:

- **A parameter the model does not take.** OpenAI's reasoning models use `max_completion_tokens` on Chat Completions (`max_tokens` is deprecated) and `max_output_tokens` on Responses ([providers/openai.md](../../leanprompt/facts/providers/openai.md)); a branch for reasoning models that removes `max_tokens` to avoid an error, and adds nothing, sends no cap at all.
- **One orchestrator or provider adapter that never reads the setting,** while the others do.
- **A cap that counts something else.** On OpenAI and Azure the limit includes reasoning tokens; on xAI it applies to visible output only ([providers/xai.md](../../leanprompt/facts/providers/xai.md)). The same number caps different things on different targets.
- **A default that replaces the setting** when it is unset on one path and set on another (a converter that sends its own fixed limit).

This is a correctness rule: the owner's setting is silently ignored. Whether it costs tokens depends on how long the answers run without it, which is LP-GE-03 (budgets that fit the task); so this rule has no token share, and the audit records a match as a note that names this rule. When the missing cap lets answers run far past what the task needs, record that as an LP-GE-03 finding as well.

## Detect in code
Find where the setting is read and every place a request body is built, and check that each body carries it. Follow the setting to the client the call really uses: a value handed to a constructor whose result is never read, or to a second client the call site does not use, does nothing. The reverse shape counts too: an error message or a doc that tells users to raise a limit that is a constant in the code points at a setting that does not exist.

Python:
```
rg -n 'max_tokens|max_completion_tokens|max_output_tokens|maxOutputTokens|MAX_TOKENS|response_length' -g '*.py' -g '*.yaml' -g '*.json'
rg -n 'pop\("max_tokens"|del .*\["max_tokens"\]|is_reasoning|startswith\("o[0-9]|gpt-5' -g '*.py'
```
TS/JS:
```
rg -n 'maxTokens|max_tokens|maxOutputTokens|max_completion_tokens|max_output_tokens' -g '*.{ts,tsx,js,mjs,json}'
```
Go:
```
rg -n 'MaxTokens|MaxCompletionTokens|MaxOutputTokens' -g '*.go'
```
Shapes: an admin form field saved to config, read by one orchestrator and never by another; `if is_reasoning_model: params.pop("max_tokens")` with no `max_completion_tokens` added; a provider adapter that builds its body from a fixed list of fields that leaves the limit out; a gateway converter that sends its own default when the client sent one in a field it does not map.

Not a finding: a path that sends the setting in the model's own parameter, or one that deliberately ignores it and says so where the owner sets it.

## Fix
```python
# before
params = {"model": model, "messages": msgs}
if not is_reasoning(model):
    params["max_tokens"] = settings.max_tokens
# reasoning models: no cap at all

# after
params = {"model": model, "messages": msgs}
key = "max_completion_tokens" if is_reasoning(model) else "max_tokens"
params[key] = settings.max_tokens   # on reasoning models this also covers thinking: size it (LP-GE-03)
```

Where a path cannot honour the setting, say so next to it on the settings page.

## Don't break meaning
A cap that starts to work can cut answers that used to finish, especially on reasoning models where it covers thinking too. Check the longest real answers against it (LP-GE-03) and read the finish reason (LP-GE-12) so a cut is visible.

## Verify
(a) Provider: set the owner's limit to a small value (`64`) and send one request down each path. Every response reports `output_tokens` (or `completion_tokens`) at most that value plus the reasoning share the provider documents, and a length stop when the answer was longer.

(b) leanprompt usage record: `params` on each record carries the limit; records from every path show it, and answers longer than the limit end with `finish: "length"`.

## Waste signal
No token share: an ignored setting is a correctness problem, so it never enters the score. The audit records a match as a note with `"rule": "LP-GE-17"` and a severity. High: the default deployment's main path ignores the owner's cap. Medium: one path or one model family ignores it. Low: the cap reaches the request but counts something else than the settings page says. When answers on that path run far past what the task needs, record the token loss as an LP-GE-03 finding and link the note to it with `finding`.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
