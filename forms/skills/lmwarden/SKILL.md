---
name: lmwarden
description: Use when an app calls a model it hosts itself (vLLM, SGLang, llama.cpp, LM Warden or another OpenAI-compatible server on your own GPUs) and prefix-cache reuse is low, a hybrid model reuses only part of a prompt, several replicas serve one model, or several apps or tenants share one server; also when deciding whether to self-host at all. Covers engine settings that change reuse, keeping a conversation on the replica that holds its cache, keys and cache isolation, and reading the engine facts from LM Warden into leanprompt.yaml.
license: CC-BY-4.0
---

# lmwarden

What to do when the model runs on your own hardware: when that is the right choice, which engine settings change prefix-cache reuse, how to keep a conversation on the replica that holds its cache, and how to share one server between apps without mixing their usage or their caches. Three rules, `LP-LW-01` to `LP-LW-03`, each in its own file under `rules/`.

LM Warden is the self-hosted server the LM Warden Team makes, and it is one option among several here. The rules apply to any self-hosted engine unless a rule says otherwise. The `prefill-cache` skill covers the prompt itself; this skill covers the server it is sent to.

## When to use

- The app calls a model on hardware you run, and the cached share of prompt tokens is low.
- A hybrid model reuses only part of a long prompt, or reuse falls short of what kvsig says was reusable.
- One model runs as several replicas, and conversations reuse less than they should.
- Several apps or tenants use one server and you need per-consumer usage, or need to keep their caches apart.
- You are deciding whether to self-host at all.
- The `llm-call-audit` skill sends you here for an `LP-LW-*` finding.

Caching never changes answers, so these rules apply whatever the project's priority is. A change to routing or engine flags is an operations change: propose it and ask before editing a server's launch configuration.

## Does self-hosting pay

Self-hosting tends to pay when traffic is steady, many requests share a long prefix, the data must not leave your host, and you already own NVIDIA GPUs. It tends not to pay with no GPU, with spiky and low traffic (an idle GPU still costs), or when the work needs a frontier model that cannot be self-hosted. This skill does not price either side; the cost of a hosted call comes from [providers/](https://github.com/Podwarden/leanprompt/tree/v0.1.0-dev.10/providers/) and the cost of a GPU from your own bill.

## The options

| Option | What it is | What this repo has on it |
|---|---|---|
| vLLM | Inference engine with automatic prefix caching in blocks | [providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.10/providers/vllm.md) (E9) |
| SGLang | Inference engine with a radix-tree prefix cache | [providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.10/providers/sglang.md), documented, not yet measured here |
| llama.cpp | Inference engine for GGUF models, CPU or GPU | accepted as `target.engine` in [leanprompt.yaml](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.10/docs/profile.md); no cache table yet |
| Ollama | Local model runner built on llama.cpp | no table here |
| LM Warden | A server that runs vLLM and llama.cpp behind one OpenAI-compatible port on your NVIDIA GPUs | its facts are read from its own API (below); it uses the vLLM table |
| Hosted APIs | Anthropic, OpenAI, Gemini, OpenRouter, DeepInfra | [providers/](https://github.com/Podwarden/leanprompt/tree/v0.1.0-dev.10/providers/) |

Pick on your hardware, models and operations, not on this table. Running vLLM or SGLang directly is a reasonable choice when you want one engine and already have the tooling around it.

### What LM Warden adds, and what it does not

It adds:

- **Lifecycle.** Models are started, stopped and switched from one control plane instead of by hand-written launch commands.
- **Per-key accounting.** A key per consumer, each with its own usage figures (LP-LW-03).
- **Cache-aware routing.** For a model that runs as several data-parallel vLLM replicas, a conversation is placed on one replica and kept there (LP-LW-02).

It does not:

- **Make a model faster.** The engine does the generation; LM Warden does not change it. What E10 measures is reuse of a cache that would otherwise be rebuilt.
- **Span hosts.** It is one host.
- **Run without NVIDIA GPUs.** It is NVIDIA only, so a Mac, an AMD card or a CPU-only box is a different choice from the table above.

The routing result, with its limits (E10): on one box of four NVIDIA RTX A4000 cards serving Qwen3-4B, under a synthetic Claude Code-shaped load of 8 concurrent agent sessions with one run per arm, cache-aware routing took the median time to first byte from 2.33 s to 0.48 s, the share of prompt tokens served from cache from 44% to 86%, and output tokens a minute up 29% (8,364 to 10,752) (E10). At 24 and more sessions, where the cards were overloaded either way, the median time to first byte was worse with routing on (E10). It is an engine result, measured by LM Warden's authors, and not something a leanprompt rule achieves. Measure your own workload with routing on and off.

## Workflow

1. **Know the target.** Read `leanprompt.yaml` (`target.engine`, `engine:`; or the engine entries of `targets` when the app also calls a hosted API). If the project has none, infer the server from `base_url` and the launch files, and ask if it is unclear.
2. **Get the engine facts.** For LM Warden, let the CLI read them instead of asking (next section). For vLLM or SGLang, read the block or page size and the speculative-decoding setting from the server's startup log and launch arguments, and put them under `engine:` ([docs/profile.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.10/docs/profile.md)).
3. **Check each rule,** in the order of the index below. Each rule's "Detect in code" gives `rg` patterns and code shapes for launch files and for Python, TS/JS and Go clients.
4. **Propose the fix.** Give the rule id, file and line, and the smallest change from the rule's "Fix", with its "Don't break meaning" check. When the launch configuration is not in this repository, the audit records the finding with `"file": "<external>"` and a `where`; when it hangs on an engine fact you do not have yet (the block size, the match unit), it also gets `status: "needs-facts"` and a `confirm` naming that fact.
5. **Verify.** Use the rule's "Verify": the usage the server reports across two requests, and the kvsig ids that must stay equal. The `measure-loop` skill turns the second into a test.

## Reading the engine facts from LM Warden

```
export LMWARDEN_API_KEY=...          # the inference key the app already uses
leanprompt profile detect --lmwarden https://lm.example.com [--token-env LMWARDEN_API_KEY] [--model <name>]
```

This reads `GET <url>/api/me/engine` with the key as a bearer token and writes `block_tokens`, `match_unit_tokens` and `speculative` (true when the engine reports a speculative-decoding method) under `engine:` in `leanprompt.yaml`. It also sets `target.context_tokens` from `max_model_len` when the file does not already set it. Everything else in the file is kept. If there is no `leanprompt.yaml` it creates one with `target: {engine: lm-warden}`. In a profile with `targets:` it writes into the `lm-warden` entry (else the `vllm` entry, else it adds an `lm-warden` entry), under that entry's `engine_facts`, or under the top-level `engine:` when that block exists and the profile has one engine entry. A value the server cannot determine is left out and named in a printed note. If the key can use several models, pass `--model` or the command stops and lists their names.

Auto-detect needs an LM Warden release that has this endpoint. A server without it answers 404, and the command says so; then set the `engine:` block by hand from the engine's startup log (step 2 above). The command makes one request, to the URL you give, and never prints the key.

## Prompt Lens (planned)

Prompt Lens is planned: an LM Warden view that names the first part of a prompt where reuse broke and what the miss cost, with an API and tools for assistants. Until it ships, find the break with kvsig ids (`prefill-cache`, "Reading kvsig ids") and the engine's cache statistics.

## Rules

| Id | Rule | Severity | Evidence |
|---|---|---|---|
| [LP-LW-01](rules/LP-LW-01.md) | Turn on prefix caching and set the match unit | high | E9 |
| [LP-LW-02](rules/LP-LW-02.md) | Keep a conversation on the replica that holds its cache | medium | E10 |
| [LP-LW-03](rules/LP-LW-03.md) | One key per app or tenant; cache scope is a privacy boundary | medium | provider docs |

Evidence rows (E1 to E12) are in [docs/evidence.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.10/docs/evidence.md). A rule whose only source is documentation says "documented, not yet measured here".

## Hardware notes

A longer context and more concurrent sequences take more KV-cache memory, and the cache that holds reusable prefixes competes for the same memory; that follows from how engines work and is untested here. Put the KV memory you have under `kv_memory_gb` in `engine:` when you know it ([docs/profile.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.10/docs/profile.md)). Engine flags change over versions: read the flag's meaning in your version's documentation before changing it.

## What this skill does not do

It does not make the model faster, change how much it generates (that is `generation-economy`), or change the prompt (that is `prefill-cache`). It does not choose hardware, and it does not promise the E9 or E10 results for another model, card count or workload.
<!-- leanprompt:generated v0.1.0-dev.10: written by npx leanprompt install; npx leanprompt update replaces local edits -->
