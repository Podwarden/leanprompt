---
id: LP-LW-03
title: One key per app or tenant; cache scope is a privacy boundary
skill: lmwarden
applies_to: [vllm, sglang, lm-warden]
saves: prefill
severity: medium
evidence:
  - doc: https://docs.vllm.ai/en/latest/features/automatic_prefix_caching.html
    checked: 2026-11-26
---
## Rule
Give each app or tenant of a shared self-hosted server its own API key, and treat the prefix cache as shared by everyone who reaches the same model unless you have confirmed that it is partitioned.

## Why
Two separate things share this rule.

**Accounting.** One key for several apps makes usage unattributable: you cannot see which app generates the long prompts, the repeats and the misses, so none of the other rules can be targeted. LM Warden issues a key per consumer with its own usage figures; other servers vary, and a reverse proxy can add keys in front of any of them.

**Isolation.** A prefix cache matches on tokens: each block's hash covers every token before it, so any request that starts with the same tokens finds the same block ([providers/vllm.md](../../../providers/vllm.md)). The cache does not know who sent the earlier request unless the engine partitions it. A request that reuses a prefix is answered faster than one that does not, so a tenant who can time responses can learn whether another tenant sent a given prefix recently. That follows from how prefix caches work and is untested here. For an internal app sharing a system prompt with its siblings the cost is nothing; for tenants whose prompts are confidential from one another it is a privacy question. The vLLM page read does not mention `cache_salt` and the SGLang pages read do not either (checked 2026-11-26); whether your engine version supports a per-request cache salt is a question for its documentation. This skill has not verified whether LM Warden partitions the cache by key, so do not assume it does.

The trade is real: a partitioned cache cannot share one long system prompt across tenants, so it prefills that prompt once per partition. Share a cache across consumers you trust, separate it across consumers you do not.

## Detect in code
Look for one credential used by several apps or tenants, and for per-tenant content going through a shared server.

Python:
```
rg -n 'api_key=os\.environ|(OPENAI|LLM)_API_KEY|api_key=.*(SHARED|COMMON|TEAM)' -g '*.py'
rg -n 'tenant|org_id|customer_id' -g '*.py'
```
Shapes: one `api_key` read from a shared environment variable by several services; a function that serves many tenants with a single client object and builds each tenant's prompt with its private data in the system prompt.

TS/JS:
```
rg -n 'apiKey: process\.env|new OpenAI\(\{' -g '*.{ts,tsx,js,mjs}'
rg -n 'tenantId|orgId|customerId' -g '*.{ts,tsx,js,mjs}'
```
Shapes: a module-level `new OpenAI({ baseURL, apiKey })` used for every tenant's request.

Go:
```
rg -n 'openai\.NewClient|option\.WithAPIKey|os\.Getenv\("(LLM|OPENAI)_' -g '*.go'
rg -n 'TenantID|OrgID|CustomerID' -g '*.go'
```
Shapes: one package-level client with one key serving requests for many tenants.

Also in deployment files: the same key value or secret reference mounted into several services.

## Fix
One key per app, and for tenants who must not share a cache, a separate key and, where your engine supports it, a separate cache partition; otherwise a separate model instance.

```python
# before: every app and tenant shares one key
client = OpenAI(base_url=SERVER_URL, api_key="YOUR_SHARED_KEY")

# after: one key per app, named after it (placeholder: load it from that app's own secret store)
client = OpenAI(base_url=SERVER_URL, api_key="YOUR_BILLING_APP_KEY")
```

For several tenants in one app, keep tenant-specific text after the shared prefix, never in the shared head (`prefill-cache` LP-PC-07), and do not put one tenant's confidential data in text that other tenants' prompts share a prefix with. If tenants must be isolated from each other's timing, give each its own key and a partitioned cache or its own instance, and accept the lower reuse.

## Don't break meaning
Splitting keys does not change answers. Do not split a prefix that belongs to one consumer across keys that do not share a cache: that lowers reuse for nothing (`prefill-cache` LP-PC-12). Do not paste a key into a prompt or a log. When rotating keys, use the server's grace window if it has one, so a running app is not cut off.

## Verify
(a) The server's per-key usage shows each app's own requests and tokens, and no app's usage appears under another's key.

(b) For isolation, send the same long prefix from two keys: if the second request reports cached tokens (`cached_tokens`, where the server reports it) for the first's prefix, the cache is shared across those keys. That is the answer to whether your setup partitions it, for that engine version.

## Waste signal
Measured: none directly; attribution by key is what lets the other rules' signals be read per app, and the usage log carries no key. Static: severity medium where one credential is read by several services or one client serves several tenants through a shared server; low for a single app with a single consumer. A shared cache is not waste, and it is only a finding where the tenants' prompts are confidential from each other.
