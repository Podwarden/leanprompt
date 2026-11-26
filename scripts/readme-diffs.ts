// Regenerates (or, with --check, verifies) the ```diff block in each examples/<app>/README.md
// from before/app.ts and after/app.ts. The test in cli/test/examples/demo-set.test.ts uses
// the same function, so the README can never drift from the code or from the platform's diff(1).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleDiff } from "./unified-diff.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOCK = /```diff\n[\s\S]*?```/;

const check = process.argv.includes("--check");
let stale = 0;
for (const app of readdirSync(join(ROOT, "examples")).sort()) {
  const dir = join(ROOT, "examples", app);
  if (!existsSync(join(dir, "before", "app.ts")) || !existsSync(join(dir, "README.md"))) continue;
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  const next = readme.replace(BLOCK, () => "```diff\n" + exampleDiff(dir) + "```");
  if (next === readme) continue;
  stale++;
  if (check) process.stderr.write(`examples/${app}/README.md: diff block is stale (run: npm run build:diffs)\n`);
  else writeFileSync(join(dir, "README.md"), next);
}
process.exit(check && stale > 0 ? 1 : 0);
