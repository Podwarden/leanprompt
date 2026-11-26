import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { loadEvidenceIds, loadRuleIds } from "../../src/lint/rules.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = join(ROOT, "skills", "llm-call-audit");
const FILES = ["SKILL.md", "call-shapes.md", "report-template.md", "presenting.md"] as const;
const read = (f: string): string => (existsSync(join(DIR, f)) ? readFileSync(join(DIR, f), "utf8") : "");
/** Everything after the frontmatter block. */
const body = (text: string): string => text.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "");
const all = () => FILES.map((f) => [f, read(f)] as const);
const SKILL = () => read("SKILL.md");
const PRESENTING = () => body(read("presenting.md"));
/** The first paragraph (blank-line separated, not a heading) of a text that matches `re`, or "". */
const para = (text: string, re: RegExp): string => text.split(/\n\s*\n/).find((p) => !p.startsWith("#") && re.test(p)) ?? "";
/** The body of a `## heading` section, or "". */
const section = (text: string, heading: string): string => parseDoc(text).sections.find((s) => s.heading === heading)?.body ?? "";
/** Text with fenced code blocks removed (template placeholders live there). */
const unfenced = (text: string): string => text.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");

describe("llm-call-audit skill files", () => {
  it("has every planned file", () => {
    for (const f of FILES) expect(existsSync(join(DIR, f)), f).toBe(true);
  });

  it("SKILL.md has Agent Skills frontmatter", () => {
    const { meta } = parseDoc(SKILL());
    expect(meta.name).toBe("llm-call-audit");
    expect(String(meta.description)).toMatch(/^Use when /);
    expect(meta.license).toBe("CC-BY-4.0");
  });

  it("call-shapes.md lists every SDK and endpoint shape from the design", () => {
    const shapes = read("call-shapes.md");
    for (const s of [
      "`anthropic`",
      "`openai`",
      "`@anthropic-ai/sdk`",
      "`google-genai`",
      "LangChain",
      "LlamaIndex",
      "LiteLLM",
      "Vercel AI SDK",
      "/v1/chat/completions",
      "/v1/messages",
      "/v1/responses",
    ])
      expect(shapes, s).toContain(s);
    for (const lang of ["Python", "TS/JS", "Go"]) expect(shapes, lang).toContain(lang);
    for (const kind of ["chat", "agent loop", "one-shot", "batch"]) expect(shapes, kind).toMatch(new RegExp(kind, "i"));
  });

  it("every rule id referenced in the skill's files exists", () => {
    const known = loadRuleIds(ROOT);
    expect(known.size).toBeGreaterThan(0);
    let seen = 0;
    for (const [f, t] of all()) {
      for (const m of t.matchAll(/LP-(?:PC|GE|PD|LW)-\d+/g)) {
        seen++;
        expect(known.has(m[0]), `${f}: ${m[0]}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("every cited evidence row exists", () => {
    const known = loadEvidenceIds(ROOT);
    for (const [f, t] of all()) for (const m of body(t).matchAll(/\bE(\d+)\b/g)) expect(known.has(`E${m[1]}`), `${f}: E${m[1]}`).toBe(true);
  });

  it("every relative link resolves", () => {
    let links = 0;
    for (const [f, t] of all()) {
      for (const m of unfenced(t).matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) {
        links++;
        expect(existsSync(join(dirname(join(DIR, f)), m[1]!)), `${f}: ${m[1]}`).toBe(true);
      }
    }
    expect(links).toBeGreaterThan(0);
  });

  it("links to the other five skills instead of restating their rules", () => {
    const s = SKILL();
    for (const k of ["prefill-cache", "generation-economy", "prompt-diet", "measure-loop", "lmwarden"]) expect(s).toContain(`../${k}/SKILL.md`);
    // Rule bodies stay in their own files: no Fix or Verify sections copied in.
    for (const [f, t] of all()) expect(t, f).not.toMatch(/^## (Rule|Why|Detect in code|Fix|Don't break meaning|Waste signal)$/m);
  });

  it("no percentage without an evidence citation; no internal jargon, hype or 'documented'", () => {
    for (const [f, t] of all()) {
      const b = body(t);
      for (const line of b.split("\n")) if (/\d\s*%/.test(line)) expect(line, f).toMatch(/\(E\d+\)/);
      expect(b, f).not.toMatch(/owner ruling|ruling D\d|\bD\d\b|\bQ\d\b|Task \d+|Open item/i);
      expect(b, f).not.toMatch(/up to \d|AI-powered|!\s/i);
      expect(b, f).not.toMatch(/\bdocumented\b/i);
    }
  });

  it("Prompt Lens appears only as planned", () => {
    for (const [f, t] of all()) for (const line of t.split("\n")) if (/Prompt Lens/.test(line)) expect(line, f).toMatch(/planned/i);
  });
});

describe("llm-call-audit SKILL.md workflow", () => {
  it("never edits code without asking and proposes one fix per finding", () => {
    expect(SKILL()).toMatch(/never edits code without asking/i);
    expect(SKILL()).toMatch(/one fix per finding/i);
  });

  it("hands over to measure-loop to prove each fix", () => {
    expect(para(SKILL(), /hand(s)? over to `measure-loop`/i)).not.toBe("");
  });

  it("reads leanprompt.yaml or asks for the target and priority", () => {
    const p = para(SKILL(), /`leanprompt\.yaml`/);
    expect(p).toMatch(/target/);
    expect(p).toMatch(/priority/);
    expect(p).toMatch(/ask/i);
    expect(SKILL()).toContain("../../docs/profile.md");
  });

  it("applies the break-even rule before recommending a cache mark", () => {
    const p = section(SKILL(), "The break-even rule for cache marks");
    expect(p).toMatch(/before (recommending|proposing) a cache mark/i);
    expect(p).toMatch(/mark, don't mark, longer lifetime, restructure|mark \/ don't mark/i);
    expect(SKILL()).toContain("../prefill-cache/rules/LP-PC-01.md");
  });

  it("after a static score offers a trial run with leanprompt calibrate on real or synthetic data", () => {
    const p = section(SKILL(), "Calibrating a static score");
    expect(p).toContain("leanprompt calibrate");
    expect(p).toMatch(/static/);
    expect(p).toMatch(/trial run/);
    expect(p).toMatch(/real/);
    expect(p).toMatch(/--synthetic/);
    expect(SKILL()).toContain("../../docs/calibration.md");
  });

  it("ranks findings by estimated tokens lost per 1,000 calls and says how to estimate from code", () => {
    const s = SKILL();
    expect(s).toMatch(/tokens lost per 1,000 calls/);
    expect(s).toMatch(/## Estimating tokens lost per 1,000 calls/);
    expect(para(s, /no usage log/i)).toMatch(/estimate/i);
  });

  it("describes the CLI as the code does", () => {
    const s = SKILL();
    expect(s).toContain("npx leanprompt score");
    expect(s).toContain(".leanprompt/findings.json");
    expect(s).toContain(".leanprompt/usage.jsonl");
    expect(s).toContain(".leanprompt/score.json");
    expect(s).toMatch(/at least 50 measured calls/);
    expect(s).toContain("--static");
    expect(s).toContain("leanprompt profile detect --lmwarden");
    // The findings format the parser accepts.
    for (const k of ["rule", "file", "line", "saves", "severity", "share", "fixed"]) expect(s).toContain(`\`${k}\``);
    expect(s).toMatch(/"v": ?1/);
  });

  it("uses the heads diagnostic to raise the findings the measured score cannot see", () => {
    const p = section(SKILL(), "The heads diagnostic");
    expect(p).toContain("diagnostics.heads");
    expect(p).toContain("distinct_head");
    expect(p).toContain("conversations");
    for (const id of ["LP-PC-03", "LP-PC-07", "LP-PC-08"]) expect(p).toContain(id);
  });

  it("links presenting.md, call-shapes.md and the report template from its workflow", () => {
    const wf = parseDoc(SKILL()).sections.find((s) => s.heading === "Workflow")?.body ?? "";
    expect(wf).toContain("(presenting.md)");
    expect(wf).toContain("(call-shapes.md)");
    expect(wf).toContain("(report-template.md)");
  });

  it("writes leanprompt-report.md and the findings file", () => {
    expect(SKILL()).toContain("leanprompt-report.md");
  });
});

describe("llm-call-audit report-template.md", () => {
  it("mirrors the page: costs, findings, hand-off, score, then inventory and next steps", () => {
    const heads = [...read("report-template.md").matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
    expect(heads).toEqual(["What this costs you", "What's wrong and what to change", "Fix it with your coding agent", "Score", "Inventory", "Next steps"]);
  });
  it("opens with a plain-English headline and labels the total as an estimate", () => {
    const t = read("report-template.md");
    expect(t).toMatch(/places? where this app pays for tokens it doesn't need/);
    expect(t).toMatch(/estimate from the code, not a measurement/);
  });
  it("each finding carries problem, change, why, estimate, assumptions and how to check the fix", () => {
    const t = read("report-template.md");
    for (const k of ["**Problem:**", "**What to change:**", "**Why it matters:**", "**Estimate:**", "**Assumes:**", "**How to check the fix:**"]) expect(t).toContain(k);
  });
  it("carries the hand-off block for any coding agent", () => {
    expect(read("report-template.md")).toContain("npx leanprompt install");
    expect(read("report-template.md")).toMatch(/Check each finding against the code before you change anything/);
    expect(read("report-template.md")).toMatch(/only after I say yes/);
  });
  it("money only from the user's volume and a dated price; otherwise tokens and what to add", () => {
    const t = read("report-template.md");
    expect(t).toMatch(/calls_per_month/);
    expect(t).toMatch(/checked/);
    expect(t).toMatch(/never (invent|guess)/i);
  });
  it("carries the inventory columns, per-finding fields and the score kind", () => {
    const t = read("report-template.md");
    for (const c of ["File", "Provider", "Model", "Call kind"]) expect(t).toContain(c);
    for (const c of ["tokens lost per 1,000 calls", "What to change", "How to check the fix"]) expect(t).toContain(c);
    expect(t).toMatch(/static|measured/);
  });
});

describe("llm-call-audit presenting.md", () => {
  it("(1) summary first: call sites, findings, score with its kind, biggest leak with file:line, before any detail", () => {
    const p = para(PRESENTING(), /summary first/i);
    for (const s of [/call sites/, /findings/, /score/, /kind/, /biggest leak/, /file:line/, /before any detail/]) expect(p).toMatch(s);
  });
  it("(2) one finding at a time with the four choices; the last writes an ignore: entry", () => {
    const t = PRESENTING();
    expect(t).toMatch(/one finding at a time/i);
    for (const c of ["`fix now`", "`explain more`", "`skip`", "`don't flag this again`"]) expect(t).toContain(c);
    const p = para(t, /`don't flag this again`[^\n]*`ignore:`|`ignore:`[^\n]*`don't flag this again`/);
    expect(p).toContain("`leanprompt.yaml`");
    expect(p).toMatch(/\{rule: LP-[A-Z]{2}-\d{2}, file: [^}]+\}/);
    expect(p).toMatch(/score/);
  });
  it("(3) the assistant's own question tool, Claude Code's option prompts as the example, else numbered choices", () => {
    const p = para(PRESENTING(), /question tool/i);
    expect(p).toMatch(/Claude Code/);
    expect(p).toMatch(/option/i);
    expect(p).toMatch(/numbered choices/i);
  });
  it("(4) asks only what the code cannot answer and saves each answer to leanprompt.yaml", () => {
    const t = PRESENTING();
    expect(t).toMatch(/only what the code cannot answer/i);
    expect(t).toMatch(/priority/);
    expect(t).toMatch(/reorder[\s\S]{0,80}change answers/i);
    expect(t).toMatch(/never asked twice/i);
    expect(para(t, /never asked twice/i)).toContain("`leanprompt.yaml`");
  });
  it("(5) each fix as a small diff, each proof as a before/after line", () => {
    const t = PRESENTING();
    expect(t).toMatch(/small diff/i);
    expect(t).toContain("cached_tokens: 0 → 18,432");
  });
  it("(6) offers npx leanprompt report --html for more than 10 findings or to share", () => {
    const p = para(PRESENTING(), /npx leanprompt report --html/);
    expect(p).toMatch(/more than 10 findings/);
    expect(p).toMatch(/share/);
  });
});

describe("llm-call-audit asks before proving a fix", () => {
  it("SKILL.md asks before the billed before/after run and offers the stable-head test as its own diff", () => {
    const p = section(SKILL(), "Proving each fix");
    expect(p).toMatch(/`fix now` covers the one diff/);
    expect(p).toMatch(/ask[^.]*run the scenario|ask whether you may run it/i);
    expect(p).toMatch(/real requests[^.]*billed/);
    expect(p).toMatch(/stable-head test[\s\S]*own small diff[\s\S]*only after the user says yes/);
    expect(SKILL()).toMatch(/Prove each fix\.\*\* Ask before running anything that sends requests or adds files/);
  });
  it("presenting.md's fix now bullet asks before the run and the test file", () => {
    const line = PRESENTING().split("\n").find((l) => l.startsWith("- `fix now`")) ?? "";
    expect(line).toMatch(/consents to that diff only/);
    expect(line).toMatch(/real requests[^.]*billed/);
    expect(line).toMatch(/stable-head test as its own small diff, and add it only after the user says yes/);
  });
});

describe("llm-call-audit consent rule", () => {
  it("states the ask-first rule and its exemptions", () => {
    const p = para(SKILL(), /^Ask first:/);
    for (const r of [/edit the app's code/, /install a package/, /add a file outside `\.leanprompt\/`/, /sends requests to a provider \(they are billed\)/, /ask/, /run it themselves/]) expect(p).toMatch(r);
    expect(p).toMatch(/No ask is needed[\s\S]*npx leanprompt score[\s\S]*npx leanprompt calibrate[\s\S]*no network calls/);
  });
  it("does not imply calibrate --synthetic makes calls", () => {
    expect(section(SKILL(), "Calibrating a static score")).toMatch(/--synthetic`, which itself makes no calls/);
  });
});

describe("llm-call-audit asks before writing leanprompt.yaml", () => {
  it("offers to save answers, shows the lines, and writes only on a yes", () => {
    const step = SKILL().split("\n").find((l) => l.startsWith("1. **Know the target and priority.**")) ?? "";
    expect(step).toMatch(/offer to save the answers to `leanprompt\.yaml`[^.]*show the lines that would be written[^.]*only on a yes/);
    expect(step).not.toMatch(/(^|[;.] )save the answers/);
    const p = para(PRESENTING(), /never asked twice/);
    expect(p).toMatch(/^Offer to save each answer to `leanprompt\.yaml`/);
    expect(p).toMatch(/show the lines that would be written[\s\S]*only on a yes/);
    expect(p).toMatch(/not consent to writing the file/);
    expect(p).not.toMatch(/(^|\. )Save each answer/);
  });
});

describe("llm-call-audit: issue #4 decisions", () => {
  const TEMPLATE = () => read("report-template.md");
  it("records each backend of an app with several as a targets entry, offered and written only on a yes, and checks applies_to per backend", () => {
    const step = SKILL().split("\n").find((l) => l.startsWith("1. **Know the target and priority.**")) ?? "";
    expect(step).toMatch(/more than one backend/);
    expect(step).toMatch(/`targets`/);
    expect(step).toMatch(/offer to save[\s\S]*only on a yes/);
    const rules = SKILL().split("\n").find((l) => l.startsWith("3. **Check the rules.**")) ?? "";
    expect(rules).toMatch(/per backend|each backend/);
    expect(rules).toMatch(/`applies_to`[^.]*finding's backend|finding's backend[^.]*`applies_to`/);
    expect(PRESENTING()).toMatch(/`targets:`/);
  });
  it("findings outside the repository: <external>, where, needs-facts and confirm, scored like any other", () => {
    const s = section(SKILL(), "The findings file");
    expect(s).toContain('"<external>"');
    expect(s).toMatch(/`where`/);
    expect(s).toMatch(/`status`[^\n]*`needs-facts`/);
    expect(s).toMatch(/`confirm`/);
    expect(s).toMatch(/count in the static score/);
    expect(TEMPLATE()).toMatch(/### Open questions/);
    expect(TEMPLATE()).toMatch(/Confirm/);
    expect(para(PRESENTING(), /open question/i)).toMatch(/confirm/);
  });
  it("requires a share for every finding, states the formula, and falls back to the default only when no estimate is possible", () => {
    const s = section(SKILL(), "The findings file");
    expect(s).toMatch(/`share`[^\n]*every finding/);
    expect(s).toMatch(/share = [^\n]*÷/);
    expect(s).toMatch(/severity default[^\n]*only when no estimate is possible[^\n]*report/);
    expect(TEMPLATE()).toMatch(/\*\*Share:\*\*/);
    expect(TEMPLATE()).toMatch(/assumptions/i);
    expect(TEMPLATE()).toMatch(/default share/);
    expect(section(SKILL(), "Calibrating a static score")).toMatch(/only the default shares[^.]*matters less|matters less[^.]*default shares/);
  });
});

describe("llm-call-audit: findings explain themselves (0.1.0-dev.6)", () => {
  it("the findings file asks for problem, change, why, estimate, assumptions, verify on every finding, with tokens_per_1k", () => {
    const s = section(SKILL(), "The findings file");
    for (const k of ["problem", "change", "why", "estimate", "assumptions", "verify", "tokens_per_1k", "model"]) expect(s, k).toContain(`\`${k}\``);
    expect(s).toMatch(/every finding/);
    expect(s).toMatch(/600 characters/);
    expect(s).toMatch(/"problem":/);
    expect(s).toMatch(/plain/i);
  });
  it("asks for the monthly volume and offers to look up a dated price, saved to leanprompt.yaml only on a yes", () => {
    const s = section(SKILL(), "Volume and prices");
    expect(s).toMatch(/calls a month|calls_per_month/);
    expect(s).toMatch(/usage log/);
    expect(s).toMatch(/pricing page/);
    expect(s).toMatch(/checked/);
    expect(s).toMatch(/only on a yes/);
    expect(s).toMatch(/never (invent|guess)/i);
    expect(s).toContain("prefill_tokens_per_second");
  });
  it("presenting.md points at the page's hand-off block", () => {
    expect(PRESENTING()).toMatch(/Fix it with your coding agent/);
  });
});
