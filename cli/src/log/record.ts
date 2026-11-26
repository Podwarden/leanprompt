// The usage record (`leanprompt/usage/1`): one JSON object per line in .leanprompt/usage.jsonl.
// It holds ids, counts and flags only. It never holds prompt or completion text.

export type Finish = "stop" | "length" | "tool" | "error";

export interface Flags {
  /**
   * The call this one retries: the 0-based index of the earlier record among the valid records of
   * the same usage file, in file order. A value not smaller than this record's own index is ignored.
   * Retry links hold within one file written by one process; concatenating logs from several
   * processes is not supported for retry linking.
   */
  retry_of?: number;
  parse_failed?: true;
}

export interface RecordIds {
  conv: string | null;
  head: string;
  nodes: string[];
}

export interface UsageRecord {
  v: 1;
  ts: string;
  provider: string;
  model: string;
  dialect: string;
  ids: RecordIds | null;
  node_chars: number[] | null;
  breakpoints: number[];
  params: string;
  prompt_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  finish: Finish;
  flags: Flags;
}

export interface Tokens {
  prompt_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/**
 * Token counts from a provider's usage object.
 * The Anthropic shape (provider "anthropic", or cache_read_input_tokens / cache_creation_input_tokens
 * present, as from Bedrock, Vertex or a proxy) reports input_tokens apart from the cache counters, so the prompt is their sum.
 * OpenAI-compatible APIs report prompt_tokens with the cached part inside it. Gemini's native
 * usageMetadata is read too, and so is the Vercel AI SDK's camelCase usage (v4 promptTokens /
 * completionTokens; v5 inputTokens / outputTokens / cachedInputTokens, where Anthropic's inputTokens
 * leaves out the cache read; v6 inputTokens as the total with inputTokenDetails). Anything unreadable counts as 0.
 */
export function usageFrom(provider: string, usage: unknown): Tokens {
  const u = isObj(usage) ? usage : {};
  if ("inputTokens" in u || "promptTokens" in u || "outputTokens" in u || "completionTokens" in u) {
    const out = num(u.outputTokens ?? u.completionTokens);
    if (isObj(u.inputTokenDetails)) {
      const d = u.inputTokenDetails;
      return { prompt_tokens: num(u.inputTokens), cached_tokens: num(d.cacheReadTokens), cache_write_tokens: num(d.cacheWriteTokens), output_tokens: out };
    }
    const input = num(u.inputTokens ?? u.promptTokens);
    const cached = num(u.cachedInputTokens);
    return {
      prompt_tokens: provider === "anthropic" ? input + cached : input,
      cached_tokens: cached,
      cache_write_tokens: 0,
      output_tokens: out,
    };
  }
  if (provider === "anthropic" || "cache_read_input_tokens" in u || "cache_creation_input_tokens" in u) {
    const read = num(u.cache_read_input_tokens);
    const write = num(u.cache_creation_input_tokens);
    return {
      prompt_tokens: num(u.input_tokens) + read + write,
      cached_tokens: read,
      cache_write_tokens: write,
      output_tokens: num(u.output_tokens),
    };
  }
  if (isObj(u.usageMetadata) || "promptTokenCount" in u) {
    const m = isObj(u.usageMetadata) ? u.usageMetadata : u;
    return {
      prompt_tokens: num(m.promptTokenCount),
      cached_tokens: num(m.cachedContentTokenCount),
      cache_write_tokens: 0,
      output_tokens: num(m.candidatesTokenCount),
    };
  }
  const details = isObj(u.prompt_tokens_details)
    ? u.prompt_tokens_details
    : isObj(u.input_tokens_details)
      ? u.input_tokens_details
      : {};
  return {
    prompt_tokens: num(u.prompt_tokens ?? u.input_tokens),
    cached_tokens: num(details.cached_tokens),
    cache_write_tokens: num(details.cache_write_tokens),
    output_tokens: num(u.completion_tokens ?? u.output_tokens),
  };
}

/** Provider finish reasons mapped onto the record's four values; unknown reasons count as "stop". */
export function finishFrom(finish: string | undefined): Finish {
  switch (finish) {
    case "length":
    case "max_tokens":
    case "max_output_tokens":
      return "length";
    case "tool":
    case "tool_calls":
    case "tool_use":
    case "function_call":
      return "tool";
    case "error":
      return "error";
    default:
      return "stop";
  }
}

function validRecord(r: unknown): r is UsageRecord {
  if (!isObj(r) || r.v !== 1) return false;
  for (const k of ["ts", "provider", "model", "dialect", "params"]) if (typeof r[k] !== "string") return false;
  for (const k of ["prompt_tokens", "cached_tokens", "cache_write_tokens", "output_tokens"]) {
    if (typeof r[k] !== "number") return false;
  }
  if (r.ids !== null && !(isObj(r.ids) && Array.isArray(r.ids.nodes) && typeof r.ids.head === "string")) return false;
  if (r.node_chars !== null && !Array.isArray(r.node_chars)) return false;
  if (!Array.isArray(r.breakpoints) || !isObj(r.flags)) return false;
  return typeof r.finish === "string";
}

/** Reads a usage.jsonl text. A malformed or non-record line is skipped and counted in `bad`; blank lines are ignored. */
export function parseUsageLog(text: string): { records: UsageRecord[]; bad: number } {
  const records: UsageRecord[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r: unknown = JSON.parse(line);
      if (validRecord(r)) records.push(r);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { records, bad };
}
