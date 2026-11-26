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
    if (mode === "skills" && resolved.startsWith("skills/")) return whole;
    const dir = statSync(abs).isDirectory();
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
    "In Claude Code (2.1.275 or later), inside a session:",
    "",
    "```",
    "/plugin install leanprompt --marketplace Podwarden/leanprompt",
    "```",
    "",
    "On older versions: `/plugin marketplace add Podwarden/leanprompt`, then `/plugin install leanprompt@leanprompt`.",
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
    "- The plugin is instructions only: Markdown skills and two small test templates. It has no hooks, no MCP",
    "  servers and no executables, and it runs no code on its own.",
    "- Nothing is sent anywhere. The skills ask before editing code, installing a package, or running anything",
    "  that sends billed requests to a model provider.",
    "- The command line tool is optional. Some commands (`score`, `report`, `calibrate`, `lesson`) run it as",
    "  `npx leanprompt <command>`: npx downloads the `leanprompt` package from npm and runs it on your machine,",
    "  where it reads and writes files in your project and makes no network calls. Only `profile detect",
    "  --lmwarden <url>` reads from a server: the LM Warden server you name, for its engine facts.",
    "- Links to provider tables and docs open pages on GitHub; the skills do not fetch them on their own.",
    "",
    "## More",
    "",
    `Source, documentation and other assistants (Codex, Cursor, OpenCode): ${REPO}. This folder is generated`,
    `from that repository for version ${version}.`,
    "",
    "## Licence",
    "",
    "The skills and this README are licensed under CC BY 4.0 (LICENSE-DOCS); code is licensed under",
    "Apache-2.0 (LICENSE). See NOTICE.",
    "",
  ].join("\n");
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
      if (f.endsWith(".md")) text = rewriteLinks(text, `skills/${name}/${f}`, "skills", root, version);
      if (f.endsWith(".md")) text = stamp(text, version);
      else if (f.endsWith(".ts")) text = stampCode(text, "//", version);
      else if (f.endsWith(".py")) text = stampCode(text, "#", version);
      out.set(`forms/skills/${name}/${f}`, text);
    }
    skillMeta(root, name); // throws when a skill has no description
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
  for (const [path, text] of [...out]) {
    if (path.startsWith("forms/skills/")) out.set(`plugin/${path.slice("forms/".length)}`, text);
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
  for (const f of ["LICENSE", "LICENSE-DOCS", "NOTICE"]) out.set(`plugin/${f}`, lf(readFileSync(join(root, f), "utf8")));

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
