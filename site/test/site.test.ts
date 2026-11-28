import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRuleIds } from "../../cli/src/lint/rules.js";
import { knownOf } from "../../cli/src/score/static.js";
import { BADGES, ILLUSTRATIONS_PENDING, ILLUSTRATION_FILES, KINDS, MOCKING, badgeOf, bigNumberOf, imageInfo, loadAudits, sortForIndex, validateMeta } from "../src/audits.js";
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

// A complete meta.yaml, and helpers for a throwaway repository root holding one audit.
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
illustration:
  scene: a desk clock glued to the cover of a thick handbook beside a copier
  alt: A thick handbook with a small clock on its cover sits beside a copier.
`;

/** A PNG, JPEG or WebP header of the given size: enough for the build's checks, not a picture. */
const fakePng = (w: number, h: number) => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
};
/** A JPEG skeleton (SOI, a progressive frame header, EOI) of the given size. */
const fakeJpeg = (w: number, h: number) => {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc2, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
};
const fakeWebp = (w: number, h: number) => {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(22, 4);
  b.write("WEBPVP8X", 8, "latin1");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};
/** A temporary repository root with one audit, acme__widget, and its two illustration files. */
const tempAudit = (meta = good, files: Record<string, Buffer | null> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "lp-site-"));
  const dir = join(root, "site", "audits", "acme__widget");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.yaml"), meta);
  writeFileSync(join(dir, "findings.json"), readFileSync(join(ROOT, "site", "audits", "_template", "findings.json")));
  const all: Record<string, Buffer | null> = { "illustration.webp": fakeWebp(1408, 736), "og.jpg": fakeJpeg(1200, 630), ...files };
  for (const [f, b] of Object.entries(all)) if (b) writeFileSync(join(dir, f), b);
  return root;
};

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

  it("keeps the dateline below an audit subtitle instead of pulling it over the last line", () => {
    const css = site.files.get("leanprompt/assets/site.css")!.toString();
    // .dateline has a negative top margin for other contexts; after the subtitle it must not overlap.
    expect(css).toMatch(/\.dateline\{[^}]*margin:-\d+px/);
    const m = css.match(/\.audit-sub\.lede\+\.dateline\{margin-top:(-?\d+)px\}/);
    expect(m, "rule for the dateline after an audit subtitle").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
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
      // A private repository (published with consent) has no public thread: the consent and the response stand in for it.
      if (b === "reported" || b === "fixed" || b === "planned")
        expect(a.meta.visibility === "private" ? a.meta.consent && a.meta.maintainer?.response : (a.meta.maintainer?.issue ?? a.meta.maintainer?.pr), a.slug).toBeTruthy();
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
      const priv = a.meta.visibility === "private";
      // A private repository's code is behind a sign-in: the page names the file and line and links nothing of it.
      if (priv) expect(h, a.slug).not.toContain(`href="${a.meta.repo}`);
      const codeRef = (file: string, line: number) => (priv ? `<code>${file}:${line}</code>` : `${a.meta.repo}/blob/${a.meta.commit}/${file}#L${line}`);
      for (const f of a.findings) if (f.file !== "<external>") expect(h, `${a.slug} ${f.file}`).toContain(codeRef(f.file, f.line));
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
        if (n.file !== "<external>") expect(h).toContain(codeRef(n.file, n.line));
      }
      if (a.notes?.length) {
        expect(t, a.slug).toContain("Other problems the audit found");
        expect(html.get(`leanprompt/audits/${a.slug}/report/index.html`)!, a.slug).toContain('id="s-notes"');
      }
      // Every real audit links where the maintainers were told, or says why there was no channel.
      if (priv) expect(t, a.slug).toContain(`Published with the maintainers’ written permission, given ${a.meta.consent!.date}`);
      else if (a.meta.status !== "demo" && !a.meta.no_channel) expect(a.meta.maintainer?.issue ?? a.meta.maintainer?.pr, a.slug).toBeTruthy();
      if (a.meta.no_channel) {
        expect(t, a.slug).toContain(a.meta.no_channel);
        expect(t, a.slug).not.toContain("Status Published.");
      }
    }
  });


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
    ["a private repo without consent", good.replace("visibility: public", "visibility: private"), /needs consent/],
    ["consent on a public repo", good + "consent:\n  date: 2026-12-01\n", /consent goes only with visibility: private/],
    ["a private repo with a malformed consent date", good.replace("visibility: public", "visibility: private") + "consent:\n  date: soon\n", /consent.date must be/],
    ["a private repo with an issue link", good.replace("visibility: public", "visibility: private") + "consent:\n  date: 2026-12-01\nmaintainer:\n  issue: https://github.com/acme/widget/issues/1\n", /leave maintainer.issue and maintainer.pr out/],
    ["a private repo fixed with no response", good.replace("visibility: public", "visibility: private").replace("published", "fixed") + "consent:\n  date: 2026-12-01\n", /needs maintainer.response/],
    ["a private repo notified", good.replace("visibility: public", "visibility: private").replace("published", "notified") + "consent:\n  date: 2026-12-01\n", /status notified does not fit a private repository/],
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

  it("accept a private repository on any host, with the maintainers' written consent (0.1.0-dev.16)", () => {
    const priv = good.replace("https://github.com/acme/widget", "https://gitlab.com/acme/widget").replace("visibility: public", "visibility: private").replace("published", "fixed") +
      "consent:\n  date: 2026-12-02\n  note: Given by email to info@podwarden.com.\nmaintainer:\n  response: We fixed the history trim.\n  response_date: 2026-12-02\n";
    const { meta, errors } = validateMeta(priv, "acme__widget");
    expect(errors).toEqual([]);
    expect(meta).toMatchObject({ owner: "acme", name: "widget", visibility: "private", consent: { date: "2026-12-02", note: "Given by email to info@podwarden.com." } });
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

  it("refuse a findings.json with private items, and accept it once they are stripped (0.1.0-dev.15)", () => {
    const root = mkdtempSync(join(tmpdir(), "lp-site-"));
    const dir = join(root, "site", "audits", "acme__widget");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.yaml"), good);
    const priv = { title: "The default base URL sends users' keys to a third-party relay", file: "start.py", line: 3, problem: "A relay receives the key.", change: "Default to the provider.", private: true };
    writeFileSync(join(dir, "findings.json"), JSON.stringify({ v: 1, findings: [], notes: [priv] }));
    expect(() => loadAudits(root, loadRuleIds(ROOT))).toThrow(/1 private item \(private: true\); remove it from the published file/);
    writeFileSync(join(dir, "findings.json"), JSON.stringify({ v: 1, findings: [{ rule: "LP-PC-03", file: "a.ts", line: 1, saves: "prefill", severity: "high", private: true }] }));
    expect(() => loadAudits(root, loadRuleIds(ROOT))).toThrow(/private item/);
  });

  it("no published audit holds a private item, and AI-Video-Transcriber's relay note stays out", () => {
    const vt = readFileSync(join(ROOT, "site", "audits", "wendy7756__AI-Video-Transcriber", "findings.json"), "utf8");
    expect(vt).not.toMatch(/relay|private/i);
    for (const a of loadAudits(ROOT, loadRuleIds(ROOT))) {
      expect([...a.findings, ...(a.notes ?? [])].some((x) => (x as { private?: boolean }).private), a.slug).toBe(false);
    }
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
    expect(() => loadAudits(root, ids)).toThrow(/illustration.webp and og.jpg missing: run npm run illustrations -- --only acme__widget/);
    writeFileSync(join(dir, "acme__widget", "illustration.webp"), fakeWebp(1408, 736));
    writeFileSync(join(dir, "acme__widget", "og.jpg"), fakeJpeg(1200, 630));
    expect(loadAudits(root, ids).map((a) => a.slug)).toEqual(["acme__widget"]);
  });
});

describe("audit illustrations", () => {
  const audits = () => loadAudits(ROOT, loadRuleIds(ROOT));
  const ids = loadRuleIds(ROOT);

  it("give every published audit, the demonstration too, a scene, an alt sentence and both files", () => {
    const all = audits();
    expect(all.some((a) => a.meta.status === "demo")).toBe(true);
    for (const a of all) {
      expect(a.meta.illustration?.scene, a.slug).toBeTruthy();
      expect(a.meta.illustration?.alt, a.slug).toMatch(/^[A-Z].*\.$/);
      if (ILLUSTRATIONS_PENDING.includes(a.folder)) continue;
      expect(a.images, a.slug).toBeDefined();
      for (const k of ["card", "og"] as const) {
        const want = ILLUSTRATION_FILES[k];
        expect(imageInfo(readFileSync(join(ROOT, "site", "audits", a.folder, want.file))), `${a.folder}/${want.file}`).toEqual({ type: want.type, width: want.width, height: want.height });
        expect(site.files.has(`leanprompt/audits/${a.slug}/${want.file}`), `${a.slug} ${want.file}`).toBe(true);
      }
    }
  });

  it("keep the pending list to audits that still lack their files: it must be empty before a release", () => {
    // Each entry lets one audit build without illustration.webp and og.jpg until the owner renders them.
    // Once the files exist the entry must go (this test fails until it does); site/audits/README.md's
    // release checklist requires the list to be empty.
    for (const folder of ILLUSTRATIONS_PENDING) {
      expect(existsSync(join(ROOT, "site", "audits", folder, "meta.yaml")), folder).toBe(true);
      const has = Object.values(ILLUSTRATION_FILES).filter((f) => existsSync(join(ROOT, "site", "audits", folder, f.file)));
      expect(has.map((f) => f.file), `${folder} has its files now: remove it from ILLUSTRATIONS_PENDING`).toEqual([]);
    }
    expect(ILLUSTRATIONS_PENDING.length, "pending illustrations").toBeLessThanOrEqual(2);
  });

  it("show the picture beside each card's headline, after it in the markup, lazy below the first row", () => {
    const h = html.get("leanprompt/audits/index.html")!;
    const cards = h.split('<li class="audit-card">').slice(1);
    const order = sortForIndex(audits());
    expect(cards.length).toBe(order.length);
    order.forEach((a, i) => {
      const card = cards[i]!;
      const img = /<img [^>]*>/.exec(card)?.[0];
      if (!a.images) {
        expect(img, a.slug).toBeUndefined();
        return;
      }
      expect(img, a.slug).toBeDefined();
      expect(card.indexOf("<h2>"), a.slug).toBeLessThan(card.indexOf("<img "));
      expect(img, a.slug).toContain(` src="/leanprompt/audits/${a.slug}/illustration.webp?v=`);
      expect(img, a.slug).toContain(' width="1408" height="736"');
      expect(img, a.slug).toMatch(/ alt="[A-Z][^"]{20,}\."/);
      if (i < 2) expect(img, a.slug).not.toContain("loading=");
      else expect(img, a.slug).toContain(' loading="lazy"');
    });
  });

  it("show the picture after the headline on each audit page, never lazy, and use og.jpg as the page's share image", () => {
    for (const a of audits()) {
      const h = html.get(`leanprompt/audits/${a.slug}/index.html`)!;
      const og = /<meta property="og:image" content="([^"]+)">/.exec(h)?.[1];
      const tw = /<meta name="twitter:image" content="([^"]+)">/.exec(h)?.[1];
      if (!a.images) {
        expect(h, a.slug).not.toContain('class="audit-art');
        expect(og, a.slug).toBe(`${ORIGIN}${BASE}assets/og-image.png`);
        continue;
      }
      const img = /<img class="audit-art audit-art-page"[^>]*>/.exec(h)?.[0];
      expect(img, a.slug).toBeDefined();
      expect(h.indexOf("<h1"), a.slug).toBeLessThan(h.indexOf(img!));
      expect(img, a.slug).toContain(' width="1408" height="736"');
      expect(img, a.slug).toMatch(/ alt="[A-Z][^"]{20,}\."/);
      expect(img, a.slug).not.toContain("loading=");
      expect(og, a.slug).toBe(`${ORIGIN}${url(`audits/${a.slug}`)}og.jpg`);
      expect(tw, a.slug).toBe(og);
      expect(h, a.slug).toContain('<meta property="og:image:width" content="1200">');
      expect(h, a.slug).toContain('<meta property="og:image:height" content="630">');
      expect(site.files.has(og!.slice(ORIGIN.length + 1)), a.slug).toBe(true);
    }
    // Other pages keep the site's own share image.
    expect(html.get("leanprompt/index.html")!).toContain(`<meta property="og:image" content="${ORIGIN}${BASE}assets/og-image.png">`);
  });

  it("shows the first three audits of the index order on the home page, with a link to all of them", () => {
    const home = html.get("leanprompt/index.html")!;
    const real = sortForIndex(loadAudits(ROOT, loadRuleIds(ROOT)).filter((a) => a.meta.status !== "demo"));
    const section = home.slice(home.indexOf('id="audits-title"'), home.indexOf("</section>", home.indexOf('id="audits-title"')));
    const linked = [...section.matchAll(/<h3><a href="([^"]+)"/g)].map((m) => m[1]);
    expect(linked).toEqual(real.slice(0, 3).map((a) => url(`audits/${a.slug}`)));
    expect(section).toContain(`See all ${loadAudits(ROOT, loadRuleIds(ROOT)).length} audits`);
    // Below the first screen: the pictures load lazily.
    expect(section.match(/<img [^>]*>/g)!.every((i) => i.includes('loading="lazy"'))).toBe(true);
  });

  it.each([
    ["no illustration", good.replace(/^illustration:\n(  .*\n)+/m, ""), /illustration is required/],
    ["no scene", good.replace(/^  scene:.*\n/m, ""), /illustration.scene is required/],
    ["no alt", good.replace(/^  alt:.*\n/m, ""), /illustration.alt is required/],
    ["a two-sentence alt", good.replace(/^  alt:.*$/m, "  alt: A handbook. A copier."), /one plain sentence/],
    ["an alt without a full stop", good.replace(/^  alt:.*$/m, "  alt: A handbook beside a copier"), /one plain sentence/],
    ["an image-of alt", good.replace(/^  alt:.*$/m, "  alt: Image of a handbook beside a copier."), /drop "image of"/],
    ["a too-short scene", good.replace(/^  scene:.*$/m, "  scene: a clock"), /10 to 1500 characters/],
    ["an unknown illustration key", good + "  seed: 4\n", /illustration: unknown keys seed/],
  ])("refuse %s", (_name, text, re) => {
    expect(validateMeta(text, "acme__widget").errors.join("\n")).toMatch(re);
  });

  it.each([
    ["no og.jpg", { "og.jpg": null }, /og.jpg missing: run npm run illustrations/],
    ["no illustration.webp", { "illustration.webp": null }, /illustration.webp missing/],
    ["a PNG saved as illustration.webp", { "illustration.webp": fakePng(1408, 736) }, /illustration.webp is not a valid WEBP image/],
    ["a truncated WebP", { "illustration.webp": fakeWebp(1408, 736).subarray(0, 26) }, /illustration.webp is not a valid WEBP image/],
    ["a WebP of the wrong size", { "illustration.webp": fakeWebp(1024, 1024) }, /illustration.webp must be 1408x736, not 1024x1024/],
    ["an og.jpg of the wrong size", { "og.jpg": fakeJpeg(1408, 736) }, /og.jpg must be 1200x630, not 1408x736/],
    ["a PNG saved as og.jpg", { "og.jpg": fakePng(1200, 630) }, /og.jpg is not a valid JPEG image/],
    ["a truncated JPEG", { "og.jpg": fakeJpeg(1200, 630).subarray(0, 12) }, /og.jpg is not a valid JPEG image/],
  ])("fail the build on %s", (_name, files, re) => {
    expect(() => loadAudits(tempAudit(good, files as Record<string, Buffer | null>), ids)).toThrow(re);
  });

  it("build an audit with both files, and read real files' sizes", () => {
    expect(loadAudits(tempAudit(), ids)[0]!.images).toBeDefined();
    expect(imageInfo(readFileSync(join(ROOT, "site", "audits", "Nutlope__aicommits", "illustration.webp")))).toEqual({ type: "webp", width: 1408, height: 736 });
  });
});
