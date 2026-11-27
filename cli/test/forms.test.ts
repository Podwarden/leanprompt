import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { buildForms, pluginText, PLUGIN_CLI_NOTE, PACKAGE_PAGES, SKILLS, BLOCK_BEGIN, BLOCK_END, BINARY_COPIES, ICON_PATH, ICON_SOURCE } from "../src/forms.js";
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

  it("writes no Cursor rules: Cursor reads the skills (cursor.com/docs/context/skills)", () => {
    expect([...built.keys()].filter((k) => k.startsWith("forms/cursor/"))).toEqual([]);
  });

  it("the entry skill leanprompt lists every command and routes to the other skills", () => {
    const skill = built.get("forms/skills/leanprompt/SKILL.md")!;
    expect(parseDoc(skill).meta.name).toBe("leanprompt");
    for (const c of ["init", "audit", "fix", "measure", "score", "report", "lesson"]) expect(skill).toContain("`" + c);
    for (const s of SKILLS.filter((x) => x !== "leanprompt")) expect(skill).toContain(`../${s}/SKILL.md`);
  });

  it("writes the OpenCode /leanprompt command that loads the entry skill with its arguments", () => {
    const cmd = built.get("forms/opencode/commands/leanprompt.md")!;
    expect(typeof parseDoc(cmd).meta.description).toBe("string");
    expect(cmd).toContain("`leanprompt` skill");
    expect(cmd).toContain("$ARGUMENTS");
  });

  it("writes the OpenCode audit command with a description", () => {
    const cmd = built.get("forms/opencode/commands/leanprompt-audit.md")!;
    expect(typeof parseDoc(cmd).meta.description).toBe("string");
    expect(cmd).toContain("llm-call-audit");
  });

  it("every relative link resolves inside its own form tree", () => {
    const trees = ["forms/skills", "forms/opencode"];
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
    expect(mk.plugins[0].source).toBe("./plugin");
    expect(JSON.parse(built.get("plugin/.claude-plugin/plugin.json")!).name).toBe(pl.name);
    expect(pl.version).toBe(pkg.version);
    expect(pl.author).toEqual({ name: "LM Warden Team" });
    for (const n of [mk.name, pl.name]) {
      expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(n).not.toMatch(/^(claude|anthropic)-/);
    }
  });

  it("plugin/ holds only a manifest, an icon, a README, the licences and the shared skills form", () => {
    const keys = [...built.keys()].filter((k) => k.startsWith("plugin/"));
    for (const k of keys) {
      const rest = k.slice("plugin/".length);
      expect(
        ["README.md", "LICENSE", "LICENSE-DOCS.md", "NOTICE.md", ".claude-plugin/plugin.json"].includes(rest) || rest.startsWith("skills/"),
        k,
      ).toBe(true);
      // Only Markdown, JSON, images and the licence texts: the directory refuses code files.
      expect(/\.(md|json)$/.test(rest) || rest === "LICENSE", k).toBe(true);
    }
    const code = /\.(ts|py)$/;
    for (const [k, v] of built) {
      if (!k.startsWith("forms/skills/")) continue;
      const rest = k.slice("forms/".length);
      if (code.test(k)) {
        // Shipped as Markdown, the code intact inside one fenced block.
        expect(built.has(`plugin/${rest}`), k).toBe(false);
        expect(built.get(`plugin/${rest}.md`)!).toContain(pluginText(v).replace(/\n$/, ""));
      } else {
        let p = built.get(`plugin/${rest}`)!;
        if (rest === "skills/leanprompt/SKILL.md") p = p.replace(`\n${PLUGIN_CLI_NOTE}\n`, "");
        expect(p.replace(/\]\(templates\/([^)]+?)\.md\)/g, "](templates/$1)")).toBe(pluginText(v));
      }
    }
    // Anthropic's directory: under 512 files, nothing over 256 KiB but images, no package.json.
    expect(keys.length + BINARY_COPIES.length).toBeLessThan(512);
    for (const k of keys) expect(Buffer.byteLength(built.get(k)!), k).toBeLessThanOrEqual(256 * 1024);
    expect(keys.some((k) => k.endsWith("package.json"))).toBe(false);
    const pl = JSON.parse(built.get("plugin/.claude-plugin/plugin.json")!);
    expect(pl.version).toBe(pkg.version);
    expect(pl.icon).toBe("./.claude-plugin/icon.png");
    expect(BINARY_COPIES.map(([, d]) => d)).toContain(ICON_PATH);
    expect(existsSync(join(ROOT, ICON_SOURCE))).toBe(true);
  });

  it("the plugin README has at least 40 words outside code and says what it runs, sends and fetches", () => {
    const readme = built.get("plugin/README.md")!;
    const prose = readme.replace(/```[\s\S]*?```/g, "");
    expect(prose.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(readme).toContain("## What it runs, sends and fetches");
    expect(readme).toMatch(/runs no code on its own/);
    expect(readme).toMatch(/Nothing is sent anywhere/);
    expect(readme).toMatch(/`leanprompt <command>`/);
    expect(readme).toContain(PACKAGE_PAGES.leanprompt);
    expect(relLinks(readme)).toEqual([]);
  });

  // Anthropic's directory validator flags download-and-execute commands and keys read from the
  // environment in skill text; plugin/ carries neither, forms/ (npx leanprompt install) keeps the commands.
  const pluginFiles = () => [...built].filter(([k]) => k.startsWith("plugin/"));
  const INSTALL_OR_RUN: Array<[string, RegExp]> = [
    ["npx", /\bnpx\s/],
    ["npm install", /\bnpm (?:i|install|add|ci)\b/],
    ["pip install", /\bpip3? install\b/],
    ["uv", /\buv (?:add|pip|run|tool|sync)\b|\buvx\b|\bpipx\b/],
    ["other runners", /\b(?:yarn (?:add|dlx)|pnpm (?:add|dlx)|bunx)\b/],
    ["piped to a shell", /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/],
    ["shell -c", /\b(?:ba|z)?sh -c\b/],
    ["clone and run", /\bgit clone\b[^\n]*&&/],
  ];
  const KEY_READS = /os\.environ\[|os\.environ\.get\(|os\.getenv\(|process\.env\.|process\.env\[|\$\{?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET)\b|\bexport [A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET)=|Getenv\("[A-Z_]*(?:KEY|TOKEN)/;

  it("plugin/ shows no install or download-and-run command", () => {
    for (const [k, v] of pluginFiles()) for (const [what, re] of INSTALL_OR_RUN) expect(re.test(v), `${k}: ${what} (${v.match(re)?.[0]})`).toBe(false);
  });

  it("no skill example reads a key from the environment", () => {
    for (const [k, v] of built) if (k.startsWith("plugin/") || k.startsWith("forms/skills/")) expect(KEY_READS.test(v), `${k}: ${v.match(KEY_READS)?.[0]}`).toBe(false);
  });

  it("forms/ keeps the exact npx and install commands", () => {
    expect(built.get("forms/skills/leanprompt/SKILL.md")!).toContain("`npx leanprompt score`");
    const ml = built.get("forms/skills/measure-loop/SKILL.md")!;
    for (const c of ["`npm i leanprompt`", "`pip install --pre leanprompt-cli`", "`npm i -D @kvsig/core@0.1.0`", "`pip install kvsig==0.1.0`"]) expect(ml, c).toContain(c);
    expect(built.get("forms/skills/measure-loop/templates/stable-head.template.ts")!).toContain("// Install: npm i -D @kvsig/core@0.1.0 ");
    expect(built.get("forms/skills/measure-loop/templates/stable_head_template.py")!).toContain("Install: pip install kvsig==0.1.0 pytest");
  });

  it("the plugin's leanprompt skill says where the CLI comes from, once, under its title", () => {
    const skill = built.get("plugin/skills/leanprompt/SKILL.md")!;
    expect(skill.split(PLUGIN_CLI_NOTE).length).toBe(2);
    expect(skill.indexOf(PLUGIN_CLI_NOTE)).toBeLessThan(skill.indexOf("## Commands"));
    expect(skill).toContain("`leanprompt score`");
    expect(built.get("forms/skills/leanprompt/SKILL.md")!).not.toContain(PLUGIN_CLI_NOTE);
  });

  it("the plugin's measure-loop names each package by its page and keeps the yes around it", () => {
    const ml = built.get("plugin/skills/measure-loop/SKILL.md")!;
    for (const url of Object.values(PACKAGE_PAGES)) expect(ml, url).toContain(url);
    expect(ml).toContain("ask the user to add the package instead of installing it yourself");
    expect(ml).toContain("only after the user says yes");
    expect(built.get("plugin/skills/measure-loop/templates/stable-head.template.ts.md")!).toContain(
      `// Install: @kvsig/core 0.1.0 as a dev dependency, following ${PACKAGE_PAGES["@kvsig/core"]} (kvsig/1`,
    );
  });

  it("pluginText rewrites only the command shapes, not prose that mentions them", () => {
    const cases: Array<[string, string]> = [
      ["run `npx leanprompt score --static`.", "run `leanprompt score --static`."],
      ["npx -y leanprompt@0.1.0 report --html", "leanprompt report --html"],
      ["written by npx leanprompt install; npx leanprompt update", "written by leanprompt install; leanprompt update"],
      ["propose: `npm i leanprompt`.", `propose: the \`leanprompt\` package (see its page on npm for how to install it: ${PACKAGE_PAGES.leanprompt}).`],
      ["`npm i -D @kvsig/core@0.1.0` (npm) or `pip install kvsig==0.1.0` (PyPI)",
        `the \`@kvsig/core\` package at 0.1.0 (see its page on npm for how to install it: ${PACKAGE_PAGES["@kvsig/core"]}) or the \`kvsig\` package at 0.1.0 (see its page on PyPI for how to install it: ${PACKAGE_PAGES.kvsig})`],
      ["Install: pip install kvsig==0.1.0 pytest   (ids)", `Install: kvsig 0.1.0 and pytest, following ${PACKAGE_PAGES.kvsig} (ids)`],
    ];
    for (const [a, b] of cases) expect(pluginText(a)).toBe(b);
    // Untouched: the package names in prose, leanprompt-cli, and commands for other packages.
    for (const s of ["the leanprompt CLI", "`leanprompt calibrate`", "npx leanprompt-cli", "`npm i left-pad`", "an npx user"]) expect(pluginText(s)).toBe(s);
  });

  it("the icon is a square PNG of 512 to 2048 px", () => {
    const png = readFileSync(join(ROOT, ICON_SOURCE));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    expect(w).toBe(h);
    expect(w).toBeGreaterThanOrEqual(512);
    expect(w).toBeLessThanOrEqual(2048);
  });

  it("the Cursor manifest uses only fields in Cursor's schema and points at the shared skills", () => {
    // Fields from github.com/cursor/plugins schemas/plugin.schema.json (additionalProperties: false).
    const allowed = ["name", "displayName", "description", "version", "minClientVersions", "author", "publisher", "homepage", "repository", "license", "logo", "keywords", "category", "tags", "commands", "agents", "skills", "rules", "hooks", "variables", "mcpServers"];
    const cur = JSON.parse(built.get(".cursor-plugin/plugin.json")!);
    for (const k of Object.keys(cur)) expect(allowed, k).toContain(k);
    expect(cur.name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    expect(cur.version).toBe(pkg.version);
    expect(cur.skills).toBe("./plugin/skills/");
    expect(cur.logo).toBe(ICON_PATH);
    for (const s of SKILLS) expect(built.has(`plugin/skills/${s}/SKILL.md`), s).toBe(true);
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
    for (const p of ["package.json", "LICENSE", "LICENSE-DOCS", "NOTICE", "skills", "providers", "models", "runtimes", "docs"]) cpSync(join(ROOT, p), join(d, p), { recursive: true });
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
    // plugin/ is covered too: an edited copy, a stray file and a changed icon all fail the check.
    writeFileSync(join(d, "plugin/skills/prefill-cache/SKILL.md"), "edited\n");
    expect(run(d, "--check").stderr).toContain("plugin/skills/prefill-cache/SKILL.md");
    expect(run(d).status).toBe(0);
    writeFileSync(join(d, "plugin/stray.md"), "x");
    expect(run(d, "--check").stderr).toContain("plugin/stray.md (stale)");
    expect(run(d).status).toBe(0);
    expect(existsSync(join(d, "plugin/stray.md"))).toBe(false);
    writeFileSync(join(d, ICON_PATH), "not a png");
    expect(run(d, "--check").stderr).toContain(ICON_PATH);
    expect(run(d).status).toBe(0);
    expect(run(d, "--check").status).toBe(0);
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
