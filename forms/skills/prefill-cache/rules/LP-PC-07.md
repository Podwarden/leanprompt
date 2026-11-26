---
id: LP-PC-07
title: Shared context before per-user context
skill: prefill-cache
applies_to: [anthropic, openai, gemini, openrouter, deepinfra, vllm, sglang]
saves: prefill
severity: medium
evidence:
  - doc: https://developers.openai.com/api/docs/guides/prompt-caching
    checked: 2026-11-26
  - doc: https://docs.deepinfra.com/chat/prompt-caching.md
    checked: 2026-11-26
---
## Rule
In an app that serves many users or tenants, put what is the same for everyone (instructions, tools, shared reference documents, examples) before anything specific to a tenant, then a user, then a request.

## Why
A cache is shared between requests only up to the first byte that differs. If the system prompt opens with "You are helping Alice at Acme" and then carries a long shared handbook, every user gets a private copy of the handbook in cache and every user's first request pays for it again. Ordered from widest to narrowest audience (everyone, tenant, user, request), each layer is reused by everyone who shares it. OpenAI and DeepInfra both ask for stable content first; OpenAI's `prompt_cache_key` groups requests that share a prefix, and it should name the group that shares it (for example the tenant), not a single request ([providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/openai.md), [providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev.3/providers/deepinfra.md)). Documented, not yet measured here.

On a self-hosted server a cache shared across tenants is also a privacy question; see the `lmwarden` skill (keys, isolation, `cache_salt`).

## Detect in code
Python:
```
rg -n 'f"(You are|Hello|Hi)[^"]*\{(user|customer|tenant|account)' -g '*.py'
```
Shapes: `system = f"You are assisting {user.name} ({user.plan}).\n{HANDBOOK}"`; `system = user_profile + SHARED_DOCS`; few-shot examples picked per user and placed before the shared instructions; `prompt_cache_key=request_id`.

TS/JS:
```
rg -n '`(You are|Hello|Hi)[^`]*\$\{(user|customer|tenant|account)|prompt_cache_key' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` system: `Customer: ${customer.name}\n${HANDBOOK}` ``; `prompt_cache_key: crypto.randomUUID()`.

Go:
```
rg -n 'Sprintf\("(You are|User|Customer|Tenant)[^"]*%s' -g '*.go'
```
Shapes: `fmt.Sprintf("User: %s\n%s", u.Name, sharedDocs)` as the system prompt.

## Fix
Layer from the widest audience to the narrowest.

```python
# before
system = f"You are assisting {user.name} at {tenant.name}.\n\n{INSTRUCTIONS}\n\n{HANDBOOK}"

# after
system = f"{INSTRUCTIONS}\n\n{HANDBOOK}"                    # same for every user
first_user = (
    f"<tenant>{tenant.name}: {tenant.notes}</tenant>\n"
    f"<user>{user.name}, plan {user.plan}</user>\n\n{question}"
)
```

```ts
// before
prompt_cache_key: crypto.randomUUID(),
// after
prompt_cache_key: `tenant:${tenant.id}`,   // one key per group that shares the prefix
```

When a tenant has a large block of its own (its documents), it can go at the end of the system prompt, after the shared part, so that tenant's users share it.

## Don't break meaning
The model must still know whom it serves: keep the user and tenant blocks labelled, and update instructions that referred to them by position. If per-user settings are meant to override the shared defaults, say so in the user block ("These preferences take precedence over the defaults above"). Run the answer check on a few personalised cases before and after.

## Verify
(a) Send the first request for user A, then for user B. B's request reports `cached_tokens` or `cache_read_input_tokens` covering the shared part.

(b) kvsig: build the first request for two users. Exact `tools` and `sys` are equal, so `head` is equal; the per-user part starts at the first message.

## Waste signal
Measured: first requests of different users share a short prefix with each other; the score's S counts only continuing requests, so the loss shows as many `sys` or `head` ids for one shared prompt. Static: severity medium for per-user or per-tenant values before long shared text, low for a `prompt_cache_key` that is unique per request.
<!-- leanprompt:generated v0.1.0-dev.3 — managed by npx leanprompt init; local edits are replaced on update -->
