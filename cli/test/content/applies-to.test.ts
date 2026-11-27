import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RULES = join(ROOT, "skills", "generation-economy", "rules");

/** Generation rules whose fix is a feature only some providers have: the sample-count parameter, the batch API, predicted outputs. */
const PROVIDER_SPECIFIC = new Set(["LP-GE-01", "LP-GE-07", "LP-GE-09"]);

const rules = readdirSync(RULES)
  .filter((f) => /^LP-GE-\d+\.md$/.test(f))
  .map((f) => parseDoc(readFileSync(join(RULES, f), "utf8")).meta as { id: string; applies_to: string[] });

describe("applies_to: provider-independent rules", () => {
  it("finds all eleven generation rules", () => {
    expect(rules.length).toBe(11);
  });

  it("every LP-GE rule whose fix needs no provider feature lists `any`", () => {
    for (const r of rules) {
      if (PROVIDER_SPECIFIC.has(r.id)) continue;
      expect(r.applies_to, r.id).toContain("any");
    }
  });

  it("a rule that needs a provider feature does not list `any`", () => {
    for (const r of rules.filter((x) => PROVIDER_SPECIFIC.has(x.id))) expect(r.applies_to, r.id).not.toContain("any");
  });

  it("covers the four rules issue #2 names (LP-GE-03, 04, 05, 10)", () => {
    for (const id of ["LP-GE-03", "LP-GE-04", "LP-GE-05", "LP-GE-10"])
      expect(rules.find((r) => r.id === id)?.applies_to, id).toContain("any");
  });

  it("the semantics is stated in the template, the audit skill and how-it-works", () => {
    const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
    expect(read("skills", "_template", "RULE.md")).toMatch(/`any`[^]*every target/);
    expect(read("skills", "llm-call-audit", "SKILL.md")).toMatch(/includes `any`/);
    expect(read("skills", "llm-call-audit", "SKILL.md")).toMatch(/restricts only the provider-specific rules/);
    expect(read("docs", "how-it-works.md")).toMatch(/applies to every target/);
    expect(read("docs", "providers.md")).toMatch(/unknown, check the provider's docs/);
  });
});
