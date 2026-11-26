import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRuleIds } from "../../src/lint/rules.js";
import { parseFindings, staticScore, type Finding, type Weights } from "../../src/score/static.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const IDS = new Set(["LP-PC-01", "LP-GE-01"]);
const f = (o: Partial<Finding> = {}): Finding => ({
  rule: "LP-PC-01", file: "a.ts", line: 1, saves: "prefill", severity: "high", ...o,
});
const file = (findings: unknown[], v: unknown = 1) => JSON.stringify({ v, findings });
const W = (o: Partial<Weights> = {}): Weights => ({
  v: 1, shares: { high: 0.5, medium: 0.2, low: 0.05 }, k_prefill: 1, k_gen: 1, source: "real", calls: 100, date: "2026-11-26", ...o,
});

describe("staticScore", () => {
  it("no findings gives 100", () => {
    expect(staticScore([])).toEqual({ score: 100, inputs: { E: 1, S: 1, G: 0 }, weights: "default", default_shares: { used: 0, of: 0 } });
  });
  it("one high prefill finding gives 70", () => {
    const r = staticScore([f()]);
    expect(r.inputs).toEqual({ E: 0.5, S: 1, G: 0 });
    expect(r.score).toBe(70);
  });
  it("prefill shares multiply", () => {
    expect(staticScore([f(), f()]).inputs.E).toBe(0.25);
  });
  it("one medium generation finding gives G 0.2 and 92", () => {
    const r = staticScore([f({ saves: "generation", severity: "medium" })]);
    expect(r.inputs.G).toBeCloseTo(0.2);
    expect(r.score).toBe(92);
  });
  it("default low share is 0.05", () => {
    expect(staticScore([f({ severity: "low" })]).inputs.E).toBe(0.95);
  });
  it("both counts on both sides", () => {
    const r = staticScore([f({ saves: "both", severity: "medium" })]);
    expect(r.inputs.E).toBeCloseTo(0.8);
    expect(r.inputs.G).toBeCloseTo(0.2);
  });
  it("fixed findings are ignored", () => {
    expect(staticScore([f({ fixed: true })]).score).toBe(100);
  });
  it("explicit share overrides the severity default", () => {
    expect(staticScore([f({ share: 0.1 })]).inputs.E).toBeCloseTo(0.9);
  });
  it("weights scale default shares by k, capped at 0.95, and mark calibrated", () => {
    const r = staticScore([f()], W({ k_prefill: 3 }));
    expect(r.weights).toBe("calibrated");
    expect(r.inputs.E).toBeCloseTo(0.05);
    expect(staticScore([f({ saves: "generation" })], W({ k_gen: 0.5 })).inputs.G).toBeCloseTo(0.25);
  });
  it("weights do not scale an explicit share", () => {
    expect(staticScore([f({ share: 0.1 })], W({ k_prefill: 3 })).inputs.E).toBeCloseTo(0.9);
  });
});

describe("staticScore default shares", () => {
  it("counts the scored findings that used a severity default share, calibrated or not", () => {
    const fs = [f(), f({ share: 0.1 }), f({ severity: "low" }), f({ fixed: true })];
    expect(staticScore(fs).default_shares).toEqual({ used: 2, of: 3 });
    expect(staticScore(fs, W({ k_prefill: 2 })).default_shares).toEqual({ used: 2, of: 3 });
    expect(staticScore([]).default_shares).toEqual({ used: 0, of: 0 });
  });
});

describe("parseFindings", () => {
  it("parses a valid file", () => {
    const r = parseFindings(file([f(), f({ rule: "LP-GE-01", saves: "generation", share: 0.3, fixed: true })]), IDS);
    expect(r.errors).toEqual([]);
    expect(r.findings).toHaveLength(2);
  });
  it("unknown rule id is an error and the finding is dropped", () => {
    const r = parseFindings(file([f({ rule: "LP-PC-99" })]), IDS);
    expect(r.findings).toEqual([]);
    expect(r.errors[0]).toMatch(/unknown rule LP-PC-99/);
  });
  it("validates every field", () => {
    const bad = [
      { ...f(), file: "" }, { ...f(), line: 0 }, { ...f(), line: 1.5 }, { ...f(), saves: "x" },
      { ...f(), severity: "x" }, { ...f(), share: 1.1 }, { ...f(), share: -0.1 }, { ...f(), fixed: "yes" }, "str",
    ];
    const r = parseFindings(file(bad), IDS);
    expect(r.findings).toEqual([]);
    expect(r.errors).toHaveLength(bad.length);
  });
  it("accepts share 0 and 1", () => {
    expect(parseFindings(file([f({ share: 0 }), f({ share: 1 })]), IDS).errors).toEqual([]);
  });
  it("reports bad json, bad version, missing findings array", () => {
    expect(parseFindings("{", IDS).errors[0]).toMatch(/not valid JSON/);
    expect(parseFindings(file([], 2), IDS).errors[0]).toMatch(/v must be 1/);
    expect(parseFindings(JSON.stringify({ v: 1 }), IDS).errors[0]).toMatch(/findings must be an array/);
  });
  it("accepts a finding outside the repository: file <external> with where, line optional or 0", () => {
    const ext = { rule: "LP-PC-01", file: "<external>", saves: "prefill", severity: "high", where: "engine launch flags", status: "needs-facts", confirm: "the server's block size", share: 0.4 };
    const r = parseFindings(file([ext, { ...ext, line: 0 }]), IDS);
    expect(r.errors).toEqual([]);
    expect(r.findings[0]).toEqual({ ...ext, line: 0 });
    expect(r.findings[1]!.line).toBe(0);
  });
  it("validates external and needs-facts findings", () => {
    const ext = { rule: "LP-PC-01", file: "<external>", saves: "prefill", severity: "high", where: "engine launch flags" };
    const cases: [unknown, RegExp][] = [
      [{ ...ext, where: undefined }, /in <external> needs `where`/],
      [{ ...ext, where: "" }, /<external> needs `where`/],
      [{ ...ext, line: -1 }, /line must be 0 or a positive integer/],
      [{ ...ext, status: "needs-facts" }, /needs-facts finding needs `confirm`/],
      [{ ...ext, status: "maybe", confirm: "x" }, /status must be needs-facts/],
      [{ ...f(), line: 0 }, /line must be a positive integer/],
      [{ ...f(), where: 3 }, /where must be a non-empty string/],
    ];
    for (const [c, re] of cases) {
      const r = parseFindings(file([c]), IDS);
      expect(r.findings, String(re)).toEqual([]);
      expect(r.errors[0], String(re)).toMatch(re);
    }
    // an in-repo finding may also wait on facts
    expect(parseFindings(file([{ ...f(), status: "needs-facts", confirm: "the traffic share" }]), IDS).errors).toEqual([]);
  });
  it("an external or needs-facts finding counts in the static score like any other", () => {
    const ext: Finding = { rule: "LP-PC-01", file: "<external>", line: 0, saves: "prefill", severity: "high", where: "engine launch flags", status: "needs-facts", confirm: "block size" };
    expect(staticScore([ext])).toEqual(staticScore([f()]));
  });
  it("accepts real rule ids from skills/*/rules", () => {
    const ids = loadRuleIds(ROOT);
    expect(ids.has("LP-PC-01")).toBe(true);
    expect(ids.has("LP-GE-10")).toBe(true);
    expect(parseFindings(file([f({ rule: "LP-GE-10" })]), ids).errors).toEqual([]);
  });
});

describe("parseFindings: the plain-English fields and token estimates", () => {
  const words = {
    problem: "The app retries a cut-off answer unchanged.", change: "Read finish_reason and raise the budget.",
    why: "Each retry pays the whole prompt again.", estimate: "about 138k tokens per 1,000 calls",
    assumptions: "5% of calls truncate", verify: "No retry follows a length stop.",
  };
  it("keeps problem, change, why, estimate, assumptions, verify, model and tokens_per_1k", () => {
    const tokens = { prompt: 1000, uncached: 2000, output: 300, measured_calls: 120 };
    const r = parseFindings(file([{ ...f(), ...words, model: "example-model", tokens_per_1k: tokens }]), IDS);
    expect(r.errors).toEqual([]);
    expect(r.findings[0]).toEqual({ ...f(), ...words, model: "example-model", tokens_per_1k: tokens });
  });
  it("old files without them stay valid", () => {
    expect(parseFindings(file([f()]), IDS).findings[0]).toEqual(f());
  });
  it("rejects empty, non-string and over-long text fields", () => {
    for (const k of Object.keys(words)) {
      for (const v of ["", "  ", 3, "x".repeat(601)]) {
        const r = parseFindings(file([{ ...f(), [k]: v }]), IDS);
        expect(r.findings, `${k}=${String(v).slice(0, 5)}`).toEqual([]);
        expect(r.errors[0]).toMatch(new RegExp(`${k} must be`));
      }
      expect(parseFindings(file([{ ...f(), [k]: "x".repeat(600) }]), IDS).errors).toEqual([]);
    }
  });
  it("validates tokens_per_1k and model", () => {
    for (const t of [3, [], { prompt: -1 }, { output: "9" }, { uncached: Infinity }, { measured_calls: 1.5 }, { other: 1 }, {}]) {
      const r = parseFindings(file([{ ...f(), tokens_per_1k: t }]), IDS);
      expect(r.findings, JSON.stringify(t)).toEqual([]);
      expect(r.errors[0]).toMatch(/tokens_per_1k/);
    }
    expect(parseFindings(file([{ ...f(), model: "" }]), IDS).errors[0]).toMatch(/model must be/);
  });
  it("reads an optional average_call for the share of the bill", () => {
    const ok = parseFindings(JSON.stringify({ v: 1, average_call: { prompt_tokens: 4500, output_tokens: 900 }, findings: [] }), IDS);
    expect(ok.errors).toEqual([]);
    expect(ok.average_call).toEqual({ prompt_tokens: 4500, output_tokens: 900 });
    const bad = parseFindings(JSON.stringify({ v: 1, average_call: { prompt_tokens: -1 }, findings: [] }), IDS);
    expect(bad.errors[0]).toMatch(/average_call/);
  });
});
