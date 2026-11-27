export type Saves = "prefill" | "generation" | "both";
export type Severity = "high" | "medium" | "low";
export type Status = "needs-facts" | "frequency-unknown";
export type FixBy = "app" | "server";

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
  /** `saves: both` only: the share on each side, when the two differ (give both, in place of or as well as `share`). */
  share_prefill?: number;
  share_output?: number;
  fixed?: boolean;
  /**
   * `needs-facts`: the behaviour itself is not confirmed; whether the finding holds depends on a fact not known yet.
   * `frequency-unknown`: the code shows the problem; only how often it happens is assumed.
   * Either needs `confirm`: the fact that would settle it.
   */
  status?: Status;
  /**
   * Who makes the fix: `app` (the app's code) or `server` (the server's or engine's settings, for its administrator).
   * Default: `server` for an LP-LW finding in `<external>`, `app` otherwise. Server findings are left out of the
   * app's static score by default (see `staticScore`).
   */
  fix_by?: FixBy;
  /** Planned work this finding is already part of: an issue link or reference, a TODO, a design note. */
  planned?: string;
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
 * thrown away. `cache_write`: for a fix that adds cache marks, the prompt tokens the fix would newly write to the
 * cache, billed at the cache-write price instead of the input price; the money estimate subtracts that premium.
 * It is a cost of the fix, not tokens lost, so it is not in the token totals. `measured_calls`: set when the
 * numbers come from a usage log of that many calls.
 */
export interface TokensLost {
  prompt?: number;
  uncached?: number;
  output?: number;
  cache_write?: number;
  measured_calls?: number;
}

/**
 * A verified problem the rules have no place for (a spend meter that ignores cache tokens, a cut-off answer
 * accepted as complete). Reported after the findings and in the hand-off block; never scored, so it has no
 * share, severity or saves.
 */
export interface Note {
  title: string;
  /** A path relative to the project root, or `<external>`. */
  file: string;
  /** The line the note is about; 0 for an `<external>` note with no line. */
  line: number;
  problem: string;
  change: string;
  why?: string;
  verify?: string;
}

export const NOTE_KEYS = ["title", "file", "line", "problem", "change", "why", "verify"] as const;
export const NOTE_TITLE_MAX = 120;

/** The audit's assumed average call, for the share of the bill a fix saves. */
export interface AverageCall {
  prompt_tokens: number;
  output_tokens: number;
}

/**
 * Whether the app already uses kvsig (imports it, or depends on it), and where. Recognition only:
 * the score never reads it, so a findings file scores the same with or without it.
 */
export interface KvsigUse {
  used: boolean;
  /** Where the app uses it, as `file:line` (or a dependency file), for example "src/llm/hosted.ts:12". */
  where?: string[];
}

/** The plain-English text fields of a finding, and their length limit. */
export const TEXT_FIELDS = ["problem", "change", "why", "estimate", "assumptions", "verify"] as const;
export const TEXT_MAX = 600;

/**
 * Whether the fix is a setting of the server or engine (for its administrator), not a change to the app's code:
 * `fix_by: "server"`, or by default an LP-LW finding outside the repository.
 */
export const isServerFinding = (f: Finding): boolean => (f.fix_by ?? (f.file === EXTERNAL && f.rule.startsWith("LP-LW-") ? "server" : "app")) === "server";

/** A finding the report lists under "Open questions": an app finding outside the repository, or one whose behaviour is unconfirmed. */
export const isOpenQuestion = (f: Finding): boolean => !isServerFinding(f) && (f.file === EXTERNAL || f.status === "needs-facts");

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
  /** Open server findings (not fixed): left out of the score unless `includeServer`, counted in `of` when included. */
  server_findings: number;
  /** Whether server findings were counted. */
  included_server: boolean;
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
): { findings: Finding[]; errors: string[]; average_call?: AverageCall; kvsig?: KvsigUse; notes?: Note[] } {
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
  let kvsig: KvsigUse | undefined;
  if (d.kvsig !== undefined) {
    const k = d.kvsig as Record<string, unknown> | null;
    const okWhere = (w: unknown): w is string[] =>
      Array.isArray(w) && w.length > 0 && w.every((x) => typeof x === "string" && x.trim() !== "" && x.length <= TEXT_MAX);
    if (!k || typeof k !== "object" || Array.isArray(k) || typeof k.used !== "boolean" || Object.keys(k).some((x) => x !== "used" && x !== "where")) {
      errors.push("kvsig must be {used: true or false, where: [\"file:line\", ...]}");
    } else if (k.where !== undefined && !okWhere(k.where)) errors.push("kvsig.where must be a non-empty list of non-empty strings");
    else if (k.used && k.where === undefined) errors.push("kvsig.where is required when kvsig.used is true: list where the app uses it");
    else kvsig = { used: k.used, ...(k.where !== undefined ? { where: [...(k.where as string[])] } : {}) };
  }
  let notes: Note[] | undefined;
  if (d.notes !== undefined) {
    if (!Array.isArray(d.notes)) errors.push("notes must be an array");
    else {
      notes = [];
      d.notes.forEach((raw: unknown, i: number) => {
        const n = parseNote(raw, `notes[${i}]`, errors);
        if (n) notes!.push(n);
      });
    }
  }
  const extra = { ...(average_call ? { average_call } : {}), ...(kvsig ? { kvsig } : {}), ...(notes ? { notes } : {}) };
  if (!Array.isArray(d.findings)) {
    errors.push("findings must be an array");
    return { findings, errors, ...extra };
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
    const shareOk = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
    if (r.share !== undefined && !shareOk(r.share)) return bad("share must be a number in [0, 1]");
    for (const k of ["share_prefill", "share_output"] as const) if (r[k] !== undefined && !shareOk(r[k])) return bad(`${k} must be a number in [0, 1]`);
    const sides = [r.share_prefill, r.share_output].filter((v) => v !== undefined).length;
    if (sides > 0 && r.saves !== "both") return bad("share_prefill and share_output are for a finding that saves both; use share");
    if (sides === 1 && r.share === undefined) return bad("give both share_prefill and share_output (a side the finding does not touch gets 0), or share");
    if (r.fixed !== undefined && typeof r.fixed !== "boolean") return bad("fixed must be a boolean");
    const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
    if (external && !text(r.where)) return bad("a finding in <external> needs `where` (for example \"engine launch flags\")");
    for (const k of ["where", "confirm"] as const) if (r[k] !== undefined && !text(r[k])) return bad(`${k} must be a non-empty string`);
    if (r.status !== undefined && r.status !== "needs-facts" && r.status !== "frequency-unknown") {
      return bad(`status must be needs-facts or frequency-unknown, not ${String(r.status)}`);
    }
    if (r.status === "needs-facts" && r.confirm === undefined) return bad("a needs-facts finding needs `confirm`: the fact that would confirm or dismiss it");
    if (r.status === "frequency-unknown" && r.confirm === undefined) return bad("a frequency-unknown finding needs `confirm`: what would show how often it happens");
    if (r.fix_by !== undefined && r.fix_by !== "app" && r.fix_by !== "server") return bad(`fix_by must be app or server, not ${String(r.fix_by)}`);
    if (r.planned !== undefined && (!text(r.planned) || r.planned.length > TEXT_MAX)) return bad(`planned must be a non-empty string of at most ${TEXT_MAX} characters`);
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
      // An empty object means "nothing to estimate", the same as leaving the field out.
      if (keys.length > 0) {
        const tl: TokensLost = {};
        for (const k of keys) {
          const v = t[k];
          if (k === "measured_calls") {
            if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return bad("tokens_per_1k.measured_calls must be a positive integer");
            tl.measured_calls = v;
          } else if (k === "prompt" || k === "uncached" || k === "output" || k === "cache_write") {
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return bad(`tokens_per_1k.${k} must be a number >= 0`);
            tl[k] = v;
          } else return bad(`tokens_per_1k: unknown key ${k}`);
        }
        if (tl.prompt === undefined && tl.uncached === undefined && tl.output === undefined) {
          return bad("tokens_per_1k needs prompt, uncached or output (or leave it out, or {}, when nothing can be estimated)");
        }
        tokens = tl;
      }
    }
    const out: Finding = { rule: r.rule, file: r.file, line: (r.line as number | undefined) ?? 0, saves: r.saves as Saves, severity: r.severity as Severity };
    if (r.share !== undefined) out.share = r.share as number;
    if (r.share_prefill !== undefined) out.share_prefill = r.share_prefill as number;
    if (r.share_output !== undefined) out.share_output = r.share_output as number;
    if (r.fixed !== undefined) out.fixed = r.fixed;
    if (r.status !== undefined) out.status = r.status as Status;
    if (r.fix_by !== undefined) out.fix_by = r.fix_by as FixBy;
    if (r.planned !== undefined) out.planned = r.planned as string;
    if (r.where !== undefined) out.where = r.where as string;
    if (r.confirm !== undefined) out.confirm = r.confirm as string;
    for (const k of TEXT_FIELDS) if (r[k] !== undefined) out[k] = r[k] as string;
    if (r.model !== undefined) out.model = r.model as string;
    if (tokens) out.tokens_per_1k = tokens;
    findings.push(out);
  });
  return { findings, errors, ...extra };
}

/** One `notes` entry, validated; null (with the error recorded) when it is malformed. */
function parseNote(raw: unknown, at: string, errors: string[]): Note | null {
  const bad = (msg: string) => (errors.push(`${at}: ${msg}`), null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("must be an object");
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!(NOTE_KEYS as readonly string[]).includes(k)) {
      return bad(["share", "severity", "saves", "rule"].includes(k) ? `${k} is not allowed: a note is never scored` : `unknown key ${k}`);
    }
  }
  const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;
  if (!text(r.title, NOTE_TITLE_MAX)) return bad(`title must be a non-empty string of at most ${NOTE_TITLE_MAX} characters`);
  if (typeof r.file !== "string" || !r.file) return bad("file must be a non-empty string");
  if (r.file === EXTERNAL) {
    if (r.line !== undefined && (typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 0)) return bad("line must be 0 or a positive integer");
  } else if (typeof r.line !== "number" || !Number.isInteger(r.line) || r.line < 1) return bad("line must be a positive integer");
  for (const k of ["problem", "change"] as const) if (!text(r[k], TEXT_MAX)) return bad(`${k} must be a non-empty string of at most ${TEXT_MAX} characters`);
  for (const k of ["why", "verify"] as const) {
    if (r[k] !== undefined && !text(r[k], TEXT_MAX)) return bad(`${k} must be a non-empty string of at most ${TEXT_MAX} characters`);
  }
  const n: Note = { title: r.title, file: r.file, line: (r.line as number | undefined) ?? 0, problem: r.problem as string, change: r.change as string };
  if (r.why !== undefined) n.why = r.why as string;
  if (r.verify !== undefined) n.verify = r.verify as string;
  return n;
}

/**
 * Static score: floor(100 x (0.6 x E x S + 0.4 x (1 - G))).
 * E x S = product of (1 - share) over prefill findings (reported as E, with S = 1);
 * G = 1 - product of (1 - share) over generation findings. `both` counts on both sides, with
 * `share_prefill` and `share_output` in place of `share` when given; `fixed` findings are skipped.
 * Server findings (`isServerFinding`: the fix is a server or engine setting) are skipped too, unless
 * `includeServer`: the score is the app's (a score change in 0.1.0-dev.13, docs/score.md). App findings
 * in `<external>` and `needs-facts` findings count like any other.
 * Pure: filtering by the profile's `ignore:` is the caller's job.
 *
 * Share per finding: an explicit share (set by the auditor) is used as is. Otherwise the
 * severity default (high 0.5, medium 0.2, low 0.05); with `weights`, that default becomes
 * min(0.95, default x k_prefill) on the prefill side or min(0.95, default x k_gen) on the
 * generation side. k does NOT scale an explicit share: calibration corrects the guessed
 * defaults, not a share the auditor stated.
 */
export function staticScore(findings: readonly Finding[], weights?: Weights, opts: { includeServer?: boolean } = {}): StaticScore {
  let es = 1;
  let keepG = 1;
  const default_shares = { used: 0, of: 0 };
  let server_findings = 0;
  for (const f of findings) {
    if (f.fixed) continue;
    if (isServerFinding(f)) {
      server_findings++;
      if (!opts.includeServer) continue;
    }
    default_shares.of++;
    const explicit = f.share !== undefined || f.share_prefill !== undefined || f.share_output !== undefined;
    if (!explicit) default_shares.used++;
    const share = (side: number | undefined, k: number): number =>
      side ?? f.share ?? (weights ? Math.min(SHARE_CAP, DEFAULT_SHARE[f.severity] * k) : DEFAULT_SHARE[f.severity]);
    if (f.saves !== "generation") es *= 1 - share(f.share_prefill, weights?.k_prefill ?? 1);
    if (f.saves !== "prefill") keepG *= 1 - share(f.share_output, weights?.k_gen ?? 1);
  }
  const inputs = { E: es, S: 1, G: 1 - keepG };
  return {
    score: scoreFrom(inputs),
    inputs,
    weights: weights ? "calibrated" : "default",
    default_shares,
    server_findings,
    included_server: opts.includeServer === true,
  };
}
