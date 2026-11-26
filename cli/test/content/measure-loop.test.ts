import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/frontmatter.js";
import { assertStableHead, type Built } from "../../../skills/measure-loop/templates/stable-head.template.js";
import { createApp as datedChat } from "../../../examples/dated-chat/app.js";
import { createApp as dictTools } from "../../../examples/dict-tools-agent/app.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL = readFileSync(join(ROOT, "skills", "measure-loop", "SKILL.md"), "utf8");
const body = SKILL.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "");

const dates = [new Date("2026-11-03T08:15:42Z"), new Date("2026-11-04T17:02:09Z")] as [Date, Date];
const sessions = [0, 1] as [number, number];
const datedBuild = (form: "before" | "after") => async () => {
  const app = await datedChat(form);
  return (now: Date): Built => app.buildRequest("Where is my order?", { session: 0, turn: 0, now });
};
const toolsBuild = (form: "before" | "after") => async () => {
  const app = await dictTools(form);
  return (session: number): Built => app.buildRequest("Where is my order?", { session, turn: 0, now: dates[0] });
};

describe("stable-head template against the example apps", () => {
  it("dated-chat before fails on sys; loose_sys differs too, because a labelled time is not noise to loose/1", async () => {
    const b = await datedBuild("before")();
    expect(() => assertStableHead(b, dates, { sys: true })).toThrow("`sys` differs, `loose_sys` differs: the system prompt changed in content");
  });
  it("a bare date line in the system prompt fails with the sys / loose_sys message", () => {
    const b = (day: string): Built => ({ dialect: "openai.chat", body: { messages: [{ role: "system", content: `${day}\nYou are a support assistant.` }, { role: "user", content: "hi" }] } });
    expect(() => assertStableHead(b, ["2026-11-03", "2026-11-04"], { sys: true })).toThrow("`sys` differs, `loose_sys` equal: the system prompt changed only in noise");
  });
  it("dated-chat after passes on the head; nodes[0] differs because the time rides in the user message", async () => {
    const b = await datedBuild("after")();
    expect(() => assertStableHead(b, dates, { sys: true, tools: true })).not.toThrow();
    expect(() => assertStableHead(b, dates, { nodesUpTo: 1 })).toThrow("`nodes[0]` differs");
  });
  it("dict-tools-agent before fails on tools", async () => {
    const b = await toolsBuild("before")();
    expect(() => assertStableHead(b, sessions, { tools: true })).toThrow(/`tools` differs/);
  });
  it("dict-tools-agent after passes", async () => {
    const b = await toolsBuild("after")();
    expect(() => assertStableHead(b, sessions, { sys: true, tools: true, nodesUpTo: 1 })).not.toThrow();
  });
  it("an unidentifiable request fails loudly instead of passing", () => {
    expect(() => assertStableHead(() => ({ dialect: "openai.chat", body: "not json {" }), ["a", "b"], { sys: true })).toThrow(/could not identify/);
  });
});

describe("measure-loop SKILL.md", () => {
  it("has Agent Skills frontmatter", () => {
    const { meta } = parseDoc(SKILL);
    expect(meta.name).toBe("measure-loop");
    expect(String(meta.description)).toMatch(/^Use when /);
  });
  it("names every usage field", () => {
    for (const f of ["prompt_tokens_details.cached_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "cachedContentTokenCount"]) expect(SKILL).toContain(f);
  });
  it("names the kvsig installs at 0.1.0 and the logger imports", () => {
    expect(SKILL).toContain("kvsig==0.1.0");
    expect(SKILL).toContain("@kvsig/core@0.1.0");
    expect(SKILL).toContain("leanprompt/log");
    expect(SKILL).toContain("from leanprompt_cli import Logger");
    expect(SKILL).toContain("leanprompt-cli");
  });
  it("never recommends loose/2 and carries the limits", () => {
    expect(body).toMatch(/never[^.\n]*loose\/2/i);
    expect(body).toMatch(/at least 50 measured calls/);
    expect(body).toMatch(/character share/i);
    expect(body).toContain("docs/calibration.md");
    expect(body).toContain("https://github.com/Podwarden/kvsig/blob/main/docs/reading-the-ids.md");
  });
  it("states the measured-call threshold, the failed-call limit and that the lifetime changes E only", () => {
    expect(body).toMatch(/at least 50 measured calls/);
    expect(body).toMatch(/Failed calls are unmeasured[\s\S]*finish `error`[\s\S]*not counted as zero/);
    expect(body).toMatch(/changes the cache-reuse figure \(E\) only; the stability figure \(S\) ignores it/);
    expect(body).not.toMatch(/price card/);
  });
  it("has no internal jargon and no percentage without an evidence citation", () => {
    expect(body).not.toMatch(/owner ruling|\bD1\b|Task \d+/i);
    for (const line of body.split("\n")) if (/\d\s*%/.test(line)) expect(line).toMatch(/\(E\d+\)/);
  });
  it("asks before a billed replay and before adding the stable-head test", () => {
    const step = (n: number) => body.split("\n").find((l) => l.startsWith(`${n}. **`)) ?? "";
    expect(step(3)).toMatch(/real requests[^.]*billed/);
    expect(step(3)).toMatch(/ask/i);
    expect(step(5)).toMatch(/own small diff, and add it only after the user says yes/);
    const replay = body.split(/\n\s*\n/).find((p) => p.startsWith("For a before and after")) ?? "";
    expect(replay).toMatch(/real requests[^.]*billed[^.]*ask the user before you start/);
  });
  it("has an ask-first consent rule near the top", () => {
    const sec = parseDoc(SKILL).sections;
    const i = sec.findIndex((s) => s.heading === "Ask first");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(sec.findIndex((s) => s.heading === "Workflow"));
    const p = sec[i]!.body;
    for (const r of [/edit the app's code/, /install a package/, /add a file outside `\.leanprompt\/`/, /billed/, /ask/, /run it themselves/, /No ask is needed/]) expect(p).toMatch(r);
  });
  it("every step or paragraph that runs, installs, applies, adds, copies or replays also asks", () => {
    const sec = parseDoc(SKILL).sections;
    const pick = (h: string) => sec.find((s) => s.heading === h)?.body ?? "";
    const action = /\b(run|runs|install|apply|add|adds|copy|replay|replays)\b/i;
    const consent = /\bask|propos|offer|with the user|if the user|user says yes|the user runs|let them run/i;
    const exempt = /npx leanprompt (score|calibrate)|leanprompt calibrate|runs offline|scores the audit/;
    const units = [
      ...pick("Workflow").split("\n").filter((l) => /^\d+\. /.test(l)),
      ...["Log every call", "Replay: send a recorded session twice", "The stable-head test (kvsig ids in CI)"].flatMap((h) =>
        pick(h).split(/^###/m)[0]!.replace(/^```[\s\S]*?^```/gm, "").split(/\n\s*\n/).filter((p) => !p.trim().startsWith("|")),
      ),
    ];
    expect(units.length).toBeGreaterThan(5);
    for (const u of units) if (action.test(u) && !exempt.test(u)) expect(u, u.slice(0, 80)).toMatch(consent);
  });
  it("does not present the replay harness as a CLI command or as free", () => {
    expect(body).not.toContain("npx leanprompt eval");
    const replay = body.split(/\n\s*\n/).find((p) => p.startsWith("For a before and after")) ?? "";
    expect(replay).toMatch(/sim:[\s\S]*costs nothing[\s\S]*real requests, which are billed/);
  });
  it("links every file it points at", () => {
    for (const m of body.matchAll(/\]\((\.\.?\/[^)#]+)/g)) expect(() => readFileSync(join(ROOT, "skills", "measure-loop", m[1]!))).not.toThrow();
  });
});
