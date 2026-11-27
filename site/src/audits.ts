// Published audits: site/audits/<owner>__<repo>/{meta.yaml, findings.json}.
//
// Rules the build enforces, so that an audit page is fair to the project it is about:
// - only a PUBLIC repository on github.com is published (meta.yaml `repo` and `visibility: public`);
// - the page names the commit audited, the leanprompt version and the date;
// - every figure is labelled as an estimate from reading the code, never a measurement;
// - the title is neutral ("Where <repo> could save tokens");
// - the maintainer's issue, pull request and response are linked when there is one;
// - every page carries the corrections and takedown line.
// A folder whose name starts with "_" (the template) is skipped, and so is an audit whose status
// is `draft` or `withdrawn`. Any other problem fails the build with the folder and the reason.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseFindings, type AverageCall, type Finding, type KvsigUse, type Note } from "../../cli/src/score/static.js";

export const AUDITS_DIR = "site/audits";

export const STATUSES = ["demo", "notified", "published", "acknowledged", "fixed", "disputed", "draft", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];
const UNPUBLISHED: ReadonlySet<Status> = new Set(["draft", "withdrawn"]);

/** What each status means, as the page says it. */
export const STATUS_TEXT: Record<Status, string> = {
  demo: "Demonstration: an audit of leanprompt’s own example app.",
  notified: "The maintainers have been told about this audit; no response yet.",
  published: "Published.",
  acknowledged: "The maintainers have acknowledged the findings.",
  fixed: "The maintainers have changed the code since this audit.",
  disputed: "The maintainers dispute some or all of the findings; their response is below.",
  draft: "Draft.",
  withdrawn: "Withdrawn.",
};

export interface AuditMeta {
  repo: string;
  owner: string;
  name: string;
  visibility: "public";
  commit: string;
  leanprompt: string;
  date: string;
  status: Status;
  /** A subfolder of the repository the audit covered, if not all of it. */
  path?: string;
  summary?: string;
  maintainer?: { issue?: string; pr?: string; response?: string; response_date?: string };
}

export interface Audit {
  /** The page key: the folder name in lower case. */
  slug: string;
  /** The folder under site/audits/ as it is in the repository (GitHub paths are case-sensitive). */
  folder: string;
  meta: AuditMeta;
  findings: Finding[];
  average_call?: AverageCall;
  kvsig?: KvsigUse;
  /** Verified problems outside the rules: shown after the findings, never scored. */
  notes?: Note[];
}

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
const GITHUB_LINK = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/(issues|pull|discussions)\/\d+(#[\w-]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** Validate one audit's meta.yaml text. Returns the errors (empty when fine) and the meta. */
export function validateMeta(text: string, slug: string): { meta?: AuditMeta; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    return { errors: [`meta.yaml is not valid YAML: ${(err as Error).message}`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["meta.yaml must be a mapping"] };
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string).trim() : typeof m[k] === "number" ? String(m[k]) : undefined);
  // YAML reads an unquoted 2026-11-26 as a Date.
  const dateOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.trim() : undefined);

  const repo = str("repo");
  const gh = repo ? GITHUB_REPO.exec(repo) : null;
  if (!repo) errors.push("repo is required: the public github.com URL of the repository audited");
  else if (!gh) errors.push(`repo must be a public repository URL of the form https://github.com/<owner>/<repo>, not ${repo}`);
  if (m.visibility !== "public") errors.push("visibility: public is required; only audits of public repositories are published");
  if (gh && slug.toLowerCase() !== `${gh[1]}__${gh[2]}`.toLowerCase()) errors.push(`the folder must be named ${gh[1]}__${gh[2]} (lower case is fine), not ${slug}`);
  const commit = str("commit");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) errors.push("commit must be the full 40-character SHA of the commit audited");
  const version = str("leanprompt");
  if (!version || !VERSION.test(version)) errors.push("leanprompt must be the version that ran the audit, for example 0.1.0");
  const date = dateOf(m.date);
  if (!date || !DATE.test(date)) errors.push("date must be the day the audit ran, YYYY-MM-DD");
  const status = str("status") as Status | undefined;
  if (!status || !STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);
  const path = str("path");
  if (path !== undefined && (path.startsWith("/") || path.split("/").includes(".."))) errors.push("path must be a folder inside the repository");
  const summary = str("summary");
  if (summary !== undefined && summary.length > 400) errors.push("summary must be at most 400 characters");

  let maintainer: AuditMeta["maintainer"];
  if (m.maintainer !== undefined && m.maintainer !== null) {
    if (typeof m.maintainer !== "object" || Array.isArray(m.maintainer)) errors.push("maintainer must be a mapping");
    else {
      const mm = m.maintainer as Record<string, unknown>;
      maintainer = {};
      for (const k of ["issue", "pr"] as const) {
        if (mm[k] === undefined || mm[k] === null) continue;
        if (typeof mm[k] !== "string" || !GITHUB_LINK.test(mm[k] as string)) errors.push(`maintainer.${k} must be a github.com issue, pull request or discussion URL`);
        else maintainer[k] = mm[k] as string;
      }
      if (typeof mm.response === "string" && mm.response.trim()) maintainer.response = mm.response.trim();
      const rd = dateOf(mm.response_date);
      if (rd !== undefined) {
        if (!DATE.test(rd)) errors.push("maintainer.response_date must be YYYY-MM-DD");
        else maintainer.response_date = rd;
      }
      if (maintainer.response && !maintainer.response_date) errors.push("maintainer.response needs maintainer.response_date");
      const extra = Object.keys(mm).filter((k) => !["issue", "pr", "response", "response_date"].includes(k));
      if (extra.length) errors.push(`maintainer: unknown keys ${extra.join(", ")}`);
    }
  }
  if (status === "disputed" && !maintainer?.response) errors.push("a disputed audit must quote the maintainer's response");
  if (status && ["notified", "acknowledged", "fixed", "disputed"].includes(status) && !maintainer?.issue && !maintainer?.pr)
    errors.push(`status ${status} needs maintainer.issue or maintainer.pr: link where the maintainers were told`);
  const known = ["repo", "visibility", "commit", "leanprompt", "date", "status", "path", "summary", "maintainer"];
  const unknown = Object.keys(m).filter((k) => !known.includes(k));
  if (unknown.length) errors.push(`unknown keys ${unknown.join(", ")}`);
  if (errors.length) return { errors };
  return {
    errors,
    meta: {
      repo: repo!,
      owner: gh![1]!,
      name: gh![2]!,
      visibility: "public",
      commit: commit!,
      leanprompt: version!,
      date: date!,
      status: status!,
      ...(path ? { path: path.replace(/\/+$/, "") } : {}),
      ...(summary ? { summary } : {}),
      ...(maintainer && Object.keys(maintainer).length ? { maintainer } : {}),
    },
  };
}

/** Every publishable audit under site/audits, newest first. Throws with every problem found. */
export function loadAudits(root: string, ruleIds: ReadonlySet<string>): Audit[] {
  const dir = join(root, AUDITS_DIR);
  if (!existsSync(dir)) return [];
  const out: Audit[] = [];
  const problems: string[] = [];
  for (const slug of readdirSync(dir).sort()) {
    if (slug.startsWith("_") || slug.startsWith(".") || !statSync(join(dir, slug)).isDirectory()) continue;
    const at = `${AUDITS_DIR}/${slug}`;
    const metaFile = join(dir, slug, "meta.yaml");
    const findingsFile = join(dir, slug, "findings.json");
    if (!existsSync(metaFile)) {
      problems.push(`${at}: meta.yaml is missing`);
      continue;
    }
    const { meta, errors } = validateMeta(readFileSync(metaFile, "utf8"), slug);
    if (errors.length || !meta) {
      problems.push(...errors.map((x) => `${at}/meta.yaml: ${x}`));
      continue;
    }
    if (UNPUBLISHED.has(meta.status)) continue;
    if (!existsSync(findingsFile)) {
      problems.push(`${at}: findings.json is missing`);
      continue;
    }
    const parsed = parseFindings(readFileSync(findingsFile, "utf8"), ruleIds);
    if (parsed.errors.length) {
      problems.push(...parsed.errors.map((x) => `${at}/findings.json: ${x}`));
      continue;
    }
    for (const [i, f] of parsed.findings.entries()) {
      if (f.tokens_per_1k?.measured_calls !== undefined)
        problems.push(`${at}/findings.json: findings[${i}] has measured_calls; a published audit states estimates from the code only`);
    }
    out.push({
      slug: slug.toLowerCase(),
      folder: slug,
      meta,
      findings: parsed.findings,
      ...(parsed.average_call ? { average_call: parsed.average_call } : {}),
      ...(parsed.kvsig ? { kvsig: parsed.kvsig } : {}),
      ...(parsed.notes?.length ? { notes: parsed.notes } : {}),
    });
  }
  if (problems.length) throw new Error(`audits:\n  ${problems.join("\n  ")}`);
  return out.sort((a, b) => (a.meta.date === b.meta.date ? a.slug.localeCompare(b.slug) : b.meta.date.localeCompare(a.meta.date)));
}
