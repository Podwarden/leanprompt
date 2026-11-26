import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { lintRules, loadEvidenceIds, loadRuleIds } from "../../src/lint/rules.js";
import { parseFindings } from "../../src/score/static.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_DIR = join(ROOT, "skills", "prompt-diet");
const RULES_DIR = join(SKILL_DIR, "rules");

const TITLES: Record<string, string> = {
  "LP-PD-01": "Offer each route only the tools it can use",
  "LP-PD-02": "Say each instruction once",
  "LP-PD-03": "Do not resend the same boilerplate on every turn",
  "LP-PD-04": "Trim tool results and retrieved context at the tool boundary",
  "LP-PD-05": "Drop stale history on purpose, not by stripping",
  "LP-PD-06": "Compact serialisation for data in the prompt",
};

const ruleFiles = (): string[] => (existsSync(RULES_DIR) ? readdirSync(RULES_DIR).filter((f) => f.endsWith(".md")).sort() : []);
const read = (f: string) => readFileSync(join(RULES_DIR, f), "utf8");
const skillText = () => readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const section = (text: string, heading: string) => parseDoc(text).sections.find((s) => s.heading === heading)?.body ?? "";
const body = (text: string) => text.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "");
const allDocs = () => [...ruleFiles().map((f) => [f, read(f)] as const), ["SKILL.md", skillText()] as const];
const docUrls = (text: string): string[] => ((parseDoc(text).meta.evidence as unknown[]) ?? []).map((e) => (e as { doc?: string }).doc ?? "").filter(Boolean);

describe("prompt-diet skill content", () => {
  it("passes the rule linter with no errors", () => {
    expect(lintRules(ROOT).filter((i) => i.level === "error" && i.file.includes("prompt-diet"))).toEqual([]);
  });

  it("has exactly LP-PD-01..06 with the planned titles, one per file", () => {
    expect(ruleFiles()).toEqual(Object.keys(TITLES).map((id) => `${id}.md`));
    const got = Object.fromEntries(ruleFiles().map((f) => [parseDoc(read(f)).meta.id, parseDoc(read(f)).meta.title]));
    expect(got).toEqual(TITLES);
  });

  it("every rule saves prefill and applies to any target", () => {
    for (const f of ruleFiles()) {
      const { meta } = parseDoc(read(f));
      expect(meta.saves, f).toBe("prefill");
      expect(meta.applies_to as string[], f).toContain("any");
    }
  });

  it("every rule carries the doctrine: an answer check before and after with measure-loop", () => {
    for (const f of ruleFiles()) {
      const dbm = section(read(f), "Don't break meaning");
      expect(dbm, f).toMatch(/answer check/);
      expect(dbm, f).toMatch(/`measure-loop`/);
      expect(dbm, f).toMatch(/before and after|before\/after/);
      expect(dbm, f).toMatch(/unchanged or better/);
    }
  });

  it("every rule weighs the cache and links prefill-cache", () => {
    for (const f of ruleFiles()) {
      const dbm = section(read(f), "Don't break meaning");
      expect(dbm, f).toMatch(/cache/);
      expect(dbm, f).toContain("](../../prefill-cache/SKILL.md)");
      expect(body(read(f)), f).toMatch(/LP-PC-\d{2}/);
    }
  });

  it("every rule cites E11 as the reason not to strip blindly", () => {
    for (const f of ruleFiles()) {
      const text = read(f);
      expect(parseDoc(text).meta.evidence, f).toContain("E11");
      expect(section(text, "Don't break meaning"), f).toMatch(/strip[\s\S]*\(E11\)/);
    }
    expect(skillText()).toMatch(/Do not strip blindly[\s\S]*\(E11\)/);
  });

  it("every provider fact a rule relies on comes from a dated doc source that the provider tables also record", () => {
    const tables = ["anthropic", "openai", "gemini"].map((p) => readFileSync(join(ROOT, "providers", `${p}.md`), "utf8")).join("\n");
    for (const f of ruleFiles()) {
      const urls = docUrls(read(f));
      expect(urls.length, f).toBeGreaterThan(0);
      for (const e of parseDoc(read(f)).meta.evidence as unknown[]) {
        if (typeof e === "object") expect(String((e as { checked: unknown }).checked instanceof Date ? (e as { checked: Date }).checked.toISOString() : (e as { checked: unknown }).checked), f).toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
      expect(body(read(f)), f).toMatch(/\]\(\.\.\/\.\.\/\.\.\/providers\/[a-z]+\.md\)/);
    }
    for (const p of ["anthropic", "openai", "gemini"]) {
      const t = parseDoc(readFileSync(join(ROOT, "providers", `${p}.md`), "utf8"));
      const s = t.sections.find((x) => x.heading.startsWith("Prompt size facts"));
      expect(s, p).toBeDefined();
      expect(s!.body, p).toMatch(/prompt-diet/);
      expect(s!.body, p).toMatch(/https:\/\//);
    }
    // The tool-definition facts the skill states, with their sources.
    expect(tables).toMatch(/including in the `tools` parameter[\s\S]*tool-use\/overview/);
    expect(tables).toMatch(/billed as input tokens[\s\S]*guides\/function-calling/);
    expect(tables).toMatch(/allowed_tools/);
    expect(tables).toMatch(/clear_tool_uses_20250919[\s\S]*context-editing/);
  });

  it("LP-PD-05 cross-references compaction (LP-PC-08) instead of restating it, and keeps the tool-use turn whole", () => {
    const text = read("LP-PD-05.md");
    expect(body(text)).toMatch(/LP-PC-08/);
    expect(body(text)).not.toMatch(/Summarise the conversation so far for your own later use/);
    expect(section(text, "Don't break meaning")).toMatch(/tool-use turn whole/);
    expect(section(text, "Why")).toMatch(/LP-PC-06/);
  });

  it("LP-PD-01 keeps the tool list fixed per route and names allowed_tools", () => {
    const text = read("LP-PD-01.md");
    expect(section(text, "Rule")).toMatch(/fixed tool list/);
    expect(section(text, "Fix")).toMatch(/allowed_tools/);
    expect(section(text, "Waste signal")).toMatch(/LP-PC-04/);
  });

  it("every Verify names a provider usage field and a leanprompt record signal or kvsig id", () => {
    for (const f of ruleFiles()) {
      const v = section(read(f), "Verify");
      expect(v, f).toMatch(/input_tokens|prompt_tokens|promptTokenCount/);
      expect(v, f).toMatch(/cached_tokens|cache_read_input_tokens/);
      expect(v, f).toMatch(/ids\.(tools|head|sys|nodes)|`prompt_tokens`/);
    }
  });

  it("every Detect in code section covers Python, TS/JS and Go", () => {
    for (const f of ruleFiles()) {
      const d = section(read(f), "Detect in code");
      expect(d, f).toMatch(/Python/);
      expect(d, f).toMatch(/TS\/JS/);
      expect(d, f).toMatch(/\bGo\b/);
    }
  });

  it("SKILL.md has Agent Skills frontmatter, indexes every rule and states the three things every trim must respect", () => {
    const text = skillText();
    const { meta } = parseDoc(text);
    expect(meta.name).toBe("prompt-diet");
    expect(meta.license).toBe("CC-BY-4.0");
    expect(String(meta.description)).toMatch(/^Use when /);
    for (const id of Object.keys(TITLES)) expect(text).toContain(`rules/${id}.md`);
    const t = section(text, "Three things every trim must respect");
    expect(t).toMatch(/answer check/);
    expect(t).toMatch(/cache/);
    expect(t).toContain("../prefill-cache/SKILL.md");
    expect(t).toMatch(/\(E11\)/);
  });

  it("findings with LP-PD ids are accepted by the static score's parser", () => {
    const ids = loadRuleIds(ROOT);
    for (const id of Object.keys(TITLES)) expect(ids.has(id), id).toBe(true);
    const doc = { v: 1, findings: [{ rule: "LP-PD-04", file: "app/tools.py", line: 18, saves: "prefill", severity: "high", share: 0.1, tokens_per_1k: { prompt: 1000 } }] };
    const r = parseFindings(JSON.stringify(doc), ids);
    expect(r.errors).toEqual([]);
    expect(r.findings).toHaveLength(1);
  });

  it("every relative link resolves", () => {
    for (const [f, text] of allDocs()) {
      const base = f === "SKILL.md" ? SKILL_DIR : RULES_DIR;
      for (const m of body(text).matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) expect(existsSync(join(dirname(join(base, f)), m[1]!)), `${f}: ${m[1]}`).toBe(true);
    }
  });

  it("no percentage without an evidence citation; every cited evidence row exists; no hype or internal jargon", () => {
    const known = loadEvidenceIds(ROOT);
    for (const [f, text] of allDocs()) {
      const b = body(text);
      for (const line of b.split("\n")) if (/\d\s*%/.test(line)) expect(line, f).toMatch(/\(E\d+\)/);
      for (const m of b.matchAll(/\bE(\d+)\b/g)) expect(known.has(`E${m[1]}`), `${f}: E${m[1]}`).toBe(true);
      expect(text, f).not.toMatch(/—/);
      expect(b, f).not.toMatch(/!\s|up to \d|AI-powered/i);
      expect(b, f).not.toMatch(/owner ruling|ruling D\d|\bD\d\b|\bQ\d\b|Task \d+/i);
    }
  });
});
