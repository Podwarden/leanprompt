---
id: LP-PC-08
title: Cache-aware compaction
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang]
saves: prefill
severity: medium
evidence:
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
---
## Rule
When you compact a long conversation, keep the system prompt and the tool list byte-identical and put the summary in the messages after them, and run the summarising call as a continuation of the same prompt.

## Why
Compaction replaces the history with a summary, so the message part is recomputed once whatever you do. If the compaction also rewrites the system prompt (appending "Summary of the conversation so far: ..." to it) or rebuilds the tool list, the head is lost too, on every compaction. On Anthropic, tools and system render before messages, so an unchanged head stays cached across the compaction ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/anthropic.md)). Documented, not yet measured here.

The summarising call itself is the second cost. Sent with its own system prompt ("You are a summariser") over the full history, it pays for the whole history again. Sent as the same head and history plus a final instruction to summarise, it reads the cache that the last turn wrote.

## Detect in code
Python:
```
rg -n '(system|system_prompt)\s*\+=|summary|summari[sz]e|compact' -g '*.py'
```
Shapes: `system_prompt += f"\n\nEarlier conversation:\n{summary}"`; `client.messages.create(system="Summarise this conversation.", messages=history)`; tools rebuilt from the registry after compaction (LP-PC-04).

TS/JS:
```
rg -n 'system\w*\s*\+=|system\w*\s*=\s*`\$\{\w+\}.*summary|summari[sz]e|compact' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` systemPrompt = `${BASE}\n\n${summary}` ``; a summariser request with a different `system` and the full `messages`.

Go:
```
rg -n 'sys(tem)?\w*\s*\+=|sys(tem)?\w*\s*=\s*\w+\s*\+\s*.*summary|Summari[sz]e|Compact' -g '*.go'
```
Shapes: `sys = basePrompt + "\n" + summary`.

## Fix
```python
# before
summary = client.messages.create(system="Summarise this conversation.", messages=history, ...)
system = BASE_PROMPT + "\n\nSummary of the conversation so far:\n" + text_of(summary)
history = []

# after
ask = {"role": "user", "content": "Summarise the conversation so far for your own later use."}
summary = client.messages.create(system=BASE_PROMPT, tools=TOOLS, messages=[*history, ask], ...)
system = BASE_PROMPT                                    # unchanged, byte for byte
history = [{"role": "user", "content": "Summary of the conversation so far:\n" + text_of(summary)}]
```

Keep the tools exactly as they were (same list, same order, same serialisation). To stop the summarising call from calling a tool, say so in the instruction rather than changing `tool_choice`: on OpenAI `"none"` drops the tools from the rendered prompt, and on Anthropic a `tool_choice` change invalidates the message blocks ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/openai.md), [providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/anthropic.md)).

## Don't break meaning
The summary must still be read as context: label it ("Summary of the conversation so far"), and if the system prompt used to say how to treat the summary, keep that instruction in the stable system prompt. A summariser call made as a continuation sees the agent's own instructions; ask for a summary in plain terms, and compare a few post-compaction answers on a fixed long conversation before and after the change.

## Verify
(a) The request right after a compaction reports `cached_tokens` or `cache_read_input_tokens` of at least the head (tools and system). The summarising call reports a read close to the size of the history it summarised.

(b) kvsig: `head` (and `sys`, `tools`) is equal before and after the compaction. `conv` changes, as expected: kvsig reads it as "different conv, same sys". The summarising call's `nodes` start with all of the last pre-compaction request's `nodes`.

## Waste signal
Measured: compaction starts a new `conv`, so the score's S does not see it; it shows as a new `sys` right after a long conversation where the same `sys` was expected, and as a summarising call with a short shared prefix. Static: severity medium for a summary written into the system prompt or a summariser call with its own system prompt.
<!-- leanprompt:generated v0.1.0-dev.2 — managed by npx leanprompt init; local edits are replaced on update -->
