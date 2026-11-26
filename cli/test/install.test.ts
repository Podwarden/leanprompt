import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_BEGIN, SKILLS } from "../src/forms.js";
import { init, update } from "../src/init.js";
import { installCommand, nextStep, updateCommand, type Io } from "../src/install.js";
import { main } from "../src/main.js";

let tmp: string;
let dir: string;
let home: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const put = (p: string, text: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const rd = (p: string) => readFileSync(p, "utf8");

/** A scripted terminal: answers are given in order; everything printed is collected. */
function fakeIo(interactive: boolean, answers: string[] = []): Io & { text: () => string; asked: string[] } {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    interactive,
    asked,
    ask: async (q) => {
      asked.push(q);
      lines.push(q);
      return answers.shift() ?? "";
    },
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
    text: () => lines.join("\n"),
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lp-install-"));
  dir = join(tmp, "proj");
  home = join(tmp, "home");
  mkdirSync(dir);
  mkdirSync(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe("install", () => {
  it("in a terminal: asks the scope, lists the files, asks to confirm, writes, and prints the next step", async () => {
    mkdirSync(join(dir, ".claude"));
    const io = fakeIo(true, ["1", "y"]);
    expect(await installCommand(["--dir", dir], io)).toBe(0);
    const t = io.text();
    expect(io.asked[0]).toMatch(/Choose 1 or 2/);
    expect(t).toContain("Install for this project or for all your projects?");
    expect(t).toContain("write .claude/skills/leanprompt/SKILL.md");
    expect(io.asked[1]).toMatch(/^Write these \d+ files\? \[y\/N\] $/);
    expect(t).toContain("Reload your assistant");
    expect(t.trimEnd().split("\n").pop()).toBe(nextStep("claude", "project"));
    for (const s of SKILLS) expect(existsSync(join(dir, ".claude/skills", s, "SKILL.md"))).toBe(true);
  });

  it("in a terminal: a no writes nothing and exits 1", async () => {
    mkdirSync(join(dir, ".claude"));
    const io = fakeIo(true, ["", "n"]);
    expect(await installCommand(["--dir", dir], io)).toBe(1);
    expect(io.text()).toContain("Nothing written.");
    expect(existsSync(join(dir, ".claude/skills"))).toBe(false);
  });

  it("without a terminal and without --yes: prints the plan, writes nothing, exits 1", async () => {
    mkdirSync(join(dir, ".claude"));
    const io = fakeIo(false);
    expect(await installCommand(["--dir", dir], io)).toBe(1);
    expect(io.asked).toEqual([]);
    expect(io.text()).toContain("write .claude/skills/llm-call-audit/SKILL.md");
    expect(io.text()).toContain("--yes");
    expect(existsSync(join(dir, ".claude/skills"))).toBe(false);
  });

  it("--providers and --scope=project --yes install exactly those, with no question", async () => {
    const io = fakeIo(false);
    expect(await installCommand(["--dir", dir, "--providers=claude,codex", "--scope=project", "--yes"], io)).toBe(0);
    expect(existsSync(join(dir, ".claude/skills/leanprompt/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents/skills/leanprompt/SKILL.md"))).toBe(true);
    expect(rd(join(dir, "AGENTS.md"))).toContain(BLOCK_BEGIN);
    expect(io.text()).toContain("$leanprompt audit");
    expect(io.text()).toContain("/leanprompt audit");
  });

  it("--scope=global writes under the home folder only", async () => {
    const io = fakeIo(false);
    expect(await installCommand(["--dir", dir, "--providers=claude,cursor", "--scope=global", "--yes"], io)).toBe(0);
    expect(existsSync(join(home, ".claude/skills/leanprompt/SKILL.md"))).toBe(true);
    // Cursor reads ~/.claude/skills, so it gets no second copy.
    expect(existsSync(join(home, ".cursor/skills"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(io.text()).toContain("~/.claude/skills/leanprompt/SKILL.md");
    expect(io.text()).toContain("in any project");
  });

  it("in a terminal, choosing 2 installs globally; agents-md is skipped there with the reason", async () => {
    put(join(dir, "AGENTS.md"), "mine\n");
    const io = fakeIo(true, ["2", "y"]);
    expect(await installCommand(["--dir", dir, "--providers=claude,agents-md"], io)).toBe(0);
    expect(existsSync(join(home, ".claude/skills/leanprompt/SKILL.md"))).toBe(true);
    expect(rd(join(dir, "AGENTS.md"))).toBe("mine\n");
    expect(io.text()).toMatch(/agents-md: .*no user-level location/);
  });

  it("--dry-run lists and writes nothing, and asks nothing", async () => {
    mkdirSync(join(dir, ".claude"));
    const io = fakeIo(true);
    expect(await installCommand(["--dir", dir, "--dry-run"], io)).toBe(0);
    expect(io.asked).toEqual([]);
    expect(io.text()).toContain("would write .claude/skills/leanprompt/SKILL.md");
    expect(io.text()).toContain("dry run: nothing was written");
    expect(existsSync(join(dir, ".claude/skills"))).toBe(false);
  });

  it("rejects bad flags with exit 2", async () => {
    expect(await installCommand(["--providers=vim"], fakeIo(false))).toBe(2);
    expect(await installCommand(["--scope=everywhere"], fakeIo(false))).toBe(2);
    expect(await installCommand(["--providers=claude", "--assistant", "claude"], fakeIo(false))).toBe(2);
  });

  it("a second run has nothing to write and still prints the next step", async () => {
    await installCommand(["--dir", dir, "--providers=claude", "--yes"], fakeIo(false));
    const io = fakeIo(false);
    expect(await installCommand(["--dir", dir, "--providers=claude"], io)).toBe(0);
    expect(io.text()).toContain("Nothing to write.");
    expect(io.text()).toContain("/leanprompt audit");
  });

  it("init is the same command", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await main(["init", "--dir", dir, "--providers=cursor", "--yes"])).toBe(0);
    expect(existsSync(join(dir, ".cursor/skills/leanprompt/SKILL.md"))).toBe(true);
  });
});

describe("update", () => {
  const stale = "old\n<!-- leanprompt:generated v0.0.1: written by npx leanprompt install -->\n";

  it("refreshes stamped files in both scopes, adds new form files, never touches unstamped ones", () => {
    init({ dir, assistant: "claude" });
    init({ dir, home, global: true, assistant: "claude" });
    put(join(dir, ".claude/skills/prefill-cache/SKILL.md"), stale);
    put(join(home, ".claude/skills/llm-call-audit/SKILL.md"), stale);
    put(join(dir, ".claude/skills/measure-loop/SKILL.md"), "my own edit, no stamp\n");
    rmSync(join(dir, ".claude/skills/leanprompt"), { recursive: true });

    const r = update({ dir, home });
    expect(r.found.map((f) => f.scope).sort()).toEqual(["global", "project"]);
    expect(r.updated.sort()).toEqual([join(dir, ".claude/skills/prefill-cache/SKILL.md"), join(home, ".claude/skills/llm-call-audit/SKILL.md")].sort());
    expect(r.written).toContain(join(dir, ".claude/skills/leanprompt/SKILL.md"));
    expect(rd(join(dir, ".claude/skills/measure-loop/SKILL.md"))).toBe("my own edit, no stamp\n");
    expect(r.skippedWhy.find((s) => s.path.endsWith(join("measure-loop", "SKILL.md")))!.reason).toMatch(/not a leanprompt file/);
    expect(update({ dir, home }).updated).toEqual([]);
  });

  it("finds nothing where nothing was installed, and writes nothing", () => {
    put(join(dir, ".claude/skills/mine/SKILL.md"), "mine\n");
    const r = update({ dir, home });
    expect(r.found).toEqual([]);
    expect(r.written).toEqual([]);
  });

  it("refreshes the AGENTS.md block and the OpenCode commands, and reports old Cursor rule files without touching them", () => {
    init({ dir, assistant: "opencode" });
    const agents = rd(join(dir, "AGENTS.md"));
    put(join(dir, "AGENTS.md"), agents.replace("## leanprompt", "## leanprompt (old)"));
    put(join(dir, ".cursor/rules/leanprompt-prefill-cache.mdc"), stale);
    const r = update({ dir, home, scopes: ["project"] });
    expect(rd(join(dir, "AGENTS.md"))).toBe(agents);
    expect(r.found.some((f) => f.path === join(dir, ".opencode/commands"))).toBe(true);
    expect(r.notes.join("\n")).toMatch(/older leanprompt/);
    expect(rd(join(dir, ".cursor/rules/leanprompt-prefill-cache.mdc"))).toBe(stale);
  });

  it("the command reports what changed; --dry-run writes nothing", async () => {
    init({ dir, assistant: "claude" });
    put(join(dir, ".claude/skills/prefill-cache/SKILL.md"), stale);
    const dry = fakeIo(false);
    expect(await updateCommand(["--dir", dir, "--dry-run"], dry)).toBe(0);
    expect(dry.text()).toContain("would update .claude/skills/prefill-cache/SKILL.md");
    expect(rd(join(dir, ".claude/skills/prefill-cache/SKILL.md"))).toBe(stale);
    const io = fakeIo(false);
    expect(await updateCommand(["--dir", dir], io)).toBe(0);
    expect(io.text()).toContain("updated .claude/skills/prefill-cache/SKILL.md");
    expect(io.text()).toMatch(/0 added, 1 updated/);
  });
});
