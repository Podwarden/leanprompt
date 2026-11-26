import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { buildForms, SKILLS, BLOCK_BEGIN, BLOCK_END } from "../src/forms.js";
import { parseDoc } from "../src/frontmatter.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const built = buildForms(ROOT);
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

function relLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)/g)]
    .map((m) => m[1]!)
    .filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("#") && !t.startsWith("<"));
}

describe("buildForms", () => {
  it("is deterministic and sorted", () => {
    const again = buildForms(ROOT);
    expect([...again.keys()]).toEqual([...built.keys()]);
    expect([...built.keys()]).toEqual([...built.keys()].sort());
    for (const [k, v] of built) expect(again.get(k)).toBe(v);
    for (const v of built.values()) expect(v).not.toContain("\r");
  });

  it("AGENTS block is at most 40 lines and names every skill", () => {
    const block = built.get("forms/AGENTS.block.md")!;
    expect(block.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(BLOCK_END)).toBe(true);
    expect(block.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    for (const s of SKILLS) expect(block).toContain(`\`${s}\``);
    const agents = built.get("AGENTS.md")!;
    expect(agents).toContain(block.trimEnd());
    expect(agents.split("\n").length).toBeGreaterThan(block.split("\n").length);
  });

  it("copies each skill folder whole into one shared skills form (no claude or agents duplicates)", () => {
    for (const s of SKILLS) {
      const files = readdirSyncRec(join(ROOT, "skills", s));
      for (const f of files) expect(built.has(`forms/skills/${s}/${f}`), f).toBe(true);
    }
    for (const k of built.keys()) {
      expect(k.startsWith("forms/claude/"), k).toBe(false);
      expect(k.startsWith("forms/agents/"), k).toBe(false);
    }
    expect(existsSync(join(ROOT, "forms/claude"))).toBe(false);
    expect(existsSync(join(ROOT, "forms/agents"))).toBe(false);
  });

  it("writes one agent-requested Cursor rule per skill", () => {
    const mdc = [...built.keys()].filter((k) => k.startsWith("forms/cursor/rules/"));
    expect(mdc).toEqual(SKILLS.map((s) => `forms/cursor/rules/leanprompt-${s}.mdc`).sort());
    for (const k of mdc) {
      const m = /^---\n([\s\S]*?)\n---\n/.exec(built.get(k)!);
      expect(m, k).not.toBeNull();
      const meta = parse(m![1]!) as Record<string, unknown>;
      expect(Object.keys(meta).sort()).toEqual(["alwaysApply", "description"]);
      expect(meta.alwaysApply).toBe(false);
      expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    }
  });

  it("writes the OpenCode audit command with a description", () => {
    const cmd = built.get("forms/opencode/commands/leanprompt-audit.md")!;
    expect(typeof parseDoc(cmd).meta.description).toBe("string");
    expect(cmd).toContain("llm-call-audit");
  });

  it("every relative link resolves inside its own form tree", () => {
    const trees = ["forms/skills", "forms/cursor", "forms/opencode"];
    let checked = 0;
    for (const [path, text] of built) {
      const tree = trees.find((t) => path.startsWith(t + "/"));
      if (!tree || !path.endsWith(".md") && !path.endsWith(".mdc")) continue;
      for (const l of relLinks(text)) {
        const abs = posix.normalize(posix.join(posix.dirname(path), l.split(/[#?]/)[0]!));
        expect(abs.startsWith(tree + "/"), `${path} -> ${l}`).toBe(true);
        expect(built.has(abs) || [...built.keys()].some((k) => k.startsWith(abs + "/")), `${path} -> ${l}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // Cursor files are flat: no relative links at all.
    for (const [path, text] of built) if (path.startsWith("forms/cursor/")) expect(relLinks(text), path).toEqual([]);
  });

  it("pins escaping links to the release tag", () => {
    const text = built.get("forms/skills/prefill-cache/rules/LP-PC-01.md")!;
    expect(text).toContain(`https://github.com/Podwarden/leanprompt/blob/v${pkg.version}/providers/`);
    expect(text).not.toMatch(/\]\(\.\.\/\.\.\/\.\.\//);
     const ge04 = built.get("forms/skills/generation-economy/rules/LP-GE-04.md")!;
    expect(ge04).toContain(`https://github.com/Podwarden/leanprompt/blob/v${pkg.version}/runtimes/http-clients.md`);
  });

  it("plugin and marketplace files match the schema in docs/assistant-paths.md", () => {
    const schema = (parseDoc(readFileSync(join(ROOT, "docs/assistant-paths.md"), "utf8")).meta as any).schema;
    const mk = JSON.parse(built.get(".claude-plugin/marketplace.json")!);
    const pl = JSON.parse(built.get(".claude-plugin/plugin.json")!);
    for (const k of schema.claude_marketplace_json.required) expect(mk).toHaveProperty(k);
    for (const k of schema.claude_marketplace_json.owner_required) expect(mk.owner).toHaveProperty(k);
    expect(Array.isArray(mk.plugins) && mk.plugins.length > 0).toBe(true);
    for (const p of mk.plugins) for (const k of schema.claude_marketplace_json.plugin_entry_required) expect(p).toHaveProperty(k);
    for (const k of schema.claude_plugin_json.required) expect(pl).toHaveProperty(k);
    expect(mk.plugins[0].name).toBe(pl.name);
    expect(mk.plugins[0].source).toBe("./");
    expect(pl.version).toBe(pkg.version);
    expect(pl.author).toEqual({ name: "PodWarden Team" });
    for (const n of [mk.name, pl.name]) {
      expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(n).not.toMatch(/^(claude|anthropic)-/);
    }
  });
});

function readdirSyncRec(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel)).filter((n) => n !== "__pycache__").flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return statSync(join(dir, r)).isDirectory() ? readdirSyncRec(dir, r) : [r];
  });
}

describe("build:forms --check", () => {
  const tsx = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const script = join(ROOT, "scripts/build-forms.ts");
  const run = (root: string, ...a: string[]) =>
    spawnSync(process.execPath, [tsx, script, "--root", root, ...a], { encoding: "utf8" });

  function copy(): string {
    const d = mkdtempSync(join(tmpdir(), "lp-forms-"));
    for (const p of ["package.json", "skills", "providers", "models", "runtimes", "docs"]) cpSync(join(ROOT, p), join(d, p), { recursive: true });
    return d;
  }

  it("exits 0 after a build, 1 after a SKILL.md edit, 1 on a stale file, 0 after rebuild", () => {
    const d = copy();
    expect(run(d).status).toBe(0);
    expect(run(d, "--check").status).toBe(0);
    const skill = join(d, "skills/prefill-cache/SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nEdited.\n");
    const r = run(d, "--check");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("forms/skills/prefill-cache/SKILL.md");
    expect(run(d).status).toBe(0);
    expect(run(d, "--check").status).toBe(0);
    writeFileSync(join(d, "forms/skills/ghost.md"), "x");
    expect(run(d, "--check").status).toBe(1);
    expect(run(d).status).toBe(0);
    expect(existsSync(join(d, "forms/skills/ghost.md"))).toBe(false);
  }, 60_000);

  it("keeps user text around the block in AGENTS.md", () => {
    const d = copy();
    writeFileSync(join(d, "AGENTS.md"), `before\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\nafter\n`);
    expect(run(d).status).toBe(0);
    const t = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(t.startsWith("before\n")).toBe(true);
    expect(t.endsWith("\nafter\n")).toBe(true);
    expect(t).not.toContain("\nold\n");
    expect(run(d, "--check").status).toBe(0);
  }, 60_000);

  it("the repo's committed forms are current", () => {
    const r = run(ROOT, "--check");
    expect(r.status, r.stderr).toBe(0);
  }, 60_000);
});
