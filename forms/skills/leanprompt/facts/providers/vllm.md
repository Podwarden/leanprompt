---
provider: vllm
checked: 2026-11-26
source: https://docs.vllm.ai/en/latest/features/automatic_prefix_caching.html
cache:
  mode: block
  min_tokens: 0
  block_tokens: 1584
  drops_last_block: true
  ttl_seconds: 0
---

# vLLM (self-hosted)

Status: measured in E9 (one 4B hybrid model on one 16 GB card, TP1, thinking off) and E5 (a self-hosted vLLM reused only the 7,920 tokens before a changing working-directory line). Everything else below is documented, not yet measured here.

`ttl_seconds: 0` means no lifetime: entries are evicted under memory pressure only. The docs do not describe an eviction policy (checked 2026-11-26).

`block_tokens: 1584` and `drops_last_block: true` are the values from E9's production setup (hybrid model, MTP speculative decoding on). Read the real block size from your engine's startup log, or from LM Warden's `engine_block_tokens`; a non-hybrid model usually has a smaller block. The default block size is not stated in the docs (checked 2026-11-26).

## Facts

| Fact | Value | Basis |
|---|---|---|
| Block size, hybrid model | 1,584 tokens in one production setup | E9 |
| Last block with MTP speculative decoding | one more block is dropped when MTP is on (short prompts reused 44% on an append-only workload) | E9 |
| `--prefix-match-unit` | sets the granularity at which prefix-cache keys are computed; unset, it defaults to the greatest common divisor of the prefix-cacheable KV cache group block sizes (the block size on hybrid Mamba models); the docs suggest 64 as a starting point | docs |
| Effect of `--prefix-match-unit 16` | short-prompt reuse 44% to 76% (ideal 78%), no change in decode speed; vLLM 0.32 | E9 |
| Hashing | each block's hash covers every token before it; a change at one token invalidates that block and all later blocks | docs |
| Hybrid models | Mamba state is stored only on the Mamba block grid, so a hit can resume only at a block boundary. `--enable-mamba-shared-prefix-checkpoint` is off by default and takes effect only with prefix caching on and `--prefix-match-unit` smaller than the Mamba block size | docs |
| Enable / disable | `--enable-prefix-caching` / `--no-enable-prefix-caching` | docs |
| Chat-template effect | Toggling thinking between turns of a Qwen hybrid session lost 47% of what those turns could have reused | E7 |

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | `SamplingParams.n`: "Number of outputs to return for the given prompt request"; maximum set by `VLLM_MAX_N_SEQUENCES` (default 16384). The online-serving page does not list `n` among its extra parameters. Whether the samples share one prefill is not stated; it follows from prefix caching, untested here | https://docs.vllm.ai/en/latest/api/vllm/sampling_params/ |
| Batch | `/v1/chat/completions/batch` accepts up to 1,024 conversations per request by default | https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/ |
| Structured outputs | On by default in the OpenAI-compatible server: `response_format` `json_schema`, or `structured_outputs` with `choice`, `regex`, `json`, `grammar`, `structural_tag` (the `guided_*` fields were removed in v0.12.0). Backends xgrammar or guidance, default `auto`. For reasoning models, see the next two rows | https://docs.vllm.ai/en/latest/features/structured_outputs.html |
| Reasoning parser | `--reasoning-parser <name>` (for example `qwen3` for the Qwen3 series, `deepseek_r1`) extracts the thinking into a separate `reasoning` field (formerly `reasoning_content`); the field is absent for models served without one. Qwen3 reasoning is on by default; `enable_thinking: false` in `chat_template_kwargs` turns it off per request, `--default-chat-template-kwargs '{"enable_thinking": false}'` for every request | https://docs.vllm.ai/en/latest/features/reasoning_outputs.html |
| Structured outputs with reasoning | With reasoning outside the output grammar, constraints start after the first end-of-reasoning marker; the reasoning parser supplies that marker (its end token). What happens with no reasoning parser is not stated; that the schema then also constrains thinking returned inside `content` follows from this, not measured here. Qwen3 Coder with reasoning: structured outputs may be disabled unless the reasoning is parsed into `reasoning`, or the server runs with `--structured-outputs-config.enable_in_reasoning=True` | https://docs.vllm.ai/en/latest/features/structured_outputs.html, https://docs.vllm.ai/en/latest/features/reasoning_outputs.html |
| Predicted outputs | `prediction` is not mentioned on the serving page. The nearest engine-side feature is n-gram speculative decoding (`--speculative-config '{"method": "ngram", ...}'`), which the page says gives "modest speedups"; MTP speculative decoding dropped one more cache block on a hybrid model (E9); n-gram speculation is untested here | https://docs.vllm.ai/en/latest/features/speculative_decoding/ |
| Client disconnect | Not stated on the serving page read | not stated (checked 2026-11-26) |

## Not stated in the docs

- Default block size and eviction policy: not stated in the docs (checked 2026-11-26).
- `cache_salt`: not mentioned on the page (checked 2026-11-26).
- The docs call `--prefix-match-unit` both required and defaulted; the default above is the one the page gives for the unset case.
<!-- leanprompt:generated v0.1.0-dev.13: written by npx leanprompt install; npx leanprompt update replaces local edits -->
