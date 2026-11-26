import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDoc } from "./frontmatter.js";

export interface CacheFacts {
  mode: "automatic" | "breakpoints" | "block";
  min_tokens: number;
  step_tokens?: number;
  block_tokens?: number;
  drops_last_block?: boolean;
  max_breakpoints?: number;
  ttl_seconds: number;
}

export const CACHE_MODES = ["automatic", "breakpoints", "block"] as const;

/** `cache:` blocks of providers/*.md, keyed by the `provider` frontmatter field. Files without a cache block are skipped. */
export function loadCacheFacts(root: string): Map<string, CacheFacts> {
  const out = new Map<string, CacheFacts>();
  const dir = join(root, "providers");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".md")) continue;
    const { meta } = parseDoc(readFileSync(join(dir, f), "utf8"));
    if (typeof meta.provider === "string" && meta.cache && typeof meta.cache === "object") {
      out.set(meta.provider, meta.cache as CacheFacts);
    }
  }
  return out;
}

/** Tokens of a `reusable`-token shared prefix that the provider could cache. */
export function cap(facts: CacheFacts, reusable: number): number {
  if (reusable < facts.min_tokens) return 0;
  switch (facts.mode) {
    case "breakpoints":
      // Missing breakpoints are the app's to fix (D1), so they do not reduce the cap.
      return reusable;
    case "automatic": {
      const step = facts.step_tokens;
      if (!step) return reusable;
      return facts.min_tokens + Math.floor((reusable - facts.min_tokens) / step) * step;
    }
    case "block": {
      const block = facts.block_tokens;
      if (!block) return reusable;
      const blocks = Math.floor(reusable / block) - (facts.drops_last_block ? 1 : 0);
      return Math.max(0, blocks) * block;
    }
  }
}
