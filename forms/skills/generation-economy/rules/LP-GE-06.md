---
id: LP-GE-06
title: Cache exact responses for deterministic requests
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: both
severity: medium
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
When the app sends the same request again and wants the same answer (classifying a label set, extracting fields from a document it has seen, summarising an unchanged file), store the response in the app keyed by the exact request, and serve it from there instead of calling the model.

## Why
A provider's prompt cache only makes the prompt cheaper. The repeated call still pays for cached input at a reduced rate, pays the full price for every output token, and waits for the model to generate again ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md), [providers/openai.md](../../leanprompt/facts/providers/openai.md), [providers/gemini.md](../../leanprompt/facts/providers/gemini.md), [providers/deepinfra.md](../../leanprompt/facts/providers/deepinfra.md)). A self-hosted engine reuses the prefix but still spends the decode time ([providers/vllm.md](../../leanprompt/facts/providers/vllm.md), [providers/sglang.md](../../leanprompt/facts/providers/sglang.md)). None of the provider tables lists a response cache; it belongs in the app, and OpenRouter forwards each call to a provider like any other ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)).

The shapes: a pipeline that re-runs over every document each night although most did not change; a page that classifies the same product text on every view; a retry wrapper that resends a request that already succeeded; tests and evaluation runs that call the live model with fixed inputs.

## Detect in code
Python:
```
rg -n 'lru_cache|functools\.cache|diskcache|redis|@cache' -g '*.py'
rg -n 'def (classify|extract|summari[sz]e|label|tag)\w*\(' -g '*.py'
```
Shapes: `def classify(text): return client.chat.completions.create(...)` called from a view or a loop, with no cache in front; a nightly job that processes all rows instead of changed rows; a test suite that hits the API.

TS/JS:
```
rg -n 'async function (classify|extract|summari[sz]e|label)\w*\(|new Map\(|lru-cache|keyv' -g '*.{ts,tsx,js,mjs}'
```
Shapes: a request handler that calls the model with the same inputs on every page view.

Go:
```
rg -n 'func (Classify|Extract|Summari[sz]e|Label)\w*\(|groupcache|ristretto|bigcache' -g '*.go'
```
Shapes: a handler that calls the model for an entity whose text has not changed since the last call.

Not a finding: requests that are meant to vary (sampling, chat replies), and requests whose prompt carries time-relative or changing content.

## Fix
Key the cache on everything that can change the answer: the model, every sampling and output parameter, the tools and the full prompt. A canonical JSON of the request body works. kvsig gives most of a ready-made key: the exact `nodes` id of the last message (the whole prompt), plus the model and a hash of the parameters.

```python
# before
def classify(text: str) -> str:
    resp = client.chat.completions.create(model=MODEL, messages=build(text), temperature=0)
    return resp.choices[0].message.content

# after
def classify(text: str) -> str:
    body = {"model": MODEL, "messages": build(text), "temperature": 0}
    key = sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if (hit := store.get(key)) is not None:
        return hit
    out = client.chat.completions.create(**body).choices[0].message.content
    store.set(key, out, ttl=RESULT_TTL)   # expire when the prompt, model or data version changes
    return out
```

For batch pipelines, the cheaper form is often to skip unchanged inputs: store a hash of each input with its result and process only rows whose hash changed.

## Don't break meaning
Serve a stored answer only when a fresh call would be expected to give the same answer: the request is identical, the app treats one answer as the answer (temperature zero or a fixed choice), and nothing outside the request changed (the date, a tool result, a database row). Put the model and prompt version in the key, so a prompt change misses the cache instead of serving old answers. Never share cached answers across users or tenants when the request carries their data. Do not cache refusals, errors or truncated answers.

## Verify
(a) Provider usage: the number of calls and their `prompt_tokens` and `output_tokens` / `completion_tokens` fall by the hit count; for the requests that remain, `cached_tokens` behaviour is unchanged.

(b) leanprompt usage record: before, several records with equal exact `ids.nodes` for the last message and an equal `params` hash; after, one record per distinct request within the cache lifetime. The `output_tokens` of the duplicates is the waste removed. kvsig: equal exact `nodes[i]` for the last message plus equal `params` is the duplicate the audit looks for.

## Waste signal
Measured: output tokens on calls repeated identically (same exact ids, same `params`) count as generation waste. Static: severity medium for a deterministic call (temperature zero, a classification or extraction prompt) on a path that runs repeatedly for the same input with no cache in front; low for tests that call the live model.
<!-- leanprompt:generated v0.1.0-dev.13: written by npx leanprompt install; npx leanprompt update replaces local edits -->
