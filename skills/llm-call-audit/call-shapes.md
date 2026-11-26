# Call shapes: how to find every LLM call

The first step of the audit is a complete inventory. An LLM call hides behind an SDK, a framework, a wrapper the app wrote itself, or a plain HTTP request. Search for all of them, then follow each hit to the line that sends the request.

Skip vendored and generated code (`node_modules/`, `.venv/`, `vendor/`, `dist/`, `build/`). List calls in tests separately: a test that calls a live model on every run is itself a finding candidate (LP-GE-06).

## SDKs and frameworks

| Shape | Language | What to search for | Provider |
|---|---|---|---|
| `anthropic` | Python | `import anthropic`, `from anthropic import`, `Anthropic(`, `AsyncAnthropic(`, `AnthropicBedrock(`, `AnthropicVertex(`, `messages.create(`, `messages.stream(` | Anthropic, or Bedrock or Vertex when those clients are used |
| `@anthropic-ai/sdk` | TS/JS | `from "@anthropic-ai/sdk"`, `new Anthropic(`, `messages.create(`, `messages.stream(` | Anthropic |
| `anthropic-sdk-go` | Go | `github.com/anthropics/anthropic-sdk-go`, `Messages.New(`, `Messages.NewStreaming(` | Anthropic |
| `openai` | Python | `from openai import`, `OpenAI(`, `AsyncOpenAI(`, `AzureOpenAI(`, `chat.completions.create(`, `responses.create(`, `batches.create(` | Whatever `base_url` points at (below) |
| `openai` | TS/JS | `from "openai"`, `new OpenAI(`, `chat.completions.create(`, `responses.create(`, `batches.create(` | Whatever `baseURL` points at |
| `openai-go`, `go-openai` | Go | `github.com/openai/openai-go`, `github.com/sashabaranov/go-openai`, `Chat.Completions.New(`, `CreateChatCompletion(` | Whatever the base URL points at |
| `google-genai` | Python | `from google import genai`, `genai.Client(`, `models.generate_content(`, `models.generate_content_stream(`, `caches.create(`; the older `google.generativeai` package too | Gemini |
| `@google/genai` | TS/JS | `from "@google/genai"`, `new GoogleGenAI(`, `models.generateContent(` | Gemini |
| `google.golang.org/genai` | Go | `genai.NewClient(`, `Models.GenerateContent(` | Gemini |
| LangChain | Python, TS/JS | `langchain_openai`, `langchain_anthropic`, `langchain_google_genai`, `@langchain/openai`, `@langchain/anthropic`, `ChatOpenAI(`, `ChatAnthropic(`, `.invoke(`, `.ainvoke(`, `.stream(`, `.batch(`, `create_react_agent(`, `AgentExecutor(` | The chat model class and its `base_url` |
| LangChain (Go) | Go | `github.com/tmc/langchaingo`, `llms.GenerateFromSinglePrompt(`, `GenerateContent(` | The model package imported |
| LlamaIndex | Python, TS/JS | `llama_index.llms`, `from llama_index.core import Settings`, `Settings.llm`, `llamaindex`, `.complete(`, `.chat(`, `as_query_engine(`, `as_chat_engine(` | The LLM class configured in `Settings` |
| LiteLLM | Python | `import litellm`, `litellm.completion(`, `litellm.acompletion(`, `litellm.batch_completion(`, `Router(`; a LiteLLM proxy is reached through the `openai` SDK with a `base_url` on the proxy | The `model` string prefix (`anthropic/`, `openai/`, `gemini/`, `hosted_vllm/` ...) |
| Vercel AI SDK | TS/JS | `from "ai"`, `generateText(`, `streamText(`, `generateObject(`, `streamObject(`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@openrouter/ai-sdk-provider` | The provider package and model passed to `model:` |

Agent frameworks built on these (CrewAI, AutoGen, the OpenAI Agents SDK, Mastra, Pydantic AI and others) end in one of the shapes above; search for the framework's agent or model class, then find where it sets the model and the base URL.

## Raw HTTP

Search all languages for the endpoint paths, in string literals and in URL builders:

| Endpoint | Dialect | Typical callers |
|---|---|---|
| `/v1/chat/completions` | OpenAI Chat Completions | OpenAI, OpenRouter, DeepInfra, vLLM, SGLang, LiteLLM proxy, LM Warden |
| `/v1/responses` | OpenAI Responses | OpenAI |
| `/v1/messages` | Anthropic Messages | Anthropic, and routers that accept the Anthropic dialect |
| `/v1/completions` | OpenAI legacy completions | self-hosted engines, older code |
| `:generateContent`, `:streamGenerateContent` | Gemini native | Gemini |
| `/v1/batches`, `/v1/messages/batches`, `:batchGenerateContent` | Batch APIs | bulk jobs (LP-GE-07 is about the jobs that do not use them) |

Shapes: Python `requests.post(`, `httpx.post(`, `httpx.AsyncClient(`, `aiohttp`; TS/JS `fetch(`, `axios.post(`, `got.post(`, `ky.post(`; Go `http.NewRequest(`, `http.Post(`, `resty`. The JSON body (`"messages"`, `"model"`, `"system"`, `"tools"`, `"contents"`) confirms it is an LLM call.

```
rg -n '/v1/(chat/completions|responses|messages|completions|batches)|:(stream)?[gG]enerateContent' -g '!{node_modules,.venv,vendor,dist,build}/**'
```

## The app's own wrapper

Most apps call the SDK in one or two helper functions (`call_llm`, `askModel`, `client.ts`). When a hit is inside such a helper, the call site the user cares about is each caller of the helper: list the callers (`rg -n 'call_llm\('`) and audit each one, because each passes its own system prompt, tools and history. Record the helper's line as well, since retry, timeout and parsing findings (LP-GE-04, LP-GE-05, LP-GE-10) usually live there.

## Which provider and model

1. The SDK or provider package, from the table above.
2. The base URL: `base_url`, `baseURL`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, or a URL constant in config. A host such as `api.openai.com`, `api.anthropic.com`, `openrouter.ai`, `api.deepinfra.com` or `generativelanguage.googleapis.com` names the provider. A URL on the user's own hosts (localhost, a private name or address) is a self-hosted engine; read the launch files (`docker-compose.yml`, Kubernetes manifests, `vllm serve`, `python -m sglang.launch_server`) to tell vLLM, SGLang, llama.cpp or LM Warden apart.
3. The model string: a router prefix such as `anthropic/` or `google/` means the upstream is that provider even though the SDK is `openai` (the cache marks then matter: LP-PC-01).
4. Environment and config files (`.env.example`, `settings.py`, `config.ts`) when the model or URL is read from a variable.

When these disagree, or the value comes only from the environment at run time, write "unknown" in the inventory and ask (see [presenting.md](presenting.md)); `leanprompt.yaml` settles it for the next run ([docs/profile.md](../../docs/profile.md)).

## Call kind

Each inventory row gets one kind. The kind decides which rules apply and how many calls share a prefix.

| Kind | How it looks in code | What it means for reuse |
|---|---|---|
| chat | A message list kept per user or session and appended to on each turn; a request handler that loads history, adds the new message and calls the model | Each turn should extend the last one; the prefix grows. History rules (LP-PC-06, LP-PC-08) apply. |
| agent loop | A `while`/`for` loop that calls the model, runs the tool calls it returns (`stop_reason == "tool_use"`, `finish_reason == "tool_calls"`, `tool_calls` in the response) and calls again; framework agents (`AgentExecutor`, `create_react_agent`, `maxSteps` or `stopWhen` in the Vercel AI SDK) | Many calls per task with a long fixed head of system prompt and tools; head and tool rules (LP-PC-03, LP-PC-04, LP-PC-05, LP-PC-09) matter most. |
| one-shot | One call per input, no history: classify, extract, summarise, title | Reuse only across inputs, through a shared head; small calls may suit a smaller model (LP-GE-08). |
| batch | A loop, `map`, `gather` or `Promise.all` over a dataset; a scheduled or nightly job; a batch API | Many calls with the same head in a short time; batch APIs and sample counts apply (LP-GE-01, LP-GE-02, LP-GE-07). |

A call can be several kinds at once (an agent loop run nightly over a dataset): record the main one and note the other.

## Following a call to where its prompt is built

From each call site, trace the arguments back:

- **System prompt:** the string or builder passed as `system`, the first `system` message, or `instructions`. Look for f-strings, template literals, `.format(`, `datetime.now()`, `new Date()`, user or tenant ids, paths, versions, and retrieved text in it.
- **Tools:** the list passed as `tools` or `functions`; the registry or MCP client that produces it, and whether its order is fixed.
- **History:** where the message list is stored, loaded, trimmed, summarised or rewritten between turns.
- **Request options:** `max_tokens`, `thinking`, `reasoning_effort`, `temperature`, `n`, `tool_choice`, `prompt_cache_key`, `cache_control`, timeouts and retries (on the client and in decorators around the call).

The rule files of [prefill-cache](../prefill-cache/SKILL.md), [generation-economy](../generation-economy/SKILL.md) and [lmwarden](../lmwarden/SKILL.md) give the `rg` patterns and code shapes for each rule; use them once the call sites are known.
