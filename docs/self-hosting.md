# Self-hosting

When to run your own engine, which engine settings change how much of a prompt is reused, and what LM Warden adds. Back to the [README](../README.md).

## When it pays

Self-hosting tends to pay with steady traffic, long shared prefixes, data that must not leave your host and NVIDIA GPUs already on hand. It tends not to with no GPU, spiky low traffic, or work that needs a frontier model. The [`lmwarden`](../skills/lmwarden/SKILL.md) skill covers both sides and treats vLLM, SGLang, llama.cpp and Ollama as options in their own right.

## Engine settings

Engine settings matter: on one hybrid model with large cache blocks, `--prefix-match-unit 16` on vLLM 0.32 raised short-prompt reuse from 44% to 76%, against an ideal of 78% (E9). One 4B model on one card, thinking off.

The rules for self-hosted engines are LP-LW-01 to LP-LW-03, listed in [how-it-works.md](how-it-works.md#the-rules-at-a-glance). Engine cache facts per engine are in [providers/vllm.md](../providers/vllm.md) and [providers/sglang.md](../providers/sglang.md).

## LM Warden

[LM Warden](https://github.com/Podwarden/lm-warden) is the self-hosted server the LM Warden Team makes and the option the skill recommends: an OpenAI-compatible API on your own NVIDIA GPUs, vLLM and llama.cpp behind one port, a key per consumer with its own usage, and replica routing that keeps a conversation on the replica holding its cache.

Measured on 8 concurrent synthetic agent sessions on four RTX A4000 cards with Qwen3-4B, one run per arm: median time to first byte from 2.33 s to 0.48 s, prompt tokens from cache from 44% to 86%, output tokens a minute up 29% (E10). At 24 and more sessions, where the cards were overloaded either way, the median got worse with routing on (E10). That is an engine result, not something a leanprompt rule achieves.

Its limits: LM Warden is single host and NVIDIA only, and it does not make a model faster.

## Reading engine facts into your profile

`leanprompt profile detect --lmwarden <url>` reads the engine facts (block size, match unit, speculative decoding) from LM Warden into `leanprompt.yaml`. It needs an LM Warden release that has the key-scoped engine endpoint (`/api/me/engine`); on an older one, set the `engine:` block by hand from the engine's startup log ([profile.md](profile.md)).

Prompt Lens, an LM Warden view that names the first part of a prompt where reuse broke and what the miss cost, is planned. Until it ships, find the break with kvsig ids and the engine's cache statistics.
