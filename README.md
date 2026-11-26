# leanprompt

**Skills that teach your AI coding assistant to make the app it is building call LLMs for less, by the PodWarden Team.** leanprompt is a set of skills for coding agents, not a prompt-compression library, and it works on the app the assistant is building, not on the assistant's own bill.

[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![ci](https://github.com/Podwarden/leanprompt/actions/workflows/ci.yml/badge.svg)](https://github.com/Podwarden/leanprompt/actions/workflows/ci.yml)
[![status: pre-release](https://img.shields.io/badge/status-pre--release-orange)](docs/install.md)
<!-- pending: this repo's own leanprompt badge, once .leanprompt/score.json is committed from a measured run -->

<!-- pending: demo GIF (docs/DESIGN.md section 13): init, audit, three findings, static score, fix, replay, measured score; recorded on a real run, numbers from eval/results -->

## TL;DR

- **What it does:** five skills that show Claude Code, Codex, Cursor, OpenCode or any `AGENTS.md` agent where your app pays twice for the same LLM tokens: a prompt the provider's cache cannot reuse, a retry that repeats a truncation, one request per sample.
- **How you use it:** install the skills, then ask your assistant to *audit this app's LLM calls*.
- **What you get:** findings ranked by tokens lost, each with its file, line and a fix that keeps meaning, and a score: measured from your provider's own usage numbers, or estimated from the findings until you have a usage log.
- **What it never does:** no telemetry, no proxy, no hosted service, no account. It does not edit your code without asking first.
- **Status:** pre-release. Install from GitHub today; the npm and PyPI packages come with the first release.

## Quick start

1. Install the skills. In Claude Code, inside a session:
   ```
   /plugin marketplace add Podwarden/leanprompt
   /plugin install leanprompt@leanprompt
   ```
   For Codex, Cursor, OpenCode or any `AGENTS.md` agent, run this in your project (Node 20.19 or newer):
   ```
   npx github:Podwarden/leanprompt init --assistant codex   # or cursor, opencode, agents-md, claude
   ```
   Paths per assistant, global installs, Windows and a clone-and-build install: [docs/install.md](docs/install.md).
2. Ask your assistant: *audit this app's LLM calls*.
3. It writes `leanprompt-report.md` and `.leanprompt/findings.json`, then proposes one fix at a time and asks before it edits anything.
4. Score it with `npx leanprompt score`: measured from your usage log when there is one, static from the findings otherwise. Until the npm release, run every `npx leanprompt <cmd>` as `npx github:Podwarden/leanprompt <cmd>`.
5. Optional: `npx leanprompt report --html` writes a local page, `.leanprompt/report.html`.

## The problem

Every call to an LLM resends the system prompt, the tool list and the history. Providers cache the part that did not change, but only if it really did not change, byte for byte, from the first token. Most apps break that without knowing: a timestamp on the first line, tools built from an unsorted dict, a client that never sends Anthropic's cache marks. Then they pay again for output: a retry after a truncation, one request per sample, a parse failure re-asked from scratch.

| What changed | Before | After |
|---|---|---|
| Replayed coding-agent sessions on Anthropic: did the client send cache marks? No marks: Codex and OpenCode sessions; 3 marks: a Claude Code session | no marks: 0 tokens from cache on 29 turns (E1) | 3 marks: 92% of prompt tokens from cache on one session (435,661 of 471,607) (E1) |
| Thinking toggled between turns vs kept the same, one session on a self-hosted vLLM (Qwen hybrid model) | toggled turns lost 47% of what they could have reused (E7) | turns with the same setting as the turn before lost nothing beyond the engine rule (E7) |
| Cache-aware replica routing (LM Warden, an engine setting, not a prompt rule); synthetic load, 8 concurrent agent sessions, one run per arm; at 24+ sessions (overload) the median got worse | median time to first byte 2.33 s; 44% of prompt tokens from cache (E10) | median time to first byte 0.48 s; 86% from cache; output tokens a minute +29% (E10) |

<!-- pending: eval/results (example apps before/after, measured; one row per app once real runs are committed) -->

And one that went the other way: moving the date to the end of the prompt cut correct date answers from 10/12 to 1/12 and did not help the cache (E6). leanprompt's rules keep meaning first. Every figure above is a row in [docs/evidence.md](docs/evidence.md), with its source and its limits.

## What's in the box

Five skills, each a folder with a `SKILL.md` and one file per rule:

- [`llm-call-audit`](skills/llm-call-audit/SKILL.md): finds every LLM call, checks it against the rules, ranks the findings and writes the report. Start here.
- [`prefill-cache`](skills/prefill-cache/SKILL.md): prompts the provider's prefix cache can reuse, without changing what they mean (LP-PC-01 to LP-PC-12).
- [`generation-economy`](skills/generation-economy/SKILL.md): samples, budgets, timeouts, retries and batching that do not waste calls or output (LP-GE-01 to LP-GE-10).
- [`measure-loop`](skills/measure-loop/SKILL.md): measure, change one thing, measure again; the usage logger, the stable-head CI test, the score.
- [`lmwarden`](skills/lmwarden/SKILL.md): self-hosted engines (vLLM, SGLang, LM Warden): engine settings, replica routing, cache isolation (LP-LW-01 to LP-LW-03).

## Commands

| Command | What it does |
|---|---|
| `leanprompt init` | Installs the skills for the assistants the project uses ([docs/install.md](docs/install.md)) |
| `leanprompt score` | Writes `.leanprompt/score.json`, measured or static ([docs/score.md](docs/score.md)) |
| `leanprompt calibrate` | Fits the static score's weights to your app from a trial run ([docs/calibration.md](docs/calibration.md)) |
| `leanprompt report --html` | Writes the findings and the score to `.leanprompt/report.html` |
| `leanprompt profile detect --lmwarden <url>` | Reads engine cache facts from LM Warden into `leanprompt.yaml` ([docs/profile.md](docs/profile.md)) |
| `leanprompt lesson` | Drafts a lesson-learned issue on your machine; sends nothing |
| `leanprompt eval-audit` | Scores an audit's findings against the seeded example cases |

## Learn more

- [How it works](docs/how-it-works.md): the audit, the rules at a glance, and how to prove a fix.
- [The score and the badge](docs/score.md): the formula, measured and static scores, calibration.
- [Provider notes](docs/providers.md) and [self-hosting](docs/self-hosting.md), including LM Warden and its limits.
- [All docs](docs/README.md), including the [evidence table](docs/evidence.md) and the [changelog](docs/CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. A new rule needs a "Verify" section and either a measured example or a dated provider-doc source; commits carry a DCO sign-off. See [CONTRIBUTING.md](.github/CONTRIBUTING.md), [GOVERNANCE.md](.github/GOVERNANCE.md) and [SECURITY.md](.github/SECURITY.md). If leanprompt helped you, or a rule misled you, share a lesson in general terms with the [Lesson learned form](https://github.com/Podwarden/leanprompt/issues/new?template=lesson-learned.yml); credit is optional ([THANKYOU.md](docs/THANKYOU.md)).

## License

Code (`cli/`, `eval/`, `examples/`, `python/`, `scripts/`) is under [Apache-2.0](LICENSE). The skills, provider and model tables, docs and this README are under [CC BY 4.0](LICENSE-DOCS). Copyright the PodWarden Team. "PodWarden" and "LM Warden" are trademarks of their owners; see [NOTICE](NOTICE).

## Related projects

- [kvsig](https://github.com/Podwarden/kvsig): the open spec for keyed conversation and prefix ids that the stable-head test and the measured score use.
- [LM Warden](https://github.com/Podwarden/lm-warden): self-hosted, cache-aware model serving on your own NVIDIA GPUs.
