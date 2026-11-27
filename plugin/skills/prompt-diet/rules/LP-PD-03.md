---
id: LP-PD-03
title: Do not resend the same boilerplate on every turn
skill: prompt-diet
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang, any]
saves: prefill
severity: medium
evidence:
  - E11
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
Put policies, reminders and fixed context that apply to the whole conversation in the stable system prompt once, instead of wrapping every user message in the same block of text.

## Why
Some apps wrap each user message in a template: the policy, the style guide, "remember the rules above", a list of the user's settings that has not changed. The block is sent again in every new message, so a conversation of many turns carries many copies of it, and the history grows by the block on every turn. Each new copy is in the uncached tail of its request and is paid at the full input price; the older copies are read from the cache on later turns, but they still fill the context window and, on a self-hosted engine, KV memory ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/anthropic.md), [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/openai.md), [providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.12/providers/vllm.md)). Documented, not yet measured here.

Text that really changes per turn (the current time, a fresh retrieval) belongs in the newest message (LP-PC-03); this rule is about text that is the same every turn.

## Detect in code
Python:
```
rg -n 'content["\x27]?\s*[:=]\s*f?["\x27]{1,3}.*\{(policy|rules|reminder|guidelines|instructions|context)\}' -g '*.py'
rg -n '(REMINDER|POLICY|GUIDELINES|RULES)\w*\s*\+\s*(user_)?(msg|message|input|query)|\+\s*(REMINDER|POLICY)' -g '*.py'
```
Shapes: `{"role": "user", "content": POLICY + "\n\n" + user_text}` in the turn loop; a `wrap_user_message()` helper that adds the same header to every turn; settings re-rendered into each message although they change once per session.

TS/JS:
```
rg -n 'content:\s*`\$\{(POLICY|REMINDER|RULES|GUIDELINES)\w*\}' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` messages.push({ role: "user", content: `${REMINDER}\n\n${input}` }) ``; a middleware that prepends the same block to each user turn.

Go:
```
rg -n 'Content:\s*(policy|reminder|rules)\w*\s*\+|fmt\.Sprintf\("%s\\n\\n%s",\s*(policy|reminder)' -g '*.go'
```
Shapes: `Content: reminder + "\n\n" + input` inside the request loop.

## Fix
```python
# before: the policy rides on every user message
history.append({"role": "user", "content": POLICY + "\n\n" + user_text})

# after: once, in the system prompt, which stays byte-identical for the session
SYSTEM = BASE_PROMPT + "\n\n" + POLICY
history.append({"role": "user", "content": user_text})
```

Make the change for new conversations. Do not rewrite the user messages already sent in a running conversation to remove the block: that rewrites the history and loses its cached prefix (LP-PC-06).

## Don't break meaning
Some apps repeat a reminder on purpose, because in long conversations the model drifts from instructions it saw only at the start. Move the block only after the answer check with `measure-loop`, on a fixed set of long conversations (as many turns as the app really sees), before and after: answers unchanged or better on the late turns too. If the late turns drift, keep a one-line reminder instead of the whole block. Weigh the cache: adding the policy to the system prompt changes the head once, which is a cost of one prefill per route. Do not strip the copies, tool results or reasoning from history to save more; stripping reasoning produced about 3x more generation (E11). What must stay byte-identical in the head: [prefill-cache](../../prefill-cache/SKILL.md).

## Verify
(a) Provider usage: the uncached part of each turn (`input_tokens` minus `cache_read_input_tokens`, or `prompt_tokens` minus `cached_tokens`) falls by about the size of the block, and `prompt_tokens` on late turns of a long conversation falls by about the block times the turns so far. `cached_tokens` on the second turn still covers the head.

(b) leanprompt usage record: `prompt_tokens` grows turn over turn by about the user message plus the last answer, not by the block too; `ids.sys` is equal on every turn of the conversation.

## Waste signal
Measured: the drop in `prompt_tokens` across a conversation, times conversations; the score does not count it, the report shows it as `tokens_per_1k.prompt`. Static: severity medium for a fixed block wrapped around every user message in a multi-turn conversation; low for a short reminder line.
<!-- leanprompt:generated v0.1.0-dev.12: written by leanprompt install; leanprompt update replaces local edits -->
