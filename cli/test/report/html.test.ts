import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/main.js";
import { loadRules, renderReport, type ScoreFile } from "../../src/report/html.js";
import type { Finding } from "../../src/score/static.js";
import { PACKAGE_ROOT } from "../../src/score/write.js";

const rules = loadRules(PACKAGE_ROOT);
const f = (extra: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "src/a.ts", line: 3, saves: "prefill", severity: "high", ...extra });
const staticScore: ScoreFile = { score: 72, kind: "static", weights: "default", inputs: { E: 0.5, S: 1, G: 0.2 }, message: "72 static", color: "lightgrey" };
const render = (findings: Finding[] = [f()], score: ScoreFile | null = staticScore, extra: object = {}) =>
  renderReport({ findings, score, rules, project: "demo", version: "1.2.3", ...extra });

describe("renderReport", () => {
  it("loads rule titles", () => expect(rules.get("LP-PC-01")?.skill).toBe("prefill-cache"));

  it("is self-contained: no script, no remote assets, links only to the repo", () => {
    const html = render([f(), f({ rule: "LP-GE-01", severity: "low" })]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/(src|href)="(?!https:\/\/github\.com\/Podwarden\/leanprompt)/);
    const urls = [...html.replace(/<pre>[\s\S]*?<\/pre>/g, "").matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^https:\/\/github\.com\/Podwarden\/leanprompt(\/|$)/);
    const pre = [...html.matchAll(/<pre>[\s\S]*?<\/pre>/g)].map((m) => m[0]).join("");
    const preUrls = [...pre.matchAll(/https?:\/\/[^\s"'<)&]+/g)].map((m) => m[0]);
    expect(preUrls).toEqual(["https://img.shields.io/endpoint?url="]);
    expect(html.replace(/<pre>[\s\S]*?<\/pre>/g, "")).not.toContain("img.shields.io");
    expect(html).toContain("https://github.com/Podwarden/leanprompt/blob/v1.2.3/skills/prefill-cache/rules/LP-PC-01.md");
  });

  it("shows score, kind, labelled E S G", () => {
    const html = render();
    expect(html).toContain(">72<");
    expect(html).toContain("static");
    expect(html).toContain("E, prefill reuse");
    expect(html).toContain("S, prefix stability");
    expect(html).toContain("G, generation waste");
    expect(html).toContain("0.50");
  });

  it("labels calibrated static and measured scores", () => {
    expect(render([], { ...staticScore, weights: "calibrated" })).toContain("static, calibrated");
    const m = render([], { score: 88, kind: "measured", inputs: { E: 0.9, S: 0.9, G: 0.1 }, calls: 40, unmeasured: 3, diagnostics: { estimate: "char-share" } });
    expect(m).toContain("measured");
    expect(m).toContain("Calls unmeasured");
    // 40 logged calls, 3 unmeasured: 37 measured, 40 logged.
    expect(m).toMatch(/Calls measured<\/dt><dd>37</);
    expect(m).toMatch(/Calls logged<\/dt><dd>40</);
    expect(m).toContain("character share");
  });

  it("says so with no score file", () => {
    const html = render([], null);
    expect(html).toContain("No score yet: run <code>npx leanprompt score</code>");
    expect(html).not.toContain("README badge");
  });

  it("tolerates a score file with missing fields", () => {
    expect(() => render([], { score: 50 } as ScoreFile)).not.toThrow();
    expect(() => render([], { kind: "measured" } as ScoreFile)).not.toThrow();
  });

  const rowsOf = (html: string): string[] =>
    [...html.matchAll(/<tr[^>]*><td><span class="sev[^"]*">(\w+)<\/span><\/td>.*?<td class="loc"><code>([^<]+)<\/code><\/td>/g)].map((m) => `${m[1]} ${m[2]}`);

  it("ranks all findings in one table: open before fixed, severity, share, then file:line, and shows file:line", () => {
    const html = render([
      f({ file: "b.ts", line: 9, severity: "low", rule: "LP-GE-01" }),
      f({ file: "a.ts", line: 20, severity: "high" }),
      f({ file: "a.ts", line: 5, severity: "medium", rule: "LP-PC-02" }),
      f({ file: "a.ts", line: 1, severity: "high", fixed: true }),
      f({ file: "b.ts", line: 2, severity: "high", share: 0.4 }),
      f({ file: "a.ts", line: 2, severity: "high", share: 0.1 }),
      f({ file: "a.ts", line: 3, severity: "high", share: 0.4 }),
    ]);
    expect(rowsOf(html)).toEqual(["high a.ts:3", "high b.ts:2", "high a.ts:2", "high a.ts:20", "medium a.ts:5", "low b.ts:9", "high a.ts:1"]);
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).not.toContain("<h3>");
    expect(html).toContain(rules.get("LP-PC-01")!.title);
    expect(html).toContain("6 open, 1 fixed");
  });

  it("keeps a rule id on one line", () => expect(render()).toMatch(/td\.rule|class="rule"/));

  it("reports the ignored count", () => expect(render([f()], staticScore, { ignored: 4 })).toContain("4 ignored by the profile"));

  it("includes the README badge built from the score", () => {
    const html = render();
    expect(html).toContain("![leanprompt](https://img.shields.io/endpoint?url=&lt;raw URL of .leanprompt/score.json in your repo&gt;)");
    expect(html).not.toContain("img.shields.io/badge");
  });

  it("escapes text from findings and score files", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = renderReport({
      findings: [f({ file: evil })],
      score: { ...staticScore, message: evil, date: evil, kind: "static" },
      rules: new Map([["LP-PC-01", { title: evil, skill: evil }]]),
      project: evil,
      version: "1",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("supports light and dark and phones", () => {
    const html = render();
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });
});

describe("report command", () => {
  let dir: string;
  let out: string;
  let err: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lp-report-"));
    out = err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it("without --html exits 2 with the pointer", async () => {
    expect(await main(["report"])).toBe(2);
    expect(err).toContain("use --html (the Markdown report is leanprompt-report.md, written by the audit)");
  });

  it("writes the page, applies ignore, prints the path", async () => {
    mkdirSync(join(dir, ".leanprompt"));
    writeFileSync(
      join(dir, ".leanprompt", "findings.json"),
      JSON.stringify({ v: 1, findings: [f({ file: "<img src=x onerror=alert(1)>" }), f({ file: "skip.ts" })] }),
    );
    writeFileSync(join(dir, "leanprompt.yaml"), "priority: {cost: 0.5, speed: 0.25, quality: 0.25}\nignore:\n  - {rule: LP-PC-01, file: skip.ts}\n");
    expect(await main(["report", "--html", "--dir", dir])).toBe(0);
    const target = join(dir, ".leanprompt", "report.html");
    expect(out.trim()).toBe(target);
    const html = readFileSync(target, "utf8");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("skip.ts");
    expect(html).toContain("1 ignored by the profile");
    expect(html).toContain("No score yet");
  });

  it("honours --out", async () => {
    const o = join(dir, "x", "r.html");
    expect(await main(["report", "--html", "--dir", dir, "--out", o])).toBe(0);
    expect(existsSync(o)).toBe(true);
  });
});
