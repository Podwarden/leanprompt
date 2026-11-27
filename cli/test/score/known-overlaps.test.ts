import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNoteRuleIds, loadRuleIds } from "../../src/lint/rules.js";
import { parseProfile } from "../../src/profile.js";
import { costSummary, costsNothing, formatDollars, ownerQuestions } from "../../src/report/cost.js";
import { handoffText, loadRules, renderReport, type ScoreFile } from "../../src/report/html.js";
import { renderMarkdown } from "../../src/report/markdown.js";
import { isKnownFinding, isOpenQuestion, parseFindings, staticScore, type Finding, type Note } from "../../src/score/static.js";
import { PACKAGE_ROOT, scoreCommand } from "../../src/score/write.js";

// What 0.1.0-dev.14 added from real audits: prior art (known), overlaps, size-unknown, correctness notes, unattended, currency.
const IDS = loadRuleIds(PACKAGE_ROOT);
const NOTE_IDS = loadNoteRuleIds(PACKAGE_ROOT);
const rules = loadRules(PACKAGE_ROOT);
const f = (o: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "src/a.ts", line: 3, saves: "prefill", severity: "high", ...o });
const doc = (findings: unknown[], extra: object = {}) => JSON.stringify({ v: 1, findings, ...extra });
const parse = (findings: unknown[], extra: object = {}) => parseFindings(doc(findings, extra), IDS, NOTE_IDS);
const ISSUE = "https://github.com/acme/app/issues/12";
const score: ScoreFile = { score: 80, kind: "static", weights: "default", inputs: { E: 0.9, S: 1, G: 0 }, date: "2026-11-26" };

describe("known: what the project already knows (prior art)", () => {
  it("accepts the four kinds with a link, and rejects a bad kind, a missing link, unknown keys and known with planned", () => {
    for (const kind of ["planned", "in-progress", "declined", "reported"]) {
      const r = parse([f({ known: { kind: kind as never, url: ISSUE, note: "open" } })]);
      expect(r.errors, kind).toEqual([]);
      expect(r.findings[0]!.known).toEqual({ kind, url: ISSUE, note: "open" });
    }
    expect(parse([{ ...f(), known: { kind: "wontfix", url: ISSUE } }]).errors[0]).toMatch(/known\.kind must be one of planned, in-progress, declined, reported/);
    expect(parse([{ ...f(), known: { kind: "planned" } }]).errors[0]).toMatch(/known\.url must be the http\(s\) link/);
    expect(parse([{ ...f(), known: { kind: "planned", url: ISSUE, state: "open" } }]).errors[0]).toMatch(/unknown key state/);
    expect(parse([{ ...f(), planned: "issue 12", known: { kind: "planned", url: ISSUE } }]).errors[0]).toMatch(/known or planned, not both/);
  });

  it("a known finding, or one with the older planned text, is left out of the static score; includeKnown gives the 0.1.0-dev.13 figure", () => {
    const open = f({ share: 0.1 });
    const known = f({ share: 0.5, known: { kind: "planned", url: ISSUE } });
    const legacy = f({ share: 0.5, planned: "issue 12, open" });
    expect(isKnownFinding(known)).toBe(true);
    expect(isKnownFinding(legacy)).toBe(true);
    expect(isKnownFinding(f({ fixed: true, planned: "x" }))).toBe(false);
    const s = staticScore([open, known]);
    expect(s.score).toBe(staticScore([open]).score);
    expect(s.known_findings).toBe(1);
    expect(staticScore([open, legacy]).score).toBe(staticScore([open]).score);
    // floor(100 x (0.6 x 0.9 x 0.5 + 0.4)) = 67, as 0.1.0-dev.13 scored it
    expect(staticScore([open, known], undefined, { includeKnown: true }).score).toBe(67);
    expect(isOpenQuestion(f({ status: "needs-facts", confirm: "x", known: { kind: "reported", url: ISSUE } }))).toBe(false);
  });

  it("known findings are not in the totals, have their own section, and a declined one is a line with its link and left out of the hand-off", () => {
    const fs = [
      f({ problem: "The history is never cached.", tokens_per_1k: { uncached: 100_000 }, share: 0.1 }),
      f({ file: "src/b.ts", problem: "The time is in the system prompt.", tokens_per_1k: { uncached: 900_000 }, share: 0.4, known: { kind: "planned", url: ISSUE, note: "issue 12, open, core team" } }),
      f({ file: "src/c.ts", rule: "LP-GE-05", saves: "generation", problem: "A parse failure asks again.", tokens_per_1k: { output: 50_000 }, share: 0.05, known: { kind: "declined", url: "https://github.com/acme/app/pull/30" } }),
    ];
    const cost = costSummary(fs, null);
    expect(cost.tokens_per_1k).toBe(100_000);
    expect(cost.known_tokens_per_1k).toBe(950_000);
    const html = renderReport({ findings: fs, score, rules, project: "acme", version: "1.2.3" });
    expect(html).toMatch(/<h1>1 place where this app pays/);
    expect(html).toMatch(/<h2>Already known to the project<\/h2>/);
    expect(html).toMatch(/Already planned<\/dt><dd>issue 12, open, core team https:\/\/github\.com\/acme\/app\/issues\/12/);
    expect(html).toMatch(/<h3>Declined by the project<\/h3><ul class="declined"><li[^>]*>A parse failure asks again\. <code>src\/c\.ts:3<\/code> <a href="https:\/\/github\.com\/acme\/app\/pull\/30">/);
    const hand = handoffText(fs, rules);
    expect(hand).toMatch(/Already known to the project[\s\S]*The time is in the system prompt\. Already planned: issue 12/);
    expect(hand).not.toMatch(/A parse failure asks again/);
    const md = renderMarkdown({ findings: fs, score, rules, project: "acme", version: "1.2.3" }, { date: "2026-11-26" });
    expect(md).toMatch(/## Already known to the project[\s\S]*- \*\*Already planned:\*\* issue 12/);
    expect(md).toMatch(/### Declined by the project\n\n\d+\. A parse failure asks again · `src\/c\.ts:3` · https:\/\/github\.com\/acme\/app\/pull\/30/);
  });

  it("score.json records the known findings and the score with them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-known-"));
    mkdirSync(join(dir, ".leanprompt"));
    writeFileSync(join(dir, ".leanprompt", "findings.json"), doc([f({ share: 0.1 }), f({ share: 0.5, known: { kind: "reported", url: ISSUE } })]));
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    expect(await scoreCommand(["--static", "--dir", dir])).toBe(0);
    vi.restoreAllMocks();
    const s = JSON.parse(readFileSync(join(dir, ".leanprompt", "score.json"), "utf8"));
    expect(s.score).toBe(94);
    expect(s.diagnostics.known_findings).toBe(1);
    expect(s.known).toMatchObject({ findings: 1, with_known_score: 67 });
    expect(out).toMatch(/known: 1 finding the project already knows about .* left out \(with them: 67\)/);
  });
});

describe("overlaps: a group of findings counts once", () => {
  const a = f({ id: "gateway", share: 0.4, tokens_per_1k: { uncached: 8_000_000 }, status: "needs-facts", confirm: "x", problem: "The default model gets no cache marks." });
  const b = f({ id: "loop", share: 0.05, tokens_per_1k: { uncached: 450_000 }, overlaps: ["gateway"], problem: "The tool loop keeps its mark on the user message." });
  const c = f({ file: "src/w.ts", share: 0.1, tokens_per_1k: { uncached: 2_500_000 }, problem: "The window slides every turn." });

  it("validates ids and overlaps", () => {
    expect(parse([a, b, c]).errors).toEqual([]);
    expect(parse([{ ...b, id: undefined }]).errors[0]).toMatch(/needs its own id/);
    expect(parse([b]).errors[0]).toMatch(/overlaps names gateway, which no finding has as its id/);
    expect(parse([a, { ...a }]).errors[0]).toMatch(/id gateway is used twice/);
    expect(parse([{ ...a, id: "bad id" }]).errors[0]).toMatch(/id must be/);
    expect(parse([{ ...b, overlaps: ["loop"] }]).errors[0]).toMatch(/cannot overlap itself/);
  });

  it("the static score takes the largest share of each group, on each side", () => {
    // groups {a, b} -> 0.4, {c} -> 0.1: E = 0.6 x 0.9 = 0.54; floor(100 x (0.6 x 0.54 + 0.4)) = 72
    expect(staticScore([a, b, c]).score).toBe(72);
    expect(staticScore([a, { ...b, overlaps: undefined }, c]).score).toBe(70);
  });

  it("the totals count the larger once; what the open questions add leaves out what they share with a finding", () => {
    const cost = costSummary([a, b, c], null);
    expect(cost.tokens_per_1k).toBe(2_950_000);
    // with the question: {a, b} -> 8M, plus c 2.5M = 10.5M; minus the findings' 2.95M
    expect(cost.question_tokens_per_1k).toBe(7_550_000);
    expect(cost.overlaps).toBe(true);
  });

  it("the headline names the largest open question when it is larger than the largest finding", () => {
    const html = renderReport({ findings: [a, b, c], score, rules, project: "chat", version: "1.2.3" });
    expect(html).toMatch(/The biggest, at <code>src\/w\.ts:3<\/code>, about 2\.5M tokens per 1,000 calls/);
    expect(html).toMatch(/The largest item is an open question, at <code>src\/a\.ts:3<\/code>, about 8M tokens per 1,000 calls if it holds: the default model gets no cache marks\./);
    expect(html).toMatch(/Findings that overlap are counted once\./);
    expect(html).toMatch(/Overlaps<\/dt><dd>Finding 3 loses some of the same tokens/);
    const md = renderMarkdown({ findings: [a, b, c], score, rules, project: "chat", version: "1.2.3" }, { date: "2026-11-26" });
    expect(md).toMatch(/The largest item is an open question, at `src\/a\.ts:3`, about 8M tokens per 1,000 calls if it holds/);
    // A question smaller than the largest finding is not named.
    const small = renderReport({ findings: [{ ...a, tokens_per_1k: { uncached: 1000 } }, c], score, rules, project: "chat", version: "1.2.3" });
    expect(small).not.toMatch(/largest item is an open question/);
  });
});

describe("a finding that costs no tokens is not a place", () => {
  it("costsNothing needs every share 0 and no tokens", () => {
    expect(costsNothing(f({ share: 0 }))).toBe(true);
    expect(costsNothing(f({ share: 0, tokens_per_1k: {} as never }))).toBe(true);
    expect(costsNothing(f({ share: 0, tokens_per_1k: { uncached: 10 } }))).toBe(false);
    expect(costsNothing(f())).toBe(false); // no share: the severity default applies
    expect(costsNothing(f({ saves: "both", share_prefill: 0, share_output: 0.01 }))).toBe(false);
  });

  it("the headline leaves it out of the count and says so", () => {
    const html = renderReport({ findings: [f({ share: 0.1, tokens_per_1k: { uncached: 10_000 } }), f({ file: "src/z.ts", share: 0 })], score, rules, project: "x", version: "1.2.3" });
    expect(html).toMatch(/<h1>1 place where/);
    expect(html).toMatch(/Plus 1 finding that costs no tokens today/);
  });
});

describe("size-unknown", () => {
  it("is a finding, needs confirm, and is marked on the page and in the report", () => {
    expect(parse([{ ...f(), status: "size-unknown" }]).errors[0]).toMatch(/size-unknown finding needs `confirm`/);
    const x = f({ status: "size-unknown", confirm: "reasoning_tokens per answer at medium and at low", share: 0.2 });
    expect(parse([x]).errors).toEqual([]);
    expect(isOpenQuestion(x)).toBe(false);
    const html = renderReport({ findings: [x], score, rules, project: "x", version: "1.2.3" });
    expect(html).toMatch(/<span class="flag">size is assumed<\/span>/);
    expect(html).toMatch(/How big it is<\/dt><dd>The code shows the problem and how often it happens/);
    expect(renderMarkdown({ findings: [x], score, rules, project: "x", version: "1.2.3" }, { date: "2026-11-26" })).toMatch(/\*\*How big:\*\* the code shows the problem and how often/);
  });
});

describe("notes: a correctness rule, a link to a finding, known", () => {
  const meter: Note = { title: "The spend cap ignores cache tokens", rule: "LP-GE-11", severity: "high", file: "lib/usage.ts", line: 31, problem: "It adds input_tokens only.", change: "Add both cache fields." };

  it("LP-GE-11 is a correctness rule: allowed on a note with a severity, refused on a finding", () => {
    expect(NOTE_IDS.has("LP-GE-11")).toBe(true);
    expect(parse([], { notes: [meter] }).errors).toEqual([]);
    expect(parse([f({ rule: "LP-GE-11" })]).errors[0]).toMatch(/LP-GE-11 is a correctness rule with no token share: record it as a note/);
    expect(parse([], { notes: [{ ...meter, rule: "LP-PC-01" }] }).errors[0]).toMatch(/not a correctness rule/);
    expect(parse([], { notes: [{ ...meter, rule: undefined }] }).errors[0]).toMatch(/severity is not allowed on a note without a rule/);
    expect(parse([], { notes: [{ ...meter, share: 0.1 }] }).errors[0]).toMatch(/share is not allowed: a note is never scored/);
  });

  it("a note can name the finding it is another face of, and the page links it", () => {
    const fx = f({ id: "effort", problem: "Effort is fixed at medium.", share: 0.2 });
    expect(parse([fx], { notes: [{ ...meter, finding: "nope" }] }).errors[0]).toMatch(/finding nope is not the id of any finding/);
    const n = { ...meter, finding: "effort" };
    expect(parse([fx], { notes: [n] }).errors).toEqual([]);
    const html = renderReport({ findings: [fx], notes: [n], score, rules, project: "x", version: "1.2.3" });
    expect(html).toMatch(/Same problem as<\/dt><dd><a href="#f1">finding 1<\/a>/);
    expect(html).toMatch(/<span class="rid">LP-GE-11<\/span> <span class="sev">high<\/span>/);
    expect(html).toMatch(/blob\/v1\.2\.3\/skills\/generation-economy\/rules\/LP-GE-11\.md/);
    const md = renderMarkdown({ findings: [fx], notes: [n], score, rules, project: "x", version: "1.2.3" }, { date: "2026-11-26" });
    expect(md).toMatch(/- \*\*Rule:\*\* \[LP-GE-11 Meter every billed token[^\]]*\]\([^)]+\), severity high/);
    expect(md).toMatch(/- \*\*Same problem as:\*\* finding 1/);
  });

  it("a declined note is listed with its link only and left out of the hand-off", () => {
    const n: Note = { ...meter, rule: undefined, severity: undefined, title: "English text on degraded days", known: { kind: "declined", url: "https://github.com/acme/app/blob/abc/CLAUDE.md#L63", note: "by design" } };
    delete (n as Partial<Note>).rule;
    delete (n as Partial<Note>).severity;
    expect(parse([], { notes: [n] }).errors).toEqual([]);
    const html = renderReport({ findings: [], notes: [n], score, rules, project: "x", version: "1.2.3" });
    expect(html).toMatch(/note declined[\s\S]*by design <a href="https:\/\/github\.com\/acme\/app\/blob\/abc\/CLAUDE\.md#L63">/);
    expect(handoffText([], rules, { notes: [n] })).not.toMatch(/English text/);
  });
});

describe("unattended runs and the questions for the owner", () => {
  it("findings.json takes unattended: true; the page and the report say so", () => {
    expect(parse([], { unattended: true }).unattended).toBe(true);
    expect(parse([], { unattended: "yes" }).errors[0]).toMatch(/unattended must be true or false/);
    const html = renderReport({ findings: [f({ share: 0.1 })], score, rules, project: "x", version: "1.2.3", unattended: true });
    expect(html).toMatch(/Unattended audit: nobody was asked during the run/);
    const md = renderMarkdown({ findings: [f({ share: 0.1 })], score, rules, project: "x", version: "1.2.3", unattended: true }, { date: "2026-11-26" });
    expect(md).toMatch(/priority: not set · unattended run/);
    expect(md).toMatch(/\*\*Unattended audit: nobody was asked/);
  });

  it("the page shows the same Questions for the owner as the Markdown report", () => {
    const fs = [f({ share: 0.1, tokens_per_1k: { uncached: 10_000 } })];
    const html = renderReport({ findings: fs, score, rules, project: "x", version: "1.2.3" });
    expect(html).toMatch(/<h2>Questions for the owner<\/h2>/);
    for (const q of ownerQuestions(null, costSummary(fs, null), undefined)) expect(html).toContain(`<strong>${q.label}:</strong>`);
    expect(html).toMatch(/href="#s-owner"/);
    const answered = renderReport({ findings: fs, score, rules, project: "x", version: "1.2.3", priority: "cost", profile: parseProfile("volume: {calls_per_month: 1000}\nprices:\n  m: {input: 1, output: 2, cached_input: 0.1, source: x, checked: 2026-11-26}\n").profile });
    expect(answered).not.toMatch(/Questions for the owner/);
  });
});

describe("prices in another currency", () => {
  const yaml = (cur: string) => `volume: {calls_per_month: 100000}\nprices:\n  qwen-flash: {input: 0.15, output: 1.5, cached_input: 0.03, currency: ${cur}, source: https://example.com/pricing, checked: 2026-11-26}\n`;

  it("accepts an ISO code, shows the figures in it and never converts", () => {
    const p = parseProfile(yaml("CNY"));
    expect(p.errors).toEqual([]);
    expect(p.profile!.prices!["qwen-flash"]!.currency).toBe("CNY");
    expect(parseProfile(yaml("yuan")).errors[0]).toMatch(/three-letter ISO 4217 code/);
    expect(formatDollars(12.4, "CNY")).toBe("CNY 12");
    expect(formatDollars(1.5)).toBe("$1.50");
    const fs = [f({ share: 0.1, tokens_per_1k: { uncached: 1_000_000 } })];
    const cost = costSummary(fs, p.profile!);
    expect(cost.money?.currency).toBe("CNY");
    const html = renderReport({ findings: fs, score, rules, project: "x", version: "1.2.3", profile: p.profile });
    expect(html).toMatch(/About CNY 12 a month/);
    expect(html).toMatch(/input CNY 0\.15, cached input CNY 0\.03, output CNY 1\.50 per 1M tokens/);
    expect(html).toMatch(/Prices are in CNY, as given in leanprompt\.yaml; leanprompt does not convert them\./);
  });

  it("two currencies are not added together", () => {
    const p = parseProfile(
      "volume: {calls_per_month: 1000}\nprices:\n  a: {input: 1, output: 2, cached_input: 0.1, source: x, checked: 2026-11-26}\n  b: {input: 1, output: 2, cached_input: 0.1, currency: EUR, source: x, checked: 2026-11-26}\n",
    ).profile!;
    const cost = costSummary([f({ model: "a", share: 0.1, tokens_per_1k: { uncached: 1000 } }), f({ model: "b", file: "b.ts", share: 0.1, tokens_per_1k: { uncached: 1000 } })], p);
    expect(cost.money).toBeUndefined();
    expect(cost.missing.join("\n")).toMatch(/one currency for every model/);
  });
});
