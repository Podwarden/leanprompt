// Where the site lives and how a file in this repository maps to a page on it.
//
// The site is served at https://lmwarden.com/leanprompt/ (owner decision 2026-11-26: under
// lmwarden.com for search authority, looking like part of it). Every URL the build writes is
// root-relative and starts with BASE, so the same files work behind lmwarden.com and in a local
// preview that serves site-dist/ at its root.

export const ORIGIN = "https://lmwarden.com";
export const BASE = "/leanprompt/";
export const REPO = "https://github.com/Podwarden/leanprompt";
export const CONTACT = "info@podwarden.com";

/** The paths on lmwarden.com (outside BASE) the header and footer link to. A test keeps every root-relative link in this list or under BASE. */
export const LMWARDEN_PATHS = ["/", "/#why", "/#features", "/coding-agents", "/faq", "/features", "/privacy", "/llms.txt"] as const;

/** The site URL of a page key: "" is Home, "rules/lp-pc-02" a rule. Always ends with "/". */
export const url = (key: string): string => (key === "" ? BASE : `${BASE}${key.replace(/^\/+|\/+$/g, "")}/`);

/** The canonical absolute URL of a page key. */
export const canonical = (key: string): string => ORIGIN + url(key);

/** The page key of a rule id: LP-PC-02 -> rules/lp-pc-02. */
export const ruleKey = (id: string): string => `rules/${id.toLowerCase()}`;

/** Repository files that are pages on the site, by their path from the repo root. */
const DOC_PAGES: Record<string, string> = {
  "README.md": "",
  "docs/how-it-works.md": "how-it-works",
  "docs/install.md": "install",
  "docs/score.md": "score",
  "docs/CHANGELOG.md": "news/changelog",
};

/** An example app's folder or its README: each example has a page. */
const EXAMPLE = /^examples\/([a-z0-9-]+)(?:\/README\.md)?$/;

const RULE_FILE = /^skills\/[a-z-]+\/rules\/(LP-[A-Z]{2}-\d{2})\.md$/;

/**
 * Where a link written in a repository Markdown file should point on the site.
 * `from` is the file's path from the repo root; `href` is the link as written.
 * A link to another page of the site becomes that page; any other repository path becomes its
 * GitHub URL (blob for files, tree for folders); absolute URLs and in-page anchors are kept.
 */
export function siteHref(from: string, href: string, isDir: (repoPath: string) => boolean = () => false): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("//")) return href;
  const [pathPart, frag = ""] = href.split("#", 2) as [string, string?];
  const hash = frag ? `#${frag}` : "";
  const target = resolveRepoPath(from, pathPart);
  if (target === null) return `${REPO}/blob/main/${from}`; // a link out of the repo: point at the file itself
  const page = DOC_PAGES[target];
  if (page !== undefined) return url(page) + hash;
  const ex = EXAMPLE.exec(target);
  if (ex && isDir(`examples/${ex[1]}`)) return url(`examples/${ex[1]}`) + hash;
  const rule = RULE_FILE.exec(target);
  if (rule) return url(ruleKey(rule[1]!)) + hash;
  if (target === "") return REPO;
  return `${REPO}/${isDir(target) ? "tree" : "blob"}/main/${target}${hash}`;
}

/** Resolve a relative link against a repo file's folder; null when it climbs out of the repo. */
export function resolveRepoPath(from: string, rel: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}
