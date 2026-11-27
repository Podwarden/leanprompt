# Provider notes

Each provider gets the same treatment: its cache rules, its render order and its limits, from its own documentation, dated. The facts live only in the tables under [providers/](../providers/) and [models/](../models/), each with a `checked:` date and a source; this page is a summary that links to them. Back to the [README](../README.md).

- **Anthropic** caches at the cache marks the request sets (or with its automatic mode); without marks, nothing is cached. [providers/anthropic.md](../providers/anthropic.md)
- **OpenAI** caches long prompts automatically by prefix; a stable `prompt_cache_key` helps route to the same cache. [providers/openai.md](../providers/openai.md)
- **Gemini** caches implicitly above a minimum that depends on the model; explicit caching exists on some models only. [providers/gemini.md](../providers/gemini.md)
- **OpenRouter** is a router: hits depend on the upstream provider, so keep one provider per conversation and pass cache marks through. [providers/openrouter.md](../providers/openrouter.md)
- **DeepInfra** caches automatically by prefix. [providers/deepinfra.md](../providers/deepinfra.md)
- **Azure OpenAI** caches long prompts automatically, as OpenAI does, with its own rules for lifetimes, cache writes and breakpoints by model family and deployment type; its reasoning models bill reasoning as output. [providers/azure-openai.md](../providers/azure-openai.md)
- **Alibaba Model Studio** (DashScope) has an explicit cache (marks, a short lifetime, a write premium) and an implicit one, and some Qwen models support only the explicit one. [providers/alibaba-model-studio.md](../providers/alibaba-model-studio.md)
- **Vercel AI Gateway** is a gateway: it passes requests through unchanged unless `caching: 'auto'` is set, which adds cache marks for the providers that need them. [providers/vercel-ai-gateway.md](../providers/vercel-ai-gateway.md)
- **DeepSeek** caches automatically, best effort, and reports hits in `prompt_cache_hit_tokens`; thinking is on by default. [providers/deepseek.md](../providers/deepseek.md)
- **Groq** caches automatically on the gpt-oss models only, at a discount. [providers/groq.md](../providers/groq.md)
- **xAI** caches automatically, routed by `prompt_cache_key` or `x-grok-conv-id`; its output limit covers visible output only. [providers/xai.md](../providers/xai.md)
- **Together** caches automatically, best effort, routed by `prompt_cache_key`; hybrid reasoning models reason by default. [providers/together.md](../providers/together.md)
- **Ollama** keeps a model loaded for its `keep_alive` time, runs one request at a time by default, and reports cache reuse in `prompt_eval_cached_count`. [providers/ollama.md](../providers/ollama.md)
- **vLLM** and **SGLang** cache in blocks or pages on your own hardware; block size and speculative decoding change how much is reused. [providers/vllm.md](../providers/vllm.md), [providers/sglang.md](../providers/sglang.md)

A provider with no table here (Fireworks, Mistral and other OpenAI-compatible hosts): the provider-independent generation rules still apply to it. For its caching, treat it as OpenAI-style automatic prefix caching only if the provider's own documentation says it does, and then say which page; otherwise the answer is "unknown, check the provider's docs". Never assume. To add a table, see [CONTRIBUTING](../.github/CONTRIBUTING.md).

Per-model habits (thinking and reasoning controls, template quirks) are in [models/](../models/), with model retirement dates in [models/retirements.md](../models/retirements.md) and tokens per character by language, measured on a sample, in [models/tokens-per-character.md](../models/tokens-per-character.md). SDK behaviour that affects token use (the Claude Agent SDK, the Codex SDK, the Vercel AI SDK) is in [runtimes/llm-sdks.md](../runtimes/llm-sdks.md), and LangChain.js and langchaingo defaults (retries, timeouts, output limits) in [runtimes/langchain.md](../runtimes/langchain.md).

Which usage field each provider reports, and how to compare two requests with it: [how-it-works.md](how-it-works.md#prove-it-measure-change-measure). Running your own engine: [self-hosting.md](self-hosting.md).
