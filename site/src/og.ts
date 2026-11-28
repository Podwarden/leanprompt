// The share card of each audit page: a 1200x630 PNG composed from meta.yaml and findings.json only
// (kind, headline, repo, the big number, status badge, the leanprompt mark), in the site's dark palette.
// Text is laid out here with opentype.js (so wrapping and shrinking are measured, not guessed) and
// rasterised by @resvg/resvg-js from the bundled TTFs (site/src/og-fonts, SIL OFL), with no system
// fonts and no browser: the same bytes on macOS and Linux. Both are devDependencies of the site build.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { BADGES, badgeOf, bigNumberOf, type Audit } from "./audits.js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_FILE = "og.png";

const DIR = join(import.meta.dirname, "og-fonts");
const FILES = { bold: "MonaSans-Bold.ttf", medium: "MonaSans-Medium.ttf", mono: "JetBrainsMono-Medium.ttf" } as const;
type Face = keyof typeof FILES;
const fonts = new Map<Face, opentype.Font>();
const font = (f: Face): opentype.Font => {
  let x = fonts.get(f);
  if (!x) {
    const b = readFileSync(join(DIR, FILES[f]));
    x = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    fonts.set(f, x);
  }
  return x;
};
const FAMILY: Record<Face, { family: string; weight: number }> = {
  bold: { family: "Mona Sans", weight: 700 },
  medium: { family: "Mona Sans", weight: 500 },
  mono: { family: "JetBrains Mono", weight: 500 },
};

// The dark theme of site.css.
const C = { ground: "#1C1409", plate: "#2C251A", ink: "#EAE5DC", ink2: "#ACA397", rule: "#433C31", amber: "#F2A516", amberInk: "#1C1409" };
const PAD = 64;
const INNER = OG_WIDTH - 2 * PAD;

const width = (face: Face, text: string, size: number) => font(face).getAdvanceWidth(text, size);

/** Greedy word wrap to a pixel width; a word wider than the line is broken by characters. */
export function wrap(face: Face, text: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const push = (w: string) => {
    const t = cur ? `${cur} ${w}` : w;
    if (width(face, t, size) <= max) return void (cur = t);
    if (cur) lines.push(cur);
    cur = "";
    if (width(face, w, size) <= max) return void (cur = w);
    for (const ch of w) {
      if (cur && width(face, cur + ch, size) > max) {
        lines.push(cur);
        cur = "";
      }
      cur += ch;
    }
  };
  for (const w of text.split(/\s+/).filter(Boolean)) push(w);
  if (cur) lines.push(cur);
  return lines;
}

export interface HeadlineFit {
  size: number;
  lines: string[];
  lineHeight: number;
  height: number;
}

/** The largest size (from 80 down to 36 px) at which the headline wraps into the box; ellipsised only below that. */
export function fitHeadline(text: string, maxWidth: number, maxHeight: number): HeadlineFit {
  for (let size = 80; size >= 36; size -= 2) {
    const lines = wrap("bold", text, size, maxWidth);
    const lineHeight = Math.round(size * 1.12);
    if (lines.length * lineHeight <= maxHeight) return { size, lines, lineHeight, height: lines.length * lineHeight };
  }
  const size = 36;
  const lineHeight = Math.round(size * 1.12);
  const n = Math.max(1, Math.floor(maxHeight / lineHeight));
  const lines = wrap("bold", text, size, maxWidth).slice(0, n);
  let last = lines[n - 1] ?? "";
  while (last && width("bold", `${last}…`, size) > maxWidth) last = last.slice(0, -1);
  lines[lines.length - 1] = `${last.trimEnd()}…`;
  return { size, lines, lineHeight, height: lines.length * lineHeight };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function text(face: Face, s: string, x: number, y: number, size: number, fill: string, extra = ""): string {
  const f = FAMILY[face];
  return `<text x="${x}" y="${y}" font-family="${f.family}" font-weight="${f.weight}" font-size="${size}" fill="${fill}"${extra}>${esc(s)}</text>`;
}

/** What the card says, taken from the audit alone. */
export interface CardContent {
  kind?: string;
  badge?: string;
  fixed: boolean;
  headline: string;
  repo: string;
  figure?: { number: string; unit?: string; label: string; tag: string };
}

export function cardContent(a: Audit): CardContent {
  const m = a.meta;
  const b = badgeOf(a);
  const big = bigNumberOf(a);
  return {
    ...(m.kind ? { kind: m.kind } : {}),
    ...(b ? { badge: BADGES[b] } : {}),
    fixed: b === "fixed",
    headline: m.headline ?? `Where ${m.name} could save tokens`,
    repo: `${m.owner}/${m.name}`,
    ...(big
      ? big.kind === "count"
        ? { figure: { number: big.text, label: big.label, tag: "counted from their own output" } }
        : { figure: { number: `≈ ${big.text}`, unit: `tokens per 1,000 ${big.unit}`, label: big.label, tag: "estimate" } }
      : {}),
  };
}

/** The card as SVG: every text is a plain <text> element, so the headline is readable before rasterising. */
export function cardSvg(a: Audit): string {
  const c = cardContent(a);
  const parts: string[] = [];
  parts.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${C.ground}"/>`);
  parts.push(`<rect width="12" height="${OG_HEIGHT}" fill="${C.amber}"/>`);

  // Top row: the kind label on the left, the status badge on the right.
  const topY = 72;
  if (c.kind) parts.push(text("mono", c.kind.toUpperCase(), PAD, topY, 24, C.amber, ' letter-spacing="2"'));
  if (c.badge) {
    const size = 22;
    const w = Math.ceil(width("bold", c.badge, size)) + 40;
    const x = OG_WIDTH - PAD - w;
    parts.push(
      c.fixed
        ? `<rect x="${x}" y="${topY - 32}" width="${w}" height="46" rx="23" fill="${C.amber}"/>${text("bold", c.badge, x + 20, topY, size, C.amberInk)}`
        : `<rect x="${x + 1}" y="${topY - 31}" width="${w - 2}" height="44" rx="22" fill="none" stroke="${C.ink2}" stroke-width="2"/>${text("bold", c.badge, x + 20, topY, size, C.ink)}`,
    );
  }

  // Bottom: the rule, the repo, the mark.
  const footY = 585;
  parts.push(`<rect x="${PAD}" y="520" width="${INNER}" height="2" fill="${C.rule}"/>`);
  const mark = "leanprompt · lmwarden.com";
  const repoMax = INNER - width("bold", mark, 26) - 40;
  let rs = 28;
  while (rs > 20 && width("mono", c.repo, rs) > repoMax) rs -= 1;
  let repo = c.repo;
  while (repo.length > 4 && width("mono", repo, rs) > repoMax) repo = repo.slice(0, -2);
  parts.push(text("mono", repo === c.repo ? repo : `${repo}…`, PAD, footY, rs, C.ink));
  parts.push(text("bold", "leanprompt", OG_WIDTH - PAD - width("bold", mark, 26), footY, 26, C.amber));
  parts.push(text("medium", " · lmwarden.com", OG_WIDTH - PAD - width("medium", " · lmwarden.com", 26), footY, 26, C.ink2));

  // Figure block, above the rule, when the page shows a big number.
  const figTop = 392;
  const headTop = 112;
  const headMax = (c.figure ? figTop - 40 : 500) - headTop;
  const fit = fitHeadline(c.headline, INNER, headMax);
  fit.lines.forEach((l, i) => parts.push(text("bold", l, PAD - 2, headTop + Math.round(fit.size * 0.92) + i * fit.lineHeight, fit.size, C.ink, ' class="headline"')));

  if (c.figure) {
    const f = c.figure;
    const nSize = 72;
    const base = figTop + 64;
    parts.push(text("bold", f.number, PAD, base, nSize, C.amber));
    const x = PAD + Math.ceil(width("bold", f.number, nSize)) + 28;
    const lines = wrap("medium", [f.unit, f.label].filter(Boolean).join(", "), 24, OG_WIDTH - PAD - x).slice(0, 3);
    const lh = 30;
    const top = base - 52 + (lines.length === 1 ? 14 : lines.length === 2 ? 0 : -12);
    lines.forEach((l, i) => parts.push(text("medium", l, x, top + 24 + i * lh, 24, C.ink)));
    parts.push(text("mono", f.tag.toUpperCase(), x, top + 24 + lines.length * lh + 4, 17, C.ink2, ' letter-spacing="1.5"'));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">\n${parts.join("\n")}\n</svg>\n`;
}

/** The card as a 1200x630 PNG. */
export function renderCard(a: Audit): Buffer {
  return renderSvg(cardSvg(a));
}

export function renderSvg(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: { loadSystemFonts: false, fontFiles: Object.values(FILES).map((f) => join(DIR, f)), defaultFontFamily: "Mona Sans" },
  });
  return Buffer.from(r.render().asPng());
}
