import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_MODES } from "../facts.js";
import { parseDoc } from "../frontmatter.js";
import { isMain } from "../isMain.js";
import { posix, type LintIssue } from "./rules.js";

export const STALE_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function asDate(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "string" && DATE_RE.test(v) ? v : undefined;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Lint providers/*.md, models/*.md and runtimes/*.md: dated, sourced, and (providers) a well-formed cache block;
 * (runtimes) a source URL on every table row.
 */
export function lintFacts(root: string, today: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const tables: { file: string; kind: "provider" | "model" | "runtime" }[] = [];
  for (const [dir, kind] of [["providers", "provider"], ["models", "model"], ["runtimes", "runtime"]] as const) {
    const p = join(root, dir);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).sort()) if (f.endsWith(".md")) tables.push({ file: posix(join(dir, f)), kind });
  }

  for (const { file, kind } of tables) {
    const err = (msg: string) => issues.push({ file, level: "error", msg });
    let doc;
    try {
      doc = parseDoc(readFileSync(join(root, file), "utf8"));
    } catch (e) {
      err(`bad frontmatter: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    const { meta } = doc;
    const nameKey = kind === "provider" ? "provider" : kind === "model" ? "family" : "runtime";
    if (typeof meta[nameKey] !== "string" || !meta[nameKey]) err(`missing field: ${nameKey}`);

    if (typeof meta.source !== "string" || !/^https?:\/\/\S+$/.test(meta.source)) err("missing source (a URL)");

    const checked = asDate(meta.checked);
    if (!checked) err("missing or bad checked date (YYYY-MM-DD)");
    else {
      const age = Math.floor((Date.parse(today) - Date.parse(checked)) / DAY_MS);
      if (age < 0) err(`checked date ${checked} is after ${today}`);
      else if (age > STALE_DAYS) issues.push({ file, level: "warn", msg: `checked ${checked} is ${age} days old (limit ${STALE_DAYS})` });
    }

    if (doc.sections.length === 0) err("empty body: no fact table sections");

    if (kind === "runtime") {
      const text = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
      const rows = rowsWithoutSource(text);
      if (rows.total === 0) err("no table rows");
      for (const r of rows.missing) err(`table row without a source URL: ${r}`);
    }

    if (kind === "provider") {
      const c = meta.cache as Record<string, unknown> | undefined;
      if (!c || typeof c !== "object") {
        err("missing cache block");
        continue;
      }
      if (!CACHE_MODES.includes(c.mode as never)) err(`bad cache.mode ${String(c.mode)}`);
      if (!isNum(c.min_tokens)) err("cache.min_tokens must be a number");
      if (!isNum(c.ttl_seconds)) err("cache.ttl_seconds must be a number");
      for (const k of ["step_tokens", "block_tokens", "max_breakpoints"]) {
        if (c[k] !== undefined && !isNum(c[k])) err(`cache.${k} must be a number`);
      }
      if (c.drops_last_block !== undefined && typeof c.drops_last_block !== "boolean") err("cache.drops_last_block must be a boolean");
      if (c.mode === "block" && c.block_tokens === undefined) err("cache.block_tokens required for mode block");
      if (c.mode === "breakpoints" && c.max_breakpoints === undefined) err("cache.max_breakpoints required for mode breakpoints");
    }
  }
  issues.push(...lintAssistantPaths(root, today));
  return issues;
}

const PATHS_FILE = "docs/assistant-paths.md";

/** Lint docs/assistant-paths.md: dated, a `paths:` map, and a source URL on every table row. Skipped when the file is absent. */
function lintAssistantPaths(root: string, today: string): LintIssue[] {
  const file = PATHS_FILE;
  const full = join(root, file);
  if (!existsSync(full)) return [];
  const issues: LintIssue[] = [];
  const err = (msg: string) => issues.push({ file, level: "error", msg });
  const text = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
  let doc;
  try {
    doc = parseDoc(text);
  } catch (e) {
    err(`bad frontmatter: ${(e as Error).message.split("\n")[0]}`);
    return issues;
  }
  const checked = asDate(doc.meta.checked);
  if (!checked) err("missing or bad checked date (YYYY-MM-DD)");
  else {
    const age = Math.floor((Date.parse(today) - Date.parse(checked)) / DAY_MS);
    if (age < 0) err(`checked date ${checked} is after ${today}`);
    else if (age > STALE_DAYS) issues.push({ file, level: "warn", msg: `checked ${checked} is ${age} days old (limit ${STALE_DAYS})` });
  }
  const paths = doc.meta.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths) || Object.keys(paths).length === 0) err("missing paths map");
  if (doc.sections.length === 0) err("empty body: no assistant sections");

  const rows = rowsWithoutSource(text);
  for (const r of rows.missing) err(`table row without a source URL: ${r}`);
  if (rows.total === 0) err("no table rows");
  return issues;
}

/** Every table row (not the header, not the separator) needs an http(s) URL as its source. */
function rowsWithoutSource(text: string): { total: number; missing: string[] } {
  const lines = text.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "").split("\n");
  let total = 0;
  const missing: string[] = [];
  lines.forEach((line, i) => {
    if (!line.trimStart().startsWith("|")) return;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return; // separator
    if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) return; // header
    total++;
    if (!/https?:\/\/\S+/.test(line)) missing.push(line.trim().slice(0, 60));
  });
  return { total, missing };
}

// CLI entry for `npm run lint:facts`: lint the repo root, exit 1 on errors, print warnings.
if (isMain(import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const issues = lintFacts(root, new Date().toISOString().slice(0, 10));
  for (const i of issues) process.stderr.write(`${i.level}: ${i.file}: ${i.msg}\n`);
  const errors = issues.filter((i) => i.level === "error").length;
  process.stdout.write(`lint:facts: ${errors} error(s), ${issues.length - errors} warning(s)\n`);
  process.exit(errors ? 1 : 0);
}
