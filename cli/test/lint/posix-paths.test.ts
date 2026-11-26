import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintFacts } from "../../src/lint/facts.js";
import { checkNumbersInRepo } from "../../src/lint/numbers.js";
import { lintRules, posix } from "../../src/lint/rules.js";
import { FINDINGS_FILE, USAGE_FILE, WEIGHTS_FILE } from "../../src/score/write.js";

// Windows CI is the first place a "\" in a displayed path shows up; this keeps the class visible on any OS.
let root: string;
const put = (rel: string, text: string) => {
  mkdirSync(join(root, ...rel.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lp-posix-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("displayed paths use '/' on every OS", () => {
  it("every issue file the linters report matches /^[^\\\\]+$/", () => {
    put("providers/a.md", "---\nprovider: a\n---\nno facts\n");
    put("models/r.md", "---\nmodel: r\n---\nno facts\n");
    put("skills/s/SKILL.md", "---\nname: s\n---\n");
    put("skills/s/rules/bad.md", "---\nid: LP-XX-01\n---\nno sections\n");
    put("README.md", "Saves 99.9% of tokens.\n");
    put("skills/s/notes.md", "Saves 88.8% of tokens.\n");
    const all = [...lintFacts(root, "2026-11-26"), ...lintRules(root), ...checkNumbersInRepo(root)];
    expect(all.length).toBeGreaterThan(2);
    for (const i of all) expect(i.file).toMatch(/^[^\\]+$/);
    expect(all.some((i) => i.file.includes("/"))).toBe(true);
  });

  it("posix() turns native separators into '/'", () => {
    expect(posix(join("a", "b", "c.md"))).toBe("a/b/c.md");
  });

  it("the .leanprompt display names are fixed '/' strings", () => {
    for (const n of [USAGE_FILE, FINDINGS_FILE, WEIGHTS_FILE]) expect(n).toMatch(/^\.leanprompt\/[^\\]+$/);
  });

  it("no lint source builds an issue `file` straight from join()/relative()", () => {
    const dir = join(import.meta.dirname, "..", "..", "src", "lint");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/\bfile:\s*(join|relative)\(/);
    }
  });
});
