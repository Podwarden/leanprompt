---
id: LP-PC-04
title: Fixed tool order and JSON key order
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang]
saves: prefill
severity: high
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
Build the tool list in one fixed order and serialise every JSON value in the prompt (tool schemas, tool-call arguments, tool results, structured context) the same way every time.

## Why
The tool list is part of the prefix: first on Anthropic; after the system prompt on OpenAI and DeepInfra as observed, not documented (render-order rows in [providers/openai.md](../../../providers/openai.md) and [providers/deepinfra.md](../../../providers/deepinfra.md)); wherever the chat template puts it on a self-hosted engine. A different tool order, or the same schema with its keys in a different order, is a different prompt even though it means the same thing. On Anthropic a change to the tool definitions invalidates tools, system and messages ([providers/anthropic.md](../../../providers/anthropic.md)); OpenAI requires the whole rendered prefix to match ([providers/openai.md](../../../providers/openai.md)). Documented, not yet measured here.

Common causes: a registry filled in import or plugin-load order; MCP servers whose tools are listed in registration order, which depends on which server connected first; tools collected from concurrent discovery in completion order; a `set` of tools; Go `map` iteration, which is randomised on every run; dicts built in varying order and dumped without sorting; a schema generator whose field order changed between library versions.

## Detect in code
Python:
```
rg -n -i 'registry\.(values|items)\(\)|for .* in .*(tools|registry)|set\(.*tool|as_completed\(|json\.dumps\(' -g '*.py'
```
Shapes: `tools = [t.schema() for t in REGISTRY.values()]` where `REGISTRY` is filled by decorators at import time; `tools = list({*base_tools, *mcp_tools})`; MCP tools gathered with `asyncio.as_completed` and appended in arrival order; `json.dumps(result)` on a dict whose keys arrive in varying order, or `json.dumps(..., sort_keys=False)` in one path and `sort_keys=True` in another.

TS/JS:
```
rg -n 'Object\.(keys|values|entries)\((registry|tools)|new Set\(|Promise\.race\(|JSON\.stringify\(' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `tools: Object.values(registry)` with `registry` filled as servers connect; `for await (const server of servers) tools.push(...await server.listTools())`; objects assembled from spreads in different orders before `JSON.stringify`.

Go:
```
rg -n 'for .*range .*(tools|Tools|registry)|map\[string\].*Tool' -g '*.go'
```
Shapes: `for _, t := range toolsByName { params.Tools = append(params.Tools, t) }` over a `map`; goroutines appending discovered tools to a shared slice under a mutex.

## Fix
Fix the order once at session start (sorting by name is the easy way) and serialise canonically.

```python
# before
tools = [t.schema() for t in REGISTRY.values()]
content = json.dumps(result)
# after
tools = [REGISTRY[name].schema() for name in sorted(REGISTRY)]
content = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
```

```ts
// before
const tools = Object.values(registry);
// after
const tools = Object.keys(registry).sort().map((name) => registry[name]);
```

```go
// before
for _, t := range toolsByName { tools = append(tools, t) }
// after
for _, name := range slices.Sorted(maps.Keys(toolsByName)) { tools = append(tools, toolsByName[name]) }
```

A tool loaded later in the session goes at the end, not into its sorted position (LP-PC-05). Serialise a tool result once, when it is first added to the history, and keep that string (LP-PC-06).

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds the request twice, in two process starts or with two seeds, and asserts its kvsig `tools` id is equal catches a refactor that changes the tool order or the key order. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
Some models favour tools listed earlier. If the existing order was deliberate (the most important tool first), keep that order and make it fixed rather than sorting. After a change of order, run the app's tool-choice check on a fixed set of tasks. Key order inside JSON does not change its meaning; field descriptions and `required` lists must stay as they were.

## Verify
(a) Restart the process (new registration order, new map iteration) and send the same first request before and after the restart. The second reports `cached_tokens` or `cache_read_input_tokens` covering the tool list.

(b) kvsig: exact `tools` is equal across two runs of the app. `loose_tools` equal with exact `tools` different means only the member order inside schemas or arguments changed (the loose form ignores it): a key-order problem, not a tool-order one.

## Waste signal
Measured: order that varies per process or per conversation shows as several `tools` ids for one tool set and a short shared prefix on first requests; order that varies per call inside a conversation lowers S. Static: severity high for a tool list built by iterating a map, set or registry without a fixed order, medium for unsorted JSON serialisation of content that goes back into the prompt.
