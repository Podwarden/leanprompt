import { profileTargets, type Price, type Profile } from "../profile.js";
import { isOpenQuestion, isServerFinding, type AverageCall, type Finding } from "../score/static.js";

/** Which part of the page a finding belongs to: the app's findings, its open questions, the server's administrator, or fixed. */
export type Group = "open" | "question" | "server" | "fixed";
export const groupOf = (f: Finding): Group => (f.fixed ? "fixed" : isServerFinding(f) ? "server" : isOpenQuestion(f) ? "question" : "open");
const GROUP_ORDER: Record<Group, number> = { open: 0, question: 1, server: 2, fixed: 3 };

/**
 * What the findings cost, from the audit's token estimates and the user's own volume and dated prices
 * in leanprompt.yaml. Money is never part of the score; this is a separate, labelled estimate, and it is
 * only computed when a volume and a dated price are both present. Nothing here is invented: a missing
 * input leaves the figure out and names the input in `missing`.
 */
export interface CostRow {
  finding: Finding;
  group: Group;
  /** prompt + uncached + output tokens per 1,000 calls. */
  tokens: number;
  dollars_per_month?: number;
  /** Average seconds this finding adds to a call's first-token time on a self-hosted engine. */
  ttft_seconds?: number;
  gpu_hours_per_month?: number;
  model?: string;
}

export interface CostSummary {
  rows: CostRow[];
  /** Open app findings that are not open questions, with tokens. */
  tokens_per_1k: number;
  question_tokens_per_1k: number;
  /** Open findings for the server's administrator, with tokens: never in the app's totals. */
  server_tokens_per_1k: number;
  with_tokens: number;
  measured: boolean;
  /** Smallest number of calls behind a measured figure, when `measured`. */
  measured_calls?: number;
  money?: {
    calls_per_month: number;
    volume_source?: string;
    lost_per_month: number;
    saved_if_fixed: number;
    saved_by_fixes?: number;
    questions_per_month?: number;
    server_per_month?: number;
    bill_per_month?: number;
    percent?: number;
    prices: { model: string; price: Price }[];
  };
  gpu?: { calls_per_month: number; prefill_tokens_per_second: number; hours_per_month: number };
  /** One entry per missing input: what to add to leanprompt.yaml, a tab, and what it is. */
  missing: string[];
  average_call?: AverageCall;
}

/** Tokens lost: prompt + uncached + output. `cache_write` is a cost of the fix, priced in money only. */
const tokensOf = (f: Finding): number => (f.tokens_per_1k?.prompt ?? 0) + (f.tokens_per_1k?.uncached ?? 0) + (f.tokens_per_1k?.output ?? 0);

function volumeOf(p: Profile | null): { calls_per_month: number; source?: string } | undefined {
  if (!p) return undefined;
  if (p.targets) {
    if (!p.targets.every((t) => t.volume)) return undefined;
    const sources = p.targets.map((t) => t.volume!.source).filter((s): s is string => !!s);
    const v: { calls_per_month: number; source?: string } = { calls_per_month: p.targets.reduce((n, t) => n + t.volume!.calls_per_month, 0) };
    if (sources.length) v.source = sources.join("; ");
    return v;
  }
  return p.volume;
}

/** The one prefill throughput the profile gives, from `engine:` or an engine entry's `engine_facts`. */
function throughput(p: Profile | null): number | undefined {
  if (!p) return undefined;
  const all = new Set<number>();
  if (p.engine?.prefill_tokens_per_second) all.add(p.engine.prefill_tokens_per_second);
  for (const t of profileTargets(p)) if (t.engine_facts?.prefill_tokens_per_second) all.add(t.engine_facts.prefill_tokens_per_second);
  return all.size === 1 ? [...all][0] : undefined;
}

/** US dollars per 1,000 calls for one finding at one price, or a reason it cannot be priced. */
function dollarsPer1k(f: Finding, price: Price): number | string {
  const t = f.tokens_per_1k ?? {};
  if ((t.uncached ?? 0) > 0 && price.cached_input === undefined) return "cached_input";
  if ((t.cache_write ?? 0) > 0 && price.cache_write === undefined) return "cache_write";
  // A fix that adds cache marks writes these tokens at the cache-write price instead of the input price.
  const premium = (t.cache_write ?? 0) * ((price.cache_write ?? price.input) - price.input);
  const perM = (t.prompt ?? 0) * price.input + (t.uncached ?? 0) * (price.input - (price.cached_input ?? 0)) + (t.output ?? 0) * price.output - premium;
  return perM / 1e6;
}

export function costSummary(findings: readonly Finding[], profile: Profile | null, average_call?: AverageCall): CostSummary {
  const prices = profile?.prices ?? {};
  const models = Object.keys(prices);
  const volume = volumeOf(profile);
  const tps = throughput(profile);
  const missing = new Set<string>();
  const usedPrices = new Map<string, Price>();
  const rows: CostRow[] = [];

  const priceFor = (f: Finding): string | undefined => (f.model ? (prices[f.model] ? f.model : undefined) : models.length === 1 ? models[0] : undefined);

  for (const f of findings) {
    if (!f.tokens_per_1k) continue;
    const row: CostRow = { finding: f, group: groupOf(f), tokens: tokensOf(f) };
    const model = priceFor(f);
    if (model && volume) {
      const d = dollarsPer1k(f, prices[model]!);
      if (typeof d === "number") {
        row.dollars_per_month = (d * volume.calls_per_month) / 1000;
        row.model = model;
        usedPrices.set(model, prices[model]!);
      } else if (d === "cache_write") {
        missing.add(`prices.${model}.cache_write\tthe cache-write price, to price what writing the new cache marks costs`);
      } else {
        missing.add(`prices.${model}.cached_input\tthe cached-input price, to price the tokens the cache could have served`);
      }
    } else if (!f.fixed) {
      if (!model && models.length > 1) missing.add(`"model" on each finding\twhich of the models in prices: its calls use`);
      if (!model && models.length > 0 && f.model) missing.add(`prices.${f.model}\tthe price of the model this finding names`);
    }
    if (tps) {
      const prefill = (f.tokens_per_1k.uncached ?? 0) + (f.tokens_per_1k.prompt ?? 0);
      if ((f.tokens_per_1k.uncached ?? 0) > 0) row.ttft_seconds = (f.tokens_per_1k.uncached! / 1000) / tps;
      if (volume && prefill > 0) row.gpu_hours_per_month = ((prefill / 1000) * volume.calls_per_month) / tps / 3600;
    }
    rows.push(row);
  }
  // The table's order: the app's findings, then its open questions, then the server's, each largest first.
  rows.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.tokens - a.tokens);

  const open = rows.filter((r) => r.group === "open");
  const questions = rows.filter((r) => r.group === "question");
  const server = rows.filter((r) => r.group === "server");
  const fixed = rows.filter((r) => r.group === "fixed");
  const sum = (rs: CostRow[], k: "tokens" | "dollars_per_month" | "gpu_hours_per_month") => rs.reduce((n, r) => n + (r[k] ?? 0), 0);
  const scored = rows.filter((r) => !r.finding.fixed);
  const measuredCalls = scored.map((r) => r.finding.tokens_per_1k!.measured_calls);
  const measured = scored.length > 0 && measuredCalls.every((n) => n !== undefined);

  const out: CostSummary = {
    rows,
    tokens_per_1k: sum(open, "tokens"),
    question_tokens_per_1k: sum(questions, "tokens"),
    server_tokens_per_1k: sum(server, "tokens"),
    with_tokens: open.length,
    measured,
    missing: [],
  };
  if (measured) out.measured_calls = Math.min(...(measuredCalls as number[]));
  if (average_call) out.average_call = average_call;

  if (!volume) missing.add("volume: {calls_per_month: N}\thow many calls the app makes a month (with targets:, on each entry)");
  if (models.length === 0 && !tps) {
    missing.add("prices\tper model: input, cached_input and output in US dollars per 1M tokens, with source and checked date (or, self-hosted, engine: {prefill_tokens_per_second: N})");
  }

  const openPriced = open.filter((r) => r.dollars_per_month !== undefined);
  if (volume && openPriced.length > 0 && openPriced.length === open.length) {
    const lost = sum(open, "dollars_per_month");
    const money: NonNullable<CostSummary["money"]> = {
      calls_per_month: volume.calls_per_month,
      lost_per_month: lost,
      saved_if_fixed: lost,
      prices: [...usedPrices].map(([model, price]) => ({ model, price })),
    };
    if (volume.source) money.volume_source = volume.source;
    if (fixed.some((r) => r.dollars_per_month !== undefined)) money.saved_by_fixes = sum(fixed, "dollars_per_month");
    if (questions.some((r) => r.dollars_per_month !== undefined)) money.questions_per_month = sum(questions, "dollars_per_month");
    if (server.some((r) => r.dollars_per_month !== undefined)) money.server_per_month = sum(server, "dollars_per_month");
    if (average_call && usedPrices.size === 1) {
      const p = [...usedPrices.values()][0]!;
      money.bill_per_month = (volume.calls_per_month * (average_call.prompt_tokens * p.input + average_call.output_tokens * p.output)) / 1e6;
      if (money.bill_per_month > 0) money.percent = (100 * lost) / money.bill_per_month;
    }
    out.money = money;
  }
  if (tps && volume) {
    const hours = sum(open, "gpu_hours_per_month");
    if (hours > 0) out.gpu = { calls_per_month: volume.calls_per_month, prefill_tokens_per_second: tps, hours_per_month: hours };
  }
  if (!out.money && !out.gpu) out.missing = [...missing];
  else out.missing = [...missing].filter((m) => !m.startsWith("volume") && !m.startsWith("prices\t"));
  return out;
}

/** 950, 138k, 1.5M */
export function formatTokens(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${Number((n / 1e3).toFixed(1))}k`;
  return `${Math.round(n)}`;
}

/** $0.48, $12, $1,235 */
export function formatDollars(n: number): string {
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
