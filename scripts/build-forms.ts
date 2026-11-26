import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildForms, staleFiles } from "../cli/src/forms.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const ri = args.indexOf("--root");
const root = ri >= 0 ? resolve(args[ri + 1]!) : resolve(dirname(fileURLToPath(import.meta.url)), "..");

const built = buildForms(root);
const stale = staleFiles(root, built);
const differ: string[] = [];
for (const [path, content] of built) {
  const abs = join(root, path);
  if (!existsSync(abs) || readFileSync(abs, "utf8") !== content) differ.push(path);
}

if (check) {
  const all = [...differ, ...stale.map((p) => `${p} (stale)`)];
  if (all.length) {
    console.error(`generated files are out of date; run npm run build:forms:\n${all.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`forms up to date (${built.size} files)`);
} else {
  for (const path of differ) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), built.get(path)!);
  }
  for (const path of stale) {
    rmSync(join(root, path));
    // Drop directories the removal left empty, up to (not including) forms/.
    for (let d = dirname(join(root, path)); d !== join(root, "forms") && readdirSync(d).length === 0; d = dirname(d)) rmdirSync(d);
  }
  console.log(`wrote ${differ.length} files, removed ${stale.length} (${built.size} total)`);
}
