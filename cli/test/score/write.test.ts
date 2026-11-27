import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../../src/main.js";
import { badgeColor, ghEscape, loadWeights, scoreCommand } from "../../src/score/write.js";

const USAGE = join(__dirname, "../fixtures/usage/two-sessions-sorted.jsonl");
let dir: string;
let out: string;
let err: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lp-score-"));
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
});
afterEach(() => vi.restoreAllMocks());

const lp = (name: string, text: string): string => {
  mkdirSync(join(dir, ".leanprompt"), { recursive: true });
  const p = join(dir, ".leanprompt", name);
  writeFileSync(p, text);
  return p;
};
const findings = (...f: object[]): string => JSON.stringify({ v: 1, findings: f });
const finding = (extra: object = {}) => ({ rule: "LP-PC-01", file: "app.ts", line: 3, saves: "prefill", severity: "high", ...extra });
const readScore = () => JSON.parse(readFileSync(join(dir, ".leanprompt", "score.json"), "utf8"));

describe("badgeColor", () => {
  it.each([[100, "brightgreen"], [90, "brightgreen"], [89, "green"], [75, "green"], [74, "yellow"], [50, "yellow"], [49, "red"], [0, "red"]])(
    "measured %i is %s",
    (score, color) => expect(badgeColor(score, "measured")).toBe(color),
  );
  it("static is always lightgrey", () => {
    for (const s of [0, 60, 100]) expect(badgeColor(s, "static")).toBe("lightgrey");
  });
});

describe("score --measured", () => {
  it("writes score.json with the badge keys on top and diagnostics", async () => {
    expect(await scoreCommand(["--measured", USAGE, "--dir", dir])).toBe(0);
    const s = readScore();
    expect(s.schemaVersion).toBe(1);
    expect(s.label).toBe("leanprompt");
    expect(s.kind).toBe("measured");
    expect(s.message).toBe(`${s.score} measured`);
    expect(s.color).toBe(badgeColor(s.score, "measured"));
    expect(s.weights).toBe("default");
    expect(s.calls).toBe(60);
    expect(s.diagnostics.estimate).toBe("char-share");
    expect(s.diagnostics.heads).toEqual(expect.objectContaining({ distinct_head: expect.any(Number) }));
    expect(s.diagnostics.unmeasured_by_reason).toHaveProperty("no_ids");
    expect(s.leanprompt).toBe(VERSION);
    expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toContain(`${s.score} measured`);
    expect(out).toMatch(/E prefill reuse \d\.\d\d, S prefix stability \d\.\d\d, G generation waste \d\.\d\d/);
    expect(out).toContain("calls logged 60, measured 60, unmeasured 0");
  });

  it("refuses a log with too few calls", async () => {
    const lines = readFileSync(USAGE, "utf8").split("\n").slice(0, 10).join("\n");
    const p = lp("usage.jsonl", lines);
    expect(await scoreCommand(["--measured", p, "--dir", dir])).toBe(1);
    expect(err).toContain("measured score needs at least 50 calls; found 10. Run with --static to score from the audit's findings.");
    expect(existsSync(join(dir, ".leanprompt", "score.json"))).toBe(false);
  });

  it("refuses a log whose records carry no usage, naming the reason (never a perfect score)", async () => {
    const zero = readFileSync(USAGE, "utf8").trim().split("\n").map((l) => {
      const r = JSON.parse(l);
      return JSON.stringify({ ...r, prompt_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
    });
    expect(zero.length).toBe(60);
    const p = lp("usage.jsonl", zero.join("\n"));
    expect(await scoreCommand(["--measured", p, "--dir", dir])).toBe(1);
    expect(err).toContain("found 0");
    expect(err).toContain("no_usage 60");
    expect(err).toMatch(/usage object/);
    expect(existsSync(join(dir, ".leanprompt", "score.json"))).toBe(false);
  });

  it("an OpenAI-compatible host with no table refuses with unknown_provider, and scores once the profile names a target", async () => {
    const groq = readFileSync(USAGE, "utf8").trim().split("\n").map((l) => JSON.stringify({ ...JSON.parse(l), provider: "fireworks" }));
    const p = lp("usage.jsonl", groq.join("\n"));
    expect(await scoreCommand(["--measured", p, "--dir", dir])).toBe(1);
    expect(err).toContain("unknown_provider 60");
    writeFileSync(join(dir, "leanprompt.yaml"), "target: {provider: openai}\n");
    expect(await scoreCommand(["--measured", p, "--dir", dir])).toBe(0);
    expect(readScore().unmeasured).toBe(0);
  });

  it("with two targets, a host matching neither is unmeasured as ambiguous_target with a hint", async () => {
    const groq = readFileSync(USAGE, "utf8").trim().split("\n").map((l) => JSON.stringify({ ...JSON.parse(l), provider: "fireworks" }));
    const p = lp("usage.jsonl", groq.join("\n"));
    writeFileSync(join(dir, "leanprompt.yaml"), "targets:\n  - {engine: lm-warden}\n  - {provider: openai}\n");
    expect(await scoreCommand(["--measured", p, "--dir", dir])).toBe(1);
    expect(err).toContain("ambiguous_target 60");
    expect(err).toMatch(/ambiguous_target: .*targets/);
  });

  it("a log with provider lm-warden is scored on the vLLM table", async () => {
    const lmw = readFileSync(USAGE, "utf8").trim().split("\n").map((l) => JSON.stringify({ ...JSON.parse(l), provider: "lm-warden" }));
    const p = lp("usage.jsonl", lmw.join("\n"));
    expect(await scoreCommand(["--measured", p, "--dir", dir])).toBe(0);
    expect(readScore().unmeasured).toBe(0);
  });

  it("uses .leanprompt/usage.jsonl by default, ahead of findings", async () => {
    lp("usage.jsonl", readFileSync(USAGE, "utf8"));
    lp("findings.json", findings(finding()));
    expect(await scoreCommand(["--dir", dir])).toBe(0);
    expect(readScore().kind).toBe("measured");
  });

  it("errors on a missing explicit file", async () => {
    await expect(scoreCommand(["--measured", join(dir, "nope.jsonl"), "--dir", dir])).rejects.toThrow(/nope\.jsonl/);
  });
});

describe("score --static", () => {
  it("falls back to .leanprompt/findings.json and is lightgrey", async () => {
    lp("findings.json", findings(finding()));
    expect(await scoreCommand(["--dir", dir])).toBe(0);
    const s = readScore();
    expect(s).toMatchObject({ kind: "static", weights: "default", color: "lightgrey", message: `${s.score} static` });
    expect(s.score).toBe(70);
    expect(s.diagnostics).toEqual({ default_shares: 1, findings: 1 });
  });

  it("reports how many findings used a default share, in score.json and on stdout", async () => {
    lp("findings.json", findings(finding(), finding({ share: 0.1 }), finding({ severity: "low" }), finding({ fixed: true })));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    expect(readScore().diagnostics).toEqual({ default_shares: 2, findings: 3 });
    expect(out).toContain("default_shares: 2 of 3");
  });

  it("warns when every share is a severity default", async () => {
    lp("findings.json", findings(finding(), finding({ severity: "low" })));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    expect(out).toContain("default_shares: 2 of 2");
    expect(out).toMatch(/every share is a severity default/);
    lp("findings.json", findings(finding({ share: 0.2 })));
    out = "";
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    expect(out).toContain("default_shares: 0 of 1");
    expect(out).not.toMatch(/every share is a severity default/);
  });

  it("scores the same with and without the kvsig field: recognising kvsig gives no points", async () => {
    const fs = [finding(), finding({ rule: "LP-GE-01", saves: "generation", severity: "medium", share: 0.3 })];
    lp("findings.json", findings(...fs));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    const { date: _a, ...without } = readScore();
    lp("findings.json", JSON.stringify({ v: 1, kvsig: { used: true, where: ["src/llm/hosted.ts:12", "package.json"] }, findings: fs }));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    const { date: _b, ...withKvsig } = readScore();
    expect(withKvsig).toEqual(without);
    lp("findings.json", JSON.stringify({ v: 1, kvsig: { used: false }, findings: fs }));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    const { date: _c, ...notUsed } = readScore();
    expect(notUsed).toEqual(without);
  });

  it("a bare --static scores .leanprompt/findings.json even when a usage log exists (the hint the measured refusal prints)", async () => {
    lp("usage.jsonl", readFileSync(USAGE, "utf8"));
    lp("findings.json", findings(finding()));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    expect(readScore().kind).toBe("static");
    expect(await scoreCommand(["--dir", dir, "--static"])).toBe(0);
    expect(readScore().kind).toBe("static");
  });

  it("a bare --measured reads .leanprompt/usage.jsonl", async () => {
    lp("usage.jsonl", readFileSync(USAGE, "utf8"));
    expect(await scoreCommand(["--measured", "--dir", dir])).toBe(0);
    expect(readScore().kind).toBe("measured");
  });

  it("exits 2 naming both files when nothing is there", async () => {
    expect(await scoreCommand(["--dir", dir])).toBe(2);
    expect(err).toContain(".leanprompt/usage.jsonl");
    expect(err).toContain(".leanprompt/findings.json");
  });

  it("drops findings matched by the profile's ignore list", async () => {
    lp("findings.json", findings(finding(), finding({ file: "other.ts" })));
    writeFileSync(join(dir, "leanprompt.yaml"), "ignore:\n  - rule: LP-PC-01\n    file: app.ts\n");
    expect(await scoreCommand(["--dir", dir])).toBe(0);
    // one high prefill finding left: 0.6 x 0.5 + 0.4 = 0.70
    expect(readScore().score).toBe(70);
  });

  it("skips fixed findings", async () => {
    lp("findings.json", findings(finding({ fixed: true })));
    await scoreCommand(["--dir", dir]);
    expect(readScore().score).toBe(100);
  });

  it("reports calibrated weights in the message", async () => {
    lp("findings.json", findings(finding()));
    lp("weights.json", JSON.stringify({ v: 1, shares: { high: 0.5, medium: 0.2, low: 0.05 }, k_prefill: 1.2, k_gen: 1, source: "synthetic", calls: 0, date: "2026-11-26" }));
    await scoreCommand(["--dir", dir]);
    const s = readScore();
    expect(s.weights).toBe("calibrated");
    expect(s.message).toBe(`${s.score} static, calibrated`);
    expect(s.score).toBe(64); // share 0.6: 0.6 x 0.4 + 0.4
  });

  it("errors on an invalid findings file, naming it", async () => {
    const p = lp("findings.json", findings({ rule: "LP-XX-99" }));
    await expect(scoreCommand(["--static", p, "--dir", dir])).rejects.toThrow(/findings\.json.*unknown rule/);
  });

  it.each([
    ["not json", "{"],
    ["v 2", JSON.stringify({ v: 2, k_prefill: 1, k_gen: 1 })],
    ["negative k", JSON.stringify({ v: 1, k_prefill: -1, k_gen: 1 })],
    ["string k", JSON.stringify({ v: 1, k_prefill: "1", k_gen: 1 })],
    ["null k", JSON.stringify({ v: 1, k_prefill: null, k_gen: 1 })],
    ["missing k_gen", JSON.stringify({ v: 1, k_prefill: 1 })],
  ])("rejects a weights file that is %s, never a NaN score", async (_n, text) => {
    lp("findings.json", findings(finding()));
    const w = lp("weights.json", text);
    await expect(scoreCommand(["--dir", dir])).rejects.toThrow(w);
    expect(existsSync(join(dir, ".leanprompt", "score.json"))).toBe(false);
  });

  it("loadWeights returns null when absent", () => expect(loadWeights(join(dir, "none.json"))).toBeNull());
});

describe("score arguments", () => {
  it("rejects both --measured and --static, and unknown flags", async () => {
    expect(await scoreCommand(["--measured", "a", "--static", "b"])).toBe(2);
    expect(await scoreCommand(["--bogus"])).toBe(2);
  });
});

describe("score --github", () => {
  it("prints one ::warning per open finding with file and line, then a summary, and exits 0", async () => {
    lp(
      "findings.json",
      findings(
        finding({ problem: "The first line of the prompt changes on every call, so nothing is cached." }),
        finding({ rule: "LP-PC-03", line: 9, fixed: true }),
        { rule: "LP-LW-01", file: "<external>", line: 0, where: "engine launch flags", saves: "prefill", severity: "medium", status: "needs-facts", confirm: "is prefix caching on" },
      ),
    );
    expect(await scoreCommand(["--static", "--github", "--dir", dir])).toBe(0);
    const warnings = out.split("\n").filter((l) => l.startsWith("::warning "));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^::warning file=app\.ts,line=3,title=leanprompt LP-PC-01%3A [^,]+::The first line of the prompt changes on every call, so nothing is cached\.$/);
    expect(warnings[1]).not.toContain("file=");
    expect(warnings[1]).toContain("(engine launch flags)");
    expect(warnings[1]).toContain("Open question: is prefix caching on");
    expect(out).toMatch(/::notice title=leanprompt score::leanprompt score \d+ static; 2 open findings/);
  });

  it("leaves out ignored findings", async () => {
    writeFileSync(join(dir, "leanprompt.yaml"), "ignore:\n  - {rule: LP-PC-01, file: app.ts}\n");
    lp("findings.json", findings(finding()));
    expect(await scoreCommand(["--static", "--github", "--dir", dir])).toBe(0);
    expect(out).not.toContain("::warning");
    expect(out).toContain("0 open findings");
  });

  it("an invalid findings file exits 1 (thrown, as every score error)", async () => {
    lp("findings.json", "{not json");
    await expect(scoreCommand(["--static", "--github", "--dir", dir])).rejects.toThrow();
  });

  it("--fail-under exits 3 only when the score is below it", async () => {
    lp("findings.json", findings(finding({ share: 0.9 })));
    expect(await scoreCommand(["--static", "--dir", dir, "--fail-under", "0"])).toBe(0);
    expect(await scoreCommand(["--static", "--dir", dir, "--fail-under", "100"])).toBe(3);
    expect(await scoreCommand(["--static", "--dir", dir, "--fail-under", "lots"])).toBe(2);
  });

  it("escapes the workflow command characters", () => {
    expect(ghEscape("a%b\nc\r")).toBe("a%25b%0Ac%0D");
    expect(ghEscape("x: y, z", true)).toBe("x%3A y%2C z");
  });
});
