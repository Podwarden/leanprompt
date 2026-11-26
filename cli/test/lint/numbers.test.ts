import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ResultFile } from "../../../eval/run.js";
import { checkNumbers, checkNumbersInRepo, resultFileName } from "../../src/lint/numbers.js";

const EVIDENCE = new Set(Array.from({ length: 12 }, (_, i) => `E${i + 1}`));
const result = (kind: ResultFile["kind"]): ResultFile => ({
  v: 1,
  kind,
  app: "dated-chat",
  form: "after",
  provider: "openai",
  model: "gpt-x",
  date: "2026-11-30",
  runs: [],
  spend_usd: 0,
});
const SIM = result("simulated");
const REAL = { ...result("measured"), date: "2026-12-01" };
const msgs = (md: string, results: ResultFile[] = [SIM, REAL]) => checkNumbers(md, results, EVIDENCE).map((i) => i.msg);

describe("checkNumbers", () => {
  it("passes a number that cites a known E-row", () => {
    expect(msgs("92% of prompt tokens came from cache (E1).")).toEqual([]);
  });
  it("fails the same number without a source", () => {
    const m = msgs("92% from cache");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/^line 1: .*92%.*needs a source/);
  });
  it("fails an unknown E-row even when the line has a number", () => {
    expect(msgs("92% from cache (E99)")).toEqual(["line 1: unknown evidence E99"]);
  });
  it("rejects a simulated result as a source (Review Focus 5)", () => {
    const md = `Cached share rose to 80% ([result](eval/results/${resultFileName(SIM)})).`;
    expect(msgs(md)).toContain(`line 1: simulated result cannot be quoted: eval/results/${resultFileName(SIM)}`);
  });
  it("rejects a simulated result even with no number on the line", () => {
    expect(msgs(`See [the run](eval/results/${resultFileName(SIM)}).`)).toEqual([
      `line 1: simulated result cannot be quoted: eval/results/${resultFileName(SIM)}`,
    ]);
  });
  it("accepts a measured result as a source", () => {
    expect(msgs(`Cached share rose to 80% ([result](eval/results/${resultFileName(REAL)})).`)).toEqual([]);
  });
  it("fails a link to a result file that does not exist", () => {
    expect(msgs("Rose to 80% ([r](eval/results/nope.json)).")).toEqual(["line 1: unknown result eval/results/nope.json"]);
  });
  it("ignores version numbers and anything else inside code blocks", () => {
    expect(msgs("```\nnpm i leanprompt@0.1.0\n92% 3x 2.33 s $5 100 tokens\n```\n")).toEqual([]);
    expect(msgs("~~~sh\n92%\n~~~\n")).toEqual([]);
  });
  it("ignores inline code and HTML comments", () => {
    expect(msgs("Run `sleep 10 s` and `$1`.")).toEqual([]);
    expect(msgs("| row | <!-- pending: eval/results --> |")).toEqual([]);
    expect(msgs("<!--\n92% of something\n-->")).toEqual([]);
  });
  it("flags each unit trigger", () => {
    for (const s of ["took 2.33 s", "about 3x more", "10,176 tokens", "cost $0.36", "1.5× faster", "44 %"]) expect(msgs(s)).toHaveLength(1);
  });
  it("does not flag product constants and plain counts", () => {
    for (const s of [
      "A measured score needs at least 50 measured calls and states how many it used.",
      "The AGENTS.md block is at most 40 lines.",
      "Five skills, 25 rules, version 0.1.0, Node 20.19, a body over 2 MiB.",
      "8 sessions on 4 cards",
      "rule LP-PC-03 and E10 limits",
      "a 0x1f byte",
    ])
      expect(msgs(s)).toEqual([]);
  });
  it("accepts several E-rows in one citation and a linked label", () => {
    expect(msgs("47% lost (E7, E1)")).toEqual([]);
    expect(msgs("47% lost ([E7](docs/evidence.md))")).toEqual([]);
  });
  it("refuses a number sourced from a row that is not quotable yet (E8, E12)", () => {
    expect(msgs("reuse went from 45.7% to 89.2% (E8)")).toEqual(["line 1: E8 cannot be quoted with a number yet (see docs/DESIGN.md open questions)"]);
    expect(msgs("A benchmark repeated requests instead of using n samples (E12).")).toEqual([]);
  });
  it("reports the right line number", () => {
    expect(msgs("ok\n\n```\n1%\n```\n5%")[0]).toMatch(/^line 6:/);
  });
});

describe("checkNumbersInRepo", () => {
  it("is clean on this repo's README and skills", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    expect(checkNumbersInRepo(root)).toEqual([]);
  });
});
