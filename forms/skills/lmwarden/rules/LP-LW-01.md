---
id: LP-LW-01
title: Turn on prefix caching and set the match unit
skill: lmwarden
applies_to: [vllm, sglang, lm-warden]
saves: prefill
severity: high
evidence: [E9]
---
## Rule
On a self-hosted engine, run with prefix caching on, and on a hybrid model set the prefix match unit (vLLM) or page size (SGLang) small enough that a prompt's tail is not thrown away.

## Why
A block-mode prefix cache reuses whole blocks. The part of a prompt after the last full block is recomputed on every request, and an engine that drops one more block (speculative decoding does this on the hybrid model measured) recomputes that block too. With large blocks this is most of a short prompt. On one 4B hybrid model on one 16 GB card, the block was 1,584 tokens, and short prompts reused 44% of their tokens on an append-only workload (E9). With `--prefix-match-unit 16` on vLLM 0.32 the same workload reused 76%, against an ideal of 78%, with no change in decode speed (E9). That is one model, one card and thinking off; another model, engine version or card count can differ.

What the engine documents: `--prefix-match-unit` sets the granularity at which prefix-cache keys are computed. Unset, it defaults to the greatest common divisor of the cacheable block sizes, which on hybrid Mamba models is the block size; the docs suggest 64 as a starting point. On hybrid models a hit can resume only at a block boundary of the Mamba state, and the shared-prefix checkpoint option is off by default and works only with a match unit smaller than the Mamba block ([providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/vllm.md)). SGLang matches at its `page_size`, and the radix tree splits a node for an exact boundary ([providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/sglang.md)), documented, not yet measured here. Whether prefix caching is on by default is not in the tables; check the launch arguments.

A non-hybrid model usually has a small block and little to gain from the match unit; the first step there is only to confirm caching is on.

## Detect in code
Look at how the server is launched, and at code that launches it. The client code does not show this.

Launch files (compose, Kubernetes, systemd, shell, Makefile):
```
rg -n 'vllm serve|vllm\.entrypoints|--no-enable-prefix-caching|--enable-prefix-caching|--prefix-match-unit|--enable-mamba-shared-prefix-checkpoint' .
rg -n 'sglang\.launch_server|--page-size|page_size' .
rg -n 'speculative|--speculative-config|mtp|eagle' .
```
Shapes: a `vllm serve` command with `--no-enable-prefix-caching`; a hybrid model (a Qwen model whose `chat_template` or `config.json` names Mamba or linear-attention layers) with speculative decoding on and no `--prefix-match-unit`.

Python, TS/JS, Go: code that starts an engine as a subprocess (`subprocess.Popen(["vllm", "serve", ...])`, `spawn("vllm", ...)`, `exec.Command("vllm", ...)`) carries the same arguments; apply the same patterns to its argument lists.

Check the data too: a self-hosted app whose cached share is low while kvsig says the prefix was equal (`prefill-cache`, "Reading kvsig ids"), with the shortfall close to the block size.

For LM Warden the engine facts are reported by the server; run `leanprompt profile detect` (see the skill; it needs a release with that endpoint) instead of reading launch files.

## Fix
Confirm caching is on, then add the match unit for a hybrid model. Start from a value the engine's documentation suggests and measure; 16 is the value measured in E9, on one model.

```bash
# before
vllm serve Qwen/<hybrid-model> --speculative-config '{"method": "mtp", "num_speculative_tokens": 2}'

# after
vllm serve Qwen/<hybrid-model> --enable-prefix-caching --prefix-match-unit 16 \
  --speculative-config '{"method": "mtp", "num_speculative_tokens": 2}'
```

Then record what the engine reports in `leanprompt.yaml`, so the scorer uses the real granularity:

```yaml
target: {engine: vllm}
engine:
  block_tokens: 1584
  match_unit_tokens: 16
  speculative: true
```

## Don't break meaning
Prefix caching does not change answers. The match unit changes what is stored and where a hit can resume, not what the model computes, but it is an engine setting with costs this skill has not measured beyond E9 (which saw no change in decode speed): watch memory headroom and decode speed after the change, and roll back if either moves. Restart the engine to apply it, which empties its cache and drops live conversations' warm prefixes. Do it in a quiet window and tell the people who use the server.

## Verify
(a) Send the same long conversation twice, appending a short turn each time. Before the change the second request reports cached tokens only up to a block boundary (`cached_tokens` in the usage, where the server reports it, or the engine's prefix-cache hit counters); after it, `cached_tokens` is close to the previous turn's full prompt.

(b) kvsig: the two requests have equal exact `nodes[i]` up to the previous turn. The share of the reusable prefix that was actually cached should rise toward the ideal; E9 went from 44% to 76% of prompt tokens on its workload, against 78% ideal (E9). Run the same conversation before and after, on the same model and engine version.

## Waste signal
Measured: raises E (provider-cached tokens over reusable tokens) for short prompts on a block-mode engine; the scorer treats the last partial block as the engine's rule and not as the app's, using the `engine:` values (docs/profile.md). A shortfall much larger than one block counts against the app. Static: a finding of severity high where a hybrid model runs with speculative decoding and no match unit, or with prefix caching turned off; low where the model is not hybrid and caching is on.
<!-- leanprompt:generated v0.1.0-dev.2 — managed by npx leanprompt init; local edits are replaced on update -->
