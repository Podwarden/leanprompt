import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXTERNAL, PRIVATE_HEADER, type Finding, type Note, type ParsedFindings } from "../score/static.js";

/** The local file that lists private items. It is never read by any public output. */
export const PRIVATE_FILE = join(".leanprompt", "private.md");

const where = (x: { file: string; line: number }): string => (x.file === EXTERNAL ? "outside the repository" : x.line > 0 ? `${x.file}:${x.line}` : x.file);
const one = (s: string): string => s.replace(/\s*\n\s*/g, " ");

/**
 * The text of `.leanprompt/private.md`: the security, privacy and legal items marked `private: true`, with a header
 * that says not to publish them. Null when there are none.
 */
export function renderPrivateList(priv: { findings: Finding[]; notes: Note[] } | undefined): string | null {
  if (!priv || priv.findings.length + priv.notes.length === 0) return null;
  const out = [
    `# ${PRIVATE_HEADER}`,
    "",
    "These items from `.leanprompt/findings.json` are marked `private: true` (security, privacy or legal). leanprompt leaves them out of the score, the page, the Markdown report, the hand-off block, GitHub annotations and the website. Report them privately, through the project's security contact, not in a public issue. Keep this file out of git.",
    "",
  ];
  for (const f of priv.findings) {
    out.push(`## ${f.rule} at ${where(f)}`, "");
    for (const [k, v] of [["Problem", f.problem], ["What to change", f.change], ["Why it matters", f.why], ["Estimate", f.estimate], ["How to check the fix", f.verify]] as const) if (v) out.push(`- **${k}:** ${one(v)}`);
    out.push("");
  }
  for (const n of priv.notes) {
    out.push(`## ${one(n.title)} (${where(n)})`, "");
    if (n.rule) out.push(`- **Rule:** ${n.rule}${n.severity ? `, severity ${n.severity}` : ""}`);
    for (const [k, v] of [["Problem", n.problem], ["What to change", n.change], ["Why it matters", n.why], ["How to check the fix", n.verify]] as const) if (v) out.push(`- **${k}:** ${one(v)}`);
    out.push("");
  }
  return out.join("\n");
}

/** Write `.leanprompt/private.md` under `dir` when the findings file has private items; the path written, or null. */
export function writePrivateList(dir: string, parsed: Pick<ParsedFindings, "private">): string | null {
  const text = renderPrivateList(parsed.private);
  if (text === null) return null;
  const target = join(dir, PRIVATE_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  // `.leanprompt/` is often committed (score.json feeds the badge): keep the private list out of git.
  const ignore = join(dirname(target), ".gitignore");
  const lines = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  if (!lines.split(/\r?\n/).includes("private.md")) writeFileSync(ignore, `${lines}${lines && !lines.endsWith("\n") ? "\n" : ""}private.md\n`);
  return target;
}
