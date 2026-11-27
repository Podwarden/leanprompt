import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRuleIds } from "../../cli/src/lint/rules.js";
import { knownOf } from "../../cli/src/score/static.js";
import { BADGES, KINDS, MOCKING, badgeOf, bigNumberOf, loadAudits, sortForIndex, validateMeta } from "../src/audits.js";
import { CORRECTIONS_LINE, ESTIMATE_LABEL, buildSite, type Site } from "../src/build.js";
import { BASE, LMWARDEN_PATHS, ORIGIN, siteHref, url } from "../src/paths.js";

const ROOT = join(import.meta.dirname, "..", "..");
let site: Site;
const html = new Map<string, string>();

beforeAll(() => {
  site = buildSite(ROOT);
  for (const [f, c] of site.files) if (f.endsWith(".html")) html.set(f, c as string);
});

/** The file a site URL path is served from, or undefined. */
function fileFor(path: string): string | undefined {
  const p = decodeURI(path.split(/[?#]/)[0]!).replace(/^\//, "");
  for (const cand of [p, `${p}index.html`, `${p}/index.html`]) if (site.files.has(cand)) return cand;
  return undefined;
}

const attrs = (h: string, name: "href" | "src") => [...h.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]!.replace(/&amp;/g, "&"));
const textOf = (h: string) =>
  h
    .replace(/<(script|style|pre)[\s\S]*?<\/\1>/g, " ")
    .replace(/<\/?(a|code|b|span|time|em|strong)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");

describe("the site build", () => {
  it("builds every page", () => {
    const keys = new Set(site.pages.map((p) => p.key));
    for (const k of ["", "how-it-works", "rules", "score", "examples", "install", "news", "news/changelog", "audits", "examples/dated-chat", "examples/dated-chat/before", "examples/dated-chat/after", "audits/podwarden__leanprompt", "audits/podwarden__leanprompt/report", "404"])
      expect(keys, k).toContain(k);
    const ruleIds = [...loadRuleIds(ROOT)];
    expect(ruleIds.length).toBeGreaterThan(20);
    for (const id of ruleIds) expect(keys, id).toContain(`rules/${id.toLowerCase()}`);
    for (const p of site.pages) expect(site.files.get(p.file), p.file).toMatch(/^<!(DOCTYPE|doctype) html>/);
  });

  it("gives every rule a stable URL", () => {
    expect(site.files.has("leanprompt/rules/lp-pc-02/index.html")).toBe(true);
    expect(url("rules/lp-pc-02")).toBe("/leanprompt/rules/lp-pc-02/");
    expect(siteHref("docs/how-it-works.md", "../skills/prefill-cache/rules/LP-PC-02.md#fix")).toBe("/leanprompt/rules/lp-pc-02/#fix");
  });

  it("keeps every file under the base path", () => {
    for (const f of site.files.keys()) expect(f.startsWith("leanprompt/"), f).toBe(true);
    expect(BASE).toBe("/leanprompt/");
  });

  it("resolves every internal link, and links outside /leanprompt/ only to lmwarden.com's known pages", () => {
    const bad: string[] = [];
    for (const [file, h] of html) {
      for (const link of [...attrs(h, "href"), ...attrs(h, "src")]) {
        if (/^(https?:|mailto:)/.test(link) || link.startsWith("#")) continue;
        if (!link.startsWith("/")) bad.push(`${file}: relative link ${link}`);
        else if (link.startsWith(BASE)) {
          if (!fileFor(link)) bad.push(`${file}: ${link} does not exist`);
        } else if (!(LMWARDEN_PATHS as readonly string[]).includes(link)) bad.push(`${file}: ${link} is outside the site and not a known lmwarden.com page`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("resolves in-page anchors to an id on the target page", () => {
    const bad: string[] = [];
    for (const [file, h] of html) {
      for (const link of attrs(h, "href")) {
        if (!link.startsWith(BASE) || !link.includes("#")) continue;
        const target = fileFor(link);
        const id = link.split("#")[1]!;
        if (target && !html.get(target)!.includes(` id="${id}"`)) bad.push(`${file}: ${link}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives every indexable page its canonical lmwarden.com URL, Open Graph tags and a description", () => {
    for (const p of site.pages) {
      const h = html.get(p.file)!;
      expect(h, p.file).toMatch(/<title>[^<]+<\/title>/);
      expect(h, p.file).toMatch(/<meta name="description" content="[^"]{20,}">/);
      if (!p.index) {
        expect(h, p.file).toContain('<meta name="robots" content="noindex">');
        expect(h, p.file).not.toContain('rel="canonical"');
        continue;
      }
      const want = ORIGIN + url(p.key);
      expect(h, p.file).toContain(`<link rel="canonical" href="${want}">`);
      expect(h, p.file).toContain(`<meta property="og:url" content="${want}">`);
      expect(h, p.file).toMatch(/<meta property="og:title" content="[^"]+">/);
    }
    const titles = site.pages.filter((p) => p.index).map((p) => /<title>([^<]+)<\/title>/.exec(html.get(p.file)!)![1]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("loads nothing from another host and runs no inline code", () => {
    for (const [file, h] of html) {
      for (const tag of h.match(/<script\b[^>]*>/g) ?? []) expect(tag, file).toMatch(/^<script src="\/leanprompt\/assets\/[\w.-]+\?v=[0-9a-f]+"( defer)?>$/);
      expect(h, file).not.toMatch(/<script>[^<]*\S/);
      expect(h, file).not.toMatch(/<style\b/);
      expect(h, file).not.toMatch(/\sstyle="/);
      expect(h, file).not.toMatch(/\son[a-z]+="/);
      for (const tag of h.match(/<(img|link|iframe|video|audio|source)\b[^>]*>/g) ?? []) {
        if (/rel="(canonical|alternate)"/.test(tag)) continue;
        expect(tag, file).not.toMatch(/(src|href)="(https?:)?\/\//);
      }
      expect(h, file).not.toMatch(/googletagmanager|google-analytics|gtag\(/);
    }
    const css = site.files.get("leanprompt/assets/site.css")!.toString();
    expect(css).not.toMatch(/url\("?(https?:)?\/\//);
    expect(css).not.toMatch(/@import/);
  });

  it("has landmarks and one h1 on every site page", () => {
    for (const p of site.pages.filter((x) => !x.key.endsWith("/report") && !/\/(before|after)$/.test(x.key))) {
      const h = html.get(p.file)!;
      expect(h, p.file).toContain('<html lang="en">');
      for (const l of ["<header", "<main", "<footer", '<nav aria-label="Primary">', 'class="skip" href="#main"']) expect(h, `${p.file} ${l}`).toContain(l);
      expect((h.match(/<h1\b/g) ?? []).length, p.file).toBe(1);
    }
  });

  it("writes its own copy without em dashes or exclamation marks", () => {
    for (const key of ["", "rules", "examples", "news", "audits", ...site.pages.filter((p) => /^audits\/[^/]+$/.test(p.key)).map((p) => p.key), "404"]) {
      const f = site.pages.find((p) => p.key === key)!.file;
      const t = textOf(html.get(f)!);
      expect(t, key).not.toContain("—");
      expect(t, key).not.toMatch(/\w!(\s|$)/);
    }
  });

  it("writes a sitemap of exactly the indexable pages, and an llms.txt", () => {
    const sm = site.files.get("leanprompt/sitemap.xml") as string;
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(site.pages.filter((p) => p.index).map((p) => ORIGIN + url(p.key)).sort());
    const llms = site.files.get("leanprompt/llms.txt") as string;
    expect(llms).toMatch(/^# leanprompt\n\n> /);
    expect(llms).toContain(`${ORIGIN}/leanprompt/rules/lp-pc-02/`);
    expect(llms).toContain(`${ORIGIN}/leanprompt/audits/podwarden__leanprompt/`);
    expect(site.files.get("leanprompt/news/feed.xml")).toMatch(/<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  });
});

describe("the audits index", () => {
  const audits = () => loadAudits(ROOT, loadRuleIds(ROOT));
  const index = () => html.get("leanprompt/audits/index.html")!;

  it("gives every published audit a headline, a subtitle, a kind from the list and a badge consistent with its links", () => {
    for (const a of audits()) {
      expect(a.meta.headline, a.slug).toBeTruthy();
      expect(a.meta.headline!.length, a.slug).toBeLessThanOrEqual(80);
      expect(a.meta.subtitle, a.slug).toBeTruthy();
      expect(KINDS, a.slug).toContain(a.meta.kind);
      const b = badgeOf(a);
      expect(b, a.slug).toBeDefined();
      if (b === "fixed") expect(a.meta.status, a.slug).toBe("fixed");
      if (b === "demo") expect(a.meta.status, a.slug).toBe("demo");
      if (b === "reported" || b === "fixed" || b === "planned") expect(a.meta.maintainer?.issue ?? a.meta.maintainer?.pr, a.slug).toBeTruthy();
      if (b === "nochannel") {
        expect(a.meta.status, a.slug).toBe("published");
        expect(a.meta.no_channel, a.slug).toBeTruthy();
      }
      expect(index(), a.slug).toContain(`badge badge-${b}">${BADGES[b!]}`);
    }
  });

  it("never mocks: no mocking words, exclamation marks or em dashes in a headline or subtitle", () => {
    for (const a of audits()) for (const t of [a.meta.headline!, a.meta.subtitle!]) {
      expect(t, a.slug).not.toMatch(MOCKING);
      expect(t, a.slug).not.toMatch(/[!\u2014]/);
    }
  });

  it("labels every big number: an estimate for tokens, counted for a count", () => {
    const h = index();
    const bigs = [...h.matchAll(/<p class="big[^"]*">([\s\S]*?)<\/p>/g)].map((m) => m[1]!);
    expect(bigs.length).toBe(audits().filter((a) => bigNumberOf(a)).length);
    for (const b of bigs) {
      if (b.includes("≈")) expect(b).toMatch(/tokens per 1,000 (calls|runs)[\s\S]*<span class="big-tag">estimate<\/span>$/);
      else expect(b).toMatch(/<span class="big-tag">counted from their own output<\/span>$/);
    }
    for (const a of audits()) {
      const page = html.get(`leanprompt/audits/${a.slug}/index.html`)!;
      const b = /<p class="big big-page">([\s\S]*?)<\/p>/.exec(page)?.[1];
      if (bigNumberOf(a)) expect(b, a.slug).toMatch(/<span class="big-tag">(estimate|counted from their own output)<\/span>$/);
    }
  });

  it("lists fixed upstream first, then by the big number, the demonstration last", () => {
    const order = [...index().matchAll(/<li class="audit-card">[\s\S]*?href="\/leanprompt\/audits\/([^/]+)\/"/g)].map((m) => m[1]);
    const sorted = sortForIndex(audits());
    expect(order).toEqual(sorted.map((a) => a.slug));
    const rank = (b?: string) => (b === "fixed" ? 0 : b === "demo" ? 2 : 1);
    for (let i = 1; i < sorted.length; i++) {
      const [x, y] = [sorted[i - 1]!, sorted[i]!];
      expect(rank(badgeOf(x)), `${x.slug} before ${y.slug}`).toBeLessThanOrEqual(rank(badgeOf(y)));
      if (rank(badgeOf(x)) === rank(badgeOf(y))) {
        const [bx, by] = [bigNumberOf(x), bigNumberOf(y)];
        const v = (b: typeof bx) => (b?.kind === "tokens" ? b.value : -1);
        expect(v(bx), `${x.slug} before ${y.slug}`).toBeGreaterThanOrEqual(v(by));
      }
    }
  });

  it("keeps the estimates line, the tell-the-maintainers line and the corrections line, under a summary strip", () => {
    const t = textOf(index()).replace(/\s+/g, " ");
    expect(t).toMatch(/\d+ open-source apps audited \d+ problems found \d+ fixed upstream \d+ reported to the maintainers/);
    expect(t).toContain("The figures are estimates from reading the code, not measurements.");
    expect(t).toContain("We tell the maintainers before an audit is published.");
    expect(t).toContain(CORRECTIONS_LINE);
  });
});

describe("audit pages", () => {
  const page = () => textOf(html.get("leanprompt/audits/podwarden__leanprompt/index.html")!).replace(/\s+/g, " ");

  it("are dated, name the commit and the version, and label every figure as an estimate", () => {
    const t = page();
    expect(t).toContain("A timestamp at the top of the prompt means no call can reuse the cache");
    expect(t).toContain("Audited 2026-11-26 with leanprompt 0.1.0-dev.12");
    expect(t).toContain("67e1586");
    expect(t).toContain(ESTIMATE_LABEL);
    const h = html.get("leanprompt/audits/podwarden__leanprompt/index.html")!;
    // Every figure: each finding with tokens carries the Estimate tag.
    const findings = h.split('<li class="finding"').slice(1);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f).toContain('<span class="est-tag">Estimate</span>');
    expect(t).toContain("an estimate from the findings");
  });

  it("carry the corrections and takedown line, here and on the full report page", () => {
    expect(page()).toContain(CORRECTIONS_LINE);
    expect(CORRECTIONS_LINE).toBe("Corrections and takedown: email info@podwarden.com or open an issue.");
    const report = textOf(html.get("leanprompt/audits/podwarden__leanprompt/report/index.html")!).replace(/\s+/g, " ");
    expect(report).toContain("Corrections and takedown: email info@podwarden.com");
    expect(report).toContain(ESTIMATE_LABEL);
  });

  it("show planned work, how-often flags, fixed findings and notes, and link the code at the commit audited", () => {
    const audits = loadAudits(ROOT, loadRuleIds(ROOT));
    for (const a of audits) {
      const h = html.get(`leanprompt/audits/${a.slug}/index.html`)!;
      const t = textOf(h).replace(/\s+/g, " ");
      // The findings.json link names the folder as it is in the repository: GitHub paths are case-sensitive.
      expect(h, a.slug).toContain(`/blob/main/site/audits/${a.folder}/findings.json`);
      expect(existsSync(join(ROOT, "site", "audits", a.folder, "findings.json")), a.folder).toBe(true);
      for (const f of a.findings) if (f.file !== "<external>") expect(h, `${a.slug} ${f.file}`).toContain(`${a.meta.repo}/blob/${a.meta.commit}/${f.file}#L${f.line}`);
      expect(t.split("Already planned.").length - 1, a.slug).toBe(a.findings.filter((f) => !f.fixed && knownOf(f)?.kind === "planned").length);
      expect(t.split("Declined by the project").length - 1, a.slug).toBe(
        (a.findings.some((f) => !f.fixed && knownOf(f)?.kind === "declined") ? 1 : 0) + (a.notes ?? []).filter((n) => n.known?.kind === "declined").length,
      );
      // A declined finding is listed only with its link, so its flags are not shown.
      const shown = a.findings.filter((f) => knownOf(f)?.kind !== "declined");
      expect(t.split("size is assumed").length - 1, a.slug).toBe(shown.filter((f) => f.status === "size-unknown").length);
      if (a.unattended) expect(t, a.slug).toContain("Unattended audit");
      expect(t.split("how often is assumed").length - 1, a.slug).toBe(shown.filter((f) => f.status === "frequency-unknown").length);
      if (a.findings.some((f) => f.fixed)) expect(t, a.slug).toContain("Already fixed");
      for (const n of a.notes ?? []) {
        expect(t, a.slug).toContain(n.title.replace(/['"&<>]/g, " "));
        if (n.file !== "<external>") expect(h).toContain(`${a.meta.repo}/blob/${a.meta.commit}/${n.file}#L${n.line}`);
      }
      if (a.notes?.length) {
        expect(t, a.slug).toContain("Other problems the audit found");
        expect(html.get(`leanprompt/audits/${a.slug}/report/index.html`)!, a.slug).toContain('id="s-notes"');
      }
      // Every real audit links where the maintainers were told, or says why there was no channel.
      if (a.meta.status !== "demo" && !a.meta.no_channel) expect(a.meta.maintainer?.issue ?? a.meta.maintainer?.pr, a.slug).toBeTruthy();
      if (a.meta.no_channel) {
        expect(t, a.slug).toContain(a.meta.no_channel);
        expect(t, a.slug).not.toContain("Status Published.");
      }
    }
  });

  const good = `repo: https://github.com/acme/widget
visibility: public
commit: ${"a".repeat(40)}
leanprompt: 0.1.0
date: 2026-12-01
status: published
headline: "A timestamp at the top of the prompt means no call can reuse the cache"
subtitle: An example app that keeps its whole handbook in one system prompt.
kind: Cache never hits
figure:
  label: for a handbook the cache could have served
`;

  it("accept a complete meta.yaml", () => {
    const { meta, errors } = validateMeta(good, "acme__widget");
    expect(errors).toEqual([]);
    expect(meta).toMatchObject({ owner: "acme", name: "widget", date: "2026-12-01" });
  });

  it.each([
    ["no repo", good.replace(/^repo:.*\n/m, ""), /repo is required/],
    ["a GitLab repo", good.replace("https://github.com/acme/widget", "https://gitlab.com/acme/widget"), /public repository URL/],
    ["an http URL", good.replace("https://github.com", "http://github.com"), /public repository URL/],
    ["a deeper URL", good.replace("acme/widget", "acme/widget/tree/main"), /public repository URL/],
    ["no visibility", good.replace("visibility: public\n", ""), /visibility: public is required/],
    ["a private repo", good.replace("visibility: public", "visibility: private"), /visibility: public is required/],
    ["a short commit", good.replace("a".repeat(40), "abc1234"), /full 40-character SHA/],
    ["a disputed audit with no response", good.replace("published", "disputed") + "maintainer:\n  issue: https://github.com/acme/widget/issues/1\n", /quote the maintainer's response/],
    ["notified with no link", good.replace("published", "notified"), /needs maintainer.issue/],
    ["an unknown key", good + "score: 12\n", /unknown keys score/],
    ["no headline", good.replace(/^headline:.*\n/m, ""), /headline is required/],
    ["a headline over 80 characters", good.replace(/^headline:.*$/m, `headline: ${"x".repeat(81)}`), /at most 80 characters/],
    ["a mocking headline", good.replace(/^headline:.*$/m, "headline: A lazy retry loop"), /not mock it: remove "lazy"/],
    ["an exclamation mark", good.replace(/^headline:.*$/m, "headline: The cache never hits!"), /plain statement/],
    ["a wasted-as-fact subtitle", good.replace(/^subtitle:.*$/m, "subtitle: A chat app that wasted tokens."), /not mock it/],
    ["no subtitle", good.replace(/^subtitle:.*\n/m, ""), /subtitle is required/],
    ["an unknown kind", good.replace("kind: Cache never hits", "kind: Bad code"), /kind must be one of/],
    ["no figure", good.replace(/^figure:\n.*\n/m, ""), /figure is required/],
    ["a figure with finding and count", good.replace("figure:\n", "figure:\n  count: 3 of 9\n  finding: a.ts:1\n"), /finding or count, not both/],
    ["a malformed count", good.replace("figure:\n", "figure:\n  count: many\n"), /figure.count must be/],
    ["a figure unit other than calls or runs", good.replace("figure:\n", "figure:\n  unit: days\n"), /figure.unit must be calls or runs/],
    ["no_channel on a notified audit", good.replace("published", "notified") + "maintainer:\n  issue: https://github.com/acme/widget/issues/1\nno_channel: Issues are off.\n", /no_channel goes only with status: published/],
    ["an empty no_channel", good + "no_channel: \"\"\n", /no_channel must be a sentence/],
    ["a no_channel over 300 characters", good + `no_channel: ${"x".repeat(301)}\n`, /no_channel must be at most 300 characters/],
  ])("refuse %s", (_name, text, re) => {
    expect(validateMeta(text, "acme__widget").errors.join("\n")).toMatch(re);
  });

  it("accept a published audit that says why there is no maintainer thread", () => {
    const { meta, errors } = validateMeta(good + "no_channel: The repository has issues and discussions turned off.\n", "acme__widget");
    expect(errors).toEqual([]);
    expect(meta?.no_channel).toBe("The repository has issues and discussions turned off.");
  });

  it("accept a draft without the headline fields", () => {
    const draft = good.replace("published", "draft").replace(/^(headline|subtitle|kind):.*\n/gm, "").replace(/^figure:\n.*\n/m, "");
    expect(validateMeta(draft, "acme__widget").errors).toEqual([]);
  });

  it("refuse a figure that names no finding", () => {
    const root = mkdtempSync(join(tmpdir(), "lp-site-"));
    const dir = join(root, "site", "audits", "acme__widget");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.yaml"), good.replace("figure:\n", "figure:\n  finding: nope\n"));
    writeFileSync(join(dir, "findings.json"), '{"v":1,"findings":[]}');
    expect(() => loadAudits(root, loadRuleIds(ROOT))).toThrow(/figure.finding nope names no finding/);
  });

  it("refuse a folder that does not match the repository", () => {
    expect(validateMeta(good, "acme__other").errors.join("\n")).toMatch(/must be named acme__widget/);
  });

  it("fail the build on a bad audit, skip drafts and the template", () => {
    const root = mkdtempSync(join(tmpdir(), "lp-site-"));
    const ids = loadRuleIds(ROOT);
    const dir = join(root, "site", "audits");
    mkdirSync(join(dir, "acme__widget"), { recursive: true });
    cpSync(join(ROOT, "site", "audits", "_template"), join(dir, "_template"), { recursive: true });
    writeFileSync(join(dir, "acme__widget", "meta.yaml"), good.replace("visibility: public\n", ""));
    writeFileSync(join(dir, "acme__widget", "findings.json"), '{"v":1,"findings":[]}');
    expect(() => loadAudits(root, ids)).toThrow(/acme__widget\/meta.yaml: visibility: public is required/);
    writeFileSync(join(dir, "acme__widget", "meta.yaml"), good.replace("published", "draft"));
    expect(loadAudits(root, ids)).toEqual([]);
    writeFileSync(join(dir, "acme__widget", "meta.yaml"), good);
    writeFileSync(join(dir, "acme__widget", "findings.json"), JSON.stringify({ v: 1, findings: [{ rule: "LP-PC-03", file: "a.ts", line: 1, saves: "prefill", severity: "high", tokens_per_1k: { uncached: 5, measured_calls: 50 } }] }));
    expect(() => loadAudits(root, ids)).toThrow(/estimates from the code only/);
    writeFileSync(join(dir, "acme__widget", "findings.json"), readFileSync(join(ROOT, "site", "audits", "_template", "findings.json")));
    expect(loadAudits(root, ids).map((a) => a.slug)).toEqual(["acme__widget"]);
  });
});
