import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { CacheFacts } from "./facts.js";

export const ENGINES = ["vllm", "sglang", "llama.cpp", "lm-warden"] as const;
export type Engine = (typeof ENGINES)[number];

export interface Profile {
  target: { provider?: string; engine?: Engine; model_family?: string; context_tokens?: number };
  engine?: { block_tokens?: number; match_unit_tokens?: number; speculative?: boolean; kv_memory_gb?: number };
  priority: { cost: number; speed: number; quality: number };
  ignore?: { rule: string; file: string }[];
}

const KEYS = ["target", "engine", "priority", "ignore"];
const TARGET_KEYS = ["provider", "engine", "model_family", "context_tokens"];
const ENGINE_KEYS = ["block_tokens", "match_unit_tokens", "speculative", "kv_memory_gb"];
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
    if (t.provider !== undefined) isStr(t.provider) ? (target.provider = t.provider) : errors.push("target.provider must be a string");
    if (t.engine !== undefined) {
      if (typeof t.engine === "string" && (ENGINES as readonly string[]).includes(t.engine)) target.engine = t.engine as Engine;
      else errors.push(`target.engine must be one of ${ENGINES.join(", ")}`);
    }
    if (t.model_family !== undefined) isStr(t.model_family) ? (target.model_family = t.model_family) : errors.push("target.model_family must be a string");
    if (t.context_tokens !== undefined) isPosInt(t.context_tokens) ? (target.context_tokens = t.context_tokens) : errors.push("target.context_tokens must be a positive integer");
  }

  let engine: Profile["engine"];
  const e = section(doc.engine, "engine", errors);
  if (e) {
    unknownKeys(e, ENGINE_KEYS, "engine.", errors);
    engine = {};
    for (const k of ["block_tokens", "match_unit_tokens"] as const) {
      if (e[k] !== undefined) isPosInt(e[k]) ? (engine[k] = e[k] as number) : errors.push(`engine.${k} must be a positive integer`);
    }
    if (e.speculative !== undefined) typeof e.speculative === "boolean" ? (engine.speculative = e.speculative) : errors.push("engine.speculative must be true or false");
    if (e.kv_memory_gb !== undefined) isNum(e.kv_memory_gb) && e.kv_memory_gb > 0 ? (engine.kv_memory_gb = e.kv_memory_gb) : errors.push("engine.kv_memory_gb must be a positive number");
  }

  const priority = parsePriority(doc.priority, errors);

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

  if (errors.length) return { errors };
  const profile: Profile = { target, priority };
  if (engine) profile.engine = engine;
  if (ignore) profile.ignore = ignore;
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

/** Key into the provider cache tables for a profile: the engine's table if `target.engine` is set, else `target.provider`, else null. */
export function targetKey(p: Profile): string | null {
  const { engine, provider } = p.target;
  if (engine) return ENGINE_TABLE[engine];
  return provider ?? null;
}

/**
 * The cache facts with the profile's `engine:` values laid over them. `provider` is optional:
 * when omitted the key comes from `targetKey(p)` (callers holding a usage record pass the
 * record's provider). A provider that names an engine (`lm-warden`, `vllm`, `sglang`, `llama.cpp`)
 * goes through the engine table. A provider with no table of its own (an OpenAI-compatible host
 * such as groq or together) falls back to the profile's target, when one is set.
 * Engine values apply only to block-mode (self-hosted) tables.
 * `match_unit_tokens` replaces the block size (E9); `speculative` sets whether the last block is dropped.
 */
export function effectiveFacts(p: Profile | null, facts: Map<string, CacheFacts>, provider?: string): CacheFacts {
  let key = provider;
  if (key !== undefined && (ENGINES as readonly string[]).includes(key)) {
    const table = ENGINE_TABLE[key as Engine];
    if (table === null) throw new Error(`no cache facts for ${key} yet`);
    key = table;
  }
  if (key !== undefined && !facts.has(key) && p) key = targetKey(p) ?? key;
  if (key === undefined) {
    if (!p) throw new Error("no provider given and no profile to read one from");
    key = targetKey(p) ?? undefined;
    if (key === undefined) {
      if (p.target.engine) throw new Error(`no cache facts for ${p.target.engine} yet`);
      throw new Error("profile sets neither target.provider nor target.engine");
    }
  }
  const base = facts.get(key);
  if (!base) throw new Error(`unknown provider: ${key}`);
  if (!p?.engine || base.mode !== "block") return base;
  const out: CacheFacts = { ...base };
  const { block_tokens, match_unit_tokens, speculative } = p.engine;
  if (block_tokens !== undefined) out.block_tokens = block_tokens;
  if (match_unit_tokens !== undefined) out.block_tokens = match_unit_tokens;
  if (speculative !== undefined) out.drops_last_block = speculative;
  return out;
}
