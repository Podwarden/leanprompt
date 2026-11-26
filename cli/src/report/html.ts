import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDoc } from "../frontmatter.js";
import { optionsFor } from "../help.js";
import { REPO } from "../forms.js";
import { loadRuleIds, ruleFiles } from "../lint/rules.js";
import { loadProfile, type Profile } from "../profile.js";
import { EXTERNAL, isOpenQuestion, parseFindings, type AverageCall, type Finding, type Severity } from "../score/static.js";
import { costSummary, formatDollars, formatTokens, type CostSummary } from "./cost.js";
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
  diagnostics?: { estimate?: string; default_shares?: number; findings?: number };
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
  /** Local git facts for the badge snippet. */
  git?: GitInfo;
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
    return `<section class="score-sec" id="s-score"><h2>Score</h2><p class="card">No score yet: run <code>npx leanprompt score</code></p></section>`;
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
  if (measured) {
    html += `<p class="muted">Reusable tokens are estimated from the character share of each prompt part, not counted by the provider.</p>`;
  } else {
    html += `<p class="muted">A static score is an estimate from the audit's findings, not a measurement.</p>`;
  }
  if (typeof score.date === "string") html += `<p class="muted">Scored ${e(score.date)}.</p>`;
  html += `</div></section>`;
  return html;
}

/** Where a finding is, as plain text: `file:line`, or for an `<external>` one its `where` text. */
function whereText(f: Finding): string {
  if (f.file === EXTERNAL) return `${f.where ?? EXTERNAL}${f.line > 0 ? ` (line ${f.line})` : ""}`;
  return `${f.file}:${f.line}`;
}

/** Where a finding is, as HTML. */
function location(f: Finding): string {
  if (f.file === EXTERNAL) return e(whereText(f));
  return `<code>${e(whereText(f))}</code>`;
}

const tokensOf = (f: Finding): number | undefined =>
  f.tokens_per_1k ? (f.tokens_per_1k.prompt ?? 0) + (f.tokens_per_1k.uncached ?? 0) + (f.tokens_per_1k.output ?? 0) : undefined;

/**
 * Rank: open before fixed; findings with token numbers before those without, largest first; then severity
 * high to low, estimated share (when given) high to low, then file:line.
 */
export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      Number(!!a.fixed) - Number(!!b.fixed) ||
      (tokensOf(b) ?? -1) - (tokensOf(a) ?? -1) ||
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      (b.share ?? 0) - (a.share ?? 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line,
  );
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const ruleTitle = (f: Finding, rules: Map<string, RuleInfo>): string => rules.get(f.rule)?.title ?? f.rule;
const ruleLink = (f: Finding, rules: Map<string, RuleInfo>, version: string): string | undefined => {
  const r = rules.get(f.rule);
  return r ? `${REPO}/blob/v${version}/skills/${r.skill}/rules/${f.rule}.md` : undefined;
};

interface Groups {
  open: Finding[];
  questions: Finding[];
  fixed: Finding[];
}
function groups(findings: Finding[]): Groups {
  const ranked = rankFindings(findings);
  return {
    open: ranked.filter((f) => !f.fixed && !isOpenQuestion(f)),
    questions: ranked.filter((f) => !f.fixed && isOpenQuestion(f)),
    fixed: ranked.filter((f) => f.fixed),
  };
}

/** "an estimate from the code, not a measurement" or "measured over N calls". */
const tokenKind = (c: CostSummary): string =>
  c.measured ? `measured over ${(c.measured_calls ?? 0).toLocaleString("en-US")} calls` : "an estimate from the code, not a measurement";

function headline(o: ReportInput, g: Groups, cost: CostSummary): string {
  const n = g.open.length;
  let h = `<header class="lede" id="s-top"><p class="project">leanprompt audit of <strong>${e(o.project)}</strong></p>`;
  if (n === 0 && g.questions.length === 0) {
    if (g.fixed.length > 0) {
      h += `<h1>No open findings</h1><p class="sub">${e(plural(g.fixed.length, "finding"))}, fixed. Nothing open remains.</p>`;
    } else h += `<h1>${e("The audit found no place where this app pays for tokens it doesn't need")}</h1>`;
    return `${h}</header>`;
  }
  if (n === 0) {
    h += `<h1>${e(`Nothing confirmed yet, and ${plural(g.questions.length, "open question")} to settle`)}</h1>`;
  } else {
    h += `<h1>${e(`${plural(n, "place")} where this app pays for tokens it doesn't need`)}</h1>`;
    const top = g.open[0]!;
    const t = tokensOf(top);
    const size = t !== undefined ? `, about ${e(formatTokens(t))} tokens per 1,000 calls` : top.estimate ? `, ${e(top.estimate)}` : "";
    const what = top.problem ? splitLead(top.problem)[0] : `${ruleTitle(top, o.rules).replace(/\.$/, "")}.`;
    h += `<p class="sub">The biggest, at ${location(top)}${size}: ${e(what)}</p>`;
    if (cost.with_tokens > 0) {
      const kind = tokenKind(cost);
      h += `<p class="total"><span class="lbl">Together</span> <strong>about ${e(formatTokens(cost.tokens_per_1k))} tokens per 1,000 calls</strong> `;
      h += `${cost.with_tokens < n ? `For the ${e(cost.with_tokens)} with a number, ${e(kind)}.` : `${e(kind.charAt(0).toUpperCase() + kind.slice(1))}.`}`;
      if (cost.question_tokens_per_1k > 0) h += ` <span class="oq">If the open questions hold, add about ${e(formatTokens(cost.question_tokens_per_1k))}.</span>`;
      h += `</p>`;
      h += tokenBar(g.open);
    }
    if (g.questions.length > 0) h += `<p class="muted">Plus ${e(plural(g.questions.length, "open question"))} to confirm, listed after the findings.</p>`;
  }
  return `${h}</header>`;
}

/** `client.ts:42`: the file's name and line, for the legend. */
const shortWhere = (f: Finding): string => (f.file === EXTERNAL ? whereText(f) : `${f.file.split("/").pop()}:${f.line}`);

/**
 * The meter: one row per finding with a number, largest first. Each row carries the card's number, where it is,
 * a bar scaled to its share of the total, and the figures as text, so neither colour nor length carries meaning alone.
 */
function tokenBar(open: Finding[]): string {
  const withT = open.filter((f) => (tokensOf(f) ?? 0) > 0);
  const total = withT.reduce((a, f) => a + tokensOf(f)!, 0);
  if (total <= 0 || withT.length < 1) return "";
  const max = Math.max(...withT.map((f) => tokensOf(f)!));
  let html = `<figure class="meter"><figcaption>Tokens per 1,000 calls, by finding, and each one's share of the total</figcaption><ol>`;
  withT.forEach((f) => {
    const t = tokensOf(f)!;
    const share = (100 * t) / total;
    const n = open.indexOf(f) + 1;
    const pct = share >= 1 ? `${Math.round(share)}%` : "under 1%";
    html += `<li><a href="#f${n}" aria-label="${e(`Finding ${n}, ${shortWhere(f)}: ${formatTokens(t)} tokens per 1,000 calls, ${pct} of the total`)}">`;
    html += `<span class="mn" aria-hidden="true">${n}</span><code class="mw" aria-hidden="true">${e(shortWhere(f))}</code>`;
    html += `<span class="mt" aria-hidden="true">${e(formatTokens(t))}</span><span class="mp" aria-hidden="true">${e(pct)}</span>`;
    html += `<span class="track" aria-hidden="true"><span class="fill" style="width:${((100 * t) / max).toFixed(2)}%"></span></span></a></li>`;
  });
  return `${html}</ol></figure>`;
}

function costSection(cost: CostSummary): string {
  if (cost.rows.filter((r) => !r.finding.fixed).length === 0) return "";
  let html = `<section class="cost" id="s-cost"><h2>What this costs you</h2>`;
  const m = cost.money;
  if (m) {
    html += `<p class="big"><strong>About ${e(formatDollars(m.lost_per_month))} a month at ${e(m.calls_per_month.toLocaleString("en-US"))} calls a month.</strong></p>`;
    html += `<p>Fixing these saves about ${e(formatDollars(m.saved_if_fixed))} a month`;
    if (m.percent !== undefined && m.bill_per_month !== undefined) html += ` (about ${e(m.percent.toFixed(1))}% of an estimated ${e(formatDollars(m.bill_per_month))} monthly bill)`;
    html += `.`;
    if (m.questions_per_month !== undefined) html += ` If the open questions hold, add about ${e(formatDollars(m.questions_per_month))} a month.`;
    if (m.saved_by_fixes !== undefined) html += ` The fixes already made save about ${e(formatDollars(m.saved_by_fixes))} a month.`;
    html += `</p>`;
  }
  if (cost.gpu) {
    const h = cost.gpu.hours_per_month;
    html += `<p class="big"><strong>About ${e(h.toFixed(1))} ${h === 1 ? "hour" : "hours"} of GPU prefill time a month</strong> at ${e(cost.gpu.calls_per_month.toLocaleString("en-US"))} calls a month and ${e(cost.gpu.prefill_tokens_per_second.toLocaleString("en-US"))} prefill tokens a second.</p>`;
  }
  html += `<p class="muted">Every figure here is ${e(tokenKind(cost))}. Findings can overlap (one failed call can show up in two), so the sum may count some tokens twice. Money is not part of the score.</p>`;
  // The inputs, so every figure can be checked by hand.
  html += `<div class="tablewrap"><table><thead><tr><th>Finding</th><th>Where</th><th class="fig">Tokens per 1,000 calls</th>${m ? `<th class="fig">A month</th>` : ""}${cost.rows.some((r) => r.ttft_seconds !== undefined) ? `<th class="fig">First-token time</th>` : ""}</tr></thead><tbody>`;
  for (const r of cost.rows.filter((x) => !x.finding.fixed)) {
    const t = r.finding.tokens_per_1k!;
    const parts = [t.prompt ? `${formatTokens(t.prompt)} prompt` : "", t.uncached ? `${formatTokens(t.uncached)} not cached` : "", t.output ? `${formatTokens(t.output)} output` : ""].filter(Boolean).join(", ");
    html += `<tr><td class="rule">${e(r.finding.rule)}</td><td class="loc">${location(r.finding)}</td><td class="fig tok">${e(parts || "0")}</td>`;
    if (m) html += `<td class="fig mon">${r.dollars_per_month !== undefined ? e(formatDollars(r.dollars_per_month)) : ""}</td>`;
    if (cost.rows.some((x) => x.ttft_seconds !== undefined)) html += `<td class="fig ttft">${r.ttft_seconds !== undefined ? `+${e(r.ttft_seconds.toFixed(2))} s` : ""}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  const inputs: string[] = [];
  if (m) {
    inputs.push(`Volume: ${e(m.calls_per_month.toLocaleString("en-US"))} calls a month${m.volume_source ? `, from ${e(m.volume_source)}` : ""}.`);
    for (const { model, price } of m.prices) {
      const usd = (v: number): string => `$${v.toFixed(Math.max(2, (String(v).split(".")[1] ?? "").length))}`;
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
    html += `<p class="muted">leanprompt never guesses a volume or a price. Your coding agent can look up the provider's current price page and add it with the date; <a href="${REPO}/blob/main/docs/profile.md">how</a>.</p>`;
  }
  return `${html}</section>`;
}

/** Split text after its first sentence (a full stop, question mark or colon followed by a space and a capital). */
export function splitLead(text: string): [string, string] {
  const m = /^(.+?[.?])\s+(?=[A-Z"(])/.exec(text);
  return m ? [m[1]!, text.slice(m[0].length)] : [text, ""];
}

function card(f: Finding, i: number, o: ReportInput, version: string, kind: "open" | "question" | "fixed"): string {
  const link = ruleLink(f, o.rules, version);
  const title = ruleTitle(f, o.rules);
  let html = `<article class="finding sev-${f.severity}${f.fixed ? " fixed" : ""}" data-where="${e(whereText(f))}" id="f${i + 1}">`;
  html += `<div class="num" aria-hidden="true">${i + 1}</div><div class="body">`;
  // The first sentence of the problem is the card's heading; the rest follows it as text.
  const [lead, rest] = f.problem ? splitLead(f.problem) : [title, ""];
  html += `<h3>${e(lead)}</h3>`;
  html += `<p class="meta"><span class="visually-hidden">Finding ${i + 1}. </span>${location(f)} <span class="sev">${e(f.severity)}</span> <span class="rid">${e(f.rule)}</span>${f.fixed ? ` <span class="tag">fixed</span>` : ""}</p>`;
  if (rest) html += `<p class="rest">${e(rest)}</p>`;
  const estimate = f.estimate ?? (tokensOf(f) !== undefined ? `about ${formatTokens(tokensOf(f)!)} tokens per 1,000 calls` : undefined);
  const dl: [string, string, string | undefined][] = [
    ["act", kind === "question" ? "Change, if confirmed" : "What to change", f.change],
    ["why", "Why it matters", f.why],
  ];
  if (kind === "question") dl.unshift(["act confirm", "To confirm", f.confirm]);
  const rows = dl.filter(([, , v]) => v).map(([c, k, v]) => `<div class="${c}"><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`);
  if (estimate || f.assumptions) {
    let dd = estimate ? `<span class="est">${e(estimate)}</span>` : "";
    if (f.assumptions) dd += `<details class="assume"><summary>What the estimate assumes</summary><p>${e(f.assumptions)}</p></details>`;
    rows.push(`<div class="estimate"><dt>Estimate</dt><dd>${dd}</dd></div>`);
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

function findingsSection(o: ReportInput, g: Groups, version: string): string {
  const all = g.open.length + g.questions.length;
  let html = `<section class="findings" id="s-findings"><h2>${e("What's wrong and what to change")}</h2><p class="muted">${all} open, ${g.fixed.length} fixed`;
  if (o.ignored) html += `, ${o.ignored} ignored by the profile`;
  html += `. Largest first, by the audit's estimate of tokens lost per 1,000 calls.</p>`;
  html += g.open.map((f, i) => card(f, i, o, version, "open")).join("");
  if (g.open.length === 0) html += `<p>No confirmed findings.</p>`;
  html += `</section>`;
  if (g.questions.length > 0) {
    html += `<section class="findings" id="s-questions"><h2>Open questions</h2><p class="muted">Findings outside this repository, or waiting on a fact the code cannot show. They still count in the score. Each says what to confirm.</p>`;
    html += g.questions.map((f, i) => card(f, g.open.length + i, o, version, "question")).join("");
    html += `</section>`;
  }
  if (g.fixed.length > 0) {
    html += `<section class="findings" id="s-fixed"><details class="fixed-list"><summary><h2>${e(plural(g.fixed.length, "fixed finding"))}</h2></summary>`;
    html += g.fixed.map((f, i) => card(f, all + i, o, version, "fixed")).join("");
    html += `</details></section>`;
  }
  return html;
}

const NPX = "npx github:Podwarden/leanprompt";

/** The block a user pastes into their coding agent: self-contained instructions plus the open findings. */
export function handoffText(findings: Finding[], rules: Map<string, RuleInfo>): string {
  const g = groups(findings);
  const lines = [
    "Please check and fix the LLM-call findings from a leanprompt audit of this repository.",
    "",
    `1. If the leanprompt skills are not installed for you here, install them: ${NPX} init`,
    "2. Read .leanprompt/findings.json and leanprompt-report.md. If they are missing, use the list below.",
    "3. Check each finding against the code before you change anything. The audit can be wrong: if a finding does not hold, tell me why and leave that code alone.",
    "4. Fix one finding at a time. Show me the change as a small diff and apply it only after I say yes.",
    "5. Prove each fix with the measure-loop skill: a before and after on the same scenario. Ask me before running anything that sends real, billed requests.",
    `6. When a fix is proved, set "fixed": true on its finding in .leanprompt/findings.json and run ${NPX} score.`,
  ];
  if (g.open.length > 0) {
    lines.push("", "Findings, largest first:");
    g.open.forEach((f, i) => lines.push(`${i + 1}. ${f.rule} at ${whereText(f)}: ${f.problem ?? ruleTitle(f, rules)}`));
  }
  if (g.questions.length > 0) {
    lines.push("", "Open questions (confirm before fixing):");
    for (const f of g.questions) lines.push(`- ${f.rule} (${whereText(f)}): ${f.problem ?? ruleTitle(f, rules)}${f.confirm ? ` To confirm: ${f.confirm}` : ""}`);
  }
  return lines.join("\n");
}

function copyButton(id: string, label = "Copy"): string {
  return `<button type="button" class="copy" data-copy="${id}" data-label="${e(label)}" hidden>${e(label)}</button>`;
}

function handoffSection(o: ReportInput): string {
  let html = `<section class="handoff" id="s-fix"><h2>Fix it with your coding agent</h2>`;
  html += `<p>Paste this into Claude Code, Codex, Cursor or any coding assistant. It will check each finding against your code and propose fixes one at a time, asking before it changes anything.</p>`;
  html += `<div class="copybox">${copyButton("handoff", "Copy for your agent")}<pre id="handoff" tabindex="0">${e(handoffText(o.findings, o.rules))}</pre></div>`;
  return `${html}</section>`;
}

/** Whether the page has shown something worth passing on: an estimate, or a measured score. */
function worthSharing(o: ReportInput): boolean {
  return o.findings.some((f) => f.estimate || f.tokens_per_1k) || (o.score?.kind === "measured" && num(o.score.score) !== undefined);
}

/** A short, plain message a user can send a colleague. */
export function shareText(findings: Finding[], score: ScoreFile | null, profile: Profile | null = null): string {
  const g = groups(findings);
  const cost = costSummary(findings, profile);
  let what: string;
  if (g.open.length > 0) {
    what = `leanprompt checked how our app calls LLMs and found ${plural(g.open.length, "place")} where it pays for tokens it doesn't need`;
    if (cost.with_tokens > 0) what += `, about ${formatTokens(cost.tokens_per_1k)} tokens per 1,000 calls, ${cost.measured ? `measured over ${cost.measured_calls} calls` : "an estimate from the code"}`;
    else if (g.open[0]!.estimate) what += `; the largest is ${g.open[0]!.estimate}, an estimate from the code`;
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
  if (g.fixed.length > 0) items.push(["s-fixed", "Fixed", String(g.fixed.length)]);
  items.push(["s-fix", "Hand-off to your agent", ""], ["s-score", "Score", o.score && num(o.score.score) !== undefined ? String(o.score.score) : ""]);
  if (worthSharing(o)) items.push(["s-share", "Share", ""]);
  const li = items.map(([id, label, n]) => `<li><a href="#${id}"><span>${e(label)}</span>${n ? `<span class="c">${e(n)}</span>` : ""}</a></li>`).join("");
  return `<nav class="rail" aria-label="Sections"><p class="mark">leanprompt</p><p class="proj">${e(o.project)}</p><ul>${li}</ul></nav>`;
}

/** One self-contained HTML document: inline CSS, one inline copy script, no network. */
export function renderReport(o: ReportInput): string {
  const version = o.version ?? packageVersion();
  const g = groups(o.findings);
  const cost = costSummary(o.findings, o.profile ?? null, o.average_call);
  const body =
    headline(o, g, cost) +
    costSection(cost) +
    findingsSection(o, g, version) +
    handoffSection(o) +
    scoreSection(o.score) +
    shareSection(o);
  const footer = `<footer class="page-foot muted">Made by leanprompt ${e(version)}, on your machine; this page loads nothing from the network. <a href="${REPO}">${REPO}</a></footer>`;
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
  let average_call: AverageCall | undefined;
  const profile = loadProfile(dir);
  const fpath = join(dir, FINDINGS_FILE);
  if (existsSync(fpath)) {
    const parsed = parseFindings(readFileSync(fpath, "utf8"), loadRuleIds(PACKAGE_ROOT));
    if (parsed.errors.length > 0) throw new Error(`${fpath}: ${parsed.errors.join("; ")}`);
    findings = filterIgnored(parsed.findings, profile);
    ignored = parsed.findings.length - findings.length;
    average_call = parsed.average_call;
  }
  const html = renderReport({
    findings,
    ignored,
    score: readScore(join(dir, SCORE_FILE)),
    rules: loadRules(PACKAGE_ROOT),
    project: basename(dir),
    profile,
    ...(average_call ? { average_call } : {}),
    git: readGit(dir),
  });
  const target = resolve(dir, values.out ?? DEFAULT_OUT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  process.stdout.write(`${target}\n`);
  return 0;
}
