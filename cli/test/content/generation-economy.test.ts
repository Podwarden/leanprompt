import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { lintRules, loadEvidenceIds } from "../../src/lint/rules.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_DIR = join(ROOT, "skills", "generation-economy");
const RULES_DIR = join(SKILL_DIR, "rules");

const TITLES: Record<string, string> = {
  "LP-GE-01": "n samples in one request",
  "LP-GE-02": "Batch independent questions about one context",
  "LP-GE-03": "Output and thinking budgets that fit the task",
  "LP-GE-04": "Stream long outputs; timeouts that match generation time",
  "LP-GE-05": "Retry only retryable errors; never retry a truncation unchanged",
  "LP-GE-06": "Cache exact responses for deterministic requests",
  "LP-GE-07": "Batch API for work that can wait",
  "LP-GE-08": "Route trivially small calls to a small model",
  "LP-GE-09": "Predicted outputs for mostly unchanged text",
  "LP-GE-10": "Structured output instead of parse-and-re-ask",
};

function ruleFiles(): string[] {
  if (!existsSync(RULES_DIR)) return [];
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}
const read = (f: string) => readFileSync(join(RULES_DIR, f), "utf8");
const skillText = () => readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const section = (text: string, heading: string) => parseDoc(text).sections.find((s) => s.heading === heading)?.body ?? "";
/** Everything after the frontmatter block. */
const body = (text: string) => text.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "");
const allDocs = () => [...ruleFiles().map((f) => [f, read(f)] as const), ["SKILL.md", skillText()] as const];

describe("generation-economy skill content", () => {
  it("passes the rule linter with no errors", () => {
    const issues = lintRules(ROOT).filter((i) => i.level === "error" && i.file.includes("generation-economy"));
    expect(issues).toEqual([]);
  });

  it("has exactly LP-GE-01..10 with the planned titles, one per file", () => {
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

  it("every Verify section names a provider usage field and a leanprompt usage-record signal", () => {
    const files = ruleFiles();
    expect(files.length).toBe(10);
    const provider = /output_tokens|completion_tokens|finish_reason|stop_reason|finishReason|candidatesTokenCount|cached_tokens/;
    const record = /flags\.retry_of|flags\.parse_failed|finish: "length"|`output_tokens`|`finish`/;
    for (const f of files) {
      const v = section(read(f), "Verify");
      expect(v, f).toMatch(provider);
      expect(v, f).toMatch(record);
    }
  });

  it("every Detect in code section covers Python, TS/JS and Go", () => {
    for (const f of ruleFiles()) {
      const d = section(read(f), "Detect in code");
      expect(d, f).toMatch(/Python/);
      expect(d, f).toMatch(/TS|JS|TypeScript|JavaScript/);
      expect(d, f).toMatch(/\bGo\b/);
    }
  });

  it("every rule links the providers that support its feature to a dated table", () => {
    for (const f of ruleFiles()) expect(body(read(f)), f).toMatch(/\]\(\.\.\/\.\.\/\.\.\/providers\/[a-z]+\.md\)/);
  });

  it("LP-GE-01 cites E12 and contains no number from E12", () => {
    const text = read("LP-GE-01.md");
    expect(parseDoc(text).meta.evidence).toContain("E12");
    expect(body(text)).toMatch(/\(E12\)/);
    const evidence = readFileSync(join(ROOT, "docs", "evidence.md"), "utf8");
    const row = evidence.split("\n").find((l) => /^\|\s*E12\s*\|/.test(l)) ?? "";
    expect(row).not.toBe("");
    const rowNumbers = (row.replace(/\bE12\b/g, "").match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, ""));
    for (const n of rowNumbers) expect(body(text), `E12 number ${n}`).not.toContain(n);
    // No measured figure of any kind in the rule: no percentages, no "Nx" multipliers.
    expect(body(text)).not.toMatch(/\d\s*%|\b\d+(\.\d+)?x\b/);
  });

  it("LP-GE-02 and LP-GE-08 describe an answer check in Don't break meaning", () => {
    for (const f of ["LP-GE-02.md", "LP-GE-08.md"]) {
      const dbm = section(read(f), "Don't break meaning");
      expect(dbm, f).toMatch(/answer check/i);
      expect(dbm, f).toMatch(/fixed (set of )?(synthetic )?inputs?|fixed input set/i);
      expect(dbm, f).toMatch(/compare/i);
      expect(dbm, f).toMatch(/pass\/fail|pass or fail/i);
    }
  });

  it("SKILL.md carries the priority-aware advice and a Frontier generation economy section", () => {
    const text = skillText();
    const headings = parseDoc(text).sections.map((s) => s.heading);
    expect(headings).toContain("Priority-aware advice");
    expect(headings).toContain("Frontier generation economy");
    const advice = section(text, "Priority-aware advice");
    for (const p of [/cost first/i, /speed first/i, /quality first/i]) expect(advice).toMatch(p);
    expect(section(text, "Frontier generation economy")).toMatch(/providers\/[a-z]+\.md/);
  });

  it("no percentage appears without an evidence citation on the same line", () => {
    for (const [f, text] of allDocs()) {
      for (const line of body(text).split("\n")) {
        if (/\d\s*%/.test(line)) expect(line, `${f}: percentage without (E<n>)`).toMatch(/\(E\d+\)/);
      }
    }
  });

  it("every cited evidence row exists in docs/evidence.md", () => {
    const known = loadEvidenceIds(ROOT);
    for (const [f, text] of allDocs()) {
      for (const m of body(text).matchAll(/\bE(\d+)\b/g)) expect(known.has(`E${m[1]}`), `${f}: E${m[1]}`).toBe(true);
    }
  });

  it("public text carries no internal planning jargon", () => {
    for (const [f, text] of allDocs()) {
      const b = body(text);
      expect(b, f).not.toMatch(/owner ruling|ruling D\d|\bD\d\b|\bQ\d\b|Task \d+/i);
    }
  });

  it("SKILL.md has Agent Skills frontmatter and indexes every rule", () => {
    const text = skillText();
    const { meta } = parseDoc(text);
    expect(meta.name).toBe("generation-economy");
    expect(String(meta.description)).toMatch(/^Use when /);
    for (const id of Object.keys(TITLES)) expect(text).toContain(`rules/${id}.md`);
    for (const p of ["anthropic", "openai", "gemini", "openrouter", "vllm", "sglang"]) expect(text).toContain(`providers/${p}.md`);
  });
});
