# How leanprompt works

leanprompt is a set of skills for coding assistants. It finds the places where an app pays for the same LLM tokens twice, proposes a fix for each that keeps meaning, and proves the fix with the provider's own usage numbers. This page covers the problem, the audit, the rules and the measure loop. Back to the [README](../README.md).

## The problem

Every call to an LLM resends the system prompt, the tool list and the history. Providers and engines cache the part that did not change, but only if it really did not change, byte for byte, from the first token. Most apps break that without knowing: a timestamp on the first line, tools built from an unsorted dict, a history store that re-serialises old messages, a client that never sends Anthropic's cache marks. Then they pay again to generate what one call could have produced: a retry after a truncation, one request per sample, a parse failure re-asked from scratch.

leanprompt gives your coding assistant the rules to find those places in your code, the fix for each, and a way to prove the fix helped with the provider's own usage fields.

## How the audit works

Ask your assistant to *audit this app's LLM calls*. The [`llm-call-audit`](../skills/llm-call-audit/SKILL.md) skill:

1. Inventories the call sites by SDK and HTTP shape (Anthropic, OpenAI, Gemini, LangChain, LlamaIndex, LiteLLM, the Vercel AI SDK, raw `fetch` or `requests`), and follows each one back to where its system prompt, tools and history are built.
2. Checks each call against the rules and records every finding with its rule id, file and line.
3. Proposes one fix per finding, with the rule's "Don't break meaning" check, and asks before editing anything.
4. Hands each fix to [`measure-loop`](../skills/measure-loop/SKILL.md) to prove it with a before and after number.

The audit writes `leanprompt-report.md` and `.leanprompt/findings.json`. The report follows [report-template.md](../skills/llm-call-audit/report-template.md): the call inventory, the findings ranked by tokens lost, the score and the next steps. `leanprompt report --html` turns the findings and the score into a single local page (`.leanprompt/report.html`). If you tell the audit you are on a particular provider or self-hosted engine, or that speed matters more than cost, put it in [`leanprompt.yaml`](profile.md) and the findings are ranked for that target.

<!-- pending: eval/results (an excerpt of a real leanprompt-report.md from an example app, once the audit has been run on it) -->

## The rules at a glance

Prefill rules first, then generation, then self-hosted. Every rule file ends with a "Verify" section: the usage field that must change and the kvsig id that must stay equal.

| Rule | In one line | Saves |
|---|---|---|
| [LP-PC-01](../skills/prefill-cache/rules/LP-PC-01.md) | Put cache marks where the provider needs them | prefill |
| [LP-PC-02](../skills/prefill-cache/rules/LP-PC-02.md) | Stable content first, without hurting meaning | prefill |
| [LP-PC-03](../skills/prefill-cache/rules/LP-PC-03.md) | No ids, timestamps, versions or paths at the top of the prompt | prefill |
| [LP-PC-04](../skills/prefill-cache/rules/LP-PC-04.md) | Fixed tool order and JSON key order | prefill |
| [LP-PC-05](../skills/prefill-cache/rules/LP-PC-05.md) | Tool lists grow only at the end | prefill |
| [LP-PC-06](../skills/prefill-cache/rules/LP-PC-06.md) | Append-only history | prefill |
| [LP-PC-07](../skills/prefill-cache/rules/LP-PC-07.md) | Shared context before per-user context | prefill |
| [LP-PC-08](../skills/prefill-cache/rules/LP-PC-08.md) | Cache-aware compaction | prefill |
| [LP-PC-09](../skills/prefill-cache/rules/LP-PC-09.md) | Consistent reasoning handling; thinking fixed per session | both |
| [LP-PC-10](../skills/prefill-cache/rules/LP-PC-10.md) | Stable image and attachment placement | prefill |
| [LP-PC-11](../skills/prefill-cache/rules/LP-PC-11.md) | Keep pauses inside the cache lifetime | prefill |
| [LP-PC-12](../skills/prefill-cache/rules/LP-PC-12.md) | Do not split one prefix across models or keys that do not share a cache | prefill |
| [LP-GE-01](../skills/generation-economy/rules/LP-GE-01.md) | n samples in one request | prefill |
| [LP-GE-02](../skills/generation-economy/rules/LP-GE-02.md) | Batch independent questions about one context | both |
| [LP-GE-03](../skills/generation-economy/rules/LP-GE-03.md) | Output and thinking budgets that fit the task | generation |
| [LP-GE-04](../skills/generation-economy/rules/LP-GE-04.md) | Stream long outputs; timeouts that match generation time | both |
| [LP-GE-05](../skills/generation-economy/rules/LP-GE-05.md) | Retry only retryable errors; never retry a truncation unchanged | both |
| [LP-GE-06](../skills/generation-economy/rules/LP-GE-06.md) | Cache exact responses for deterministic requests | both |
| [LP-GE-07](../skills/generation-economy/rules/LP-GE-07.md) | Batch API for work that can wait | both |
| [LP-GE-08](../skills/generation-economy/rules/LP-GE-08.md) | Route trivially small calls to a small model | both |
| [LP-GE-09](../skills/generation-economy/rules/LP-GE-09.md) | Predicted outputs for mostly unchanged text | generation |
| [LP-GE-10](../skills/generation-economy/rules/LP-GE-10.md) | Structured output instead of parse-and-re-ask | generation |
| [LP-LW-01](../skills/lmwarden/rules/LP-LW-01.md) | Turn on prefix caching and set the match unit | prefill |
| [LP-LW-02](../skills/lmwarden/rules/LP-LW-02.md) | Keep a conversation on the replica that holds its cache | prefill |
| [LP-LW-03](../skills/lmwarden/rules/LP-LW-03.md) | One key per app or tenant; cache scope is a privacy boundary | prefill |

## Prove it: measure, change, measure

Start with what the provider already tells you. OpenAI-compatible APIs, vLLM, DeepInfra and OpenRouter report `usage.prompt_tokens_details.cached_tokens`; Anthropic reports `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`. Compare them across two requests of the same conversation, before and after a fix.

To keep a fix from coming undone, add a stable-head test. It builds the request your app would send for two fixed inputs and fails when the system prompt or tool list differs, using [kvsig](https://github.com/Podwarden/kvsig) ids. It runs offline, with no provider call:

```ts
import { assertStableHead } from "./stable-head";
it("the head does not change from one day to the next", () =>
  assertStableHead(
    (now) => app.buildRequest("Where is my order?", { session: 0, turn: 0, now }),
    [new Date("2026-11-03T08:15:42Z"), new Date("2026-11-04T17:02:09Z")],
    { sys: true, tools: true },
  ));
```

When `sys` differs, something in the system prompt changes per input (a date, an id, a path); when `tools` differs, a tool was reordered or edited. The helper templates (TypeScript and Python) to copy into your tests and the table of which id to assert for each rule are in [measure-loop](../skills/measure-loop/SKILL.md#the-stable-head-test-kvsig-ids-in-ci).

For a measured score, log every call with the usage logger: `leanprompt/log` for TypeScript and `leanprompt-cli` for Python, both published with the first release. It writes one JSON line per call to `.leanprompt/usage.jsonl` with keyed ids, token counts and flags, and never writes prompt or completion text. How the log becomes a score: [score.md](score.md).

## Evidence and example apps

The figures in the README, these docs and the skills come from the table in [evidence.md](evidence.md) (rows E1 to E12, each with its source, date and limits) or from measured result files under `eval/results/`, which stays empty until the first real replay is committed. Results from the cache simulator run in CI only and are never quoted. `npm run check:numbers` fails the build when a number in the README, a page under `docs/` or a skill has no source.

The example apps in [examples/](../examples/) each come in a `before/` and an `after/` form with an answer check, and `npm run eval` replays them: against the local simulator at no cost, or against a provider you name, which sends real, billed requests under a spend cap.

## What leanprompt is not

- Not a proxy and not a prompt rewriter on the wire. It changes your code, with your approval, one fix at a time.
- Not a prompt-compression library. Compressing a prompt changes its bytes on every call, which is what breaks a prefix cache.
- Not a hosted service. There is no telemetry, no account and no upload. The CLI makes no network calls except `profile detect` (to the URL you give it) and the replay harness (to providers you name).
- Not a promise of a percentage for your app. Measure it: the score says what it was computed from.
