import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPECS, helpText } from "../src/help.js";
import { commands, main } from "../src/main.js";

let out: string;
let err: string;
beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
});
afterEach(() => vi.restoreAllMocks());

const FLAGS: Record<string, string[]> = {
  init: ["--assistant", "--global", "--dir", "--dry-run"],
  score: ["--measured", "--static", "--dir"],
  calibrate: ["--findings", "--usage", "--synthetic", "--yes", "--dir"],
  "profile detect": ["--lmwarden", "--token-env", "--model"],
  report: ["--html", "--out", "--dir"],
  lesson: ["--rule", "--before", "--dir"],
  "eval-audit": ["--form"],
};

describe("help", () => {
  it("--help, -h and `help` print the overview and exit 0, naming every command", async () => {
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      out = "";
      expect(await main(argv)).toBe(0);
      for (const c of Object.keys(commands)) expect(out).toContain(c);
      expect(out).toContain("leanprompt <command> --help");
      for (const s of ["llm-call-audit", "prefill-cache", "generation-economy", "prompt-diet", "measure-loop", "lmwarden"]) expect(out).toContain(s);
    }
  });

  it.each(Object.entries(FLAGS))("`%s --help` lists every flag its parser accepts and exits 0", async (name, flags) => {
    const argv = name.split(" ");
    for (const a of [[...argv, "--help"], ["help", ...argv]]) {
      out = "";
      expect(await main(a)).toBe(0);
      for (const f of flags) expect(out).toContain(f);
      expect(err).toBe("");
    }
  });

  it("`profile --help` shows profile detect", async () => {
    expect(await main(["profile", "--help"])).toBe(0);
    expect(out).toContain("--lmwarden");
  });

  it("the table covers exactly the registered commands and the flags above", () => {
    const names = SPECS.map((s) => s.name.split(" ")[0]);
    expect(new Set(names)).toEqual(new Set(Object.keys(commands)));
    for (const s of SPECS) expect(s.flags.map((f) => "--" + f.name).sort()).toEqual([...FLAGS[s.name]!].sort());
    for (const s of SPECS) expect(helpText(s.name)).toContain(s.summary);
  });

  it("every command takes its parseArgs options from the table, so help cannot drift", () => {
    const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
    for (const p of ["../src/init.ts", "../src/lesson.ts", "../src/detect.ts", "../src/evalAudit.ts", "../src/report/html.ts", "../src/score/write.ts", "../src/score/calibrate.ts"]) {
      expect(src(p), p).toMatch(/optionsFor\(/);
      expect(src(p), p).not.toMatch(/options:\s*\{\s*\w/);
    }
  });

  it("an unknown command exits 2 and points at --help", async () => {
    expect(await main(["nope"])).toBe(2);
    expect(err).toContain("unknown command: nope");
    expect(err).toContain("leanprompt --help");
  });

  it("help for an unknown command exits 2", async () => {
    expect(await main(["help", "nope"])).toBe(2);
  });
});
