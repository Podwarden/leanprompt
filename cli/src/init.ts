import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { optionsFor } from "./help.js";
import { BLOCK_BEGIN, BLOCK_END, isGenerated, listFiles } from "./forms.js";

export type Assistant = "claude" | "codex" | "opencode" | "cursor" | "agents-md";
export const ASSISTANTS: readonly Assistant[] = ["claude", "codex", "opencode", "cursor", "agents-md"];

export interface InitOptions {
  dir: string;
  assistant?: Assistant;
  global?: boolean;
  /** Plan and report, write nothing. */
  dryRun?: boolean;
  /** Home directory for `--global`; defaults to the user's. */
  home?: string;
}

export interface InitResult {
  /** Absolute paths of files that did not exist and were created. */
  written: string[];
  /** Absolute paths of leanprompt-owned files that differed and were replaced. */
  updated: string[];
  /** Absolute paths left alone (identical, or not ours to touch). */
  skipped: string[];
  skippedWhy: { path: string; reason: string }[];
  detected: { assistant: Assistant; why: string }[];
  notes: string[];
}

// cli/src and cli/dist are the same depth below the package root.
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FORMS = join(PACKAGE_ROOT, "forms");

export const CLOSING_LINE = "Ask your assistant: audit this app's LLM calls";

function isDir(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

/** Which assistants a project (or, with --global, the home directory) appears to use, and why. */
export function detect(base: string, global: boolean): { assistant: Assistant; why: string }[] {
  const found: { assistant: Assistant; why: string }[] = [];
  const add = (assistant: Assistant, why: string) => found.push({ assistant, why });
  if (global) {
    if (isDir(join(base, ".claude"))) add("claude", "found ~/.claude");
    if (isDir(join(base, ".codex"))) add("codex", "found ~/.codex");
    if (isDir(join(base, ".config", "opencode"))) add("opencode", "found ~/.config/opencode");
  } else {
    if (isDir(join(base, ".claude"))) add("claude", "found .claude/");
    if (isFile(join(base, "AGENTS.md"))) {
      add("agents-md", "found AGENTS.md");
      if (isDir(join(base, ".codex"))) add("codex", "found AGENTS.md and .codex/");
      if (isDir(join(base, ".opencode"))) add("opencode", "found AGENTS.md and .opencode/");
    }
    if (isDir(join(base, ".cursor"))) add("cursor", "found .cursor/");
    if (isDir(join(base, ".opencode")) && !found.some((f) => f.assistant === "opencode")) add("opencode", "found .opencode/");
  }
  if (found.length === 0) add("agents-md", "no assistant detected, using the AGENTS.md convention");
  return found;
}

/**
 * Insert or replace the marked block, leaving every byte outside the markers as it was.
 * (forms.spliceBlock normalises line endings and trailing newlines, which is right for this
 * repo's own AGENTS.md but would rewrite a user's file.) Returns null when the markers are
 * damaged (a begin without a following end), so the caller can refuse to guess.
 */
export function spliceUserBlock(existing: string | null, block: string): string | null {
  const body = block.replace(/\n+$/, "");
  if (existing === null) return body + "\n";
  const crlf = existing.includes("\r\n");
  const b = crlf ? body.replace(/\n/g, "\r\n") : body;
  const i = existing.indexOf(BLOCK_BEGIN);
  if (i >= 0) {
    const j = existing.indexOf(BLOCK_END, i);
    if (j < 0) return null;
    return existing.slice(0, i) + b + existing.slice(j + BLOCK_END.length);
  }
  if (existing.indexOf(BLOCK_END) >= 0) return null;
  const nl = crlf ? "\r\n" : "\n";
  const sep = existing === "" ? "" : existing.endsWith(nl + nl) ? "" : existing.endsWith("\n") ? nl : nl + nl;
  return existing + sep + b + nl;
}

interface Plan {
  /** absolute path -> file content, or the AGENTS block to splice */
  files: Map<string, string>;
  agents: Set<string>;
}

function readForm(sub: string): { rel: string; text: string }[] {
  const root = join(FORMS, sub);
  if (!existsSync(root)) throw new Error(`forms/${sub} is missing from the package; reinstall leanprompt`);
  return listFiles(root).map((rel) => ({ rel, text: readFileSync(join(root, rel), "utf8") }));
}

function targetsFor(assistant: Assistant, base: string, global: boolean, plan: Plan, notes: string[], skillsViaClaude: boolean): void {
  const put = (path: string, text: string) => plan.files.set(path, text);
  // One shared skills form serves both .claude/skills and .agents/skills.
  const skills = (dir: string) => {
    for (const f of readForm("skills")) put(join(base, dir, f.rel), f.text);
  };
  const addAgentsMd = (path: string) => plan.agents.add(join(base, path));

  switch (assistant) {
    case "claude":
      skills(join(".claude", "skills"));
      break;
    case "codex":
      skills(join(".agents", "skills"));
      addAgentsMd(global ? ".codex/AGENTS.md" : "AGENTS.md");
      break;
    case "agents-md":
      // With claude detected, the block points at .claude/skills; a second copy would show every skill twice.
      if (!skillsViaClaude) skills(join(".agents", "skills"));
      addAgentsMd(global ? ".codex/AGENTS.md" : "AGENTS.md");
      break;
    case "opencode": {
      const cmdDir = global ? ".config/opencode/commands" : ".opencode/commands";
      for (const f of readForm("opencode/commands")) put(join(base, cmdDir, f.rel), f.text);
      addAgentsMd(global ? ".config/opencode/AGENTS.md" : "AGENTS.md");
      // OpenCode reads .claude/skills and .agents/skills; give it the agents form when neither is there
      // (and the claude form is not already being installed by this run).
      const claudeSkills = join(base, ".claude", "skills");
      const agentsSkills = join(base, ".agents", "skills");
      const hasSkills =
        isDir(claudeSkills) ||
        isDir(agentsSkills) ||
        [...plan.files.keys()].some((p) => p.startsWith(claudeSkills + sep) || p.startsWith(agentsSkills + sep));
      if (!hasSkills) skills(join(".agents", "skills"));
      break;
    }
    case "cursor":
      if (global) {
        notes.push("cursor: user rules are set in Cursor's settings and docs/assistant-paths.md lists no global file path; skipped");
        break;
      }
      for (const f of readForm("cursor/rules")) put(join(base, ".cursor/rules", f.rel), f.text);
      break;
  }
}

/** realpath of the deepest ancestor of `path` that exists. */
function deepestRealParent(path: string): string {
  let p = dirname(path);
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  return realpathSync(p);
}

/** The first symlinked directory between `base` and `path`'s parent (falls back to the parent). */
function firstSymlink(base: string, path: string): string {
  let cur = base;
  for (const seg of relative(base, dirname(path)).split(sep).filter(Boolean)) {
    cur = join(cur, seg);
    if (isLink(cur)) return cur;
  }
  return dirname(path);
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

export function init(o: InitOptions): InitResult {
  const global = o.global === true;
  const base = global ? resolve(o.home ?? homedir()) : resolve(o.dir);
  const result: InitResult = { written: [], updated: [], skipped: [], skippedWhy: [], detected: [], notes: [] };
  result.detected = o.assistant ? [{ assistant: o.assistant, why: "--assistant" }] : detect(base, global);
  // Auto-detect only: claude and an AGENTS.md reader share one copy, in .claude/skills (OpenCode reads it too).
  // .agents/skills is for codex (detected or asked) or when claude is absent; --assistant agents-md forces it.
  const skillsViaClaude = !o.assistant && result.detected.some((d) => d.assistant === "claude");
  if (skillsViaClaude) {
    const d = result.detected.find((x) => x.assistant === "agents-md");
    if (d) d.why = `${d.why}; its block points at .claude/skills, so no second copy in .agents/skills`;
  }

  const plan: Plan = { files: new Map(), agents: new Set() };
  for (const { assistant } of ASSISTANTS.map((a) => result.detected.find((d) => d.assistant === a)).filter((d) => d !== undefined)) {
    targetsFor(assistant, base, global, plan, result.notes, skillsViaClaude);
  }

  const skip = (path: string, reason: string) => {
    result.skipped.push(path);
    result.skippedWhy.push({ path, reason });
  };

  const realBase = realpathSync(base);
  // `owned` is decided by content: a file differing from the form is replaced only if it carries the
  // generated stamp (or, for AGENTS.md, we are splicing between our own markers).
  const apply = (path: string, content: string, stamped: boolean) => {
    const exists = existsSync(path) || isLink(path);
    if (exists) {
      if (!isFile(path)) return skip(path, "exists and is not a regular file");
      const current = readFileSync(path);
      if (current.equals(Buffer.from(content))) return skip(path, "already up to date");
      if (!stamped && !isGenerated(current.toString("utf8"))) return skip(path, "exists and is not a leanprompt file");
    }
    const real = deepestRealParent(path);
    if (!inside(real, realBase)) {
      if (!global) return skip(path, "parent directory is a symlink outside the project");
      const link = firstSymlink(base, path);
      result.notes.push(`via symlink ${link} \u2192 ${realpathSync(link)}: ${path}`);
    }
    try {
      if (!o.dryRun) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
    } catch (e) {
      return skip(path, `cannot write: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    }
    (exists ? result.updated : result.written).push(path);
  };

  for (const [path, content] of plan.files) apply(path, content, false);

  const block = readFileSync(join(FORMS, "AGENTS.block.md"), "utf8");
  for (const path of plan.agents) {
    let existing: string | null = null;
    if (existsSync(path) || isLink(path)) {
      if (!isFile(path)) {
        skip(path, "exists and is not a regular file");
        continue;
      }
      existing = readFileSync(path, "utf8");
    }
    const next = spliceUserBlock(existing, block);
    if (next === null) {
      skip(path, "leanprompt markers are damaged (begin without end); fix or remove them and run again");
      continue;
    }
    apply(path, next, true);
  }
  return result;
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function initCommand(args: string[]): Promise<number> {
  let values: { assistant?: string; global?: boolean; "dry-run"?: boolean; dir?: string };
  try {
    values = parseArgs({
      args,
      options: optionsFor("init"),
      strict: true,
    }).values as typeof values;
  } catch (e) {
    process.stderr.write(`leanprompt: ${(e as Error).message}\n`);
    return 2;
  }
  if (values.assistant !== undefined && !(ASSISTANTS as readonly string[]).includes(values.assistant)) {
    process.stderr.write(`leanprompt: unknown assistant "${values.assistant}"; use ${ASSISTANTS.join(", ")}\n`);
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  const r = init({ dir, assistant: values.assistant as Assistant | undefined, global: values.global === true, dryRun: values["dry-run"] === true });
  const home = resolve(homedir());
  const base = values.global ? home : dir;
  const show = (p: string) => (values.global ? "~/" : "") + relative(base, p).split(sep).join("/");
  const out = (s: string) => process.stdout.write(s + "\n");

  const dry = values["dry-run"] === true;
  out("Detected:");
  for (const d of r.detected) out(`  ${d.assistant}: ${d.why}`);
  if (values.assistant === undefined) out(`  To install for another assistant instead, name it: leanprompt init --assistant <${ASSISTANTS.join("|")}>`);
  for (const n of r.notes) out(n);
  for (const p of r.written) out(`  ${dry ? "would write" : "wrote"} ${show(p)}`);
  for (const p of r.updated) out(`  ${dry ? "would update" : "updated"} ${show(p)}`);
  const skippedNew = r.skippedWhy.filter((s) => s.reason !== "already up to date");
  for (const s of skippedNew) out(`  skipped ${show(s.path)}: ${s.reason}`);
  const same = r.skippedWhy.length - skippedNew.length;
  if (same > 0) out(`  ${same} file${same === 1 ? "" : "s"} already up to date`);
  if (dry) {
    out("dry run: nothing was written");
    return 0;
  }
  out(CLOSING_LINE);
  return 0;
}
