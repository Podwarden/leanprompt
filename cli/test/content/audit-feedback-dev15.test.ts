import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { loadNoteRuleIds, loadRuleIds, loadRules } from "../../src/lint/rules.js";
import { costSummary } from "../../src/report/cost.js";
import { parseProfile } from "../../src/profile.js";
import { handoffText, renderReport, reportCommand } from "../../src/report/html.js";
import { renderMarkdown } from "../../src/report/markdown.js";
import { PRIVATE_FILE, renderPrivateList } from "../../src/report/private.js";
import { parseFindings, PRIVATE_HEADER, staticScore } from "../../src/score/static.js";
import { githubAnnotations, scoreCommand } from "../../src/score/write.js";

// What the latest real audits asked for (0.1.0-dev.15): new rule families, gateway mode, the small-app fast path,
// a per-run unit, counted figures, more fact tables and private items.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const RULES = join("skills", "generation-economy", "rules");
const section = (text: string, heading: string): string => {
  const i = text.indexOf(`## ${heading}\n`);
  if (i < 0) return "";
  const j = text.indexOf("\n## ", i + 3);
  return text.slice(i, j < 0 ? undefined : j);
};
const ids = loadRuleIds(ROOT);
const noteIds = loadNoteRuleIds(ROOT);
const rules = loadRules(ROOT);
const parse = (doc: unknown) => parseFindings(JSON.stringify(doc), ids, noteIds);

describe("the new rule families", () => {
  const meta = (id: string) => parseDoc(read(RULES, `${id}.md`)).meta as { saves: string; severity: string };

  it("LP-GE-12, 13, 15, 16 and 17 are correctness rules recorded as notes; LP-GE-14 carries a token share", () => {
    for (const id of ["LP-GE-12", "LP-GE-13", "LP-GE-15", "LP-GE-16", "LP-GE-17"]) {
      expect(meta(id).saves, id).toBe("none");
      expect(noteIds.has(id), id).toBe(true);
      expect(section(read(RULES, `${id}.md`), "Waste signal"), id).toMatch(new RegExp(`No token share[\\s\\S]*note with \`"rule": "${id}"\``));
    }
    expect(meta("LP-GE-14").saves).toBe("both");
    expect(noteIds.has("LP-GE-14")).toBe(false);
    // A correctness rule cannot be a finding.
    expect(parse({ v: 1, findings: [{ rule: "LP-GE-12", file: "a.py", line: 1, saves: "both", severity: "high" }] }).errors.join()).toMatch(/record it as a note/);
    expect(parse({ v: 1, findings: [], notes: [{ title: "Cut off", rule: "LP-GE-12", severity: "high", file: "a.py", line: 1, problem: "p", change: "c" }] }).errors).toEqual([]);
  });

  it("LP-GE-12 detects the finish reason in Python, TS/JS and Go, and the SDK truncation exceptions", () => {
    const t = read(RULES, "LP-GE-12.md");
    const d = section(t, "Detect in code");
    for (const s of ["LengthFinishReasonError", "NoObjectGeneratedError", "finishReason", "FinishReason", "incomplete_details", "max_tokens"]) expect(t).toContain(s);
    for (const lang of ["Python:", "TS/JS:", "Go:"]) expect(d).toContain(lang);
    // It points at LP-GE-05 for the resend and LP-GE-03 for the budget, so a cut-off is not counted twice.
    expect(section(t, "Why")).toMatch(/LP-GE-05/);
    expect(section(t, "Why")).toMatch(/LP-GE-03/);
    expect(section(t, "Detect in code")).toMatch(/"scope": "proxied"/);
  });

  it("LP-GE-13 checks model ids against the dated retirement table, which separates snapshots from aliases", () => {
    const t = read(RULES, "LP-GE-13.md");
    expect(t).toContain("](../../../models/retirements.md)");
    expect(t).toMatch(/dated snapshot and a bare alias/);
    const table = read("models", "retirements.md");
    const m = parseDoc(table).meta as { family: string; checked: unknown };
    expect(m.family).toBe("retirements");
    expect(table).toMatch(/## Snapshot and alias/);
    for (const h of ["## OpenAI", "## Anthropic", "## Google Gemini API"]) expect(table).toContain(h);
    const rows = table.split("\n").filter((l) => /^\| `/.test(l));
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r, r).toMatch(/https:\/\//);
      expect(r, r).toMatch(/\| (retired|scheduled|deprecated, no date) \|/);
    }
    // Rows the audits relied on, as the pages state them on the date read.
    expect(rows.find((r) => r.includes("`gpt-4o-mini-2024-07-18`"))).toMatch(/2027-01-14/);
    expect(rows.find((r) => r.includes("`gemini-2.0-flash`"))).toMatch(/retired \| 2026-06-01/);
  });

  it("LP-GE-14 is the bug in a cache the app has, LP-GE-06 the missing cache", () => {
    const t = read(RULES, "LP-GE-14.md");
    expect(t).toMatch(/hexdigest\(\)\[:16\]/);
    expect(t).toMatch(/timestamp/);
    expect(t).toMatch(/LP-GE-06/);
    expect(section(t, "Waste signal")).toMatch(/"unit": "run"/);
  });

  it("LP-GE-15 and LP-GE-16 hand the token side to LP-GE-04 and LP-GE-05", () => {
    expect(section(read(RULES, "LP-GE-15.md"), "Why")).toMatch(/per-call value used as a deadline for the whole run/);
    expect(section(read(RULES, "LP-GE-15.md"), "Waste signal")).toMatch(/LP-GE-04 finding/);
    expect(section(read(RULES, "LP-GE-16.md"), "Why")).toMatch(/Authentication[\s\S]*Quota and credit[\s\S]*Invalid request/);
    expect(section(read(RULES, "LP-GE-16.md"), "Waste signal")).toMatch(/LP-GE-05 finding/);
    expect(section(read(RULES, "LP-GE-17.md"), "Why")).toMatch(/max_completion_tokens/);
  });

  it("LP-GE-11 covers a gateway's price book and its settlement", () => {
    const t = read(RULES, "LP-GE-11.md");
    expect(section(t, "Why")).toMatch(/Gateways and proxies that bill their clients/);
    expect(section(t, "Waste signal")).toMatch(/High: a gateway or proxy that charges its clients from a price book with no cache-read or cache-write rate/);
  });
});

describe("the audit skill", () => {
  const SKILL = read("skills", "llm-call-audit", "SKILL.md");

  it("has a small-app fast path with a threshold, the reliability checks first and no call-mix modelling", () => {
    const s = section(SKILL, "The small-app fast path");
    expect(s).toMatch(/under about 5,000 lines[\s\S]*fewer than about 10 LLM call sites/);
    for (const id of ["LP-GE-12", "LP-GE-15", "LP-GE-05", "LP-GE-16", "LP-GE-13", "LP-GE-17", "LP-GE-11"]) expect(s).toContain(id);
    expect(s).toMatch(/Skip the call-mix modelling/);
    expect(s).toMatch(/version the lockfile pins/);
  });

  it("has a gateway checklist and records scope own or proxied", () => {
    const s = section(SKILL, "Gateways and proxies");
    for (const x of ["Byte-faithful passthrough", "Cross-protocol conversion", "The price book", "Finish reasons", "Successful upstream replies turned into errors", "Reservation and settlement"]) expect(s).toContain(x);
    expect(s).toMatch(/"gateway": true/);
    expect(s).toMatch(/"own"[\s\S]*"proxied"/);
  });

  it("documents the per-run unit, counted figures and private items in the findings file", () => {
    const f = section(SKILL, "The findings file");
    for (const k of ["`unit` and `tokens_per_run`", "`evidence` and `counted_from`", "`gateway`", "`private`"]) expect(f).toContain(k);
    expect(SKILL).toMatch(/\*\*Private items\.\*\*[\s\S]*Do not publish/);
  });
});

describe("the fact tables added in 0.1.0-dev.15", () => {
  it("DeepSeek, Groq, xAI and Together have dated provider tables with a cache block", () => {
    for (const p of ["deepseek", "groq", "xai", "together"]) {
      const m = parseDoc(read("providers", `${p}.md`)).meta as { provider: string; checked: unknown; source: string; cache: { mode: string } };
      expect(m.provider).toBe(p);
      expect(String(m.source)).toMatch(/^https:\/\//);
      expect(m.cache.mode).toBe("automatic");
    }
  });

  it("the SDK page covers the Claude Agent SDK, the Codex SDK and the AI SDK, with a source on every row", () => {
    const t = read("runtimes", "llm-sdks.md");
    for (const s of ["Claude Agent SDK", "Codex SDK", "AI SDK", "error_max_turns", "cached_input_tokens", "finishReason"]) expect(t).toContain(s);
  });

  it("tokens per character is measured with named tokenizers on a stated sample, not invented", () => {
    const t = read("models", "tokens-per-character.md");
    expect(t).toMatch(/## Method/);
    for (const s of ["cl100k_base", "o200k_base", "tiktoken"]) expect(t).toContain(s);
    expect(t).toMatch(/Universal Declaration of Human Rights/);
  });
});

const PRIV_NOTE = { title: "The default base URL sends users' keys to a third-party relay", file: "start.py", line: 3, problem: "RELAY-SECRET-TEXT reaches the relay.", change: "Default to the provider's own URL.", private: true };
const PRIV_FINDING = { rule: "LP-PC-03", file: "secret.py", line: 9, saves: "prefill", severity: "high", share: 0.5, problem: "PRIVATE-FINDING-TEXT", private: true };
const PUBLIC = { rule: "LP-PC-03", file: "app.py", line: 4, saves: "prefill", severity: "high", share: 0.2, tokens_per_1k: { uncached: 1000 }, problem: "The prompt starts with the time." };
const DOC = { v: 1, findings: [PUBLIC, PRIV_FINDING], notes: [{ title: "Public note", file: "a.py", line: 1, problem: "p", change: "c" }, PRIV_NOTE] };

describe("private items", () => {
  it("are split from the public findings and notes, and never scored", () => {
    const p = parse(DOC);
    expect(p.errors).toEqual([]);
    expect(p.findings.map((f) => f.file)).toEqual(["app.py"]);
    expect(p.notes!.map((n) => n.title)).toEqual(["Public note"]);
    expect(p.private!.findings.map((f) => f.file)).toEqual(["secret.py"]);
    expect(p.private!.notes.map((n) => n.file)).toEqual(["start.py"]);
    const without = parse({ v: 1, findings: [PUBLIC] });
    expect(staticScore(p.findings).score).toBe(staticScore(without.findings).score);
    expect(parse({ v: 1, findings: [PUBLIC] }).private).toBeUndefined();
  });

  it("a public item may not name a private one", () => {
    const d = { v: 1, findings: [{ ...PUBLIC, id: "pub", overlaps: ["sec"] }, { ...PRIV_FINDING, id: "sec" }], notes: [{ title: "t", file: "a.py", line: 1, problem: "p", change: "c", finding: "sec" }] };
    const errs = parse(d).errors.join("\n");
    expect(errs).toMatch(/overlaps names sec, a private finding/);
    expect(errs).toMatch(/finding sec is private/);
    expect(parse({ v: 1, findings: [], notes: [{ ...PRIV_NOTE, private: "yes" }] }).errors.join()).toMatch(/private must be true or false/);
  });

  it("never appear in the page, the Markdown report, the hand-off block or GitHub annotations", () => {
    const p = parse(DOC);
    const input = { findings: p.findings, notes: p.notes ?? [], score: null, rules, project: "acme", version: "0.1.0-dev.15" };
    const outputs = [
      renderReport(input),
      renderMarkdown(input, { date: "2026-11-27" }),
      handoffText(p.findings, rules, { notes: p.notes ?? [] }),
      githubAnnotations(p.findings, rules).join("\n"),
    ];
    for (const o of outputs) {
      expect(o).not.toContain("RELAY-SECRET-TEXT");
      expect(o).not.toContain("PRIVATE-FINDING-TEXT");
      expect(o).not.toContain("third-party relay");
      expect(o).not.toContain("secret.py");
      expect(o).not.toMatch(/private/i);
    }
  });

  it("are listed only in .leanprompt/private.md, headed Do not publish", () => {
    const text = renderPrivateList(parse(DOC).private)!;
    expect(text.split("\n")[0]).toBe(`# ${PRIVATE_HEADER}`);
    expect(PRIVATE_HEADER).toBe("Do not publish");
    expect(text).toContain("RELAY-SECRET-TEXT");
    expect(text).toContain("PRIVATE-FINDING-TEXT");
    expect(renderPrivateList(undefined)).toBeNull();
  });

  describe("the commands", () => {
    let dir: string;
    let out: string[];
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "lp-priv-"));
      mkdirSync(join(dir, ".leanprompt"));
      writeFileSync(join(dir, ".leanprompt", "findings.json"), JSON.stringify(DOC));
      out = [];
      vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    });
    afterEach(() => vi.restoreAllMocks());

    it("score --github and report --html --md leave private items out and write the private list, kept out of git", async () => {
      expect(await scoreCommand(["--static", "--dir", dir, "--github"])).toBe(0);
      expect(await reportCommand(["--html", "--md", "--dir", dir])).toBe(0);
      const pub = [out.join(""), readFileSync(join(dir, ".leanprompt", "score.json"), "utf8"), readFileSync(join(dir, ".leanprompt", "report.html"), "utf8"), readFileSync(join(dir, "leanprompt-report.md"), "utf8")];
      for (const t of pub) {
        expect(t).not.toContain("RELAY-SECRET-TEXT");
        expect(t).not.toContain("PRIVATE-FINDING-TEXT");
        expect(t).not.toContain("secret.py");
      }
      expect(existsSync(join(dir, PRIVATE_FILE))).toBe(true);
      expect(readFileSync(join(dir, PRIVATE_FILE), "utf8")).toMatch(/^# Do not publish\n/);
      expect(readFileSync(join(dir, ".leanprompt", ".gitignore"), "utf8").split("\n")).toContain("private.md");
      // The score is the one without the private finding.
      const score = JSON.parse(readFileSync(join(dir, ".leanprompt", "score.json"), "utf8")) as { score: number };
      expect(score.score).toBe(staticScore(parse({ v: 1, findings: [PUBLIC] }).findings).score);
    });
  });
});

describe("findings per run, counted figures and scope", () => {
  const RUN = { rule: "LP-GE-14", file: "refresh.py", line: 30, saves: "both", severity: "high", share: 0.6, unit: "run", tokens_per_run: { prompt: 40000, output: 9000 }, problem: "Every page is summarised again on every run." };

  it("validate unit run, tokens_per_run and the run description", () => {
    expect(parse({ v: 1, run: "one nightly refresh", findings: [RUN] }).errors).toEqual([]);
    expect(parse({ v: 1, findings: [RUN] }).errors.join()).toMatch(/run is required when a finding has unit run/);
    expect(parse({ v: 1, run: "x", findings: [{ ...RUN, tokens_per_1k: { prompt: 1 }, tokens_per_run: undefined }] }).errors.join()).toMatch(/gives tokens_per_run, not tokens_per_1k/);
    expect(parse({ v: 1, findings: [{ ...PUBLIC, tokens_per_run: { prompt: 1 } }] }).errors.join()).toMatch(/tokens_per_run needs "unit": "run"/);
    expect(parse({ v: 1, findings: [{ ...PUBLIC, unit: "day" }] }).errors.join()).toMatch(/unit must be calls or run/);
  });

  it("keep separate totals per unit, never added, and price a run without a volume", () => {
    const p = parse({ v: 1, run: "one nightly refresh", findings: [PUBLIC, RUN] });
    const parsedProfile = parseProfile("target: {provider: openai}\nprices:\n  m: {input: 1, output: 4, cached_input: 0.1, source: \"https://example.com/p\", checked: 2026-11-27}\n");
    expect(parsedProfile.errors).toEqual([]);
    const profile = parsedProfile.profile!;
    const c = costSummary(p.findings, profile, undefined, p.run);
    expect(c.tokens_per_1k).toBe(1000);
    expect(c.run_tokens).toBe(49000);
    expect(c.with_tokens).toBe(1);
    expect(c.run_with_tokens).toBe(1);
    expect(c.dollars_per_run).toBeCloseTo((40000 * 1 + 9000 * 4) / 1e6);
    const md = renderMarkdown({ findings: p.findings, score: null, rules, project: "acme", run: p.run }, { date: "2026-11-27" });
    expect(md).toMatch(/about 1k tokens per 1,000 calls, and about 49k tokens per run \(one nightly refresh\)/);
    expect(md).toMatch(/the two units are kept apart/);
    const html = renderReport({ findings: p.findings, score: null, rules, project: "acme", run: p.run });
    expect(html).toContain("Tokens per run (one nightly refresh), by finding");
    expect(html).toContain("Tokens (per 1,000 calls, or per run where marked)");
    expect(html).not.toMatch(/50k tokens/);
    // The share is a share either way: the score does not depend on the unit.
    expect(staticScore(p.findings).score).toBe(staticScore(parse({ v: 1, findings: [PUBLIC, { ...RUN, unit: undefined, tokens_per_run: undefined }] }).findings).score);
  });

  it("label a counted figure as counted, not as an estimate", () => {
    const counted = { ...PUBLIC, evidence: "counted", counted_from: "66 of 558 highlights in data/highlights.json" };
    expect(parse({ v: 1, findings: [{ ...PUBLIC, evidence: "counted" }] }).errors.join()).toMatch(/needs counted_from/);
    expect(parse({ v: 1, findings: [{ ...PUBLIC, counted_from: "x" }] }).errors.join()).toMatch(/counted_from goes with/);
    const p = parse({ v: 1, findings: [counted] });
    expect(p.errors).toEqual([]);
    const html = renderReport({ findings: p.findings, score: null, rules, project: "acme" });
    expect(html).toContain("<dt>Counted</dt>");
    expect(html).toContain("Counted from 66 of 558 highlights");
    expect(html).toMatch(/counted from the app&#39;s own committed output, not an estimate/);
    const md = renderMarkdown({ findings: p.findings, score: null, rules, project: "acme" }, { date: "2026-11-27" });
    expect(md).toMatch(/\*\*Counted:\*\* about 1k tokens per 1,000 calls \(counted\)/);
  });

  it("separate the gateway's own calls from what it does to clients' calls", () => {
    const d = { v: 1, gateway: true, findings: [{ ...PUBLIC, scope: "proxied" }, { ...PUBLIC, file: "agent.py", scope: "own" }], notes: [{ title: "Cached tokens billed at the input rate", rule: "LP-GE-11", severity: "high", scope: "proxied", file: "billing.go", line: 1, problem: "p", change: "c" }] };
    const p = parse(d);
    expect(p.errors).toEqual([]);
    expect(p.gateway).toBe(true);
    expect(parse({ ...d, findings: [{ ...PUBLIC, scope: "both" }] }).errors.join()).toMatch(/scope must be own or proxied/);
    const input = { findings: p.findings, notes: p.notes ?? [], score: null, rules, project: "gw", gateway: true };
    const html = renderReport(input);
    expect(html).toMatch(/1 item is about the gateway&#39;s own calls, 2 items about what it does to its clients&#39; calls/);
    expect(html).toContain("clients&#39; calls through the gateway");
    expect(renderMarkdown(input, { date: "2026-11-27" })).toMatch(/- \*\*About:\*\* the gateway's own calls/);
  });
});

describe("the fifth batch of audits", () => {
  it("LP-GE-12 detects a finish reason taken as done, the empty-only half-fix and a cut-off answer that is cached", () => {
    const d = section(read(RULES, "LP-GE-12.md"), "Detect in code");
    expect(d).toMatch(/Boolean\(choice\.finish_reason\)/);
    expect(d).toMatch(/the half-fix, the finish reason read only inside `if not text:`/);
    expect(d).toMatch(/cut-off reply written to a response cache/);
    expect(d).toMatch(/points at a setting that does not exist \(LP-GE-17\)/);
  });

  it("LP-GE-13 checks image, embedding and picker ids and keeps defaults apart from selectable ids", () => {
    const t = read(RULES, "LP-GE-13.md");
    expect(section(t, "Detect in code")).toMatch(/image, embedding[\s\S]*picker[\s\S]*only selectable[\s\S]*only in docs/);
    expect(read("models", "retirements.md")).toMatch(/\| `dall-e-3` \| retired \| 2026-05-12 \|/);
  });

  it("LP-GE-15 and LP-GE-17 follow each setting to the client the call uses; LP-GE-05 and LP-PC-04 cover the new shapes", () => {
    expect(section(read(RULES, "LP-GE-15.md"), "Detect in code")).toMatch(/Follow each timeout setting to the client the call really uses[\s\S]*checked only when a stream chunk arrives/);
    expect(section(read(RULES, "LP-GE-17.md"), "Detect in code")).toMatch(/Follow the setting to the client the call really uses/);
    expect(section(read(RULES, "LP-GE-05.md"), "Detect in code")).toMatch(/status code in the error text[\s\S]*400, 401, 403 or 404/);
    expect(section(read("skills", "prefill-cache", "rules", "LP-PC-04.md"), "Detect in code")).toMatch(/Go `range` over a `map\[string\]\.\.\.`/);
  });

  it("cached_discount none prices the uncached tokens at 0 and says so; reach is shown on the card", () => {
    const f = { ...PUBLIC, cached_discount: "none", reach: "only users who switch to the API mode", model: "m" };
    expect(parse({ v: 1, findings: [{ ...PUBLIC, cached_discount: "half" }] }).errors.join()).toMatch(/cached_discount must be "none"/);
    const p = parse({ v: 1, findings: [f] });
    expect(p.errors).toEqual([]);
    const prof = parseProfile("target: {provider: openai}\nvolume: {calls_per_month: 1000}\nprices:\n  m: {input: 1, output: 4, source: \"https://example.com/p\", checked: 2026-11-27}\n").profile!;
    const c = costSummary(p.findings, prof);
    expect(c.money?.lost_per_month).toBe(0);
    expect(c.missing.join()).not.toMatch(/cached_input/);
    const html = renderReport({ findings: p.findings, score: null, rules, project: "acme" });
    expect(html).toContain("Who reaches this");
    expect(html).toContain("saves time, not money");
    expect(staticScore(p.findings).score).toBe(staticScore(parse({ v: 1, findings: [PUBLIC] }).findings).score);
  });
});
