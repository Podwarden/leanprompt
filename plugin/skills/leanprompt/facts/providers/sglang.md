---
provider: sglang
checked: 2026-11-26
source: https://docs.sglang.io/advanced_features/hicache_design.html
cache:
  mode: block
  min_tokens: 0
  block_tokens: 1
  ttl_seconds: 0
---

# SGLang (self-hosted)

Status: documented, not yet measured here.

`ttl_seconds: 0` means no lifetime: eviction only. `block_tokens: 1` is a placeholder for exact-token matching; it applies when `page_size` is 1. The default `page_size` is not stated in the docs (checked 2026-11-26), so read it from your server arguments.

## Facts (docs, checked 2026-11-26)

| Fact | Value |
|---|---|
| Mechanism | RadixAttention: "leverages idle GPU memory to cache and reuse prefix KV caches"; each radix tree node holds the KV cache of a consecutive span of tokens |
| Granularity | `page_size` is "the number of tokens per page" and "determines the granularity of KV cache storage and retrieval". When `page_size > 1`, matching is done at page granularity. A match that ends inside a node splits the node, giving an exact boundary |
| Hierarchical cache (HiCache) | Write-back to a lower tier happens when an entry is evicted from the upper tier. The `HiCacheFastFile` backend does background LRU eviction |

## Generation features (docs, checked 2026-11-26)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | Accepted on chat completions and completions, "Integer from 1 to 128". Whether the samples share one prefill is not stated; it follows from the radix cache, untested here | https://docs.sglang.io/basic_usage/openai_api_completions.html |
| Structured outputs | `response_format` `json_schema`, or `regex` / `ebnf` through `extra_body`, one constraint per request; backends XGrammar (default), Outlines, Llguidance. "The model output will be guaranteed to follow the given constraints" | https://docs.sglang.io/advanced_features/structured_outputs.html |
| Predicted outputs, batch API, client disconnect | Not on the pages read | not stated (checked 2026-11-26) |

## Not stated in the docs

- Default `page_size`: not stated in the docs (checked 2026-11-26).
- Eviction policy of the radix tree and of HiCache's memory tiers: not stated in the docs (checked 2026-11-26).
- Flag to disable the radix cache: not stated on the pages read (checked 2026-11-26).
- Treatment of hybrid or Mamba models: not read.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
