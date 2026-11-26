import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEval, type EvalDeps } from "../../../eval/run.js";
import { HttpClient } from "../../../eval/http.js";
import { parseUsageLog } from "../../src/log/record.js";
import type { LlmClient } from "../../../eval/client.js";
import type { ExampleApp } from "../../../examples/types.js";

const SECRET = "ZEBRA-QUARTZ-needle-" + "x".repeat(40);
const PRICES = fileURLToPath(new URL("../fixtures/prices.yaml", import.meta.url));

function toy(check = true): ExampleApp {
  const build = (input: string) => ({
    dialect: "openai.chat" as const,
    body: { messages: [{ role: "system", content: "s".repeat(5000) }, { role: "user", content: input }] },
  });
  return {
    name: "toy",
    dialect: "openai.chat",
    scenario: { sessions: 1, turns: [{ input: SECRET }, { input: SECRET + "2" }] },
    buildRequest: (input) => build(input),
    async run(client, scenario) {
      const out: string[] = [];
      for (let s = 0; s < scenario.sessions; s++) {
        for (const t of scenario.turns) {
          const r = await client.send(build(t.input));
          out.push(JSON.stringify(r.body).length > 0 ? "ok" : "");
        }
      }
      return out;
    },
    ...(check ? { check: () => ({ pass: true, detail: "fine" }) } : {}),
  };
}

const deps = (o: Partial<EvalDeps> = {}): EvalDeps => {
  const outDir = mkdtempSync(join(tmpdir(), "lp-eval-"));
  return { outDir, root: join(import.meta.dirname, "..", "..", ".."), pricesPath: PRICES, loadApp: async () => toy(), now: () => new Date("2026-11-26T00:00:00Z"), ...o };
};

const allText = (dir: string): string =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"))
    .join("\n");

describe("replay harness", () => {
  it("sim run twice: simulated ResultFile, answer_check skipped, no prompt text on disk", async () => {
    const d = deps();
    const r = await runEval({ app: "toy", form: "before", target: "sim:openai", runs: 2, budgetUsd: 1 }, d);
    expect(r).toMatchObject({ v: 1, kind: "simulated", app: "toy", form: "before", provider: "openai", date: "2026-11-26" });
    expect(r.runs).toHaveLength(2);
    expect(r.runs.every((x) => x.answer_check === "skipped" && x.calls === 2)).toBe(true);
    expect(r.runs[0].cached_tokens).toBeGreaterThan(0); // the second turn reads the shared system head
    expect(r.runs[1].cached_tokens).toBeGreaterThan(r.runs[0].cached_tokens); // the sim cache carries across runs
    expect(existsSync(join(d.outDir!, "2026-11-26-toy-before-openai-sim.json"))).toBe(true);
    const text = allText(d.outDir!);
    expect(text).not.toContain("ZEBRA");
    expect(text).not.toContain("needle");
    const log = readdirSync(join(d.outDir!, "usage")).sort();
    expect(log).toHaveLength(2);
    expect(parseUsageLog(readFileSync(join(d.outDir!, "usage", log[0]), "utf8")).records).toHaveLength(2);
  });

  it("stops after the call that crossed the budget: 3 calls at $0.40, budget $1", async () => {
    const client: LlmClient = {
      send: async () => ({ body: {}, usage: { prompt_tokens: 1_000_000, completion_tokens: 0 }, finish: "stop" }),
    };
    const d = deps({ client });
    const r = await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 5, budgetUsd: 1 }, d);
    expect(r.kind).toBe("measured");
    expect(r.error).toBe("budget reached after 3 calls");
    expect(r.spend_usd).toBeCloseTo(1.2, 6);
    expect(r.spend_usd).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(r.runs.reduce((a, x) => a + x.calls, 0)).toBe(3);
    expect(r.runs).toHaveLength(2);
    expect(allText(d.outDir!)).not.toContain("ZEBRA");
  });

  it("stops before a call whose own input already exceeds the budget", async () => {
    let sent = 0;
    const client: LlmClient = { send: async () => (sent++, { body: {}, usage: { prompt_tokens: 10, completion_tokens: 1 }, finish: "stop" }) };
    const r = await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 1, budgetUsd: 0.0001 }, deps({ client }));
    expect(sent).toBe(0);
    expect(r.error).toBe("budget reached after 0 calls");
  });

  it("concurrent sends cannot overshoot: 5 parallel sends at $0.40, budget $1 stop at 3 calls", async () => {
    const client: LlmClient = {
      send: async () => (await new Promise((r) => setTimeout(r, 5)), { body: {}, usage: { prompt_tokens: 1_000_000, completion_tokens: 0 }, finish: "stop" }),
    };
    const app: ExampleApp = {
      ...toy(),
      run: async (c) => {
        const req = toy().buildRequest("hi", { session: 0, turn: 0, now: new Date(0) });
        const r = await Promise.allSettled(Array.from({ length: 5 }, () => c.send(req)));
        return r.map(() => "a");
      },
    };
    const r = await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 1, budgetUsd: 1 }, deps({ client, loadApp: async () => app }));
    expect(r.runs[0].calls).toBe(3);
    expect(r.spend_usd).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(r.error).toBe("budget reached after 3 calls");
  });

  it("failed calls without usage are counted and charged; 5 consecutive failures stop the run", async () => {
    let sent = 0;
    const client: LlmClient = { send: async () => (sent++, Promise.reject(new Error("HTTP 503"))) };
    const app: ExampleApp = {
      ...toy(),
      run: async (c) => {
        const req = toy().buildRequest("hi", { session: 0, turn: 0, now: new Date(0) });
        for (;;) {
          try {
            await c.send(req); // a retry loop that never gives up
          } catch (e) {
            if ((e as Error).message.startsWith("stopped")) throw e;
          }
        }
      },
    };
    const r = await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 3, budgetUsd: 1 }, deps({ client, loadApp: async () => app }));
    expect(sent).toBe(5);
    expect(r.error).toBe("stopped after 5 consecutive failed calls");
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].calls).toBe(5);
    expect(r.runs[0].prompt_tokens).toBeGreaterThan(0);
    expect(r.spend_usd).toBeGreaterThan(0);
  });

  it("a max_tokens finish counts as length for retry detection", async () => {
    let n = 0;
    const client: LlmClient = { send: async () => ({ body: {}, usage: { input_tokens: 10, output_tokens: 1 }, finish: n++ === 0 ? "max_tokens" : "end_turn" }) };
    const app: ExampleApp = {
      ...toy(),
      dialect: "anthropic.messages",
      run: async (c) => {
        const req = { dialect: "anthropic.messages" as const, body: { messages: [{ role: "user", content: "hi" }] } };
        await c.send(req);
        await c.send(req);
        return ["a"];
      },
    };
    const d = deps({ client, loadApp: async () => app });
    await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 1, budgetUsd: 1 }, d);
    const f = readdirSync(join(d.outDir!, "usage"))[0];
    const recs = parseUsageLog(readFileSync(join(d.outDir!, "usage", f), "utf8")).records;
    expect(recs.map((r) => r.flags)).toEqual([{}, { retry_of: 0 }]);
  });

  it("measured runs run the app's check", async () => {
    const client: LlmClient = { send: async () => ({ body: {}, usage: { prompt_tokens: 10, completion_tokens: 1 }, finish: "stop" }) };
    const r = await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 1, budgetUsd: 1 }, deps({ client }));
    expect(r.runs[0].answer_check).toBe("pass");
    expect(r.error).toBeUndefined();
  });

  it("refuses a model missing from the price card, and a measured run without a check", async () => {
    const target = { provider: "testprov", model: "nope", baseUrl: "http://x" };
    await expect(runEval({ app: "toy", form: "after", target, runs: 1, budgetUsd: 1 }, deps())).rejects.toThrow(/no price card entry for testprov\/nope/);
    await expect(
      runEval({ app: "toy", form: "after", target: { ...target, model: "test-model" }, runs: 1, budgetUsd: 1 }, deps({ loadApp: async () => toy(false) })),
    ).rejects.toThrow(/no check/);
  });

  it("an identical request right after a length-truncated call is logged as its retry", async () => {
    let n = 0;
    const client: LlmClient = { send: async () => ({ body: {}, usage: { prompt_tokens: 10, completion_tokens: 1 }, finish: n++ === 0 ? "length" : "stop" }) };
    const app: ExampleApp = {
      ...toy(),
      run: async (c) => {
        const req = toy().buildRequest("hi", { session: 0, turn: 0, now: new Date(0) });
        await c.send(req);
        await c.send(req);
        return ["a"];
      },
    };
    const d = deps({ client, loadApp: async () => app });
    await runEval({ app: "toy", form: "after", target: { provider: "testprov", model: "test-model", baseUrl: "http://x" }, runs: 1, budgetUsd: 1 }, d);
    const f = readdirSync(join(d.outDir!, "usage"))[0];
    const recs = parseUsageLog(readFileSync(join(d.outDir!, "usage", f), "utf8")).records;
    expect(recs.map((r) => r.flags)).toEqual([{}, { retry_of: 0 }]);
  });
});

describe("HttpClient", () => {
  const fake = (reply: unknown, status = 200) => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(JSON.stringify(reply), { status }))) as unknown as typeof fetch;
    return { seen, f };
  };

  it("OpenAI-compatible: bearer key, model set by the client, usage and finish read", async () => {
    const { seen, f } = fake({ choices: [{ finish_reason: "length", message: { content: "x" } }], usage: { prompt_tokens: 3 } });
    const c = new HttpClient({ provider: "openai", model: "m1", baseUrl: "https://h/v1/", apiKey: "k", fetch: f });
    const r = await c.send({ dialect: "openai.chat", body: { model: "other", messages: [] } });
    expect(seen[0].url).toBe("https://h/v1/chat/completions");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(seen[0].init.body as string).model).toBe("m1");
    expect(r).toMatchObject({ usage: { prompt_tokens: 3 }, finish: "length" });
  });

  it("Anthropic Messages: x-api-key and stop_reason", async () => {
    const { seen, f } = fake({ content: [], stop_reason: "end_turn", usage: { input_tokens: 1 } });
    const c = new HttpClient({ provider: "anthropic", model: "m", baseUrl: "https://a/v1", apiKey: "k", fetch: f });
    const r = await c.send({ dialect: "anthropic.messages", body: { messages: [] } });
    expect(seen[0].url).toBe("https://a/v1/messages");
    expect((seen[0].init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(r.finish).toBe("end_turn");
  });

  it("a non-JSON body gives a status-only error", async () => {
    const f = (async () => new Response(SECRET, { status: 200 })) as unknown as typeof fetch;
    const c = new HttpClient({ provider: "openai", model: "m", baseUrl: "https://h/v1", fetch: f });
    const e = await c.send({ dialect: "openai.chat", body: {} }).catch((x: Error) => x);
    expect((e as Error).message).toBe("openai response was not JSON: HTTP 200");
  });

  it("an HTTP error carries the status and not the body", async () => {
    const { f } = fake({ error: SECRET }, 429);
    const c = new HttpClient({ provider: "openai", model: "m", baseUrl: "https://h/v1", fetch: f });
    await expect(c.send({ dialect: "openai.chat", body: {} })).rejects.toThrow("HTTP 429");
    await expect(c.send({ dialect: "openai.chat", body: {} })).rejects.not.toThrow(/ZEBRA/);
  });
});
