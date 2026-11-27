---
id: LP-GE-14
title: Build both sides of a cache or change key the same way
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, deepseek, groq, xai, together, vllm, lm-warden, sglang, any]
saves: both
severity: high
evidence:
  - doc: https://docs.python.org/3/library/hashlib.html
    checked: 2026-11-27
---
## Rule
When the app skips an LLM call because it has seen the input before (a response cache, a "changed since last run" check, a dedupe set, a "page already exists" test), build the key it stores and the key it looks up with the same function, so a repeat can actually hit.

## Why
A cache or change check that never matches is worse than none: the app pays for every call again and its author believes it does not. The two sides of the key are usually written in different places at different times, and drift:

- **Normalisation:** one side lower-cases, strips or replaces spaces with underscores (`Andrej_Karpathy.md`), the other looks up the raw name (`Andrej Karpathy`).
- **Hash length or kind:** one side stores a 16-character prefix of a hash, the other compares the full 64-character digest, or one hashes bytes and the other a decoded string.
- **Something per run in the key:** a timestamp, a request id, a random seed, a temp path, the order of a set or a dict.
- **Different inputs:** the stored key covers the prompt, the lookup covers the prompt plus the model or the settings (or the reverse), so a key never matches after any setting changes, or matches when it should not.

Every miss sends the call again: on a nightly or batch path that is the whole job's prompt and output each run. The provider's prompt cache does not save it: at best it serves the repeated prefix at the cached rate, and the output is generated and billed again ([providers/openai.md](../../../providers/openai.md), [providers/anthropic.md](../../../providers/anthropic.md)). This rule is the bug in a cache the app already has; LP-GE-06 is about adding one where there is none.

## Detect in code
Find each place a key is written and each place it is read, and compare how each is built.

Python:
```
rg -n 'hashlib\.|\.hexdigest\(\)|\[:(8|12|16|32)\]|sha256|md5' -g '*.py'
rg -n 'if .* in (seen|cache|done|processed)|\.exists\(\)|os\.path\.exists|cache\.get\(|lru_cache' -g '*.py'
rg -n '\.replace\(" ", "_"\)|\.lower\(\)|slugify|datetime\.now\(\)|time\.time\(\)|uuid' -g '*.py'
```
TS/JS:
```
rg -n "createHash|digest\('hex'\)|\.slice\(0, ?(8|12|16|32)\)|cache\.(get|has)\(|existsSync|Date\.now\(\)" -g '*.{ts,tsx,js,mjs}'
```
Go:
```
rg -n 'sha256\.|hex\.EncodeToString|\[:16\]|os\.Stat\(|cache\[' -g '*.go'
```
Shapes: `stored = sha256(text).hexdigest()[:16]` beside `if sha256(text).hexdigest() != stored`; a file saved as `name.replace(" ", "_")` and checked with `exists(name)`; `key = f"{prompt}:{time.time()}"`; `JSON.stringify(obj)` of an object whose key order varies; a cache keyed by the prompt and looked up by the prompt plus the model. Also read the project's docs and cron or shell recipes: a schedule that re-runs every input each night shows how often the miss costs.

Not this rule: no cache at all in front of a repeated deterministic call (that is LP-GE-06); a cache that hits but is never cleared (no tokens lost).

## Fix
```python
# before
def save_hash(path, text):  db[path] = sha256(text.encode()).hexdigest()[:16]
def changed(path, text):    return db.get(path) != sha256(text.encode()).hexdigest()

# after: one function builds the key, both sides call it
def content_key(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()
def save_hash(path, text):  db[path] = content_key(text)
def changed(path, text):    return db.get(path) != content_key(text)
```

Keep anything per run out of the key, and put every setting that changes the answer (model, temperature, prompt version) in it on both sides. Existing stored keys in the old form will miss once; say so in the change, or migrate them.

## Don't break meaning
A key that starts to hit makes the app skip calls it used to make. Check that everything that should force a new call (a changed input, a changed prompt or model) is in the key, so the fix never serves a stale answer.

## Verify
(a) Provider usage: run the job twice on unchanged input. Before, the second run makes as many calls, and bills as many `output_tokens`, as the first; after, it makes none (or only for inputs that changed).

(b) leanprompt usage record: two runs over the same input. Before, the second run repeats records with equal `ids.nodes` and `params`, each with its own `output_tokens`; after, there are none. A unit test that writes a key and looks it up with the same input passes.

## Waste signal
Measured: the calls of the second run over unchanged input count as generation waste (repeated identical calls). Static: severity high when the miss is on a scheduled or batch path (every run redoes every input), medium when it is on a path a person triggers. The share is the fraction of calls the working key would have skipped, from the schedule and how much of the input changes between runs. When a run is a natural unit (one nightly job, one ingest), give the tokens per run (`"unit": "run"`). When the miss causes no repeated LLM call (a cache in front of a non-LLM step), it is not this rule: record it as a note.
