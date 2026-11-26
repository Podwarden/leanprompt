import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const mdUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? mdUnder(p) : n.endsWith(".md") ? [p] : [];
  });

// Public copy must not lean on the build's internal labels (owner rulings, decision and question ids, task numbers).
const JARGON = /owner ruling|ruling D\d|\bD\d\b|\bQ\d\b|\bTask \d+/;
const FILES = [
  ...mdUnder(join(ROOT, "skills")),
  ...["README.md", "docs/profile.md", "docs/calibration.md", "docs/evidence.md", "CONTRIBUTING.md", "GOVERNANCE.md", "SECURITY.md"].map((f) => join(ROOT, f)),
];

describe("no internal jargon in public copy", () => {
  it.each(FILES.map((f) => [relative(ROOT, f), f]))("%s", (_name, file) => {
    const hits = readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((l) => JARGON.test(l.text));
    expect(hits).toEqual([]);
  });
});
