// Published audits: site/audits/<owner>__<repo>/{meta.yaml, findings.json}.
//
// Rules the build enforces, so that an audit page is fair to the project it is about:
// - only a PUBLIC repository on github.com is published (meta.yaml `repo` and `visibility: public`),
//   unless its maintainers gave written permission to publish an audit of their private repository
//   (`visibility: private` with `consent`): that page names the project but links none of its code;
// - the page names the commit audited, the leanprompt version and the date;
// - every figure is labelled as an estimate from reading the code, never a measurement;
// - the headline names the mistake in plain words, never the people (no mocking words), and the
//   subtitle says what the project already does well;
// - the big number at the top is one finding's tokens per 1,000 calls (or runs), always labelled
//   an estimate, or a count read from the project's own output, labelled as such;
// - the maintainer's issue, pull request and response are linked when there is one; an audit of a
//   repository with no public channel (issues and discussions off) says so in `no_channel` instead;
// - every page carries the corrections and takedown line;
// - an audit's picture is a mechanism diagram that site/src/diagram.ts draws at build time from
//   meta.yaml `diagram:` (short strings, the keys each kind needs are in DIAGRAM_KEYS); the
//   share card (og.png) is drawn by site/src/og.ts from the same data. The old generated
//   illustration (`illustration: {scene, alt}` and illustration.webp) is optional and unused.
// A folder whose name starts with "_" (the template) is skipped, and so is an audit whose status
// is `draft` or `withdrawn`. Any other problem fails the build with the folder and the reason.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { loadNoteRuleIds } from "../../cli/src/lint/rules.js";
import { isKnownFinding, isServerFinding, knownOf, parseFindings, tokensLost, unitOf, type AverageCall, type Finding, type KvsigUse, type Note } from "../../cli/src/score/static.js";

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
  "Retired model",
  "Oversized prompt",
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

/**
 * The old generated picture: optional and no longer shown anywhere. A meta.yaml may still carry it
 * (scene and alt), and illustration.webp may still sit in the folder; the build neither requires
 * nor reads either.
 */
export interface Illustration {
  scene: string;
  alt: string;
}

/** The longest value of a diagram string, and of its `wrong` label, in characters. */
export const DIAGRAM_VALUE_MAX = 56;
export const DIAGRAM_WRONG_MAX = 64;

/**
 * The strings each kind's diagram template needs (`required`) and may take (`optional`); every
 * diagram also takes `wrong`: a short label saying what goes wrong at the marked step. `app`
 * overrides the name of the app (default: the repository name); `repeat` is a short "x N" tag.
 * See site/src/diagram.ts for where each string goes, and site/audits/README.md for how to write them.
 */
export const DIAGRAM_KEYS: Record<Kind, { required: readonly string[]; optional: readonly string[] }> = {
  "Cut-off answer": { required: ["cap", "then", "wrong"], optional: ["app", "repeat"] },
  "Retry loop": { required: ["request", "reply", "then", "wrong"], optional: ["app", "repeat"] },
  "Cache never hits": { required: ["prompt", "cache", "bill", "wrong"], optional: ["app"] },
  "Blind spend meter": { required: ["call", "reports", "meter", "wrong"], optional: ["app"] },
  "Setting that does nothing": { required: ["setting", "request", "result", "wrong"], optional: [] },
  "Runs again every night": { required: ["job", "input", "call", "wrong"], optional: [] },
  "Wrong text summarised": { required: ["source", "cut", "asked", "result", "wrong"], optional: [] },
  "Retired model": { required: ["model", "provider", "result", "wrong"], optional: ["app"] },
  "Oversized prompt": { required: ["ask", "attached", "paid", "wrong"], optional: [] },
};

/** The diagram's strings: one entry per key of the kind's template. */
export type DiagramStrings = Record<string, string>;

export interface AuditMeta {
  repo: string;
  owner: string;
  name: string;
  visibility: "public" | "private";
  /** A private repository only: when the maintainers gave written permission to publish, and how. */
  consent?: { date: string; note?: string };
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
  /** The strings that fill the kind's mechanism diagram (DIAGRAM_KEYS); the page and cards show the diagram when present. */
  diagram?: DiagramStrings;
  /** Optional and unused: the old generated picture's scene and alt text. */
  illustration?: Illustration;
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
  /** The project is a gateway or proxy (findings.json `gateway: true`). */
  gateway?: boolean;
  /** What one run is, for per-run findings. */
  run?: string;
  /** The audit ran unattended (findings.json `unattended: true`); the page says so. */
  unattended?: boolean;
}

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
const GITHUB_LINK = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/(issues|pull|discussions)\/\d+(#[\w-]+)?$/;
/** A private repository's address, on any host: https://<host>/<owner>/<repo>. Never linked from the page. */
const PRIVATE_REPO = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9._-]{1,100})$/;
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
  const isPrivate = m.visibility === "private";
  const pm = repo && isPrivate ? PRIVATE_REPO.exec(repo) : null;
  const gh = repo ? (isPrivate ? (pm ? [pm[0], pm[2], pm[3]] : null) : GITHUB_REPO.exec(repo)) : null;
  if (!repo) errors.push("repo is required: the public github.com URL of the repository audited");
  else if (!gh) errors.push(isPrivate ? `repo must be the private repository's URL, https://<host>/<owner>/<repo>, not ${repo}` : `repo must be a public repository URL of the form https://github.com/<owner>/<repo>, not ${repo}`);
  if (m.visibility !== "public" && !isPrivate) errors.push("visibility: public is required; only audits of public repositories are published (or private, with the maintainers' written consent)");
  if (gh && slug.toLowerCase() !== `${gh[1]}__${gh[2]}`.toLowerCase()) errors.push(`the folder must be named ${gh[1]}__${gh[2]} (lower case is fine), not ${slug}`);
  let consent: AuditMeta["consent"];
  if (m.consent !== undefined && m.consent !== null) {
    if (!isPrivate) errors.push("consent goes only with visibility: private");
    if (typeof m.consent !== "object" || Array.isArray(m.consent)) errors.push("consent must be a mapping with date and an optional note");
    else {
      const cm = m.consent as Record<string, unknown>;
      const cd = dateOf(cm.date);
      const note = typeof cm.note === "string" ? cm.note.trim() : undefined;
      if (!cd || !DATE.test(cd)) errors.push("consent.date must be the day the maintainers gave written permission, YYYY-MM-DD");
      if (note !== undefined && (!note || note.length > 300)) errors.push("consent.note must be one sentence of at most 300 characters");
      const extra = Object.keys(cm).filter((k) => !["date", "note"].includes(k));
      if (extra.length) errors.push(`consent: unknown keys ${extra.join(", ")}`);
      if (cd && DATE.test(cd)) consent = { date: cd, ...(note ? { note } : {}) };
    }
  } else if (isPrivate) errors.push("a private repository needs consent: {date, note}: the maintainers' written permission to publish the audit");
  const commit = str("commit");
  // A private repository's audit may name only the short SHA its maintainers' report gives: nobody outside can resolve it anyway.
  if (!commit || !(isPrivate ? /^[0-9a-f]{7,40}$/ : /^[0-9a-f]{40}$/).test(commit))
    errors.push(isPrivate ? "commit must be the SHA of the commit audited (at least 7 characters)" : "commit must be the full 40-character SHA of the commit audited");
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
  if (isPrivate) {
    if (maintainer?.issue || maintainer?.pr) errors.push("a private repository's issues and pull requests are not public: leave maintainer.issue and maintainer.pr out");
    if (status === "notified") errors.push("status notified does not fit a private repository: its maintainers gave consent, so use published, acknowledged, fixed or disputed");
    if (status && ["acknowledged", "fixed"].includes(status) && !maintainer?.response)
      errors.push(`status ${status} on a private repository needs maintainer.response: what the maintainers said, since there is no public thread to link`);
    if (m.no_channel !== undefined) errors.push("no_channel does not fit a private repository: consent says how the maintainers were told");
  } else if (status && ["notified", "acknowledged", "fixed", "disputed"].includes(status) && !maintainer?.issue && !maintainer?.pr)
    errors.push(`status ${status} needs maintainer.issue or maintainer.pr: link where the maintainers were told`);
  const noChannel = m.no_channel === undefined ? undefined : typeof m.no_channel === "string" ? m.no_channel.trim() : "";
  if (noChannel !== undefined) {
    if (!noChannel) errors.push("no_channel must be a sentence: why there is no maintainer thread to link");
    else if (noChannel.length > 300) errors.push(`no_channel must be at most 300 characters, not ${noChannel.length}`);
    if (status !== "published") errors.push("no_channel goes only with status: published (an audit with a maintainer thread links it instead)");
    if (maintainer?.issue || maintainer?.pr) errors.push("no_channel and a maintainer.issue or maintainer.pr contradict each other");
  }
  let illustration: Illustration | undefined;
  if (m.illustration !== undefined && m.illustration !== null) {
    // Optional and unused now; a block that is there must still be well formed.
    if (typeof m.illustration !== "object" || Array.isArray(m.illustration)) errors.push("illustration must be a mapping with scene and alt");
    else {
      const im = m.illustration as Record<string, unknown>;
      const scene = typeof im.scene === "string" ? im.scene.trim() : undefined;
      const alt = typeof im.alt === "string" ? im.alt.trim() : undefined;
      if (!scene || !alt) errors.push("illustration needs both scene and alt (or leave the block out: it is optional and unused)");
      const extra = Object.keys(im).filter((k) => !["scene", "alt"].includes(k));
      if (extra.length) errors.push(`illustration: unknown keys ${extra.join(", ")}`);
      if (scene && alt) illustration = { scene, alt };
    }
  }
  let diagram: DiagramStrings | undefined;
  if (m.diagram !== undefined && m.diagram !== null) {
    if (typeof m.diagram !== "object" || Array.isArray(m.diagram)) errors.push("diagram must be a mapping of short strings");
    else if (!kind || !KINDS.includes(kind)) {
      if (publishable) errors.push("diagram needs a valid kind: the kind picks the template");
    }
    else {
      const dm = m.diagram as Record<string, unknown>;
      const spec = DIAGRAM_KEYS[kind];
      const out: DiagramStrings = {};
      for (const k of [...spec.required, ...spec.optional]) {
        const v = dm[k];
        if (v === undefined || v === null) {
          if (spec.required.includes(k)) errors.push(`diagram.${k} is required for kind ${kind}`);
          continue;
        }
        const t = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : undefined;
        const max = k === "wrong" ? DIAGRAM_WRONG_MAX : k === "repeat" ? 14 : k === "app" ? 32 : DIAGRAM_VALUE_MAX;
        if (t === undefined || !t) errors.push(`diagram.${k} must be a non-empty string`);
        else if (t.length > max) errors.push(`diagram.${k} must be at most ${max} characters, not ${t.length}`);
        else if (/[\n\u2014<>]/.test(t) || /\bundefined\b|\bnull\b/i.test(t)) errors.push(`diagram.${k} must be plain words on one line: no em dash, no markup, no "undefined"`);
        else out[k] = t;
      }
      const extra = Object.keys(dm).filter((k) => !spec.required.includes(k) && !spec.optional.includes(k));
      if (extra.length) errors.push(`diagram: unknown keys ${extra.join(", ")} for kind ${kind} (it takes ${[...spec.required, ...spec.optional].join(", ")})`);
      if (!errors.some((x) => x.startsWith("diagram"))) diagram = out;
    }
  }
  const known = ["repo", "visibility", "consent", "commit", "leanprompt", "date", "status", "path", "summary", "headline", "subtitle", "kind", "figure", "maintainer", "no_channel", "diagram", "illustration"];
  const unknown = Object.keys(m).filter((k) => !known.includes(k));
  if (unknown.length) errors.push(`unknown keys ${unknown.join(", ")}`);
  if (errors.length) return { errors };
  return {
    errors,
    meta: {
      repo: repo!,
      owner: gh![1]!,
      name: gh![2]!,
      visibility: isPrivate ? "private" : "public",
      ...(consent ? { consent } : {}),
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
      ...(diagram ? { diagram } : {}),
      ...(illustration ? { illustration } : {}),
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
    // Private items (security, privacy, legal) never go on the site, and findings.json is published beside the page:
    // the file must have them removed, not just hidden.
    if (parsed.private) {
      const n = parsed.private.findings.length + parsed.private.notes.length;
      problems.push(`${at}/findings.json: ${n} private item${n === 1 ? "" : "s"} (private: true); remove ${n === 1 ? "it" : "them"} from the published file before building the site, they are never published`);
      continue;
    }
    for (const [i, f] of parsed.findings.entries()) {
      if (tokensLost(f)?.measured_calls !== undefined)
        problems.push(`${at}/findings.json: findings[${i}] has measured_calls; a published audit states estimates from the code only`);
    }
    const fig = meta.figure?.finding;
    const figF = fig !== undefined ? parsed.findings.find((f) => f.id === fig || `${f.file}:${f.line}` === fig) : undefined;
    if (fig !== undefined && !figF) problems.push(`${at}/meta.yaml: figure.finding ${fig} names no finding in findings.json (use its id or file:line)`);
    if (figF && meta.figure && (unitOf(figF) === "run") !== (meta.figure.unit === "runs"))
      problems.push(`${at}/meta.yaml: figure.unit ${meta.figure.unit} does not match finding ${fig}, whose figure is ${unitOf(figF) === "run" ? "per run" : "per 1,000 calls"}`);
    out.push({
      slug: slug.toLowerCase(),
      folder: slug,
      meta,
      findings: parsed.findings,
      ...(parsed.average_call ? { average_call: parsed.average_call } : {}),
      ...(parsed.kvsig ? { kvsig: parsed.kvsig } : {}),
      ...(parsed.notes?.length ? { notes: parsed.notes } : {}),
      ...(parsed.unattended ? { unattended: true } : {}),
      ...(parsed.gateway ? { gateway: true } : {}),
      ...(parsed.run !== undefined ? { run: parsed.run } : {}),
    });
  }
  if (problems.length) throw new Error(`audits:\n  ${problems.join("\n  ")}`);
  return out.sort((a, b) => (a.meta.date === b.meta.date ? a.slug.localeCompare(b.slug) : b.meta.date.localeCompare(a.meta.date)));
}

/** A finding's tokens per 1,000 calls (or per run, for a per-run finding), the three billed sides the page sums. */
export function findingTokens(f: Finding): number {
  const t = tokensLost(f) ?? {};
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
