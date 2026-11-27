# /leanprompt init

Writes `leanprompt.yaml` at the project root, so later commands do not ask the same questions again. The schema is in [docs/profile.md](facts/docs/profile.md). Ask one question at a time, as [presenting.md](../llm-call-audit/presenting.md#asking-questions) describes, and write the file only on a yes.

## 1. Read first

Before asking anything, read what the code already says ([call-shapes.md](../llm-call-audit/call-shapes.md), "Which provider and model"):

- the SDK or HTTP client, the base URL and the model names of every call site;
- whether some calls go to a self-hosted engine (vLLM, SGLang, LM Warden) and others to a hosted API: then each backend is its own `targets` entry, with its call sites under `files:`;
- launch files, compose files and engine flags, for the `engine:` facts;
- an existing `leanprompt.yaml`: keep every key and comment it has, and ask only for what is missing.

For an LM Warden server, offer `leanprompt profile detect --lmwarden <url>` instead of asking for the engine facts ([lmwarden](../lmwarden/SKILL.md)).

## 2. Ask only what the code cannot tell

1. **Targets**, only when the code reads the provider or model from the environment at run time and nothing else names it.
2. **Priority:** cost, speed or quality, or weights. It decides the order of the advice; caching applies whatever the answer.
3. **Monthly volume:** how many calls the app makes a month, and where the number comes from. With a usage log, infer it from the log instead and say so.
4. **Prices:** offer to look up the current price of each model on the provider's pricing page, or take the user's own price. Every price needs a `source` and a `checked` date; a price without them is rejected. The fields are in [llm-call-audit](../llm-call-audit/SKILL.md#volume-and-prices).

A user may skip volume and prices: the report then shows tokens only.

## 3. Show, then write

Show the exact lines that would be written, then ask whether to write them. Answering a question is not consent to writing the file. On a yes, write the file and say which keys were added. On a no, keep the answers for this session only.

Then suggest `/leanprompt audit`.
<!-- leanprompt:generated v0.1.0-dev.14: written by leanprompt install; leanprompt update replaces local edits -->
