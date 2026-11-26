export type Saves = "prefill" | "generation" | "both";
export type Severity = "high" | "medium" | "low";

export interface Finding {
  rule: string;
  file: string;
  line: number;
  saves: Saves;
  severity: Severity;
  share?: number;
  fixed?: boolean;
}

/** `.leanprompt/weights.json`, written by `calibrate`. */
export interface Weights {
  v: 1;
  shares: { high: number; medium: number; low: number };
  k_prefill: number;
  k_gen: number;
  source: "real" | "synthetic";
  calls: number;
  date: string;
}

export interface StaticScore {
  score: number;
  inputs: { E: number; S: number; G: number };
  weights: "default" | "calibrated";
}

const DEFAULT_SHARE: Record<Severity, number> = { high: 0.5, medium: 0.2, low: 0.05 };
const SHARE_CAP = 0.95;
const SAVES: readonly string[] = ["prefill", "generation", "both"];
const SEVERITY: readonly string[] = ["high", "medium", "low"];

/** The score formula shared by the static and measured scores: floor(100 x (0.6 x E x S + 0.4 x (1 - G))). */
export function scoreFrom({ E, S, G }: { E: number; S: number; G: number }): number {
  // The epsilon guards against 91.99999... from float error before floor.
  return Math.floor(100 * (0.6 * E * S + 0.4 * (1 - G)) + 1e-9);
}

/**
 * Parse `.leanprompt/findings.json`. Invalid entries are dropped and reported in `errors`;
 * `ruleIds` is the set of known rule ids (see `loadRuleIds`).
 */
export function parseFindings(text: string, ruleIds: ReadonlySet<string>): { findings: Finding[]; errors: string[] } {
  const findings: Finding[] = [];
  const errors: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { findings, errors: ["findings file is not valid JSON"] };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { findings, errors: ["findings file must be an object"] };
  const d = doc as Record<string, unknown>;
  if (d.v !== 1) errors.push("v must be 1");
  if (!Array.isArray(d.findings)) {
    errors.push("findings must be an array");
    return { findings, errors };
  }
  d.findings.forEach((raw: unknown, i: number) => {
    const at = `findings[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void errors.push(`${at}: must be an object`);
    const r = raw as Record<string, unknown>;
    const bad = (msg: string) => void errors.push(`${at}: ${msg}`);
    if (typeof r.rule !== "string" || !ruleIds.has(r.rule)) return bad(`unknown rule ${String(r.rule)}`);
    if (typeof r.file !== "string" || !r.file) return bad("file must be a non-empty string");
    if (typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 1) return bad("line must be a positive integer");
    if (typeof r.saves !== "string" || !SAVES.includes(r.saves)) return bad(`bad saves ${String(r.saves)}`);
    if (typeof r.severity !== "string" || !SEVERITY.includes(r.severity)) return bad(`bad severity ${String(r.severity)}`);
    if (r.share !== undefined && (typeof r.share !== "number" || !(r.share >= 0 && r.share <= 1))) return bad("share must be a number in [0, 1]");
    if (r.fixed !== undefined && typeof r.fixed !== "boolean") return bad("fixed must be a boolean");
    const out: Finding = { rule: r.rule, file: r.file, line: r.line, saves: r.saves as Saves, severity: r.severity as Severity };
    if (r.share !== undefined) out.share = r.share as number;
    if (r.fixed !== undefined) out.fixed = r.fixed;
    findings.push(out);
  });
  return { findings, errors };
}

/**
 * Static score: floor(100 x (0.6 x E x S + 0.4 x (1 - G))).
 * E x S = product of (1 - share) over prefill findings (reported as E, with S = 1);
 * G = 1 - product of (1 - share) over generation findings. `both` counts on both sides;
 * `fixed` findings are skipped. Pure: filtering by the profile's `ignore:` is the caller's job.
 *
 * Share per finding: an explicit `share` (set by the auditor) is used as is. Otherwise the
 * severity default (high 0.5, medium 0.2, low 0.05); with `weights`, that default becomes
 * min(0.95, default x k_prefill) on the prefill side or min(0.95, default x k_gen) on the
 * generation side. k does NOT scale an explicit share: calibration corrects the guessed
 * defaults, not a share the auditor stated.
 */
export function staticScore(findings: readonly Finding[], weights?: Weights): StaticScore {
  let es = 1;
  let keepG = 1;
  for (const f of findings) {
    if (f.fixed) continue;
    const share = (k: number): number => f.share ?? (weights ? Math.min(SHARE_CAP, DEFAULT_SHARE[f.severity] * k) : DEFAULT_SHARE[f.severity]);
    if (f.saves !== "generation") es *= 1 - share(weights?.k_prefill ?? 1);
    if (f.saves !== "prefill") keepG *= 1 - share(weights?.k_gen ?? 1);
  }
  const inputs = { E: es, S: 1, G: 1 - keepG };
  return { score: scoreFrom(inputs), inputs, weights: weights ? "calibrated" : "default" };
}
