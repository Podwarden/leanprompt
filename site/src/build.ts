// The leanprompt website, built from this repository into static files.
//
//   npm run build:site            writes site-dist/leanprompt/...
//
// Served at https://lmwarden.com/leanprompt/: the LM Warden vendor build bundles site-dist/leanprompt/ and serves it from disk.
// Every page is generated from a file in this repository, so a new rule, a changelog entry, a
// news post or an audit is a commit and a rebuild:
//   README.md and docs/*.md          Home's facts, How it works, Install, Score, the changelog
//   skills/*/rules/*.md              Rules: an index and one page per rule (/leanprompt/rules/lp-pc-02/)
//   examples/*/README.md             Examples, and site/examples/<app>/*.findings.json for the
//                                    before and after pages `leanprompt report --html` writes
//   site/news/*.md                   News posts (with the dated releases from the changelog)
//   site/audits/<owner>__<repo>/     Audits (meta.yaml + findings.json; rules in audits.ts)
//
// No framework and no client-side rendering: TypeScript strings, one Markdown parser (marked),
// one stylesheet and two small same-origin scripts. Nothing loads from another host, and there
// is no analytics (lmwarden.com's Google tag is configured per instance and not carried here).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDoc } from "../../cli/src/frontmatter.js";
import { loadNoteRuleIds, loadRuleIds } from "../../cli/src/lint/rules.js";
import { costsNothing, formatTokens } from "../../cli/src/report/cost.js";
import { KNOWN_LABEL, loadRules, NO_DISCOUNT_LINE, rankFindings, renderReport, SCOPE_LABEL, scopeCounts, scopeLine, UNATTENDED_LINE, type ScoreFile } from "../../cli/src/report/html.js";
import { isKnownFinding, isServerFinding, knownOf, parseFindings, staticScore, tokensLost, unitOf, type Finding, type Note } from "../../cli/src/score/static.js";
import { badgeColor } from "../../cli/src/score/write.js";
import { BADGES, ILLUSTRATION_FILES, STATUS_TEXT, badgeOf, bigNumberOf, loadAudits, sortForIndex, type Audit } from "./audits.js";
import { page, type AssetUrl, type PageSpec } from "./layout.js";
import { clip, escapeHtml as e, plain, renderMarkdown } from "./markdown.js";
import { loadPosts, loadReleases } from "./news.js";
import { BASE, CONTACT, ORIGIN, REPO, canonical, ruleKey, url } from "./paths.js";

/** What the build produces: files by their path under site-dist/ (so "leanprompt/index.html"). */
export interface Site {
  files: Map<string, string | Buffer>;
  /** Every HTML page: its key, its file and whether search engines should index it. */
  pages: { key: string; file: string; index: boolean; lastmod?: string }[];
}

const SKILL_ORDER = ["prefill-cache", "generation-economy", "prompt-diet", "lmwarden"];
const SAVES_TEXT: Record<string, string> = { prefill: "Prefill", generation: "Generation", both: "Prefill and generation", none: "No tokens: a correctness rule, recorded as a note" };
export const ESTIMATE_LABEL = "Every figure on this page is an estimate from reading the code, not a measurement of the app in use.";
export const CORRECTIONS_LINE = `Corrections and takedown: email ${CONTACT} or open an issue.`;

interface RulePage {
  id: string;
  title: string;
  skill: string;
  saves: string;
  severity: string;
  appliesTo: string[];
  evidence: string[];
  file: string;
  html: string;
  lede: string;
}

export function buildSite(root: string): Site {
  const files = new Map<string, string | Buffer>();
  const pages: Site["pages"] = [];
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const pkg = JSON.parse(read("package.json")) as { version: string; description: string };

  // --- Assets: copied with a content hash in their URL, so they can be cached for a year.
  const assetDir = join(root, "site", "assets");
  const assetFiles = new Map<string, Buffer>();
  const walk = (prefix: string) => {
    for (const d of readdirSync(join(assetDir, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.isDirectory()) walk(`${prefix}${d.name}/`);
      else assetFiles.set(prefix + d.name, readFileSync(join(assetDir, prefix + d.name)));
    }
  };
  walk("");
  const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 10);
  const asset: AssetUrl = (name) => {
    const b = assetFiles.get(name);
    if (!b) throw new Error(`site asset ${name} does not exist in site/assets`);
    return `${BASE}assets/${name}?v=${hash(b)}`;
  };
  // site.css names its fonts relative to itself; give them their versioned URLs too.
  const css = assetFiles.get("site.css")!.toString("utf8").replace(/url\("(fonts\/[^"]+)"\)/g, (_m, f: string) => `url("${asset(f)}")`);
  assetFiles.set("site.css", Buffer.from(css));
  // The report pages' own stylesheet and script (extracted from the page `report --html` writes).
  let reportCss: string | undefined;
  let reportJs: string | undefined;
  const widths = new Set<number>();

  const emit = (spec: PageSpec, lastmod?: string) => {
    const file = spec.key === "" ? "leanprompt/index.html" : `leanprompt/${spec.key}/index.html`;
    files.set(file, page(spec, asset));
    pages.push({ key: spec.key, file, index: !spec.noindex, ...(lastmod ? { lastmod } : {}) });
  };

  /** A page `leanprompt report --html` wrote, made servable under the site's CSP and linked back to the site. */
  const emitReport = (key: string, html: string, o: { title: string; description: string; back: [string, string]; note: string }) => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(html);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html);
    if (!style) throw new Error("report page without its <style>");
    if (reportCss !== undefined && reportCss !== style[1]) throw new Error("report pages differ in their stylesheet");
    reportCss = style[1]!;
    let out = html.replace(style[0], `<link rel="stylesheet" href="@@REPORT_CSS@@">`);
    if (script) {
      if (reportJs !== undefined && reportJs !== script[1]) throw new Error("report pages differ in their script");
      reportJs = script[1]!;
      out = out.replace(script[0], `<script src="@@REPORT_JS@@" defer></script>`);
    }
    // The token bar's one inline style becomes a class, so the CSP needs no 'unsafe-inline'.
    out = out.replace(/ style="width:([\d.]+)%"/g, (_m, w: string) => {
      const n = Math.round(Number(w));
      widths.add(n);
      return ` data-w="${n}"`;
    });
    if (/ style="/.test(out)) throw new Error("report page has an inline style attribute the site cannot serve");
    const head = [
      `<meta name="description" content="${e(o.description)}">`,
      `<link rel="canonical" href="${canonical(key)}">`,
      `<meta property="og:type" content="article">`,
      `<meta property="og:site_name" content="LM Warden">`,
      `<meta property="og:title" content="${e(o.title)}">`,
      `<meta property="og:description" content="${e(o.description)}">`,
      `<meta property="og:url" content="${canonical(key)}">`,
      `<link rel="icon" href="${asset("icon.svg")}" type="image/svg+xml">`,
    ].join("\n");
    out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${e(o.title)}</title>\n${head}`);
    const bar = `<div class="lp-sitebar" role="region" aria-label="About this page"><p>${o.note} <a href="${url(o.back[0])}">${e(o.back[1])}</a></p></div>`;
    out = out.replace(/<body([^>]*)>/, `<body$1>\n${bar}`);
    files.set(`leanprompt/${key}/index.html`, out);
    pages.push({ key, file: `leanprompt/${key}/index.html`, index: true });
  };

  // --- Rules
  const rules = loadRules(root);
  const ruleIds = loadRuleIds(root);
  const noteRuleIds = loadNoteRuleIds(root);
  const rulePages: RulePage[] = [];
  const skillInfo = new Map<string, { lede: string; title: string }>();
  for (const skill of SKILL_ORDER) {
    const dir = `skills/${skill}/rules`;
    const sk = renderMarkdown(read(join("skills", skill, "SKILL.md")).replace(/^---[\s\S]*?\n---\n/, ""), `skills/${skill}/SKILL.md`, root);
    skillInfo.set(skill, { lede: sk.lede, title: sk.title });
    for (const f of readdirSync(join(root, dir)).filter((x) => /^LP-[A-Z]{2}-\d{2}\.md$/.test(x)).sort()) {
      const file = `${dir}/${f}`;
      const text = read(file);
      const meta = parseDoc(text).meta;
      const body = text.replace(/^---[\s\S]*?\n---\n/, "");
      const r = renderMarkdown(body, file, root, { keepTitle: true });
      rulePages.push({
        id: String(meta.id),
        title: String(meta.title),
        skill,
        saves: String(meta.saves),
        severity: String(meta.severity),
        appliesTo: (meta.applies_to as string[] | undefined) ?? [],
        evidence: (meta.evidence as string[] | undefined) ?? [],
        file,
        html: r.html,
        lede: r.lede,
      });
    }
  }
  const ruleUrl = (id: string) => url(ruleKey(id));

  // --- Home
  const releases = loadReleases(read("docs/CHANGELOG.md"));
  const posts = loadPosts(root);
  const audits = loadAudits(root, ruleIds, noteRuleIds);
  const news = [
    ...posts.map((p) => ({ date: p.date, title: p.title, href: url(`news/${p.slug}`), text: p.description })),
    ...releases.map((r) => ({ date: r.date, title: `leanprompt ${r.version}`, href: `${url("news/changelog")}#${r.anchor}`, text: r.summary })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const installCmd = "npx leanprompt install";
  const exampleScore = (form: string) =>
    staticScore(parseFindings(read(`site/examples/dated-chat/${form}.findings.json`), ruleIds, noteRuleIds).findings).score;
  const [scoreBefore, scoreAfter] = [exampleScore("before"), exampleScore("after")];
  const skillCount = (s: string) => rulePages.filter((r) => r.skill === s).length;
  emit({
    key: "",
    title: "leanprompt: get more from every LLM call your app makes",
    description:
      "Skills for coding assistants that make your app's prompts cacheable, cut dead weight and stop wasted output without changing the answers, plus a CLI to measure the result.",
    mainClass: "home",
    body: `  <section class="hero" aria-labelledby="hero-title">
    <div class="wrap">
      <h1 id="hero-title">Get more from every LLM call your app makes.</h1>
      <p class="lede">Your coding assistant makes prompts cacheable, cuts dead weight, stops wasted output and speeds up first tokens, without changing the answers.</p>
      <div class="cmd" aria-label="Install command">
        <pre id="install-cmd"><code>${installCmd}</code></pre>
        <button class="btn copy" type="button" data-copy="install-cmd" hidden><span>Copy</span></button>
      </div>
      <p class="small">From your project root. Needs Node 20.19 or newer. It shows every file it will write and asks before writing. Then reload your assistant and type <code>/leanprompt init</code>.</p>
      <p class="works"><span class="works-h">Works with</span> Claude Code, Codex, Cursor, OpenCode and any agent that reads <code>AGENTS.md</code>.</p>
    </div>
  </section>

  <section class="sec pair-sec" aria-labelledby="pair-title">
    <div class="wrap">
      <h2 id="pair-title">One example app, before and after one fix</h2>
      <p class="sec-lede">The audit page for <a href="${url("examples/dated-chat")}">dated-chat</a>. Before, the system prompt starts with the time to the second, so no call can reuse the handbook that follows it. After, the time moves to the newest message.</p>
      <div class="pair">
        <figure>
          <figcaption><b>Without leanprompt</b> One finding at <code>app.ts</code> line 11; static score ${scoreBefore}.</figcaption>
          <a class="shot" href="${url("examples/dated-chat/before")}"><img src="${asset("readme-without.webp")}" width="1400" height="600" alt="The leanprompt audit page for the dated-chat example before the fix: one place where the app pays for tokens it does not need, at app.ts line 11, where the system prompt starts with the current time; an estimate of 6.7 million tokens per 1,000 calls that the cache could have served; static score 46"></a>
        </figure>
        <figure>
          <figcaption><b>With leanprompt</b> No open findings, one fixed; static score ${scoreAfter}.</figcaption>
          <a class="shot" href="${url("examples/dated-chat/after")}"><img src="${asset("readme-with.webp")}" width="1400" height="600" alt="The leanprompt audit page for the same example after the fix: no open findings, 1 finding fixed, static score 100" loading="lazy"></a>
        </figure>
      </div>
      <p class="small">Both pages show estimates from the code, not measurements. <code>/leanprompt measure</code> turns a fix into a before and after number.</p>
    </div>
  </section>

  <section class="sec steps-sec" aria-labelledby="steps-title">
    <div class="wrap">
      <h2 id="steps-title">What your assistant does with it</h2>
      <ol class="steps">
        <li><h3>Audit</h3><p><code>/leanprompt audit</code> finds every LLM call in the app and ranks where it loses tokens and time: a prompt the cache cannot reuse, dead weight, output thrown away.</p></li>
        <li><h3>Fix</h3><p><code>/leanprompt fix</code> checks each finding, shows a diff and applies it on your yes. A fix that changes what the model is asked or answers is not a fix.</p></li>
        <li><h3>Prove</h3><p><code>/leanprompt measure</code> compares the provider’s own usage numbers before and after, and <code>/leanprompt score</code> turns them into one number you can put in CI.</p></li>
      </ol>
      <p><a class="more" href="${url("how-it-works")}">How it works</a></p>
    </div>
  </section>

  <section class="sec rules-sec" aria-labelledby="rules-title">
    <div class="wrap">
      <h2 id="rules-title">${rulePages.length} rules, each with a way to check it</h2>
      <ul class="skill-list">
${SKILL_ORDER.map((s) => `        <li><a href="${url("rules")}#${s}"><span class="skill-name">${e(s)}</span><span class="skill-count">${skillCount(s)} rules</span></a><p>${e(firstSentence(skillInfo.get(s)!.lede))}</p></li>`).join("\n")}
      </ul>
      <p class="small">Every rule says how to detect the problem in code, the smallest fix, what the fix must not break, and how to verify it. Provider facts carry a checked date and a source.</p>
    </div>
  </section>

  <section class="sec news-sec" aria-labelledby="news-title">
    <div class="wrap split">
      <div>
        <h2 id="news-title">News</h2>
        <ul class="dated">
${news.slice(0, 3).map((n) => `          <li><time datetime="${n.date}">${n.date}</time> <a href="${n.href}">${e(n.title)}</a></li>`).join("\n")}
        </ul>
        <p><a class="more" href="${url("news")}">All news</a></p>
      </div>
      <div>
        <h2>Audits</h2>
        <p>Audits of public repositories, each dated, with the commit and leanprompt version it ran on and the maintainers’ response.</p>
        <p><a class="more" href="${url("audits")}">See the audits</a></p>
      </div>
    </div>
  </section>

  <section class="sec note-sec" aria-label="What it is not">
    <div class="wrap">
      <p class="note">leanprompt is not a prompt-compression library, and it works on the app the assistant is building, not on the assistant’s own bill. No telemetry, no proxy, no hosted service, no account. It does not edit your code without asking.</p>
    </div>
  </section>`,
  });

  // --- Doc pages
  const docPage = (key: string, file: string, section: PageSpec["section"], description?: string, crumbs: [string, string][] = []) => {
    const r = renderMarkdown(read(file), file, root);
    emit({ key, title: r.title, description: clip(description ?? r.lede), section, crumbs, body: article(e(r.title), r.html, file) });
  };
  docPage("how-it-works", "docs/how-it-works.md", "how-it-works");
  docPage("install", "docs/install.md", "install", "Install leanprompt's skills for Claude Code, Codex, Cursor, OpenCode or any AGENTS.md reader, for one project or all of them, and keep them up to date.");
  docPage("score", "docs/score.md", "score");

  // --- Rules
  const bySkill = SKILL_ORDER.map((s) => [s, rulePages.filter((r) => r.skill === s)] as const);
  emit({
    key: "rules",
    title: "The rules",
    description: `All ${rulePages.length} leanprompt rules for cacheable prompts, calls and output that are not wasted, lean prompts and self-hosted engines, each with a way to detect and verify it.`,
    section: "rules",
    crumbs: [],
    body: article(
      "The rules",
      `<p class="lede">${rulePages.length} rules in four skills. Each rule file says how to detect the problem in code (Python, TypeScript and Go), the smallest fix, what the fix must not break, and how to verify it. Your assistant loads a rule only when its skill points at it.</p>
${bySkill
  .map(
    ([s, list]) => `<h2 id="${s}">${e(s)}</h2>
<p>${e(skillInfo.get(s)!.lede)}</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="${e(s)} rules"><table class="rules-table"><thead><tr><th>Rule</th><th>Title</th><th>Saves</th><th>Severity</th></tr></thead><tbody>
${list.map((r) => `<tr><td><a href="${ruleUrl(r.id)}"><code>${r.id}</code></a></td><td><a href="${ruleUrl(r.id)}">${e(r.title)}</a></td><td>${e(SAVES_TEXT[r.saves] ?? r.saves)}</td><td>${e(r.severity)}</td></tr>`).join("\n")}
</tbody></table></div>`,
  )
  .join("\n")}`,
    ),
  });
  rulePages.forEach((r, i) => {
    const prev = rulePages[i - 1];
    const next = rulePages[i + 1];
    const evidence = r.evidence.map((x) => `<a href="${REPO}/blob/main/docs/evidence.md" rel="noopener">${e(x)}</a>`).join(", ");
    const meta = `<dl class="facts">
<div><dt>Skill</dt><dd><a href="${url("rules")}#${r.skill}">${e(r.skill)}</a></dd></div>
<div><dt>Saves</dt><dd>${e(SAVES_TEXT[r.saves] ?? r.saves)}</dd></div>
<div><dt>Severity</dt><dd>${e(r.severity)}</dd></div>
<div><dt>Applies to</dt><dd>${r.appliesTo.map((a) => e(a)).join(", ")}</dd></div>
${evidence ? `<div><dt>Evidence</dt><dd>${evidence}</dd></div>` : ""}
</dl>`;
    const pager = `<nav class="pager" aria-label="Other rules">${prev ? `<a rel="prev" href="${ruleUrl(prev.id)}"><span>Previous</span> ${prev.id} ${e(prev.title)}</a>` : "<span></span>"}${next ? `<a rel="next" href="${ruleUrl(next.id)}"><span>Next</span> ${next.id} ${e(next.title)}</a>` : ""}</nav>`;
    emit({
      key: ruleKey(r.id),
      title: `${r.id}: ${r.title}`,
      description: clip(r.lede),
      section: "rules",
      crumbs: [["Rules", "rules"]],
      crumbLabel: r.id,
      ogType: "article",
      body: article(`<span class="rule-id">${r.id}</span> ${e(r.title)}`, `${meta}\n${r.html}\n${pager}`, r.file),
    });
  });

  // --- Examples
  const exampleNames = readdirSync(join(root, "examples")).filter((d) => existsSync(join(root, "examples", d, "README.md"))).sort();
  const exampleLede = (md: string) => {
    const paras = md.split(/\n\n+/).filter((p) => p.trim() && !p.startsWith("#") && !p.startsWith("Rule"));
    return plain(paras[0] ?? "");
  };
  const reportPair = (name: string) => ["before", "after"].filter((f) => existsSync(join(root, "site", "examples", name, `${f}.findings.json`)));
  emit({
    key: "examples",
    title: "Examples",
    description: "Small example apps, each in a before and an after form with an answer check, and the audit pages leanprompt writes for them.",
    section: "examples",
    crumbs: [],
    body: article(
      "Examples",
      `<p class="lede">Each example is a small app in two forms, <code>before/</code> and <code>after/</code>, with a check that the answers did not change. They are how leanprompt tests its own rules.</p>
<ul class="cards">
${exampleNames
  .map((n) => {
    const md = read(`examples/${n}/README.md`);
    const pair = reportPair(n);
    const extra = pair.length ? `<p class="small">Audit pages: ${pair.map((f) => `<a href="${url(`examples/${n}/${f}`)}">${f}</a>`).join(" · ")}</p>` : "";
    return `<li><h2><a href="${url(`examples/${n}`)}">${e(n)}</a></h2><p>${e(clip(exampleLede(md), 220))}</p>${extra}</li>`;
  })
  .join("\n")}
</ul>`,
    ),
  });
  for (const n of exampleNames) {
    const file = `examples/${n}/README.md`;
    const md = read(file);
    const r = renderMarkdown(md, file, root);
    const pair = reportPair(n);
    let top = "";
    if (pair.length === 2) {
      top = `<div class="pair">
<figure><figcaption><b>Without leanprompt</b> <a href="${url(`examples/${n}/before`)}">Open the audit page for before/</a></figcaption><a class="shot" href="${url(`examples/${n}/before`)}"><img src="${asset("readme-without.webp")}" width="1400" height="600" alt="The audit page for ${e(n)} before the fix"></a></figure>
<figure><figcaption><b>With leanprompt</b> <a href="${url(`examples/${n}/after`)}">Open the audit page for after/</a></figcaption><a class="shot" href="${url(`examples/${n}/after`)}"><img src="${asset("readme-with.webp")}" width="1400" height="600" alt="The audit page for ${e(n)} after the fix" loading="lazy"></a></figure>
</div>
<p class="small">These are the pages <code>leanprompt report --html</code> writes, from the findings in <a href="${REPO}/tree/main/site/examples/${n}" rel="noopener">site/examples/${e(n)}</a>. Their figures are estimates from the code, not measurements.</p>
`;
      for (const form of pair) {
        const findingsText = read(`site/examples/${n}/${form}.findings.json`);
        const parsed = parseFindings(findingsText, ruleIds, noteRuleIds);
        if (parsed.errors.length) throw new Error(`site/examples/${n}/${form}.findings.json: ${parsed.errors.join("; ")}`);
        const html = renderReport({
          findings: parsed.findings,
          score: scoreOf(parsed.findings, releases[0]?.date ?? "", pkg.version),
          rules,
          project: `${n} (${form}/)`,
          version: pkg.version,
          ...(parsed.average_call ? { average_call: parsed.average_call } : {}),
        });
        emitReport(`examples/${n}/${form}`, html, {
          title: `${n}, ${form} the fix: the leanprompt audit page`,
          description: `The page leanprompt report --html writes for the ${n} example app, ${form} the fix. Estimates from the code, not measurements.`,
          back: [`examples/${n}`, `Back to the ${n} example`],
          note: `This is the page <code>leanprompt report --html</code> writes for the ${e(n)} example, ${form} the fix, on the leanprompt site.`,
        });
      }
    }
    emit({ key: `examples/${n}`, title: r.title || n, description: clip(exampleLede(md)), section: "examples", crumbs: [["Examples", "examples"]], body: article(e(r.title || n), top + r.html, file) });
  }

  // --- News
  emit({
    key: "news",
    title: "News",
    description: "leanprompt releases and posts, newest first.",
    section: "news",
    crumbs: [],
    body: article(
      "News",
      `<p class="lede">Releases and posts, newest first. Every release is in the <a href="${url("news/changelog")}">changelog</a>; there is also an <a href="${BASE}news/feed.xml">Atom feed</a>.</p>
<ul class="dated long">
${news.map((n) => `<li><time datetime="${n.date}">${n.date}</time><div><a href="${n.href}">${e(n.title)}</a>${n.text ? `<p>${e(clip(n.text, 200))}</p>` : ""}</div></li>`).join("\n")}
</ul>`,
    ),
  });
  docPage("news/changelog", "docs/CHANGELOG.md", "news", "Every leanprompt release and what changed in it, newest first.", [["News", "news"]]);
  for (const p of posts) {
    const r = renderMarkdown(p.body, p.file, root, { keepTitle: true });
    emit(
      {
        key: `news/${p.slug}`,
        title: p.title,
        description: clip(p.description),
        section: "news",
        crumbs: [["News", "news"]],
        ogType: "article",
        published: p.date,
        body: article(e(p.title), `<p class="dateline"><time datetime="${p.date}">${p.date}</time></p>\n${r.html}`, p.file),
      },
      p.date,
    );
  }
  files.set("leanprompt/news/feed.xml", atom(news));

  // --- Audits
  const auditOrder = sortForIndex(audits);
  const real = audits.filter((a) => a.meta.status !== "demo");
  const problems = real.reduce(
    (n, a) => n + a.findings.filter((f) => knownOf(f)?.kind !== "declined").length + (a.notes ?? []).filter((x) => x.known?.kind !== "declined").length,
    0,
  );
  const fixedUpstream = real.reduce((n, a) => n + a.findings.filter((f) => f.fixed).length, 0);
  const reported = real.filter((a) => badgeOf(a) === "reported").length;
  const planned = real.filter((a) => badgeOf(a) === "planned").length;
  const stat = (n: number, label: string) => `<li><span class="stat-n">${n}</span> <span class="stat-l">${e(label)}</span></li>`;
  const strip = `<ul class="audit-strip" aria-label="All audits at a glance">
${stat(real.length, real.length === 1 ? "open-source app audited" : "open-source apps audited")}
${stat(problems, problems === 1 ? "problem found" : "problems found")}
${stat(fixedUpstream, "fixed upstream")}
${stat(reported, "reported to the maintainers")}${planned ? `\n${stat(planned, "already planned by the maintainers")}` : ""}
</ul>`;
  // The illustrations ship with the site, beside each audit page: /leanprompt/audits/<slug>/illustration.webp and og.jpg.
  for (const a of audits) {
    if (!a.images) continue;
    files.set(`leanprompt/audits/${a.slug}/${ILLUSTRATION_FILES.card.file}`, a.images.card);
    files.set(`leanprompt/audits/${a.slug}/${ILLUSTRATION_FILES.og.file}`, a.images.og);
  }
  /** The illustration's <img>: lazy unless it is in the first screen (the first row of cards, or the page header). */
  const auditImg = (a: Audit, eager: boolean, cls: string) => {
    if (!a.images || !a.meta.illustration) return "";
    const c = ILLUSTRATION_FILES.card;
    return `<img class="${cls}" src="${url(`audits/${a.slug}`)}${c.file}?v=${hash(a.images.card)}" width="${c.width}" height="${c.height}" alt="${e(a.meta.illustration.alt)}"${eager ? "" : ' loading="lazy"'} decoding="async">`;
  };
  const auditCard = (a: Audit, i: number) => {
    const m = a.meta;
    // Two cards to a row on a desktop: the first two images load at once, the rest when scrolled to.
    return `<li class="audit-card">
<div class="audit-head"><h2><a href="${url(`audits/${a.slug}`)}">${e(m.headline ?? auditTitle(a))}</a></h2>${auditImg(a, i < 2, "audit-art")}</div>
<p class="audit-tags">${auditTags(a)}</p>
${m.subtitle ? `<p class="audit-sub">${e(m.subtitle)}</p>` : ""}
${bigNumber(a)}
<p class="audit-foot"><span>${e(m.owner)}/${e(m.name)}</span> · <time datetime="${m.date}">${m.date}</time></p>
</li>`;
  };
  emit({
    key: "audits",
    title: "Audits",
    description: "Audits of public repositories: what each app’s LLM calls get wrong and what it costs, estimated from the code, dated, with the maintainers’ response.",
    section: "audits",
    crumbs: [],
    body: article(
      "Audits",
      `${audits.length ? strip : ""}
<p class="lede">What a leanprompt audit finds in public repositories. Each audit names the commit and the leanprompt version it ran on, and links the maintainers’ issue and response. The figures are estimates from reading the code, not measurements.</p>
<p>We tell the maintainers before an audit is published. Where a repository has no public channel for it, the audit page says so. ${CORRECTIONS_LINE.replace("open an issue", `<a href="${REPO}/issues/new" rel="noopener">open an issue</a>`).replace(CONTACT, `<a href="mailto:${CONTACT}">${CONTACT}</a>`)}</p>
${audits.length ? `<ul class="audit-cards">\n${auditOrder.map(auditCard).join("\n")}\n</ul>` : "<p>No audits yet.</p>"}`,
    ),
  });
  for (const a of audits) {
    emitAudit(a);
  }

  function emitAudit(a: Audit) {
    const key = `audits/${a.slug}`;
    const m = a.meta;
    const short = m.commit.slice(0, 7);
    const ranked = rankFindings(a.findings);
    const known = ranked.filter((f) => isKnownFinding(f));
    const open = ranked.filter((f) => !f.fixed && !isKnownFinding(f) && !isServerFinding(f));
    const server = ranked.filter((f) => !f.fixed && !isKnownFinding(f) && isServerFinding(f));
    const fixed = ranked.filter((f) => f.fixed);
    const notes = a.notes ?? [];
    const places = open.filter((f) => !costsNothing(f)).length;
    const zero = open.length - places;
    const knownLive = known.filter((f) => knownOf(f)!.kind !== "declined");
    const declined = known.filter((f) => knownOf(f)!.kind === "declined");
    // Finding numbers by id, for overlaps and notes.
    const numById = new Map<string, number>();
    [...open, ...server, ...knownLive, ...fixed].forEach((f, i) => f.id !== undefined && numById.set(f.id, i + 1));
    const linkify = (t: string) => e(t).replace(/https:\/\/github\.com\/[\w./#-]+/g, (u) => `<a href="${u}" rel="noopener">${u}</a>`);
    const score = scoreOf(a.findings, m.date, m.leanprompt);
    // A private repository's code is behind a sign-in: name the file and line, link nothing.
    const priv = m.visibility === "private";
    const codeAt = (file: string, line: number) =>
      priv ? `<code>${e(file)}:${line}</code>` : `<a href="${m.repo}/blob/${m.commit}/${file.split("/").map(encodeURIComponent).join("/")}#L${line}" rel="noopener"><code>${e(file)}:${line}</code></a>`;
    const where = (f: Finding) => (f.file === "<external>" ? e(f.where ?? "outside the repository") : codeAt(f.file, f.line));
    const tokens = (f: Finding) => {
      const t = tokensLost(f);
      if (!t) return "";
      const parts = [
        t.uncached !== undefined ? `${formatTokens(t.uncached)} prompt tokens the cache could have served` : "",
        t.prompt !== undefined ? `${formatTokens(t.prompt)} prompt tokens that need not be sent` : "",
        t.output !== undefined ? `${formatTokens(t.output)} output tokens thrown away` : "",
      ].filter(Boolean);
      const per = unitOf(f) === "run" ? `per run${a.run ? ` (${e(a.run)})` : ""}` : "per 1,000 calls";
      const counted = f.evidence === "counted";
      return `<p class="estimate"><span class="est-tag">${counted ? "Counted" : "Estimate"}</span> ${parts.join("; ")}, ${per}.${counted && f.counted_from ? ` Counted from ${e(f.counted_from)}.` : ""}</p>`;
    };
    const card = (f: Finding, i: number) => `<li class="finding" id="f${i + 1}">
<h3><a href="${ruleUrl(f.rule)}"><code>${f.rule}</code></a> ${e(rules.get(f.rule)?.title ?? "")}</h3>
<p class="small">${where(f)} · severity ${e(f.severity)} · saves ${e((SAVES_TEXT[f.saves] ?? f.saves).toLowerCase())}${f.status === "needs-facts" ? " · needs a fact to confirm" : f.status === "frequency-unknown" ? " · how often is assumed" : f.status === "size-unknown" ? " · size is assumed" : ""}${costsNothing(f) ? " · costs no tokens today" : ""}${f.scope ? ` · ${e(SCOPE_LABEL[f.scope])}` : ""}</p>
${f.problem ? `<p><b>What happens.</b> ${e(f.problem)}</p>` : ""}
${f.change ? `<p><b>The change.</b> ${e(f.change)}</p>` : ""}
${f.why ? `<p><b>Why it helps.</b> ${e(f.why)}</p>` : ""}
${knownOf(f) ? `<p class="planned"><b>${e(KNOWN_LABEL[knownOf(f)!.kind])}.</b> ${linkify([knownOf(f)!.note, knownOf(f)!.url].filter(Boolean).join(" "))}</p>` : ""}
${(f.overlaps ?? []).filter((id) => numById.has(id)).length ? `<p class="small"><b>Overlaps.</b> Finding ${(f.overlaps ?? []).filter((id) => numById.has(id)).map((id) => `<a href="#f${numById.get(id)}">${numById.get(id)}</a>`).join(", ")} loses some of the same tokens; the totals count the larger once.</p>` : ""}
${f.estimate ? `<p class="estimate"><span class="est-tag">${f.evidence === "counted" ? "Counted" : "Estimate"}</span> ${e(f.estimate)}</p>` : tokens(f)}
${f.assumptions ? `<p class="small"><b>Assumptions.</b> ${e(f.assumptions)}</p>` : ""}
${f.reach ? `<p class="small"><b>Who reaches this.</b> ${e(f.reach)}</p>` : ""}
${f.cached_discount === "none" ? `<p class="small"><b>Money.</b> ${e(NO_DISCOUNT_LINE)}</p>` : ""}
${f.confirm ? `<p class="small"><b>${f.status === "frequency-unknown" ? "How often." : f.status === "size-unknown" ? "How big." : "To confirm."}</b> ${e(f.confirm)}</p>` : ""}
</li>`;
    const noteWhere = (n: Note) => (n.file === "<external>" ? "outside the repository" : codeAt(n.file, n.line));
    const noteCard = (n: Note) => `<li class="note">
<h3>${e(n.title)}</h3>
<p class="small">${noteWhere(n)}${n.rule ? ` · <a href="${ruleUrl(n.rule)}"><code>${e(n.rule)}</code></a> ${e(rules.get(n.rule)?.title ?? "")}${n.severity ? ` · severity ${e(n.severity)}` : ""}` : ""}${n.scope ? ` · ${e(SCOPE_LABEL[n.scope])}` : ""}${n.finding !== undefined && numById.has(n.finding) ? ` · the same problem as <a href="#f${numById.get(n.finding)}">finding ${numById.get(n.finding)}</a>` : ""}</p>
${n.known?.kind === "declined" ? `<p><b>${e(KNOWN_LABEL.declined)}.</b> ${linkify([n.known.note, n.known.url].filter(Boolean).join(" "))}</p>` : `<p><b>What happens.</b> ${e(n.problem)}</p>
<p><b>The change.</b> ${e(n.change)}</p>${n.known ? `\n<p class="planned"><b>${e(KNOWN_LABEL[n.known.kind])}.</b> ${linkify([n.known.note, n.known.url].filter(Boolean).join(" "))}</p>` : ""}`}
${n.why ? `<p><b>Why it matters.</b> ${e(n.why)}</p>` : ""}
${n.verify ? `<p class="small"><b>To check.</b> ${e(n.verify)}</p>` : ""}
</li>`;
    const mt = m.maintainer;
    const response = mt?.response
      ? `<blockquote class="response"><p>${e(mt.response)}</p><footer>The maintainers, <time datetime="${mt.response_date}">${mt.response_date}</time></footer></blockquote>`
      : "<p>No response from the maintainers yet.</p>";
    const links = [mt?.issue ? `<a href="${mt.issue}" rel="noopener">${mt.issue.includes("#issuecomment-") ? "the comment" : "the issue"}</a>` : "", mt?.pr ? `<a href="${mt.pr}" rel="noopener">the pull request</a>` : ""].filter(Boolean).join(" and ");
    const scope = m.path ? `<code>${e(m.path)}/</code> in ` : "";
    const corrections = `<p class="corrections">${CORRECTIONS_LINE.replace(CONTACT, `<a href="mailto:${CONTACT}">${CONTACT}</a>`).replace("open an issue", `<a href="${REPO}/issues/new" rel="noopener">open an issue</a>`)}</p>`;
    const body = `<p class="audit-tags">${auditTags(a)}</p>
${m.subtitle ? `<p class="audit-sub lede">${e(m.subtitle)}</p>` : ""}
${bigNumber(a, true)}
<p class="dateline">Audited <time datetime="${m.date}">${m.date}</time> with leanprompt ${e(m.leanprompt)}</p>
<p class="notice"><b>Estimates, not measurements.</b> ${ESTIMATE_LABEL}</p>
<dl class="facts">
${priv ? `<div><dt>Repository</dt><dd>${e(m.owner)}/${e(m.name)}, a private repository</dd></div>
<div><dt>Commit audited</dt><dd><code>${short}</code></dd></div>
${m.path ? `<div><dt>Folder</dt><dd><code>${e(m.path)}/</code></dd></div>` : ""}
<div><dt>Permission</dt><dd>Published with the maintainers’ written permission, given <time datetime="${m.consent!.date}">${m.consent!.date}</time>.${m.consent!.note ? ` ${e(m.consent!.note)}` : ""}</dd></div>` : `<div><dt>Repository</dt><dd><a href="${m.repo}" rel="noopener">${e(m.owner)}/${e(m.name)}</a></dd></div>
<div><dt>Commit audited</dt><dd><a href="${m.repo}/tree/${m.commit}" rel="noopener"><code>${short}</code></a></dd></div>
${m.path ? `<div><dt>Folder</dt><dd><a href="${m.repo}/tree/${m.commit}/${m.path}" rel="noopener"><code>${e(m.path)}/</code></a></dd></div>` : ""}`}
<div><dt>leanprompt version</dt><dd><a href="${REPO}/tree/v${e(m.leanprompt)}" rel="noopener">${e(m.leanprompt)}</a></dd></div>
<div><dt>Audit date</dt><dd><time datetime="${m.date}">${m.date}</time></dd></div>
<div><dt>Status</dt><dd>${m.no_channel ? e(m.no_channel).replace(CONTACT, `<a href="mailto:${CONTACT}">${CONTACT}</a>`) : e(STATUS_TEXT[m.status])}</dd></div>
${links ? `<div><dt>Maintainers</dt><dd>${links}</dd></div>` : ""}
${a.unattended ? `<div><dt>How it ran</dt><dd>${e(UNATTENDED_LINE)}</dd></div>` : ""}
</dl>
${m.summary ? `<p>${e(m.summary)}</p>` : ""}
<p>leanprompt read ${scope}the code at commit <code>${short}</code> and found ${places} ${places === 1 ? "place" : "places"} where its LLM calls could use fewer tokens${zero ? `, ${zero} more that ${zero === 1 ? "costs" : "cost"} no tokens today` : ""}${known.length ? `, ${known.length} the project already knows about` : ""}${fixed.length ? `, and ${fixed.length} already fixed` : ""}${notes.length ? `, plus ${notes.length} other ${notes.length === 1 ? "problem" : "problems"}, not scored` : ""}. Static score: ${score.score} of 100 (an estimate from the findings${known.length ? ", leaving out what the project already knows about" : ""}). The code may have changed since.</p>
${a.gateway || scopeCounts(a.findings, notes) ? `<p class="small">${e(scopeLine(scopeCounts(a.findings, notes)))}</p>` : ""}
<h2 id="findings">Findings</h2>
${open.length ? `<ol class="findings">\n${open.map(card).join("\n")}\n</ol>` : "<p>No open findings.</p>"}
${server.length ? `<h2 id="server">Questions for the server’s administrator</h2>\n<p>Settings of the server or engine the app calls, not of the app’s code; left out of the static score.</p>\n<ol class="findings" start="${open.length + 1}">\n${server.map((f, i) => card(f, open.length + i)).join("\n")}\n</ol>` : ""}
${known.length ? `<h2 id="known">Already known to the project</h2>\n<p>The project’s own issues, pull requests or docs already cover these, so they are not counted above and are left out of the static score.</p>\n${knownLive.length ? `<ol class="findings" start="${open.length + server.length + 1}">\n${knownLive.map((f, i) => card(f, open.length + server.length + i)).join("\n")}\n</ol>` : ""}${declined.length ? `\n<h3>Declined by the project</h3>\n<ul class="declined">\n${declined.map((f) => `<li>${e(f.problem ? (/^(.+?[.?])(\s|$)/.exec(f.problem)?.[1] ?? f.problem) : (rules.get(f.rule)?.title ?? f.rule))} ${where(f)} ${linkify(knownOf(f)!.url ?? "")}</li>`).join("\n")}\n</ul>` : ""}` : ""}
${fixed.length ? `<h2 id="fixed">Already fixed</h2>\n<ol class="findings" start="${open.length + server.length + knownLive.length + 1}">\n${fixed.map((f, i) => card(f, open.length + server.length + knownLive.length + i)).join("\n")}\n</ol>` : ""}
${notes.length ? `<h2 id="notes">Other problems the audit found</h2>\n<p>Problems read in the code that cost no tokens of their own, such as a cost meter or an error path. Not scored.</p>\n<ol class="notes">\n${notes.map(noteCard).join("\n")}\n</ol>` : ""}
<h2 id="response">The maintainers’ response</h2>
${response}
<h2 id="method">How this was made</h2>
<p>The <a href="${url("how-it-works")}">llm-call-audit</a> skill read the code and wrote <a href="${REPO}/blob/main/site/audits/${a.folder}/findings.json" rel="noopener">findings.json</a>; nothing was run against the project’s providers. <a href="${url(`${key}/report`)}">The full audit page</a> is what <code>leanprompt report --html</code> writes from the same findings.</p>
${corrections}`;
    emit(
      {
        key,
        title: auditTitle(a),
        description: clip(`${m.headline ? `${m.headline}. ` : ""}An audit of ${m.owner}/${m.name}'s LLM calls, estimated from the code at commit ${short} with leanprompt ${m.leanprompt} on ${m.date}.`),
        section: "audits",
        crumbs: [["Audits", "audits"]],
        crumbLabel: `${m.owner}/${m.name}`,
        ogType: "article",
        published: m.date,
        ...(a.images && m.illustration ? { ogImage: { url: canonical(key) + ILLUSTRATION_FILES.og.file, width: ILLUSTRATION_FILES.og.width, height: ILLUSTRATION_FILES.og.height, alt: m.illustration.alt } } : {}),
        body: article(e(m.headline ?? auditTitle(a)), body, undefined, { h1Class: "audit-h1", beside: auditImg(a, true, "audit-art audit-art-page") }),
      },
      m.date,
    );
    const html = renderReport({ findings: a.findings, score, rules, project: `${m.owner}/${m.name}`, version: m.leanprompt, ...(a.average_call ? { average_call: a.average_call } : {}), ...(a.kvsig ? { kvsig: a.kvsig } : {}), ...(a.notes ? { notes: a.notes } : {}), ...(a.unattended ? { unattended: true } : {}), ...(a.gateway ? { gateway: true } : {}), ...(a.run !== undefined ? { run: a.run } : {}) });
    emitReport(`${key}/report`, html, {
      title: `${auditTitle(a)}: the full audit page`,
      description: `The page leanprompt report --html writes for ${m.owner}/${m.name} at commit ${short}. Estimates from the code, not measurements.`,
      back: [key, `Back to the audit of ${m.owner}/${m.name}`],
      note: `The page <code>leanprompt report --html</code> writes for ${e(m.owner)}/${e(m.name)} at commit <code>${short}</code>, audited ${m.date}. ${ESTIMATE_LABEL} ${CORRECTIONS_LINE.replace(CONTACT, `<a href="mailto:${CONTACT}">${CONTACT}</a>`)}`,
    });
  }

  // --- 404 (the static server answers it for any unknown path under /leanprompt/)
  const notFound = page(
    {
      key: "404",
      title: "Page not found",
      description: "There is no leanprompt page at this address.",
      noindex: true,
      body: article("Page not found", `<p class="lede">There is no page at this address. It may have moved when the docs changed.</p>\n<p><a href="${BASE}">leanprompt home</a> · <a href="${url("rules")}">the rules</a> · <a href="${url("news")}">news</a></p>`),
    },
    asset,
  );
  files.set("leanprompt/404.html", notFound);
  pages.push({ key: "404", file: "leanprompt/404.html", index: false });

  // --- Report assets, then every asset
  if (reportCss !== undefined) {
    const w = [...widths].sort((a, b) => a - b).map((n) => `.fill[data-w="${n}"]{width:${n}%}`).join("");
    assetFiles.set("report.css", Buffer.from(`${reportCss}\n/* The token bar's widths (inline styles in the page report --html writes). */\n${w}\n${SITEBAR_CSS}`));
  }
  if (reportJs !== undefined) assetFiles.set("report.js", Buffer.from(reportJs));
  for (const [file, content] of files) {
    if (typeof content !== "string" || !file.endsWith(".html")) continue;
    let c = content;
    if (c.includes("@@REPORT_CSS@@")) c = c.replace("@@REPORT_CSS@@", asset("report.css"));
    if (c.includes("@@REPORT_JS@@")) c = c.replace("@@REPORT_JS@@", asset("report.js"));
    files.set(file, c);
  }
  for (const [name, b] of assetFiles) files.set(`leanprompt/assets/${name}`, b);

  // --- sitemap.xml and llms.txt
  const indexed = pages.filter((p) => p.index);
  files.set(
    "leanprompt/sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed
      .map((p) => `  <url><loc>${canonical(p.key)}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ""}</url>`)
      .join("\n")}\n</urlset>\n`,
  );
  files.set("leanprompt/llms.txt", llms(pkg.description, rulePages, exampleNames, audits, posts));
  return { files, pages };
}

const SITEBAR_CSS = `.lp-sitebar{background:#1C1409;color:#EAE5DC;border-bottom:1px solid #433C31;font:15px/1.5 system-ui,sans-serif;padding:10px 16px}
.lp-sitebar p{max-width:72rem;margin:0 auto}
.lp-sitebar a{color:#F2A516}
.lp-sitebar code{font-size:.95em}`;

function firstSentence(t: string): string {
  const m = /^.+?[.:](?=\s|$)/.exec(t);
  return (m ? m[0] : t).replace(/:$/, ".");
}

/** The page title: the repository and the headline (older audits without one: the neutral title). */
export function auditTitle(a: Audit): string {
  return a.meta.headline ? `${a.meta.name}: ${a.meta.headline}` : `Where ${a.meta.name} could save tokens`;
}

/** The kind label and the status badge, above an audit's headline. */
function auditTags(a: Audit): string {
  const b = badgeOf(a);
  return [a.meta.kind ? `<span class="kind">${e(a.meta.kind)}</span>` : "", b ? `<span class="badge badge-${b}">${e(BADGES[b])}</span>` : ""].filter(Boolean).join(" ");
}

/** The big number: a finding's tokens, always labelled an estimate, or a count read from the project's output. */
function bigNumber(a: Audit, onPage = false): string {
  const b = bigNumberOf(a);
  if (!b) return "";
  const cls = onPage ? "big big-page" : "big";
  if (b.kind === "count")
    return `<p class="${cls}"><span class="big-n">${e(b.text)}</span> <span class="big-u">${e(b.label)}</span> <span class="big-tag">counted from their own output</span></p>`;
  return `<p class="${cls}"><span class="big-n">≈ ${b.text}</span> <span class="big-u">tokens per 1,000 ${b.unit}, ${e(b.label)}</span> <span class="big-tag">estimate</span></p>`;
}

function scoreOf(findings: Finding[], date: string, version: string): ScoreFile {
  const s = staticScore(findings);
  return {
    score: s.score,
    kind: "static",
    weights: s.weights,
    inputs: s.inputs,
    message: `${s.score} static`,
    color: badgeColor(s.score, "static"),
    diagnostics: { default_shares: s.default_shares.used, findings: s.default_shares.of, ...(s.known_findings ? { known_findings: s.known_findings } : {}) },
    ...(s.known_findings ? { known: { findings: s.known_findings, with_known_score: staticScore(findings, undefined, { includeKnown: true }).score } } : {}),
    ...(date ? { date } : {}),
    leanprompt: version,
  };
}

/** The body of an article page: its h1, its content and, for a page made from a file, where to edit it. */
function article(titleHtml: string, inner: string, sourceFile?: string, o: { h1Class?: string; beside?: string } = {}): string {
  const src = sourceFile ? `\n      <p class="source"><a href="${REPO}/blob/main/${sourceFile}" rel="noopener">Edit this page on GitHub</a></p>` : "";
  const h1 = `<h1${o.h1Class ? ` class="${o.h1Class}"` : ""}>${titleHtml}</h1>`;
  // A picture beside the headline comes after it in the markup, so the headline is read first.
  return `  <article class="sec article">
    <div class="wrap prose">
      ${o.beside ? `<div class="audit-head audit-head-page">${h1}${o.beside}</div>` : h1}
${inner}${src}
    </div>
  </article>`;
}

function atom(items: { date: string; title: string; href: string; text: string }[]): string {
  const updated = items[0]?.date ?? "2026-01-01";
  const entries = items
    .map(
      (n) => `  <entry>
    <title>${e(n.title)}</title>
    <link href="${ORIGIN}${n.href}"/>
    <id>${ORIGIN}${n.href}</id>
    <updated>${n.date}T00:00:00Z</updated>
    <summary>${e(n.text)}</summary>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>leanprompt news</title>
  <link href="${canonical("news")}"/>
  <link rel="self" href="${ORIGIN}${BASE}news/feed.xml"/>
  <id>${canonical("news")}</id>
  <updated>${updated}T00:00:00Z</updated>
  <author><name>The LM Warden Team</name></author>
${entries}
</feed>
`;
}

function llms(description: string, rules: RulePage[], examples: string[], audits: Audit[], posts: { slug: string; title: string; description: string }[]): string {
  const l = (key: string, title: string, text: string) => `- [${title}](${canonical(key)}): ${text}`;
  return `# leanprompt

> ${description}

leanprompt is a set of skills for coding assistants (Claude Code, Codex, Cursor, OpenCode and any agent that reads AGENTS.md) by the LM Warden Team. Install it from a project root with \`npx leanprompt install\`. It is not a prompt-compression library: it works on the app the assistant is building. No telemetry, no hosted service. Source: ${REPO}

## Pages

${l("", "Home", "what leanprompt does, the install command, a before and after example")}
${l("how-it-works", "How it works", "the problem, the audit, the rules at a glance and how to prove a fix")}
${l("install", "Install", "every assistant, project or global, the Claude Code plugin, Windows")}
${l("score", "The score and the badge", "measured and static scores, calibration, the shields.io badge")}
${l("rules", "Rules", "all rules, grouped by skill")}
${l("examples", "Examples", "example apps in before and after forms with answer checks")}
${l("audits", "Audits", "audits of public repositories, estimates from the code, with the maintainers’ response")}
${l("news", "News", "releases and posts")}

## Rules

${rules.map((r) => l(ruleKey(r.id), `${r.id}: ${r.title}`, `${r.skill}, saves ${r.saves}, severity ${r.severity}`)).join("\n")}

## Examples

${examples.map((n) => `- [${n}](${canonical(`examples/${n}`)})`).join("\n")}
${audits.length ? `\n## Audits\n\n${audits.map((a) => l(`audits/${a.slug}`, auditTitle(a), `${a.meta.repo} at ${a.meta.commit.slice(0, 7)}, ${a.meta.date}, leanprompt ${a.meta.leanprompt}; estimates from the code, not measurements`)).join("\n")}\n` : ""}${posts.length ? `\n## News\n\n${posts.map((p) => l(`news/${p.slug}`, p.title, p.description)).join("\n")}\n` : ""}
## Optional

- [Changelog](${canonical("news/changelog")}): every release, newest first
- [LM Warden](${ORIGIN}/llms.txt): the self-hosted LLM server by the same team
`;
}
