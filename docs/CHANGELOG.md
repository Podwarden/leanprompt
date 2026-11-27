# Changelog

All notable changes to leanprompt. Versions follow semantic versioning; a change to the score formula is a minor version.

## 0.1.0 – unreleased

The first release.

### Skills

- `leanprompt`: the entry point; `/leanprompt` lists the commands (init, audit, fix, measure, score, report, lesson) and routes each to the skill that does the work.
- `llm-call-audit`: finds every LLM call in an app, checks it against the rules, ranks the findings and writes `leanprompt-report.md` and `.leanprompt/findings.json`; asks before editing code, installing a package or running billed requests.
- `prefill-cache`: rules LP-PC-01 to LP-PC-12 for prompts a provider's prefix cache can reuse.
- `generation-economy`: rules LP-GE-01 to LP-GE-10 for calls and output that are not wasted.
- `prompt-diet`: rules LP-PD-01 to LP-PD-06 for dead weight in what each call sends; every trim carries an answer check.
- `measure-loop`: the usage logger, the stable-head CI test (vitest and pytest templates on kvsig ids), replay before and after, and the score.
- `lmwarden`: rules LP-LW-01 to LP-LW-03 for self-hosted engines, and reading engine facts from LM Warden. Prompt Lens is described as planned.
- Dated provider tables (Anthropic, OpenAI, Gemini, OpenRouter, DeepInfra, vLLM, SGLang) and per-model notes (Qwen, OpenAI reasoning, Anthropic thinking), each with a `checked:` date and a source.
- The evidence table, `docs/evidence.md` (rows E1 to E12, with sources and limits).

### CLI (`npx leanprompt`)

- `install` (also `init`): installs the skills for Claude Code, Codex, OpenCode, Cursor and any `AGENTS.md` reader, detected or chosen with `--providers`, for this project or all your projects (`--scope`), after showing the files and asking. Idempotent; leaves user text outside its marked block untouched and never overwrites files it did not generate. `update` refreshes an earlier install.
- `score`: writes `.leanprompt/score.json`, measured from the usage log (at least 50 measured calls) or static from the audit's findings; the file is also the shields.io endpoint badge source. `--github` adds GitHub Actions annotations.
- `calibrate`: fits the static score's weights to an app from a trial run.
- `report --html`: a local page for the person who reads the audit: the findings in plain English, what they cost, a hand-off block for their coding agent, the score, and the badge when it can work. `report --md` writes `leanprompt-report.md` from the same findings.
- `profile detect --lmwarden <url>`: reads engine cache facts from LM Warden into `leanprompt.yaml`.
- `eval-audit`: scores an audit's findings against the seeded example cases.
- The target profile, `leanprompt.yaml` (target, engine, priority, ignore list).
- Usage loggers for TypeScript (`leanprompt/log`) and Python (PyPI `leanprompt-cli`); they write ids, counts and flags, never prompt or completion text.

### Evaluation

- Six example apps, each in a `before/` and an `after/` form with an answer check.
- A replay harness (`npm run eval`) with a local cache simulator for CI and a spend cap for real providers. Simulator results are never quoted.
- An audit recall and false-positive harness over seeded fixtures in Python, Go and TypeScript.

### Project

- Per-assistant forms generated from one source and checked in CI; a Claude Code plugin marketplace in `.claude-plugin/` that installs the small `plugin/` folder, and a Cursor manifest in `.cursor-plugin/`.
- `npm run check:numbers`: every number with a unit in the README, the public docs and the skills cites an evidence row or a measured result.
- Apache-2.0 for code, CC BY 4.0 for the skills and docs; README, CONTRIBUTING, GOVERNANCE and SECURITY (the last three under `.github/`).

## Unreleased

### Fixed

- `report`: on Windows the project name fell back to the folder name instead of the git remote's repository, because Windows short paths (`RUNNER~1`) did not match the path git prints.
- Site: an audit page's findings.json link used the lower-cased page key, so for a folder with capitals (`Mintplex-Labs__anything-llm`) it pointed at a path GitHub does not have.
- Site: the demonstration audit named a commit that is not in the public repository, so its code links did not open; it names v0.1.0-dev.13 (`67e1586`), where the audited example is the same.

## 0.1.0-dev.13 – 2026-11-26

Fixes for what real users hit, from feedback from four real audits, including one run independently by an app's own team.

### Score change

- The static score is now the app's own score. Findings whose fix is a setting of the server or engine the app calls (`"fix_by": "server"`; by default an `LP-LW-*` finding recorded in `<external>`) are left out of it. The formula is unchanged; it runs over the app's findings only. A findings file with such findings can score higher than it did in 0.1.0-dev.12; one without them scores the same. `score.json` keeps the old figure under `server.with_server_score`, and `score --static --with-server` makes it the headline again (its message says `with server`). Details in [score.md](score.md#the-apps-score-and-the-servers-questions).
- A finding that saves both prefill and output can give each side its own share (`share_prefill`, `share_output`); `share` alone still applies to both sides, so existing files score the same.

### Added

- Questions for the server's administrator: the page and the Markdown report list server findings in their own section, after the app's, each with what would answer it and, for an LM Warden server, `leanprompt profile detect --lmwarden <url>`. The hand-off block lists them apart, with a note not to change the app for them.
- Notes: a top-level `notes` array in `findings.json` for verified problems the rules have no place for, such as a spend meter that ignores cache tokens or a cut-off answer accepted as complete (`title`, `file`, `line`, `problem`, `change`, and optionally `why` and `verify`). Validated, never scored; shown after the findings on the page and in the Markdown report, and included in the hand-off block. The audit skill says when to record one.
- Two kinds of unknown: `status: "frequency-unknown"` for a finding the code shows for certain whose rate is assumed (listed with the findings, marked "how often is assumed"), next to `needs-facts` for behaviour that is not confirmed (an open question).
- `planned` on a finding: the issue or plan it already belongs to, shown as "Already planned".
- `tokens_per_1k.cache_write`: for a fix that adds cache marks, the tokens it would newly write to the cache; the money estimate subtracts the write premium, so the saving it shows is net.
- `report --md` writes `leanprompt-report.md` from `findings.json` and `score.json` inside a generated block, and keeps the inventory and the next steps written below it on later runs; it refuses to overwrite a report it did not write. It ends with "Questions for the owner" for the priority, volume and prices nobody answered. `report --project <name>` names the project.
- `install` also installs the provider, model and runtime fact tables, the evidence table and the profile reference under `leanprompt/facts/`, and the rules link to them there, so an audit works offline. `docs/evidence.md` is in the npm package.
- The audit skill reads the project's own rules and plans first (`CLAUDE.md`, `AGENTS.md`, decision records, issue references), never proposes a fix the project has ruled out (it offers an alternative, such as repairing a malformed JSON reply locally before asking again), and links planned work instead of presenting it as new. It has an unattended mode that asks nothing and records the open questions. `presenting.md` has a section on auditing someone else's repository: install outside it, keep the audit's files out of its history, read its policy before reporting upstream.

### Changed

- LP-GE-05: a truncation can arrive as an SDK exception (`LengthFinishReasonError` and `ContentFilterFinishReasonError` from the OpenAI Python SDK's `parse()`), so exclusion-list retry filters around it are checked; for a model whose reasoning cannot be turned off the fix is a larger limit on the second attempt, not removing the retry; one retry of an empty answer after a normal stop is not a finding.
- LP-PC-01: medium severity for partial marking (the head marked, the messages of a loop not); a warning that adding marks moves tokens into cache fields a spend meter may not read, with Anthropic's total-input formula in the provider table.
- LP-GE-04: a serverless function's time limit around a whole agent turn (Vercel's `maxDuration`), with the setting in the runtimes table.
- LP-PC-09: a chat template that writes the effort into the system message; `models/qwen.md` records where the Qwen3.8-27B template writes it, read from the model's template. Template placement on a server the app does not control is a question for its administrator.
- LP-LW-01, LP-LW-02 and LP-LW-03 say their findings are for the server's administrator and how to phrase uncertain ones as questions.
- Every rule that lists `vllm` in `applies_to` also lists `lm-warden`.
- `tokens_per_1k: {}` is accepted and means no estimate; `share: 0` is documented.
- Installed skills call the CLI they came with (`npx leanprompt@<version> ...`), and the page's hand-off block names the page's version.
- Dates in `score.json` and on the page are the local date of the machine that ran the command, not the UTC date, and the page says so.
- The page's cost table is in token order: the app's findings, then its open questions, then the server's. The page's link to the profile reference is pinned to the release, like the rule links.
- The page and the report are titled with the project's name from `package.json` or `pyproject.toml`, else the git remote's repository name, else the folder.
- The report template says the headline count leaves out open questions, server questions and notes.

## 0.1.0-dev.12 – 2026-11-26

Passes the plugin directory's checks.

### Fixed

- `profile detect --lmwarden`: a 403 shows LM Warden's own reason (for example a key without the engine facts permission); a 404 says the warden is older than v2026.11.26.1; a loaded model whose engine has not reported yet gets "run this again after it has served a request", and nothing is guessed.

### Changed

- `plugin/`: the two test templates of `measure-loop` ship as Markdown with the code in one fenced block (`templates/*.template.ts.md`, `templates/stable_head_template.py.md`), because the directory accepts only Markdown, text, JSON, YAML and images from organizations that are not Verified. The npm package, `forms/` and `npx leanprompt install` keep the plain `.ts` and `.py` files.
- `plugin/`: `LICENSE-DOCS` and `NOTICE` are `LICENSE-DOCS.md` and `NOTICE.md` there, because the directory refuses extensionless files it does not recognise as a licence.
- plugin/: install commands point to the packages' pages; examples no longer read keys from the environment.
- The plugin README and `docs/registries.md` give the two-step plugin install (`/plugin marketplace add`, then `/plugin install leanprompt@leanprompt`), and the runbook says to submit the `plugin` folder URL so the portal does not validate the whole repository.

## 0.1.0-dev.11 – 2026-11-26

Ready for the plugin directories.

### Added

- **A small plugin folder, `plugin/`**, for Anthropic's plugin directory: `.claude-plugin/plugin.json`, an icon, a README that says what the plugin runs, sends and fetches, the licences (LICENSE, LICENSE-DOCS, NOTICE) and the seven skills, copied from the shared skills form. `npm run build:forms` writes it and `--check` fails when it is stale; it has 51 files and none over 256 KiB. This repository's marketplace now installs that folder (`"source": "./plugin"`), so `/plugin install leanprompt@leanprompt` gets the same files as the directory listing. `claude plugin validate --strict` passes on the repository root and on `plugin/`.
- **An icon**: a lean gauge with its needle low, in the report page's graphite, indigo and white. The source is `docs/assets/icon.svg`; `docs/assets/icon.png` (1024 px) is copied to `plugin/.claude-plugin/icon.png`.
- **A Cursor manifest**, `.cursor-plugin/plugin.json`, generated with the others; its `skills` field points Cursor at `plugin/skills/`, and its `logo` at the icon.

### Changed

- `docs/registries.md` is now a short runbook per registry for the owner: the page to open, the account, and what to paste.
- The npm package is unchanged: `plugin/`, `.claude-plugin/` and `.cursor-plugin/` are not in it.

## 0.1.0-dev.10 – 2026-11-26

kvsig in the audit and the fixes.

### Added

- **The audit recognises kvsig.** When the app imports kvsig or depends on it (`@kvsig/core` on npm, `kvsig` on PyPI), `llm-call-audit` notes per call site which prompt parts carry ids and uses the app's own tests or logs of those ids to check stability exactly, instead of estimating it from the code (`SKILL.md`, "When the app already uses kvsig"; `call-shapes.md`, "kvsig in the app"). `.leanprompt/findings.json` takes an optional top-level `kvsig: {"used": true, "where": ["src/llm/hosted.ts:12"]}`, which `score` validates, and the report page says in one line in the score section that the stability checks use the app's ids. The score does not read the field: a findings file scores the same with it or without it.
- **The fixes suggest kvsig.** The "Fix" of LP-PC-01, LP-PC-02, LP-PC-03, LP-PC-04, LP-PC-05, LP-PC-07, LP-PC-08, LP-LW-01, LP-PD-01 and LP-PD-02 ends with one optional way to keep the fix checkable: a test in the app that asserts a kvsig id stays equal. `measure-loop` ("The stable-head test") has the short TypeScript and Python example next to the helper templates.

## 0.1.0-dev.9 – 2026-11-26

### Changed

- Install from npm and PyPI: `npx leanprompt install` and `npx leanprompt score` work as written, `npm i leanprompt` adds the TypeScript usage logger and `pip install --pre leanprompt-cli` the Python one (`--pre` because it is a pre-release). The README, `docs/install.md`, the skills, `scripts/install.sh` and the hand-off block in the report page no longer go through GitHub; `docs/install.md` keeps one line for running the latest code from GitHub.

## 0.1.0-dev.8 – 2026-11-26

One-line install and a `/leanprompt` command.

- **`npx leanprompt install`.** Detects the coding assistants in use, asks in a terminal whether to install for this project or for all your projects, lists every file it will write and asks before writing, then prints what to type next in each assistant (`/leanprompt audit`, or `$leanprompt audit` in Codex). For scripts and CI: `--providers=claude,codex,cursor,opencode,agents-md`, `--scope=project|global` and `--yes`; without a terminal and without `--yes` it prints the plan and exits 1 without writing. `--dry-run` still lists and writes nothing. `init` is the same command under its older name, and `--assistant` and `--global` still work. The ownership stamp, the symlink containment and "never overwrite a file it did not write" are unchanged. `scripts/install.sh` runs `install` and hands it the terminal.
- **Global locations, from each assistant's documentation.** Claude Code `~/.claude/skills`, Codex `~/.agents/skills` (plus `~/.codex/AGENTS.md`), Cursor `~/.cursor/skills`, OpenCode `~/.config/opencode/commands` and `~/.config/opencode/AGENTS.md`. The `AGENTS.md` convention has no user-level location, so it installs per project only and the installer says so.
- **Cursor reads skills now.** Cursor installs get the skills in `.cursor/skills/` (or none, when `.claude/skills` or `.agents/skills` already has them, since Cursor reads those too) instead of one `.mdc` rule per skill, so `/leanprompt` works there. `update` reports old `leanprompt-*.mdc` rule files and leaves them alone.
- **`npx leanprompt update`.** Refreshes what an earlier install wrote, in the project and in the home folder, by the stamp; adds files new in this version; reports what changed; never touches an unstamped file. `--scope` and `--dry-run`.
- **One entry skill, `leanprompt`.** `/leanprompt` alone lists the commands, one line each, and suggests the next one; `init`, `audit`, `fix`, `measure`, `score`, `report` and `lesson` route to the six skills, which stay the reference. `init` asks only what the code cannot tell (targets, priority, monthly volume, prices with a source and a date) and writes `leanprompt.yaml` on a yes; `fix` follows the hand-off rules (check each finding first, one at a time, a diff, a yes). In the Claude Code plugin the skill is `/leanprompt:leanprompt`, and bare `/leanprompt` resolves to it when no other command has that name. OpenCode gets a `/leanprompt` command file.
- **`npx leanprompt score --github`.** Prints a GitHub Actions `::warning` annotation for each open finding in `.leanprompt/findings.json`, with its file and line, and a summary line. Exits 0 on findings; 1 when a file is invalid; `--fail-under N` exits 3 when the score is below N. Workflow snippet: `docs/ci.md`.
- **README.** A first screen with the one-line install, a "Without / With" pair of report pages from the `dated-chat` example, and a grouped command table; detail moved to `docs/install.md`, `docs/ci.md` and `docs/registries.md` (a checklist of registries for the owner to submit to).

## 0.1.0-dev.7 – 2026-11-26

Get more from every LLM call your app makes: a new skill for dead weight in the prompt, a new headline, and finding titles on the report page.

- **New skill, `prompt-diet`.** Six rules for what a call need not send: LP-PD-01 offer each route only the tools it can use (a fixed list per route; on OpenAI, `allowed_tools` to narrow the choice without changing the list); LP-PD-02 say each instruction once; LP-PD-03 do not resend the same boilerplate on every turn; LP-PD-04 trim tool results and retrieved context at the tool boundary; LP-PD-05 drop stale history on purpose, not by stripping (compaction itself stays in LP-PC-08); LP-PD-06 compact serialisation for data in the prompt. Every rule ships its trim with an answer check through `measure-loop`, weighs the cache before touching the shared head of the prompt, and cites the standing reason not to strip blindly: stripping reasoning from history produced about 3x more generation (E11).
- **Prompt size facts.** The Anthropic, OpenAI and Gemini tables gain a dated "Prompt size facts" section, each fact with its source: tool and function definitions are billed as input tokens, OpenAI's `allowed_tools` keeps the tool list stable for caching, Anthropic's rules for thinking blocks in tool-use turns, and Anthropic's tool result clearing (beta) and how it invalidates the cache.
- **The audit** checks the `LP-PD-*` rules (rule map, estimates under `tokens_per_1k.prompt`, a trim question in `presenting.md`), and `findings.json`, `score`, `report --html` and `lesson` accept the new ids. `init`, the Claude Code plugin, the Cursor and OpenCode forms, the `AGENTS.md` block and `--help` list the new skill.
- **Headline.** "Get more from every LLM call your app makes." Effective, efficient and affordable: your coding assistant makes prompts cacheable, cuts dead weight, stops wasted output and speeds up first tokens, without changing the answers. Used in the README, the package and plugin descriptions, the Python package and the docs index.
- **By the LM Warden Team.** Attribution, copyright and the package authors now read the LM Warden Team; the GitHub address is unchanged. A test checks that no public file uses the old name.
- **`report --html`.** Each row of the meter shows the finding's short title (the first sentence of its problem, cut at a word) next to its file and line; it wraps at phone width and is read out with the row. The headline sentence no longer capitalises the first word after its colon, unless that word is an acronym, code or a name.

## 0.1.0-dev.6 – 2026-11-26

The audit's HTML page is now written for the person who reads it, not for the tool.

- **Findings explain themselves.** `.leanprompt/findings.json` takes optional plain-text fields per finding: `problem`, `change`, `why`, `estimate`, `assumptions` and `verify` (each at most 600 characters), plus `tokens_per_1k` (the tokens a finding loses per 1,000 calls, split into `prompt`, `uncached` and `output`, with `measured_calls` when measured), `model`, and a top-level `average_call`. Older files stay valid. The `llm-call-audit` skill writes them for every finding; `presenting.md` and `report-template.md` say how.
- **`report --html`, top to bottom:** a plain-English headline (how many places the app pays for tokens it doesn't need, the biggest first, the total labelled as an estimate from the code or as measured), what the findings cost, one card per finding (problem, change, why, estimate, assumptions, how to check the fix, file:line, and a link to the rule), open questions with what to confirm, a "Fix it with your coding agent" block to paste into Claude Code, Codex, Cursor or any coding assistant (self-contained instructions and the findings list) with a Copy button, then the score card with one line on what it means. The page stays self-contained: one small inline script for the Copy buttons, and the text is selectable without it.
- **What this costs you.** `leanprompt.yaml` takes an optional `volume: {calls_per_month}` (per `targets` entry when there are several), `prices:` per model (input, cached input, cache write, output per million tokens, each price with a `source` and a `checked` date), and `engine.prefill_tokens_per_second` for self-hosted engines. With them the page shows what the findings cost a month, what fixing them saves and, with an average call, the share of the bill; self-hosted, GPU prefill hours a month and the first-token time a finding adds. Every input is shown next to the result. Without them the page shows tokens per 1,000 calls and what to add; it never invents a volume or a price. Money is not part of the score.
- **If this helped.** Only after the page has shown an estimate or a measured score: a star link, a short, plain message to send a colleague, and the README badge with its raw URL filled in from `git remote get-url origin` and the current branch (local git calls only) for GitHub, GitLab.com and Bitbucket remotes. For other hosts or no remote the page says the badge needs a public repository and shows no snippet; when `score.json` is not committed it says to commit it first.
- Findings on the page and in the report are ranked by their token numbers when they have them, largest first.

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
