import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { loadCacheFacts } from "../../src/facts.js";
import { loadNoteRuleIds } from "../../src/lint/rules.js";

// What seven real audits asked of the skills, the rules and the fact tables (0.1.0-dev.14).
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const section = (text: string, heading: string): string => {
  const i = text.indexOf(`## ${heading}\n`);
  if (i < 0) return "";
  const j = text.indexOf("\n## ", i + 3);
  return text.slice(i, j < 0 ? undefined : j);
};

describe("the prior-art step", () => {
  const SKILL = read("skills", "llm-call-audit", "SKILL.md");

  it("is a required workflow step before the files are written, and records known with its four kinds", () => {
    expect(SKILL).toMatch(/7\. \*\*Search for prior art \(required, before writing the findings\)\.\*\*[^\n]*open and closed issues and pull requests/);
    expect(SKILL.indexOf("7. **Search for prior art")).toBeLessThan(SKILL.indexOf("9. **Write the files.**"));
    const s = section(SKILL, "Prior art: what the project already knows");
    for (const k of ["`planned`", "`in-progress`", "`reported`", "`declined`"]) expect(s).toContain(k);
    expect(s).toMatch(/not in the totals and not in the static score/);
    expect(s).toMatch(/Your own report is not prior art/);
    expect(s).toMatch(/REST API/);
    expect(section(SKILL, "The findings file")).toMatch(/`known` \(optional\)/);
    expect(section(SKILL, "The findings file")).toMatch(/`overlaps` \(optional\)/);
    expect(section(SKILL, "The findings file")).toMatch(/`size-unknown`/);
    expect(section(SKILL, "The findings file")).toMatch(/`unattended` \(top level, optional\)/);
  });

  it("presenting.md: contribution-policy checks and one complete post with a disclosure line", () => {
    const s = section(read("skills", "llm-call-audit", "presenting.md"), "Auditing someone else's repository");
    expect(s).toMatch(/AI-generated contributions/);
    expect(s).toMatch(/contributor licence agreement \(CLA\)/);
    expect(s).toMatch(/Issue first/);
    expect(s).toMatch(/core-team-only/);
    expect(s).toMatch(/One complete post/);
    expect(s).toMatch(/Do not promise follow-ups/);
    expect(s).toMatch(/disclosure line/);
    expect(s).toMatch(/npm_config_registry=https:\/\/registry\.npmjs\.org\//);
    expect(read("docs", "install.md")).toMatch(/npm_config_registry=https:\/\/registry\.npmjs\.org\/ npx leanprompt install/);
  });
});

describe("LP-GE-11, the metering rule", () => {
  const t = read("skills", "generation-economy", "rules", "LP-GE-11.md");
  const meta = parseDoc(t).meta as { saves: string; severity: string; evidence: { doc: string; checked: unknown }[] };

  it("is a correctness rule: saves none, a severity, recorded as a note", () => {
    expect(meta.saves).toBe("none");
    expect(meta.severity).toBe("medium");
    expect(loadNoteRuleIds(ROOT)).toContain("LP-GE-11");
    expect(section(t, "Waste signal")).toMatch(/No token share[\s\S]*note with `"rule": "LP-GE-11"`/);
  });

  it("states how each provider's fields add up, unfinished calls, and the detection shapes", () => {
    const why = section(t, "Why");
    expect(why).toMatch(/`input_tokens` counts only the tokens after the last cache mark/);
    expect(why).toMatch(/`prompt_tokens` already includes `prompt_tokens_details\.cached_tokens`/);
    expect(why).toMatch(/Unfinished calls are billed too/);
    const d = section(t, "Detect in code");
    expect(d).toMatch(/usage\.input_tokens \* IN_PRICE/);
    expect(d).toMatch(/budget/);
    expect(meta.evidence.map((e) => e.doc)).toContain("https://platform.claude.com/docs/en/build-with-claude/prompt-caching");
  });

  it("the audit skill and LP-PC-01 point at it", () => {
    expect(read("skills", "llm-call-audit", "SKILL.md")).toMatch(/\[LP-GE-11\]\(\.\.\/generation-economy\/rules\/LP-GE-11\.md\)/);
    expect(read("skills", "prefill-cache", "rules", "LP-PC-01.md")).toMatch(/note under \[LP-GE-11\]/);
  });
});

describe("fact tables", () => {
  it("Vercel AI Gateway, Alibaba Model Studio and Azure OpenAI have dated, sourced tables with a cache block", () => {
    const facts = loadCacheFacts(ROOT);
    for (const p of ["vercel-ai-gateway", "alibaba-model-studio", "azure-openai"]) {
      expect(facts.get(p), p).toBeDefined();
      const meta = parseDoc(read("providers", `${p}.md`)).meta as { checked: unknown; source: string };
      expect(String(meta.source)).toMatch(/^https:\/\/(vercel\.com|www\.alibabacloud\.com|learn\.microsoft\.com)\//);
    }
    expect(read("providers", "vercel-ai-gateway.md")).toMatch(/When `caching` is not set, AI Gateway passes your request through without modification/);
    expect(read("providers", "alibaba-model-studio.md")).toMatch(/\| qwen3\.6-plus \| yes \| no/);
    expect(read("providers", "azure-openai.md")).toMatch(/return a `400` error/);
    expect(read("providers", "azure-openai.md")).toMatch(/Both limits cover reasoning tokens/);
  });

  it("openai.md has the Node SDK defaults, how cached tokens add up, and the GPT-5.4 reasoning defaults", () => {
    const o = read("providers", "openai.md");
    expect(o).toMatch(/\| SDK timeout and retries, Node \|[^\n]*requests which time out will be retried twice by default[^\n]*https:\/\/github\.com\/openai\/openai-node/);
    expect(o).toMatch(/\| Total input \|[^\n]*Cached tokens present in the prompt/);
    expect(o).toMatch(/\| `gpt-5\.4-mini` \|[^\n]*\| `none` \|/);
  });
});

describe("docs", () => {
  it("score.md and the CHANGELOG state the score change, and DESIGN records the decision", () => {
    expect(read("docs", "score.md")).toMatch(/\*\*This is a score change, in 0\.1\.0-dev\.14\.\*\*/);
    expect(read("docs", "CHANGELOG.md")).toMatch(/## 0\.1\.0-dev\.14[\s\S]*### Score change[\s\S]*## 0\.1\.0-dev\.13/);
    const d = read("docs", "DESIGN.md");
    expect(d).toMatch(/## Owner decisions \(2026-11-27, 0\.1\.0-dev\.14\)[\s\S]*supersedes "a metering rule was considered and not added"/);
  });
});
