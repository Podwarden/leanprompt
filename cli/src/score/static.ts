export type Saves = "prefill" | "generation" | "both";
export type Severity = "high" | "medium" | "low";

/** `file` of a finding that lives outside the repository (an engine's launch flags, a gateway's config). */
export const EXTERNAL = "<external>";

export interface Finding {
  rule: string;
  /** A path relative to the project root, or `<external>`. */
  file: string;
  /** The line the fix changes; 0 for an `<external>` finding with no line. */
  line: number;
  saves: Saves;
  severity: Severity;
  share?: number;
  fixed?: boolean;
  /** `needs-facts`: whether the finding holds depends on a fact not known yet (`confirm` names it). */
  status?: "needs-facts";
  /** Free text: where an `<external>` finding lives, for example "engine launch flags". Required for `<external>`. */
  where?: string;
  /** The fact that would confirm or dismiss the finding. Required with `status: "needs-facts"`. */
  confirm?: string;
  /** Plain-English explanation for the report and the page (each at most 600 characters). */
  problem?: string;
  change?: string;
  why?: string;
  /** The estimate as words, for example "about 138k tokens per 1,000 calls". */
  estimate?: string;
  assumptions?: string;
  verify?: string;
  /** The model this finding's calls use: the key into `prices:` in leanprompt.yaml. */
  model?: string;
  /** Tokens this finding loses per 1,000 calls of the whole app, by how they are billed (see TokensLost). */
  tokens_per_1k?: TokensLost;
}

/**
 * Tokens lost per 1,000 calls of the whole app. `prompt`: prompt tokens sent that need not be sent at all
 * (a retry, a repeated context), billed at the full input price. `uncached`: prompt tokens the cache could
 * have served and did not, billed at the input price less the cached-input price. `output`: output tokens
 * thrown away. `measured_calls`: set when the numbers come from a usage log of that many calls.
 */
export interface TokensLost {
  prompt?: number;
  uncached?: number;
  output?: number;
  measured_calls?: number;
}

/** The audit's assumed average call, for the share of the bill a fix saves. */
export interface AverageCall {
  prompt_tokens: number;
  output_tokens: number;
}

/** The plain-English text fields of a finding, and their length limit. */
export const TEXT_FIELDS = ["problem", "change", "why", "estimate", "assumptions", "verify"] as const;
export const TEXT_MAX = 600;

/** A finding the report lists under "Open questions": outside the repository, or waiting on a fact. */
export const isOpenQuestion = (f: Finding): boolean => f.file === EXTERNAL || f.status === "needs-facts";

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
  /** Of the `of` findings scored (not fixed), how many had no `share` and used the severity default. */
  default_shares: { used: number; of: number };
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
export function parseFindings(
  text: string,
  ruleIds: ReadonlySet<string>,
): { findings: Finding[]; errors: string[]; average_call?: AverageCall } {
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
  let average_call: AverageCall | undefined;
  if (d.average_call !== undefined) {
    const a = d.average_call as Record<string, unknown> | null;
    const okNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (a && typeof a === "object" && !Array.isArray(a) && okNum(a.prompt_tokens) && okNum(a.output_tokens) && Object.keys(a).length === 2) {
      average_call = { prompt_tokens: a.prompt_tokens as number, output_tokens: a.output_tokens as number };
    } else errors.push("average_call must be {prompt_tokens, output_tokens}, both positive numbers");
  }
  if (!Array.isArray(d.findings)) {
    errors.push("findings must be an array");
    return { findings, errors, ...(average_call ? { average_call } : {}) };
  }
  d.findings.forEach((raw: unknown, i: number) => {
    const at = `findings[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void errors.push(`${at}: must be an object`);
    const r = raw as Record<string, unknown>;
    const bad = (msg: string) => void errors.push(`${at}: ${msg}`);
    if (typeof r.rule !== "string" || !ruleIds.has(r.rule)) return bad(`unknown rule ${String(r.rule)}`);
    if (typeof r.file !== "string" || !r.file) return bad("file must be a non-empty string");
    const external = r.file === EXTERNAL;
    if (external) {
      if (r.line !== undefined && (typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 0)) return bad("line must be 0 or a positive integer");
    } else if (typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 1) return bad("line must be a positive integer");
    if (typeof r.saves !== "string" || !SAVES.includes(r.saves)) return bad(`bad saves ${String(r.saves)}`);
    if (typeof r.severity !== "string" || !SEVERITY.includes(r.severity)) return bad(`bad severity ${String(r.severity)}`);
    if (r.share !== undefined && (typeof r.share !== "number" || !(r.share >= 0 && r.share <= 1))) return bad("share must be a number in [0, 1]");
    if (r.fixed !== undefined && typeof r.fixed !== "boolean") return bad("fixed must be a boolean");
    const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
    if (external && !text(r.where)) return bad("a finding in <external> needs `where` (for example \"engine launch flags\")");
    for (const k of ["where", "confirm"] as const) if (r[k] !== undefined && !text(r[k])) return bad(`${k} must be a non-empty string`);
    if (r.status !== undefined && r.status !== "needs-facts") return bad(`status must be needs-facts, not ${String(r.status)}`);
    if (r.status === "needs-facts" && r.confirm === undefined) return bad("a needs-facts finding needs `confirm`: the fact that would confirm or dismiss it");
    for (const k of TEXT_FIELDS) {
      const v = r[k];
      if (v !== undefined && (!text(v) || v.length > TEXT_MAX)) return bad(`${k} must be a non-empty string of at most ${TEXT_MAX} characters`);
    }
    if (r.model !== undefined && !text(r.model)) return bad("model must be a non-empty string");
    let tokens: TokensLost | undefined;
    if (r.tokens_per_1k !== undefined) {
      const t = r.tokens_per_1k as Record<string, unknown> | null;
      if (!t || typeof t !== "object" || Array.isArray(t)) return bad("tokens_per_1k must be an object");
      const keys = Object.keys(t);
      if (keys.length === 0) return bad("tokens_per_1k needs prompt, uncached or output");
      tokens = {};
      for (const k of keys) {
        const v = t[k];
        if (k === "measured_calls") {
          if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return bad("tokens_per_1k.measured_calls must be a positive integer");
          tokens.measured_calls = v;
        } else if (k === "prompt" || k === "uncached" || k === "output") {
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return bad(`tokens_per_1k.${k} must be a number >= 0`);
          tokens[k] = v;
        } else return bad(`tokens_per_1k: unknown key ${k}`);
      }
      if (tokens.prompt === undefined && tokens.uncached === undefined && tokens.output === undefined) return bad("tokens_per_1k needs prompt, uncached or output");
    }
    const out: Finding = { rule: r.rule, file: r.file, line: (r.line as number | undefined) ?? 0, saves: r.saves as Saves, severity: r.severity as Severity };
    if (r.share !== undefined) out.share = r.share as number;
    if (r.fixed !== undefined) out.fixed = r.fixed;
    if (r.status !== undefined) out.status = "needs-facts";
    if (r.where !== undefined) out.where = r.where as string;
    if (r.confirm !== undefined) out.confirm = r.confirm as string;
    for (const k of TEXT_FIELDS) if (r[k] !== undefined) out[k] = r[k] as string;
    if (r.model !== undefined) out.model = r.model as string;
    if (tokens) out.tokens_per_1k = tokens;
    findings.push(out);
  });
  return { findings, errors, ...(average_call ? { average_call } : {}) };
}

/**
 * Static score: floor(100 x (0.6 x E x S + 0.4 x (1 - G))).
 * E x S = product of (1 - share) over prefill findings (reported as E, with S = 1);
 * G = 1 - product of (1 - share) over generation findings. `both` counts on both sides;
 * `fixed` findings are skipped. `<external>` and `needs-facts` findings count like any other.
 * Pure: filtering by the profile's `ignore:` is the caller's job.
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
  const default_shares = { used: 0, of: 0 };
  for (const f of findings) {
    if (f.fixed) continue;
    default_shares.of++;
    if (f.share === undefined) default_shares.used++;
    const share = (k: number): number => f.share ?? (weights ? Math.min(SHARE_CAP, DEFAULT_SHARE[f.severity] * k) : DEFAULT_SHARE[f.severity]);
    if (f.saves !== "generation") es *= 1 - share(weights?.k_prefill ?? 1);
    if (f.saves !== "prefill") keepG *= 1 - share(weights?.k_gen ?? 1);
  }
  const inputs = { E: es, S: 1, G: 1 - keepG };
  return { score: scoreFrom(inputs), inputs, weights: weights ? "calibrated" : "default", default_shares };
}
