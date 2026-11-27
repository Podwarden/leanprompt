import { profileTargets, type Price, type Profile } from "../profile.js";
import { isKnownFinding, isOpenQuestion, isServerFinding, overlapGroups, type AverageCall, type Finding } from "../score/static.js";

/**
 * Which part of the page a finding belongs to: the app's findings, its open questions, the server's administrator,
 * the findings the project already knows about (planned, in progress, declined or reported), or fixed.
 */
export type Group = "open" | "question" | "server" | "known" | "fixed";
export const groupOf = (f: Finding): Group =>
  f.fixed ? "fixed" : isKnownFinding(f) ? "known" : isServerFinding(f) ? "server" : isOpenQuestion(f) ? "question" : "open";
const GROUP_ORDER: Record<Group, number> = { open: 0, question: 1, server: 2, known: 3, fixed: 4 };

/**
 * A finding that costs no tokens: every share it gives is 0 and it has no token estimate above 0 (a prompt below the
 * provider's minimum, a change not recommended). It stays on the page but is not counted as a place that wastes tokens.
 */
export function costsNothing(f: Finding): boolean {
  const shares = [f.share, f.share_prefill, f.share_output].filter((v): v is number => v !== undefined);
  if (shares.length === 0 || shares.some((v) => v > 0)) return false;
  const t = f.tokens_per_1k;
  return !t || (t.prompt ?? 0) + (t.uncached ?? 0) + (t.output ?? 0) === 0;
}

/**
 * The sum of `value` over rows, counting each group of overlapping findings once: its largest value.
 * Overlapping findings lose some of the same tokens, so adding them would count those tokens twice.
 */
export function sumOverlapping<T extends { finding: Finding }>(rows: readonly T[], value: (r: T) => number | undefined): number {
  return overlapGroups(rows.map((r) => r.finding)).reduce((n, g) => n + Math.max(0, ...g.map((i) => value(rows[i]!) ?? 0)), 0);
}

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
  /** Findings the project already knows about, with tokens: never in the totals. */
  known_tokens_per_1k: number;
  /** Whether some findings in the totals overlap, so the totals count each overlapping group once. */
  overlaps: boolean;
  with_tokens: number;
  measured: boolean;
  /** Smallest number of calls behind a measured figure, when `measured`. */
  measured_calls?: number;
  money?: {
    /** ISO 4217 code of every price used; absent means US dollars. Figures are shown as given, never converted. */
    currency?: string;
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

/** Money per 1,000 calls for one finding at one price (in the price's currency), or a reason it cannot be priced. */
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
  // The table's order: the app's findings, then its open questions, then the server's, then the known ones, each largest first.
  rows.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.tokens - a.tokens);

  const open = rows.filter((r) => r.group === "open");
  const questions = rows.filter((r) => r.group === "question");
  const server = rows.filter((r) => r.group === "server");
  const known = rows.filter((r) => r.group === "known");
  const fixed = rows.filter((r) => r.group === "fixed");
  // Overlapping findings count once per group, the largest (0.1.0-dev.14).
  const sum = (rs: CostRow[], k: "tokens" | "dollars_per_month" | "gpu_hours_per_month") => sumOverlapping(rs, (r) => r[k]);
  // What the open questions add on top of the findings, overlaps counted once across both.
  const added = (k: "tokens" | "dollars_per_month") => sum([...open, ...questions], k) - sum(open, k);
  const scored = rows.filter((r) => !r.finding.fixed);
  const measuredCalls = scored.map((r) => r.finding.tokens_per_1k!.measured_calls);
  const measured = scored.length > 0 && measuredCalls.every((n) => n !== undefined);

  const out: CostSummary = {
    rows,
    tokens_per_1k: sum(open, "tokens"),
    question_tokens_per_1k: added("tokens"),
    server_tokens_per_1k: sum(server, "tokens"),
    known_tokens_per_1k: sum(known, "tokens"),
    overlaps: [...open, ...questions].some((r) => (r.finding.overlaps?.length ?? 0) > 0),
    with_tokens: open.length,
    measured,
    missing: [],
  };
  if (measured) out.measured_calls = Math.min(...(measuredCalls as number[]));
  if (average_call) out.average_call = average_call;

  if (!volume) missing.add("volume: {calls_per_month: N}\thow many calls the app makes a month (with targets:, on each entry)");
  if (models.length === 0 && !tps) {
    missing.add("prices\tper model: input, cached_input and output per 1M tokens (US dollars, or set currency), with source and checked date (or, self-hosted, engine: {prefill_tokens_per_second: N})");
  }

  const openPriced = open.filter((r) => r.dollars_per_month !== undefined);
  const currencies = new Set([...usedPrices.values()].map((p) => p.currency ?? "USD"));
  if (currencies.size > 1) missing.add(`prices.*.currency\tone currency for every model: the prices are in ${[...currencies].join(" and ")}, and leanprompt does not convert between them`);
  if (volume && openPriced.length > 0 && openPriced.length === open.length && currencies.size <= 1) {
    const lost = sum(open, "dollars_per_month");
    const money: NonNullable<CostSummary["money"]> = {
      calls_per_month: volume.calls_per_month,
      lost_per_month: lost,
      saved_if_fixed: lost,
      prices: [...usedPrices].map(([model, price]) => ({ model, price })),
    };
    if (volume.source) money.volume_source = volume.source;
    const cur = [...currencies][0];
    if (cur && cur !== "USD") money.currency = cur;
    if (fixed.some((r) => r.dollars_per_month !== undefined)) money.saved_by_fixes = sum(fixed, "dollars_per_month");
    if (questions.some((r) => r.dollars_per_month !== undefined)) money.questions_per_month = added("dollars_per_month");
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

/** $0.48, $12, $1,235; with a currency other than USD, its code before the figure: CNY 0.48, CNY 1,235. */
export function formatDollars(n: number, currency?: string): string {
  const body = n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US");
  return currency && currency !== "USD" ? `${currency} ${body}` : `$${body}`;
}

/** A unit price as written: $0.15, or CNY 0.15 for another currency. */
export function formatPrice(v: number, currency?: string): string {
  const body = v.toFixed(Math.max(2, (String(v).split(".")[1] ?? "").length));
  return currency && currency !== "USD" ? `${currency} ${body}` : `$${body}`;
}

/** One question only the owner can answer, with how to answer it (Markdown: code in backticks). */
export interface OwnerQuestion {
  label: string;
  text: string;
}

/**
 * The questions only the owner can answer that are still open: priority, volume and prices. Shown under
 * "Questions for the owner" on the page and in the Markdown report, the same list in both.
 */
export function ownerQuestions(p: Profile | null, cost: CostSummary, priority: string | undefined): OwnerQuestion[] {
  const q: OwnerQuestion[] = [];
  if (priority === undefined) {
    q.push({ label: "Priority", text: "which matters most for this app, cost, speed or quality (or weights)? Not set, so the advice uses equal weights. Answer with `priority:` in `leanprompt.yaml`." });
  }
  const hasVolume = !!p && (p.volume !== undefined || (p.targets?.length ? p.targets.every((t) => t.volume) : false));
  if (!hasVolume) q.push({ label: "Volume", text: "how many calls does the app make a month? Answer with `volume: {calls_per_month: N, source: \"...\"}` in `leanprompt.yaml`." });
  if (!p?.prices && !cost.gpu) {
    q.push({ label: "Prices", text: "what does each model cost (input, cached input, output per 1M tokens, with the source and the date it was read, and the currency if not US dollars)? Answer with `prices:` in `leanprompt.yaml`." });
  }
  return q;
}
