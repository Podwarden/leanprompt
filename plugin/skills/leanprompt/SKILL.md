---
name: leanprompt
description: Use when the user types /leanprompt or $leanprompt, alone or with a command (init, audit, fix, measure, score, report, lesson), or asks what leanprompt can do for an app's LLM calls. The entry point to the leanprompt skills; it lists the commands and routes each one to the skill or CLI command that does the work.
argument-hint: "[init | audit | fix | measure | score | report | lesson] [target]"
license: CC-BY-4.0
---

# leanprompt

One command for the leanprompt skills. Each subcommand routes to the skill that does the work; this file holds no rules of its own, so read the file the table points at and follow it.

The command line tool is the `leanprompt` npm package. If `leanprompt` is not available, ask the user to install it following https://www.npmjs.com/package/leanprompt, or to run it through their package runner; never install anything without asking.

## Commands

| Command | What it does | Read |
|---|---|---|
| `init` | Reads the code, asks only what it cannot infer (targets, priority, monthly volume, prices with source and date), and writes `leanprompt.yaml` on a yes | [init.md](init.md) |
| `audit [path] [--unattended]` | Finds every LLM call, checks it against the rules, ranks the findings, writes `.leanprompt/findings.json` and `leanprompt-report.md`; `--unattended` asks nothing and records the open questions | [llm-call-audit](../llm-call-audit/SKILL.md) |
| `fix [rule or file]` | Works through the open findings one at a time: checks each against the code first, shows the diff, applies it only on a yes | [fix.md](fix.md) |
| `measure` | Proves a fix with a before and after on the same scenario; sets up the usage logger and the stable-head test | [measure-loop](../measure-loop/SKILL.md) |
| `score` | Runs `leanprompt score` and explains the number and its kind (measured or static) | [llm-call-audit](../llm-call-audit/SKILL.md#the-score) |
| `report` | Runs `leanprompt report --html` (and `--md` for `leanprompt-report.md`) and gives the path of the page to read and share | [presenting.md](../llm-call-audit/presenting.md#the-page-the-hand-off-and-sharing) |
| `lesson` | Drafts a lesson-learned issue on this machine with `leanprompt lesson`; sends nothing | [llm-call-audit](../llm-call-audit/SKILL.md#sharing-a-lesson) |

The rules themselves live in [prefill-cache](../prefill-cache/SKILL.md), [generation-economy](../generation-economy/SKILL.md), [prompt-diet](../prompt-diet/SKILL.md) and [lmwarden](../lmwarden/SKILL.md). Load a rule file only when a command points at it.

## Routing

- **No command.** Show this menu, one line per command, and nothing else:

  ```
  leanprompt: get more from every LLM call your app makes
    init      set up leanprompt.yaml: targets, priority, volume, prices
    audit     find where the app's LLM calls lose tokens and time
    fix       work through the findings, one diff at a time, with your yes
    measure   prove a fix with a before and after number
    score     the score, measured from usage or static from the findings
    report    a local page with the findings in plain English
    lesson    draft a lesson-learned issue; nothing is sent
  ```

  Then suggest one next command, with a one-line reason, from what is in the project: no `leanprompt.yaml` means `init`; no `.leanprompt/findings.json` means `audit`; open findings (not `fixed`) mean `fix`; a fixed finding with no before and after means `measure`. Never run a command the user did not ask for.
- **A command.** Read the file in its row and follow it. Text after the command is its target (a folder, a file, a rule id such as `LP-PC-03`).
- **A question or a plain request.** "Why does this app pay for the same prompt twice" is `audit`; "is this fix working" is `measure`. If two commands fit, ask once which one.

## Running the CLI

The commands above call the leanprompt CLI as `leanprompt <command>`. In the installed skills the command names the version they came with (`leanprompt@<version> <command>`), so the skills and the CLI stay in step. `score`, `report --html` and `calibrate` only read and write files under `.leanprompt/` (and `report --md` writes `leanprompt-report.md`) and make no network calls. Ask before editing code, installing a package, or running anything that sends requests to a provider, which are billed.
<!-- leanprompt:generated v0.1.0-dev.15: written by leanprompt install; leanprompt update replaces local edits -->
