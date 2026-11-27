import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/main.js";
import { costSummary } from "../../src/report/cost.js";
import { handoffText, loadRules, renderReport, type ScoreFile } from "../../src/report/html.js";
import { MD_BEGIN, MD_END, projectName, renderMarkdown, spliceReport } from "../../src/report/markdown.js";
import type { Profile } from "../../src/profile.js";
import type { Finding, Note } from "../../src/score/static.js";
import { PACKAGE_ROOT } from "../../src/score/write.js";

const rules = loadRules(PACKAGE_ROOT);
const f = (o: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "src/a.ts", line: 3, saves: "prefill", severity: "high", ...o });
const lw = (o: Partial<Finding> = {}): Finding =>
  f({ rule: "LP-LW-01", file: "<external>", line: 0, where: "engine launch flags", status: "needs-facts", confirm: "the engine's block size", problem: "Is the shared head longer than one engine block?", tokens_per_1k: { uncached: 900_000 }, ...o });
const note: Note = { title: "The spend cap ignores cache tokens", file: "lib/usage.ts", line: 31, problem: "It adds input_tokens and output_tokens only.", change: "Add the two cache fields.", verify: "The meter matches the bill." };
const score: ScoreFile = { score: 94, kind: "static", weights: "default", inputs: { E: 0.9, S: 1, G: 0 }, date: "2026-11-26", server: { included: false, findings: 1, with_server_score: 83 } };
const render = (findings: Finding[], extra: object = {}) => renderReport({ findings, score, rules, project: "demo", version: "1.2.3", ...extra });
const between = (html: string, a: string, b: string): string => {
  const i = html.indexOf(a);
  return i < 0 ? "" : html.slice(i, html.indexOf(b, i + a.length));
};

describe("the page: questions for the server's administrator", () => {
  const html = render([f({ problem: "The app sends no cache marks.", tokens_per_1k: { uncached: 100_000 } }), lw()]);

  it("lists server findings in their own section, after the app's, with what would answer them and profile detect", () => {
    const sec = between(html, "<h2>Questions for the server&#39;s administrator</h2>", "</section>");
    expect(sec).toContain("Is the shared head longer than one engine block?");
    expect(sec).toContain("What would answer it");
    expect(sec).toContain("the engine&#39;s block size");
    expect(sec).toContain("npx leanprompt profile detect --lmwarden &lt;url&gt;");
    expect(sec).toContain("score --with-server");
    expect(html.indexOf("Questions for the server")).toBeGreaterThan(html.indexOf("What&#39;s wrong and what to change"));
    // Not an app open question.
    expect(html).not.toContain("<h2>Open questions</h2>");
  });

  it("keeps them out of the headline count and the app's total, and says how many there are", () => {
    expect(html).toContain("1 place where this app pays for tokens it doesn&#39;t need");
    expect(html).toContain("about 100k tokens per 1,000 calls");
    expect(html).toMatch(/Plus 1 question for the server&#39;s administrator[^<]*not in this app&#39;s score/);
    expect(costSummary([f({ tokens_per_1k: { uncached: 100_000 } }), lw()], null).server_tokens_per_1k).toBe(900_000);
  });

  it("the score card names the app's own score and the figure with the server's findings", () => {
    const sc = between(html, "<h2>Score", "</section>");
    expect(sc).toMatch(/This is the app&#39;s own score\. It leaves out 1 finding for the server&#39;s administrator[^<]*with them it would be 83/);
    expect(sc).toContain("(the date on the machine that ran it)");
  });

  it("the hand-off block lists them apart and says not to change the app for them", () => {
    const block = handoffText([f(), lw()], rules);
    expect(block).toMatch(/Questions for the server's administrator \(not this app's code; do not change the app for these\):\n- LP-LW-01 \(engine launch flags\): Is the shared head[^\n]*What would answer it: the engine's block size/);
  });
});

describe("the page: notes, frequency-unknown, planned", () => {
  it("shows notes after the findings, marked not scored, and in the hand-off block", () => {
    const html = render([f({ problem: "The app sends no cache marks." })], { notes: [note] });
    const sec = between(html, "<h2>Other problems the audit found</h2>", "</section>");
    expect(sec).toContain("The spend cap ignores cache tokens");
    expect(sec).toContain("<code>lib/usage.ts:31</code>");
    expect(sec).toContain("not scored");
    expect(sec).toContain("Add the two cache fields.");
    expect(sec).toContain("The meter matches the bill.");
    expect(html.indexOf("Other problems the audit found")).toBeGreaterThan(html.indexOf("What&#39;s wrong and what to change"));
    expect(html.indexOf("Other problems the audit found")).toBeLessThan(html.indexOf("Fix it with your coding agent"));
    expect(html).toMatch(/Plus 1 other problem the audit found outside the rules/);
    const block = handoffText([f()], rules, { notes: [note] });
    expect(block).toContain("Other problems found outside the rules (check each against the code first; not scored):\n- The spend cap ignores cache tokens (lib/usage.ts:31): It adds input_tokens and output_tokens only. Change: Add the two cache fields.");
    expect(render([f()])).not.toContain("Other problems the audit found");
  });

  it("marks a frequency-unknown finding among the findings, with how to measure it", () => {
    const html = render([f({ status: "frequency-unknown", confirm: "count length stops in the logs" })]);
    const main_ = between(html, "What&#39;s wrong and what to change", "Fix it with your coding agent");
    expect(main_).toContain("how often is assumed");
    expect(main_).toContain("To measure it: count length stops in the logs");
    expect(html).not.toContain("<h2>Open questions</h2>");
    expect(html).toContain("1 place where this app pays");
  });

  it("shows planned work as already planned", () => {
    expect(render([f({ planned: "issue #412, open" })])).toMatch(/Already planned<\/dt><dd>issue #412, open/);
  });

  it("the hand-off pins the CLI to the page's version, and the profile link to the release", () => {
    const html = render([f({ tokens_per_1k: { prompt: 10 } })]);
    expect(html).toContain("install them: npx leanprompt@1.2.3 install");
    expect(html).toContain("https://github.com/Podwarden/leanprompt/blob/v1.2.3/docs/profile.md");
    expect(html).not.toContain("blob/main/");
  });
});

describe("the cost table", () => {
  const base: Profile = { target: { provider: "anthropic" }, priority: { cost: 1, speed: 0, quality: 0 } };
  const price = { input: 3, cached_input: 0.3, cache_write: 3.75, output: 15, source: "https://example.com/p", checked: "2026-11-26" };

  it("sorts by tokens: the app's findings, then its open questions, then the server's", () => {
    const s = costSummary(
      [
        f({ file: "small.ts", tokens_per_1k: { output: 10 } }),
        lw({ tokens_per_1k: { uncached: 5_000 } }),
        f({ file: "<external>", where: "gateway", tokens_per_1k: { uncached: 9_000 } }),
        f({ file: "big.ts", tokens_per_1k: { uncached: 1_000 } }),
      ],
      null,
    );
    expect(s.rows.map((r) => `${r.group}:${r.finding.file === "<external>" ? r.finding.where : r.finding.file}`)).toEqual([
      "open:big.ts", "open:small.ts", "question:gateway", "server:engine launch flags",
    ]);
  });

  it("subtracts the cache-write premium of a fix that adds marks", () => {
    // per 1k calls: 1M uncached x ($3 - $0.3) = $2.70; 200k written x ($3.75 - $3) = $0.15 => $2.55 per 1k calls
    const s = costSummary([f({ tokens_per_1k: { uncached: 1_000_000, cache_write: 200_000 } })], { ...base, volume: { calls_per_month: 1_000 }, prices: { m: price } });
    expect(s.rows[0]!.dollars_per_month).toBeCloseTo(2.55, 6);
    expect(s.tokens_per_1k).toBe(1_000_000);
    const noWrite = costSummary([f({ tokens_per_1k: { uncached: 1, cache_write: 1 } })], { ...base, volume: { calls_per_month: 1 }, prices: { m: { ...price, cache_write: undefined } } });
    expect(noWrite.missing.join("\n")).toMatch(/prices\.m\.cache_write/);
  });
});

describe("report --md", () => {
  const input = (o: object = {}) => ({ findings: [f({ problem: "The app sends no cache marks. More text.", tokens_per_1k: { uncached: 100_000 }, share: 0.1 }), lw()], score, rules, project: "shop", version: "1.2.3", notes: [note], ...o });

  it("writes the same headline, sections and hand-off as the page, inside a generated block", () => {
    const md = renderMarkdown(input(), { date: "2026-11-26" });
    expect(md.startsWith(MD_BEGIN)).toBe(true);
    expect(md.trimEnd().endsWith(MD_END)).toBe(true);
    expect(md).toContain("# leanprompt report: shop");
    expect(md).toContain("2026-11-26 · leanprompt 1.2.3 · target: not set (no leanprompt.yaml) · priority: not set");
    expect(md).toContain("**1 place where this app pays for tokens it doesn't need.**");
    expect(md).toContain("Together about 100k tokens per 1,000 calls (an estimate from the code, not a measurement).");
    const heads = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual(["What this costs you", "What's wrong and what to change", "Questions for the server's administrator", "Other problems the audit found", "Fix it with your coding agent", "Score", "Questions for the owner"]);
    expect(md).toContain("- **Share:** 0.100 of prompt tokens");
    expect(md).toContain("[LP-PC-01 Put cache marks where the provider needs them](https://github.com/Podwarden/leanprompt/blob/v1.2.3/skills/prefill-cache/rules/LP-PC-01.md)");
    expect(md).toContain(handoffText(input().findings, rules, { notes: [note], version: "1.2.3" }));
    expect(md).toMatch(/This is the app's own score: it leaves out 1 finding for the server's administrator; with them it would be 83/);
    expect(md).toMatch(/\*\*Priority:\*\*[^\n]*`priority:`/);
    expect(md).toMatch(/\*\*Volume:\*\*/);
  });

  it("asks no owner question the profile already answers", () => {
    const profile: Profile = { target: { provider: "anthropic" }, priority: { cost: 1, speed: 0, quality: 0 }, volume: { calls_per_month: 10 }, prices: { m: { input: 1, cached_input: 0.1, output: 2, source: "s", checked: "2026-11-26" } } };
    const md = renderMarkdown(input({ profile }), { date: "2026-11-26", priority: "cost" });
    expect(md).not.toContain("## Questions for the owner");
    expect(md).toContain("target: anthropic · priority: cost");
  });

  it("keeps what is written below the block, and refuses a hand-written report", () => {
    const first = spliceReport(null, "X\n")!;
    expect(first).toContain("## Inventory");
    const block = `${MD_BEGIN}\nnew\n${MD_END}\n`;
    const kept = spliceReport(`${MD_BEGIN}\nold\n${MD_END}\n\n## Inventory\n\n| 1 | a.ts:3 |\n`, block)!;
    expect(kept).toBe(`${MD_BEGIN}\nnew\n${MD_END}\n\n## Inventory\n\n| 1 | a.ts:3 |\n`);
    expect(spliceReport("# my own report\n", block)).toBeNull();
  });

  describe("the command", () => {
    let dir: string;
    let out: string;
    let err: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "lp-md-"));
      out = err = "";
      vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
      vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
      mkdirSync(join(dir, ".leanprompt"));
      writeFileSync(join(dir, ".leanprompt", "findings.json"), JSON.stringify({ v: 1, findings: [f()], notes: [note] }));
    });
    afterEach(() => vi.restoreAllMocks());

    it("writes leanprompt-report.md and the page together, and keeps the inventory on a second run", async () => {
      expect(await main(["report", "--md", "--html", "--dir", dir])).toBe(0);
      const md = join(dir, "leanprompt-report.md");
      expect(existsSync(md)).toBe(true);
      expect(existsSync(join(dir, ".leanprompt", "report.html"))).toBe(true);
      writeFileSync(md, readFileSync(md, "utf8").replace("## Next steps\n", "## Next steps\n\n1. Fix the marks first.\n"));
      expect(await main(["report", "--md", "--dir", dir])).toBe(0);
      const text = readFileSync(md, "utf8");
      expect(text).toContain("1. Fix the marks first.");
      expect(text.split(MD_BEGIN).length).toBe(2);
      expect(text).toContain("The spend cap ignores cache tokens");
    });

    it("refuses to overwrite a hand-written report, and --out with both formats", async () => {
      writeFileSync(join(dir, "leanprompt-report.md"), "# written by hand\n");
      expect(await main(["report", "--md", "--dir", dir])).toBe(1);
      expect(err).toMatch(/was not written by report --md/);
      expect(readFileSync(join(dir, "leanprompt-report.md"), "utf8")).toBe("# written by hand\n");
      expect(await main(["report", "--md", "--html", "--out", "x", "--dir", dir])).toBe(2);
    });

    it("names the project from package.json, pyproject.toml or the git remote, not the folder; --project overrides", async () => {
      expect(projectName(dir)).toMatch(/^lp-md-/);
      writeFileSync(join(dir, "pyproject.toml"), '[build-system]\nrequires = []\n\n[project]\nname = "translator"\nversion = "1"\n');
      expect(projectName(dir)).toBe("translator");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "shop-app" }));
      expect(projectName(dir)).toBe("shop-app");
      const g = mkdtempSync(join(tmpdir(), "owner__repo-"));
      execFileSync("git", ["init", "-q", g]);
      execFileSync("git", ["-C", g, "remote", "add", "origin", "git@github.com:owner/shop.git"]);
      expect(projectName(g)).toBe("shop");
      expect(await main(["report", "--html", "--project", "My shop", "--dir", dir])).toBe(0);
      expect(readFileSync(join(dir, ".leanprompt", "report.html"), "utf8")).toContain("<title>leanprompt report: My shop</title>");
    });
  });
});
