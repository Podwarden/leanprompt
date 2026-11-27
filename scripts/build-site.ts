// npm run build:site: the leanprompt website into site-dist/ (served at /leanprompt/; see site/src/build.ts).
//   --out <dir>   write somewhere else (default site-dist)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "../site/src/build.js";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = oi >= 0 ? resolve(args[oi + 1]!) : join(root, "site-dist");

const site = buildSite(root);
rmSync(out, { recursive: true, force: true });
for (const [file, content] of site.files) {
  const abs = join(out, file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
const html = site.pages.length;
console.log(`site: ${html} pages, ${site.files.size} files in ${out}`);
