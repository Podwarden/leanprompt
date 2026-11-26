import { describe, expect, it } from "vitest";
import { costSummary, formatDollars, formatTokens } from "../../src/report/cost.js";
import type { Profile } from "../../src/profile.js";
import type { Finding } from "../../src/score/static.js";

const f = (extra: Partial<Finding> = {}): Finding => ({ rule: "LP-GE-05", file: "a.ts", line: 1, saves: "both", severity: "medium", ...extra });
const base: Profile = { target: { provider: "deepseek" }, priority: { cost: 1, speed: 0, quality: 0 } };
const price = { input: 1, cached_input: 0.1, output: 4, source: "https://example.com/pricing", checked: "2026-11-26" };
const prof = (o: Partial<Profile> = {}): Profile => ({ ...base, volume: { calls_per_month: 100_000 }, prices: { m: price }, ...o });

describe("costSummary", () => {
  it("sums open findings' tokens and leaves open questions apart", () => {
    const s = costSummary(
      [
        f({ tokens_per_1k: { prompt: 1000, output: 500 } }),
        f({ tokens_per_1k: { uncached: 2000 } }),
        f({ tokens_per_1k: { output: 9999 }, fixed: true }),
        f({ file: "<external>", where: "engine", tokens_per_1k: { uncached: 7000 } }),
        f(),
      ],
      null,
    );
    expect(s.tokens_per_1k).toBe(3500);
    expect(s.question_tokens_per_1k).toBe(7000);
    expect(s.with_tokens).toBe(2);
    expect(s.measured).toBe(false);
    expect(s.money).toBeUndefined();
  });

  it("losses: tokens x volume x price, uncached at input less cached input", () => {
    // per 1k calls: 1000 prompt x $1 + 2000 uncached x $0.9 + 500 output x $4 = 1000 + 1800 + 2000 = 4800 token-dollars per 1M
    // => $0.0048 per 1k calls => 100 x 1k calls a month => $0.48
    const s = costSummary([f({ model: "m", tokens_per_1k: { prompt: 1000, uncached: 2000, output: 500 } })], prof());
    expect(s.money?.lost_per_month).toBeCloseTo(0.48, 6);
    expect(s.money?.saved_if_fixed).toBeCloseTo(0.48, 6);
    expect(s.rows[0]!.dollars_per_month).toBeCloseTo(0.48, 6);
  });

  it("gains as a percent of the estimated bill, when the audit gives an average call", () => {
    // bill: 100,000 calls x (4000 x $1 + 1000 x $4) / 1M = $800; loss: 100 x (1M x $1)/1M... below
    const s = costSummary([f({ tokens_per_1k: { prompt: 80_000 } })], prof(), { prompt_tokens: 4000, output_tokens: 1000 });
    // 80,000 prompt tokens per 1k calls x 100 x $1 / 1M = $8 a month
    expect(s.money?.lost_per_month).toBeCloseTo(8, 6);
    expect(s.money?.bill_per_month).toBeCloseTo(800, 6);
    expect(s.money?.percent).toBeCloseTo(1, 6);
  });

  it("counts what fixed findings already save, separately", () => {
    const s = costSummary([f({ tokens_per_1k: { prompt: 10_000 }, fixed: true }), f({ tokens_per_1k: { prompt: 20_000 } })], prof());
    expect(s.money?.lost_per_month).toBeCloseTo(2, 6);
    expect(s.money?.saved_by_fixes).toBeCloseTo(1, 6);
  });

  it("never shows money without a volume and a dated price; says what to add", () => {
    const fs = [f({ tokens_per_1k: { prompt: 1000 } })];
    const noVol = costSummary(fs, { ...prof(), volume: undefined });
    expect(noVol.money).toBeUndefined();
    expect(noVol.missing.join(" ")).toMatch(/volume: \{calls_per_month: N\}/);
    const noPrice = costSummary(fs, { ...prof(), prices: undefined });
    expect(noPrice.money).toBeUndefined();
    expect(noPrice.missing.join(" ")).toMatch(/^prices\t/m);
    expect(costSummary(fs, null).missing.length).toBe(2);
  });

  it("picks the finding's model price, else the only price; with several and no model it does not guess", () => {
    const two = prof({ prices: { m: price, n: { ...price, input: 2 } } });
    const pinned = costSummary([f({ model: "n", tokens_per_1k: { prompt: 10_000 } })], two);
    expect(pinned.money?.lost_per_month).toBeCloseTo(2, 6);
    const unpinned = costSummary([f({ tokens_per_1k: { prompt: 10_000 } })], two);
    expect(unpinned.money).toBeUndefined();
    expect(unpinned.missing.join(" ")).toMatch(/model/);
  });

  it("an uncached estimate with no cached_input price is not priced", () => {
    const p = prof({ prices: { m: { input: 1, output: 4, source: "x", checked: "2026-11-26" } } });
    const s = costSummary([f({ tokens_per_1k: { uncached: 10_000 } })], p);
    expect(s.money).toBeUndefined();
    expect(s.missing.join(" ")).toMatch(/cached_input/);
  });

  it("with targets, the volume is the sum of the entries' volumes, and only when every entry has one", () => {
    const fs = [f({ tokens_per_1k: { prompt: 10_000 } })];
    const t = (a?: number, b?: number): Profile => ({
      ...base,
      target: {},
      prices: { m: price },
      targets: [
        { provider: "x", ...(a ? { volume: { calls_per_month: a } } : {}) },
        { provider: "y", ...(b ? { volume: { calls_per_month: b } } : {}) },
      ],
    });
    expect(costSummary(fs, t(60_000, 40_000)).money?.calls_per_month).toBe(100_000);
    expect(costSummary(fs, t(60_000)).money).toBeUndefined();
  });

  it("self-hosted: GPU prefill hours a month and first-token time from prefill_tokens_per_second", () => {
    const p: Profile = { ...base, target: { engine: "vllm" }, engine: { prefill_tokens_per_second: 10_000 }, volume: { calls_per_month: 360_000 } };
    const s = costSummary([f({ tokens_per_1k: { uncached: 100_000, prompt: 0 } })], p);
    // 100 uncached tokens a call at 10,000/s = 0.01 s per call; 360,000 calls = 3,600 s = 1 h
    expect(s.gpu?.hours_per_month).toBeCloseTo(1, 6);
    expect(s.rows[0]!.ttft_seconds).toBeCloseTo(0.01, 6);
    expect(s.money).toBeUndefined();
  });

  it("labels measured numbers only when every estimate is measured", () => {
    expect(costSummary([f({ tokens_per_1k: { prompt: 1, measured_calls: 80 } })], null).measured).toBe(true);
    expect(costSummary([f({ tokens_per_1k: { prompt: 1, measured_calls: 80 } }), f({ tokens_per_1k: { prompt: 1 } })], null).measured).toBe(false);
  });
});

describe("formatting", () => {
  it("formats tokens and dollars", () => {
    expect(formatTokens(138_000)).toBe("138k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(950)).toBe("950");
    expect(formatDollars(1234.5)).toBe("$1,235");
    expect(formatDollars(12.345)).toBe("$12");
    expect(formatDollars(0.48)).toBe("$0.48");
  });
});
