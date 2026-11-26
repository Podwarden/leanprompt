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
