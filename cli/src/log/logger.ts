// The TypeScript usage logger. It writes ids, counts and flags, never prompt or completion text,
// and never throws into the caller's request path.

import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, canonicalize, hmacSha256, ids, Key, parseJson, SUPPORTED, type Canon, type Dialect } from "@kvsig/core";
import { finishFrom, parseUsageLog, usageFrom, type Flags, type RecordIds, type UsageRecord } from "./record.js";

export { parseUsageLog, usageFrom, finishFrom } from "./record.js";
export type { Flags, UsageRecord, Finish, Tokens, RecordIds } from "./record.js";

export interface LoggerOptions {
  path: string;
  /**
   * A kvsig Key, or the raw 32 key bytes. Raw bytes are wrapped as epoch 1, the same convention
   * as the Python logger, so one key gives the same ids in both languages. Every kvsig id starts
   * with the epoch byte: pass a Key with another epoch only if every logger of the app does.
   */
  key: Key | Uint8Array;
  provider: string;
  model: string;
}

export interface LogRequest {
  dialect: Dialect | "other";
  body: unknown;
  params?: Record<string, unknown>;
  breakpoints?: number[];
}

export interface LogResponse {
  usage: unknown;
  finish?: string;
}

const enc = new TextEncoder();
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const codePoints = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Canonical JSON text of any plain value (object key order is kept unless `sort`). */
function canonText(v: unknown, sort = false): string {
  return canonicalJson(parseJson(JSON.stringify(v)), sort);
}

/** HMAC-SHA256 over the canonical JSON of the params (keys sorted), keyed by the kvsig key; first 16 hex characters. */
export function paramsHash(key: Key, params: Record<string, unknown> | undefined): string {
  return hex(hmacSha256(key.bytes(), enc.encode(canonText(params ?? {}, true)))).slice(0, 16);
}

/**
 * node_chars[i]: code points of the canonical JSON text of the head messages, the tools and
 * body messages 0..i, the same per-message text kvsig hashes. One entry per prefix node.
 */
export function nodeChars(canon: Canon): number[] {
  let total = 0;
  for (const m of canon.head) total += codePoints(canonText(m));
  for (const t of canon.tools) total += codePoints(canonText(t));
  return canon.messages.map((m) => (total += codePoints(canonText(m))));
}

function identify(key: Key, dialect: LogRequest["dialect"], body: unknown): { ids: RecordIds; node_chars: number[] } | null {
  if (!(SUPPORTED as readonly string[]).includes(dialect)) return null;
  const canon = canonicalize(body, dialect as Dialect, { onError: () => {} });
  if (canon === null || canon.stateful) return null;
  const i = ids(canon, key);
  return { ids: { conv: i.conv, head: i.head, nodes: [...i.nodes] }, node_chars: nodeChars(canon) };
}

/** Valid records already in the file (0 when it is missing or unreadable). */
function existingRecords(path: string): number {
  try {
    return parseUsageLog(readFileSync(path, "utf8")).records.length;
  } catch {
    return 0;
  }
}

// A process that exits while records are still queued loses them unless it awaits flush().
// This hook is a fallback only (it runs when the event loop empties, never on process.exit() or a crash);
// the documented contract is to await flush().
const pendingLoggers = new Set<() => Promise<void>>();
let exitHook = false;
function ensureExitHook(): void {
  if (exitHook) return;
  exitHook = true;
  process.on("beforeExit", () => {
    for (const flush of [...pendingLoggers]) void flush();
  });
}

export interface Logger {
  /**
   * Returns the record's 0-based index among the valid records of the file (the value to pass as
   * `flags.retry_of` on a later retry), or null when no record could be built. The index is computed
   * in memory and the line is appended in the background, in call order, one write at a time, so
   * `log()` never touches the disk. The counter starts at the file's existing valid-record count.
   * If a background write later fails, that record is dropped and later indexes run ahead of the file.
   */
  log(req: LogRequest, res: LogResponse, flags?: Flags): number | null;
  /**
   * Resolves when every record accepted so far has been written (or its write has failed). Never rejects.
   * Await it before a script or test ends: records still queued are lost on `process.exit()`, a
   * crash or a signal unless flush() has been awaited.
   */
  flush(): Promise<void>;
}

export function createLogger(options: LoggerOptions): Logger {
  const opts = { ...options, key: options.key instanceof Key ? options.key : new Key(1, options.key) };
  let next = existingRecords(opts.path);
  let queue: string[] = [];
  let running: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const text = queue.join("");
      queue = [];
      try {
        await mkdir(dirname(opts.path), { recursive: true });
        await appendFile(opts.path, text);
      } catch {
        // Logging must never break the app; the batch is dropped.
      }
    }
  };
  const flush = async (): Promise<void> => {
    while (running !== null) await running;
  };
  const enqueue = (line: string): void => {
    queue.push(line);
    if (running !== null) return;
    ensureExitHook();
    pendingLoggers.add(flush);
    // Start on a later tick so log() returns before any disk work begins.
    running = Promise.resolve()
      .then(drain)
      .finally(() => {
        running = null;
        pendingLoggers.delete(flush);
        if (queue.length > 0) enqueue("");
      });
  };

  return {
    flush,
    log(req, res, flags = {}) {
      try {
        let who: ReturnType<typeof identify> = null;
        try {
          who = identify(opts.key, req.dialect, req.body);
        } catch {
          who = null;
        }
        let params = "";
        try {
          params = paramsHash(opts.key, req.params);
        } catch {
          params = "";
        }
        const record: UsageRecord = {
          v: 1,
          ts: new Date().toISOString(),
          provider: opts.provider,
          model: opts.model,
          dialect: req.dialect,
          ids: who?.ids ?? null,
          node_chars: who?.node_chars ?? null,
          breakpoints: (req.breakpoints ?? []).filter((n) => Number.isInteger(n)),
          params,
          ...usageFrom(opts.provider, res.usage),
          finish: finishFrom(res.finish),
          flags,
        };
        enqueue(JSON.stringify(record) + "\n");
        return next++;
      } catch {
        // Logging must never break the app's call path.
        return null;
      }
    },
  };
}
