import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { CacheFacts } from "./facts.js";

export const ENGINES = ["vllm", "sglang", "llama.cpp", "lm-warden"] as const;
export type Engine = (typeof ENGINES)[number];

export interface EngineFacts {
  block_tokens?: number;
  match_unit_tokens?: number;
  speculative?: boolean;
  kv_memory_gb?: number;
  /** Measured prefill throughput of the engine, for the GPU time a finding costs. */
  prefill_tokens_per_second?: number;
}

/** How many calls the app (or one backend) makes a month; `source` says where the number came from. */
export interface Volume {
  calls_per_month: number;
  source?: string;
}

/**
 * Prices for one model, per 1M tokens, with where they came from and when they were checked. In US dollars unless
 * `currency` names another currency (an ISO 4217 code such as CNY or EUR); leanprompt shows the figure as given and
 * never converts it.
 */
export interface Price {
  /** ISO 4217 code, upper case; absent means USD. */
  currency?: string;
  input: number;
  output: number;
  cached_input?: number;
  cache_write?: number;
  source: string;
  /** YYYY-MM-DD */
  checked: string;
}

/** One backend: a hosted provider or a self-hosted engine (exactly one in a `targets` entry). */
export interface Target {
  provider?: string;
  engine?: Engine;
  model_family?: string;
  context_tokens?: number;
  /** `targets` entries only: globs of the files whose calls go to this backend (for the audit). */
  files?: string[];
  /** `targets` engine entries only: this engine's cache facts, in place of the top-level `engine:`. */
  engine_facts?: EngineFacts;
  /** `targets` entries only: this backend's monthly call volume. */
  volume?: Volume;
}

export interface Profile {
  /** The single target. Empty when the profile uses `targets`. */
  target: Target;
  /** Several backends, for an app that calls more than one (issue #4). Absent when `target` is used. */
  targets?: Target[];
  engine?: EngineFacts;
  priority: { cost: number; speed: number; quality: number };
  ignore?: { rule: string; file: string }[];
  /** Calls a month, for the money estimate. With `targets`, each entry carries its own instead. */
  volume?: Volume;
  /** Model name -> price, for the money estimate. */
  prices?: Record<string, Price>;
}

const KEYS = ["target", "targets", "engine", "priority", "ignore", "volume", "prices"];
const TARGET_KEYS = ["provider", "engine", "model_family", "context_tokens"];
const TARGETS_ENTRY_KEYS = [...TARGET_KEYS, "files", "engine_facts", "volume"];
const ENGINE_KEYS = ["block_tokens", "match_unit_tokens", "speculative", "kv_memory_gb", "prefill_tokens_per_second"];
const PRICE_KEYS = ["input", "output", "cached_input", "cache_write", "currency", "source", "checked"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ["cost", "speed", "quality"] as const;

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPosInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function unknownKeys(m: Record<string, unknown>, allowed: string[], prefix: string, errors: string[]): void {
  for (const k of Object.keys(m)) if (!allowed.includes(k)) errors.push(`unknown key: ${prefix}${k}`);
}

function section(raw: unknown, name: string, errors: string[]): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isMap(raw)) {
    errors.push(`${name} must be a mapping`);
    return undefined;
  }
  return raw;
}

function parseTargetFields(t: Record<string, unknown>, out: Target, at: string, errors: string[]): void {
  if (t.provider !== undefined) isStr(t.provider) ? (out.provider = t.provider) : errors.push(`${at}.provider must be a string`);
  if (t.engine !== undefined) {
    if (typeof t.engine === "string" && (ENGINES as readonly string[]).includes(t.engine)) out.engine = t.engine as Engine;
    else errors.push(`${at}.engine must be one of ${ENGINES.join(", ")}`);
  }
  if (t.model_family !== undefined) isStr(t.model_family) ? (out.model_family = t.model_family) : errors.push(`${at}.model_family must be a string`);
  if (t.context_tokens !== undefined) isPosInt(t.context_tokens) ? (out.context_tokens = t.context_tokens) : errors.push(`${at}.context_tokens must be a positive integer`);
}

function parseEngineFacts(raw: unknown, at: string, errors: string[]): EngineFacts | undefined {
  const e = section(raw, at, errors);
  if (!e) return undefined;
  unknownKeys(e, ENGINE_KEYS, `${at}.`, errors);
  const engine: EngineFacts = {};
  for (const k of ["block_tokens", "match_unit_tokens"] as const) {
    if (e[k] !== undefined) isPosInt(e[k]) ? (engine[k] = e[k] as number) : errors.push(`${at}.${k} must be a positive integer`);
  }
  if (e.speculative !== undefined) typeof e.speculative === "boolean" ? (engine.speculative = e.speculative) : errors.push(`${at}.speculative must be true or false`);
  if (e.kv_memory_gb !== undefined) isNum(e.kv_memory_gb) && e.kv_memory_gb > 0 ? (engine.kv_memory_gb = e.kv_memory_gb) : errors.push(`${at}.kv_memory_gb must be a positive number`);
  if (e.prefill_tokens_per_second !== undefined) {
    isNum(e.prefill_tokens_per_second) && e.prefill_tokens_per_second > 0
      ? (engine.prefill_tokens_per_second = e.prefill_tokens_per_second)
      : errors.push(`${at}.prefill_tokens_per_second must be a positive number`);
  }
  return engine;
}

function parseVolume(raw: unknown, at: string, errors: string[]): Volume | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isMap(raw)) return void errors.push(`${at} must be a mapping: {calls_per_month: N}`);
  unknownKeys(raw, ["calls_per_month", "source"], `${at}.`, errors);
  if (!isPosInt(raw.calls_per_month)) return void errors.push(`${at}.calls_per_month must be a positive integer`);
  const v: Volume = { calls_per_month: raw.calls_per_month };
  if (raw.source !== undefined) isStr(raw.source) ? (v.source = raw.source) : errors.push(`${at}.source must be a string`);
  return v;
}

/** A YAML date may arrive as a string or, under some schemas, a Date. */
const dateText = (v: unknown): string | undefined =>
  v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : typeof v === "string" && DATE.test(v) ? v : undefined;

function parsePrices(raw: unknown, errors: string[]): Record<string, Price> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isMap(raw)) return void errors.push("prices must be a mapping of model name to price");
  const out: Record<string, Price> = {};
  for (const [model, p] of Object.entries(raw)) {
    const at = `prices.${model}`;
    if (!isMap(p)) {
      errors.push(`${at} must be a mapping`);
      continue;
    }
    unknownKeys(p, PRICE_KEYS, `${at}.`, errors);
    let ok = true;
    const price = { source: "", checked: "" } as Price;
    for (const k of ["input", "output", "cached_input", "cache_write"] as const) {
      const v = p[k];
      if (v === undefined) {
        if (k === "input" || k === "output") {
          errors.push(`${at}.${k} is required (per 1M tokens, in US dollars unless currency is set)`);
          ok = false;
        }
      } else if (isNum(v) && v >= 0) price[k] = v;
      else {
        errors.push(`${at}.${k} must be a number >= 0 (per 1M tokens, in US dollars unless currency is set)`);
        ok = false;
      }
    }
    if (p.currency !== undefined) {
      if (typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency)) {
        if (p.currency !== "USD") price.currency = p.currency;
      } else {
        errors.push(`${at}.currency must be a three-letter ISO 4217 code in capitals, such as USD, CNY or EUR`);
        ok = false;
      }
    }
    if (isStr(p.source)) price.source = p.source;
    else {
      errors.push(`${at}.source is required: the pricing page's URL, or where your own price comes from`);
      ok = false;
    }
    const checked = dateText(p.checked);
    if (checked) price.checked = checked;
    else {
      errors.push(`${at}.checked is required: the date the price was read, as YYYY-MM-DD`);
      ok = false;
    }
    if (ok) out[model] = price;
  }
  return out;
}

function parsePriority(raw: unknown, errors: string[]): Profile["priority"] {
  const third = 1 / 3;
  const equal = { cost: third, speed: third, quality: third };
  if (raw === undefined || raw === null) return equal;
  if (typeof raw === "string") {
    if ((PRIORITIES as readonly string[]).includes(raw)) {
      return { cost: 0, speed: 0, quality: 0, [raw]: 1 } as Profile["priority"];
    }
    errors.push("priority must be cost, speed, quality or a weights object");
    return equal;
  }
  if (!isMap(raw)) {
    errors.push("priority must be cost, speed, quality or a weights object");
    return equal;
  }
  unknownKeys(raw, [...PRIORITIES], "priority.", errors);
  const w = {} as Profile["priority"];
  let ok = true;
  for (const k of PRIORITIES) {
    const v = raw[k];
    if (!isNum(v) || v < 0) {
      errors.push(`priority.${k} must be a number >= 0`);
      ok = false;
    } else w[k] = v;
  }
  if (!ok) return equal;
  if (Math.abs(w.cost + w.speed + w.quality - 1) > 0.01) {
    errors.push("priority weights must sum to 1");
    return equal;
  }
  return w;
}

/** Parse and validate the text of a leanprompt.yaml. Never throws; problems come back in `errors`. */
export function parseProfile(text: string): { profile?: Profile; errors: string[] } {
  const errors: string[] = [];
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { errors: [`invalid YAML: ${(e as Error).message.split("\n")[0]}`] };
  }
  if (doc === null || doc === undefined) doc = {};
  if (!isMap(doc)) return { errors: ["leanprompt.yaml must be a mapping"] };
  unknownKeys(doc, KEYS, "", errors);

  const target: Profile["target"] = {};
  const t = section(doc.target, "target", errors);
  if (t) {
    unknownKeys(t, TARGET_KEYS, "target.", errors);
    parseTargetFields(t, target, "target", errors);
  }

  let targets: Target[] | undefined;
  if (doc.targets !== undefined && doc.targets !== null) {
    if (!Array.isArray(doc.targets) || doc.targets.length === 0) errors.push("targets must be a non-empty list of entries");
    else {
      targets = [];
      doc.targets.forEach((raw: unknown, i: number) => {
        const at = `targets[${i}]`;
        if (!isMap(raw)) return void errors.push(`${at} must be a mapping`);
        unknownKeys(raw, TARGETS_ENTRY_KEYS, `${at}.`, errors);
        const entry: Target = {};
        parseTargetFields(raw, entry, at, errors);
        if (raw.provider !== undefined && raw.engine !== undefined) errors.push(`${at}: set provider or engine, not both`);
        else if (raw.provider === undefined && raw.engine === undefined) errors.push(`${at}: set provider or engine`);
        if (raw.files !== undefined) {
          if (Array.isArray(raw.files) && raw.files.length > 0 && raw.files.every(isStr)) entry.files = raw.files as string[];
          else errors.push(`${at}.files must be a list of glob strings`);
        }
        if (raw.engine_facts !== undefined) {
          if (raw.engine === undefined) errors.push(`${at}.engine_facts applies only to an engine entry`);
          else {
            const f = parseEngineFacts(raw.engine_facts, `${at}.engine_facts`, errors);
            if (f) entry.engine_facts = f;
          }
        }
        const vol = parseVolume(raw.volume, `${at}.volume`, errors);
        if (vol) entry.volume = vol;
        targets!.push(entry);
      });
    }
  }

  const engine = parseEngineFacts(doc.engine, "engine", errors);

  const priority = parsePriority(doc.priority, errors);
  const volume = parseVolume(doc.volume, "volume", errors);
  const prices = parsePrices(doc.prices, errors);
  if (doc.volume !== undefined && doc.volume !== null && doc.targets !== undefined && doc.targets !== null) {
    errors.push("with targets, set volume on each targets entry, not at the top level");
  }

  let ignore: Profile["ignore"];
  if (doc.ignore !== undefined && doc.ignore !== null) {
    if (!Array.isArray(doc.ignore)) errors.push("ignore must be a list of {rule, file} entries");
    else {
      ignore = [];
      doc.ignore.forEach((it: unknown, i: number) => {
        if (isMap(it) && isStr(it.rule) && isStr(it.file)) {
          unknownKeys(it, ["rule", "file"], `ignore[${i}].`, errors);
          ignore!.push({ rule: it.rule, file: it.file });
        } else errors.push(`ignore[${i}] must have a rule and a file`);
      });
    }
  }

  if (target.provider !== undefined && target.engine !== undefined) errors.push("set target.provider or target.engine, not both");
  if (t && doc.targets !== undefined && doc.targets !== null) errors.push("set target or targets, not both");
  if (engine && targets && targets.filter((x) => x.engine !== undefined).length > 1) {
    errors.push("with several engine entries in targets, give each its own engine_facts instead of a top-level engine:");
  }

  if (errors.length) return { errors };
  const profile: Profile = { target, priority };
  if (targets) profile.targets = targets;
  if (engine) profile.engine = engine;
  if (ignore) profile.ignore = ignore;
  if (volume) profile.volume = volume;
  if (prices) profile.prices = prices;
  return { profile, errors };
}

/** Read `<dir>/leanprompt.yaml`. Null when the file is absent; throws with every error when it is invalid. */
export function loadProfile(dir: string): Profile | null {
  const file = join(dir, "leanprompt.yaml");
  if (!existsSync(file)) return null;
  const { profile, errors } = parseProfile(readFileSync(file, "utf8"));
  if (!profile) throw new Error(`${file}: ${errors.join("; ")}`);
  return profile;
}

/** Engines served through another engine's cache table. */
const ENGINE_TABLE: Record<Engine, string | null> = { vllm: "vllm", sglang: "sglang", "lm-warden": "vllm", "llama.cpp": null };

/** A usage record (or a caller) names no backend the profile can pick on its own: never guessed. */
export class AmbiguousTargetError extends Error {
  readonly code = "ambiguous_target";
  constructor(provider: string | undefined, count: number) {
    super(
      `ambiguous_target: ${provider === undefined ? "no provider given" : `provider ${provider} has no cache table and matches no entry`} among the ${count} targets in leanprompt.yaml`,
    );
  }
}

/** The profile's targets: the `targets` list, or the single `target` when it names a provider or engine. */
export function profileTargets(p: Profile): Target[] {
  if (p.targets) return p.targets;
  return p.target.provider !== undefined || p.target.engine !== undefined ? [p.target] : [];
}

/** Table key of one target: the engine's table if it names an engine, else its provider. */
const keyOf = (t: Target): string | null => (t.engine ? ENGINE_TABLE[t.engine] : (t.provider ?? null));

/**
 * Key into the provider cache tables for a profile with one target: the engine's table if `engine` is
 * set, else `provider`, else null. Throws `AmbiguousTargetError` when the profile lists several targets.
 */
export function targetKey(p: Profile): string | null {
  const ts = profileTargets(p);
  if (ts.length > 1) throw new AmbiguousTargetError(undefined, ts.length);
  return ts[0] ? keyOf(ts[0]) : null;
}

/** The engine facts that apply to one engine target: its own `engine_facts`, else the top-level `engine:`. */
const engineFactsFor = (p: Profile | null, t: Target | undefined): EngineFacts | undefined => t?.engine_facts ?? p?.engine;

/**
 * The cache facts with the profile's engine values laid over them. `provider` is optional:
 * when omitted the key comes from the profile's one target (callers holding a usage record pass the
 * record's provider). Resolution, for a record:
 * 1. A provider that names an engine (`lm-warden`, `vllm`, `sglang`, `llama.cpp`) goes through the
 *    engine table; the engine facts are those of the `targets` entry for that engine, else `engine:`.
 * 2. A provider with its own table uses it.
 * 3. A provider with no table of its own (an OpenAI-compatible host such as groq or together) falls back
 *    to the `targets` entry whose `provider` is that name (it has no table either, so: unknown provider),
 *    else to the single target. With several targets and no match it throws `AmbiguousTargetError`:
 *    the record is unmeasured (`ambiguous_target`), never guessed.
 * Engine values apply only to block-mode (self-hosted) tables.
 * `match_unit_tokens` replaces the block size (E9); `speculative` sets whether the last block is dropped.
 */
export function effectiveFacts(p: Profile | null, facts: Map<string, CacheFacts>, provider?: string): CacheFacts {
  const ts = p ? profileTargets(p) : [];
  let key = provider;
  let chosen: Target | undefined;
  if (key !== undefined && (ENGINES as readonly string[]).includes(key)) {
    const table = ENGINE_TABLE[key as Engine];
    if (table === null) throw new Error(`no cache facts for ${key} yet`);
    chosen = ts.find((t) => t.engine === key);
    key = table;
  } else if (key !== undefined && !facts.has(key) && p) {
    const match = ts.find((t) => t.provider === key);
    if (match) chosen = match;
    else if (ts.length > 1) throw new AmbiguousTargetError(key, ts.length);
    else if (ts.length === 1) {
      chosen = ts[0];
      key = keyOf(chosen!) ?? key;
    }
  }
  if (key === undefined) {
    if (!p) throw new Error("no provider given and no profile to read one from");
    if (ts.length > 1) throw new AmbiguousTargetError(undefined, ts.length);
    chosen = ts[0];
    key = chosen ? (keyOf(chosen) ?? undefined) : undefined;
    if (key === undefined) {
      if (chosen?.engine) throw new Error(`no cache facts for ${chosen.engine} yet`);
      throw new Error("profile sets neither target.provider nor target.engine");
    }
  }
  const base = facts.get(key);
  if (!base) throw new Error(`unknown provider: ${key}`);
  const ef = engineFactsFor(p, chosen);
  if (!ef || base.mode !== "block") return base;
  const out: CacheFacts = { ...base };
  const { block_tokens, match_unit_tokens, speculative } = ef;
  if (block_tokens !== undefined) out.block_tokens = block_tokens;
  if (match_unit_tokens !== undefined) out.block_tokens = match_unit_tokens;
  if (speculative !== undefined) out.drops_last_block = speculative;
  return out;
}
