import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCacheFacts, type CacheFacts } from "../../src/facts.js";
import { parseUsageLog, type UsageRecord } from "../../src/log/record.js";
import { measuredScore } from "../../src/score/measured.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FACTS = loadCacheFacts(ROOT);
const real = (provider: string): CacheFacts => {
  const f = FACTS.get(provider);
  if (!f) throw new Error(`unknown provider: ${provider}`);
  return f;
};
const fixture = (name: string): UsageRecord[] => {
  const { records, bad } = parseUsageLog(readFileSync(new URL(`../fixtures/usage/${name}`, import.meta.url), "utf8"));
  expect(bad).toBe(0);
  return records;
};

/** Plain automatic cache: no minimum, no step, 300 s lifetime. */
const PLAIN: CacheFacts = { mode: "automatic", min_tokens: 0, ttl_seconds: 300 };
const plain = () => PLAIN;

const T0 = Date.parse("2026-11-20T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const rec = (o: Partial<UsageRecord> = {}): UsageRecord => ({
  v: 1, ts: at(0), provider: "x", model: "m", dialect: "openai.chat",
  ids: { conv: "c1", head: "h", nodes: ["a"] }, node_chars: [100], breakpoints: [], params: "p",
  prompt_tokens: 100, cached_tokens: 0, cache_write_tokens: 0, output_tokens: 0, finish: "stop", flags: {}, ...o,
});

/** Neutral filler: unique node, no conversation, no tokens. It counts as a call and moves no input. */
const filler = (n: number, from = 0): UsageRecord[] =>
  Array.from({ length: n }, (_, i) =>
    rec({ ts: at(-10_000 - i), ids: { conv: null, head: "f", nodes: [`filler-${from + i}`] }, node_chars: [1], prompt_tokens: 1 }));

const ok = (r: ReturnType<typeof measuredScore>) => {
  if (!r.ok) throw new Error(`expected a score, got ${JSON.stringify(r)}`);
  return r;
};

describe("measuredScore: call count (Review Focus 1)", () => {
  it("49 calls refuse with the count", () => {
    expect(measuredScore(filler(49), plain)).toMatchObject({ ok: false, reason: "too_few_calls", calls: 49, unmeasured: 0 });
  });
  it("50 calls give a score", () => {
    const r = ok(measuredScore(filler(50), plain));
    expect(r.calls).toBe(50);
    expect(r.unmeasured).toBe(0);
  });
  it("unmeasured calls do not count toward the 50", () => {
    const r = measuredScore([...filler(45), ...filler(10).map((x) => ({ ...x, ids: null, node_chars: null }))], plain);
    expect(r).toMatchObject({ ok: false, reason: "too_few_calls", calls: 55, unmeasured: 10, unmeasured_by_reason: { no_ids: 10 } });
  });
  it("an empty log refuses", () => {
    expect(measuredScore([], plain)).toMatchObject({ ok: false, reason: "too_few_calls", calls: 0, unmeasured: 0 });
  });
  it("60 records with all-zero usage refuse with reason no_usage, never a perfect score", () => {
    const zero = Array.from({ length: 60 }, (_, i) =>
      rec({ ts: at(i), ids: { conv: "c1", head: "h", nodes: ["a", `n${i}`] }, node_chars: [50, 100], prompt_tokens: 0, cached_tokens: 0, output_tokens: 0 }));
    const r = measuredScore(zero, plain);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r).toMatchObject({ reason: "too_few_calls", calls: 60, unmeasured: 60 });
    expect(r.unmeasured_by_reason.no_usage).toBe(60);
  });
});

describe("measuredScore: fixtures", () => {
  it("two sessions, all caches hit: E = 1, S close to 1, score >= 99", () => {
    const r = ok(measuredScore(fixture("two-sessions-interleaved.jsonl"), real));
    expect(r.inputs.E).toBe(1);
    // S = (426,880 + 482,560) / (430,592 + 489,984), by hand from the fixture.
    expect(r.inputs.S).toBeCloseTo(909_440 / 920_576, 12);
    expect(r.inputs.G).toBe(0);
    expect(r.score).toBe(99);
    expect(r.calls).toBe(60);
    expect(r.estimate).toBe("char-share");
    expect(r.heads).toEqual({ distinct_head: 1, conversations: 2 });
  });
  it("Anthropic without cache marks: E = 0 and score <= 40 (E1's shape)", () => {
    const r = ok(measuredScore(fixture("anthropic-no-marks.jsonl"), real));
    expect(r.inputs.E).toBe(0);
    expect(r.score).toBeLessThanOrEqual(40);
  });
  it("interleaved and sorted-by-session logs give the same E and S (Review Focus 3)", () => {
    const a = ok(measuredScore(fixture("two-sessions-interleaved.jsonl"), real));
    const b = ok(measuredScore(fixture("two-sessions-sorted.jsonl"), real));
    expect(Math.abs(a.inputs.E - b.inputs.E)).toBeLessThan(1e-9);
    expect(Math.abs(a.inputs.S - b.inputs.S)).toBeLessThan(1e-9);
    expect(a.score).toBe(b.score);
  });
  it("any shuffle of the file gives the same E and S", () => {
    const recs = fixture("two-sessions-sorted.jsonl");
    const base = ok(measuredScore(recs, real));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 5; k++) {
      const s = [...recs].sort(() => rnd() - 0.5);
      const r = ok(measuredScore(s, real));
      expect(Math.abs(r.inputs.E - base.inputs.E)).toBeLessThan(1e-9);
      expect(Math.abs(r.inputs.S - base.inputs.S)).toBeLessThan(1e-9);
    }
  });
});

describe("measuredScore: unmeasured records (Review Focus 2)", () => {
  const base = () => fixture("two-sessions-interleaved.jsonl");
  const inject = (recs: UsageRecord[], extra: UsageRecord[]) => {
    const out = [...recs];
    extra.forEach((x, i) => out.splice(i * 6, 0, x));
    return out;
  };
  const nullIds = (i: number): UsageRecord =>
    rec({ ts: at(i * 30), provider: "openai", ids: null, node_chars: null, prompt_tokens: 20_000, cached_tokens: 5_000 });

  it("10 records with ids: null among 60 give unmeasured 10 and leave E and S unchanged", () => {
    const without = ok(measuredScore(base(), real));
    const r = ok(measuredScore(inject(base(), Array.from({ length: 10 }, (_, i) => nullIds(i))), real));
    expect(r.unmeasured).toBe(10);
    expect(r.unmeasured_by_reason.no_ids).toBe(10);
    expect(r.calls).toBe(70);
    expect(r.inputs.E).toBe(without.inputs.E);
    expect(r.inputs.S).toBe(without.inputs.S);
  });

  it("missing, empty, misaligned or broken node_chars are unmeasured, not zero reuse", () => {
    const without = ok(measuredScore(base(), real));
    const bad = (node_chars: number[] | null, i: number) =>
      rec({ ts: at(i * 30), provider: "openai", ids: { conv: "conv-a", head: "h-1", nodes: ["n-head", `x${i}`] }, node_chars, prompt_tokens: 20_000 });
    const extra = [bad(null, 0), bad([], 1), bad([51200], 2), bad([51200, 51712, 52000], 3), bad([0, 0], 4), bad([60000, 51200], 5), bad([51200, Number.NaN], 6)];
    const r = ok(measuredScore(inject(base(), extra), real));
    expect(r.unmeasured).toBe(7);
    expect(r.unmeasured_by_reason.bad_node_chars).toBe(7);
    expect(r.inputs.E).toBe(without.inputs.E);
    expect(r.inputs.S).toBe(without.inputs.S);
  });

  it("an unknown provider is unmeasured with a reason, not a crash", () => {
    const without = ok(measuredScore(base(), real));
    const extra = [rec({ ts: at(5), provider: "nobody", ids: { conv: "conv-a", head: "h-1", nodes: ["n-head", "z"] }, node_chars: [51200, 60000], prompt_tokens: 15_000 })];
    const r = ok(measuredScore(inject(base(), extra), real));
    expect(r.unmeasured).toBe(1);
    expect(r.unmeasured_by_reason.unknown_provider).toBe(1);
    expect(r.inputs.E).toBe(without.inputs.E);
    expect(r.inputs.S).toBe(without.inputs.S);
  });

  it("a record with prompt_tokens <= 0 is unmeasured (no_usage), not zero reuse", () => {
    const r = ok(measuredScore([...filler(50), rec({ ts: at(1), prompt_tokens: 0 }), rec({ ts: at(2), prompt_tokens: -5 })], plain));
    expect(r.unmeasured).toBe(2);
    expect(r.unmeasured_by_reason.no_usage).toBe(2);
  });

  it("an unreadable ts is unmeasured", () => {
    const r = ok(measuredScore([...filler(50), rec({ ts: "yesterday" })], plain));
    expect(r.unmeasured_by_reason.bad_ts).toBe(1);
  });
});

describe("measuredScore: cache lifetime (owner ruling D1)", () => {
  // Two requests of one conversation on Anthropic facts (ttl 300 s, min 4,096 tokens), plus neutral filler.
  const pair = (gap: number): UsageRecord[] => [
    rec({ ts: at(0), provider: "anthropic", ids: { conv: "c", head: "h", nodes: ["s", "u1"] }, node_chars: [40_000, 41_000], prompt_tokens: 10_250 }),
    rec({ ts: at(gap), provider: "anthropic", ids: { conv: "c", head: "h", nodes: ["s", "u1", "a1", "u2"] }, node_chars: [40_000, 41_000, 42_000, 44_000], prompt_tokens: 11_000 }),
    ...filler(48),
  ];
  const facts = (p: string) => (p === "anthropic" ? real("anthropic") : PLAIN);
  // reusable = stable = cap(round(11,000 x 41,000 / 44,000)) = 10,250 tokens; S = 10,250 / 11,000.
  // Nothing is cached, so E = 0 when the prefix is reusable and E = 1 when it is cold.
  const STABLE = 10_250 / 11_000;

  it("a prefix last seen 301 s earlier is not reusable, and S still counts its structure", () => {
    const r = ok(measuredScore(pair(301), facts));
    expect(r.inputs.E).toBe(1); // nothing reusable, nothing missed
    expect(r.inputs.S).toBeCloseTo(STABLE, 12); // a pause is not a rewritten prefix
    expect(r.score).toBe(95); // floor(100 x (0.6 x 1 x 0.93182 + 0.4)); before ruling 1 it was 40
  });
  it("a prefix last seen 299 s earlier is reusable", () => {
    const r = ok(measuredScore(pair(299), facts));
    expect(r.inputs.E).toBe(0); // reusable, but nothing cached: the app's miss
    expect(r.inputs.S).toBeCloseTo(STABLE, 12);
  });
  it("S is the same at 299 s and 301 s", () => {
    expect(ok(measuredScore(pair(301), facts)).inputs.S).toBe(ok(measuredScore(pair(299), facts)).inputs.S);
  });
  it("exactly 300 s is still within the lifetime", () => {
    expect(ok(measuredScore(pair(300), facts)).inputs.E).toBe(0);
  });
  it("the latest earlier sighting counts, not the first", () => {
    const recs = pair(500);
    recs.splice(1, 0, rec({ ts: at(400), provider: "anthropic", ids: { conv: "other", head: "h", nodes: ["s", "u1", "q"] }, node_chars: [40_000, 41_000, 42_000], prompt_tokens: 10_500 }));
    // The middle request at 400 s is 400 s after the first (cold), but it refreshes ["s","u1"],
    // so at 500 s the prefix is 100 s old and reusable: E = 0 / 10,250.
    expect(ok(measuredScore(recs, facts)).inputs.E).toBe(0);
    expect(ok(measuredScore(pair(500), facts)).inputs.E).toBe(1);
  });
  it("ttl 0 means no lifetime limit", () => {
    const self: CacheFacts = { mode: "block", min_tokens: 0, block_tokens: 1, ttl_seconds: 0 };
    const recs = pair(10 * 86_400).map((x) => ({ ...x, provider: "self" }));
    expect(ok(measuredScore(recs, () => self)).inputs.E).toBe(0);
  });
  it("a partly cold prefix: E uses the warm part, S the whole shared part", () => {
    // R0 at 0 s has [s, u1]; R1 at 200 s has [s]; R2 at 450 s repeats [s, u1, ...]:
    // [s] was seen 250 s ago (warm), [s, u1] 450 s ago (cold).
    const recs = [
      rec({ ts: at(0), provider: "x", ids: { conv: "c", head: "h", nodes: ["s", "u1"] }, node_chars: [500, 800], prompt_tokens: 200 }),
      rec({ ts: at(200), provider: "x", ids: { conv: "d", head: "h", nodes: ["s"] }, node_chars: [500], prompt_tokens: 125, cached_tokens: 125 }),
      rec({ ts: at(450), provider: "x", ids: { conv: "c", head: "h", nodes: ["s", "u1", "u2"] }, node_chars: [500, 800, 1000], prompt_tokens: 250, cached_tokens: 125 }),
      ...filler(47),
    ];
    const r = ok(measuredScore(recs, plain));
    // R1 reusable 125 (cached 125); R2 reusable round(250 x 500/1000) = 125 (cached 125), stable round(250 x 800/1000) = 200.
    expect(r.inputs.E).toBe(1);
    expect(r.inputs.S).toBe(200 / 250);
  });
  it("below the provider minimum the prefix is not reusable", () => {
    const recs = pair(10);
    recs[0] = { ...recs[0], prompt_tokens: 1_025 };
    recs[1] = { ...recs[1], prompt_tokens: 1_100 }; // reusable 1,025 < 4,096
    expect(ok(measuredScore(recs, facts)).inputs.S).toBe(0);
  });
  it("missing breakpoints do not reduce reusable on Anthropic", () => {
    const withMarks = pair(10).map((x) => ({ ...x, breakpoints: [0] }));
    expect(ok(measuredScore(withMarks, facts)).inputs.S).toBe(ok(measuredScore(pair(10), facts)).inputs.S);
  });
});

describe("measuredScore: ordering", () => {
  it("earlier means earlier ts, not earlier in the file", () => {
    // The request first in the file is later in time, so it is the one that reuses.
    const recs = [
      rec({ ts: at(10), ids: { conv: "c", head: "h", nodes: ["s", "u"] }, node_chars: [500, 1000], prompt_tokens: 1000, cached_tokens: 500 }),
      rec({ ts: at(0), ids: { conv: "d", head: "h", nodes: ["s"] }, node_chars: [500], prompt_tokens: 600, cached_tokens: 0 }),
      ...filler(48),
    ];
    const r = ok(measuredScore(recs, plain));
    expect(r.inputs.E).toBe(1); // 500 cached of 500 reusable; file order would give 500 of 600
  });
  it("equal ts keeps file order", () => {
    const recs = [
      rec({ ts: at(0), ids: { conv: "d", head: "h", nodes: ["s"] }, node_chars: [500], prompt_tokens: 600, cached_tokens: 0 }),
      rec({ ts: at(0), ids: { conv: "c", head: "h", nodes: ["s", "u"] }, node_chars: [500, 1000], prompt_tokens: 1000, cached_tokens: 250 }),
      ...filler(48),
    ];
    expect(ok(measuredScore(recs, plain)).inputs.E).toBe(0.5);
  });
  it("S counts only requests that continue an earlier one of the same conv", () => {
    // Second request shares the head with the first but starts a new conv: it is in E, not in S.
    const recs = [
      rec({ ts: at(0), ids: { conv: "c1", head: "h", nodes: ["s", "u1"] }, node_chars: [800, 1000], prompt_tokens: 250 }),
      rec({ ts: at(5), ids: { conv: "c2", head: "h", nodes: ["s", "u2"] }, node_chars: [800, 1000], prompt_tokens: 250, cached_tokens: 100 }),
      ...filler(48),
    ];
    const r = ok(measuredScore(recs, plain));
    expect(r.inputs.S).toBe(1); // no continuations
    expect(r.inputs.E).toBe(0.5); // 100 cached of 200 reusable
  });
});

describe("measuredScore: generation waste", () => {
  const trunc = rec({ ts: at(0), ids: { conv: "c", head: "h", nodes: ["s", "u"] }, node_chars: [500, 1000], params: "p1", output_tokens: 1000, finish: "length" });
  it("a retry of a length call with the same params counts in G", () => {
    const retry = { ...trunc, ts: at(5), finish: "stop" as const, flags: { retry_of: 0 } };
    expect(ok(measuredScore([trunc, retry, ...filler(48)], plain)).inputs.G).toBe(0.5);
  });
  it("a retry with a larger max_tokens (other params) does not", () => {
    const retry = { ...trunc, ts: at(5), params: "p2", finish: "stop" as const, flags: { retry_of: 0 } };
    expect(ok(measuredScore([trunc, retry, ...filler(48)], plain)).inputs.G).toBe(0);
  });
  it("the retry rule holds without ids", () => {
    const retry = { ...trunc, ts: at(5), ids: null, node_chars: null, finish: "stop" as const, flags: { retry_of: 0 } };
    expect(ok(measuredScore([trunc, retry, ...filler(49)], plain)).inputs.G).toBe(0.5);
  });
  it("a retry of a call that did not hit the limit is not counted by the retry rule", () => {
    const first = { ...trunc, finish: "stop" as const };
    const retry = { ...trunc, ts: at(5), ids: null, node_chars: null, flags: { retry_of: 0 } };
    expect(ok(measuredScore([first, retry, ...filler(49)], plain)).inputs.G).toBe(0);
  });
  it("an identical repeat (same last node, same params) counts; the first call does not", () => {
    const again = { ...trunc, ts: at(5), finish: "stop" as const, output_tokens: 300 };
    expect(ok(measuredScore([again, { ...trunc, output_tokens: 100 }, ...filler(48)], plain)).inputs.G).toBe(0.75);
  });
  it("a retry_of pointing forward (at a later record in the file) is ignored", () => {
    // The length call is second in the file; the record pointing at it is first, so the link is ignored.
    const retry = { ...trunc, ts: at(5), ids: null, node_chars: null, finish: "stop" as const, flags: { retry_of: 1 } };
    expect(ok(measuredScore([retry, trunc, ...filler(49)], plain)).inputs.G).toBe(0);
  });
  it("a retry_of pointing at itself is ignored", () => {
    const self = { ...trunc, ids: null, node_chars: null, flags: { retry_of: 0 } };
    expect(ok(measuredScore([self, ...filler(50)], plain)).inputs.G).toBe(0);
  });
  it("a parse failure counts", () => {
    const bad = { ...trunc, finish: "stop" as const, flags: { parse_failed: true as const } };
    const good = rec({ ts: at(5), ids: { conv: "c", head: "h", nodes: ["s", "v"] }, node_chars: [500, 1000], output_tokens: 3000 });
    expect(ok(measuredScore([bad, good, ...filler(48)], plain)).inputs.G).toBe(0.25);
  });
  it("G is 0 when no output tokens were spent", () => {
    expect(ok(measuredScore(filler(50), plain)).inputs.G).toBe(0);
  });
});

describe("measuredScore: worked example (report)", () => {
  it("matches the hand computation", () => {
    const recs = [
      rec({ ts: at(0), ids: { conv: "c1", head: "h", nodes: ["a", "b"] }, node_chars: [400, 800], prompt_tokens: 200, output_tokens: 50 }),
      rec({ ts: at(10), ids: { conv: "c1", head: "h", nodes: ["a", "b", "c", "d"] }, node_chars: [400, 800, 1000, 1600], prompt_tokens: 400, cached_tokens: 150, output_tokens: 60 }),
      rec({ ts: at(20), ids: { conv: "c2", head: "h", nodes: ["a", "e"] }, node_chars: [400, 1000], prompt_tokens: 250, cached_tokens: 100, output_tokens: 40 }),
      rec({ ts: at(30), ids: { conv: "c1", head: "h", nodes: ["a", "b", "c", "d"] }, node_chars: [400, 800, 1000, 1600], prompt_tokens: 400, cached_tokens: 400, output_tokens: 60 }),
      ...filler(46),
    ];
    const r = ok(measuredScore(recs, plain));
    expect(r.inputs.E).toBeCloseTo(650 / 700, 12);
    expect(r.inputs.S).toBeCloseTo(600 / 800, 12);
    expect(r.inputs.G).toBeCloseTo(60 / 210, 12);
    expect(r.score).toBe(70);
    expect(r.heads).toEqual({ distinct_head: 2, conversations: 2 }); // "h" and the filler's "f"
  });
});

describe("measuredScore: failed calls", () => {
  it("a failed call followed by an identical successful call: G = 0; two identical successes still waste", () => {
    const base = { ids: { conv: null, head: "h", nodes: ["g"] }, params: "p", output_tokens: 100 };
    const failed = rec({ ...base, ts: at(1), finish: "error", output_tokens: 0 });
    const retry = rec({ ...base, ts: at(2) });
    expect(ok(measuredScore([failed, retry, ...filler(49)], plain)).inputs.G).toBe(0);
    const again = rec({ ...base, ts: at(3) });
    expect(ok(measuredScore([retry, again, ...filler(48)], plain)).inputs.G).toBe(0.5);
  });
  it("failed-call records leave E and S unchanged and count as call_failed", () => {
    const good = Array.from({ length: 50 }, (_, i) =>
      rec({ ts: at(i), ids: { conv: null, head: "h", nodes: ["a"] }, prompt_tokens: 100, cached_tokens: i === 0 ? 0 : 100 }));
    const failed = Array.from({ length: 5 }, (_, i) =>
      rec({ ts: at(25 + i + 0.5), ids: { conv: null, head: "h", nodes: ["a"] }, prompt_tokens: 100, cached_tokens: 0, finish: "error" }));
    const base = ok(measuredScore(good, plain));
    const mixed = ok(measuredScore([...good, ...failed], plain));
    expect(mixed.inputs.E).toBe(base.inputs.E);
    expect(mixed.inputs.S).toBe(base.inputs.S);
    expect(mixed.unmeasured_by_reason.call_failed).toBe(5);
    expect(mixed.calls).toBe(55);
    // The 50-call threshold counts measured calls only.
    expect(measuredScore([...good.slice(0, 49), ...failed], plain)).toMatchObject({ ok: false, calls: 54, unmeasured: 5 });
  });
});
