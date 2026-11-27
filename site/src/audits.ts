// Published audits: site/audits/<owner>__<repo>/{meta.yaml, findings.json}.
//
// Rules the build enforces, so that an audit page is fair to the project it is about:
// - only a PUBLIC repository on github.com is published (meta.yaml `repo` and `visibility: public`);
// - the page names the commit audited, the leanprompt version and the date;
// - every figure is labelled as an estimate from reading the code, never a measurement;
// - the headline names the mistake in plain words, never the people (no mocking words), and the
//   subtitle says what the project already does well;
// - the big number at the top is one finding's tokens per 1,000 calls (or runs), always labelled
//   an estimate, or a count read from the project's own output, labelled as such;
// - the maintainer's issue, pull request and response are linked when there is one; an audit of a
//   repository with no public channel (issues and discussions off) says so in `no_channel` instead;
// - every page carries the corrections and takedown line.
// A folder whose name starts with "_" (the template) is skipped, and so is an audit whose status
// is `draft` or `withdrawn`. Any other problem fails the build with the folder and the reason.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { loadNoteRuleIds } from "../../cli/src/lint/rules.js";
import { isKnownFinding, isServerFinding, knownOf, parseFindings, type AverageCall, type Finding, type KvsigUse, type Note } from "../../cli/src/score/static.js";

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

/** The kinds of mistake an audit leads with: one short label on the card and the page. */
export const KINDS = [
  "Cut-off answer",
  "Retry loop",
  "Cache never hits",
  "Blind spend meter",
  "Setting that does nothing",
  "Runs again every night",
  "Wrong text summarised",
] as const;
export type Kind = (typeof KINDS)[number];

/** Words that mock people or call a mistake a failure of theirs; never in a headline or subtitle. */
export const MOCKING = /\b(silly|dumb|stupid|lazy|wasteful|sloppy|careless|incompetent|clueless|fail(s|ed|ing)?|failure|embarrassing|terrible|awful|idiotic|wasted)\b/i;

/**
 * The big number at the top of an audit. Either the tokens one finding costs per 1,000 calls
 * (`finding`: its id or file:line; the default is the largest open finding), always shown as an
 * estimate, or a count the audit read from the project's own output (`count`, like "66 of 558").
 */
export interface Figure {
  finding?: string;
  count?: string;
  /** What the number measures, in a few plain words (at most 120 characters). */
  label: string;
  /** "runs" when the findings count per run of a CLI or batch tool; "calls" otherwise. */
  unit: "calls" | "runs";
}

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
  /** Plain-English headline naming the mistake (at most 80 characters); required to publish. */
  headline?: string;
  /** One sentence: what the app is and what it already does well (at most 240 characters). */
  subtitle?: string;
  kind?: Kind;
  figure?: Figure;
  maintainer?: { issue?: string; pr?: string; response?: string; response_date?: string };
  /**
   * Status published only: why there is no maintainer thread to link, in literally true words (the
   * repository has issues and discussions turned off, say). Shown as the page's status.
   */
  no_channel?: string;
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
  /** The audit ran unattended (findings.json `unattended: true`); the page says so. */
  unattended?: boolean;
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

  const publishable = !!status && !UNPUBLISHED.has(status);
  const headline = str("headline");
  const subtitle = str("subtitle");
  const kind = str("kind") as Kind | undefined;
  if (headline === undefined) {
    if (publishable) errors.push("headline is required: the mistake in plain words, at most 80 characters");
  } else {
    if (headline.length > 80) errors.push(`headline must be at most 80 characters, not ${headline.length}`);
    if (headline.endsWith("?") || /!/.test(headline)) errors.push("headline must be a plain statement, without a question or exclamation mark");
  }
  if (subtitle === undefined) {
    if (publishable) errors.push("subtitle is required: one sentence on what the app is and what it already does well");
  } else if (subtitle.length > 240) errors.push(`subtitle must be at most 240 characters, not ${subtitle.length}`);
  for (const [k, v] of [["headline", headline], ["subtitle", subtitle]] as const) {
    if (v === undefined) continue;
    const bad = MOCKING.exec(v);
    if (bad) errors.push(`${k} must describe the mistake, not mock it: remove "${bad[0]}"`);
    if (/[\u2014]/.test(v)) errors.push(`${k} must not use an em dash`);
  }
  if (kind === undefined) {
    if (publishable) errors.push(`kind is required, one of: ${KINDS.join(", ")}`);
  } else if (!KINDS.includes(kind)) errors.push(`kind must be one of: ${KINDS.join(", ")}`);
  let figure: Figure | undefined;
  if (m.figure !== undefined && m.figure !== null) {
    if (typeof m.figure !== "object" || Array.isArray(m.figure)) errors.push("figure must be a mapping");
    else {
      const fm = m.figure as Record<string, unknown>;
      const fs = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string).trim() : typeof fm[k] === "number" ? String(fm[k]) : undefined);
      const label = fs("label");
      const unit = fs("unit") ?? "calls";
      if (!label) errors.push("figure.label is required: what the number measures");
      else if (label.length > 120) errors.push("figure.label must be at most 120 characters");
      if (unit !== "calls" && unit !== "runs") errors.push("figure.unit must be calls or runs");
      if (fs("finding") !== undefined && fs("count") !== undefined) errors.push("figure takes finding or count, not both");
      if (fs("count") !== undefined && !/^\d[\d,]*( of \d[\d,]*)?$/.test(fs("count")!)) errors.push('figure.count must be a number or "N of M"');
      const extra = Object.keys(fm).filter((k) => !["finding", "count", "label", "unit"].includes(k));
      if (extra.length) errors.push(`figure: unknown keys ${extra.join(", ")}`);
      if (label) figure = { label, unit: unit as Figure["unit"], ...(fs("finding") ? { finding: fs("finding")! } : {}), ...(fs("count") ? { count: fs("count")! } : {}) };
    }
  } else if (publishable) errors.push("figure is required: at least its label, what the big number measures");

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
  const noChannel = m.no_channel === undefined ? undefined : typeof m.no_channel === "string" ? m.no_channel.trim() : "";
  if (noChannel !== undefined) {
    if (!noChannel) errors.push("no_channel must be a sentence: why there is no maintainer thread to link");
    else if (noChannel.length > 300) errors.push(`no_channel must be at most 300 characters, not ${noChannel.length}`);
    if (status !== "published") errors.push("no_channel goes only with status: published (an audit with a maintainer thread links it instead)");
    if (maintainer?.issue || maintainer?.pr) errors.push("no_channel and a maintainer.issue or maintainer.pr contradict each other");
  }
  const known = ["repo", "visibility", "commit", "leanprompt", "date", "status", "path", "summary", "headline", "subtitle", "kind", "figure", "maintainer", "no_channel"];
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
      ...(headline ? { headline } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(kind ? { kind } : {}),
      ...(figure ? { figure } : {}),
      ...(maintainer && Object.keys(maintainer).length ? { maintainer } : {}),
      ...(noChannel ? { no_channel: noChannel } : {}),
    },
  };
}

/** Every publishable audit under site/audits, newest first. Throws with every problem found. */
export function loadAudits(root: string, ruleIds: ReadonlySet<string>, noteRuleIds: ReadonlySet<string> = loadNoteRuleIds(root)): Audit[] {
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
    const parsed = parseFindings(readFileSync(findingsFile, "utf8"), ruleIds, noteRuleIds);
    if (parsed.errors.length) {
      problems.push(...parsed.errors.map((x) => `${at}/findings.json: ${x}`));
      continue;
    }
    for (const [i, f] of parsed.findings.entries()) {
      if (f.tokens_per_1k?.measured_calls !== undefined)
        problems.push(`${at}/findings.json: findings[${i}] has measured_calls; a published audit states estimates from the code only`);
    }
    const fig = meta.figure?.finding;
    if (fig !== undefined && !parsed.findings.some((f) => f.id === fig || `${f.file}:${f.line}` === fig))
      problems.push(`${at}/meta.yaml: figure.finding ${fig} names no finding in findings.json (use its id or file:line)`);
    out.push({
      slug: slug.toLowerCase(),
      folder: slug,
      meta,
      findings: parsed.findings,
      ...(parsed.average_call ? { average_call: parsed.average_call } : {}),
      ...(parsed.kvsig ? { kvsig: parsed.kvsig } : {}),
      ...(parsed.notes?.length ? { notes: parsed.notes } : {}),
      ...(parsed.unattended ? { unattended: true } : {}),
    });
  }
  if (problems.length) throw new Error(`audits:\n  ${problems.join("\n  ")}`);
  return out.sort((a, b) => (a.meta.date === b.meta.date ? a.slug.localeCompare(b.slug) : b.meta.date.localeCompare(a.meta.date)));
}

/** A finding's tokens per 1,000 calls, the three billed sides the page sums. */
export function findingTokens(f: Finding): number {
  const t = f.tokens_per_1k ?? {};
  return (t.uncached ?? 0) + (t.prompt ?? 0) + (t.output ?? 0);
}

/** The finding the big number is taken from: the one meta.figure names, else the largest open one. */
export function leadFinding(a: Audit): Finding | undefined {
  const name = a.meta.figure?.finding;
  if (name !== undefined) return a.findings.find((f) => f.id === name || `${f.file}:${f.line}` === name);
  if (a.meta.figure?.count !== undefined) return undefined;
  const open = a.findings.filter((f) => !f.fixed && !isKnownFinding(f) && !isServerFinding(f));
  return [...open].sort((x, y) => findingTokens(y) - findingTokens(x))[0];
}

/** Two significant figures, so the big number never reads as more exact than the estimate is. */
export function roundFigure(n: number): number {
  if (n <= 0) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

export type BigNumber =
  | { kind: "tokens"; value: number; text: string; unit: "calls" | "runs"; label: string }
  | { kind: "count"; text: string; label: string };

/** The big number on the card and the page header; undefined when the audit has nothing to count. */
export function bigNumberOf(a: Audit): BigNumber | undefined {
  const fig = a.meta.figure;
  if (!fig) return undefined;
  if (fig.count !== undefined) return { kind: "count", text: fig.count, label: fig.label };
  const f = leadFinding(a);
  const v = f ? roundFigure(findingTokens(f)) : 0;
  if (!v) return undefined;
  return { kind: "tokens", value: v, text: v.toLocaleString("en-US"), unit: fig.unit, label: fig.label };
}

export const BADGES = {
  fixed: "Fixed upstream",
  reported: "Reported",
  planned: "Already planned by the maintainers",
  nochannel: "No public channel to report",
  demo: "Demonstration",
} as const;
export type Badge = keyof typeof BADGES;

/**
 * The status badge: Fixed upstream when the maintainers changed the code (status fixed); Already
 * planned when the lead finding is in the project's own plans; Reported when the maintainers were
 * told (an issue or pull request is linked); No public channel when the repository offers none
 * (`no_channel`); Demonstration for leanprompt's own example.
 */
export function badgeOf(a: Audit): Badge | undefined {
  const m = a.meta;
  if (m.status === "demo") return "demo";
  if (m.status === "fixed") return "fixed";
  const lead = leadFinding(a);
  if (lead && knownOf(lead)?.kind === "planned") return "planned";
  if (m.maintainer?.issue || m.maintainer?.pr) return "reported";
  if (m.no_channel) return "nochannel";
  return undefined;
}

/** The index order: fixed upstream first, then by the big number (token figures before counts), the demonstration last. */
export function sortForIndex(audits: Audit[]): Audit[] {
  const rank = (a: Audit) => (badgeOf(a) === "fixed" ? 0 : badgeOf(a) === "demo" ? 2 : 1);
  const size = (a: Audit) => {
    const b = bigNumberOf(a);
    return b?.kind === "tokens" ? b.value : -1;
  };
  return [...audits].sort((x, y) => rank(x) - rank(y) || size(y) - size(x) || x.slug.localeCompare(y.slug));
}
