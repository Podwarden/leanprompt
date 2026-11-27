---
id: LP-PC-01
title: Put cache marks where the provider needs them
skill: prefill-cache
applies_to: [anthropic, openrouter, openai, deepinfra, gemini]
saves: prefill
severity: high
evidence: [E1]
---
## Rule
On a provider that caches only at marks, put a cache mark at the end of each stable part of the prompt, and only on parts that will be read again within the cache lifetime.

## Why
Anthropic caches a prefix only at a `cache_control` breakpoint, or with top-level automatic caching, which places one breakpoint for you. Without marks nothing is cached and every turn pays the full input price. Coding-agent sessions that sent no `cache_control` to an Anthropic model through a router cached 0 tokens on 29 turns, while sessions that set 3 breakpoints cached almost all of their reusable prefix (E1).

Anthropic renders tools, then system, then messages. A read looks back from a mark for the longest prefix already written, so three marks cover a conversation: the last tool, the end of the system prompt, and the newest message. The breakpoint limit and the lookback limit are in [providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md).

A router does not add marks for you. OpenRouter forwards marks and translates them between dialects, so an OpenAI-shaped client that talks to an Anthropic or Gemini model through it still has to send them ([providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md)). Automatic caches (OpenAI, DeepInfra, vLLM, SGLang) need no marks; recent OpenAI models and some DeepInfra models also accept optional explicit breakpoints with their own write price ([providers/openai.md](../../leanprompt/facts/providers/openai.md), [providers/deepinfra.md](../../leanprompt/facts/providers/deepinfra.md)). Gemini's explicit cache objects are a separate mechanism with storage billing ([providers/gemini.md](../../leanprompt/facts/providers/gemini.md)).

**Break-even rule.** A mark is not free. Where cache writes cost a premium, a prefix that is written and not read again within the lifetime costs more marked than unmarked. Take the write multiplier `w` and the read multiplier `r` from the provider's table (both relative to the base input price). A marked prefix pays back when it is read, on average, more than `(w − 1) / (1 − r)` times per write within the lifetime. Mark the head of a chat or agent loop. Do not mark a one-shot prompt that never repeats. For prefixes reused at long intervals, compare a longer lifetime (a higher `w`) with rewriting at the default one (LP-PC-11).

## Detect in code
Find every Anthropic call, direct or routed, and check whether `tools`, `system` and the newest message carry a mark.

Python:
```
rg -n 'anthropic\.(Anthropic|AsyncAnthropic|AnthropicBedrock|AnthropicVertex)\(|messages\.(create|stream)\(' -g '*.py'
rg -n 'cache_control' -g '*.py'
rg -n 'openrouter\.ai|"anthropic/|"google/' -g '*.py'
```
Shapes: `client.messages.create(system=SYSTEM_PROMPT, ...)` with `system` as a plain string and no `cache_control` anywhere in the call; the OpenAI SDK with `base_url` on a router and an `anthropic/...` or `google/...` model, with string `content` (a string cannot carry a mark).

TS/JS:
```
rg -n '@anthropic-ai/sdk|messages\.(create|stream)\(|cache_control|cacheControl' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `system: "..."` as a string; Vercel AI SDK calls to an Anthropic model with no `providerOptions: { anthropic: { cacheControl: ... } }` on any message; the reverse, marks keyed to one provider (`providerOptions.anthropic`) sent on calls whose model may be another explicit-cache provider (Alibaba's explicit-only Qwen models, MiniMax), which ignores them, so that traffic caches nothing (through Vercel AI Gateway, `providerOptions.gateway.caching: 'auto'` marks for each provider, [providers/vercel-ai-gateway.md](../../leanprompt/facts/providers/vercel-ai-gateway.md)); `fetch(".../v1/messages", ...)` bodies without `"cache_control"`.

Go:
```
rg -n 'anthropic-sdk-go|Messages\.New\(|CacheControl|/v1/messages' -g '*.go'
```
Shapes: `anthropic.MessageNewParams{System: ...}` with no `CacheControl` on any `TextBlockParam` or `ToolParam`; raw `http.NewRequest` to `/v1/messages` whose JSON has no `cache_control`.

Partial marking: a mark on the tools or the system prompt and none on the messages of a chat or agent loop. The fixed head is read from the cache, and the conversation, which grows every turn, is recomputed every turn.

Over-marking, the opposite finding: a mark on a block that holds per-request content (a timestamp, the user's question), or marks on a one-shot call whose prompt never repeats. Apply the break-even rule.

## Fix
Python, Anthropic SDK. The marks are added to copies at send time, so the stored history stays byte-identical (LP-PC-06).

```python
# before
resp = client.messages.create(
    model=MODEL, max_tokens=MAX_TOKENS,
    system=SYSTEM_PROMPT, tools=TOOLS, messages=history,
)

# after
EPHEMERAL = {"type": "ephemeral"}

def mark_last(items):
    *rest, last = items
    return [*rest, {**last, "cache_control": EPHEMERAL}]

def mark_last_message(messages):
    *rest, last = messages
    content = last["content"]
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    return [*rest, {**last, "content": mark_last(content)}]

resp = client.messages.create(
    model=MODEL, max_tokens=MAX_TOKENS,
    tools=mark_last(TOOLS),                                    # 1: end of tools
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": EPHEMERAL}],  # 2: end of system
    messages=mark_last_message(history),                       # 3: newest message
)
```

TS/JS through a router with the OpenAI SDK: send `content` as parts so a part can carry the mark.

```ts
// before
messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history]
// after
messages: [
  { role: "system", content: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }] },
  ...history,
]
```

To choose a longer lifetime, add the `ttl` field documented in [providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md), and only where the break-even rule favours it.

If the app meters its own spend from the usage fields (a daily cap, a cost display), check the meter before adding marks. On Anthropic, `input_tokens` counts only the tokens after the last breakpoint; the total input is `cache_read_input_tokens + cache_creation_input_tokens + input_tokens` ([providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md)). Marks move tokens out of `input_tokens` into the two cache fields, so a meter that reads `input_tokens` and `output_tokens` alone undercounts more after the fix. Count all three input fields, each at its own price; a meter that is already wrong is worth reporting as a note under [LP-GE-11](../../generation-economy/rules/LP-GE-11.md) in the audit.

The estimate for a mark finding: the tokens the cache could serve are `uncached`, and the tokens the fix newly writes to the cache (each write of the marked prefix, including the last turn of a conversation, which is never read back) are `cache_write`. The page prices the write premium and subtracts it, so the money it shows is the net saving.

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds two requests of one conversation and asserts their kvsig `head` ids are equal shows that the marked prefix stays the same, so the mark keeps being read. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
A mark does not change the text the model sees, so adding marks cannot change answers. Do not reorder or reword content to make a mark fit: that is LP-PC-02, and it needs an answer check. Do not convert content between string and parts in the stored history; convert at send time.

## Verify
(a) Send two requests with the same marked prefix within the lifetime. On Anthropic the first reports `cache_creation_input_tokens` > 0 and the second `cache_read_input_tokens` close to the marked prefix. Through OpenRouter read `prompt_tokens_details.cached_tokens` and `cache_write_tokens`. If both stay 0 with no error, check the prompt against the model's minimum cacheable length in [providers/anthropic.md](../../leanprompt/facts/providers/anthropic.md); below it nothing is cached, marks or not.

(b) kvsig: the two requests have equal exact `head` (tools and system) and equal exact `nodes[i]` up to the marked message. Equal ids with `cache_read_input_tokens` of 0 is the E1 shape: the prefix was reusable and the marks were missing or misplaced.

## Waste signal
Measured: lowers E (provider-cached tokens over reusable tokens). kvsig says the prefix was equal, the provider reports no read. Missing marks count against the app: leanprompt scores what the provider could have reused, and a mark is the app's to add. Static: a finding of severity high on each Anthropic call site, direct or routed, that sends no marks. Medium for partial marking (the head is marked, the messages of a loop are not). Over-marking is reported with the break-even advice (mark, don't mark, longer lifetime, restructure).
<!-- leanprompt:generated v0.1.0-dev.14: written by npx leanprompt install; npx leanprompt update replaces local edits -->
