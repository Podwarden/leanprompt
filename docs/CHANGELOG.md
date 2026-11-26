# Changelog

All notable changes to leanprompt. Versions follow semantic versioning; a change to the score formula is a minor version.

## 0.1.0 – unreleased

The first release.

### Skills

- `llm-call-audit`: finds every LLM call in an app, checks it against the rules, ranks the findings and writes `leanprompt-report.md` and `.leanprompt/findings.json`; asks before editing code, installing a package or running billed requests.
- `prefill-cache`: rules LP-PC-01 to LP-PC-12 for prompts a provider's prefix cache can reuse.
- `generation-economy`: rules LP-GE-01 to LP-GE-10 for calls and output that are not wasted.
- `measure-loop`: the usage logger, the stable-head CI test (vitest and pytest templates on kvsig ids), replay before and after, and the score.
- `lmwarden`: rules LP-LW-01 to LP-LW-03 for self-hosted engines, and reading engine facts from LM Warden. Prompt Lens is described as planned.
- Dated provider tables (Anthropic, OpenAI, Gemini, OpenRouter, DeepInfra, vLLM, SGLang) and per-model notes (Qwen, OpenAI reasoning, Anthropic thinking), each with a `checked:` date and a source.
- The evidence table, `docs/evidence.md` (rows E1 to E12, with sources and limits).

### CLI (`npx leanprompt`)

- `init`: installs the skills for Claude Code, Codex, OpenCode, Cursor and any `AGENTS.md` reader, detected or forced with `--assistant`; `--global` for the home directory. Idempotent; leaves user text outside its marked block untouched and never overwrites files it did not generate.
- `score`: writes `.leanprompt/score.json`, measured from the usage log (at least 50 measured calls) or static from the audit's findings; the file is also the shields.io endpoint badge source.
- `calibrate`: fits the static score's weights to an app from a trial run.
- `report --html`: a local HTML page of the findings and the score.
- `profile detect --lmwarden <url>`: reads engine cache facts from LM Warden into `leanprompt.yaml`.
- `eval-audit`: scores an audit's findings against the seeded example cases.
- The target profile, `leanprompt.yaml` (target, engine, priority, ignore list).
- Usage loggers for TypeScript (`leanprompt/log`) and Python (PyPI `leanprompt-cli`); they write ids, counts and flags, never prompt or completion text.

### Evaluation

- Six example apps, each in a `before/` and an `after/` form with an answer check.
- A replay harness (`npm run eval`) with a local cache simulator for CI and a spend cap for real providers. Simulator results are never quoted.
- An audit recall and false-positive harness over seeded fixtures in Python, Go and TypeScript.

### Project

- Per-assistant forms generated from one source and checked in CI; a Claude Code plugin marketplace in `.claude-plugin/`.
- `npm run check:numbers`: every number with a unit in the README, the public docs and the skills cites an evidence row or a measured result.
- Apache-2.0 for code, CC BY 4.0 for the skills and docs; README, CONTRIBUTING, GOVERNANCE and SECURITY (the last three under `.github/`).

## 0.1.0-dev.5 – 2026-11-26

Rule changes from the rule-quality notes of a first real audit ([#5](https://github.com/Podwarden/leanprompt/issues/5)) and a lesson learned report ([#6](https://github.com/Podwarden/leanprompt/issues/6)). Each change was checked against the sources it cites; what follows from them without a source is marked as such.

- **LP-GE-04, no timeout set.** A call with no timeout of its own gets the HTTP client's default. The defaults of Node's built-in `fetch` (undici's header and body timeouts), Python `httpx`, Python `requests` and Go `net/http` are on a new dated facts page, [runtimes/http-clients.md](../runtimes/http-clients.md), one row per client with its source; the rule links to it instead of repeating the values. The rule adds Detect patterns for calls with no timeout of their own, a Node `fetch` streaming fix with an idle timer, and a severity for a default shorter than the generation.
- **`runtimes/`.** A new folder of dated facts pages for HTTP clients and runtimes, checked by `lint:facts` like `providers/` and `models/` (`checked:` date, `source:`, a source URL on every table row, the 90-day warning) and shipped in the package.
- **LP-GE-10, no reasoning parser.** On vLLM a schema is kept off the thinking only when a reasoning parser marks where the thinking ends. When the thinking arrives inside `content`, the schema would constrain it too. Don't break meaning and Verify now say: confirm the server returns a separate `reasoning` field, or decide thinking off under LP-GE-03 with an answer check, before adding a schema. Detect finds `<think>` stripping in code. `providers/vllm.md` has rows for the reasoning parser and for structured outputs with reasoning; `models/qwen.md` points at them.
- **LP-GE-03, reasoning twice.** A prompt or schema that asks for a reasoning field while model thinking is on spends one output limit on two rounds of reasoning. New Why bullet, Detect shape, Don't break meaning check and severity. The Waste signal also gives a severity for a limit below the task.
- **LP-GE-05.** The Waste signal says how to rate a truncation filed under a generic "retryable" status and re-run later, by a job or by a person. Detect names an "empty answer" error raised for a truncation inside the thinking.
- **LP-PC-07, per-user transforms.** Redaction or per-user templating run over the whole prompt rewrites the shared head whenever a per-user value also appears in it. Apply them only to the per-user parts; Verify checks that kvsig `sys` and `head` stay equal across two such users.
- **LP-LW-01, one-shot apps.** With a constant head and a different body on each request, only the full blocks inside the shared head are reused; the rule says how to compare the head's length with the engine's block size.
- Content tests for each of these.

Thanks for a lesson learned report (#6).

## 0.1.0-dev.4 – 2026-11-26

The three format decisions from the first audit of a real project ([#4](https://github.com/Podwarden/leanprompt/issues/4)).

- **Several backends.** `leanprompt.yaml` accepts `targets:`, a list with one entry per backend (each names a `provider` or an `engine`, with optional `model_family`, `context_tokens`, `files` globs and, on an engine entry, `engine_facts`). `target:` still works; both together are an error. The measured score takes each record's cache facts from its own provider or engine name, then from the matching `targets` entry, then from a single target; with several targets and no match the record is unmeasured as `ambiguous_target` instead of guessed. `profile detect --lmwarden` writes into the `lm-warden` (else `vllm`) entry. The audit records each backend as a `targets` entry, on a yes, and checks `applies_to` against each finding's backend. Example in [profile.md](profile.md).
- **Findings outside the repository.** `findings.json` accepts `"file": "<external>"` with a `where` (for example "engine launch flags"; `line` optional or 0), and `"status": "needs-facts"` with a `confirm` naming the fact that would confirm or dismiss the finding. They count in the static score like any other finding. `report --html`, the report template and `presenting.md` list them, ranked, under "Open questions" with the `confirm` text. `eval-audit` leaves `<external>` findings out of recall and false positives and prints how many.
- **The audit estimates share.** The audit skill now gives every finding a `share`: estimated tokens lost on the affected side ÷ that side's tokens for the same calls, with the assumptions in the report. The severity default is used only when no estimate is possible, and the report says so. `score --static` prints `default_shares: N of M` (with a note when every share is a default), `score.json` stores the counts under `diagnostics`, and `report --html` shows them next to the static score. `calibrate` is unchanged: it scales only default shares, so with estimated shares it matters less.

## 0.1.0-dev.3 – 2026-11-26

CLI fixes from the first audit of a real project ([#4](https://github.com/Podwarden/leanprompt/issues/4); the design items there stay open).

- `leanprompt --help`, `leanprompt help` and `leanprompt <command> --help` print the flags each command accepts, and exit 0. The help and the argument parsers read one table of command specs, so they cannot drift. An unknown command still exits 2 and now points at `--help`.
- `init` with auto-detect no longer installs the skills twice. When Claude Code is detected, the skills go to `.claude/skills` only, and an `AGENTS.md` that is present gets the block pointing at them (OpenCode reads `.claude/skills` too). `.agents/skills` is installed when Codex is detected or asked for, when Claude Code is absent, or with `--assistant agents-md`. `init` prints why each assistant was detected and how to name another.
- `init --dry-run` lists what would be written, updated or skipped, and writes nothing.
- `report --html` lists the findings in one table ranked by severity, then estimated share of tokens lost (when the finding has a `share`), then file and line; each row shows `file:line`. Rule ids no longer wrap on a phone.
- `lesson` exits 2 when there is no measured score and no `--rule`, and says what is missing: a measured before and after, or a rule that misled you. `--rule <id>` still works after a static score.

## 0.1.0-dev.2 – 2026-11-26

Fixes from the first audit of a real project ([#1](https://github.com/Podwarden/leanprompt/issues/1), [#2](https://github.com/Podwarden/leanprompt/issues/2), [#3](https://github.com/Podwarden/leanprompt/issues/3)).

- The call-site search finds raw HTTP calls whose URL is built from a base that ends in `/v1`: `call-shapes.md` now searches the path without the version (`chat/completions`, `/messages`, `/responses`), template-literal and concatenated URLs, and a `messages` list in the request body near `fetch`, `axios`, `got`, `requests`, `httpx` and `http.NewRequest`, with the `rg` patterns per language. A hit is a candidate: the skill says to confirm it is a real call. A content test runs the documented patterns on small fixtures, and the audit example set has a new case, `ts/triage-fetch`.
- A provider with no table (DeepSeek, Groq, Together, Azure and other OpenAI-compatible hosts) now gets the provider-independent rules. `applies_to` restricts only the provider-specific rules; a rule whose fix is the same on every target lists `any` (LP-GE-02, 03, 04, 05, 06, 08 and 10). For caching on such a host the audit says "unknown, check the provider's docs" unless the host's documentation shows automatic prefix caching.
- The usage loggers install before the npm and PyPI releases: `npm i github:Podwarden/leanprompt#v0.1.0-dev.1` for TypeScript, `pip install "git+https://github.com/Podwarden/leanprompt#subdirectory=python"` for Python. The measure-loop skill, `docs/install.md` and the README say so, and the assistant still asks before running the install.

## 0.1.0-dev.1 – 2026-11-26

A pre-release that installs from GitHub.

- `npx github:Podwarden/leanprompt <cmd>` builds and runs the CLI from source (a `prepare` script), so it works before the npm release; `scripts/install.sh` installs from the GitHub tag `v<version>`.
- The README is shorter, with a TL;DR and a quick start; the detail moved to pages under `docs/` (install, how it works, score, providers, self-hosting) with an index in `docs/README.md`.
- CONTRIBUTING, GOVERNANCE and SECURITY moved to `.github/`; CHANGELOG and THANKYOU moved to `docs/`.
- `npm run check:numbers` and the jargon test also cover the public pages under `docs/`.
