import { describe, expect, it } from "vitest";
import { cap, type CacheFacts } from "../../src/facts.js";
import { usageFrom } from "../../src/log/record.js";
import { SimProvider, TimeoutError } from "../../../eval/sim/provider.js";
import { tokensOf } from "../../../eval/sim/tokens.js";

const text = (n: number, c = "a") => c.repeat(n);
const chat = (first: string, second = text(3000, "b")) => ({
  dialect: "openai.chat" as const,
  body: { messages: [{ role: "user", content: first }, { role: "assistant", content: second }, { role: "user", content: "q" }] },
});
const auto: CacheFacts = { mode: "automatic", min_tokens: 1024, step_tokens: 128, ttl_seconds: 300 };
const bp: CacheFacts = { mode: "breakpoints", min_tokens: 1024, max_breakpoints: 4, ttl_seconds: 300 };
const cc = { type: "ephemeral" };
const anth = (mark: boolean) => ({
  dialect: "anthropic.messages" as const,
  body: {
    system: [{ type: "text", text: text(6000), ...(mark ? { cache_control: cc } : {}) }],
    messages: [{ role: "user", content: "hello" }],
  },
});

describe("SimProvider", () => {
  it("openai: an equal repeat reads the capped shared prefix; a changed first message reads 0", async () => {
    const sim = new SimProvider({ kind: "openai", facts: auto });
    const a = await sim.send(chat(text(3000)));
    expect(usageFrom("openai", a.usage).cached_tokens).toBe(0);
    const b = await sim.send(chat(text(3000)));
    const u = usageFrom("openai", b.usage);
    expect(u.cached_tokens).toBe(cap(auto, u.prompt_tokens));
    expect(u.cached_tokens).toBeGreaterThan(0);
    const c = await sim.send(chat(text(3000, "z")));
    expect(usageFrom("openai", c.usage).cached_tokens).toBe(0);
  });

  it("openai: a shared prefix with a new tail caches only the shared part", async () => {
    const sim = new SimProvider({ kind: "openai", facts: auto });
    await sim.send(chat(text(6000)));
    const u = usageFrom("openai", (await sim.send(chat(text(6000), text(3000, "c")))).usage);
    // Only message 0 is shared: about 6000 chars, less than the whole prompt.
    expect(u.cached_tokens).toBeGreaterThan(0);
    expect(u.cached_tokens).toBeLessThanOrEqual(tokensOf(6100));
  });

  it("anthropic: without cache_control nothing is read; with a mark on the last system block a repeat reads the head", async () => {
    const sim = new SimProvider({ kind: "anthropic", facts: bp });
    await sim.send(anth(false));
    const none = usageFrom("anthropic", (await sim.send(anth(false))).usage);
    expect(none.cached_tokens).toBe(0);
    expect(none.cache_write_tokens).toBe(0);

    const first = usageFrom("anthropic", (await sim.send(anth(true))).usage);
    expect(first.cached_tokens).toBe(0);
    expect(first.cache_write_tokens).toBeGreaterThan(1024);
    const again = usageFrom("anthropic", (await sim.send(anth(true))).usage);
    expect(again.cached_tokens).toBe(first.cache_write_tokens);
    expect(again.cache_write_tokens).toBe(0);
    expect(again.prompt_tokens).toBe(first.prompt_tokens);
  });

  it("anthropic: an unmarked request reads nothing even after a marked one stored the head", async () => {
    const sim = new SimProvider({ kind: "anthropic", facts: bp });
    await sim.send(anth(true));
    expect(usageFrom("anthropic", (await sim.send(anth(true))).usage).cached_tokens).toBeGreaterThan(0);
    const u = usageFrom("anthropic", (await sim.send(anth(false))).usage);
    expect(u.cached_tokens).toBe(0);
    expect(u.cache_write_tokens).toBe(0);
  });

  it("anthropic: a mark earlier than a cached deeper node stops the read at the mark", async () => {
    const sim = new SimProvider({ kind: "anthropic", facts: bp });
    const body = (markMsg: boolean) => ({
      dialect: "anthropic.messages" as const,
      body: {
        system: [{ type: "text", text: text(6000), cache_control: cc }],
        messages: [
          { role: "user", content: [{ type: "text", text: text(6000, "m"), ...(markMsg ? { cache_control: cc } : {}) }] },
          { role: "assistant", content: "ok" },
          { role: "user", content: "next" },
        ],
      },
    });
    const deep = usageFrom("anthropic", (await sim.send(body(true))).usage);
    const head = usageFrom("anthropic", (await sim.send(body(false))).usage);
    const again = usageFrom("anthropic", (await sim.send(body(true))).usage);
    expect(head.cached_tokens).toBeGreaterThan(0);
    expect(head.cached_tokens).toBeLessThan(deep.cache_write_tokens);
    expect(again.cached_tokens).toBe(deep.cache_write_tokens);
  });

  it("vllm: cached tokens come in multiples of the block, with the last block dropped", async () => {
    const facts: CacheFacts = { mode: "block", min_tokens: 0, block_tokens: 1584, drops_last_block: true, ttl_seconds: 300 };
    const sim = new SimProvider({ kind: "vllm", facts });
    const req = chat(text(20000));
    await sim.send(req);
    const u = usageFrom("vllm", (await sim.send(req)).usage);
    expect(u.cached_tokens % 1584).toBe(0);
    expect(u.cached_tokens).toBeGreaterThan(0);
    expect(u.cached_tokens).toBe((Math.floor(u.prompt_tokens / 1584) - 1) * 1584);
  });

  it("rejects with TimeoutError after counting usage, and the retry then reads the cache", async () => {
    const sim = new SimProvider({
      kind: "openai",
      facts: auto,
      reply: () => ({ text: "x", output_tokens: 100 }),
      msPerOutputToken: 10,
    });
    const err = await sim.send({ ...chat(text(3000)), timeoutMs: 500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(usageFrom("openai", (err as TimeoutError).usage).output_tokens).toBe(100);
    const ok = await sim.send({ ...chat(text(3000)), timeoutMs: 1000 });
    expect(usageFrom("openai", ok.usage).cached_tokens).toBeGreaterThan(0);
  });

  it("the cache expires after ttl_seconds on the injected clock", async () => {
    let t = 0;
    const sim = new SimProvider({ kind: "openai", facts: auto, now: () => t });
    await sim.send(chat(text(3000)));
    t = 299_000;
    expect(usageFrom("openai", (await sim.send(chat(text(3000)))).usage).cached_tokens).toBeGreaterThan(0);
    t = 299_000 + 301_000;
    expect(usageFrom("openai", (await sim.send(chat(text(3000)))).usage).cached_tokens).toBe(0);
  });
});
