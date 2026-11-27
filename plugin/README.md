# leanprompt

**Get more from every LLM call your app makes.**

leanprompt is a set of skills for your coding assistant, by the LM Warden Team. They help the assistant
find the places where the app you are building pays for the same tokens twice, and fix them without
changing the answers: prompts the provider's cache can reuse, no dead weight in what each call sends,
no wasted output, faster first tokens. Every fix says how to prove it with a before and after number.

## Install

In Claude Code, inside a session:

```
/plugin marketplace add Podwarden/leanprompt
/plugin install leanprompt@leanprompt
```

## Use

Type `/leanprompt` to list the commands, then start with `/leanprompt init` and `/leanprompt audit`.
If another command already has that name, the full name is `/leanprompt:leanprompt`.

| Skill | What it is for |
|---|---|
| `leanprompt` | the entry point: `/leanprompt` lists the commands (init, audit, fix, measure, score, report, lesson) |
| `llm-call-audit` | audit an app's LLM calls, rank the waste, write the report and findings |
| `prefill-cache` | rules for prompts the provider's cache can reuse (LP-PC-*) |
| `generation-economy` | rules for calls and output that are not wasted (LP-GE-*) |
| `prompt-diet` | rules that cut dead weight from what each call sends (LP-PD-*) |
| `measure-loop` | prove a fix with a before and after number; the score (CI test, logger) |
| `lmwarden` | rules for self-hosted vLLM, SGLang and LM Warden servers (LP-LW-*) |

## What it runs, sends and fetches

- The plugin is instructions only: Markdown skills, two of them small test templates as code blocks. It has no hooks, no MCP
  servers and no executables, and it runs no code on its own.
- Nothing is sent anywhere. The skills ask before editing code, installing a package, or running anything
  that sends billed requests to a model provider.
- The command line tool is optional. Some commands (`score`, `report`, `calibrate`, `lesson`) run it as
  `leanprompt <command>`. It is the `leanprompt` npm package (https://www.npmjs.com/package/leanprompt);
  the skills ask you to install it, or to run it through your package runner, and never install it
  themselves. It runs on your machine, where it reads and writes files in your project and makes no
  network calls. Only `profile detect
  --lmwarden <url>` reads from a server: the LM Warden server you name, for its engine facts.
- The provider, model and runtime fact tables, the evidence table and the profile reference are included
  under `skills/leanprompt/facts/`, so an audit needs no network. Other links open pages on GitHub; the
  skills do not fetch them on their own.

## More

Source, documentation and other assistants (Codex, Cursor, OpenCode): https://github.com/Podwarden/leanprompt. This folder is generated
from that repository for version 0.1.0-dev.13.

## Licence

The skills and this README are licensed under CC BY 4.0 (LICENSE-DOCS.md); code is licensed under
Apache-2.0 (LICENSE). See NOTICE.md.
