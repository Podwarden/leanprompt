# Install leanprompt for each assistant

leanprompt is pre-release. Today you install it from GitHub: the Claude Code plugin, or the CLI run straight from this repo with `npx`. The npm package and the PyPI logger come with the first release; until then the `leanprompt` package on npm is a placeholder with no CLI in it. Back to the [README](../README.md).

## Run the CLI (today)

The CLI installs the skills for every assistant and computes the score. It needs Node 20.19 or newer. `npx` fetches it from GitHub and builds it on first use:

```
npx github:Podwarden/leanprompt init
```

Until the npm release, run every `npx leanprompt <cmd>` in these docs and the skills as `npx github:Podwarden/leanprompt <cmd>`. To pin a release, add its tag: `npx github:Podwarden/leanprompt#v0.1.0-dev.1 init`.

### Or clone and build

If you would rather not have `npx` fetch from GitHub on each run, build the CLI once from a clone:

```
git clone https://github.com/Podwarden/leanprompt
cd leanprompt
npm ci && npm run build && npm link
```

`npm link` puts a `leanprompt` command on your `PATH` that runs from the clone; `git pull && npm run build` updates it, and `npm unlink -g leanprompt` removes it. If `npm link` needs write access you do not have, run the CLI directly from the clone instead: `node /path/to/leanprompt/cli/dist/main.js init --dir /path/to/your-app`.

In the sections below, `leanprompt <cmd>` means whichever of these you use: `npx github:Podwarden/leanprompt <cmd>`, the linked `leanprompt` command, or, after the npm release, `npx leanprompt <cmd>`.

## What `init` does

`leanprompt init` detects the assistants a project uses from `.claude/`, `AGENTS.md`, `.codex/`, `.opencode/` and `.cursor/`, and writes the matching files. `--assistant claude|codex|opencode|cursor|agents-md` forces one, `--global` installs into your home directory where the assistant supports it, and `--dir <project>` points it at another folder. A second run is a no-op, and text of yours outside leanprompt's marked block in `AGENTS.md` is left byte for byte as it was. The paths below were checked against each vendor's documentation on 2026-11-26 ([assistant-paths.md](assistant-paths.md)).

## Claude Code

Install the plugin from this repo's marketplace, inside a session. This works today, with no clone:

```
/plugin marketplace add Podwarden/leanprompt
/plugin install leanprompt@leanprompt
```

The plugin installs the skills only. For `leanprompt score` and the other commands, run the CLI as above.

Or let the CLI copy the skills into `.claude/skills/<name>/` (or `~/.claude/skills/` with `--global`):

```
leanprompt init --assistant claude
```

## Codex

Skills go to `.agents/skills/<name>/`, plus a short leanprompt block in `AGENTS.md` (with `--global`: `~/.agents/skills/` and `~/.codex/AGENTS.md`):

```
leanprompt init --assistant codex
```

## OpenCode

An `audit` command in `.opencode/commands/` and the block in `AGENTS.md`. OpenCode reads skills from `.claude/skills` and `.agents/skills`, so init adds the skills to `.agents/skills/` only when neither folder is there:

```
leanprompt init --assistant opencode
```

## Cursor

One project rule per skill, `.cursor/rules/leanprompt-<skill>.mdc`; the agent decides when each applies. The installed rules link to the full rule text on GitHub, so opening a rule needs the network. Cursor's user rules have no file path, so there is no `--global`:

```
leanprompt init --assistant cursor
```

## Any agent that reads `AGENTS.md`

Skills in `.agents/skills/<name>/` and the block in `AGENTS.md`. This is also what init does when it detects no assistant:

```
leanprompt init --assistant agents-md
```

## Windows

`npx github:Podwarden/leanprompt init` works the same in PowerShell or `cmd`, and so do the clone-and-build steps (CI builds and tests leanprompt on Windows). The `curl | sh` line below is for macOS and Linux only.

## Without typing npx (macOS and Linux)

[scripts/install.sh](../scripts/install.sh) runs the same `init` through `npx github:Podwarden/leanprompt#v<version>` (the tag of the release, or the latest commit when no version is set), so it still needs Node. Arguments pass through:

```
curl -fsSL https://raw.githubusercontent.com/Podwarden/leanprompt/main/scripts/install.sh | sh -s -- --assistant cursor
```

To pin a release, set the version for `sh`:

```
curl -fsSL https://raw.githubusercontent.com/Podwarden/leanprompt/main/scripts/install.sh | LEANPROMPT_VERSION=0.1.0-dev.1 sh -s -- --assistant cursor
```
