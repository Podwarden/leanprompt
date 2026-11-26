import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMap, parseDocument } from "yaml";
import { optionsFor } from "./help.js";
import { parseProfile, type Profile } from "./profile.js";

const USAGE = "usage: leanprompt profile detect --lmwarden <url> [--token-env LMWARDEN_API_KEY] [--model <name>]\n";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface Detected {
  engine: NonNullable<Profile["engine"]>;
  context_tokens?: number;
  /** Fields the server could not determine; left out of the profile. */
  unknown: string[];
}

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Engine facts from the response of `GET /api/me/engine` (v1). With several models `model` picks one;
 * without it the error lists the names. A value that is null (named in `unknown`) is left out.
 */
export function detectFromLmWarden(json: unknown, model?: string): Detected {
  if (!isObj(json) || !Array.isArray(json.models)) throw new Error("unexpected response: no models list");
  if (json.v !== undefined && json.v !== 1) throw new Error(`unsupported response version ${String(json.v)}; upgrade leanprompt`);
  const rows = json.models.filter(isObj);
  if (rows.length === 0) throw new Error("this key can use no models");
  const names = rows.map((r) => String(r.model)).join(", ");
  let row: Record<string, unknown>;
  if (model !== undefined) {
    const hit = rows.find((r) => r.model === model);
    if (!hit) throw new Error(`no model "${model}" for this key; models: ${names}`);
    row = hit;
  } else if (rows.length > 1) {
    throw new Error(`this key can use several models; pass --model <name>. Models: ${names}`);
  } else row = rows[0]!;

  const unknown = new Set(Array.isArray(row.unknown) ? row.unknown.map(String) : []);
  const engine: Detected["engine"] = {};
  if (posInt(row.engine_block_tokens)) engine.block_tokens = row.engine_block_tokens;
  else unknown.add("engine_block_tokens");
  if (posInt(row.engine_match_unit_tokens)) engine.match_unit_tokens = row.engine_match_unit_tokens;
  else unknown.add("engine_match_unit_tokens");
  if (row.speculative === null || row.speculative === undefined) {
    if (unknown.has("speculative") || row.speculative === undefined) unknown.add("speculative");
    else engine.speculative = false;
  } else engine.speculative = true;
  const out: Detected = { engine, unknown: [...unknown] };
  if (posInt(row.max_model_len)) out.context_tokens = row.max_model_len;
  else unknown.add("max_model_len"), (out.unknown = [...unknown]);
  return out;
}

export interface DetectDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isLoopback = (host: string): boolean =>
  host === "localhost" || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(host) || host === "[::1]" || host === "::1";

/** `leanprompt profile detect`: read the engine's cache facts from LM Warden and write them to `engine:`. */
export async function detectCommand(args: string[], deps: DetectDeps = {}): Promise<number> {
  let secrets: string[] = [];
  const fail = (msg: string, code = 1): number => {
    for (const x of secrets) if (x) msg = msg.split(x).join("***");
    process.stderr.write(`${msg}\n`);
    return code;
  };
  let values: { lmwarden?: string; "token-env"?: string; model?: string };
  try {
    values = parseArgs({ args, options: optionsFor("profile detect"), strict: true }).values;
  } catch (e) {
    // Never echo a bare value: it may be a key pasted in the wrong place.
    let msg = (e as Error).message;
    for (const a of args) if (a && !a.startsWith("-")) msg = msg.split(a).join("***");
    return fail(`${msg}\n${USAGE.trimEnd()}`, 2);
  }
  const base = values.lmwarden;
  if (!base) return fail(`--lmwarden <url> is required\n${USAGE.trimEnd()}`, 2);
  const tokenEnv = values["token-env"] ?? "LMWARDEN_API_KEY";
  if (!ENV_NAME.test(tokenEnv)) {
    return fail(`--token-env takes the name of an environment variable (letters, digits and _), not the key itself; put the key in a variable and pass its name\n${USAGE.trimEnd()}`, 2);
  }
  const model = values.model;
  let url: URL;
  try {
    url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not http");
  } catch {
    return fail(`--lmwarden must be an http:// or https:// URL\n${USAGE.trimEnd()}`, 2);
  }
  const rawToken = (deps.env ?? process.env)[tokenEnv] ?? "";
  const token = rawToken.trim();
  secrets = [rawToken, token];
  if (rawToken && !token) return fail(`the environment variable ${tokenEnv} is empty after trimming whitespace; set it to an LM Warden API key`);
  if (!token) return fail(`no token: set the environment variable ${tokenEnv} (or name another with --token-env <VAR>) to an LM Warden API key`);

  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    process.stderr.write(`warning: sending the API key over plain http to ${url.hostname}; anyone on the network path can read it. Use https:// unless this network is trusted.\n`);
  }

  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${base.replace(/\/+$/, "")}/api/me/engine`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  } catch (e) {
    return fail(`could not reach LM Warden at ${base}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401) return fail(`LM Warden returned 401: check the API key in ${tokenEnv}`);
  if (res.status === 404) return fail("this LM Warden does not have /api/me/engine yet; it needs a newer release");
  if (!res.ok) return fail(`LM Warden returned ${res.status}`);

  let found: Detected;
  try {
    found = detectFromLmWarden(await res.json(), model);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const { engine, unknown } = found;
  if (Object.keys(engine).length === 0 && found.context_tokens === undefined) return fail("LM Warden could not determine any engine facts for this model yet; is it loaded?");
  const file = join(deps.cwd ?? process.cwd(), "leanprompt.yaml");
  const doc = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "target:\n  engine: lm-warden\n");
  if (doc.errors.length) return fail(`${file}: invalid YAML: ${doc.errors[0]!.message.split("\n")[0]}`);
  if (!doc.has("target") || doc.get("target") === null) doc.set("target", doc.createNode({ engine: "lm-warden" }));
  const target = doc.get("target", true);
  let note = "";
  if (isMap(target)) {
    if (target.has("provider")) note = `target.provider is ${String(target.get("provider"))}, left as is; the engine: values apply only to calls logged with a self-hosted engine name (see docs/profile.md)`;
    else if (!target.has("engine")) target.set("engine", "lm-warden");
  }
  if (found.context_tokens !== undefined && isMap(target) && !target.has("context_tokens")) target.set("context_tokens", found.context_tokens);
  if (Object.keys(engine).length) {
    const existing = doc.get("engine", true);
    if (isMap(existing)) for (const [k, v] of Object.entries(engine)) existing.set(k, v);
    else doc.set("engine", doc.createNode(engine));
  }
  const text = String(doc);
  const { errors } = parseProfile(text);
  if (errors.length) return fail(`not writing ${file}: ${errors.join("; ")}`);
  writeFileSync(file, text);
  process.stdout.write(`wrote ${file}: ${Object.entries(engine).map(([k, v]) => `engine.${k}=${v}`).join(", ")}\n`);
  if (unknown.length) process.stdout.write(`not reported by LM Warden, left out: ${unknown.join(", ")}\n`);
  if (note) process.stdout.write(`${note}\n`);
  return 0;
}

export const profileCommand = async (args: string[]): Promise<number> => {
  if (args[0] === "detect") return detectCommand(args.slice(1));
  process.stderr.write(USAGE);
  return 2;
};
