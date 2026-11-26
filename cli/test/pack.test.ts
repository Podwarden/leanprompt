import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// On Windows npm and npx are .cmd shims, which execFile starts only through a shell.
const win = process.platform === "win32";
const bin = (name: "npm" | "npx") => (win ? `${name}.cmd` : name);
// Slow (builds, packs, and npm-installs the tarball's dependencies from the registry).
// Set LEANPROMPT_SKIP_SLOW=1 to skip it, e.g. in a CI job without network.
const slow = process.env.LEANPROMPT_SKIP_SLOW === "1" ? it.skip : it;

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd === "npm" || cmd === "npx" ? bin(cmd) : cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: win });

describe("packaging smoke test", () => {
  slow(
    "a packed and installed leanprompt reports its version and runs init",
    () => {
      const tmp = mkdtempSync(join(tmpdir(), "lp-pack-"));
      try {
        run("npm", ["run", "build"], REPO);
        run("npm", ["pack", "--pack-destination", tmp], REPO);
        const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
        expect(tgz).toBeDefined();
        const proj = join(tmp, "proj");
        mkdirSync(proj);
        writeFileSync(join(proj, "package.json"), '{"name":"smoke","version":"0.0.0","private":true}\n');
        run("npm", ["install", "--no-audit", "--no-fund", join(tmp, tgz!)], proj);

        const version = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version;
        expect(run("npx", ["--no-install", "leanprompt", "--version"], proj).trim()).toBe(version);

        const out = run("npx", ["--no-install", "leanprompt", "init", "--assistant", "claude"], proj);
        expect(out.trimEnd().split(/\r?\n/).pop()).toBe("Ask your assistant: audit this app's LLM calls");
        expect(existsSync(join(proj, ".claude", "skills", "llm-call-audit", "SKILL.md"))).toBe(true);

        // leanprompt/log ships its TypeScript types: a consumer type-checks against them.
        const installed = join(proj, "node_modules", "leanprompt");
        const exp = (JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { exports: Record<string, { types: string }> }).exports;
        expect(existsSync(join(installed, exp["./log"]!.types))).toBe(true);
        writeFileSync(
          join(proj, "use-log.ts"),
          'import { createLogger, type Logger } from "leanprompt/log";\nconst l: Logger = createLogger({ path: "u.jsonl", key: new Uint8Array(32), provider: "openai", model: "m" });\nconst n: number | null = l.log({ dialect: "openai.chat", body: {} }, { usage: {} });\nvoid n;\n',
        );
        run(process.execPath, [join(REPO, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--skipLibCheck", "--types", "node", "--typeRoots", join(REPO, "node_modules", "@types"), "use-log.ts"], proj);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    240_000,
  );

  slow(
    "npm pack lists the shared skills form and no forms/claude or forms/agents duplicates",
    () => {
      const out = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], REPO);
      const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path.replace(/\\/g, "/"));
      expect(files.some((f) => f.startsWith("forms/skills/"))).toBe(true);
      expect(files.filter((f) => f.startsWith("forms/claude/") || f.startsWith("forms/agents/"))).toEqual([]);
      expect(files).toContain("cli/dist/log/logger.d.ts");
      expect(files).not.toContain("README.outline.md");
    },
    60_000,
  );
});
