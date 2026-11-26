// compareFindings() is pure; evalAuditCommand() reads the case's expected file and an assistant's findings.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { optionsFor } from "./help.js";
import { loadRuleIds } from "./lint/rules.js";
import { EXTERNAL, parseFindings, type Finding } from "./score/static.js";
import { PACKAGE_ROOT } from "./score/write.js";

export interface ExpectedFinding {
  rule: string;
  /** Path relative to the case directory, e.g. `before/bot.py`. */
  file: string;
  line: number;
}
export type Expected = readonly ExpectedFinding[];

export interface Comparison {
  /** Share of expected findings that were found, 1 when none were expected. */
  recall: number;
  /** Findings on files under `after/`, where the seeded problems are already fixed. */
  falsePositives: Finding[];
  missed: ExpectedFinding[];
}

/** A finding matches an expected one with the same rule, in the same file, within this many lines. */
export const LINE_TOLERANCE = 3;

function normalize(file: string): string {
  return file.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

/** Each expected finding is matched by at most one reported finding, and each reported finding fills at most one. */
export function compareFindings(expected: Expected, got: readonly Finding[]): Comparison {
  const used = new Set<number>();
  const missed: ExpectedFinding[] = [];
  for (const e of expected) {
    const i = got.findIndex(
      (g, idx) => !used.has(idx) && g.rule === e.rule && normalize(g.file) === normalize(e.file) && Math.abs(g.line - e.line) <= LINE_TOLERANCE,
    );
    if (i < 0) missed.push(e);
    else used.add(i);
  }
  const falsePositives = got.filter((g) => normalize(g.file).startsWith("after/"));
  const recall = expected.length === 0 ? 1 : (expected.length - missed.length) / expected.length;
  return { recall, falsePositives, missed };
}

/** Parse an expected file: a JSON array of `{rule, file, line}`. */
export function parseExpected(text: string): Expected {
  const doc: unknown = JSON.parse(text);
  if (!Array.isArray(doc)) throw new Error("expected file must be a JSON array");
  return doc.map((r: unknown, i) => {
    const o = r as Partial<ExpectedFinding> | null;
    if (!o || typeof o.rule !== "string" || typeof o.file !== "string" || !Number.isInteger(o.line)) {
      throw new Error(`expected[${i}] needs rule, file and line`);
    }
    return { rule: o.rule, file: o.file, line: o.line as number };
  });
}

export type Form = "before" | "after";

/** Case name -> directory for `<root>/fixtures/<lang>/<case>`. Throws when two languages use the same case name. */
export function listCases(auditDir: string): Map<string, string> {
  const cases = new Map<string, string>();
  const fixtures = join(auditDir, "fixtures");
  for (const lang of readdirSync(fixtures)) {
    for (const c of readdirSync(join(fixtures, lang))) {
      const dir = join(fixtures, lang, c);
      if (cases.has(c)) throw new Error(`duplicate case name ${c}: ${cases.get(c)} and ${dir}`);
      cases.set(c, dir);
    }
  }
  return cases;
}

/**
 * Map a reported path to `<form>/<path inside the form>`, or null when it matches no file of the case.
 * A `before/` or `after/` segment decides the form and the part after the last such segment is the path.
 * Otherwise the path is relative to the copied folder (possibly absolute under a copy root): leading
 * segments are dropped until the remainder is a file of `defaultForm`.
 */
export function mapPath(caseDir: string, file: string, defaultForm: Form): string | null {
  const segs = file.replace(/\\/g, "/").split("/").filter((x) => x !== "" && x !== ".");
  let at = -1;
  segs.forEach((x, i) => {
    if (x === "before" || x === "after") at = i;
  });
  const isFile = (form: Form, parts: string[]): boolean => {
    const p = join(caseDir, form, ...parts);
    return parts.length > 0 && existsSync(p) && statSync(p).isFile();
  };
  if (at >= 0) {
    const form = segs[at] as Form;
    const rest = segs.slice(at + 1);
    return isFile(form, rest) ? `${form}/${rest.join("/")}` : null;
  }
  for (let i = 0; i < segs.length; i++) {
    if (isFile(defaultForm, segs.slice(i))) return `${defaultForm}/${segs.slice(i).join("/")}`;
  }
  return null;
}

export async function evalAuditCommand(args: string[]): Promise<number> {
  const fail = (msg: string): number => {
    process.stderr.write(`leanprompt: ${msg}\n`);
    return 2;
  };
  let parsed: { values: { form?: string }; positionals: string[] };
  try {
    parsed = parseArgs({ args, options: optionsFor("eval-audit"), allowPositionals: true, strict: true });
  } catch (e) {
    return fail((e as Error).message);
  }
  const form = parsed.values.form ?? "before";
  if (form !== "before" && form !== "after") return fail("--form must be before or after");
  const [caseArg, findingsArg] = parsed.positionals;
  if (parsed.positionals.length !== 2) return fail("usage: leanprompt eval-audit <case-dir> <findings.json> [--form before|after]");
  const caseDir = resolve(caseArg!);
  const findingsPath = resolve(findingsArg!);
  if (!existsSync(caseDir) || !statSync(caseDir).isDirectory()) return fail(`case directory not found: ${caseArg}`);
  if (!existsSync(findingsPath)) return fail(`findings file not found: ${findingsArg}`);
  const auditDir = join(PACKAGE_ROOT, "eval", "audit");
  try {
    listCases(auditDir);
  } catch (e) {
    return fail((e as Error).message);
  }
  const expectedPath = join(auditDir, "expected", `${basename(caseDir)}.json`);
  if (!existsSync(expectedPath)) return fail(`no expected file for case ${basename(caseDir)} (looked for ${expectedPath})`);

  let expected: Expected;
  try {
    expected = parseExpected(readFileSync(expectedPath, "utf8"));
  } catch (e) {
    return fail(`${expectedPath}: ${(e as Error).message}`);
  }
  const { findings, errors } = parseFindings(readFileSync(findingsPath, "utf8"), loadRuleIds(PACKAGE_ROOT));
  if (errors.length > 0 && findings.length === 0) return fail(`invalid findings file: ${errors.join("; ")}`);
  for (const e of errors) process.stderr.write(`leanprompt: warning: ${e}\n`);

  const got: Finding[] = [];
  const unmatched: Finding[] = [];
  // A finding outside the repository has no file in the case to match: it counts toward neither
  // recall nor false positives. The seeded cases expect none.
  const external = findings.filter((f) => f.file === EXTERNAL).length;
  for (const f of findings) {
    if (f.file === EXTERNAL) continue;
    const mapped = mapPath(caseDir, f.file, form);
    if (mapped === null) unmatched.push(f);
    else got.push({ ...f, file: mapped });
  }
  for (const f of unmatched) process.stderr.write(`leanprompt: warning: ${f.file} matches no file of the ${form} form of this case; not counted\n`);

  const { recall, missed, falsePositives } = compareFindings(expected, got);
  const out = [`case: ${basename(caseDir)} (${form} run)`];
  if (form === "before") {
    out.push(`recall: ${recall.toFixed(2)} (${expected.length - missed.length}/${expected.length})`);
    out.push(`missed: ${missed.length}`, ...missed.map((m) => `  ${m.rule} ${m.file}:${m.line}`));
  } else {
    out.push("recall: not measured on an after run");
  }
  out.push(`false positives: ${falsePositives.length}`, ...falsePositives.map((f) => `  ${f.rule} ${f.file}:${f.line}`));
  out.push(`unmatched paths: ${unmatched.length}`, ...unmatched.map((f) => `  ${f.rule} ${f.file}:${f.line}`));
  if (external > 0) out.push(`external findings: ${external} (not counted)`);
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
