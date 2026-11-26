import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEval, type ResultFile } from "../../../eval/run.js";
import { SimProvider } from "../../../eval/sim/provider.js";
import { loadCacheFacts } from "../../src/facts.js";
import { parseUsageLog } from "../../src/log/record.js";
import { dialectFor, stepClock } from "../../../examples/common.js";
import { isLong } from "../../../examples/timeout-retry/data.js";
import type { CreateApp } from "../../../examples/types.js";
import { exampleDiff } from "../../../scripts/unified-diff.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const APPS = ["dated-chat", "dict-tools-agent", "timeout-retry"] as const;
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

describe("demo set: scenarios", () => {
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

describe("demo set: prefill apps cache more after the fix", () => {
  for (const app of ["dated-chat", "dict-tools-agent"]) {
    for (const kind of ["openai", "anthropic"] as const) {
      it(`${app} on sim:${kind}: after has more cached tokens than before`, async () => {
        const before = await play(app, "before", kind);
        const after = await play(app, "after", kind);
        expect(before.result.runs.every((r) => r.calls >= 32)).toBe(true);
        expect(sum(after.result, "cached_tokens")).toBeGreaterThan(sum(before.result, "cached_tokens"));
        // Same prompts overall: the fix does not change how much is sent, within a block of a few tokens per call.
        const sent = (r: ResultFile): number => r.runs.reduce((n, x) => n + x.prompt_tokens, 0);
        expect(Math.abs(sent(after.result) - sent(before.result)) / sent(before.result)).toBeLessThan(0.02);
      });
    }
  }

  it("dated-chat before reuses nothing: every call opens with a new time", async () => {
    const before = await play("dated-chat", "before", "openai");
    expect(sum(before.result, "cached_tokens")).toBe(0);
  });

  it("dict-tools-agent before reuses the head only inside a session; after also across sessions", async () => {
    const before = await play("dict-tools-agent", "before", "openai");
    const after = await play("dict-tools-agent", "after", "openai");
    const firstOfSession = (u: typeof before.usage) => u.filter((_, i) => i % 8 === 0).map((r) => r.cached_tokens);
    expect(firstOfSession(before.usage).every((c) => c === 0)).toBe(true);
    // The first session of the first run is the only cold start after the fix.
    expect(firstOfSession(after.usage).filter((c) => c > 0).length).toBeGreaterThanOrEqual(after.usage.length / 8 - 1);
  });
});

describe("demo set: dated-chat keeps the date and time available", () => {
  const now = new Date("2026-11-26T09:00:12Z");
  const text = (b: unknown) => JSON.stringify(b);
  it("before puts the time on line 1 of the system prompt; after puts it in a labelled block in the newest user message", async () => {
    const { createApp } = await load<Mod>("dated-chat", "app");
    const ctx = { session: 0, turn: 0, now };
    const b = (await createApp("before")).buildRequest("hi", ctx).body as { messages: { role: string; content: string }[] };
    const a = (await createApp("after")).buildRequest("hi", ctx).body as { messages: { role: string; content: string }[] };
    expect(b.messages[0].content.split("\n")[0]).toBe("Current time: 2026-11-26T09:00:12Z");
    expect(a.messages[0].content).not.toContain("2026-11");
    expect(a.messages[1].content).toBe("<environment>\nCurrent time: 2026-11-26T09:00:12Z\n</environment>\n\nhi");
    expect(text(b)).toContain("2026-11-26T09:00:12Z");
    expect(text(a)).toContain("2026-11-26T09:00:12Z");
  });
  it("a date-dependent turn closes every session, and its check word is a date", async () => {
    const { scenario, expected } = await load<Scn>("dated-chat", "scenario");
    expect(scenario.turns.at(-1)!.input).toContain("today");
    expect(expected.at(-1)).toEqual(["2026-12-31"]);
  });
});

describe("demo set: timeout-retry", () => {
  // A long answer is 2,000 tokens and takes 40 s: over 2 s, under the fix's timeout. A short one takes 0.4 s.
  const sim = { msPerOutputToken: 20, outputTokens: (input: string) => (isLong(input) ? 2000 : 20) };

  for (const kind of ["openai", "anthropic"] as const) {
    it(`on sim:${kind}: after has fewer output tokens than before and no retries`, async () => {
      const before = await play("timeout-retry", "before", kind, sim);
      const after = await play("timeout-retry", "after", kind, sim);
      expect(sum(after.result, "output_tokens")).toBeLessThan(sum(before.result, "output_tokens"));
      expect(after.result.runs.every((r) => r.calls === 32)).toBe(true); // one call per turn
      expect(before.result.runs.every((r) => r.calls === 16 + 16 * 3)).toBe(true); // each long answer is sent three times
      expect(before.result.error).toBeUndefined();
      expect(before.usage.some((r) => r.flags.retry_of !== undefined)).toBe(true);
      expect(after.usage.some((r) => r.flags.retry_of !== undefined)).toBe(false);
      expect(after.usage.every((r) => r.finish === "stop")).toBe(true);
      expect(before.usage.filter((r) => r.finish === "error")).toHaveLength(96); // two runs of 16 long answers x 3 attempts: every attempt at a long answer timed out
    });
  }

  it("runEval on sim:openai with the app's own sim settings: after has fewer output tokens than before", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "lp-demo-"));
    const go = (form: "before" | "after") => runEval({ app: "timeout-retry", form, target: "sim:openai", runs: 2, budgetUsd: 1 }, { root: ROOT, outDir });
    const before = await go("before");
    const after = await go("after");
    expect(sum(after, "output_tokens")).toBeLessThan(sum(before, "output_tokens"));
    expect(sum(after, "calls")).toBeLessThan(sum(before, "calls"));
  });

  describe("after's retry policy", () => {
    const fail = (status: number, extra: object = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
    const run = async (errs: Error[]) => {
      const waits: number[] = [];
      let calls = 0;
      const { createApp } = await load<Mod>("timeout-retry", "app");
      const a = await createApp("after", { sleep: async (ms) => void waits.push(ms) });
      await a.run(
        {
          send: async () => {
            if (calls < errs.length) throw errs[calls++];
            calls++;
            return { body: { choices: [{ message: { content: "ITEM-01" } }] }, usage: {}, finish: "stop" };
          },
        },
        { sessions: 1, turns: [{ input: "x" }] },
      );
      return { calls, waits };
    };

    it("retries 429, 409 and 503 with growing waits, and stops after three attempts", async () => {
      expect(await run([fail(429)])).toEqual({ calls: 2, waits: [1000] });
      expect(await run([fail(409)])).toEqual({ calls: 2, waits: [1000] });
      expect(await run([fail(503), fail(503)])).toEqual({ calls: 3, waits: [1000, 2000] });
      expect((await run([fail(503), fail(503), fail(503)])).calls).toBe(3);
    });
    it("honours Retry-After", async () => {
      expect(await run([fail(429, { retryAfter: 7 })])).toEqual({ calls: 2, waits: [7000] });
      expect((await run([fail(429, { retryAfter: 9999 })])).waits).toEqual([30_000]);
    });
    it("does not retry a 400, a 502, an abort or a quota 429", async () => {
      expect((await run([fail(400)])).calls).toBe(1);
      expect((await run([fail(502)])).calls).toBe(1);
      expect((await run([new Error("The operation was aborted")])).calls).toBe(1);
      expect((await run([fail(429, { type: "insufficient_quota" })])).calls).toBe(1);
      expect((await run([Object.assign(new Error("HTTP 429: you exceeded your current quota"), {})])).calls).toBe(1);
    });
  });
});

describe("demo set: the README diff is the real diff", () => {
  for (const app of APPS) {
    it(`${app}: the diff block in its README is the diff of before/app.ts and after/app.ts`, () => {
      const dir = join(ROOT, "examples", app);
      const actual = exampleDiff(dir);
      const body = (s: string): string[] => s.split("\n").filter((l) => !/^(---|\+\+\+) /.test(l) && l !== "");
      const readme = readFileSync(join(dir, "README.md"), "utf8").replace(/\r\n/g, "\n");
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
