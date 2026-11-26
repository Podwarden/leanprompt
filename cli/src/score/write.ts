import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { optionsFor } from "../help.js";
import { loadCacheFacts } from "../facts.js";
import { loadRuleIds } from "../lint/rules.js";
import { parseUsageLog } from "../log/record.js";
import { effectiveFacts, loadProfile, type Profile } from "../profile.js";
import { measuredScore, MIN_CALLS, type MeasuredScore, type UnmeasuredReason } from "./measured.js";
import { parseFindings, staticScore, type Finding, type Weights } from "./static.js";

export type Kind = "measured" | "static";

// cli/src/score and cli/dist/score are the same depth below the package root.
export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VERSION: string = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

// Display names: always "/" (join() still makes native paths where a file is opened).
export const USAGE_FILE = ".leanprompt/usage.jsonl";
export const FINDINGS_FILE = ".leanprompt/findings.json";
export const WEIGHTS_FILE = ".leanprompt/weights.json";
const SCORE_FILE = join(".leanprompt", "score.json");

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

/**
 * `leanprompt score [--measured [<usage.jsonl>]] [--static [<findings.json>]] [--dir <project>]`.
 * A bare `--measured` or `--static` means the project's own `.leanprompt/usage.jsonl` or `.leanprompt/findings.json`.
 */
export async function scoreCommand(args: string[]): Promise<number> {
  let values: { measured?: string; static?: string; dir?: string };
  // parseArgs has no optional-value strings: give a bare flag an empty value, resolved below.
  const argv = args.map((a, i) => ((a === "--static" || a === "--measured") && (args[i + 1] === undefined || args[i + 1]!.startsWith("--")) ? `${a}=` : a));
  try {
    values = parseArgs({ args: argv, options: optionsFor("score"), strict: true }).values;
  } catch (e) {
    process.stderr.write(`leanprompt: ${(e as Error).message}\n`);
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
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
    const s = staticScore(findings, w ?? undefined);
    score = s.score;
    inputs = s.inputs;
    weights = s.weights;
    evidence = { diagnostics: { default_shares: s.default_shares.used, findings: s.default_shares.of } };
  }

  const out = {
    schemaVersion: 1,
    label: "leanprompt",
    message: `${score} ${kind}${weights === "calibrated" ? ", calibrated" : ""}`,
    color: badgeColor(score, kind),
    v: 1,
    score,
    kind,
    inputs,
    weights,
    ...evidence,
    date: new Date().toISOString().slice(0, 10),
    leanprompt: VERSION,
  };
  const target = join(dir, SCORE_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

  const f = (x: number): string => x.toFixed(2);
  process.stdout.write(`leanprompt score: ${out.message}\n  E prefill reuse ${f(inputs.E)}, S prefix stability ${f(inputs.S)}, G generation waste ${f(inputs.G)}\n`);
  if (kind === "static") {
    const d = evidence.diagnostics as { default_shares: number; findings: number };
    process.stdout.write(`  default_shares: ${d.default_shares} of ${d.findings} findings used the severity default share, not an estimate\n`);
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
  return 0;
}
