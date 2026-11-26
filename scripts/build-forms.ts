import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BINARY_COPIES, GENERATED_DIRS, buildForms, staleFiles } from "../cli/src/forms.js";

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
const binDiffer: (readonly [string, string])[] = [];
for (const [src, dst] of BINARY_COPIES) {
  const from = join(root, src);
  if (!existsSync(from)) {
    console.error(`missing ${src}, which build:forms copies to ${dst}`);
    process.exit(1);
  }
  const to = join(root, dst);
  if (!existsSync(to) || !readFileSync(to).equals(readFileSync(from))) binDiffer.push([src, dst]);
}
const total = built.size + BINARY_COPIES.length;

if (check) {
  const all = [...differ, ...binDiffer.map(([, d]) => d), ...stale.map((p) => `${p} (stale)`)];
  if (all.length) {
    console.error(`generated files are out of date; run npm run build:forms:\n${all.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`forms up to date (${total} files)`);
} else {
  for (const path of differ) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), built.get(path)!);
  }
  for (const [src, dst] of binDiffer) {
    mkdirSync(dirname(join(root, dst)), { recursive: true });
    copyFileSync(join(root, src), join(root, dst));
  }
  for (const path of stale) {
    rmSync(join(root, path));
    // Drop directories the removal left empty, up to (not including) the generated tree's top.
    const top = join(root, GENERATED_DIRS.find((g) => path.startsWith(g + "/"))!);
    for (let d = dirname(join(root, path)); d !== top && readdirSync(d).length === 0; d = dirname(d)) rmdirSync(d);
  }
  console.log(`wrote ${differ.length + binDiffer.length} files, removed ${stale.length} (${total} total)`);
}
