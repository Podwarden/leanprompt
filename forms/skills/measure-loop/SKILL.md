---
name: measure-loop
description: Use when you need to prove that a change to an LLM-calling app made it cheaper or faster, or to keep it from regressing — logging cache usage per call (cached_tokens, cache_read_input_tokens, cache_creation_input_tokens), replaying a recorded session before and after a change, writing a CI test that fails when the system prompt or tool list stops being stable, running npx leanprompt score or leanprompt calibrate, or when someone asks "did that fix work?" for Anthropic, OpenAI, Gemini, OpenRouter, DeepInfra or a self-hosted vLLM or SGLang server. Turns each fix from a claim into a before and after number.
license: CC-BY-4.0
---

# measure-loop

Makes every change to an LLM-calling app answer to numbers: measure, change one thing, measure again, then prove it with a score anyone can rerun. The other skills say what to change (`prefill-cache`, `generation-economy`); this one says how to know it worked and how to keep it working.

## When to use

- You changed a prompt builder, a tool registry, a history store, a retry or a token budget, and want to know what it did to cache reuse and output tokens.
- You want a test in CI that fails when the stable head of a request changes (a timestamp added to a system prompt, a tool reordered, old messages re-serialised).
- You want a score for the badge or the report: `npx leanprompt score`, optionally `leanprompt calibrate`.
- The `prefill-cache` or `generation-economy` skill sent you here for a rule's "Verify" step.

## Ask first

Before you edit the app's code, install a package, add a file outside `.leanprompt/`, or run anything that sends requests to a provider (they are billed), show the change or the command and ask. The user may prefer to run it themselves. No ask is needed for `npx leanprompt score` and `npx leanprompt calibrate`, which only read and write files under `.leanprompt/` and make no network calls; `calibrate` still writes `.leanprompt/weights.json` only after `y` or `--yes`. Offering to share a lesson (below) needs no ask, but `npx leanprompt lesson` writes `.leanprompt/lesson.md`, so run it only after the user says yes.

## Workflow

1. **Measure.** Propose adding the usage logger (below) as a small diff, and add it only if the user says yes. Then ask the user to run a fixed scenario through the app, or ask whether you may run it (it sends real, billed requests): several sessions, with follow-up turns, not one request repeated. Keep the scenario so the next run is comparable.
2. **Change one rule at a time.** Propose a single rule's fix from `prefill-cache` or `generation-economy` as a diff, with its "Don't break meaning" check, and apply it only after the user says yes. If two things change together, the result cannot be credited to either.
3. **Measure again.** Replay the same scenario against the same model, or collect real traffic. A replay sends real requests to the provider, which are billed: ask the user to run it, or ask before you run it yourself. Compare the same fields: cached tokens against prompt tokens, output tokens, number of calls, `finish: "length"`, retries.
4. **Prove.** `npx leanprompt score` writes `.leanprompt/score.json` (the badge source) from the usage log. With no log yet, `npx leanprompt score --static` scores the audit's findings instead and labels it "static". To fit the static score to your app, run `leanprompt calibrate` ([docs/calibration.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/docs/calibration.md)).
5. **Keep it.** Offer the stable-head test (below) as its own small diff, and add it only after the user says yes, so the change cannot quietly come undone.

## Read the provider's own usage fields first

Every provider reports what it cached. Read these before any other tool; they are what you are billed on. Where each lives, and what the provider says about it, is in the dated tables.

| Provider | Cache read | Cache write |
|---|---|---|
| OpenAI-compatible APIs, vLLM, DeepInfra, OpenRouter | `usage.prompt_tokens_details.cached_tokens` | OpenRouter: `cache_write_tokens` beside it |
| Anthropic | `usage.cache_read_input_tokens` | `usage.cache_creation_input_tokens` |
| Gemini | the cached-content token count, `usageMetadata.cachedContentTokenCount` in the leanprompt logger | none reported |

Details and sources: [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/openai.md), [providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/anthropic.md), [providers/gemini.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/gemini.md) (its SDK examples name a different field, so check the response you get), [providers/openrouter.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/openrouter.md), [providers/deepinfra.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/deepinfra.md), [providers/vllm.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/vllm.md). A hit that reports 0 with no error usually means the prompt was under the model's minimum or the prefix changed; the tables list the minimums and the rules say what changes a prefix.

## Log every call

Adding the logger is a change to the app's code: show the lines below as a diff for the user's call site, and add them only if the user says yes. The leanprompt usage logger writes one JSON line per call to `.leanprompt/usage.jsonl`: kvsig ids, character counts, token counts from the usage fields above, the finish reason and flags. It never writes prompt or completion text, and it never raises into your request path.

TypeScript or JavaScript:

```ts
import { createLogger } from "leanprompt/log";
const logger = createLogger({ path: ".leanprompt/usage.jsonl", key: keyBytes, provider: "openai", model: "gpt-x" });
// after each call:
logger.log({ dialect: "openai.chat", body: requestBody, params: { temperature } }, { usage: response.usage, finish: choice.finish_reason });
// log() returns at once and appends in the background. Before a script or test exits, await logger.flush().
```

Python (PyPI package `leanprompt-cli`):

```python
from leanprompt_cli import Logger
logger = Logger(".leanprompt/usage.jsonl", key_bytes, "openai", "gpt-x")
# after each call:
logger.log("openai.chat", request_body, response.usage, params={"temperature": t}, finish=choice.finish_reason)
```

The `provider` you pass decides which cache facts score the call, so name where the request is served, not the SDK that sends it:

- A hosted API with its own table: `anthropic`, `openai`, `gemini`, `openrouter` or `deepinfra`.
- A self-hosted server: the engine name, `vllm`, `sglang` or `lm-warden` (LM Warden uses the vLLM table), even when you call it through the OpenAI SDK. Logged as `openai`, its calls get OpenAI's cache facts and the `engine:` values in `leanprompt.yaml` are not applied.
- Another OpenAI-compatible host (Groq, Together, Azure, DeepSeek and others with no table here): its own name. With no table, the target in `leanprompt.yaml` (`target.provider` or `target.engine`) decides the cache facts; with no target set, those calls are unmeasured (`unknown_provider`) and `score` says so.

`key_bytes` is a 32-byte secret you generate once and keep out of the repo; the ids are keyed and mean nothing without it. When you retry, pass the index the previous `log` returned as `retry_of`; when your parser rejects an answer, set `parse_failed`. The generation rules read those flags.

## Replay: send a recorded session twice

For a before and after you need the same traffic twice. Record the requests of a session (ids and token counts are enough to compare; keep the bodies only if your own policy allows it), then send the same session through the old and the new code, or through the same code twice a few seconds apart. The second pass shows what the provider could reuse. Every pass sends real requests to the provider, which are billed, so ask the user before you start one, or let them run it. Gaps longer than the provider's cache lifetime ([providers/anthropic.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/anthropic.md), [providers/openai.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/providers/openai.md)) make the second pass cold, which is expected and not a bug. The leanprompt repo's replay harness (`npm run eval`, `eval/run.ts`) replays the example apps in `examples/` this way; with a `sim:` target it uses a local simulator and costs nothing, and pointed at a provider it sends real requests, which are billed, so ask the user before you run it that way.

## The stable-head test (kvsig ids in CI)

kvsig gives every request keyed ids for its system prompt (`sys`), its tool list (`tools`), the two together (`head`) and each prefix (`nodes[i]`). Two requests with equal exact `nodes[i]` have the same prompt up to message `i`. A test can build the request your app would send for two fixed inputs (two users, two days, two working directories) and fail when the stable head differs. It runs offline, in milliseconds, with no provider call, and it catches a tool reordered by a refactor, a timestamp added to a system prompt, or a history store that re-serialises old messages.

The test needs kvsig 0.1.0 as a dev dependency, `npm i -D @kvsig/core@0.1.0` (npm) or `pip install kvsig==0.1.0` (PyPI), the helper template copied into the project's tests, and a test file that points it at the app's request builder. The templates are helpers, not tests, and their names keep test runners from collecting them where they are installed. Propose the install command, the copied helper and the new test file as one small diff, and run or add them only after the user says yes:

- TypeScript, once the user says yes: copy [templates/stable-head.template.ts](templates/stable-head.template.ts) to the project's tests as `stable-head.ts` and write the test in `stable-head.test.ts` (vitest, jest or any runner)
- Python, once the user says yes: copy [templates/stable_head_template.py](templates/stable_head_template.py) to the project's tests as `stable_head.py` and write the test in `test_stable_head.py` (pytest)

Leave the trailing `leanprompt:generated` line out of the proposed copy: it marks the installed template, which `leanprompt init` keeps up to date, not the user's file.

```ts
import { assertStableHead } from "./stable-head";
it("the head does not change from one day to the next", () =>
  assertStableHead(
    (now) => app.buildRequest("Where is my order?", { session: 0, turn: 0, now }),
    [new Date("2026-11-03T08:15:42Z"), new Date("2026-11-04T17:02:09Z")],
    { sys: true, tools: true },
  ));
```

Use `nodesUpTo` only when the inputs leave the first messages equal: a request that carries the date in its newest user message (the fix for LP-PC-03) has equal `head` but a different `nodes[0]` for two days, so leave `nodesUpTo` out there.

Assert only on `kvsig/1` exact ids and `loose/1` ids; never on `loose/2`, which is experimental. The test uses exact ids for what the provider caches and the loose ids only to explain a failure.

### Which id to assert for each rule

| Rule | Assert equal across the two inputs | Inputs to vary |
|---|---|---|
| [LP-PC-02](../prefill-cache/rules/LP-PC-02.md), [LP-PC-03](../prefill-cache/rules/LP-PC-03.md) | `sys`, then `head` | the date, a user id, a working directory, a version |
| [LP-PC-04](../prefill-cache/rules/LP-PC-04.md) | `tools` | process restarts or seeds (registration order) |
| [LP-PC-05](../prefill-cache/rules/LP-PC-05.md) | `sys` every turn; `tools` only on turns that add a tool | a session that loads a tool mid-way |
| [LP-PC-06](../prefill-cache/rules/LP-PC-06.md), [LP-PC-09](../prefill-cache/rules/LP-PC-09.md) | `nodes[0..i]` between consecutive turns | a two-turn session; the later request starts with all earlier `nodes` |
| [LP-PC-07](../prefill-cache/rules/LP-PC-07.md) | `head` | two users |
| [LP-PC-08](../prefill-cache/rules/LP-PC-08.md) | `head` before and after a compaction (`conv` is expected to change) | a session long enough to compact |

### Reading a failure

The messages follow kvsig's [reading-the-ids](https://github.com/Podwarden/kvsig/blob/main/docs/reading-the-ids.md) table:

| Failure | Meaning | Look at |
|---|---|---|
| `sys` differs, `loose_sys` equal | the system prompt changed only in noise: a bare date line, a reminder, whitespace | LP-PC-03 |
| `sys` differs, `loose_sys` differs | the system prompt changed beyond noise: a labelled date or time ("Current time: ..."), an id, a path, or wording | LP-PC-03, and what the input is allowed to change |
| `tools` differs, `loose_tools` equal | only the member order inside a schema or arguments changed | LP-PC-04, key order |
| `tools` differs, `loose_tools` differs | a tool was added, removed, edited or reordered | LP-PC-04, LP-PC-05 |
| `nodes[i]` differs, `sys` and `tools` equal | part of the history was rewritten: an edit, a fork, or old messages re-serialised | LP-PC-06 |

Ids tell you the prompt was reusable; they do not tell you the provider reused it. Pair a passing test with the usage fields in a real run, and see the limits of kvsig in its reading-the-ids page ("What the ids do not tell you").

## Where the measured score stops

The score comes from the usage log, so it inherits the log's limits. Say so when you quote it.

- **It needs at least 50 measured calls** (calls minus unmeasured), and states how many it used. With fewer, `score` refuses a measured number, prints how many measured calls it found, and suggests `--static`.
- **Reusable tokens are an estimate by character share**, not a token count from the provider's tokenizer ([docs/calibration.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/docs/calibration.md) explains how the static weights are fitted against it).
- **A cache has a lifetime.** A prefix that returns after the provider's lifetime was not reusable; the lifetimes are in the provider tables. The lifetime changes the cache-reuse figure (E) only; the stability figure (S) ignores it, because a user's pause is not the app rewriting its prefix.
- **Requests kvsig cannot identify** (a dialect it does not read, a body over 2 MiB, malformed JSON) are counted as "unmeasured" and left out of the reuse figures; they are not counted as zero reuse.
- **Failed calls are unmeasured too.** A call that failed (finish `error`) never reached the cache, or its state is unknown, so it is left out of the reuse figures, not counted as zero.
- **The heads diagnostic is information only.** It reports how many distinct heads and conversations the log holds. A head that differs per session shows up there, not in the score; read it beside the score.
- **Money is not in the score.** It covers tokens only, because prices change.

The target profile ([docs/profile.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/docs/profile.md)) sets the provider and the priority the report is read against.

## Sharing a lesson

After a fix has a measured before and after, or when a rule misled the user (it did not fit their app, or the fix changed answers), offer once to share what happened as a "lesson learned". It is an offer, not a step: say what it is, and never run it unasked. Only after the user says yes, run `npx leanprompt lesson --rule <id>` (add `--before <an older score.json>` when they kept one). It writes a draft to `.leanprompt/lesson.md` on their machine from the rule id, the target and the current score; it contains no code, paths, prompts or model output, and nothing is sent anywhere.

The user reads the exact text, edits it, and opens the issue themselves: the command prints a link to the "Lesson learned" form on GitHub, which carries no text from the draft, and the user pastes the draft into the form. A maintainer reads every submission before it informs a rule, and credit is optional ([THANKYOU.md](https://github.com/Podwarden/leanprompt/blob/v0.1.0-dev/THANKYOU.md)). If `lesson` reports something to remove (a key, an email, a path, a host name), help the user remove it and run it again; do not paste the removed text anywhere. Do not offer after a static score alone: there is no before and after to share.

## What this skill does not do

It does not decide what to change (that is `prefill-cache` and `generation-economy`), it does not make answers right (any change that can alter answers needs its own answer check), and it does not turn a small log into a trustworthy score.
<!-- leanprompt:generated v0.1.0-dev — managed by npx leanprompt init; local edits are replaced on update -->
