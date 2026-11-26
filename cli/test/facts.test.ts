import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cap, loadCacheFacts, type CacheFacts } from "../src/facts.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const f = (x: Partial<CacheFacts> & Pick<CacheFacts, "mode">): CacheFacts => ({ min_tokens: 0, ttl_seconds: 0, ...x });

describe("cap", () => {
  it("automatic with min 1024 and step 128 (E2, OpenAI)", () => {
    const o = f({ mode: "automatic", min_tokens: 1024, step_tokens: 128 });
    expect(cap(o, 1023)).toBe(0);
    expect(cap(o, 1024)).toBe(1024);
    expect(cap(o, 1300)).toBe(1280);
  });
  it("automatic with min 0 and step 64 (E2, DeepInfra)", () => {
    const d = f({ mode: "automatic", step_tokens: 64 });
    expect(cap(d, 10176)).toBe(10176);
    expect(cap(d, 100)).toBe(64);
  });
  it("block of 1584 (E9), with and without the dropped last block", () => {
    expect(cap(f({ mode: "block", block_tokens: 1584, drops_last_block: true }), 3200)).toBe(1584);
    expect(cap(f({ mode: "block", block_tokens: 1584, drops_last_block: false }), 3200)).toBe(3168);
    expect(cap(f({ mode: "block", block_tokens: 1584, drops_last_block: true }), 1000)).toBe(0);
  });
  it("breakpoints: only the minimum caps; missing breakpoints are not capped (D1)", () => {
    const a = f({ mode: "breakpoints", min_tokens: 1024, max_breakpoints: 4 });
    expect(cap(a, 1000)).toBe(0);
    expect(cap(a, 5000)).toBe(5000);
  });
});

describe("loadCacheFacts on the repo tables", () => {
  const facts = loadCacheFacts(REPO);
  it("loads every provider table with a numeric ttl_seconds", () => {
    for (const p of ["anthropic", "openai", "gemini", "openrouter", "deepinfra", "vllm", "sglang"]) {
      expect(facts.has(p), p).toBe(true);
      expect(typeof facts.get(p)!.ttl_seconds, p).toBe("number");
    }
  });
  it("carries the documented and measured values", () => {
    expect(facts.get("anthropic")).toMatchObject({ mode: "breakpoints", max_breakpoints: 4, ttl_seconds: 300 });
    expect(facts.get("openai")).toMatchObject({ mode: "automatic", min_tokens: 1024, step_tokens: 128 });
    expect(facts.get("deepinfra")).toMatchObject({ mode: "automatic", step_tokens: 64 });
    expect(facts.get("vllm")).toMatchObject({ mode: "block", block_tokens: 1584, drops_last_block: true, ttl_seconds: 0 });
    expect(facts.get("sglang")!.ttl_seconds).toBe(0);
  });
  it("returns an empty map when providers/ is absent", () => {
    const d = mkdtempSync(join(tmpdir(), "lp-facts-"));
    try {
      expect(loadCacheFacts(d).size).toBe(0);
      mkdirSync(join(d, "providers"));
      writeFileSync(join(d, "providers", "x.md"), "---\nprovider: x\n---\n## A\nb\n");
      expect(loadCacheFacts(d).size).toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
