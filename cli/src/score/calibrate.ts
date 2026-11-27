// `leanprompt calibrate`: scale the static severity shares to fit a trial run (DESIGN D4).
// calibrate() is pure; calibrateCommand() reads the files, asks, and writes .leanprompt/weights.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { optionsFor, usageLine, spec } from "../help.js";
import { loadCacheFacts, type CacheFacts } from "../facts.js";
import { loadNoteRuleIds, loadRuleIds } from "../lint/rules.js";
import { parseUsageLog, type UsageRecord } from "../log/record.js";
import { effectiveFacts, loadProfile } from "../profile.js";
import { measuredScore, MIN_CALLS } from "./measured.js";
import { FINDINGS_FILE, filterIgnored, localDate, PACKAGE_ROOT, USAGE_FILE, WEIGHTS_FILE } from "./write.js";
import { parseFindings, staticScore, type Finding, type Weights } from "./static.js";

const BASE_SHARES = { high: 0.5, medium: 0.2, low: 0.05 } as const;
const SHARE_CAP = 0.95;
const K_DECIMALS = 1e4;

export type Side = "prefill" | "generation";

export interface CalibrateOptions {
  source: "real" | "synthetic";
  /** Cache facts per provider, as for `measuredScore`. */
  factsFor: (provider: string) => CacheFacts;
  /** ISO date written into the weights file; today when omitted. */
  date?: string;
}

export type CalibrateResult =
  | {
      ok: true;
      weights: Weights;
      before: { static: number; measured: number };
      after: { static: number };
      /** Measured E, S, G of the log the weights were fitted to. */
      measured: { E: number; S: number; G: number };
      /** Share of all tokens in the log that are prompt tokens. Information only; not used in the fit. */
      split: { prefill_cost_share: number };
      /**
       * How each side's k was found. "exact": the static value meets the measured one. "capped": the
       * measured value lies beyond what the 0.95 share cap allows; k is the smallest that reaches the
       * closest achievable value (`limit`). "unreachable": explicit shares already overshoot the
       * measured value. "none": no finding uses a default share. The last two are not calibratable.
       */
      fit: Record<Side, Fit>;
      /** For a capped side, the closest achievable static E x S (prefill) or G (generation). */
      limit: Partial<Record<Side, number>>;
      /** Sides left at k = 1: "unreachable" or "none". */
      not_calibratable: Side[];
    }
  | { ok: false; reason: "too_few_calls" | "no_findings" | "not_calibratable"; calls?: number };

export type Fit = "exact" | "capped" | "unreachable" | "none";

interface SideFit {
  k: number;
  fit: Fit;
  /** Closest achievable value of the static quantity (E x S or G); set when `fit` is "capped". */
  limit?: number;
}

/**
 * Find k with f(k) = target. `f` is non-increasing (`decreasing`) or non-decreasing in k and constant
 * from `kCap` on, where every default share has reached the 0.95 cap.
 * - target on the wrong side of f(0) (explicit shares already overshoot it): "unreachable", k = 1.
 * - target beyond f(kCap): "capped", k = kCap (the smallest k reaching the closest achievable value).
 * - otherwise "exact", by bisection on [0, kCap].
 */
function solve(f: (k: number) => number, target: number, decreasing: boolean, kCap: number): SideFit {
  const EPS = 1e-9;
  // Positive when x is on the far side of the target (below it for a decreasing f, above it otherwise).
  const past = (x: number): number => (decreasing ? target - x : x - target);
  if (Math.abs(f(0) - target) <= EPS) return { k: 0, fit: "exact" };
  if (past(f(0)) > 0) return { k: 1, fit: "unreachable" };
  const kc = Math.ceil(kCap * K_DECIMALS) / K_DECIMALS;
  if (past(f(kc)) < -EPS) return { k: kc, fit: "capped", limit: f(kc) };
  let lo = 0;
  let hi = kc;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (past(f(mid)) < 0) lo = mid;
    else hi = mid;
  }
  return { k: Math.round(((lo + hi) / 2) * K_DECIMALS) / K_DECIMALS, fit: "exact" };
}

/**
 * Fit k_prefill so the static E x S equals the measured E x S, and k_gen so the static G equals the
 * measured G. Only default severity shares are scaled (an explicit finding `share` is never touched),
 * capped at 0.95. A side with no default-share finding is "not calibratable": its k is 1 and it is
 * listed in `not_calibratable`. The 0.6 / 0.4 split and the measured score are not changed.
 * Fixed findings are ignored, as in `staticScore`; if none remain the result is `no_findings`.
 * Profile `ignore:` filtering is the caller's job.
 */
export function calibrate(findings: readonly Finding[], records: readonly UsageRecord[], o: CalibrateOptions): CalibrateResult {
  const live = findings.filter((f) => !f.fixed);
  if (live.length === 0) return { ok: false, reason: "no_findings" };
  const m = measuredScore(records, o.factsFor);
  if (!m.ok) return { ok: false, reason: "too_few_calls", calls: m.calls - m.unmeasured };

  const sides = (side: Side): { fixed: number; defaults: number[] } => {
    let fixed = 1;
    const defaults: number[] = [];
    for (const f of live) {
      if (side === "prefill" ? f.saves === "generation" : f.saves === "prefill") continue;
      if (f.share !== undefined) fixed *= 1 - f.share;
      else defaults.push(BASE_SHARES[f.severity]);
    }
    return { fixed, defaults };
  };
  // Product of (1 - share) on one side as a function of k.
  const keep = (s: { fixed: number; defaults: number[] }) => (k: number) =>
    s.defaults.reduce((acc, d) => acc * (1 - Math.min(SHARE_CAP, d * k)), s.fixed);
  const pre = sides("prefill");
  const gen = sides("generation");
  const kCap = (d: number[]): number => SHARE_CAP / Math.min(...d);
  const fits: Record<Side, SideFit> = {
    prefill: pre.defaults.length === 0 ? { k: 1, fit: "none" } : solve(keep(pre), m.inputs.E * m.inputs.S, true, kCap(pre.defaults)),
    generation: gen.defaults.length === 0 ? { k: 1, fit: "none" } : solve((k) => 1 - keep(gen)(k), m.inputs.G, false, kCap(gen.defaults)),
  };
  const not_calibratable = (["prefill", "generation"] as const).filter((x) => fits[x].fit === "unreachable" || fits[x].fit === "none");
  if (not_calibratable.length === 2) return { ok: false, reason: "not_calibratable" };
  const k_prefill = fits.prefill.k;
  const k_gen = fits.generation.k;

  const weights: Weights = {
    v: 1,
    shares: { ...BASE_SHARES },
    k_prefill,
    k_gen,
    source: o.source,
    calls: m.calls - m.unmeasured,
    date: o.date ?? localDate(),
  };
  let prompt = 0;
  let output = 0;
  for (const r of records) {
    prompt += r.prompt_tokens;
    output += r.output_tokens;
  }
  return {
    ok: true,
    weights,
    before: { static: staticScore(live).score, measured: m.score },
    after: { static: staticScore(live, weights).score },
    measured: m.inputs,
    split: { prefill_cost_share: prompt + output > 0 ? prompt / (prompt + output) : 0 },
    fit: { prefill: fits.prefill.fit, generation: fits.generation.fit },
    limit: Object.fromEntries((["prefill", "generation"] as const).flatMap((x) => (fits[x].limit === undefined ? [] : [[x, fits[x].limit]]))),
    not_calibratable,
  };
}

export interface CalibrateIo {
  /** Ask a yes/no question; the default reads one line from stdin. */
  confirm?: (question: string) => Promise<boolean>;
  /** Whether stdin is a terminal; defaults to `process.stdin.isTTY`. */
  isTTY?: boolean;
}

async function askStdin(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

const USAGE_TEXT = `usage: ${usageLine(spec("calibrate"))}
`;

/** `leanprompt calibrate`: print before/after, ask, then write `.leanprompt/weights.json`. */
export async function calibrateCommand(args: string[], io: CalibrateIo = {}): Promise<number> {
  let values: { findings?: string; usage?: string; synthetic?: boolean; yes?: boolean; dir?: string };
  try {
    values = parseArgs({
      args,
      options: optionsFor("calibrate"),
      strict: true,
    }).values;
  } catch (e) {
    process.stderr.write(`leanprompt: ${(e as Error).message}\n${USAGE_TEXT}`);
    return 2;
  }
  const dir = resolve(values.dir ?? ".");
  const findingsPath = resolve(values.findings ?? join(dir, FINDINGS_FILE));
  const usagePath = resolve(values.usage ?? join(dir, USAGE_FILE));
  for (const p of [findingsPath, usagePath]) if (!existsSync(p)) throw new Error(`${p}: no such file`);

  const parsed = parseFindings(readFileSync(findingsPath, "utf8"), loadRuleIds(PACKAGE_ROOT), loadNoteRuleIds(PACKAGE_ROOT));
  if (parsed.errors.length > 0) throw new Error(`${findingsPath}: ${parsed.errors.join("; ")}`);
  const profile = loadProfile(dir);
  const findings = filterIgnored(parsed.findings, profile);
  const { records, bad } = parseUsageLog(readFileSync(usagePath, "utf8"));
  if (bad > 0) process.stderr.write(`leanprompt: skipped ${bad} unreadable line(s) in ${usagePath}\n`);
  const facts = loadCacheFacts(PACKAGE_ROOT);
  const r = calibrate(findings, records, {
    source: values.synthetic ? "synthetic" : "real",
    factsFor: (provider) => effectiveFacts(profile, facts, provider),
  });

  if (!r.ok) {
    const msg = {
      too_few_calls: `calibration needs at least ${MIN_CALLS} measured calls; found ${r.calls}. Log more calls, or run without calibrating to keep the default weights.\n`,
      no_findings: "no findings to calibrate: the findings file has none left after removing fixed and ignored ones.\n",
      not_calibratable:
        "nothing to calibrate: every finding carries an explicit share, so scaling the severity defaults would change nothing. No weights written.\n",
    }[r.reason];
    process.stderr.write(`leanprompt calibrate: ${msg}`);
    return 1;
  }

  const f = (x: number): string => x.toFixed(2);
  const w = r.weights;
  const side = (s: Side, k: number): string => {
    const quantity = s === "prefill" ? "E x S" : "G";
    const dir = s === "prefill" ? "lower" : "higher";
    switch (r.fit[s]) {
      case "none":
        return "not calibratable (no finding uses a default share), left at 1";
      case "unreachable":
        return `not calibratable (explicit shares already overshoot the measured ${quantity}), left at 1`;
      case "capped":
        return `x${k}, capped: shares hit the 0.95 limit; static ${quantity} cannot go ${dir} than ${f(r.limit[s]!)}`;
      default:
        return `x${k}`;
    }
  };
  const out = [
    `leanprompt calibrate (${w.source}, ${w.calls} measured calls)`,
    `  measured score:        ${r.before.measured}   (E=${f(r.measured.E)} S=${f(r.measured.S)} G=${f(r.measured.G)})`,
    `  static score before:   ${r.before.static}   (default shares)`,
    `  static score after:    ${r.after.static}   (calibrated)`,
    `  k_prefill: ${side("prefill", w.k_prefill)}`,
    `  k_gen:     ${side("generation", w.k_gen)}`,
    `  prompt tokens are ${(r.split.prefill_cost_share * 100).toFixed(0)}% of all tokens in this log (token counts, not prices; for information only)`,
    "",
  ];
  process.stdout.write(out.join("\n"));

  const target = join(dir, WEIGHTS_FILE);
  if (!values.yes) {
    const tty = io.isTTY ?? process.stdin.isTTY === true;
    if (!tty && !io.confirm) {
      process.stderr.write(`leanprompt calibrate: stdin is not a terminal, so nothing was written. Re-run with --yes to write ${WEIGHTS_FILE}.\n`);
      return 1;
    }
    const yes = await (io.confirm ?? askStdin)(`write ${WEIGHTS_FILE}? [y/N] `);
    if (!yes) {
      process.stdout.write(`not written\n`);
      return 0;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(w, null, 2)}\n`);
  process.stdout.write(`wrote ${target}\n`);
  return 0;
}
