---
id: LP-GE-09
title: Predicted outputs for mostly unchanged text
skill: generation-economy
applies_to: [openai, vllm, anthropic, gemini, openrouter, deepinfra, sglang]
saves: generation
severity: low
evidence:
  - doc: https://developers.openai.com/api/docs/guides/predicted-outputs
    checked: 2026-11-26
  - doc: https://docs.vllm.ai/en/latest/features/speculative_decoding/
    checked: 2026-11-26
---
## Rule
When a call returns a long text that is mostly the input unchanged (editing a file, fixing a few lines, updating a document), either pass the current text as a predicted output where the provider supports it, or ask for only the changes (a diff or search-and-replace edits) and apply them in code.

## Why
Regenerating a whole file to change three lines pays for, and waits for, every unchanged token. There are two ways out.

- **Predicted outputs** (speed). OpenAI Chat Completions takes a `prediction` with the expected text, on the models listed in [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/openai.md). The docs say it improves response times when large parts of the output are known ahead of time. Rejected prediction tokens are billed as completion tokens, so a poor prediction adds cost (this follows from that billing rule); and the feature does not work with `n` > 1, tools, `logprobs` and a few other parameters. The Responses API and reasoning models are not mentioned on the page. Anthropic, Gemini, OpenRouter, DeepInfra and SGLang list no prediction parameter on the pages read ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/anthropic.md), [providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/gemini.md), [providers/openrouter.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/openrouter.md), [providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/deepinfra.md), [providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/sglang.md)). On a self-hosted vLLM, n-gram speculative decoding is the nearest engine-side feature: it is set on the server, not per request. With MTP speculative decoding on a hybrid model, one more cache block was dropped (E9); whether n-gram speculation does the same is untested here ([providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.9/providers/vllm.md)).
- **Ask for the changes only** (tokens and speed, any provider). The output shrinks from the whole text to the edits. This works everywhere and saves output tokens, at the cost of code that applies the edits and fails loudly when one does not apply.

Documented, not yet measured here.

## Detect in code
Python:
```
rg -n 'Return the (full|entire|complete|whole) (file|document|text|code)|rewrite the (file|document)|write_text\(.*choices\[0\]' -g '*.py'
rg -n 'prediction\s*=' -g '*.py'
```
Shapes: a prompt that sends a file and asks for the whole file back with a small change; `path.write_text(resp.choices[0].message.content)` after an edit request; an edit loop with no `prediction` on a provider and model that support it.

TS/JS:
```
rg -n 'full (file|document)|entire (file|document)|writeFile\(.*(content|text)|prediction:' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `await fs.writeFile(path, completion.choices[0].message.content)` on an edit task.

Go:
```
rg -n 'os\.WriteFile\(|Prediction|full file|entire file' -g '*.go'
```
Shapes: a handler that overwrites a file with the model's whole output after a small edit request.

## Fix
OpenAI Chat Completions, on a supported model:

```python
resp = client.chat.completions.create(
    model=EDIT_MODEL,
    messages=[{"role": "user", "content": EDIT_INSTRUCTIONS + "\n\n" + current_text}],
    prediction={"type": "content", "content": current_text},
)
```

Any provider, changes only:

```python
# before: "Return the full file with the fix applied."
# after
EDIT_FORMAT = (
    "Return only the edits, as blocks:\n"
    "<<<<<<< SEARCH\n(exact lines from the file)\n=======\n(replacement lines)\n>>>>>>> REPLACE"
)
edits = parse_edits(resp_text)
new_text = apply_edits(current_text, edits)   # raise if a SEARCH block is not found exactly once
```

## Don't break meaning
The page presents predicted outputs as a latency feature; whether the output is identical with and without a prediction is not stated, so run the answer check on a fixed set of edits before and after. For the changes-only form, an edit that does not apply must fail, never be skipped or applied fuzzily; check the result with the same tests or answer check that judged the full-text form. Keep the file's unchanged parts byte-identical.

## Verify
(a) Provider usage: with predictions, `completion_tokens` and `rejected_prediction_tokens` in `usage` (the rejected count should be small; a large one means the prediction costs more than it saves) and the response time. With changes-only, `output_tokens` / `completion_tokens` per edit falls to roughly the size of the edits.

(b) leanprompt usage record: `output_tokens` per edit call falls (changes-only); an edit that failed to apply and was re-asked shows as `flags.parse_failed` followed by a record with `flags.retry_of`, and should be rare.

## Waste signal
Not in the score directly (the full-text output is not a repeat). It shows as fewer output tokens per edit in a before/after run (the `measure-loop` skill). Static: severity low for a whole-file rewrite prompt on edit tasks; with the provider's prediction support noted from the tables.
<!-- leanprompt:generated v0.1.0-dev.9: written by npx leanprompt install; npx leanprompt update replaces local edits -->
