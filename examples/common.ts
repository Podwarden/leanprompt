// Helpers the example apps share: building a request in either dialect, reading the reply text,
// a clock, a seeded shuffle, stable key order, filler text and the answer check.

import type { Dialect } from "@kvsig/core";
import type { Check } from "./types.js";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface Parts {
  system: string;
  tools?: ToolDef[];
  messages: { role: "user" | "assistant"; text: string }[];
  maxTokens?: number;
  /** Extra top-level body fields, the same in both dialects (for example `temperature`). */
  extra?: Record<string, unknown>;
}

/** Anthropic needs `cache_control` marks to cache anything; every other provider here caches by itself. */
export const dialectFor = (provider: string): Dialect => (provider === "anthropic" ? "anthropic.messages" : "openai.chat");

/**
 * The request body for either dialect. On `anthropic.messages` the last system block carries one
 * `cache_control` mark, which covers the tools and the system prompt. Both forms of every app get it.
 */
export function chatRequest(dialect: Dialect, p: Parts): { dialect: Dialect; body: unknown } {
  const max = p.maxTokens ?? 300;
  if (dialect === "anthropic.messages") {
    const tools = p.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    return {
      dialect,
      body: {
        max_tokens: max,
        ...p.extra,
        ...(tools ? { tools } : {}),
        system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
        messages: p.messages.map((m) => ({ role: m.role, content: m.text })),
      },
    };
  }
  const tools = p.tools?.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return {
    dialect,
    body: {
      max_completion_tokens: max,
      ...p.extra,
      ...(tools ? { tools } : {}),
      messages: [{ role: "system", content: p.system }, ...p.messages.map((m) => ({ role: m.role, content: m.text }))],
    },
  };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** The reply text of either response shape. */
export function answerText(body: unknown): string {
  if (!isObj(body)) return "";
  const choice = Array.isArray(body.choices) && isObj(body.choices[0]) ? body.choices[0] : null;
  if (choice && isObj(choice.message) && typeof choice.message.content === "string") return choice.message.content;
  const block = Array.isArray(body.content) && isObj(body.content[0]) ? body.content[0] : null;
  return block && typeof block.text === "string" ? block.text : "";
}

/** The reply text of every choice (`n` samples) in the OpenAI shape; the one text of an Anthropic reply. */
export function answerTexts(body: unknown): string[] {
  if (isObj(body) && Array.isArray(body.choices)) {
    return body.choices.map((c) => (isObj(c) && isObj(c.message) && typeof c.message.content === "string" ? c.message.content : ""));
  }
  return [answerText(body)];
}

/** A clock that moves `stepMs` on every call. */
export const CLOCK_START = "2026-11-26T09:00:00Z";
export function stepClock(start = CLOCK_START, stepMs = 90_000): () => Date {
  let t = Date.parse(start) - stepMs;
  return () => new Date((t += stepMs));
}

/** A small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The same value with every object's keys in sorted order (arrays keep theirs). */
export function sortKeys<T>(x: T): T {
  if (Array.isArray(x)) return x.map(sortKeys) as T;
  if (isObj(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) as T;
  return x;
}

const SUBJECTS = ["a refund", "a delivery", "a warranty claim", "an invoice", "a password reset", "a bulk order", "a damaged parcel", "an address change"];

/** `n` lines of stable policy text, so a prompt is long enough to be cached (Anthropic's minimum is 4,096 tokens). */
export function policyText(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const s = SUBJECTS[i % SUBJECTS.length];
    return `Guideline ${i + 1}: when a request concerns ${s}, confirm the account details first, answer in plain language, keep to the figures in this handbook, and hand the case to a person if it is not covered here (reference G${100 + i}).`;
  }).join("\n");
}

/** A check that every answer holds all of its expected words. `expected[i]` belongs to answer `i`. */
export function containsAll(expected: string[][]): Check {
  return ([answers]) => {
    if (!answers || answers.length !== expected.length) {
      return { pass: false, detail: `expected ${expected.length} answers, got ${answers?.length ?? 0}` };
    }
    const bad = expected.flatMap((words, i) =>
      words.filter((w) => !new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(answers[i])).map((w) => `#${i + 1}: ${w}`),
    );
    return bad.length === 0 ? { pass: true, detail: `${answers.length} answers hold what was asked` } : { pass: false, detail: `missing ${bad.slice(0, 5).join(", ")}` };
  };
}
