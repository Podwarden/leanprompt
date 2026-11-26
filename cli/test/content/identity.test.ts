import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HEADLINE = "Get more from every LLM call your app makes.";
// Built from parts so this file does not match itself.
const OLD_TEAM = new RegExp(["Pod", "Warden\\s+Team"].join(""), "i");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".worktrees", "superpowers", ".superpowers", "__pycache__", ".venv", ".pytest_cache"]);
const TEXT = /\.(md|mdc|json|ts|py|toml|yml|yaml|html|txt|sh|go|js|mjs)$|^(NOTICE|LICENSE|LICENSE-DOCS)$/;

/** Every text file a public mirror would carry (the working tree, minus build output and internal planning notes). */
function publicFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(n) ? [] : publicFiles(p);
    return TEXT.test(n) ? [p] : [];
  });
}

describe("identity and headline", () => {
  it("no public file names the old team", () => {
    const hits: string[] = [];
    for (const f of publicFiles(ROOT)) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OLD_TEAM.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("the README opens with the headline and says who makes it", () => {
    const lines = readFileSync(join(ROOT, "README.md"), "utf8").split("\n");
    expect(lines[0]).toBe("# leanprompt");
    expect(lines[2]).toBe(`**${HEADLINE}**`);
    expect(lines.slice(0, 6).join("\n")).toMatch(/by the LM Warden Team/);
  });

  it("the package, the plugin and the Python package carry the headline and the team", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { description: string; author: string };
    expect(pkg.description.startsWith(HEADLINE.replace(/\.$/, ""))).toBe(true);
    expect(pkg.author).toBe("The LM Warden Team");
    for (const f of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "plugin/.claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
      const text = readFileSync(join(ROOT, f), "utf8");
      expect(text, f).toContain(HEADLINE.replace(/\.$/, ""));
      expect(text, f).toContain("LM Warden Team");
    }
    const py = join(ROOT, "python", "pyproject.toml");
    if (existsSync(py)) expect(readFileSync(py, "utf8")).toMatch(/authors = \[\{ name = "LM Warden Team" \}\]/);
    expect(readFileSync(join(ROOT, "NOTICE"), "utf8")).toMatch(/^Copyright \d{4} The LM Warden Team$/m);
  });
});
