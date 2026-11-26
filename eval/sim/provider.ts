// A deterministic fake provider for CI. Its results are always kind "simulated" and never quotable.
// The cache is a map from kvsig exact ids (head = node -1, then nodes[i]) to an expiry time.
// A request reuses its longest cached prefix, capped by the provider facts (`cap`).

import { canonicalJson, canonicalize, ids, parseJson, TEST_KEY, type Canon } from "@kvsig/core";
import { cap, type CacheFacts } from "../../cli/src/facts.js";
import { nodeChars } from "../../cli/src/log/logger.js";
import type { LlmClient, LlmRequest, LlmResponse } from "../client.js";
import { tokensOf } from "./tokens.js";

export class TimeoutError extends Error {
  /** The usage the provider counted: the server still generated the reply. */
  constructor(readonly usage: unknown) {
    super("simulated request timed out");
    this.name = "TimeoutError";
  }
}

export interface SimOptions {
  kind: "openai" | "anthropic" | "vllm";
  facts: CacheFacts;
  reply?: (body: unknown) => { text: string; output_tokens: number };
  msPerOutputToken?: number;
  /** Injectable clock in ms, for the cache lifetime (`facts.ttl_seconds`). */
  now?: () => number;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const hasMark = (x: unknown): boolean => isObj(x) && "cache_control" in x;
const blocks = (x: unknown): unknown[] => (isObj(x) && Array.isArray(x.content) ? x.content : []);

/**
 * The last prefix node an Anthropic `cache_control` mark covers: -1 for head, i for message i,
 * undefined for no mark. Simplification: Anthropic renders tools, then system, then messages and
 * caches up to the mark; here kvsig `head` (system + tools) is one unit, so a mark on any tool or
 * system block marks the whole head.
 */
function lastMark(body: unknown): number | undefined {
  if (!isObj(body)) return undefined;
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) if (blocks(msgs[i]).some(hasMark)) return i;
  const system = Array.isArray(body.system) ? body.system : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return [...system, ...tools].some(hasMark) ? -1 : undefined;
}

/** Code points of the head messages and tools: what comes before node 0 (see nodeChars). */
function headChars(canon: Canon): number {
  let total = 0;
  for (const x of [...canon.head, ...canon.tools]) for (const _ of canonicalJson(parseJson(JSON.stringify(x)))) total++;
  return total;
}

export class SimProvider implements LlmClient {
  private readonly cache = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly o: SimOptions) {
    this.now = o.now ?? Date.now;
  }

  async send(req: LlmRequest): Promise<LlmResponse> {
    const { kind, facts } = this.o;
    const reply = (this.o.reply ?? (() => ({ text: "ok", output_tokens: 5 })))(req.body);
    const canon = canonicalize(req.body, req.dialect, { onError: () => {} });

    let promptTokens: number;
    let read = 0;
    let write = 0;
    if (canon === null || canon.stateful) {
      // kvsig cannot identify it, so nothing is cached.
      promptTokens = tokensOf(JSON.stringify(req.body).length);
    } else {
      const i = ids(canon, TEST_KEY);
      const keys = [i.head, ...i.nodes]; // keys[k + 1] is node k
      const head = headChars(canon);
      const chars = [head, ...nodeChars(canon)];
      promptTokens = tokensOf(chars[chars.length - 1]);
      const t = this.now();
      // vllm and openai store every node; Anthropic only up to its last cache_control mark, and
      // it reads only up to the current request's own mark (none: no read).
      const mark = kind === "anthropic" ? lastMark(req.body) : keys.length - 2;
      const storeTo = mark === undefined ? -1 : mark + 1;
      let hit = -1; // longest cached prefix, as an index into keys
      keys.forEach((k, n) => {
        if (n <= storeTo && (this.cache.get(k) ?? -Infinity) > t) hit = n;
      });
      if (hit >= 0) read = cap(facts, tokensOf(chars[hit]));
      if (storeTo >= 0 && tokensOf(chars[storeTo]) >= facts.min_tokens) {
        keys.slice(0, storeTo + 1).forEach((k) => this.cache.set(k, t + facts.ttl_seconds * 1000));
        if (kind === "anthropic") write = Math.max(0, tokensOf(chars[storeTo]) - read);
      }
    }

    // `n` asks for several choices from one prefill; each choice is generated on its own.
    const n = isObj(req.body) && typeof req.body.n === "number" && req.body.n > 1 && kind !== "anthropic" ? Math.floor(req.body.n) : 1;
    const outputTokens = reply.output_tokens * n;
    const usage =
      kind === "anthropic"
        ? {
            input_tokens: promptTokens - read - write,
            cache_read_input_tokens: read,
            cache_creation_input_tokens: write,
            output_tokens: outputTokens,
          }
        : {
            prompt_tokens: promptTokens,
            completion_tokens: outputTokens,
            prompt_tokens_details: { cached_tokens: read },
          };

    if (req.timeoutMs !== undefined && outputTokens * (this.o.msPerOutputToken ?? 0) > req.timeoutMs) {
      throw new TimeoutError(usage);
    }
    const body =
      kind === "anthropic"
        ? { content: [{ type: "text", text: reply.text }] }
        : { choices: Array.from({ length: n }, () => ({ message: { role: "assistant", content: reply.text } })) };
    return { body, usage, finish: "stop" };
  }
}
