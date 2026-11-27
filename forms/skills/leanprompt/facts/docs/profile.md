# Target profile: `leanprompt.yaml`

An optional file at the root of your project. It tells the leanprompt skills and
CLI what you call, so that findings and advice are filtered and ranked for that
target. When the file is absent the audit asks, or infers the target from the code.

All keys are optional. Unknown keys are reported as errors (`unknown key: <name>`).

## Schema

```yaml
target:                      # or targets: a list, one entry per backend (below)
  provider: anthropic        # anthropic | openai | gemini | openrouter | deepinfra | ... (a hosted provider)
  engine: vllm               # vllm | sglang | llama.cpp | lm-warden (a self-hosted engine)
  model_family: qwen         # free text, matched against models/<family>.md
  context_tokens: 32768      # positive integer

engine:                      # self-hosted only
  block_tokens: 1584         # cache block size, in tokens
  match_unit_tokens: 16      # prefix match unit; when set, it replaces block_tokens
  speculative: true          # speculative decoding (MTP, EAGLE) on or off
  kv_memory_gb: 16           # KV cache memory, positive number
  prefill_tokens_per_second: 8000   # measured prefill throughput, for GPU time (optional)

volume:                      # optional: calls a month, for money figures on the report page
  calls_per_month: 30000
  source: our dashboard, Nov 2026

prices:                      # optional: per model, US dollars per 1M tokens, with source and date
  example-model:
    input: 0.50
    cached_input: 0.05
    output: 2.00
    source: https://provider.example/pricing
    checked: 2026-11-26

priority: cost               # cost | speed | quality, or weights (below)

ignore:                      # written by the audit when you choose "don't flag this again"
  - {rule: LP-PC-01, file: src/legacy/client.ts}
```

Use `target.provider` for a hosted API or `target.engine` for an engine you run
yourself; setting both is an error (`set target.provider or target.engine, not both`).
The `engine:` block describes that engine's cache behaviour.

### Several backends: `targets`

An app that sends some calls to an engine you run and others to a hosted API
(chosen per call site, or at run time from a setting) lists each backend under
`targets:` instead of `target:`:

```yaml
targets:
  - engine: vllm             # each entry: exactly one of provider or engine
    model_family: qwen
    context_tokens: 32768
    files: [src/llm/selfhosted.ts]      # optional globs: the call sites that use this backend
    engine_facts:            # optional: this engine's cache facts (same keys as engine:)
      block_tokens: 1584
  - provider: deepseek
    files: [src/llm/hosted.ts]
```

- Each entry takes `provider` or `engine` (not both, and not neither), with the
  same values and checks as `target`, plus optional `model_family`,
  `context_tokens`, `files` and, on an engine entry, `engine_facts`.
- `target` and `targets` together are an error (`set target or targets, not both`).
- Engine facts: with one engine entry, the top-level `engine:` block still applies
  to it. With two or more engine entries, give each its own `engine_facts`; a
  top-level `engine:` is then an error, because leanprompt would have to guess
  which engine it describes.
- `files` is for the audit: it says which backend a call site uses, so that a
  provider-specific rule is checked against that backend. Usage records carry no
  file, so the score does not read it.
- `profile detect --lmwarden` writes into the `lm-warden` entry (else the `vllm`
  entry), and adds `{engine: lm-warden}` when there is neither.

Cache facts exist for `vllm` and `sglang`. `lm-warden` serves models through vLLM
and uses the `vllm` table. `llama.cpp` is accepted in the profile but has no cache
table yet, so cache-dependent advice cannot be computed for it.

### Which `provider` to log

The measured score looks up the cache facts by the `provider` each usage record
carries, so the logger's `provider` should name where the request is served:

- A hosted API with its own table: `anthropic`, `openai`, `gemini`, `openrouter`,
  `deepinfra`.
- A self-hosted server: `vllm`, `sglang` or `lm-warden`, even when the app calls it
  through the OpenAI SDK. `lm-warden` and the other engine names go through the same
  engine table as `target.engine`. A self-hosted server logged as `openai` is scored
  on OpenAI's facts, and the `engine:` values are not applied.
- An OpenAI-compatible host with no table here (Groq, Together, Azure, DeepSeek and
  others): its own name. For a provider with no table, the profile's target
  (`target.engine`, else `target.provider`) decides the cache facts. With no target
  set, those calls are unmeasured (`unknown_provider`), and `leanprompt score` prints
  the count by reason.

With `targets`, the facts for each usage record are chosen in this order, and
never guessed:

1. The record's own `provider`: an engine name goes through the engine table
   (with that engine entry's `engine_facts`, else `engine:`); a provider with a
   table uses it.
2. When that name has no table, the `targets` entry whose `provider` is that name.
   It has no table either, so the record is unmeasured as `unknown_provider`.
3. Otherwise, with a single target, that target, as above.
4. With several targets and no match, the record is unmeasured with the reason
   `ambiguous_target`. Log the backend's own name (`vllm`, `lm-warden`, `openai`)
   or add a `targets` entry for the host.

### `priority`

Either one word or a weights object:

```yaml
priority: speed
```

```yaml
priority: {cost: 0.5, speed: 0.3, quality: 0.2}
```

A word is read as full weight on that axis (`speed` is `{cost: 0, speed: 1, quality: 0}`).
Weights must be numbers of 0 or more, give all three keys, and sum to 1 within
0.01, otherwise the error is `priority weights must sum to 1`. When `priority`
is absent every axis weighs one third.

Caching never changes answers, so it applies whatever the priority. The priority
changes which other advice ranks first: output budgets and thinking effort for
speed, batch APIs and cheaper models for cost, thinking budgets and larger models
for quality.

### `engine` and the cache facts

The provider tables in `providers/` hold the default cache facts for each
provider. For a block-mode provider (vLLM, SGLang) the `engine:` values are laid
over those defaults:

- `block_tokens` replaces the table's block size.
- `match_unit_tokens`, when set, becomes the block size instead (reuse then
  follows the match unit; see E9 in [evidence.md](evidence.md)).
- `speculative: true` means the engine drops one more block; `false` means it
  does not.

Engine values have no effect on providers that cache automatically or with
breakpoints.

### `volume` and `prices`

Optional. With both, the report page (`leanprompt report --html`) turns the audit's
token estimates into money: what the findings cost a month, and what fixing them
saves. Without them it shows tokens per 1,000 calls and says what to add. leanprompt
never invents a volume or a price, and money is never part of the score.

- `volume.calls_per_month`: how many calls the whole app makes a month, a positive
  integer, with an optional `source` (where the number came from). With `targets:`,
  give each entry its own `volume:` instead; the page uses their sum, and only when
  every entry has one. A top-level `volume:` next to `targets:` is an error.
- `prices.<model>`: `input` and `output` (required), `cached_input` (needed to price
  prompt tokens the cache could have served) and `cache_write`, in US dollars per
  million tokens, with `source` (the pricing page's URL, or where your own price comes
  from) and `checked` (the date you read it, `YYYY-MM-DD`). A price without a source
  or a date is rejected. With several models, the audit sets `model` on each finding.
- `engine.prefill_tokens_per_second` (self-hosted): your engine's measured prefill
  throughput. With a volume, the page shows the GPU prefill time the findings cost a
  month and the first-token time they add.

The figures are your own: your volume, your price, the audit's estimate of the tokens
each finding loses. The page shows every input next to the result, so each figure can
be checked by hand. The values in the schema above are illustrative.

### `ignore`

A list of `{rule, file}` entries. Each is a rule id and a file path the audit
should stop reporting. You can edit the list by hand.

## Examples

### Hosted provider, cost first

```yaml
target:
  provider: openai
  model_family: openai-reasoning
  context_tokens: 128000
priority: cost
```

### Hosted provider, balanced weights

```yaml
target:
  provider: anthropic
  model_family: anthropic-thinking
priority: {cost: 0.4, speed: 0.2, quality: 0.4}
```

### Self-hosted vLLM with speculative decoding

```yaml
target:
  engine: vllm
  model_family: qwen
  context_tokens: 32768
engine:
  block_tokens: 1584
  match_unit_tokens: 16
  speculative: true
  kv_memory_gb: 16
priority: speed
```

### LM Warden

```yaml
target:
  engine: lm-warden
  model_family: qwen
priority: quality
```

### Self-hosted vLLM and a hosted API, chosen at run time

An app that sends each request to its own vLLM server or to a hosted
DeepSeek model, depending on a setting read at start-up. The logger records
`vllm` or `deepseek` as each call's `provider`, so each record finds its backend.

```yaml
targets:
  - engine: vllm
    model_family: qwen
    context_tokens: 32768
    files: [src/llm/selfhosted.ts]
  - provider: deepseek
    files: [src/llm/hosted.ts]
engine:                      # the one engine entry's cache facts
  block_tokens: 1584
  match_unit_tokens: 16
priority: cost
```

Records logged as `vllm` are scored on the vLLM table with these engine values.
DeepSeek has no table here, so records logged as `deepseek` are unmeasured
(`unknown_provider`) until it has one; the audit still applies the
provider-independent rules to those call sites.

## Reading the file from code

`loadProfile(dir)` returns the profile, or `null` when `leanprompt.yaml` is
missing, and throws with the list of errors when it is invalid. `parseProfile(text)`
returns `{profile, errors}` without throwing. `effectiveFacts(profile, facts, provider?)`
returns the cache facts with the `engine:` values applied. Without `provider` the
table is chosen from the profile (`target.engine`, else `target.provider`). An engine
name passed as `provider` goes through the engine table, and a provider with no table
falls back to the matching `targets` entry, then to a single target.
`profileTargets(profile)` lists the targets of either form. With several targets
and nothing to choose by, it throws `AmbiguousTargetError` (`code:
"ambiguous_target"`). It throws
`unknown provider: <name>` when the name has no table and `no cache facts for
<engine> yet` for `llama.cpp`.
<!-- leanprompt:generated v0.1.0-dev.13: written by npx leanprompt install; npx leanprompt update replaces local edits -->
