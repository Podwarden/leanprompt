# Target profile: `leanprompt.yaml`

An optional file at the root of your project. It tells the leanprompt skills and
CLI what you call, so that findings and advice are filtered and ranked for that
target. When the file is absent the audit asks, or infers the target from the code.

All keys are optional. Unknown keys are reported as errors (`unknown key: <name>`).

## Schema

```yaml
target:
  provider: anthropic        # anthropic | openai | gemini | openrouter | deepinfra | ... (a hosted provider)
  engine: vllm               # vllm | sglang | llama.cpp | lm-warden (a self-hosted engine)
  model_family: qwen         # free text, matched against models/<family>.md
  context_tokens: 32768      # positive integer

engine:                      # self-hosted only
  block_tokens: 1584         # cache block size, in tokens
  match_unit_tokens: 16      # prefix match unit; when set, it replaces block_tokens
  speculative: true          # speculative decoding (MTP, EAGLE) on or off
  kv_memory_gb: 16           # KV cache memory, positive number

priority: cost               # cost | speed | quality, or weights (below)

ignore:                      # written by the audit when you choose "don't flag this again"
  - {rule: LP-PC-01, file: src/legacy/client.ts}
```

Use `target.provider` for a hosted API or `target.engine` for an engine you run
yourself; setting both is an error (`set target.provider or target.engine, not both`).
The `engine:` block describes that engine's cache behaviour.

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

## Reading the file from code

`loadProfile(dir)` returns the profile, or `null` when `leanprompt.yaml` is
missing, and throws with the list of errors when it is invalid. `parseProfile(text)`
returns `{profile, errors}` without throwing. `effectiveFacts(profile, facts, provider?)`
returns the cache facts with the `engine:` values applied. Without `provider` the
table is chosen from the profile (`target.engine`, else `target.provider`). An engine
name passed as `provider` goes through the engine table, and a provider with no table
falls back to the profile's target. It throws
`unknown provider: <name>` when the name has no table and `no cache facts for
<engine> yet` for `llama.cpp`.
