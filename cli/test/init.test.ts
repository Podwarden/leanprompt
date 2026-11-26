import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_BEGIN, BLOCK_END, SKILLS } from "../src/forms.js";
import { init } from "../src/init.js";
import { main } from "../src/main.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Windows refuses symlinks without Developer Mode or elevation (EPERM). Probe once and skip, with a
// visible reason, the tests that need one.
const canSymlink = ((): boolean => {
  const d = mkdtempSync(join(tmpdir(), "lp-probe-"));
  try {
    symlinkSync(d, join(d, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
})();
const itLink = canSymlink ? it : it.skip;
if (!canSymlink) it.skip("symlink tests skipped: this OS refused to create a symlink (EPERM)", () => {});
const isWin = process.platform === "win32";
let tmp: string;
let dir: string;
let home: string;
const put = (p: string, text: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const rd = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lp-init-"));
  dir = join(tmp, "proj");
  home = join(tmp, "home");
  mkdirSync(dir);
  mkdirSync(home);
  vi.stubGlobal("fetch", () => {
    throw new Error("init must not use the network");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe("init", () => {
  it("installs all six skills into a .claude project", () => {
    mkdirSync(join(dir, ".claude"));
    const r = init({ dir });
    expect(r.detected.map((d) => d.assistant)).toEqual(["claude"]);
    for (const s of SKILLS) expect(existsSync(join(dir, ".claude/skills", s, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(r.written.length).toBeGreaterThan(5);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("claude and codex/agents-md get the same skill files from the one forms/skills tree", () => {
    const a = mkdtempSync(join(tmp, "a-"));
    const b = mkdtempSync(join(tmp, "b-"));
    init({ dir: a, assistant: "claude" });
    init({ dir: b, assistant: "agents-md" });
    expect(existsSync(join(a, ".agents"))).toBe(false);
    expect(existsSync(join(b, ".claude"))).toBe(false);
    for (const s of SKILLS) {
      expect(rd(join(a, ".claude", "skills", s, "SKILL.md"))).toBe(rd(join(b, ".agents", "skills", s, "SKILL.md")));
      expect(rd(join(a, ".claude", "skills", s, "SKILL.md"))).toBe(rd(join(REPO, "forms", "skills", s, "SKILL.md")));
    }
    expect(existsSync(join(REPO, "forms", "claude"))).toBe(false);
    expect(existsSync(join(REPO, "forms", "agents"))).toBe(false);
  });

  it("inserts the AGENTS.md block once and keeps user text byte-identical", () => {
    const above = "# My project\r\n\nrules above\n\n\n";
    const below = "\n## Mine\ntext below, no trailing newline";
    put(join(dir, "AGENTS.md"), above + BLOCK_BEGIN + "\nold\n" + BLOCK_END + below);
    put(join(dir, "other/AGENTS.md"), "x");
    init({ dir });
    const text = rd(join(dir, "AGENTS.md"));
    expect(text.startsWith(above + BLOCK_BEGIN)).toBe(true);
    expect(text.endsWith(BLOCK_END + below)).toBe(true);
    expect(text.split(BLOCK_BEGIN).length).toBe(2);
    expect(text).not.toContain("\nold\n");
  });

  it("appends the block to an AGENTS.md without markers, leaving existing bytes untouched", () => {
    const user = "# Mine\n\nhello\n\n\n";
    put(join(dir, "AGENTS.md"), user);
    init({ dir });
    const text = rd(join(dir, "AGENTS.md"));
    expect(text.startsWith(user)).toBe(true);
    expect(text.split(BLOCK_BEGIN).length).toBe(2);
    expect(init({ dir }).written).toEqual([]);
    expect(rd(join(dir, "AGENTS.md"))).toBe(text);
  });

  it("keeps CRLF user files in CRLF", () => {
    const user = "# Mine\r\n\r\nhello\r\n";
    put(join(dir, "AGENTS.md"), user);
    init({ dir });
    const text = rd(join(dir, "AGENTS.md"));
    expect(text.startsWith(user)).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses to guess when the begin marker has no end", () => {
    const broken = `# Mine\n${BLOCK_BEGIN}\nhalf\n`;
    put(join(dir, "AGENTS.md"), broken);
    const r = init({ dir });
    expect(rd(join(dir, "AGENTS.md"))).toBe(broken);
    expect(r.skippedWhy.some((s) => s.path.endsWith("AGENTS.md") && /markers/.test(s.reason))).toBe(true);
  });

  it("a second run writes nothing and changes nothing", () => {
    put(join(dir, "AGENTS.md"), "# Mine\n");
    mkdirSync(join(dir, ".claude"));
    mkdirSync(join(dir, ".cursor"));
    mkdirSync(join(dir, ".opencode"));
    const first = init({ dir });
    expect(first.written.length).toBeGreaterThan(0);
    const touched = [...first.written, ...first.updated];
    const snap = new Map(touched.map((p) => [p, rd(p)]));
    const second = init({ dir });
    expect(second.written).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.skipped.length).toBe(touched.length);
    for (const [p, t] of snap) expect(rd(p)).toBe(t);
  });

  it("leaves an existing .cursor/rules/other.mdc alone and writes leanprompt-*.mdc", () => {
    put(join(dir, ".cursor/rules/other.mdc"), "mine\n");
    const r = init({ dir });
    expect(rd(join(dir, ".cursor/rules/other.mdc"))).toBe("mine\n");
    expect(r.detected.map((d) => d.assistant)).toEqual(["cursor"]);
    for (const s of SKILLS) expect(existsSync(join(dir, ".cursor/rules", `leanprompt-${s}.mdc`))).toBe(true);
  });

  it("updates a leanprompt-owned file that differs, and says so", () => {
    mkdirSync(join(dir, ".claude"));
    init({ dir });
    const f = join(dir, ".claude/skills/prefill-cache/SKILL.md");
    const good = rd(f);
    writeFileSync(f, "stale\n<!-- leanprompt:generated v0.0.1 \u2014 managed by npx leanprompt init; local edits are replaced on update -->\n");
    const r = init({ dir });
    expect(r.updated).toEqual([f]);
    expect(rd(f)).toBe(good);
  });

  it("does not overwrite a user's own differing skill file, and says why", () => {
    mkdirSync(join(dir, ".claude"));
    const f = join(dir, ".claude/skills/llm-call-audit/SKILL.md");
    put(f, "---\ndescription: mine\n---\nmy own skill\n");
    const r = init({ dir });
    expect(rd(f)).toBe("---\ndescription: mine\n---\nmy own skill\n");
    expect(r.skippedWhy).toContainEqual({ path: f, reason: "exists and is not a leanprompt file" });
    expect(r.updated).toEqual([]);
  });

  it("a project under a directory named like a skill gets no special treatment", () => {
    const odd = join(tmp, "llm-call-audit", "leanprompt-x");
    mkdirSync(join(odd, ".claude"), { recursive: true });
    put(join(odd, ".claude/skills/prefill-cache/SKILL.md"), "mine\n");
    init({ dir: odd });
    expect(rd(join(odd, ".claude/skills/prefill-cache/SKILL.md"))).toBe("mine\n");
  });

  it("every generated md and mdc form carries the stamp", () => {
    mkdirSync(join(dir, ".claude"));
    mkdirSync(join(dir, ".cursor"));
    mkdirSync(join(dir, ".opencode"));
    const r = init({ dir });
    const docs = r.written.filter((p) => /\.(md|mdc)$/.test(p) && !p.endsWith("AGENTS.md"));
    expect(docs.length).toBeGreaterThan(10);
    for (const p of docs) expect(rd(p), p).toContain("<!-- leanprompt:generated v");
  });

  it("installs no file a test runner would collect (*.test.*, *.spec.*, test_*.py, *_test.py)", () => {
    for (const a of ["claude", "codex", "agents-md", "cursor", "opencode"] as const) {
      const d = mkdtempSync(join(tmp, `${a}-`));
      const r = init({ dir: d, assistant: a });
      for (const p of [...r.written, ...r.updated]) {
        const name = p.split(/[\\/]/).pop()!;
        expect(name, p).not.toMatch(/\.(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.py$/);
      }
    }
  });

  it("the stable-head templates are installed with a code-comment stamp, and a stamped stale copy is updated", () => {
    mkdirSync(join(dir, ".claude"));
    init({ dir });
    const ts = join(dir, ".claude/skills/measure-loop/templates/stable-head.template.ts");
    const py = join(dir, ".claude/skills/measure-loop/templates/stable_head_template.py");
    expect(rd(ts)).toMatch(/^\/\/ leanprompt:generated v\S+ /m);
    expect(rd(py)).toMatch(/^# leanprompt:generated v\S+ /m);
    const good = rd(py);
    writeFileSync(py, "stale\n# leanprompt:generated v0.0.1 \u2014 managed by npx leanprompt init; local edits are replaced on update\n");
    const r = init({ dir });
    expect(r.updated).toEqual([py]);
    expect(rd(py)).toBe(good);
  });

  itLink("never follows a symlinked parent out of the project", () => {
    const outside = join(tmp, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(dir, ".claude"));
    const r = init({ dir, assistant: "claude" });
    expect(r.written).toEqual([]);
    expect(readdirSync(outside)).toEqual([]);
    expect(r.skippedWhy.length).toBeGreaterThan(5);
    for (const s of r.skippedWhy) expect(s.reason).toBe("parent directory is a symlink outside the project");
  });

  itLink("allows a symlink that stays inside the project", () => {
    mkdirSync(join(dir, "real-claude"));
    symlinkSync(join(dir, "real-claude"), join(dir, ".claude"));
    expect(init({ dir, assistant: "claude" }).written.length).toBeGreaterThan(5);
  });

  itLink("--global writes through a symlinked config dir and reports it", () => {
    const dotfiles = join(tmp, "dotfiles");
    mkdirSync(dotfiles);
    symlinkSync(dotfiles, join(home, ".claude"));
    const r = init({ dir, global: true, home, assistant: "claude" });
    expect(r.written.length).toBeGreaterThan(5);
    expect(existsSync(join(dotfiles, "skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(r.notes.some((n) => n.startsWith(`via symlink ${join(home, ".claude")} \u2192 `) && n.includes(realpathSync(dotfiles)))).toBe(true);
  });

  it("never touches a user file inside a leanprompt skill folder that the form does not ship", () => {
    mkdirSync(join(dir, ".claude"));
    put(join(dir, ".claude/skills/llm-call-audit/my-notes.md"), "mine");
    init({ dir });
    expect(rd(join(dir, ".claude/skills/llm-call-audit/my-notes.md"))).toBe("mine");
  });

  itLink("skips, with a reason, a target that is a symlink or a directory", () => {
    mkdirSync(join(dir, ".cursor"));
    put(join(tmp, "elsewhere.mdc"), "outside");
    mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
    symlinkSync(join(tmp, "elsewhere.mdc"), join(dir, ".cursor/rules/leanprompt-prefill-cache.mdc"));
    mkdirSync(join(dir, ".cursor/rules/leanprompt-lmwarden.mdc"));
    const r = init({ dir });
    expect(rd(join(tmp, "elsewhere.mdc"))).toBe("outside");
    expect(r.skippedWhy.filter((s) => /not a regular file/.test(s.reason)).length).toBe(2);
  });

  it("codex gets .agents/skills and the AGENTS.md block; opencode gets a command, and skills only if none exist", () => {
    put(join(dir, "AGENTS.md"), "x\n");
    mkdirSync(join(dir, ".codex"));
    mkdirSync(join(dir, ".opencode"));
    const r = init({ dir });
    expect(r.detected.map((d) => d.assistant).sort()).toEqual(["agents-md", "codex", "opencode"]);
    expect(existsSync(join(dir, ".agents/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".opencode/commands/leanprompt-audit.md"))).toBe(true);

    const dir2 = join(tmp, "p2");
    mkdirSync(join(dir2, ".claude"), { recursive: true });
    mkdirSync(join(dir2, ".opencode"));
    init({ dir: dir2 });
    expect(existsSync(join(dir2, ".agents"))).toBe(false);
    expect(existsSync(join(dir2, ".opencode/commands/leanprompt-audit.md"))).toBe(true);
  });

  it("falls back to agents-md when nothing is detected, and --assistant overrides detection", () => {
    const r = init({ dir });
    expect(r.detected).toEqual([{ assistant: "agents-md", why: expect.stringContaining("no assistant") }]);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents/skills/measure-loop/SKILL.md"))).toBe(true);
    // a new AGENTS.md does not get this repo's contributor preamble
    expect(rd(join(dir, "AGENTS.md"))).not.toContain("Contributors");

    const dir2 = join(tmp, "p2");
    mkdirSync(join(dir2, ".cursor"), { recursive: true });
    init({ dir: dir2, assistant: "claude" });
    expect(existsSync(join(dir2, ".claude/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir2, ".cursor/rules"))).toBe(false);
  });

  it("--global writes under home, not dir, and uses the documented global paths", () => {
    init({ dir, global: true, home, assistant: "claude" });
    init({ dir, global: true, home, assistant: "codex" });
    init({ dir, global: true, home, assistant: "opencode" });
    expect(existsSync(join(home, ".claude/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".agents/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(rd(join(home, ".codex/AGENTS.md"))).toContain(BLOCK_BEGIN);
    expect(existsSync(join(home, ".config/opencode/commands/leanprompt-audit.md"))).toBe(true);
    expect(rd(join(home, ".config/opencode/AGENTS.md"))).toContain(BLOCK_BEGIN);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("--global cursor prints that there is no documented path and writes nothing", () => {
    const r = init({ dir, global: true, home, assistant: "cursor" });
    expect(r.written).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/cursor.*no global/);
  });

  it("--global detects from home", () => {
    mkdirSync(join(home, ".claude"));
    expect(init({ dir, global: true, home }).detected.map((d) => d.assistant)).toEqual(["claude"]);
  });

  it("makes no network call", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    init({ dir });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("init command", () => {
  it("prints what was detected and ends with the closing line", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    mkdirSync(join(dir, ".claude"));
    expect(await main(["init", "--dir", dir])).toBe(0);
    const text = out.join("");
    expect(text).toContain("claude: found .claude/");
    expect(text.trimEnd().split("\n").pop()).toBe("Ask your assistant: audit this app's LLM calls");
    out.length = 0;
    await main(["init", "--dir", dir]);
    expect(out.join("")).toContain("already up to date");
  });

  it("rejects an unknown assistant with exit 2", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await main(["init", "--dir", dir, "--assistant", "vim"])).toBe(2);
  });
});

// install.sh is POSIX sh; Windows installs with `npx github:Podwarden/leanprompt init`.
describe.skipIf(isWin)("scripts/install.sh", () => {
  const script = join(REPO, "scripts/install.sh");
  it("runs npx --yes github:Podwarden/leanprompt#v<version> init with the arguments", () => {
    const bin = join(tmp, "bin");
    put(join(bin, "npx"), '#!/bin/sh\necho "npx $*"\n');
    chmodSync(join(bin, "npx"), 0o755);
    const node = process.execPath;
    symlinkSync(node, join(bin, "node"));
    const r = spawnSync("/bin/sh", [script, "--assistant", "claude"], {
      env: { PATH: bin, LEANPROMPT_VERSION: "1.2.3" },
      encoding: "utf8",
    });
    expect(r.stdout.trim()).toBe("npx --yes github:Podwarden/leanprompt#v1.2.3 init --assistant claude");
    const pkg = JSON.parse(rd(join(REPO, "package.json"))) as { version: string };
    const r2 = spawnSync("/bin/sh", [script], { env: { PATH: bin }, encoding: "utf8" });
    expect(r2.stdout.trim()).toBe(`npx --yes github:Podwarden/leanprompt#v${pkg.version} init`);
  });

  const fakeBin = (): string => {
    const bin = join(tmp, "bin");
    put(join(bin, "npx"), '#!/bin/sh\necho "npx $*"\n');
    chmodSync(join(bin, "npx"), 0o755);
    symlinkSync(process.execPath, join(bin, "node"));
    return bin;
  };
  // A project nested in another whose package.json is not leanprompt's (a monorepo package).
  const nestedProject = (): string => {
    put(join(tmp, "mono", "package.json"), JSON.stringify({ name: "acme-monorepo", version: "9.9.9" }));
    const proj = join(tmp, "mono", "app");
    mkdirSync(proj, { recursive: true });
    return proj;
  };

  it("piped (curl | sh) never reads a package.json: the parent project's version is ignored", () => {
    const bin = fakeBin();
    const proj = nestedProject();
    put(join(proj, "sh"), "not a script"); // even a file named like the shell in the cwd is not used
    const r = spawnSync("/bin/sh", ["-s", "--", "--assistant", "cursor"], { input: rd(script), cwd: proj, env: { PATH: bin }, argv0: "sh", encoding: "utf8" });
    expect(r.stdout.trim()).toBe("npx --yes github:Podwarden/leanprompt init --assistant cursor");
  });

  it("piped honours LEANPROMPT_VERSION", () => {
    const bin = fakeBin();
    const proj = nestedProject();
    const r = spawnSync("/bin/sh", ["-s", "--", "--assistant", "cursor"], {
      input: rd(script),
      cwd: proj,
      env: { PATH: bin, LEANPROMPT_VERSION: "0.1.0" },
      argv0: "sh", // as `curl ... | sh` runs it: $0 is "sh"
      encoding: "utf8",
    });
    expect(r.stdout.trim()).toBe("npx --yes github:Podwarden/leanprompt#v0.1.0 init --assistant cursor");
  });

  it("a script file whose parent package.json is not leanprompt's uses latest", () => {
    const bin = fakeBin();
    put(join(tmp, "mono", "package.json"), JSON.stringify({ name: "acme-monorepo", version: "9.9.9" }));
    put(join(tmp, "mono", "scripts", "install.sh"), rd(script));
    const r = spawnSync("/bin/sh", [join(tmp, "mono", "scripts", "install.sh")], { env: { PATH: bin }, encoding: "utf8" });
    expect(r.stdout.trim()).toBe("npx --yes github:Podwarden/leanprompt init");
  });

  it("explains a missing node and exits non-zero", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    const r = spawnSync("/bin/sh", [script], { env: { PATH: empty }, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/node and npx are required/);
  });
});

describe("init, both claude and AGENTS.md present", () => {
  it("auto-detect installs skills once, to .claude/skills, and still adds the AGENTS.md block", () => {
    mkdirSync(join(dir, ".claude"));
    put(join(dir, "AGENTS.md"), "mine\n");
    const r = init({ dir });
    expect(r.detected.map((d) => d.assistant).sort()).toEqual(["agents-md", "claude"]);
    expect(existsSync(join(dir, ".claude/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
    expect(rd(join(dir, "AGENTS.md"))).toContain(BLOCK_BEGIN);
    expect(r.detected.find((d) => d.assistant === "agents-md")!.why).toContain(".claude/skills");
  });

  it("is idempotent in that case", () => {
    mkdirSync(join(dir, ".claude"));
    put(join(dir, "AGENTS.md"), "mine\n");
    init({ dir });
    const again = init({ dir });
    expect(again.written).toEqual([]);
    expect(again.updated).toEqual([]);
  });

  it("an explicit codex (.codex/ present) still gets .agents/skills next to .claude/skills", () => {
    mkdirSync(join(dir, ".claude"));
    mkdirSync(join(dir, ".codex"));
    put(join(dir, "AGENTS.md"), "mine\n");
    init({ dir });
    expect(existsSync(join(dir, ".claude/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents/skills/llm-call-audit/SKILL.md"))).toBe(true);
  });

  it("--assistant agents-md forces .agents/skills even when claude is present", () => {
    mkdirSync(join(dir, ".claude"));
    init({ dir, assistant: "agents-md" });
    expect(existsSync(join(dir, ".agents/skills/llm-call-audit/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude/skills"))).toBe(false);
  });

  it("the command says which assistants were found and how to force another", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    mkdirSync(join(dir, ".claude"));
    put(join(dir, "AGENTS.md"), "mine\n");
    expect(await main(["init", "--dir", dir])).toBe(0);
    const text = out.join("");
    expect(text).toContain("claude: found .claude/");
    expect(text).toContain("agents-md: found AGENTS.md");
    expect(text).toContain("--assistant");
  });
});

describe("init --dry-run", () => {
  it("lists what would be written and writes nothing", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    mkdirSync(join(dir, ".claude"));
    put(join(dir, "AGENTS.md"), "mine\n");
    expect(await main(["init", "--dry-run", "--dir", dir])).toBe(0);
    const text = out.join("");
    expect(text).toContain("would write .claude/skills/llm-call-audit/SKILL.md");
    expect(text).toContain("would update AGENTS.md");
    expect(text).toContain("dry run");
    expect(existsSync(join(dir, ".claude/skills"))).toBe(false);
    expect(rd(join(dir, "AGENTS.md"))).toBe("mine\n");
  });

  it("reports skips (a user's own file, up to date) without touching anything", () => {
    mkdirSync(join(dir, ".claude"));
    init({ dir });
    put(join(dir, ".claude/skills/llm-call-audit/SKILL.md"), "mine\n");
    const r = init({ dir, dryRun: true });
    expect(r.skippedWhy.some((s) => /not a leanprompt file/.test(s.reason))).toBe(true);
    expect(rd(join(dir, ".claude/skills/llm-call-audit/SKILL.md"))).toBe("mine\n");
  });

  it("creates no directory in a fresh project", () => {
    init({ dir, dryRun: true });
    expect(existsSync(join(dir, ".agents"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });
});
