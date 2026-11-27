---
family: qwen
checked: 2026-11-26
source: https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/chat_template.jinja
---

# Qwen (hybrid thinking models, self-hosted)

Status: template facts observed in each model's `chat_template.jinja` on 2026-09-04; the Qwen3.8-27B template was re-read at the source URL on 2026-11-26. The other two templates were not re-fetched on 2026-11-26. Documented, not yet measured here except E7.

## Thinking and reasoning controls

| Model | `reasoning_effort` | `enable_thinking` | Basis |
|---|---|---|---|
| `Qwen/Qwen3.8-27B` | Default `'xhigh'`; allowed `('xhigh', 'medium', 'low')`; any other value raises an exception ("Supported types are xhigh (default), medium, and low"). The check runs only while thinking is enabled | Yes. Thinking is on when `enable_thinking` is undefined or true; when false the generation prompt emits an empty `<think>\n\n</think>\n\n` block | observed 2026-09-04 in the model's chat_template.jinja; re-read 2026-11-26 |
| `Qwen/Qwen3.6-35B-A3B` | No `reasoning_effort` in the template; the kwarg is ignored | Yes | observed 2026-09-04 in the model's chat_template.jinja |
| `Qwen/Qwen3.5-27B` | No `reasoning_effort` in the template; the kwarg is ignored | Yes | observed 2026-09-04 in the model's chat_template.jinja |

Passing `reasoning_effort` to a server that serves a template without it changes nothing and raises nothing. Check the template before relying on it.

## Where the template writes the effort (Qwen3.8-27B)

Read in the model's `chat_template.jinja` at the source URL on 2026-11-26. While thinking is enabled, the template turns `reasoning_effort` into a sentence and writes it at the very start of the system message, before the tool definitions and before the app's own system prompt: `xhigh` (the default) and `low` each add their own sentence, `medium` adds none. With `enable_thinking: false` no sentence is written. A system message is rendered even when the app sends none, if there is a sentence to write.

So on this template the first tokens of the prompt depend on the thinking flag and the effort. Two calls that share a long system prompt and differ only in effort or thinking share no prefix at all, even single-turn calls with no history (LP-PC-09). Documented, not yet measured here. The other two templates above have no `reasoning_effort`; whether they render anything about thinking in the system message was not checked on 2026-11-26.

## Cache effects

- The chat template renders earlier assistant turns differently depending on the thinking flag, so toggling thinking between turns of one session changes the prefix. Measured loss: 47% of what those turns could have reused (329k tokens), E7. Fix the flag per session.
- Qwen3.8-27B: past reasoning is rendered by default. The template keeps an assistant turn's reasoning when `preserve_thinking` is undefined or true, or when the turn is after the last user query; otherwise only the answer is rendered. Stripping reasoning from history by hand produced about 3x more generation in agent loops (E11, one model).
- Hybrid models cache in large blocks; see `providers/vllm.md` (E9).

## Cache markers

Self-hosted engines take no cache markers; reuse is by token prefix. Through OpenRouter, Alibaba Qwen endpoints take `cache_control: {"type": "ephemeral"}` only (5-minute TTL; snapshot endpoints do not support it), per OpenRouter's docs checked 2026-11-26.

## Tool-calling and JSON quirks

- Served by vLLM, the thinking comes back in a separate `reasoning` field only when the server runs with a reasoning parser (`--reasoning-parser qwen3`); without one it arrives inside `content` as `<think>...</think>` before the answer. Check this before adding a JSON schema: see the structured-output rows in [providers/vllm.md](../providers/vllm.md) and LP-GE-10 (vLLM docs, checked 2026-11-26).
- Other tool-calling and JSON quirks: not stated in the sources read for this table (checked 2026-11-26).
<!-- leanprompt:generated v0.1.0-dev.13: written by npx leanprompt install; npx leanprompt update replaces local edits -->
