import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { lintRules, loadEvidenceIds } from "../../src/lint/rules.js";

const FIX = fileURLToPath(new URL("../fixtures/rules/", import.meta.url));
const REAL_EVIDENCE = fileURLToPath(new URL("../../../docs/evidence.md", import.meta.url));
let root: string;

function put(name: string, fixture: string, edit?: (t: string) => string, skill = "prefill-cache") {
  const dir = join(root, "skills", skill, "rules");
  mkdirSync(dir, { recursive: true });
  const text = readFileSync(join(FIX, fixture), "utf8");
  writeFileSync(join(dir, name), edit ? edit(text) : text);
}
const msgs = () => lintRules(root).map((i) => i.msg);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lp-rules-"));
  mkdirSync(join(root, "docs"));
  cpSync(REAL_EVIDENCE, join(root, "docs", "evidence.md"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("parseDoc", () => {
  it("reads frontmatter and level-2 sections only", () => {
    const d = parseDoc("---\nid: a\nlist: [1, 2]\n---\n## One\nbody\n### sub\nmore\n## Two\n```\n## not a heading\n```\n");
    expect(d.meta).toEqual({ id: "a", list: [1, 2] });
    expect(d.sections.map((s) => s.heading)).toEqual(["One", "Two"]);
    expect(d.sections[0]!.body).toBe("body\n### sub\nmore");
    expect(d.sections[1]!.body).toContain("## not a heading");
  });
  it("handles a document without frontmatter", () => {
    expect(parseDoc("## A\nx").meta).toEqual({});
  });
});

describe("loadEvidenceIds", () => {
  it("reads E1..E12 from the real docs/evidence.md", () => {
    const ids = loadEvidenceIds(join(REAL_EVIDENCE, "..", ".."));
    expect([...ids]).toEqual(Array.from({ length: 12 }, (_, i) => `E${i + 1}`));
  });
});

describe("lintRules", () => {
  it("is clean with zero rule files", () => expect(lintRules(root)).toEqual([]));
  it("good.md gives no issues", () => {
    put("LP-PC-01.md", "good.md");
    expect(lintRules(root)).toEqual([]);
  });
  it("missing Verify", () => {
    put("a.md", "no-verify.md");
    expect(msgs()).toContain("missing section: Verify");
  });
  it("bad id", () => {
    put("a.md", "bad-id.md");
    expect(msgs().some((m) => m.startsWith("bad id"))).toBe(true);
  });
  it("duplicate id", () => {
    put("a.md", "good.md");
    put("b.md", "dup-id.md");
    expect(msgs().some((m) => m.startsWith("duplicate id LP-PC-01"))).toBe(true);
  });
  it("unknown evidence", () => {
    put("a.md", "unknown-evidence.md");
    expect(msgs()).toContain("unknown evidence E99");
  });
  it("sections out of order", () => {
    put("a.md", "good.md", (t) => {
      const [head, ...rest] = t.split("## ");
      return [head, ...rest.slice(1, 2), ...rest.slice(0, 1), ...rest.slice(2)].join("## ");
    });
    expect(msgs()).toContain("sections out of order");
  });
  it("doc evidence needs checked date", () => {
    put("a.md", "good.md", (t) => t.replace("evidence: [E3]", "evidence: [{doc: 'https://example.com/x'}]"));
    expect(msgs()).toContain("doc evidence needs checked date");
  });
  it("accepts doc evidence with a checked date", () => {
    put("a.md", "good.md", (t) => t.replace("evidence: [E3]", "evidence: [{doc: 'https://example.com/x', checked: 2026-11-25}]"));
    expect(lintRules(root)).toEqual([]);
  });
  it("id skill code must match skill field", () => {
    put("a.md", "good.md", (t) => t.replace("LP-PC-01", "LP-GE-01"));
    expect(msgs()).toContain("id LP-GE-01 does not match skill prefill-cache");
  });
  it("reports malformed frontmatter without throwing", () => {
    put("a.md", "good.md", (t) => t.replace("saves: prefill", "saves: [unclosed"));
    expect(msgs().some((m) => m.startsWith("bad frontmatter"))).toBe(true);
  });
  it("ignores skills/_template", () => {
    mkdirSync(join(root, "skills", "_template", "rules"), { recursive: true });
    writeFileSync(join(root, "skills", "_template", "rules", "x.md"), "junk");
    expect(lintRules(root)).toEqual([]);
  });
});
