// News: the releases in docs/CHANGELOG.md, plus posts in site/news/*.md.
//
// A post is a Markdown file with frontmatter:
//   ---
//   title: A plain sentence
//   date: 2026-12-01
//   description: One or two sentences for search results and the news list.
//   ---
// Its URL is /leanprompt/news/<file name without .md>/. Files starting with "_" are skipped
// (site/news/_template.md). A release appears once its changelog heading carries a date
// ("## 0.1.0 – 2026-12-01"); "unreleased" sections stay on the changelog page only.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { plain, slug } from "./markdown.js";

export const NEWS_DIR = "site/news";

export interface Post {
  slug: string;
  title: string;
  date: string;
  description: string;
  body: string;
  file: string;
}

export interface Release {
  version: string;
  date: string;
  /** The heading's anchor on the changelog page. */
  anchor: string;
  summary: string;
}

const RELEASE = /^## (\S+)\s+[–-]\s+(\d{4}-\d{2}-\d{2})\s*$/;

export function loadReleases(changelog: string): Release[] {
  const lines = changelog.split("\n");
  const out: Release[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = RELEASE.exec(lines[i]!);
    if (!m) continue;
    let summary = "";
    for (let j = i + 1; j < lines.length && !lines[j]!.startsWith("## "); j++) {
      const l = lines[j]!.trim();
      if (l && !l.startsWith("#") && !l.startsWith("-")) {
        summary = plain(l);
        break;
      }
    }
    out.push({ version: m[1]!, date: m[2]!, anchor: slug(lines[i]!.slice(3)), summary });
  }
  return out;
}

export function loadPosts(root: string): Post[] {
  const dir = join(root, NEWS_DIR);
  if (!existsSync(dir)) return [];
  const out: Post[] = [];
  const problems: string[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".md") || f.startsWith("_")) continue;
    const file = `${NEWS_DIR}/${f}`;
    const text = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (!m) {
      problems.push(`${file}: needs frontmatter with title, date and description`);
      continue;
    }
    const meta = (parse(m[1]!) ?? {}) as Record<string, unknown>;
    const date = meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : String(meta.date ?? "");
    const bad: string[] = [];
    if (typeof meta.title !== "string" || !meta.title.trim()) bad.push("title");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad.push("date (YYYY-MM-DD)");
    if (typeof meta.description !== "string" || !meta.description.trim()) bad.push("description");
    if (bad.length) {
      problems.push(`${file}: missing or invalid ${bad.join(", ")}`);
      continue;
    }
    const s = f.slice(0, -3);
    if (!/^[a-z0-9-]+$/.test(s)) {
      problems.push(`${file}: the file name must be lower-case letters, digits and hyphens`);
      continue;
    }
    out.push({ slug: s, title: (meta.title as string).trim(), date, description: (meta.description as string).trim(), body: text.slice(m[0].length), file });
  }
  if (problems.length) throw new Error(`news:\n  ${problems.join("\n  ")}`);
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}
