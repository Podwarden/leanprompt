import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { lintRules } from "../../src/lint/rules.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_DIR = join(ROOT, "skills", "prefill-cache");
const RULES_DIR = join(SKILL_DIR, "rules");

const TITLES: Record<string, string> = {
  "LP-PC-01": "Put cache marks where the provider needs them",
  "LP-PC-02": "Stable content first, without hurting meaning",
  "LP-PC-03": "No ids, timestamps, versions or paths at the top of the prompt",
  "LP-PC-04": "Fixed tool order and JSON key order",
  "LP-PC-05": "Tool lists grow only at the end",
  "LP-PC-06": "Append-only history",
  "LP-PC-07": "Shared context before per-user context",
  "LP-PC-08": "Cache-aware compaction",
  "LP-PC-09": "Consistent reasoning handling; thinking fixed per session",
  "LP-PC-10": "Stable image and attachment placement",
  "LP-PC-11": "Keep pauses inside the cache lifetime",
  "LP-PC-12": "Do not split one prefix across models or keys that do not share a cache",
};

function ruleFiles(): string[] {
  if (!existsSync(RULES_DIR)) return [];
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}
const read = (f: string) => readFileSync(join(RULES_DIR, f), "utf8");
const section = (text: string, heading: string) => parseDoc(text).sections.find((s) => s.heading === heading)?.body ?? "";
/** Everything after the frontmatter block. */
const body = (text: string) => text.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "");

describe("prefill-cache skill content", () => {
  it("passes the rule linter with no errors", () => {
    const issues = lintRules(ROOT).filter((i) => i.level === "error" && i.file.includes("prefill-cache"));
    expect(issues).toEqual([]);
  });

  it("has exactly LP-PC-01..12 with the planned titles, one per file", () => {
    const files = ruleFiles();
    expect(files).toEqual(Object.keys(TITLES).map((id) => `${id}.md`));
    const got = Object.fromEntries(
      files.map((f) => {
        const { meta } = parseDoc(read(f));
        return [meta.id, meta.title];
      }),
    );
    expect(got).toEqual(TITLES);
  });

  it("every Verify section names a provider usage field or a kvsig id", () => {
    const files = ruleFiles();
    expect(files.length).toBe(12);
    const re = /cached_tokens|cache_read_input_tokens|`(sys|tools|head|nodes)(\[[^\]`]*\])?`/;
    for (const f of files) expect(section(read(f), "Verify"), f).toMatch(re);
  });

  it("every Detect in code section covers Python, TS/JS and Go", () => {
    for (const f of ruleFiles()) {
      const d = section(read(f), "Detect in code");
      expect(d, f).toMatch(/Python/);
      expect(d, f).toMatch(/TS|JS|TypeScript|JavaScript/);
      expect(d, f).toMatch(/\bGo\b/);
    }
  });

  it("LP-PC-02 states the E6 result in Don't break meaning", () => {
    const dbm = section(read("LP-PC-02.md"), "Don't break meaning");
    expect(dbm).toMatch(/10\/12/);
    expect(dbm).toMatch(/1\/12/);
    expect(dbm).toMatch(/\(E6\)/);
  });

  it("LP-PC-01 carries the break-even rule", () => {
    expect(read("LP-PC-01.md")).toMatch(/break-even/i);
  });

  it("no percentage appears without an evidence citation on the same line", () => {
    const docs = [...ruleFiles().map((f) => [f, read(f)] as const), ["SKILL.md", readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8")] as const];
    for (const [f, text] of docs) {
      for (const line of body(text).split("\n")) {
        if (/\d\s*%/.test(line)) expect(line, `${f}: percentage without (E<n>)`).toMatch(/\(E\d+\)/);
      }
    }
  });

  it("SKILL.md has Agent Skills frontmatter and indexes every rule", () => {
    const text = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    const { meta } = parseDoc(text);
    expect(meta.name).toBe("prefill-cache");
    expect(String(meta.description)).toMatch(/^Use when /);
    for (const id of Object.keys(TITLES)) expect(text).toContain(`rules/${id}.md`);
    for (const p of ["anthropic", "openai", "gemini", "openrouter", "vllm", "sglang"]) expect(text).toContain(`providers/${p}.md`);
  });
});
