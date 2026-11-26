import { mkdirSync, mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareFindings, evalAuditCommand, listCases, type ExpectedFinding } from "../src/evalAudit.js";
import { loadRuleIds } from "../src/lint/rules.js";
import { PACKAGE_ROOT } from "../src/score/write.js";
import type { Finding } from "../src/score/static.js";

afterEach(() => vi.restoreAllMocks());

const exp: ExpectedFinding[] = [{ rule: "LP-PC-01", file: "before/a.py", line: 10 }];
const f = (over: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "before/a.py", line: 10, saves: "prefill", severity: "high", ...over });

describe("compareFindings", () => {
  it("scores an exact match as recall 1 with no false positives", () => {
    expect(compareFindings(exp, [f()])).toEqual({ recall: 1, falsePositives: [], missed: [] });
  });
  it("matches within 3 lines and not at 4", () => {
    expect(compareFindings(exp, [f({ line: 13 })]).recall).toBe(1);
    expect(compareFindings(exp, [f({ line: 7 })]).recall).toBe(1);
    const r = compareFindings(exp, [f({ line: 14 })]);
    expect(r.recall).toBe(0);
    expect(r.missed).toEqual(exp);
  });
  it("needs the same rule and file", () => {
    expect(compareFindings(exp, [f({ rule: "LP-PC-02" })]).recall).toBe(0);
    expect(compareFindings(exp, [f({ file: "before/b.py" })]).recall).toBe(0);
    expect(compareFindings(exp, [f({ file: "./before/a.py" })]).recall).toBe(1);
  });
  it("counts a finding on an after/ file as a false positive", () => {
    const fp = f({ file: "after/a.py" });
    expect(compareFindings(exp, [f(), fp])).toEqual({ recall: 1, falsePositives: [fp], missed: [] });
  });
  it("does not count an unexpected finding on a before/ file as a false positive", () => {
    expect(compareFindings(exp, [f({ rule: "LP-GE-03", line: 50 })]).falsePositives).toEqual([]);
  });
  it("lets one reported finding fill only one expected finding", () => {
    const two = [...exp, { rule: "LP-PC-01", file: "before/a.py", line: 11 }];
    expect(compareFindings(two, [f()]).recall).toBe(0.5);
  });
  it("gives recall 1 when nothing is expected", () => {
    expect(compareFindings([], []).recall).toBe(1);
  });
});

describe("fixtures", () => {
  const dir = join(PACKAGE_ROOT, "eval", "audit");
  const files = readdirSync(join(dir, "expected")).filter((n) => n.endsWith(".json"));
  const cases = listCases(dir);

  it("seed every LP-PC and LP-GE rule at least once", () => {
    const seeded = new Set<string>();
    for (const n of files) for (const e of JSON.parse(readFileSync(join(dir, "expected", n), "utf8")) as ExpectedFinding[]) seeded.add(e.rule);
    const wanted = [...loadRuleIds(PACKAGE_ROOT)].filter((id) => /^LP-(PC|GE)-/.test(id));
    expect(wanted.length).toBe(22);
    expect(wanted.filter((id) => !seeded.has(id))).toEqual([]);
  });

  it("have an expected file for every case and a case for every expected file", () => {
    expect([...cases.keys()].sort()).toEqual(files.map((n) => n.replace(/\.json$/, "")).sort());
  });

  it("reject a case name used in two languages", () => {
    const root = mkdtempSync(join(tmpdir(), "lp-dup-"));
    for (const lang of ["python", "go"]) mkdirSync(join(root, "fixtures", lang, "same"), { recursive: true });
    expect(() => listCases(root)).toThrow(/duplicate case name same/);
  });

  it("have a case directory with before/ and after/ for each expected file, and lines inside the file", () => {
    for (const n of files) {
      const c = n.replace(/\.json$/, "");
      const caseDir = cases.get(c);
      expect(caseDir, c).toBeDefined();
      expect(existsSync(join(caseDir!, "after")), c).toBe(true);
      for (const e of JSON.parse(readFileSync(join(dir, "expected", n), "utf8")) as ExpectedFinding[]) {
        expect(e.file.startsWith("before/"), `${c} ${e.file}`).toBe(true);
        const lines = readFileSync(join(caseDir!, e.file), "utf8").split("\n").length;
        expect(e.line, `${c} ${e.rule}`).toBeLessThanOrEqual(lines);
      }
    }
  });
});

describe("eval-audit command", () => {
  const caseDir = join(PACKAGE_ROOT, "eval", "audit", "fixtures", "python", "support-bot");
  const write = (findings: unknown): string => {
    const p = join(mkdtempSync(join(tmpdir(), "lp-audit-")), "findings.json");
    writeFileSync(p, JSON.stringify(findings));
    return p;
  };
  const run = async (args: string[]) => {
    let out = "";
    let err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
    const code = await evalAuditCommand(args);
    return { code, out, err };
  };
  const doc = (...fs: Partial<Finding>[]) => ({ v: 1, findings: fs.map((x) => f(x)) });

  it("scores a before run with a path relative to the copied folder", async () => {
    const r = await run([caseDir, write(doc({ file: "bot.py", line: 24 }))]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("recall: 0.25 (1/4)");
    expect(r.out).toContain("false positives: 0");
    expect(r.out).toContain("LP-PC-02 before/bot.py");
  });

  it("maps an absolute path under a temp copy of before/", async () => {
    const r = await run([caseDir, write(doc({ file: "/tmp/support-bot/bot.py", line: 24 }))]);
    expect(r.out).toContain("recall: 0.25 (1/4)");
    expect(r.out).toContain("unmatched paths: 0");
  });

  it("takes the part after a before/ segment", async () => {
    const r = await run([caseDir, write(doc({ file: "/tmp/x/before/bot.py", line: 24 }))]);
    expect(r.out).toContain("recall: 0.25 (1/4)");
  });

  it("counts every finding of an after run as a false positive, with absolute or relative paths", async () => {
    const r = await run([caseDir, write(doc({ file: "/tmp/support-bot-after/bot.py", line: 9 }, { file: "bot.py", line: 12, rule: "LP-PC-02" })), "--form", "after"]);
    expect(r.out).toContain("false positives: 2");
    expect(r.out).toContain("recall: not measured");
  });

  it("counts a finding under after/ as a false positive even in a before run", async () => {
    const r = await run([caseDir, write(doc({ file: "/tmp/y/after/bot.py", line: 9 }))]);
    expect(r.out).toContain("false positives: 1");
  });

  it("lists an unmatched path with a warning and counts it nowhere", async () => {
    const r = await run([caseDir, write(doc({ file: "/tmp/support-bot/nothing.py", line: 24 }))]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unmatched paths: 1");
    expect(r.out).toContain("false positives: 0");
    expect(r.out).toContain("recall: 0.00");
    expect(r.err).toContain("nothing.py matches no file");
  });

  it("exits 2 on bad input", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await evalAuditCommand([caseDir])).toBe(2);
    expect(await evalAuditCommand([caseDir, "/nonexistent.json"])).toBe(2);
    expect(await evalAuditCommand([join(caseDir, "before"), write({ v: 1, findings: [] })])).toBe(2);
    expect(await evalAuditCommand([caseDir, write("nope")])).toBe(2);
    expect(await evalAuditCommand([caseDir, write(doc()), "--form", "middle"])).toBe(2);
  });
});
