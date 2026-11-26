---
id: LP-GE-01
title: n samples in one request
skill: generation-economy
applies_to: [openai, gemini, deepinfra, vllm, sglang]
saves: prefill
severity: medium
evidence:
  - E12
  - doc: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
    checked: 2026-11-26
  - doc: https://aistudio.google.com/api-reference/generate-content
    checked: 2026-11-26
  - doc: https://docs.deepinfra.com/api-reference/chat-completions/openai-chat-completions.md
    checked: 2026-11-26
---
## Rule
When the app needs several samples of the same prompt (self-consistency votes, candidate answers to rank, an evaluation that scores spread), ask for them in one request with the API's sample-count parameter instead of sending the same request again for each sample.

## Why
Every request pays to prefill its prompt. A loop that sends one request per sample prefills the same context once per sample, and the samples gain nothing from it: they differ only in what is generated. A literary question-answering benchmark did exactly this, sending the same request repeatedly to collect several samples instead of one request with `n` samples, and paid prefill once per sample (E12). That case has not been measured before and after yet, so this rule gives no figure for it.

One request with a sample count prefills once and decodes the samples from that prefill. Where the parameter exists:

- **OpenAI** Chat Completions takes `n`, and bills generated tokens across all choices. Newer models reject an explicit `n`, even `n=1`, and the Responses API has no `n` ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/openai.md)).
- **Gemini** takes `candidateCount` in the generation config ([providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/gemini.md)).
- **DeepInfra** takes `n` on its OpenAI-compatible endpoint, with a small upper limit ([providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/deepinfra.md)).
- **vLLM** and **SGLang** take `n` ([providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/vllm.md), [providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/sglang.md)). That the samples then share one prefill follows from their prefix caches; it is untested here.
- **Anthropic** has no sample-count parameter on the Messages API, and OpenRouter does not list one ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/anthropic.md), [providers/openrouter.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.8/providers/openrouter.md)).

Where `n` is not available, the repeats can still share a cached prefix: send the first request, wait for it, then send the rest, with a cache mark on the shared prompt where the provider needs one (LP-PC-01). Repeats fired all at once may all start before any cache entry exists. That ordering follows from how prefix caches work; it is untested here.

## Detect in code
Look for a loop or a gather that sends the same request body several times and collects the results.

Python:
```
rg -n 'for _ in range\(|asyncio\.gather\(|ThreadPoolExecutor|n_samples|num_samples|samples' -g '*.py'
rg -n 'chat\.completions\.create\(|generate_content\(|messages\.create\(' -g '*.py'
```
Shapes: `[client.chat.completions.create(model=M, messages=msgs, temperature=T) for _ in range(k)]`; `await asyncio.gather(*(ask(prompt) for _ in range(k)))`; a majority vote over answers from a repeated call.

TS/JS:
```
rg -n 'Array\.from\(\{ ?length|Promise\.all\(|for \(let i = 0; i < (k|n|samples)' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `await Promise.all(Array.from({ length: k }, () => client.chat.completions.create(body)))`.

Go:
```
rg -n 'for i := 0; i < (k|n|samples)|errgroup|sync\.WaitGroup' -g '*.go'
```
Shapes: a `for` loop or an `errgroup` that calls `client.Chat.Completions.New(ctx, params)` with the same `params` each time.

Not a finding: repeats that deliberately change something per sample (a different seed, temperature, model or prompt), and a provider or model without a sample-count parameter (then check the ordering advice above).

## Fix
```python
# before: one request, and one prefill, per sample
answers = [
    client.chat.completions.create(model=MODEL, messages=msgs, temperature=TEMP)
    .choices[0].message.content
    for _ in range(N_SAMPLES)
]

# after: one request, N_SAMPLES choices
resp = client.chat.completions.create(model=MODEL, messages=msgs, temperature=TEMP, n=N_SAMPLES)
answers = [c.message.content for c in resp.choices]
```

```ts
// Gemini: candidateCount in the generation config
const resp = await ai.models.generateContent({
  model: MODEL,
  contents,
  config: { temperature: TEMP, candidateCount: N_SAMPLES },
});
const answers = resp.candidates?.map((c) => c.content?.parts?.[0]?.text ?? "") ?? [];
```

Keep the provider's upper limit on the count in mind; split into a few requests when it is lower than the number of samples needed.

## Don't break meaning
The samples must stay independent draws from the same settings: keep the same temperature and other sampling parameters as the repeated calls. If the repeats used a different seed or temperature on purpose, `n` is not the same experiment; keep them, and use the ordering advice instead. At temperature zero, several samples are pointless in either form. Code that reads `choices[0]` only must be changed to read every choice.

## Verify
(a) Provider usage: before, the app makes one call per sample, each reporting the full prompt in `prompt_tokens`; after, one call reports the prompt once, and `completion_tokens` (OpenAI), or `candidatesTokenCount` across all candidates (Gemini), covers every sample.

(b) leanprompt usage record: before, the log holds several records per question with equal `ids.nodes` and equal `params`, sent close together; after, one record per question whose `output_tokens` covers all samples. kvsig: the repeated requests have equal exact `nodes[i]` for the last message, which is how the audit finds them.

## Waste signal
Measured: the score's generation waste counts output tokens on calls that were repeated identically (same ids, same `params`); repeated sampling calls count there, and after the fix they are one call. Static: severity medium for a loop or gather that sends one unchanged request body several times to a provider that supports a sample count; low where the provider has none.
<!-- leanprompt:generated v0.1.0-dev.8: written by npx leanprompt install; npx leanprompt update replaces local edits -->
