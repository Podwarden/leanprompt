---
checked: 2026-11-26
paths:
  claude:
    skills: .claude/skills/<name>/SKILL.md
    skills_global: ~/.claude/skills/<name>/SKILL.md
    plugin_marketplace: .claude-plugin/marketplace.json
    plugin_manifest: .claude-plugin/plugin.json
    plugin_skills: skills/<name>/SKILL.md
  codex:
    skills: .agents/skills/<name>/SKILL.md
    skills_global: ~/.agents/skills/<name>/SKILL.md
    agents_md: AGENTS.md
    agents_md_global: ~/.codex/AGENTS.md
  opencode:
    skills: .opencode/skills/<name>/SKILL.md
    skills_global: ~/.config/opencode/skills/<name>/SKILL.md
    commands: .opencode/commands/<name>.md
    commands_legacy: .opencode/command/<name>.md
    commands_global: ~/.config/opencode/commands/<name>.md
    agents_md: AGENTS.md
    agents_md_global: ~/.config/opencode/AGENTS.md
  cursor:
    rules: .cursor/rules/<name>.mdc
    agents_md: AGENTS.md
schema:
  claude_skill_frontmatter:
    required: []
    recommended: [description]
  claude_marketplace_json:
    path: .claude-plugin/marketplace.json
    required: [name, owner, plugins]
    owner_required: [name]
    plugin_entry_required: [name, source]
  claude_plugin_json:
    path: .claude-plugin/plugin.json
    required: [name]
    optional_file: true
  codex_skill_frontmatter:
    required: [name, description]
  cursor_mdc_frontmatter:
    fields: [description, globs, alwaysApply]
    agent_requested: "alwaysApply: false, description set, no globs"
---

# Where each assistant reads skills, commands and rules

Install locations for five assistants, read from each vendor's own
documentation on 2026-11-26. These paths change often. Every row carries its
own source; where a page says nothing, the row says so rather than guessing.
Paths are relative to the project root unless they start with `~`.

## Claude Code

| Item | Path or format | Source |
|---|---|---|
| Project skills | `.claude/skills/<name>/SKILL.md`; also `<subdir>/.claude/skills/<name>/SKILL.md` | https://code.claude.com/docs/en/skills |
| User skills | `~/.claude/skills/<name>/SKILL.md` (all projects on the machine) | https://code.claude.com/docs/en/skills |
| Skill frontmatter | All fields optional; only `description` is recommended. Frontmatter must start on the file's first line. `name` defaults to the folder name. Unknown fields are ignored without an error | https://code.claude.com/docs/en/skills |
| Plugin skills | `<plugin>/skills/<name>/SKILL.md`; a `skills` key in `plugin.json` adds directories to the default `skills/` scan | https://code.claude.com/docs/en/plugins-reference |
| Plugin manifest | `.claude-plugin/plugin.json`; optional file; `name` is the only required key (kebab-case; names starting `claude-` or `anthropic-` are rejected by validation); all other plugin files go at the plugin root, not inside `.claude-plugin/` | https://code.claude.com/docs/en/plugins-reference |
| Marketplace file | `.claude-plugin/marketplace.json` at the marketplace root; required top-level keys `name`, `owner` (object, `name` required), `plugins` (array); each entry requires `name` and `source` (`"./path"` from the marketplace root, or a source object such as `github`) | https://code.claude.com/docs/en/plugins/marketplace-reference |
| Install from a marketplace | `claude plugin marketplace add <owner>/<repo>`, then `claude plugin install <plugin>@<marketplace>`; inside a session, `/plugin marketplace add` and `/plugin install` | https://code.claude.com/docs/en/plugin-marketplaces |
| Entry name vs manifest name | Keep the marketplace entry `name` equal to the `name` in `plugin.json`; install ids use the entry name, skill prefixes use the manifest name | https://code.claude.com/docs/en/plugin-marketplaces |
| `AGENTS.md` | Not checked on this date (Claude Code documentation was read for skills and plugins only) | https://code.claude.com/docs/en/skills |

## OpenAI Codex

The Codex pages moved on 2026-11-26: `developers.openai.com/codex/...` answers
with a permanent redirect to `learn.chatgpt.com`. Both addresses are listed.

| Item | Path or format | Source |
|---|---|---|
| Global `AGENTS.md` | `~/.codex/AGENTS.md` (or `$CODEX_HOME`); `AGENTS.override.md` is checked first and only the first non-empty file at this level is used | https://learn.chatgpt.com/docs/agent-configuration/agents-md (was https://developers.openai.com/codex/guides/agents-md) |
| Project `AGENTS.md` | From the project root (usually the Git root) down to the current directory, at most one file per directory, checking `AGENTS.override.md`, then `AGENTS.md`, then configured fallback names; files are joined root first, so closer files come later and take precedence | https://learn.chatgpt.com/docs/agent-configuration/agents-md |
| `AGENTS.md` size limit | Combined size stops growing at `project_doc_max_bytes`, 32 KiB by default | https://learn.chatgpt.com/docs/agent-configuration/agents-md |
| Skills (Agent Skills format) | Supported. Repository: `.agents/skills` in each directory from the working directory up to the repository root. A skill is a directory with `SKILL.md` | https://learn.chatgpt.com/docs/build-skills (was https://developers.openai.com/codex/skills) |
| User skills | `$HOME/.agents/skills`. The page does not mention `~/.codex/skills` | https://learn.chatgpt.com/docs/build-skills |
| Admin and bundled skills | `/etc/codex/skills`; a system set ships with Codex | https://learn.chatgpt.com/docs/build-skills |
| Skill frontmatter | `name` and `description` are required | https://learn.chatgpt.com/docs/build-skills |
| Custom commands | Not checked on this date | https://learn.chatgpt.com/docs/build-skills |

## OpenCode

| Item | Path or format | Source |
|---|---|---|
| Project `AGENTS.md` | Placed in the directory it covers; OpenCode loads every `AGENTS.md` from the workspace up toward home (stopping at the project root for workspaces outside home) and combines them without resolving conflicts | https://opencode.ai/docs/rules/ |
| Global `AGENTS.md` | `~/.config/opencode/AGENTS.md`, loaded first | https://opencode.ai/docs/rules/ |
| `CLAUDE.md` fallback | In a directory without `AGENTS.md`, `CLAUDE.md` is read; `AGENTS.md` wins when both exist | https://opencode.ai/docs/rules/ |
| Commands, project | `.opencode/commands/` (plural). The page says the legacy singular `.opencode/command/` is still discovered but to use `commands/` for new files | https://opencode.ai/docs/commands/ |
| Commands, global | `~/.config/opencode/commands/` | https://opencode.ai/docs/commands/ |
| Command file format | Markdown file; the body is the prompt template; frontmatter `description`, `agent`, `model`, `subagent` (`subtask` is a deprecated alias); `$ARGUMENTS` and positional `$1`, `$2` placeholders | https://opencode.ai/docs/commands/ |
| Skills | Supported. Project: `.opencode/skills`, searched from the working directory up to the project root; compatibility: `.claude/skills` and `.agents/skills`. Global: `~/.config/opencode/skills`, plus `~/.claude/skills` and `~/.agents/skills` | https://opencode.ai/docs/skills/ |
| Skill frontmatter | All optional at runtime; a skill without `description` is not advertised to the model | https://opencode.ai/docs/skills/ |

## Cursor

| Item | Path or format | Source |
|---|---|---|
| Project rules | `.cursor/rules/`, version-controlled; project rules use the `.mdc` extension (a plain `.md` there is ignored for lack of frontmatter) | https://cursor.com/docs/context/rules |
| `.mdc` frontmatter | `description`, `globs`, `alwaysApply` | https://cursor.com/docs/context/rules |
| Always applied | `alwaysApply: true` (description and globs ignored) | https://cursor.com/docs/context/rules |
| Agent requested ("Apply Intelligently") | `alwaysApply: false` with a `description` and no `globs`; the agent decides when it is relevant | https://cursor.com/docs/context/rules |
| File-scoped | `alwaysApply: false` with `globs` set | https://cursor.com/docs/context/rules |
| Manual | `alwaysApply: false` with neither `description` nor `globs`; included only when @-mentioned | https://cursor.com/docs/context/rules |
| `AGENTS.md` | Supported as a plain Markdown file at the project root, as an alternative to `.cursor/rules`; nested `AGENTS.md` files in subdirectories are combined with parent directories, the more specific taking precedence | https://cursor.com/docs/context/rules |
| Global rules | "User Rules" are set in the Cursor settings interface; the page gives no file path | https://cursor.com/docs/context/rules |
| Skills | Not checked on this date | https://cursor.com/docs/context/rules |

## The AGENTS.md convention

| Item | Path or format | Source |
|---|---|---|
| File | `AGENTS.md`, standard Markdown with no required fields or headings | https://agents.md/ |
| Location | Repository root; nested files in subprojects of a monorepo | https://agents.md/ |
| Precedence | The nearest file to the edited file wins; explicit chat prompts override everything | https://agents.md/ |
| Tools listed as supporting it | Includes OpenAI Codex and Cursor; Aider and Gemini CLI need a setting (`read: AGENTS.md` in `.aider.conf.yml`; the context file name in `.gemini/settings.json`) | https://agents.md/ |
