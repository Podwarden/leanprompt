import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { posix, join } from "node:path";
import { parseDoc } from "./frontmatter.js";

export const SKILLS = ["leanprompt", "llm-call-audit", "prefill-cache", "generation-economy", "prompt-diet", "measure-loop", "lmwarden"] as const;

export const BLOCK_BEGIN = "<!-- leanprompt:begin -->";
export const BLOCK_END = "<!-- leanprompt:end -->";
export const GENERATED_MARK = "<!-- leanprompt:generated";
export const generatedStamp = (version: string) =>
  `${GENERATED_MARK} v${version}: written by npx leanprompt install; npx leanprompt update replaces local edits -->`;
const stamp = (text: string, version: string) => text.replace(/\n*$/, "\n") + generatedStamp(version) + "\n";
/** The stamp as a line comment, for the code templates (`//` for .ts, `#` for .py). */
export const codeStamp = (comment: "//" | "#", version: string) =>
  `${comment} leanprompt:generated v${version}: written by npx leanprompt install; npx leanprompt update replaces local edits`;
const stampCode = (text: string, comment: "//" | "#", version: string) =>
  text.replace(/\n*$/, "\n") + codeStamp(comment, version) + "\n";
/** True when a file's text carries any form of the generated stamp (markdown or code comment). */
export const isGenerated = (text: string): boolean =>
  text.includes(GENERATED_MARK) || /^(?:\/\/|#) leanprompt:generated v/m.test(text);
export const REPO = "https://github.com/Podwarden/leanprompt";

const PREAMBLE = `# AGENTS.md

This repo is leanprompt: skills that get more from every LLM call an app makes (cacheable
prompts, no dead weight, no wasted output, faster first tokens), plus a TypeScript CLI. Contributors:

- \`skills/\`, \`providers/\`, \`models/\`, \`runtimes/\`, \`docs/\` are the source of truth. Edit them, never \`forms/\`.
- \`npm run build:forms\` regenerates \`forms/\`, \`plugin/\`, \`.claude-plugin/\`, \`.cursor-plugin/\` and
  the block below; CI runs \`npm run build:forms -- --check\` and fails when they are stale.
- Provider facts (limits, prices, TTLs) live only in \`providers/\` and \`models/\`, and HTTP client
  defaults in \`runtimes/\`, each with a \`checked:\` date and a \`source:\`. Every number in the docs links to its source.
- Commits carry a DCO sign-off (\`git commit -s\`).

The block below is generated. It is also what \`leanprompt install\` copies into other projects.

`;

const BLURB: Record<(typeof SKILLS)[number], string> = {
  leanprompt: "the entry point: `/leanprompt` lists the commands (init, audit, fix, measure, score, report, lesson)",
  "llm-call-audit": "audit an app's LLM calls, rank the waste, write the report and findings",
  "prefill-cache": "rules for prompts the provider's cache can reuse (LP-PC-*)",
  "generation-economy": "rules for calls and output that are not wasted (LP-GE-*)",
  "prompt-diet": "rules that cut dead weight from what each call sends (LP-PD-*)",
  "measure-loop": "prove a fix with a before and after number; the score (CI test, logger)",
  lmwarden: "rules for self-hosted vLLM, SGLang and LM Warden servers (LP-LW-*)",
};

const sorted = (xs: string[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const lf = (s: string) => s.replace(/\r\n?/g, "\n");

export function listFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of sorted(readdirSync(join(dir, rel)))) {
    if (name === "__pycache__" || name.endsWith(".pyc")) continue; // local interpreter cache, never source
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, r)).isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

const LINK = /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

/**
 * The fact tables the skills link to, installed with them under `leanprompt/facts/` (same paths as in the
 * repository) so an audit works offline. Directories are copied whole.
 */
export const FACT_DIRS = ["providers", "models", "runtimes"] as const;
export const FACT_FILES = ["docs/evidence.md", "docs/profile.md"] as const;
export const FACTS_HOME = "skills/leanprompt/facts";
export const isFact = (repoPath: string): boolean =>
  (FACT_FILES as readonly string[]).includes(repoPath) || FACT_DIRS.some((d) => repoPath === d || repoPath === `${d}/` || repoPath.startsWith(`${d}/`));

/** `npx leanprompt <cmd>` -> `npx leanprompt@<version> <cmd>`, so installed skills call the CLI they came with. */
export function pinNpx(text: string, version: string): string {
  return text.replace(/\bnpx (-y |--yes )?leanprompt(?![@\w-])/g, (_m, y: string | undefined) => `npx ${y ?? ""}leanprompt@${version}`);
}

/**
 * Rewrite markdown links in `text`, which lives at repo path `fromFile`.
 * mode "skills": links that stay inside skills/ remain relative; everything else becomes a GitHub URL.
 * mode "flat": every local link becomes a GitHub URL (the file is installed outside the skills tree).
 */
export function rewriteLinks(
  text: string,
  fromFile: string,
  mode: "skills" | "flat",
  root: string,
  version: string,
  /** Where the file is installed, as a repository-like path under skills/ (a fact table: skills/leanprompt/facts/...). */
  installedAs: string = fromFile,
): string {
  return text.replace(LINK, (whole, target: string, title: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) return whole;
    const m = /^([^#?]*)([#?].*)?$/.exec(target)!;
    const path = m[1]!;
    const tail = m[2] ?? "";
    const resolved = posix.normalize(posix.join(posix.dirname(fromFile), path));
    if (resolved.startsWith("..")) throw new Error(`${fromFile}: link ${target} leaves the repo`);
    const abs = join(root, resolved);
    if (!existsSync(abs)) throw new Error(`${fromFile}: link ${target} points at a missing file (${resolved})`);
    const dir = statSync(abs).isDirectory();
    if (mode === "skills") {
      // Inside the installed tree: a link to another skill file, or to an installed fact table, stays relative.
      const to = resolved.startsWith("skills/") ? resolved : isFact(resolved) ? `${FACTS_HOME}/${resolved}` : undefined;
      if (to !== undefined) {
        if (to === resolved && installedAs === fromFile) return whole;
        let rel = posix.relative(posix.dirname(installedAs), to) || ".";
        if (dir) rel = rel.replace(/\/+$/, "") + "/";
        return `](${rel}${tail}${title})`;
      }
    }
    const p = dir ? resolved.replace(/\/+$/, "") + "/" : resolved;
    return `](${REPO}/${dir ? "tree" : "blob"}/v${version}/${p}${tail}${title})`;
  });
}

function skillMeta(root: string, name: string): { description: string } {
  const raw = lf(readFileSync(join(root, "skills", name, "SKILL.md"), "utf8"));
  const meta = parseDoc(raw).meta;
  const description = typeof meta.description === "string" ? meta.description.trim() : "";
  if (!description) throw new Error(`skills/${name}/SKILL.md has no description`);
  return { description };
}

export function agentsBlock(): string {
  const lines = [
    BLOCK_BEGIN,
    "## leanprompt",
    "",
    "Skills that get more from every LLM call: cacheable prompts, no dead weight, no wasted output.",
    "Load a skill only",
    "when its task comes up, and a rule file only when the skill points at it.",
    "",
    "Skills live in `.claude/skills/<name>/`, `.agents/skills/<name>/` or `.cursor/skills/<name>/`:",
    "",
    ...SKILLS.map((s) => `- \`${s}\`: ${BLURB[s]}`),
    "",
    "- Start with the `leanprompt` skill (`/leanprompt audit`, or `$leanprompt audit` in Codex), which routes to `llm-call-audit`.",
    "- Rules are in `<skill>/rules/LP-*.md`. Each ends with `Verify`; run it before calling a fix done.",
    "- Provider and model facts (limits, minimums, TTLs) are in the `providers/` and `models/`",
    "  pages linked from each rule, and HTTP client defaults in `runtimes/`, each with a `checked:`",
    "  date. Do not quote them from memory.",
    "- Ask before editing code, installing a package, or running anything that sends billed requests.",
    "- Keep meaning: a fix that changes what the model is asked or answers is not a fix.",
    BLOCK_END,
  ];
  return lines.join("\n") + "\n";
}

export function spliceBlock(existing: string | null, block: string): string {
  const b = block.replace(/\n+$/, "");
  if (existing === null) return PREAMBLE + b + "\n";
  const text = lf(existing);
  const i = text.indexOf(BLOCK_BEGIN);
  const j = text.indexOf(BLOCK_END);
  if (i < 0 || j < i) return text.replace(/\n*$/, "\n\n") + b + "\n";
  return text.slice(0, i) + b + text.slice(j + BLOCK_END.length);
}

const KEYWORDS = ["llm", "prompt-caching", "prompt-cache", "tokens", "cost", "latency", "skills"];

/** The plugin icon: rendered from docs/assets/icon.svg, copied byte for byte by build:forms. */
export const ICON_SOURCE = "docs/assets/icon.png";
export const ICON_PATH = "plugin/.claude-plugin/icon.png";
/** Binary files build:forms copies unchanged: [source, destination], repo-relative. */
export const BINARY_COPIES: ReadonlyArray<readonly [string, string]> = [[ICON_SOURCE, ICON_PATH]];
/** Generated trees whose files build:forms owns; anything else in them is stale. */
export const GENERATED_DIRS = ["forms", "plugin"] as const;

function pluginReadme(version: string): string {
  return [
    "# leanprompt",
    "",
    "**Get more from every LLM call your app makes.**",
    "",
    "leanprompt is a set of skills for your coding assistant, by the LM Warden Team. They help the assistant",
    "find the places where the app you are building pays for the same tokens twice, and fix them without",
    "changing the answers: prompts the provider's cache can reuse, no dead weight in what each call sends,",
    "no wasted output, faster first tokens. Every fix says how to prove it with a before and after number.",
    "",
    "## Install",
    "",
    "In Claude Code, inside a session:",
    "",
    "```",
    "/plugin marketplace add Podwarden/leanprompt",
    "/plugin install leanprompt@leanprompt",
    "```",
    "",
    "## Use",
    "",
    "Type `/leanprompt` to list the commands, then start with `/leanprompt init` and `/leanprompt audit`.",
    "If another command already has that name, the full name is `/leanprompt:leanprompt`.",
    "",
    "| Skill | What it is for |",
    "|---|---|",
    ...SKILLS.map((s) => `| \`${s}\` | ${BLURB[s]} |`),
    "",
    "## What it runs, sends and fetches",
    "",
    "- The plugin is instructions only: Markdown skills, two of them small test templates as code blocks. It has no hooks, no MCP",
    "  servers and no executables, and it runs no code on its own.",
    "- Nothing is sent anywhere. The skills ask before editing code, installing a package, or running anything",
    "  that sends billed requests to a model provider.",
    "- The command line tool is optional. Some commands (`score`, `report`, `calibrate`, `lesson`) run it as",
    "  `leanprompt <command>`. It is the `leanprompt` npm package (https://www.npmjs.com/package/leanprompt);",
    "  the skills ask you to install it, or to run it through your package runner, and never install it",
    "  themselves. It runs on your machine, where it reads and writes files in your project and makes no",
    "  network calls. Only `profile detect",
    "  --lmwarden <url>` reads from a server: the LM Warden server you name, for its engine facts.",
    "- The provider, model and runtime fact tables, the evidence table and the profile reference are included",
    "  under `skills/leanprompt/facts/`, so an audit needs no network. Other links open pages on GitHub; the",
    "  skills do not fetch them on their own.",
    "",
    "## More",
    "",
    `Source, documentation and other assistants (Codex, Cursor, OpenCode): ${REPO}. This folder is generated`,
    `from that repository for version ${version}.`,
    "",
    "## Licence",
    "",
    "The skills and this README are licensed under CC BY 4.0 (LICENSE-DOCS.md); code is licensed under",
    "Apache-2.0 (LICENSE). See NOTICE.md.",
    "",
  ].join("\n");
}

/** Each package's own page, where its install instructions live. */
export const PACKAGE_PAGES: Record<string, string> = {
  leanprompt: "https://www.npmjs.com/package/leanprompt",
  "@kvsig/core": "https://www.npmjs.com/package/@kvsig/core",
  "leanprompt-cli": "https://pypi.org/project/leanprompt-cli/",
  kvsig: "https://pypi.org/project/kvsig/",
};

/** The note the plugin's `leanprompt` SKILL.md carries under its title. */
export const PLUGIN_CLI_NOTE =
  "The command line tool is the `leanprompt` npm package. If `leanprompt` is not available, ask the user to install it " +
  `following ${PACKAGE_PAGES.leanprompt}, or to run it through their package runner; never install anything without asking.`;

const PKG = String.raw`(@kvsig\/core|leanprompt-cli|leanprompt|kvsig)`;
const VER = String.raw`(\d[\w.-]*)`;
const page = (p: string) => PACKAGE_PAGES[p]!;
const at = (v: string | undefined) => (v ? ` at ${v}` : "");

/**
 * Text rewrites for plugin/ only. Anthropic's plugin directory flags a command that downloads and
 * runs code (`npx`, `npm i`, `pip install`) in a skill body, so the plugin copy names the CLI by
 * its own command (`leanprompt <cmd>`) and points to each package's page for installing it. The
 * npm package and forms/ keep the exact commands. Each rule matches one shape the skills use; a
 * test fails when any install or npx command is left in plugin/.
 */
export const PLUGIN_REWRITES: ReadonlyArray<readonly [RegExp, string | ((...m: string[]) => string)]> = [
  // `npx leanprompt score`, `npx -y leanprompt@0.1.0 score` -> `leanprompt score`
  [/\bnpx (?:-y |--yes )?leanprompt(?:@[\w.-]+)?(?![\w-])/g, "leanprompt"],
  // The prose around an install the skill proposes rather than runs.
  [/propose the install command to the user instead of running it/g, "ask the user to add the package instead of installing it yourself"],
  [/Propose the install command, /g, "Propose adding the package, "],
  // The repo's replay harness is named by its file alone (`npm run eval` reads like a command to run here).
  [/\(\x60npm run eval\x60, \x60eval\/run\.ts\x60\)/g, "(`eval/run.ts`)"],
  // `pip install --pre leanprompt-cli` (`--pre` because it is a pre-release; `uv pip install` takes the same arguments)
  [
    new RegExp(String.raw`\x60pip install --pre ${PKG}\x60 \(\x60--pre\x60 because it is a pre-release; \x60uv pip install\x60 takes the same arguments\)`, "g"),
    (_m, p) => `the \`${p}\` package, a pre-release (see its page on PyPI for how to install it: ${page(p)})`,
  ],
  // `npm i -D @kvsig/core@0.1.0` (npm) / `npm i leanprompt`
  [
    new RegExp(String.raw`\x60npm (?:i|install|add)(?: -D| --save-dev)? ${PKG}(?:@${VER})?\x60(?: \(npm\))?`, "g"),
    (_m, p, v) => `the \`${p}\` package${at(v)} (see its page on npm for how to install it: ${page(p)})`,
  ],
  // `pip install kvsig==0.1.0` (PyPI)
  [
    new RegExp(String.raw`\x60(?:uv )?pip install (?:--pre )?${PKG}(?:==${VER})?\x60(?: \(PyPI\))?`, "g"),
    (_m, p, v) => `the \`${p}\` package${at(v)} (see its page on PyPI for how to install it: ${page(p)})`,
  ],
  // Code comments in the templates: `Install: npm i -D @kvsig/core@0.1.0 (...)`
  [
    new RegExp(String.raw`Install: npm (?:i|install|add)(?: -D| --save-dev)? ${PKG}@${VER} `, "g"),
    (_m, p, v) => `Install: ${p} ${v} as a dev dependency, following ${page(p)} `,
  ],
  // `Install: pip install kvsig==0.1.0 pytest   (...)`
  [
    new RegExp(String.raw`Install: pip install ${PKG}==${VER} pytest +`, "g"),
    (_m, p, v) => `Install: ${p} ${v} and pytest, following ${page(p)} `,
  ],
];

/** Rewrites one file's text for plugin/ (see PLUGIN_REWRITES). */
export function pluginText(text: string): string {
  let t = text;
  for (const [re, to] of PLUGIN_REWRITES) t = t.replace(re, to as never);
  return t;
}

function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + "\n";
}

/** Everything generated from the source tree: repo-relative path -> content. */
export function buildForms(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; description: string };
  const version = pkg.version;

  for (const name of SKILLS) {
    const base = join(root, "skills", name);
    for (const f of listFiles(base)) {
      let text = lf(readFileSync(join(base, f), "utf8"));
      if (f.endsWith(".md")) text = pinNpx(rewriteLinks(text, `skills/${name}/${f}`, "skills", root, version), version);
      if (f.endsWith(".md")) text = stamp(text, version);
      else if (f.endsWith(".ts")) text = stampCode(text, "//", version);
      else if (f.endsWith(".py")) text = stampCode(text, "#", version);
      out.set(`forms/skills/${name}/${f}`, text);
    }
    skillMeta(root, name); // throws when a skill has no description
  }

  // The fact tables, so the links above work with no network (FACT_DIRS, FACT_FILES).
  const facts = [...FACT_DIRS.flatMap((d) => listFiles(join(root, d)).filter((f) => f.endsWith(".md")).map((f) => `${d}/${f}`)), ...FACT_FILES];
  for (const repoPath of facts) {
    const installedAs = `${FACTS_HOME}/${repoPath}`;
    const text = pinNpx(rewriteLinks(lf(readFileSync(join(root, repoPath), "utf8")), repoPath, "skills", root, version, installedAs), version);
    out.set(`forms/${installedAs}`, stamp(text, version));
  }

  out.set(
    "forms/opencode/commands/leanprompt.md",
    stamp([
      "---",
      "description: leanprompt commands for this app's LLM calls (init, audit, fix, measure, score, report, lesson)",
      "---",
      "",
      "Load the `leanprompt` skill and follow its routing for this command: $ARGUMENTS",
      "",
      "With no command, show the skill's menu and suggest one next step. Do not edit code without asking.",
      "",
    ].join("\n"), version),
  );

  out.set(
    "forms/opencode/commands/leanprompt-audit.md",
    stamp([
      "---",
      "description: Audit this project's LLM calls with leanprompt and write leanprompt-report.md",
      "---",
      "",
      "Load the `llm-call-audit` skill and run it on this project. Find every LLM call, check it",
      "against the leanprompt rules, rank the findings by tokens lost, and write",
      "`leanprompt-report.md` and `.leanprompt/findings.json`. Do not edit code without asking.",
      "",
      "Focus, if given: $ARGUMENTS",
      "",
    ].join("\n"), version),
  );

  const block = agentsBlock();
  out.set("forms/AGENTS.block.md", block);
  const agentsPath = join(root, "AGENTS.md");
  out.set("AGENTS.md", spliceBlock(existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null, block));

  out.set(
    ".claude-plugin/plugin.json",
    json({
      name: "leanprompt",
      description: pkg.description,
      version,
      author: { name: "LM Warden Team" },
      homepage: REPO,
      repository: REPO,
      license: "Apache-2.0 AND CC-BY-4.0",
      icon: `./${ICON_PATH}`,
    }),
  );
  out.set(
    ".claude-plugin/marketplace.json",
    json({
      name: "leanprompt",
      owner: { name: "LM Warden Team" },
      metadata: { description: pkg.description },
      plugins: [{ name: "leanprompt", source: "./plugin", description: pkg.description }],
    }),
  );

  // plugin/: the small folder submitted to Anthropic's plugin directory and installed by the
  // marketplace above. Only a manifest, a README, the licences and the shared skills form.
  // The directory takes Markdown, text, JSON, YAML and images only from organizations that are
  // not Verified, so the two code templates ship there as Markdown with one fenced block each.
  const codeLang: Record<string, string> = { ".ts": "ts", ".py": "python" };
  const asMd = (p: string) => Object.keys(codeLang).some((e) => p.endsWith(e));
  const renamed = [...out.keys()].filter((p) => p.startsWith("forms/skills/") && asMd(p)).map((p) => p.split("/").pop()!);
  for (const [path, text] of [...out]) {
    if (!path.startsWith("forms/skills/")) continue;
    const dest = `plugin/${path.slice("forms/".length)}`;
    if (asMd(path)) {
      const name = path.split("/").pop()!;
      const lang = codeLang[name.slice(name.lastIndexOf("."))];
      out.set(`${dest}.md`, pluginText([
        `# ${name}`,
        "",
        `Save the code below as a file in the project's tests (the skill says which name), after the user says yes.`,
        "",
        "```" + lang,
        text.replace(/\n$/, ""),
        "```",
        "",
      ].join("\n")));
    } else {
      let t = pluginText(text);
      for (const n of renamed) t = t.split(`](templates/${n})`).join(`](templates/${n}.md)`);
      if (dest === "plugin/skills/leanprompt/SKILL.md") {
        if (!t.includes("\n## Commands\n")) throw new Error(`${dest}: no "## Commands" heading for the CLI note`);
        t = t.replace("\n## Commands\n", `\n${PLUGIN_CLI_NOTE}\n\n## Commands\n`);
      }
      out.set(dest, t);
    }
  }
  out.set(
    "plugin/.claude-plugin/plugin.json",
    json({
      name: "leanprompt",
      description: pkg.description,
      version,
      author: { name: "LM Warden Team" },
      homepage: REPO,
      repository: REPO,
      license: "Apache-2.0 AND CC-BY-4.0",
      keywords: KEYWORDS,
      icon: "./.claude-plugin/icon.png",
    }),
  );
  out.set("plugin/README.md", pluginReadme(version));
  // LICENSE keeps its name (the directory accepts a licence); the other two texts get .md, since the
  // directory refuses extensionless files it does not recognise from organizations that are not Verified.
  for (const [f, to] of [["LICENSE", "LICENSE"], ["LICENSE-DOCS", "LICENSE-DOCS.md"], ["NOTICE", "NOTICE.md"]]) {
    out.set(`plugin/${to}`, lf(readFileSync(join(root, f), "utf8")));
  }

  // Cursor reads .cursor-plugin/plugin.json at the repository root; `skills` points it at the
  // same self-contained skills (links outside the skills tree are pinned GitHub URLs).
  out.set(
    ".cursor-plugin/plugin.json",
    json({
      name: "leanprompt",
      displayName: "leanprompt",
      description: pkg.description,
      version,
      author: { name: "LM Warden Team" },
      homepage: REPO,
      repository: REPO,
      license: "Apache-2.0 AND CC-BY-4.0",
      keywords: KEYWORDS,
      logo: ICON_PATH,
      skills: "./plugin/skills/",
    }),
  );
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Files under the generated trees (forms/, plugin/) on disk that buildForms no longer produces. */
export function staleFiles(root: string, built: Map<string, string>): string[] {
  const keep = new Set(BINARY_COPIES.map(([, dst]) => dst));
  return GENERATED_DIRS.flatMap((d) => {
    const dir = join(root, d);
    if (!existsSync(dir)) return [];
    return listFiles(dir)
      .map((f) => `${d}/${f}`)
      .filter((f) => !built.has(f) && !keep.has(f));
  });
}
