import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCacheFacts } from "../src/facts.js";
import { AmbiguousTargetError, effectiveFacts, loadProfile, parseProfile, profileTargets, targetKey } from "../src/profile.js";

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
    for (const host of ["fireworks", "cerebras", "azure", "mistral"]) {
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

describe("targets: several backends (issue #4)", () => {
  const TWO = "targets:\n  - engine: vllm\n    model_family: qwen\n    files: [src/llm/selfhosted.ts]\n  - provider: mistral\n    context_tokens: 65536\n";
  it("parses a list of targets, each with one provider or engine and optional files", () => {
    const r = parseProfile(TWO);
    expect(r.errors).toEqual([]);
    expect(r.profile?.targets).toEqual([
      { engine: "vllm", model_family: "qwen", files: ["src/llm/selfhosted.ts"] },
      { provider: "mistral", context_tokens: 65536 },
    ]);
    expect(r.profile?.target).toEqual({});
  });
  it("rejects target together with targets", () => {
    expect(parseProfile("target: {provider: openai}\ntargets: [{engine: vllm}]").errors).toContain("set target or targets, not both");
  });
  it("each entry needs exactly one of provider or engine, validated as target is", () => {
    expect(parseProfile("targets: [{provider: openai, engine: vllm}]").errors).toEqual(["targets[0]: set provider or engine, not both"]);
    expect(parseProfile("targets: [{model_family: qwen}]").errors).toEqual(["targets[0]: set provider or engine"]);
    expect(parseProfile("targets: [{engine: tgi}]").errors).toEqual(["targets[0].engine must be one of vllm, sglang, llama.cpp, lm-warden"]);
    expect(parseProfile("targets: [{provider: openai, colour: blue}]").errors).toEqual(["unknown key: targets[0].colour"]);
    expect(parseProfile("targets: [{provider: openai, files: src/a.ts}]").errors).toEqual(["targets[0].files must be a list of glob strings"]);
    expect(parseProfile("targets: {provider: openai}").errors).toEqual(["targets must be a non-empty list of entries"]);
    expect(parseProfile("targets: []").errors).toEqual(["targets must be a non-empty list of entries"]);
  });
  it("engine facts go per entry with two engine entries; a top-level engine: is then an error", () => {
    const y = "targets:\n  - {engine: vllm, engine_facts: {block_tokens: 1584}}\n  - {engine: sglang, engine_facts: {block_tokens: 1}}\n";
    const r = parseProfile(y);
    expect(r.errors).toEqual([]);
    expect(r.profile?.targets?.[0]?.engine_facts).toEqual({ block_tokens: 1584 });
    expect(parseProfile(`${y}engine: {block_tokens: 16}\n`).errors).toEqual([
      "with several engine entries in targets, give each its own engine_facts instead of a top-level engine:",
    ]);
    expect(parseProfile("targets: [{provider: openai, engine_facts: {block_tokens: 16}}]").errors).toEqual([
      "targets[0].engine_facts applies only to an engine entry",
    ]);
    expect(parseProfile("targets: [{engine: vllm, engine_facts: {gpu: 1}}]").errors).toEqual(["unknown key: targets[0].engine_facts.gpu"]);
  });
  it("keeps the top-level engine: for the single-engine case", () => {
    const p = prof2("targets: [{engine: lm-warden}, {provider: mistral}]\nengine: {block_tokens: 800}\n");
    expect(effectiveFacts(p, facts, "lm-warden")).toMatchObject({ mode: "block", block_tokens: 800 });
  });
  it("scores a record on its own provider's table first, whatever the targets", () => {
    const p = prof2(TWO);
    expect(effectiveFacts(p, facts, "openai")).toEqual(facts.get("openai"));
    expect(effectiveFacts(p, facts, "vllm")).toEqual(facts.get("vllm"));
  });
  it("per-entry engine facts apply to records logged with that engine's name", () => {
    const p = prof2("targets:\n  - {engine: lm-warden, engine_facts: {block_tokens: 800}}\n  - {engine: sglang, engine_facts: {block_tokens: 4}}\n");
    expect(effectiveFacts(p, facts, "lm-warden")).toMatchObject({ block_tokens: 800 });
    expect(effectiveFacts(p, facts, "sglang")).toMatchObject({ block_tokens: 4 });
  });
  it("a provider with no table falls back to the matching entry, never to a guess", () => {
    const p = prof2(TWO);
    // mistral matches its own entry, which has no table either: unknown provider, not ambiguous.
    expect(() => effectiveFacts(p, facts, "mistral")).toThrow("unknown provider: mistral");
    // cerebras matches no entry and there are two: ambiguous.
    let err: unknown;
    try {
      effectiveFacts(p, facts, "cerebras");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AmbiguousTargetError);
    expect(String(err)).toMatch(/ambiguous_target.*cerebras/);
    // a single targets entry is the fallback, as target: is
    expect(effectiveFacts(prof2("targets: [{provider: openai}]"), facts, "cerebras")).toEqual(facts.get("openai"));
  });
  it("without a record's provider, several targets are ambiguous", () => {
    expect(() => effectiveFacts(prof2(TWO), facts)).toThrow(AmbiguousTargetError);
  });
  it("profileTargets lists the targets of either form", () => {
    expect(profileTargets(prof2("target: {provider: openai}"))).toEqual([{ provider: "openai" }]);
    expect(profileTargets(prof2(TWO)).map((t) => t.engine ?? t.provider)).toEqual(["vllm", "mistral"]);
    expect(profileTargets(prof2("priority: cost"))).toEqual([]);
  });
});
const prof2 = (y: string) => {
  const r = parseProfile(y);
  if (!r.profile) throw new Error(r.errors.join("; "));
  return r.profile;
};

describe("parseProfile volume and prices (cost estimates)", () => {
  const price = "prices:\n  example-model: {input: 0.5, cached_input: 0.05, output: 2, source: https://example.com/pricing, checked: 2026-11-26}\n";
  it("reads a top-level volume and dated prices per model", () => {
    const r = parseProfile(`volume: {calls_per_month: 30000}\n${price}`);
    expect(r.errors).toEqual([]);
    expect(r.profile?.volume).toEqual({ calls_per_month: 30000 });
    expect(r.profile?.prices).toEqual({ "example-model": { input: 0.5, cached_input: 0.05, output: 2, source: "https://example.com/pricing", checked: "2026-11-26" } });
  });
  it("a price needs input, output, a source and a checked date", () => {
    for (const p of [
      "{input: 1, output: 2, source: x}",
      "{input: 1, output: 2, checked: 2026-11-26}",
      "{input: 1, source: x, checked: 2026-11-26}",
      "{input: -1, output: 2, source: x, checked: 2026-11-26}",
      "{input: 1, output: 2, source: x, checked: yesterday}",
      "{input: 1, output: 2, source: x, checked: 2026-11-26, currency: euro}",
      "{input: 1, output: 2, cache_write: nope, source: x, checked: 2026-11-26}",
    ]) {
      expect(parseProfile(`prices:\n  m: ${p}\n`).errors.length, p).toBeGreaterThan(0);
    }
    expect(parseProfile("prices:\n  m: {input: 1, output: 2, cache_write: 1.25, source: our contract, checked: 2026-11-01}\n").errors).toEqual([]);
  });
  it("validates volume", () => {
    for (const v of ["{calls_per_month: 0}", "{calls_per_month: 1.5}", "{calls: 3}", "30000"]) expect(parseProfile(`volume: ${v}`).errors.length, v).toBeGreaterThan(0);
    expect(parseProfile("volume: {calls_per_month: 100, source: \"usage log, 30 days\"}").profile?.volume).toEqual({ calls_per_month: 100, source: "usage log, 30 days" });
  });
  it("with targets, the volume goes on each entry, not at the top", () => {
    const ok = parseProfile("targets:\n  - {engine: lm-warden, volume: {calls_per_month: 100}}\n  - {provider: mistral, volume: {calls_per_month: 50}}\n");
    expect(ok.errors).toEqual([]);
    expect(ok.profile?.targets?.map((t) => t.volume?.calls_per_month)).toEqual([100, 50]);
    expect(parseProfile("volume: {calls_per_month: 10}\ntargets:\n  - {provider: mistral}\n").errors.join()).toMatch(/volume/);
  });
  it("reads prefill_tokens_per_second for a self-hosted engine", () => {
    expect(parseProfile("engine: {prefill_tokens_per_second: 8000}").profile?.engine).toEqual({ prefill_tokens_per_second: 8000 });
    expect(parseProfile("engine: {prefill_tokens_per_second: 0}").errors.length).toBeGreaterThan(0);
  });
});
