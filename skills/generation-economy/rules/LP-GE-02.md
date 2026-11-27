---
id: LP-GE-02
title: Batch independent questions about one context
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: both
severity: medium
evidence:
  - doc: https://developers.openai.com/api/docs/guides/structured-outputs
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
    checked: 2026-11-26
---
## Rule
When the app asks several questions about the same context and no answer depends on another, ask them in one call with a structured output that has one field per question, and keep it only if the answer check passes.

## Why
Each separate call sends the context again: a document with five extraction questions is five prefills of the document, five copies of the instructions, and five answer preambles. A prefix cache makes the repeated context cheaper but not free (cached tokens are still billed at a reduced rate, and only above the provider's minimum and within its lifetime; see LP-PC-01 and the cache rows in [providers/anthropic.md](../../../providers/anthropic.md), [providers/openai.md](../../../providers/openai.md), [providers/gemini.md](../../../providers/gemini.md), [providers/deepinfra.md](../../../providers/deepinfra.md)). One call with one field per question prefills the context once.

A structured output keeps the answers apart and parseable. Structured output is supported by every provider in the tables (LP-GE-10): OpenAI, Anthropic, Gemini, OpenRouter (on models with the capability), DeepInfra, vLLM and SGLang ([providers/openrouter.md](../../../providers/openrouter.md), [providers/vllm.md](../../../providers/vllm.md), [providers/sglang.md](../../../providers/sglang.md)).

The saving has a price that this rule makes you check: one model call answering many questions can answer some of them worse than a call that sees one question, and one truncated output loses every answer at once. Untested here: the cited pages document structured output, not this trade-off.

## Detect in code
Look for a loop over questions, fields or checks that sends the same context each time.

Python:
```
rg -n 'for (q|question|field|check) in|QUESTIONS|FIELDS' -g '*.py'
```
Shapes: `for field in FIELDS: ask(f"{doc}\n\nWhat is the {field}?")`; `[classify(doc, label) for label in LABELS]` with one yes/no call per label; `asyncio.gather(*(ask(doc, q) for q in questions))`.

TS/JS:
```
rg -n 'questions\.map\(|fields\.map\(|for \(const (q|field) of' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `await Promise.all(questions.map((q) => ask(doc, q)))`.

Go:
```
rg -n 'for _, (q|field|question) := range' -g '*.go'
```
Shapes: a loop that builds a prompt from the same `doc` and a different question and calls the model each time.

Not a finding: questions where a later one needs an earlier answer (a chain), and questions that need different tools, models or settings.

## Fix
```python
# before: one call, and one prefill of the document, per question
answers = {f: ask(f"{DOC}\n\nQuestion: What is the {f}?") for f in FIELDS}

# after: one call, one field per question
schema = {
    "type": "object",
    "properties": {f: {"type": ["string", "null"]} for f in FIELDS},
    "required": FIELDS,
    "additionalProperties": False,
}
resp = client.responses.create(
    model=MODEL,
    input=f"{DOC}\n\nAnswer each field from the document. Use null when the document does not say.",
    text={"format": {"type": "json_schema", "name": "fields", "strict": True, "schema": schema}},
    max_output_tokens=OUTPUT_LIMIT,   # sized for all fields together (LP-GE-03)
)
answers = json.loads(resp.output_text)
```

Group a small number of related questions per call rather than every question at once, and size the output limit for all answers together.

## Don't break meaning
Batching changes what the model sees in one call, so it can change answers. Each question must still be answerable on its own: keep its wording, allow "not stated" (`null`) for each field so the model does not invent an answer to fill it, and never batch questions whose answers depend on each other.

Run an answer check before keeping the change: a fixed set of synthetic inputs (documents with known answers), run through the old form (one call per question) and the new form (one batched call), compare the outputs field by field (exact match or schema match), and record pass/fail per field. Keep the batched form only if it passes on at least as many fields as the old form; otherwise make the groups smaller or keep separate calls.

## Verify
(a) Provider usage: before, one call per question, each with the context in `prompt_tokens` (or `cached_tokens` / `cache_read_input_tokens` when the cache hits); after, one call with the context once and `output_tokens` / `completion_tokens` for all answers. Check `finish_reason` (`stop_reason` on Anthropic) is never `length` / `max_tokens`.

(b) leanprompt usage record: before, several records per document that share `ids.nodes` up to the context and differ only in the last message; after, one record per document, `finish: "length"` absent and `flags.parse_failed` absent.

## Waste signal
Measured: not counted directly in the score (separate questions are not identical calls); it shows as fewer calls and fewer prompt tokens per document in a before/after run (the `measure-loop` skill). Static: severity medium for a loop that sends the same long context with a different question each time and does not chain the answers.
