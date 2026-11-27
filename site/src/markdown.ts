// Markdown from this repository (docs, rules, the changelog, news posts) to HTML for the site.
//
// One renderer for every page, so a link written for GitHub ("../skills/x/rules/LP-PC-03.md")
// lands on the site's own page for it (paths.ts::siteHref), headings get the ids GitHub gives
// them (so "how-it-works.md#prove-it-measure-change-measure" still works), and nothing loads
// from another host: an image whose source is not on this site becomes a plain link.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Marked, type Tokens } from "marked";
import { siteHref } from "./paths.js";

export const escapeHtml = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** The sentence the docs end their first paragraph with on GitHub; on the site the header does that job. */
const BACK_LINK = /\s*Back to the \[(README|docs)\]\((\.\.\/)?README\.md\)\.?/g;

export interface Rendered {
  /** The first level-1 heading's text, or "" (it is not part of `html`). */
  title: string;
  /** The first paragraph as plain text, for the meta description. */
  lede: string;
  html: string;
}

/**
 * Render Markdown written at `from` (a path from the repo root). The first `# heading` is taken out
 * and returned as `title`; the page template prints it as the page's h1. With `keepTitle` the
 * Markdown is rendered whole (a rule file or news post has no "# heading" of its own).
 */
export function renderMarkdown(src: string, from: string, root: string, opts: { keepTitle?: boolean } = {}): Rendered {
  const isDir = (p: string) => {
    const abs = join(root, p);
    return existsSync(abs) && statSync(abs).isDirectory();
  };
  const ids = new Map<string, number>();
  let title = "";
  let lede = "";
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens);
        let id = slug(inner);
        const n = ids.get(id) ?? 0;
        ids.set(id, n + 1);
        if (n > 0) id = `${id}-${n}`;
        return `<h${t.depth} id="${escapeHtml(id)}">${inner}</h${t.depth}>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Link) {
        const href = siteHref(from, t.href, isDir);
        const ext = /^https?:/i.test(href) ? ' rel="noopener"' : "";
        const ttl = t.title ? ` title="${escapeHtml(t.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${ttl}${ext}>${this.parser.parseInline(t.tokens)}</a>`;
      },
      image(t: Tokens.Image) {
        // Nothing on the site loads from another host: an image becomes a link to where it is.
        const href = siteHref(from, t.href, isDir);
        return `<a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(t.text || href)}</a>`;
      },
      html(t: Tokens.HTML | Tokens.Tag) {
        // The repository's Markdown holds HTML only as comments (pending markers); drop them, escape the rest.
        return /^\s*<!--[\s\S]*-->\s*$/.test(t.text) ? "" : escapeHtml(t.text);
      },
      table(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td") =>
          `<${tag}${c.align ? ` class="a-${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${t.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const body = t.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("\n");
        return `<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  const tokens = md.lexer(src.replace(BACK_LINK, ""));
  if (!opts.keepTitle) {
    const i = tokens.findIndex((t) => t.type === "heading" && (t as Tokens.Heading).depth === 1);
    if (i >= 0) {
      title = (tokens[i] as Tokens.Heading).text;
      tokens.splice(i, 1);
    }
  }
  const para = tokens.find((t) => t.type === "paragraph") as Tokens.Paragraph | undefined;
  if (para) lede = plain(para.text);
  const html = md.parser(tokens);
  return { title: plain(title), lede, html };
}

/** Markdown inline text to plain text: links keep their words, code its letters, emphasis goes. */
export function plain(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** A description of at most `max` characters, cut at a word. */
export function clip(s: string, max = 155): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}
