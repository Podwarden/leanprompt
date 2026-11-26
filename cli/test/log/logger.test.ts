import { appendFileSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_KEY } from "@kvsig/core";
import { describe, expect, it } from "vitest";
import { createLogger, paramsHash } from "../../src/log/logger.js";
import { parseUsageLog, usageFrom } from "../../src/log/record.js";

const fx = (n: string): any => JSON.parse(readFileSync(new URL(`../fixtures/bodies/${n}.json`, import.meta.url), "utf8"));

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "lp-log-")), ".leanprompt", "usage.jsonl");
  const logger = createLogger({ path, key: TEST_KEY, provider: "openai", model: "gpt-x" });
  const read = () => parseUsageLog(readFileSync(path, "utf8")).records;
  return { path, logger, read };
}

// A path whose parent is a regular file, so mkdir and append fail on every OS.
function unwritable(): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-log-"));
  const file = join(dir, "file");
  writeFileSync(file, "x");
  return join(file, "x", "usage.jsonl");
}

describe("usage logger", () => {
  it("OpenAI chat body: one node per message, node_chars strictly increasing", async () => {
    const { logger, read } = setup();
    const body = fx("openai-chat");
    logger.log({ dialect: "openai.chat", body }, { usage: { prompt_tokens: 50, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 20 } }, finish: "stop" });
    await logger.flush();
    const [r] = read();
    expect(r.v).toBe(1);
    expect(r.ids!.nodes.length).toBe(body.messages.filter((m: any) => m.role !== "system").length);
    const nc = r.node_chars!;
    expect(nc.length).toBe(r.ids!.nodes.length);
    for (let i = 1; i < nc.length; i++) expect(nc[i]).toBeGreaterThan(nc[i - 1]);
    expect(r).toMatchObject({ provider: "openai", model: "gpt-x", dialect: "openai.chat", prompt_tokens: 50, cached_tokens: 20, output_tokens: 5, finish: "stop", flags: {} });
  });

  it("Anthropic usage sums input and cache counters", () => {
    expect(usageFrom("anthropic", { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 7 })).toEqual({
      prompt_tokens: 1000,
      cached_tokens: 900,
      cache_write_tokens: 0,
      output_tokens: 7,
    });
    expect(usageFrom("anthropic", { input_tokens: 10, cache_creation_input_tokens: 90 }).cache_write_tokens).toBe(90);
    // Anthropic-shaped usage under another provider key (Bedrock, a proxy)
    expect(usageFrom("my-proxy", { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 1 })).toMatchObject({ prompt_tokens: 1000, cached_tokens: 900 });
    expect(usageFrom("openrouter", { input_tokens: 10, cache_creation_input_tokens: 90 })).toMatchObject({ prompt_tokens: 100, cache_write_tokens: 90 });
    expect(usageFrom("openai", null)).toEqual({ prompt_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
  });

  it("Vercel AI SDK camelCase usage is read (v4 promptTokens, v5 inputTokens, v6 inputTokenDetails)", () => {
    // AI SDK 4: { promptTokens, completionTokens, totalTokens }
    expect(usageFrom("openai", { promptTokens: 1200, completionTokens: 30, totalTokens: 1230 })).toEqual({
      prompt_tokens: 1200, cached_tokens: 0, cache_write_tokens: 0, output_tokens: 30,
    });
    // AI SDK 5: { inputTokens, outputTokens, totalTokens, cachedInputTokens } (OpenAI: inputTokens includes the cached part)
    expect(usageFrom("openai", { inputTokens: 2000, outputTokens: 40, totalTokens: 2040, cachedInputTokens: 1536 })).toEqual({
      prompt_tokens: 2000, cached_tokens: 1536, cache_write_tokens: 0, output_tokens: 40,
    });
    // AI SDK 5 with Anthropic: inputTokens excludes the cache read
    expect(usageFrom("anthropic", { inputTokens: 100, outputTokens: 7, cachedInputTokens: 900 })).toMatchObject({
      prompt_tokens: 1000, cached_tokens: 900, output_tokens: 7,
    });
    // AI SDK 6: inputTokens is the total, the split is in inputTokenDetails
    expect(usageFrom("anthropic", {
      inputTokens: 1100, outputTokens: 9,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 100 },
    })).toEqual({ prompt_tokens: 1100, cached_tokens: 900, cache_write_tokens: 100, output_tokens: 9 });
  });

  it('dialect "other" still writes a record with null ids', async () => {
    const { logger, read } = setup();
    logger.log({ dialect: "other", body: fx("gemini") }, { usage: { prompt_tokens: 3 } });
    await logger.flush();
    const [r] = read();
    expect(r.ids).toBeNull();
    expect(r.node_chars).toBeNull();
    expect(r.prompt_tokens).toBe(3);
  });

  it("a body kvsig cannot read gets null ids and does not throw", async () => {
    const { logger, read } = setup();
    expect(() => logger.log({ dialect: "openai.chat", body: "{not json" }, { usage: {} })).not.toThrow();
    expect(() => logger.log({ dialect: "openai.chat", body: null }, { usage: {} })).not.toThrow();
    await logger.flush();
    expect(read().map((r) => r.ids)).toEqual([null, null]);
  });

  it("never writes prompt text", async () => {
    const { path, logger } = setup();
    logger.log({ dialect: "openai.chat", body: fx("openai-chat"), params: { note: "x" } }, { usage: {} });
    logger.log({ dialect: "other", body: fx("gemini") }, { usage: {} });
    await logger.flush();
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("Paris");
  });

  it("never throws on an unwritable path, at log() or at flush()", async () => {
    const logger = createLogger({ path: unwritable(), key: TEST_KEY, provider: "openai", model: "m" });
    expect(() => logger.log({ dialect: "other", body: {} }, { usage: {} })).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  it("params hash: equal for equal params, order-insensitive, differs when temperature changes", async () => {
    const { logger, read } = setup();
    const call = (params: Record<string, unknown>) => logger.log({ dialect: "other", body: {}, params }, { usage: {} });
    call({ temperature: 0.2, top_p: 1 });
    call({ top_p: 1, temperature: 0.2 });
    call({ temperature: 0.7, top_p: 1 });
    await logger.flush();
    const [a, b, c] = read().map((r) => r.params);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("flags, finish mapping and breakpoints are recorded", async () => {
    const { logger, read } = setup();
    logger.log({ dialect: "other", body: {}, breakpoints: [2, 5] }, { usage: {}, finish: "tool_calls" }, { retry_of: 3, parse_failed: true });
    await logger.flush();
    expect(read()[0]).toMatchObject({ finish: "tool", breakpoints: [2, 5], flags: { retry_of: 3, parse_failed: true } });
  });
});

describe("non-blocking writes", () => {
  it("log() returns its index before anything is on disk, and flush() drains the queue", async () => {
    const { path, logger } = setup();
    const idx = logger.log({ dialect: "other", body: {} }, { usage: {} });
    expect(idx).toBe(0);
    expect(existsSync(path)).toBe(false);
    await logger.flush();
    expect(parseUsageLog(readFileSync(path, "utf8")).records.length).toBe(1);
  });

  it("1,000 records are appended in call order", async () => {
    const { path, logger } = setup();
    for (let i = 0; i < 1000; i++) expect(logger.log({ dialect: "other", body: {} }, { usage: { prompt_tokens: i } })).toBe(i);
    await logger.flush();
    const { records, bad } = parseUsageLog(readFileSync(path, "utf8"));
    expect(bad).toBe(0);
    expect(records.map((r) => r.prompt_tokens)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
  });

  it("records logged while a write is in flight, and after a flush, keep their order", async () => {
    const { path, logger } = setup();
    logger.log({ dialect: "other", body: {} }, { usage: { prompt_tokens: 0 } });
    const f = logger.flush();
    logger.log({ dialect: "other", body: {} }, { usage: { prompt_tokens: 1 } });
    await f;
    logger.log({ dialect: "other", body: {} }, { usage: { prompt_tokens: 2 } });
    await logger.flush();
    expect(parseUsageLog(readFileSync(path, "utf8")).records.map((r) => r.prompt_tokens)).toEqual([0, 1, 2]);
  });

  it("a failed write is dropped without throwing; a later good logger on a good path still works", async () => {
    const bad = createLogger({ path: unwritable(), key: TEST_KEY, provider: "openai", model: "m" });
    for (let i = 0; i < 3; i++) bad.log({ dialect: "other", body: {} }, { usage: {} });
    await expect(bad.flush()).resolves.toBeUndefined();
    const { logger, read } = setup();
    logger.log({ dialect: "other", body: {} }, { usage: {} });
    await logger.flush();
    expect(read().length).toBe(1);
  });
});

describe("parseUsageLog", () => {
  it("skips a malformed line and counts it", async () => {
    const { logger, path } = setup();
    logger.log({ dialect: "other", body: {} }, { usage: {} });
    await logger.flush();
    const text = readFileSync(path, "utf8") + "{truncated\n" + '{"v":2}\n\n';
    const { records, bad } = parseUsageLog(text);
    expect(records.length).toBe(1);
    expect(bad).toBe(2);
    expect(existsSync(path)).toBe(true);
  });
});

describe("cross-language agreement (the same fixture is asserted in python/tests/test_log.py)", () => {
  it("ids, node_chars and params match the pinned values", async () => {
    const x = fx("cross");
    const { logger, read } = setup();
    logger.log({ dialect: x.dialect, body: x.body, params: x.params }, { usage: {} });
    await logger.flush();
    const [r] = read();
    expect(r.ids).toEqual(x.expected.ids);
    expect(r.node_chars).toEqual(x.expected.node_chars);
    expect(r.params).toBe(x.expected.params);
    expect(paramsHash(TEST_KEY, x.params)).toBe(x.expected.params);
  });

  it("raw 32 key bytes are wrapped as epoch 1 and pin the same ids as the Python logger", async () => {
    const x = fx("cross");
    const path = join(mkdtempSync(join(tmpdir(), "lp-log-")), "usage.jsonl");
    const raw = Uint8Array.from({ length: 32 }, (_, i) => i);
    const rawLogger = createLogger({ path, key: raw, provider: "openai", model: "m" });
    rawLogger.log({ dialect: x.dialect, body: x.body, params: x.params }, { usage: {} });
    await rawLogger.flush();
    const [r] = parseUsageLog(readFileSync(path, "utf8")).records;
    expect(r.ids).toEqual(x.expected_raw_key.ids);
    expect(r.ids!.head.startsWith("01")).toBe(true);
    expect(r.params).toBe(x.expected.params);
  });

  it("log returns the record's index among valid records, continuing an existing file", async () => {
    const { path, logger } = setup();
    expect(logger.log({ dialect: "other", body: {} }, { usage: {} })).toBe(0);
    expect(logger.log({ dialect: "other", body: {} }, { usage: {} }, { retry_of: 0 })).toBe(1);
    // A new logger on the same file, with a torn line in it, counts only valid records.
    await logger.flush();
    appendFileSync(path, "{truncated\n");
    const again = createLogger({ path, key: TEST_KEY, provider: "openai", model: "gpt-x" });
    expect(again.log({ dialect: "other", body: {} }, { usage: {} })).toBe(2);
    await again.flush();
    expect(parseUsageLog(readFileSync(path, "utf8")).records.length).toBe(3);
  });

  it("log returns null when no record could be built", () => {
    const logger = createLogger({ path: join(tmpdir(), "unused.jsonl"), key: TEST_KEY, provider: "openai", model: "m" });
    const hostile = { get usage(): never { throw new Error("boom"); } };
    expect(logger.log({ dialect: "other", body: {} }, hostile as never)).toBeNull();
  });
});
