import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEval, type ResultFile } from "../../../eval/run.js";
import { HttpClient } from "../../../eval/http.js";
import { SimProvider } from "../../../eval/sim/provider.js";
import { loadCacheFacts } from "../../src/facts.js";
import { parseUsageLog } from "../../src/log/record.js";
import { dialectFor, stepClock } from "../../../examples/common.js";
import type { CreateApp } from "../../../examples/types.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const APPS = ["rag-chunks-first", "repeat-samples", "compaction-rewrite"] as const;
type Kind = "openai" | "anthropic";

interface Mod {
  createApp: CreateApp;
}
interface Scn {
  scenario: { sessions: number; turns: { input: string }[] };
  expected: string[][];
  answerFor: (input: string) => string;
}
const load = async <T>(app: string, file: string): Promise<T> => (await import(`../../../examples/${app}/${file}.ts`)) as T;

/** The text of the newest message of a request body, in either dialect. */
const lastText = (body: unknown): string => {
  const msgs = (body as { messages: { content: unknown }[] }).messages;
  const c = msgs[msgs.length - 1].content;
  return typeof c === "string" ? c : "";
};

async function play(app: string, form: "before" | "after", kind: Kind, sim: { msPerOutputToken?: number; outputTokens?: (input: string) => number } = {}) {
  const { createApp } = await load<Mod>(app, "app");
  const { answerFor } = await load<Scn>(app, "scenario");
  const facts = loadCacheFacts(ROOT).get(kind)!;
  const client = new SimProvider({
    kind,
    facts,
    msPerOutputToken: sim.msPerOutputToken,
    reply: (body) => ({ text: answerFor(lastText(body)), output_tokens: sim.outputTokens?.(lastText(body)) ?? 5 }),
  });
  const outDir = mkdtempSync(join(tmpdir(), "lp-demo-"));
  const result: ResultFile = await runEval(
    { app, form, target: `sim:${kind}`, runs: 2, budgetUsd: 1 },
    {
      client,
      root: ROOT,
      outDir,
      now: () => new Date("2026-11-26T00:00:00Z"),
      loadApp: async (_a, f, provider) => createApp(f, { dialect: dialectFor(provider), clock: stepClock() }),
    },
  );
  const usage = readdirSync(join(outDir, "usage")).flatMap((f) => parseUsageLog(readFileSync(join(outDir, "usage", f), "utf8")).records);
  return { result, usage };
}

const sum = (r: ResultFile, k: "cached_tokens" | "output_tokens" | "calls"): number => r.runs.reduce((n, x) => n + x[k], 0);

describe("rest: scenarios", () => {
  for (const app of APPS) {
    it(`${app}: at least 3 sessions x 8 turns, so a measured run has 50+ calls`, async () => {
      const { scenario, expected } = await load<Scn>(app, "scenario");
      expect(scenario.sessions).toBeGreaterThanOrEqual(3);
      expect(scenario.turns.length).toBeGreaterThanOrEqual(8);
      expect(expected).toHaveLength(scenario.sessions * scenario.turns.length);
      expect(scenario.sessions * scenario.turns.length * 2).toBeGreaterThanOrEqual(50);
    });

    it(`${app}: check passes on canned replies built from the expected answers and fails on wrong ones`, async () => {
      const { check } = await load<{ check: (a: string[][]) => { pass: boolean } }>(app, "check");
      const { expected } = await load<Scn>(app, "scenario");
      expect(check([expected.map((w) => `Sure: ${w.join(" ")}.`)]).pass).toBe(true);
      expect(check([expected.map(() => "I do not know")]).pass).toBe(false);
      expect(check([expected.slice(1).map((w) => w.join(" "))]).pass).toBe(false);
      expect(check([[]]).pass).toBe(false);
    });

    for (const form of ["before", "after"] as const) {
      it(`${app}/${form}: run returns one answer per turn that the check accepts, and exposes the first request`, async () => {
        const { createApp } = await load<Mod>(app, "app");
        const { answerFor, scenario } = await load<Scn>(app, "scenario");
        const a = await createApp(form);
        expect(a.check).toBeTypeOf("function");
        const answers = await a.run(
          { send: async (req) => ({ body: { choices: [{ message: { content: answerFor(lastText(req.body)) } }] }, usage: {}, finish: "stop" }) },
          scenario,
        );
        expect(answers).toHaveLength(scenario.sessions * scenario.turns.length);
        expect(a.check!([answers]).pass).toBe(true);
        const first = a.buildRequest(scenario.turns[0].input, { session: 0, turn: 0, now: new Date("2026-11-26T09:00:00Z") });
        expect(first.dialect).toBe("openai.chat");
        const anth = await createApp(form, { dialect: "anthropic.messages" });
        expect(anth.buildRequest("hi", { session: 0, turn: 0, now: new Date() }).dialect).toBe("anthropic.messages");
      });
    }
  }
});


const bodyOf = (b: unknown): { messages: { role: string; content: string }[] } => b as { messages: { role: string; content: string }[] };
const first = async (app: string, form: "before" | "after", input: string, dialect?: "anthropic.messages") => {
  const { createApp } = await load<Mod>(app, "app");
  return (await createApp(form, dialect ? { dialect } : {})).buildRequest(input, { session: 0, turn: 0, now: new Date("2026-11-26T09:00:00Z") });
};

describe("rest: rag-chunks-first", () => {
  for (const kind of ["openai", "anthropic"] as const) {
    it(`on sim:${kind}: after has more cached tokens than before, and sends about as much`, async () => {
      const before = await play("rag-chunks-first", "before", kind);
      const after = await play("rag-chunks-first", "after", kind);
      expect(before.result.runs.every((r) => r.calls === 32)).toBe(true);
      expect(sum(after.result, "cached_tokens")).toBeGreaterThan(sum(before.result, "cached_tokens"));
      const sent = (r: ResultFile): number => r.runs.reduce((n, x) => n + x.prompt_tokens, 0);
      expect(sent(after.result) / sent(before.result)).toBeLessThan(1.25); // after keeps each turn's chunks in the history
    });
  }

  it("before reuses nothing: the chunks come first and change on every call", async () => {
    const before = await play("rag-chunks-first", "before", "openai");
    // The second run of an eval replays the first, so look at the first run (four sessions of eight calls).
    expect(before.usage.slice(0, 32).every((r) => r.cached_tokens === 0)).toBe(true);
  });

  it("after reuses the whole system prompt on every call but the first of the run", async () => {
    const after = await play("rag-chunks-first", "after", "openai");
    expect(after.usage.filter((r) => r.cached_tokens === 0)).toHaveLength(1);
  });

  it("after: the system prompt is the same for every question and holds no chunk; the chunks are labelled in the user message", async () => {
    const { TURNS, retrieve, partCode } = await load<{ TURNS: { part: number; input: string; expect: string[] }[]; retrieve: (i: number) => { id: string; text: string }[]; partCode: (i: number) => string }>("rag-chunks-first", "data");
    const systems = new Set<string>();
    for (const t of TURNS) {
      const msgs = bodyOf((await first("rag-chunks-first", "after", t.input)).body).messages;
      systems.add(msgs[0].content);
      expect(msgs[0].content).not.toContain(partCode(t.part));
      expect(msgs[0].content).toContain("<retrieved>"); // says where the chunks are
      expect(msgs[1].content.startsWith("<retrieved>\n")).toBe(true);
      expect(msgs[1].content.endsWith(t.input)).toBe(true);
      for (const c of retrieve(t.part)) expect(msgs[1].content).toContain(`[${c.id}] ${c.text}`);
    }
    expect(systems.size).toBe(1);
  });

  it("before: the chunks open the system prompt, so the system prompt differs per question", async () => {
    const { TURNS } = await load<{ TURNS: { input: string }[] }>("rag-chunks-first", "data");
    const systems = await Promise.all(TURNS.map(async (t) => bodyOf((await first("rag-chunks-first", "before", t.input)).body).messages[0].content));
    expect(new Set(systems).size).toBe(TURNS.length);
    expect(systems[0].startsWith("Retrieved chunks")).toBe(true);
  });

  it("the check wants the right chunk: an answer from a neighbouring chunk, or with no chunk id, fails", async () => {
    const { TURNS, retrieve } = await load<{ TURNS: { part: number; expect: string[] }[]; retrieve: (i: number) => { id: string; text: string }[] }>("rag-chunks-first", "data");
    const { check } = await load<{ check: (a: string[][]) => { pass: boolean } }>("rag-chunks-first", "check");
    const { SESSIONS } = await load<{ SESSIONS: number }>("rag-chunks-first", "scenario");
    const right = (t: (typeof TURNS)[number]): string => `${t.expect[1]} kg (${t.expect[0]})`;
    const all = (f: (t: (typeof TURNS)[number]) => string): string[][] => [Array.from({ length: SESSIONS }, () => TURNS.map(f)).flat()];
    expect(check(all(right)).pass).toBe(true);
    const neighbour = (t: (typeof TURNS)[number]): string => {
      const other = retrieve(t.part).find((c) => c.id !== t.expect[0])!;
      return `${/(\d+) kg/.exec(other.text)![1]} kg (${other.id})`;
    };
    expect(check(all(neighbour)).pass).toBe(false);
    expect(check(all((t) => `${t.expect[1]} kg`)).pass).toBe(false); // right figure, no chunk id
    expect(check(all((t) => t.expect[0])).pass).toBe(false); // right id, no figure
  });
});

describe("rest: repeat-samples", () => {
  const SAMPLES = 4;
  it("before sends one request per sample; after sends one request with n", async () => {
    const { createApp } = await load<Mod>("repeat-samples", "app");
    const { answerFor, scenario } = await load<Scn>("repeat-samples", "scenario");
    const bodies = async (form: "before" | "after", dialect?: "anthropic.messages") => {
      const sent: Record<string, unknown>[] = [];
      const a = await createApp(form, dialect ? { dialect } : {});
      await a.run(
        {
          send: async (req) => {
            sent.push(req.body as Record<string, unknown>);
            const n = (req.body as { n?: number }).n ?? 1;
            return { body: { choices: Array.from({ length: n }, () => ({ message: { content: answerFor(lastText(req.body)) } })) }, usage: {}, finish: "stop" };
          },
        },
        { sessions: 1, turns: scenario.turns.slice(0, 2) },
      );
      return sent;
    };
    const before = await bodies("before");
    const after = await bodies("after");
    expect(before).toHaveLength(2 * SAMPLES);
    expect(before.every((b) => !("n" in b))).toBe(true);
    expect(after).toHaveLength(2);
    expect(after.every((b) => b.n === SAMPLES)).toBe(true);
    // The same sampling settings, and the same prompt, in both.
    const strip = (b: Record<string, unknown>) => ({ ...b, n: undefined });
    expect(strip(after[0])).toEqual(strip(before[0]));
    expect(before[0].temperature).toBe(0.8);
    // Anthropic has no n: after sends the samples one after another, with the same body as before.
    const anth = await bodies("after", "anthropic.messages");
    expect(anth).toHaveLength(2 * SAMPLES);
    expect(anth.every((b) => !("n" in b))).toBe(true);
    expect(JSON.stringify(anth[0])).toContain("cache_control");
  });

  it("after reads every choice: a vote over the samples decides the answer", async () => {
    const { createApp } = await load<Mod>("repeat-samples", "app");
    const a = await createApp("after");
    const texts = ["Okafor", "Tanaka", "okafor ", "Okafor"];
    const out = await a.run({ send: async () => ({ body: { choices: texts.map((content) => ({ message: { content } })) }, usage: {}, finish: "stop" }) }, { sessions: 1, turns: [{ input: "x" }] });
    expect(out[0].trim()).toBe("Okafor");
  });

  it("after falls back to one request per sample when the model rejects n", async () => {
    const { createApp } = await load<Mod>("repeat-samples", "app");
    const a = await createApp("after");
    let rejected = 0;
    let calls = 0;
    const out = await a.run(
      {
        send: async (req) => {
          if ("n" in (req.body as object)) {
            rejected++;
            throw Object.assign(new Error("HTTP 400"), { status: 400 });
          }
          calls++;
          return { body: { choices: [{ message: { content: "Okafor" } }] }, usage: {}, finish: "stop" };
        },
      },
      { sessions: 1, turns: [{ input: "x" }, { input: "y" }] },
    );
    expect(out).toEqual(["Okafor", "Okafor"]);
    expect(rejected).toBe(1); // asked once, then remembered
    expect(calls).toBe(2 * SAMPLES);
  });

  it("after does not hide other errors", async () => {
    const { createApp } = await load<Mod>("repeat-samples", "app");
    const a = await createApp("after");
    await expect(a.run({ send: async () => { throw Object.assign(new Error("HTTP 500"), { status: 500 }); } }, { sessions: 1, turns: [{ input: "x" }] })).rejects.toThrow("HTTP 500");
  });

  for (const kind of ["openai", "anthropic"] as const) {
    it(`on sim:${kind}: ${kind === "openai" ? "after prefills once per question, and generates the same number of samples" : "after sends the samples one after another, like before"}`, async () => {
      const before = await play("repeat-samples", "before", kind);
      const after = await play("repeat-samples", "after", kind);
      expect(before.result.runs.every((r) => r.calls === 32 * SAMPLES)).toBe(true);
      expect(sum(after.result, "output_tokens")).toBe(sum(before.result, "output_tokens"));
      if (kind === "openai") {
        expect(after.result.runs.every((r) => r.calls === 32)).toBe(true);
        const sent = (r: ResultFile): number => r.runs.reduce((n, x) => n + x.prompt_tokens, 0);
        expect(sent(after.result)).toBeLessThan(sent(before.result) / 2);
      } else {
        expect(after.result.runs.every((r) => r.calls === 32 * SAMPLES)).toBe(true);
      }
    });
  }
});

describe("rest: compaction-rewrite", () => {
  const tools = (b: unknown): string => JSON.stringify((b as { tools?: unknown }).tools);
  const systemOf = (b: unknown): string => JSON.stringify((b as { messages: { role: string; content: unknown }[] }).messages.filter((m) => m.role === "system"));
  const record = async (form: "before" | "after") => {
    const { createApp } = await load<Mod>("compaction-rewrite", "app");
    const { answerFor, scenario } = await load<Scn>("compaction-rewrite", "scenario");
    const sent: { messages: { role: string; content: string }[]; tools?: unknown }[] = [];
    const a = await createApp(form);
    await a.run(
      {
        send: async (req) => {
          sent.push(req.body as (typeof sent)[number]);
          return { body: { choices: [{ message: { content: answerFor(lastText(req.body)) } }] }, usage: {}, finish: "stop" };
        },
      },
      { sessions: 1, turns: scenario.turns },
    );
    return sent;
  };

  it("makes nine calls per session: eight turns and one summarising call", async () => {
    expect(await record("before")).toHaveLength(9);
    expect(await record("after")).toHaveLength(9);
  });

  it("after keeps the system prompt and the tools byte-identical through the compaction; before rewrites the system prompt", async () => {
    const b = await record("before");
    const a = await record("after");
    expect(new Set(a.map(systemOf)).size).toBe(1);
    expect(new Set(a.map(tools)).size).toBe(1);
    expect(new Set(b.map(systemOf)).size).toBeGreaterThan(2); // base, summariser, base plus summary
    // before's main calls keep their tools; only the system prompt is rewritten
    expect(new Set(b.filter((r) => r.tools).map(tools)).size).toBe(1);
  });

  it("after: the summarising call continues the last turn's request, and the summary is a labelled message", async () => {
    const a = await record("after");
    const lastTurn = a[3].messages;
    const summarising = a[4].messages;
    expect(summarising.slice(0, lastTurn.length + 1)).toEqual([...lastTurn, { role: "assistant", content: expect.any(String) }]);
    expect(summarising.at(-1)!.content).toContain("Summarise the conversation so far");
    expect(a[5].messages[1].content.startsWith("Summary of the conversation so far:\n")).toBe(true);
    expect(a[5].messages[1].content).toContain("D-41"); // the summary the model gave is what the next turn reads
  });

  it("before: the summariser has its own system prompt and no tools, and the summary lands in the system prompt", async () => {
    const b = await record("before");
    expect(b[4].messages[0].content).toBe("You are a summariser.");
    expect(b[4].tools).toBeUndefined();
    expect(b[5].messages[0].content).toContain("Summary of the conversation so far:\n");
    expect(b[5].messages[0].content).toContain("D-41");
  });

  it("the post-compaction turns ask for facts only the summary holds", async () => {
    const { scenario, expected } = await load<Scn>("compaction-rewrite", "scenario");
    const early = expected.slice(0, 4).flat().join(" ");
    for (const t of scenario.turns.slice(0, 4)) expect(t.input).not.toMatch(/Which|On which/);
    for (const [i, t] of scenario.turns.slice(4).entries()) {
      expect(t.input).toMatch(/Which|On which/);
      expect(early).toContain(expected[4 + i][0]);
    }
  });

  for (const kind of ["openai", "anthropic"] as const) {
    it(`on sim:${kind}: after has more cached tokens than before and the prompts stay the same size within a fifth`, async () => {
      const before = await play("compaction-rewrite", "before", kind);
      const after = await play("compaction-rewrite", "after", kind);
      expect(before.result.runs.every((r) => r.calls === 36)).toBe(true);
      expect(after.result.runs.every((r) => r.calls === 36)).toBe(true);
      expect(sum(after.result, "cached_tokens")).toBeGreaterThan(sum(before.result, "cached_tokens"));
      const sent = (r: ResultFile): number => r.runs.reduce((n, x) => n + x.prompt_tokens, 0);
      // Uncached = prompt tokens minus cache reads. On Anthropic, cache writes count as uncached here (they bill above the base rate).
      const uncached = (r: ResultFile): number => sent(r) - sum(r, "cached_tokens");
      expect(uncached(after.result)).toBeLessThan(uncached(before.result));
      // after's summarising call carries the head (and reads it from the cache); before's carries only the history.
      expect(Math.abs(sent(after.result) - sent(before.result)) / sent(before.result)).toBeLessThan(0.2);
    });
  }

  it("on sim:openai the summarising call after reads the history; before it reads nothing", async () => {
    const before = await play("compaction-rewrite", "before", "openai");
    const after = await play("compaction-rewrite", "after", "openai");
    const summarising = (u: typeof before.usage) => u.filter((_, i) => i % 9 === 4);
    expect(summarising(before.usage).every((r) => r.cached_tokens === 0)).toBe(true);
    expect(summarising(after.usage).every((r) => r.cached_tokens > 0.9 * r.prompt_tokens)).toBe(true);
  });
});

describe("rest: the README diff is the real diff", () => {
  for (const app of APPS) {
    // diff(1) is not on a stock Windows PATH.
    it.skipIf(process.platform === "win32")(`${app}: the diff block in its README matches diff -U1 of before/app.ts and after/app.ts`, () => {
      const dir = join(ROOT, "examples", app);
      let actual = "";
      try {
        execFileSync("diff", ["-U1", join("before", "app.ts"), join("after", "app.ts")], { cwd: dir, encoding: "utf8" });
      } catch (e) {
        actual = (e as { stdout: string }).stdout; // diff exits 1 when the files differ
      }
      const body = (s: string): string[] => s.split("\n").filter((l) => !/^(---|\+\+\+) /.test(l) && l !== "");
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      const block = /```diff\n([\s\S]*?)```/.exec(readme)?.[1] ?? "";
      expect(block).not.toBe("");
      expect(body(block)).toEqual(body(actual));
      const hunks = (s: string): number => s.split("\n").filter((l) => l.startsWith("@@")).length;
      expect(hunks(block)).toBe(hunks(actual));
      expect(hunks(actual)).toBeGreaterThan(0);
      expect(hunks(actual)).toBeLessThanOrEqual(4);
    });

    it(`${app}: each form stays under 120 lines`, () => {
      for (const form of ["before", "after"]) {
        expect(readFileSync(join(ROOT, "examples", app, form, "app.ts"), "utf8").split("\n").length).toBeLessThan(120);
      }
    });
  }
});

describe("rest: timeout-retry's policy reads what HttpClient puts on its errors", () => {
  const through = async (responses: { status: number; headers?: Record<string, string>; body?: unknown }[]) => {
    const waits: number[] = [];
    let calls = 0;
    const http = new HttpClient({
      provider: "openai",
      model: "m",
      baseUrl: "http://x",
      fetch: (async () => {
        const r = responses[Math.min(calls++, responses.length - 1)];
        return new Response(JSON.stringify(r.body ?? { choices: [{ message: { content: "ITEM-01" } }] }), { status: r.status, headers: r.headers });
      }) as unknown as typeof fetch,
    });
    const { createApp } = await load<Mod>("timeout-retry", "app");
    const a = await createApp("after", { sleep: async (ms) => void waits.push(ms) });
    await a.run(http, { sessions: 1, turns: [{ input: "x" }] });
    return { calls, waits };
  };
  it("waits the Retry-After of a 429, then succeeds", async () => {
    expect(await through([{ status: 429, headers: { "retry-after": "3" } }, { status: 200 }])).toEqual({ calls: 2, waits: [3000] });
  });
  it("stops on a 429 whose error type is an exhausted quota", async () => {
    expect((await through([{ status: 429, body: { error: { type: "insufficient_quota", message: "x" } } }])).calls).toBe(1);
    expect((await through([{ status: 429, body: { error: { code: "insufficient_quota" } } }])).calls).toBe(1);
  });
  it("does not retry a 400", async () => {
    expect((await through([{ status: 400 }])).calls).toBe(1);
  });
});
