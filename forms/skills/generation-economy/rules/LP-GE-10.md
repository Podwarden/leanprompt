---
id: LP-GE-10
title: Structured output instead of parse-and-re-ask
skill: generation-economy
applies_to: [openai, anthropic, gemini, openrouter, deepinfra, vllm, sglang, any]
saves: generation
severity: high
evidence:
  - doc: https://developers.openai.com/api/docs/guides/structured-outputs
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
    checked: 2026-11-26
  - doc: https://aistudio.google.com/docs/structured-output
    checked: 2026-11-26
  - doc: https://docs.deepinfra.com/chat/structured-outputs.md
    checked: 2026-11-26
  - doc: https://docs.vllm.ai/en/latest/features/structured_outputs.html
    checked: 2026-11-26
  - doc: https://docs.sglang.io/advanced_features/structured_outputs.html
    checked: 2026-11-26
---
## Rule
When code needs to parse the model's answer, request structured output with a schema (or a strict tool call) instead of asking for JSON in prose, parsing it, and asking again when parsing fails.

## Why
A parse failure throws away a whole generated answer and pays for another, and the re-ask usually carries the failed answer and an error message too. Constrained decoding prevents the failure instead of repairing it. What each provider offers ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/openai.md), [providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/anthropic.md), [providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/gemini.md), [providers/openrouter.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/openrouter.md), [providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/deepinfra.md), [providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/vllm.md), [providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/sglang.md)):

- **OpenAI:** `json_schema` with `strict: true` (Responses `text.format`, Chat Completions `response_format`). Only Structured Outputs ensure schema adherence; JSON mode only ensures valid JSON. Refusals come back in a separate `refusal` field.
- **Anthropic:** `output_config.format` with a JSON schema, and `strict: true` on tools; the docs say no retries are needed for schema violations. Some schema features are not supported (400). Changing the format invalidates the prompt cache for that conversation.
- **Gemini:** a JSON schema with `application/json`; output is valid JSON, but some constraints are stripped rather than enforced, and the docs say to validate values in the app.
- **OpenRouter:** `response_format` `json_schema` on models with the structured-outputs capability.
- **DeepInfra:** `json_object` or `json_schema` with `strict`; the docs warn that a `length` stop can leave the JSON incomplete.
- **vLLM, SGLang:** `response_format` `json_schema`, plus regex, choice and grammar constraints.

Documented, not yet measured here.

## Detect in code
Python:
```
rg -n 'json\.loads\(|JSONDecodeError|ValidationError|model_validate_json|re\.search\(r?["'"'"']```json' -g '*.py'
rg -n 'response_format|output_config|json_schema|strict' -g '*.py'
```
Shapes: `try: json.loads(text) except JSONDecodeError: ask again with "That was not valid JSON"`; a regex that strips a ```` ```json ```` fence before parsing; a prompt line "Respond only with JSON in this format: ..." and no `response_format`; `response_format={"type": "json_object"}` where the code depends on specific fields.

TS/JS:
```
rg -n 'JSON\.parse\(|SyntaxError|safeParse\(|zod|response_format|json_schema' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `try { JSON.parse(text) } catch { return retryWithError(...) }`; a zod `safeParse` failure that triggers a re-ask.

Go:
```
rg -n 'json\.Unmarshal\(|ResponseFormat|JSONSchema' -g '*.go'
```
Shapes: `if err := json.Unmarshal([]byte(content), &out); err != nil { /* re-ask */ }`.

## Fix
```python
# before
resp = client.chat.completions.create(model=MODEL, messages=msgs + [{"role": "user", "content": "Reply only with JSON: {\"label\": ..., \"confidence\": ...}"}])
try:
    out = json.loads(resp.choices[0].message.content)
except json.JSONDecodeError:
    out = reask(msgs, resp)          # pays for another answer

# after
schema = {
    "type": "object",
    "properties": {"label": {"type": "string", "enum": LABELS}, "confidence": {"type": "number"}},
    "required": ["label", "confidence"],
    "additionalProperties": False,
}
resp = client.chat.completions.create(
    model=MODEL, messages=msgs,
    response_format={"type": "json_schema", "json_schema": {"name": "label", "strict": True, "schema": schema}},
)
msg = resp.choices[0].message
if msg.refusal:
    handle_refusal(msg.refusal)
out = json.loads(msg.content)        # schema-constrained
```

Keep validating the values in code (ranges, cross-field rules) where the provider does not enforce them, and keep the schema fixed for the life of a cached conversation.

## Don't break meaning
The schema must let the model say what it would have said in prose: allow `null` or an "unknown" value where the answer can be missing, and include a reasoning field before the answer field if the prose form relied on the model explaining first. A schema that forbids those forces an answer that may be wrong. Size the output limit for the whole object (LP-GE-03), since a cut-off object is still invalid. Run the answer check on a fixed set of inputs before and after.

## Verify
(a) Provider usage: `finish_reason` / `stop_reason` is `stop` / `end_turn` and the content parses on every call; no follow-up call after a parse failure; `output_tokens` / `completion_tokens` per task falls by the re-asks removed. On OpenAI, read `refusal` separately.

(b) leanprompt usage record: no records with `flags.parse_failed`, and no `flags.retry_of` records following one. Before the fix, each parse failure shows as a record with `flags.parse_failed` and a re-ask record pointing at it.

## Waste signal
Measured: output tokens of answers discarded after a parse failure (`flags.parse_failed`) count as generation waste. Static: severity high for a parse-and-re-ask loop; medium for JSON requested in the prompt with no schema on a provider that supports one.
<!-- leanprompt:generated v0.1.0-dev.3 — managed by npx leanprompt init; local edits are replaced on update -->
