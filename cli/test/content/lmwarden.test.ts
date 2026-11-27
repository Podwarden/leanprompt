import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { lintRules } from "../../src/lint/rules.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = join(ROOT, "skills", "lmwarden");
const TITLES: Record<string, string> = {
  "LP-LW-01": "Turn on prefix caching and set the match unit",
  "LP-LW-02": "Keep a conversation on the replica that holds its cache",
  "LP-LW-03": "One key per app or tenant; cache scope is a privacy boundary",
};
const SKILL = readFileSync(join(DIR, "SKILL.md"), "utf8");
const files = readdirSync(join(DIR, "rules")).filter((f) => f.endsWith(".md")).sort();
const read = (f: string) => readFileSync(join(DIR, "rules", f), "utf8");
const all = [["SKILL.md", SKILL] as const, ...files.map((f) => [f, read(f)] as const)];
const section = (t: string, h: string) => parseDoc(t).sections.find((s) => s.heading === h)?.body ?? "";

describe("lmwarden skill content", () => {
  it("passes the rule linter", () => {
    expect(lintRules(ROOT).filter((i) => i.level === "error" && i.file.includes("lmwarden"))).toEqual([]);
  });
  it("has exactly LP-LW-01..03 with the planned titles", () => {
    expect(files).toEqual(Object.keys(TITLES).map((id) => `${id}.md`));
    expect(Object.fromEntries(files.map((f) => [parseDoc(read(f)).meta.id, parseDoc(read(f)).meta.title]))).toEqual(TITLES);
  });
  it("has Agent Skills frontmatter and indexes every rule", () => {
    const { meta } = parseDoc(SKILL);
    expect(meta.name).toBe("lmwarden");
    expect(String(meta.description)).toMatch(/^Use when /);
    for (const id of Object.keys(TITLES)) expect(SKILL).toContain(`rules/${id}.md`);
  });
  it("names the alternatives and what LM Warden does not do", () => {
    for (const n of ["vLLM", "SGLang", "llama.cpp", "Ollama", "Hosted APIs"]) expect(SKILL).toContain(n);
    expect(SKILL).toMatch(/Make a model faster/);
    expect(SKILL).toMatch(/NVIDIA only/);
    expect(SKILL).toMatch(/one host/);
  });
  it("quotes E10 only with its limits", () => {
    for (const [f, t] of all) {
      for (const para of t.split(/\n\n+/).filter((p) => /2\.33 s/.test(p))) {
        expect(para, f).toMatch(/synthetic/);
        expect(para, f).toMatch(/one run per arm/);
        expect(para, f).toMatch(/24 and more sessions/);
        expect(para, f).toMatch(/worse/);
        expect(para, f).toMatch(/engine result|result for the engine/);
      }
    }
    expect(SKILL).toMatch(/2\.33 s/);
    expect(read("LP-LW-02.md")).toMatch(/2\.33 s/);
  });
  it("E10 paragraphs make no comparative claim beyond the E10 row", () => {
    for (const [f, t] of all) for (const para of t.split(/\n\n+/).filter((p) => /E10/.test(p))) expect(para, f).not.toMatch(/slow tail|shorter tail|p95|tail was/i);
  });
  it("Prompt Lens appears only as planned", () => {
    for (const [f, t] of all) for (const line of t.split("\n")) if (/Prompt Lens/.test(line)) expect(line, f).toMatch(/planned/i);
    expect(SKILL).toMatch(/Prompt Lens is planned/);
  });
  it("no percentage or timing without an evidence citation on the same line; no internal jargon", () => {
    for (const [f, t] of all) {
      for (const line of t.replace(/^---[\s\S]*?\n---\n/, "").split("\n")) {
        if (/\d\s*%|\d\.\d+ s\b/.test(line)) expect(line, f).toMatch(/\(E\d+\)/);
      }
      expect(t, f).not.toMatch(/owner ruling|Open item|\bQ\d\b|Task \d|\.h\b/);
    }
  });
  it("every rule covers Python, TS/JS and Go in Detect and has a Verify", () => {
    for (const f of files) {
      const d = section(read(f), "Detect in code");
      expect(d, f).toMatch(/Python|Launch files/);
      expect(d, f).toMatch(/TS|JS/);
      expect(d, f).toMatch(/\bGo\b/);
      expect(section(read(f), "Verify"), f).toMatch(/kvsig|cached_tokens|usage/);
    }
  });
  it("LP-LW-01 covers one-shot apps with a shared head", () => {
    const t = read("LP-LW-01.md");
    expect(section(t, "Why")).toMatch(/one-shot app/);
    expect(section(t, "Detect in code")).toMatch(/one-shot app/);
  });
  it("auto-detect is described as needing a release with the endpoint", () => {
    expect(SKILL).toMatch(/needs LM Warden v2026\.11\.26\.1 or later/);
    expect(SKILL).toContain("never fill them in by guess");
    expect(SKILL).toContain("/api/me/engine");
  });
});
