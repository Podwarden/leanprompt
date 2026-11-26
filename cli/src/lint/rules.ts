import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { parseDoc } from "../frontmatter.js";
import { isMain } from "../isMain.js";

/** A path for display: always "/" separators, whatever the OS. */
export const posix = (p: string): string => p.split(sep).join("/");

export interface LintIssue {
  file: string;
  level: "error" | "warn";
  msg: string;
}

export const REQUIRED_SECTIONS = ["Rule", "Why", "Detect in code", "Fix", "Don't break meaning", "Verify", "Waste signal"];
const SKILL_CODES: Record<string, string> = { PC: "prefill-cache", GE: "generation-economy", LW: "lmwarden" };
const ID_RE = /^LP-(PC|GE|LW)-\d{2}$/;
const SAVES = ["prefill", "generation", "both"];
const SEVERITY = ["high", "medium", "low"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ids from the `| E<n> |` rows of docs/evidence.md. */
export function loadEvidenceIds(root: string): Set<string> {
  const ids = new Set<string>();
  const p = join(root, "docs", "evidence.md");
  if (!existsSync(p)) return ids;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\|\s*(E\d+)\s*\|/.exec(line);
    if (m) ids.add(m[1]!);
  }
  return ids;
}

export function ruleFiles(root: string): string[] {
  const skills = join(root, "skills");
  if (!existsSync(skills)) return [];
  const out: string[] = [];
  for (const s of readdirSync(skills, { withFileTypes: true })) {
    if (!s.isDirectory() || s.name.startsWith("_")) continue;
    const dir = join(skills, s.name, "rules");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".md")) out.push(posix(join("skills", s.name, "rules", f)));
  }
  return out;
}

/** Rule ids (`LP-PC-01`, ...) declared in the skills rules directories; files with bad frontmatter are skipped. */
export function loadRuleIds(root: string): Set<string> {
  const ids = new Set<string>();
  for (const file of ruleFiles(root)) {
    try {
      const id = parseDoc(readFileSync(join(root, file), "utf8")).meta.id;
      if (typeof id === "string" && ID_RE.test(id)) ids.add(id);
    } catch {
      /* lintRules reports it */
    }
  }
  return ids;
}

export function lintRules(root: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const evidence = loadEvidenceIds(root);
  const evidenceMissing = !existsSync(join(root, "docs", "evidence.md"));
  if (evidenceMissing) {
    // One clear error instead of an unknown-evidence error per rule.
    issues.push({ file: "docs/evidence.md", level: "error", msg: "missing docs/evidence.md" });
  }
  const seen = new Map<string, string>();

  for (const file of ruleFiles(root)) {
    const err = (msg: string) => issues.push({ file, level: "error", msg });
    let doc;
    try {
      doc = parseDoc(readFileSync(join(root, file), "utf8"));
    } catch (e) {
      err(`bad frontmatter: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    const { meta, sections } = doc;
    const dirSkill = file.split(/[\\/]/)[1];

    for (const k of ["id", "title", "skill", "applies_to", "saves", "severity", "evidence"]) {
      if (meta[k] === undefined || meta[k] === null || meta[k] === "") err(`missing field: ${k}`);
    }

    const id = meta.id;
    if (id !== undefined) {
      if (typeof id !== "string" || !ID_RE.test(id)) err(`bad id ${String(id)}`);
      else {
        const prev = seen.get(id);
        if (prev) err(`duplicate id ${id} (also in ${prev})`);
        else seen.set(id, file);
        const expected = SKILL_CODES[id.split("-")[1]!];
        if (meta.skill !== undefined && meta.skill !== expected) err(`id ${id} does not match skill ${String(meta.skill)}`);
      }
    }
    if (typeof meta.skill === "string" && meta.skill !== dirSkill) err(`skill ${meta.skill} does not match directory ${dirSkill}`);
    if (meta.applies_to !== undefined && !Array.isArray(meta.applies_to)) err("applies_to must be a list");
    if (meta.saves !== undefined && !SAVES.includes(String(meta.saves))) err(`bad saves ${String(meta.saves)}`);
    if (meta.severity !== undefined && !SEVERITY.includes(String(meta.severity))) err(`bad severity ${String(meta.severity)}`);

    if (meta.evidence !== undefined) {
      if (!Array.isArray(meta.evidence)) err("evidence must be a list");
      else
        for (const ev of meta.evidence as unknown[]) {
          if (typeof ev === "string") {
            if (!evidenceMissing && !evidence.has(ev)) err(`unknown evidence ${ev}`);
          } else if (ev && typeof ev === "object" && "doc" in ev) {
            const e = ev as { doc?: unknown; checked?: unknown };
            const checked = e.checked instanceof Date ? e.checked.toISOString().slice(0, 10) : e.checked;
            if (typeof checked !== "string" || !DATE_RE.test(checked)) err("doc evidence needs checked date");
            if (typeof e.doc !== "string" || !e.doc) err("doc evidence needs doc url");
          } else err("bad evidence entry");
        }
    }

    const headings = sections.map((s) => s.heading);
    let missing = false;
    for (const h of REQUIRED_SECTIONS) {
      if (!headings.includes(h)) {
        err(`missing section: ${h}`);
        missing = true;
      }
    }
    if (!missing) {
      const order = headings.filter((h) => REQUIRED_SECTIONS.includes(h));
      if (order.join("\n") !== REQUIRED_SECTIONS.join("\n")) err("sections out of order");
    }
    for (const s of sections) if (REQUIRED_SECTIONS.includes(s.heading) && !s.body) err(`empty section: ${s.heading}`);
  }
  return issues;
}

// CLI entry for `npm run lint:rules`: lint the repo root, exit 1 on any error.
if (isMain(import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const issues = lintRules(root);
  for (const i of issues) process.stderr.write(`${i.level}: ${i.file}: ${i.msg}\n`);
  const errors = issues.filter((i) => i.level === "error").length;
  process.stdout.write(`lint:rules: ${errors} error(s), ${issues.length - errors} warning(s)\n`);
  process.exit(errors ? 1 : 0);
}
