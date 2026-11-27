import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { profileTargets, type Profile } from "../profile.js";
import { EXTERNAL, type Finding, type Note } from "../score/static.js";
import { costSummary, formatDollars, formatTokens, type CostSummary } from "./cost.js";
import {
  afterColon,
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

function findingBlock(f: Finding, n: number, o: ReportInput, version: string, kind: "open" | "question" | "server" | "fixed"): string[] {
  const lead = shortTitle(f, o.rules);
  const link = ruleLink(f, o.rules, version);
  const t = tokensOf(f);
  const out = [`${kind === "question" || kind === "server" ? "####" : "###"} ${n}. ${cell(lead)} · ${where(f)}`, ""];
  const li = (k: string, v: string | undefined) => v && out.push(`- **${k}:** ${cell(v)}`);
  li("Problem", f.problem);
  if (kind === "question" || (kind === "server" && f.status === "needs-facts")) li(kind === "server" ? "What would answer it" : "To confirm", f.confirm);
  li(kind === "question" || (kind === "server" && f.status === "needs-facts") ? "Change, if confirmed" : "What to change", f.change);
  li("Why it matters", f.why);
  const est = f.estimate ?? (t !== undefined ? `about ${formatTokens(t)} tokens per 1,000 calls` : undefined);
  const estKind = f.tokens_per_1k?.measured_calls ? `measured, ${f.tokens_per_1k.measured_calls} calls` : "estimate";
  if (est) li("Estimate", /\((?:[^)]*\b)?(estimate|measured)\b/i.test(est) ? est : `${est} (${estKind})`);
  li("Assumes", f.assumptions);
  if (f.tokens_per_1k?.cache_write) li("Cache writes", `the fix writes about ${formatTokens(f.tokens_per_1k.cache_write)} tokens per 1,000 calls to the cache at the write price; the money estimate subtracts that premium`);
  li("Share", shareLine(f));
  if (f.status === "frequency-unknown") li("How often", `the code shows the problem; how often it happens is assumed. To measure it: ${f.confirm ?? ""}`);
  li("Already planned", f.planned);
  li("How to check the fix", f.verify);
  out.push(`- **Rule:** ${link ? `[${f.rule} ${ruleTitle(f, o.rules)}](${link})` : f.rule}`);
  out.push(`- **Status:** ${f.fixed ? "fixed" : kind === "question" ? "open question" : kind === "server" ? "question for the server's administrator" : "open"}`);
  out.push("");
  return out;
}

function costLines(cost: CostSummary): string[] {
  const rows = cost.rows.filter((r) => !r.finding.fixed);
  if (rows.length === 0) return [];
  const out = ["## What this costs you", ""];
  const m = cost.money;
  if (m) {
    let p = `About ${formatDollars(m.lost_per_month)} a month at ${m.calls_per_month.toLocaleString("en-US")} calls a month. Fixing these saves about ${formatDollars(m.saved_if_fixed)} a month`;
    if (m.percent !== undefined && m.bill_per_month !== undefined) p += ` (about ${m.percent.toFixed(1)}% of an estimated ${formatDollars(m.bill_per_month)} monthly bill)`;
    p += ".";
    if (m.questions_per_month !== undefined) p += ` If the open questions hold, add about ${formatDollars(m.questions_per_month)} a month.`;
    if (m.server_per_month !== undefined) p += ` The questions for the server's administrator, if they hold, are about ${formatDollars(m.server_per_month)} a month more.`;
    out.push(p, "");
    const inputs = [`volume ${m.calls_per_month.toLocaleString("en-US")} calls a month${m.volume_source ? ` (${m.volume_source})` : ""}`];
    for (const { model, price } of m.prices) {
      inputs.push(`${model} input $${price.input}, ${price.cached_input !== undefined ? `cached input $${price.cached_input}, ` : ""}${price.cache_write !== undefined ? `cache write $${price.cache_write}, ` : ""}output $${price.output} per 1M tokens, from ${price.source}, checked ${price.checked}`);
    }
    out.push(`Inputs: ${inputs.join("; ")}. Every figure is ${tokenKind(cost)}.`, "");
  } else {
    out.push(`Tokens per 1,000 calls only. Every figure is ${tokenKind(cost)}.`);
    if (cost.missing.length > 0) {
      out.push("", "To see this in money, add to `leanprompt.yaml`:", "");
      for (const x of cost.missing) out.push(`- \`${x.split("\t")[0]}\`: ${x.split("\t")[1] ?? ""}`);
      out.push("", "leanprompt never invents a volume or a price.");
    }
    out.push("");
  }
  if (cost.gpu) out.push(`About ${cost.gpu.hours_per_month.toFixed(1)} hours of GPU prefill time a month at ${cost.gpu.calls_per_month.toLocaleString("en-US")} calls a month.`, "");
  out.push(`| Finding | Where | Tokens per 1,000 calls |${m ? " A month |" : ""}`, `|---|---|---|${m ? "---|" : ""}`);
  for (const r of rows) {
    const t = r.finding.tokens_per_1k!;
    const parts = [t.prompt ? `${formatTokens(t.prompt)} prompt` : "", t.uncached ? `${formatTokens(t.uncached)} not cached` : "", t.output ? `${formatTokens(t.output)} output` : ""].filter(Boolean).join(", ") || "0";
    const tag = r.group === "question" ? " (open question)" : r.group === "server" ? " (server)" : "";
    out.push(`| ${r.finding.rule}${tag} | ${cell(whereText(r.finding))} | ${parts} |${m ? ` ${r.dollars_per_month !== undefined ? formatDollars(r.dollars_per_month) : ""} |` : ""}`);
  }
  out.push("", "The table lists this app's findings first, largest first, then its open questions, then the questions for the server's administrator. Money is not part of the score.", "");
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
  out.push("Money is not part of the score.", "");
  return out;
}

/** The questions only the owner can answer, when nobody answered them (an unattended audit). */
function ownerQuestions(o: ReportInput, cost: CostSummary, ctx: MdContext): string[] {
  const q: string[] = [];
  if (ctx.priority === undefined) q.push("**Priority:** which matters most for this app, cost, speed or quality (or weights)? Not set, so the advice uses equal weights. Answer with `priority:` in `leanprompt.yaml`.");
  const p = o.profile ?? null;
  const hasVolume = !!p && (p.volume !== undefined || (p.targets?.length ? p.targets.every((t) => t.volume) : false));
  if (!hasVolume) q.push("**Volume:** how many calls does the app make a month? Answer with `volume: {calls_per_month: N, source: \"...\"}` in `leanprompt.yaml`.");
  if (!p?.prices && !cost.gpu) q.push("**Prices:** what does each model cost (input, cached input, output per 1M tokens, with the source and the date it was read)? Answer with `prices:` in `leanprompt.yaml`.");
  if (q.length === 0) return [];
  return ["## Questions for the owner", "", "These were not answered during the audit. Until they are, the report shows tokens only and ranks the advice without a priority.", "", ...q.map((x) => `- ${x}`), ""];
}

/** The generated part of `leanprompt-report.md`, from the same inputs as the page. */
export function renderMarkdown(o: ReportInput, ctx: MdContext): string {
  const version = o.version ?? packageVersion();
  const g = groups(o.findings);
  const cost = costSummary(o.findings, o.profile ?? null, o.average_call);
  const notes: Note[] = o.notes ?? [];
  const out: string[] = [
    MD_BEGIN,
    `<!-- Written by npx leanprompt report --md from .leanprompt/findings.json and .leanprompt/score.json. It is replaced on the next run: change the findings file, not this block. The inventory and the next steps go below the block. -->`,
    "",
    `# leanprompt report: ${o.project}`,
    "",
    `${ctx.date} · leanprompt ${version} · target: ${targetText(o.profile)} · priority: ${ctx.priority ?? "not set"}`,
    "",
  ];
  // Headline: the same counts and totals as the page.
  const n = g.open.length;
  let h: string;
  if (n === 0) h = g.questions.length > 0 ? `**Nothing confirmed yet, and ${plural(g.questions.length, "open question")} to settle.**` : "**The audit found no place in this app's code where it pays for tokens it doesn't need.**";
  else {
    const top = g.open[0]!;
    const t = tokensOf(top);
    const lead = top.problem ? splitLead(top.problem)[0].replace(/[.:]$/, "") : ruleTitle(top, o.rules).replace(/\.$/, "");
    h = `**${plural(n, "place")} where this app pays for tokens it doesn't need.** The biggest, at ${where(top)}${t !== undefined ? `, about ${formatTokens(t)} tokens per 1,000 calls` : ""}: ${afterColon(lead)}.`;
    if (cost.with_tokens > 0) h += ` Together about ${formatTokens(cost.tokens_per_1k)} tokens per 1,000 calls (${tokenKind(cost)}).`;
  }
  if (n > 0 && g.questions.length > 0) {
    h += ` Plus ${plural(g.questions.length, "open question")} to confirm${cost.question_tokens_per_1k > 0 ? `; if ${g.questions.length === 1 ? "it holds" : "they hold"}, add about ${formatTokens(cost.question_tokens_per_1k)}` : ""}.`;
  }
  if (g.server.length > 0) h += ` Plus ${plural(g.server.length, "question")} for the server's administrator, not in this app's score.`;
  if (notes.length > 0) h += ` Plus ${plural(notes.length, "other problem")} outside the rules, not scored.`;
  out.push(h, "", `The count of places leaves out the open questions, the questions for the server's administrator and the other problems; each has its own section below.`, "");
  out.push(...costLines(cost));
  out.push("## What's wrong and what to change", "", "Largest first, by estimated tokens lost per 1,000 calls.", "");
  g.open.forEach((f, i) => out.push(...findingBlock(f, i + 1, o, version, "open")));
  if (g.open.length === 0) out.push("No confirmed findings.", "");
  let k = g.open.length;
  if (g.questions.length > 0) {
    out.push("### Open questions", "", "Findings outside this repository, or whose behaviour the code cannot show. They count in the score. Confirm or dismiss each one.", "");
    g.questions.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "question")));
  }
  if (g.server.length > 0) {
    out.push("## Questions for the server's administrator", "");
    out.push("About the server or engine the app calls, not this app's code, so they are not in this app's score (`npx leanprompt score --with-server` counts them). For an LM Warden server, `npx leanprompt profile detect --lmwarden <url>` reads the engine's cache facts into `leanprompt.yaml`.", "");
    g.server.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "server")));
  }
  if (notes.length > 0) {
    out.push("## Other problems the audit found", "", "Checked in the code, outside the rules, not scored.", "");
    notes.forEach((nt, i) => {
      out.push(`### N${i + 1}. ${cell(nt.title)} · ${nt.file === EXTERNAL ? noteWhere(nt) : `\`${noteWhere(nt)}\``}`, "");
      out.push(`- **Problem:** ${cell(nt.problem)}`, `- **What to change:** ${cell(nt.change)}`);
      if (nt.why) out.push(`- **Why it matters:** ${cell(nt.why)}`);
      if (nt.verify) out.push(`- **How to check the fix:** ${cell(nt.verify)}`);
      out.push("");
    });
  }
  if (g.fixed.length > 0) {
    out.push(`### Fixed`, "");
    g.fixed.forEach((f) => out.push(...findingBlock(f, ++k, o, version, "fixed")));
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
