# leanprompt

**Skills that teach your AI coding assistant to make the apps it builds call LLMs for less, by the PodWarden Team.** leanprompt is a set of skills for coding agents, not a prompt-compression library, and it works on the app the assistant is building, not on the assistant's own bill.

*Stop paying for the same prompt twice.*

[![code: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue)](LICENSE)
[![docs: CC BY 4.0](https://img.shields.io/badge/docs-CC_BY_4.0-lightgrey)](LICENSE-DOCS)
[![works with](https://img.shields.io/badge/works_with-Claude_Code_·_Codex_·_OpenCode_·_Cursor_·_AGENTS.md-555)](#install-for-each-assistant)
<!-- pending: this repo's own leanprompt badge, once .leanprompt/score.json is committed from a measured run -->

| What changed | Before | After |
|---|---|---|
| Replayed coding-agent sessions on Anthropic: did the client send cache marks? No marks: Codex and OpenCode sessions; 3 marks: a Claude Code session | no marks: 0 tokens from cache on 29 turns (E1) | 3 marks: 92% of prompt tokens from cache on one session (435,661 of 471,607) (E1) |
| Thinking toggled between turns vs kept the same, one session on a self-hosted vLLM (Qwen hybrid model) | toggled turns lost 47% of what they could have reused (E7) | turns with the same setting as the turn before lost nothing beyond the engine rule (E7) |
| Cache-aware replica routing (LM Warden, an engine setting, not a prompt rule); synthetic load, 8 concurrent agent sessions, one run per arm; at 24+ sessions (overload) the median got worse | median time to first byte 2.33 s; 44% of prompt tokens from cache (E10) | median time to first byte 0.48 s; 86% from cache; output tokens a minute +29% (E10) |

<!-- pending: eval/results (example apps before/after, measured; one row per app once real runs are committed) -->

And one that went the other way: moving the date to the end of the prompt cut correct date answers from 10/12 to 1/12 and did not help the cache (E6). leanprompt's rules keep meaning first. Every figure above is a row in [docs/evidence.md](docs/evidence.md), with its source and its limits.

```
npx leanprompt init
```

Then ask your assistant: *audit this app's LLM calls*. In Claude Code you can install the plugin instead: `/plugin marketplace add Podwarden/leanprompt`, then `/plugin install leanprompt@leanprompt`.

<!-- pending: demo GIF (docs/DESIGN.md section 13): init, audit, three findings, static score, fix, replay, measured score; recorded on a real run, numbers from eval/results -->

## The problem

Every call to an LLM resends the system prompt, the tool list and the history. Providers and engines cache the part that did not change, but only if it really did not change, byte for byte, from the first token. Most apps break that without knowing: a timestamp on the first line, tools built from an unsorted dict, a history store that re-serialises old messages, a client that never sends Anthropic's cache marks. Then they pay again to generate what one call could have produced: a retry after a truncation, one request per sample, a parse failure re-asked from scratch.

leanprompt gives your coding assistant the rules to find those places in your code, the fix for each, and a way to prove the fix helped with the provider's own usage fields.

## What you get

Five skills, each a folder with a `SKILL.md` and one file per rule:

- [`llm-call-audit`](skills/llm-call-audit/SKILL.md): finds every LLM call in the app, checks it against the rules, ranks the findings and writes `leanprompt-report.md` and `.leanprompt/findings.json`. Start here.
- [`prefill-cache`](skills/prefill-cache/SKILL.md): prompts the provider's prefix cache can reuse, without changing what they mean (LP-PC-01 to LP-PC-12).
- [`generation-economy`](skills/generation-economy/SKILL.md): calls and output that are not wasted: samples, budgets, timeouts, retries, batching (LP-GE-01 to LP-GE-10).
- [`measure-loop`](skills/measure-loop/SKILL.md): measure, change one thing, measure again; the usage logger, the stable-head CI test, the score.
- [`lmwarden`](skills/lmwarden/SKILL.md): self-hosted engines (vLLM, SGLang, LM Warden): engine settings, replica routing, keys and cache isolation (LP-LW-01 to LP-LW-03).

Plus a small CLI (`npx leanprompt`) that installs the skills, computes the score and writes a local HTML report.

## How the audit works

Ask your assistant to *audit this app's LLM calls*. The `llm-call-audit` skill:

1. Inventories the call sites by SDK and HTTP shape (Anthropic, OpenAI, Gemini, LangChain, LlamaIndex, LiteLLM, the Vercel AI SDK, raw `fetch` or `requests`), and follows each one back to where its system prompt, tools and history are built.
2. Checks each call against the rules and records every finding with its rule id, file and line.
3. Proposes one fix per finding, with the rule's "Don't break meaning" check, and asks before editing anything.
4. Hands each fix to `measure-loop` to prove it with a before and after number.

The report follows [report-template.md](skills/llm-call-audit/report-template.md): the call inventory, the findings ranked by tokens lost, the score and the next steps. `npx leanprompt report --html` turns the findings and the score into a single local page (`.leanprompt/report.html`). If you tell the audit you are on a particular provider or self-hosted engine, or that speed matters more than cost, put it in [`leanprompt.yaml`](docs/profile.md) and the findings are ranked for that target.

<!-- pending: eval/results (an excerpt of a real leanprompt-report.md from an example app, once the audit has been run on it) -->

## The rules at a glance

Prefill rules first, then generation, then self-hosted. Every rule file ends with a "Verify" section: the usage field that must change and the kvsig id that must stay equal.

| Rule | In one line | Saves |
|---|---|---|
| [LP-PC-01](skills/prefill-cache/rules/LP-PC-01.md) | Put cache marks where the provider needs them | prefill |
| [LP-PC-02](skills/prefill-cache/rules/LP-PC-02.md) | Stable content first, without hurting meaning | prefill |
| [LP-PC-03](skills/prefill-cache/rules/LP-PC-03.md) | No ids, timestamps, versions or paths at the top of the prompt | prefill |
| [LP-PC-04](skills/prefill-cache/rules/LP-PC-04.md) | Fixed tool order and JSON key order | prefill |
| [LP-PC-05](skills/prefill-cache/rules/LP-PC-05.md) | Tool lists grow only at the end | prefill |
| [LP-PC-06](skills/prefill-cache/rules/LP-PC-06.md) | Append-only history | prefill |
| [LP-PC-07](skills/prefill-cache/rules/LP-PC-07.md) | Shared context before per-user context | prefill |
| [LP-PC-08](skills/prefill-cache/rules/LP-PC-08.md) | Cache-aware compaction | prefill |
| [LP-PC-09](skills/prefill-cache/rules/LP-PC-09.md) | Consistent reasoning handling; thinking fixed per session | both |
| [LP-PC-10](skills/prefill-cache/rules/LP-PC-10.md) | Stable image and attachment placement | prefill |
| [LP-PC-11](skills/prefill-cache/rules/LP-PC-11.md) | Keep pauses inside the cache lifetime | prefill |
| [LP-PC-12](skills/prefill-cache/rules/LP-PC-12.md) | Do not split one prefix across models or keys that do not share a cache | prefill |
| [LP-GE-01](skills/generation-economy/rules/LP-GE-01.md) | n samples in one request | prefill |
| [LP-GE-02](skills/generation-economy/rules/LP-GE-02.md) | Batch independent questions about one context | both |
| [LP-GE-03](skills/generation-economy/rules/LP-GE-03.md) | Output and thinking budgets that fit the task | generation |
| [LP-GE-04](skills/generation-economy/rules/LP-GE-04.md) | Stream long outputs; timeouts that match generation time | both |
| [LP-GE-05](skills/generation-economy/rules/LP-GE-05.md) | Retry only retryable errors; never retry a truncation unchanged | both |
| [LP-GE-06](skills/generation-economy/rules/LP-GE-06.md) | Cache exact responses for deterministic requests | both |
| [LP-GE-07](skills/generation-economy/rules/LP-GE-07.md) | Batch API for work that can wait | both |
| [LP-GE-08](skills/generation-economy/rules/LP-GE-08.md) | Route trivially small calls to a small model | both |
| [LP-GE-09](skills/generation-economy/rules/LP-GE-09.md) | Predicted outputs for mostly unchanged text | generation |
| [LP-GE-10](skills/generation-economy/rules/LP-GE-10.md) | Structured output instead of parse-and-re-ask | generation |
| [LP-LW-01](skills/lmwarden/rules/LP-LW-01.md) | Turn on prefix caching and set the match unit | prefill |
| [LP-LW-02](skills/lmwarden/rules/LP-LW-02.md) | Keep a conversation on the replica that holds its cache | prefill |
| [LP-LW-03](skills/lmwarden/rules/LP-LW-03.md) | One key per app or tenant; cache scope is a privacy boundary | prefill |

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

When `sys` differs, something in the system prompt changes per input (a date, an id, a path); when `tools` differs, a tool was reordered or edited. The helper templates (TypeScript and Python) to copy into your tests and the table of which id to assert for each rule are in [measure-loop](skills/measure-loop/SKILL.md#the-stable-head-test-kvsig-ids-in-ci).

For a measured score, log every call with the usage logger: `leanprompt/log` on npm, `leanprompt-cli` on PyPI. It writes one JSON line per call to `.leanprompt/usage.jsonl` with keyed ids, token counts and flags, and never writes prompt or completion text.

## The score and the badge

```
npx leanprompt score
```

writes `.leanprompt/score.json`. The number is `floor(100 × (0.6 × E × S + 0.4 × (1 − G)))`, shown with its inputs:

- **E**, prefill reuse: cached prompt tokens over reusable prompt tokens, where reusable is capped by the provider's own rules (minimum size, block or step size, breakpoints, cache lifetime).
- **S**, prefix stability: reusable over prompt tokens on requests that continue an earlier one.
- **G**, generation waste: output tokens spent on repeated calls, retried truncations and parse failures, over all output tokens.

There are two kinds, always labelled. A **measured** score comes from the usage log (`score --measured`). It needs at least 50 measured calls and states how many it used; with fewer, it refuses and suggests `--static`. A **static** score comes from the audit's findings (`score --static`) and is an estimate, with a lighter badge colour. With no flag, `score` uses `.leanprompt/usage.jsonl` when it exists and `.leanprompt/findings.json` otherwise. `npx leanprompt calibrate` fits the static weights to your app from a trial run ([docs/calibration.md](docs/calibration.md)).

Commit `.leanprompt/score.json` and point shields.io's endpoint badge at its raw URL:

```markdown
![leanprompt](https://img.shields.io/endpoint?url=<raw URL of .leanprompt/score.json in your repo>)
```

The file carries the score, its kind, its inputs, the number of calls, the date and the leanprompt version. There is no hosted service and no upload. Rerun it yourself: the file is the evidence.

## Provider notes

Each provider gets the same treatment: its cache rules, its render order and its limits, from its own documentation, dated. The facts live only in these tables.

- **Anthropic** caches at the cache marks the request sets (or with its automatic mode); without marks, nothing is cached. [providers/anthropic.md](providers/anthropic.md)
- **OpenAI** caches long prompts automatically by prefix; a stable `prompt_cache_key` helps route to the same cache. [providers/openai.md](providers/openai.md)
- **Gemini** caches implicitly above a minimum that depends on the model; explicit caching exists on some models only. [providers/gemini.md](providers/gemini.md)
- **OpenRouter** is a router: hits depend on the upstream provider, so keep one provider per conversation and pass cache marks through. [providers/openrouter.md](providers/openrouter.md)
- **DeepInfra** caches automatically by prefix. [providers/deepinfra.md](providers/deepinfra.md)
- **vLLM** and **SGLang** cache in blocks or pages on your own hardware; block size and speculative decoding change how much is reused. [providers/vllm.md](providers/vllm.md), [providers/sglang.md](providers/sglang.md)

Per-model habits (thinking and reasoning controls, template quirks) are in [models/](models/).

## Self-hosting

Self-hosting tends to pay with steady traffic, long shared prefixes, data that must not leave your host and NVIDIA GPUs already on hand. It tends not to with no GPU, spiky low traffic, or work that needs a frontier model. The [`lmwarden`](skills/lmwarden/SKILL.md) skill covers both sides and treats vLLM, SGLang, llama.cpp and Ollama as options in their own right.

Engine settings matter: on one hybrid model with large cache blocks, `--prefix-match-unit 16` on vLLM 0.32 raised short-prompt reuse from 44% to 76%, against an ideal of 78% (E9). One 4B model on one card, thinking off.

[LM Warden](https://github.com/Podwarden/lm-warden) is the self-hosted server the PodWarden Team makes and the option the skill recommends: an OpenAI-compatible API on your own NVIDIA GPUs, vLLM and llama.cpp behind one port, a key per consumer with its own usage, and replica routing that keeps a conversation on the replica holding its cache. Measured on 8 concurrent synthetic agent sessions on four RTX A4000 cards with Qwen3-4B, one run per arm: median time to first byte from 2.33 s to 0.48 s, prompt tokens from cache from 44% to 86%, output tokens a minute up 29% (E10). At 24 and more sessions, where the cards were overloaded either way, the median got worse with routing on (E10). That is an engine result, not something a leanprompt rule achieves. LM Warden is single host and NVIDIA only, and it does not make a model faster.

`leanprompt profile detect --lmwarden <url>` reads the engine facts (block size, match unit, speculative decoding) from LM Warden into `leanprompt.yaml`. It needs an LM Warden release that has the key-scoped engine endpoint (`/api/me/engine`); on an older one, set the `engine:` block by hand from the engine's startup log ([docs/profile.md](docs/profile.md)).

Prompt Lens, an LM Warden view that names the first part of a prompt where reuse broke and what the miss cost, is planned. Until it ships, find the break with kvsig ids and the engine's cache statistics.

## Install for each assistant

`npx leanprompt init` (Node 20.19 or newer) detects the assistants a project uses from `.claude/`, `AGENTS.md`, `.codex/`, `.opencode/` and `.cursor/`, and writes the matching files. `--assistant claude|codex|opencode|cursor|agents-md` forces one, `--global` installs into your home directory where the assistant supports it, and `--dir <project>` points it at another folder. A second run is a no-op, and text of yours outside leanprompt's marked block in `AGENTS.md` is left byte for byte as it was. The paths below were checked against each vendor's documentation on 2026-11-26 ([docs/assistant-paths.md](docs/assistant-paths.md)).

**Claude Code.** Skills go to `.claude/skills/<name>/` (or `~/.claude/skills/` with `--global`):

```
npx leanprompt init --assistant claude
```

Or install the plugin from this repo's marketplace, inside a session:

```
/plugin marketplace add Podwarden/leanprompt
/plugin install leanprompt@leanprompt
```

**Codex.** Skills go to `.agents/skills/<name>/`, plus a short leanprompt block in `AGENTS.md` (with `--global`: `~/.agents/skills/` and `~/.codex/AGENTS.md`):

```
npx leanprompt init --assistant codex
```

**OpenCode.** An `audit` command in `.opencode/commands/` and the block in `AGENTS.md`. OpenCode reads skills from `.claude/skills` and `.agents/skills`, so init adds the skills to `.agents/skills/` only when neither folder is there:

```
npx leanprompt init --assistant opencode
```

**Cursor.** One project rule per skill, `.cursor/rules/leanprompt-<skill>.mdc`, the agent decides when each applies. The installed rules link to the full rule text on GitHub, so opening a rule needs the network. Cursor's user rules have no file path, so there is no `--global`:

```
npx leanprompt init --assistant cursor
```

**Any agent that reads `AGENTS.md`.** Skills in `.agents/skills/<name>/` and the block in `AGENTS.md`. This is also what init does when it detects no assistant:

```
npx leanprompt init --assistant agents-md
```

**Without typing npx (macOS and Linux).** Windows installs with `npx leanprompt init`. The `curl | sh` line below is for macOS and Linux: [scripts/install.sh](scripts/install.sh) runs the same `init` through npx, so it still needs Node; arguments pass through:

```
curl -fsSL https://raw.githubusercontent.com/Podwarden/leanprompt/main/scripts/install.sh | sh -s -- --assistant cursor
```

## Evidence

The figures in this README and the skills come from the table in [docs/evidence.md](docs/evidence.md) (rows E1 to E12, each with its source, date and limits) or from measured result files under `eval/results/`, which stays empty until the first real replay is committed. Results from the cache simulator run in CI only and are never quoted. `npm run check:numbers` fails the build when a number in the README or a skill has no source.

The example apps in [examples/](examples/) each come in a `before/` and an `after/` form with an answer check, and `npm run eval` replays them: against the local simulator at no cost, or against a provider you name, which sends real, billed requests under a spend cap.

## What leanprompt is not

- Not a proxy and not a prompt rewriter on the wire. It changes your code, with your approval, one fix at a time.
- Not a prompt-compression library. Compressing a prompt changes its bytes on every call, which is what breaks a prefix cache.
- Not a hosted service. There is no telemetry, no account and no upload. The CLI makes no network calls except `profile detect` (to the URL you give it) and the replay harness (to providers you name).
- Not a promise of a percentage for your app. Measure it: the score says what it was computed from.

## Related projects

- [kvsig](https://github.com/Podwarden/kvsig): the open spec for keyed conversation and prefix ids that the stable-head test and the measured score use.
- [LM Warden](https://github.com/Podwarden/lm-warden): self-hosted, cache-aware model serving on your own NVIDIA GPUs.

## Contributing

Issues and pull requests are welcome. A new rule needs a "Verify" section and either a measured example or a dated provider-doc source; commits carry a DCO sign-off. See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md) and [SECURITY.md](SECURITY.md).

If leanprompt helped you, or a rule misled you, share a lesson in general terms with the [Lesson learned form](https://github.com/Podwarden/leanprompt/issues/new?template=lesson-learned.yml). `npx leanprompt lesson` drafts the text on your machine and sends nothing. Credit is optional: see [THANKYOU.md](THANKYOU.md).

## License

Code (`cli/`, `eval/`, `examples/`, `python/`, `scripts/`) is under [Apache-2.0](LICENSE). The skills, provider and model tables, docs and this README are under [CC BY 4.0](LICENSE-DOCS). Copyright the PodWarden Team. "PodWarden" and "LM Warden" are trademarks of their owners; see [NOTICE](NOTICE).
