---
id: LP-PC-02
title: Stable content first, without hurting meaning
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang]
saves: prefill
severity: high
evidence: [E6]
---
## Rule
Put the content that is the same across requests first; make a dynamic value stable (a date instead of a timestamp) or move it into the newest user message together with the text that refers to it, and re-check answers after any reordering.

## Why
Every prefix cache matches from the first token and stops at the first difference; everything after a changed byte is recomputed. Render order decides what "first" means: Anthropic renders tools, then system, then messages; on OpenAI and DeepInfra the system prompt appears to render before the tools (observed, not documented: the render-order rows in [providers/openai.md](../../../providers/openai.md) and [providers/deepinfra.md](../../../providers/deepinfra.md)); self-hosted engines follow the model's chat template, which you can read. A value that changes per request near the top (a timestamp, a user's name, the retrieved chunks for this query) makes the long stable text after it unreusable.

The obvious fix, "move everything dynamic to the end", is not always safe. Text that tells the model what a value means can end up far from the value, and answers that depend on it get worse. The general rule is therefore stable first without hurting meaning, not dynamic last (E6).

## Detect in code
Look at every function that builds a system prompt or the first messages, and ask of each interpolated value: is it the same on the next request?

Python:
```
rg -n 'datetime\.(now|utcnow)\(|time\.time\(|date\.today\(' -g '*.py'
rg -n -i '(system|instructions)\w*\s*=\s*f"' -g '*.py'
```
Shapes: `system = f"Current time: {datetime.now().isoformat()}\n{INSTRUCTIONS}"`; `prompt = context + "\n\n" + INSTRUCTIONS` with retrieved chunks before the instructions; few-shot examples chosen per query and placed before fixed instructions.

TS/JS:
```
rg -n 'new Date\(|Date\.now\(|toISOString\(' -g '*.{ts,tsx,js,mjs}'
rg -n 'system:\s*`|role:\s*"system"' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` system: `Now: ${new Date().toISOString()}\n${INSTRUCTIONS}` ``; `[chunks.join("\n"), INSTRUCTIONS].join("\n\n")`.

Go:
```
rg -n 'time\.Now\(\)|fmt\.Sprintf\(.*(system|System|prompt|Prompt)' -g '*.go'
```
Shapes: `fmt.Sprintf(systemTmpl, time.Now().Format(time.RFC3339), instructions)`; `strings.Join([]string{retrieved, instructions}, "\n\n")`; a `text/template` whose first lines print request data.

## Fix
Stabilise before you move.

1. Coarsen the value: a date changes once a day, a timestamp on every call.
2. If the value is truly per request (the question, the chunks retrieved for it), put it in the newest user message, together with the sentence that says what it is.
3. Put long stable text (instructions, reference documents, examples) before short dynamic text.

```python
# before
system = f"Current time: {datetime.now().isoformat()}\n{INSTRUCTIONS}\n\nContext:\n{chunks}"
messages = [{"role": "user", "content": question}]

# after
system = f"{INSTRUCTIONS}\n\nToday's date is {date.today().isoformat()}. Use it to resolve relative dates."
messages = [{"role": "user", "content": f"Context for this question:\n{chunks}\n\nQuestion: {question}"}]
```

```ts
// before
const system = `Now: ${new Date().toISOString()}\n${INSTRUCTIONS}`;
// after
const today = new Date().toISOString().slice(0, 10);
const system = `${INSTRUCTIONS}\n\nToday's date is ${today}. Use it to resolve relative dates.`;
```

## Don't break meaning
In the reorder experiment, moving date lines to the end of the prompt cut correct date answers from 10/12 to 1/12, lowered the control question too, and did not help caching (E6). A value must stay next to the text that tells the model how to use it: "Today's date is 2026-11-26. Use it to resolve relative dates." moves as one unit or not at all.

- After any reorder, run the app's answer check on a fixed input set before and after. A change that saves tokens and fails the check is not a fix.
- Coarsening a timestamp to a date changes meaning only if the app needs the time of day; then pass the time in the newest user message.
- Retrieved chunks moved into the user message must keep their label, and instructions that said "the context above" must still be true.

## Verify
(a) Send two requests built for two different moments (or two users) that share the stable part. The second reports `cached_tokens` (OpenAI-compatible APIs, vLLM) or `cache_read_input_tokens` (Anthropic) covering the stable part.

(b) kvsig: build the request for two fixed `now` values (or two users) and compare. Exact `sys` must be equal when the date is unchanged; with the per-request part in the newest user message, `head` and every `nodes[i]` before that message are equal too. `loose_sys` equal with exact `sys` different means a date line or similar noise is still in the system prompt.

## Waste signal
Measured: a value that changes on every turn lowers S, because each request shares little with the turn before; a value that changes per user or per day shows as more distinct `sys` and `head` ids than the app has prompts. Static: severity high when a per-call value (timestamp, id, query, retrieved chunks) comes before long stable text.
