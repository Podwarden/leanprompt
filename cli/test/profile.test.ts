import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCacheFacts } from "../src/facts.js";
import { effectiveFacts, loadProfile, parseProfile, targetKey } from "../src/profile.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const facts = loadCacheFacts(REPO);

describe("parseProfile priority", () => {
  it("normalizes a shorthand string", () => {
    expect(parseProfile("priority: speed").profile?.priority).toEqual({ cost: 0, speed: 1, quality: 0 });
    expect(parseProfile("priority: cost").profile?.priority).toEqual({ cost: 1, speed: 0, quality: 0 });
  });
  it("keeps a weights object", () => {
    const r = parseProfile("priority: {cost: 0.5, speed: 0.3, quality: 0.2}");
    expect(r.errors).toEqual([]);
    expect(r.profile?.priority).toEqual({ cost: 0.5, speed: 0.3, quality: 0.2 });
  });
  it("rejects weights that do not sum to 1 (+-0.01)", () => {
    expect(parseProfile("priority: {cost: 0.5, speed: 0.5, quality: 0.5}").errors).toContain("priority weights must sum to 1");
    expect(parseProfile("priority: {cost: 0.5, speed: 0.3, quality: 0.205}").errors).toEqual([]);
  });
  it("rejects bad shorthand, missing or negative weights", () => {
    expect(parseProfile("priority: fast").errors).toHaveLength(1);
    expect(parseProfile("priority: {cost: 1}").errors.length).toBeGreaterThan(0);
    expect(parseProfile("priority: {cost: 1.5, speed: -0.5, quality: 0}").errors.length).toBeGreaterThan(0);
  });
  it("defaults to equal thirds when absent", () => {
    const p = parseProfile("target: {provider: openai}").profile!.priority;
    expect(p.cost + p.speed + p.quality).toBeCloseTo(1);
    expect(p.cost).toBeCloseTo(1 / 3);
    expect(parseProfile("").profile?.priority.speed).toBeCloseTo(1 / 3);
  });
});

describe("parseProfile shape", () => {
  it("parses a full self-hosted profile", () => {
    const r = parseProfile(
      "target: {engine: vllm, model_family: qwen, context_tokens: 32768}\nengine: {block_tokens: 1584, match_unit_tokens: 16, speculative: true, kv_memory_gb: 16}\n",
    );
    expect(r.errors).toEqual([]);
    expect(r.profile?.target).toEqual({ engine: "vllm", model_family: "qwen", context_tokens: 32768 });
    expect(r.profile?.engine).toEqual({ block_tokens: 1584, match_unit_tokens: 16, speculative: true, kv_memory_gb: 16 });
  });
  it("reports unknown keys at the top level and nested", () => {
    expect(parseProfile("colour: blue").errors).toEqual(["unknown key: colour"]);
    expect(parseProfile("engine: {gpu: 1}").errors).toEqual(["unknown key: engine.gpu"]);
  });
  it("rejects target.provider together with target.engine", () => {
    expect(parseProfile("target: {provider: openai, engine: vllm}").errors).toEqual(["set target.provider or target.engine, not both"]);
  });
  it("reports wrong types and unknown engines", () => {
    expect(parseProfile("target: {engine: tgi}").errors.length).toBe(1);
    expect(parseProfile("target: {context_tokens: lots}").errors.length).toBe(1);
    expect(parseProfile("engine: {speculative: maybe}").errors.length).toBe(1);
    expect(parseProfile("engine: {block_tokens: 0}").errors.length).toBe(1);
  });
  it("reports non-mapping and invalid YAML without throwing", () => {
    expect(parseProfile("- a\n- b").errors.length).toBe(1);
    expect(parseProfile("a: [").errors.length).toBe(1);
  });
  it("accepts and validates ignore entries", () => {
    const ok = parseProfile("ignore:\n  - {rule: LP-PC-01, file: src/a.ts}\n");
    expect(ok.errors).toEqual([]);
    expect(ok.profile?.ignore).toEqual([{ rule: "LP-PC-01", file: "src/a.ts" }]);
    expect(parseProfile("ignore: [{rule: LP-PC-01}]").errors.length).toBe(1);
    expect(parseProfile("ignore: nope").errors.length).toBe(1);
  });
});

describe("loadProfile", () => {
  it("returns null when the file is missing", () => {
    const d = mkdtempSync(join(tmpdir(), "lp-"));
    try {
      expect(loadProfile(d)).toBeNull();
    } finally {
      rmSync(d, { recursive: true });
    }
  });
  it("reads leanprompt.yaml and throws on invalid content", () => {
    const d = mkdtempSync(join(tmpdir(), "lp-"));
    try {
      writeFileSync(join(d, "leanprompt.yaml"), "priority: quality\n");
      expect(loadProfile(d)?.priority.quality).toBe(1);
      writeFileSync(join(d, "leanprompt.yaml"), "colour: blue\n");
      expect(() => loadProfile(d)).toThrow("unknown key: colour");
    } finally {
      rmSync(d, { recursive: true });
    }
  });
});

describe("effectiveFacts", () => {
  const prof = (y: string) => parseProfile(y).profile!;
  it("returns the table facts when there is no profile", () => {
    expect(effectiveFacts(null, facts, "vllm")).toEqual(facts.get("vllm"));
  });
  it("overrides block size and speculative from the engine block", () => {
    const e = effectiveFacts(prof("engine: {block_tokens: 1584, speculative: true}"), facts, "vllm");
    expect(e).toMatchObject({ mode: "block", block_tokens: 1584, drops_last_block: true });
  });
  it("match_unit_tokens becomes the block size (E9)", () => {
    const e = effectiveFacts(prof("engine: {block_tokens: 1584, match_unit_tokens: 16, speculative: true}"), facts, "vllm");
    expect(e.block_tokens).toBe(16);
    expect(e.drops_last_block).toBe(true);
  });
  it("speculative: false clears the dropped block", () => {
    expect(effectiveFacts(prof("engine: {speculative: false}"), facts, "vllm").drops_last_block).toBe(false);
  });
  it("does not mutate the table and ignores engine for non-block providers", () => {
    const before = structuredClone(facts.get("vllm"));
    effectiveFacts(prof("engine: {block_tokens: 16}"), facts, "vllm");
    expect(facts.get("vllm")).toEqual(before);
    expect(effectiveFacts(prof("engine: {block_tokens: 16}"), facts, "openai")).toEqual(facts.get("openai"));
  });
  it("maps an engine name logged as the record's provider through the engine table", () => {
    expect(effectiveFacts(null, facts, "lm-warden")).toEqual(facts.get("vllm"));
    const e = effectiveFacts(prof("target: {engine: lm-warden}\nengine: {block_tokens: 800}"), facts, "lm-warden");
    expect(e).toMatchObject({ mode: "block", block_tokens: 800 });
    expect(() => effectiveFacts(null, facts, "llama.cpp")).toThrow("no cache facts for llama.cpp yet");
  });
  it("a provider with no table falls back to the profile's target", () => {
    for (const host of ["groq", "together", "azure", "deepseek"]) {
      expect(effectiveFacts(prof("target: {provider: openai}"), facts, host)).toEqual(facts.get("openai"));
      expect(effectiveFacts(prof("target: {engine: lm-warden}\nengine: {block_tokens: 800}"), facts, host)).toMatchObject({ mode: "block", block_tokens: 800 });
      expect(() => effectiveFacts(null, facts, host)).toThrow(`unknown provider: ${host}`);
    }
  });
  it("a provider with its own table keeps it, whatever the target", () => {
    expect(effectiveFacts(prof("target: {engine: lm-warden}"), facts, "anthropic")).toEqual(facts.get("anthropic"));
  });
  it("throws for an unknown provider", () => {
    expect(() => effectiveFacts(null, facts, "nope")).toThrow("unknown provider: nope");
  });
  it("resolves the key from target.engine when no provider is passed", () => {
    const p = prof("target: {engine: vllm}\nengine: {block_tokens: 1584, match_unit_tokens: 16, speculative: true}");
    expect(targetKey(p)).toBe("vllm");
    expect(effectiveFacts(p, facts)).toMatchObject({ mode: "block", block_tokens: 16, drops_last_block: true });
  });
  it("maps lm-warden to the vllm table", () => {
    const p = prof("target: {engine: lm-warden}\nengine: {block_tokens: 800}");
    expect(targetKey(p)).toBe("vllm");
    expect(effectiveFacts(p, facts)).toMatchObject({ mode: "block", block_tokens: 800 });
  });
  it("uses target.provider when set", () => {
    expect(effectiveFacts(prof("target: {provider: openai}"), facts)).toEqual(facts.get("openai"));
  });
  it("says llama.cpp has no cache facts yet", () => {
    const p = prof("target: {engine: llama.cpp}");
    expect(targetKey(p)).toBeNull();
    expect(() => effectiveFacts(p, facts)).toThrow("no cache facts for llama.cpp yet");
  });
  it("throws clearly with nothing to resolve", () => {
    expect(() => effectiveFacts(prof("priority: cost"), facts)).toThrow("neither target.provider nor target.engine");
    expect(() => effectiveFacts(null, facts)).toThrow("no provider given");
  });
});
