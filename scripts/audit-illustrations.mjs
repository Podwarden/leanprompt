#!/usr/bin/env node
// npm run illustrations: the picture beside each audit's headline, from its meta.yaml scene.
//
// For every site/audits/<folder>/ whose meta.yaml has `illustration.scene` and lacks
// illustration.webp, fetch it from the illustration service:
//   - with IMGEN_API_TOKEN set, ask the service to draw the scene (slug = the folder name; the same
//     slug and scene give the same picture), wait for the job and download the picture (the share card og.png is not made here: the site build draws it);
//   - without it, download the job the service already finished for that folder and scene, if any.
// Anything still missing at the end is listed and the script exits 1.
//
//   IMGEN_URL         required: the illustration service's base URL (not published; ask the maintainers)
//   IMGEN_API_TOKEN   optional: lets the script start new jobs; never printed
//   IMGEN_TIMEOUT_S   optional: how long to wait for one job, in seconds (default 600)
//
//   --only <folder>   just this audit folder, even when its files exist
//   --force           every audit with a scene, even when its files exist
//   --help
//
// Node 20+, no npm dependencies. See site/audits/README.md.

import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDITS = join(ROOT, "site", "audits");
/** What the service makes, what the site keeps, and the size the build insists on. */
const FILES = [
  { from: "full.webp", to: "illustration.webp", type: "webp", width: 1408, height: 736 },
];

function usage(code) {
  console.log(`usage: npm run illustrations [-- --only <folder> | --force]

Fetches illustration.webp for each audit in site/audits/ whose meta.yaml has
illustration.scene and lacks it.

  IMGEN_URL         required: the illustration service's base URL
  IMGEN_API_TOKEN   optional: lets the script start new jobs (without it, only finished jobs are fetched)
  IMGEN_TIMEOUT_S   optional: seconds to wait for one job (default 600)`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage(0);
const force = args.includes("--force");
const oi = args.indexOf("--only");
const only = oi >= 0 ? args[oi + 1] : undefined;
if (oi >= 0 && (!only || only.startsWith("--"))) usage(2);
for (const a of args) if (a.startsWith("--") && !["--force", "--only"].includes(a)) usage(2);

const base = (process.env.IMGEN_URL ?? "").trim().replace(/\/+$/, "");
if (!base) {
  console.error("IMGEN_URL is not set. It is the base URL of the illustration service that draws the audit pictures (not published; ask the maintainers), for example: export IMGEN_URL=http://<host>:<port>");
  process.exit(2);
}
if (!/^https?:\/\//.test(base)) {
  console.error("IMGEN_URL must start with http:// or https://");
  process.exit(2);
}
const token = (process.env.IMGEN_API_TOKEN ?? "").trim();
const timeoutS = Number(process.env.IMGEN_TIMEOUT_S ?? 600);

// --- meta.yaml: only the illustration block is read, so no YAML library is needed.
/** The value of `key:` among the indented lines of a block; supports "double", 'single', plain and >- / | blocks. */
function blockValue(lines, key) {
  const i = lines.findIndex((l) => new RegExp(`^\\s+${key}:`).test(l));
  if (i < 0) return undefined;
  const indent = /^(\s*)/.exec(lines[i])[1].length;
  const raw = lines[i].replace(new RegExp(`^\\s+${key}:\\s*`), "");
  if (/^[>|][+-]?\s*$/.test(raw)) {
    const body = [];
    for (let j = i + 1; j < lines.length && (/^\s*$/.test(lines[j]) || /^(\s*)/.exec(lines[j])[1].length > indent); j++) body.push(lines[j].trim());
    return raw.startsWith(">") ? body.join(" ").replace(/\s+/g, " ").trim() : body.join("\n").trim();
  }
  if (raw.startsWith('"')) return JSON.parse(raw.replace(/\s+#.*$/, "").trim());
  if (raw.startsWith("'")) return raw.trim().slice(1, -1).replace(/''/g, "'");
  return raw.replace(/\s+#.*$/, "").trim();
}

function illustrationOf(metaText) {
  const lines = metaText.split("\n");
  const start = lines.findIndex((l) => /^illustration:\s*$/.test(l));
  if (start < 0) return undefined;
  const block = [];
  for (let j = start + 1; j < lines.length && (/^\s+\S/.test(lines[j]) || /^\s*$/.test(lines[j])); j++) block.push(lines[j]);
  const scene = blockValue(block, "scene");
  return scene ? { scene } : undefined;
}

// --- images
function imageInfo(b) {
  if (b.length >= 33 && b.toString("latin1", 1, 4) === "PNG" && b.toString("latin1", 12, 16) === "IHDR") return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const c = b.toString("latin1", 12, 16);
    if (c === "VP8 ") return { type: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (c === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (c === "VP8X") return { type: "webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return undefined;
}

// --- the service
async function http(method, path, body) {
  const headers = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (method === "POST") headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`cannot reach the illustration service at IMGEN_URL (${err.cause?.code ?? err.name}): is it up, and is this machine on its network?`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`the service refused the token (HTTP ${res.status}): check IMGEN_API_TOKEN`);
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function download(jobId, from) {
  // The permalink needs no token and never expires; it redirects to the stored file.
  const res = await fetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}/images/${from}`, { redirect: "follow", signal: AbortSignal.timeout(120_000) }).catch((err) => {
    throw new Error(`cannot download ${from} of job ${jobId} (${err.cause?.code ?? err.name})`);
  });
  if (!res.ok) throw new Error(`downloading ${from} of job ${jobId} answered HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function waitFor(jobId) {
  const until = Date.now() + timeoutS * 1000;
  let last = "";
  for (;;) {
    const job = await http("GET", `/v1/jobs/${encodeURIComponent(jobId)}`);
    if (job.status !== last) process.stdout.write(`  job ${jobId}: ${job.status}\n`);
    last = job.status;
    if (job.status === "done") return job;
    if (job.status === "failed") throw new Error(`job ${jobId} failed: ${job.error ?? "no reason given"}`);
    if (Date.now() > until) throw new Error(`job ${jobId} still ${job.status} after ${timeoutS}s (raise IMGEN_TIMEOUT_S, or run again later: the same scene picks the job up)`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** A finished job for this folder and exactly this scene, newest first; undefined when there is none. */
async function existingJob(slug, scene) {
  const list = await http("GET", `/v1/jobs?slug=${encodeURIComponent(slug)}&limit=50`);
  const done = (Array.isArray(list) ? list : []).filter((j) => j.slug === slug && j.status === "done").sort((a, b) => b.created - a.created);
  for (const j of done) {
    const job = await http("GET", `/v1/jobs/${encodeURIComponent(j.job_id)}`);
    if (job.scene === scene) return job;
  }
  return undefined;
}

async function fetchFor(folder, scene) {
  let job;
  if (token) {
    const made = await http("POST", "/v1/illustrations", { slug: folder, scene });
    if (!made.job_id) throw new Error("the service accepted the request but returned no job_id");
    job = await waitFor(made.job_id);
  } else {
    job = await existingJob(folder, scene);
    if (!job) return false;
    console.log(`  found finished job ${job.job_id}`);
  }
  const out = [];
  for (const f of FILES) {
    const b = await download(job.job_id, f.from);
    const info = imageInfo(b);
    if (!info || info.type !== f.type || info.width !== f.width || info.height !== f.height)
      throw new Error(`${f.from} of job ${job.job_id} is not a ${f.width}x${f.height} ${f.type.toUpperCase()} (got ${info ? `${info.width}x${info.height} ${info.type}` : "an unreadable file"})`);
    out.push([f.to, b]);
  }
  for (const [to, b] of out) {
    const dest = join(AUDITS, folder, to);
    writeFileSync(`${dest}.tmp`, b);
    renameSync(`${dest}.tmp`, dest);
    console.log(`  wrote site/audits/${folder}/${to} (${Math.round(b.length / 1024)} KB)`);
  }
  return true;
}

const folders = readdirSync(AUDITS)
  .filter((d) => !d.startsWith("_") && !d.startsWith(".") && statSync(join(AUDITS, d)).isDirectory())
  .sort();
if (only && !folders.includes(only)) {
  console.error(`no audit folder site/audits/${only} (folder names are case-sensitive)`);
  process.exit(2);
}

const missing = [];
let failed = false;
for (const folder of only ? [only] : folders) {
  const metaFile = join(AUDITS, folder, "meta.yaml");
  if (!existsSync(metaFile)) continue;
  let ill;
  try {
    ill = illustrationOf(readFileSync(metaFile, "utf8"));
  } catch (err) {
    console.error(`${folder}: cannot read illustration.scene from meta.yaml (${err.message})`);
    failed = true;
    continue;
  }
  if (!ill) {
    if (only) {
      console.error(`${folder}: meta.yaml has no illustration.scene`);
      failed = true;
    }
    continue;
  }
  const have = FILES.every((f) => existsSync(join(AUDITS, folder, f.to)));
  if (have && !force && !only) continue;
  console.log(`${folder}:`);
  try {
    if (!(await fetchFor(folder, ill.scene))) missing.push(folder);
  } catch (err) {
    console.error(`  ${err.message}`);
    failed = true;
  }
}

if (missing.length) {
  console.error(`\nNo finished picture for this scene yet: ${missing.join(", ")}.\nSet IMGEN_API_TOKEN to have the service draw it, then run this again.`);
  process.exit(1);
}
if (failed) process.exit(1);
console.log("illustrations: up to date");
