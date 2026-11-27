import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDoc } from "../frontmatter.js";
import { optionsFor } from "../help.js";
import { REPO } from "../forms.js";
import { loadNoteRuleIds, loadRuleIds } from "../lint/rules.js";
import { loadProfile, type Profile } from "../profile.js";
import { EXTERNAL, knownOf, parseFindings, tokensLost, unitOf, unitText, type AverageCall, type Finding, type Known, type KvsigUse, type Note, type Scope, type Severity, type Unit } from "../score/static.js";
import { writePrivateList } from "./private.js";
import { costSummary, costsNothing, formatDollars, formatPrice, formatTokens, groupOf, ownerQuestions, type CostSummary } from "./cost.js";
import { filterIgnored, FINDINGS_FILE, localDate, PACKAGE_ROOT } from "../score/write.js";
import { MD_FILE, projectName, rawPriority, renderMarkdown, spliceReport } from "./markdown.js";

export type { RuleInfo } from "../lint/rules.js";
export { loadRules } from "../lint/rules.js";
import type { RuleInfo } from "../lint/rules.js";
import { loadRules } from "../lint/rules.js";

/** The fields of `.leanprompt/score.json` the page uses. Everything is optional: the file is read defensively. */
export interface ScoreFile {
  score?: number;
  kind?: string;
  weights?: string;
  inputs?: { E?: number; S?: number; G?: number };
  calls?: number;
  unmeasured?: number;
  diagnostics?: { estimate?: string; default_shares?: number; findings?: number; server_findings?: number; known_findings?: number };
  /** Static only, when there are findings for the server's administrator (0.1.0-dev.13 and later). */
  server?: { included?: boolean; findings?: number; with_server_score?: number; app_score?: number };
  /** Static only, when some findings are already known to the project (0.1.0-dev.14 and later). */
  known?: { findings?: number; with_known_score?: number };
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
  /** leanprompt.yaml, for the volume and prices behind the money estimate. */
  profile?: Profile | null;
  /** The audit's average call, from findings.json, for the share of the bill. */
  average_call?: AverageCall;
  /** Whether the app already uses kvsig, from findings.json. Shown as one line; it does not change the score. */
  kvsig?: KvsigUse;
  /** Verified problems outside the rules, from findings.json. Shown after the findings; never scored. */
  notes?: Note[];
  /** Local git facts for the badge snippet. */
  git?: GitInfo;
  /** The audit ran unattended (nobody was asked), from findings.json. The page says so. */
  unattended?: boolean;
  /** `priority:` as leanprompt.yaml writes it, for "Questions for the owner"; undefined when it is not set. */
  priority?: string;
  /** The project is an LLM gateway or proxy (findings.json `gateway: true`): items say whose calls they are about. */
  gateway?: boolean;
  /** What one run is, for per-run findings (findings.json `run`). */
  run?: string;
}

export const DEFAULT_OUT = join(".leanprompt", "report.html");
const SCORE_FILE = join(".leanprompt", "score.json");
const TEMPLATE = new URL("./template.html", import.meta.url);
const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const escapeHtml = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const e = escapeHtml;

export function packageVersion(): string {
  return (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const fmt2 = (v: unknown): string => num(v)?.toFixed(2) ?? "n/a";

function kindLabel(s: ScoreFile): string {
  if (s.kind === "measured") return "measured";
  return s.weights === "calibrated" ? "static, calibrated" : "static";
}

/** The quiet line for an app that already gives its prompt parts kvsig ids. */
export const KVSIG_LINE = "This app already gives its prompt parts kvsig ids, so the stability checks use them.";

function scoreSection(score: ScoreFile | null, kvsig?: KvsigUse): string {
  const kv = kvsig?.used ? `<p class="muted kvsig">${e(KVSIG_LINE)}</p>` : "";
  if (!score || num(score.score) === undefined) {
    return `<section class="score-sec" id="s-score"><h2>Score</h2><p class="card">No score yet: run <code>npx leanprompt score</code></p>${kv}</section>`;
  }
  const measured = score.kind === "measured";
  const i = score.inputs ?? {};
  let html = `<section class="score-sec" id="s-score"><h2>Score</h2><p class="prose">One number from 0 to 100 for how well this app avoids paying for the same tokens twice; higher is better. It is computed from the findings above (static) or from your usage log (measured).</p><div class="card"><div class="score"><span class="n">${e(score.score)}</span><span class="kind">${e(kindLabel(score))}</span></div>`;
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
  const d = score.diagnostics ?? {};
  const defaults = !measured && num(d.default_shares) !== undefined && num(d.findings) !== undefined;
  if (defaults) html += `<div><dt>Default shares</dt><dd>${e(d.default_shares)} of ${e(d.findings)}</dd></div>`;
  html += `</dl>`;
  if (defaults) html += `<p class="muted">Findings scored with severity defaults, not estimates. The fewer, the more the static score says about this app.</p>`;
  const sv = score.server;
  const svn = num(sv?.findings);
  if (!measured && sv && svn !== undefined && svn > 0) {
    if (sv.included) {
      html += `<p class="muted">${e(`This score counts ${plural(svn, "finding")} for the server's administrator${num(sv.app_score) !== undefined ? `; the app's own score is ${sv.app_score}` : ""}.`)}</p>`;
    } else {
      html += `<p class="muted">${e(`This is the app's own score. It leaves out ${plural(svn, "finding")} for the server's administrator, whose fix is a server setting, not the app's code${num(sv.with_server_score) !== undefined ? `; with them it would be ${sv.with_server_score}` : ""}.`)}</p>`;
    }
  }
  const kn = score.known;
  const knn = num(kn?.findings);
  if (!measured && kn && knn !== undefined && knn > 0) {
    html += `<p class="muted">${e(`It leaves out ${plural(knn, "finding")} the project already knows about (planned, in progress, declined or reported)${num(kn.with_known_score) !== undefined ? `; with them it would be ${kn.with_known_score}` : ""}.`)}</p>`;
  }
  if (measured) {
    html += `<p class="muted">Reusable tokens are estimated from the character share of each prompt part, not counted by the provider.</p>`;
  } else {
    html += `<p class="muted">A static score is an estimate from the audit's findings, not a measurement.</p>`;
  }
  if (typeof score.date === "string") html += `<p class="muted">Scored ${e(score.date)} (the date on the machine that ran it).</p>`;
  html += `</div>${kv}</section>`;
  return html;
}

/** Where a finding is, as plain text: `file:line`, or for an `<external>` one its `where` text. */
export function whereText(f: Finding): string {
  if (f.file === EXTERNAL) return `${f.where ?? EXTERNAL}${f.line > 0 ? ` (line ${f.line})` : ""}`;
  return `${f.file}:${f.line}`;
}

/** Where a finding is, as HTML. */
function location(f: Finding): string {
  if (f.file === EXTERNAL) return e(whereText(f));
  return `<code>${e(whereText(f))}</code>`;
}

/** The finding's tokens lost, in its own unit (`unitOf`: per 1,000 calls, or per run). */
export const tokensOf = (f: Finding): number | undefined => {
  const t = tokensLost(f);
  return t ? (t.prompt ?? 0) + (t.uncached ?? 0) + (t.output ?? 0) : undefined;
};

/** "about 138k tokens per 1,000 calls" or "about 12k tokens per run". */
export const tokensPhrase = (f: Finding): string | undefined => {
  const t = tokensOf(f);
  return t === undefined ? undefined : `about ${formatTokens(t)} tokens ${unitText(unitOf(f))}`;
};

/** How a scope reads on a card: whose calls the item is about, in a gateway or proxy audit. */
export const SCOPE_LABEL: Record<Scope, string> = { own: "the gateway's own calls", proxied: "clients' calls through the gateway" };

/** "own" and "proxied" counts, for the line that separates them on a gateway's page. Empty when no item has a scope. */
export function scopeCounts(findings: Finding[], notes: Note[] = []): { own: number; proxied: number } | undefined {
  const items = [...findings.filter((f) => !f.fixed), ...notes];
  if (!items.some((x) => x.scope)) return undefined;
  return { own: items.filter((x) => x.scope === "own").length, proxied: items.filter((x) => x.scope === "proxied").length };
}

/**
 * Rank: open before fixed; findings with token numbers before those without, largest first; then severity
 * high to low, estimated share (when given) high to low, then file:line.
 */
export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      Number(!!a.fixed) - Number(!!b.fixed) ||
      Number(tokensOf(b) !== undefined) - Number(tokensOf(a) !== undefined) ||
      // Figures per 1,000 calls and per run cannot be compared: per-call findings first, each unit largest first.
      Number(unitOf(a) === "run") - Number(unitOf(b) === "run") ||
      (tokensOf(b) ?? -1) - (tokensOf(a) ?? -1) ||
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      (b.share ?? 0) - (a.share ?? 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  );
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const ruleTitle = (f: Finding, rules: Map<string, RuleInfo>): string => rules.get(f.rule)?.title ?? f.rule;
export const ruleLink = (f: Finding, rules: Map<string, RuleInfo>, version: string): string | undefined => {
  const r = rules.get(f.rule);
  return r ? `${REPO}/blob/v${version}/skills/${r.skill}/rules/${f.rule}.md` : undefined;
};

export interface Groups {
  /** The app's confirmed findings: the "places" the headline counts. */
  open: Finding[];
  /** The app's open questions: outside the repository, or behaviour unconfirmed. */
  questions: Finding[];
  /** Findings whose fix is a server or engine setting: questions for the server's administrator. */
  server: Finding[];
  /** Findings the project already knows about: planned, in progress or reported, then declined. Not in the totals or the score. */
  known: Finding[];
  fixed: Finding[];
}
export function groups(findings: Finding[]): Groups {
  const ranked = rankFindings(findings);
  return {
    open: ranked.filter((f) => groupOf(f) === "open"),
    questions: ranked.filter((f) => groupOf(f) === "question"),
    server: ranked.filter((f) => groupOf(f) === "server"),
    known: ranked.filter((f) => groupOf(f) === "known").sort((a, b) => Number(knownOf(a)!.kind === "declined") - Number(knownOf(b)!.kind === "declined")),
    fixed: ranked.filter((f) => f.fixed),
  };
}

/** The open findings that cost tokens: the "places" the headline counts. A finding that costs nothing stays on the page. */
export const costly = (g: Groups): Finding[] => g.open.filter((f) => !costsNothing(f));

/** How each kind of known finding is named on the page. */
export const KNOWN_LABEL: Record<Known["kind"], string> = {
  planned: "Already planned",
  "in-progress": "In progress",
  reported: "Already reported",
  declined: "Declined by the project",
};

/** The known entry as one line: "Already planned: <note> (<url>)". */
export const knownLine = (f: Finding): string | undefined => {
  const k = knownOf(f);
  if (!k) return undefined;
  return `${k.note ?? (k.url ? "" : KNOWN_LABEL[k.kind])}${k.note && k.url ? " " : ""}${k.url ?? ""}`.trim();
};

/**
 * The largest open question, when it is larger than the largest finding (or there is no finding with a number):
 * the headline names it, so a question that may be the main result is not lost under "plus N open questions".
 */
export function largestQuestion(g: Groups): Finding | undefined {
  const q = g.questions[0];
  const tq = q ? tokensOf(q) : undefined;
  if (!q || tq === undefined || tq <= 0) return undefined;
  const top = costly(g)[0];
  const t = top ? tokensOf(top) : undefined;
  if (top && t !== undefined && unitOf(top) !== unitOf(q)) return undefined;
  return t === undefined || tq > t ? q : undefined;
}

/** "an estimate from the code, not a measurement", "measured over N calls", or counted from the app's own output. */
export const tokenKind = (c: CostSummary): string => {
  if (c.measured) return `measured over ${(c.measured_calls ?? 0).toLocaleString("en-US")} calls`;
  if (c.total_rows > 0 && c.counted === c.total_rows) return "counted from the app's own committed output, not an estimate";
  if (c.counted > 0) return "an estimate from the code, not a measurement, except the figures marked counted, which come from the app's own committed output";
  return "an estimate from the code, not a measurement";
};

/** "per run (one aicommits invocation)" or "per run". */
export const runText = (run?: string): string => `per run${run ? ` (${run})` : ""}`;

/** What a finding with `cached_discount: "none"` says about money. */
export const NO_DISCOUNT_LINE = "The tokens are real, but this model has no cached-input price, so serving them from the cache saves time, not money.";

/** The line an unattended audit carries on the page and in the Markdown report. */
export const UNATTENDED_LINE =
  "Unattended audit: nobody was asked during the run, so priority, volume and prices were left open; the questions for the owner are listed at the end.";

function headline(o: ReportInput, g: Groups, cost: CostSummary): string {
  const places = costly(g);
  const n = places.length;
  const zero = g.open.length - n;
  let h = `<header class="lede" id="s-top"><p class="project">leanprompt audit of <strong>${e(o.project)}</strong></p>`;
  if (o.unattended) h += `<p class="flag unattended">${e(UNATTENDED_LINE)}</p>`;
  const bigQ = largestQuestion(g);
  const questionLine = (): string => {
    if (!bigQ) return "";
    const what = bigQ.problem ? splitLead(bigQ.problem)[0] : `${ruleTitle(bigQ, o.rules).replace(/\.$/, "")}.`;
    return `<p class="sub">${n > 0 ? "The largest item is an open question" : "The largest"}, at ${location(bigQ)}, ${e(tokensPhrase(bigQ)!)} if it holds: ${e(afterColon(what))}</p>`;
  };
  const extras = (): string => {
    let x = "";
    if (zero > 0) x += `<p class="muted">${e(`Plus ${plural(zero, "finding")} that ${zero === 1 ? "costs" : "cost"} no tokens today, listed with the findings and not counted as places.`)}</p>`;
    if (g.server.length > 0) {
      x += `<p class="muted">${e(`Plus ${plural(g.server.length, "question")} for the server's administrator, listed after the findings. They are about the server's settings, not this app's code, so they are not in this app's score.`)}</p>`;
    }
    if (g.known.length > 0) x += `<p class="muted">${e(`Plus ${plural(g.known.length, "finding")} the project already knows about (planned, in progress, reported or declined), listed after the findings. They are not in the totals or the score.`)}</p>`;
    if ((o.notes ?? []).length > 0) x += `<p class="muted">Plus ${e(plural(o.notes!.length, "other problem"))} the audit found, listed after the findings. Not scored.</p>`;
    const sc = scopeCounts(o.findings, o.notes ?? []);
    if (o.gateway || sc) x += `<p class="muted scope">${e(scopeLine(sc))}</p>`;
    return x;
  };
  if (n === 0 && g.questions.length === 0) {
    if (g.fixed.length > 0 && zero === 0) {
      h += `<h1>No open findings</h1><p class="sub">${e(plural(g.fixed.length, "finding"))}, fixed. Nothing open remains in this app&#39;s code.</p>`;
    } else h += `<h1>${e("The audit found no place where this app pays for tokens it doesn't need")}</h1>`;
    return `${h}${extras()}</header>`;
  }
  if (n === 0) {
    h += `<h1>${e(`Nothing confirmed yet, and ${plural(g.questions.length, "open question")} to settle`)}</h1>`;
    h += questionLine();
  } else {
    h += `<h1>${e(`${plural(n, "place")} where this app pays for tokens it doesn't need`)}</h1>`;
    const top = places[0]!;
    const tp = tokensPhrase(top);
    const size = tp !== undefined ? `, ${e(tp)}` : top.estimate ? `, ${e(top.estimate)}` : "";
    const what = top.problem ? splitLead(top.problem)[0] : `${ruleTitle(top, o.rules).replace(/\.$/, "")}.`;
    h += `<p class="sub">The biggest, at ${location(top)}${size}: ${e(afterColon(what))}</p>`;
    h += questionLine();
    const withNumber = cost.with_tokens + cost.run_with_tokens;
    if (withNumber > 0) {
      const kind = tokenKind(cost);
      // Per 1,000 calls and per run are separate totals: they are never added together.
      const totals = [
        cost.with_tokens > 0 ? `about ${formatTokens(cost.tokens_per_1k)} tokens per 1,000 calls` : "",
        cost.run_with_tokens > 0 ? `about ${formatTokens(cost.run_tokens)} tokens ${runText(o.run)}` : "",
      ].filter(Boolean);
      h += `<p class="total"><span class="lbl">Together</span> <strong>${e(totals.join(", and "))}</strong> `;
      h += `${withNumber < n ? `For the ${e(withNumber)} with a number, ${e(kind)}.` : `${e(kind.charAt(0).toUpperCase() + kind.slice(1))}.`}`;
      if (totals.length > 1) h += ` The two units are kept apart, never added.`;
      if (cost.overlaps) h += ` Findings that overlap are counted once.`;
      if (cost.question_tokens_per_1k > 0) h += ` <span class="oq">If the open questions hold, add about ${e(formatTokens(cost.question_tokens_per_1k))} per 1,000 calls.</span>`;
      if (cost.run_question_tokens > 0) h += ` <span class="oq">If the open questions hold, add about ${e(formatTokens(cost.run_question_tokens))} per run.</span>`;
      if (cost.dollars_per_run !== undefined) h += ` About ${e(formatDollars(cost.dollars_per_run))} per run at the prices in <code>leanprompt.yaml</code>.`;
      h += `</p>`;
      h += tokenBar(g.open, o.rules, "calls") + tokenBar(g.open, o.rules, "run", o.run);
    }
    if (g.questions.length > 0) h += `<p class="muted">Plus ${e(plural(g.questions.length, "open question"))} to confirm, listed after the findings.</p>`;
  }
  return `${h}${extras()}</header>`;
}

// Capitalised words that stay capitalised after a colon: names of providers, tools and languages.
const PROPER = new Set(
  "Anthropic Claude OpenAI Gemini Google OpenRouter DeepInfra DeepSeek Qwen Llama Mistral Groq Together Azure Bedrock Vertex LangChain LlamaIndex LiteLLM Vercel Python Go Node TypeScript JavaScript Rust Java Ruby Windows Linux Codex Cursor OpenCode SGLang Ollama GitHub GitLab Bitbucket Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December".split(" "),
);

/**
 * Text joined after a colon reads as one sentence: lower-case its first word when that is an ordinary capitalised
 * word ("When", "A"), and leave acronyms, code, names and "I" as they are ("LLM", "vLLM", "OpenAI", "Anthropic").
 */
export function afterColon(text: string): string {
  const word = /^[^\s,.;:!?()"]*/.exec(text)![0];
  if (!/^[A-Z][a-z'-]*$/.test(word) || word.replace(/['-].*$/, "") === "I" || PROPER.has(word.replace(/['-].*$/, ""))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The finding's short title for the meter: the first sentence of its problem, or the rule's title, cut at a word. */
export function shortTitle(f: Finding, rules: Map<string, RuleInfo>, max = 80): string {
  const lead = (f.problem ? splitLead(f.problem)[0] : ruleTitle(f, rules)).trim().replace(/[.:;,]$/, "");
  if (lead.length <= max) return lead;
  const cut = lead.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.(]+$/, "")}\u2026`;
}

/** `client.ts:42`: the file's name and line, for the legend. */
const shortWhere = (f: Finding): string => (f.file === EXTERNAL ? whereText(f) : `${f.file.split("/").pop()}:${f.line}`);

/**
 * The meter: one row per finding with a number, largest first. Each row carries the card's number, where it is,
 * a bar scaled to its share of the total, and the figures as text, so neither colour nor length carries meaning alone.
 */
function tokenBar(open: Finding[], rules: Map<string, RuleInfo>, unit: Unit = "calls", run?: string): string {
  const withT = open.filter((f) => unitOf(f) === unit && (tokensOf(f) ?? 0) > 0);
  const total = withT.reduce((a, f) => a + tokensOf(f)!, 0);
  if (total <= 0 || withT.length < 1) return "";
  const max = Math.max(...withT.map((f) => tokensOf(f)!));
  const per = unit === "run" ? runText(run) : "per 1,000 calls";
  let html = `<figure class="meter"><figcaption>${e(`Tokens ${per}, by finding, and each one's share of the total`)}</figcaption><ol>`;
  withT.forEach((f) => {
    const t = tokensOf(f)!;
    const share = (100 * t) / total;
    const n = open.indexOf(f) + 1;
    const pct = share >= 1 ? `${Math.round(share)}%` : "under 1%";
    const title = shortTitle(f, rules);
    html += `<li><a href="#f${n}" aria-label="${e(`Finding ${n}, ${title}, ${shortWhere(f)}: ${formatTokens(t)} tokens ${unitText(unit)}, ${pct} of the total`)}">`;
    html += `<span class="mn" aria-hidden="true">${n}</span><span class="ml" aria-hidden="true"><span class="mtt">${e(title)}</span><code class="mw">${e(shortWhere(f))}</code></span>`;
    html += `<span class="mt" aria-hidden="true">${e(formatTokens(t))}</span><span class="mp" aria-hidden="true">${e(pct)}</span>`;
    html += `<span class="track" aria-hidden="true"><span class="fill" style="width:${((100 * t) / max).toFixed(2)}%"></span></span></a></li>`;
  });
  return `${html}</ol></figure>`;
}

/** What a run is, for the cost section: the findings file's `run`, or a plain default. */
const o_run = (cost: CostSummary): string => cost.run ?? "one run of the tool";

/** The line that separates the gateway's own calls from what it does to its clients' calls. */
export function scopeLine(sc: { own: number; proxied: number } | undefined): string {
  if (!sc) return "This project is a gateway or proxy: the audit did not mark which items are about its own calls and which about its clients' calls.";
  return `This project is a gateway or proxy. ${plural(sc.own, "item")} ${sc.own === 1 ? "is" : "are"} about the gateway's own calls, ${plural(sc.proxied, "item")} about what it does to its clients' calls; each card says which.`;
}

function costSection(cost: CostSummary, version: string): string {
  if (cost.rows.filter((r) => !r.finding.fixed).length === 0) return "";
  let html = `<section class="cost" id="s-cost"><h2>What this costs you</h2>`;
  const m = cost.money;
  if (m) {
    const cur = m.currency;
    html += `<p class="big"><strong>About ${e(formatDollars(m.lost_per_month, cur))} a month at ${e(m.calls_per_month.toLocaleString("en-US"))} calls a month.</strong></p>`;
    html += `<p>Fixing these saves about ${e(formatDollars(m.saved_if_fixed, cur))} a month`;
    if (m.percent !== undefined && m.bill_per_month !== undefined) html += ` (about ${e(m.percent.toFixed(1))}% of an estimated ${e(formatDollars(m.bill_per_month, cur))} monthly bill)`;
    html += `.`;
    if (m.questions_per_month !== undefined) html += ` If the open questions hold, add about ${e(formatDollars(m.questions_per_month, cur))} a month.`;
    if (m.server_per_month !== undefined) html += ` ${e(`The questions for the server's administrator, if they hold, are about ${formatDollars(m.server_per_month, cur)} a month more.`)}`;
    if (m.saved_by_fixes !== undefined) html += ` The fixes already made save about ${e(formatDollars(m.saved_by_fixes, cur))} a month.`;
    if (cur) html += ` ${e(`Prices are in ${cur}, as given in leanprompt.yaml; leanprompt does not convert them.`)}`;
    html += `</p>`;
  }
  if (cost.gpu) {
    const h = cost.gpu.hours_per_month;
    html += `<p class="big"><strong>About ${e(h.toFixed(1))} ${h === 1 ? "hour" : "hours"} of GPU prefill time a month</strong> at ${e(cost.gpu.calls_per_month.toLocaleString("en-US"))} calls a month and ${e(cost.gpu.prefill_tokens_per_second.toLocaleString("en-US"))} prefill tokens a second.</p>`;
  }
  html += `<p class="muted">Every figure here is ${e(tokenKind(cost))}. ${cost.overlaps ? "Findings the audit marked as overlapping are counted once in the totals, the largest of each group; other findings can still overlap." : "Findings can overlap (one failed call can show up in two), so the sum may count some tokens twice."} Money is not part of the score. ${e("The table lists this app's findings first, largest first, then its open questions, then the questions for the server's administrator, then the findings the project already knows about, which are not in the totals.")}</p>`;
  // The inputs, so every figure can be checked by hand.
  const live = cost.rows.filter((x) => !x.finding.fixed);
  const units = new Set(live.map((r) => r.unit));
  const tokHead = units.size > 1 ? "Tokens (per 1,000 calls, or per run where marked)" : units.has("run") ? "Tokens per run" : "Tokens per 1,000 calls";
  if (units.has("run")) html += `<p class="muted">${e(`A run is ${o_run(cost)}. Per-run figures are a separate total, never added to the figures per 1,000 calls.`)}</p>`;
  if (cost.dollars_per_run !== undefined) html += `<p class="big"><strong>${e(`About ${formatDollars(cost.dollars_per_run)} per run`)}</strong> at the prices below.</p>`;
  html += `<div class="tablewrap"><table><thead><tr><th>Finding</th><th>Where</th><th class="fig">${e(tokHead)}</th>${m ? `<th class="fig">A month</th>` : ""}${cost.rows.some((r) => r.ttft_seconds !== undefined) ? `<th class="fig">First-token time</th>` : ""}</tr></thead><tbody>`;
  for (const r of cost.rows.filter((x) => !x.finding.fixed)) {
    const t = tokensLost(r.finding)!;
    const parts = [t.prompt ? `${formatTokens(t.prompt)} prompt` : "", t.uncached ? `${formatTokens(t.uncached)} not cached` : "", t.output ? `${formatTokens(t.output)} output` : ""].filter(Boolean).join(", ");
    const write = t.cache_write ? `; the fix writes ${formatTokens(t.cache_write)} to the cache at the write price` : "";
    const per = units.size > 1 && r.unit === "run" ? " per run" : "";
    const counted = r.finding.evidence === "counted" ? " (counted)" : "";
    const tag = r.group === "question" ? " (open question)" : r.group === "server" ? " (server)" : r.group === "known" ? ` (${KNOWN_LABEL[knownOf(r.finding)!.kind].toLowerCase()})` : "";
    const scope = r.finding.scope ? ` (${SCOPE_LABEL[r.finding.scope]})` : "";
    html += `<tr><td class="rule">${e(r.finding.rule)}${e(tag + scope)}</td><td class="loc">${location(r.finding)}</td><td class="fig tok">${e((parts || "0") + per + counted + write)}</td>`;
    if (m) html += `<td class="fig mon">${r.dollars_per_month !== undefined ? e(formatDollars(r.dollars_per_month, m.currency)) : r.dollars_per_run !== undefined ? e(`${formatDollars(r.dollars_per_run)} per run`) : ""}</td>`;
    if (cost.rows.some((x) => x.ttft_seconds !== undefined)) html += `<td class="fig ttft">${r.ttft_seconds !== undefined ? `+${e(r.ttft_seconds.toFixed(2))} s` : ""}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  const inputs: string[] = [];
  if (m) {
    inputs.push(`Volume: ${e(m.calls_per_month.toLocaleString("en-US"))} calls a month${m.volume_source ? `, from ${e(m.volume_source)}` : ""}.`);
    for (const { model, price } of m.prices) {
      const usd = (v: number): string => formatPrice(v, price.currency);
      const bits = [`input ${usd(price.input)}`, price.cached_input !== undefined ? `cached input ${usd(price.cached_input)}` : "", price.cache_write !== undefined ? `cache write ${usd(price.cache_write)}` : "", `output ${usd(price.output)}`].filter(Boolean).join(", ");
      inputs.push(`Price of <code>${e(model)}</code>: ${e(bits)} per 1M tokens, from ${e(price.source)}, checked ${e(price.checked)}.`);
    }
    if (cost.average_call && m.bill_per_month !== undefined) {
      inputs.push(`Average call, as the audit assumed: ${e(cost.average_call.prompt_tokens.toLocaleString("en-US"))} prompt and ${e(cost.average_call.output_tokens.toLocaleString("en-US"))} output tokens; the bill leaves cache discounts out.`);
    }
  } else if (cost.gpu) {
    inputs.push(`Volume: ${e(cost.gpu.calls_per_month.toLocaleString("en-US"))} calls a month; prefill throughput ${e(cost.gpu.prefill_tokens_per_second.toLocaleString("en-US"))} tokens a second, from <code>leanprompt.yaml</code>.`);
  }
  if (inputs.length) html += `<ul class="inputs">${inputs.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  if (cost.missing.length > 0) {
    html += `<p>To see this in money, add to <code>leanprompt.yaml</code>:</p><ul class="missing">${cost.missing.map((x) => `<li><code>${e(x.split("\t")[0])}</code>: ${e(x.split("\t")[1] ?? "")}</li>`).join("")}</ul>`;
    html += `<p class="muted">leanprompt never guesses a volume or a price. Your coding agent can look up the provider's current price page and add it with the date; <a href="${REPO}/blob/v${version}/docs/profile.md">how</a>.</p>`;
  }
  return `${html}</section>`;
}

/** Split text after its first sentence (a full stop, question mark or colon followed by a space and a capital). */
export function splitLead(text: string): [string, string] {
  const m = /^(.+?[.?])\s+(?=[A-Z"(])/.exec(text);
  return m ? [m[1]!, text.slice(m[0].length)] : [text, ""];
}

function card(f: Finding, i: number, o: ReportInput, version: string, kind: "open" | "question" | "server" | "known" | "fixed", num: Map<string, number> = new Map()): string {
  const link = ruleLink(f, o.rules, version);
  const title = ruleTitle(f, o.rules);
  let html = `<article class="finding sev-${f.severity}${f.fixed ? " fixed" : ""}" data-where="${e(whereText(f))}" id="f${i + 1}">`;
  html += `<div class="num" aria-hidden="true">${i + 1}</div><div class="body">`;
  // The first sentence of the problem is the card's heading; the rest follows it as text.
  const [lead, rest] = f.problem ? splitLead(f.problem) : [title, ""];
  html += `<h3>${e(lead)}</h3>`;
  const freq = f.status === "frequency-unknown" ? ` <span class="flag">how often is assumed</span>` : f.status === "size-unknown" ? ` <span class="flag">size is assumed</span>` : "";
  const unconfirmed = f.status === "needs-facts" && kind !== "question" ? ` <span class="flag">unconfirmed</span>` : "";
  const scope = f.scope ? ` <span class="flag scope">${e(SCOPE_LABEL[f.scope])}</span>` : "";
  html += `<p class="meta"><span class="visually-hidden">Finding ${i + 1}. </span>${location(f)} <span class="sev">${e(f.severity)}</span> <span class="rid">${e(f.rule)}</span>${f.fixed ? ` <span class="tag">fixed</span>` : ""}${freq}${unconfirmed}${scope}</p>`;
  if (rest) html += `<p class="rest">${e(rest)}</p>`;
  const estimate = f.estimate ?? tokensPhrase(f);
  const counted = f.evidence === "counted";
  const asks = kind === "question" || (kind === "server" && f.status === "needs-facts");
  const dl: [string, string, string | undefined][] = [
    ["act", asks ? "Change, if confirmed" : "What to change", f.change],
    ["why", "Why it matters", f.why],
  ];
  if (asks) dl.unshift(["act confirm", kind === "server" ? "What would answer it" : "To confirm", f.confirm]);
  else if (f.status === "frequency-unknown") dl.push(["why freq", "How often it happens", `The code shows the problem; how often it happens is assumed. To measure it: ${f.confirm ?? ""}`]);
  else if (f.status === "size-unknown") dl.push(["why freq", "How big it is", `The code shows the problem and how often it happens; how many tokens it costs each time is assumed. To measure it: ${f.confirm ?? ""}`]);
  if (f.reach) dl.push(["why reach", "Who reaches this", f.reach]);
  if (f.cached_discount === "none") dl.push(["why nodiscount", "Money", NO_DISCOUNT_LINE]);
  const k = knownOf(f);
  if (k) dl.push(["why planned", KNOWN_LABEL[k.kind], knownLine(f)]);
  const others = (f.overlaps ?? []).map((id) => num.get(id)).filter((x): x is number => x !== undefined);
  if (others.length) dl.push(["why overlap", "Overlaps", `Finding ${others.join(", ")} loses some of the same tokens; the totals count the larger once.`]);
  const rows = dl.filter(([, , v]) => v).map(([c, k, v]) => `<div class="${c}"><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`);
  if (estimate || f.assumptions) {
    let dd = estimate ? `<span class="est">${e(estimate)}</span>` : "";
    if (counted && f.counted_from) dd += ` <span class="muted">${e(`Counted from ${f.counted_from}.`)}</span>`;
    if (f.assumptions) dd += `<details class="assume"><summary>${counted ? "What the count leaves out" : "What the estimate assumes"}</summary><p>${e(f.assumptions)}</p></details>`;
    rows.push(`<div class="estimate"><dt>${counted ? "Counted" : "Estimate"}</dt><dd>${dd}</dd></div>`);
  }
  if (rows.length) html += `<dl class="why">${rows.join("")}</dl>`;
  else html += `<p class="muted">The audit wrote no explanation for this one; the rule page explains it.</p>`;
  if (f.verify || f.problem || link) {
    html += `<footer class="check">`;
    if (f.verify) html += `<p><span class="k">How to check the fix</span> ${e(f.verify)}</p>`;
    if (f.problem || link) {
      html += `<p class="rulelink">${f.problem ? `Rule: ${e(title)}.` : ""}${link ? ` <a href="${e(link)}">How this rule works</a>` : ""}</p>`;
    }
    html += `</footer>`;
  }
  return `${html}</div></article>`;
}

/** The number each finding with an id has on the page (open, questions, server, known, fixed, in that order). */
function numbering(g: Groups): Map<string, number> {
  const m = new Map<string, number>();
  [...g.open, ...g.questions, ...g.server, ...g.known, ...g.fixed].forEach((f, i) => f.id !== undefined && m.set(f.id, i + 1));
  return m;
}

function findingsSection(o: ReportInput, g: Groups, version: string): string {
  const all = g.open.length + g.questions.length;
  const num = numbering(g);
  let html = `<section class="findings" id="s-findings"><h2>${e("What's wrong and what to change")}</h2><p class="muted">${all} open, ${g.server.length > 0 ? e(`${g.server.length} for the server's administrator, `) : ""}${g.known.length > 0 ? e(`${g.known.length} already known to the project, `) : ""}${g.fixed.length} fixed`;
  if (o.ignored) html += `, ${o.ignored} ignored by the profile`;
  html += `. Largest first, by the audit's estimate of tokens lost per 1,000 calls${g.open.some((f) => unitOf(f) === "run") ? ", then per run" : ""}.</p>`;
  html += g.open.map((f, i) => card(f, i, o, version, "open", num)).join("");
  if (g.open.length === 0) html += `<p>No confirmed findings.</p>`;
  html += `</section>`;
  if (g.questions.length > 0) {
    html += `<section class="findings" id="s-questions"><h2>Open questions</h2><p class="muted">Findings outside this repository, or whose behaviour the code cannot show. They still count in the score. Each says what to confirm.</p>`;
    html += g.questions.map((f, i) => card(f, g.open.length + i, o, version, "question", num)).join("");
    html += `</section>`;
  }
  if (g.server.length > 0) {
    html += `<section class="findings" id="s-server"><h2>${e("Questions for the server's administrator")}</h2>`;
    html += `<p class="muted">${e("These are about the server or engine the app calls (its launch settings, its cache, its replicas), not this app's code, so they are not in this app's score;")} <code>npx leanprompt score --with-server</code> counts them. Each says what would answer it. For an LM Warden server, <code>npx leanprompt profile detect --lmwarden &lt;url&gt;</code> reads the engine&#39;s cache facts (block size, match unit, speculative decoding) into <code>leanprompt.yaml</code>.</p>`;
    html += g.server.map((f, i) => card(f, all + i, o, version, "server", num)).join("");
    html += `</section>`;
  }
  html += knownSection(o, g, version, num);
  html += notesSection(o.notes ?? [], o, version, num);
  if (g.fixed.length > 0) {
    const start = all + g.server.length + g.known.length;
    html += `<section class="findings" id="s-fixed"><details class="fixed-list"><summary><h2>${e(plural(g.fixed.length, "fixed finding"))}</h2></summary>`;
    html += g.fixed.map((f, i) => card(f, start + i, o, version, "fixed", num)).join("");
    html += `</details></section>`;
  }
  return html;
}

/**
 * Findings the project already knows about, from its tracker or docs: planned, in progress or reported as cards with
 * the link; declined ones as one line each with the link, and no proposed change. Not in the totals or the score.
 */
function knownSection(o: ReportInput, g: Groups, version: string, num: Map<string, number>): string {
  if (g.known.length === 0) return "";
  const start = g.open.length + g.questions.length + g.server.length;
  const live = g.known.filter((f) => knownOf(f)!.kind !== "declined");
  const declined = g.known.filter((f) => knownOf(f)!.kind === "declined");
  let html = `<section class="findings known" id="s-known"><h2>Already known to the project</h2>`;
  html += `<p class="muted">${e("The project's own issues, pull requests or docs already cover these, so they are not new and are not in the totals or the score. Read the link before working on one.")}</p>`;
  html += live.map((f, i) => card(f, start + i, o, version, "known", num)).join("");
  if (declined.length) {
    html += `<h3>Declined by the project</h3><ul class="declined">`;
    declined.forEach((f, i) => {
      const k = knownOf(f)!;
      const lead = f.problem ? splitLead(f.problem)[0] : ruleTitle(f, o.rules);
      html += `<li id="f${start + live.length + i + 1}">${e(lead)} ${location(f)}${k.url ? ` <a href="${e(k.url)}">${e(k.url)}</a>` : ""}</li>`;
    });
    html += `</ul>`;
  }
  return `${html}</section>`;
}

/** Where a note is: `file:line`, or for an `<external>` one just that. */
export const noteWhere = (n: Note): string => (n.file === EXTERNAL ? "outside the repository" : n.line > 0 ? `${n.file}:${n.line}` : n.file);

/** Verified correctness problems on the LLM paths: outside the rules, or under a correctness rule (LP-GE-11). Never scored. */
function notesSection(notes: Note[], o?: ReportInput, version?: string, num: Map<string, number> = new Map()): string {
  if (notes.length === 0) return "";
  let html = `<section class="findings notes" id="s-notes"><h2>Other problems the audit found</h2>`;
  html += `<p class="muted">Problems the audit checked in the code that cost no tokens of their own, such as a spend meter that ignores cache tokens or a cut-off answer accepted as complete. They are not scored. Check each one before you change anything.</p>`;
  notes.forEach((n, i) => {
    if (n.known?.kind === "declined") {
      // The project has said no: the title, where, and the link, without a proposed change.
      html += `<article class="finding note declined" id="n${i + 1}"><div class="num" aria-hidden="true">N${i + 1}</div><div class="body"><h3>${e(n.title)}</h3>`;
      html += `<p class="meta">${n.file === EXTERNAL ? e(noteWhere(n)) : `<code>${e(noteWhere(n))}</code>`} <span class="flag">${e(KNOWN_LABEL.declined.toLowerCase())}</span></p>`;
      html += `<p class="rest">${e(n.known.note ?? KNOWN_LABEL.declined)}${n.known.url ? ` <a href="${e(n.known.url)}">${e(n.known.url)}</a>` : ""}</p></div></article>`;
      return;
    }
    html += `<article class="finding note" data-where="${e(noteWhere(n))}" id="n${i + 1}"><div class="num" aria-hidden="true">N${i + 1}</div><div class="body">`;
    const rid = n.rule ? ` <span class="rid">${e(n.rule)}</span>${n.severity ? ` <span class="sev">${e(n.severity)}</span>` : ""}` : "";
    const nscope = n.scope ? ` <span class="flag scope">${e(SCOPE_LABEL[n.scope])}</span>` : "";
    html += `<h3>${e(n.title)}</h3><p class="meta"><span class="visually-hidden">Note ${i + 1}. </span>${n.file === EXTERNAL ? e(noteWhere(n)) : `<code>${e(noteWhere(n))}</code>`}${rid} <span class="flag">not scored</span>${nscope}</p>`;
    html += `<p class="rest">${e(n.problem)}</p>`;
    const rows: [string, string, string | undefined][] = [["act", "What to change", n.change], ["why", "Why it matters", n.why]];
    html += `<dl class="why">${rows.filter(([, , v]) => v).map(([c, k, v]) => `<div class="${c}"><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}`;
    const fnum = n.finding !== undefined ? num.get(n.finding) : undefined;
    if (fnum !== undefined) html += `<div class="why"><dt>Same problem as</dt><dd><a href="#f${fnum}">finding ${fnum}</a></dd></div>`;
    if (n.known) html += `<div class="why planned"><dt>${e(KNOWN_LABEL[n.known.kind])}</dt><dd>${e([n.known.note, n.known.url].filter(Boolean).join(" "))}</dd></div>`;
    html += `</dl>`;
    const link = n.rule && o && version ? ruleLink({ rule: n.rule } as Finding, o.rules, version) : undefined;
    if (n.verify || link) {
      html += `<footer class="check">`;
      if (n.verify) html += `<p><span class="k">How to check the fix</span> ${e(n.verify)}</p>`;
      if (link) html += `<p class="rulelink">Rule: ${e(o!.rules.get(n.rule!)?.title ?? n.rule!)}. <a href="${e(link)}">How this rule works</a></p>`;
      html += `</footer>`;
    }
    html += `</div></article>`;
  });
  return `${html}</section>`;
}

/** Questions only the owner can answer, still open (an unattended audit, or nobody answered): the same list as the Markdown report. */
function ownerSection(o: ReportInput, cost: CostSummary): string {
  const q = ownerQuestions(o.profile ?? null, cost, o.priority);
  if (q.length === 0) return "";
  const code = (t: string) => e(t).replace(/`([^`]+)`/g, "<code>$1</code>");
  let html = `<section class="owner" id="s-owner"><h2>Questions for the owner</h2>`;
  html += `<p class="muted">${e("These were not answered during the audit. Until they are, the page shows tokens only and ranks the advice without a priority.")}</p><ul>`;
  html += q.map((x) => `<li><strong>${e(x.label)}:</strong> ${code(x.text)}</li>`).join("");
  return `${html}</ul></section>`;
}

const NPX_BARE = "npx leanprompt";

/**
 * The block a user pastes into their coding agent: self-contained instructions plus the open findings, the
 * questions for the server's administrator and the notes. With `version`, the commands name that version
 * (`npx leanprompt@<version>`), so the skills installed match the CLI that wrote the page.
 */
export function handoffText(findings: Finding[], rules: Map<string, RuleInfo>, opts: { notes?: Note[]; version?: string } = {}): string {
  const g = groups(findings);
  const NPX = opts.version ? `npx leanprompt@${opts.version}` : NPX_BARE;
  const lines = [
    "Please check and fix the LLM-call findings from a leanprompt audit of this repository.",
    "",
    `1. If the leanprompt skills are not installed for you here, install them: ${NPX} install`,
    "2. Read .leanprompt/findings.json and leanprompt-report.md. If they are missing, use the list below.",
    "3. Check each finding against the code before you change anything. The audit can be wrong: if a finding does not hold, tell me why and leave that code alone.",
    "4. Fix one finding at a time. Show me the change as a small diff and apply it only after I say yes.",
    "5. Prove each fix with the measure-loop skill: a before and after on the same scenario. Ask me before running anything that sends real, billed requests.",
    `6. When a fix is proved, set "fixed": true on its finding in .leanprompt/findings.json and run ${NPX} score.`,
  ];
  if (g.open.length > 0) {
    lines.push("", "Findings, largest first:");
    g.open.forEach((f, i) => lines.push(`${i + 1}. ${f.rule} at ${whereText(f)}${f.scope ? ` [${SCOPE_LABEL[f.scope]}]` : ""}: ${f.problem ?? ruleTitle(f, rules)}`));
  }
  // Declined findings are left out: the project has said no, so they are not work to do.
  const live = g.known.filter((f) => knownOf(f)!.kind !== "declined");
  if (live.length > 0) {
    lines.push("", "Already known to the project (read the link first; do not duplicate work the project has planned or started):");
    for (const f of live) lines.push(`- ${f.rule} (${whereText(f)}): ${f.problem ?? ruleTitle(f, rules)} ${KNOWN_LABEL[knownOf(f)!.kind]}: ${knownLine(f)}`);
  }
  if (g.questions.length > 0) {
    lines.push("", "Open questions (confirm before fixing):");
    for (const f of g.questions) lines.push(`- ${f.rule} (${whereText(f)}): ${f.problem ?? ruleTitle(f, rules)}${f.confirm ? ` To confirm: ${f.confirm}` : ""}`);
  }
  if (g.server.length > 0) {
    lines.push("", "Questions for the server's administrator (not this app's code; do not change the app for these):");
    for (const f of g.server) lines.push(`- ${f.rule} (${whereText(f)}): ${f.problem ?? ruleTitle(f, rules)}${f.confirm ? ` What would answer it: ${f.confirm}` : ""}`);
  }
  const notes = (opts.notes ?? []).filter((n) => n.known?.kind !== "declined");
  if (notes.length > 0) {
    lines.push("", "Other problems found (check each against the code first; not scored):");
    for (const n of notes) lines.push(`- ${n.title} (${noteWhere(n)})${n.rule ? ` [${n.rule}]` : ""}${n.scope ? ` [${SCOPE_LABEL[n.scope]}]` : ""}: ${n.problem} Change: ${n.change}`);
  }
  return lines.join("\n");
}

function copyButton(id: string, label = "Copy"): string {
  return `<button type="button" class="copy" data-copy="${id}" data-label="${e(label)}" hidden>${e(label)}</button>`;
}

function handoffSection(o: ReportInput): string {
  let html = `<section class="handoff" id="s-fix"><h2>Fix it with your coding agent</h2>`;
  html += `<p>Paste this into Claude Code, Codex, Cursor or any coding assistant. It will check each finding against your code and propose fixes one at a time, asking before it changes anything.</p>`;
  html += `<div class="copybox">${copyButton("handoff", "Copy for your agent")}<pre id="handoff" tabindex="0">${e(handoffText(o.findings, o.rules, { notes: o.notes ?? [], version: o.version ?? packageVersion() }))}</pre></div>`;
  return `${html}</section>`;
}

/** Whether the page has shown something worth passing on: an estimate, or a measured score. */
function worthSharing(o: ReportInput): boolean {
  return o.findings.some((f) => f.estimate || tokensLost(f)) || (o.score?.kind === "measured" && num(o.score.score) !== undefined);
}

/** A short, plain message a user can send a colleague. */
export function shareText(findings: Finding[], score: ScoreFile | null, profile: Profile | null = null): string {
  const g = groups(findings);
  const cost = costSummary(findings, profile);
  let what: string;
  const places = costly(g);
  if (places.length > 0) {
    what = `leanprompt checked how our app calls LLMs and found ${plural(places.length, "place")} where it pays for tokens it doesn't need`;
    if (cost.with_tokens > 0) what += `, about ${formatTokens(cost.tokens_per_1k)} tokens per 1,000 calls, ${cost.measured ? `measured over ${cost.measured_calls} calls` : "an estimate from the code"}`;
    else if (cost.run_with_tokens > 0) what += `, about ${formatTokens(cost.run_tokens)} tokens per run, ${cost.counted === cost.total_rows ? "counted from its own output" : "an estimate from the code"}`;
    else if (places[0]!.estimate) what += `; the largest is ${places[0]!.estimate}, an estimate from the code`;
    what += ".";
  } else if (g.fixed.length > 0) {
    what = `leanprompt checked how our app calls LLMs; we fixed the ${plural(g.fixed.length, "place")} where it paid for tokens it didn't need.`;
  } else if (score?.kind === "measured" && num(score.score) !== undefined) {
    what = `leanprompt measured how our app's LLM calls reuse the provider's cache: score ${score.score} over ${num(score.calls) ?? "its logged"} calls.`;
  } else what = "leanprompt checked how our app calls LLMs.";
  return `${what} It explains each finding in plain English and hands the fixes to your coding agent. It is free, open source, and runs locally: ${REPO}`;
}

/** Git facts for the badge, read locally by the command (no network). */
export interface GitInfo {
  remote?: string;
  branch?: string;
  /** Whether `.leanprompt/score.json` is tracked by git. */
  scoreTracked?: boolean;
}

/**
 * The raw URL of `.leanprompt/score.json` on a public git host (GitHub, GitLab.com, Bitbucket), from
 * `git remote get-url origin` and the current branch. Null for any other host, or no branch.
 * Credentials in the remote URL are dropped.
 */
export function rawScoreUrl(remote: string, branch: string): string | null {
  if (!branch || branch === "HEAD") return null;
  const m =
    /^(?:[\w.-]+@)?(github\.com|gitlab\.com|bitbucket\.org):(.+?)(?:\.git)?\/?$/.exec(remote) ??
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?(github\.com|gitlab\.com|bitbucket\.org)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(remote);
  if (!m) return null;
  const [, host, path] = m;
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path!)) return null;
  const br = branch.split("/").map(encodeURIComponent).join("/");
  const file = ".leanprompt/score.json";
  if (host === "github.com") return /^[\w.-]+\/[\w.-]+$/.test(path!) ? `https://raw.githubusercontent.com/${path}/${br}/${file}` : null;
  if (host === "gitlab.com") return `https://gitlab.com/${path}/-/raw/${br}/${file}`;
  return /^[\w.-]+\/[\w.-]+$/.test(path!) ? `https://bitbucket.org/${path}/raw/${br}/${file}` : null;
}

function badgeBlock(o: ReportInput): string {
  let html = `<h3>The README badge</h3>`;
  if (!o.score || num(o.score.score) === undefined) {
    return `${html}<p class="muted">The badge shows your score. Run <code>npx leanprompt score</code> first; it writes <code>.leanprompt/score.json</code>, which the badge reads.</p>`;
  }
  const raw = o.git?.remote && o.git.branch ? rawScoreUrl(o.git.remote, o.git.branch) : null;
  if (!raw) {
    return `${html}<p class="muted">The badge needs a public repository on GitHub, GitLab.com or Bitbucket with <code>.leanprompt/score.json</code> committed: shields.io reads the file from there. This repository's remote is not one of those, so there is no snippet to paste.</p>`;
  }
  const md = `![leanprompt](https://img.shields.io/endpoint?url=${encodeURIComponent(raw)})`;
  html += `<p>It shows your ${o.score.kind === "measured" ? "measured" : "static (estimated, grey)"} score, read from your own committed <code>.leanprompt/score.json</code>. Anyone can rerun it: there is no hosted service.`;
  if (!o.git?.scoreTracked) html += ` Commit <code>.leanprompt/score.json</code> first, or the badge has nothing to read.`;
  html += ` It works once the repository is public.</p>`;
  html += `<div class="copybox">${copyButton("badge")}<pre id="badge" tabindex="0">${e(md)}</pre></div>`;
  return html;
}

function shareSection(o: ReportInput): string {
  if (!worthSharing(o)) return "";
  let html = `<section class="share" id="s-share"><h2>If this helped</h2>`;
  html += `<p>If this page saved you some digging, a star or a word to a colleague helps other builders find it.</p>`;
  html += `<p><a class="star" href="${REPO}">Star leanprompt on GitHub</a></p>`;
  html += `<h3>A message for a colleague</h3><div class="copybox">${copyButton("share")}<pre id="share" tabindex="0">${e(shareText(o.findings, o.score, o.profile ?? null))}</pre></div>`;
  html += badgeBlock(o);
  return `${html}</section>`;
}

const COPY_SCRIPT = `<script>
document.querySelectorAll("button[data-copy]").forEach(function (b) {
  if (!navigator.clipboard) return;
  var live = document.getElementById("copy-status");
  var label = b.getAttribute("data-label") || "Copy";
  b.hidden = false;
  b.addEventListener("click", function () {
    var text = document.getElementById(b.getAttribute("data-copy")).textContent;
    navigator.clipboard.writeText(text).then(function () {
      b.textContent = "Copied";
      if (live) live.textContent = "Copied to the clipboard.";
      setTimeout(function () { b.textContent = label; if (live) live.textContent = ""; }, 2000);
    }, function () {
      b.textContent = "Select the text to copy it";
      if (live) live.textContent = "Copying failed. Select the text to copy it.";
    });
  });
});
</script>`;

/** The section index for wide screens: short labels, with counts, linking to the sections in order. */
function navRail(o: ReportInput, g: Groups, cost: CostSummary): string {
  const items: [string, string, string][] = [["s-top", "Summary", ""]];
  if (cost.rows.some((r) => !r.finding.fixed)) items.push(["s-cost", "Cost", ""]);
  items.push(["s-findings", "Findings", String(g.open.length)]);
  if (g.questions.length > 0) items.push(["s-questions", "Questions", String(g.questions.length)]);
  if (g.server.length > 0) items.push(["s-server", "For the server", String(g.server.length)]);
  if (g.known.length > 0) items.push(["s-known", "Already known", String(g.known.length)]);
  if ((o.notes ?? []).length > 0) items.push(["s-notes", "Other problems", String(o.notes!.length)]);
  if (g.fixed.length > 0) items.push(["s-fixed", "Fixed", String(g.fixed.length)]);
  items.push(["s-fix", "Hand-off to your agent", ""], ["s-score", "Score", o.score && num(o.score.score) !== undefined ? String(o.score.score) : ""]);
  if (ownerQuestions(o.profile ?? null, cost, o.priority).length > 0) items.push(["s-owner", "For the owner", ""]);
  if (worthSharing(o)) items.push(["s-share", "Share", ""]);
  const li = items.map(([id, label, n]) => `<li><a href="#${id}"><span>${e(label)}</span>${n ? `<span class="c">${e(n)}</span>` : ""}</a></li>`).join("");
  return `<nav class="rail" aria-label="Sections"><p class="mark">leanprompt</p><p class="proj">${e(o.project)}</p><ul>${li}</ul></nav>`;
}

/** One self-contained HTML document: inline CSS, one inline copy script, no network. */
export function renderReport(o: ReportInput): string {
  const version = o.version ?? packageVersion();
  const g = groups(o.findings);
  const cost = costSummary(o.findings, o.profile ?? null, o.average_call, o.run);
  const body =
    headline(o, g, cost) +
    costSection(cost, version) +
    findingsSection(o, g, version) +
    handoffSection(o) +
    scoreSection(o.score, o.kvsig) +
    ownerSection(o, cost) +
    shareSection(o);
  const footer = `<footer class="page-foot muted">Made by leanprompt ${e(version)}, by the LM Warden Team, on your machine; this page loads nothing from the network. <a href="${REPO}">${REPO}</a></footer>`;
  return readFileSync(TEMPLATE, "utf8")
    .replace("{{TITLE}}", () => `leanprompt report: ${e(o.project)}`)
    .replace("{{NAV}}", () => navRail(o, g, cost))
    .replace("{{BODY}}", () => body)
    .replace("{{FOOTER}}", () => footer)
    .replace("{{SCRIPT}}", () => COPY_SCRIPT);
}

/** Local git facts for the badge: the origin remote, the current branch, and whether score.json is tracked. No network. */
export function readGit(dir: string): GitInfo | undefined {
  const git = (...a: string[]): string | undefined => {
    try {
      return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return undefined;
    }
  };
  if (git("rev-parse", "--is-inside-work-tree") !== "true") return undefined;
  const info: GitInfo = { scoreTracked: git("ls-files", "--error-unmatch", "--", ".leanprompt/score.json") !== undefined };
  const remote = git("remote", "get-url", "origin");
  const branch = git("symbolic-ref", "--short", "-q", "HEAD");
  if (remote) info.remote = remote;
  if (branch) info.branch = branch;
  return info;
}

export function readScore(file: string): ScoreFile | null {
  if (!existsSync(file)) return null;
  try {
    const d: unknown = JSON.parse(readFileSync(file, "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? (d as ScoreFile) : null;
  } catch {
    return null;
  }
}

/** `leanprompt report --html|--md [--out <file>] [--project <name>] [--dir <project>]` */
export async function reportCommand(args: string[]): Promise<number> {
  let values: { html?: boolean; md?: boolean; out?: string; dir?: string; project?: string };
  try {
    values = parseArgs({ args, options: optionsFor("report"), strict: true }).values;
  } catch (err) {
    process.stderr.write(`leanprompt: ${(err as Error).message}\n`);
    return 2;
  }
  if (!values.html && !values.md) {
    process.stderr.write("leanprompt: use --html (the page), --md (leanprompt-report.md), or both\n");
    return 2;
  }
  if (values.html && values.md && values.out !== undefined) {
    process.stderr.write("leanprompt: --out names one file; with both --html and --md, leave it out (they go to .leanprompt/report.html and leanprompt-report.md)\n");
    return 2;
  }
  if (values.project !== undefined && values.project.trim() === "") {
    process.stderr.write("leanprompt: --project needs a name\n");
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  let findings: Finding[] = [];
  let ignored = 0;
  let average_call: AverageCall | undefined;
  let kvsig: KvsigUse | undefined;
  let notes: Note[] | undefined;
  let unattended: boolean | undefined;
  let gateway: boolean | undefined;
  let run: string | undefined;
  const profile = loadProfile(dir);
  const fpath = join(dir, FINDINGS_FILE);
  if (existsSync(fpath)) {
    const parsed = parseFindings(readFileSync(fpath, "utf8"), loadRuleIds(PACKAGE_ROOT), loadNoteRuleIds(PACKAGE_ROOT));
    if (parsed.errors.length > 0) throw new Error(`${fpath}: ${parsed.errors.join("; ")}`);
    findings = filterIgnored(parsed.findings, profile);
    ignored = parsed.findings.length - findings.length;
    average_call = parsed.average_call;
    kvsig = parsed.kvsig;
    notes = parsed.notes;
    unattended = parsed.unattended;
    gateway = parsed.gateway;
    run = parsed.run;
    // Private items never reach the page or the Markdown report: only the local list.
    const priv = writePrivateList(dir, parsed);
    if (priv) process.stdout.write(`${priv} (private items: do not publish)\n`);
  }
  const priority = rawPriority(dir);
  const input: ReportInput = {
    findings,
    ignored,
    score: readScore(join(dir, SCORE_FILE)),
    rules: loadRules(PACKAGE_ROOT),
    project: values.project?.trim() ?? projectName(dir),
    profile,
    ...(average_call ? { average_call } : {}),
    ...(kvsig ? { kvsig } : {}),
    ...(notes ? { notes } : {}),
    ...(unattended ? { unattended } : {}),
    ...(gateway ? { gateway } : {}),
    ...(run !== undefined ? { run } : {}),
    ...(priority !== undefined ? { priority } : {}),
    git: readGit(dir),
  };
  if (values.md) {
    const target = resolve(dir, values.html ? MD_FILE : (values.out ?? MD_FILE));
    const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
    const text = spliceReport(existing, renderMarkdown(input, { date: localDate(), ...(priority !== undefined ? { priority } : {}) }));
    if (text === null) {
      process.stderr.write(`leanprompt: ${target} exists and was not written by report --md (it has no generated block); move it aside or pass --out <file>\n`);
      return 1;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    process.stdout.write(`${target}\n`);
  }
  if (values.html) {
    const target = resolve(dir, values.out ?? DEFAULT_OUT);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderReport(input));
    process.stdout.write(`${target}\n`);
  }
  return 0;
}
