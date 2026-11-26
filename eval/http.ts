// A real-provider LlmClient over global fetch: OpenAI-compatible chat/responses and Anthropic Messages.
// Keys come from the environment only. A failed call throws an HttpError that carries the HTTP status,
// the Retry-After wait and the provider's error type/code, never the message text or the body
// (which can echo prompt text).

import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";

export const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  anthropic: "https://api.anthropic.com/v1",
};

export const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  vllm: "VLLM_API_KEY",
  "lm-warden": "LM_WARDEN_API_KEY",
};

export interface HttpOptions {
  provider: string;
  model: string;
  baseUrl: string;
  /** Defaults to the provider's env variable; absent is allowed for self-hosted servers. */
  apiKey?: string;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch; only used to turn an HTTP-date Retry-After into seconds. */
  now?: () => number;
}

/** A failed provider call. Apps read `status`, `retryAfter` (seconds), `type` and `code`; there is no body or message text. */
export class HttpError extends Error {
  status: number;
  retryAfter?: number;
  type?: string;
  code?: string;
  constructor(provider: string, status: number, extra: { retryAfter?: number; type?: string; code?: string } = {}) {
    super(`${provider} request failed: HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
    if (extra.type !== undefined) this.type = extra.type;
    if (extra.code !== undefined) this.code = extra.code;
  }
}

/** Retry-After as seconds: a number of seconds, or an HTTP-date. Anything else is undefined. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.ceil(Number(v));
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

const IDENT = /^[\w.:-]{1,64}$/;
/** `error.type` and `error.code` of a provider error body, when they are short identifiers. Nothing else is read. */
function errorIds(json: unknown): { type?: string; code?: string } {
  const e = isObj(json) && isObj(json.error) ? json.error : {};
  const pick = (x: unknown): string | undefined => (typeof x === "number" ? String(x) : typeof x === "string" && IDENT.test(x) ? x : undefined);
  const type = pick(e.type);
  const code = pick(e.code);
  return { ...(type ? { type } : {}), ...(code ? { code } : {}) };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

export class HttpClient implements LlmClient {
  private readonly f: typeof fetch;
  constructor(private readonly o: HttpOptions) {
    this.f = o.fetch ?? fetch;
  }

  async send(req: LlmRequest): Promise<LlmResponse> {
    const { baseUrl, model } = this.o;
    const anthropic = req.dialect === "anthropic.messages";
    const path = anthropic ? "/messages" : req.dialect === "openai.responses" ? "/responses" : "/chat/completions";
    const headers: Record<string, string> = { "content-type": "application/json" };
    const key = this.o.apiKey;
    if (anthropic) {
      if (key) headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else if (key) headers.authorization = `Bearer ${key}`;
    // The harness picks the model, not the app: one app runs against any model.
    const body = isObj(req.body) ? { ...req.body, model } : req.body;

    const ctl = new AbortController();
    const timer = req.timeoutMs === undefined ? undefined : setTimeout(() => ctl.abort(), req.timeoutMs);
    try {
      const res = await this.f(baseUrl.replace(/\/+$/, "") + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) {
        let ids = {};
        try {
          ids = errorIds(await res.json());
        } catch {
          /* no JSON body: status only */
        }
        const retryAfter = parseRetryAfter(res.headers?.get("retry-after"), (this.o.now ?? Date.now)());
        throw new HttpError(this.o.provider, res.status, { ...ids, ...(retryAfter === undefined ? {} : { retryAfter }) });
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error(`${this.o.provider} response was not JSON: HTTP ${res.status}`);
      }
      const j = isObj(json) ? json : {};
      const choice = Array.isArray(j.choices) && isObj(j.choices[0]) ? j.choices[0] : {};
      const finish = anthropic ? j.stop_reason : (choice.finish_reason ?? (isObj(j) && j.status === "incomplete" ? "length" : undefined));
      return { body: json, usage: j.usage, finish: typeof finish === "string" ? finish : "stop" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
