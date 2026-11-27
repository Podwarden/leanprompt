import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOpenQuestion, isServerFinding, parseFindings, staticScore, type Finding } from "../../src/score/static.js";
import { localDate, scoreCommand } from "../../src/score/write.js";

const IDS = new Set(["LP-PC-01", "LP-GE-05", "LP-LW-01", "LP-LW-03", "LP-PC-09"]);
const f = (o: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "a.ts", line: 1, saves: "prefill", severity: "high", ...o });
const lw = (o: Partial<Finding> = {}): Finding => f({ rule: "LP-LW-01", file: "<external>", line: 0, where: "engine launch flags", share: 0.2, ...o });
const doc = (findings: unknown[], extra: object = {}) => JSON.stringify({ v: 1, findings, ...extra });

describe("server findings: the app's score leaves them out (score change in 0.1.0-dev.13)", () => {
  it("an LP-LW finding in <external> is for the server's administrator by default; fix_by overrides either way", () => {
    expect(isServerFinding(lw())).toBe(true);
    expect(isServerFinding(lw({ fix_by: "app" }))).toBe(false);
    expect(isServerFinding(f({ rule: "LP-LW-01" }))).toBe(false); // in the repository: the app's own code
    expect(isServerFinding(f({ fix_by: "server", status: "needs-facts", confirm: "x" }))).toBe(true);
    expect(isServerFinding(f({ file: "<external>", where: "gateway" }))).toBe(false);
    // A server finding is not an app open question; it has its own section.
    expect(isOpenQuestion(lw({ status: "needs-facts", confirm: "block size" }))).toBe(false);
    expect(isOpenQuestion(f({ file: "<external>", where: "gateway" }))).toBe(true);
  });

  it("the static score leaves server findings out unless includeServer, with the formula unchanged", () => {
    const app = f({ share: 0.1 });
    const s = staticScore([app, lw()]);
    expect(s.score).toBe(staticScore([app]).score);
    expect(s.server_findings).toBe(1);
    expect(s.included_server).toBe(false);
    expect(s.default_shares.of).toBe(1);
    const w = staticScore([app, lw()], undefined, { includeServer: true });
    // floor(100 x (0.6 x 0.9 x 0.8 + 0.4)) = floor(83.2) = 83, the 0.1.0-dev.12 figure
    expect(w.score).toBe(83);
    expect(w.included_server).toBe(true);
    expect(s.score).toBe(94); // floor(100 x (0.6 x 0.9 + 0.4))
  });

  it("a file with no server findings scores the same as before", () => {
    const fs = [f({ share: 0.3 }), f({ rule: "LP-GE-05", saves: "generation", share: 0.1 })];
    expect(staticScore(fs).score).toBe(staticScore(fs, undefined, { includeServer: true }).score);
  });

  it("validates fix_by", () => {
    expect(parseFindings(doc([{ ...f(), fix_by: "ops" }]), IDS).errors[0]).toMatch(/fix_by must be app or server/);
    expect(parseFindings(doc([{ ...lw(), fix_by: "app" }]), IDS).findings[0]!.fix_by).toBe("app");
  });
});

describe("share_prefill and share_output", () => {
  it("score each side with its own share on a both finding", () => {
    const both = f({ rule: "LP-GE-05", saves: "both", share_prefill: 0, share_output: 0.5 });
    const s = staticScore([both]);
    expect(s.inputs.E).toBe(1);
    expect(s.inputs.G).toBeCloseTo(0.5, 9);
    expect(s.default_shares.used).toBe(0);
    // The old single share hit both sides.
    expect(staticScore([f({ rule: "LP-GE-05", saves: "both", share: 0.5 })]).inputs.E).toBeCloseTo(0.5, 9);
  });

  it("are only for both findings, and come as a pair unless share is the fallback", () => {
    const e = (o: object) => parseFindings(doc([{ ...f(), ...o }]), IDS).errors[0] ?? "";
    expect(e({ share_prefill: 0.1, share_output: 0.2 })).toMatch(/for a finding that saves both/);
    expect(e({ saves: "both", share_output: 0.2 })).toMatch(/give both share_prefill and share_output/);
    expect(e({ saves: "both", share_output: 2, share_prefill: 0 })).toMatch(/share_output must be a number in \[0, 1\]/);
    expect(e({ saves: "both", share_output: 0.2, share: 0.05 })).toBe("");
    expect(e({ share: 0 })).toBe("");
  });
});

describe("status: needs-facts and frequency-unknown", () => {
  it("frequency-unknown is a finding, not an open question, and needs confirm", () => {
    const fu = f({ status: "frequency-unknown", confirm: "how often finish_reason is length" });
    expect(isOpenQuestion(fu)).toBe(false);
    expect(parseFindings(doc([{ ...f(), status: "frequency-unknown" }]), IDS).errors[0]).toMatch(/frequency-unknown finding needs `confirm`/);
    expect(parseFindings(doc([fu]), IDS).findings[0]!.status).toBe("frequency-unknown");
    expect(parseFindings(doc([{ ...f(), status: "maybe", confirm: "x" }]), IDS).errors[0]).toMatch(/needs-facts or frequency-unknown/);
  });
});

describe("tokens_per_1k and planned", () => {
  it("accepts {} as no estimate, and cache_write for a mark finding", () => {
    const r = parseFindings(doc([{ ...f(), tokens_per_1k: {} }, { ...f(), tokens_per_1k: { uncached: 10, cache_write: 4 } }]), IDS);
    expect(r.errors).toEqual([]);
    expect(r.findings[0]!.tokens_per_1k).toBeUndefined();
    expect(r.findings[1]!.tokens_per_1k).toEqual({ uncached: 10, cache_write: 4 });
    expect(parseFindings(doc([{ ...f(), tokens_per_1k: { cache_write: 4 } }]), IDS).errors[0]).toMatch(/leave it out, or \{\}/);
  });

  it("keeps planned, a reference to planned work", () => {
    expect(parseFindings(doc([{ ...f(), planned: "issue #412, open" }]), IDS).findings[0]!.planned).toBe("issue #412, open");
    expect(parseFindings(doc([{ ...f(), planned: "" }]), IDS).errors[0]).toMatch(/planned must be/);
  });
});

describe("notes: verified problems outside the rules", () => {
  const note = { title: "The spend cap ignores cache tokens", file: "lib/usage.ts", line: 31, problem: "It adds input_tokens and output_tokens only.", change: "Add the two cache fields." };

  it("parses a valid notes array and never scores it", () => {
    const r = parseFindings(doc([f({ share: 0.1 })], { notes: [note, { ...note, file: "<external>", line: undefined, why: "w", verify: "v" }] }), IDS);
    expect(r.errors).toEqual([]);
    expect(r.notes).toHaveLength(2);
    expect(r.notes![1]).toEqual({ ...note, file: "<external>", line: 0, why: "w", verify: "v" });
    const with_ = staticScore(r.findings);
    const without = staticScore(parseFindings(doc([f({ share: 0.1 })]), IDS).findings);
    expect(with_).toEqual(without);
  });

  it("rejects a score field, an unknown key, a missing field or a bad line, naming the entry", () => {
    const e = (n: object) => parseFindings(doc([], { notes: [n] }), IDS).errors[0] ?? "";
    expect(e({ ...note, share: 0.1 })).toMatch(/notes\[0\]: share is not allowed: a note is never scored/);
    expect(e({ ...note, severity: "high" })).toMatch(/severity is not allowed/);
    expect(e({ ...note, extra: 1 })).toMatch(/unknown key extra/);
    expect(e({ ...note, change: undefined })).toMatch(/change must be a non-empty string/);
    expect(e({ ...note, line: 0 })).toMatch(/line must be a positive integer/);
    expect(e({ ...note, title: "x".repeat(121) })).toMatch(/title must be/);
    expect(parseFindings(doc([], { notes: {} }), IDS).errors[0]).toMatch(/notes must be an array/);
  });
});

describe("score command: server block, --with-server, local date", () => {
  let dir: string;
  let out: string;
  let err: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lp-server-"));
    out = err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
    mkdirSync(join(dir, ".leanprompt"), { recursive: true });
    writeFileSync(join(dir, ".leanprompt", "findings.json"), doc([f({ share: 0.1 }), lw()]));
  });
  afterEach(() => vi.restoreAllMocks());
  const read = () => JSON.parse(readFileSync(join(dir, ".leanprompt", "score.json"), "utf8"));

  it("writes the app's score, with the server figure beside it", async () => {
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    const s = read();
    expect(s.score).toBe(94);
    expect(s.message).toBe("94 static");
    expect(s.diagnostics).toEqual({ default_shares: 0, findings: 1, server_findings: 1 });
    expect(s.server).toMatchObject({ included: false, findings: 1, with_server_score: 83 });
    expect(out).toMatch(/1 finding for the server's administrator left out of this app score \(with them: 83; --with-server counts them\)/);
    expect(s.date).toBe(localDate());
  });

  it("--with-server makes the old figure the headline and says so", async () => {
    expect(await scoreCommand(["--static", "--with-server", "--dir", dir])).toBe(0);
    const s = read();
    expect(s.score).toBe(83);
    expect(s.message).toBe("83 static, with server");
    expect(s.server).toMatchObject({ included: true, app_score: 94 });
  });

  it("--with-server is refused for a measured score", async () => {
    writeFileSync(join(dir, ".leanprompt", "usage.jsonl"), "");
    expect(await scoreCommand(["--with-server", "--dir", dir])).toBe(2);
    expect(err).toMatch(/--with-server is for the static score/);
  });

  it("the date is the machine's local date, not UTC", () => {
    // 23:30 local on 26 November is 26 November locally, whatever UTC says.
    expect(localDate(new Date(2026, 10, 26, 23, 30))).toBe("2026-11-26");
    expect(localDate(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});
