---
id: LP-GE-07
title: Batch API for work that can wait
skill: generation-economy
applies_to: [openai, anthropic, gemini, openrouter, deepinfra]
saves: both
severity: medium
evidence:
  - doc: https://developers.openai.com/api/docs/guides/batch
    checked: 2026-11-26
  - doc: https://platform.claude.com/docs/en/build-with-claude/batch-processing
    checked: 2026-11-26
  - doc: https://aistudio.google.com/docs/batch-api
    checked: 2026-11-26
  - doc: https://openrouter.ai/docs/guides/features/batch-api
    checked: 2026-11-26
  - doc: https://docs.deepinfra.com/batch/introduction.md
    checked: 2026-11-26
---
## Rule
Send work that no user is waiting for (backfills, nightly jobs, evaluations, bulk extraction, embeddings of a corpus) through the provider's batch API instead of the interactive endpoint.

## Why
Batch APIs bill the same requests at a discount in exchange for asynchronous completion within a window. The discount, the window and the limits differ per provider and are in the tables:

- **OpenAI** Batch API, and a `flex` service tier priced at batch rates for calls that can tolerate slow responses and occasional unavailability ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/openai.md)).
- **Anthropic** Message Batches; prompt caching works in batches on a best-effort basis, and the docs suggest the longer cache lifetime for shared context ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/anthropic.md)).
- **Gemini** Batch API, with context caching supported for batch requests ([providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/gemini.md)).
- **OpenRouter** batch endpoint, for models with a batch variant ([providers/openrouter.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/openrouter.md)).
- **DeepInfra** batch API, a smaller discount than the others, outside the real-time rate limits ([providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/deepinfra.md)).
- **vLLM** has a batch endpoint that takes many conversations in one request; on your own server the saving is throughput, not a price ([providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/vllm.md)). SGLang: no batch API on the pages read ([providers/sglang.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.2/providers/sglang.md)).

The tokens are the same; the price per token is lower. Batch jobs also do not compete with interactive traffic for rate limits on providers that say so.

## Detect in code
Python:
```
rg -n 'for (row|doc|item|record) in .*(tqdm|df\.|rows|records|dataset)|asyncio\.Semaphore|ThreadPoolExecutor' -g '*.py'
rg -n 'schedule|cron|airflow|@task|backfill|evaluate|eval_' -g '*.py'
```
Shapes: a script or scheduled task that loops over a dataset and calls `chat.completions.create` / `messages.create` per row; an evaluation harness that runs a fixed suite against the live endpoint; an embeddings backfill one request at a time.

TS/JS:
```
rg -n 'p-limit|p-map|Bottleneck|for await \(const (row|doc|item)|cron' -g '*.{ts,tsx,js,mjs}'
```
Shapes: a job runner that rate-limits interactive calls over thousands of items.

Go:
```
rg -n 'for _, (row|doc|item|rec) := range|errgroup|semaphore\.NewWeighted|cron\.' -g '*.go'
```
Shapes: a worker pool over a table, each worker calling the completions endpoint.

Not a finding: anything a user waits for, and jobs whose next step needs each answer before the next request can be built (agent loops).

## Fix
```python
# before: thousands of interactive calls from a nightly job
for row in rows:
    save(row.id, client.chat.completions.create(**build_request(row)))

# after: one batch, collected when it completes
lines = [{"custom_id": str(r.id), "method": "POST", "url": "/v1/chat/completions", "body": build_request(r)} for r in rows]
batch_file = client.files.create(file=to_jsonl(lines), purpose="batch")
batch = client.batches.create(input_file_id=batch_file.id, endpoint="/v1/chat/completions", completion_window="24h")
# later, from a scheduled poll
for result in read_results(client, batch.id):
    save(result["custom_id"], result["response"]["body"])
```

The same request bodies go into the batch. Keep the shared prefix first and identical (the `prefill-cache` rules), so batch requests can also hit the cache where the provider supports it. On OpenAI, `service_tier: "flex"` on the same synchronous call is a smaller change where flex is still offered for the model.

## Don't break meaning
The request bodies are unchanged, so answers do not change. What changes is delivery: results arrive later and in any order (match them by `custom_id`), some requests can fail or expire (resubmit those, and only those), and a batch is no place for anything interactive. Log the batch results as usage records like any other call.

## Verify
(a) Provider usage: each batch result carries its own usage (`output_tokens` or `completion_tokens`, `finish_reason` or `stop_reason`); the billing page shows the batch rate for those tokens. Token counts per item stay the same as the interactive form.

(b) leanprompt usage record: one record per batch result, with its `finish`; resubmitted expired or failed lines carry `flags.retry_of`. Money is not in the score, so the score does not move; the report shows the price change separately with the price card's date.

## Waste signal
Not in the score (the score counts tokens, not price). Static: severity medium for a scheduled or bulk job that sends many independent calls to the interactive endpoint of a provider with a batch API; reported with the provider's discount from its table.
<!-- leanprompt:generated v0.1.0-dev.2 — managed by npx leanprompt init; local edits are replaced on update -->
