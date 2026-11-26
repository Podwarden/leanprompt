import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";

afterEach(() => vi.restoreAllMocks());

describe("main", () => {
  it("prints the version and returns 0", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await main(["--version"])).toBe(0);
    expect(out).toHaveBeenCalledWith("0.1.0-dev.4\n");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await main(["nope"])).toBe(2);
    expect(err).toHaveBeenCalledWith("unknown command: nope\nRun leanprompt --help for the commands.\n");
  });
});
