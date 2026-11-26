---
id: LP-PC-05
title: Tool lists grow only at the end
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang]
saves: prefill
severity: medium
evidence: [E3]
---
## Rule
When a tool is added during a session, append it after the existing tools and never insert, remove or re-sort; on a provider that renders tools first (Anthropic), declare the full tool set at session start instead.

## Why
On caches that render the system prompt before the tools (observed for OpenAI and DeepInfra, not documented: render-order rows in [providers/openai.md](../../../providers/openai.md) and [providers/deepinfra.md](../../../providers/deepinfra.md)), appending a tool at the end keeps everything before it: after one deferred tool was appended, DeepInfra still cached 10,176 of 21,149 prompt tokens (E3). Inserting the tool in the middle, or re-sorting, loses everything after the insertion point.

Anthropic renders tools first, so any change to the tool list also invalidates the system prompt and the messages after it. The same append cached 0 there, with no breakpoint in front of the change (E3). A mark on the last original tool should keep at least that tool block, because marks are written at a block boundary. This is untested: E3 had no breakpoint in front of the change, and the docs do not describe this case ([providers/anthropic.md](../../../providers/anthropic.md)). Even if it works, the system prompt and history are recomputed once.

The shapes that do this: an MCP server that connects mid-session, a tool loaded on demand (tool search, a skill or plugin activated by the conversation), tools filtered per turn by relevance to the current message. A related case: on OpenAI, `tool_choice: "none"` drops the tool definitions from the rendered prompt, so switching `tool_choice` between turns changes the prefix ([providers/openai.md](../../../providers/openai.md)).

## Detect in code
Python:
```
rg -n 'tools\.insert\(|tools\s*=\s*(select|filter|relevant)\w*\(|tool_choice\s*=.*if ' -g '*.py'
```
Shapes: `tools = relevant_tools(user_message)` on every turn; `tools.insert(0, new_tool)`; `tools = sorted(tools + [new_tool], key=...)` after an on-demand load; `tool_choice="none" if final_turn else "auto"`.

TS/JS:
```
rg -n 'tools\.(unshift|splice)\(|tools\s*=\s*\w*(select|filter|relevant)\w*\(|toolChoice|tool_choice' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `tools.unshift(loaded)`; `tools: pickTools(input)` per call; `client.on("connect", s => tools = [...s.tools, ...tools])`.

Go:
```
rg -n 'append\(\[\]\w*Tool\w*\{|slices\.Insert\(|sort\.Slice\(tools|ToolChoice' -g '*.go'
```
Shapes: `tools = append([]Tool{loaded}, tools...)` (a prepend); `slices.Insert(tools, i, loaded)`; `sort.Slice(tools, ...)` after a load.

## Fix
Keep the base list fixed for the session and append.

```python
# before
tools = sorted([*tools, loaded], key=lambda t: t["name"])
# after
tools = [*tools, loaded]          # the base list keeps its order; new tools go last
```

```ts
// before
const tools = pickTools(userMessage);          // a different subset every turn
// after
const tools = ALL_TOOLS;                       // one list for the session; steer with instructions
```

On Anthropic, load every tool the session may need before the first request. If a late tool cannot be avoided, a mark on the last original tool (LP-PC-01) may keep the tool block; this is untested here, so check it with step (a) of Verify before relying on it.

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds every turn of a session that loads a tool part way through and asserts the kvsig `sys` id is equal on every turn catches a late tool that rewrites the system prompt. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
More tools in view can change which tool the model picks, so run the app's tool-choice check on a fixed set of tasks after declaring tools up front. Tools gated for permission or safety stay gated: a tool the user may not use must not be exposed to save cache. Enforce the gate in the code that executes tool calls and say so in the instructions, or keep the gated tools out of the session's list from the start. Replacing per-turn filtering with one list needs the same tool-choice check.

## Verify
(a) Load a tool mid-session. On automatic caches the next request still reports `cached_tokens` covering the system prompt and the tools before the new one. On Anthropic with all tools declared at start, `cache_read_input_tokens` covers the previous turn on every request. If you rely on a mark on the last original tool instead, the request after the append must report `cache_read_input_tokens` of at least the original tool block; if it reports 0, the workaround does not hold for your model, so declare all tools at the start.

(b) kvsig: inside one conversation (`conv`), `sys` is equal on every turn and `tools` changes only on the turns where a tool was added (the "same conv, sys equal, tools differ" case). On Anthropic, `tools` is equal on every turn of the session.

## Waste signal
Measured: each tool change lowers S on the turn where it happens; per-turn filtering lowers it on most turns. Static: severity medium for an on-demand load, a prepend or a re-sort, and for per-turn filtering or a per-turn `tool_choice` switch.
