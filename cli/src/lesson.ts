import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadRuleIds } from "./lint/rules.js";
import { loadProfile } from "./profile.js";
import { PACKAGE_ROOT } from "./score/write.js";

const REPO = "https://github.com/Podwarden/leanprompt";
export const LESSON_FILE = join(".leanprompt", "lesson.md");
const SCORE_FILE = join(".leanprompt", "score.json");
const CREDIT_PROJECT = "Credit (optional): project and link";

// The repo URL itself (and a path or query under it), never a lookalike such as `leanprompt-evil`.
const REPO_URL = /^https:\/\/github\.com\/Podwarden\/leanprompt(?:[/?#].*)?$/;
const URL_RE = /https?:\/\/[^\s)>\]"'`]+|\bwww\.[^\s)>\]"'`]+/gi;
const TLDS = "com|net|org|io|dev|app|ai|cloud|local|internal|lan|corp|home|h|co|me|xyz|info|biz";
const HOST_RE = new RegExp(`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b`, "gi");
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){5,7}\b/gi;
const KEY_PREFIX_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|vw[A-Za-z0-9_-]{16,})/g;
const LONG_RUN_RE = /[A-Za-z0-9+/=_-]{32,}/g;
const HEX_RUN_RE = /\b[0-9a-fA-F]{24,}\b/g;
const UNIX_PATH_RE = /(?:^|[\s("'`=:])(?:~|(?:\/[A-Za-z0-9._@+-]+){2,})(?:\/[A-Za-z0-9._@+-]+)*/g;
const WIN_PATH_RE = /\b[A-Za-z]:\\[^\s]+/g;
const SOURCE_PATH_RE = /\b[\w.@-]+(?:\/[\w.@-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|ya?ml|json|toml|env|sh|md)\b/g;

const mask = (s: string): string => `${s.trim().slice(0, 4)}...`;
const matches = (text: string, re: RegExp): string[] => text.match(re) ?? [];

/** Split a draft into the text of its "Credit (optional): project and link" section and the rest. */
function splitCredit(text: string): { rest: string; credit: string } {
  const lines = text.split("\n");
  const rest: string[] = [];
  const credit: string[] = [];
  let inCredit = false;
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) inCredit = l.replace(/^#+\s*/, "").trim() === CREDIT_PROJECT;
    (inCredit ? credit : rest).push(l);
  }
  return { rest: rest.join("\n"), credit: credit.join("\n") };
}

function scanPart(text: string, allowLinks: boolean): string[] {
  const found: string[] = [];
  let t = text;
  // URLs first, so a path or host inside a URL is reported once, as a URL.
  t = t.replace(URL_RE, (u) => {
    const bare = u.replace(/[.,;:]+$/, "");
    if (REPO_URL.test(bare) || allowLinks) return " ";
    found.push(`a link to somewhere other than this repo: ${bare.slice(0, 30)}${bare.length > 30 ? "..." : ""}`);
    return " ";
  });
  for (const m of matches(t, EMAIL_RE)) found.push(`an email address: ${mask(m)}`);
  t = t.replace(EMAIL_RE, " ");
  for (const m of matches(t, KEY_PREFIX_RE)) found.push(`something that looks like an API key: ${mask(m)}`);
  t = t.replace(KEY_PREFIX_RE, " ");
  for (const m of [...matches(t, HEX_RUN_RE), ...matches(t, LONG_RUN_RE)]) found.push(`a long random-looking string, possibly a key: ${mask(m)}`);
  t = t.replace(HEX_RUN_RE, " ").replace(LONG_RUN_RE, " ");
  for (const m of [...matches(t, IPV4_RE), ...matches(t, IPV6_RE)]) found.push(`an IP address: ${mask(m)}`);
  t = t.replace(IPV4_RE, " ").replace(IPV6_RE, " ");
  for (const m of [...matches(t, WIN_PATH_RE), ...matches(t, UNIX_PATH_RE)]) found.push(`a file path: ${mask(m)}`);
  t = t.replace(WIN_PATH_RE, " ").replace(UNIX_PATH_RE, " ");
  for (const m of matches(t, SOURCE_PATH_RE)) found.push(`a file path: ${mask(m)}`);
  t = t.replace(SOURCE_PATH_RE, " ");
  for (const m of matches(t, HOST_RE)) found.push(`a host name: ${mask(m)}`);
  return found;
}

/**
 * What must be removed before a lesson is shared: keys, emails, IP addresses, host names, links other than this
 * repo's, and file paths. The repo URL, rule ids and E-row citations pass. A link is allowed only in the
 * "Credit (optional): project and link" section, where the contributor puts it on purpose. Matches are masked
 * to their first characters, so a key is never printed in full.
 */
export function scanLesson(text: string): { blocked: string[] } {
  const { rest, credit } = splitCredit(text);
  return { blocked: [...scanPart(rest, false), ...scanPart(credit, true)] };
}

interface ScoreView {
  kind?: string;
  score?: number;
  E?: number;
  S?: number;
  G?: number;
}

/** The fields of a score.json this command copies. Null when absent; throws naming the file when unreadable. */
function readScore(file: string): ScoreView | null {
  if (!existsSync(file)) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error(`${file}: must be an object`);
  const inp = (d.inputs ?? {}) as Record<string, unknown>;
  const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  return {
    kind: d.kind === "measured" || d.kind === "static" ? d.kind : undefined,
    score: num(d.score),
    E: num(inp.E),
    S: num(inp.S),
    G: num(inp.G),
  };
}

const cell = (v: number | string | undefined, digits?: number): string =>
  v === undefined ? "" : typeof v === "number" ? (digits === undefined ? String(v) : v.toFixed(digits)) : v;

function buildDraft(rule: string, target: string, before: ScoreView | null, after: ScoreView | null): string {
  const row = (label: string, pick: (s: ScoreView) => number | string | undefined, digits?: number): string =>
    `| ${label} | ${before ? cell(pick(before), digits) : ""} | ${after ? cell(pick(after), digits) : ""} |`;
  return `<!-- Draft written by leanprompt on this machine. Nothing has been sent. Read every line, edit it freely, and delete this note. Describe the case in general terms: no code, keys, hostnames, file paths, customer or company names. A maintainer reads every submission before it informs a rule, and it is shared under CC BY 4.0. -->

# Lesson learned

Rule id: ${rule}
Provider or engine: ${target}

## Before and after

| | Before | After |
|---|---|---|
${row("Score kind", (s) => s.kind)}
${row("Score", (s) => s.score)}
${row("E", (s) => s.E, 2)}
${row("S", (s) => s.S, 2)}
${row("G", (s) => s.G, 2)}

## What changed

## Edge case (in general terms)

## Credit (optional): name

## ${CREDIT_PROJECT}
`;
}

/** The prefilled "new issue" link: template, title and labels only. The body is pasted by the user, never put in a URL. */
function issueUrl(rule: string): string {
  const q = [
    ["template", "lesson-learned.yml"],
    ["title", rule ? `Lesson learned: ${rule}` : "Lesson learned: "],
    ["labels", "lesson-learned"],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return `${REPO}/issues/new?${q}`;
}

/** The rule id a written draft names, for the issue title. */
const ruleOf = (text: string): string => /^Rule id:[ \t]*(LP-[A-Z]{2}-\d{2})\b/m.exec(text)?.[1] ?? "";

/**
 * `leanprompt lesson [--rule <id>] [--before <older score.json>] [--dir <project>]`.
 * Writes a draft to `.leanprompt/lesson.md` for the user to edit, scans it, and prints a prefilled
 * GitHub issue link once it is clean. An existing draft is checked, not overwritten. Sends nothing.
 */
export async function lessonCommand(args: string[]): Promise<number> {
  let values: { rule?: string; before?: string; dir?: string };
  try {
    values = parseArgs({ args, options: { rule: { type: "string" }, before: { type: "string" }, dir: { type: "string" } }, strict: true }).values;
  } catch (e) {
    process.stderr.write(`leanprompt: ${(e as Error).message}\n`);
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  const file = join(dir, LESSON_FILE);

  if (values.rule !== undefined && !loadRuleIds(PACKAGE_ROOT).has(values.rule)) {
    process.stderr.write(`leanprompt: unknown rule id ${values.rule}\n`);
    return 2;
  }

  let text: string;
  if (existsSync(file)) {
    text = readFileSync(file, "utf8");
    process.stdout.write(`leanprompt lesson: checking your existing draft ${file} (not overwritten; delete it to start again)\n`);
  } else {
    const profile = loadProfile(dir);
    const target = profile?.target.engine ?? profile?.target.provider ?? "";
    const after = readScore(join(dir, SCORE_FILE));
    const before = values.before === undefined ? null : readScore(resolve(values.before));
    if (values.before !== undefined && before === null) throw new Error(`${resolve(values.before)}: no such file`);
    text = buildDraft(values.rule ?? "", target, before, after);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    process.stdout.write(`leanprompt lesson: wrote a draft to ${file}\n`);
  }

  const { blocked } = scanLesson(text);
  if (blocked.length > 0) {
    process.stderr.write(`leanprompt lesson: remove these from ${file} before sharing, then run this command again:\n`);
    for (const b of blocked) process.stderr.write(`  - ${b}\n`);
    return 1;
  }
  process.stdout.write(
    [
      "Read the draft and fill in the empty sections, then run this command again to check it.",
      "To share it, open this link, then paste the text of the draft into the form. You open the issue yourself; leanprompt sends nothing, and the link carries no text from the draft:",
      issueUrl(values.rule ?? ruleOf(text)),
      "",
    ].join("\n"),
  );
  return 0;
}
