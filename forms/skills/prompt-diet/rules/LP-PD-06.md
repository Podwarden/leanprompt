---
id: LP-PD-06
title: Compact serialisation for data in the prompt
skill: prompt-diet
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: prefill
severity: low
evidence:
  - E11
  - doc: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
Serialise the data the app puts into the prompt (tool results, records, retrieved rows, examples) compactly and the same way every time: no pretty-printing indentation, and a table or a list of rows instead of a list of objects that repeats every key.

## Why
Whitespace and repeated keys are tokens. `json.dumps(rows, indent=2)` adds a line break and indentation for every field, and a list of objects writes every key name once per row; a hundred rows with eight keys write each key a hundred times. The model reads the data just as well in compact JSON, or as a header line followed by rows. Anthropic counts `tool_result` content as input tokens ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)); data in the history is sent again on every later call ([providers/openai.md](../../leanprompt/facts/providers/openai.md)). Documented, not yet measured here; count the two forms with the provider's tokenizer before claiming a saving.

Serialisation is also a cache question. Whatever form you choose, produce it the same way every time (fixed key order, fixed separators), and never re-serialise data already in the history in a new form (LP-PC-04, LP-PC-06).

This rule is about data the app sends. Asking the model for a compact output format is about generated tokens, which the `generation-economy` skill covers (LP-GE-10 for structured output).

## Detect in code
Python:
```
rg -n 'json\.dumps\([^)]*indent\s*=|pprint\.pformat\(|yaml\.dump\(' -g '*.py'
```
Shapes: `json.dumps(result, indent=2)` as a tool result or in a prompt template; `df.to_json(orient="records")` for a large table; `pformat(obj)` in a prompt.

TS/JS:
```
rg -n 'JSON\.stringify\([^)]*,\s*(null|undefined)\s*,\s*\d' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `JSON.stringify(data, null, 2)` in a tool handler or prompt builder.

Go:
```
rg -n 'json\.MarshalIndent\(' -g '*.go'
```
Shapes: `json.MarshalIndent(v, "", "  ")` for a value that goes into a message.

## Fix
```python
# before: pretty-printed, every key on every row
content = json.dumps(rows, indent=2)

# after: compact, fixed separators and key order; for many uniform rows, a header and rows
content = json.dumps(rows, separators=(",", ":"), sort_keys=True, ensure_ascii=False)

COLS = ["id", "status", "total"]
content = json.dumps({"columns": COLS, "rows": [[r[c] for c in COLS] for r in rows]}, separators=(",", ":"))
```

`sort_keys=True` keeps the bytes the same for the same data; if the app's key order carries meaning (a priority, a display order), keep a fixed order of your own instead.

## Don't break meaning
Compact JSON carries the same data; a header and rows changes the shape, so the prompt must say what the columns are, and the model must still be able to point at a row. Run the answer check with `measure-loop` on a fixed set of inputs, before and after: answers unchanged or better, including answers that quote or count the data. Data in the shared head (examples in the system prompt) is read from the cache, so change it there only if the saving outweighs one prefill of the head per route, once. Do not re-serialise or shorten data already in the history, and do not strip reasoning from it; stripping reasoning produced about 3x more generation (E11). What must stay byte-identical in the head and the history: [prefill-cache](../../prefill-cache/SKILL.md).

## Verify
(a) Provider usage: `usage.input_tokens` or `usage.prompt_tokens` on the call that carries the data falls by about the difference between the two forms; on later turns of the conversation `prompt_tokens` stays lower by the same amount, and `cached_tokens` on the next turn still covers the earlier history.

(b) leanprompt usage record: `prompt_tokens` falls for the call site; for the same data, the message's `ids.nodes` entry is equal across two runs (the serialisation is deterministic).

## Waste signal
Measured: the drop in `prompt_tokens` per call that carries the data, times those calls; the score does not count it, the report shows it as `tokens_per_1k.prompt`. Static: severity low for indented JSON or repeated keys in tool results or prompt data; medium when the data is large (hundreds of rows) and sits in an agent loop's history, where every later turn carries it.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
