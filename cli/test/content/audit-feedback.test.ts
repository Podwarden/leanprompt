import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";

// What four real audits asked of the skills and rules (0.1.0-dev.13).
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const rule = (skill: string, id: string) => read("skills", skill, "rules", `${id}.md`);
const section = (text: string, heading: string): string => {
  const i = text.indexOf(`## ${heading}\n`);
  if (i < 0) return "";
  const j = text.indexOf("\n## ", i + 3);
  return text.slice(i, j < 0 ? undefined : j);
};

describe("rules", () => {
  it("every rule that lists vllm also lists lm-warden", () => {
    for (const skill of ["prefill-cache", "generation-economy", "prompt-diet", "lmwarden"]) {
      for (const f of readdirSync(join(ROOT, "skills", skill, "rules"))) {
        const meta = parseDoc(read("skills", skill, "rules", f)).meta as { applies_to: string[] };
        if (meta.applies_to.includes("vllm")) expect(meta.applies_to, f).toContain("lm-warden");
      }
    }
  });

  it("LP-GE-05: truncation as an SDK exception, exclusion-list filters, raise the limit when reasoning cannot be turned off, an empty stop may be retried", () => {
    const t = rule("generation-economy", "LP-GE-05");
    expect(t).toContain("LengthFinishReasonError");
    expect(t).toContain("ContentFilterFinishReasonError");
    expect(t).toContain("retry_if_not_exception_type");
    expect(section(t, "Why")).toMatch(/cannot turn its reasoning off[^\n]*raise the limit on that attempt instead of removing the retry/);
    expect(section(t, "Why")).toMatch(/empty answer is a model glitch[^.]*; one retry of it is fine/);
    expect(section(t, "Waste signal")).toMatch(/frequency-unknown/);
    expect(read("providers", "openai.md")).toMatch(/LengthFinishReasonError[^\n]*https:\/\/github\.com\/openai\/openai-python\/blob\/main\/helpers\.md/);
  });

  it("LP-PC-01: a severity for partial marking, the spend-meter warning, and the cache-write estimate", () => {
    const t = rule("prefill-cache", "LP-PC-01");
    expect(section(t, "Waste signal")).toMatch(/Medium for partial marking/);
    expect(section(t, "Fix")).toMatch(/meters its own spend[\s\S]*cache_read_input_tokens \+ cache_creation_input_tokens \+ input_tokens/);
    expect(section(t, "Fix")).toContain("`cache_write`");
    expect(read("providers", "anthropic.md")).toMatch(/\| Total input \|[^\n]*checked 2026-11-26/);
  });

  it("LP-GE-04: a serverless function's time limit around a whole agent turn", () => {
    const t = rule("generation-economy", "LP-GE-04");
    expect(section(t, "Why")).toMatch(/maxDuration/);
    expect(section(t, "Detect in code")).toMatch(/maxDuration/);
    expect(read("runtimes", "http-clients.md")).toMatch(/\| Vercel Functions \|[^\n]*https:\/\/vercel\.com\/docs\/functions\/configuring-functions\/duration/);
  });

  it("LP-PC-09: a template that writes the effort into the system message, a fact read from the model's own template", () => {
    const t = rule("prefill-cache", "LP-PC-09");
    expect(section(t, "Why")).toMatch(/system message itself[\s\S]*single-turn calls/);
    expect(section(t, "Detect in code")).toMatch(/question for the server's administrator[\s\S]*fix_by: "server"/);
    const q = read("models", "qwen.md");
    expect(q).toMatch(/## Where the template writes the effort \(Qwen3\.8-27B\)\n\nRead in the model's `chat_template\.jinja` at the source URL on 2026-11-26/);
  });

  it("LP-LW-01 and LP-LW-02 frame engine facts and replicas as questions for the server's administrator", () => {
    expect(section(rule("lmwarden", "LP-LW-01"), "Waste signal")).toMatch(/server's administrator[\s\S]*profile detect --lmwarden/);
    expect(section(rule("lmwarden", "LP-LW-02"), "Waste signal")).toMatch(/question for the server's administrator, not a defect/);
  });
});

describe("the audit skill", () => {
  const SKILL = read("skills", "llm-call-audit", "SKILL.md");
  const PRESENTING = read("skills", "llm-call-audit", "presenting.md");

  it("reads the project's own rules and plans, honours them, and links planned work", () => {
    expect(SKILL).toMatch(/2\. \*\*Read the project's own rules and plans\.\*\*[^\n]*CLAUDE\.md[^\n]*AGENTS\.md[^\n]*ADRs[^\n]*#233/);
    const s = section(SKILL, "Project rules and planned work");
    expect(s).toMatch(/do not propose it/);
    expect(s).toMatch(/repair the reply locally/);
    expect(s).toMatch(/`planned`/);
    expect(s).toMatch(/written as a question|write `problem` as a question/);
  });

  it("records notes for verified problems outside the rules, never scored", () => {
    const s = section(SKILL, "Problems outside the rules");
    expect(s).toMatch(/spend meter/);
    expect(s).toMatch(/cut-off answer accepted as complete/);
    expect(s).toMatch(/never scored/);
    expect(section(SKILL, "The findings file")).toMatch(/`notes` \(top level, optional\)/);
  });

  it("documents the two unknowns, fix_by, the two shares, share 0 and an empty tokens_per_1k", () => {
    const s = section(SKILL, "The findings file");
    expect(s).toMatch(/`frequency-unknown`: the code shows the problem for certain/);
    expect(s).toMatch(/`fix_by` \(optional\)/);
    expect(s).toMatch(/`share_prefill` and `share_output`/);
    expect(s).toMatch(/`share: 0` is valid/);
    expect(s).toMatch(/leave it out, or write `\{\}`, when nothing can be estimated/);
  });

  it("has an unattended mode and writes the report with report --md", () => {
    expect(SKILL).toMatch(/If you cannot ask \(an unattended run[\s\S]*Questions for the owner/);
    expect(SKILL).toMatch(/`npx leanprompt report --md`, which writes `leanprompt-report\.md`/);
    expect(PRESENTING).toMatch(/If you cannot ask \(an unattended run/);
  });

  it("has etiquette for auditing someone else's repository", () => {
    const s = section(PRESENTING, "Auditing someone else's repository");
    expect(s).toMatch(/--scope=global/);
    expect(s).toMatch(/\.git\/info\/exclude/);
    expect(s).toMatch(/policy on AI-generated/);
    expect(s).toMatch(/one verified finding at a time/);
  });

  it("presenting.md lists every key leanprompt.yaml accepts", () => {
    expect(PRESENTING).toMatch(/accepts only `target` \(or `targets`\), `engine`, `priority`, `ignore`, `volume` and `prices`/);
  });
});

describe("docs", () => {
  it("score.md states the score change plainly, and DESIGN.md records the owner decision", () => {
    expect(read("docs", "score.md")).toMatch(/\*\*This is a score change, in 0\.1\.0-dev\.13\.\*\*/);
    expect(read("docs", "CHANGELOG.md")).toMatch(/## 0\.1\.0-dev\.13[\s\S]*### Score change/);
    expect(read("docs", "DESIGN.md")).toMatch(/## Owner decisions \(2026-11-26, 0\.1\.0-dev\.13\)[\s\S]*Pre-1\.0 score changes \(flagged clearly\)/);
  });
});
