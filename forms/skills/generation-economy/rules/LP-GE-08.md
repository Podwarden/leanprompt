---
id: LP-GE-08
title: Route trivially small calls to a small model
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: both
severity: medium
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/reasoning
    checked: 2026-11-26
---
## Rule
Send calls whose task is small and checkable (a conversation title, a label, a yes/no classification, a short rewrite) to a small, fast model instead of the app's main model, and keep the change only where an answer check passes.

## Why
Apps often send every call to the model chosen for the hardest task, at its default effort. A title or a label then pays the large model's price for every input and output token, waits for its slower decode, and on a reasoning model may spend more tokens thinking than answering ([models/openai-reasoning.md](../../leanprompt/facts/models/openai-reasoning.md), [models/anthropic-thinking.md](../../leanprompt/facts/models/anthropic-thinking.md)). Smaller models and their prices are on each provider's model and pricing pages; the tables here record what changes caching and generation for them ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md), [providers/openai.md](../../leanprompt/facts/providers/openai.md), [providers/gemini.md](../../leanprompt/facts/providers/gemini.md), [providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md), [providers/deepinfra.md](../../leanprompt/facts/providers/deepinfra.md)). On a self-hosted server a second model costs GPU memory; it pays only if the small calls are frequent ([providers/vllm.md](../../leanprompt/facts/providers/vllm.md), [providers/sglang.md](../../leanprompt/facts/providers/sglang.md)).

Two cache effects to account for. A model has its own cache, so a small call that repeats the main conversation's long prefix on another model pays for that prefix again, cold (LP-PC-12): send the small model only what the small task needs. And a small model can have a different minimum cacheable length (per-model table in [providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)).

Untested here: the cited pages document the cache minimums and reasoning effort, not the size of the saving.

## Detect in code
Python:
```
rg -n '(title|label|classif|tag|summary|is_|should_)\w*\(' -g '*.py'
rg -n 'model\s*=\s*(MODEL|settings\.\w*model|DEFAULT_MODEL)' -g '*.py'
```
Shapes: `generate_title(history)` calling the main model with the whole history; `is_spam(text)` or `classify(text, LABELS)` using the same `MODEL` constant as the agent; a reasoning model at high effort for a yes/no question.

TS/JS:
```
rg -n '(generateTitle|classify|label|isSpam|shouldReply)\w*\(|model:\s*(MODEL|config\.model)' -g '*.{ts,tsx,js,mjs}'
```
Shapes: one `model` in a shared client config used for every call.

Go:
```
rg -n 'func (GenerateTitle|Classify|Label|Is\w+)\(|Model:\s*(cfg\.Model|DefaultModel)' -g '*.go'
```
Shapes: a single `Model` field in the client options used for agent turns and for titles alike.

Not a finding: small calls where the answer check fails on the small model, and calls whose input needs the large model's context window.

## Fix
```python
# before: titles from the main model, with the whole conversation
title = client.chat.completions.create(model=MAIN_MODEL, messages=history + [TITLE_ASK])

# after: a small model, the input the task needs, a small output limit
title = client.chat.completions.create(
    model=SMALL_MODEL,
    messages=[{"role": "user", "content": TITLE_PROMPT + first_user_message}],
    max_completion_tokens=TITLE_LIMIT,
)
```

Keep the model choice in configuration per kind of call (`models: {agent: ..., title: ..., label: ...}`), so it can change without code edits when the answer check says so.

## Don't break meaning
A smaller model can give different, worse answers. Run an answer check before switching each kind of call: a fixed set of synthetic inputs for that call (with expected labels, or titles a fixed judge prompt accepts), run through the large model and the small one, compare the outputs (exact match for labels and yes/no, a schema match or the judge for free text), and record pass/fail per input. Switch only the kinds of call where the small model passes at least as many inputs as the large one, and rerun the check when either model changes.

## Verify
(a) Provider usage: per model, `prompt_tokens` and `output_tokens` / `completion_tokens` for the small calls move to the small model; with the price card, the cost per small call falls. The main conversation's `cached_tokens` stays the same (the small calls must not change its prefix).

(b) leanprompt usage record: records for the small calls show the small `model`; `flags.parse_failed` and `flags.retry_of` on them do not rise after the switch (a rising rate means the small model is failing the task and the saving is being spent on retries).

## Waste signal
Not in the score (model choice is outside it). Static: severity medium for a label, title or yes/no call on the app's main or reasoning model; reported with the answer-check requirement.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
