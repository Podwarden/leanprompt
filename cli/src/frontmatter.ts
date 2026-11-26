import { parse } from "yaml";

export interface Section {
  heading: string;
  body: string;
}
export interface Doc {
  meta: Record<string, unknown>;
  sections: Section[];
}

/** Parse YAML frontmatter between leading `---` lines, then split the rest on level-2 headings. */
export function parseDoc(text: string): Doc {
  const src = text.replace(/\r\n/g, "\n");
  let meta: Record<string, unknown> = {};
  let rest = src;
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (m) {
    const parsed: unknown = parse(m[1]!);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
    rest = src.slice(m[0].length);
  }
  const sections: Section[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  let fence = false;
  for (const line of rest.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence ? /^##[ \t]+(.+?)[ \t]*$/.exec(line) : null;
    if (h) {
      if (cur) sections.push({ heading: cur.heading, body: cur.lines.join("\n").trim() });
      cur = { heading: h[1]!, lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) sections.push({ heading: cur.heading, body: cur.lines.join("\n").trim() });
  return { meta, sections };
}
