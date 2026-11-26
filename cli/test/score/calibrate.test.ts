import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheFacts } from "../../src/facts.js";
import type { UsageRecord } from "../../src/log/record.js";
import { calibrate, calibrateCommand } from "../../src/score/calibrate.js";
import { measuredScore } from "../../src/score/measured.js";
import { staticScore, type Finding } from "../../src/score/static.js";
import { loadWeights } from "../../src/score/write.js";

const PLAIN: CacheFacts = { mode: "automatic", min_tokens: 0, ttl_seconds: 0 };
const factsFor = () => PLAIN;
/** Token unit: 128 divides the real providers' cache steps, so the numbers stay exact. */
const U = 128;
const T0 = Date.parse("2026-11-20T10:00:00.000Z");

/**
 * n calls of one conversation with the same prompt, so S = 1 and E = cachedPct / 100.
 * The first call has nothing to reuse. `bad` calls carry parse_failed and `out` output tokens each.
 */
const log = (n: number, cachedPct: number, o: { bad?: number; out?: number } = {}): UsageRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    v: 1, ts: new Date(T0 + i * 1000).toISOString(), provider: "openai", model: "m", dialect: "openai.chat",
    ids: { conv: "c1", head: "h", nodes: ["a"] }, node_chars: [100], breakpoints: [], params: `p${i}`,
    prompt_tokens: 100 * U, cached_tokens: i === 0 ? 0 : cachedPct * U, cache_write_tokens: 0,
    output_tokens: (o.out ?? 0) * U, finish: "stop" as const, flags: i < (o.bad ?? 0) ? { parse_failed: true as const } : {},
  }));

const F = (o: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "app.ts", line: 1, saves: "prefill", severity: "high", ...o });
const okc = (r: ReturnType<typeof calibrate>) => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
};
const opts = { source: "real" as const, factsFor, date: "2026-11-26" };

describe("calibrate", () => {
  it("fits k_prefill so the static E x S meets the measured 0.7", () => {
    const records = log(60, 70);
    const m = measuredScore(records, factsFor);
    if (!m.ok) throw new Error("no score");
    expect(m.inputs.E * m.inputs.S).toBeCloseTo(0.7, 5);
    const r = okc(calibrate([F()], records, opts));
    const s = staticScore([F()], r.weights);
    expect(Math.abs(s.inputs.E * s.inputs.S - 0.7)).toBeLessThan(0.005);
    expect(Math.abs(r.after.static - r.before.measured)).toBeLessThanOrEqual(1);
    expect(r.weights.shares).toEqual({ high: 0.5, medium: 0.2, low: 0.05 });
    expect(r.weights.calls).toBe(60);
    expect(r.weights.date).toBe("2026-11-26");
    expect(r.not_calibratable).toEqual(["generation"]);
    expect(r.weights.k_gen).toBe(1);
  });

  it("fits k_gen to the measured G", () => {
    const records = log(60, 100, { bad: 6, out: 10 }); // G = 0.1
    const fs = [F(), F({ rule: "LP-GE-01", saves: "generation", severity: "medium" })];
    const r = okc(calibrate(fs, records, opts));
    expect(r.not_calibratable).toEqual([]);
    expect(Math.abs(staticScore(fs, r.weights).inputs.G - 0.1)).toBeLessThan(0.005);
    expect(Math.abs(r.after.static - r.before.measured)).toBeLessThanOrEqual(1);
  });

  it("leaves the measured score unchanged", () => {
    const records = log(60, 70);
    const before = measuredScore(records, factsFor);
    okc(calibrate([F()], records, opts));
    expect(measuredScore(records, factsFor)).toEqual(before);
  });

  it("refuses a log under 50 calls and empty findings", () => {
    expect(calibrate([F()], log(49, 70), opts)).toEqual({ ok: false, reason: "too_few_calls", calls: 49 });
    expect(calibrate([], log(60, 70), opts)).toEqual({ ok: false, reason: "no_findings" });
    expect(calibrate([F({ fixed: true })], log(60, 70), opts)).toEqual({ ok: false, reason: "no_findings" });
  });

  it("records the source", () => {
    expect(okc(calibrate([F()], log(60, 70), { ...opts, source: "synthetic" })).weights.source).toBe("synthetic");
  });

  it("calibrated weights mark the static score as calibrated", () => {
    const r = okc(calibrate([F()], log(60, 70), opts));
    expect(staticScore([F()], r.weights).weights).toBe("calibrated");
  });

  it("measured E x S = 0 is capped at the smallest k that reaches the cap, and no share passes 0.95", () => {
    const records = log(60, 0);
    // smallest k at which the default share reaches 0.95
    for (const [sev, k] of [["high", 1.9], ["medium", 4.75], ["low", 19]] as const) {
      const r = okc(calibrate([F({ severity: sev })], records, opts));
      expect(r.fit.prefill).toBe("capped");
      expect(r.weights.k_prefill).toBeCloseTo(k, 3);
      expect(r.limit.prefill).toBeCloseTo(0.05, 9);
      expect(staticScore([F({ severity: sev })], r.weights).inputs.E).toBeGreaterThanOrEqual(0.05 - 1e-12);
    }
  });

  it("measured E x S = 1 is an exact fit with k = 0", () => {
    const r = okc(calibrate([F()], log(60, 100), opts));
    expect(r.fit.prefill).toBe("exact");
    expect(r.weights.k_prefill).toBe(0);
    expect(r.limit).toEqual({});
  });

  it("measured G above the cap-limited maximum is capped", () => {
    const fs = [F(), F({ rule: "LP-GE-01", saves: "generation", severity: "medium" })];
    const r = okc(calibrate(fs, log(60, 70, { bad: 60, out: 10 }), opts)); // G = 1
    expect(r.fit.generation).toBe("capped");
    expect(r.fit.prefill).toBe("exact");
    expect(r.weights.k_gen).toBeCloseTo(4.75, 3);
    expect(r.limit.generation).toBeCloseTo(0.95, 9);
    expect(staticScore(fs, r.weights).inputs.G).toBeCloseTo(0.95, 9);
  });

  it("explicit shares that already overshoot the target make that side unreachable, k = 1", () => {
    const fs = [F({ share: 0.5 }), F({ severity: "high" }), F({ rule: "LP-GE-01", saves: "generation", severity: "low" })];
    const r = okc(calibrate(fs, log(60, 90, { bad: 6, out: 10 }), opts)); // E x S = 0.9 > 0.5
    expect(r.fit.prefill).toBe("unreachable");
    expect(r.weights.k_prefill).toBe(1);
    expect(r.not_calibratable).toEqual(["prefill"]);
    expect(r.fit.generation).toBe("exact");
  });

  it("writes nothing when both sides are unreachable or have no default finding", () => {
    const fs = [F({ share: 0.5 }), F({ severity: "high" })];
    expect(calibrate(fs, log(60, 90), opts)).toEqual({ ok: false, reason: "not_calibratable" });
  });

  it("a side whose findings all carry an explicit share is not calibratable", () => {
    const fs = [F({ share: 0.3 }), F({ rule: "LP-GE-01", saves: "generation", share: 0.2 })];
    expect(calibrate(fs, log(60, 70), opts)).toEqual({ ok: false, reason: "not_calibratable" });
    const mixed = [F({ share: 0.3 }), F({ rule: "LP-GE-01", saves: "generation", severity: "low" })];
    const r = okc(calibrate(mixed, log(60, 70, { bad: 6, out: 10 }), opts));
    expect(r.fit.prefill).toBe("none");
    expect(r.not_calibratable).toEqual(["prefill"]);
    expect(r.weights.k_prefill).toBe(1);
  });

  it("an explicit share is not scaled, only defaults are fitted around it", () => {
    const fs = [F({ share: 0.2 }), F({ severity: "medium" })];
    const r = okc(calibrate(fs, log(60, 70), opts));
    const s = staticScore(fs, r.weights);
    expect(Math.abs(s.inputs.E - 0.7)).toBeLessThan(0.005);
  });

  it("reports the prompt-token share of all tokens", () => {
    const r = okc(calibrate([F()], log(60, 70, { out: 100 }), opts));
    expect(r.split.prefill_cost_share).toBeCloseTo(0.5, 5);
  });
});

describe("calibrate command", () => {
  let dir: string;
  let out: string;
  let err: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lp-cal-"));
    mkdirSync(join(dir, ".leanprompt"));
    out = "";
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  const put = (name: string, text: string) => writeFileSync(join(dir, ".leanprompt", name), text);
  const setup = (findings: object[] = [{ rule: "LP-PC-01", file: "app.ts", line: 3, saves: "prefill", severity: "high" }], n = 60) => {
    put("findings.json", JSON.stringify({ v: 1, findings }));
    put("usage.jsonl", log(n, 70).map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
  const weightsPath = () => join(dir, ".leanprompt", "weights.json");

  it("--yes writes weights that pass loadWeights, with source and before/after printed", async () => {
    setup();
    expect(await calibrateCommand(["--dir", dir, "--yes", "--synthetic"])).toBe(0);
    const w = loadWeights(weightsPath())!;
    expect(w.source).toBe("synthetic");
    expect(w.shares).toEqual({ high: 0.5, medium: 0.2, low: 0.05 });
    expect(out).toContain("static score before");
    expect(out).toContain("static score after");
    expect(out).toContain("not calibratable");
  });

  it("prints the capped fit and the achievable value", async () => {
    put("findings.json", JSON.stringify({ v: 1, findings: [{ rule: "LP-PC-01", file: "app.ts", line: 3, saves: "prefill", severity: "high" }] }));
    put("usage.jsonl", log(60, 0).map((r) => JSON.stringify(r)).join("\n") + "\n");
    expect(await calibrateCommand(["--dir", dir, "--yes"])).toBe(0);
    expect(out).toContain("capped: shares hit the 0.95 limit; static E x S cannot go lower than 0.05");
  });

  it("asks, and writes only on y", async () => {
    setup();
    const confirm = vi.fn(async () => true);
    expect(await calibrateCommand(["--dir", dir], { confirm, isTTY: true })).toBe(0);
    expect(confirm).toHaveBeenCalledWith("write .leanprompt/weights.json? [y/N] ");
    expect(existsSync(weightsPath())).toBe(true);
  });

  it("writes nothing on n", async () => {
    setup();
    expect(await calibrateCommand(["--dir", dir], { confirm: async () => false, isTTY: true })).toBe(0);
    expect(existsSync(weightsPath())).toBe(false);
    expect(out).toContain("not written");
  });

  it("without a terminal and without --yes writes nothing and says how to re-run", async () => {
    setup();
    expect(await calibrateCommand(["--dir", dir], { isTTY: false })).toBe(1);
    expect(existsSync(weightsPath())).toBe(false);
    expect(err).toContain("--yes");
  });

  it("applies the profile ignore list, as score --static does", async () => {
    setup([
      { rule: "LP-PC-01", file: "app.ts", line: 3, saves: "prefill", severity: "high" },
      { rule: "LP-PC-02", file: "other.ts", line: 1, saves: "prefill", severity: "high" },
    ]);
    writeFileSync(join(dir, "leanprompt.yaml"), "ignore:\n  - rule: LP-PC-02\n    file: other.ts\n");
    expect(await calibrateCommand(["--dir", dir, "--yes"])).toBe(0);
    const w = loadWeights(weightsPath())!;
    // Only one high finding remains: E = 1 - min(0.95, 0.5 k) = 0.7, so k = 0.6.
    expect(w.k_prefill).toBeCloseTo(0.6, 3);
  });

  it("refuses a short log without writing", async () => {
    setup(undefined, 10);
    expect(await calibrateCommand(["--dir", dir, "--yes"])).toBe(1);
    expect(err).toContain("at least 50");
    expect(existsSync(weightsPath())).toBe(false);
  });

  it("is reachable as `leanprompt calibrate`", async () => {
    const { commands } = await import("../../src/main.js");
    expect(typeof commands.calibrate).toBe("function");
  });
});
