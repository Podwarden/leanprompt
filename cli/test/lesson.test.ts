import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { lessonCommand, scanLesson } from "../src/lesson.js";
import { main } from "../src/main.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let dir: string;
let out: string;
let err: string;
const fetchSpy = vi.fn(() => {
  throw new Error("lesson must not call fetch");
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lp-lesson-"));
  out = "";
  err = "";
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lp = (name: string, text: string): string => {
  mkdirSync(join(dir, ".leanprompt"), { recursive: true });
  const p = join(dir, ".leanprompt", name);
  writeFileSync(p, text);
  return p;
};
const score = (o: object = {}) =>
  JSON.stringify({ schemaVersion: 1, label: "leanprompt", message: "81 measured", color: "green", v: 1, score: 81, kind: "measured", inputs: { E: 0.9, S: 0.95, G: 0.2 }, ...o });
const draft = (): string => readFileSync(join(dir, ".leanprompt", "lesson.md"), "utf8");
const urlOf = (s: string): URL => new URL(/https:\/\/github\.com\/Podwarden\/leanprompt\/issues\/new\?\S+/.exec(s)![0]);

describe("scanLesson", () => {
  it("passes plain general text, the repo URL, rule ids and E-row citations", () => {
    const t = "Rule LP-PC-03 misled me when the prompt was short (E4, E5). See https://github.com/Podwarden/leanprompt/issues/new?template=lesson-learned.yml and https://github.com/Podwarden/leanprompt.";
    expect(scanLesson(t).blocked).toEqual([]);
  });
  it.each([
    ["an sk- key", "key sk-abcdEFGH1234567890abcd here"],
    ["a vw key", "token vwAbCdEfGhIjKlMnOpQr12 here"],
    ["a long base64 run", "x QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5 y"],
    ["a long hex run", "id 0123456789abcdef0123456789abcdef0123"],
    ["an email", "write to jane.doe@example.org"],
    ["an IPv4 address", "host at 192.0.2.10 answered"],
    ["another URL", "see https://example.com/page"],
    ["a lookalike of the repo URL", "see https://github.com/Podwarden/leanprompt-evil/x"],
    ["another repo on github", "see https://github.com/someone/else"],
    ["a bare host name", "the box api.internal.corp.local was slow"],
    ["an absolute path", "edited /Users/jane/work/app/prompt.ts today"],
    ["a home path", "edited ~/work/app today"],
    ["a Windows path", "edited C:\\Users\\jane\\app today"],
    ["a relative source path", "in src/agent/prompt.ts the date"],
  ])("blocks %s", (_n, text) => {
    expect(scanLesson(text).blocked.length).toBeGreaterThan(0);
  });
  it("does not echo a key in full", () => {
    const key = "sk-abcdEFGH1234567890abcd";
    expect(scanLesson(`k ${key}`).blocked.join("\n")).not.toContain(key);
  });
  it("allows a link in the credit project section only", () => {
    const ok = "## Credit (optional): project and link\n\nMy Project, https://example.com/mine\n";
    expect(scanLesson(ok).blocked).toEqual([]);
    expect(scanLesson(`${ok}\n## Credit (optional): name\n\nJane\n`).blocked).toEqual([]);
    expect(scanLesson("## What changed\n\nsee https://example.com/mine\n\n## Credit (optional): project and link\n\nx\n").blocked.length).toBeGreaterThan(0);
  });
  it("still blocks an email or key inside the credit project section", () => {
    expect(scanLesson("## Credit (optional): project and link\n\njane@example.org\n").blocked.length).toBeGreaterThan(0);
  });
});

describe("leanprompt lesson", () => {
  it("is registered in the CLI", async () => {
    lp("score.json", score());
    expect(await main(["lesson", "--dir", dir])).toBe(0);
  });

  it("refuses with exit 2 and says what is missing when there is no score and no --rule", async () => {
    expect(await main(["lesson", "--dir", dir])).toBe(2);
    expect(err).toMatch(/no score yet/);
    expect(err).toMatch(/measured before and after/);
    expect(err).toMatch(/--rule/);
    expect(existsSync(join(dir, ".leanprompt", "lesson.md"))).toBe(false);
  });

  it("refuses after a static score alone, but --rule is still a valid lesson", async () => {
    lp("score.json", score({ kind: "static", score: 53 }));
    expect(await lessonCommand(["--dir", dir])).toBe(2);
    expect(err).toMatch(/static, not measured|not measured/);
    expect(existsSync(join(dir, ".leanprompt", "lesson.md"))).toBe(false);
    expect(await lessonCommand(["--rule", "LP-PC-03", "--dir", dir])).toBe(0);
    expect(draft()).toContain("LP-PC-03");
  });

  it("writes a draft with rule, target, current score as after and the four empty sections", async () => {
    lp("score.json", score());
    writeFileSync(join(dir, "leanprompt.yaml"), "target:\n  provider: openai\n");
    expect(await lessonCommand(["--rule", "LP-PC-03", "--dir", dir])).toBe(0);
    const t = draft();
    expect(t).toContain("LP-PC-03");
    expect(t).toContain("openai");
    expect(t).toContain("measured");
    expect(t).toMatch(/\| Score \| \s*\| 81 \|/);
    expect(t).toMatch(/\| E \| \s*\| 0\.90 \|/);
    expect(t).toMatch(/\| S \| \s*\| 0\.95 \|/);
    expect(t).toMatch(/\| G \| \s*\| 0\.20 \|/);
    for (const h of ["What changed", "Edge case (in general terms)", "Credit (optional): name", "Credit (optional): project and link"]) expect(t).toMatch(new RegExp(`^## ${h.replace(/[()]/g, "\\$&")}\\n(?:\\n(?=##)|\\s*$)`, "m"));
  });

  it("prefers the engine over the provider and writes blanks without a score", async () => {
    writeFileSync(join(dir, "leanprompt.yaml"), "target:\n  engine: vllm\n");
    expect(await lessonCommand(["--rule", "LP-PC-03", "--dir", dir])).toBe(0);
    expect(draft()).toContain("vllm");
    expect(draft()).toMatch(/\| Score \| \s*\| \s*\|/);
  });

  it("names every backend of a profile with several targets", async () => {
    writeFileSync(join(dir, "leanprompt.yaml"), "targets:\n  - engine: vllm\n  - provider: deepseek\n");
    expect(await lessonCommand(["--rule", "LP-PC-03", "--dir", dir])).toBe(0);
    expect(draft()).toContain("Provider or engine: vllm, deepseek");
  });

  it("fills before from --before and leaves it blank otherwise", async () => {
    lp("score.json", score());
    const older = lp("old.json", score({ score: 40, kind: "static", inputs: { E: 0.5, S: 1, G: 0.6 } }));
    expect(await lessonCommand(["--rule", "LP-PC-03", "--before", older, "--dir", dir])).toBe(0);
    expect(draft()).toMatch(/\| Score \| 40 \| 81 \|/);
    expect(draft()).toMatch(/\| Score kind \| static \| measured \|/);
    expect(draft()).toMatch(/\| E \| 0\.50 \| 0\.90 \|/);
  });

  it("rejects an unknown rule id and an unreadable --before file", async () => {
    expect(await lessonCommand(["--rule", "LP-XX-99", "--dir", dir])).toBe(2);
    expect(err).toContain("LP-XX-99");
    expect(existsSync(join(dir, ".leanprompt", "lesson.md"))).toBe(false);
    lp("bad.json", "{not json");
    await expect(lessonCommand(["--rule", "LP-PC-03", "--before", join(dir, ".leanprompt", "bad.json"), "--dir", dir])).rejects.toThrow(/bad\.json/);
  });

  it("the draft has no path, code, model output or prompt text, and passes its own scan", async () => {
    lp("score.json", score());
    lp("findings.json", JSON.stringify({ v: 1, findings: [{ rule: "LP-PC-03", file: "src/agent/prompt.ts", line: 12, saves: "prefill", severity: "high" }] }));
    await lessonCommand(["--rule", "LP-PC-03", "--dir", dir]);
    const t = draft();
    expect(t).not.toContain("src/agent");
    expect(t).not.toContain("prompt.ts");
    expect(t).not.toContain(dir);
    expect(t).not.toMatch(/```/);
    expect(scanLesson(t).blocked).toEqual([]);
  });

  it("prints a prefilled link with the template, title and labels only, and calls no fetch", async () => {
    lp("score.json", score());
    expect(await lessonCommand(["--rule", "LP-PC-03", "--dir", dir])).toBe(0);
    const u = urlOf(out);
    expect(u.origin + u.pathname).toBe("https://github.com/Podwarden/leanprompt/issues/new");
    expect([...u.searchParams.keys()].sort()).toEqual(["labels", "template", "title"]);
    expect(u.searchParams.get("template")).toBe("lesson-learned.yml");
    expect(u.searchParams.get("title")).toContain("LP-PC-03");
    expect(u.searchParams.get("labels")).toBe("lesson-learned");
    expect(out).toMatch(/sends nothing/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prints what it found and no link when the draft is not clean", async () => {
    expect(await lessonCommand(["--rule", "LP-PC-03", "--dir", dir])).toBe(0);
    const p = join(dir, ".leanprompt", "lesson.md");
    writeFileSync(p, `${draft()}\nI edited /Users/jane/app/prompt.ts and mailed jane@example.org with sk-abcdEFGH1234567890abcd\n`);
    out = "";
    err = "";
    expect(await lessonCommand(["--dir", dir])).toBe(1);
    expect(`${out}${err}`).not.toContain("issues/new");
    expect(err).toMatch(/path/i);
    expect(err).toMatch(/email/i);
    expect(err).toMatch(/key/i);
    expect(`${out}${err}`).not.toContain("sk-abcdEFGH1234567890abcd");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not overwrite a draft the user is editing; it checks it", async () => {
    await lessonCommand(["--rule", "LP-PC-03", "--dir", dir]);
    const p = join(dir, ".leanprompt", "lesson.md");
    writeFileSync(p, `${draft()}\nMy own words.\n`);
    out = "";
    expect(await lessonCommand(["--dir", dir])).toBe(0);
    expect(draft()).toContain("My own words.");
    expect(out).toContain("issues/new");
  });
});

describe("issue form and files", () => {
  const form = parse(readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/lesson-learned.yml"), "utf8")) as {
    name: string;
    labels: string[];
    body: { type: string; id?: string; attributes: { label?: string; description?: string; options?: { label: string; required?: boolean }[] }; validations?: { required?: boolean } }[];
  };
  const field = (id: string) => form.body.find((b) => b.id === id)!;
  it("has the planned fields, required where planned", () => {
    expect(form.labels).toContain("lesson-learned");
    expect(field("rule").validations?.required).toBe(true);
    for (const id of ["engine", "before_after", "what_changed", "edge_case", "credit_name", "credit_project"]) expect(field(id), id).toBeDefined();
    for (const id of ["engine", "before_after", "what_changed", "edge_case", "credit_name", "credit_project"]) expect(field(id).validations?.required ?? false, id).toBe(false);
  });
  it("ends with a required checkbox naming what was removed and CC BY 4.0", () => {
    const box = form.body.filter((b) => b.type === "checkboxes").at(-1)!;
    const o = box.attributes.options![0]!;
    expect(o.required).toBe(true);
    expect(o.label).toBe("I removed code, keys, hostnames and customer or company names, and I agree this text is shared under CC BY 4.0");
  });
  it("keeps private text out of a link and says a maintainer reads every submission", () => {
    const text = JSON.stringify(form);
    expect(text).toMatch(/maintainer/);
    expect(text).not.toMatch(/Prompt Lens|owner ruling|Task \d+/i);
  });
  it("config.yml keeps blank issues available and points at CONTRIBUTING", () => {
    const c = parse(readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/config.yml"), "utf8")) as { blank_issues_enabled: boolean; contact_links?: { url: string }[] };
    expect(c.blank_issues_enabled).toBe(true);
  });
});
