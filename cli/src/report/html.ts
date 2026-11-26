import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDoc } from "../frontmatter.js";
import { optionsFor } from "../help.js";
import { REPO } from "../forms.js";
import { loadRuleIds, ruleFiles } from "../lint/rules.js";
import { loadProfile } from "../profile.js";
import { parseFindings, type Finding, type Severity } from "../score/static.js";
import { filterIgnored, FINDINGS_FILE, PACKAGE_ROOT } from "../score/write.js";

export type RuleInfo = { title: string; skill: string };

/** The fields of `.leanprompt/score.json` the page uses. Everything is optional: the file is read defensively. */
export interface ScoreFile {
  score?: number;
  kind?: string;
  weights?: string;
  inputs?: { E?: number; S?: number; G?: number };
  calls?: number;
  unmeasured?: number;
  diagnostics?: { estimate?: string };
  message?: string;
  color?: string;
  date?: string;
  leanprompt?: string;
}

export interface ReportInput {
  findings: Finding[];
  score: ScoreFile | null;
  rules: Map<string, RuleInfo>;
  project: string;
  /** Findings dropped by the profile's `ignore:` list. */
  ignored?: number;
  /** leanprompt version used in pinned rule links. Defaults to this package's version. */
  version?: string;
}

export const DEFAULT_OUT = join(".leanprompt", "report.html");
const SCORE_FILE = join(".leanprompt", "score.json");
const TEMPLATE = new URL("./template.html", import.meta.url);
const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const escapeHtml = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const e = escapeHtml;

function packageVersion(): string {
  return (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
}

/** Rule id -> title and skill, from the frontmatter of skills/*\/rules/*.md. */
export function loadRules(root: string): Map<string, RuleInfo> {
  const out = new Map<string, RuleInfo>();
  for (const file of ruleFiles(root)) {
    try {
      const m = parseDoc(readFileSync(join(root, file), "utf8")).meta;
      if (typeof m.id === "string" && typeof m.title === "string" && typeof m.skill === "string") out.set(m.id, { title: m.title, skill: m.skill });
    } catch {
      /* lint:rules reports it */
    }
  }
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const fmt2 = (v: unknown): string => num(v)?.toFixed(2) ?? "n/a";

function kindLabel(s: ScoreFile): string {
  if (s.kind === "measured") return "measured";
  return s.weights === "calibrated" ? "static, calibrated" : "static";
}

function scoreSection(score: ScoreFile | null): string {
  if (!score || num(score.score) === undefined) {
    return `<section><h2>Score</h2><p class="card">No score yet: run <code>npx leanprompt score</code></p></section>`;
  }
  const measured = score.kind === "measured";
  const i = score.inputs ?? {};
  let html = `<section><h2>Score</h2><div class="card"><div class="score">${e(score.score)}<span class="kind">${e(kindLabel(score))}</span></div>`;
  html += `<dl class="inputs">`;
  html += `<div><dt>E, prefill reuse</dt><dd>${e(fmt2(i.E))}</dd></div>`;
  html += `<div><dt>S, prefix stability</dt><dd>${e(fmt2(i.S))}</dd></div>`;
  html += `<div><dt>G, generation waste</dt><dd>${e(fmt2(i.G))}</dd></div>`;
  if (measured) {
    const calls = num(score.calls);
    const unmeasured = num(score.unmeasured);
    const measuredCalls = calls !== undefined && unmeasured !== undefined ? calls - unmeasured : undefined;
    html += `<div><dt>Calls measured</dt><dd>${e(measuredCalls ?? "n/a")}</dd></div>`;
    html += `<div><dt>Calls logged</dt><dd>${e(calls ?? "n/a")}</dd></div>`;
    html += `<div><dt>Calls unmeasured</dt><dd>${e(num(score.unmeasured) ?? "n/a")}</dd></div>`;
  }
  html += `</dl>`;
  if (measured) {
    html += `<p class="muted">Reusable tokens are estimated from the character share of each prompt part, not counted by the provider.</p>`;
  } else {
    html += `<p class="muted">A static score is an estimate from the audit's findings, not a measurement.</p>`;
  }
  if (typeof score.date === "string") html += `<p class="muted">Scored ${e(score.date)}.</p>`;
  html += `</div></section>`;
  return html;
}

function badgeSection(score: ScoreFile | null): string {
  if (!score || num(score.score) === undefined) return "";
  const md = "![leanprompt](https://img.shields.io/endpoint?url=<raw URL of .leanprompt/score.json in your repo>)";
  return `<section><h2>README badge</h2><p class="muted">Paste this line into your README and replace the URL with the raw URL of the committed <code>.leanprompt/score.json</code>.</p><pre><code>${e(md)}</code></pre></section>`;
}

function findingRow(f: Finding, rules: Map<string, RuleInfo>, version: string): string {
  const r = rules.get(f.rule);
  const id = r ? `<a href="${REPO}/blob/v${e(version)}/skills/${e(r.skill)}/rules/${e(f.rule)}.md">${e(f.rule)}</a>` : e(f.rule);
  const status = f.fixed ? `<span class="tag">fixed</span>` : "open";
  const share = f.share === undefined ? "" : `${Math.round(f.share * 100)}%`;
  return `<tr${f.fixed ? ` class="fixed"` : ""}><td><span class="sev sev-${f.severity}">${e(f.severity)}</span></td><td class="rule">${id}</td><td>${e(r?.title ?? "")}</td><td class="loc"><code>${e(f.file)}:${e(f.line)}</code></td><td>${share}</td><td>${status}</td></tr>`;
}

/** Rank: open before fixed, severity high to low, estimated share of tokens lost (when given) high to low, then file:line. */
export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      Number(!!a.fixed) - Number(!!b.fixed) ||
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      (b.share ?? 0) - (a.share ?? 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  );
}

function findingsSection(o: ReportInput, version: string): string {
  const open = o.findings.filter((f) => !f.fixed).length;
  const fixed = o.findings.length - open;
  let html = `<section><h2>Findings</h2><p class="muted">${open} open, ${fixed} fixed`;
  if (o.ignored) html += `, ${o.ignored} ignored by the profile`;
  html += `. Ranked by severity, then estimated share of tokens lost, then location.</p>`;
  if (o.findings.length === 0) return html + `</section>`;
  html += `<div class="tablewrap"><table><thead><tr><th>Severity</th><th>Rule</th><th>Title</th><th>Where</th><th>Share</th><th>Status</th></tr></thead><tbody>`;
  html += rankFindings(o.findings).map((f) => findingRow(f, o.rules, version)).join("");
  return html + `</tbody></table></div></section>`;
}

/** One self-contained HTML document: inline CSS, no script, no network. */
export function renderReport(o: ReportInput): string {
  const version = o.version ?? packageVersion();
  const body =
    `<h1>leanprompt report</h1><p class="muted">${e(o.project)}</p>` +
    scoreSection(o.score) +
    findingsSection(o, version) +
    badgeSection(o.score) +
    `<p class="muted">Made by leanprompt ${e(version)}. <a href="${REPO}">${REPO}</a></p>`;
  return readFileSync(TEMPLATE, "utf8")
    .replace("{{TITLE}}", () => `leanprompt report: ${e(o.project)}`)
    .replace("{{BODY}}", () => body);
}

function readScore(file: string): ScoreFile | null {
  if (!existsSync(file)) return null;
  try {
    const d: unknown = JSON.parse(readFileSync(file, "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? (d as ScoreFile) : null;
  } catch {
    return null;
  }
}

/** `leanprompt report --html [--out <file>] [--dir <project>]` */
export async function reportCommand(args: string[]): Promise<number> {
  let values: { html?: boolean; out?: string; dir?: string };
  try {
    values = parseArgs({ args, options: optionsFor("report"), strict: true }).values;
  } catch (err) {
    process.stderr.write(`leanprompt: ${(err as Error).message}\n`);
    return 2;
  }
  if (!values.html) {
    process.stderr.write("leanprompt: use --html (the Markdown report is leanprompt-report.md, written by the audit)\n");
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  let findings: Finding[] = [];
  let ignored = 0;
  const fpath = join(dir, FINDINGS_FILE);
  if (existsSync(fpath)) {
    const parsed = parseFindings(readFileSync(fpath, "utf8"), loadRuleIds(PACKAGE_ROOT));
    if (parsed.errors.length > 0) throw new Error(`${fpath}: ${parsed.errors.join("; ")}`);
    findings = filterIgnored(parsed.findings, loadProfile(dir));
    ignored = parsed.findings.length - findings.length;
  }
  const html = renderReport({ findings, ignored, score: readScore(join(dir, SCORE_FILE)), rules: loadRules(PACKAGE_ROOT), project: basename(dir) });
  const target = resolve(dir, values.out ?? DEFAULT_OUT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  process.stdout.write(`${target}\n`);
  return 0;
}
