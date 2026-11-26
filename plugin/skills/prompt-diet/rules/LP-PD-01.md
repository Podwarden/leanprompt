---
id: LP-PD-01
title: Offer each route only the tools it can use
skill: prompt-diet
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang, any]
saves: prefill
severity: medium
evidence:
  - E11
  - doc: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/function-calling
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
  - doc: https://aistudio.google.com/docs/function-calling
    checked: 2026-11-26
---
## Rule
Give each route (a kind of call with its own job) a fixed tool list that holds only the tools the app's flow lets the model use on that route, instead of sending every registered tool on every call.

## Why
Tool definitions are prompt tokens. Anthropic prices tool use on all input tokens "including in the `tools` parameter" and adds a tool use system prompt whenever a tool is present; OpenAI says function definitions "count against the model's context limit and are billed as input tokens"; Gemini says every function declaration "is billed as input tokens on every request" ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.11/providers/anthropic.md), [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.11/providers/openai.md), [providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.11/providers/gemini.md)). A title call, a classifier or a summariser that is sent the agent's whole tool registry pays for tools it is never allowed to call, and a self-hosted engine spends prefill time and KV memory on them ([providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.11/providers/vllm.md)).

The cache pulls the other way. Tools render first on Anthropic and sit in the cached prefix on OpenAI, so a tool list that changes from call to call within one conversation loses the whole cached prefix on every change (LP-PC-04, LP-PC-05). The fix is therefore per route, not per call: each route has one list that never changes while its conversations run. Where a route's turns need different subsets, keep the list and restrict the choice instead: OpenAI `tool_choice: {"type": "allowed_tools", ...}` restricts which tools may be called while the list stays the same, which the docs give as the way to keep prompt caching ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.11/providers/openai.md)). Documented, not yet measured here.

## Detect in code
Python:
```
rg -n 'tools\s*=\s*(ALL_TOOLS|TOOLS|registry|tool_registry|get_tools\(\))|tools=\[\*|list_tools\(\)' -g '*.py'
rg -n 'tool_choice\s*=\s*["\x27]none|tool_choice=\{"type":\s*"none' -g '*.py'
```
Shapes: one module-level `TOOLS` (or every MCP server's tools) passed to every `create(...)` call, including calls whose code never handles a `tool_use` or `tool_calls` reply; `tool_choice="none"` on a call that still sends the full list; a list built per call from the user's message or permissions inside one conversation (that is a cache break, LP-PC-04).

TS/JS:
```
rg -n 'tools:\s*(allTools|TOOLS|registry|Object\.values\(tools\)|await \w+\.listTools\(\))' -g '*.{ts,tsx,js,mjs}'
```
Shapes: Vercel AI SDK `generateText({ tools: allTools, ... })` for a call that only needs text; one shared options object with `tools` spread into every request.

Go:
```
rg -n 'Tools:\s*(allTools|AllTools|registry\.|tools\b)' -g '*.go'
```
Shapes: one package-level `[]Tool` slice used in the params of every request type.

## Fix
```python
# before: every call gets the whole registry
TOOLS = registry.all()
title = client.messages.create(model=M, tools=TOOLS, messages=[ask_for_title(chat)], max_tokens=64)
answer = client.messages.create(model=M, tools=TOOLS, system=AGENT_SYSTEM, messages=history, max_tokens=2048)

# after: one fixed, sorted list per route, built once
ROUTE_TOOLS = {
    "title": [],                                                     # never calls a tool
    "agent": sorted(registry.for_agent(), key=lambda t: t["name"]), # the same list on every turn
}
title = client.messages.create(model=M, messages=[ask_for_title(chat)], max_tokens=64)
answer = client.messages.create(model=M, tools=ROUTE_TOOLS["agent"], system=AGENT_SYSTEM, messages=history, max_tokens=2048)
```

On OpenAI, when one conversation needs a smaller set for some turns, keep the list and narrow the choice:

```python
tool_choice={"type": "allowed_tools", "mode": "auto", "tools": [{"type": "function", "name": "search_docs"}]}
```

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds two calls of one route and asserts their kvsig `tools` id is equal shows each route keeps one fixed tool list, so the smaller list is still cached. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
Remove a tool from a route only when the code shows the model can never use it there: no handler for it on that route, or a flow that forbids it. A tool the model rarely calls may still be the one it needs; check the logs or the code path, not your intuition. Run the answer check with `measure-loop` on a fixed set of inputs for that route, before and after: answers unchanged or better, and no new "I cannot do that" replies. Weigh the cache before changing the agent's own list: the tools are the start of its cached head, so change them once, in one release, and never per call. Do not drop tool calls or tool results from the history to match the new list; stripping what the model already did made it redo the work: about 3x more generation (E11). The head and what keeps it cached: [prefill-cache](../../prefill-cache/SKILL.md).

## Verify
(a) Provider usage: `usage.input_tokens` (Anthropic), `usage.prompt_tokens` or `usage.input_tokens` (OpenAI, Gemini `promptTokenCount`) per call on the trimmed route falls by about the size of the removed tool definitions. On the agent route, `cache_read_input_tokens` or `cached_tokens` on the second turn is at least the size of the new head, as before the fix.

(b) leanprompt usage record: `prompt_tokens` for the route's calls falls; `ids.tools` is the same on every call of the route (the list is fixed per route), and `ids.head` stays equal within each conversation.

## Waste signal
Measured: the drop in `prompt_tokens` per call on the route, times its calls; the score does not count it, the report shows it as `tokens_per_1k.prompt`. Static: severity medium for a full tool registry sent on a route that cannot call any tool or most of them; low when only a few unused tools are sent. A tool list that changes per call within a conversation is an LP-PC-04 or LP-PC-05 finding, not this one.
<!-- leanprompt:generated v0.1.0-dev.11: written by npx leanprompt install; npx leanprompt update replaces local edits -->
