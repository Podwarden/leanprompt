import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK_BEGIN, BLOCK_END, isGenerated, listFiles } from "./forms.js";

export type Assistant = "claude" | "codex" | "opencode" | "cursor" | "agents-md";
export const ASSISTANTS: readonly Assistant[] = ["claude", "codex", "opencode", "cursor", "agents-md"];
export type Scope = "project" | "global";

/** Names people know the assistants by, for what the installer prints. */
export const ASSISTANT_NAMES: Record<Assistant, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  "agents-md": "an AGENTS.md agent",
};

/**
 * Where each assistant reads skills for all of a user's projects, from its own documentation
 * (checked 2026-11-26; the table with the sources is docs/assistant-paths.md):
 * - Claude Code: ~/.claude/skills (https://code.claude.com/docs/en/skills)
 * - Codex: ~/.agents/skills, plus ~/.codex/AGENTS.md (https://learn.chatgpt.com/docs/build-skills,
 *   https://learn.chatgpt.com/docs/agent-configuration/agents-md)
 * - OpenCode: ~/.config/opencode/commands and ~/.config/opencode/AGENTS.md; skills are read from
 *   ~/.claude/skills and ~/.agents/skills too (https://opencode.ai/docs/skills/, /docs/commands/, /docs/rules/)
 * - Cursor: ~/.cursor/skills, and it also reads ~/.claude/skills and ~/.agents/skills
 *   (https://cursor.com/docs/context/skills)
 * - The AGENTS.md convention has no user-level location (https://agents.md/), so project only.
 */
export const NO_GLOBAL: Partial<Record<Assistant, string>> = {
  "agents-md": "the AGENTS.md convention has no user-level location (https://agents.md/), so it installs per project only",
};

export interface InitOptions {
  dir: string;
  assistant?: Assistant;
  /** Install for these assistants instead of detecting (`--providers`). */
  assistants?: Assistant[];
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
    if (isDir(join(base, ".cursor"))) add("cursor", "found ~/.cursor");
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

/** True when a skills folder already holds leanprompt's skills (written by an earlier run). */
function hasOurSkills(root: string): boolean {
  return ["leanprompt", "llm-call-audit"].some((s) => {
    const f = join(root, s, "SKILL.md");
    return isFile(f) && isGenerated(readFileSync(f, "utf8"));
  });
}

function targetsFor(assistant: Assistant, base: string, global: boolean, plan: Plan, notes: string[], skillsViaClaude: boolean): void {
  const put = (path: string, text: string) => plan.files.set(path, text);
  // One shared skills form serves .claude/skills, .agents/skills and .cursor/skills.
  const skills = (dir: string) => {
    for (const f of readForm("skills")) put(join(base, dir, f.rel), f.text);
  };
  const addAgentsMd = (path: string) => plan.agents.add(join(base, path));
  // OpenCode and Cursor also read .claude/skills and .agents/skills (home or project alike), so a
  // copy there, already installed or planned by this run, serves them; a second copy would show every skill twice.
  const sharedSkills = (): boolean => {
    const claudeSkills = join(base, ".claude", "skills");
    const agentsSkills = join(base, ".agents", "skills");
    return (
      hasOurSkills(claudeSkills) ||
      hasOurSkills(agentsSkills) ||
      [...plan.files.keys()].some((p) => p.startsWith(claudeSkills + sep) || p.startsWith(agentsSkills + sep))
    );
  };

  if (global && NO_GLOBAL[assistant]) {
    notes.push(`${assistant}: ${NO_GLOBAL[assistant]}; skipped. Run in the project with --scope=project to install it there.`);
    return;
  }
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
      addAgentsMd("AGENTS.md");
      break;
    case "opencode": {
      const cmdDir = global ? ".config/opencode/commands" : ".opencode/commands";
      for (const f of readForm("opencode/commands")) put(join(base, cmdDir, f.rel), f.text);
      addAgentsMd(global ? ".config/opencode/AGENTS.md" : "AGENTS.md");
      if (!sharedSkills()) skills(join(".agents", "skills"));
      break;
    }
    case "cursor":
      if (!sharedSkills()) skills(join(".cursor", "skills"));
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

const emptyResult = (): InitResult => ({ written: [], updated: [], skipped: [], skippedWhy: [], detected: [], notes: [] });

/**
 * Write a plan under `base`, with every protection: a file is created, or replaced only when it carries
 * leanprompt's stamp (or, for AGENTS.md, between leanprompt's own markers); never through a symlink that
 * leaves the project; never anything that is not a regular file.
 */
function applyPlan(plan: Plan, base: string, global: boolean, dryRun: boolean, result: InitResult): void {
  const skip = (path: string, reason: string) => {
    result.skipped.push(path);
    result.skippedWhy.push({ path, reason });
  };

  const realBase = realpathSync(base);
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
      result.notes.push(`via symlink ${link} → ${realpathSync(link)}: ${path}`);
    }
    try {
      if (!dryRun) {
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
}

export function init(o: InitOptions): InitResult {
  const global = o.global === true;
  const base = global ? resolve(o.home ?? homedir()) : resolve(o.dir);
  const result = emptyResult();
  const forced = o.assistants ?? (o.assistant ? [o.assistant] : undefined);
  if (forced) result.detected = forced.map((assistant) => ({ assistant, why: o.assistants ? "--providers" : "--assistant" }));
  else {
    result.detected = detect(base, global);
    // Nothing in the home directory says which assistants are used: go by the project instead.
    if (global && result.detected.length === 1 && result.detected[0]!.assistant === "agents-md" && !isFile(join(base, "AGENTS.md"))) {
      const local = detect(resolve(o.dir), false);
      if (!(local.length === 1 && local[0]!.why.startsWith("no assistant"))) {
        result.detected = local.map((d) => ({ assistant: d.assistant, why: `${d.why} in this project` }));
      }
    }
  }
  // Auto-detect only: claude and an AGENTS.md reader share one copy, in .claude/skills (OpenCode reads it too).
  // .agents/skills is for codex (detected or asked) or when claude is absent; --assistant agents-md forces it.
  const skillsViaClaude = !forced && result.detected.some((d) => d.assistant === "claude");
  if (skillsViaClaude) {
    const d = result.detected.find((x) => x.assistant === "agents-md");
    if (d) d.why = `${d.why}; its block points at .claude/skills, so no second copy in .agents/skills`;
  }

  const plan: Plan = { files: new Map(), agents: new Set() };
  for (const { assistant } of ASSISTANTS.map((a) => result.detected.find((d) => d.assistant === a)).filter((d) => d !== undefined)) {
    targetsFor(assistant, base, global, plan, result.notes, skillsViaClaude);
  }
  applyPlan(plan, base, global, o.dryRun === true, result);
  return result;
}

/** Where leanprompt may have installed before, per scope (paths relative to the project or home). */
const LOCATIONS: Record<Scope, { skills: string[]; commands: string[]; agents: string[]; legacyRules: string[] }> = {
  project: {
    skills: [".claude/skills", ".agents/skills", ".cursor/skills", ".opencode/skills"],
    commands: [".opencode/commands", ".opencode/command"],
    agents: ["AGENTS.md"],
    legacyRules: [".cursor/rules"],
  },
  global: {
    skills: [".claude/skills", ".agents/skills", ".cursor/skills", ".config/opencode/skills"],
    commands: [".config/opencode/commands"],
    agents: [".codex/AGENTS.md", ".config/opencode/AGENTS.md"],
    legacyRules: [],
  },
};

export interface UpdateOptions {
  dir: string;
  home?: string;
  scopes?: Scope[];
  dryRun?: boolean;
}

export interface UpdateResult extends InitResult {
  /** The install locations found, per scope (absolute paths). */
  found: { scope: Scope; path: string }[];
}

/**
 * Refresh what an earlier `install` wrote, in each scope where it is found: a skills folder holding
 * leanprompt's stamped skills, an OpenCode commands folder with leanprompt's command, an AGENTS.md with
 * leanprompt's block. Unstamped files are never touched; new files of the same form are added.
 */
export function update(o: UpdateOptions): UpdateResult {
  const result: UpdateResult = { ...emptyResult(), found: [] };
  const seen = new Set<string>();
  for (const scope of o.scopes ?? (["project", "global"] as Scope[])) {
    const base = scope === "global" ? resolve(o.home ?? homedir()) : resolve(o.dir);
    if (!isDir(base)) continue;
    const loc = LOCATIONS[scope];
    const plan: Plan = { files: new Map(), agents: new Set() };
    const found = (path: string) => {
      if (seen.has(path)) return false;
      seen.add(path);
      result.found.push({ scope, path });
      return true;
    };
    for (const rel of loc.skills) {
      const root = join(base, rel);
      if (!hasOurSkills(root) || !found(root)) continue;
      for (const f of readForm("skills")) plan.files.set(join(root, f.rel), f.text);
    }
    for (const rel of loc.commands) {
      const root = join(base, rel);
      const ours = ["leanprompt.md", "leanprompt-audit.md"].some((n) => isFile(join(root, n)) && isGenerated(readFileSync(join(root, n), "utf8")));
      if (!ours || !found(root)) continue;
      for (const f of readForm("opencode/commands")) plan.files.set(join(root, f.rel), f.text);
    }
    for (const rel of loc.agents) {
      const file = join(base, rel);
      if (!isFile(file) || !readFileSync(file, "utf8").includes(BLOCK_BEGIN) || !found(file)) continue;
      plan.agents.add(file);
    }
    for (const rel of loc.legacyRules) {
      const root = join(base, rel);
      if (!isDir(root)) continue;
      const old = readdirSync(root).filter((n) => /^leanprompt-.*\.mdc$/.test(n) && isGenerated(readFileSync(join(root, n), "utf8")));
      if (old.length > 0) {
        result.notes.push(
          `${join(root)}: ${old.length} rule file${old.length === 1 ? "" : "s"} from an older leanprompt (leanprompt-*.mdc). Cursor now reads the skills instead; delete them when you like. They were left as they are.`,
        );
      }
    }
    applyPlan(plan, base, scope === "global", o.dryRun === true, result);
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
