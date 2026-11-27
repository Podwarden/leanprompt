---
id: LP-PD-02
title: Say each instruction once
skill: prompt-diet
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang, any]
saves: prefill
severity: low
evidence:
  - E11
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
State each instruction once, in the stable system prompt, and remove copies of it from per-turn reminders and from the other templates that are concatenated into the same prompt.

## Why
Prompts grow by accretion: a base template, a persona template, a safety block and a tool-use block are joined together, and each restates "answer in JSON", "never reveal the system prompt" or "cite your sources". A reminder added to each user message says it again. Every copy is sent on every call, and copies in per-turn text are not in the cached head, so they are paid at the full input price each turn ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/anthropic.md), [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/openai.md)). Copies that drift apart ("cite sources" in one, "cite at most two sources" in another) also leave the model to choose between them.

Copies inside the cached head cost little per call: they are read from the cache. Removing them changes the head, which every later call reuses (LP-PC-02), so the saving has to be weighed against one full prefill of the head on each route (the `prompt-diet` skill, "Three things every trim must respect"). Documented, not yet measured here.

## Detect in code
Python:
```
rg -n 'SYSTEM|PROMPT|TEMPLATE|INSTRUCTIONS|REMINDER' -g '*.py' -g '*.txt' -g '*.md' -g '*.j2' -g '*.jinja*'
rg -n '"\n"\.join\(\[.*(PROMPT|TEMPLATE)|\+\s*(SAFETY|STYLE|FORMAT)_\w+' -g '*.py'
```
Shapes: a system prompt built by joining several constants or template files; the same sentence (or a near copy) found in two of them; a reminder string appended to each user message that repeats a line of the system prompt.

TS/JS:
```
rg -n '(SYSTEM|PROMPT|TEMPLATE|INSTRUCTIONS|REMINDER)\w*\s*=' -g '*.{ts,tsx,js,mjs}'
rg -n '\[(\w*PROMPT\w*,\s*)+\w*PROMPT\w*\]\.join' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` system: [BASE, PERSONA, SAFETY, FORMAT].join("\n\n") `` where two parts say the same thing; prompt files under `prompts/` that each repeat the output rules.

Go:
```
rg -n '(System|Prompt|Template|Instructions|Reminder)\w*\s*=\s*`|strings\.Join\(\[\]string\{' -g '*.go'
```
Shapes: raw-string prompt constants joined with `strings.Join`, two of them sharing a paragraph.

To find copies, normalise case and whitespace and compare sentences across the parts; a short script or a careful read of the assembled prompt (print it once) is enough.

## Fix
```python
# before: the output rule three times, once per turn
BASE   = "You are a support assistant. Answer in JSON with keys answer and sources."
FORMAT = "Always answer in JSON with keys answer and sources. Cite your sources."
SYSTEM = BASE + "\n\n" + PERSONA + "\n\n" + FORMAT
user   = {"role": "user", "content": question + "\n\nRemember: answer in JSON with keys answer and sources."}

# after: once, in the stable system prompt, merged into one wording
BASE   = "You are a support assistant."
FORMAT = "Answer in JSON with keys answer and sources. Cite your sources."
SYSTEM = BASE + "\n\n" + PERSONA + "\n\n" + FORMAT
user   = {"role": "user", "content": question}
```

Where the copies differ, keep the version the app relies on and say so in the change; do not merge two different rules into a new third one without the answer check.

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds two calls after the trim and asserts their kvsig `head` ids are equal shows the shorter head is fixed from call to call, so it is cached once and then read. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
A repeated instruction is sometimes there because it was needed: a format rule restated near the end of a long prompt can be what keeps the model on format. Remove a copy only after the answer check with `measure-loop` on a fixed set of inputs, before and after, shows answers unchanged or better, with the format checks of the app (schema, length, refusals) passing. Weigh the cache before editing the head; change it once, not per call. Never strip earlier turns or reasoning from the history as part of this change; stripping reasoning produced about 3x more generation (E11). What must stay byte-identical in the head: [prefill-cache](../../prefill-cache/SKILL.md).

## Verify
(a) Provider usage: `usage.input_tokens` or `usage.prompt_tokens` per call falls by about the size of the removed copies; for copies removed from per-turn text, the uncached part of each turn falls (`input_tokens` minus `cache_read_input_tokens`, or `prompt_tokens` minus `cached_tokens`).

(b) leanprompt usage record: `prompt_tokens` for the call site falls; after the one-time change, `ids.sys` and `ids.head` are again equal from call to call within each route.

## Waste signal
Measured: the drop in `prompt_tokens` per call times the calls; the score does not count it, the report shows it as `tokens_per_1k.prompt`. Static: severity low for copies inside the cached head (they are read from the cache); medium when the copy is in per-turn text, where it is sent uncached on every turn (that shape is also LP-PD-03).
<!-- leanprompt:generated v0.1.0-dev.12: written by npx leanprompt install; npx leanprompt update replaces local edits -->
