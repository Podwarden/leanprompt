// The mechanism diagram of an audit: a small left-to-right flow of 3 or 4 labelled steps, with the one step
// where the mistake happens marked in the accent colour and a short label saying what goes wrong. One
// template per kind (KINDS in audits.ts); each audit fills it with the strings of its meta.yaml
// `diagram:` block, which are read from that audit's findings.
//
// Drawn as inline SVG, no images and no script. Every colour is a CSS custom property of the site's
// light and dark themes, set by the classes in site.css (`dg-*`); the markup holds no colour value.
// Three layouts go in one figure: a wide row of boxes (960 units across), two columns (440) and a
// tall column (320). CSS shows one by the width of the figure itself (a container query), so a
// card or a phone gets a narrower layout and never a scaled-down row.

import type { AuditMeta, Kind } from "./audits.js";
import { escapeHtml as e } from "./markdown.js";

export interface Step {
  /** The fixed role of the step, shown small above its text: "Request", "Provider cache". */
  cap: string;
  text: string;
  wrong?: boolean;
  /** A short "x N" tag on the step, for a step that happens again. */
  repeat?: string;
}

type D = Record<string, string>;

/** The steps of each kind's template, filled from the audit's diagram strings. */
const TEMPLATES: Record<Kind, (d: D, appName: string) => Step[]> = {
  "Cut-off answer": (d, app) => [
    { cap: "App", text: d.app ?? app },
    { cap: "Request", text: `Output limit: ${d.cap}` },
    { cap: "Reply", text: "Cut off at the limit" },
    { cap: "Then", text: d.then!, wrong: true, ...(d.repeat ? { repeat: d.repeat } : {}) },
  ],
  "Retry loop": (d, app) => [
    { cap: "App", text: d.app ?? app },
    { cap: "Request", text: d.request! },
    { cap: "Reply", text: d.reply! },
    { cap: "Then", text: d.then!, wrong: true, ...(d.repeat ? { repeat: d.repeat } : {}) },
  ],
  "Cache never hits": (d, app) => [
    { cap: "App", text: d.app ?? app },
    { cap: "Prompt", text: d.prompt! },
    { cap: "Provider cache", text: d.cache!, wrong: true },
    { cap: "You pay", text: d.bill! },
  ],
  "Blind spend meter": (d, app) => [
    { cap: "App", text: d.app ?? app },
    { cap: "Call", text: d.call! },
    { cap: "Usage reported", text: d.reports! },
    { cap: "Meter", text: d.meter!, wrong: true },
  ],
  "Setting that does nothing": (d) => [
    { cap: "Setting", text: d.setting! },
    { cap: "Request", text: d.request!, wrong: true },
    { cap: "Result", text: d.result! },
  ],
  "Runs again every night": (d) => [
    { cap: "Scheduled job", text: d.job! },
    { cap: "Input", text: d.input! },
    { cap: "Model calls", text: d.call!, wrong: true },
  ],
  "Wrong text summarised": (d, app) => [
    { cap: "Source text", text: d.source! },
    { cap: "Cut to", text: d.cut!, wrong: true },
    { cap: "Model asked for", text: d.asked! },
    { cap: "Result", text: d.result! },
  ],
  "Retired model": (d, app) => [
    { cap: "App", text: d.app ?? app },
    { cap: "Asks for", text: d.model! },
    { cap: "Provider", text: d.provider!, wrong: true },
    { cap: "Result", text: d.result! },
  ],
  "Oversized prompt": (d) => [
    { cap: "Small ask", text: d.ask! },
    { cap: "Prompt carries", text: d.attached!, wrong: true },
    { cap: "You pay", text: d.paid! },
  ],
};

export interface Diagram {
  kind: Kind;
  steps: Step[];
  wrong: string;
  /** The sentence for aria-label: the mechanism in words. */
  sentence: string;
}

/** The diagram of an audit, or undefined when its meta.yaml has no `diagram:` block (or no kind). */
export function diagramOf(meta: AuditMeta): Diagram | undefined {
  if (!meta.diagram || !meta.kind) return undefined;
  const d = meta.diagram;
  const steps = TEMPLATES[meta.kind](d, meta.name);
  const bad = steps.find((s) => s.wrong)!;
  const flow = steps.map((s) => `${s.cap}: ${s.text}${s.repeat ? ` (${s.repeat})` : ""}`).join("; then ");
  const sentence = `Diagram of the mistake, ${meta.kind.toLowerCase()}. ${flow}. It goes wrong at the step "${bad.cap}": ${d.wrong}.`;
  return { kind: meta.kind, steps, wrong: d.wrong!, sentence };
}

// --- Drawing ---------------------------------------------------------------------------------

const FONT = { cap: 13, text: 16, tab: 15 };
/** Average glyph width as a fraction of the font size, with some room to spare so a line never overruns its box. */
const GLYPH = 0.56;
const LINE = 21;

/** Greedy word wrap by character count. */
export function wrapChars(text: string, max: number): string[] {
  // A word longer than a line (a model id) may break after a hyphen, slash, dot or underscore.
  const words = text.split(/\s+/).filter(Boolean).flatMap((w) => (w.length <= max ? [w] : (w.match(/[^-/._]+[-/._]?/g) ?? [w])));
  const lines: string[] = [];
  let cur = "";
  let glue = true;
  words.forEach((w, i) => {
    const joined = glue ? " " : "";
    const t = cur ? `${cur}${joined}${w}` : w;
    if (t.length <= max || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
    // Pieces of one broken word rejoin without a space.
    glue = !/[-/._]$/.test(w) || !words[i + 1];
  });
  if (cur) lines.push(cur);
  return lines;
}

const perLine = (boxW: number, size: number) => Math.max(8, Math.floor((boxW - 28) / (size * GLYPH)));
const num = (n: number) => String(Math.round(n * 10) / 10);

interface Placed {
  step: Step;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

function boxSvg(p: Placed): string {
  const { step, x, y, w, h, lines } = p;
  const cls = step.wrong ? "dg-box dg-bad" : "dg-box";
  let out = "";
  if (step.repeat) {
    // Two outlines behind the box: the step happens again.
    out += `<rect class="dg-ghost" x="${num(x + 12)}" y="${num(y + 12)}" width="${num(w)}" height="${num(h)}" rx="6"/><rect class="dg-ghost" x="${num(x + 6)}" y="${num(y + 6)}" width="${num(w)}" height="${num(h)}" rx="6"/>`;
  }
  out += `<rect class="${cls}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="6"/>`;
  out += `<text class="dg-cap${step.wrong ? " dg-cap-bad" : ""}" x="${num(x + 14)}" y="${num(y + 24)}">${e(step.cap.toUpperCase())}</text>`;
  out += `<text class="dg-val" x="${num(x + 14)}" y="${num(y + 24 + 8 + LINE - 4)}">${lines.map((l, i) => `<tspan x="${num(x + 14)}" dy="${i === 0 ? 0 : LINE}">${e(l)}</tspan>`).join("")}</text>`;
  if (step.repeat) {
    const tw = step.repeat.length * 8.6 + 20;
    out += `<rect class="dg-pill" x="${num(x + w - tw - 10)}" y="${num(y - 12)}" width="${num(tw)}" height="24" rx="12"/><text class="dg-pill-t" x="${num(x + w - 10 - tw / 2)}" y="${num(y + 4.5)}" text-anchor="middle">${e(step.repeat)}</text>`;
  }
  return out;
}

/** The tab under the wrong step: a triangle pointing up at it and the label in a filled strip. */
function tabSvg(label: string, boxX: number, boxW: number, boxBottom: number, tabW: number, minX: number, maxX: number): { svg: string; bottom: number } {
  const lines = wrapChars(label, perLine(tabW, FONT.tab));
  const tabH = 16 + lines.length * 20;
  const x = Math.min(Math.max(boxX + boxW / 2 - tabW / 2, minX), maxX - tabW);
  const y = boxBottom + 18;
  const cx = Math.min(Math.max(boxX + boxW / 2, x + 22), x + tabW - 22);
  const svg =
    `<path class="dg-tab" d="M${num(cx - 8)} ${num(y)} L${num(cx)} ${num(y - 9)} L${num(cx + 8)} ${num(y)} Z"/>` +
    `<rect class="dg-tab" x="${num(x)}" y="${num(y)}" width="${num(tabW)}" height="${num(tabH)}" rx="6"/>` +
    `<text class="dg-tab-t" x="${num(x + 14)}" y="${num(y + 24)}">${lines.map((l, i) => `<tspan x="${num(x + 14)}" dy="${i === 0 ? 0 : 20}">${e(l)}</tspan>`).join("")}</text>`;
  return { svg, bottom: y + tabH };
}

const arrowRight = (x1: number, x2: number, y: number) => `<path class="dg-arrow" d="M${num(x1)} ${num(y)} H${num(x2 - 7)}"/><path class="dg-head" d="M${num(x2)} ${num(y)} l-9 -6 v12 Z"/>`;
const arrowDown = (x: number, y1: number, y2: number) => `<path class="dg-arrow" d="M${num(x)} ${num(y1)} V${num(y2 - 7)}"/><path class="dg-head" d="M${num(x)} ${num(y2)} l-6 -9 h12 Z"/>`;

function svgOpen(cls: string, w: number, h: number, sentence: string, title: string): string {
  return `<svg class="${cls}" viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w)}" height="${num(h)}" role="img" aria-label="${e(sentence)}"><title>${e(title)}</title>`;
}

/**
 * One layout: the steps in rows of `cols` boxes, an arrow from each step to the next (an elbow from the
 * end of a row to the start of the next), and the tab under the row of the wrong step. `wide` is one row,
 * `mid` two columns, `tall` one column.
 */
function flow(d: Diagram, cls: string, W: number, cols: number, hgap: number, tabWidth: (boxW: number) => number): string {
  const PAD = 2;
  const VGAP = 30;
  const bw = (W - 2 * PAD - (cols - 1) * hgap) / cols;
  const rows: Step[][] = [];
  for (let i = 0; i < d.steps.length; i += cols) rows.push(d.steps.slice(i, i + cols));
  let y = 16;
  let prev: { cx: number; bottom: number } | undefined;
  let out = "";
  for (const row of rows) {
    const wrapped = row.map((s) => wrapChars(s.text, perLine(bw, FONT.text)));
    const h = 24 + 8 + Math.max(...wrapped.map((l) => l.length)) * LINE + 12;
    const placed: Placed[] = row.map((step, i) => ({ step, x: PAD + i * (bw + hgap), y, w: bw, h, lines: wrapped[i]! }));
    if (prev) {
      const first = placed[0]!;
      const cx = first.x + bw / 2;
      const y1 = prev.bottom + 2;
      const y2 = y - 2;
      out += prev.cx === cx ? arrowDown(cx, y1, y2) : `<path class="dg-arrow" d="M${num(prev.cx)} ${num(y1)} V${num((y1 + y2) / 2)} H${num(cx)} V${num(y2 - 7)}"/><path class="dg-head" d="M${num(cx)} ${num(y2)} l-6 -9 h12 Z"/>`;
    }
    placed.forEach((p, i) => {
      if (i > 0) out += arrowRight(p.x - hgap + 8, p.x - 6, y + h / 2);
      out += boxSvg(p);
    });
    let bottom = y + h;
    const wp = placed.find((p) => p.step.wrong);
    if (wp) {
      // The ghost outlines of a repeated step reach 12 units past its box (the figure lets them overflow).
      const tab = tabSvg(d.wrong, wp.x, wp.w, bottom + (wp.step.repeat ? 12 : 0), tabWidth(bw), PAD, W - PAD);
      out += tab.svg;
      bottom = tab.bottom;
    } else if (row.some((s) => s.repeat)) bottom += 12;
    const last = placed[placed.length - 1]!;
    prev = { cx: last.x + bw / 2, bottom };
    y = bottom + VGAP;
  }
  return svgOpen(cls, W, y - VGAP + PAD, d.sentence, `The mistake: ${d.kind}`) + out + "</svg>";
}

const wide = (d: Diagram) => flow(d, "dg-wide", 960, d.steps.length, 44, (bw) => Math.min(956, Math.max(bw + 160, 460)));
const mid = (d: Diagram) => flow(d, "dg-mid", 440, 2, 36, () => 436);
const tall = (d: Diagram) => flow(d, "dg-tall", 320, 1, 0, (bw) => bw);

/** The figure for an audit's page or card; "" when the audit has no diagram. */
export function renderDiagram(meta: AuditMeta): string {
  const d = diagramOf(meta);
  if (!d) return "";
  return `<figure class="dg">${wide(d)}${mid(d)}${tall(d)}</figure>`;
}
