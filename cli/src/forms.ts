import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { posix, join } from "node:path";
import { stringify } from "yaml";
import { parseDoc } from "./frontmatter.js";

export const SKILLS = ["llm-call-audit", "prefill-cache", "generation-economy", "measure-loop", "lmwarden"] as const;

export const BLOCK_BEGIN = "<!-- leanprompt:begin -->";
export const BLOCK_END = "<!-- leanprompt:end -->";
export const GENERATED_MARK = "<!-- leanprompt:generated";
export const generatedStamp = (version: string) =>
  `${GENERATED_MARK} v${version} — managed by npx leanprompt init; local edits are replaced on update -->`;
const stamp = (text: string, version: string) => text.replace(/\n*$/, "\n") + generatedStamp(version) + "\n";
/** The stamp as a line comment, for the code templates (`//` for .ts, `#` for .py). */
export const codeStamp = (comment: "//" | "#", version: string) =>
  `${comment} leanprompt:generated v${version} — managed by npx leanprompt init; local edits are replaced on update`;
const stampCode = (text: string, comment: "//" | "#", version: string) =>
  text.replace(/\n*$/, "\n") + codeStamp(comment, version) + "\n";
/** True when a file's text carries any form of the generated stamp (markdown or code comment). */
export const isGenerated = (text: string): boolean =>
  text.includes(GENERATED_MARK) || /^(?:\/\/|#) leanprompt:generated v/m.test(text);
export const REPO = "https://github.com/Podwarden/leanprompt";

const PREAMBLE = `# AGENTS.md

This repo is leanprompt: skills for AI coding assistants that cut wasted prefill and
generation in LLM calls, plus a TypeScript CLI. Contributors:

- \`skills/\`, \`providers/\`, \`models/\`, \`runtimes/\`, \`docs/\` are the source of truth. Edit them, never \`forms/\`.
- \`npm run build:forms\` regenerates \`forms/\`, \`.claude-plugin/\` and the block below; CI runs
  \`npm run build:forms -- --check\` and fails when they are stale.
- Provider facts (limits, prices, TTLs) live only in \`providers/\` and \`models/\`, and HTTP client
  defaults in \`runtimes/\`, each with a \`checked:\` date and a \`source:\`. Every number in the docs links to its source.
- Commits carry a DCO sign-off (\`git commit -s\`).

The block below is generated. It is also what \`leanprompt init\` copies into other projects.

`;

const BLURB: Record<(typeof SKILLS)[number], string> = {
  "llm-call-audit": "audit an app's LLM calls, rank the waste, write the report and findings",
  "prefill-cache": "rules for prompts the provider's cache can reuse (LP-PC-*)",
  "generation-economy": "rules for calls and output that are not wasted (LP-GE-*)",
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

function skillMeta(root: string, name: string): { description: string; body: string } {
  const raw = lf(readFileSync(join(root, "skills", name, "SKILL.md"), "utf8"));
  const meta = parseDoc(raw).meta;
  const description = typeof meta.description === "string" ? meta.description.trim() : "";
  if (!description) throw new Error(`skills/${name}/SKILL.md has no description`);
  const body = raw.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "").replace(/^\n+/, "");
  return { description, body };
}

export function agentsBlock(): string {
  const lines = [
    BLOCK_BEGIN,
    "## leanprompt",
    "",
    "Skills that cut wasted prefill and generation in code that calls LLMs. Load a skill only",
    "when its task comes up, and a rule file only when the skill points at it.",
    "",
    "Skills live in `.claude/skills/<name>/` or `.agents/skills/<name>/` (Cursor: `.cursor/rules/leanprompt-<name>.mdc`):",
    "",
    ...SKILLS.map((s) => `- \`${s}\`: ${BLURB[s]}`),
    "",
    "- Start with `llm-call-audit` for \"where does this app pay for the same tokens twice\".",
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
    const { description, body } = skillMeta(root, name);
    const front = stringify({ description, alwaysApply: false }, { lineWidth: 0 });
    out.set(
      `forms/cursor/rules/leanprompt-${name}.mdc`,
      stamp(`---\n${front}---\n\n${rewriteLinks(body, `skills/${name}/SKILL.md`, "flat", root, version)}`, version),
    );
  }

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
    json({ name: "leanprompt", description: pkg.description, version, author: { name: "PodWarden Team" } }),
  );
  out.set(
    ".claude-plugin/marketplace.json",
    json({
      name: "leanprompt",
      owner: { name: "PodWarden Team" },
      plugins: [{ name: "leanprompt", source: "./", description: pkg.description }],
    }),
  );
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Files under forms/ on disk that buildForms no longer produces. */
export function staleFiles(root: string, built: Map<string, string>): string[] {
  const dir = join(root, "forms");
  if (!existsSync(dir)) return [];
  return listFiles(dir)
    .map((f) => `forms/${f}`)
    .filter((f) => !built.has(f));
}
