---
id: LP-GE-03
title: Output and thinking budgets that fit the task
skill: generation-economy
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: generation
severity: high
evidence:
  - E11
  - doc: https://developers.openai.com/api/docs/guides/reasoning
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
    checked: 2026-11-26
  - doc: https://docs.vllm.ai/en/latest/features/reasoning_outputs.html
    checked: 2026-11-26
---
## Rule
Set an output limit and a thinking or effort level on every call, sized from the outputs the task really produces: high enough that a correct answer is never cut off, low enough that a runaway output stops.

## Why
Output tokens are the slow and expensive part of a call, and three mistakes waste them.

- **No limit, or a limit far above the task.** A reasoning model with thinking on by default and no output limit can think until it reaches the token ceiling and return no answer at all: every token is billed and the app gets nothing. Thinking and reasoning tokens count toward the output limit and are billed as output on Anthropic and OpenAI ([models/anthropic-thinking.md](../../leanprompt/facts/models/anthropic-thinking.md), [models/openai-reasoning.md](../../leanprompt/facts/models/openai-reasoning.md)); OpenAI notes that hitting the limit can end a response as `incomplete` before any visible output. Self-hosted Qwen hybrid models think unless `enable_thinking` is set to false, and one template defaults to its highest effort ([models/qwen.md](../../leanprompt/facts/models/qwen.md)).
- **A limit below the task.** The answer is cut off (`finish_reason: "length"`, `stop_reason: "max_tokens"`, `finishReason: "MAX_TOKENS"`), the app throws it away and asks again, often with the same limit (LP-GE-05). The truncated tokens were paid for and are lost.
- **Reasoning twice.** The prompt or the schema asks for a written reasoning, rationale or explanation field while the model's own thinking is also on. The model reasons in its thinking and again in the visible answer, and both count against one output limit, so outputs grow and truncations become more likely (LP-GE-05). This follows from thinking tokens counting toward the output limit; not yet measured here. Keep one: thinking on and no reasoning field, or thinking off and a reasoning field before the answer (LP-GE-10).

Thinking effort is the larger lever. Pick the effort or budget per kind of task (a title needs none, a multi-step plan may need a lot), and keep it fixed within a session, since changing it changes the cached prefix (LP-PC-09). Do not save thinking tokens by stripping earlier reasoning from the history: in agent loops that produced about 3x more generation (E11).

Where the controls are: OpenAI `max_output_tokens` / `max_completion_tokens` and `reasoning_effort` ([providers/openai.md](../../leanprompt/facts/providers/openai.md)); Anthropic `max_tokens` and adaptive thinking with `effort` ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)); Gemini `maxOutputTokens`, `thinkingBudget`, `thinkingLevel` ([providers/gemini.md](../../leanprompt/facts/providers/gemini.md)); OpenRouter `max_tokens`, which covers reasoning and visible output together on most providers ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)); vLLM and SGLang `max_tokens` plus the model's template kwargs ([providers/vllm.md](../../leanprompt/facts/providers/vllm.md), [providers/sglang.md](../../leanprompt/facts/providers/sglang.md)).

## Detect in code
Python:
```
rg -n 'chat\.completions\.create\(|responses\.create\(|messages\.create\(|generate_content\(' -g '*.py'
rg -n 'max_tokens|max_completion_tokens|max_output_tokens|reasoning_effort|budget_tokens|effort|enable_thinking|thinking_budget' -g '*.py'
```
Shapes: a call to a reasoning or hybrid-thinking model with no output limit; a prompt or schema that asks for a `"reasoning"`, `"rationale"` or `"explanation"` field, or says "think step by step", on a call whose model thinking is on (reasoning twice; for a self-hosted Qwen model, thinking is on unless `enable_thinking` is false in the request or in the server's `--default-chat-template-kwargs`, [vLLM reasoning outputs](https://docs.vllm.ai/en/latest/features/reasoning_outputs.html), checked 2026-11-26); `max_tokens=MODEL_MAX` (the model's maximum used as a default for every call); one effort level, usually the highest, for every call including titles and labels; a small fixed limit on a call that produces long outputs (summaries, code).

TS/JS:
```
rg -n 'max_tokens|maxTokens|max_completion_tokens|max_output_tokens|maxOutputTokens|reasoning_effort|reasoningEffort|budget_tokens|thinkingBudget' -g '*.{ts,tsx,js,mjs}'
```
Shapes: Vercel AI SDK `generateText({ model, prompt })` with no `maxOutputTokens`; `reasoningEffort: "high"` in a shared default options object.

Go:
```
rg -n 'MaxTokens|MaxCompletionTokens|MaxOutputTokens|ReasoningEffort|BudgetTokens' -g '*.go'
```
Shapes: `MaxTokens: 0` or unset on a reasoning model; one package-level params value reused for every kind of call.

## Fix
Measure first: log `output_tokens` per kind of call for a few days, or run the answer-check inputs, then set each limit above the longest correct output seen, with headroom, and pick the lowest effort that passes the answer check.

```python
# before: every call, from titles to plans, at the model maximum and the highest effort
resp = client.responses.create(model=MODEL, input=msgs, reasoning={"effort": "high"})

# after: budgets per kind of task, from measured outputs
BUDGETS = {
    "title":  {"max_output_tokens": TITLE_LIMIT,  "reasoning": {"effort": "low"}},
    "answer": {"max_output_tokens": ANSWER_LIMIT, "reasoning": {"effort": "medium"}},
    "plan":   {"max_output_tokens": PLAN_LIMIT,   "reasoning": {"effort": "high"}},
}
resp = client.responses.create(model=MODEL, input=msgs, **BUDGETS[kind])
```

Self-hosted Qwen, where a call needs no thinking:

```python
extra_body={"chat_template_kwargs": {"enable_thinking": False}}   # fixed for the whole session (LP-PC-09)
```

The allowed effort values differ by model; take them from the model tables, not from memory.

## Don't break meaning
Less thinking and shorter outputs can change answers. Lower an effort level or a limit only after an answer check on a fixed set of inputs passes with the new value, and never set a limit below the longest correct answer in that set. When quality is the priority, keep thinking on and raise limits until no correct answer is truncated; caching still applies. Do not change thinking per turn inside a cached session (LP-PC-09). Before dropping a reasoning field to end reasoning twice, check whether the app reads or shows that field; if it does, keep the field and turn thinking off instead, or show the thinking where the server returns it separately. Either way, run the answer check.

## Verify
(a) Provider usage: the share of calls ending with `finish_reason: "length"` (Chat Completions), `status: "incomplete"` (Responses), `stop_reason: "max_tokens"` (Anthropic) or `finishReason: "MAX_TOKENS"` (Gemini) falls to zero on calls that should finish; `output_tokens` per kind of call falls where the limit or effort was above the task. Thinking tokens show in `usage.output_tokens_details.thinking_tokens` (Anthropic) or `thoughtsTokenCount` (Gemini).

(b) leanprompt usage record: no records with `finish: "length"` for that kind of call, and the spread of `output_tokens` sits below the limit. Records with `finish: "length"` followed by a record with `flags.retry_of` pointing at them are the waste this rule removes.

## Waste signal
Measured: output tokens of calls with `finish: "length"` that were retried count as generation waste; output spent on a runaway call with no answer shows as `finish: "length"` too. Static: severity high for a reasoning or thinking model called with no output limit, medium for one effort level on every kind of call, low for a fixed limit far above the measured outputs. A limit below the task: medium for a fixed limit below outputs the task produces (truncations in the log, or a limit smaller than the output the task asks for); when those truncations are retried or re-run unchanged, that is also a high LP-GE-05 finding. Reasoning twice: medium.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
