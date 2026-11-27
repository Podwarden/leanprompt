---
id: LP-PC-06
title: Append-only history
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
Send every earlier message byte for byte as it was sent before, and add new content only at the end.

## Why
A turn can reuse the cache only if every message before it is identical to what was sent last time. A rewrite at message `k` makes everything after `k` a miss, and a rewrite that happens on every call makes every turn a miss. The provider docs require the whole rendered prefix to match ([providers/openai.md](../../leanprompt/facts/providers/openai.md), [providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)). Documented, not yet measured here.

The rewrites that cause it are rarely deliberate:
- history re-serialised from objects or database rows on each call (different whitespace, key order or number formatting);
- `.strip()` or Markdown re-rendering of old messages;
- a reminder or "current state" block updated inside an old message, or inserted in the middle;
- old tool results truncated in place to stay under a budget;
- conversion between SDK message types (for example Responses items to Chat Completions messages) on each call.

## Detect in code
Python:
```
rg -n 'messages\[\d+\]\s*=|history\[-?\d+\]\[.content.\]\s*\+?=|messages\.insert\(|\.strip\(\)|model_dump\(|json\.dumps\(' -g '*.py'
```
Shapes: `messages = [to_api(row) for row in db.load(conv_id)]` on every call, where `to_api` formats content; `for m in history: m["content"] = render(m)`; `history[0]["content"] += reminder`; `result[:MAX_CHARS]` applied to all old tool results on each call.

TS/JS:
```
rg -n 'messages\.splice\(|history\.map\(|\.trim\(\)|JSON\.stringify\(\w+,\s*null,\s*\d' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `history.map(m => ({ ...m, content: render(m) }))` before each request; `JSON.stringify(result, null, 2)` when the tool result is first shown and `JSON.stringify(result)` when history is rebuilt.

Go:
```
rg -n 'json\.MarshalIndent\(|strings\.TrimSpace\(|messages\[\w+\]\s*=' -g '*.go'
```
Shapes: `[]Message` rebuilt from the store each call with `fmt.Sprintf`; `json.MarshalIndent` in one path and `json.Marshal` in another for the same tool result.

## Fix
Store exactly what was sent, and replay it.

```python
# before
messages = [{"role": r.role, "content": render(r)} for r in store.load(conv_id)]
messages[0]["content"] += f"\n\n<reminder>{state()}</reminder>"

# after
messages = store.load_sent(conv_id)          # the exact dicts sent last time, stored after each send
messages.append({"role": "user", "content": f"<reminder>{state()}</reminder>\n\n{user_input}"})
```

Truncate or redact a tool result once, when it is added, never later. Keep cache marks off the stored copies (LP-PC-01 adds them at send time).

## Don't break meaning
If the app rewrote history to keep the model informed (an updated plan, the current state), say the same thing in a new message at the end and state that it supersedes the earlier one; do not silently drop it. If old messages were trimmed to fit the context window, trim by compaction (LP-PC-08), not on every call. Redaction for privacy still happens, once, before the first send.

## Verify
(a) In a multi-turn session, each request reports `cached_tokens` or `cache_read_input_tokens` close to the previous request's prompt size, less the tail the engine rounds away (step and block sizes in the provider tables).

(b) kvsig: for consecutive requests A and B of one conversation, `B.nodes` starts with all of `A.nodes`. A shorter shared prefix points at the first rewritten message: the index where the two `nodes` lists first differ.

## Waste signal
Measured: lowers S, the share of prompt tokens that requests continuing a conversation could reuse. Static: severity high for history rebuilt or modified on every call, medium for a one-off rewrite (a single insertion or truncation point).
<!-- leanprompt:generated v0.1.0-dev.13: written by leanprompt install; leanprompt update replaces local edits -->
