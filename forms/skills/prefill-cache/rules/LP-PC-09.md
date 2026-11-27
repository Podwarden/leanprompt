---
id: LP-PC-09
title: Consistent reasoning handling; thinking fixed per session
skill: prefill-cache
applies_to: [anthropic, openai, vllm, lm-warden, sglang, openrouter]
saves: both
severity: high
evidence: [E7, E11]
---
## Rule
Decide once per session whether thinking is on, at what budget or effort, and how earlier reasoning is carried in the history, and keep all three the same on every turn; where the template writes the setting into the system message, keep it the same on every call that shares that prefix.

## Why
Chat templates and providers render earlier assistant turns differently depending on the thinking setting, so a setting that changes between turns changes the prefix behind them.

- On a self-hosted Qwen hybrid model, toggling thinking on and off between turns of one session lost 47% of what those turns could have reused; turns with the same setting as the turn before lost nothing (E7). The template rules are in [models/qwen.md](../../leanprompt/facts/models/qwen.md).
- Some templates write the setting into the system message itself. The Qwen3.8-27B template turns `reasoning_effort` into a sentence at the very start of the system message, before the tools and the app's system prompt, while thinking is on ([models/qwen.md](../../leanprompt/facts/models/qwen.md), "Where the template writes the effort"). There, two calls that share a long head and differ only in effort or thinking share no prefix, even single-turn calls with no history: one call kind that uses a different effort (a "think harder" button) loses the whole shared head on each of its calls.
- On Anthropic, the thinking mode and budget are rendered into the prompt, and changing either invalidates the message blocks ([models/anthropic-thinking.md](../../leanprompt/facts/models/anthropic-thinking.md)).
- On OpenAI reasoning models, reasoning items returned with tool calls are meant to be passed back in their original order ([models/openai-reasoning.md](../../leanprompt/facts/models/openai-reasoning.md)).

Stripping reasoning from history to save tokens changes the prefix from the first stripped turn on, and it can cost more than it saves: in agent loops it produced about 3x more generation (E11).

The shapes: a router that turns thinking on for "hard" turns only; an effort level picked per request by a heuristic; a history store that keeps only the final text of each assistant turn; one-shot calls that share a long head (a document, a chapter) and use different effort or thinking settings per call kind, on a template that renders the setting into the system message.

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

Where the setting renders: on a self-hosted model, look up the template in [models/qwen.md](../../leanprompt/facts/models/qwen.md) or read the served `chat_template.jinja`. If the app's repository does not show which template the server serves, the placement is a question for the server's administrator: record it as `needs-facts` with `fix_by: "server"`, written as a question ("does the served template write the effort into the system message?"), not as a defect.

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

If some steps need thinking and others do not, run them as separate sessions (a subagent with its own fixed setting) instead of toggling inside one. On a template that writes the effort into the system message, give each call kind that shares a long head one effort and one thinking setting, or put the call kind with a different setting on its own head, so the common calls keep their cached prefix.

## Don't break meaning
A fixed setting changes the turns that used to differ. If hard turns needed thinking, turn it on for the whole session (quality first), or move hard steps into their own session; do not silently turn it off. Keeping reasoning in history uses more context: if context is the limit, compact (LP-PC-08) instead of stripping per turn. Compare answers and output tokens per task on a fixed set before and after.

## Verify
(a) On consecutive turns, `cached_tokens` or `cache_read_input_tokens` is close to the previous request's prompt size. A turn whose read drops to the system prompt alone, right after a setting change, is this rule.

(b) kvsig: each request's exact `nodes` starts with all of the previous request's exact `nodes`. Use exact ids here: the loose form ignores reasoning, so `loose_nodes` that continue while exact `nodes` do not mean the reasoning was stripped or rendered differently.

## Waste signal
Measured: the prefill side lowers S on every turn after a change. The generation side (E11) is not part of G; it shows as more output tokens per task in a before/after run (the `measure-loop` skill). Static: severity high, counted on both the prefill and the generation side (`saves: both`).
<!-- leanprompt:generated v0.1.0-dev.14: written by npx leanprompt install; npx leanprompt update replaces local edits -->
