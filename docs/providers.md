# Provider notes

Each provider gets the same treatment: its cache rules, its render order and its limits, from its own documentation, dated. The facts live only in the tables under [providers/](../providers/) and [models/](../models/), each with a `checked:` date and a source; this page is a summary that links to them. Back to the [README](../README.md).

- **Anthropic** caches at the cache marks the request sets (or with its automatic mode); without marks, nothing is cached. [providers/anthropic.md](../providers/anthropic.md)
- **OpenAI** caches long prompts automatically by prefix; a stable `prompt_cache_key` helps route to the same cache. [providers/openai.md](../providers/openai.md)
- **Gemini** caches implicitly above a minimum that depends on the model; explicit caching exists on some models only. [providers/gemini.md](../providers/gemini.md)
- **OpenRouter** is a router: hits depend on the upstream provider, so keep one provider per conversation and pass cache marks through. [providers/openrouter.md](../providers/openrouter.md)
- **DeepInfra** caches automatically by prefix. [providers/deepinfra.md](../providers/deepinfra.md)
- **vLLM** and **SGLang** cache in blocks or pages on your own hardware; block size and speculative decoding change how much is reused. [providers/vllm.md](../providers/vllm.md), [providers/sglang.md](../providers/sglang.md)

A provider with no table here (DeepSeek, Groq, Together, Azure and other OpenAI-compatible hosts): the provider-independent generation rules still apply to it. For its caching, treat it as OpenAI-style automatic prefix caching only if the provider's own documentation says it does, and then say which page; otherwise the answer is "unknown, check the provider's docs". Never assume. To add a table, see [CONTRIBUTING](../.github/CONTRIBUTING.md).

Per-model habits (thinking and reasoning controls, template quirks) are in [models/](../models/).

Which usage field each provider reports, and how to compare two requests with it: [how-it-works.md](how-it-works.md#prove-it-measure-change-measure). Running your own engine: [self-hosting.md](self-hosting.md).
