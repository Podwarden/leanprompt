export type Saves = "prefill" | "generation" | "both";
export type Severity = "high" | "medium" | "low";
export type Status = "needs-facts" | "frequency-unknown" | "size-unknown";
export const STATUSES: readonly Status[] = ["needs-facts", "frequency-unknown", "size-unknown"];

/**
 * What the project already knows about a finding, from its tracker or docs (the audit's prior-art step).
 * `planned` and `in-progress`: the project means to make the change, or is making it. `reported`: someone has
 * raised it (an issue or a pull request) and the project has not decided. `declined`: the project decided against
 * it. None of these counts toward the headline estimate or the static score.
 */
export type KnownKind = "planned" | "in-progress" | "declined" | "reported";
export const KNOWN_KINDS: readonly KnownKind[] = ["planned", "in-progress", "declined", "reported"];
export interface Known {
  /** The issue, pull request, discussion, decision record or doc that shows it, as an http(s) URL. */
  url?: string;
  kind: KnownKind;
  /** One line on what the link says (at most 600 characters). */
  note?: string;
}
export type FixBy = "app" | "server";

/** `file` of a finding that lives outside the repository (an engine's launch flags, a gateway's config). */
export const EXTERNAL = "<external>";

export interface Finding {
  /** Optional id, unique in the file, for `overlaps` and for a note's `finding`. */
  id?: string;
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
   * `size-unknown`: the code shows the problem and how often; only how many tokens it costs each time is assumed.
   * Each needs `confirm`: the fact that would settle it.
   */
  status?: Status;
  /**
   * Who makes the fix: `app` (the app's code) or `server` (the server's or engine's settings, for its administrator).
   * Default: `server` for an LP-LW finding in `<external>`, `app` otherwise. Server findings are left out of the
   * app's static score by default (see `staticScore`).
   */
  fix_by?: FixBy;
  /**
   * Planned work this finding is already part of: an issue link or reference, a TODO, a design note.
   * Kept for files written before 0.1.0-dev.14: it means the same as `known: {kind: "planned", note: <text>}`.
   */
  planned?: string;
  /** What the project already knows about it (prior art): planned, in progress, declined or reported, with the link. */
  known?: Known;
  /**
   * Ids of other findings that lose some of the same tokens (one fix covers both, or fixing one shrinks the
   * other). In the totals and the score, a group of overlapping findings counts once: the largest wins.
   */
  overlaps?: string[];
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
  /** A correctness rule (`saves: none` in its frontmatter, such as LP-GE-11) the note applies. */
  rule?: string;
  /** With `rule`: how serious, as the rule's "Waste signal" says for the shape found. */
  severity?: Severity;
  /** The id of a finding this note is another face of (the same bug, seen by the user). */
  finding?: string;
  /** What the project already knows about it. A declined note is listed with its link only, and left out of the hand-off. */
  known?: Known;
  /** A path relative to the project root, or `<external>`. */
  file: string;
  /** The line the note is about; 0 for an `<external>` note with no line. */
  line: number;
  problem: string;
  change: string;
  why?: string;
  verify?: string;
}

export const NOTE_KEYS = ["title", "rule", "severity", "finding", "known", "file", "line", "problem", "change", "why", "verify"] as const;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
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

/** What the project already knows about a finding: `known`, or the older `planned` text as a planned entry. Fixed findings are not "known". */
export const knownOf = (f: Finding): Known | undefined =>
  f.known ?? (f.planned !== undefined ? { kind: "planned", note: f.planned } : undefined);

/** A finding the project already knows about (prior art): left out of the headline estimate and the static score. */
export const isKnownFinding = (f: Finding): boolean => !f.fixed && knownOf(f) !== undefined;

/** A finding the report lists under "Open questions": an app finding outside the repository, or one whose behaviour is unconfirmed. */
export const isOpenQuestion = (f: Finding): boolean => !isKnownFinding(f) && !isServerFinding(f) && (f.file === EXTERNAL || f.status === "needs-facts");

/**
 * Groups of findings that overlap (connected through `overlaps`), as lists of indexes into `findings`.
 * A finding with no overlaps is a group of one. Ids that name no finding are ignored here (parseFindings rejects them).
 */
export function overlapGroups(findings: readonly Finding[]): number[][] {
  const parent = findings.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const byId = new Map<string, number>();
  findings.forEach((f, i) => f.id !== undefined && byId.set(f.id, i));
  findings.forEach((f, i) => {
    for (const o of f.overlaps ?? []) {
      const j = byId.get(o);
      if (j !== undefined) parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, number[]>();
  findings.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()];
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
  /** Of the `of` findings scored (not fixed), how many had no `share` and used the severity default. */
  default_shares: { used: number; of: number };
  /** Open server findings (not fixed): left out of the score unless `includeServer`, counted in `of` when included. */
  server_findings: number;
  /** Whether server findings were counted. */
  included_server: boolean;
  /** Open findings the project already knows about (`known`, or the older `planned`): left out unless `includeKnown`. */
  known_findings: number;
  included_known: boolean;
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
  /** Ids of the correctness rules (`saves: none`): a note may name one; a finding may not. See `loadNoteRuleIds`. */
  noteRuleIds: ReadonlySet<string> = new Set(),
): { findings: Finding[]; errors: string[]; average_call?: AverageCall; kvsig?: KvsigUse; notes?: Note[]; unattended?: boolean } {
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
        const n = parseNote(raw, `notes[${i}]`, errors, noteRuleIds);
        if (n) notes!.push(n);
      });
    }
  }
  let unattended: boolean | undefined;
  if (d.unattended !== undefined) {
    if (typeof d.unattended !== "boolean") errors.push("unattended must be true or false");
    else unattended = d.unattended;
  }
  const extra = { ...(average_call ? { average_call } : {}), ...(kvsig ? { kvsig } : {}), ...(notes ? { notes } : {}), ...(unattended !== undefined ? { unattended } : {}) };
  if (!Array.isArray(d.findings)) {
    errors.push("findings must be an array");
    return { findings, errors, ...extra };
  }
  d.findings.forEach((raw: unknown, i: number) => {
    const at = `findings[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void errors.push(`${at}: must be an object`);
    const r = raw as Record<string, unknown>;
    const bad = (msg: string) => void errors.push(`${at}: ${msg}`);
    if (typeof r.rule === "string" && noteRuleIds.has(r.rule)) return bad(`${r.rule} is a correctness rule with no token share: record it as a note with "rule": "${r.rule}"`);
    if (typeof r.rule !== "string" || !ruleIds.has(r.rule)) return bad(`unknown rule ${String(r.rule)}`);
    if (r.id !== undefined && (typeof r.id !== "string" || !ID_RE.test(r.id))) return bad("id must be 1 to 40 letters, digits, dots, dashes or underscores, starting with a letter or digit");
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
    if (r.status !== undefined && !(STATUSES as readonly unknown[]).includes(r.status)) {
      return bad(`status must be needs-facts, frequency-unknown or size-unknown, not ${String(r.status)}`);
    }
    if (r.status === "needs-facts" && r.confirm === undefined) return bad("a needs-facts finding needs `confirm`: the fact that would confirm or dismiss it");
    if (r.status === "frequency-unknown" && r.confirm === undefined) return bad("a frequency-unknown finding needs `confirm`: what would show how often it happens");
    if (r.status === "size-unknown" && r.confirm === undefined) return bad("a size-unknown finding needs `confirm`: what would show how many tokens it costs");
    if (r.fix_by !== undefined && r.fix_by !== "app" && r.fix_by !== "server") return bad(`fix_by must be app or server, not ${String(r.fix_by)}`);
    if (r.planned !== undefined && (!text(r.planned) || r.planned.length > TEXT_MAX)) return bad(`planned must be a non-empty string of at most ${TEXT_MAX} characters`);
    let known: Known | undefined;
    if (r.known !== undefined) {
      if (r.planned !== undefined) return bad("give known or planned, not both (known: {kind: \"planned\", url, note} replaces planned)");
      const k = parseKnown(r.known);
      if (typeof k === "string") return bad(k);
      known = k;
    }
    let overlaps: string[] | undefined;
    if (r.overlaps !== undefined) {
      if (!Array.isArray(r.overlaps) || r.overlaps.length === 0 || !r.overlaps.every((x) => typeof x === "string" && ID_RE.test(x))) return bad("overlaps must be a non-empty list of finding ids");
      if (r.id === undefined) return bad("a finding with overlaps needs its own id");
      if (r.overlaps.includes(r.id)) return bad("a finding cannot overlap itself");
      overlaps = [...(r.overlaps as string[])];
    }
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
    if (r.id !== undefined) out.id = r.id as string;
    if (r.share !== undefined) out.share = r.share as number;
    if (r.share_prefill !== undefined) out.share_prefill = r.share_prefill as number;
    if (r.share_output !== undefined) out.share_output = r.share_output as number;
    if (r.fixed !== undefined) out.fixed = r.fixed;
    if (r.status !== undefined) out.status = r.status as Status;
    if (r.fix_by !== undefined) out.fix_by = r.fix_by as FixBy;
    if (r.planned !== undefined) out.planned = r.planned as string;
    if (known) out.known = known;
    if (overlaps) out.overlaps = overlaps;
    if (r.where !== undefined) out.where = r.where as string;
    if (r.confirm !== undefined) out.confirm = r.confirm as string;
    for (const k of TEXT_FIELDS) if (r[k] !== undefined) out[k] = r[k] as string;
    if (r.model !== undefined) out.model = r.model as string;
    if (tokens) out.tokens_per_1k = tokens;
    findings.push(out);
  });
  // Ids are unique, and overlaps and notes name findings that exist.
  const ids = new Map<string, number>();
  findings.forEach((f, i) => {
    if (f.id === undefined) return;
    if (ids.has(f.id)) errors.push(`findings: id ${f.id} is used twice`);
    else ids.set(f.id, i);
  });
  for (const f of findings) {
    for (const o of f.overlaps ?? []) if (!ids.has(o)) errors.push(`finding ${f.id}: overlaps names ${o}, which no finding has as its id`);
  }
  for (const [i, n] of (notes ?? []).entries()) {
    if (n.finding !== undefined && !ids.has(n.finding)) errors.push(`notes[${i}]: finding ${n.finding} is not the id of any finding`);
  }
  return { findings, errors, ...extra };
}

/** A `known` entry, validated; the error text when it is malformed. */
function parseKnown(raw: unknown): Known | string {
  const k = raw as Record<string, unknown> | null;
  if (!k || typeof k !== "object" || Array.isArray(k)) return "known must be {url, kind, note}";
  const extraKeys = Object.keys(k).filter((x) => !["url", "kind", "note"].includes(x));
  if (extraKeys.length) return `known: unknown key ${extraKeys[0]}`;
  if (typeof k.kind !== "string" || !(KNOWN_KINDS as readonly string[]).includes(k.kind)) return `known.kind must be one of ${KNOWN_KINDS.join(", ")}`;
  if (typeof k.url !== "string" || !/^https?:\/\/\S+$/.test(k.url) || k.url.length > TEXT_MAX) return "known.url must be the http(s) link to the issue, pull request or doc that shows it";
  if (k.note !== undefined && (typeof k.note !== "string" || k.note.trim() === "" || k.note.length > TEXT_MAX)) return `known.note must be a non-empty string of at most ${TEXT_MAX} characters`;
  return { url: k.url, kind: k.kind as KnownKind, ...(k.note !== undefined ? { note: k.note as string } : {}) };
}

/** One `notes` entry, validated; null (with the error recorded) when it is malformed. */
function parseNote(raw: unknown, at: string, errors: string[], noteRuleIds: ReadonlySet<string>): Note | null {
  const bad = (msg: string) => (errors.push(`${at}: ${msg}`), null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("must be an object");
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!(NOTE_KEYS as readonly string[]).includes(k)) {
      return bad(["share", "saves", "share_prefill", "share_output", "tokens_per_1k"].includes(k) ? `${k} is not allowed: a note is never scored` : `unknown key ${k}`);
    }
  }
  if (r.rule !== undefined && (typeof r.rule !== "string" || !noteRuleIds.has(r.rule))) {
    return bad(`rule ${String(r.rule)} is not a correctness rule; a note may name only a rule with saves: none (such as LP-GE-11), or leave rule out`);
  }
  if (r.severity !== undefined && (r.rule === undefined || typeof r.severity !== "string" || !SEVERITY.includes(r.severity))) {
    return bad(r.rule === undefined ? "severity is not allowed on a note without a rule: a note is never scored" : "severity must be high, medium or low");
  }
  if (r.finding !== undefined && (typeof r.finding !== "string" || !ID_RE.test(r.finding))) return bad("finding must be the id of a finding");
  let known: Known | undefined;
  if (r.known !== undefined) {
    const k = parseKnown(r.known);
    if (typeof k === "string") return bad(k);
    known = k;
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
  if (r.rule !== undefined) n.rule = r.rule as string;
  if (r.severity !== undefined) n.severity = r.severity as Severity;
  if (r.finding !== undefined) n.finding = r.finding as string;
  if (known) n.known = known;
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
 * Known findings (`isKnownFinding`: planned, in progress, declined or reported in the project's own tracker
 * or docs) are skipped unless `includeKnown` (a score change in 0.1.0-dev.14). Findings that overlap
 * (`overlaps`) count once per group: on each side, the largest share in the group (0.1.0-dev.14).
 * Pure: filtering by the profile's `ignore:` is the caller's job.
 *
 * Share per finding: an explicit share (set by the auditor) is used as is. Otherwise the
 * severity default (high 0.5, medium 0.2, low 0.05); with `weights`, that default becomes
 * min(0.95, default x k_prefill) on the prefill side or min(0.95, default x k_gen) on the
 * generation side. k does NOT scale an explicit share: calibration corrects the guessed
 * defaults, not a share the auditor stated.
 */
export function staticScore(findings: readonly Finding[], weights?: Weights, opts: { includeServer?: boolean; includeKnown?: boolean } = {}): StaticScore {
  const default_shares = { used: 0, of: 0 };
  let server_findings = 0;
  let known_findings = 0;
  const scored: { p: number; o: number }[] = [];
  const scoredFindings: Finding[] = [];
  for (const f of findings) {
    if (f.fixed) continue;
    if (isKnownFinding(f)) {
      known_findings++;
      if (!opts.includeKnown) continue;
    }
    if (isServerFinding(f)) {
      server_findings++;
      if (!opts.includeServer) continue;
    }
    default_shares.of++;
    const explicit = f.share !== undefined || f.share_prefill !== undefined || f.share_output !== undefined;
    if (!explicit) default_shares.used++;
    const share = (side: number | undefined, k: number): number =>
      side ?? f.share ?? (weights ? Math.min(SHARE_CAP, DEFAULT_SHARE[f.severity] * k) : DEFAULT_SHARE[f.severity]);
    scored.push({
      p: f.saves !== "generation" ? share(f.share_prefill, weights?.k_prefill ?? 1) : 0,
      o: f.saves !== "prefill" ? share(f.share_output, weights?.k_gen ?? 1) : 0,
    });
    scoredFindings.push(f);
  }
  let es = 1;
  let keepG = 1;
  for (const g of overlapGroups(scoredFindings)) {
    es *= 1 - Math.max(...g.map((i) => scored[i]!.p));
    keepG *= 1 - Math.max(...g.map((i) => scored[i]!.o));
  }
  const inputs = { E: es, S: 1, G: 1 - keepG };
  return {
    score: scoreFrom(inputs),
    inputs,
    weights: weights ? "calibrated" : "default",
    default_shares,
    server_findings,
    included_server: opts.includeServer === true,
    known_findings,
    included_known: opts.includeKnown === true,
  };
}
