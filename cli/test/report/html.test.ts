import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/main.js";
import { handoffText, loadRules, splitLead, rawScoreUrl, renderReport, shareText, type ScoreFile } from "../../src/report/html.js";
import type { Finding } from "../../src/score/static.js";
import { PACKAGE_ROOT } from "../../src/score/write.js";

const rules = loadRules(PACKAGE_ROOT);
const f = (extra: Partial<Finding> = {}): Finding => ({ rule: "LP-PC-01", file: "src/a.ts", line: 3, saves: "prefill", severity: "high", ...extra });
const staticScore: ScoreFile = { score: 72, kind: "static", weights: "default", inputs: { E: 0.5, S: 1, G: 0.2 }, message: "72 static", color: "lightgrey" };
const render = (findings: Finding[] = [f()], score: ScoreFile | null = staticScore, extra: object = {}) =>
  renderReport({ findings, score, rules, project: "demo", version: "1.2.3", ...extra });

const words = {
  problem: "The app resends a cut-off answer unchanged.",
  change: "Read finish_reason and raise the output budget before a retry.",
  why: "Each retry pays the whole prompt and all its output again.",
  estimate: "about 138k tokens per 1,000 calls",
  assumptions: "5% of calls truncate; half are retried",
  verify: "No retry follows a length stop with the same budget.",
};
const cardsOf = (html: string): string[] => [...html.matchAll(/<article class="finding[^"]*" data-where="([^"]+)"/g)].map((m) => m[1]!);
const between = (html: string, a: string, b?: string): string => {
  const i = html.indexOf(a);
  if (i < 0) return "";
  const j = b ? html.indexOf(b, i) : -1;
  return html.slice(i, j < 0 ? undefined : j);
};
const githubGit = { remote: "git@github.com:acme/shop.git", branch: "main", scoreTracked: true };

describe("renderReport", () => {
  it("loads rule titles", () => expect(rules.get("LP-PC-01")?.skill).toBe("prefill-cache"));

  it("is self-contained: one inline copy script, no remote assets, links only to the repo", () => {
    const html = render([f({ ...words }), f({ rule: "LP-GE-01", severity: "low", tokens_per_1k: { output: 10 } })], staticScore, { git: githubGit });
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts).toEqual(["<script>"]);
    expect(html).toContain("navigator.clipboard");
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/\bsrc=/i);
    // In-page anchors (the section index, the meter rows) are allowed; nothing else outside the repo.
    expect(html).not.toMatch(/(src|href)="(?!https:\/\/github\.com\/Podwarden\/leanprompt|#[\w-]+")/);
    expect(html).not.toMatch(/@import|url\(/);
    const outside = html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, "");
    const urls = [...outside.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^https:\/\/github\.com\/Podwarden\/leanprompt(\/|$)/);
    const pre = [...html.matchAll(/<pre[^>]*>[\s\S]*?<\/pre>/g)].map((m) => m[0]).join("");
    for (const u of [...pre.matchAll(/https?:\/\/[^\s"'<)&]+/g)].map((m) => m[0])) {
      expect(u).toMatch(/^https:\/\/(img\.shields\.io\/endpoint\?url=|github\.com\/Podwarden\/leanprompt$)/);
    }
    expect(html).toContain("https://github.com/Podwarden/leanprompt/blob/v1.2.3/skills/prefill-cache/rules/LP-PC-01.md");
  });

  it("puts the page in order: headline, costs, findings, hand-off, score, share", () => {
    const html = render([f({ ...words, tokens_per_1k: { prompt: 138_000 } })], staticScore, { git: githubGit });
    const order = ["<h1", "What this costs you", "What&#39;s wrong and what to change", "Fix it with your coding agent", "<h2>Score", "If this helped"].map((k) => html.indexOf(k));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("headline: how many places, the biggest first, the total labelled as an estimate", () => {
    const html = render([
      f({ file: "a.ts", line: 2, ...words, tokens_per_1k: { prompt: 20_000 } }),
      f({ file: "b.ts", line: 9, rule: "LP-GE-01", severity: "low", tokens_per_1k: { output: 138_000 } }),
      f({ file: "c.ts", line: 1, fixed: true, tokens_per_1k: { prompt: 1 } }),
    ]);
    const head = between(html, "<header", "</header>");
    expect(head).toContain("2 places where this app pays for tokens it doesn&#39;t need");
    expect(head).toMatch(/The biggest[^<]*<code>b\.ts:9<\/code>/);
    expect(head).toContain("about 158k tokens per 1,000 calls");
    expect(head).toMatch(/estimate from the code, not a measurement/);
    expect(render([f()])).toContain("1 place where this app pays for tokens it doesn&#39;t need");
  });

  it("headline with nothing open says so plainly", () => {
    expect(between(render([], null), "<header", "</header>")).toMatch(/found no place where this app pays for tokens it doesn&#39;t need/);
    expect(between(render([f({ fixed: true })]), "<header", "</header>")).toMatch(/All 1 finding is fixed|1 finding, fixed/);
  });

  it("measured token numbers are labelled measured", () => {
    const html = render([f({ tokens_per_1k: { prompt: 5000, measured_calls: 120 } })]);
    expect(between(html, "<header", "</header>")).toMatch(/[Mm]easured over 120 calls/);
    expect(between(html, "<header", "</header>")).not.toMatch(/not a measurement/);
  });

  it("one card per finding, ranked biggest first, with problem, change, why, estimate, where and a rule link", () => {
    const html = render([
      f({ file: "a.ts", line: 20, severity: "high" }),
      f({ file: "b.ts", line: 2, severity: "medium", ...words, tokens_per_1k: { output: 90_000 } }),
      f({ file: "a.ts", line: 5, severity: "medium", rule: "LP-PC-02" }),
      f({ file: "a.ts", line: 1, severity: "high", fixed: true }),
    ]);
    expect(cardsOf(html)).toEqual(["b.ts:2", "a.ts:20", "a.ts:5", "a.ts:1"]);
    const card = between(html, 'data-where="b.ts:2"', "</article>");
    for (const w of Object.values(words)) expect(card).toContain(w.replace(/'/g, "&#39;"));
    expect(card).toContain("<code>b.ts:2</code>");
    expect(card).toMatch(/How this rule works/);
    expect(card).toContain("blob/v1.2.3/skills/prefill-cache/rules/LP-PC-01.md");
    expect(html).toContain("3 open, 1 fixed");
    // A finding without the plain-English fields still reads: the rule title stands in.
    expect(between(html, 'data-where="a.ts:20"', "</article>")).toContain(rules.get("LP-PC-01")!.title);
  });

  it("a card's heading is the problem's first sentence; the rest follows as text", () => {
    const html = render([f({ problem: "The prompt starts with the time. So nothing is reused, e.g. on retries." })]);
    expect(html).toContain("<h3>The prompt starts with the time.</h3>");
    expect(html).toContain('<p class="rest">So nothing is reused, e.g. on retries.</p>');
    expect(splitLead("No sentence break here")).toEqual(["No sentence break here", ""]);
  });

  it("keeps the old ranking when no finding has token numbers", () => {
    const html = render([
      f({ file: "b.ts", line: 9, severity: "low", rule: "LP-GE-01" }),
      f({ file: "a.ts", line: 20, severity: "high" }),
      f({ file: "a.ts", line: 5, severity: "medium", rule: "LP-PC-02" }),
      f({ file: "b.ts", line: 2, severity: "high", share: 0.4 }),
      f({ file: "a.ts", line: 3, severity: "high", share: 0.4 }),
    ]);
    expect(cardsOf(html)).toEqual(["a.ts:3", "b.ts:2", "a.ts:20", "a.ts:5", "b.ts:9"]);
  });

  it("shows external and needs-facts findings in their own group, with what to confirm", () => {
    const html = render([
      f({ file: "a.ts", line: 4, severity: "medium" }),
      f({ file: "<external>", line: 0, severity: "low", where: "replica routing", status: "needs-facts", confirm: "how many replicas serve the model" }),
      f({ file: "<external>", line: 0, severity: "high", where: "engine launch flags", status: "needs-facts", confirm: "is --enable-prefix-caching set <on> the server" }),
      f({ file: "b.ts", line: 7, severity: "high", status: "needs-facts", confirm: "share of traffic on this path" }),
    ]);
    const main = between(html, "What&#39;s wrong and what to change", "Open questions");
    const open = between(html, "Open questions", "Fix it with your coding agent");
    expect(cardsOf(main)).toEqual(["a.ts:4"]);
    expect(cardsOf(open)).toEqual(["engine launch flags", "b.ts:7", "replica routing"]);
    expect(open).toContain("To confirm");
    expect(open).toContain("how many replicas serve the model");
    expect(open).toContain("is --enable-prefix-caching set &lt;on&gt; the server");
    expect(open).toMatch(/still count in the score/);
    expect(render([f()])).not.toContain("Open questions");
  });

  it("hand-off block: instructions for any coding agent plus the findings, copyable, readable without script", () => {
    const html = render([
      f({ file: "a.ts", line: 4, ...words }),
      f({ file: "<external>", line: 0, where: "engine flags", status: "needs-facts", confirm: "the block size" }),
      f({ file: "z.ts", line: 1, fixed: true }),
    ]);
    const sec = between(html, "Fix it with your coding agent", "<h2>Score");
    expect(sec).toMatch(/Claude Code, Codex, Cursor or any coding assistant/);
    expect(sec).toMatch(/asking before it changes anything/);
    expect(sec).toMatch(/<pre id="handoff"[^>]*>/);
    expect(sec).toMatch(/<button[^>]*data-copy="handoff"[^>]*hidden/);
    const block = handoffText([
      f({ file: "a.ts", line: 4, ...words }),
      f({ file: "<external>", line: 0, where: "engine flags", status: "needs-facts", confirm: "the block size" }),
      f({ file: "z.ts", line: 1, fixed: true }),
    ], rules);
    expect(sec).toContain(block.split("\n")[0]!);
    expect(block).toContain("npx github:Podwarden/leanprompt init");
    expect(block).toContain(".leanprompt/findings.json");
    expect(block).toContain("leanprompt-report.md");
    expect(block).toMatch(/before you change anything/);
    expect(block).toMatch(/one finding at a time/i);
    expect(block).toMatch(/only after I say yes/);
    expect(block).toContain("measure-loop");
    expect(block).toContain("LP-PC-01 at a.ts:4: The app resends a cut-off answer unchanged.");
    expect(block).toMatch(/engine flags[\s\S]*To confirm: the block size/);
    expect(block).not.toContain("z.ts");
  });

  it("score card: as before, below the explanations, with one plain line on what it means", () => {
    const html = render([], { ...staticScore, diagnostics: { default_shares: 3, findings: 5 } });
    const sc = between(html, "<h2>Score", "</section>");
    expect(sc).toContain(">72<");
    expect(sc).toContain("E, prefill reuse");
    expect(sc).toContain("S, prefix stability");
    expect(sc).toContain("G, generation waste");
    expect(sc).toContain("0.50");
    expect(sc).toMatch(/Default shares<\/dt><dd>3 of 5</);
    expect(sc).toMatch(/severity defaults, not estimates/);
    expect(sc).toMatch(/from 0 to 100/);
    expect(render([], staticScore)).not.toContain("Default shares");
  });

  it("labels calibrated static and measured scores", () => {
    expect(render([], { ...staticScore, weights: "calibrated" })).toContain("static, calibrated");
    const m = render([], { score: 88, kind: "measured", inputs: { E: 0.9, S: 0.9, G: 0.1 }, calls: 40, unmeasured: 3, diagnostics: { estimate: "char-share" } });
    expect(m).toContain("Calls unmeasured");
    expect(m).toMatch(/Calls measured<\/dt><dd>37</);
    expect(m).toMatch(/Calls logged<\/dt><dd>40</);
    expect(m).toContain("character share");
  });

  it("says so with no score file", () => {
    const html = render([], null);
    expect(html).toContain("No score yet: run <code>npx leanprompt score</code>");
  });

  it("tolerates a score file with missing fields", () => {
    expect(() => render([], { score: 50 } as ScoreFile)).not.toThrow();
    expect(() => render([], { kind: "measured" } as ScoreFile)).not.toThrow();
  });

  it("reports the ignored count", () => expect(render([f()], staticScore, { ignored: 4 })).toContain("4 ignored by the profile"));

  describe("If this helped", () => {
    it("is shown only with something worth sharing: an estimate or a measured score", () => {
      expect(render([f()])).not.toContain("If this helped");
      expect(render([f({ estimate: "about 9k tokens per 1,000 calls" })])).toContain("If this helped");
      expect(render([f({ tokens_per_1k: { prompt: 9000 } })])).toContain("If this helped");
      expect(render([], { score: 88, kind: "measured", inputs: { E: 0.9, S: 0.9, G: 0.1 }, calls: 60, unmeasured: 0 })).toContain("If this helped");
    });
    it("has a star link and an honest share message with a copy button", () => {
      const html = render([f({ tokens_per_1k: { prompt: 9000 } }), f({ file: "b.ts", tokens_per_1k: { output: 1000 } })]);
      const sec = between(html, "If this helped", "</section>");
      expect(sec).toContain('href="https://github.com/Podwarden/leanprompt"');
      expect(sec).toMatch(/Star/);
      const msg = shareText([f({ tokens_per_1k: { prompt: 9000 } }), f({ file: "b.ts", tokens_per_1k: { output: 1000 } })], null);
      expect(msg).toMatch(/found 2 places where it pays for tokens it doesn't need/);
      expect(msg).toMatch(/about 10k tokens per 1,000 calls, an estimate from the code/);
      expect(msg).toMatch(/free, open source, and runs locally/i);
      expect(msg).toContain("https://github.com/Podwarden/leanprompt");
      expect(msg).not.toMatch(/!|best|amazing|revolution/i);
      expect(sec).toMatch(/<button[^>]*data-copy="share"/);
    });
    it("badge: auto-filled raw URL for GitHub, GitLab.com and Bitbucket remotes", () => {
      expect(rawScoreUrl("git@github.com:acme/shop.git", "main")).toBe("https://raw.githubusercontent.com/acme/shop/main/.leanprompt/score.json");
      expect(rawScoreUrl("https://github.com/acme/shop", "feat/x")).toBe("https://raw.githubusercontent.com/acme/shop/feat/x/.leanprompt/score.json");
      expect(rawScoreUrl("https://user:tok@github.com/acme/shop.git", "main")).toBe("https://raw.githubusercontent.com/acme/shop/main/.leanprompt/score.json");
      expect(rawScoreUrl("ssh://git@github.com/acme/shop.git", "main")).toBe("https://raw.githubusercontent.com/acme/shop/main/.leanprompt/score.json");
      expect(rawScoreUrl("git@gitlab.com:grp/sub/app.git", "main")).toBe("https://gitlab.com/grp/sub/app/-/raw/main/.leanprompt/score.json");
      expect(rawScoreUrl("https://bitbucket.org/team/app.git", "dev")).toBe("https://bitbucket.org/team/app/raw/dev/.leanprompt/score.json");
      expect(rawScoreUrl("git@git.example.internal:team/app.git", "main")).toBeNull();
      expect(rawScoreUrl("https://github.example.com/acme/shop.git", "main")).toBeNull();
      expect(rawScoreUrl("git@github.com:acme/shop.git", "HEAD")).toBeNull();
    });
    it("shows the badge snippet only for a public host, and asks to commit score.json first when it is not tracked", () => {
      const fs = [f({ tokens_per_1k: { prompt: 9000 } })];
      const gh = render(fs, staticScore, { git: githubGit });
      expect(gh).toContain(`![leanprompt](https://img.shields.io/endpoint?url=${encodeURIComponent("https://raw.githubusercontent.com/acme/shop/main/.leanprompt/score.json")})`);
      expect(gh).not.toMatch(/commit .*score\.json.* first/i);
      const untracked = render(fs, staticScore, { git: { ...githubGit, scoreTracked: false } });
      expect(untracked).toMatch(/[Cc]ommit <code>\.leanprompt\/score\.json<\/code> first/);
      for (const git of [{ remote: "git@git.example.internal:team/app.git", branch: "main", scoreTracked: true }, undefined]) {
        const h = render(fs, staticScore, { git });
        expect(h).not.toContain("img.shields.io");
        expect(h).toMatch(/badge needs a public repository/);
        expect(h).not.toContain("example.internal");
      }
      expect(render(fs, null, { git: githubGit })).not.toContain("img.shields.io");
    });
  });

  describe("What this costs you", () => {
    const price = { input: 1, cached_input: 0.1, output: 4, source: "https://example.com/pricing", checked: "2026-11-26" };
    const base = { target: { provider: "x" }, priority: { cost: 1, speed: 0, quality: 0 } };
    it("without volume or prices: tokens per 1,000 calls and what to add, never money", () => {
      const html = render([f({ tokens_per_1k: { prompt: 9000 } })]);
      const sec = between(html, "What this costs you", "</section>");
      expect(sec).toContain("9k");
      expect(sec).toMatch(/To see this in money, add to <code>leanprompt\.yaml<\/code>/);
      expect(sec).toContain("volume: {calls_per_month: N}");
      expect(sec).not.toMatch(/\$\d/);
      expect(render([f()])).not.toContain("What this costs you");
    });
    it("with volume and a dated price: losses, savings, percent, and every input shown", () => {
      const html = render([f({ tokens_per_1k: { prompt: 80_000 } })], staticScore, {
        profile: { ...base, volume: { calls_per_month: 100_000, source: "our dashboard" }, prices: { m: price } },
        average_call: { prompt_tokens: 4000, output_tokens: 1000 },
      });
      const sec = between(html, "What this costs you", "</section>");
      expect(sec).toMatch(/About \$8\.00 a month at 100,000 calls a month/);
      expect(sec).toMatch(/Fixing these saves about \$8\.00 a month \(about 1\.0% of an estimated \$800 monthly bill\)/);
      expect(sec).toContain("our dashboard");
      expect(sec).toContain("checked 2026-11-26");
      expect(sec).toContain("input $1.00, cached input $0.10, output $4.00 per 1M tokens");
      expect(sec).toContain("https://example.com/pricing");
      expect(sec).toMatch(/estimate from the code, not a measurement/);
      expect(sec).toMatch(/Findings can overlap/);
    });
    it("self-hosted: GPU prefill hours a month", () => {
      const html = render([f({ tokens_per_1k: { uncached: 100_000 } })], staticScore, {
        profile: { target: { engine: "vllm" }, priority: base.priority, engine: { prefill_tokens_per_second: 10_000 }, volume: { calls_per_month: 360_000 } },
      });
      expect(between(html, "What this costs you", "</section>")).toMatch(/About 1\.0 hours? of GPU prefill time a month/);
    });
    it("escapes the price source and volume source", () => {
      const evil = "<img src=x onerror=alert(1)>";
      const html = render([f({ tokens_per_1k: { prompt: 80_000 } })], staticScore, {
        profile: { ...base, volume: { calls_per_month: 10, source: evil }, prices: { m: { ...price, source: evil } } },
      });
      expect(html).not.toContain("<img");
    });
  });

  it("escapes text from findings, score files and the new fields", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const evilWords = Object.fromEntries(Object.keys(words).map((k) => [k, evil]));
    const html = renderReport({
      findings: [f({ file: evil, ...evilWords, model: evil, tokens_per_1k: { prompt: 1 } }), f({ file: "<external>", where: evil, status: "needs-facts", confirm: evil })],
      score: { ...staticScore, message: evil, date: evil, kind: "static" },
      rules: new Map([["LP-PC-01", { title: evil, skill: evil }]]),
      project: evil,
      version: "1",
      git: { remote: evil, branch: evil, scoreTracked: true },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("has landmarks, headings in order, and a polite live region for the copy buttons", () => {
    const html = render([f({ ...words, tokens_per_1k: { prompt: 9000 } }), f({ file: "b.ts", status: "needs-facts", confirm: "x" }), f({ file: "c.ts", fixed: true })], staticScore);
    expect(html.match(/<main>/g)).toHaveLength(1);
    expect(html).toMatch(/<nav class="rail" aria-label="Sections">/);
    expect(html).toMatch(/<header class="lede"/);
    expect(html).toMatch(/<\/main>\s*<footer class="page-foot/);
    expect(html).toMatch(/<p id="copy-status"[^>]*aria-live="polite"/);
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    // Every in-page link points at an id that exists.
    for (const [, id] of html.matchAll(/href="#([\w-]+)"/g)) expect(html).toContain(`id="${id}"`);
  });

  it("the meter carries its numbers as text, not only as colour or length", () => {
    const html = render([f({ file: "a.ts", line: 1, tokens_per_1k: { prompt: 30_000 } }), f({ file: "b.ts", line: 2, tokens_per_1k: { output: 10_000 } })]);
    const meter = between(html, '<figure class="meter">', "</figure>");
    expect(meter).toContain("<figcaption>Tokens per 1,000 calls");
    expect(meter).toContain('aria-label="Finding 1, a.ts:1: 30k tokens per 1,000 calls, 75% of the total"');
    expect(meter).toContain('aria-label="Finding 2, b.ts:2: 10k tokens per 1,000 calls, 25% of the total"');
    expect(meter).toContain('href="#f1"');
    expect(html).toMatch(/data-where="a\.ts:1" id="f1"/);
  });

  it("prints the findings cleanly: a print stylesheet that hides the controls and opens the details", () => {
    const html = render();
    const print = between(html, "@media print", "</style>");
    expect(print).toMatch(/button\.copy/);
    expect(print).toMatch(/\.rail/);
    expect(print).toMatch(/details::details-content/);
    expect(print).toMatch(/break-inside: avoid/);
    expect(html).toMatch(/prefers-reduced-motion/);
    expect(html).toMatch(/font-variant-numeric: tabular-nums/);
  });

  it("text colours meet WCAG AA (4.5:1) against their backgrounds, light and dark", () => {
    const html = render();
    const vars = (block: string): Record<string, string> =>
      Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
    const light = vars(between(html, ":root {", "}"));
    const dark = { ...light, ...vars(between(html, "@media (prefers-color-scheme: dark)", "}\n}")) };
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const pairs: [string, string][] = [
      ["ink", "paper"], ["ink", "sheet"], ["slate", "paper"], ["slate", "sheet"], ["slate", "foot"],
      ["high", "sheet"], ["medium", "sheet"], ["low", "sheet"], ["ok", "sheet"], ["signal", "sheet"], ["signal", "paper"],
      ["signal", "signal-tint"], ["ink", "signal-tint"], ["panel-ink", "panel"], ["panel-soft", "panel"],
      ["panel-pre-ink", "panel-pre"], ["panel-btn-ink", "panel-btn"],
    ];
    for (const theme of [light, dark]) {
      for (const [fg, bg] of pairs) {
        expect(theme[fg], fg).toBeDefined();
        expect(ratio(theme[fg]!, theme[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("supports light and dark and phones", () => {
    const html = render();
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toMatch(/pre[^{]*\{[^}]*white-space: pre-wrap/);
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

describe("readGit", () => {
  it("reads the origin remote, the branch and whether score.json is tracked, locally", async () => {
    const { execFileSync } = await import("node:child_process");
    const { readGit } = await import("../../src/report/html.js");
    const d = mkdtempSync(join(tmpdir(), "lp-git-"));
    expect(readGit(d)).toBeUndefined();
    const g = (...a: string[]) => execFileSync("git", ["-C", d, ...a], { stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("remote", "add", "origin", "git@github.com:acme/shop.git");
    mkdirSync(join(d, ".leanprompt"));
    writeFileSync(join(d, ".leanprompt", "score.json"), "{}");
    expect(readGit(d)).toEqual({ remote: "git@github.com:acme/shop.git", branch: "main", scoreTracked: false });
    g("add", ".leanprompt/score.json");
    expect(readGit(d)?.scoreTracked).toBe(true);
  });
});
