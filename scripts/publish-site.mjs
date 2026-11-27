#!/usr/bin/env node
// npm run publish:site: publish the website to S3-compatible object storage, where the
// lmwarden.com server reads it (it serves /leanprompt/ from the copy that current.json names).
//
// Layout under s3://<S3_BUCKET>/<S3_PREFIX>/:
//   <commit>/<path>          one full build per published commit; never rewritten
//                            (Cache-Control: public, max-age=31536000, immutable)
//   manifests/<commit>.json  that build's manifest, kept for rollbacks
//   current.json             the live manifest, uploaded LAST (Cache-Control: no-cache):
//                            {"commit", "version", "published", "files": {path: sha256}}
// The server checks every file against the sha256 in current.json and switches to a commit
// only once all of it loaded, so a half-finished upload is never served.
//
// What is published: by default the tip of the public repository's main branch (fetched
// from LEANPROMPT_PUBLIC_REPO), built from a clean `git archive` of that commit in a
// temporary directory. --ref <commit> publishes another commit, which must be on public
// main. --allow-unpublished builds the current checkout's HEAD in place instead (for a
// preview; the tree must be clean).
//
//   --dry-run              build and print what would be uploaded; no credentials needed
//   --ref <commit>         publish this commit of public main (default: its tip)
//   --allow-unpublished    publish this checkout's HEAD, even if it is not on public main
//   --rollback <commit>    point current.json at a commit published before; uploads nothing else
//   --help
//
// Environment (npm run loads .env from the current directory; never commit it):
//   S3_ENDPOINT     the S3 endpoint, path-style (https://<host>), for example https://media.example.com
//   S3_BUCKET       the bucket
//   S3_PREFIX       the key prefix (default leanprompt-site)
//   S3_ACCESS_KEY   an access key allowed to read and write <bucket>/<prefix>/*
//   S3_SECRET_KEY   its secret; never printed
//   S3_REGION       the signing region (default us-east-1)
//   LEANPROMPT_PUBLIC_REPO  the public repository (default https://github.com/Podwarden/leanprompt.git)
//
// Node 20.19+, no npm dependencies: requests are signed with AWS Signature Version 4 here.
// See docs/site.md.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PREFIX = "leanprompt-site";
export const DEFAULT_REGION = "us-east-1";
export const DEFAULT_PUBLIC_REPO = "https://github.com/Podwarden/leanprompt.git";
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_MANIFEST = "no-cache";

/** Content types by extension. The lmwarden.com server serves exactly these (and sets its own
 * headers); a file of any other type would not be served there, so the build refuses it. */
export const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

/** The paths the server accepts: every segment starts with a letter, digit, "_" or "-". */
const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const PREFIX_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const MAX_FILES = 5000;

// --- SigV4 -------------------------------------------------------------------------------

export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it: unreserved characters kept, "/" kept when `keepSlash`. */
export function uriEncode(s, keepSlash) {
  let out = "";
  for (const b of Buffer.from(s, "utf8")) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** The SigV4 signing key for a date (YYYYMMDD), region and service. */
export function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac("AWS4" + secret, date), region), service), "aws4_request");
}

/**
 * Sign a request with AWS Signature Version 4.
 * `path` is the decoded path ("/bucket/key with space"); it is encoded once per segment
 * (S3's rule; pass `doubleEncode` for other services, whose canonical URI is encoded twice).
 * `query` is a list of [name, value] pairs. `headers` must include host and x-amz-date.
 * Returns {canonicalRequest, stringToSign, signature, authorization}.
 */
export function signV4({ method, path, query = [], headers, payloadHash, accessKey, secretKey, region, service, doubleEncode = false }) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const amzDate = lower["x-amz-date"];
  if (!amzDate) throw new Error("x-amz-date header required");
  const date = amzDate.slice(0, 8);
  let uri = uriEncode(path, true);
  if (doubleEncode) uri = uriEncode(uri, true);
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, uri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(secretKey, date, region, service)).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { canonicalRequest, stringToSign, signature, authorization };
}

export const amzDateOf = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// --- the manifest ------------------------------------------------------------------------

/** Every file under `dir`, as sorted posix paths relative to it. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(relative(dir, p).split(sep).join("/"));
      else throw new Error(`not a regular file: ${relative(dir, p)}`);
    }
  };
  walk(dir);
  return out.sort();
}

export function contentTypeOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? CONTENT_TYPES[name.slice(dot).toLowerCase()] : undefined;
}

/**
 * The manifest for a built site: {commit, version, published, files: {path: sha256}}.
 * `read(path)` returns a file's bytes. Throws on anything the server would refuse.
 */
export function buildManifest({ paths, read, commit, version, published }) {
  if (!COMMIT_RE.test(commit)) throw new Error(`not a full commit SHA: ${commit}`);
  if (paths.length === 0 || paths.length > MAX_FILES) throw new Error(`a site has 1..${MAX_FILES} files, not ${paths.length}`);
  const files = {};
  const bad = [];
  for (const p of [...paths].sort()) {
    if (!PATH_RE.test(p) || p.length > 400) bad.push(`${p}: a path the server does not accept`);
    else if (!contentTypeOf(p)) bad.push(`${p}: a file type the server does not serve`);
    else files[p] = sha256Hex(read(p));
  }
  if (bad.length) throw new Error("the built site has files lmwarden.com cannot serve:\n  " + bad.join("\n  "));
  if (!files["index.html"]) throw new Error("the built site has no index.html");
  return { commit, version: String(version), published, files };
}

/** Upload order: every file, then the commit's manifest, then current.json, last. */
export function uploadPlan(prefix, manifest) {
  const files = Object.keys(manifest.files).map((p) => ({
    key: `${prefix}/${manifest.commit}/${p}`,
    path: p,
    contentType: contentTypeOf(p),
    cacheControl: CACHE_IMMUTABLE,
  }));
  return [
    ...files,
    { key: `${prefix}/manifests/${manifest.commit}.json`, contentType: "application/json", cacheControl: CACHE_IMMUTABLE, manifest: true },
    { key: `${prefix}/current.json`, contentType: "application/json", cacheControl: CACHE_MANIFEST, manifest: true },
  ];
}

// --- S3 ----------------------------------------------------------------------------------

export function s3Config(env) {
  const need = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"];
  const missing = need.filter((k) => !(env[k] ?? "").trim());
  if (missing.length) throw new Error(`not set: ${missing.join(", ")} (see docs/site.md)`);
  const endpoint = new URL(env.S3_ENDPOINT.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && local)) throw new Error("S3_ENDPOINT must be https://");
  if (endpoint.pathname !== "/" || endpoint.search || endpoint.username) throw new Error("S3_ENDPOINT is the origin only, for example https://media.example.com");
  const prefix = (env.S3_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "") || DEFAULT_PREFIX;
  if (!PREFIX_RE.test(prefix)) throw new Error(`S3_PREFIX is not a valid key prefix: ${prefix}`);
  const bucket = env.S3_BUCKET.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("S3_BUCKET is not a valid bucket name");
  return {
    endpoint: endpoint.origin,
    host: endpoint.host,
    bucket,
    prefix,
    region: (env.S3_REGION ?? "").trim() || DEFAULT_REGION,
    accessKey: env.S3_ACCESS_KEY.trim(),
    secretKey: env.S3_SECRET_KEY.trim(),
  };
}

/** A short, secret-free description of an S3 error response. */
function s3Error(status, text) {
  const code = /<Code>([^<]{1,80})<\/Code>/.exec(text)?.[1];
  const msg = /<Message>([^<]{1,200})<\/Message>/.exec(text)?.[1];
  return `HTTP ${status}${code ? ` ${code}` : ""}${msg ? `: ${msg}` : ""}`;
}

/** One signed request; returns the Response. Retries network errors and 5xx a few times. */
export async function s3Request(cfg, method, key, { body, headers = {}, fetchImpl = fetch } = {}) {
  const path = `/${cfg.bucket}/${key}`;
  const payload = body ?? Buffer.alloc(0);
  for (let attempt = 1; ; attempt++) {
    const h = {
      host: cfg.host,
      "x-amz-date": amzDateOf(new Date()),
      "x-amz-content-sha256": sha256Hex(payload),
      ...headers,
    };
    const { authorization } = signV4({ method, path, headers: h, payloadHash: h["x-amz-content-sha256"], accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region, service: "s3" });
    const { host: _host, ...sent } = h;
    try {
      const r = await fetchImpl(cfg.endpoint + uriEncode(path, true), {
        method,
        headers: { ...sent, authorization },
        body: method === "PUT" ? payload : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status >= 500 && attempt < 4) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${method} ${key}: ${err.message}`);
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
    }
  }
}

async function put(cfg, key, body, contentType, cacheControl) {
  const r = await s3Request(cfg, "PUT", key, { body, headers: { "content-type": contentType, "cache-control": cacheControl } });
  if (r.status !== 200) throw new Error(`PUT ${key}: ${s3Error(r.status, await r.text())}`);
  await r.arrayBuffer().catch(() => undefined);
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

// --- git and the build -------------------------------------------------------------------

const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function run(cmd, args, cwd) {
  console.error(`+ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function requireClean() {
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) throw new Error("the working tree has uncommitted changes; commit or stash them first:\n" + dirty);
}

/** Fetch public main; returns its tip. */
function fetchPublicMain(repo) {
  console.error(`fetching main from ${repo}`);
  git(["fetch", "--quiet", "--no-tags", repo, "main"]);
  return git(["rev-parse", "FETCH_HEAD^{commit}"]);
}

function isAncestor(commit, of) {
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, of], { cwd: ROOT }).status === 0;
}

/** Build the site; returns {dir, commit, version, cleanup}. */
function buildSite({ ref, allowUnpublished, publicRepo }) {
  requireClean();
  if (allowUnpublished) {
    const commit = git(["rev-parse", "HEAD"]);
    const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    let onMain = false;
    try {
      onMain = isAncestor(commit, fetchPublicMain(publicRepo));
    } catch {
      /* offline: just say so below */
    }
    if (!onMain) console.error(`warning: ${commit.slice(0, 12)} is not on public main (--allow-unpublished)`);
    run("npm", ["run", "build:site"], ROOT);
    return { dir: join(ROOT, "site-dist", "leanprompt"), commit, version, cleanup: () => {} };
  }
  const tip = fetchPublicMain(publicRepo);
  const commit = ref ? git(["rev-parse", `${ref}^{commit}`]) : tip;
  if (!isAncestor(commit, tip)) throw new Error(`${commit.slice(0, 12)} is not on public main; publish a public commit, or pass --allow-unpublished to publish this checkout`);
  const version = JSON.parse(git(["show", `${commit}:package.json`])).version;
  const work = mkdtempSync(join(tmpdir(), "lp-publish-"));
  const src = join(work, "src");
  run("sh", ["-c", `mkdir -p "$1" && git -C "$2" archive --format=tar "$3" | tar -x -C "$1"`, "sh", src, ROOT, commit], ROOT);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], src);
  run("npm", ["run", "build:site"], src);
  return { dir: join(src, "site-dist", "leanprompt"), commit, version, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

// --- commands ----------------------------------------------------------------------------

async function publish(opts) {
  const cfg = opts.dryRun ? undefined : s3Config(process.env); // fail before the build, not after
  const built = buildSite(opts);
  try {
    const paths = listFiles(built.dir);
    const manifest = buildManifest({ paths, read: (p) => readFileSync(join(built.dir, p)), commit: built.commit, version: built.version, published: new Date().toISOString() });
    const plan = uploadPlan(cfg?.prefix ?? ((process.env.S3_PREFIX ?? "").trim() || DEFAULT_PREFIX), manifest);
    const bytes = paths.reduce((n, p) => n + statSync(join(built.dir, p)).size, 0);
    console.log(`site ${manifest.version} at ${manifest.commit}: ${paths.length} files, ${bytes} bytes`);
    if (opts.dryRun) {
      for (const item of plan) console.log(`  would PUT ${item.key}  (${item.contentType}; ${item.cacheControl})`);
      console.log("dry run: nothing uploaded");
      return;
    }
    const body = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const files = plan.filter((i) => !i.manifest);
    let done = 0;
    await mapLimit(files, 6, async (item) => {
      await put(cfg, item.key, readFileSync(join(built.dir, item.path)), item.contentType, item.cacheControl);
      if (++done % 25 === 0 || done === files.length) console.error(`  uploaded ${done}/${files.length}`);
    });
    for (const item of plan.filter((i) => i.manifest)) await put(cfg, item.key, body, item.contentType, item.cacheControl);
    console.log(`published: ${cfg.bucket}/${cfg.prefix}/current.json now names ${manifest.commit}`);
    console.log("lmwarden.com picks it up within about two minutes; see docs/site.md to check.");
  } finally {
    built.cleanup();
  }
}

async function rollback(commit, opts) {
  if (!COMMIT_RE.test(commit)) throw new Error("--rollback needs a full 40-character commit SHA");
  const cfg = s3Config(process.env);
  const r = await s3Request(cfg, "GET", `${cfg.prefix}/manifests/${commit}.json`);
  if (r.status !== 200) throw new Error(`no published manifest for ${commit} (${s3Error(r.status, await r.text())})`);
  const old = JSON.parse(await r.text());
  if (old.commit !== commit || typeof old.files !== "object") throw new Error(`manifests/${commit}.json is not that commit's manifest`);
  const missing = [];
  await mapLimit(Object.keys(old.files), 8, async (p) => {
    const h = await s3Request(cfg, "HEAD", `${cfg.prefix}/${commit}/${p}`);
    if (h.status !== 200) missing.push(p);
  });
  if (missing.length) throw new Error(`commit ${commit} is incomplete in storage (${missing.length} files missing, e.g. ${missing[0]}); not rolling back`);
  const manifest = { ...old, published: new Date().toISOString(), rolled_back: true };
  if (opts.dryRun) {
    console.log(`dry run: would point ${cfg.prefix}/current.json at ${commit} (${Object.keys(old.files).length} files, all present)`);
    return;
  }
  await put(cfg, `${cfg.prefix}/current.json`, Buffer.from(JSON.stringify(manifest, null, 2) + "\n"), "application/json", CACHE_MANIFEST);
  console.log(`rolled back: ${cfg.bucket}/${cfg.prefix}/current.json now names ${commit}`);
}

function usage(code) {
  console.log(`usage: npm run publish:site [-- --dry-run] [--ref <commit> | --allow-unpublished | --rollback <commit>]

Builds the website and uploads it to S3-compatible storage under <S3_PREFIX>/<commit>/,
then points <S3_PREFIX>/current.json at it. See docs/site.md.`);
  process.exit(code);
}

export function parseArgs(argv) {
  const opts = { dryRun: false, allowUnpublished: false, ref: undefined, rollback: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--allow-unpublished") opts.allowUnpublished = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--ref" || a === "--rollback") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a commit`);
      opts[a === "--ref" ? "ref" : "rollback"] = v;
    } else throw new Error(`unknown option ${a}`);
  }
  if (opts.rollback && (opts.ref || opts.allowUnpublished)) throw new Error("--rollback takes no --ref or --allow-unpublished");
  if (opts.ref && opts.allowUnpublished) throw new Error("--ref and --allow-unpublished exclude each other");
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage(2);
  }
  if (opts.help) usage(0);
  opts.publicRepo = (process.env.LEANPROMPT_PUBLIC_REPO ?? "").trim() || DEFAULT_PUBLIC_REPO;
  try {
    if (opts.rollback) await rollback(opts.rollback, opts);
    else await publish(opts);
  } catch (err) {
    console.error(`publish:site: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
