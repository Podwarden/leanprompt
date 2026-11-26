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
A cache is shared between requests only up to the first byte that differs. If the system prompt opens with "You are helping Alice at Acme" and then carries a long shared handbook, every user gets a private copy of the handbook in cache and every user's first request pays for it again. Ordered from widest to narrowest audience (everyone, tenant, user, request), each layer is reused by everyone who shares it. OpenAI and DeepInfra both ask for stable content first; OpenAI's `prompt_cache_key` groups requests that share a prefix, and it should name the group that shares it (for example the tenant), not a single request ([providers/openai.md](../../../providers/openai.md), [providers/deepinfra.md](../../../providers/deepinfra.md)). Documented, not yet measured here.

Order is not enough if a per-user transform runs over the whole rendered prompt afterwards. A redaction step that replaces a requester's name, email or account number wherever it occurs, or a template pass that fills per-user placeholders across every message, also rewrites the shared head whenever the same value happens to appear there (a customer whose name is also a product name, a name that is also a word in the instructions). For those requests the head differs from everyone else's and is paid for again. This follows from prefix matching; not yet measured here. It is rare in any one request, invisible without comparing kvsig ids across users, and more likely the more name-like terms the shared text contains.

On a self-hosted server a cache shared across tenants is also a privacy question; see the `lmwarden` skill (keys, isolation, `cache_salt`).

## Detect in code
Python:
```
rg -n 'f"(You are|Hello|Hi)[^"]*\{(user|customer|tenant|account)' -g '*.py'
```
```
rg -n 'redact|scrub|anonymi[sz]e|presidio|mask_pii|pii' -g '*.py'
```
Shapes: `system = f"You are assisting {user.name} ({user.plan}).\n{HANDBOOK}"`; `messages = [redact(m, user) for m in [system_msg, *msgs]]` or `scrub(render(prompt), names=[user.name])` (a per-user transform over the whole prompt, shared head included); `system = user_profile + SHARED_DOCS`; few-shot examples picked per user and placed before the shared instructions; `prompt_cache_key=request_id`.

TS/JS:
```
rg -n '`(You are|Hello|Hi)[^`]*\$\{(user|customer|tenant|account)|prompt_cache_key' -g '*.{ts,tsx,js,mjs}'
```
```
rg -n 'redact|scrub|anonymi[sz]e|maskPii|pii' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `` system: `Customer: ${customer.name}\n${HANDBOOK}` ``; `messages.map((m) => redact(m, requester))` applied to the system message too; `prompt_cache_key: crypto.randomUUID()`.

Go:
```
rg -n 'Sprintf\("(You are|User|Customer|Tenant)[^"]*%s' -g '*.go'
```
```
rg -n '(?i)redact|scrub|anonymi[sz]e|pii' -g '*.go'
```
Shapes: `fmt.Sprintf("User: %s\n%s", u.Name, sharedDocs)` as the system prompt; a `Redact(prompt, user)` call on the fully rendered prompt.

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

Apply per-user transforms (redaction, per-user templating) only to the per-user parts, then put the shared head in front unchanged.

```python
# before: the scrubber sees the whole prompt, shared head included
messages = scrub([{"role": "system", "content": SYSTEM}, {"role": "user", "content": request_text}], names=[requester.name])

# after: scrub only what is per request; the shared head is never transformed per user
messages = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": scrub(request_text, names=[requester.name])}]
```

When a tenant has a large block of its own (its documents), it can go at the end of the system prompt, after the shared part, so that tenant's users share it.

One way to keep this checkable, if the user wants it (optional, not part of the fix): a test in the app that builds the first request for two users and asserts their kvsig `head` ids are equal catches per-user text that moves back into the shared head. [measure-loop](../../measure-loop/SKILL.md) ("The stable-head test") has a short example in TypeScript and Python and a helper; propose the test as its own small diff and add it only after the user says yes.

## Don't break meaning
The model must still know whom it serves: keep the user and tenant blocks labelled, and update instructions that referred to them by position. If per-user settings are meant to override the shared defaults, say so in the user block ("These preferences take precedence over the defaults above"). Run the answer check on a few personalised cases before and after. Moving redaction off the shared head must not let personal data through: the shared head must hold none to begin with (it is the same for everyone), and every per-user part must still pass through the transform. If the head does contain personal data, remove it from the head; do not keep scrubbing it per user.

## Verify
(a) Send the first request for user A, then for user B. B's request reports `cached_tokens` or `cache_read_input_tokens` covering the shared part.

(b) kvsig: build the first request for two users. Exact `tools` and `sys` are equal, so `head` is equal; the per-user part starts at the first message. Where a per-user transform runs, pick two users whose values also occur in the shared text (a name that is also a product term) and check that `sys` and `head` are still equal after the transform.

## Waste signal
Measured: first requests of different users share a short prefix with each other; the score's S counts only continuing requests, so the loss shows as many `sys` or `head` ids for one shared prompt. Static: severity medium for per-user or per-tenant values before long shared text, low for a `prompt_cache_key` that is unique per request, low for a per-user transform run over the shared head (it costs only on the requests whose values occur in the head).
