import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { profileTargets, type Profile } from "../profile.js";
import { EXTERNAL, knownOf, tokensLost, unitOf, type Finding, type Note } from "../score/static.js";
import { costSummary, formatDollars, formatPrice, formatTokens, ownerQuestions as ownerQuestionList, type CostSummary } from "./cost.js";
import {
  afterColon,
  costly,
  KNOWN_LABEL,
  knownLine,
  largestQuestion,
  UNATTENDED_LINE,
  NO_DISCOUNT_LINE,
  groups,
  shortTitle,
  handoffText,
  noteWhere,
  packageVersion,
  plural,
  ruleLink,
  ruleTitle,
  splitLead,
  tokenKind,
  tokensOf,
  tokensPhrase,
  runText,
  scopeCounts,
  scopeLine,
  SCOPE_LABEL,
  whereText,
  type ReportInput,
  type ScoreFile,
} from "./html.js";

export const MD_FILE = "leanprompt-report.md";
export const MD_BEGIN = "<!-- leanprompt:report:begin -->";
export const MD_END = "<!-- leanprompt:report:end -->";

/** What the report says about the owner's answers, which the findings file does not hold. */
export interface MdContext {
  /** The day of the report, `YYYY-MM-DD`, local time. */
  date: string;
  /** The `priority:` as written in leanprompt.yaml, or undefined when it is not set. */
  priority?: string;
}

/** The finding numbers by id, in the order the report lists them. */
function numbering(g: ReturnType<typeof groups>): Map<string, number> {
  const m = new Map<string, number>();
  [...g.open, ...g.questions, ...g.server, ...g.known, ...g.fixed].forEach((f, i) => f.id !== undefined && m.set(f.id, i + 1));
  return m;
}

/** Plain text for a table cell or a list item: no line breaks, no pipes. */
const cell = (s: string): string => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
const where = (f: Finding): string => (f.file === EXTERNAL ? whereText(f) : `\`${whereText(f)}\``);

function targetText(p: Profile | null | undefined): string {
  if (!p) return "not set (no leanprompt.yaml)";
  const ts = profileTargets(p);
  if (ts.length === 0) return "not set";
  return ts.map((t) => [t.provider ?? t.engine, t.model_family].filter(Boolean).join(", ")).join("; ");
}

function shareLine(f: Finding): string {
  const side = f.saves === "generation" ? "output" : "prompt";
  if (f.share_prefill !== undefined || f.share_output !== undefined) {
    const p = f.share_prefill ?? f.share ?? 0;
    const o = f.share_output ?? f.share ?? 0;
    return `${p.toFixed(3)} of prompt tokens and ${o.toFixed(3)} of output tokens`;
  }
  if (f.share !== undefined) return f.saves === "both" ? `${f.share.toFixed(3)} of prompt and of output tokens (one share for both sides)` : `${f.share.toFixed(3)} of ${side} tokens`;
  return "severity default share: no estimate was possible";
}

function findingBlock(f: Finding, n: number, o: ReportInput, version: string, kind: "open" | "question" | "server" | "known" | "fixed", num: Map<string, number> = new Map()): string[] {
  const lead = shortTitle(f, o.rules);
  const link = ruleLink(f, o.rules, version);
  const t = tokensOf(f);
  const out = [`${kind === "question" || kind === "server" || kind === "known" ? "####" : "###"} ${n}. ${cell(lead)} · ${where(f)}`, ""];
  if (f.scope) out.push(`- **About:** ${SCOPE_LABEL[f.scope]}`);
  const li = (k: string, v: string | undefined) => v && out.push(`- **${k}:** ${cell(v)}`);
  li("Problem", f.problem);
  if (kind === "question" || (kind === "server" && f.status === "needs-facts")) li(kind === "server" ? "What would answer it" : "To confirm", f.confirm);
  li(kind === "question" || (kind === "server" && f.status === "needs-facts") ? "Change, if confirmed" : "What to change", f.change);
  li("Why it matters", f.why);
  const est = f.estimate ?? (t !== undefined ? tokensPhrase(f) : undefined);
  const tl = tokensLost(f);
  const counted = f.evidence === "counted";
  const estKind = tl?.measured_calls ? `measured, ${tl.measured_calls} calls` : counted ? "counted" : "estimate";
  if (est) li(counted ? "Counted" : "Estimate", /\((?:[^)]*\b)?(estimate|measured|counted)\b/i.test(est) ? est : `${est} (${estKind})`);
  if (counted) li("Counted from", f.counted_from);
  li("Assumes", f.assumptions);
  li("Who reaches this", f.reach);
  if (f.cached_discount === "none") li("Money", NO_DISCOUNT_LINE);
  if (tl?.cache_write) li("Cache writes", `the fix writes about ${formatTokens(tl.cache_write)} tokens ${unitOf(f) === "run" ? "per run" : "per 1,000 calls"} to the cache at the write price; the money estimate subtracts that premium`);
  li("Share", shareLine(f));
  if (f.status === "frequency-unknown") li("How often", `the code shows the problem; how often it happens is assumed. To measure it: ${f.confirm ?? ""}`);
  if (f.status === "size-unknown") li("How big", `the code shows the problem and how often it happens; how many tokens it costs each time is assumed. To measure it: ${f.confirm ?? ""}`);
  const k = knownOf(f);
  if (k) li(KNOWN_LABEL[k.kind], knownLine(f));
  const others = (f.overlaps ?? []).map((id) => num.get(id)).filter((x): x is number => x !== undefined);
  if (others.length) li("Overlaps", `finding ${others.join(", ")} loses some of the same tokens; the totals count the larger once`);
  li("How to check the fix", f.verify);
  out.push(`- **Rule:** ${link ? `[${f.rule} ${ruleTitle(f, o.rules)}](${link})` : f.rule}`);
  out.push(`- **Status:** ${f.fixed ? "fixed" : kind === "question" ? "open question" : kind === "server" ? "question for the server's administrator" : kind === "known" ? `already known to the project (${k?.kind ?? "planned"}), not in the totals or the score` : "open"}`);
  out.push("");
  return out;
}

/** "Tokens per 1,000 calls", "Tokens per run", or both, for the line under the cost heading. */
const units0 = (rows: { unit: string }[]): string => {
  const u = new Set(rows.map((r) => r.unit));
  return u.size > 1 ? "Tokens per 1,000 calls and per run" : u.has("run") ? "Tokens per run" : "Tokens per 1,000 calls";
};

function costLines(cost: CostSummary): string[] {
  const rows = cost.rows.filter((r) => !r.finding.fixed);
  if (rows.length === 0) return [];
  const out = ["## What this costs you", ""];
  const m = cost.money;
  if (m) {
    const c = m.currency;
    let p = `About ${formatDollars(m.lost_per_month, c)} a month at ${m.calls_per_month.toLocaleString("en-US")} calls a month. Fixing these saves about ${formatDollars(m.saved_if_fixed, c)} a month`;
    if (m.percent !== undefined && m.bill_per_month !== undefined) p += ` (about ${m.percent.toFixed(1)}% of an estimated ${formatDollars(m.bill_per_month, c)} monthly bill)`;
    p += ".";
    if (m.questions_per_month !== undefined) p += ` If the open questions hold, add about ${formatDollars(m.questions_per_month, c)} a month.`;
    if (m.server_per_month !== undefined) p += ` The questions for the server's administrator, if they hold, are about ${formatDollars(m.server_per_month, c)} a month more.`;
    if (c) p += ` Prices are in ${c}, as given in leanprompt.yaml; leanprompt does not convert them.`;
    out.push(p, "");
    const inputs = [`volume ${m.calls_per_month.toLocaleString("en-US")} calls a month${m.volume_source ? ` (${m.volume_source})` : ""}`];
    for (const { model, price } of m.prices) {
      const pr = (v: number) => formatPrice(v, price.currency);
      inputs.push(`${model} input ${pr(price.input)}, ${price.cached_input !== undefined ? `cached input ${pr(price.cached_input)}, ` : ""}${price.cache_write !== undefined ? `cache write ${pr(price.cache_write)}, ` : ""}output ${pr(price.output)} per 1M tokens, from ${price.source}, checked ${price.checked}`);
    }
    out.push(`Inputs: ${inputs.join("; ")}. Every figure is ${tokenKind(cost)}.`, "");
  } else {
    out.push(`${units0(rows)} only. Every figure is ${tokenKind(cost)}.`);
    if (cost.missing.length > 0) {
      out.push("", "To see this in money, add to `leanprompt.yaml`:", "");
      for (const x of cost.missing) out.push(`- \`${x.split("\t")[0]}\`: ${x.split("\t")[1] ?? ""}`);
      out.push("", "leanprompt never invents a volume or a price.");
    }
    out.push("");
  }
  if (rows.some((r) => r.unit === "run")) {
    out.push(`Per-run figures are a separate total, never added to the figures per 1,000 calls. A run is ${cost.run ?? "one run of the tool"}.${cost.dollars_per_run !== undefined ? ` About ${formatDollars(cost.dollars_per_run)} per run at the prices in leanprompt.yaml.` : ""}`, "");
  }
  if (cost.gpu) out.push(`About ${cost.gpu.hours_per_month.toFixed(1)} hours of GPU prefill time a month at ${cost.gpu.calls_per_month.toLocaleString("en-US")} calls a month.`, "");
  const units = new Set(rows.map((r) => r.unit));
  const tokHead = units.size > 1 ? "Tokens (per 1,000 calls, or per run where marked)" : units.has("run") ? "Tokens per run" : "Tokens per 1,000 calls";
  out.push(`| Finding | Where | ${tokHead} |${m ? " A month |" : ""}`, `|---|---|---|${m ? "---|" : ""}`);
  for (const r of rows) {
    const t = tokensLost(r.finding)!;
    const parts = [t.prompt ? `${formatTokens(t.prompt)} prompt` : "", t.uncached ? `${formatTokens(t.uncached)} not cached` : "", t.output ? `${formatTokens(t.output)} output` : ""].filter(Boolean).join(", ") || "0";
    const tag = r.group === "question" ? " (open question)" : r.group === "server" ? " (server)" : r.group === "known" ? ` (${KNOWN_LABEL[knownOf(r.finding)!.kind].toLowerCase()})` : "";
    const per = units.size > 1 && r.unit === "run" ? " per run" : "";
    const cnt = r.finding.evidence === "counted" ? " (counted)" : "";
    const scope = r.finding.scope ? ` (${SCOPE_LABEL[r.finding.scope]})` : "";
    out.push(`| ${r.finding.rule}${tag}${scope} | ${cell(whereText(r.finding))} | ${parts}${per}${cnt} |${m ? ` ${r.dollars_per_month !== undefined ? formatDollars(r.dollars_per_month, m.currency) : r.dollars_per_run !== undefined ? `${formatDollars(r.dollars_per_run)} per run` : ""} |` : ""}`);
  }
  out.push(
    "",
    `The table lists this app's findings first, largest first, then its open questions, then the questions for the server's administrator, then the findings the project already knows about, which are not in the totals.${cost.overlaps ? " Findings marked as overlapping count once in the totals, the largest of each group." : ""} Money is not part of the score.`,
    "",
  );
  return out;
}

function scoreLines(score: ScoreFile | null): string[] {
  const out = ["## Score", ""];
  if (!score || typeof score.score !== "number") return [...out, "No score yet: run `npx leanprompt score`.", ""];
  const measured = score.kind === "measured";
  const src = measured ? `.leanprompt/usage.jsonl, ${score.calls ?? "?"} calls (${score.unmeasured ?? 0} unmeasured)` : ".leanprompt/findings.json";
  out.push(`${score.score} ${score.kind ?? "static"}, from ${src}, ${score.weights ?? "default"} weights. One number from 0 to 100 for how well the app avoids paying for the same tokens twice; higher is better.`, "");
  const d = score.diagnostics ?? {};
  if (!measured && typeof d.default_shares === "number" && typeof d.findings === "number") {
    out.push(`${d.default_shares} of ${d.findings} findings use a default share (\`default_shares\` in \`.leanprompt/score.json\`), the rest an estimated one.`, "");
  }
  const sv = score.server;
  if (!measured && sv && typeof sv.findings === "number" && sv.findings > 0) {
    out.push(
      sv.included
        ? `This score counts ${plural(sv.findings, "finding")} for the server's administrator${typeof sv.app_score === "number" ? `; the app's own score is ${sv.app_score}` : ""}.`
        : `This is the app's own score: it leaves out ${plural(sv.findings, "finding")} for the server's administrator${typeof sv.with_server_score === "number" ? `; with them it would be ${sv.with_server_score}` : ""} (\`npx leanprompt score --with-server\`).`,
      "",
    );
  }
  const f2 = (v: number | undefined) => (typeof v === "number" ? v.toFixed(2) : "n/a");
  const i = score.inputs ?? {};
  out.push("| Input | Value | Meaning |", "|---|---|---|");
  out.push(`| E | ${f2(i.E)} | prefill reuse (measured), or the prefill term from the findings (static) |`);
  out.push(`| S | ${f2(i.S)} | prefix stability (measured); 1 in a static score |`);
  out.push(`| G | ${f2(i.G)} | share of output tokens wasted |`, "");
  out.push(measured ? "Measured from the usage log." : "This score is an estimate from code. A trial run with `npx leanprompt calibrate` fits it to this app.", "");
  const kn = score.known;
  if (!measured && kn && typeof kn.findings === "number" && kn.findings > 0) {
    out.push(`It leaves out ${plural(kn.findings, "finding")} the project already knows about (planned, in progress, declined or reported)${typeof kn.with_known_score === "number" ? `; with them it would be ${kn.with_known_score}` : ""}.`, "");
  }
  out.push("Money is not part of the score.", "");
  return out;
}

/** The questions only the owner can answer, when nobody answered them (an unattended audit). */
function ownerQuestions(o: ReportInput, cost: CostSummary, ctx: MdContext): string[] {
  const q = ownerQuestionList(o.profile ?? null, cost, ctx.priority);
  if (q.length === 0) return [];
  return ["## Questions for the owner", "", "These were not answered during the audit. Until they are, the report shows tokens only and ranks the advice without a priority.", "", ...q.map((x) => `- **${x.label}:** ${x.text}`), ""];
}

/** The generated part of `leanprompt-report.md`, from the same inputs as the page. */
export function renderMarkdown(o: ReportInput, ctx: MdContext): string {
  const version = o.version ?? packageVersion();
  const g = groups(o.findings);
  const cost = costSummary(o.findings, o.profile ?? null, o.average_call, o.run);
  const notes: Note[] = o.notes ?? [];
  const out: string[] = [
    MD_BEGIN,
    `<!-- Written by npx leanprompt report --md from .leanprompt/findings.json and .leanprompt/score.json. It is replaced on the next run: change the findings file, not this block. The inventory and the next steps go below the block. -->`,
    "",
    `# leanprompt report: ${o.project}`,
    "",
    `${ctx.date} · leanprompt ${version} · target: ${targetText(o.profile)} · priority: ${ctx.priority ?? "not set"}${o.unattended ? " · unattended run" : ""}`,
    "",
  ];
  if (o.unattended) out.push(`**${UNATTENDED_LINE}**`, "");
  const num = numbering(g);
  // Headline: the same counts and totals as the page.
  const places = costly(g);
  const n = places.length;
  const zero = g.open.length - n;
  const bigQ = largestQuestion(g);
  const qLine = (lead: string): string => {
    if (!bigQ) return "";
    const what = bigQ.problem ? splitLead(bigQ.problem)[0].replace(/[.:]$/, "") : ruleTitle(bigQ, o.rules).replace(/\.$/, "");
    return ` ${lead}, at ${where(bigQ)}, ${tokensPhrase(bigQ)} if it holds: ${afterColon(what)}.`;
  };
  let h: string;
  if (n === 0) {
    h = g.questions.length > 0 ? `**Nothing confirmed yet, and ${plural(g.questions.length, "open question")} to settle.**${qLine("The largest")}` : "**The audit found no place in this app's code where it pays for tokens it doesn't need.**";
  } else {
    const top = places[0]!;
    const t = tokensOf(top);
    const lead = top.problem ? splitLead(top.problem)[0].replace(/[.:]$/, "") : ruleTitle(top, o.rules).replace(/\.$/, "");
    h = `**${plural(n, "place")} where this app pays for tokens it doesn't need.** The biggest, at ${where(top)}${t !== undefined ? `, ${tokensPhrase(top)}` : ""}: ${afterColon(lead)}.`;
    h += qLine("The largest item is an open question");
    const totals = [
      cost.with_tokens > 0 ? `about ${formatTokens(cost.tokens_per_1k)} tokens per 1,000 calls` : "",
      cost.run_with_tokens > 0 ? `about ${formatTokens(cost.run_tokens)} tokens ${runText(o.run)}` : "",
    ].filter(Boolean);
    if (totals.length) h += ` Together ${totals.join(", and ")} (${tokenKind(cost)}${totals.length > 1 ? "; the two units are kept apart" : ""}${cost.overlaps ? "; overlapping findings counted once" : ""}).`;
  }
  if (n > 0 && g.questions.length > 0) {
    h += ` Plus ${plural(g.questions.length, "open question")} to confirm${cost.question_tokens_per_1k > 0 ? `; if ${g.questions.length === 1 ? "it holds" : "they hold"}, add about ${formatTokens(cost.question_tokens_per_1k)}` : ""}.`;
  }
  if (zero > 0) h += ` Plus ${plural(zero, "finding")} that ${zero === 1 ? "costs" : "cost"} no tokens today.`;
  if (g.server.length > 0) h += ` Plus ${plural(g.server.length, "question")} for the server's administrator, not in this app's score.`;
  if (g.known.length > 0) h += ` Plus ${plural(g.known.length, "finding")} the project already knows about, not in the totals or the score.`;
  if (notes.length > 0) h += ` Plus ${plural(notes.length, "other problem")}, not scored.`;
  const sc = scopeCounts(o.findings, notes);
  if (o.gateway || sc) h += ` ${scopeLine(sc)}`;
  out.push(
    h,
    "",
    `The count of places leaves out findings that cost no tokens, the open questions, the questions for the server's administrator, the findings the project already knows about and the other problems; each is listed below.`,
    "",
  );
  out.push(...costLines(cost));
  out.push("## What's wrong and what to change", "", `Largest first, by estimated tokens lost per 1,000 calls${g.open.some((f) => unitOf(f) === "run") ? ", then per run" : ""}.`, "");
  g.open.forEach((f, i) => out.push(...findingBlock(f, i + 1, o, version, "open", num)));
  if (g.open.length === 0) out.push("No confirmed findings.", "");
  let k = g.open.length;
  if (g.questions.length > 0) {
    out.push("### Open questions", "", "Findings outside this repository, or whose behaviour the code cannot show. They count in the score. Confirm or dismiss each one.", "");
    g.questions.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "question", num)));
  }
  if (g.server.length > 0) {
    out.push("## Questions for the server's administrator", "");
    out.push("About the server or engine the app calls, not this app's code, so they are not in this app's score (`npx leanprompt score --with-server` counts them). For an LM Warden server, `npx leanprompt profile detect --lmwarden <url>` reads the engine's cache facts into `leanprompt.yaml`.", "");
    g.server.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "server", num)));
  }
  if (g.known.length > 0) {
    out.push("## Already known to the project", "", "The project's own issues, pull requests or docs already cover these, so they are not new and are not in the totals or the score. Read the link before working on one.", "");
    const live = g.known.filter((f) => knownOf(f)!.kind !== "declined");
    live.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "known", num)));
    const declined = g.known.filter((f) => knownOf(f)!.kind === "declined");
    if (declined.length > 0) {
      out.push("### Declined by the project", "");
      for (const f of declined) {
        const kd = knownOf(f)!;
        out.push(`${++k}. ${cell(shortTitle(f, o.rules))} · ${where(f)}${kd.url ? ` · ${kd.url}` : ""}`);
      }
      out.push("");
    }
  }
  if (notes.length > 0) {
    out.push("## Other problems the audit found", "", "Checked in the code; they cost no tokens of their own and are not scored.", "");
    notes.forEach((nt, i) => {
      out.push(`### N${i + 1}. ${cell(nt.title)} · ${nt.file === EXTERNAL ? noteWhere(nt) : `\`${noteWhere(nt)}\``}`, "");
      if (nt.scope) out.push(`- **About:** ${SCOPE_LABEL[nt.scope]}`);
      if (nt.known?.kind === "declined") {
        out.push(`- **${KNOWN_LABEL.declined}:** ${cell([nt.known.note, nt.known.url].filter(Boolean).join(" "))}`, "");
        return;
      }
      out.push(`- **Problem:** ${cell(nt.problem)}`, `- **What to change:** ${cell(nt.change)}`);
      if (nt.known) out.push(`- **${KNOWN_LABEL[nt.known.kind]}:** ${cell([nt.known.note, nt.known.url].filter(Boolean).join(" "))}`);
      if (nt.rule) {
        const r = o.rules.get(nt.rule);
        const link = ruleLink({ rule: nt.rule } as Finding, o.rules, version);
        out.push(`- **Rule:** ${link ? `[${nt.rule} ${r?.title ?? ""}](${link})` : nt.rule}${nt.severity ? `, severity ${nt.severity}` : ""}`);
      }
      const fn = nt.finding !== undefined ? num.get(nt.finding) : undefined;
      if (fn !== undefined) out.push(`- **Same problem as:** finding ${fn}`);
      if (nt.why) out.push(`- **Why it matters:** ${cell(nt.why)}`);
      if (nt.verify) out.push(`- **How to check the fix:** ${cell(nt.verify)}`);
      out.push("");
    });
  }
  if (g.fixed.length > 0) {
    out.push(`### Fixed`, "");
    g.fixed.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "fixed", num)));
  }
  out.push("## Fix it with your coding agent", "", "Paste this into Claude Code, Codex, Cursor or any coding assistant. It checks each finding against the code and proposes fixes one at a time, asking before it changes anything.", "");
  out.push("```text", handoffText(o.findings, o.rules, { notes, version }), "```", "");
  out.push(...scoreLines(o.score));
  out.push(...ownerQuestions(o, cost, ctx));
  out.push(MD_END);
  return out.join("\n") + "\n";
}

/** The rest of a new report, below the generated block, for the assistant to fill. */
export const MD_TAIL = [
  "",
  "## Inventory",
  "",
  "| # | File | Provider | Model | Call kind | Notes |",
  "|---|---|---|---|---|---|",
  "",
  "## Next steps",
  "",
].join("\n");

/**
 * Put the generated block into an existing report, keeping every byte outside it. A new file gets the
 * block and an empty inventory and next steps. Null when the file exists without a generated block
 * (a hand-written report), so the caller can refuse to overwrite it.
 */
export function spliceReport(existing: string | null, block: string): string | null {
  if (existing === null) return block + MD_TAIL;
  const i = existing.indexOf(MD_BEGIN);
  const j = existing.indexOf(MD_END);
  if (i < 0 || j < i) return null;
  return existing.slice(0, i) + block.replace(/\n$/, "") + existing.slice(j + MD_END.length);
}

/** The project's name for the page and the report: its package name, else the git remote's repository, else the folder. */
export function projectName(dir: string): string {
  try {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  } catch {
    /* fall through */
  }
  const py = join(dir, "pyproject.toml");
  if (existsSync(py)) {
    // [project] name = "...", or [tool.poetry] name = "..."; a full TOML parser is not needed for one key.
    const text = readFileSync(py, "utf8");
    for (const section of ["project", "tool.poetry"]) {
      const m = new RegExp(String.raw`^\[${section.replace(".", "\\.")}\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))`, "m").exec(text);
      const n = m && /^\s*name\s*=\s*["']([^"']+)["']/m.exec(m[1]!);
      if (n) return n[1]!;
    }
  }
  try {
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    // Only the project's own repository: a folder inside another repository does not take that one's name.
    // realpathSync.native expands Windows 8.3 short names (C:\Users\RUNNER~1\...) that git prints in full;
    // Windows paths compare without case.
    const canon = (p: string) => {
      const r = realpathSync.native(p);
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    if (canon(git("rev-parse", "--show-toplevel")) !== canon(dir)) throw new Error("not the top");
    const remote = git("remote", "get-url", "origin");
    const m = /([^/:]+?)(?:\.git)?\/?$/.exec(remote);
    if (m && m[1]) return m[1];
  } catch {
    /* no git, or no remote */
  }
  return basename(dir);
}

/** `priority:` exactly as leanprompt.yaml writes it (a word or weights), or undefined when it is not set. */
export function rawPriority(dir: string): string | undefined {
  const file = join(dir, "leanprompt.yaml");
  if (!existsSync(file)) return undefined;
  try {
    const p = (parseYaml(readFileSync(file, "utf8")) as Record<string, unknown> | null)?.priority;
    if (p === undefined || p === null) return undefined;
    if (typeof p === "string") return p;
    if (typeof p === "object") return Object.entries(p as Record<string, unknown>).map(([k, v]) => `${k} ${String(v)}`).join(", ");
  } catch {
    /* loadProfile reports a bad file */
  }
  return undefined;
}
