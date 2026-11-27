---
id: LP-PD-05
title: Drop stale history on purpose, not by stripping
skill: prompt-diet
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang, any]
saves: prefill
severity: medium
evidence:
  - E11
  - doc: https://platform.claude.com/docs/en/build-with-claude/thinking
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/context-editing
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    checked: 2026-11-26
---
## Rule
Keep a long conversation's history bounded with one deliberate step taken rarely (compaction past a size threshold, or clearing old tool outputs in one large cut), and never by removing pieces of earlier turns on every call.

## Why
An agent that keeps every turn and every tool output sends all of it on every call. Past some point most of it no longer bears on the answer: the files read before the last edit, the search results of a question already answered. Each call pays for it, read from the cache at a fraction of the price or, after a pause longer than the cache lifetime, at the full price (LP-PC-11).

Trimming it the wrong way costs more than it saves. Removing old messages or old tool outputs a little on every call rewrites the history, so the cached prefix ends at the first removed piece and everything after it is prefilled again on every call (LP-PC-06). Stripping the model's earlier reasoning to save tokens produced about 3x more generation in agent loops (E11): the model redid the reasoning it could no longer see. On Anthropic, the thinking blocks of a tool-use turn in progress must be passed back complete and unmodified, the API itself filters older thinking blocks, and on models with preserved thinking a change to an earlier message can make the request fail ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)).

So the step is rare and large. Compaction (summarise and continue) is described in LP-PC-08, which says how to keep the head cached across it; this rule says when to do it and what to keep. On Anthropic, context editing (beta) can clear old tool results past a token trigger, and its `clear_at_least` setting skips a clearing that would remove too little to be worth the cache write ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)). Documented, not yet measured here.

## Detect in code
Python:
```
rg -n 'messages\s*=\s*messages\[-\d+:\]|history\[-\d+:\]|messages\.pop\(\d*\)|del messages\[' -g '*.py'
rg -n '(strip|remove|drop)_(thinking|reasoning)|block\.type\s*[!=]=\s*.(thinking|reasoning)' -g '*.py'
```
Shapes: a sliding window (`history[-10:]`) applied on every call; a loop that deletes or shortens old `tool_result` contents each turn; a filter that removes `thinking` or `reasoning` blocks from assistant messages before resending; the opposite, a history that grows with no bound and no compaction at all.

TS/JS:
```
rg -n 'messages\.slice\(-\d+\)|history\.slice\(-\d+\)|\.shift\(\)|filter\(\s*\(?\w+\)?\s*=>\s*\w+\.type\s*!==\s*.(thinking|reasoning)' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `messages = messages.slice(-20)` before each request; old tool outputs replaced with `"[truncated]"` in place, turn by turn.

Go:
```
rg -n 'messages\[len\(messages\)-\d+:\]|history\[len\(history\)-\d+:\]' -g '*.go'
```
Shapes: a window re-sliced on every request.

## Fix
```python
# before: a sliding window every call, and reasoning stripped from the history
messages = strip_thinking(history)[-12:]
resp = client.messages.create(model=M, system=SYSTEM, tools=TOOLS, messages=messages, max_tokens=2048)

# after: the history is sent as it is, append-only, and compacted rarely, past a threshold
if estimate_tokens(history) > COMPACT_AT:            # a threshold well above a typical task
    history = compact(history)                       # LP-PC-08: same system and tools, summary appended
resp = client.messages.create(model=M, system=SYSTEM, tools=TOOLS, messages=history, max_tokens=2048)
```

When the bulk of an agent's history is old tool output, clearing it in one cut can replace compaction. On Anthropic that is context editing with a `clear_tool_uses_20250919` edit, a `trigger`, a `keep` count for the latest results, and `clear_at_least` (beta; check the table for the current header). Elsewhere, do the same in code: past the threshold, replace the content of old tool results with a short placeholder in one step, then append-only again.

## Don't break meaning
What looks stale may be what the model needs: the file it read before the edit, the error that explains the retry. Choose the threshold and what is kept (the latest turns, the latest tool results, the task statement, the decisions made) with the answer check from `measure-loop`: a fixed set of long conversations or agent tasks, run before and after on the same scenario, with answers or task results unchanged or better and no rise in output tokens or tool calls; after stripping reasoning, agents made about 3x more generation (E11). Never strip thinking or reasoning blocks to save tokens, and keep the current tool-use turn whole. The compaction step must keep the system prompt and tools byte-identical (LP-PC-08); cutting the shared head to make room breaks the prefix for every later call. How compaction keeps the head cached: [prefill-cache](../../prefill-cache/SKILL.md) (LP-PC-08).

## Verify
(a) Provider usage: between compactions, each call's `cache_read_input_tokens` or `cached_tokens` covers everything up to the newest messages (the history is append-only again); after a compaction or clearing, `input_tokens` or `prompt_tokens` falls by about what was removed and `cached_tokens` still covers the head. `output_tokens` per task does not rise after the change.

(b) leanprompt usage record: `ids.nodes` of earlier messages are equal from call to call between compactions; `prompt_tokens` per call stays below the threshold; `output_tokens` per conversation is not higher than before.

## Waste signal
Measured: a sliding window shows as `cached_tokens` far below `prompt_tokens` on calls that continue a conversation (the score's S falls); an unbounded history shows as `prompt_tokens` that keep growing per conversation. Static: severity medium for a per-call window or per-call trimming of old turns (it breaks the cache on every call; also LP-PC-06), medium for stripping reasoning or thinking blocks from the history (E11), low for a history with no bound in an app whose conversations are long.
<!-- leanprompt:generated v0.1.0-dev.14: written by npx leanprompt install; npx leanprompt update replaces local edits -->
