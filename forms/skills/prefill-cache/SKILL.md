---
name: prefill-cache
description: Use when writing, reviewing or debugging code that builds LLM requests (system prompt, tool list, message history, compaction, cache marks, thinking settings) for Anthropic, OpenAI, Gemini, OpenRouter, DeepInfra or a self-hosted vLLM or SGLang server, or when a provider reports few or no cached prompt tokens (cached_tokens, cache_read_input_tokens). Makes the prompt reusable by the provider's prefix cache without changing what it means.
license: CC-BY-4.0
---

# prefill-cache

Makes prompts that the provider's cache can reuse, so the app stops paying full price to prefill the same tokens on every call. Twelve rules, `LP-PC-01` to `LP-PC-12`, each in its own file under `rules/`, each with a way to detect it in code, the smallest fix, what the fix must not break, and how to verify it.

Every prefix cache works the same way: it matches the rendered prompt from the first token and stops at the first byte that differs. Everything after that byte is recomputed and billed at the full input price. The rules below are all ways of keeping the early bytes identical from one request to the next, plus the marks and routing some providers need on top.

## When to use

- You are writing or changing the code that builds a request: the system prompt, the tool list, the history store, compaction, cache marks, thinking or effort settings, model or provider routing.
- A provider reports few or no cached tokens on a chat, an agent loop, or a batch that repeats a long prompt.
- The `llm-call-audit` skill sends you here for an `LP-PC-*` finding.

Caching never changes answers, so it applies whatever the project's priority is (cost, speed or quality). Rules that move or reword content (LP-PC-02, LP-PC-03, LP-PC-07) do need an answer check; each says so under "Don't break meaning".

## Workflow

1. **Know the target.** Read `leanprompt.yaml` if the project has one (`target`, `priority`). Otherwise infer the provider and model from the SDK, `base_url` and model names, and ask if it is unclear. Open that provider's table from the list below.
2. **Find where the prompt is built.** From each LLM call, follow `system`, `tools` and `messages` back to the code that builds them: system-prompt builders, tool registries and MCP clients, the history store, compaction, request options (`thinking`, `reasoning_effort`, `tool_choice`, `prompt_cache_key`), cache marks, and model or provider selection.
3. **Check each rule,** in the order of the index below (highest typical impact first). Each rule's "Detect in code" gives `rg` patterns and code shapes for Python, TS/JS and Go. Open a rule file when its pattern matches.
4. **Propose the fix.** Give the rule id, file and line, and the smallest change from the rule's "Fix", with its "Don't break meaning" check. When you are reviewing existing code, propose and ask before editing. When you are writing the prompt builder now, apply the rules directly.
5. **Verify.** Use the rule's "Verify": (a) the provider's usage field across two requests, and (b) the kvsig id that must stay equal. The `measure-loop` skill turns (b) into a CI test that fails when the stable head changes.

## Provider facts, in brief

The numbers (minimums, step and block sizes, lifetimes, prices, limits) live only in the dated tables; read them there, not from memory.

- **Anthropic.** Caches only at `cache_control` breakpoints, or with top-level automatic caching that places one breakpoint for you; without marks nothing is cached (E1). Tools render first, then system, then messages. A prompt shorter than the model's minimum is silently not cached. Two lifetimes; writes cost a premium and reads a fraction of input, so marks follow the break-even rule in LP-PC-01. Thinking settings are part of the prompt. [providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/anthropic.md), [models/anthropic-thinking.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/models/anthropic-thinking.md)
- **OpenAI.** Automatic above a minimum, reported in fixed steps (E2). System before tools is observed, not documented: in the replay test behind E3 the system-prompt part stayed cached when only the tool list changed (render-order row in the table). `prompt_cache_key` groups requests that share a prefix. Recent models add optional explicit breakpoints and lifetime options. `tool_choice: "none"` drops the tools from the rendered prompt. [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/openai.md), [models/openai-reasoning.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/models/openai-reasoning.md)
- **Gemini.** Implicit caching on current models, plus explicit cache objects with a lifetime and storage billing for large shared context. Documented, not yet measured here. [providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/gemini.md)
- **OpenRouter.** A router, not a cache: hits depend on the upstream provider, so keep a conversation on one provider. Cache marks are passed through and translated between dialects; send them for Anthropic and Gemini models (E1). [providers/openrouter.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/openrouter.md)
- **DeepInfra.** Automatic, with an optional `prompt_cache_key` and, on some models, explicit retention (E2, E3). [providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/deepinfra.md)
- **vLLM and SGLang (self-hosted).** Automatic prefix caching in whole blocks or pages, so the tail of every prompt is recomputed. Hybrid models can have very large blocks, and speculative decoding drops one more (E9). With several replicas, reuse needs the request to reach the replica that holds the prefix (the `lmwarden` skill). [providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/vllm.md), [providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/providers/sglang.md), [models/qwen.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/models/qwen.md)

Evidence rows (E1 to E12) are in [docs/evidence.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.5/docs/evidence.md). A rule whose only source is provider documentation says "documented, not yet measured here".

## Rules

| Id | Rule | Severity | Evidence |
|---|---|---|---|
| [LP-PC-01](rules/LP-PC-01.md) | Put cache marks where the provider needs them | high | E1 |
| [LP-PC-02](rules/LP-PC-02.md) | Stable content first, without hurting meaning | high | E6 |
| [LP-PC-03](rules/LP-PC-03.md) | No ids, timestamps, versions or paths at the top of the prompt | high | E4, E5 |
| [LP-PC-04](rules/LP-PC-04.md) | Fixed tool order and JSON key order | high | provider docs |
| [LP-PC-05](rules/LP-PC-05.md) | Tool lists grow only at the end | medium | E3 |
| [LP-PC-06](rules/LP-PC-06.md) | Append-only history | high | provider docs |
| [LP-PC-07](rules/LP-PC-07.md) | Shared context before per-user context | medium | provider docs |
| [LP-PC-08](rules/LP-PC-08.md) | Cache-aware compaction | medium | provider docs |
| [LP-PC-09](rules/LP-PC-09.md) | Consistent reasoning handling; thinking fixed per session | high | E7, E11 |
| [LP-PC-10](rules/LP-PC-10.md) | Stable image and attachment placement | medium | provider docs |
| [LP-PC-11](rules/LP-PC-11.md) | Keep pauses inside the cache lifetime | low | provider docs |
| [LP-PC-12](rules/LP-PC-12.md) | Do not split one prefix across models or keys that do not share a cache | medium | provider docs |

## Reading kvsig ids

kvsig gives each request keyed ids: `sys` (system prompt), `tools` (tool list), `head` (both), `msgs[i]` (one message), `nodes[i]` (the whole prompt up to message `i`) and `conv` (the conversation). Use exact ids for caching questions. Two requests with equal exact `nodes[i]` have the same prompt up to message `i`. The loose forms ignore noise such as date lines, reminders, whitespace, reasoning and key order inside tool schemas, so "loose equal, exact different" tells you the change was only noise. Assert only on `kvsig/1` exact ids and `loose/1` ids. The table of what changed between two requests is in kvsig's `docs/reading-the-ids.md`.

## What this skill does not do

It does not change how much the model generates (that is `generation-economy`), it does not tune engine settings or replica routing on a self-hosted server (that is `lmwarden`), and it does not promise a saving for an app it has not measured.
<!-- leanprompt:generated v0.1.0-dev.5 — managed by npx leanprompt init; local edits are replaced on update -->
