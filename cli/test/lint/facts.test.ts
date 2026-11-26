import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintFacts } from "../../src/lint/facts.js";
import { lintRules } from "../../src/lint/rules.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TODAY = "2026-11-26";
let root: string;

const table = (fm: string, body = "## Facts\n| a | b |\n") => `---\n${fm}\n---\n${body}`;
const CACHE = "cache:\n  mode: automatic\n  min_tokens: 1024\n  step_tokens: 128\n  ttl_seconds: 300";
const prov = (name: string, over: { checked?: string | null; source?: string | null; cache?: string } = {}) => {
  const lines = [`provider: ${name}`];
  if (over.checked !== null) lines.push(`checked: ${over.checked ?? "2026-11-26"}`);
  if (over.source !== null) lines.push(`source: ${over.source ?? "https://example.com/docs"}`);
  lines.push(over.cache ?? CACHE);
  return table(lines.join("\n"));
};
const put = (rel: string, text: string) => {
  mkdirSync(join(root, rel.split("/")[0]!), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const issues = () => lintFacts(root, TODAY);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lp-facts-lint-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("lintFacts", () => {
  it("passes a fresh, sourced table", () => {
    put("providers/a.md", prov("a"));
    expect(issues()).toEqual([]);
  });
  it("warns when checked is 91 days old, not at 90", () => {
    put("providers/a.md", prov("a", { checked: "2026-08-27" })); // 91 days
    put("providers/b.md", prov("b", { checked: "2026-08-28" })); // 90 days
    const r = issues();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ file: "providers/a.md", level: "warn" });
  });
  it("errors without source, without checked, and on a future date", () => {
    put("providers/a.md", prov("a", { source: null }));
    put("providers/b.md", prov("b", { checked: null }));
    put("providers/c.md", prov("c", { checked: "2027-01-01" }));
    const r = issues();
    expect(r.filter((i) => i.level === "error").map((i) => i.file).sort()).toEqual(["providers/a.md", "providers/b.md", "providers/c.md"]);
    expect(r.find((i) => i.file === "providers/a.md")!.msg).toMatch(/source/);
  });
  it("validates the cache block", () => {
    put("providers/a.md", prov("a", { cache: "cache:\n  mode: magic\n  min_tokens: x" }));
    put("providers/b.md", prov("b", { cache: "cache:\n  mode: block\n  min_tokens: 0\n  ttl_seconds: 0" }));
    put("providers/c.md", table("provider: c\nchecked: 2026-11-26\nsource: https://example.com"));
    const m = issues().map((i) => `${i.file}: ${i.msg}`);
    expect(m).toContain("providers/a.md: bad cache.mode magic");
    expect(m).toContain("providers/a.md: cache.ttl_seconds must be a number");
    expect(m).toContain("providers/b.md: cache.block_tokens required for mode block");
    expect(m).toContain("providers/c.md: missing cache block");
  });
  it("checks model tables for family, source and date but not a cache block", () => {
    put("models/q.md", table("family: qwen\nchecked: 2026-11-26\nsource: https://example.com/q"));
    put("models/r.md", table("checked: 2026-11-26"));
    const r = issues();
    expect(r.map((i) => i.file)).toEqual(["models/r.md", "models/r.md"]);
  });
  it("checks docs/assistant-paths.md: checked date, paths map, a source on every row, 90-day warning", () => {
    const body = "## Claude Code\n\n| Item | Path | Source |\n|---|---|---|\n| Skills | `.claude/skills` | https://example.com/a |\n";
    const fm = (checked: string | null, paths = true) =>
      `---\n${checked ? `checked: ${checked}\n` : ""}${paths ? "paths:\n  claude:\n    skills: .claude/skills\n" : ""}---\n`;
    put("docs/assistant-paths.md", fm("2026-11-26") + body);
    expect(issues()).toEqual([]);

    put("docs/assistant-paths.md", fm("2026-11-26") + body + "| Rules | `x` | none |\n");
    expect(issues().map((i) => i.msg)).toEqual(["table row without a source URL: | Rules | `x` | none |"]);

    put("docs/assistant-paths.md", fm(null, false) + body);
    expect(issues().map((i) => i.msg)).toEqual(["missing or bad checked date (YYYY-MM-DD)", "missing paths map"]);

    put("docs/assistant-paths.md", fm("2026-08-27") + body); // 91 days
    expect(issues()).toMatchObject([{ file: "docs/assistant-paths.md", level: "warn" }]);
  });
  it("passes on the repo's own tables with no warnings", () => {
    expect(lintFacts(REPO, TODAY)).toEqual([]);
  });
});

// Windows refuses symlinks without Developer Mode (EPERM): skip with that reason.
const linkOrSkip = (ctx: { skip: (note?: string) => unknown }, target: string, link: string): void => {
  try {
    symlinkSync(target, link);
  } catch (e) {
    ctx.skip(`this OS refused to create a symlink (${(e as NodeJS.ErrnoException).code})`);
  }
};
describe("entry guards", () => {
  it("lint:facts CLI runs through a symlink to the module and exits 1 on errors", (ctx) => {
    put("providers/a.md", prov("a", { source: null }));
    const link = join(root, "link-facts.ts");
    linkOrSkip(ctx, join(REPO, "cli/src/lint/facts.ts"), link);
    const r = spawnSync(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), link, root], { encoding: "utf8" });
    expect(r.stdout).toContain("lint:facts: 1 error(s)");
    expect(r.status).toBe(1);
  });
  it("lint:rules CLI runs through a symlink too", (ctx) => {
    const link = join(root, "link-rules.ts");
    linkOrSkip(ctx, join(REPO, "cli/src/lint/rules.ts"), link);
    const r = spawnSync(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), link, root], { encoding: "utf8" });
    expect(r.stdout).toContain("lint:rules:");
  });
  it("a missing docs/evidence.md is one clear error, not one per rule", () => {
    const dir = join(root, "skills", "prefill-cache", "rules");
    mkdirSync(dir, { recursive: true });
    for (const n of ["01", "02"]) {
      writeFileSync(
        join(dir, `LP-PC-${n}.md`),
        `---\nid: LP-PC-${n}\ntitle: t\nskill: prefill-cache\napplies_to: [x]\nsaves: prefill\nseverity: high\nevidence: [E3]\n---\n` +
          ["Rule", "Why", "Detect in code", "Fix", "Don't break meaning", "Verify", "Waste signal"].map((h) => `## ${h}\nbody\n`).join(""),
      );
    }
    expect(lintRules(root)).toEqual([{ file: "docs/evidence.md", level: "error", msg: "missing docs/evidence.md" }]);
  });
});
