import { homedir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { optionsFor } from "./help.js";
import { ASSISTANT_NAMES, ASSISTANTS, init, update, type Assistant, type InitResult, type Scope } from "./init.js";

/** Terminal access, injectable so the prompts can be tested. */
export interface Io {
  /** True when both stdin and stdout are a terminal, so a question can be asked and answered. */
  interactive: boolean;
  ask(question: string): Promise<string>;
  out(line: string): void;
  err(line: string): void;
}

export function terminalIo(): Io {
  return {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    ask: (question) =>
      new Promise((resolveAnswer) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (a) => {
          // Resolve before close(): closing emits "close" at once, which would answer "".
          resolveAnswer(a.trim());
          rl.close();
        });
        rl.on("close", () => resolveAnswer(""));
      }),
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  };
}

/** How the user starts leanprompt in each assistant, from its own documentation (docs/assistant-paths.md). */
export function nextStep(a: Assistant, scope: Scope): string {
  const where = scope === "global" ? "in any project" : "here";
  switch (a) {
    case "claude":
      return `Next: open Claude Code ${where} and type /leanprompt audit`;
    case "codex":
      return `Next: open Codex ${where} and type $leanprompt audit (or pick it from /skills)`;
    case "cursor":
      return `Next: open Cursor ${where} and type /leanprompt audit in the Agent chat`;
    case "opencode":
      return `Next: open OpenCode ${where} and type /leanprompt audit`;
    case "agents-md":
      return `Next: open your assistant ${where} and ask it to use the leanprompt skill to audit this app's LLM calls`;
  }
}

function parseProviders(raw: string): Assistant[] | string {
  const names = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return "--providers needs at least one name";
  const bad = names.filter((n) => !(ASSISTANTS as readonly string[]).includes(n));
  if (bad.length > 0) return `unknown provider${bad.length > 1 ? "s" : ""} ${bad.map((b) => `"${b}"`).join(", ")}; use ${ASSISTANTS.join(", ")}`;
  return [...new Set(names)] as Assistant[];
}

const yes = (a: string) => /^(y|yes)$/i.test(a);

interface InstallFlags {
  providers?: string;
  assistant?: string;
  scope?: string;
  global?: boolean;
  yes?: boolean;
  "dry-run"?: boolean;
  dir?: string;
}

/**
 * `leanprompt install` (and its alias `init`): detect the assistants, choose the scope, show the files,
 * confirm, write, and say what to type next. Without a terminal and without `--yes` it shows the plan
 * and exits 1 without writing.
 */
export async function installCommand(args: string[], io: Io = terminalIo(), name: "install" | "init" = "install"): Promise<number> {
  let values: InstallFlags;
  try {
    values = parseArgs({ args, options: optionsFor(name), strict: true }).values as InstallFlags;
  } catch (e) {
    io.err(`leanprompt: ${(e as Error).message}`);
    return 2;
  }
  let assistants: Assistant[] | undefined;
  if (values.providers !== undefined && values.assistant !== undefined) {
    io.err("leanprompt: give --providers or --assistant, not both");
    return 2;
  }
  if (values.providers !== undefined) {
    const p = parseProviders(values.providers);
    if (typeof p === "string") {
      io.err(`leanprompt: ${p}`);
      return 2;
    }
    assistants = p;
  }
  if (values.assistant !== undefined) {
    if (!(ASSISTANTS as readonly string[]).includes(values.assistant)) {
      io.err(`leanprompt: unknown assistant "${values.assistant}"; use ${ASSISTANTS.join(", ")}`);
      return 2;
    }
    assistants = [values.assistant as Assistant];
  }
  if (values.scope !== undefined && values.scope !== "project" && values.scope !== "global") {
    io.err(`leanprompt: --scope must be project or global, not "${values.scope}"`);
    return 2;
  }
  if (values.global === true && values.scope === "project") {
    io.err("leanprompt: --global and --scope=project disagree; give one");
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  const home = resolve(homedir());
  const dry = values["dry-run"] === true;

  let scope: Scope | undefined = values.global === true ? "global" : (values.scope as Scope | undefined);
  if (scope === undefined && io.interactive && !dry) {
    io.out("Install for this project or for all your projects?");
    io.out(`  1. this project (${dir})`);
    io.out("  2. all your projects (your home folder)");
    const a = (await io.ask("Choose 1 or 2 [1]: ")).toLowerCase();
    scope = a === "2" || a === "global" || a === "all" ? "global" : "project";
  }
  scope ??= "project";
  const global = scope === "global";

  const opts = { dir, home, global, ...(assistants ? { assistants } : {}) };
  const plan = init({ ...opts, dryRun: true });
  const base = global ? home : dir;
  const show = (p: string) => (global ? "~/" : "") + relative(base, p).split(sep).join("/");

  io.out("Found:");
  for (const d of plan.detected) io.out(`  ${ASSISTANT_NAMES[d.assistant]} (${d.assistant}): ${d.why}`);
  if (assistants === undefined) io.out(`  To choose instead: --providers=${ASSISTANTS.join(",")} (any of them)`);
  io.out(`Scope: ${global ? "all your projects (~)" : `this project (${dir})`}`);
  for (const n of plan.notes) io.out(n);

  const changes = plan.written.length + plan.updated.length;
  printPlan(plan, show, io, dry);
  if (dry) {
    io.out("dry run: nothing was written");
    return 0;
  }
  if (changes === 0) {
    io.out("Nothing to write.");
    printNext(plan, scope, io);
    return 0;
  }
  if (values.yes !== true) {
    if (!io.interactive) {
      io.out("Nothing written: there is no terminal to confirm in. Run again with --yes to write these files.");
      return 1;
    }
    const a = await io.ask(`Write these ${changes} file${changes === 1 ? "" : "s"}? [y/N] `);
    if (!yes(a)) {
      io.out("Nothing written.");
      return 1;
    }
  }

  const r = init({ ...opts, dryRun: false });
  const failed = r.skippedWhy.filter((s) => s.reason.startsWith("cannot write"));
  for (const s of failed) io.err(`  could not write ${show(s.path)}: ${s.reason}`);
  io.out(`Wrote ${r.written.length} new file${r.written.length === 1 ? "" : "s"}, updated ${r.updated.length}.`);
  io.out("Reload your assistant so it sees the new skills.");
  printNext(r, scope, io);
  return failed.length > 0 ? 1 : 0;
}

function printPlan(r: InitResult, show: (p: string) => string, io: Io, dry: boolean): void {
  if (r.written.length > 0) {
    io.out(`${dry ? "Would write" : "Will write"} ${r.written.length} new file${r.written.length === 1 ? "" : "s"}:`);
    for (const p of r.written) io.out(`  ${dry ? "would write" : "write"} ${show(p)}`);
  }
  if (r.updated.length > 0) {
    io.out(`${dry ? "Would update" : "Will update"} ${r.updated.length} file${r.updated.length === 1 ? "" : "s"}:`);
    for (const p of r.updated) io.out(`  ${dry ? "would update" : "update"} ${show(p)}${basename(p) === "AGENTS.md" ? " (only the leanprompt block)" : ""}`);
  }
  const skippedNew = r.skippedWhy.filter((s) => s.reason !== "already up to date");
  for (const s of skippedNew) io.out(`  skip ${show(s.path)}: ${s.reason}`);
  const same = r.skippedWhy.length - skippedNew.length;
  if (same > 0) io.out(`  ${same} file${same === 1 ? "" : "s"} already up to date`);
}

function printNext(r: InitResult, scope: Scope, io: Io): void {
  const served = r.detected.map((d) => d.assistant).filter((a) => !(scope === "global" && a === "agents-md"));
  // claude plus an AGENTS.md reader share the claude copy; the AGENTS.md line adds nothing for them.
  const lines = served.filter((a) => !(a === "agents-md" && served.length > 1)).map((a) => nextStep(a, scope));
  for (const l of lines) io.out(l);
}

interface UpdateFlags {
  scope?: string;
  "dry-run"?: boolean;
  dir?: string;
}

/** `leanprompt update`: refresh what install wrote, in each scope where it is found. */
export async function updateCommand(args: string[], io: Io = terminalIo()): Promise<number> {
  let values: UpdateFlags;
  try {
    values = parseArgs({ args, options: optionsFor("update"), strict: true }).values as UpdateFlags;
  } catch (e) {
    io.err(`leanprompt: ${(e as Error).message}`);
    return 2;
  }
  if (values.scope !== undefined && values.scope !== "project" && values.scope !== "global") {
    io.err(`leanprompt: --scope must be project or global, not "${values.scope}"`);
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  const home = resolve(homedir());
  const dry = values["dry-run"] === true;
  const scopes: Scope[] = values.scope ? [values.scope as Scope] : ["project", "global"];
  const r = update({ dir, home, scopes, dryRun: dry });
  const show = (p: string) => {
    if (p === dir || p.startsWith(dir + sep)) return relative(dir, p).split(sep).join("/") || ".";
    if (p === home || p.startsWith(home + sep)) return "~/" + relative(home, p).split(sep).join("/");
    return p;
  };
  for (const n of r.notes) io.out(n.split(dir + sep).join("").split(home + sep).join("~/"));
  if (r.found.length === 0) {
    io.out(`No leanprompt install found ${values.scope === "global" ? "in your home folder" : values.scope === "project" ? `in ${dir}` : `in ${dir} or your home folder`}. Run leanprompt install first.`);
    return 0;
  }
  io.out("Found leanprompt in:");
  for (const f of r.found) io.out(`  ${f.scope}: ${show(f.path)}`);
  for (const p of r.written) io.out(`  ${dry ? "would add" : "added"} ${show(p)}`);
  for (const p of r.updated) io.out(`  ${dry ? "would update" : "updated"} ${show(p)}`);
  const left = r.skippedWhy.filter((s) => s.reason !== "already up to date");
  for (const s of left) io.out(`  left ${show(s.path)}: ${s.reason}`);
  const same = r.skippedWhy.length - left.length;
  if (r.written.length + r.updated.length === 0) io.out(`Already up to date (${same} file${same === 1 ? "" : "s"}).`);
  else io.out(`${dry ? "dry run: nothing was written. " : ""}${r.written.length} added, ${r.updated.length} updated, ${same} already up to date.`);
  if (!dry && r.written.length + r.updated.length > 0) io.out("Reload your assistant so it sees the new version.");
  return r.skippedWhy.some((s) => s.reason.startsWith("cannot write")) ? 1 : 0;
}
