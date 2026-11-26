import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMain } from "../src/isMain.js";

let dir: string;
let argv1: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lp-ismain-"));
  argv1 = process.argv[1];
});
afterEach(() => {
  process.argv[1] = argv1!;
  rmSync(dir, { recursive: true, force: true });
});

describe("isMain", () => {
  it("is true for the same path and for a symlink to the module", () => {
    const real = join(dir, "real.js");
    const link = join(dir, "link.js");
    writeFileSync(real, "");
    symlinkSync(real, link);
    process.argv[1] = real;
    expect(isMain(pathToFileURL(real).href)).toBe(true);
    process.argv[1] = link;
    expect(isMain(pathToFileURL(real).href)).toBe(true);
    // the other direction: module reached through the link, argv holds the real path
    process.argv[1] = real;
    expect(isMain(pathToFileURL(link).href)).toBe(true);
  });
  it("is false for another file, a missing argv[1], or a missing path", () => {
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "");
    writeFileSync(b, "");
    process.argv[1] = b;
    expect(isMain(pathToFileURL(a).href)).toBe(false);
    process.argv[1] = join(dir, "nope.js");
    expect(isMain(pathToFileURL(a).href)).toBe(false);
    process.argv[1] = undefined as unknown as string;
    expect(isMain(pathToFileURL(a).href)).toBe(false);
  });
});
