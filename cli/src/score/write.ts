import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { optionsFor } from "../help.js";
import { loadCacheFacts } from "../facts.js";
import { loadRuleIds, loadRules, type RuleInfo } from "../lint/rules.js";
import { parseUsageLog } from "../log/record.js";
import { effectiveFacts, loadProfile, type Profile } from "../profile.js";
import { measuredScore, MIN_CALLS, type MeasuredScore, type UnmeasuredReason } from "./measured.js";
import { isServerFinding, parseFindings, staticScore, type Finding, type Weights } from "./static.js";

export type Kind = "measured" | "static";

// cli/src/score and cli/dist/score are the same depth below the package root.
export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VERSION: string = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

// Display names: always "/" (join() still makes native paths where a file is opened).
export const USAGE_FILE = ".leanprompt/usage.jsonl";
export const FINDINGS_FILE = ".leanprompt/findings.json";
export const WEIGHTS_FILE = ".leanprompt/weights.json";
const SCORE_FILE = join(".leanprompt", "score.json");

/** Today's date on this machine's clock, `YYYY-MM-DD` (local time, not UTC: the date the user sees). */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** shields.io colour for a score. Static scores are estimates from an audit, so they are always grey. */
export function badgeColor(score: number, kind: Kind): string {
  if (kind === "static") return "lightgrey";
  if (score >= 90) return "brightgreen";
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

/** Read and validate `.leanprompt/weights.json`. Null when absent; throws naming the file when invalid. */
export function loadWeights(file: string): Weights | null {
  if (!existsSync(file)) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  const d = doc as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error(`${file}: must be an object`);
  if (d.v !== 1) throw new Error(`${file}: v must be 1`);
  for (const k of ["k_prefill", "k_gen"]) {
    const x = d[k];
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0) throw new Error(`${file}: ${k} must be a finite number >= 0`);
  }
  return d as unknown as Weights;
}

/** What to do about each reason a call was left unmeasured, printed with a refusal. */
const REASON_HINTS: Partial<Record<UnmeasuredReason, string>> = {
  no_usage: "no prompt token count: pass the provider response's usage object to the logger",
  unknown_provider: "no cache facts for the record's provider: log a provider name leanprompt knows, or set target in leanprompt.yaml (see skills/measure-loop/SKILL.md)",
  ambiguous_target:
    "the record's provider has no cache table and matches none of the several targets in leanprompt.yaml: log the backend's own name (vllm, lm-warden, openai...) or add a targets entry with that provider (see docs/profile.md)",
  no_ids: "the request could not be identified (unsupported dialect, stateful or malformed body)",
};

/** `no_usage 60, no_ids 3`, nonzero reasons only. */
export function formatReasons(byReason: Record<UnmeasuredReason, number>): string {
  return (Object.entries(byReason) as [UnmeasuredReason, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
}

/** Drop findings the profile's `ignore:` list names (same rule and file). */
export function filterIgnored(findings: Finding[], profile: Profile | null | undefined): Finding[] {
  const ignore = profile?.ignore ?? [];
  return findings.filter((f) => !ignore.some((i) => i.rule === f.rule && i.file === f.file));
}

/** Escape for a GitHub Actions workflow command: the message, and (with `property`) a key=value property. */
export function ghEscape(s: string, property = false): string {
  let out = s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  if (property) out = out.replace(/:/g, "%3A").replace(/,/g, "%2C");
  return out;
}

/**
 * One `::warning` line per open finding (not fixed, not on the ignore list), for GitHub Actions to show
 * on the file and line. An `<external>` finding, or one with no line, is annotated without them.
 */
export function githubAnnotations(findings: Finding[], rules: Map<string, RuleInfo>): string[] {
  return findings
    .filter((f) => f.fixed !== true)
    .map((f) => {
      const props: string[] = [];
      if (f.file !== "<external>") {
        props.push(`file=${ghEscape(f.file, true)}`);
        if (f.line > 0) props.push(`line=${f.line}`);
      }
      const title = rules.get(f.rule)?.title;
      props.push(`title=${ghEscape(`leanprompt ${f.rule}${title ? `: ${title}` : ""}`, true)}`);
      const where = f.file === "<external>" ? ` (${f.where ?? "outside the repository"})` : "";
      const question = f.status === "needs-facts" ? ` Open question: ${f.confirm ?? "confirm before fixing"}` : "";
      const server = isServerFinding(f) ? " For the server's administrator, not in the app's score." : "";
      const msg = `${f.problem ?? title ?? f.rule}${where}${f.estimate ? ` Estimate: ${f.estimate}.` : ""}${question}${server}`;
      return `::warning ${props.join(",")}::${ghEscape(msg)}`;
    });
}

/**
 * `leanprompt score [--measured [<usage.jsonl>]] [--static [<findings.json>]] [--dir <project>]`.
 * A bare `--measured` or `--static` means the project's own `.leanprompt/usage.jsonl` or `.leanprompt/findings.json`.
 */
export async function scoreCommand(args: string[]): Promise<number> {
  let values: { measured?: string; static?: string; dir?: string; github?: boolean; "fail-under"?: string; "with-server"?: boolean };
  // parseArgs has no optional-value strings: give a bare flag an empty value, resolved below.
  const argv = args.map((a, i) => ((a === "--static" || a === "--measured") && (args[i + 1] === undefined || args[i + 1]!.startsWith("--")) ? `${a}=` : a));
  try {
    values = parseArgs({ args: argv, options: optionsFor("score"), strict: true }).values;
  } catch (e) {
    process.stderr.write(`leanprompt: ${(e as Error).message}\n`);
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  let failUnder: number | undefined;
  if (values["fail-under"] !== undefined) {
    failUnder = Number(values["fail-under"]);
    if (values["fail-under"].trim() === "" || !Number.isFinite(failUnder) || failUnder < 0 || failUnder > 100) {
      process.stderr.write(`leanprompt: --fail-under needs a number from 0 to 100, not "${values["fail-under"]}"\n`);
      return 2;
    }
  }
  if (values.measured !== undefined && values.static !== undefined) {
    process.stderr.write("leanprompt: give --measured or --static, not both\n");
    return 2;
  }
  let measuredPath = values.measured === undefined ? undefined : values.measured === "" ? join(dir, USAGE_FILE) : resolve(values.measured);
  let staticPath = values.static === undefined ? undefined : values.static === "" ? join(dir, FINDINGS_FILE) : resolve(values.static);
  if (measuredPath === undefined && staticPath === undefined) {
    if (existsSync(join(dir, USAGE_FILE))) measuredPath = join(dir, USAGE_FILE);
    else if (existsSync(join(dir, FINDINGS_FILE))) staticPath = join(dir, FINDINGS_FILE);
    else {
      process.stderr.write(`leanprompt: nothing to score: neither ${USAGE_FILE} nor ${FINDINGS_FILE} exists in ${dir}. Pass --measured or --static.\n`);
      return 2;
    }
  }

  if (values["with-server"] === true && measuredPath !== undefined) {
    process.stderr.write("leanprompt: --with-server is for the static score (the measured score reads the usage log); add --static\n");
    return 2;
  }
  const profile = loadProfile(dir);
  let kind: Kind;
  let score: number;
  let inputs: { E: number; S: number; G: number };
  let weights: "default" | "calibrated" = "default";
  let evidence: Record<string, unknown>;

  if (measuredPath !== undefined) {
    kind = "measured";
    if (!existsSync(measuredPath)) throw new Error(`${measuredPath}: no such file`);
    const { records, bad } = parseUsageLog(readFileSync(measuredPath, "utf8"));
    if (bad > 0) process.stderr.write(`leanprompt: skipped ${bad} unreadable line(s) in ${measuredPath}\n`);
    const facts = loadCacheFacts(PACKAGE_ROOT);
    const r = measuredScore(records, (provider) => effectiveFacts(profile, facts, provider));
    if (!r.ok) {
      const found = r.calls - r.unmeasured;
      process.stderr.write(`measured score needs at least ${MIN_CALLS} calls; found ${found}. Run with --static to score from the audit's findings.\n`);
      if (r.unmeasured > 0) {
        process.stderr.write(`(${r.unmeasured} of ${r.calls} logged calls could not be measured and are not counted: ${formatReasons(r.unmeasured_by_reason)}.)\n`);
        for (const [k, n] of Object.entries(r.unmeasured_by_reason) as [UnmeasuredReason, number][]) {
          if (n > 0 && REASON_HINTS[k]) process.stderr.write(`  ${k}: ${REASON_HINTS[k]}\n`);
        }
      }
      return 1;
    }
    const m: MeasuredScore = r;
    score = m.score;
    inputs = m.inputs;
    evidence = {
      calls: m.calls,
      unmeasured: m.unmeasured,
      diagnostics: { estimate: m.estimate, heads: m.heads, unmeasured_by_reason: m.unmeasured_by_reason },
    };
  } else {
    kind = "static";
    const file = staticPath!;
    if (!existsSync(file)) throw new Error(`${file}: no such file`);
    const parsed = parseFindings(readFileSync(file, "utf8"), loadRuleIds(PACKAGE_ROOT));
    if (parsed.errors.length > 0) throw new Error(`${file}: ${parsed.errors.join("; ")}`);
    const findings = filterIgnored(parsed.findings, profile);
    const w = loadWeights(join(dir, WEIGHTS_FILE));
    const withServer = values["with-server"] === true;
    const s = staticScore(findings, w ?? undefined, { includeServer: withServer });
    score = s.score;
    inputs = s.inputs;
    weights = s.weights;
    evidence = {
      diagnostics: { default_shares: s.default_shares.used, findings: s.default_shares.of, ...(s.server_findings > 0 ? { server_findings: s.server_findings } : {}) },
    };
    if (s.server_findings > 0) {
      // The other figure, so the app score and the one with the server's findings can both be read from the file.
      const other = withServer ? staticScore(findings, w ?? undefined) : staticScore(findings, w ?? undefined, { includeServer: true });
      evidence.server = withServer
        ? { included: true, findings: s.server_findings, app_score: other.score, app_inputs: other.inputs }
        : { included: false, findings: s.server_findings, with_server_score: other.score, with_server_inputs: other.inputs };
    }
  }

  const out = {
    schemaVersion: 1,
    label: "leanprompt",
    message: `${score} ${kind}${weights === "calibrated" ? ", calibrated" : ""}${(evidence.server as { included?: boolean } | undefined)?.included ? ", with server" : ""}`,
    color: badgeColor(score, kind),
    v: 1,
    score,
    kind,
    inputs,
    weights,
    ...evidence,
    date: localDate(),
    leanprompt: VERSION,
  };
  const target = join(dir, SCORE_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

  const f = (x: number): string => x.toFixed(2);
  process.stdout.write(`leanprompt score: ${out.message}\n  E prefill reuse ${f(inputs.E)}, S prefix stability ${f(inputs.S)}, G generation waste ${f(inputs.G)}\n`);
  if (kind === "static") {
    const d = evidence.diagnostics as { default_shares: number; findings: number; server_findings: number };
    process.stdout.write(`  default_shares: ${d.default_shares} of ${d.findings} findings used the severity default share, not an estimate\n`);
    const sv = evidence.server as { included: boolean; app_score?: number; with_server_score?: number } | undefined;
    if (sv && !sv.included) {
      process.stdout.write(
        `  server: ${d.server_findings} finding${d.server_findings === 1 ? "" : "s"} for the server's administrator left out of this app score (with them: ${sv.with_server_score}; --with-server counts them)\n`,
      );
    } else if (sv) {
      process.stdout.write(`  server: ${d.server_findings} finding${d.server_findings === 1 ? "" : "s"} for the server's administrator counted (app only: ${sv.app_score})\n`);
    }
    if (d.findings > 0 && d.default_shares === d.findings) {
      process.stdout.write(`  note: every share is a severity default, so this score says little about this app; give each finding a share from the audit's estimate (skills/llm-call-audit/SKILL.md, "The findings file")\n`);
    }
  }
  if (kind === "measured") {
    const calls = evidence.calls as number;
    const unmeasured = evidence.unmeasured as number;
    process.stdout.write(`  calls logged ${calls}, measured ${calls - unmeasured}, unmeasured ${unmeasured}\n`);
  }
  process.stdout.write(`  wrote ${target}\n`);

  if (values.github === true) {
    // Annotations come from the findings file, whichever score was computed.
    const file = staticPath ?? join(dir, FINDINGS_FILE);
    let open: string[] = [];
    if (existsSync(file)) {
      const parsed = parseFindings(readFileSync(file, "utf8"), loadRuleIds(PACKAGE_ROOT));
      if (parsed.errors.length > 0) throw new Error(`${file}: ${parsed.errors.join("; ")}`);
      open = githubAnnotations(filterIgnored(parsed.findings, profile), loadRules(PACKAGE_ROOT));
    }
    for (const line of open) process.stdout.write(`${line}\n`);
    const n = open.length;
    process.stdout.write(`::notice title=leanprompt score::${ghEscape(`leanprompt score ${out.message}; ${n} open finding${n === 1 ? "" : "s"}${existsSync(file) ? "" : ` (no ${FINDINGS_FILE})`}`)}\n`);
  }
  if (failUnder !== undefined && score < failUnder) {
    process.stderr.write(`leanprompt: score ${score} is below --fail-under ${failUnder}\n`);
    return 3;
  }
  return 0;
}
