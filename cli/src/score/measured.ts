// Measured score from a usage log (DESIGN §8). Pure: the caller reads the log and the provider facts.

import { cap, type CacheFacts } from "../facts.js";
import type { UsageRecord } from "../log/record.js";
import { scoreFrom } from "./static.js";

/** A measured score needs at least this many measured calls (DESIGN §8). */
export const MIN_CALLS = 50;

/** Why a call was left out of E and S. */
export type UnmeasuredReason = "no_usage" | "no_ids" | "bad_node_chars" | "bad_ts" | "unknown_provider" | "call_failed";

export interface MeasuredScore {
  ok: true;
  score: number;
  inputs: { E: number; S: number; G: number };
  /** Every record given. G is computed over all of them; E and S over `calls - unmeasured`. */
  calls: number;
  /** Records left out of E and S, never counted as zero reuse. */
  unmeasured: number;
  unmeasured_by_reason: Record<UnmeasuredReason, number>;
  /** Reusable tokens are estimated by character share: prompt_tokens x node_chars[i] / node_chars[last]. */
  estimate: "char-share";
  /**
   * Head churn, for information only: not part of E, S, G or the score. Counted over records with ids.
   * The usage record keeps one `head` id (not separate system and tools ids), so this is distinct heads.
   */
  heads: { distinct_head: number; conversations: number };
}

export interface TooFewCalls {
  ok: false;
  reason: "too_few_calls";
  /** Every record given. */
  calls: number;
  /** Of which left out of E and S; the threshold applies to `calls - unmeasured`. */
  unmeasured: number;
  unmeasured_by_reason: Record<UnmeasuredReason, number>;
}

interface Measured {
  r: UsageRecord;
  t: number;
  facts: CacheFacts;
}

/** A trie over node-id sequences; each entry holds the latest ts (ms) of a request whose prefix ends there. */
interface Trie {
  seen: number;
  next: Map<string, Trie>;
}

const validNodeChars = (nc: number[] | null, n: number): nc is number[] => {
  if (!Array.isArray(nc) || nc.length === 0 || nc.length !== n) return false;
  let prev = 0;
  for (const c of nc) {
    if (typeof c !== "number" || !Number.isFinite(c) || c < prev) return false;
    prev = c;
  }
  return prev > 0;
};

/** Record positions in time order: earlier `ts` first, equal (or unreadable) `ts` in file order; unreadable ts last. */
function timeOrder(records: readonly UsageRecord[]): { order: number[]; t: number[] } {
  const t = records.map((r) => {
    const ms = Date.parse(r.ts);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  });
  const order = records.map((_, i) => i).sort((a, b) => (t[a] === t[b] ? a - b : t[a] < t[b] ? -1 : 1));
  return { order, t };
}

/**
 * The measured score of a usage log (DESIGN §8).
 *
 * In time order (`ts`; equal ts keep file order), for each measured record r:
 * - shared(r) is the deepest i such that r.ids.nodes[0..i] equals the nodes prefix of an earlier
 *   measured record seen within the provider's `ttl_seconds` (0 = no limit), across all `conv`s.
 * - reusable(r) = cap(facts, round(prompt_tokens x node_chars[i] / node_chars[last])), or 0 when
 *   nothing is shared. Missing Anthropic breakpoints do not reduce it (owner ruling D1).
 * - stable(r) is the same estimate over the deepest prefix shared with an earlier measured record of
 *   any age, then cap: the structure the app kept, whether or not the cache still held it.
 * - E = sum cached / sum reusable, clamped to [0, 1]; 1 when nothing is reusable.
 * - S = sum stable / sum prompt over records that continue an earlier record with the same conv; 1 when
 *   none. The cache lifetime does not affect S: a user's pause is not the app rewriting its prefix.
 * G = output tokens of wasted calls / all output tokens, over every record. A call is wasted when
 * (a) an earlier call has the same last node and the same params, (b) flags.retry_of is the
 * position (0-based, in `records`, earlier than the retry) of a call with finish "length" and the
 * same params, or (c) flags.parse_failed.
 *
 * A record is unmeasured (out of E and S, never zero reuse) when its finish is "error" (call_failed),
 * its prompt_tokens is 0 or less (no_usage: the logger got no usage counts, so a broken integration
 * refuses instead of scoring a perfect E), it has no ids, its node_chars is missing, empty, misaligned with ids.nodes, not non-decreasing
 * or ends at 0, its ts is unreadable,
 * or `factsFor` has no facts for its provider (throws or returns nothing).
 */
export function measuredScore(
  records: readonly UsageRecord[],
  factsFor: (provider: string) => CacheFacts,
): MeasuredScore | TooFewCalls {
  const { order, t } = timeOrder(records);
  const by_reason: Record<UnmeasuredReason, number> = {
    no_usage: 0, no_ids: 0, bad_node_chars: 0, bad_ts: 0, unknown_provider: 0, call_failed: 0,
  };
  const factsCache = new Map<string, CacheFacts | null>();
  const lookup = (provider: string): CacheFacts | null => {
    if (!factsCache.has(provider)) {
      let f: CacheFacts | null = null;
      try {
        f = factsFor(provider) ?? null;
      } catch {
        f = null;
      }
      factsCache.set(provider, f);
    }
    return factsCache.get(provider)!;
  };

  const measured: Measured[] = [];
  for (const i of order) {
    const r = records[i];
    let why: UnmeasuredReason | null = null;
    let facts: CacheFacts | null = null;
    // A failed call (finish "error") never reached the cache, or its state is unknown: not evidence either way.
    if (r.finish === "error") why = "call_failed";
    // No prompt tokens: the usage object was missing or unreadable. Never evidence of reuse.
    else if (!(r.prompt_tokens > 0)) why = "no_usage";
    else if (!r.ids || !Array.isArray(r.ids.nodes) || r.ids.nodes.length === 0) why = "no_ids";
    else if (!validNodeChars(r.node_chars, r.ids.nodes.length)) why = "bad_node_chars";
    else if (t[i] === Number.POSITIVE_INFINITY) why = "bad_ts";
    else if (!(facts = lookup(r.provider))) why = "unknown_provider";
    if (why) by_reason[why]++;
    else measured.push({ r, t: t[i], facts: facts! });
  }
  const unmeasured = records.length - measured.length;
  if (measured.length < MIN_CALLS) return { ok: false, reason: "too_few_calls", calls: records.length, unmeasured, unmeasured_by_reason: by_reason };

  // E and S.
  const root: Trie = { seen: Number.NEGATIVE_INFINITY, next: new Map() };
  const convs = new Set<string>();
  let cachedSum = 0;
  let reusableSum = 0;
  let contStable = 0;
  let contPrompt = 0;
  for (const { r, t: now, facts } of measured) {
    const nodes = r.ids!.nodes;
    const chars = r.node_chars!;
    const ttlMs = facts.ttl_seconds > 0 ? facts.ttl_seconds * 1000 : Number.POSITIVE_INFINITY;
    // Walk the shared prefix. `deepest` is the structural match (any age). A shallower entry was
    // seen no earlier than a deeper one, so once an entry is outside the lifetime, `shared` stops.
    let deepest = -1;
    let shared = -1;
    let node = root;
    for (let k = 0; k < nodes.length; k++) {
      const child = node.next.get(nodes[k]);
      if (!child) break;
      deepest = k;
      if (shared === k - 1 && now - child.seen <= ttlMs) shared = k;
      node = child;
    }
    const estimate = (i: number): number =>
      i < 0 ? 0 : cap(facts, Math.round((r.prompt_tokens * chars[i]) / chars[chars.length - 1]));
    const reusable = estimate(shared);
    cachedSum += r.cached_tokens;
    reusableSum += reusable;
    const conv = r.ids!.conv;
    if (conv !== null && conv !== undefined) {
      if (convs.has(conv)) {
        contStable += estimate(deepest);
        contPrompt += r.prompt_tokens;
      } else convs.add(conv);
    }
    // Record this request's prefixes as seen now.
    node = root;
    for (const id of nodes) {
      let child = node.next.get(id);
      if (!child) node.next.set(id, (child = { seen: now, next: new Map() }));
      else child.seen = Math.max(child.seen, now);
      node = child;
    }
  }
  const E = reusableSum > 0 ? Math.min(1, Math.max(0, cachedSum / reusableSum)) : 1;
  const S = contPrompt > 0 ? contStable / contPrompt : 1;

  // G, over every record in time order.
  const lastSeen = new Set<string>();
  let wasted = 0;
  let output = 0;
  for (const i of order) {
    const r = records[i];
    output += r.output_tokens;
    const nodes = r.ids && Array.isArray(r.ids.nodes) ? r.ids.nodes : [];
    // A failed call neither repeats nor seeds the repeat rule: retrying it is correct (LP-GE-05).
    const key = nodes.length && r.finish !== "error" ? JSON.stringify([nodes[nodes.length - 1], r.params]) : null;
    const repeat = key !== null && lastSeen.has(key);
    if (key !== null) lastSeen.add(key);
    const j = r.flags?.retry_of;
    const target = typeof j === "number" && Number.isInteger(j) && j >= 0 && j < i ? records[j] : undefined;
    const retryOfTruncation = target !== undefined && target.finish === "length" && target.params === r.params;
    if (repeat || retryOfTruncation || r.flags?.parse_failed === true) wasted += r.output_tokens;
  }
  const G = output > 0 ? wasted / output : 0;

  // Head churn (information only).
  const heads = new Set<string>();
  const conversations = new Set<string>();
  for (const r of records) {
    if (!r.ids) continue;
    heads.add(r.ids.head);
    if (r.ids.conv !== null && r.ids.conv !== undefined) conversations.add(r.ids.conv);
  }

  const inputs = { E, S, G };
  return {
    ok: true,
    score: scoreFrom(inputs),
    inputs,
    calls: records.length,
    unmeasured,
    unmeasured_by_reason: by_reason,
    estimate: "char-share",
    heads: { distinct_head: heads.size, conversations: conversations.size },
  };
}
