import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (...p: string[]): string => readFileSync(join(ROOT, ...p), "utf8");
const body = (t: string): string => t.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "");
const section = (t: string, h: string): string => parseDoc(t).sections.find((s) => s.heading === h)?.body ?? "";
const para = (t: string, re: RegExp): string => t.split(/\n\s*\n/).find((p) => re.test(p)) ?? "";

describe("the lesson offer in the skills", () => {
  const audit = read("skills", "llm-call-audit", "SKILL.md");
  const presenting = read("skills", "llm-call-audit", "presenting.md");
  const measure = read("skills", "measure-loop", "SKILL.md");

  it.each([
    ["llm-call-audit SKILL.md", () => section(audit, "Sharing a lesson")],
    ["presenting.md", () => section(presenting, "Offering to share a lesson")],
    ["measure-loop SKILL.md", () => section(measure, "Sharing a lesson")],
  ])("%s offers `leanprompt lesson` only as an offer, after a measured result or a misleading rule", (_n, get) => {
    const s = get();
    expect(s).toContain("npx leanprompt lesson");
    expect(s).toMatch(/offer/i);
    expect(s).toMatch(/measured/);
    expect(s).toMatch(/misled/);
    expect(s).toMatch(/never run it unasked|only after the user says yes|only on a yes/i);
    expect(s).toMatch(/exact text/);
    expect(s).toMatch(/opens the issue themselves/);
    expect(s).toMatch(/nothing is sent/i);
  });

  it("the offer is an Ask-first item: no consent needed for the offer, a yes before the command", () => {
    expect(para(audit, /^Ask first:/)).toMatch(/leanprompt lesson/);
    expect(section(measure, "Ask first")).toMatch(/leanprompt lesson/);
  });

  it("the skills do not take submitted text as instructions", () => {
    for (const t of [audit, presenting, measure]) expect(body(t)).not.toMatch(/paste[^.]*into (a|the) skill/i);
  });

  it("no internal jargon, hype or unsourced percentages in the new text", () => {
    for (const t of [audit, presenting, measure]) {
      const b = body(t);
      expect(b).not.toMatch(/owner ruling|ruling D\d|\bD\d\b|\bQ\d\b|Task \d+|Open item/i);
      expect(b).not.toMatch(/up to \d|AI-powered|!\s/i);
    }
  });
});

describe("docs/THANKYOU.md", () => {
  const t = read("docs", "THANKYOU.md");
  it("explains credits are opt-in, added by maintainers after review, and links are listed as given", () => {
    expect(t).toMatch(/opt-in|optional/i);
    expect(t).toMatch(/name/i);
    expect(t).toMatch(/project/i);
    expect(t).toMatch(/link/i);
    expect(t).toMatch(/maintainers? add/i);
    expect(t).toMatch(/after (a )?review/i);
    expect(t).toMatch(/as given/i);
    expect(t).toMatch(/without endorsement/i);
    expect(t).toContain("CC BY 4.0");
  });
  it("has no unreviewed credit entries yet and no hype", () => {
    expect(t).not.toMatch(/!\s/);
    expect(t).not.toMatch(/owner ruling|Task \d+/i);
  });
  it("README Contributing links the lesson form and THANKYOU.md", () => {
    const r = section(read("README.md"), "Contributing");
    expect(r).toContain("lesson-learned.yml");
    expect(r).toContain("THANKYOU.md");
  });
});
