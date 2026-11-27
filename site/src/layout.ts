// The page shell: head (title, description, canonical, Open Graph), the masthead, the footer.
//
// The masthead, footer, type and palette are lmwarden.com's (LM Warden, site/lmwarden_site/
// layout.html and render.py::nav_html, Apache-2.0, same authors), so the section reads as part of
// that site. Differences, on purpose: the links are leanprompt's own sections plus a way back to
// lmwarden.com, there is a light theme beside the dark one, and every script and style is a
// same-origin file (no inline code), so the static server's CSP can be `script-src 'self'`.

import { escapeHtml as e } from "./markdown.js";
import { BASE, REPO, canonical, url } from "./paths.js";

export interface PageSpec {
  /** Page key: "" for Home, "rules/lp-pc-02" for a rule (see paths.ts::url). */
  key: string;
  /** The <title>, without the " | leanprompt" suffix (Home gives the full title). */
  title: string;
  description: string;
  body: string;
  /** The top-level section this page belongs to, for aria-current in the menu. */
  section?: Section;
  /** Breadcrumb trail above the page, each [label, key]; the page itself is added last. */
  crumbs?: [string, string][];
  crumbLabel?: string;
  ogType?: "website" | "article";
  /** ISO date for article:published_time. */
  published?: string;
  /** Not for search engines (the 404 page). */
  noindex?: boolean;
  /** Extra class on <main>. */
  mainClass?: string;
}

export type Section = "how-it-works" | "rules" | "score" | "examples" | "install" | "news" | "audits";

/** The site's own sections, in menu order. */
export const SECTIONS: [Section, string][] = [
  ["how-it-works", "How it works"],
  ["rules", "Rules"],
  ["examples", "Examples"],
  ["audits", "Audits"],
  ["score", "Score"],
  ["news", "News"],
];

/** lmwarden.com's own sections, linked from the menu sheet and the footer. */
const LMWARDEN_LINKS: [string, string][] = [
  ["/", "LM Warden home"],
  ["/#features", "Features"],
  ["/coding-agents", "Coding agents"],
  ["/faq", "FAQ"],
];

const SHIELD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>';
const SUN =
  '<svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g></svg>';
const MOON =
  '<svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

export type AssetUrl = (name: string) => string;

function nav(section: Section | undefined): string {
  const items = SECTIONS.map(([key, label]) => {
    const cur = key === section ? ' aria-current="page"' : "";
    return `              <li><a href="${url(key)}"${cur}>${label}</a></li>`;
  }).join("\n");
  const lmw = LMWARDEN_LINKS.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("");
  return `<nav aria-label="Primary">
        <details class="menu">
          <summary>Menu</summary>
          <div class="panel">
            <ul>
${items}
              <li class="lmw-link"><a href="/coding-agents" title="LM Warden: set up your coding agent">Coding agents</a></li>
              <li class="lmw-group"><span class="group-h">LM Warden</span><ul>${lmw}</ul></li>
            </ul>
          </div>
        </details>
      </nav>`;
}

function crumbs(spec: PageSpec): string {
  if (!spec.crumbs) return "";
  const trail: [string, string][] = [["leanprompt", ""], ...spec.crumbs, [spec.crumbLabel ?? spec.title, spec.key]];
  const li = trail
    .map(([label, key], i) => {
      const cur = i === trail.length - 1 ? ' aria-current="page"' : "";
      return `<li><a href="${url(key)}"${cur}>${e(label)}</a></li>`;
    })
    .join("");
  return `  <nav class="crumbs" aria-label="Breadcrumb"><div class="wrap"><ol>${li}</ol></div></nav>\n`;
}

export function page(spec: PageSpec, asset: AssetUrl): string {
  const fullTitle = spec.key === "" ? spec.title : `${spec.title} | leanprompt`;
  const canon = canonical(spec.key);
  const ogImage = canonical("") + "assets/og-image.png";
  const robots = spec.noindex ? '  <meta name="robots" content="noindex">\n' : "";
  const canonLink = spec.noindex ? "" : `  <link rel="canonical" href="${canon}">\n  <meta property="og:url" content="${canon}">\n`;
  const published = spec.published ? `  <meta property="article:published_time" content="${e(spec.published)}">\n` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(fullTitle)}</title>
  <meta name="description" content="${e(spec.description)}">
${robots}${canonLink}  <meta property="og:type" content="${spec.ogType ?? "website"}">
  <meta property="og:site_name" content="LM Warden">
  <meta property="og:title" content="${e(fullTitle)}">
  <meta property="og:description" content="${e(spec.description)}">
  <meta property="og:image" content="${ogImage}">
${published}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(fullTitle)}">
  <meta name="twitter:description" content="${e(spec.description)}">
  <meta name="theme-color" content="#1C1409">
  <meta name="color-scheme" content="dark light">
  <link rel="icon" href="${asset("icon.svg")}" type="image/svg+xml">
  <link rel="alternate" type="application/atom+xml" title="leanprompt news" href="${BASE}news/feed.xml">
  <link rel="preload" href="${asset("fonts/mona-sans-vf.woff2")}" as="font" type="font/woff2" crossorigin>
  <script src="${asset("theme.js")}"></script>
  <link rel="stylesheet" href="${asset("site.css")}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header class="masthead">
  <div class="wrap bar">
    <div class="brands">
      <a class="brand" href="/" aria-label="LM Warden home">${SHIELD}<span>LM Warden</span></a>
      <span class="brand-sep" aria-hidden="true">/</span>
      <a class="sub-brand" href="${BASE}"${spec.key === "" ? ' aria-current="page"' : ""}>leanprompt</a>
    </div>
    <div class="bar-end">
      ${nav(spec.section)}
      <button class="theme" type="button" aria-label="Switch to light theme" data-label-light="Switch to light theme" data-label-dark="Switch to dark theme" hidden>${SUN}${MOON}</button>
      <a class="btn doc" href="${REPO}" rel="noopener"><span class="full">GitHub</span><span class="short" aria-hidden="true">Code</span></a>
      <a class="btn go" href="${url("install")}">Install</a>
    </div>
  </div>
</header>

<main id="main"${spec.mainClass ? ` class="${spec.mainClass}"` : ""}>
${crumbs(spec)}${spec.body}
</main>

<footer class="colophon">
  <div class="wrap">
    <p>leanprompt is free software by the LM Warden Team, the people behind <a href="/">LM Warden</a> and <a href="https://podwarden.com" rel="noopener">PodWarden</a>. Code under Apache-2.0, skills and docs under CC BY 4.0. No telemetry, no hosted service, no account.</p>
    <ul>
      <li><a href="${REPO}" rel="noopener">Source on GitHub</a></li>
      <li><a href="${url("install")}">Install</a></li>
      <li><a href="${url("news/changelog")}">Changelog</a></li>
      <li><a href="${BASE}llms.txt">llms.txt</a></li>
      <li><a href="${BASE}news/feed.xml">News feed</a></li>
      ${LMWARDEN_LINKS.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}
    </ul>
  </div>
</footer>
<script src="${asset("site.js")}" defer></script>
</body>
</html>
`;
}
