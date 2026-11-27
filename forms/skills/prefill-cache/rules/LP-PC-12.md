---
id: LP-PC-12
title: Do not split one prefix across models or keys that do not share a cache
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, lm-warden, sglang]
saves: prefill
severity: medium
evidence:
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
  - doc: https://openrouter.ai/docs/features/provider-routing
    checked: 2026-11-26
---
## Rule
Send requests that share a long prefix to the same model, the same provider route and the same cache key, and switch any of them per session, not per request.

## Why
A KV cache is computed by one model's weights, so two models never share one, and a cache lives with the provider (and the key, and on self-hosted servers the replica) that wrote it. Traffic that shares a prefix but is spread over several of them gives each part its own cold cache. This follows from how KV caches work; the cited pages document the key and routing behaviour. Not yet measured here.

- Models: an A/B test assigned per request; a cheap model for some turns of a session and a large one for others; a fallback chain that moves a conversation on the first error.
- Routes: a router load-balancing one model over several upstream providers. OpenRouter keeps a conversation with one provider only while that provider's cache is warm and the conditions in [providers/openrouter.md](../../leanprompt/facts/providers/openrouter.md) hold; fallbacks are on by default.
- Keys: OpenAI's `prompt_cache_key` routes requests that share it together ([providers/openai.md](../../leanprompt/facts/providers/openai.md)); a key unique per request, or per user when the prefix is per tenant, splits the group. On self-hosted servers a per-request `cache_salt` or session scope does the same.
- Replicas of one self-hosted model: reuse needs the request to reach the replica that holds the prefix. That is engine-side routing, covered in the `lmwarden` skill.

## Detect in code
Python:
```
rg -n 'random\.choice\(.*(model|MODEL)|prompt_cache_key\s*=|allow_fallbacks|"order"|models\s*=\s*\[|routing_strategy' -g '*.py'
```
Shapes: `model = random.choice(MODELS)` per request; `model = SMALL if is_easy(msg) else LARGE` inside one conversation; `prompt_cache_key=str(uuid.uuid4())`; a LiteLLM `Router` with `routing_strategy="simple-shuffle"` over several deployments; OpenRouter calls with no `provider` preferences on a long session.

TS/JS:
```
rg -n 'Math\.random\(\).*model|prompt_cache_key|allow_fallbacks|models:\s*\[' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `model: Math.random() < split ? A : B` per request; `prompt_cache_key: crypto.randomUUID()`; an OpenRouter body with `models: [a, b]` as a per-request fallback list.

Go:
```
rg -n 'rand\.(Intn|IntN)\(len\(models|PromptCacheKey|AllowFallbacks' -g '*.go'
```
Shapes: `models[rand.Intn(len(models))]` per request; `PromptCacheKey: uuid.NewString()`.

## Fix
Make the choice once per session (or per tenant) and keep it.

```python
# before
model = random.choice(["model-a", "model-b"])
resp = client.chat.completions.create(model=model, messages=history,
                                      extra_body={"prompt_cache_key": str(uuid.uuid4())})

# after
model = session.model                                   # assigned once, when the session starts
resp = client.chat.completions.create(model=model, messages=history,
                                      extra_body={"prompt_cache_key": f"tenant:{tenant.id}",
                                                  "provider": {"order": [session.provider],
                                                               "allow_fallbacks": False}})
```

The `provider` block is OpenRouter's; leave it out for a direct provider. Fail over to another provider or model per session, after an error, and expect one cold prefix when you do.

## Don't break meaning
Pinning a route removes automatic fallbacks: keep error handling that moves the session elsewhere on failure, rather than failing the user. An A/B test assigned per session still compares the same two arms. Do not widen a cache key or scope across tenants that must stay isolated; isolation beats cache reuse.

## Verify
(a) Two consecutive requests of one session report the same model (and, on OpenRouter, the same upstream provider), and the second reports `cached_tokens` or `cache_read_input_tokens` covering the first.

(b) kvsig: in the usage log, requests whose exact `nodes` share a long prefix carry the same model and key. Equal `nodes` prefixes with different models or keys and `cached_tokens` of 0 is the split.

## Waste signal
Measured: lowers E. kvsig says the prefix was seen before, the provider reports no read because the earlier request went to another model, route or key. Static: severity medium for a per-request model choice, per-request cache key or unpinned router on long sessions.
<!-- leanprompt:generated v0.1.0-dev.15: written by npx leanprompt install; npx leanprompt update replaces local edits -->
