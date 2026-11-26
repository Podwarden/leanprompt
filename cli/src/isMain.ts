import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the module at `metaUrl` (pass `import.meta.url`) is the script node was started with.
 * Both sides are resolved through symlinks, so `npm link`, `node_modules/.bin` and a symlinked
 * checkout all count as the entry point.
 */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
