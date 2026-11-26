---
id: LP-PC-09
title: Consistent reasoning handling; thinking fixed per session
skill: prefill-cache
applies_to: [anthropic, openai, vllm, sglang, openrouter]
saves: both
severity: high
evidence: [E7, E11]
---
## Rule
Decide once per session whether thinking is on, at what budget or effort, and how earlier reasoning is carried in the history, and keep all three the same on every turn.

## Why
Chat templates and providers render earlier assistant turns differently depending on the thinking setting, so a setting that changes between turns changes the prefix behind them.

- On a self-hosted Qwen hybrid model, toggling thinking on and off between turns of one session lost 47% of what those turns could have reused; turns with the same setting as the turn before lost nothing (E7). The template rules are in [models/qwen.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/models/qwen.md).
- On Anthropic, the thinking mode and budget are rendered into the prompt, and changing either invalidates the message blocks ([models/anthropic-thinking.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/models/anthropic-thinking.md)).
- On OpenAI reasoning models, reasoning items returned with tool calls are meant to be passed back in their original order ([models/openai-reasoning.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.6/models/openai-reasoning.md)).

Stripping reasoning from history to save tokens changes the prefix from the first stripped turn on, and it can cost more than it saves: in agent loops it produced about 3x more generation (E11).

The shapes: a router that turns thinking on for "hard" turns only; an effort level picked per request by a heuristic; a history store that keeps only the final text of each assistant turn.

## Detect in code
Python:
```
rg -n 'enable_thinking|reasoning_effort|budget_tokens|thinking=|reasoning_content|"thinking"' -g '*.py'
```
Shapes: `extra_body={"chat_template_kwargs": {"enable_thinking": is_hard(msg)}}`; `reasoning_effort=pick_effort(msg)`; `thinking={"type": "enabled", "budget_tokens": budget_for(turn)}`; `m.pop("reasoning_content", None)` or `[b for b in content if b.type != "thinking"]` when saving history.

TS/JS:
```
rg -n 'enable_thinking|reasoning_effort|reasoningEffort|budget_tokens|thinking:|reasoning_content|type !== "thinking"' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `reasoning_effort: hard ? "high" : "low"`; `content.filter(b => b.type !== "thinking")`; `delete msg.reasoning_content`.

Go:
```
rg -n 'EnableThinking|ReasoningEffort|BudgetTokens|ReasoningContent|Thinking' -g '*.go'
```
Shapes: `ReasoningEffort: effortFor(turn)`; history rebuilt from `resp.Choices[0].Message.Content` only, dropping the reasoning field.

## Fix
Fix the setting on the session object, and store each assistant turn as it came back.

```python
# before
kwargs = {"enable_thinking": is_hard(user_msg)}
history.append({"role": "assistant", "content": msg.content})        # reasoning dropped

# after
kwargs = {"enable_thinking": session.thinking}                       # chosen once, at session start
history.append(msg.model_dump(exclude_none=True))                    # reasoning kept as returned
```

```ts
// before
reasoning_effort: isHard(input) ? "high" : "low",
// after
reasoning_effort: session.effort,   // one value for the whole session
```

If some steps need thinking and others do not, run them as separate sessions (a subagent with its own fixed setting) instead of toggling inside one.

## Don't break meaning
A fixed setting changes the turns that used to differ. If hard turns needed thinking, turn it on for the whole session (quality first), or move hard steps into their own session; do not silently turn it off. Keeping reasoning in history uses more context: if context is the limit, compact (LP-PC-08) instead of stripping per turn. Compare answers and output tokens per task on a fixed set before and after.

## Verify
(a) On consecutive turns, `cached_tokens` or `cache_read_input_tokens` is close to the previous request's prompt size. A turn whose read drops to the system prompt alone, right after a setting change, is this rule.

(b) kvsig: each request's exact `nodes` starts with all of the previous request's exact `nodes`. Use exact ids here: the loose form ignores reasoning, so `loose_nodes` that continue while exact `nodes` do not mean the reasoning was stripped or rendered differently.

## Waste signal
Measured: the prefill side lowers S on every turn after a change. The generation side (E11) is not part of G; it shows as more output tokens per task in a before/after run (the `measure-loop` skill). Static: severity high, counted on both the prefill and the generation side (`saves: both`).
<!-- leanprompt:generated v0.1.0-dev.6 — managed by npx leanprompt init; local edits are replaced on update -->
