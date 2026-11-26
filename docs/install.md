# Install and update leanprompt

Back to the [README](../README.md).

leanprompt is pre-release, published on npm as `leanprompt` and on PyPI as `leanprompt-cli`. It needs Node 20.19 or newer.

## Install

From your project root:

```
npx leanprompt install
```

To pin a release, add its version: `npx leanprompt@0.1.0-dev.9 install`. To run the latest code from GitHub instead: `npx github:Podwarden/leanprompt install`.

In a terminal, `install`:

1. finds the coding assistants the project uses, from `.claude/`, `AGENTS.md`, `.codex/`, `.opencode/` and `.cursor/` (for all your projects, from `~/.claude`, `~/.codex`, `~/.config/opencode` and `~/.cursor`);
2. asks: install for this project or for all your projects?
3. lists every file it will write, update or skip, and asks before writing;
4. ends with what to type next in each assistant, for example `Next: open Claude Code here and type /leanprompt audit`.

Reload your assistant afterwards so it sees the new skills. Then type `/leanprompt init` (`$leanprompt init` in Codex) to set up `leanprompt.yaml`, or `/leanprompt audit` to go straight to the audit.

What it never does: overwrite a file it did not write (every file it writes carries a `leanprompt:generated` stamp, and in `AGENTS.md` it only touches the text between its own markers), write through a symlinked folder that leads outside the project, or make a network call. A second run changes nothing.

## Project or global

| Assistant | This project | All your projects (`--scope=global`) | Type next |
|---|---|---|---|
| Claude Code | `.claude/skills/<name>/` | `~/.claude/skills/<name>/` | `/leanprompt audit` |
| Codex | `.agents/skills/<name>/` and a block in `AGENTS.md` | `~/.agents/skills/<name>/` and a block in `~/.codex/AGENTS.md` | `$leanprompt audit`, or pick it from `/skills` |
| Cursor | `.cursor/skills/<name>/` | `~/.cursor/skills/<name>/` | `/leanprompt audit` in the Agent chat |
| OpenCode | `.opencode/commands/leanprompt.md` (and `leanprompt-audit.md`) and a block in `AGENTS.md` | `~/.config/opencode/commands/` and `~/.config/opencode/AGENTS.md` | `/leanprompt audit` |
| Any `AGENTS.md` agent | `.agents/skills/<name>/` and a block in `AGENTS.md` | none: the convention has no user-level location, so the installer says so and skips it | ask it to use the leanprompt skill |

Every location comes from the assistant's own documentation, checked on 2026-11-26; the sources are in [assistant-paths.md](assistant-paths.md). Cursor and OpenCode also read `.claude/skills` and `.agents/skills` (and the same folders in your home), so when one of those already holds the skills, they get no second copy. When Claude Code and an `AGENTS.md` are both found, the skills go in `.claude/skills` once and the `AGENTS.md` block points at them.

## For scripts and CI

```
npx leanprompt install --providers=claude,cursor --scope=project --yes
```

- `--providers=<list>`: install for these instead of detecting; any of `claude`, `codex`, `opencode`, `cursor`, `agents-md`.
- `--scope=project|global`: this project, or all your projects. Without it, a terminal run asks and any other run uses `project`.
- `--yes`: write without asking. Without a terminal and without `--yes`, `install` prints the plan and exits 1 without writing anything.
- `--dry-run`: list what would be written or skipped, write nothing, exit 0.
- `--dir <project>`: another project folder.

`init` is the same command under its older name, so older links keep working. `--assistant <name>` (one assistant) and `--global` still work too.

## Update

```
npx leanprompt update
```

`update` looks in this project and in your home folder for what an earlier install wrote, refreshes those files to this version, adds files that are new in it, and lists what changed. It never touches a file without leanprompt's stamp. `--scope=project` or `--scope=global` limits where it looks, and `--dry-run` lists without writing. Reload your assistant afterwards.

Installs from before 0.1.0-dev.8 gave Cursor one rule file per skill (`.cursor/rules/leanprompt-*.mdc`). Cursor now reads the skills, so `update` lists those files and leaves them alone; delete them when you like.

## The Claude Code plugin

Instead of the CLI, Claude Code can install the skills as a plugin, inside a session:

```
/plugin marketplace add Podwarden/leanprompt
/plugin install leanprompt@leanprompt
```

Plugin skills carry the plugin's name, so the command is `/leanprompt:leanprompt`; bare `/leanprompt` runs it too unless another command already uses that name ([code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)). The plugin installs the skills only; the score, the report page and the other terminal commands still run through `npx`.

## The usage loggers

The measure loop logs every call with a small logger inside the app. Your assistant proposes the command and asks before it runs.

- TypeScript or JavaScript, which gives `import { createLogger } from "leanprompt/log"` with its types:
  ```
  npm i leanprompt
  ```
  It needs Node 20.19 or newer.
- Python, which gives `from leanprompt_cli import Logger`:
  ```
  pip install --pre leanprompt-cli
  ```
  `--pre` is needed because `leanprompt-cli` is a pre-release; `pip install leanprompt-cli==0.1.0.dev9` works too, and `uv pip install` takes the same arguments.

Use of the loggers: [measure-loop](../skills/measure-loop/SKILL.md#log-every-call).

## Or clone and build

If you would rather build the CLI yourself, or want the latest code, build it once from a clone:

```
git clone https://github.com/Podwarden/leanprompt
cd leanprompt
npm ci && npm run build && npm link
```

`npm link` puts a `leanprompt` command on your `PATH` that runs from the clone; `git pull && npm run build` updates it, and `npm unlink -g leanprompt` removes it. Without `npm link`, run it directly: `node /path/to/leanprompt/cli/dist/main.js install --dir /path/to/your-app`.

## Windows

`npx leanprompt install` works the same in PowerShell or `cmd`, and so do the clone-and-build steps (CI builds and tests leanprompt on Windows). The `curl | sh` line below is for macOS and Linux only.

## Without typing npx (macOS and Linux)

[scripts/install.sh](../scripts/install.sh) runs the same `install` through `npx leanprompt@<version>` (the release's version, or the latest published version when none is set), so it still needs Node. In a terminal it hands the installer the terminal, so the questions still work when piped. Arguments pass through:

```
curl -fsSL https://raw.githubusercontent.com/Podwarden/leanprompt/main/scripts/install.sh | sh -s -- --providers=cursor
```

To pin a release, set the version for `sh`:

```
curl -fsSL https://raw.githubusercontent.com/Podwarden/leanprompt/main/scripts/install.sh | LEANPROMPT_VERSION=0.1.0-dev.9 sh -s -- --providers=cursor
```
