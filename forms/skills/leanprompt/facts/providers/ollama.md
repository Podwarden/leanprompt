---
provider: ollama
checked: 2026-11-27
source: https://github.com/ollama/ollama/blob/main/docs/faq.mdx
cache:
  mode: automatic
  min_tokens: 0
  ttl_seconds: 300
---

# Ollama (self-hosted)

Status: documented, not yet measured here. Read on 2026-11-27 from the `main` branch of https://github.com/ollama/ollama (commit `8ae8acb81afba9c3c67adf08190964eb7d1207ef`). The URLs in the task, `docs/faq.md`, `docs/openai.md` and `docs/api.md`, now give a 404 or a short stub for the first two: the FAQ is `docs/faq.mdx` and the OpenAI page is `docs/api/openai-compatibility.mdx`. `docs/api.md` still exists.

`ttl_seconds: 300` is the documented default `keep_alive` (five minutes). That setting is how long the loaded model stays in memory, not a stated lifetime for a cached prompt prefix. The pages read do not state how long cached prompt tokens stay valid, so 300 is a planning floor, not a stated cache lifetime.

`min_tokens: 0` means no minimum is stated on the pages read.

## Facts

| Fact | Value | Source |
|---|---|---|
| Cache reporting field | `prompt_eval_cached_count`: "number of prompt tokens read from the cache". It sits next to `prompt_eval_count` (tokens in the prompt) and `prompt_eval_duration` ("time spent in nanoseconds evaluating uncached prompt tokens"). On streaming responses the usage fields are in the final chunk, where `done` is `true` | https://github.com/ollama/ollama/blob/main/docs/api.md, https://github.com/ollama/ollama/blob/main/docs/api/usage.mdx |
| Output tokens | `eval_count`: number of tokens in the response | https://github.com/ollama/ollama/blob/main/docs/api.md |
| Prefix reuse rules | How a prefix is matched, what granularity applies and whether a prefix survives another request are not stated on the pages read (checked 2026-11-27) | not stated on the pages read |
| Second request evicting a cached prefix on a single slot | Not stated on the pages read (checked 2026-11-27). The FAQ says only that parallel requests for one model enlarge the context by the number of parallel requests (a 2K context with 4 parallel requests becomes 8K) | https://github.com/ollama/ollama/blob/main/docs/faq.mdx |
| `OLLAMA_NUM_PARALLEL` | "The maximum number of parallel requests each model will process at the same time." Unset or zero: MLX on Metal chooses a conservative default from available memory and the model's cache needs; other backends default to 1 | https://github.com/ollama/ollama/blob/main/docs/faq.mdx |
| `OLLAMA_MAX_QUEUE` | Default 512; beyond it the server answers `503` overloaded | https://github.com/ollama/ollama/blob/main/docs/faq.mdx |
| Default `keep_alive` | `5m` on `/api/generate` and `/api/chat`; the FAQ: "By default models are kept in memory for 5 minutes before being unloaded" | https://github.com/ollama/ollama/blob/main/docs/api.md, https://github.com/ollama/ollama/blob/main/docs/faq.mdx |
| How `keep_alive` works | A duration string ("10m", "24h"), a number of seconds (3600), any negative number (keeps the model loaded) or `0` (unload right after the response). The request parameter overrides `OLLAMA_KEEP_ALIVE`, which takes the same value types. The default of `OLLAMA_KEEP_ALIVE` itself is not stated apart from the 5-minute statement above | https://github.com/ollama/ollama/blob/main/docs/faq.mdx |
| Load with an empty request | An empty request (`{"model": "mistral"}`) to `/api/generate` or `/api/chat` preloads the model | https://github.com/ollama/ollama/blob/main/docs/faq.mdx |
| Unload with an empty request | `keep_alive: 0` on an empty prompt (generate) or an empty `messages` array (chat) unloads the model; the response has `done_reason: "unload"`. A load-only request returns `done_reason: "load"` | https://github.com/ollama/ollama/blob/main/docs/api.md |
| Default context length | Three statements that differ. FAQ: "By default, Ollama uses a context window size of 4096 tokens", changed with `OLLAMA_CONTEXT_LENGTH`. Context-length page: by VRAM, under 24 GiB 4k, 24 to 48 GiB 32k, 48 GiB or more 256k. Modelfile page: `num_ctx` "(Default: 2048)". Which one applies to your install is not settled by the pages read | https://github.com/ollama/ollama/blob/main/docs/faq.mdx, https://github.com/ollama/ollama/blob/main/docs/context-length.mdx, https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx |
| `num_ctx` request option | "Context length size (number of tokens)"; set per request under `options` | https://github.com/ollama/ollama/blob/main/docs/openapi.yaml |
| `num_predict` default | `-1`, "infinite generation"; "Maximum number of tokens to predict when generating text" | https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx |
| Prompt longer than the context | For `/api/generate` and `/api/chat`, truncation or an error is not stated on the pages read (checked 2026-11-27). For embeddings, `truncate` defaults to `true` ("truncates the end of each input to fit within context length"); `false` returns an error | https://github.com/ollama/ollama/blob/main/docs/api.md |
| `done_reason` values | Values shown in the examples: `stop`, `load`, `unload`. `length` is not shown on the pages read; the field is described only as "Reason the generation stopped" | https://github.com/ollama/ollama/blob/main/docs/openapi.yaml, https://github.com/ollama/ollama/blob/main/docs/api.md |
| OpenAI-compatible endpoint | `/v1/chat/completions` supports `stream_options.include_usage`, `max_tokens`, `stop`, `seed`, `tools`. It does not support `n`, `tool_choice`, `logit_bias`, `user` or logprobs. Which usage fields the response carries (and whether cached tokens appear) is not stated on the page read | https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx |
| Parallel requests need memory | "More parallel requests require more memory"; with insufficient memory to load a new model, new requests queue until a loaded model goes idle and is unloaded | https://github.com/ollama/ollama/blob/main/docs/faq.mdx |

## Generation features (docs, checked 2026-11-27)

Used by the `generation-economy` rules.

| Fact | Value | Source |
|---|---|---|
| `n` (several samples per request) | Not supported on `/v1/chat/completions` (listed as an unchecked box) | https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx |
| Structured outputs | `format` takes `json` or a JSON schema; the page warns to ask for JSON in the prompt, or the model "may generate large amounts whitespace" | https://github.com/ollama/ollama/blob/main/docs/api.md |
| Thinking | `think` takes a boolean or a level (`low`, `medium`, `high`, `max`) on `/api/generate` | https://github.com/ollama/ollama/blob/main/docs/api.md |
| Client disconnect | Not stated on the pages read | not stated on the pages read (checked 2026-11-27) |

## Not stated in the pages read

- Whether a second request on a single slot evicts the first conversation's cached prefix (checked 2026-11-27).
- A minimum prompt length, a step size or a cache lifetime for cached prompt tokens.
- What happens to a prompt that exceeds the context window on the generate and chat endpoints.
- The `length` value of `done_reason`.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
