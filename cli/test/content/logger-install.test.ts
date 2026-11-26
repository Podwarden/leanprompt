import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const NPM = /npm i github:Podwarden\/leanprompt#v\d+\.\d+\.\d+(-[\w.]+)?/;
const PIP = 'pip install "git+https://github.com/Podwarden/leanprompt#subdirectory=python"';

describe("logger install before the npm release", () => {
  it("the measure-loop skill gives the GitHub install lines and keeps the ask-first wording", () => {
    const t = read("skills", "measure-loop", "SKILL.md");
    expect(t).toMatch(NPM);
    expect(t).toContain(PIP);
    expect(t).toMatch(/propose the install command to the user instead of running it/);
  });

  it("docs/install.md and the README give them too", () => {
    for (const f of [["docs", "install.md"], ["README.md"]] as const) {
      const t = read(...f);
      expect(t, f.join("/")).toMatch(NPM);
      expect(t, f.join("/")).toContain(PIP);
    }
  });

  it("the package exports ./log with types", () => {
    const pkg = JSON.parse(read("package.json")) as { exports: Record<string, { types: string; default: string }>; scripts: Record<string, string> };
    expect(pkg.exports["./log"]?.types).toMatch(/\.d\.ts$/);
    expect(pkg.scripts.prepare).toBe("npm run build");
  });
});
