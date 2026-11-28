import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRuleIds } from "../../cli/src/lint/rules.js";
import { loadAudits, type Audit } from "../src/audits.js";
import { buildSite, type Site } from "../src/build.js";
import { cardContent, cardSvg, fitHeadline, OG_HEIGHT, OG_WIDTH, renderCard, wrap } from "../src/og.js";
import { ORIGIN, url } from "../src/paths.js";

const ROOT = join(import.meta.dirname, "..", "..");
let site: Site;
let audits: Audit[];

beforeAll(() => {
  audits = loadAudits(ROOT, loadRuleIds(ROOT));
  site = buildSite(ROOT);
});

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const svgTexts = (svg: string) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => unesc(m[1]!));
/** The headline's lines: the text elements marked class="headline". */
const headlineLines = (svg: string) => [...svg.matchAll(/<text [^>]*class="headline"[^>]*>([^<]*)<\/text>/g)].map((m) => unesc(m[1]!));

describe("audit share cards", () => {
  it("draws a 1200x630 PNG for every audit, written beside its page", () => {
    expect(audits.length).toBeGreaterThan(5);
    for (const a of audits) {
      const f = site.files.get(`leanprompt/audits/${a.slug}/og.png`);
      expect(f, a.slug).toBeInstanceOf(Buffer);
      const b = f as Buffer;
      expect(b.subarray(0, 8).toString("hex"), a.slug).toBe("89504e470d0a1a0a");
      expect(pngSize(b), a.slug).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
      expect(b.length, a.slug).toBeLessThan(150_000);
    }
  });

  it("puts the headline, repo, kind, badge and figure in the SVG before rasterising", () => {
    for (const a of audits) {
      const svg = cardSvg(a);
      const c = cardContent(a);
      const texts = svgTexts(svg);
      expect(headlineLines(svg).join(" "), a.slug).toBe(c.headline);
      expect(texts, a.slug).toContain(c.repo);
      expect(texts.join(" "), a.slug).toContain("leanprompt");
      expect(texts.join(" "), a.slug).toContain("lmwarden.com");
      if (c.kind) expect(texts, a.slug).toContain(c.kind.toUpperCase());
      if (c.badge) expect(texts, a.slug).toContain(c.badge);
      if (c.figure) expect(texts, a.slug).toContain(c.figure.number);
      else expect(texts.some((t) => /^(≈|\d)/.test(t) && t.length < 20), `${a.slug}: no figure, no number`).toBe(false);
      expect(svg, a.slug).not.toMatch(/<image\b/);
    }
  });

  it("shows the badge of a fixed audit and no number for a label-only figure", () => {
    const fixed = audits.find((a) => cardContent(a).fixed);
    if (fixed) expect(svgTexts(cardSvg(fixed))).toContain("Fixed upstream");
    const labelOnly = audits.find((a) => !cardContent(a).figure);
    if (labelOnly) expect(svgTexts(cardSvg(labelOnly)).join(" ")).not.toContain("tokens per");
  });

  it("fits the longest headline in the repo, and an 80-character worst case, inside the card", () => {
    const longest = [...audits].sort((a, b) => (b.meta.headline?.length ?? 0) - (a.meta.headline?.length ?? 0))[0]!;
    const worst = "Wwwwwwwww mmmmmmmmm wwwwwwwww mmmmmmmmm wwwwwwwww mmmmmmmmm wwwwwwwww mmmmmmmmm wwwwwwwww".slice(0, 79);
    const noSpaces = "W".repeat(80);
    expect(worst.length).toBe(79);
    for (const h of [longest.meta.headline!, worst, noSpaces, "Short one"]) {
      const fit = fitHeadline(h, OG_WIDTH - 128, 250);
      expect(fit.height, h).toBeLessThanOrEqual(250);
      expect(fit.size, h).toBeGreaterThanOrEqual(36);
      expect(fit.lines.join("").replace(/\s/g, ""), h).toBe(h.replace(/\s/g, ""));
      for (const l of fit.lines) expect(wrap("bold", l, fit.size, 1e9).length, h).toBe(1);
    }
    // Long text shrinks; a short one stays large.
    expect(fitHeadline("Short one", 1072, 250).size).toBeGreaterThan(fitHeadline(longest.meta.headline!, 1072, 250).size - 1);
    expect(fitHeadline(noSpaces, 1072, 250).size).toBeLessThan(fitHeadline("Short one", 1072, 250).size);
    // Nothing is cut: the whole headline is on the card, inside its margins, for the worst cases too.
    const a = { ...longest, meta: { ...longest.meta, headline: worst } } as Audit;
    expect(headlineLines(cardSvg(a)).join(" ")).toBe(worst);
    expect(renderCard(a).length).toBeGreaterThan(1000);
  });

  it("is deterministic: the same audit gives the same SVG and the same bytes", () => {
    for (const a of audits.slice(0, 4)) {
      expect(cardSvg(a)).toBe(cardSvg(a));
      expect(renderCard(a).equals(renderCard(a)), a.slug).toBe(true);
    }
    const a = audits[0]!;
    expect(renderCard({ ...a, meta: { ...a.meta, headline: `${a.meta.headline} x` } }).equals(renderCard(a))).toBe(false);
  });

  it("points og:image and twitter:image of each audit page at its card, with the size", () => {
    for (const a of audits) {
      const h = site.files.get(`leanprompt/audits/${a.slug}/index.html`) as string;
      const want = `${ORIGIN}${url(`audits/${a.slug}`)}og.png`;
      expect(/<meta property="og:image" content="([^"]+)">/.exec(h)?.[1], a.slug).toBe(want);
      expect(/<meta name="twitter:image" content="([^"]+)">/.exec(h)?.[1], a.slug).toBe(want);
      expect(h, a.slug).toContain('<meta property="og:image:width" content="1200">');
      expect(h, a.slug).toContain('<meta property="og:image:height" content="630">');
      expect(h, a.slug).not.toContain("og.jpg");
      expect(site.files.has(want.slice(ORIGIN.length + 1)), a.slug).toBe(true);
    }
  });

  it("leaves the audits index and the home page on the diagrams, not the share cards", () => {
    for (const k of ["leanprompt/audits/index.html", "leanprompt/index.html"]) {
      const h = site.files.get(k) as string;
      expect(h).not.toMatch(/<img [^>]*og\.(png|jpg)/);
    }
  });
});
