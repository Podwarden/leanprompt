---
id: LP-LW-02
title: Keep a conversation on the replica that holds its cache
skill: lmwarden
applies_to: [vllm, lm-warden]
saves: prefill
severity: medium
evidence: [E10]
---
## Rule
When one model runs as several replicas, send every request of a conversation to the same replica, and send the same stable conversation key with each of them, so the cache the previous turn built is the one the next turn reads.

## Why
Each replica has its own prefix cache. A balancer that places each request on the least busy replica, with no memory of the conversation, sends turn two to a replica that has never seen turn one's prompt, and that replica prefills it from scratch. An agent resends its whole history every turn, so the miss is large and repeats. Placing a conversation on one replica and keeping it there gives the next turn a warm cache.

The result, with its limits (E10): on one box of four NVIDIA RTX A4000 cards serving Qwen3-4B, under a synthetic Claude Code-shaped load of 8 concurrent agent sessions with one run per arm, routing conversations to their replica took the median time to first byte from 2.33 s to 0.48 s, prompt tokens served from cache from 44% to 86%, and output tokens a minute up 29% (E10). At 24 and more sessions, where the cards were saturated either way, the median time to first byte was worse with routing on (E10). It is a result for the engine's routing on one small setup, not for a change in your code, and one run per arm is not a distribution. Measure your own load with routing on and off; LM Warden can turn it off per model.

What the app controls is the key. LM Warden's routing reads a session or conversation id from the request (for example an `X-Session-Id` header or the body's `prompt_cache_key`; its routing write-up lists the order), and without one it falls back to a hash of the first user message. A client that sends a fresh random id on every request, or none and an unstable first message, defeats it. Other balancers differ: this skill has not checked them, so read your balancer's documentation for what it keys on.

## Detect in code
Find code that sends requests to a multi-replica or load-balanced self-hosted endpoint and see what identifies the conversation.

Python:
```
rg -n 'itertools\.cycle|random\.choice\(.*(urls|hosts|endpoints)|base_url=.*(urls|hosts)\[' -g '*.py'
rg -n 'uuid4\(\)|uuid\.uuid4' -g '*.py'
rg -n 'prompt_cache_key|X-Session-Id|x-session-affinity|session_id' -g '*.py'
```
Shapes: a list of base URLs, one per replica, that the client cycles through per request; a `uuid4()` placed in a header or in `prompt_cache_key` on every call instead of once per conversation.

TS/JS:
```
rg -n 'randomUUID\(\)|Math\.random\(\)' -g '*.{ts,tsx,js,mjs}'
rg -n 'prompt_cache_key|X-Session-Id|x-session-affinity|sessionId' -g '*.{ts,tsx,js,mjs}'
rg -n 'baseURL|endpoints\[|urls\[.*%' -g '*.{ts,tsx,js,mjs}'
```
Shapes: `urls[i++ % urls.length]` choosing a replica per request; `crypto.randomUUID()` in a per-request header.

Go:
```
rg -n 'rand\.Intn\(len\(|uuid\.New\(\)|atomic\.AddUint(32|64)' -g '*.go'
rg -n 'prompt_cache_key|X-Session-Id|x-session-affinity|SessionID' -g '*.go'
```
Shapes: a round-robin counter over replica URLs; `uuid.New().String()` set per request.

Not a finding: a single replica (nothing to route), a stateless one-shot call with no history, and a server that routes on something the client already sends.

## Fix
Create the key once per conversation and send it on every turn; send every turn to the same endpoint (the server's one URL, not a list of replicas).

```python
# before: a new id per request, and a client-side round-robin across replicas
headers = {"X-Session-Id": str(uuid.uuid4())}
client = OpenAI(base_url=next(REPLICA_URLS), api_key=KEY)

# after: one id per conversation, one URL
class Conversation:
    def __init__(self):
        self.session_id = str(uuid.uuid4())      # created once
    def headers(self):
        return {"X-Session-Id": self.session_id}

client = OpenAI(base_url=SERVER_URL, api_key=KEY)  # the server places the conversation
```

Pin a key to an endpoint, do not hash a key onto a replica yourself: the server knows each replica's load.

## Don't break meaning
The key is not part of the prompt, so answers do not change. Keeping conversations on one replica concentrates load: a replica can hold more long conversations than its neighbours, and when every replica is saturated the median wait can get worse (E10). Check the median and the tail under your peak load, not only on a quiet box, and keep the option to turn routing off. Do not put the key in the prompt text, where it would change the cache key.

## Verify
(a) Send several turns of one conversation. With the key stable, each turn's `cached_tokens` (where the server reports it) is close to the previous turn's whole prompt; with a fresh key per request it is near zero on turns that land on another replica. The server's own per-replica counters (LM Warden's model page shows how many requests stayed on their home replica) show where the requests went.

(b) kvsig: the turns have equal exact `nodes[i]` up to the previous turn, so a low cached count with equal ids points at placement or the engine (LP-LW-01), not at the prompt. The leanprompt usage record has no replica field, so it cannot show which replica answered; use the server's counters for that.

## Waste signal
Measured: lowers E on conversations whose prefix kvsig says was equal and that the server did not reuse; the log cannot say whether placement was the cause, so check the server's counters before reporting it. Static: severity medium where a client rotates across replica URLs or sends a per-request random conversation key to a multi-replica server; none for a single replica.
<!-- leanprompt:generated v0.1.0-dev.8: written by npx leanprompt install; npx leanprompt update replaces local edits -->
