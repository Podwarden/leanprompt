// The replay harness: plays an example app's scenario against the cache simulator (CI) or a real
// provider (manual, owner-gated), under a spend cap, and writes a ResultFile plus a usage log per run.
// Neither file holds prompt or completion text.
//
//   npx tsx eval/run.ts --app <name> --form before|after --target sim:openai
//   npx tsx eval/run.ts --app <name> --form after --provider openai --model <m> --runs 2 --budget-usd 1

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { TEST_KEY } from "@kvsig/core";
import { parse as parseYaml } from "yaml";
import { loadCacheFacts, type CacheFacts } from "../cli/src/facts.js";
import { isMain } from "../cli/src/isMain.js";
import { createLogger, finishFrom, usageFrom, type Logger } from "../cli/src/log/logger.js";
import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";
import { DEFAULT_BASE_URLS, HttpClient, KEY_ENV } from "./http.js";
import { SimProvider } from "./sim/provider.js";
import { tokensOf } from "./sim/tokens.js";
import { dialectFor } from "../examples/common.js";
import type { CreateApp, ExampleApp } from "../examples/types.js";

export type Target = `sim:${"openai" | "anthropic" | "vllm"}` | { provider: string; model: string; baseUrl: string };

export interface EvalOptions {
  app: string;
  form: "before" | "after";
  target: Target;
  runs: number;
  budgetUsd: number;
}

export interface RunResult {
  calls: number;
  prompt_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  answer_check: "pass" | "fail" | "skipped";
}

export interface ResultFile {
  v: 1;
  kind: "measured" | "simulated";
  app: string;
  form: "before" | "after";
  provider: string;
  model: string;
  date: string;
  runs: RunResult[];
  spend_usd: number;
  /** Set when the run stopped early, e.g. "budget reached after 3 calls". */
  error?: string;
}

export interface Price {
  provider: string;
  model: string;
  input: number;
  cached_input: number;
  cache_write: number;
  output: number;
  checked: string;
  source: string;
}

export interface EvalDeps {
  /** Replaces the real HttpClient / SimProvider (tests). */
  client?: LlmClient;
  loadApp?: (app: string, form: "before" | "after", provider: string) => Promise<ExampleApp>;
  pricesPath?: string;
  root?: string;
  outDir?: string;
  now?: () => Date;
}

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

export function loadPrices(path: string): Price[] {
  const doc = parseYaml(readFileSync(path, "utf8")) as { models?: unknown } | null;
  const list = Array.isArray(doc?.models) ? (doc!.models as Record<string, unknown>[]) : [];
  return list.map((m) => {
    for (const k of ["provider", "model", "checked", "source"]) {
      if (typeof m[k] !== "string" || m[k] === "") throw new Error(`prices: entry ${JSON.stringify(m.model)} lacks ${k}`);
    }
    for (const k of ["input", "cached_input", "cache_write", "output"]) {
      if (typeof m[k] !== "number" || m[k] < 0) throw new Error(`prices: entry ${JSON.stringify(m.model)} has a bad ${k}`);
    }
    return m as unknown as Price;
  });
}

const cost = (p: Price, t: { prompt: number; cached: number; write: number; output: number }): number =>
  (Math.max(0, t.prompt - t.cached - t.write) * p.input + t.cached * p.cached_input + t.write * p.cache_write + t.output * p.output) / 1e6;

const MAX_CONSECUTIVE_FAILURES = 5;

/** Thrown to the app once the run must end; the message is the result file's `error`. */
class RunStop extends Error {}

/** Wraps the client: counts tokens, prices them, logs each call, and enforces the budget. */
class Meter implements LlmClient {
  /** Calls over all runs: what the budget message counts. */
  totalCalls = 0;
  calls = 0;
  prompt = 0;
  cached = 0;
  output = 0;
  spend = 0;
  stopped = false;
  stopReason: string | null = null;
  private failures = 0;
  private prev: { body: string; index: number | null; finish: string } | null = null;
  private logger: Logger | null = null;

  constructor(
    private readonly inner: LlmClient,
    private readonly provider: string,
    private readonly model: string,
    private readonly price: Price | null,
    private readonly budgetUsd: number,
    /** `spend` is shared across runs; the per-run counters are reset by `startRun`. */
    private readonly usagePath: (run: number) => string,
  ) {}

  startRun(run: number): void {
    this.calls = this.prompt = this.cached = this.output = 0;
    this.prev = null;
    this.logger = createLogger({ path: this.usagePath(run), key: TEST_KEY, provider: this.provider, model: this.model });
  }

  /** Waits for the run's usage records to reach disk (the logger writes in the background). */
  flush(): Promise<void> {
    return this.logger?.flush() ?? Promise.resolve();
  }

  private record(req: LlmRequest, usage: unknown, finish: string): void {
    const t = usageFrom(this.provider, usage);
    this.calls++;
    this.prompt += t.prompt_tokens;
    this.cached += t.cached_tokens;
    this.output += t.output_tokens;
    if (this.price) {
      this.spend += cost(this.price, { prompt: t.prompt_tokens, cached: t.cached_tokens, write: t.cache_write_tokens, output: t.output_tokens });
    }
    const body = JSON.stringify(req.body);
    // The same request sent again right after a truncated or failed one is that call's retry.
    const flags = this.prev && this.prev.body === body && this.prev.index !== null && (this.prev.finish === "length" || this.prev.finish === "error")
      ? { retry_of: this.prev.index }
      : {};
    const index = this.logger!.log({ dialect: req.dialect, body: req.body }, { usage, finish }, flags);
    this.prev = { body, index, finish: finishFrom(finish) };
  }

  /** Sends are serialized, so a concurrent app cannot pass the budget check N times before any spend is recorded. */
  private chain: Promise<unknown> = Promise.resolve();

  send(req: LlmRequest): Promise<LlmResponse> {
    const run = this.chain.then(() => this.sendOne(req));
    this.chain = run.catch(() => {});
    return run;
  }

  private stop(reason: string): RunStop {
    this.stopped = true;
    this.stopReason ??= reason;
    return new RunStop(this.stopReason);
  }

  private async sendOne(req: LlmRequest): Promise<LlmResponse> {
    if (this.stopped) throw new RunStop(this.stopReason!);
    // Lower bound only: the request's own tokens at the uncached input price. Output is unknown.
    const estTokens = tokensOf(JSON.stringify(req.body).length);
    if (this.price && this.spend + (estTokens * this.price.input) / 1e6 > this.budgetUsd) {
      throw this.stop(`budget reached after ${this.totalCalls} calls`);
    }
    let res: LlmResponse;
    try {
      res = await this.inner.send(req);
    } catch (e) {
      const usage = (e as { usage?: unknown }).usage;
      // With no usage the provider may still have billed the call: charge its estimated input and count it.
      this.record(req, usage ?? { prompt_tokens: estTokens, input_tokens: estTokens, completion_tokens: 0, output_tokens: 0 }, "error");
      this.totalCalls++;
      if (++this.failures >= MAX_CONSECUTIVE_FAILURES) throw this.stop(`stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failed calls`);
      if (this.price && this.spend >= this.budgetUsd) throw this.stop(`budget reached after ${this.totalCalls} calls`);
      throw e;
    }
    this.failures = 0;
    this.record(req, res.usage, res.finish);
    this.totalCalls++;
    if (this.price && this.spend >= this.budgetUsd) throw this.stop(`budget reached after ${this.totalCalls} calls`);
    return res;
  }
}

/** The text of the newest message of a request body (string content only). */
function lastMessageText(body: unknown): string {
  const msgs = (body as { messages?: { content?: unknown }[] } | null)?.messages;
  const c = msgs?.[msgs.length - 1]?.content;
  return typeof c === "string" ? c : "";
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-");

async function defaultLoadApp(app: string, form: "before" | "after", root: string, provider: string): Promise<ExampleApp> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app)) throw new Error(`bad app name: ${app}`);
  const mod = (await import(pathToFileURL(join(root, "examples", app, "app.ts")).href)) as { createApp?: CreateApp };
  if (typeof mod.createApp !== "function") throw new Error(`examples/${app}/app.ts must export createApp(form)`);
  return mod.createApp(form, { dialect: dialectFor(provider) });
}

export async function runEval(o: EvalOptions, deps: EvalDeps = {}): Promise<ResultFile> {
  const root = deps.root ?? ROOT;
  const outDir = deps.outDir ?? join(root, "eval", "results");
  const date = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  if (!Number.isFinite(o.budgetUsd) || o.budgetUsd < 0) throw new Error("budgetUsd must be a non-negative number");
  if (!Number.isInteger(o.runs) || o.runs < 1) throw new Error("runs must be a positive integer");

  const simulated = typeof o.target === "string";
  let provider: string;
  let model: string;
  let client: LlmClient | undefined;
  let simulator: { kind: "openai" | "anthropic" | "vllm"; facts: CacheFacts } | null = null;
  let price: Price | null = null;
  if (typeof o.target === "string") {
    const kind = o.target.slice("sim:".length) as "openai" | "anthropic" | "vllm";
    provider = kind;
    model = "sim";
    const facts = loadCacheFacts(root).get(kind);
    if (!deps.client && !facts) throw new Error(`no cache facts for simulated provider ${kind}`);
    client = deps.client;
    if (!client) simulator = { kind, facts: facts! }; // built below, once the app can say how it should be simulated
  } else {
    ({ provider, model } = o.target);
    price = loadPrices(deps.pricesPath ?? join(root, "eval", "prices.yaml")).find((p) => p.provider === provider && p.model === model) ?? null;
    if (!price) throw new Error(`no price card entry for ${provider}/${model} in eval/prices.yaml; add one before a real run`);
    const envName = KEY_ENV[provider];
    client = deps.client ?? new HttpClient({ provider, model, baseUrl: o.target.baseUrl, apiKey: envName ? process.env[envName] : undefined });
  }

  const app = await (deps.loadApp ?? ((a, f, p) => defaultLoadApp(a, f, root, p)))(o.app, o.form, provider);
  if (simulator) {
    const { outputTokens, msPerOutputToken } = app.sim ?? {};
    client = new SimProvider({
      ...simulator,
      msPerOutputToken,
      ...(outputTokens ? { reply: (body: unknown) => ({ text: "ok", output_tokens: outputTokens(lastMessageText(body)) }) } : {}),
    });
  }
  if (!simulated && !app.check) throw new Error(`app ${o.app} has no check, so a measured run cannot judge its answers`);

  const base = `${date}-${safe(o.app)}-${o.form}-${safe(provider)}-${safe(model)}`;
  mkdirSync(outDir, { recursive: true });
  const meter = new Meter(client!, provider, model, price, o.budgetUsd, (n) => join(outDir, "usage", `${base}-run${n + 1}.jsonl`));

  const runs: RunResult[] = [];
  let error: string | undefined;
  for (let n = 0; n < o.runs && !meter.stopped; n++) {
    meter.startRun(n);
    let answers: string[] | null = null;
    try {
      answers = await app.run(meter, app.scenario);
    } catch (e) {
      if (!(e instanceof RunStop) && !meter.stopped) throw e;
    }
    await meter.flush();
    if (meter.stopped) error = meter.stopReason!;
    let check: RunResult["answer_check"] = "skipped";
    if (!simulated && answers && !meter.stopped) check = app.check!([answers]).pass ? "pass" : "fail";
    runs.push({ calls: meter.calls, prompt_tokens: meter.prompt, cached_tokens: meter.cached, output_tokens: meter.output, answer_check: check });
  }

  const result: ResultFile = {
    v: 1,
    kind: simulated ? "simulated" : "measured",
    app: o.app,
    form: o.form,
    provider,
    model,
    date,
    runs,
    spend_usd: Math.round(meter.spend * 1e6) / 1e6,
    ...(error ? { error } : {}),
  };
  writeFileSync(join(outDir, `${base}.json`), JSON.stringify(result, null, 2) + "\n");
  return result;
}

export function parseCli(argv: string[]): EvalOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      app: { type: "string" },
      form: { type: "string" },
      target: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      "base-url": { type: "string" },
      runs: { type: "string", default: "2" },
      "budget-usd": { type: "string", default: "1" },
    },
  });
  if (!values.app) throw new Error("--app is required");
  if (values.form !== "before" && values.form !== "after") throw new Error("--form must be before or after");
  let target: Target;
  if (values.target) {
    if (!/^sim:(openai|anthropic|vllm)$/.test(values.target)) throw new Error("--target must be sim:openai, sim:anthropic or sim:vllm");
    target = values.target as Target;
  } else {
    if (!values.provider || !values.model) throw new Error("give --target sim:<kind>, or --provider and --model");
    const baseUrl = values["base-url"] ?? DEFAULT_BASE_URLS[values.provider];
    if (!baseUrl) throw new Error(`no default base URL for ${values.provider}; pass --base-url`);
    target = { provider: values.provider, model: values.model, baseUrl };
  }
  return { app: values.app, form: values.form, target, runs: Number(values.runs), budgetUsd: Number(values["budget-usd"]) };
}

if (isMain(import.meta.url)) {
  Promise.resolve()
    .then(() => runEval(parseCli(process.argv.slice(2))))
    .then((r) => {
      console.log(`${r.kind} ${r.app}/${r.form} ${r.provider}/${r.model}: ${r.runs.length} runs, $${r.spend_usd}${r.error ? `, ${r.error}` : ""}`);
      if (r.error) process.exitCode = 2;
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    });
}
