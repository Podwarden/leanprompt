import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCommand, detectFromLmWarden } from "../src/detect.js";
import { main } from "../src/main.js";
import { parseProfile } from "../src/profile.js";

const ROW = { model: "qwen3-4b", backend: "vllm", engine_block_tokens: 1584, engine_match_unit_tokens: 16, engine_drops_last_block: true, speculative: "mtp", max_model_len: 32768, unknown: [] as string[] };
const resp = (...models: object[]) => ({ v: 1, models });
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function capture() {
  let out = "";
  let err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
  return { out: () => out, err: () => err };
}
const dirWith = (yaml?: string) => {
  const d = mkdtempSync(join(tmpdir(), "lp-detect-"));
  if (yaml !== undefined) writeFileSync(join(d, "leanprompt.yaml"), yaml);
  return d;
};
afterEach(() => vi.restoreAllMocks());

describe("detectFromLmWarden", () => {
  it("maps the engine fields and the context length", () => {
    expect(detectFromLmWarden(resp(ROW))).toEqual({ engine: { block_tokens: 1584, match_unit_tokens: 16, speculative: true }, context_tokens: 32768, unknown: [] });
  });
  it("speculative null means off, unless it is listed as unknown", () => {
    expect(detectFromLmWarden(resp({ ...ROW, speculative: null })).engine.speculative).toBe(false);
    const d = detectFromLmWarden(resp({ ...ROW, speculative: null, engine_block_tokens: null, unknown: ["speculative", "engine_block_tokens"] }));
    expect(d.engine).toEqual({ match_unit_tokens: 16 });
    expect(d.unknown.sort()).toEqual(["engine_block_tokens", "speculative"]);
  });
  it("needs --model when there are several, and lists the names", () => {
    const two = resp(ROW, { ...ROW, model: "other", engine_block_tokens: 16, engine_match_unit_tokens: 16, speculative: null });
    expect(() => detectFromLmWarden(two)).toThrow(/qwen3-4b, other/);
    expect(detectFromLmWarden(two, "other").engine).toEqual({ block_tokens: 16, match_unit_tokens: 16, speculative: false });
    expect(() => detectFromLmWarden(two, "nope")).toThrow(/no model "nope".*qwen3-4b, other/);
  });
  it("rejects bad shapes", () => {
    expect(() => detectFromLmWarden(resp())).toThrow(/no models/);
    expect(() => detectFromLmWarden("x")).toThrow();
    expect(() => detectFromLmWarden({ v: 2, models: [ROW] })).toThrow(/version/);
  });
});

describe("profile detect", () => {
  it("writes engine: and keeps target, priority, ignore and comments (formatting may be normalised)", async () => {
    const original = "# my project\ntarget:\n  engine: lm-warden   # served by LM Warden\n  model_family: qwen\npriority: {cost: 0.5, speed: 0.3, quality: 0.2}\nignore:\n  - {rule: LP-PC-01, file: a.ts}\n";
    const dir = dirWith(original);
    const calls: { url: string; auth: string | null }[] = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return reply(200, resp(ROW))();
    };
    const io = capture();
    const code = await detectCommand(["--lmwarden", "http://lm.example:8080/"], { fetch: fetchFn, env: { LMWARDEN_API_KEY: "s3cret" }, cwd: dir });
    expect(code).toBe(0);
    expect(calls).toEqual([{ url: "http://lm.example:8080/api/me/engine", auth: "Bearer s3cret" }]);
    const text = readFileSync(join(dir, "leanprompt.yaml"), "utf8");
    expect(text).toContain("# my project");
    expect(text).toContain("# served by LM Warden");
    const p = parseProfile(text).profile!;
    expect(p.target).toEqual({ engine: "lm-warden", model_family: "qwen", context_tokens: 32768 });
    expect(p.priority).toEqual({ cost: 0.5, speed: 0.3, quality: 0.2 });
    expect(p.ignore).toEqual([{ rule: "LP-PC-01", file: "a.ts" }]);
    expect(p.engine).toEqual({ block_tokens: 1584, match_unit_tokens: 16, speculative: true });
    expect(io.out() + io.err()).not.toContain("s3cret");
  });
  it("replaces an existing engine: block but keeps kv_memory_gb", async () => {
    const dir = dirWith("target: {engine: lm-warden}\nengine:\n  block_tokens: 64\n  kv_memory_gb: 16\n");
    capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    expect(parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!.engine).toEqual({ block_tokens: 1584, match_unit_tokens: 16, speculative: true, kv_memory_gb: 16 });
  });
  it("creates leanprompt.yaml with target.engine lm-warden when absent", async () => {
    const dir = dirWith();
    capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    const p = parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!;
    expect(p.target).toEqual({ engine: "lm-warden", context_tokens: 32768 });
    expect(p.engine).toEqual({ block_tokens: 1584, match_unit_tokens: 16, speculative: true });
  });
  it("a 401 exits 1 with the public message and writes nothing", async () => {
    const dir = dirWith();
    const io = capture();
    const code = await detectCommand(["--lmwarden", "http://h"], { fetch: reply(401, { detail: "no" }), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir });
    expect(code).toBe(1);
    expect(io.err()).toContain("LM Warden returned 401: check the API key in LMWARDEN_API_KEY");
    expect(() => readFileSync(join(dir, "leanprompt.yaml"))).toThrow();
  });
  it("a 404 says the release lacks the endpoint; a null field is left out with a note", async () => {
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(404, {}), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dirWith() })).toBe(1);
    expect(io.err()).toContain("this LM Warden does not have /api/me/engine yet; it needs a newer release");
    const dir = dirWith();
    const row = { ...ROW, engine_match_unit_tokens: null, unknown: ["engine_match_unit_tokens"] };
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(200, resp(row)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    expect(io.out()).toContain("left out: engine_match_unit_tokens");
    expect(parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!.engine).toEqual({ block_tokens: 1584, speculative: true });
  });
  it("never overwrites an existing context_tokens", async () => {
    const dir = dirWith("target: {engine: lm-warden, context_tokens: 8000}\n");
    capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    expect(parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!.target.context_tokens).toBe(8000);
  });
  it("a missing token variable exits 1 and names the variable", async () => {
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://h", "--token-env", "MY_TOK"], { fetch: reply(200, {}), env: {}, cwd: dirWith() })).toBe(1);
    expect(io.err()).toContain("MY_TOK");
  });
  it("never prints the key, even when the runtime echoes an invalid header value", async () => {
    for (const key of ["k\nz", "k\rz", "  \r\n"]) {
      const io = capture();
      const fetchFn = async (_u: string | URL | Request, init?: RequestInit) => {
        const v = new Headers(init?.headers).get("authorization");
        void v;
        throw new TypeError(`Headers.append: "Bearer ${key.trim() || key}" is an invalid header value.`);
      };
      expect(await detectCommand(["--lmwarden", "http://h"], { fetch: fetchFn, env: { LMWARDEN_API_KEY: key }, cwd: dirWith() })).toBe(1);
      expect(io.err()).not.toContain(key.trim() || "\u0000never");
      expect(io.err()).not.toMatch(/k\s*z/);
      vi.restoreAllMocks();
    }
  });
  it("trims the key and rejects one that is empty after trimming", async () => {
    const seen: (string | null)[] = [];
    const fetchFn = async (_u: string | URL | Request, init?: RequestInit) => (seen.push(new Headers(init?.headers).get("authorization")), reply(200, resp(ROW))());
    capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: fetchFn, env: { LMWARDEN_API_KEY: "abc\r\n" }, cwd: dirWith() })).toBe(0);
    expect(seen).toEqual(["Bearer abc"]);
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: fetchFn, env: { LMWARDEN_API_KEY: " \n" }, cwd: dirWith() })).toBe(1);
    expect(io.err()).toContain("LMWARDEN_API_KEY");
  });
  it("several models without --model fail listing the names; --model picks one", async () => {
    const body = resp(ROW, { ...ROW, model: "other" });
    const dir = dirWith();
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(200, body), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(1);
    expect(io.err()).toMatch(/qwen3-4b, other/);
    expect(await detectCommand(["--lmwarden", "http://h", "--model", "other"], { fetch: reply(200, body), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
  });
  it("does not write an invalid profile over a file that fails validation", async () => {
    const dir = dirWith("target:\n  provider: openai\n  engine: vllm\n");
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://h"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(1);
    expect(io.err()).toMatch(/not both/);
    expect(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).toBe("target:\n  provider: openai\n  engine: vllm\n");
  });
  it("refuses a --token-env that is not a variable name, without echoing it", async () => {
    for (const bad of ["sk-live-abc123", "my key", "1ABC", "A=B"]) {
      const io = capture();
      let called = false;
      const fetchFn = async () => ((called = true), reply(200, resp(ROW))());
      expect(await detectCommand(["--lmwarden", "http://h", "--token-env", bad], { fetch: fetchFn, env: { [bad]: "x" }, cwd: dirWith() })).toBe(2);
      expect(io.err()).toMatch(/--token-env takes the name of an environment variable/);
      expect(io.err()).not.toContain(bad);
      expect(called).toBe(false);
      vi.restoreAllMocks();
    }
  });
  it("parses arguments strictly: a flag missing its value or an unknown flag fails clearly", async () => {
    for (const args of [["--lmwarden", "--model", "x"], ["--lmwarden", "http://h", "--modle", "x"], ["--lmwarden", "http://h", "--model"]]) {
      const io = capture();
      expect(await detectCommand(args, { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dirWith() })).toBe(2);
      expect(io.err()).toMatch(/usage: leanprompt profile detect/);
      vi.restoreAllMocks();
    }
  });
  it("warns before sending the key over plain http to a host that is not loopback", async () => {
    let io = capture();
    expect(await detectCommand(["--lmwarden", "http://lm.example:8080"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dirWith() })).toBe(0);
    expect(io.err()).toMatch(/warning: sending the API key over plain http to lm\.example/);
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8000", "http://[::1]:8000", "https://lm.example"]) {
      vi.restoreAllMocks();
      io = capture();
      expect(await detectCommand(["--lmwarden", url], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dirWith() })).toBe(0);
      expect(io.err(), url).not.toMatch(/warning/);
    }
  });
  it("sets target.engine lm-warden when an existing target names neither engine nor provider", async () => {
    const dir = dirWith("target:\n  model_family: qwen\n");
    capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    expect(parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!.target).toEqual({ engine: "lm-warden", model_family: "qwen", context_tokens: 32768 });
  });
  it("leaves a target.provider alone and says so", async () => {
    const dir = dirWith("target:\n  provider: openai\n");
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    const p = parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!;
    expect(p.target.provider).toBe("openai");
    expect(p.target.engine).toBeUndefined();
    expect(io.out()).toMatch(/target\.provider is openai.*left as is/);
  });
  it("with targets:, writes into the lm-warden entry's engine_facts and keeps the other entries", async () => {
    const dir = dirWith("targets:\n  - provider: deepseek\n  - engine: lm-warden   # self-hosted\n    model_family: qwen\npriority: cost\n");
    capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    const text = readFileSync(join(dir, "leanprompt.yaml"), "utf8");
    expect(text).toContain("# self-hosted");
    const p = parseProfile(text).profile!;
    expect(p.targets).toEqual([
      { provider: "deepseek" },
      { engine: "lm-warden", model_family: "qwen", context_tokens: 32768, engine_facts: { block_tokens: 1584, match_unit_tokens: 16, speculative: true } },
    ]);
    expect(p.engine).toBeUndefined();
  });
  it("with targets:, falls back to a vllm entry, and adds an lm-warden entry when there is neither", async () => {
    const vdir = dirWith("targets:\n  - {engine: vllm}\n  - {provider: openai}\n");
    capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: vdir })).toBe(0);
    expect(parseProfile(readFileSync(join(vdir, "leanprompt.yaml"), "utf8")).profile!.targets![0]!.engine_facts).toEqual({ block_tokens: 1584, match_unit_tokens: 16, speculative: true });
    const ndir = dirWith("targets:\n  - {provider: openai}\n");
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: ndir })).toBe(0);
    const p = parseProfile(readFileSync(join(ndir, "leanprompt.yaml"), "utf8")).profile!;
    expect(p.targets!.map((t) => t.engine ?? t.provider)).toEqual(["openai", "lm-warden"]);
    expect(io.out()).toMatch(/added .*lm-warden.* to targets/);
  });
  it("with a single engine entry and a top-level engine:, updates the top-level block", async () => {
    const dir = dirWith("targets:\n  - {engine: lm-warden}\n  - {provider: openai}\nengine:\n  kv_memory_gb: 16\n");
    capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(0);
    const p = parseProfile(readFileSync(join(dir, "leanprompt.yaml"), "utf8")).profile!;
    expect(p.engine).toEqual({ kv_memory_gb: 16, block_tokens: 1584, match_unit_tokens: 16, speculative: true });
    expect(p.targets![0]!.engine_facts).toBeUndefined();
  });
  it("refuses to pick between two lm-warden entries", async () => {
    const dir = dirWith("targets:\n  - {engine: lm-warden, files: [a/*]}\n  - {engine: lm-warden, files: [b/*]}\n");
    const io = capture();
    expect(await detectCommand(["--lmwarden", "http://localhost"], { fetch: reply(200, resp(ROW)), env: { LMWARDEN_API_KEY: "tok-1234" }, cwd: dir })).toBe(1);
    expect(io.err()).toMatch(/several lm-warden entries/);
  });
  it("requires --lmwarden and is reachable through main", async () => {
    const io = capture();
    expect(await detectCommand([], { env: {}, cwd: dirWith() })).toBe(2);
    expect(io.err()).toMatch(/--lmwarden/);
    expect(await main(["profile", "nope"])).toBe(2);
  });
});
