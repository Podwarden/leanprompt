import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { isMain } from "../isMain.js";
import { loadEvidenceIds, posix, type LintIssue } from "./rules.js";

/** The fields of an `eval/results/*.json` file this check reads (the full type is eval/run.ts `ResultFile`). */
export interface ResultFile {
  kind: "measured" | "simulated";
  app: string;
  form: string;
  provider: string;
  model: string;
  date: string;
  /** The file's basename when it was read from disk; otherwise derived with `resultFileName`. */
  file?: string;
}

// Same file naming as eval/run.ts.
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-");
export function resultFileName(r: ResultFile): string {
  return `${r.date}-${safe(r.app)}-${r.form}-${safe(r.provider)}-${safe(r.model)}.json`;
}

// A number is a claim when it carries one of these units: %, seconds (" s"), a multiplier (3x, 1.5×),
// tokens, or dollars. Plain counts ("50 calls", "40 lines", "8 sessions") and versions are not.
const NUM = String.raw`\d(?:[\d,.]*\d)?`;
const TRIGGERS: RegExp[] = [
  new RegExp(`${NUM}\\s?%`),
  new RegExp(`${NUM} s\\b`),
  new RegExp(`${NUM}(?:x|\\s?×)(?![A-Za-z0-9])`),
  new RegExp(`${NUM}[kKM]? tokens?\\b`),
  /\$\s?\d/,
];
// (E1), (E1, E7), [E7](docs/evidence.md)
const CITATION = /[([]\s*(E\d+(?:\s*[,;]\s*E\d+)*)\s*[)\]]/g;
// Rows that may be cited but not quoted with a number yet (docs/DESIGN.md Q2, Q3): E8 waits on the
// owner's wording approval, E12 on a measured before/after.
export const NOT_QUOTABLE = new Set(["E8", "E12"]);
const RESULT_LINK = /eval\/results\/([^\s)\]"'<>#`]+)/g;

/** Text a reader sees as prose: inline code spans and HTML comments removed. */
function prose(line: string): string {
  return line.replace(/(`+)[\s\S]*?\1/g, " ").replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * Every line that states a number with a unit must cite an evidence row `(E<n>)` that exists, or link
 * a result file under `eval/results/` whose kind is `measured`. Simulated results are never quotable.
 * Fenced code blocks, inline code and HTML comments are ignored.
 */
export function checkNumbers(markdown: string, results: ResultFile[], evidence: Set<string>): LintIssue[] {
  const issues: LintIssue[] = [];
  const byName = new Map(results.map((r) => [r.file ?? resultFileName(r), r]));
  const lines = markdown.split(/\r?\n/);
  let fence: string | null = null;
  let inComment = false;

  lines.forEach((raw, i) => {
    const err = (msg: string) => issues.push({ file: "", level: "error", msg: `line ${i + 1}: ${msg}` });
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (fenceMark && fenceMark[1]![0] === fence[0] && fenceMark[1]!.length >= fence.length && raw.trim() === fenceMark[1]) fence = null;
      return;
    }
    if (fenceMark) {
      fence = fenceMark[1]!;
      return;
    }
    let line = raw;
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) return;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = prose(line);
    const open = line.indexOf("<!--");
    if (open >= 0) {
      line = line.slice(0, open);
      inComment = true;
    }

    const hit = TRIGGERS.map((t) => t.exec(line)).find((m) => m);
    let sourced = false;
    let bad = false;
    for (const m of line.matchAll(CITATION)) {
      for (const id of m[1]!.split(/\s*[,;]\s*/)) {
        if (hit && NOT_QUOTABLE.has(id)) {
          err(`${id} cannot be quoted with a number yet (see docs/DESIGN.md open questions)`);
          bad = true;
        } else if (evidence.has(id)) sourced = true;
        else {
          err(`unknown evidence ${id}`);
          bad = true;
        }
      }
    }
    for (const m of line.matchAll(RESULT_LINK)) {
      const name = m[1]!;
      const r = byName.get(name);
      if (!r) {
        err(`unknown result eval/results/${name}`);
        bad = true;
      } else if (r.kind !== "measured") {
        err(`simulated result cannot be quoted: eval/results/${name}`);
        bad = true;
      } else sourced = true;
    }
    if (sourced || bad) return;
    if (hit) err(`"${hit[0]}" needs a source: cite (E<n>) from docs/evidence.md or link a measured eval/results file`);
  });
  return issues;
}

function markdownUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...markdownUnder(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function loadResults(root: string): ResultFile[] {
  const dir = join(root, "eval", "results");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as ResultFile), file: f }));
}

/** The public copy: README.md and every Markdown file under skills/. */
export function checkNumbersInRepo(root: string): LintIssue[] {
  const evidence = loadEvidenceIds(root);
  const results = loadResults(root);
  const files = [join(root, "README.md"), ...markdownUnder(join(root, "skills"))].filter((f) => existsSync(f));
  const issues: LintIssue[] = [];
  if (!existsSync(join(root, "README.md"))) issues.push({ file: "README.md", level: "error", msg: "missing README.md" });
  for (const f of files) {
    const rel = posix(relative(root, f)) || basename(f);
    for (const i of checkNumbers(readFileSync(f, "utf8"), results, evidence)) issues.push({ ...i, file: rel });
  }
  return issues;
}

// CLI entry for `npm run check:numbers`: check the repo root, exit 1 on any error.
if (isMain(import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const issues = checkNumbersInRepo(root);
  for (const i of issues) process.stderr.write(`${i.level}: ${i.file}: ${i.msg}\n`);
  process.stdout.write(`check:numbers: ${issues.length} error(s)\n`);
  process.exit(issues.length ? 1 : 0);
}
